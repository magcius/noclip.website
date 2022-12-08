import { mat4, vec3, vec4 } from "gl-matrix";
import { IntersectionState } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x3, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import {  GfxBufferUsage,GfxDevice, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxInputState } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { CalcBillboardFlags, calcBillboardMatrix, lerp, transformVec3Mat4w1 } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { ViewerRenderInput } from "../viewer";
import { NfsMap } from "./map";
import { NfsTexture } from "./region";
import { attachmentStatesAdditive, attachmentStatesTranslucent } from "./render";

export class NfsParticleEmitterGroup {

    private children: NfsParticleEmitter[];

    constructor(public transformationMatrix: mat4, emitterType: number, map: NfsMap) {
        this.children = emitterGroups[emitterType].map(e => new NfsParticleEmitter(this, e, map));
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        this.children.forEach(e => e.prepareToRender(renderInstManager, viewerInput));
    }
}


const worldMat = mat4.create();
const pos = vec3.create();
export class NfsParticleEmitter {

    private emitterProperties: NfsParticleEmitterType;
    private timeToNextCycle: number = 0;
    private timerToNextParticle: number;
    private timeBetweenParticles: number;
    private active: boolean = false;
    private texture: NfsTexture;
    private particlePool: NfsParticle[] = [];
    private minFreeParticle: number = 0;

    public static inputLayout: GfxInputLayout;
    public static inputState: GfxInputState;
    private static vertexBuffer: GfxBuffer;
    private static indexBuffer: GfxBuffer;

    constructor(public parent: NfsParticleEmitterGroup, props: NfsParticleEmitterType, map: NfsMap) {
        this.emitterProperties = props;
        this.texture = map.textureCache[props.textureId];

        const initialPoolSize = Math.min(props.numParticles, Math.ceil(props.life * props.numParticles / props.onCycle));
        for(let i = 0; i < initialPoolSize; i++) {
            this.particlePool.push(new NfsParticle());
        }

        // Simulate emitter for a bit
        let timer = Math.max(0, props.life + props.lifeDelta - (props.onCycle / props.numParticles + props.offCycle)) + Math.random() * (props.onCycle + props.offCycle);
        for(; timer > 0; timer -= 1/15) {
            this.update(1/15);
        }
    }

    public static init(device: GfxDevice) {
        // construct simple quad for particles
        NfsParticleEmitter.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]).buffer);
        NfsParticleEmitter.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array([0, 2, 3, 0, 1, 3]).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        NfsParticleEmitter.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });
        NfsParticleEmitter.inputState = device.createInputState(this.inputLayout,
            [{ buffer: NfsParticleEmitter.vertexBuffer, byteOffset: 0 }],
            { buffer: NfsParticleEmitter.indexBuffer, byteOffset: 0 }
        );
    }

    public update(deltaTime: number) {
        for(let i = 0; i < this.particlePool.length; i++){
            const particle = this.particlePool[i];
            if(particle.lifeTimer >= particle.lifeEnd)
                continue;
            vec3.scaleAndAdd(particle.position, particle.position, particle.velocity, (1 - this.emitterProperties.drag) * deltaTime);
            vec3.scaleAndAdd(particle.velocity, particle.velocity, particle.accel, deltaTime);
            particle.texFrameCounter += this.emitterProperties.texAnimFps * deltaTime;
            particle.lifeTimer += deltaTime;
            if(particle.lifeTimer >= particle.lifeEnd) {
                this.minFreeParticle = Math.min(this.minFreeParticle, i);
            }
        }
        while(this.timeToNextCycle <= 0) {
            this.active = !this.active;
            if(this.active) {
                const onCycleDuration = this.emitterProperties.onCycle + this.emitterProperties.onCycleDelta * (Math.random() * 2 - 1);
                this.timeToNextCycle += onCycleDuration;
                this.timeBetweenParticles = onCycleDuration / Math.max(1, this.emitterProperties.numParticles + (Math.random() * 2 - 1) * this.emitterProperties.numParticlesDelta);
                this.timerToNextParticle = 0;
            }
            else {
                this.timeToNextCycle += this.emitterProperties.offCycle + this.emitterProperties.offCycleDelta * (Math.random() * 2 - 1);
            }
        }
        this.timeToNextCycle -= deltaTime;
        while(this.active && this.timerToNextParticle <= 0) {
            this.emitParticle();
            this.timerToNextParticle += this.timeBetweenParticles;
        }
        this.timerToNextParticle -= deltaTime;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        assert(this.emitterProperties !== undefined);
        const camPos: vec3 = [viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]];
        const thisPos: vec3 = [this.parent.transformationMatrix[12], this.parent.transformationMatrix[13], this.parent.transformationMatrix[14]];
        let clipRatio = vec3.dist(camPos, thisPos) / this.emitterProperties.farClip;
        if(clipRatio >= 1)
            return;
        const props = this.emitterProperties;
        const center = vec3.create();
            transformVec3Mat4w1(center, this.parent.transformationMatrix, props.volumeOffset);
        if(viewerInput.camera.frustum.intersectSphere(center, props.frustumSphereRadius) == IntersectionState.FULLY_OUTSIDE)
            return;
        const deltaTime = viewerInput.deltaTime / 1000;
        this.update(deltaTime);
        const template = renderInstManager.getTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings([this.texture]);
        if(props.additiveBlend)
            template.setMegaStateFlags({attachmentsState: attachmentStatesAdditive});
        for(let i = 0; i < this.particlePool.length; i++) {
            const particle = this.particlePool[i];
            if(particle.lifeTimer >= particle.lifeEnd)
                continue;
            const renderInst = renderInstManager.newRenderInst();
            let offs = renderInst.allocateUniformBuffer(NfsParticleProgram.ub_ObjectParams, 32);
            const d = renderInst.mapUniformBufferF32(NfsParticleProgram.ub_ObjectParams);

            let t = particle.lifeTimer / particle.lifeEnd;

            // Anim interpolation; just an approximation but it's close enough
            t = t < 0.25 ? 4*t : t < 0.75 ? 2*t + 0.5 : 4*t - 1;
            const keyframe = Math.min(Math.floor(t), 2);
            t = t % 1;
            t = t * t * (3 - 2*t);
            const color = vec4.create();
            vec4.lerp(color, props.colorKeyframes[keyframe], props.colorKeyframes[keyframe + 1], t);

            // fade out at distance
            if(clipRatio > 0.8)
                color[3] *= (1.0 - clipRatio) * 5;

            const size = 0.5 * lerp(props.sizeKeyframes[keyframe], props.sizeKeyframes[keyframe + 1], t);
            transformVec3Mat4w1(pos, this.parent.transformationMatrix, particle.position);
            mat4.fromTranslation(worldMat, pos);
            mat4.scale(worldMat, worldMat, [size, size, size]);
            mat4.mul(worldMat, viewerInput.camera.viewMatrix, worldMat);
            calcBillboardMatrix(worldMat, worldMat, CalcBillboardFlags.UseZPlane | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseRollGlobal);
            if(props.hasRotation) {
                const rotation = (particle.initialRotation + lerp(props.relativeRotationKeyframes[keyframe], props.relativeRotationKeyframes[keyframe + 1], t)) * Math.PI / 180;
                mat4.rotateZ(worldMat, worldMat, rotation);
            }

            offs += fillMatrix4x3(d, offs, worldMat);
            offs += fillVec4v(d, offs, color);
            offs += fillVec4(d, offs, Math.floor(particle.texFrameCounter), this.emitterProperties.texAnimSize, 0, 0);
            renderInstManager.submitRenderInst(renderInst);
        }
        if(props.additiveBlend)
            template.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent});
    }

    public emitParticle() {
        let particle;
        if(this.minFreeParticle == this.particlePool.length) {
            particle = new NfsParticle();
            this.particlePool.push(particle);
        }
        else {
            particle = this.particlePool[this.minFreeParticle];
        }
        let nextParticle;
        do {
            this.minFreeParticle++;
            nextParticle = this.particlePool[this.minFreeParticle];
        } while(this.minFreeParticle < this.particlePool.length && nextParticle.lifeTimer < nextParticle.lifeEnd);
        const props = this.emitterProperties;
        vec3.mul(particle.position, props.volumeExtent, [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
        vec3.add(particle.position, particle.position, props.volumeOffset);
        vec3.mul(particle.velocity, props.velocityDelta, [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
        vec3.add(particle.velocity, particle.velocity, props.velocity);
        vec3.mul(particle.accel, props.accelDelta, [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
        vec3.add(particle.accel, particle.accel, props.accel);
        particle.lifeTimer = 0;
        particle.lifeEnd = props.life +  + (Math.random() * 2 - 1) * props.lifeDelta;
        particle.texFrameCounter = Math.floor(Math.random() * props.texAnimSize * props.texAnimSize);
        if(props.hasRotation)
            particle.initialRotation = Math.random() * 360;
    }

    public static destroy(device: GfxDevice) {
        device.destroyInputLayout(NfsParticleEmitter.inputLayout);
        device.destroyInputState(NfsParticleEmitter.inputState);
        device.destroyBuffer(NfsParticleEmitter.vertexBuffer);
        device.destroyBuffer(NfsParticleEmitter.indexBuffer);
    }

}

class NfsParticle {
    public lifeTimer: number = 0;
    public lifeEnd: number = 0;
    public position: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();
    public accel: vec3 = vec3.create();
    public initialRotation: number = 0;
    public texFrameCounter: number = 0;
}

export class NfsParticleProgram extends DeviceProgram {

    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `

    layout(std140) uniform ub_SceneParams {
        Mat4x4 u_ViewProjMat;
    };

    layout(std140) uniform ub_ObjectParams {
        Mat4x3 u_ObjectViewMat;
        vec4 u_Color;
        float u_Frame;
        float u_Size;
    };
    `;

    public override vert = `
layout(location = ${NfsParticleProgram.a_Position}) in vec3 a_Position;

out vec2 v_TexCoord;

void main() {
    gl_Position = Mul(u_ViewProjMat, vec4(Mul(u_ObjectViewMat, vec4(a_Position, 1.0)), 1.0));

    float frame = mod(u_Frame, u_Size * u_Size);
    float constX = mod(frame, u_Size);
    float constY = floor(frame / u_Size);
    vec2 texCoord = ((a_Position.xy + 1.0) / 2.0);
    texCoord.y = 1.0 - texCoord.y;
    v_TexCoord = texCoord / u_Size + (1.0 / u_Size) * vec2(constX, constY);
}
    `;

    public override frag = `
uniform sampler2D u_Texture;

in vec2 v_TexCoord;

void main() {
    gl_FragColor = (texture(SAMPLER_2D(u_Texture), v_TexCoord) * u_Color).rgba;
    gl_FragColor.a *= 2.0;
}
    `;

}

type NfsParticleEmitterType = {
    volumeOffset: vec3;
    volumeExtent: vec3;
    life: number;
    lifeDelta: number;
    onCycle: number;
    onCycleDelta: number;
    offCycle: number;
    offCycleDelta: number;
    numParticles: number;
    numParticlesDelta: number;
    velocity: vec3;
    velocityDelta: vec3;
    accel: vec3;
    accelDelta: vec3;
    drag: number;
    textureId: number;
    texAnimSize: number;
    texAnimFps: number;
    colorKeyframes: vec4[];
    sizeKeyframes: number[];
    relativeRotationKeyframes: number[];
    hasRotation: boolean;
    farClip: number;
    frustumSphereRadius: number;
    additiveBlend: boolean;
}

function makeEmitterType(type: Partial<NfsParticleEmitterType>, template: NfsParticleEmitterType): NfsParticleEmitterType {
    return Object.assign({}, template, type);
}

const emitter_base: NfsParticleEmitterType = {
    volumeOffset: [0, 0, 0],
    volumeExtent: [0, 0, 0],
    life: 1,
    lifeDelta: 0,
    onCycle: 1,
    onCycleDelta: 0,
    offCycle: 0,
    offCycleDelta: 0,
    numParticles: 1,
    numParticlesDelta: 0,
    velocity: [0, 0, 0],
    velocityDelta: [0, 0, 0],
    accel: [0, 0, 0],
    accelDelta: [0, 0, 0],
    drag: 0,
    textureId: 0,
    texAnimSize: 1,
    texAnimFps: 0,
    colorKeyframes: [
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1]
    ],
    sizeKeyframes: [1, 1, 1, 1],
    relativeRotationKeyframes: [0, 0, 0, 0],
    hasRotation: false,
    farClip: 300,
    frustumSphereRadius: 100,
    additiveBlend: false
};

const emitter_smk_white = makeEmitterType({
    life: 4,
    volumeExtent: [0, 0, 3],
    velocity: [0, 0, 3],
    velocityDelta: [0, 0, 1],
    accel: [-1, -1, 0],
    accelDelta: [1, 1, 0],
    textureId: 0x1c960c2e,
    colorKeyframes: [
        [0.239, 0.239, 0.239, 0.208],
        [0.4, 0.4, 0.4, 0.878],
        [0.737, 0.737, 0.737, 0.667],
        [0.878, 0.898, 0.898, 0],
    ],
    sizeKeyframes: [10, 15, 15, 20],
    relativeRotationKeyframes: [0, 4, 8, 12],
    hasRotation: true,
    farClip: 1000,
    frustumSphereRadius: 40
}, emitter_base);

const emitter_smk_brown = makeEmitterType({
    colorKeyframes: [
        [0.498, 0.439, 0.247, 0],
        [0.376, 0.4, 0.337, 0.439],
        [0.4, 0.388, 0.247, 0.6],
        [0.757, 0.678, 0.588, 0],
    ],
}, emitter_smk_white);

const emitter_smk_chimney = makeEmitterType({
    accel: [-0.25, -0.25, 0],
    accelDelta: [0.25, 0.25, 0],
    numParticles: 2,
    sizeKeyframes: [2, 3, 5, 10],
    velocity: [0, 0, 2],
    volumeExtent: [0, 0, 0],
    farClip: 150,
}, emitter_smk_white);

const emitter_leaves1 = makeEmitterType({
    numParticles: 10,
    numParticlesDelta: 1,
    life: 8,
    volumeOffset: [0, 0, 8],
    volumeExtent: [3, 3, 5],
    onCycleDelta: 0.9,
    offCycle: 4,
    offCycleDelta: 0.9,
    velocity: [0, 0, -0.5],
    velocityDelta: [4, 4, 0],
    accel: [0, 0, -1.3],
    accelDelta: [2, 2, 0.8],
    textureId: 0x5799147d,
    texAnimFps: 12,
    texAnimSize: 4,
    colorKeyframes: [
        [0.4, 0.349, 0.227, 1],
        [0.4, 0.373, 0.216, 1],
        [0.682, 0.663, 0.49, 1],
        [0.694, 0.659, 0.31, 1],
    ],
    sizeKeyframes: [0.8, 0.7, 0.6, 0.6],
    relativeRotationKeyframes: [12, 256, -128, 168],
    hasRotation: true,
    farClip: 200,
    frustumSphereRadius: 50
}, emitter_base);

const emitter_leaves2 = makeEmitterType({
    accelDelta: [4, 4, 1],
    accel: [-2, -2, -2],
    drag: 0.15,
    farClip: 200,
    hasRotation: true,
    life: 10,
    numParticles: 100,
    offCycle: 10,
    offCycleDelta: 0,
    onCycle: 6,
    onCycleDelta: 0,
    relativeRotationKeyframes: [0, 0, 0, 0],
    sizeKeyframes: [0.5, 0.5, 0.5, 0.5],
    texAnimFps: 6,
    velocity: [12, -3, -3],
    velocityDelta: [6, 5, 2],
    volumeOffset: [0, 0, 1],
    volumeExtent: [0, 30, 5],
    frustumSphereRadius: 60
}, emitter_leaves1);

const emitter_nis_leaves3 = makeEmitterType({
    accel: [-0.5, -0.5, -0.15],
    accelDelta: [0.5, 0.5, 0],
    colorKeyframes: [
        [0.4, 0.349, 0.227, 1],
        [0.4, 0.373, 0.216, 1],
        [0.682, 0.663, 0.49, 1],
        [0.694, 0.659, 0.31, 0],
    ],
    drag: 0.025,
    farClip: 200,
    hasRotation: true,
    life: 5,
    numParticles: 25,
    offCycle: 10,
    sizeKeyframes: [0.5, 0.5, 0.5, 0.5],
    textureId: 0x5799147d,
    texAnimFps: 30,
    texAnimSize: 4,
    velocity: [-2, 0, 1],
    velocityDelta: [1, 0, 1],
    volumeExtent: [5, 5, 2],
    frustumSphereRadius: 30
}, emitter_base);

const emitter_bird01 = makeEmitterType({
    colorKeyframes: [
        [0.451, 0.506, 0.506, 0],
        [0.565, 0.616, 0.616, 0.8],
        [0.439, 0.486, 0.486, 0.8],
        [0.424, 0.459, 0.459, 0.2],
    ],
    farClip: 300,
    life: 15,
    sizeKeyframes: [3, 1.6, 1.2, 0.5],
    textureId: 0x2d28ae86,
    texAnimFps: 12,
    texAnimSize: 4,
    velocity: [2, 2, 0.4],
    velocityDelta: [4, 4, 0.4],
    volumeExtent: [20, 20, 10]
}, emitter_base);

const emitter_blackbird01 = makeEmitterType({
    colorKeyframes: [
        [0.11, 0.122, 0.122, 0.314],
        [0.196, 0.216, 0.216, 0.616],
        [0.133, 0.149, 0.149, 0.588],
        [0.082, 0.09, 0.09, 0],
    ],
    life: 4,
    numParticles: 90,
    offCycle: 10,
    onCycle: 6,
    sizeKeyframes: [1, 1, 1, 0.5],
    velocity: [12, -6, 3],
    velocityDelta: [4, 4, 2],
    volumeOffset: [0, 0, 5],
    volumeExtent: [4, 50, 2],
    frustumSphereRadius: 75
}, emitter_bird01);

const emitter_blackbird02 = makeEmitterType({
    numParticles: 50,
    life: 10,
    volumeExtent: [1, 1, 1],
    onCycle: 1,
    volumeOffset: [0, 0, 0],
    frustumSphereRadius: 150
}, emitter_blackbird01);

const emitter_fog1 = makeEmitterType({
    life: 10,
    volumeOffset: [0, 0, 1],
    volumeExtent: [25, 15, 2],
    onCycleDelta: 1,
    offCycle: 2,
    offCycleDelta: 1,
    velocity: [-0.25, -0.25, 0],
    velocityDelta: [0.5, 0.5, 0],
    textureId: 0xb68a85b0,
    colorKeyframes: [
        [0.518, 0.518, 0.6, 0],
        [0.6, 0.537, 0.537, 0.059],
        [0.8, 0.765, 0.702, 0.098],
        [0.8, 0.776, 0.557, 0],
    ],
    sizeKeyframes: [7.5, 7.5, 7.5, 7.5],
    relativeRotationKeyframes: [0, 15, 20, 60],
    hasRotation: true,
    farClip: 175,
    frustumSphereRadius: 25,
}, emitter_base);

const emitter_fog2 = makeEmitterType({
    colorKeyframes: [
        [0.6, 0.439, 0.286, 0],
        [0.6, 0.459, 0.208, 0.047],
        [0.8, 0.6, 0.6, 0.098],
        [0.8, 0.776, 0.557, 0],
    ]
}, emitter_fog1);

const emitter_fog3 = makeEmitterType({
    textureId: 0x82a192ac,
    colorKeyframes: [
        [0.518, 0.518, 0.6, 0],
        [0.6, 0.537, 0.537, 0.059],
        [0.8, 0.761, 0.702, 0.059],
        [0.8, 0.776, 0.557, 0],
    ],
}, emitter_fog1);

const emitter_fog4 = makeEmitterType({
    textureId: 0x82a192ac,
    colorKeyframes: [
        [0.6, 0.439, 0.286, 0],
        [0.6, 0.459, 0.208, 0.047],
        [0.8, 0.6, 0.6, 0.059],
        [0.8, 0.776, 0.557, 0],
    ],
}, emitter_fog2);

const emitter_fog_far1 = makeEmitterType({
    relativeRotationKeyframes: [0, 5, 10, 15],
    accelDelta: [0.25, 0, 0],
    colorKeyframes: [
        [0.518, 0.518, 0.6, 0],
        [0.6, 0.537, 0.537, 0.498],
        [0.8, 0.765, 0.702, 0.247],
        [0.8, 0.776, 0.557, 0],
    ],
    farClip: 500,
    hasRotation: true,
    life: 8,
    numParticles: 5,
    numParticlesDelta: 1,
    sizeKeyframes: [20, 20, 20, 20],
    velocity: [2, 2, 0.25],
    volumeOffset: [0, -25, 10],
    volumeExtent: [100, 50, 20],
    textureId: 0x384c271,
}, emitter_base);

const emitter_splashmist1 = makeEmitterType({
    relativeRotationKeyframes: [0, 6, 20, 24],
    accel: [0.5, 0, -2],
    accelDelta: [1, 1, 0],
    colorKeyframes: [
        [0.369, 0.388, 0.4, 0.2],
        [0.557, 0.576, 0.6, 0.247],
        [0.557, 0.6, 0.6, 0.188],
        [0.369, 0.388, 0.388, 0],
    ],
    drag: 0.4,
    farClip: 75,
    hasRotation: true,
    numParticles: 10,
    sizeKeyframes: [1, 1.5, 1.5, 3],
    textureId: 0xa8f05a25,
    volumeOffset: [0, 0, 0.25],
    volumeExtent: [2.5, 2.5, 0.5],
    frustumSphereRadius: 10
}, emitter_base);

const emitter_splashmist2 = makeEmitterType({
    numParticles: 25,
    sizeKeyframes: [0, 4, 8, 12],
    volumeExtent: [1, 10, 1]
}, emitter_splashmist1);

const emitter_splashmist3 = makeEmitterType({
    numParticles: 35,
    sizeKeyframes: [0, 1, 2.5, 3],
}, emitter_splashmist2);

const emitter_splashsparkle1 = makeEmitterType({
    drag: 0.3,
    farClip: 50,
    accel: [0, 0, -0.7],
    hasRotation: true,
    life: 0.25,
    numParticles: 20,
    sizeKeyframes: [0.0625, 0.0625, 0.0625, 0.125],
    textureId: 0xc55cfa87,
    volumeExtent: [2.5, 2.5, 1],
    additiveBlend: true,
    frustumSphereRadius: 5
}, emitter_base);

const emitter_splashsparkle2 = makeEmitterType({
    numParticles: 40,
    volumeExtent: [1, 10, 3],
}, emitter_splashsparkle1);

const emitter_fountainmist2 = makeEmitterType({
    relativeRotationKeyframes: [0, 6, 20, 24],
    accel: [0, 2, 0],
    accelDelta: [0.5, 0.5, 0.25],
    colorKeyframes: [
        [0.749, 0.8, 0.8, 0],
        [0.776, 0.847, 0.859, 0.329],
        [0.827, 0.898, 0.898, 0.2],
        [0.729, 0.776, 0.8, 0],
    ],
    drag: 0.1,
    farClip: 75,
    life: 2,
    numParticles: 2,
    textureId: 0x384c271,
    volumeOffset: [0, 0, 1],
    volumeExtent: [2.5, 2.5, 1],
    sizeKeyframes: [1, 2, 3, 3],
    frustumSphereRadius: 10
}, emitter_base);

const emitter_fountainmist3 = makeEmitterType({
    numParticles: 5,
    volumeExtent: [1, 10, 1]
}, emitter_fountainmist2);

const emitter_small_steam1 = makeEmitterType({
    relativeRotationKeyframes: [2, 3, 4, 5],
    colorKeyframes: [
        [0.478, 0.478, 0.478, 0],
        [0.459, 0.459, 0.459, 0.149],
        [0.478, 0.478, 0.478, 0.098],
        [0.498, 0.498, 0.498, 0],
    ],
    farClip: 100,
    accel: [0, 0, 0.1],
    hasRotation: true,
    life: 2,
    numParticles: 5,
    sizeKeyframes: [1, 1.5, 2.5, 4],
    textureId: 0x82a192ac,
    velocity: [0.2, 0.2, 0.2],
    volumeOffset: [0, 0, 0.125],
    volumeExtent: [3, 1.5, 0.25],
    frustumSphereRadius: 5,
}, emitter_base);

const emitter_steamjet = makeEmitterType({
    accel: [-1, -1, 0],
    accelDelta: [2, 5, 0.5],
    drag: 0.25,
    velocityDelta: [1, 1, 1],
    numParticles: 100,
    sizeKeyframes: [1, 5, 8, 15],
    velocity: [0, 0, 10],
    volumeExtent: [0, 0, 0],
    frustumSphereRadius: 40
}, emitter_small_steam1);

export const emitterGroups: {[type: number]: NfsParticleEmitterType[]} = {
    0x2f23057a: [emitter_smk_white],
    0xfd8995c1: [emitter_smk_brown],
    0xfd888a4b: [emitter_smk_chimney],
    0x96ac4f78: [emitter_leaves1],
    0x4d9e7f58: [emitter_blackbird02],
    0x378d447e: [emitter_fog1, emitter_fog3],
    0x0b9204ce: [emitter_fog_far1],
    0x5cfeb5aa: [emitter_nis_leaves3],
    0x39ede226: [emitter_blackbird01, emitter_leaves2],
    0x45f3b7ed: [emitter_bird01],
    0xf8170eed: [emitter_fog2, emitter_fog4],
    0x8010a402: [emitter_splashmist1, emitter_splashsparkle1, emitter_fountainmist2],
    0x85676c22: [emitter_splashmist2, emitter_splashsparkle2, emitter_fountainmist3],
    0x67306f57: [emitter_splashmist3, emitter_splashsparkle2],
    0x4b54ad54: [emitter_small_steam1],
    0x0a2097e1: [emitter_steamjet]
};
