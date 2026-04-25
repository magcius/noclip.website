import { mat4, quat, ReadonlyMat4, vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropAnimation, DreamDropKeyframe, DreamDropObjectInstance, DreamDropPMO, DreamDropPMOBone, DreamDropPMOFlags, DreamDropPMOMaterial, DreamDropPMOShape, DreamDropShapeAttributeBlend } from "./bin";
import { CalcBillboardFlags, calcBillboardMatrix, calcEulerAngleRotationFromSRTMatrix, computeModelMatrixSRT } from "../MathHelpers";
import { DreamDropTexture } from "./texture";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { DreamDropRoomConfig } from "./config/room";
import { Layer } from "../ui";
import { TextureMapping } from "../TextureHolder";
import { DreamDropShader } from "./shader";
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from "../DebugJunk";
import { colorNewFromRGBA } from "../Color";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";

const FRAME_TIME = 0.03;
const WORLD_SCALE = 200.0;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const SCRATCH_MVP = mat4.create();
const SCRATCH_VIEW = mat4.create();
const SCRATCH_SRT = mat4.create();
const SCRATCH_BONE = mat4.create();
const SCRATCH_TEST = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

/**
 * Gets the 0-based nth nibble of a 2-byte number. For example, to get 4 from 0x0401, use `1` for `n`
 */
function getShortNibble(n: number, nibble: number): number {
    return (n >> ((3 - nibble) * 4)) & 15;
}

/**
 * Creates shift matrix based on given SRT and `WORLD_SCALE`. Rotation is assumed to be in radians
 */
function computeShiftMatrix(scale: vec3, rotation: vec3, position: vec3) {
    const srt = mat4.create();
    computeModelMatrixSRT(srt,
        WORLD_SCALE, WORLD_SCALE, WORLD_SCALE,
        rotation[0], rotation[1], rotation[2],
        position[0] * WORLD_SCALE, position[1] * WORLD_SCALE, position[2] * WORLD_SCALE
    );
    return srt;
}

export interface DreamDropRoomObjects {
    sets: DreamDropDataSet[];
    models: Map<string, DreamDropPMO>;
    animations: Map<string, DreamDropAnimation>;
}

export interface DreamDropDataSet {
    name: string;
    instances: DreamDropObjectInstance[];
}

/**
 * Renderer for a room from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropRoomRenderer implements Destroyable {
    public parts: ModelRenderer[];
    public objects: ModelRenderer[];
    public sets: DreamDropDataSet[];
    public selectedSetIndices: number[];
    private setIndices: number[];
    private allSetIndices: number[][];

    constructor(cache: GfxRenderCache, pmos: DreamDropPMO[], textures: DreamDropTexture[], objects: DreamDropRoomObjects, config: DreamDropRoomConfig | undefined) {
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });

        this.parts = Array(pmos.length);
        for (let i = 0; i < pmos.length; i++) {
            const model = pmos[i];
            const materials: MaterialInstance[] = Array(model.materials.length);
            for (let j = 0; j < model.materials.length; j++) {
                const t = textures.find(texture => texture.name === model.materials[j].textureName);
                if (t) {
                    materials[j] = new MaterialInstance(model.materials[j], t, gfxSampler);
                }
            }
            const isSkyBox = config && config.skyBoxIds && config.skyBoxIds.includes(model.id);
            this.parts[i] = new ModelRenderer(cache, model.name, model, materials, undefined, isSkyBox);
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
                    instanceRenderer.shiftMatrices.push(computeShiftMatrix(model.scale, instance.rotation, instance.position));
                } else {
                    const materials: MaterialInstance[] = Array(model.materials.length);
                    for (let i = 0; i < model.materials.length; i++) {
                        const t = textures.find(texture => texture.name === model.materials[i].textureName);
                        if (t) {
                            materials[i] = new MaterialInstance(model.materials[i], t, gfxSampler);
                        }
                    }
                    const renderer = new ModelRenderer(cache, instance.name, model, materials, objects.animations.get(instance.name), false);
                    renderer.shiftMatrices = [computeShiftMatrix(model.scale, instance.rotation, instance.position)];
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
    public bbox: Float32Array;
    public shiftMatrices: mat4[];
    private shapes: ShapeRenderer[];
    private isBillboard: boolean;
    private currentPAMFrame: number;
    private pamFramerate: number;
    private lastComputedPAMFrame: number;
    private boneMatrices: mat4[] = [];
    private bones: DreamDropPMOBone[];
    private decomposedBoneTransforms: { scale: vec3, rotation: vec3, translation: vec3 }[] = [];

    constructor(cache: GfxRenderCache, name: string, model: DreamDropPMO, materials: MaterialInstance[], private animation?: DreamDropAnimation, private isSkyBox: boolean = false) {
        // console.log(model.name, model.shapes.map(s => s.attribute.toString(16).padStart(4, "0")).join(" "));
        this.name = name;
        this.shapes = Array(model.shapes.length);
        for (let i = 0; i < model.shapes.length; i++) {
            const shape = model.shapes[i];
            this.shapes[i] = new ShapeRenderer(
                cache, shape, model.scaleNum, materials[shape.textureIndex], isSkyBox,
                model.skeleton ? model.skeleton.skinWeightCount : 0,
                model.skeleton ? model.skeleton.bones.length : 0
            );
        }
        this.shiftMatrices = [computeShiftMatrix(model.scale, model.rotation, model.position)];
        this.bbox = new Float32Array(model.bbox.map(v => v / model.scaleNum)); // some bboxes need the divison (???)
        this.isBillboard = getShortNibble(model.flags, 1) === DreamDropPMOFlags.BILLBOARD;

        this.currentPAMFrame = 0;
        this.pamFramerate = this.animation ? this.animation.framerate / 1000.0 : 0;
        this.lastComputedPAMFrame = 0;
        this.bones = model.skeleton ? model.skeleton.bones : [];
        if (this.animation) {
            console.log(model);
            console.log(this.animation);
            this.boneMatrices = Array.from({ length: this.bones.length }, () => mat4.create());
            this.decomposedBoneTransforms = Array(this.bones.length);
            for (let i = 0; i < this.bones.length; i++) {
                const bone = this.bones[i];
                const scale = vec3.create();
                const rotation = vec3.create();
                const translation = vec3.create();
                mat4.getScaling(scale, bone.transform);
                calcEulerAngleRotationFromSRTMatrix(rotation, bone.transform);
                mat4.getTranslation(translation, bone.transform);
                this.decomposedBoneTransforms[i] = { scale, rotation, translation };
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        let ranAnimation = false;
        const template = renderHelper.renderInstManager.pushTemplate();

        for (const shiftMatrix of this.shiftMatrices) {
            if (!this.isSkyBox) {
                mat4.mul(SCRATCH_MVP, viewerInput.camera.clipFromWorldMatrix, shiftMatrix);
                if (!this.inView(this.bbox, SCRATCH_MVP)) {
                    continue;
                }
            }
            if (this.animation && !ranAnimation) {
                this.currentPAMFrame += viewerInput.deltaTime * this.pamFramerate;
                this.currentPAMFrame %= this.animation.frameCount;
                const frameInt = Math.trunc(this.currentPAMFrame);
                if (this.lastComputedPAMFrame !== frameInt) {
                    this.computeBoneMatrices();
                    this.lastComputedPAMFrame = frameInt;
                }
                ranAnimation = true;
            }
            if (this.animation) {
                const ctx = getDebugOverlayCanvas2D();
                for (let i = 0; i < this.bones.length; i++) {
                    const bone = this.bones[i];
                    if (bone.parentIndex === 0xFFFF) continue;

                    vec3.set(scratchVec3a, 0, 0, 0);
                    vec3.transformMat4(scratchVec3a, scratchVec3a, this.boneMatrices[bone.parentIndex]);
                    vec3.set(scratchVec3b, 0, 0, 0);
                    vec3.transformMat4(scratchVec3b, scratchVec3b, this.boneMatrices[bone.index]);

                    drawWorldSpaceLine(ctx, SCRATCH_MVP, scratchVec3a, scratchVec3b, colorNewFromRGBA(0.5, 0.5, (this.bones.length - i) / this.bones.length));
                }
            }
            let offset = template.allocateUniformBuffer(DreamDropShader.ub_ModelParams, 12 + (12 * this.bones.length));
            const d = template.mapUniformBufferF32(DreamDropShader.ub_ModelParams);
            // u_View (12)
            if (this.isSkyBox) {
                computeViewMatrixSkybox(SCRATCH_VIEW, viewerInput.camera);
            } else {
                computeViewMatrix(SCRATCH_VIEW, viewerInput.camera);
            }
            mat4.mul(SCRATCH_VIEW, SCRATCH_VIEW, shiftMatrix);
            if (this.isBillboard && !this.isSkyBox) {
                calcBillboardMatrix(SCRATCH_VIEW, SCRATCH_VIEW, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
            }
            offset += fillMatrix4x3(d, offset, SCRATCH_VIEW);
            if (this.bones.length > 0) {
                // u_BoneSRT (12 * boneCount)
                for (let i = 0; i < this.bones.length; i++) {
                    if (this.animation) {
                        mat4.mul(SCRATCH_BONE, this.boneMatrices[i], this.bones[i].inverseTransform);
                        offset += fillMatrix4x3(d, offset, SCRATCH_BONE);
                    } else {
                        offset += fillMatrix4x3(d, offset, SCRATCH_SRT);
                    }
                }
            }

            for (const shape of this.shapes) {
                shape.prepareToRender(renderHelper);
            }
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

    private getAnimValue(keyframes: DreamDropKeyframe[] | undefined, frame: number, defaultValue: number): number {
        if (!keyframes || keyframes.length === 0) return defaultValue;
        if (keyframes.length === 1) return keyframes[0].value;

        let prev = keyframes[0];
        let next = keyframes[keyframes.length - 1];

        if (frame <= prev.frame) return prev.value;
        if (frame >= next.frame) return next.value;

        for (let i = 0; i < keyframes.length - 1; i++) {
            if (keyframes[i].frame <= frame && keyframes[i + 1].frame >= frame) {
                prev = keyframes[i];
                next = keyframes[i + 1];
                break;
            }
        }

        if (prev.frame === next.frame) return prev.value;

        const t = (frame - prev.frame) / (next.frame - prev.frame);
        return prev.value + (next.value - prev.value) * t;
    }

    private computeBoneMatrices() {
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            const frames = this.animation!.channels[bone.index];
            const { scale, rotation, translation } = this.decomposedBoneTransforms[i];
            const sx = this.getAnimValue(frames.scaleX, this.lastComputedPAMFrame, scale[0]);
            const sy = this.getAnimValue(frames.scaleY, this.lastComputedPAMFrame, scale[1]);
            const sz = this.getAnimValue(frames.scaleZ, this.lastComputedPAMFrame, scale[2]);
            const rx = this.getAnimValue(frames.rotationX, this.lastComputedPAMFrame, rotation[0]);
            const ry = this.getAnimValue(frames.rotationY, this.lastComputedPAMFrame, rotation[1]);
            const rz = this.getAnimValue(frames.rotationZ, this.lastComputedPAMFrame, rotation[2]);
            const tx = this.getAnimValue(frames.translationX, this.lastComputedPAMFrame, translation[0]);
            const ty = this.getAnimValue(frames.translationY, this.lastComputedPAMFrame, translation[1]);
            const tz = this.getAnimValue(frames.translationZ, this.lastComputedPAMFrame, translation[2]);
            computeModelMatrixSRT(SCRATCH_BONE, sx, sy, sz, rx, ry, rz, tx, ty, tz);
            mat4.copy(this.boneMatrices[i], SCRATCH_BONE);
            if (bone.parentIndex < 0xFFFF) {
                mat4.mul(this.boneMatrices[i], this.boneMatrices[bone.parentIndex], this.boneMatrices[i]);
            }
        }
    }
}

class MaterialInstance {
    public scrollX: number;
    public scrollY: number;
    public textureMapping: TextureMapping[];

    constructor(material: DreamDropPMOMaterial, texture: DreamDropTexture, gfxSampler: GfxSampler) {
        this.scrollX = material.scrollX;
        this.scrollY = material.scrollY;
        this.textureMapping = [new TextureMapping()];
        this.textureMapping[0].gfxTexture = texture.gfxTexture;
        this.textureMapping[0].gfxSampler = gfxSampler;
    }
}

class ShapeRenderer implements Destroyable {
    public sortKey: number;
    private drawCount: number;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private gfxInputLayout: GfxInputLayout;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, shape: DreamDropPMOShape, scale: number, private material: MaterialInstance, private isSkyBox: boolean = false, skinWeightCount: number, boneCount: number) {
        const blendByte = getShortNibble(shape.attribute, 2);
        const isTranslucent = blendByte === DreamDropShapeAttributeBlend.TRANSLUCENT || blendByte === DreamDropShapeAttributeBlend.TRANSLUCENT2;
        const additiveBlend = blendByte === DreamDropShapeAttributeBlend.ADDITIVE;
        const transparent = isTranslucent || additiveBlend;
        this.megaStateFlags = {
            depthWrite: !transparent
        };
        if (transparent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
        }
        if (isSkyBox) {
            this.megaStateFlags.depthWrite = false;
            this.megaStateFlags.depthCompare = GfxCompareMode.Always;
        }
        this.sortKey = makeSortKey(transparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);

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

        this.gfxProgram = cache.createProgram(new DreamDropShader(this.vertexBufferDescriptors.length, skinWeightCount, boneCount));
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
        this.drawCount = shape.indices.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shape.indices.buffer), byteOffset: 0 };
    }

    public prepareToRender(renderHelper: GfxRenderHelper) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(this.gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        let o = renderInst.allocateUniformBuffer(DreamDropShader.ub_ShapeParams, 3);
        const d = renderInst.mapUniformBufferF32(DreamDropShader.ub_ShapeParams);

        if (this.material) {
            d[o++] = this.material.scrollX;
            d[o++] = this.material.scrollY;
            d[o++] = 1.0;
            renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMapping);
        } else {
            d[o++] = 0.0;
            d[o++] = 0.0;
            d[o++] = 0.0;
        }
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (!this.isSkyBox) {
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
