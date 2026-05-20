import { mat4 } from "gl-matrix";
import { FVTX, FVTX_VertexAttribute, FVTX_VertexBuffer, FSHP_Mesh, FSHP, FRES, FSKL, FSKA, FBVS, FMAA, FMAT } from "../fres_nx/bfres";
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

function translateVertexAttributeFormat(attributeFormat: AttributeFormat): GfxFormat {
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
            throw `Unknown attribute format ${attributeFormat} (${getChannelFormat(attributeFormat)}, ${getTypeFormat(attributeFormat)})`;
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
    public attributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputLayoutDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [];
    public bufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public rawAttributes: FVTX_VertexAttribute[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        this.rawAttributes = fvtx.vertexAttributes;
        let nextBufferIndex = fvtx.vertexBuffers.length;
        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const attribute = fvtx.vertexAttributes[i];
            const bufferIndex = attribute.bufferIndex;
            if (this.inputLayoutDescriptors[bufferIndex] === undefined) {
                this.inputLayoutDescriptors[bufferIndex] = null;
            }
            const buffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertAttribute(attribute, buffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;
                this.attributeDescriptors.push({
                    location: i,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    bufferByteOffset: 0
                });
                this.inputLayoutDescriptors[attribBufferIndex] = { byteStride: convertedAttribute.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                const gfxBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, convertedAttribute.data);
                this.bufferDescriptors[attribBufferIndex] = { buffer: gfxBuffer };
            } else {
                this.attributeDescriptors.push({
                    location: i,
                    format: translateVertexAttributeFormat(attribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: attribute.offset
                });
                if (!this.bufferDescriptors[bufferIndex]) {
                    const gfxBuffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, buffer.data);
                    this.inputLayoutDescriptors[bufferIndex] = { byteStride: buffer.stride, frequency: GfxVertexBufferFrequency.PerVertex };
                    this.bufferDescriptors[bufferIndex] = { buffer: gfxBuffer };
                }
            }
        }
    }

    private convertAttribute(attribute: FVTX_VertexAttribute, buffer: FVTX_VertexBuffer): ConvertedVertexAttribute | null {
        switch (attribute.format) {
            case AttributeFormat._10_10_10_2_Snorm:
                return this.convertAttribute_10_10_10_2_Snorm(attribute, buffer);
            default:
                return null;
        }
    }

    private convertAttribute_10_10_10_2_Snorm(attribute: FVTX_VertexAttribute, buffer: FVTX_VertexBuffer): ConvertedVertexAttribute {
        function signExtend10(n: number): number {
            return (n << 22) >> 22;
        }
        const numElements = buffer.data.byteLength / buffer.stride;
        const out = new Int16Array(numElements * 4);
        const stride = out.BYTES_PER_ELEMENT * 4;
        let d = 0;
        let offs = attribute.offset;
        const view = buffer.data.createDataView();
        for (let i = 0; i < numElements; i++) {
            const n = view.getUint32(offs, true);
            out[d++] = signExtend10((n >>> 0) & 0x3FF) << 4;
            out[d++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[d++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[d++] = ((n >>> 30) & 3) << 14;
            offs += buffer.stride;
        }
        return { format: GfxFormat.S16_RGBA_NORM, data: out.buffer, stride };
    }

    public destroy(device: GfxDevice): void {
        for (const bd of this.bufferDescriptors) {
            if (bd) {
                device.destroyBuffer(bd.buffer);
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
    public indexGfxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, public mesh: FSHP_Mesh, vertexData: OrigamiVertexData) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat,
            vertexAttributeDescriptors: vertexData.attributeDescriptors,
            vertexBufferDescriptors: vertexData.inputLayoutDescriptors,
        });
        this.vertexBufferDescriptors = vertexData.bufferDescriptors;
        this.indexGfxBuffer = createBufferFromSlice(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexBufferData);
        this.indexBufferDescriptor = { buffer: this.indexGfxBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexGfxBuffer);
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
        this.vertexData.destroy(device);
        this.meshData.destroy(device);
    }
}

/**
 * Processed FMDL for _Paper Mario: The Origami King_
 */
export class OrigamiModelData implements Destroyable {
    public name: string;
    public bbox: AABB = new AABB();
    public skeletonAnimation: FSKA | undefined;
    public boneVisibilityAnimation: FBVS | undefined;
    public texturePatternAnimation: FMAA | undefined;
    public shaderParamAnimation: FMAA | undefined;
    public shapeData: OrigamiShapeData[] = [];
    public skeleton: FSKL;
    public materials: (FMAT | null)[] = [];
    public smoothRigidMatrices: mat4[] = [];
    public animatedBoneIndicies: number[] = [];
    public boneVisibility: Map<number, boolean> = new Map();
    public boneVisibilityFrames: Map<number, Map<number, boolean>> = new Map();
    public baseBoneVisibility: Map<number, boolean> = new Map();
    public texturePatternFrames: Map<number, Map<number, Map<number, string>>> = new Map();
    public texturePatternValidFrameNumbers: number[] = [];
    public texturePatternSetFirstFrame: boolean = false;
    public shaderParamFrames: Map<number, Map<number, Map<number, number[]>>> = new Map();

    constructor(cache: GfxRenderCache, bfres: FRES, public config: OrigamiModelConfig | undefined) {
        const model = bfres.fmdl[0];
        this.name = model.name;
        this.skeleton = model.fskl;

        // set fska
        if (this.config && this.config.fska) {
            this.skeletonAnimation = bfres.fska.find(a => a.name === this.config!.fska);
            if (!this.skeletonAnimation) {
                console.warn("Could not find skeleton animation", this.config.fska, "in", model.name);
            } else {
                this.animatedBoneIndicies = Array(this.skeleton.bones.length);
                for (let i = 0; i < this.skeleton.bones.length; i++) {
                    this.animatedBoneIndicies[i] = this.skeletonAnimation.boneAnimations.findIndex((f) => f.name === this.skeleton.bones[i].name);
                }
            }
        }
        this.computeSmoothRigidMatrices();

        // set fbvs, match name with fska/fbvs/tpa if not set in config
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

        // set tpa
        if (this.config && this.config.texturePattern) {
            this.texturePatternAnimation = bfres.fmaa.find(a => a.name === this.config?.texturePattern);
            if (!this.texturePatternAnimation) {
                console.warn("Could not find texture pattern animation", this.config.texturePattern, "in", model.name);
            } else {
                for (let i = 0; i < this.texturePatternAnimation.materialAnimations.length; i++) {
                    const ma = this.texturePatternAnimation.materialAnimations[i];
                    const curves = ma.curves;
                    const constants = ma.constants;
                    const tpas: Map<number, Map<number, string>> = new Map();
                    for (let j = 0; j < ma.texturePatternAnimations.length; j++) {
                        const tpa = ma.texturePatternAnimations[j];
                        const useCurve = tpa.curveIndex < curves.length;
                        const useConstant = tpa.constantIndex < constants.length;
                        const tpaFrames: Map<number, string> = new Map();
                        if (useCurve) {
                            const curve = curves[tpa.curveIndex];
                            for (let k = 0; k < curve.frames.length; k++) {
                                // curve key values are always 1 less than the actual index for some reason
                                const ti = curve.keys[k][0] + 1;
                                const frameNumber = curve.frames[k];
                                tpaFrames.set(frameNumber, model.name + "_" + this.texturePatternAnimation.textureNames[ti]);
                                if (!this.texturePatternValidFrameNumbers.includes(frameNumber)) {
                                    this.texturePatternValidFrameNumbers.push(frameNumber);
                                }
                            }
                        } else if (useConstant) {
                            // always the same texture, basically just a remapping of the sampler
                            tpaFrames.set(0, model.name + "_" + this.texturePatternAnimation.textureNames[constants[tpa.constantIndex].valueInt]);
                            if (!this.texturePatternValidFrameNumbers.includes(0)) {
                                this.texturePatternValidFrameNumbers.push(0);
                            }
                        } else {
                            console.warn("Could not determine texture pattern frames for", this.config.texturePattern, "in", model.name);
                        }
                        tpas.set(j, tpaFrames);
                    }
                    this.texturePatternFrames.set(i, tpas);
                }
            }
        }

        // set spa
        if (this.config && this.config.shaderParam) {
            this.shaderParamAnimation = bfres.fmaa.find(a => a.name === this.config?.shaderParam);
            if (!this.shaderParamAnimation) {
                console.warn("Could not find shader param animation", this.config.shaderParam, "in", model.name);
            } else {
                for (let i = 0; i < this.shaderParamAnimation.materialAnimations.length; i++) {
                    const ma = this.shaderParamAnimation.materialAnimations[i];
                    const curves = ma.curves;
                    const constants = ma.constants;
                    const animationInfo = ma.shaderParamAnimations[0];
                    const spas: Map<number, Map<number, number[]>> = new Map();
                    for (let j = 0; j < ma.shaderParamAnimations.length; j++) {
                        const curve = curves[animationInfo.firstCurveIndex];
                        const constant = constants[animationInfo.firstConstantIndex];
                        const spaFrames: Map<number, number[]> = new Map();
                        for (let k = 0; k < curve.frames.length; k++) {
                            const key = curve.keys[k];
                            spaFrames.set(curve.frames[k], [key[0], key[1], constant.valueFloat, key[2], key[3]]);
                        }
                        spas.set(j, spaFrames);
                    }
                    this.shaderParamFrames.set(i, spas);
                }
            }
        }

        // filter materials with consistent indices
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
            } else if (material.name.toLowerCase().includes("mt_shadow") || material.name.toLowerCase().includes("watershadow") ||
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

        // filter shapes and create datas
        for (const shape of model.fshp) {
            if (this.config) {
                if (this.config.shapeWhitelist && !this.config.shapeWhitelist.includes(shape.name)) {
                    continue;
                }
                if (this.config.shapeBlacklist && this.config.shapeBlacklist.includes(shape.name)) {
                    continue;
                }
            }
            const sd = new OrigamiShapeData(cache, shape, new OrigamiVertexData(cache.device, model.fvtx[shape.vertexIndex]), model.fskl);
            if (this.boneVisibilityAnimation) {
                const visibility = this.baseBoneVisibility.get(shape.boneIndex);
                if (visibility !== undefined) {
                    sd.visible = visibility;
                }
            }
            this.shapeData.push(sd);
        }
    }

    private computeShiftMatrix(boneIndex: number): mat4 {
        const bone = this.skeleton.bones[boneIndex];
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
            mat4.multiply(shift, this.computeShiftMatrix(bone.parentIndex), srt);
            return shift;
        }
    }

    public computeSmoothRigidMatrices() {
        this.smoothRigidMatrices = Array(this.skeleton.smoothRigidIndices.length);
        for (let i = 0; i < this.skeleton.smoothRigidIndices.length; i++) {
            const shiftMatrix = this.computeShiftMatrix(this.skeleton.smoothRigidIndices[i]);
            if (i < this.skeleton.boneLocalFromBindPoseMatrices.length) {
                const m: mat4 = mat4.create();
                mat4.multiply(m, shiftMatrix, this.skeleton.boneLocalFromBindPoseMatrices[i]);
                this.smoothRigidMatrices[i] = m;
            } else {
                this.smoothRigidMatrices[i] = shiftMatrix;
            }
        }
    }

    public destroy(device: GfxDevice) {
        for (const sd of this.shapeData) {
            sd.destroy(device);
        }
    }
}
