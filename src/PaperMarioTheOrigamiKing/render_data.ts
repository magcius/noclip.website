import { mat4 } from "gl-matrix";
import { FVTX, FVTX_VertexAttribute, FVTX_VertexBuffer, FSHP_Mesh, FSHP, FSKL_Bone, FRES, FMDL, FSKL, FSKA, FBVS } from "../fres_nx/bfres";
import { AttributeFormat, getChannelFormat, getTypeFormat, IndexFormat } from "../fres_nx/nngfx_enum";
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxDevice, GfxVertexBufferFrequency, GfxBufferUsage, GfxBufferFrequencyHint, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxInputLayout, GfxBuffer } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { OrigamiModelConfig } from "./model_config";
import { computeModelMatrixSRT } from "../MathHelpers";

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

export class VertexData {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public rawAttributes: FVTX_VertexAttribute[] = [];

    constructor(device: GfxDevice, public vertices: FVTX) {
        this.rawAttributes = vertices.vertexAttributes;
        let nextBufferIndex = vertices.vertexBuffers.length;
        for (let i = 0; i < vertices.vertexAttributes.length; i++) {
            const vertexAttribute = vertices.vertexAttributes[i];
            const bufferIndex = vertexAttribute.bufferIndex;
            if (this.inputBufferDescriptors[bufferIndex] === undefined) {
                this.inputBufferDescriptors[bufferIndex] = null;
            }
            const vertexBuffer = vertices.vertexBuffers[bufferIndex];
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

export class MeshData {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public mesh: FSHP_Mesh, vertexData: VertexData) {
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

export class ShapeData {
    public meshData: MeshData[] = [];
    public boneMatrixLength: number;
    public visible: boolean = true;
    public vertexSkinWeightCount;

    constructor(cache: GfxRenderCache, public shape: FSHP, public vertexData: VertexData, skeleton: FSKL) {
        for (const mesh of shape.mesh) {
            this.meshData.push(new MeshData(cache, mesh, vertexData));
        }
        this.boneMatrixLength = 1;
        if (shape.vertexSkinWeightCount > 0) {
            this.boneMatrixLength = skeleton.smoothRigidIndices.length;
        }
        this.vertexSkinWeightCount = shape.vertexSkinWeightCount;
    }

    public destroy(device: GfxDevice): void {
        for (const meshData of this.meshData) {
            meshData.destroy(device);
        }
    }
}

export class ModelData {
    public model: FMDL;
    public skeletonAnimation: FSKA | undefined;
    public boneVisibilityAnimation: FBVS | undefined;
    public shapeData: ShapeData[] = [];
    public bones: FSKL_Bone[];
    public currentSKAFrame: number = 0;
    public currentBVSFrame: number = 0;
    public skeletonAnimationBoneIndices: number[] = [];
    public boneVisibilityFrames: Map<number, Map<number, boolean>> = new Map();
    public boneVisibility: Map<number, boolean> = new Map();
    public baseBoneVisibility: Map<number, boolean> = new Map();
    public smoothRigidMatrices: mat4[] = [];

    constructor(cache: GfxRenderCache, public bfres: FRES, public config: OrigamiModelConfig | undefined) {
        this.model = bfres.fmdl[0];
        if (this.config && this.config.fska) {
            this.skeletonAnimation = bfres.fska.find(a => a.name === this.config!.fska);
            if (!this.skeletonAnimation) {
                console.warn("Could not find skeleton animation", this.config.fska, "in", this.model.name);
            }
        }

        if (this.config && (this.config.fska || this.config.fbvs)) {
            const fbvsName = this.config.fbvs ? this.config.fbvs : this.config.fska;
            if (fbvsName) {
                this.boneVisibilityAnimation = bfres.fbvs.find(v => v.name === fbvsName);
            }

            if (this.boneVisibilityAnimation) {
                const boneNames = this.boneVisibilityAnimation.boneNames;
                const baseValues = this.boneVisibilityAnimation.baseValues;
                for (let i = 0; i < boneNames.length; i++) {
                    const boneIndex = this.model.fskl.bones.findIndex(b => b.name === boneNames[i]);
                    if (boneIndex >= 0) {
                        this.baseBoneVisibility.set(boneIndex, baseValues[i]);
                    }
                }

                for (const curve of this.boneVisibilityAnimation.curves) {
                    const boneName = this.boneVisibilityAnimation.boneNames[curve.targetOffset];
                    const globalBoneIndex = this.model.fskl.bones.findIndex(b => b.name === boneName);
                    for (let i = 0; i < curve.frames.length; i++) {
                        const frameNum = curve.frames[i];
                        const frame = this.boneVisibilityFrames.get(frameNum);
                        const visibility = frame ? frame : new Map<number, boolean>();
                        visibility.set(globalBoneIndex, curve.keyStepBooleans[i]);
                        if (!frame) {
                            this.boneVisibilityFrames.set(frameNum, visibility);
                        }
                    }
                }

                if (this.boneVisibilityAnimation.curves.length > 0) {
                    this.boneVisibility = this.boneVisibilityFrames.get(0)!;
                }
            } else if (this.config.fbvs) {
                // don't warn if tried to find matching fska name, sometimes there isn't one
                console.warn("Could not find bone visibility animation", this.config.fbvs, "in", this.model.name);
            }
        }

        this.bones = this.model.fskl.bones;
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

        for (const shape of this.model.fshp) {
            if (this.config) {
                if (this.config.shapeWhitelist && !this.config.shapeWhitelist.includes(shape.name)) {
                    continue;
                }
                if (this.config.shapeBlacklist && this.config.shapeBlacklist.includes(shape.name)) {
                    continue;
                }
            }
            const vd = new VertexData(cache.device, this.model.fvtx[shape.vertexIndex]);
            const sd = new ShapeData(cache, shape, vd, this.model.fskl);
            if (this.boneVisibilityAnimation) {
                const visibility = this.baseBoneVisibility.get(shape.boneIndex);
                if (visibility !== undefined) {
                    sd.visible = visibility;
                }
            }
            this.shapeData.push(sd);
        }
    }

    public computeSmoothRigidMatrices(): void {
        this.smoothRigidMatrices = [];
        for (let i = 0; i < this.model.fskl.smoothRigidIndices.length; i++) {
            const shiftMatrix = this.computeShiftMatrix(this.bones, this.model.fskl.smoothRigidIndices[i]);
            if (i < this.model.fskl.boneLocalFromBindPoseMatrices.length) {
                const scratch: mat4 = mat4.create();
                mat4.multiply(scratch, shiftMatrix, this.model.fskl.boneLocalFromBindPoseMatrices[i])
                this.smoothRigidMatrices.push(scratch);
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
}
