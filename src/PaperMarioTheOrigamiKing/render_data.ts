import { mat4 } from "gl-matrix";
import { FVTX, FVTX_VertexAttribute, FVTX_VertexBuffer, FSHP_Mesh, FSHP, FSKL_Bone, FRES, FMDL, FSKL, FSKA, FBVS, FMAA, FMAT, ShaderParamAnimation } from "../fres_nx/bfres";
import { AttributeFormat, getChannelFormat, getTypeFormat, IndexFormat } from "../fres_nx/nngfx_enum";
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxDevice, GfxVertexBufferFrequency, GfxBufferUsage, GfxBufferFrequencyHint, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxInputLayout, GfxBuffer } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { OrigamiModelConfig } from "./model_config";
import { computeModelMatrixSRT } from "../MathHelpers";
import { AABB } from "../Geometry";
import { Destroyable } from "../SceneBase";

// Adapated code from MK8D/Odyessy for lots of the rendering and NX translation, and TMSFE for some of the animations. Switch Toolbox was a big help too

interface ConvertedVertexAttribute {
    format: GfxFormat;
    data: ArrayBufferLike;
    stride: number;
}

function translateAttributeFormat(attributeFormat: AttributeFormat): GfxFormat {
    switch (attributeFormat) {
        case AttributeFormat._8_Uint:
            return GfxFormat.U8_R;
        case AttributeFormat._8_Unorm:
            return GfxFormat.U8_R_NORM;
        case AttributeFormat._8_8_Uint:
            return GfxFormat.U8_RG;
        case AttributeFormat._8_8_Unorm:
            return GfxFormat.U8_RG_NORM;
        case AttributeFormat._8_8_Snorm:
            return GfxFormat.S8_RG_NORM;
        case AttributeFormat._16_Uint:
            return GfxFormat.U16_R;
        case AttributeFormat._8_8_8_8_Unorm:
            return GfxFormat.U8_RGBA_NORM;
        case AttributeFormat._8_8_8_8_Snorm:
            return GfxFormat.S8_RGBA_NORM;
        case AttributeFormat._8_8_8_8_Uint:
            return GfxFormat.U8_RGBA;
        case AttributeFormat._10_10_10_2_Snorm:
            return GfxFormat.S8_RGBA_NORM;
        case AttributeFormat._16_16_Unorm:
            return GfxFormat.U16_RG_NORM;
        case AttributeFormat._16_16_Snorm:
            return GfxFormat.S16_RG_NORM;
        case AttributeFormat._16_16_Uint:
            return GfxFormat.U16_RG;
        case AttributeFormat._16_16_Float:
            return GfxFormat.F16_RG;
        case AttributeFormat._16_16_16_16_Uint:
            return GfxFormat.U16_RGBA;
        case AttributeFormat._16_16_16_16_Float:
            return GfxFormat.F16_RGBA;
        case AttributeFormat._32_32_Float:
            return GfxFormat.F32_RG;
        case AttributeFormat._32_32_32_Float:
            return GfxFormat.F32_RGB;
        case AttributeFormat._32_32_32_32_Float:
            return GfxFormat.F32_RGBA;
        default:
            console.error(getChannelFormat(attributeFormat), getTypeFormat(attributeFormat));
            throw `Unknown attribute format ${attributeFormat}`;
    }
}

function translateIndexFormat(indexFormat: IndexFormat): GfxFormat {
    switch (indexFormat) {
        case IndexFormat.Uint8:
            return GfxFormat.U8_R;
        case IndexFormat.Uint16:
            return GfxFormat.U16_R;
        case IndexFormat.Uint32:
            return GfxFormat.U32_R;
        default:
            throw `Unknown index format ${indexFormat}`;
    }
}

/**
 * Processed FVTX for _Paper Mario: The Origami King_
 */
export class OrigamiVertexData implements Destroyable {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public rawAttributes: FVTX_VertexAttribute[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        this.rawAttributes = fvtx.vertexAttributes;
        let nextBufferIndex = fvtx.vertexBuffers.length;
        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const bufferIndex = vertexAttribute.bufferIndex;
            if (this.inputBufferDescriptors[bufferIndex] === undefined) {
                this.inputBufferDescriptors[bufferIndex] = null;
            }
            const vertexBuffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;
                this.vertexAttributeDescriptors.push({
                    location: i,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    bufferByteOffset: 0
                });
                this.inputBufferDescriptors[attribBufferIndex] = { byteStride: convertedAttribute.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                const gfxBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, convertedAttribute.data);
                this.vertexBufferDescriptors[attribBufferIndex] = { buffer: gfxBuffer };
            } else {
                this.vertexAttributeDescriptors.push({
                    location: i,
                    format: translateAttributeFormat(vertexAttribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset
                });
                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const gfxBuffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexBuffer.data);
                    this.inputBufferDescriptors[bufferIndex] = { byteStride: vertexBuffer.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                    this.vertexBufferDescriptors[bufferIndex] = { buffer: gfxBuffer };
                }
            }
        }
    }

    private convertVertexAttribute(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute | null {
        switch (vertexAttribute.format) {
            case AttributeFormat._10_10_10_2_Snorm:
                return this.convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute, vertexBuffer);
            default:
                return null;
        }
    }

    private convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute {
        function signExtend10(n: number): number {
            return (n << 22) >> 22;
        }
        const numElements = vertexBuffer.data.byteLength / vertexBuffer.stride;
        const out = new Int16Array(numElements * 4);
        const stride = out.BYTES_PER_ELEMENT * 4;
        let dst = 0;
        let offs = vertexAttribute.offset;
        const view = vertexBuffer.data.createDataView();
        for (let i = 0; i < numElements; i++) {
            const n = view.getUint32(offs, true);
            out[dst++] = signExtend10((n >>> 0) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[dst++] = ((n >>> 30) & 0x03) << 14;
            offs += vertexBuffer.stride;
        }
        return { format: GfxFormat.S16_RGBA_NORM, data: out.buffer, stride };
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++) {
            if (this.vertexBufferDescriptors[i]) {
                device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
            }
        }
    }
}

/**
 * Processed FSHP mesh for _Paper Mario: The Origami King_
 */
export class OrigamiMeshData implements Destroyable {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public mesh: FSHP_Mesh, vertexData: OrigamiVertexData) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat,
            vertexAttributeDescriptors: vertexData.vertexAttributeDescriptors,
            vertexBufferDescriptors: vertexData.inputBufferDescriptors,
        });
        this.vertexBufferDescriptors = vertexData.vertexBufferDescriptors;
        this.indexBuffer = createBufferFromSlice(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexBufferData);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
    }
}

/**
 * Processed FSHP for _Paper Mario: The Origami King_
 */
export class OrigamiShapeData implements Destroyable {
    public meshData: OrigamiMeshData;
    public boneMatrixLength: number;
    public visible: boolean = true;
    public vertexSkinWeightCount;

    constructor(cache: GfxRenderCache, public shape: FSHP, public vertexData: OrigamiVertexData, skeleton: FSKL) {
        this.meshData = new OrigamiMeshData(cache, shape.mesh[0], vertexData);
        this.boneMatrixLength = 1;
        if (shape.vertexSkinWeightCount > 0) {
            this.boneMatrixLength = skeleton.smoothRigidIndices.length;
        }
        this.vertexSkinWeightCount = shape.vertexSkinWeightCount;
    }

    public destroy(device: GfxDevice): void {
        this.meshData.destroy(device);
    }
}

/**
 * Processed FMDL for _Paper Mario: The Origami King_
 */
export class OrigamiModelData implements Destroyable {
    public name: string;
    public bbox: AABB;
    public skeletonAnimation: FSKA | undefined;
    public boneVisibilityAnimation: FBVS | undefined;
    public texturePatternAnimation: FMAA | undefined;
    public shaderParamAnimation: FMAA | undefined;
    public shapeData: OrigamiShapeData[] = [];
    public bones: FSKL_Bone[];
    public skeleton: FSKL;
    public materials: (FMAT | null)[] = [];
    public currentSKAFrame: number = 0;
    public currentBVSFrame: number = 0;
    public currentTPAFrame: number = 0;
    public currentSPAFrame: number = 0;
    public smoothRigidMatrices: mat4[] = [];
    public skeletonAnimationBoneIndices: number[] = [];
    public boneVisibility: Map<number, boolean> = new Map();
    public boneVisibilityFrames: Map<number, Map<number, boolean>> = new Map();
    public baseBoneVisibility: Map<number, boolean> = new Map();
    public texturePatternFrames: Map<number, string> = new Map();
    public texturePatternSampler: string = "";
    public texturePatternSetFirstFrame: boolean = false;
    public shaderParamName: string = "";
    public shaderParamFrames: Map<number, number[]> = new Map();

    constructor(cache: GfxRenderCache, bfres: FRES, public config: OrigamiModelConfig | undefined) {
        const model = bfres.fmdl[0];
        this.name = model.name;
        this.skeleton = model.fskl;

        if (this.config && this.config.fska) {
            this.skeletonAnimation = bfres.fska.find(a => a.name === this.config!.fska);
            if (!this.skeletonAnimation) {
                console.warn("Could not find skeleton animation", this.config.fska, "in", model.name);
            }
        }

        if (this.config && (this.config.fska || this.config.fbvs || this.config.texturePattern)) {
            const searchName = this.config.fbvs ? this.config.fbvs : (this.config.fska ? this.config.fska : this.config.texturePattern);
            if (searchName) {
                this.boneVisibilityAnimation = bfres.fbvs.find(v => v.name === searchName);
            }

            if (this.boneVisibilityAnimation) {
                const boneNames = this.boneVisibilityAnimation.boneNames;
                // boneNames and baseValues are assumed to have equal length
                for (let i = 0; i < boneNames.length; i++) {
                    const globalBoneIndex = this.skeleton.bones.findIndex(b => b.name === boneNames[i]);
                    if (globalBoneIndex >= 0) {
                        this.baseBoneVisibility.set(globalBoneIndex, this.boneVisibilityAnimation.baseValues[i]);
                    }
                }

                for (const curve of this.boneVisibilityAnimation.curves) {
                    let keyIndex = 0;
                    const keyStepBooleans = Array(curve.keys.length);
                    for (let i = 0; i < curve.keys.length; i++) {
                        if (curve.keys.length <= keyIndex) {
                            break;
                        }
                        let value = curve.keys[i][0];
                        for (let j = 0; j < 32; j++) {
                            if (curve.keys.length <= keyIndex) {
                                break;
                            }
                            const set = (value & 1) !== 0;
                            value >>= 1;
                            keyStepBooleans[keyIndex] = set;
                            keyIndex++;
                        }
                    }
                    const boneName = this.boneVisibilityAnimation.boneNames[curve.targetOffset];
                    const globalBoneIndex = this.skeleton.bones.findIndex(b => b.name === boneName);
                    for (let i = 0; i < curve.frames.length; i++) {
                        const frame = this.boneVisibilityFrames.get(curve.frames[i]);
                        const visibility = frame ? frame : new Map<number, boolean>();
                        visibility.set(globalBoneIndex, keyStepBooleans[i]);
                        if (!frame) {
                            this.boneVisibilityFrames.set(curve.frames[i], visibility);
                        }
                    }
                }

                if (this.boneVisibilityAnimation.curves.length > 0) {
                    this.boneVisibility = this.boneVisibilityFrames.get(0)!;
                }
            } else if (this.config.fbvs) {
                // don't warn if tried to find matching fska name, sometimes there isn't one
                console.warn("Could not find bone visibility animation", this.config.fbvs, "in", model.name);
            }
        }

        this.bones = model.fskl.bones;
        if (this.skeletonAnimation) {
            for (let i = 0; i < this.bones.length; i++) {
                let index = -1;
                const animation = this.skeletonAnimation.boneAnimations.find((f) => f.name === this.bones[i].name);
                if (animation) {
                    index = this.skeletonAnimation.boneAnimations.indexOf(animation);
                }
                this.skeletonAnimationBoneIndices.push(index);
            }
        }
        this.computeSmoothRigidMatrices();

        if (this.config && this.config.texturePattern) {
            this.texturePatternAnimation = bfres.fmaa.find(a => a.name === this.config?.texturePattern);
            if (!this.texturePatternAnimation) {
                console.warn("Could not find texture pattern animation", this.config.texturePattern, "in", model.name);
            } else {
                const ma = this.texturePatternAnimation.materialAnimations[0];
                const ta = ma.texturePatternAnimations[0];
                const useCurve = ta.curveIndex < ma.curves.length;
                const useConstant = ta.constantIndex < ma.constants.length;

                if (useCurve) {
                    const curve = ma.curves[ta.curveIndex];
                    for (let i = 0; i < curve.frames.length; i++) {
                        this.texturePatternFrames.set(curve.frames[i], model.name + "_" + this.texturePatternAnimation.textureNames[curve.keys[i][0] + 1]);
                    }
                } else if (useConstant) {
                    this.texturePatternFrames.set(0, model.name + "_" + this.texturePatternAnimation.textureNames[ma.constants[ta.constantIndex].valueInt]);
                } else {
                    console.warn("Could not determine texture pattern frames for", this.config.texturePattern, "in", model.name);
                }

                this.texturePatternSampler = ta.samplerName;
            }
        }

        if (this.config && this.config.shaderParam) {
            this.shaderParamAnimation = bfres.fmaa.find(a => a.name === this.config?.shaderParam);
            if (!this.shaderParamAnimation) {
                console.warn("Could not find shader param animation", this.config.shaderParam, "in", model.name);
            } else {
                const ma = this.shaderParamAnimation.materialAnimations[0];
                if (ma) {
                    const curves = ma.curves;
                    const constants = ma.constants;
                    const animationInfo = ma.shaderParamAnimations[0];
                    if (animationInfo) {
                        this.shaderParamName = animationInfo.paramName;
                        const curve = curves[animationInfo.firstCurveIndex];
                        const constant = constants[animationInfo.firstConstantIndex];
                        for (let i = 0; i < curve.frames.length; i++) {
                            const key = curve.keys[i];
                            this.shaderParamFrames.set(curve.frames[i], [key[0], key[1], constant.valueFloat, key[2], key[3]]);
                        }
                    }
                }
            }
        }

        for (let i = 0; i < model.fmat.length; i++) {
            const material = model.fmat[i];
            const shaderAssignExec = material.userData.get("__ShaderAssignExec");
            let visible = true;
            if (shaderAssignExec) {
                for (const s of shaderAssignExec as string[]) {
                    if (s.includes("SetAttribute('visibility', 'false')")) {
                        visible = false;
                        break;
                    }
                }
            } else if (material.name.toLowerCase().includes("mt_shadow") ||
                material.name.toLowerCase().endsWith("_sm") || material.name.toLowerCase().endsWith("_bs") ||
                material.name.toLowerCase().includes("lambert") || material.name.toLowerCase().includes("colorpattern") ||
                (material.samplerInfo.length < 1 && material.name.toLowerCase() !== "mt_mask")) {
                visible = false;
            }
            if (visible && this.config) {
                if (this.config.materialWhitelist && !this.config.materialWhitelist.includes(material.name)) {
                    visible = false;
                }
                if (this.config.materialBlacklist && this.config.materialBlacklist.includes(material.name)) {
                    visible = false;
                }
            }
            if (visible) {
                for (let i = 0; i < material.textureName.length; i++) {
                    if (!material.textureName[i].startsWith("Cmn_")) {
                        material.textureName[i] = `${model.name}_${material.textureName[i]}`;
                    }
                }
                this.materials.push(material);
            } else {
                // append null for consistent indices
                this.materials.push(null);
            }
        }

        const shapeBBoxes: AABB[] = [];
        for (const shape of model.fshp) {
            if (this.config) {
                if (this.config.shapeWhitelist && !this.config.shapeWhitelist.includes(shape.name)) {
                    continue;
                }
                if (this.config.shapeBlacklist && this.config.shapeBlacklist.includes(shape.name)) {
                    continue;
                }
            }
            const vd = new OrigamiVertexData(cache.device, model.fvtx[shape.vertexIndex]);
            const sd = new OrigamiShapeData(cache, shape, vd, model.fskl);
            if (this.boneVisibilityAnimation) {
                const visibility = this.baseBoneVisibility.get(shape.boneIndex);
                if (visibility !== undefined) {
                    sd.visible = visibility;
                }
            }
            this.shapeData.push(sd);
            if (sd && sd.visible && sd.meshData.mesh.bbox) {
                shapeBBoxes.push(sd.meshData.mesh.bbox);
            }
        }

        this.bbox = this.mergeAABB(shapeBBoxes);
    }

    public computeSmoothRigidMatrices(): void {
        this.smoothRigidMatrices = [];
        for (let i = 0; i < this.skeleton.smoothRigidIndices.length; i++) {
            const shiftMatrix = this.computeShiftMatrix(this.bones, this.skeleton.smoothRigidIndices[i]);
            if (i < this.skeleton.boneLocalFromBindPoseMatrices.length) {
                const m: mat4 = mat4.create();
                mat4.multiply(m, shiftMatrix, this.skeleton.boneLocalFromBindPoseMatrices[i])
                this.smoothRigidMatrices.push(m);
            } else {
                this.smoothRigidMatrices.push(shiftMatrix);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (const sd of this.shapeData) {
            sd.vertexData.destroy(device);
            sd.destroy(device);
        }
    }

    private computeShiftMatrix(bones: FSKL_Bone[], boneIndex: number): mat4 {
        const bone = bones[boneIndex];
        const srt: mat4 = mat4.create();
        computeModelMatrixSRT(srt,
            bone.scale[0], bone.scale[1], bone.scale[2],
            bone.rotation[0], bone.rotation[1], bone.rotation[2],
            bone.translation[0], bone.translation[1], bone.translation[2],
        );
        if (bone.parentIndex === -1) {
            return srt;
        } else {
            const shift: mat4 = mat4.create();
            mat4.multiply(shift, this.computeShiftMatrix(bones, bone.parentIndex), srt);
            return shift;
        }
    }

    private mergeAABB(boxes: AABB[]): AABB {
        if (boxes.length === 0) {
            console.warn("No valid shapes for", this.name);
            return new AABB();
        }

        let minX = boxes[0].min[0];
        let minY = boxes[0].min[1];
        let minZ = boxes[0].min[2];
        let maxX = boxes[0].max[0];
        let maxY = boxes[0].max[1];
        let maxZ = boxes[0].max[2];

        for (const box of boxes) {
            minX = Math.min(minX, box.min[0]);
            minY = Math.min(minY, box.min[1]);
            minZ = Math.min(minZ, box.min[2]);
            maxX = Math.max(maxX, box.max[0]);
            maxY = Math.max(maxY, box.max[1]);
            maxZ = Math.max(maxZ, box.max[2]);
        }

        return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
    }
}
