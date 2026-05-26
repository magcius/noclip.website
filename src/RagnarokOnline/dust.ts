import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GfxTopology, makeTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers.js";
import { DeviceProgram } from "../Program.js";
import { MobEntity } from "./entity.js";
import { makeSoftDiscImage } from "./weather.js";

const DUST_LIFETIME = 0.4;
const DUST_HALF_SIZE_START = 1.0;
const DUST_HALF_SIZE_END = 2.5;
const DUST_PEAK_ALPHA = 0.5;

const DUST_LIFT_TOTAL = 2.5;

const DUST_LIFT_INITIAL = 0.4;
const DUST_COLOR_R = 180;
const DUST_COLOR_G = 165;
const DUST_COLOR_B = 140;
const DUST_INITIAL_POOL = 256;

interface DustParticle {
    posX: number; posY: number; posZ: number;
    age: number;
    alive: boolean;
}

const DUST_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 4 * 4;
const DUST_FLOATS_PER_VERTEX = 9;

const DUST_CORNER_OX = [-1, 1, 1, -1];
const DUST_CORNER_OY = [-1, -1, 1, 1];
const DUST_CORNER_U = [0, 1, 1, 0];
const DUST_CORNER_V = [1, 1, 0, 0];

class DustProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Offset = 1;
    public static a_TexCoord = 2;
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_CamRight;
    vec4 u_CamUp;
    vec4 u_DustColor;
};

uniform sampler2D u_Texture;

varying vec3 v_TexCoord;
`;

    public override vert = `
layout(location = ${DustProgram.a_Position}) in vec3 a_Position;
layout(location = ${DustProgram.a_Offset}) in vec2 a_Offset;
layout(location = ${DustProgram.a_TexCoord}) in vec4 a_TexCoord;

void main() {
    vec3 t_World = a_Position
                 + u_CamRight.xyz * a_Offset.x
                 + u_CamUp.xyz    * a_Offset.y;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_World, 1.0);
    v_TexCoord = a_TexCoord.xyz;
}
`;

    public override frag = `
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
    gl_FragColor = vec4(u_DustColor.rgb, t_Tex.a * v_TexCoord.z);
}
`;
}

export class DustRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private texture: GfxTexture;

    private mobs: MobEntity[] = [];
    private lastSeenEpoch: number[] = [];

    private particles: DustParticle[] = [];
    private freeList: number[] = [];

    private cpuData: ArrayBuffer = new ArrayBuffer(0);
    private cpuF32: Float32Array = new Float32Array(0);
    private cpuU8: Uint8Array = new Uint8Array(0);

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"]) {
        this.program = cache.createProgram(new DustProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: DustProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: DustProgram.a_Offset, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: DustProgram.a_TexCoord, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: DUST_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        const img = makeSoftDiscImage(DUST_COLOR_R, DUST_COLOR_G, DUST_COLOR_B);
        this.texture = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.texture, 0, [img.rgba]);

        this.growPool(DUST_INITIAL_POOL);
    }

    public setMobs(mobs: MobEntity[]): void {
        this.mobs = mobs;
        if (this.lastSeenEpoch.length !== mobs.length)
            this.lastSeenEpoch = new Array(mobs.length);
        for (let i = 0; i < mobs.length; i++)
            this.lastSeenEpoch[i] = mobs[i].stepEpoch;
    }

    private growPool(target: number): void {
        const oldLen = this.particles.length;
        if (oldLen >= target)
            return;
        for (let i = oldLen; i < target; i++) {
            this.particles.push({ posX: 0, posY: 0, posZ: 0, age: 0, alive: false });
            this.freeList.push(i);
        }
    }

    private spawnOne(x: number, y: number, z: number): void {
        if (this.freeList.length === 0)
            this.growPool(this.particles.length * 2);
        const idx = this.freeList.pop()!;
        const p = this.particles[idx];
        p.posX = x;
        p.posY = y + DUST_LIFT_INITIAL;
        p.posZ = z;
        p.age = 0;
        p.alive = true;
    }

    public update(dt: number): void {
        if (dt <= 0) {

            this.drainStepEvents();
            return;
        }
        this.drainStepEvents();

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.alive)
                continue;
            p.age += dt;
            if (p.age >= DUST_LIFETIME) {
                p.alive = false;
                this.freeList.push(i);
            }
        }
    }

    private drainStepEvents(): void {
        const n = this.mobs.length;
        for (let i = 0; i < n; i++) {
            const mob = this.mobs[i];
            const epoch = mob.stepEpoch;
            const last = this.lastSeenEpoch[i];
            if (epoch !== last) {

                this.spawnOne(mob.stepWorldX, mob.stepWorldY, mob.stepWorldZ);
                this.lastSeenEpoch[i] = epoch;
            }
        }
    }

    private countLive(): number {
        let n = 0;
        for (const p of this.particles)
            if (p.alive) n++;
        return n;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, camRight: vec3, camUp: vec3): void {
        const totalLive = this.countLive();
        if (totalLive === 0)
            return;

        const vertexCount = totalLive * 4;
        const indexCount = totalLive * 6;
        const byteCount = vertexCount * DUST_VERTEX_STRIDE_BYTES;
        if (byteCount > this.cpuData.byteLength) {
            this.cpuData = new ArrayBuffer(byteCount);
            this.cpuF32 = new Float32Array(this.cpuData);
            this.cpuU8 = new Uint8Array(this.cpuData);
        }
        const f32 = this.cpuF32;

        let vi = 0;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.alive)
                continue;
            const t = p.age / DUST_LIFETIME;
            const size = DUST_HALF_SIZE_START + (DUST_HALF_SIZE_END - DUST_HALF_SIZE_START) * t;
            const alpha = DUST_PEAK_ALPHA * (1.0 - t);
            const ax = p.posX;
            const ay = p.posY + DUST_LIFT_TOTAL * t;
            const az = p.posZ;
            for (let c = 0; c < 4; c++) {
                const o = vi * DUST_FLOATS_PER_VERTEX;
                f32[o + 0] = ax;
                f32[o + 1] = ay;
                f32[o + 2] = az;
                f32[o + 3] = DUST_CORNER_OX[c] * size;
                f32[o + 4] = DUST_CORNER_OY[c] * size;
                f32[o + 5] = DUST_CORNER_U[c];
                f32[o + 6] = DUST_CORNER_V[c];
                f32[o + 7] = alpha;
                f32[o + 8] = 0;
                vi++;
            }
        }

        const cache = renderHelper.renderCache;
        const vertexBufferDescriptors = [cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, this.cpuU8.subarray(0, byteCount))];
        const indexData = makeTriangleIndexBuffer(GfxTopology.Quads, 0, vertexCount);
        const indexBufferDescriptor = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Index, new Uint8Array(indexData.buffer));

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, indexBufferDescriptor);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        let offs = template.allocateUniformBuffer(DustProgram.ub_SceneParams, 16 + 3 * 4);
        const mapped = template.mapUniformBufferF32(DustProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);
        offs += fillVec3v(mapped, offs, camRight);
        offs += fillVec3v(mapped, offs, camUp);
        offs += fillVec4(mapped, offs, 1, 1, 1, 1);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.texture, gfxSampler: this.sampler }]);
        renderInst.setDrawCount(indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}
