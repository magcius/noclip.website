
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";
import { AttributeFormat, IndexFormat, PrimitiveTopology, TextureAddressMode, FilterMode } from "./nngfx_enum";
import { AABB } from "../Geometry";

export interface FSKL_Bone {
    name: string;
}

export interface FSKL {
    bones: FSKL_Bone[];
}

export interface FVTX_VertexAttribute {
    name: string;
    format: AttributeFormat;
    offset: number;
    bufferIndex: number;
}

export interface FVTX_VertexBuffer {
    data: ArrayBufferSlice;
    stride: number;
    divisor: number;
}

export interface FVTX {
    vertexAttributes: FVTX_VertexAttribute[];
    vertexBuffers: FVTX_VertexBuffer[];
}

export interface FSHP_SubMesh {
    offset: number;
    count: number;
    bbox: AABB;
}

export interface FSHP_Mesh {
    primType: PrimitiveTopology;
    count: number;
    offset: number;
    subMeshes: FSHP_SubMesh[];
    indexFormat: IndexFormat;
    indexBufferData: ArrayBufferSlice;
    bbox: AABB;
}

export interface FSHP {
    name: string;
    mesh: FSHP_Mesh[];
    vertexIndex: number;
    boneIndex: number;
    materialIndex: number;
}

export const enum FMAT_RenderInfoType {
    Int, Float, String,
}

interface FMAT_RenderInfo_Number {
    type: FMAT_RenderInfoType.Int | FMAT_RenderInfoType.Float;
    values: number[];
}

interface FMAT_RenderInfo_String {
    type: FMAT_RenderInfoType.String;
    values: string[];
}

export type FMAT_RenderInfo = FMAT_RenderInfo_Number | FMAT_RenderInfo_String;

export interface FMAT_ShaderAssign {
    shaderArchiveName: string;
    shadingModelName: string;
    revision: number;
    attrAssign: Map<string, string>;
    samplerAssign: Map<string, string>;
    shaderOption: Map<string, string>;
}

export interface FMAT_SamplerInfo {
    name: string;
    addrModeU: TextureAddressMode; 
    addrModeV: TextureAddressMode; 
    addrModeW: TextureAddressMode; 
    filterMode: FilterMode;
    minLOD: number;
    maxLOD: number;
    lodBias: number;
}

export const enum FMAT_ShaderParamType {
    Bool, Bool2, Bool3, Bool4,
    Int, Int2, Int3, Int4,
    Uint, Uint2, Uint3, Uint4,
    Float, Float2, Float3, Float4,
    Float2x1, Float2x2, Float2x3, Float2x4,
    Float3x1, Float3x2, Float3x3, Float3x4,
    Float4x1, Float4x2, Float4x3, Float4x4,
    Srt2d, Srt3d, Texsrt,
}

export interface FMAT_ShaderParam {
    name: string;
    type: FMAT_ShaderParamType;
    srcSize: number;
    srcOffset: number;
    offset: number;
}

export interface FMAT {
    name: string;
    renderInfo: Map<string, FMAT_RenderInfo>;
    shaderAssign: FMAT_ShaderAssign;
    textureName: string[];
    samplerInfo: FMAT_SamplerInfo[];
    shaderParam: FMAT_ShaderParam[];
}

export interface FMDL {
    name: string;
    fskl: FSKL;
    fvtx: FVTX[];
    fshp: FSHP[];
    fmat: FMAT[];
}

export interface FRES {
    fmdl: FMDL[];
    externalFiles: ExternalFile[];
}

export interface ExternalFile {
    name: string;
    buffer: ArrayBufferSlice;
}

export function readBinStr(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): string {
    // first two bytes are the size
    return readString(buffer, offs + 0x02, 0xFF, true);
}

function parseFSKL(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): FSKL {
    const view = buffer.createDataView();

    assert(readString(buffer, offs + 0x00, 0x04) === 'FSKL');
    const boneArrayOffs = view.getUint32(offs + 0x18, littleEndian);

    const enum BoneFlag {
        RotationMode_Quat     = 0x00 << 12,
        RotationMode_EulerXyz = 0x01 << 12,
    }

    const flag = view.getUint32(offs + 0x48, littleEndian);
    const boneCount = view.getUint16(offs + 0x4C, littleEndian);
    const smoothMtxCount = view.getUint16(offs + 0x4E, littleEndian);
    const rigidMtxCount = view.getUint16(offs + 0x50, littleEndian);

    let boneArrayIdx = boneArrayOffs;
    const bones: FSKL_Bone[] = [];
    for (let i = 0; i < boneCount; i++) {
        const name = readBinStr(buffer, view.getUint32(boneArrayIdx + 0x00, littleEndian), littleEndian);
        const index = view.getUint16(boneArrayIdx + 0x28, littleEndian);
        const parentIndex = view.getUint16(boneArrayIdx + 0x2A, littleEndian);
        const smoothMtxIndex = view.getInt16(boneArrayIdx + 0x2C, littleEndian);
        const rigidMtxIndex = view.getInt16(boneArrayIdx + 0x2E, littleEndian);
        const billboardIndex = view.getUint16(boneArrayIdx + 0x30, littleEndian);
        const boneFlag: BoneFlag = view.getUint32(boneArrayIdx + 0x34, littleEndian);

        const scaleX = view.getFloat32(boneArrayIdx + 0x38, littleEndian);
        const scaleY = view.getFloat32(boneArrayIdx + 0x3C, littleEndian);
        const scaleZ = view.getFloat32(boneArrayIdx + 0x40, littleEndian);
        if ((boneFlag & BoneFlag.RotationMode_EulerXyz)) {
            const rotationEulerX = view.getFloat32(boneArrayIdx + 0x44, littleEndian);
            const rotationEulerY = view.getFloat32(boneArrayIdx + 0x48, littleEndian);
            const rotationEulerZ = view.getFloat32(boneArrayIdx + 0x4C, littleEndian);
        } else {
            const rotationQuatX = view.getFloat32(boneArrayIdx + 0x44, littleEndian);
            const rotationQuatY = view.getFloat32(boneArrayIdx + 0x48, littleEndian);
            const rotationQuatZ = view.getFloat32(boneArrayIdx + 0x4C, littleEndian);
            const rotationQuatW = view.getFloat32(boneArrayIdx + 0x50, littleEndian);
        }
        const translationX = view.getFloat32(boneArrayIdx + 0x54, littleEndian);
        const translationY = view.getFloat32(boneArrayIdx + 0x58, littleEndian);
        const translationZ = view.getFloat32(boneArrayIdx + 0x5C, littleEndian);

        bones.push({ name });
        boneArrayIdx += 0x60;
    }
    return { bones };
}

function parseFVTX(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, offs: number, littleEndian: boolean): FVTX {
    const view = buffer.createDataView();

    const vertexAttrArrayOffs = view.getUint32(offs + 0x10, littleEndian);
    const vertexBufferInfoArrayOffs = view.getUint32(offs + 0x38, littleEndian);
    const vertexBufferStateInfoArrayOffs = view.getUint32(offs + 0x40, littleEndian);
    const memoryPoolOffset = view.getUint32(offs + 0x50, littleEndian);
    const vertexAttrCount = view.getUint8(offs + 0x54);
    const vertexBufferCount = view.getUint8(offs + 0x55);

    const vertexAttributes: FVTX_VertexAttribute[] = [];
    let vertexAttrArrayIdx = vertexAttrArrayOffs;
    for (let i = 0; i < vertexAttrCount; i++) {
        const name = readBinStr(buffer, view.getUint32(vertexAttrArrayIdx + 0x00, littleEndian), littleEndian);
        const format = view.getUint32(vertexAttrArrayIdx + 0x08, littleEndian);
        const offset = view.getUint16(vertexAttrArrayIdx + 0x0C, littleEndian);
        const bufferIndex = view.getUint8(vertexAttrArrayIdx + 0x0E);
        vertexAttributes.push({ name, format, offset, bufferIndex });
        vertexAttrArrayIdx += 0x10;
    }

    let vertexBufferInfoArrayIdx = vertexBufferInfoArrayOffs;
    let vertexBufferStateInfoArrayIdx = vertexBufferStateInfoArrayOffs;
    let memoryPoolRunningOffset = memoryPoolOffset;
    const vertexBuffers: FVTX_VertexBuffer[] = [];
    for (let i = 0; i < vertexBufferCount; i++) {
        const vertexBufferSize = view.getUint32(vertexBufferInfoArrayIdx + 0x00, littleEndian);
        const stride = view.getUint32(vertexBufferStateInfoArrayIdx + 0x00, littleEndian);
        const divisor = view.getUint32(vertexBufferStateInfoArrayIdx + 0x04, littleEndian);
        const vertexBufferData = memoryPoolBuffer.subarray(memoryPoolRunningOffset, vertexBufferSize);
        vertexBuffers.push({ data: vertexBufferData, stride, divisor });
        memoryPoolRunningOffset = align(memoryPoolRunningOffset + vertexBufferSize, 8);
        vertexBufferInfoArrayIdx += 0x10;
        vertexBufferStateInfoArrayIdx += 0x10;
    }

    return { vertexAttributes, vertexBuffers };
}

function parseFSHP(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, offs: number, littleEndian: boolean): FSHP {
    const view = buffer.createDataView();

    const name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
    // 0x18 vertex
    const meshArrayOffs = view.getUint32(offs + 0x20, littleEndian);
    // 0x28 skin bone index array
    // 0x30 key shape array
    // 0x38 key shape dict
    const boundingBoxArrayOffs = view.getUint32(offs + 0x40, littleEndian);
    // 0x48 bounding sphere array
    // 0x50 user ptr
    // 0x58 flag
    // 0x5C index
    const materialIndex = view.getUint16(offs + 0x5E, littleEndian);
    const boneIndex = view.getUint16(offs + 0x60, littleEndian);
    const vertexIndex = view.getUint16(offs + 0x62, littleEndian);
    // 0x64 skin bone index count
    // 0x66 vtx skin count
    const meshCount = view.getUint8(offs + 0x67);
    // 0x68 key shape count
    // 0x69 target attr count

    let meshArrayIdx = meshArrayOffs;
    let boundingBoxArrayIdx = boundingBoxArrayOffs;
    const mesh: FSHP_Mesh[] = [];

    const readBBox = () => {
        const centerX = view.getFloat32(boundingBoxArrayIdx + 0x00, littleEndian);
        const centerY = view.getFloat32(boundingBoxArrayIdx + 0x04, littleEndian);
        const centerZ = view.getFloat32(boundingBoxArrayIdx + 0x08, littleEndian);
        const extentX = view.getFloat32(boundingBoxArrayIdx + 0x0C, littleEndian);
        const extentY = view.getFloat32(boundingBoxArrayIdx + 0x10, littleEndian);
        const extentZ = view.getFloat32(boundingBoxArrayIdx + 0x14, littleEndian);
        boundingBoxArrayIdx += 0x18;

        const minX = centerX - extentX, minY = centerY - extentY, minZ = centerZ - extentZ;
        const maxX = centerX + extentX, maxY = centerY + extentY, maxZ = centerZ + extentZ;

        return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
    };

    for (let i = 0; i < meshCount; i++) {
        const subMeshArrayOffs = view.getUint32(meshArrayIdx + 0x00, littleEndian);
        const indexBufferInfo = view.getUint32(meshArrayIdx + 0x18, littleEndian);
        const memoryPoolOffset = view.getUint32(meshArrayIdx + 0x20, littleEndian);
        const primType = view.getUint32(meshArrayIdx + 0x24, littleEndian);
        assert(primType === PrimitiveTopology.TriangleList);
        const indexFormat = view.getUint32(meshArrayIdx + 0x28, littleEndian);
        const count = view.getUint32(meshArrayIdx + 0x2C, littleEndian);
        const offset = view.getUint32(meshArrayIdx + 0x30, littleEndian);
        const subMeshCount = view.getUint16(meshArrayIdx + 0x34, littleEndian);

        const indexBufferSize = view.getUint32(indexBufferInfo + 0x00, littleEndian);
        const indexBufferData = memoryPoolBuffer.subarray(memoryPoolOffset, indexBufferSize);

        let subMeshArrayIdx = subMeshArrayOffs;
        const subMeshes: FSHP_SubMesh[] = [];
        for (let j = 0; j < subMeshCount; j++) {
            const offset = view.getUint32(subMeshArrayIdx + 0x00, littleEndian);
            const count = view.getUint32(subMeshArrayIdx + 0x04, littleEndian);
            const bbox = readBBox();
            subMeshes.push({ offset, count, bbox });
            subMeshArrayIdx += 0x08;
        }
        const bbox = readBBox();

        meshArrayIdx += 0x38;
        mesh.push({ primType, indexFormat, count, offset, subMeshes, indexBufferData, bbox });
    }

    return { name, mesh, vertexIndex, boneIndex, materialIndex };
}

function parseFMAT(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): FMAT {
    const view = buffer.createDataView();

    const name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
    const renderInfoArrayOffs = view.getUint32(offs + 0x18, littleEndian);
    const shaderAssignOffs = view.getUint32(offs + 0x28, littleEndian);
    const textureArrayOffs = view.getUint32(offs + 0x30, littleEndian);
    const textureNameArrayOffs = view.getUint32(offs + 0x38, littleEndian);
    const samplerInfoArrayOffs = view.getUint32(offs + 0x48, littleEndian);
    const samplerInfoDicOffs = view.getUint32(offs + 0x50, littleEndian);
    const shaderParamArrayOffs = view.getUint32(offs + 0x58, littleEndian);
    const srcParamOffs = view.getUint32(offs + 0x68, littleEndian);
    const userDataArrayOffs = view.getUint32(offs + 0x70, littleEndian);
    const flag = view.getUint32(offs + 0xA0, littleEndian);
    const index = view.getUint16(offs + 0xA4, littleEndian);
    const renderInfoCount = view.getUint16(offs + 0xA6, littleEndian);
    const samplerCount = view.getUint8(offs + 0xA8);
    const textureCount = view.getUint8(offs + 0xA9);
    const shaderParamCount = view.getUint16(offs + 0xAA, littleEndian);
    const shaderParamVolatileCount = view.getUint16(offs + 0xAC, littleEndian);
    const srcParamSize = view.getUint16(offs + 0xAE, littleEndian);
    const rawParamSize = view.getUint16(offs + 0xB0, littleEndian);
    const userDataCount = view.getUint16(offs + 0xB2, littleEndian);

    // RenderInfo
    let renderInfoArrayIdx = renderInfoArrayOffs;
    const renderInfo = new Map<string, FMAT_RenderInfo>();
    for (let i = 0; i < renderInfoCount; i++) {
        const name = readBinStr(buffer, view.getUint32(renderInfoArrayIdx + 0x00, littleEndian), littleEndian);
        const arrayOffs = view.getUint32(renderInfoArrayIdx + 0x08, littleEndian);
        const arrayLength = view.getUint16(renderInfoArrayIdx + 0x10, littleEndian);
        const type: FMAT_RenderInfoType = view.getUint8(renderInfoArrayIdx + 0x12);

        if (type === FMAT_RenderInfoType.Int) {
            const values: number[] = [];
            for (let i = 0; i < arrayLength; i++)
                values.push(view.getInt32(arrayOffs + i * 0x04, littleEndian));
            renderInfo.set(name, { type, values });
        } else if (type === FMAT_RenderInfoType.Float) {
            const values: number[] = [];
            for (let i = 0; i < arrayLength; i++)
                values.push(view.getFloat32(arrayOffs + i * 0x04, littleEndian));
            renderInfo.set(name, { type, values });
        } else if (type === FMAT_RenderInfoType.String) {
            const values: string[] = [];
            for (let i = 0; i < arrayLength; i++)
                values.push(readBinStr(buffer, view.getInt32(arrayOffs + i * 0x08, littleEndian), littleEndian));
            renderInfo.set(name, { type, values });
        }

        renderInfoArrayIdx += 0x18;
    }

    // ShaderAssign
    let shaderAssign: FMAT_ShaderAssign;
    {
        const shaderArchiveName = readBinStr(buffer, view.getUint32(shaderAssignOffs + 0x00, littleEndian), littleEndian);
        const shadingModelName = readBinStr(buffer, view.getUint32(shaderAssignOffs + 0x08, littleEndian), littleEndian);

        let attrAssignArrayIdx = view.getUint32(shaderAssignOffs + 0x10, littleEndian);
        let attrAssignDictIdx = view.getUint32(shaderAssignOffs + 0x18, littleEndian);
        let samplerAssignArrayIdx = view.getUint32(shaderAssignOffs + 0x20, littleEndian);
        let samplerAssignDictIdx = view.getUint32(shaderAssignOffs + 0x28, littleEndian);
        let shaderOptionArrayIdx = view.getUint32(shaderAssignOffs + 0x30, littleEndian);
        let shaderOptionDictIdx = view.getUint32(shaderAssignOffs + 0x38, littleEndian);
        const revision = view.getUint32(shaderAssignOffs + 0x40, littleEndian);
        const attrAssignCount = view.getUint8(shaderAssignOffs + 0x44);
        const samplerAssignCount = view.getUint8(shaderAssignOffs + 0x45);
        const shaderOptionCount = view.getUint16(shaderAssignOffs + 0x46, littleEndian);

        attrAssignDictIdx += 0x18;
        const attrAssign = new Map<string, string>();
        for (let i = 0; i < attrAssignCount; i++) {
            const name = readBinStr(buffer, view.getUint32(attrAssignDictIdx + 0x08, littleEndian), littleEndian);
            const value = readBinStr(buffer, view.getUint32(attrAssignArrayIdx + 0x00, littleEndian), littleEndian);
            attrAssign.set(name, value);
            attrAssignDictIdx += 0x10;
            attrAssignArrayIdx += 0x08;
        }

        samplerAssignDictIdx += 0x18;
        const samplerAssign = new Map<string, string>();
        for (let i = 0; i < samplerAssignCount; i++) {
            const name = readBinStr(buffer, view.getUint32(samplerAssignDictIdx + 0x08, littleEndian), littleEndian);
            const value = readBinStr(buffer, view.getUint32(samplerAssignArrayIdx + 0x00, littleEndian), littleEndian);
            assert(!samplerAssign.has(name));
            samplerAssign.set(name, value);
            samplerAssignDictIdx += 0x10;
            samplerAssignArrayIdx += 0x08;
        }

        shaderOptionDictIdx += 0x18;
        const shaderOption = new Map<string, string>();
        for (let i = 0; i < shaderOptionCount; i++) {
            const name = readBinStr(buffer, view.getUint32(shaderOptionDictIdx + 0x08, littleEndian), littleEndian);
            const value = readBinStr(buffer, view.getUint32(shaderOptionArrayIdx + 0x00, littleEndian), littleEndian);
            shaderOption.set(name, value);
            shaderOptionDictIdx += 0x10;
            shaderOptionArrayIdx += 0x08;
        }

        shaderAssign = { shaderArchiveName, shadingModelName, revision, attrAssign, samplerAssign, shaderOption };
    }

    // TextureName
    let textureNameArrayIdx = textureNameArrayOffs;
    const textureName: string[] = [];
    for (let i = 0; i < textureCount; i++) {
        textureName.push(readBinStr(buffer, view.getUint32(textureNameArrayIdx + 0x00, littleEndian), littleEndian));
        textureNameArrayIdx += 0x08;
    }

    // SamplerInfo
    let samplerInfoArrayIdx = samplerInfoArrayOffs;
    let samplerInfoDicIdx = samplerInfoDicOffs + 0x18;
    const samplerInfo: FMAT_SamplerInfo[] = [];
    for (let i = 0; i < samplerCount; i++) {
        const name = readBinStr(buffer, view.getUint32(samplerInfoDicIdx + 0x08, littleEndian), littleEndian);
        const addrModeU: TextureAddressMode = view.getUint8(samplerInfoArrayIdx + 0x00);
        const addrModeV: TextureAddressMode = view.getUint8(samplerInfoArrayIdx + 0x01);
        const addrModeW: TextureAddressMode = view.getUint8(samplerInfoArrayIdx + 0x02);
        // Comparison mode, only used for shadow sampler types I believe...
        // Border color type
        const maxAnistropy = view.getUint8(samplerInfoArrayIdx + 0x05);
        const filterMode: FilterMode = view.getUint16(samplerInfoArrayIdx + 0x06, littleEndian);
        const minLOD = view.getFloat32(samplerInfoArrayIdx + 0x08, littleEndian);
        const maxLOD = view.getFloat32(samplerInfoArrayIdx + 0x0C, littleEndian);
        const lodBias = view.getFloat32(samplerInfoArrayIdx + 0x10, littleEndian);
        samplerInfoArrayIdx += 0x20;
        samplerInfoDicIdx += 0x10;
        samplerInfo.push({ name, addrModeU, addrModeV, addrModeW, filterMode, minLOD, maxLOD, lodBias });
    }

    // ShaderParam
    let shaderParamArrayIdx = shaderParamArrayOffs;
    const shaderParam: FMAT_ShaderParam[] = [];
    for (let i = 0; i < shaderParamCount; i++) {
        const name = readBinStr(buffer, view.getUint32(shaderParamArrayIdx + 0x08, littleEndian), littleEndian);
        const type = view.getUint8(shaderParamArrayIdx + 0x10);
        const srcSize = view.getUint8(shaderParamArrayIdx + 0x11);
        const srcOffset = view.getUint16(shaderParamArrayIdx + 0x12, littleEndian);
        const offset = view.getUint32(shaderParamArrayIdx + 0x14, littleEndian);
        shaderParam.push({ name, type, srcSize, srcOffset, offset });
        shaderParamArrayIdx += 0x20;
    }

    return { name, renderInfo, shaderAssign, textureName, samplerInfo, shaderParam };
}

function parseFMDL(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, offs: number, littleEndian: boolean): FMDL {
    const view = buffer.createDataView();

    const name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
    const skeletonOffs = view.getUint32(offs + 0x20, littleEndian);
    const vertexArrayOffs = view.getUint32(offs + 0x28, littleEndian);
    const shapeArrayOffs = view.getUint32(offs + 0x30, littleEndian);
    const shapeDicOffs = view.getUint32(offs + 0x38, littleEndian);
    const materialArrayOffs = view.getUint32(offs + 0x40, littleEndian);
    const materialDicOffs = view.getUint32(offs + 0x48, littleEndian);
    const userDataArrayOffs = view.getUint32(offs + 0x50, littleEndian);
    const userDataDicOffs = view.getUint32(offs + 0x58, littleEndian);

    const userDataPtr = view.getUint32(offs + 0x60, littleEndian);
    const vertexCount = view.getUint16(offs + 0x68, littleEndian);
    const shapeCount = view.getUint16(offs + 0x6A, littleEndian);
    const materialCount = view.getUint16(offs + 0x6C, littleEndian);
    const userDataCount = view.getUint16(offs + 0x6E, littleEndian);
    const totalProcessVertex = view.getUint32(offs + 0x70, littleEndian);
    // Reserved.

    const fskl: FSKL = parseFSKL(buffer, skeletonOffs, littleEndian);

    let vertexArrayIdx = vertexArrayOffs;
    const fvtx: FVTX[] = [];
    for (let i = 0; i < vertexCount; i++) {
        assert(readString(buffer, vertexArrayIdx + 0x00, 0x04) === 'FVTX');
        const fvtx_ = parseFVTX(buffer, memoryPoolBuffer, vertexArrayIdx, littleEndian);
        fvtx.push(fvtx_);
        vertexArrayIdx += 0x60;
    }

    let shapeArrayIdx = shapeArrayOffs;
    const fshp: FSHP[] = [];
    for (let i = 0; i < shapeCount; i++) {
        assert(readString(buffer, shapeArrayIdx + 0x00, 0x04) === 'FSHP');
        const fshp_ = parseFSHP(buffer, memoryPoolBuffer, shapeArrayIdx, littleEndian);
        fshp.push(fshp_);
        shapeArrayIdx += 0x70;
    }

    let materialArrayIdx = materialArrayOffs;
    const fmat: FMAT[] = [];
    for (let i = 0; i < materialCount; i++) {
        assert(readString(buffer, materialArrayIdx + 0x00, 0x04) === 'FMAT');
        const fmat_ = parseFMAT(buffer, materialArrayIdx, littleEndian);
        fmat.push(fmat_);
        materialArrayIdx += 0xB8;
    }

    return { name, fskl, fvtx, fshp, fmat };
}

export function isMarkerLittleEndian(marker: number): boolean {
    if (marker === 0xFFFE)
        return true;
    else if (marker === 0xFEFF)
        return false;
    else
        throw "whoops";
}

export function parse(buffer: ArrayBufferSlice): FRES {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x08) === 'FRES    ');
    const littleEndian: boolean = isMarkerLittleEndian(view.getUint16(0x0C, false));

    const version = view.getUint32(0x08, littleEndian);
    const supportedVersions: number[] = [
        0x00080000, // Super Mario Odyssey
        0x00050003,
    ];
    assert(supportedVersions.includes(version));

    const fileNameOffs = view.getUint16(0x20, littleEndian);
    const fileName = readBinStr(buffer, fileNameOffs, littleEndian);

    function parseResDicIdx(idx: number): { names: string[], arrayOffs: number } {
        const arrayOffs = view.getUint32(0x28 + idx * 0x10, littleEndian);
        const resDicOffs = view.getUint32(0x30 + idx * 0x10, littleEndian);

        const names: string[] = [];
        if (resDicOffs === 0)
            return { names, arrayOffs };

        // Signature
        assert(view.getUint32(resDicOffs + 0x00, littleEndian) === 0x00000000);
        const tableCount = view.getUint32(resDicOffs + 0x04, littleEndian);

        let resDicTableIdx = resDicOffs + 0x18;
        for (let i = 0; i < tableCount; i++) {
            // There's a fancy search tree in here which I don't care about at all...
            names.push(readBinStr(buffer, view.getUint32(resDicTableIdx + 0x08, littleEndian), littleEndian));
            resDicTableIdx += 0x10;
        }
        return { names, arrayOffs };
    }

    // First, read our memory pool info. This stores our buffers.
    const memoryPoolInfoOffs = view.getUint32(0x90, littleEndian);
    const memoryPoolSize = memoryPoolInfoOffs !== 0 ? view.getUint32(memoryPoolInfoOffs + 0x04, littleEndian) : 0;
    const memoryPoolDataOffs = memoryPoolInfoOffs !== 0 ? view.getUint32(memoryPoolInfoOffs + 0x08, littleEndian) : 0;
    const memoryPoolBuffer = memoryPoolInfoOffs !== 0 ? buffer.subarray(memoryPoolDataOffs, memoryPoolSize) : null;

    const fmdlTable = parseResDicIdx(0x00);
    let fmdlTableIdx = fmdlTable.arrayOffs;
    const fmdl: FMDL[] = [];
    for (let i = 0; i < fmdlTable.names.length; i++) {
        const name = fmdlTable.names[i];
        assert(readString(buffer, fmdlTableIdx + 0x00, 0x04) === 'FMDL');
        const fmdl_ = parseFMDL(buffer, memoryPoolBuffer!, fmdlTableIdx, littleEndian);
        assert(fmdl_.name === name);
        fmdl.push(fmdl_);
        fmdlTableIdx += 0x78;
    }

    const externalFilesTable = parseResDicIdx(0x07);
    const externalFiles: ExternalFile[] = [];
    let externalFilesTableIdx = externalFilesTable.arrayOffs;
    for (let i = 0; i < externalFilesTable.names.length; i++) {
        const name = externalFilesTable.names[i];
        const offs = view.getUint32(externalFilesTableIdx + 0x00, littleEndian);
        const size = view.getUint32(externalFilesTableIdx + 0x08, littleEndian);
        const fileBuffer = buffer.subarray(offs, size);
        externalFiles.push({ name, buffer: fileBuffer });
        externalFilesTableIdx += 0x10;
    }

    return { fmdl, externalFiles };
}
