import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { FakeTextureHolder, TextureHolder, TextureMapping } from "../TextureHolder";
import { Destroyable } from "../SceneBase";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { makeSortKeyOpaque, GfxRendererLayer, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { DreamDropShader } from "./shader";
import { Checkbox, COOL_BLUE_COLOR, Layer, LAYER_ICON, LayerPanel, Panel, RENDER_HACKS_ICON } from "../ui";
import { CalcBillboardFlags, calcBillboardMatrix, computeModelMatrixSRT, lerp, Mat4Identity } from "../MathHelpers";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";

// Shared code between DDD and BBS, herein prefixed with "Lux"
// Credit to OOT3D for the basis of the skeletal animation code

export enum LuxModelFlagRenderMode {
    UNK,
    SKYBOX,
    UNK2,
    UNK3,
    UNK4,
    SKYBOX2,
    UNK6,
    UNK7,
    BACKGROUND, // not used but "background" geometry has this value I guess?
}

export enum LuxShapeAttribute {
    NO_BLEND,
    NO_MATERIAL,
    GLARE,
    CULL_BACK = 4, // may not be right, can hide some stuff that should be normally visible
    HAS_ALPHA = 16,
    BLEND_SEMITRANSPARENT = 32,
    BLEND_ADDITIVE = 64,
    BLEND_SUBTRACT = 96,
    DROP_SHADOW = 1024,
    ENV_MAP = 2048
}

export interface LuxPMP {
    pmos: LuxModelInfo[];
}

export interface LuxModelInfo {
    id: number;
    flags: number;
    scale: vec3;
    rotation: vec3;
    position: vec3;
    pmo: LuxModel;
}

export interface LuxDataSet {
    name: string;
    olos: string[];
}

export interface LuxObjectSet {
    name: string;
    instances: LuxOLOInstance[];
}

export interface LuxOLO {
    objects: LuxOLOInstance[];
}

export interface LuxOLOInstance {
    name: string;
    position: vec3;
    rotation: vec3;
}

export interface LuxModel {
    name: string;
    scale: number;
    flags: number;
    pmpFlags: number;
    bbox: number[];
    shapes: LuxShape[];
    skeleton?: Skeleton;
}

export interface LuxModelInstance {
    shiftMatrix: mat4;
    setId: number;
}

interface Skeleton {
    skinnedBoneCount: number;
    skinWeightCount: number;
    bones: LuxBone[];
}

export interface LuxBone {
    index: number;
    parentIndex: number;
    skinnedIndex: number; // unsure how this is used, it's just a sequential number for skinned bones
    name: string;
    transform: mat4; // relative transform
    inverseTransform: mat4; // inverse absolute transform
    decomposedTransform: { scale: vec3, rotation: vec3, translation: vec3 }; // relative, needed to apply animation values to
}

export interface LuxMaterial {
    textureOffset: number;
    textureName: string;
    scrollX: number;
    scrollY: number;
}

export interface LuxPAM {
    animations: LuxSkeletalAnimation[];
}

export interface LuxSkeletalAnimation {
    name: string;
    flag: number;
    framerate: number;
    interpolateFrameCount: number;
    loopFrame: number;
    boneCount: number;
    frameCount: number;
    returnFrame: number;
    channels: LuxBoneChannel[];
}

export interface LuxBoneChannel {
    translationX: LuxKeyframe[];
    translationY: LuxKeyframe[];
    translationZ: LuxKeyframe[];
    rotationX: LuxKeyframe[];
    rotationY: LuxKeyframe[];
    rotationZ: LuxKeyframe[];
    scaleX: LuxKeyframe[];
    scaleY: LuxKeyframe[];
    scaleZ: LuxKeyframe[];
}

export interface LuxKeyframe {
    frame: number;
    value: number;
}

export interface LuxTXA {
    name: string;
    textureName: string;
    defaultAnimationIndex: number;
    animations: LuxTextureAnimation[];
}

export interface LuxTextureAnimation {
    name: string;
    frames: LuxTXAFrame[];
}

export interface LuxTXAFrame {
    displayFrames: number; // amount of frames to show the texture, assumed to be in terms of 30 FPS
    data: ArrayBufferSlice;
}

export interface LuxPVD {
    clearColor: number[];
}

export interface LuxRoomObjects {
    sets: LuxObjectSet[];
    models: Map<string, LuxModel>;
    animations: Map<string, LuxSkeletalAnimation>;
}

const FRAME_TIME = 0.03;
const WORLD_SCALE = 200.0; // to make camera movement better, tiny XYZ coords are scaled up
const SCRATCH_MVP = mat4.create();
const SCRATCH_VIEW = mat4.create();
const SCRATCH_BONE = mat4.create();
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

function getChannelValue(keyframes: LuxKeyframe[], frame: number, defaultValue: number): number {
    if (keyframes.length === 0) {
        return defaultValue;
    }

    const index1 = keyframes.findIndex(kf => frame < kf.frame);
    if (index1 === 0) {
        return keyframes[0].value;
    } else if (index1 < 0) {
        return keyframes[keyframes.length - 1].value;
    }
    const index0 = index1 - 1;

    return lerp(keyframes[index0].value, keyframes[index1].value, (frame - keyframes[index0].frame) / (keyframes[index1].frame - keyframes[index0].frame));
}

export function computeLuxShiftMatrix(scale: vec3, rotation: vec3, position: vec3) {
    const srt = mat4.create();
    computeModelMatrixSRT(srt,
        scale[0] * WORLD_SCALE, scale[1] * WORLD_SCALE, scale[2] * WORLD_SCALE,
        rotation[0], rotation[1], rotation[2],
        position[0] * WORLD_SCALE, position[1] * WORLD_SCALE, position[2] * WORLD_SCALE
    );
    return srt;
}

/**
 * Gets the 0-based nth nibble of a 2-byte number. For example, to get 4 from 0x0401, use `1` for `n`
 */
export function getLuxShortNibble(n: number, nibble: number): number {
    return (n >> ((3 - nibble) * 4)) & 15;
}

export class LuxTexture {
    public gfxTexture: GfxTexture;

    constructor(device: GfxDevice, public name: string, public width: number, public height: number, data: Uint8Array) {
        const gfxTexture = device.createTexture({
            width, height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1, numLevels: 1
        });
        device.setResourceName(gfxTexture, name);
        device.uploadTextureData(gfxTexture, 0, [data]);
        this.gfxTexture = gfxTexture;
    }
}

export class LuxShape {
    public vertices: Float32Array;
    public colors: Float32Array;
    public uvs: Float32Array;
    public indices: Uint32Array;
    public weights: Float32Array;
    public joints: Uint8Array;

    constructor(public vertexCount: number, public textureIndex: number, public attribute: number, public boneIndices: number[]) {
        this.vertices = new Float32Array(vertexCount * 3);
        this.colors = new Float32Array(vertexCount * 4);
        this.uvs = new Float32Array(vertexCount * 2);
        this.weights = new Float32Array();
        this.joints = new Uint8Array();
        this.indices = new Uint32Array();
    }
}

export class LuxMaterialInstance {
    public name: string;
    public scrollX: number;
    public scrollY: number;
    public textureMappings: TextureMapping[][];

    constructor(material: LuxMaterial, textures: LuxTexture[], gfxSampler: GfxSampler) {
        this.name = textures[0].name;
        this.scrollX = material.scrollX;
        this.scrollY = material.scrollY;
        this.textureMappings = [];
        for (const texture of textures) {
            const tm = new TextureMapping();
            tm.gfxTexture = texture.gfxTexture;
            tm.gfxSampler = gfxSampler;
            this.textureMappings.push([tm]);
        }
    }
}

export class LuxShapeRenderer implements Destroyable {
    protected sortKey: number;
    protected drawCount: number;
    protected hasTXA: boolean;
    protected currentTXAFrame: number = 0;
    protected txaIndices: number[] = [];
    protected gfxProgram?: GfxProgram;
    protected megaStateFlags: Partial<GfxMegaStateDescriptor>;
    protected gfxInputLayout?: GfxInputLayout;
    protected indexBufferDescriptor: GfxIndexBufferDescriptor;
    protected vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(cache: GfxRenderCache, shape: LuxShape, scale: number, protected material: LuxMaterialInstance, txa?: LuxTextureAnimation, protected isSkybox: boolean = false, boneCount: number = 0) {
        const isTranslucent = (shape.attribute & LuxShapeAttribute.BLEND_SEMITRANSPARENT) !== 0;
        const additiveBlend = (shape.attribute & LuxShapeAttribute.BLEND_ADDITIVE) !== 0;
        const transparent = isTranslucent || additiveBlend;

        this.megaStateFlags = { depthWrite: !transparent };
        // the cull back flag makes some level geometry invisible from normal viewing points, disabled for now
        // this.megaStateFlags = { cullMode: (shape.attribute & LuxShapeAttribute.CULL_BACK) !== 0 ? GfxCullMode.Back : GfxCullMode.None };
        this.setMegaStateFlags(shape);

        if (transparent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
        }
        if (this.isSkybox) {
            this.megaStateFlags.depthWrite = false;
            this.megaStateFlags.depthCompare = GfxCompareMode.Always;
        }
        this.sortKey = makeSortKeyOpaque(transparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0);

        this.setVertexBuffers(cache, shape, scale);

        if (txa) {
            if (txa.frames.length === 1) {
                // treat the txa as flipping between two textures for an equal time (give or take 1 frame)
                const f = txa.frames[0].displayFrames === 0 ? 5 : txa.frames[0].displayFrames;
                this.txaIndices.push(...Array(f).fill(-1));
                this.txaIndices.push(...Array(f).fill(0));
            } else {
                for (let i = 0; i < txa.frames.length; i++) {
                    const frame = txa.frames[i];
                    const n = Array(frame.displayFrames === 0 ? 5 : frame.displayFrames).fill(i - 1);
                    this.txaIndices.push(...n);
                }
            }
        }
        this.hasTXA = txa !== undefined;

        // if weights are all zero then rigid skinning is used (assuming an animation is specified as well)
        this.setShader(cache, boneCount, shape.weights.length / shape.vertexCount, shape.weights.filter(w => w !== 0.0).length === 0);
        
        this.drawCount = shape.indices.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shape.indices.buffer), byteOffset: 0 };
    }

    public prepareToRender(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, ranTXA: boolean) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setVertexInput(this.gfxInputLayout!, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        let offset = renderInst.allocateUniformBuffer(DreamDropShader.ub_ShapeParams, 3);
        const d = renderInst.mapUniformBufferF32(DreamDropShader.ub_ShapeParams);
        // u_Scroll (2)
        d[offset++] = this.material ? this.material.scrollX : 0.0;
        d[offset++] = this.material ? this.material.scrollY : 0.0;
        // u_HasTexture (1)
        d[offset++] = this.material ? 1.0 : 0.0;

        if (this.material) {
            if (this.hasTXA) {
                if (!ranTXA) {
                    this.currentTXAFrame += viewerInput.deltaTime * FRAME_TIME;
                    this.currentTXAFrame %= this.txaIndices.length;
                }
                renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMappings[this.txaIndices[Math.trunc(this.currentTXAFrame)] + 1]);
            } else {
                renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMappings[0]);
            }
        }
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (!this.isSkybox) {
            renderInst.sortKey = this.sortKey;
        }
        renderInst.setDrawCount(this.drawCount);

        renderHelper.renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
    }

    protected setMegaStateFlags(shape: LuxShape) {

    }

    protected setVertexBuffers(cache: GfxRenderCache, shape: LuxShape, scale: number) {
        
    }

    protected setShader(cache: GfxRenderCache, boneCount: number, weightCount: number, doRigidSkinning: boolean) {

    }
}

// const scratchVec3a = vec3.create();
// const scratchVec3b = vec3.create();

export class LuxModelRenderer implements Destroyable, Layer {
    public visible: boolean = true;
    public instances: LuxModelInstance[] = [];
    protected bboxPoints: Float32Array;
    protected shapes: LuxShapeRenderer[];
    protected hasTXA: boolean;
    protected isBillboard: boolean;
    protected isSkybox: boolean;
    protected currentPAMFrame: number;
    protected pamFramerate: number;
    protected bones: LuxBone[];
    protected boneMatrices: mat4[][] = [];

    constructor(cache: GfxRenderCache, public name: string, model: LuxModel, materials: LuxMaterialInstance[], txas: LuxTXA[], protected animation?: LuxSkeletalAnimation) {
        this.name = name;
        const modeNibble = getLuxShortNibble(model.pmpFlags, 3);
        this.isSkybox = model.pmpFlags !== -1 && (modeNibble === LuxModelFlagRenderMode.SKYBOX || modeNibble === LuxModelFlagRenderMode.SKYBOX2);
        this.shapes = Array(model.shapes.length);
        for (let i = 0; i < model.shapes.length; i++) {
            const shape = model.shapes[i];
            let txa = undefined;
            for (const t of txas) {
                const a = t.animations[t.defaultAnimationIndex];
                if (!a) {
                    continue;
                }
                if (materials[shape.textureIndex]) {
                    if (materials[shape.textureIndex].name === t.textureName && a.frames.length > 0) {
                        txa = a;
                        break;
                    }
                }
            }
            this.shapes[i] = this.getShapeRenderer(cache, model, shape, materials, txa);
        }
        this.bboxPoints = new Float32Array(model.bbox);
        this.isBillboard = this.getIsBillboard(model.flags);

        this.currentPAMFrame = 0;
        this.hasTXA = txas.length > 0;
        this.pamFramerate = this.animation ? this.animation.framerate / 1000.0 : 0;
        this.bones = this.animation ? model.skeleton!.bones : [];
        // all bone srt matrices are computed ahead of time to save on rendering performance in exchange for a bit of memory usage
        // the difference may be neglible but there's no point in re-computing the same thing hundreds of times a second
        if (this.animation) {
            this.preComputeBoneMatrices();
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, selectedSets: number[]) {
        let ranAnimation = this.animation === undefined;
        let ranTXA = !this.hasTXA;
        const template = renderHelper.renderInstManager.pushTemplate();

        for (const instance of this.instances) {
            if (instance.setId !== -1 && !selectedSets.includes(instance.setId)) {
                continue;
            }

            if (!this.isSkybox) {
                mat4.mul(SCRATCH_MVP, viewerInput.camera.clipFromWorldMatrix, instance.shiftMatrix);
                if (!this.inView(this.bboxPoints, SCRATCH_MVP)) {
                    continue;
                }
            }

            if (!ranAnimation) {
                this.currentPAMFrame += viewerInput.deltaTime * this.pamFramerate;
                this.currentPAMFrame %= this.animation!.frameCount;
                ranAnimation = true;
            }

            let offset = template.allocateUniformBuffer(DreamDropShader.ub_ModelParams, 12 + (this.animation ? (12 * this.bones.length) : 0));
            const d = template.mapUniformBufferF32(DreamDropShader.ub_ModelParams);
            // u_View (12)
            if (this.isSkybox) {
                computeViewMatrixSkybox(SCRATCH_VIEW, viewerInput.camera);
            } else {
                computeViewMatrix(SCRATCH_VIEW, viewerInput.camera);
            }
            mat4.mul(SCRATCH_VIEW, SCRATCH_VIEW, instance.shiftMatrix);
            if (this.isBillboard && !this.isSkybox) {
                calcBillboardMatrix(SCRATCH_VIEW, SCRATCH_VIEW, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
            }
            offset += fillMatrix4x3(d, offset, SCRATCH_VIEW);
            // u_BoneSRT (12 * boneCount)
            for (let i = 0; i < this.bones.length; i++) {
                if (this.animation) {
                    mat4.mul(SCRATCH_BONE, this.boneMatrices[i][Math.trunc(this.currentPAMFrame)], this.bones[i].inverseTransform);
                    offset += fillMatrix4x3(d, offset, SCRATCH_BONE);
                } else {
                    offset += fillMatrix4x3(d, offset, Mat4Identity);
                }
            }
            // if (this.boneMatrices.length > 0 && this.instances.indexOf(instance) === 0) {
            //     const ctx = getDebugOverlayCanvas2D();
            //     for (let i = 1; i < this.boneMatrices.length; i++) {
            //         vec3.set(scratchVec3a, 0, 0, 0);
            //         mat4.mul(SCRATCH_BONE, instance.shiftMatrix, this.boneMatrices[this.bones[i].parentIndex][Math.trunc(this.currentPAMFrame)]);
            //         vec3.transformMat4(scratchVec3a, scratchVec3a, SCRATCH_BONE);
            //         vec3.set(scratchVec3b, 0, 0, 0);
            //         mat4.mul(SCRATCH_BONE, instance.shiftMatrix, this.boneMatrices[i][Math.trunc(this.currentPAMFrame)]);
            //         vec3.transformMat4(scratchVec3b, scratchVec3b, SCRATCH_BONE);
            //         drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b);
            //         drawWorldSpaceText(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3b, `${i}`, 0, White);
            //     }
            // }

            for (const shape of this.shapes) {
                shape.prepareToRender(renderHelper, viewerInput, ranTXA);
            }
            ranTXA = true;
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public destroy(device: GfxDevice): void {
        for (const shape of this.shapes) {
            shape.destroy(device);
        }
    }

    private inView(bbox: Float32Array, m: ReadonlyMat4) {
        let aol = true, aor = true;
        let aob = true, aot = true;
        let aon = true, aof = true;
        for (let i = 0; i < 32; i += 4) {
            const x = bbox[i], y = bbox[i + 1], z = bbox[i + 2];
            const xw = x * m[0] + y * m[4] + z * m[8] + m[12];
            const yw = x * m[1] + y * m[5] + z * m[9] + m[13];
            const zw = x * m[2] + y * m[6] + z * m[10] + m[14];
            const ww = x * m[3] + y * m[7] + z * m[11] + m[15];
            if (xw >= -ww && xw <= ww && yw >= -ww && yw <= ww && zw >= 0 && zw <= ww) {
                return true;
            }
            if (xw > -ww) aol = false;
            if (xw < ww) aor = false;
            if (yw > -ww) aob = false;
            if (yw < ww) aot = false;
            if (zw > 0) aon = false;
            if (zw < ww) aof = false;
        }
        if (aol || aor || aob || aot || aon || aof) {
            return false;
        }
        return true;
    }

    protected preComputeBoneMatrices() {
        this.boneMatrices = Array(this.bones.length);
        for (let i = 0; i < this.bones.length; i++) {
            const boneFrames: mat4[] = Array.from({ length: this.animation!.frameCount }, () => mat4.create());
            const channel = this.animation!.channels[i];
            const { scale, rotation, translation } = this.bones[i].decomposedTransform;
            for (let j = 0; j < this.animation!.frameCount; j++) {
                computeModelMatrixSRT(boneFrames[j],
                    getChannelValue(channel.scaleX, j, scale[0]),
                    getChannelValue(channel.scaleY, j, scale[1]),
                    getChannelValue(channel.scaleZ, j, scale[2]),
                    getChannelValue(channel.rotationX, j, rotation[0]),
                    getChannelValue(channel.rotationY, j, rotation[1]),
                    getChannelValue(channel.rotationZ, j, rotation[2]),
                    getChannelValue(channel.translationX, j, translation[0]),
                    getChannelValue(channel.translationY, j, translation[1]),
                    getChannelValue(channel.translationZ, j, translation[2])
                );
                if (this.bones[i].parentIndex < 0xFFFF) {
                    mat4.mul(boneFrames[j], this.boneMatrices[this.bones[i].parentIndex][j], boneFrames[j]);
                }
            }
            this.boneMatrices[i] = boneFrames;
        }
    }

    protected getIsBillboard(flags: number): boolean {
        return false;
    }

    protected getShapeRenderer(cache: GfxRenderCache, model: LuxModel, shape: LuxShape, materials: LuxMaterialInstance[], txa?: LuxTextureAnimation): LuxShapeRenderer {
        return new LuxShapeRenderer(cache, shape, model.scale, materials[shape.textureIndex], txa, this.isSkybox, this.animation ? model.skeleton!.bones.length : 0);
    }
}

export class LuxRoomRenderer implements Destroyable {
    public parts: LuxModelRenderer[];
    public objects: LuxModelRenderer[];
    public sets: LuxObjectSet[];
    public selectedSetIndices: number[];
    public applyTextures: boolean = true;
    public scrollingTextures: boolean = true;
    private allSetIndices: number[][];

    constructor(cache: GfxRenderCache, pmp: LuxPMP, textures: LuxTexture[], objects: LuxRoomObjects, txas: LuxTXA[]) {
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });

        this.parts = Array(pmp.pmos.length);
        for (let i = 0; i < pmp.pmos.length; i++) {
            this.setRoomPart(cache, pmp, pmp.pmos[i], i, textures, gfxSampler, txas);
        }

        this.sets = objects.sets;
        this.objects = [];
        this.allSetIndices = [];
        for (let i = 0; i < this.sets.length; i++) {
            for (let j = 0; j < this.sets[i].instances.length; j++) {
                const instance = this.sets[i].instances[j];
                const model = objects.models.get(instance.name);
                if (!model) {
                    continue;
                }
                this.setRoomObject(cache, model, i, instance, textures, gfxSampler, txas, objects.animations.get(instance.name));
            }
        }
        if (this.allSetIndices.length === 0) {
            this.allSetIndices = [[]];
        }
        this.selectedSetIndices = [];
    }

    public onSetChanged(index: number, v: boolean) {
        if (!v) {
            this.selectedSetIndices = this.selectedSetIndices.filter(i => i !== index);
        } else {
            this.selectedSetIndices.push(index);
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(DreamDropShader.ub_SceneParams, 19);
        const uniformBuffer = template.mapUniformBufferF32(DreamDropShader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.projectionMatrix);
        // u_Time (1)
        uniformBuffer[offset++] = viewerInput.time * FRAME_TIME;
        // u_ApplyTextures (1)
        uniformBuffer[offset++] = this.applyTextures ? 1.0 : 0.0;
        // u_DoScrolling (1)
        uniformBuffer[offset++] = this.scrollingTextures ? 1.0 : 0.0;

        for (let i = 0; i < this.parts.length; i++) {
            if (this.parts[i].visible) {
                this.parts[i].prepareToRender(device, renderHelper, viewerInput, []);
            }
        }

        for (let i = 0; i < this.objects.length; i++) {
            if (this.objects[i].visible) {
                this.objects[i].prepareToRender(device, renderHelper, viewerInput, this.selectedSetIndices);
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const mr of [...this.parts, ...this.objects]) {
            mr.destroy(device);
        }
    }

    protected setRoomPart(cache: GfxRenderCache, pmp: LuxPMP, info: LuxModelInfo, i: number, textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[]) {

    }

    protected setRoomObject(cache: GfxRenderCache, model: LuxModel, setId: number, instance: LuxOLOInstance, textures: LuxTexture[], gfxSampler: GfxSampler, txas: LuxTXA[], animation?: LuxSkeletalAnimation) {

    }
}

export class LuxRenderer implements SceneGfx {
    public textureHolder: TextureHolder;
    protected roomRenderer?: LuxRoomRenderer;
    protected textures: LuxTexture[];
    protected renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, protected clearColor: number[]) {
        this.textureHolder = new FakeTextureHolder([]);
        this.renderHelper = new GfxRenderHelper(device);
        this.textures = [];
        this.clearColor = this.clearColor.map(c => c / 255);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        mainColorDesc.clearColor = { r: this.clearColor[0], g: this.clearColor[1], b: this.clearColor[2], a: 1.0 };
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor), "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.pushTemplateRenderInst();
        this.roomRenderer!.prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice): void {
        this.roomRenderer!.destroy(device);
        this.renderHelper.renderCache.destroy();
        this.renderHelper.destroy();
        for (const t of this.textures) {
            device.destroyTexture(t.gfxTexture);
        }
    }

    public createPanels(): Panel[] {
        const layersPanel = new LayerPanel();
        layersPanel.setLayers([...this.roomRenderer!.parts, ...this.roomRenderer!.objects]);
        layersPanel.setTitle(LAYER_ICON, "Model Visiblity");

        const setPanel = this.getSetPanel();

        const renderOptions = new Panel();
        renderOptions.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        renderOptions.setTitle(RENDER_HACKS_ICON, "Render Hacks");
        const showPC = new Checkbox("Show player characters", false);
        showPC.onchanged = () => {
            for (const o of this.roomRenderer!.objects) {
                if (this.isPlayerCharacterModel(o.name)) {
                    o.visible = showPC.checked;
                }
            }
            layersPanel.syncLayerVisibility();
        };
        renderOptions.contents.appendChild(showPC.elem);
        const applyTextures = new Checkbox("Enable textures", true);
        applyTextures.onchanged = () => {
            this.roomRenderer!.applyTextures = applyTextures.checked;
        };
        renderOptions.contents.appendChild(applyTextures.elem);
        const scrollTextures = new Checkbox("Enable texture scrolling", true);
        scrollTextures.onchanged = () => {
            this.roomRenderer!.scrollingTextures = scrollTextures.checked;
        };
        renderOptions.contents.appendChild(scrollTextures.elem);

        return [setPanel, layersPanel, renderOptions];
    }

    protected isPlayerCharacterModel(name: string): boolean {
        return false;
    }

    protected getSetPanel(): Panel {
        return new Panel();
    }
}
