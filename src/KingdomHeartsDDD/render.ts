import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropPMO, DreamDropModelFlagBillboard, DreamDropShape, DreamDropPMP, DreamDropShapeAttributeDepthBias } from "./bin";
import { CalcBillboardFlags, calcBillboardMatrix, computeModelMatrixSRT } from "../MathHelpers";
import { GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderInstManager";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { DreamDropRoomConfig } from "./config/room";
import { Layer } from "../ui";
import { DreamDropShader } from "./shader";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import { LuxBone, LuxKeyframe, LuxMaterialInstance, LuxModelFlagRenderMode, LuxObjectSet, LuxShapeAttributeBlend, LuxSkeletalAnimation, LuxTexture, LuxTextureAnimation, LuxTXA } from "./lux";

const FRAME_TIME = 0.03;
const WORLD_SCALE = 200.0;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const SCRATCH_MVP = mat4.create();
const SCRATCH_VIEW = mat4.create();
const SCRATCH_IDENTITY = mat4.create();
const SCRATCH_BONE = mat4.create();

/**
 * Gets the 0-based nth nibble of a 2-byte number. For example, to get 4 from 0x0401, use `1` for `n`
 */
function getShortNibble(n: number, nibble: number): number {
    return (n >> ((3 - nibble) * 4)) & 15;
}

/**
 * Returns shift matrix based on given SRT and {@link WORLD_SCALE}. The SRT must be the instance SRT - baked SRT is handled by the model renderer. Rotation is assumed to be in radians
 */
function computeShiftMatrix(scale: vec3, rotation: vec3, position: vec3) {
    const srt = mat4.create();
    computeModelMatrixSRT(srt,
        scale[0] * WORLD_SCALE, scale[1] * WORLD_SCALE, scale[2] * WORLD_SCALE,
        rotation[0], rotation[1], rotation[2],
        position[0] * WORLD_SCALE, position[1] * WORLD_SCALE, position[2] * WORLD_SCALE
    );
    return srt;
}

function getChannelValue(keyframes: LuxKeyframe[] | undefined, frame: number, defaultValue: number): number {
    if (!keyframes || keyframes.length === 0) {
        return defaultValue;
    }
    if (keyframes.length === 1) {
        return keyframes[0].value;
    }
    let prev = keyframes[0];
    let next = keyframes[keyframes.length - 1];
    if (frame <= prev.frame) {
        return prev.value;
    }
    if (frame >= next.frame) {
        return next.value;
    }
    for (let i = 0; i < keyframes.length - 1; i++) {
        if (keyframes[i].frame <= frame && keyframes[i + 1].frame >= frame) {
            prev = keyframes[i];
            next = keyframes[i + 1];
            break;
        }
    }
    if (prev.frame === next.frame) {
        return prev.value;
    }
    const t = (frame - prev.frame) / (next.frame - prev.frame);
    return prev.value + (next.value - prev.value) * t;
}

export interface DreamDropRoomObjects {
    sets: LuxObjectSet[];
    models: Map<string, DreamDropPMO>;
    animations: Map<string, LuxSkeletalAnimation>;
}

/**
 * Renderer for a room from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropRoomRenderer implements Destroyable {
    public parts: ModelRenderer[];
    public objects: ModelRenderer[];
    public sets: LuxObjectSet[];
    public selectedSetIndices: number[];
    private setIndices: number[];
    private allSetIndices: number[][];

    constructor(cache: GfxRenderCache, pmp: DreamDropPMP, textures: LuxTexture[], objects: DreamDropRoomObjects, txas: LuxTXA[], config: DreamDropRoomConfig | undefined) {
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });

        this.parts = Array(pmp.pmos.length);
        for (let i = 0; i < pmp.pmos.length; i++) {
            const info = pmp.pmos[i];
            const model = info.pmo as DreamDropPMO;
            const materials: LuxMaterialInstance[] = Array(model.materials.length);
            const modelTXAs: LuxTXA[] = [];
            for (let j = 0; j < model.materials.length; j++) {
                if (!model.materials[j]) {
                    continue;
                }
                const t = textures.filter(texture => texture.name.startsWith(model.materials[j].textureName));
                if (t.length > 0) {
                    materials[j] = new LuxMaterialInstance(model.materials[j], t, gfxSampler);
                    for (const txa of txas) {
                        if (txa.textureName === model.materials[j].textureName) {
                            modelTXAs.push(txa);
                            break;
                        }
                    }
                }
            }
            this.parts[i] = new ModelRenderer(cache, model.name, model, materials, modelTXAs);
            this.parts[i].shiftMatrices = [computeShiftMatrix(info.scale, info.rotation, info.position)];
        }

        this.sets = objects.sets;
        this.objects = [];
        this.allSetIndices = [];
        for (let i = 0; i < this.sets.length; i++) {
            const indices: number[] = [];
            const models: ModelRenderer[] = [];
            for (let j = 0; j < this.sets[i].instances.length; j++) {
                const instance = this.sets[i].instances[j];
                const model = objects.models.get(instance.name);
                if (!model) {
                    continue;
                }
                const instanceRenderer = models.find(mr => mr.name === instance.name);
                if (instanceRenderer) {
                    instanceRenderer.shiftMatrices.push(computeShiftMatrix([1, 1, 1], instance.rotation, instance.position));
                } else {
                    const materials: LuxMaterialInstance[] = Array(model.materials.length);
                    const modelTXAs: LuxTXA[] = [];
                    for (let k = 0; k < model.materials.length; k++) {
                        if (!model.materials[k]) {
                            continue;
                        }
                        const t = textures.filter(texture => texture.name.startsWith(model.materials[k].textureName));
                        if (t.length > 0) {
                            materials[k] = new LuxMaterialInstance(model.materials[k], t, gfxSampler);
                            for (const txa of txas) {
                                if (txa.textureName === model.materials[k].textureName) {
                                    modelTXAs.push(txa);
                                    break;
                                }
                            }
                        }
                    }
                    const renderer = new ModelRenderer(cache, instance.name, model, materials, modelTXAs, objects.animations.get(instance.name));
                    renderer.shiftMatrices = [computeShiftMatrix([1, 1, 1], instance.rotation, instance.position)];
                    indices.push(this.objects.length);
                    this.objects.push(renderer);
                }
            }
            this.allSetIndices[i] = indices;
        }
        if (this.allSetIndices.length === 0) {
            this.allSetIndices = [[]];
        }
        this.setIndices = [];
        this.selectedSetIndices = [];
        if (config && config.defaultSets) {
            for (const set of config.defaultSets) {
                this.onSetChanged(set, true);
            }
        } else {
            this.onSetChanged(0, true);
        }
    }

    public onSetChanged(index: number, v: boolean) {
        if (!v) {
            this.selectedSetIndices = this.selectedSetIndices.filter(i => i !== index);
        } else {
            this.selectedSetIndices.push(index);
        }
        this.setIndices = [];
        for (const i of this.selectedSetIndices) {
            this.setIndices.push(...this.allSetIndices[i]);
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(DreamDropShader.ub_SceneParams, 17);
        const uniformBuffer = template.mapUniformBufferF32(DreamDropShader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.projectionMatrix);
        // u_Time (1)
        uniformBuffer[offset++] = viewerInput.time * FRAME_TIME;

        for (let i = 0; i < this.parts.length; i++) {
            if (this.parts[i].visible) {
                this.parts[i].prepareToRender(device, renderHelper, viewerInput);
            }
        }

        for (const i of this.setIndices) {
            if (this.objects[i].visible) {
                this.objects[i].prepareToRender(device, renderHelper, viewerInput);
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const mr of [...this.parts, ...this.objects]) {
            mr.destroy(device);
        }
    }
}

class ModelRenderer implements Destroyable, Layer {
    public name: string;
    public visible: boolean = true;
    public bboxPoints: Float32Array;
    public shiftMatrices: mat4[] = [];
    private shapes: ShapeRenderer[];
    private hasTXA: boolean;
    private isBillboard: boolean;
    private isSkybox: boolean;
    private currentPAMFrame: number;
    private pamFramerate: number;
    private bones: LuxBone[];
    private boneMatrices: mat4[][] = [];

    constructor(cache: GfxRenderCache, name: string, model: DreamDropPMO, materials: LuxMaterialInstance[], txas: LuxTXA[], private animation?: LuxSkeletalAnimation) {
        // console.log(model.name, model.pmpFlags.toString(16).padStart(4, "0"), "-", model.shapes.map(s => s.attribute.toString(16).padStart(4, "0")).join(" "));
        this.name = name;
        const modeNibble = getShortNibble(model.pmpFlags, 3);
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
            this.shapes[i] = new ShapeRenderer(
                cache, shape as DreamDropShape, model.scale, materials[shape.textureIndex], txa, this.isSkybox,
                this.animation ? model.skeleton!.bones.length : 0
            );
        }
        this.bboxPoints = new Float32Array(model.bbox.map(p => p * model.scale));
        this.isBillboard = getShortNibble(model.flags, 1) === DreamDropModelFlagBillboard.BILLBOARD;

        this.currentPAMFrame = 0;
        this.hasTXA = txas.length > 0;
        if (this.hasTXA) console.log(name, ...txas);
        this.pamFramerate = this.animation ? this.animation.framerate / 1000.0 : 0;
        this.bones = this.animation ? model.skeleton!.bones : [];
        if (this.animation) {
            this.preComputeBoneMatrices();
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        let ranAnimation = this.animation === undefined;
        let ranTXA = !this.hasTXA;
        const template = renderHelper.renderInstManager.pushTemplate();

        for (const shiftMatrix of this.shiftMatrices) {
            if (!this.isSkybox) {
                mat4.mul(SCRATCH_MVP, viewerInput.camera.clipFromWorldMatrix, shiftMatrix);
                if (!this.inView(this.bboxPoints, SCRATCH_MVP)) {
                    continue;
                }
            }

            if (!ranAnimation) {
                this.currentPAMFrame += viewerInput.deltaTime * this.pamFramerate;
                this.currentPAMFrame %= this.animation!.frameCount;
                ranAnimation = true;
            }

            let offset = template.allocateUniformBuffer(DreamDropShader.ub_ModelParams, 12 + (12 * this.bones.length));
            const d = template.mapUniformBufferF32(DreamDropShader.ub_ModelParams);
            // u_View (12)
            if (this.isSkybox) {
                computeViewMatrixSkybox(SCRATCH_VIEW, viewerInput.camera);
            } else {
                computeViewMatrix(SCRATCH_VIEW, viewerInput.camera);
            }
            mat4.mul(SCRATCH_VIEW, SCRATCH_VIEW, shiftMatrix);
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
                    offset += fillMatrix4x3(d, offset, SCRATCH_IDENTITY);
                }
            }

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

    /**
     * Frustum culling with an 8-point bounding box. Cheaper than standard AABB frustum culling
     */
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

    private preComputeBoneMatrices() {
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
}

class ShapeRenderer implements Destroyable {
    public sortKey: number;
    private drawCount: number;
    private hasTXA: boolean;
    private currentTXAFrame: number = 0;
    private txaIndices: number[] = [];
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private gfxInputLayout: GfxInputLayout;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, shape: DreamDropShape, scale: number, private material: LuxMaterialInstance, txa?: LuxTextureAnimation, private isSkybox: boolean = false, boneCount: number = 0) {
        const blend = getShortNibble(shape.attribute, 2);
        const isTranslucent = blend === LuxShapeAttributeBlend.TRANSLUCENT || blend === LuxShapeAttributeBlend.TRANSLUCENT2;
        const additiveBlend = blend === LuxShapeAttributeBlend.ADDITIVE || blend === LuxShapeAttributeBlend.ADDITIVE2;
        const transparent = isTranslucent || additiveBlend;
        this.megaStateFlags = {
            depthWrite: !transparent,
            polygonOffset: getShortNibble(shape.attribute, 1) !== DreamDropShapeAttributeDepthBias.SET // need to look at this again...
        };
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

        const inVertexAttributeDescriptors = [
            { location: DreamDropShader.a_Position, bufferIndex: DreamDropShader.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
            { location: DreamDropShader.a_Color, bufferIndex: DreamDropShader.a_Color, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
            { location: DreamDropShader.a_UV, bufferIndex: DreamDropShader.a_UV, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
        ];
        const inVertexBufferDescriptors = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
        ];
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.vertices.map(v => v * scale).buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.uvs.buffer), byteOffset: 0 }
        ];

        if (shape.weights.length > 0 && shape.joints.length > 0) {
            inVertexAttributeDescriptors.push({ location: DreamDropShader.a_Weight, bufferIndex: DreamDropShader.a_Weight, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 });
            inVertexAttributeDescriptors.push({ location: DreamDropShader.a_Joint, bufferIndex: DreamDropShader.a_Joint, format: GfxFormat.U8_RGBA, bufferByteOffset: 0 });
            inVertexBufferDescriptors.push({ byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex });
            inVertexBufferDescriptors.push({ byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex });
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.weights.buffer), byteOffset: 0 });
            this.vertexBufferDescriptors.push({ buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Uint8Array(shape.joints.map(j => shape.boneIndices[j])).buffer), byteOffset: 0 });
        }
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

        this.gfxProgram = cache.createProgram(new DreamDropShader(this.vertexBufferDescriptors.length, boneCount));
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
        this.drawCount = shape.indices.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shape.indices.buffer), byteOffset: 0 };
    }

    public prepareToRender(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, ranTXA: boolean) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(this.gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
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
                renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMappings[1 + this.txaIndices[Math.trunc(this.currentTXAFrame)]]);
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
}
