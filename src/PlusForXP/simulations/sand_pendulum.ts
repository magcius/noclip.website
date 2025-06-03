import { mat4, quat, vec2, vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { Simulation, SceneNode, Texture } from "../types";
import { wrapNode, reparent, createDataBuffer, updateNodeTransform } from "../util";
import {
    GfxBindingLayoutDescriptor,
    GfxBlendFactor,
    GfxBlendMode,
    GfxBufferUsage,
    GfxDevice,
    GfxFormat,
    GfxIndexBufferDescriptor,
    GfxInputLayout,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxRenderProgramDescriptor,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxTextureDimension,
    GfxTextureUsage,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode,
} from "../../gfx/platform/GfxPlatform";
import { GfxProgramObjBag, preprocessProgramObj_GLSL } from "../../gfx/shaderc/GfxShaderCompiler";
import { defaultMegaState, setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxrAttachmentSlot, GfxrGraphBuilder } from "../../gfx/render/GfxRenderGraph";
import { GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers";
import { lerp, MathConstants } from "../../MathHelpers";
import { World } from "../world";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary";

type Swing = {
    name: string;
    startEnergy: number;
    decay: number;
    finalDecay: number;
    ampA: (time: number) => number;
    ampB: (time: number) => number;
    randomStartTime: () => number;
    freqB: number;
    phaseB: number;
};

class SandProgram implements GfxProgramObjBag {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

    public static ub_SandParams = 0;
    public static a_Position = 0;
    public static a_Order = 1;

    public both = `
    ${GfxShaderLibrary.MatrixLibrary}

    layout(std140, row_major) uniform ub_SandParams {
      vec2 u_LastPendulumPos;
      vec2 u_PendulumPos;
      float u_Fade;
      float u_NumParticles;
    };

    uniform sampler2D sandTexture;

    #define PI ${Math.PI}

    float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    `;

    public vert: string = `

    layout(location = ${SandProgram.a_Position}) in vec2 a_Position;
    layout(location = ${SandProgram.a_Order}) in float a_Order;

    out vec2 v_TexCoord;
    out vec2 v_Pos;

    vec2 flipTexY(vec2 uv) {
      return vec2(uv.x, 1.0 - uv.y);
    }

    void main() {
      v_TexCoord = a_Position;
      v_Pos = (a_Position * 2.0 - 1.0);

      if (u_Fade <= 0.0) {
        vec2 pendulumPos = mix(u_LastPendulumPos, u_PendulumPos, a_Order / u_NumParticles);
        gl_Position = vec4(v_Pos * 0.04 + pendulumPos, 0.0, 1.0);
        // gl_Position = vec4(v_Pos, 0.0, 1.0); // for debugging
      } else {
        gl_Position = vec4(v_Pos, 0.0, 1.0);
      }
    }
    `;

    public frag: string = `
    in vec2 v_TexCoord;
    in vec2 v_Pos;

    void main() {

      vec3 color = texture(SAMPLER_2D(sandTexture), v_TexCoord).rgb;
      
      if (u_Fade <= 0.0) {
        if (length(v_Pos) > 1.0) {
          discard;
        } else {
          gl_FragColor = vec4(color * mix(0.7, 1.4, sin(atan(v_Pos.y, v_Pos.x)) * 0.5 + 0.75 * rand(v_Pos)), 1.0 - length(v_Pos));
        }
      } else {
        if (rand(v_Pos) > u_Fade) {
          discard;
        } else {
          gl_FragColor = vec4(color, 1.0);
        }
      }
    }
  `;
}

export default class SandPendulum extends Simulation {
    swings: Swing[] = [
        {
            name: "lissajous",
            startEnergy: 1,
            decay: 0.99997,
            finalDecay: 0.995,
            ampA: (time) => 1,
            ampB: (time) => 1,
            randomStartTime: () => {
                let time = 0;
                if (Math.random() < 0.5) {
                    time += 1;
                }
                if (Math.random() < 0.5) {
                    time += 30;
                }
                return time * Math.PI;
            },
            freqB: 1.03,
            phaseB: 0,
        },
        {
            name: "spiral",
            startEnergy: 1.25,
            decay: 0.9995,
            finalDecay: 0.95,
            ampA: (time) => 1,
            ampB: (time) => 1,
            randomStartTime: () => Math.random() * MathConstants.TAU,
            freqB: 1,
            phaseB: Math.PI / 2,
        },
        {
            name: "dahlia",
            startEnergy: 1.25,
            decay: 0.9999,
            finalDecay: 0.995,
            ampA: (time) => Math.cos((time * 2.02) / 11),
            ampB: (time) => Math.sin((time * 2.02) / 11),
            randomStartTime: () => Math.PI * Math.floor(Math.random() * 1000),
            freqB: 1,
            phaseB: 0,
        },
        {
            name: "clover",
            startEnergy: 1.25,
            decay: 0.9997,
            finalDecay: 0.95,
            ampA: (time) => Math.cos((time * 1.02) / 3),
            ampB: (time) => Math.sin((time * 1.02) / 3),
            randomStartTime: () => Math.PI * Math.floor(Math.random() * 1000),
            freqB: 1,
            phaseB: 0,
        },
    ] as const;

    private isGrotto: boolean;
    private pendulum: SceneNode;
    private sandParticles: SceneNode;
    private sparkle: SceneNode;
    private sparkleSprite: SceneNode;
    private fadeStart: number = -Infinity;
    private fade: number = 1;
    private oldAngles: vec2 = vec2.create();
    private startAngles: vec2 = vec2.create();
    private isResetting: boolean = true;
    private energy: number = 0;
    private swingTime: number = 0;
    private swingStartTime: number = 0;
    private swing: Swing;

    private pivot0: SceneNode;
    private pivot1: SceneNode;

    private sandProgram: GfxRenderProgramDescriptor;
    private lastCoord: vec2 = vec2.create();
    private coord: vec2 = vec2.create();
    private gfxTexture: GfxTexture;
    private originalSandTexture: Texture;
    private inputLayout: GfxInputLayout;
    private vertexAttributes: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private megaStateFlags: GfxMegaStateDescriptor;
    private numParticles = 3;
    private indexCount = 6 * this.numParticles;
    private sampler: GfxSampler;
    private gfxProgram: GfxProgram;
    private renderInstListSand = new GfxRenderInstList();

    private pickRandomSwing() {
        this.swing = this.swings[Math.floor(Math.random() * this.swings.length)];
    }

    override setup(device: GfxDevice, renderHelper: GfxRenderHelper, world: World): void {
        super.setup(device, renderHelper, world);
        this.isGrotto = world.sceneNodesByName.has("Pendulum_SW_Pendulum.scx/Pendulum Arrowhead");
        this.pendulum = world.sceneNodesByName.get(this.isGrotto ? "Pendulum_SW_Pendulum.scx/Pendulum Arrowhead" : "Pendulum_Pendulum.scx/Pendulum")!;
        this.sandParticles = world.sceneNodesByName.get("Pendulum_Sand_Particles.scx/_root")!;
        this.sparkle = world.sceneNodesByName.get("Sparkle.scx/_root")!;
        this.sparkleSprite = world.sceneNodesByName.get("Sparkle.scx/Plane01")!;
        this.sparkleSprite.isGhost = true;

        this.sandProgram = preprocessProgramObj_GLSL(device, new SandProgram());
        this.gfxProgram = device.createProgram(this.sandProgram);
        const sandTexturePath = "Pendulum_Sand_textures/Sand.tif";
        this.originalSandTexture = world.texturesByPath.get(sandTexturePath)!;

        this.pickRandomSwing();

        this.swingStartTime = this.swing.randomStartTime();
        this.swingTime = this.swingStartTime;
        this.energy = this.swing.startEnergy;
        this.fade = -1;
        vec2.set(this.lastCoord, 0, 0);
        vec2.set(this.coord, 0, 0);
        this.sparkle.visible = false;
        this.sparkle.transformChanged = true;
        this.sandParticles.visible = true;
        this.sandParticles.transformChanged = true;

        this.gfxTexture = device.createTexture({
            ...this.originalSandTexture,
            dimension: GfxTextureDimension.n2D,
            pixelFormat: GfxFormat.U8_RGBA_RT,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.gfxTexture, 0, [this.originalSandTexture.rgba8]);
        world.texturesByPath.set(sandTexturePath, { ...this.originalSandTexture, gfxTexture: this.gfxTexture });
        world.materialsByName.get("Pendulum_Sand.scx/1")!.gfxTexture = this.gfxTexture;

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 }, // position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_R, bufferByteOffset: 0 }, // particle ID
            ],
            vertexBufferDescriptors: [
                { byteStride: 2 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 1 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
        });

        const positionBuffer = createDataBuffer(
            device,
            GfxBufferUsage.Vertex,
            new Float32Array(Array(this.numParticles).fill([0, 0, 1, 0, 0, 1, 1, 1]).flat()).buffer,
        );

        const particleIDs = [];
        const particleIndices = [];
        for (let i = 0; i < this.numParticles; i++) {
            particleIDs.push(i, i, i, i);
            particleIndices.push([0, 1, 2, 1, 2, 3].map((j) => i * 4 + j));
        }
        const particleIDBuffer = createDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array(particleIDs.flat()).buffer);

        this.vertexAttributes = [
            { buffer: positionBuffer, byteOffset: 0 },
            { buffer: particleIDBuffer, byteOffset: 0 },
        ];

        const indexBuffer = createDataBuffer(device, GfxBufferUsage.Index, new Uint32Array(particleIndices.flat()).buffer);
        this.indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };

        this.megaStateFlags = {
            ...defaultMegaState,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const samplerDescriptor = {
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
        };
        this.sampler = device.createSampler(samplerDescriptor);

        if (this.isGrotto) {
            const sand = world.sceneNodesByName.get("Pendulum_Sand.scx/Sand New")!;
            vec3.add(sand.transform.trans, sand.transform.trans, vec3.fromValues(0, 0, this.isGrotto ? 1 : 0));
            sand.transformChanged = true;

            const pivotRingAArt = world.sceneNodesByName.get("Pendulum_SW_Scene.scx/Pivot Ring")!;
            const pivotRingA = wrapNode(pivotRingAArt);
            const offsetA = -1;
            vec3.set(pivotRingAArt.transform.trans, 0, 0, offsetA);
            pivotRingAArt.transformChanged = true;

            const pivotRingBArt = world.sceneNodesByName.get("Pendulum_SW_Scene.scx/Pivot Ring 03")!;
            const pivotRingB = wrapNode(pivotRingBArt);
            const offsetB = -4;
            vec3.set(pivotRingBArt.transform.trans, 0, 0, offsetB);
            pivotRingBArt.transformChanged = true;

            const pivotRingCArt = world.sceneNodesByName.get("Pendulum_SW_Scene.scx/Pivot Ring 2")!;
            const pivotRingC = wrapNode(pivotRingCArt);
            const offsetC = -4;
            vec3.set(pivotRingCArt.transform.trans, 0, 0, offsetC);
            pivotRingCArt.transformChanged = true;

            reparent(this.pendulum, pivotRingA);
            reparent(pivotRingA, pivotRingB);
            reparent(pivotRingB, pivotRingC);

            vec3.set(this.pendulum.transform.trans, 0, 0, -2 + offsetA);
            this.pendulum.transformChanged = true;
            vec3.set(pivotRingA.transform.trans, 0, 0, -4.6 + offsetB - offsetA);
            pivotRingA.transformChanged = true;
            vec3.set(pivotRingB.transform.trans, 0, 0, -6.5 + offsetC - offsetB);
            pivotRingB.transformChanged = true;
            vec3.set(pivotRingC.transform.trans, 0, 0, 84.5 - offsetC);
            pivotRingC.transformChanged = true;

            this.pivot0 = pivotRingB;
            this.pivot1 = pivotRingC;
        } else {
            const pivotRingAArt = world.sceneNodesByName.get("Pendulum_Scene.scx/Pivot Ring")!;
            const pivotRingA = wrapNode(pivotRingAArt);
            const offsetA = -3.5;
            vec3.set(pivotRingAArt.transform.trans, 0, 0, offsetA);
            pivotRingAArt.transformChanged = true;

            const pivotRingBArt = world.sceneNodesByName.get("Pendulum_Scene.scx/Pivot hanger")!;
            const pivotRingB = wrapNode(pivotRingBArt);
            const offsetB = 4.4;
            vec3.set(pivotRingBArt.transform.trans, 0, 0, offsetB);
            pivotRingBArt.transformChanged = true;

            reparent(this.pendulum, pivotRingA);
            reparent(pivotRingA, pivotRingB);

            vec3.set(this.pendulum.transform.trans, 0, 0, -6);
            this.pendulum.transformChanged = true;
            vec3.set(pivotRingA.transform.trans, 0, 0, -8 + offsetA - offsetA);
            pivotRingA.transformChanged = true;
            vec3.set(pivotRingB.transform.trans, 0, 0, 83.2 + offsetB - offsetB);
            pivotRingB.transformChanged = true;

            this.pivot0 = pivotRingB;
            this.pivot1 = pivotRingA;
        }

        reparent(this.sandParticles, this.pendulum);
        reparent(this.sparkle, this.pendulum);

        const sandTranslate: [number, number, number] = this.isGrotto ? [0, 0, -82] : [0, -81.2, 0];
        const sandRotate: [number, number, number] = this.isGrotto ? [0, 0, 0] : [-Math.PI * 0.5, 0, 0];
        vec3.set(this.sandParticles.transform.trans, ...sandTranslate);
        vec3.set(this.sandParticles.transform.scale, 1.5, 1.5, 1.5);
        vec3.set(this.sandParticles.transform.rot, ...sandRotate);

        const sparkleTranslate: [number, number, number] = this.isGrotto ? [0, 0, -82] : [0, -81, 0];
        vec3.set(this.sparkle.transform.trans, ...sparkleTranslate);
        vec3.set(this.sparkle.transform.rot, 0, 0, 0);
        vec3.set(this.sparkle.transform.scale, 0.4, 0.4, 0.4);

        this.pendulum.transformChanged = true;
        this.sandParticles.transformChanged = true;
        this.sparkle.transformChanged = true;
    }

    override update(input: ViewerRenderInput): void {
        this.swingTime += input.deltaTime * 0.0032;
        this.energy *= lerp(this.swing.finalDecay, this.swing.decay, Math.pow(this.energy, 0.02));

        if (this.isResetting) {
            vec3.set(this.sparkleSprite.transform.rot, 0, input.time * 0.005, 0);
            this.sparkleSprite.transformChanged = true;
            this.fade = (input.time - this.fadeStart) / 6000;
            this.energy = this.fade * this.swing.startEnergy;
            {
                const [motionA, motionB] = vec2.lerp(vec2.create(), this.oldAngles, this.startAngles, this.energy);
                this.pivot0.transform.rot[0] = motionA * 0.1;
                this.pivot0.transform.rot[1] = motionB * 0.1;
                this.pivot1.transform.rot[0] = motionA * 0.1;
                this.pivot1.transform.rot[1] = motionB * 0.1;
                this.pendulum.transform.rot[2] = motionA * 0.25;
                this.pivot0.transformChanged = true;
                this.pivot1.transformChanged = true;
                this.pendulum.transformChanged = true;
            }
            this.isResetting = this.fade <= 1;
            if (!this.isResetting) {
                this.swingTime = this.swingStartTime;
                this.energy = this.swing.startEnergy;
                this.fade = -1;
                vec2.set(this.lastCoord, 0, 0);
                vec2.set(this.coord, 0, 0);
                if (this.sparkle.visible) {
                    this.sparkle.visible = false;
                    this.sparkle.transformChanged = true;
                }
                if (!this.sandParticles.visible) {
                    this.sandParticles.visible = true;
                    this.sandParticles.transformChanged = true;
                }
            }
        } else if (this.energy < 0.1) {
            this.fadeStart = input.time;
            this.fade = 0;
            this.isResetting = true;
            {
                const motionA = Math.cos(this.swingTime) * this.swing.ampA(this.swingTime);
                const motionB = Math.cos(this.swingTime * this.swing.freqB + this.swing.phaseB) * this.swing.ampB(this.swingTime);
                vec2.set(this.oldAngles, motionA * this.energy, motionB * this.energy);
            }
            this.pickRandomSwing();
            this.swingStartTime = this.swing.randomStartTime();
            {
                const motionA = Math.cos(this.swingStartTime) * this.swing.ampA(this.swingStartTime);
                const motionB = Math.cos(this.swingStartTime * this.swing.freqB + this.swing.phaseB) * this.swing.ampB(this.swingStartTime);
                vec2.set(this.startAngles, motionA, motionB);
            }
            this.sparkle.visible = true;
            if (this.sandParticles.visible) {
                this.sandParticles.visible = false;
                this.sandParticles.transformChanged = true;
            }
        } else {
            this.fade = -1;

            const motionA = Math.cos(this.swingTime) * this.swing.ampA(this.swingTime);
            const motionB = Math.cos(this.swingTime * this.swing.freqB + this.swing.phaseB) * this.swing.ampB(this.swingTime);

            this.pivot0.transform.rot[0] = motionA * this.energy * 0.1;
            this.pivot0.transform.rot[1] = motionB * this.energy * 0.1;

            this.pivot1.transform.rot[0] = motionA * this.energy * 0.1;
            this.pivot1.transform.rot[1] = motionB * this.energy * 0.1;

            this.pendulum.transform.rot[2] = motionA * this.energy * 0.25;
        }
        this.pivot0.transformChanged = true;
        this.pivot1.transformChanged = true;
        this.pendulum.transformChanged = true;
    }

    override render(builder: GfxrGraphBuilder, cameraWorldPos: vec3): void {
        if (this.isResetting) {
            const pos = mat4.getTranslation(vec3.create(), this.sparkle.worldTransform);
            const dir = vec3.sub(vec3.create(), pos, cameraWorldPos);
            const angleY = ((-Math.PI / 2 - Math.atan2(dir[2], dir[0])) * 180) / Math.PI;
            const angleX = (Math.atan2(dir[1], Math.sqrt(dir[0] ** 2 + dir[2] ** 2)) * 180) / Math.PI;
            const scale = mat4.getScaling(vec3.create(), this.sparkle.worldTransform);
            const faceCamera = quat.fromEuler(quat.create(), 90 - angleX, 180 + angleY, 0);
            mat4.fromRotationTranslationScale(this.sparkle.worldTransform, faceCamera, pos, scale);
            this.sparkle.transformChanged = true;
            updateNodeTransform(this.sparkleSprite, true, this.sparkle.worldTransform, true);
        } else {
            [this.coord, this.lastCoord] = [this.lastCoord, this.coord];
            this.coord = [this.sandParticles.worldTransform[12] * 0.032, this.sandParticles.worldTransform[14] * 0.032];
        }

        if (vec2.sqrDist(this.coord, this.lastCoord) > 0.05) {
            return;
        }

        const { renderInstManager } = this.renderHelper;

        builder.pushPass((pass) => {
            pass.setDebugName("Sand");
            pass.attachTexture(GfxrAttachmentSlot.Color0, this.gfxTexture);
            pass.exec((passRenderer) => {
                this.renderInstListSand.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        const template = this.renderHelper.pushTemplateRenderInst();

        renderInstManager.setCurrentList(this.renderInstListSand);

        template.setBindingLayouts(SandProgram.bindingLayouts);

        template.setGfxProgram(this.gfxProgram);
        template.setMegaStateFlags(this.megaStateFlags);

        let offset = template.allocateUniformBuffer(SandProgram.ub_SandParams, 4 * 2);
        const sand = template.mapUniformBufferF32(SandProgram.ub_SandParams);
        offset += fillVec4(sand, offset, ...(this.lastCoord as [number, number]), ...(this.coord as [number, number]));
        offset += fillVec4(sand, offset, this.fade, this.numParticles);
        template.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.originalSandTexture.gfxTexture!, gfxSampler: this.sampler, lateBinding: null }]);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.vertexAttributes, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.indexCount);
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    override renderReset(): void {
        this.renderInstListSand.reset();
    }

    override destroy(): void {
        this.device.destroyProgram(this.gfxProgram);
        this.device.destroyTexture(this.originalSandTexture.gfxTexture!);
        this.device.destroyBuffer(this.vertexAttributes[0].buffer);
        this.device.destroyBuffer(this.vertexAttributes[1].buffer);
        this.device.destroyBuffer(this.indexBufferDescriptor.buffer);
        this.device.destroySampler(this.sampler);
    }
}
