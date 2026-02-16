
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString, align } from "../util.js";
import { AttributeFormat, IndexFormat, PrimitiveTopology, TextureAddressMode, FilterMode, CompareMode } from "./nngfx_enum.js";
import { AABB } from "../Geometry.js";
import { vec2, vec3, vec4, mat4 } from "gl-matrix";
import { Color } from "../Color.js";

export interface Version
{
    major: number;
    minor: number;
    micro: number;
}

export interface FSKL_Bone {
    name: string;
    parentIndex: number;
    scale: vec3;
    rotation: vec4;
    translation: vec3;
    userData: Map<string, number[] | string[]>;
}

export interface FSKL {
    bones: FSKL_Bone[];
    smoothRigidIndices: number[];
    boneLocalFromBindPoseMatrices: mat4[];
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
    boundingSphereRadius: number;
}

export interface FSHP {
    name: string;
    mesh: FSHP_Mesh[];
    vertexIndex: number;
    boneIndex: number;
    materialIndex: number;
    skinBoneIndices: number[];
    vertexSkinWeightCount: number;
}

export enum FMAT_RenderInfoType {
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
    compareMode: CompareMode;
    maxAnisotropy: number;
    filterMode: FilterMode;
    minLOD: number;
    maxLOD: number;
    lodBias: number;
}

export enum FMAT_ShaderParamType {
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
    rawData: ArrayBufferSlice;
    littleEndian: boolean;
}

export interface FMAT {
    name: string;
    renderInfo: Map<string, FMAT_RenderInfo>;
    shaderAssign: FMAT_ShaderAssign;
    textureName: string[];
    samplerInfo: FMAT_SamplerInfo[];
    shaderParam: FMAT_ShaderParam[];
    userData: Map<string, number[] | string[]>;
}

export interface FMDL {
    name: string;
    fskl: FSKL;
    fvtx: FVTX[];
    fshp: FSHP[];
    fmat: FMAT[];
    userData: Map<string, number[] | string[]>;
}

export enum CurveType {
    Cubic        = 0,
    Linear       = 1,
    BakedFloat   = 2,
    StepInteger  = 4,
    BakedInteger = 5,
    StepBoolean  = 6,
    BakedBoolean = 1,
}

export interface Curve {
    curveType: CurveType;
    startFrame: number;
    endFrame: number;
    frames: number[];
    keys: number[][];
}

export interface BoneAnimation {
    name: string;
    flags: number;
    initialValues: number[];
    curves: Curve[];
}

export interface FSKA {
    name: string;
    frameCount: number;
    boneAnimations: BoneAnimation[];
}

export interface MaterialAnimation {
    name: string;
    curves: Curve[];
}

export interface FMAA {
    name: string;
    frameCount: number;
    materialAnimations: MaterialAnimation[];
    userData: Map<string, number[] | string[]>;
}

export interface FRES {
    fmdl: FMDL[];
    fska: FSKA[];
    fmaa: FMAA[];
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

function parseFSKL(buffer: ArrayBufferSlice, fresVersion: Version, offs: number, littleEndian: boolean): FSKL {
    const view = buffer.createDataView();

    assert(readString(buffer, offs + 0x00, 0x04) === 'FSKL');

    let boneArrayOffs;
    let smoothRigidIndexArrayOffset;
    let boneLocalFromBindPoseMatrixArrayOffset;
    let flag;
    let boneCount;
    let smoothMtxCount;
    let rigidMtxCount;

    if (fresVersion.major < 9)
    {
        boneArrayOffs = view.getUint32(offs + 0x18, littleEndian);
        smoothRigidIndexArrayOffset = view.getUint32(offs + 0x20, littleEndian);
        boneLocalFromBindPoseMatrixArrayOffset = view.getUint32(offs + 0x28, littleEndian);
        flag = view.getUint32(offs + 0x48, littleEndian);
        boneCount = view.getUint16(offs + 0x4C, littleEndian);
        smoothMtxCount = view.getUint16(offs + 0x4E, littleEndian);
        rigidMtxCount = view.getUint16(offs + 0x50, littleEndian);
    }
    else
    {
        flag = view.getUint32(offs + 0x4, littleEndian);
        boneArrayOffs = view.getUint32(offs + 0x10, littleEndian);
        smoothRigidIndexArrayOffset = view.getUint32(offs + 0x18, littleEndian);
        boneLocalFromBindPoseMatrixArrayOffset = view.getUint32(offs + 0x20, littleEndian);
        boneCount = view.getUint16(offs + 0x38, littleEndian);
        smoothMtxCount = view.getUint16(offs + 0x3A, littleEndian);
        rigidMtxCount = view.getUint16(offs + 0x3C, littleEndian);
    }

    let boneArrayIdx = boneArrayOffs;
    const bones: FSKL_Bone[] = [];
    for (let i = 0; i < boneCount; i++) {
        const name = readBinStr(buffer, view.getUint32(boneArrayIdx + 0x00, littleEndian), littleEndian);
        const userDataArrayOffs = view.getUint32(boneArrayIdx + 0x08, littleEndian);
        const index = view.getUint16(boneArrayIdx + 0x28, littleEndian);
        const parentIndex = view.getInt16(boneArrayIdx + 0x2A, littleEndian);
        const smoothMtxIndex = view.getInt16(boneArrayIdx + 0x2C, littleEndian);
        const rigidMtxIndex = view.getInt16(boneArrayIdx + 0x2E, littleEndian);
        const billboardIndex = view.getInt16(boneArrayIdx + 0x30, littleEndian);
        const userDataCount = view.getInt16(boneArrayIdx + 0x32, littleEndian);
        const boneFlag = view.getUint32(boneArrayIdx + 0x34, littleEndian);

        const scaleX = view.getFloat32(boneArrayIdx + 0x38, littleEndian);
        const scaleY = view.getFloat32(boneArrayIdx + 0x3C, littleEndian);
        const scaleZ = view.getFloat32(boneArrayIdx + 0x40, littleEndian);
        const scale = vec3.fromValues(scaleX, scaleY, scaleZ);

        const rotationX = view.getFloat32(boneArrayIdx + 0x44, littleEndian);
        const rotationY = view.getFloat32(boneArrayIdx + 0x48, littleEndian);
        const rotationZ = view.getFloat32(boneArrayIdx + 0x4C, littleEndian);
        const rotationW = view.getFloat32(boneArrayIdx + 0x50, littleEndian);
        const rotation = vec4.fromValues(rotationX, rotationY, rotationZ, rotationW);

        const translationX = view.getFloat32(boneArrayIdx + 0x54, littleEndian);
        const translationY = view.getFloat32(boneArrayIdx + 0x58, littleEndian);
        const translationZ = view.getFloat32(boneArrayIdx + 0x5C, littleEndian);
        const translation = vec3.fromValues(translationX, translationY, translationZ);

        const userData = parseUserData(buffer, fresVersion, userDataArrayOffs, userDataCount, littleEndian);

        bones.push({ name, parentIndex, scale, rotation, translation, userData });
        boneArrayIdx += 0x60;
    }

    let smoothRigidIndices: number[] = [];
    let smoothRigidIndexArrayIdx = smoothRigidIndexArrayOffset;
    for (let i = 0; i < smoothMtxCount + rigidMtxCount; i++) {
        smoothRigidIndices.push(view.getUint16(smoothRigidIndexArrayIdx, littleEndian));
        smoothRigidIndexArrayIdx += 0x2;
    }

    let boneLocalFromBindPoseMatrices: mat4[] = [];
    let boneLocalFromBindPoseMatrixArrayIdx = boneLocalFromBindPoseMatrixArrayOffset;
    for (let i = 0; i < smoothMtxCount; i++) {
        const m00 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x00, littleEndian);
        const m10 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x04, littleEndian);
        const m20 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x08, littleEndian);
        const m30 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x0C, littleEndian);
        const m01 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x10, littleEndian);
        const m11 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x14, littleEndian);
        const m21 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x18, littleEndian);
        const m31 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x1C, littleEndian);
        const m02 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x20, littleEndian);
        const m12 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x24, littleEndian);
        const m22 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x28, littleEndian);
        const m32 = view.getFloat32(boneLocalFromBindPoseMatrixArrayIdx + 0x2C, littleEndian);
        const matrix = mat4.fromValues(m00, m01, m02, 0.0, m10, m11, m12, 0.0, m20, m21, m22, 0.0, m30, m31, m32, 1.0);

        boneLocalFromBindPoseMatrices.push(matrix);
        boneLocalFromBindPoseMatrixArrayIdx += 0x30;
    }

    return { bones, smoothRigidIndices, boneLocalFromBindPoseMatrices };
}

function parseFVTX(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, fresVersion: Version, offs: number, littleEndian: boolean): FVTX {
    const view = buffer.createDataView();

    let vertexAttrArrayOffs;
    let vertexBufferInfoArrayOffs;
    let vertexBufferStateInfoArrayOffs;
    let memoryPoolOffset;
    let vertexAttrCount;
    let vertexBufferCount;

    if (fresVersion.major < 9) {
        vertexAttrArrayOffs = view.getUint32(offs + 0x10, littleEndian);
        vertexBufferInfoArrayOffs = view.getUint32(offs + 0x38, littleEndian);
        vertexBufferStateInfoArrayOffs = view.getUint32(offs + 0x40, littleEndian);
        memoryPoolOffset = view.getUint32(offs + 0x50, littleEndian);
        vertexAttrCount = view.getUint8(offs + 0x54);
        vertexBufferCount = view.getUint8(offs + 0x55);
    }
    else {
        vertexAttrArrayOffs = view.getUint32(offs + 0x8, littleEndian);
        vertexBufferInfoArrayOffs = view.getUint32(offs + 0x30, littleEndian);
        vertexBufferStateInfoArrayOffs = view.getUint32(offs + 0x38, littleEndian);
        memoryPoolOffset = view.getUint32(offs + 0x48, littleEndian);
        vertexAttrCount = view.getUint8(offs + 0x4C);
        vertexBufferCount = view.getUint8(offs + 0x4D);
    }

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

function parseFSHP(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, fresVersion: Version, offs: number, littleEndian: boolean): FSHP {
    const view = buffer.createDataView();

    let name;
    let meshArrayOffs;
    let skinBoneIndexArrayOffs;
    let boundingBoxArrayOffs;
    let boundingSphereArrayOffs;
    let materialIndex;
    let boneIndex;
    let vertexIndex;
    let skinBoneIndexCount;
    let vertexSkinWeightCount;
    let meshCount;

    if (fresVersion.major < 9)
    {
        name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
        // 0x18 vertex
        meshArrayOffs = view.getUint32(offs + 0x20, littleEndian);
        skinBoneIndexArrayOffs = view.getUint32(offs + 0x28, littleEndian);
        // 0x30 key shape array
        // 0x38 key shape dict
        boundingBoxArrayOffs = view.getUint32(offs + 0x40, littleEndian);
        boundingSphereArrayOffs = view.getUint32(offs + 0x48, littleEndian);
        // 0x50 user ptr
        // 0x58 flag
        // 0x5C index
        materialIndex = view.getUint16(offs + 0x5E, littleEndian);
        boneIndex = view.getUint16(offs + 0x60, littleEndian);
        vertexIndex = view.getUint16(offs + 0x62, littleEndian);
        skinBoneIndexCount = view.getUint16(offs + 0x64, littleEndian);
        vertexSkinWeightCount = view.getUint8(offs + 0x66);
        meshCount = view.getUint8(offs + 0x67);
        // 0x68 key shape count
        // 0x69 target attr count
    }
    else
    {
        name = readBinStr(buffer, view.getUint32(offs + 0x8, littleEndian), littleEndian);

        meshArrayOffs = view.getUint32(offs + 0x18, littleEndian);
        skinBoneIndexArrayOffs = view.getUint32(offs + 0x20, littleEndian);

        boundingBoxArrayOffs = view.getUint32(offs + 0x38, littleEndian);
        boundingSphereArrayOffs = view.getUint32(offs + 0x40, littleEndian);

        materialIndex = view.getUint16(offs + 0x52, littleEndian);
        boneIndex = view.getUint16(offs + 0x54, littleEndian);
        vertexIndex = view.getUint16(offs + 0x56, littleEndian);
        skinBoneIndexCount = view.getUint16(offs + 0x58, littleEndian);
        vertexSkinWeightCount = view.getUint8(offs + 0x5A);
        meshCount = view.getUint8(offs + 0x5B);
    }

    let meshArrayIdx = meshArrayOffs;
    let boundingBoxArrayIdx = boundingBoxArrayOffs;
    let boundingSphereArrayIdx = boundingSphereArrayOffs;
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

        const boundingSphereRadius = view.getFloat32(boundingSphereArrayIdx + 0x0, littleEndian);
        boundingSphereArrayIdx += 0x4;

        meshArrayIdx += 0x38;
        mesh.push({ primType, indexFormat, count, offset, subMeshes, indexBufferData, bbox, boundingSphereRadius });
    }

    let skinBoneIndices: number[] = [];
    let skinBoneIndexArrayIdx = skinBoneIndexArrayOffs;
    for (let i = 0; i < skinBoneIndexCount; i++) {
        skinBoneIndices.push(view.getUint16(skinBoneIndexArrayIdx, littleEndian));
        skinBoneIndexArrayIdx += 0x2;
    }

    return { name, mesh, vertexIndex, boneIndex, materialIndex, skinBoneIndices, vertexSkinWeightCount };
}

export function parseFMAT_ShaderParam_Float(p: FMAT_ShaderParam): number {
    assert(p.type === FMAT_ShaderParamType.Float);
    assert(p.rawData.byteLength === 0x04);
    const view = p.rawData.createDataView();
    return view.getFloat32(0x00, p.littleEndian);
}

export function parseFMAT_ShaderParam_Float2(dst: vec2, p: FMAT_ShaderParam): void {
    assert(p.type === FMAT_ShaderParamType.Float2);
    assert(p.rawData.byteLength === 0x08);
    const view = p.rawData.createDataView();
    dst[0] = view.getFloat32(0x00, p.littleEndian);
    dst[1] = view.getFloat32(0x04, p.littleEndian);
}

export function parseFMAT_ShaderParam_Float4(dst: vec4, p: FMAT_ShaderParam): void {
    assert(p.type === FMAT_ShaderParamType.Float4);
    assert(p.rawData.byteLength === 0x10);
    const view = p.rawData.createDataView();
    dst[0] = view.getFloat32(0x00, p.littleEndian);
    dst[1] = view.getFloat32(0x04, p.littleEndian);
    dst[2] = view.getFloat32(0x08, p.littleEndian);
    dst[3] = view.getFloat32(0x0C, p.littleEndian);
}

export function parseFMAT_ShaderParam_Color3(dst: Color, p: FMAT_ShaderParam): void {
    assert(p.type === FMAT_ShaderParamType.Float3);
    assert(p.rawData.byteLength === 0x0C);
    const view = p.rawData.createDataView();
    dst.r = view.getFloat32(0x00, p.littleEndian);
    dst.g = view.getFloat32(0x04, p.littleEndian);
    dst.b = view.getFloat32(0x08, p.littleEndian);
}

interface Texsrt {
    mode: number;
    scaleS: number;
    scaleT: number;
    rotation: number;
    translationS: number;
    translationT: number;
}

export function parseFMAT_ShaderParam_Texsrt(dst: Texsrt, p: FMAT_ShaderParam): void {
    assert(p.type === FMAT_ShaderParamType.Texsrt);
    assert(p.rawData.byteLength === 0x18);
    const view = p.rawData.createDataView();
    dst.mode = view.getUint32(0x00, p.littleEndian);
    dst.scaleS = view.getFloat32(0x04, p.littleEndian);
    dst.scaleT = view.getFloat32(0x08, p.littleEndian);
    dst.rotation = view.getFloat32(0x0C, p.littleEndian);
    dst.translationS = view.getFloat32(0x10, p.littleEndian);
    dst.translationT = view.getFloat32(0x14, p.littleEndian);
}

function parseFMAT(buffer: ArrayBufferSlice, fresVersion: Version, offs: number, littleEndian: boolean): FMAT {
    const view = buffer.createDataView();

    let name;
    let renderInfoArrayOffs;
    let shaderAssignOffs;
    let textureArrayOffs;
    let textureNameArrayOffs;
    let samplerInfoArrayOffs;
    let samplerInfoDicOffs;
    let shaderParamArrayOffs;
    let srcParamOffs;
    let userDataArrayOffs;
    let flag;
    let index;
    let renderInfoCount;
    let samplerCount;
    let textureCount;
    let shaderParamCount;
    let shaderParamVolatileCount;
    let srcParamSize;
    let rawParamSize;
    let userDataCount;

    if (fresVersion.major < 9)
    {
        name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
        renderInfoArrayOffs = view.getUint32(offs + 0x18, littleEndian);
        shaderAssignOffs = view.getUint32(offs + 0x28, littleEndian);
        textureArrayOffs = view.getUint32(offs + 0x30, littleEndian);
        textureNameArrayOffs = view.getUint32(offs + 0x38, littleEndian);
        samplerInfoArrayOffs = view.getUint32(offs + 0x48, littleEndian);
        samplerInfoDicOffs = view.getUint32(offs + 0x50, littleEndian);
        shaderParamArrayOffs = view.getUint32(offs + 0x58, littleEndian);
        srcParamOffs = view.getUint32(offs + 0x68, littleEndian);
        userDataArrayOffs = view.getUint32(offs + 0x70, littleEndian);
        flag = view.getUint32(offs + 0xA0, littleEndian);
        index = view.getUint16(offs + 0xA4, littleEndian);
        renderInfoCount = view.getUint16(offs + 0xA6, littleEndian);
        samplerCount = view.getUint8(offs + 0xA8);
        textureCount = view.getUint8(offs + 0xA9);
        shaderParamCount = view.getUint16(offs + 0xAA, littleEndian);
        shaderParamVolatileCount = view.getUint16(offs + 0xAC, littleEndian);
        srcParamSize = view.getUint16(offs + 0xAE, littleEndian);
        rawParamSize = view.getUint16(offs + 0xB0, littleEndian);
        userDataCount = view.getUint16(offs + 0xB2, littleEndian);
    }
    else
    {
        name = readBinStr(buffer, view.getUint32(offs + 0x8, littleEndian), littleEndian);
        renderInfoArrayOffs = view.getUint32(offs + 0x10, littleEndian);
        shaderAssignOffs = view.getUint32(offs + 0x20, littleEndian);
        textureArrayOffs = view.getUint32(offs + 0x28, littleEndian);
        textureNameArrayOffs = view.getUint32(offs + 0x30, littleEndian);
        samplerInfoArrayOffs = view.getUint32(offs + 0x40, littleEndian);
        samplerInfoDicOffs = view.getUint32(offs + 0x48, littleEndian);
        shaderParamArrayOffs = view.getUint32(offs + 0x58, littleEndian);
        srcParamOffs = view.getUint32(offs + 0x60, littleEndian);
        userDataArrayOffs = view.getUint32(offs + 0x68, littleEndian);
        index = view.getUint16(offs + 0x98, littleEndian);
        renderInfoCount = view.getUint16(offs + 0x9A, littleEndian);
        samplerCount = view.getUint8(offs + 0x9C);
        textureCount = view.getUint8(offs + 0x9D);
        shaderParamCount = view.getUint16(offs + 0x9E, littleEndian);
        shaderParamVolatileCount = view.getUint16(offs + 0xA0, littleEndian);
        srcParamSize = view.getUint16(offs + 0xA2, littleEndian);
        rawParamSize = view.getUint16(offs + 0xA4, littleEndian);
        userDataCount = view.getUint16(offs + 0xA6, littleEndian);
    }

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
            assert(!attrAssign.has(name));
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
        const compareMode: CompareMode = view.getUint8(samplerInfoArrayIdx + 0x3);
        // Border color type
        const maxAnisotropy = view.getUint8(samplerInfoArrayIdx + 0x05);
        const filterMode: FilterMode = view.getUint16(samplerInfoArrayIdx + 0x06, littleEndian);
        const minLOD = view.getFloat32(samplerInfoArrayIdx + 0x08, littleEndian);
        const maxLOD = view.getFloat32(samplerInfoArrayIdx + 0x0C, littleEndian);
        const lodBias = view.getFloat32(samplerInfoArrayIdx + 0x10, littleEndian);
        samplerInfoArrayIdx += 0x20;
        samplerInfoDicIdx += 0x10;
        samplerInfo.push({ name, addrModeU, addrModeV, addrModeW, compareMode, maxAnisotropy, filterMode, minLOD, maxLOD, lodBias });
    }

    // ShaderParam
    let shaderParamArrayIdx = shaderParamArrayOffs;
    const shaderParam: FMAT_ShaderParam[] = [];
    for (let i = 0; i < shaderParamCount; i++) {
        const name = readBinStr(buffer, view.getUint32(shaderParamArrayIdx + 0x08, littleEndian), littleEndian);
        const type: FMAT_ShaderParamType = view.getUint8(shaderParamArrayIdx + 0x10);
        const srcSize = view.getUint8(shaderParamArrayIdx + 0x11);
        const srcOffset = view.getUint16(shaderParamArrayIdx + 0x12, littleEndian);
        const rawData = buffer.subarray(srcParamOffs + srcOffset, srcSize);
        shaderParam.push({ name, type, rawData, littleEndian });
        shaderParamArrayIdx += 0x20;
    }

    const userData = parseUserData(buffer, fresVersion, userDataArrayOffs, userDataCount, littleEndian);

    return { name, renderInfo, shaderAssign, textureName, samplerInfo, shaderParam, userData };
}

function parseUserData(buffer: ArrayBufferSlice, fresVersion: Version, offs: number, count: number, littleEndian: boolean): Map<string, number[] | string[]> {
    const view = buffer.createDataView();
    let userData = new Map<string, number[] | string[]>();

    let userDataArrayIdx = offs;
    for (let i = 0; i < count; i++) {
        const keyOffset = view.getUint32(userDataArrayIdx + 0x0, littleEndian);
        const key = readBinStr(buffer, keyOffset, littleEndian);
        const dataOffset = view.getUint32(userDataArrayIdx + 0x8, littleEndian);
        const dataCount = view.getUint32(userDataArrayIdx + 0x10, littleEndian);
        const dataType: Type = view.getUint8(userDataArrayIdx + 0x14);

        enum Type {
            S32, F32, String, U8,
        }

        let values: number[] | string[] = [];
        switch (dataType) {
            case Type.S32:
                let s32Values: number[] = [];
                for (let dataIndex = 0; dataIndex < dataCount; dataIndex++) {
                    s32Values.push(view.getInt32(dataOffset + (dataIndex * 0x4), littleEndian));
                }
                values = s32Values;
                break;
            
            case Type.F32:
                let f32Values: number[] = [];
                for (let dataIndex = 0; dataIndex < dataCount; dataIndex++) {
                    f32Values.push(view.getFloat32(dataOffset + (dataIndex * 0x4), littleEndian));
                }
                values = f32Values;
                break;
            
            case Type.String:
                let stringValues: string[] = [];
                for (let dataIndex = 0; dataIndex < dataCount; dataIndex++) {
                    const stringOffset = view.getUint32(dataOffset + (dataIndex * 0x8), littleEndian);
                    const string = readBinStr(buffer, stringOffset, littleEndian);
                    stringValues.push(string);
                }
                values = stringValues;
                break;
            
            case Type.U8:
                let u8Values: number[] = [];
                for (let dataIndex = 0; dataIndex < dataCount; dataIndex++) {
                    u8Values.push(view.getUint8(dataOffset + (dataIndex * 0x1)));
                }
                values = u8Values;
                break;
        }

        userData.set(key, values);
        userDataArrayIdx += 0x40;
    }

    return userData
}

function parseFMDL(buffer: ArrayBufferSlice, memoryPoolBuffer: ArrayBufferSlice, fresVersion: Version, offs: number, littleEndian: boolean): FMDL {
    const view = buffer.createDataView();

    let name;
    let skeletonOffs;
    let vertexArrayOffs;
    let shapeArrayOffs;
    let shapeDicOffs;
    let materialArrayOffs;
    let materialDicOffs;
    let userDataArrayOffs;
    let userDataDicOffs;
    let userDataPtr;
    let vertexCount;
    let shapeCount;
    let materialCount;
    let userDataCount;
    let totalProcessVertex;

    if (fresVersion.major < 9) {
        name = readBinStr(buffer, view.getUint32(offs + 0x10, littleEndian), littleEndian);
        skeletonOffs = view.getUint32(offs + 0x20, littleEndian);
        vertexArrayOffs = view.getUint32(offs + 0x28, littleEndian);
        shapeArrayOffs = view.getUint32(offs + 0x30, littleEndian);
        shapeDicOffs = view.getUint32(offs + 0x38, littleEndian);
        materialArrayOffs = view.getUint32(offs + 0x40, littleEndian);
        materialDicOffs = view.getUint32(offs + 0x48, littleEndian);
        userDataArrayOffs = view.getUint32(offs + 0x50, littleEndian);
        userDataDicOffs = view.getUint32(offs + 0x58, littleEndian);
        userDataPtr = view.getUint32(offs + 0x60, littleEndian);
        vertexCount = view.getUint16(offs + 0x68, littleEndian);
        shapeCount = view.getUint16(offs + 0x6A, littleEndian);
        materialCount = view.getUint16(offs + 0x6C, littleEndian);
        userDataCount = view.getUint16(offs + 0x6E, littleEndian);
        totalProcessVertex = view.getUint32(offs + 0x70, littleEndian);
        // Reserved.
    }
    else {
        name = readBinStr(buffer, view.getUint32(offs + 0x8, littleEndian), littleEndian);
        skeletonOffs = view.getUint32(offs + 0x18, littleEndian);
        vertexArrayOffs = view.getUint32(offs + 0x20, littleEndian);
        shapeArrayOffs = view.getUint32(offs + 0x28, littleEndian);
        shapeDicOffs = view.getUint32(offs + 0x30, littleEndian);
        materialArrayOffs = view.getUint32(offs + 0x38, littleEndian);
        materialDicOffs = view.getUint32(offs + 0x48, littleEndian);
        userDataArrayOffs = view.getUint32(offs + 0x50, littleEndian);
        userDataDicOffs = view.getUint32(offs + 0x58, littleEndian);
        userDataPtr = view.getUint32(offs + 0x60, littleEndian);
        vertexCount = view.getUint16(offs + 0x68, littleEndian);
        shapeCount = view.getUint16(offs + 0x6A, littleEndian);
        materialCount = view.getUint16(offs + 0x6C, littleEndian);
        userDataCount = view.getUint16(offs + 0x70, littleEndian);
    }

    const fskl: FSKL = parseFSKL(buffer, fresVersion, skeletonOffs, littleEndian);

    let vertexArrayIdx = vertexArrayOffs;
    const fvtx: FVTX[] = [];
    for (let i = 0; i < vertexCount; i++) {
        assert(readString(buffer, vertexArrayIdx + 0x00, 0x04) === 'FVTX');
        const fvtx_ = parseFVTX(buffer, memoryPoolBuffer, fresVersion, vertexArrayIdx, littleEndian);
        fvtx.push(fvtx_);
        if (fresVersion.major < 9) {
            vertexArrayIdx += 0x60;
        }
        else {
            vertexArrayIdx += 0x58;
        }
    }

    let shapeArrayIdx = shapeArrayOffs;
    const fshp: FSHP[] = [];
    for (let i = 0; i < shapeCount; i++) {
        assert(readString(buffer, shapeArrayIdx + 0x00, 0x04) === 'FSHP');
        const fshp_ = parseFSHP(buffer, memoryPoolBuffer, fresVersion, shapeArrayIdx, littleEndian);
        fshp.push(fshp_);
        if (fresVersion.major < 9) {
            shapeArrayIdx += 0x70;
        }
        else {
            shapeArrayIdx += 0x60;
        }
    }

    let materialArrayIdx = materialArrayOffs;
    const fmat: FMAT[] = [];
    for (let i = 0; i < materialCount; i++) {
        assert(readString(buffer, materialArrayIdx + 0x00, 0x04) === 'FMAT');
        const fmat_ = parseFMAT(buffer, fresVersion, materialArrayIdx, littleEndian);
        fmat.push(fmat_);
        if (fresVersion.major < 9) {
            materialArrayIdx += 0xB8;
        }
        else {
            materialArrayIdx += 0xA8;
        }
    }

    const userData = parseUserData(buffer, fresVersion, userDataArrayOffs, userDataCount, littleEndian);

    return { name, fskl, fvtx, fshp, fmat, userData };
}

function parseCurves(buffer: ArrayBufferSlice, fresVersion: Version, offset: number, count: number, littleEndian: boolean): Curve[] {
    const view = buffer.createDataView();

    let curves: Curve[] = [];
    let curveEntryOffset = offset;
    for (let curveIndex = 0; curveIndex < count; curveIndex++) {
        const frameArrayOffset = view.getUint32(curveEntryOffset + 0x0, littleEndian);
        const keyArrayOffset = view.getUint32(curveEntryOffset + 0x8, littleEndian);
        const flags = view.getUint16(curveEntryOffset + 0x10, littleEndian);
        const keyframeCount = view.getUint16(curveEntryOffset + 0x12, littleEndian);
        const startFrame = view.getFloat32(curveEntryOffset + 0x18, littleEndian);
        const endFrame = view.getFloat32(curveEntryOffset + 0x1C, littleEndian);
        const dataScale = view.getFloat32(curveEntryOffset + 0x20, littleEndian);
        const dataOffset = view.getFloat32(curveEntryOffset + 0x24, littleEndian);

        enum FrameType {
            F32, FixedPoint10x5, U8,
        }

        const frameType: FrameType = flags & 0x3;

        let frames: number[] = [];
        let frameEntryOffset = frameArrayOffset;
        for (let i = 0; i < keyframeCount; i++) {
            switch(frameType) {
                case FrameType.F32:
                    frames.push(view.getFloat32(frameEntryOffset, littleEndian));
                    frameEntryOffset += 0x4;
                    break;

                case FrameType.FixedPoint10x5:
                    let frame = view.getInt16(frameEntryOffset, littleEndian);
                    frame = frame / 32;
                    frames.push(frame);
                    frameEntryOffset += 0x2;
                    break;

                case FrameType.U8:
                    frames.push(view.getUint8(frameEntryOffset));
                    frameEntryOffset += 0x1;
                    break;

                default:
                    console.error(`Unknown frame type ${frameType}`);
                    throw("whoops");
            }
        }

        const curveType: CurveType = (flags >> 0x4) & 0x7;

        let valuesPerKey: number;
        switch(curveType) {
            case CurveType.Cubic:
                valuesPerKey = 4;
                break;
            
            case CurveType.Linear:
                valuesPerKey = 2;
                break;

            case CurveType.BakedFloat:
            case CurveType.StepInteger:
            case CurveType.BakedInteger:
                valuesPerKey = 1;
                break;

            default:
                console.error(`Unsupported curve type ${curveType}`);
                throw("whoops");
        }

        enum KeyType {
            F32, S16, S8,
        }

        const keyType: KeyType = (flags >> 0x2) & 0x3;

        let keys: number[][] = [];
        let keyEntryOffset = keyArrayOffset;
        for (let i = 0; i < keyframeCount; i++) {
            let values: number[] = [];

            for (let j = 0; j < valuesPerKey; j++) {
                let value;

                switch(keyType) {
                    case KeyType.F32:
                        value = view.getFloat32(keyEntryOffset, littleEndian);
                        keyEntryOffset += 0x4;
                        break;

                    case KeyType.S16:
                        value = view.getInt16(keyEntryOffset, littleEndian);
                        keyEntryOffset += 0x2;
                        break;

                    case KeyType.S8:
                        value = view.getInt8(keyEntryOffset);
                        keyEntryOffset += 0x1;
                        break;

                    default:
                        console.error(`Unknown key type ${keyType}`);
                        throw("whoops");
                }

                if (curveType === CurveType.Cubic || curveType === CurveType.Linear) {
                    value *= dataScale;
                    if (j === 0) {
                        value += dataOffset;
                    }
                }

                values.push(value);
            }

            keys.push(values);
        }

        curves.push({ curveType, startFrame, endFrame, frames, keys });
        curveEntryOffset += 0x30;
    }

    return curves;
}

function parseFSKA(buffer: ArrayBufferSlice, fresVersion: Version, offset: number, littleEndian: boolean): FSKA {
    const view = buffer.createDataView();

    let name;
    let boneAnimationArrayOffset;
    let frameCount;
    let boneAnimationCount;

    if (fresVersion.major < 9) {
        name = readBinStr(buffer, view.getUint32(offset + 0x10, littleEndian), littleEndian);
        boneAnimationArrayOffset = view.getUint32(offset + 0x30, littleEndian);
        frameCount = view.getUint32(offset + 0x4C, littleEndian);
        boneAnimationCount = view.getUint16(offset + 0x58, littleEndian);
    }
    else {
        name = readBinStr(buffer, view.getUint32(offset + 0x8, littleEndian), littleEndian);
        boneAnimationArrayOffset = view.getUint32(offset + 0x28, littleEndian);
        frameCount = view.getUint32(offset + 0x40, littleEndian);
        boneAnimationCount = view.getUint16(offset + 0x4C, littleEndian);
    }

    let boneAnimations: BoneAnimation[] = [];
    let boneAnimationEntryOffset = boneAnimationArrayOffset;
    for (let boneAnimationIndex = 0; boneAnimationIndex < boneAnimationCount; boneAnimationIndex++) {
        const name = readBinStr(buffer, view.getUint32(boneAnimationEntryOffset + 0x0, littleEndian), littleEndian);
        const curveArrayOffset = view.getUint32(boneAnimationEntryOffset + 0x8, littleEndian);
        const initialValueArrayOffset = view.getUint32(boneAnimationEntryOffset + 0x10, littleEndian);
        let flags;
        let curveCount;

        if (fresVersion.major < 9) {
            flags = view.getUint32(boneAnimationEntryOffset + 0x18, littleEndian);
            curveCount = view.getUint8(boneAnimationEntryOffset + 0x1E);
        }
        else {
            flags = view.getUint32(boneAnimationEntryOffset + 0x28, littleEndian);
            curveCount = view.getUint8(boneAnimationEntryOffset + 0x2E);
        }

        let initialValues: number[] = [];
        let initialValuesEntryOffset = initialValueArrayOffset;
        for (let i = 0; i < 10; i++)
        {
            initialValues.push(view.getFloat32(initialValuesEntryOffset, littleEndian));
            initialValuesEntryOffset += 0x4;
        }

        const curves = parseCurves(buffer, fresVersion, curveArrayOffset, curveCount, littleEndian);

        boneAnimations.push ({ name, flags, initialValues, curves });
        if (fresVersion.major < 9) {
            boneAnimationEntryOffset += 0x28;
        }
        else {
            boneAnimationEntryOffset += 0x38;
        }
    }

    return { name, frameCount, boneAnimations };
}

function parseFMAA(buffer: ArrayBufferSlice, fresVersion: Version, offset: number, littleEndian: boolean): FMAA {
    const view = buffer.createDataView();

    let name;
    let materialAnimationArrayOffset;
    let userDataArrayOffset;
    let userDataResDicOffset;
    let frameCount;
    let userDataCount;
    let materialAnimationCount;

    if (fresVersion.major < 9) {
        name = readBinStr(buffer, view.getUint32(offset + 0x10, littleEndian), littleEndian);
        materialAnimationArrayOffset = view.getUint32(offset + 0x30, littleEndian);
        userDataArrayOffset = view.getUint32(offset + 0x48, littleEndian);
        userDataResDicOffset = view.getUint32(offset + 0x50, littleEndian);
        userDataCount = view.getUint16(offset + 0x62, littleEndian);
        materialAnimationCount = view.getUint16(offset + 0x64, littleEndian);
        frameCount = view.getUint32(offset + 0x68, littleEndian);
    }
    else {
        name = readBinStr(buffer, view.getUint32(offset + 0x8, littleEndian), littleEndian);
        materialAnimationArrayOffset = view.getUint32(offset + 0x28, littleEndian);
        userDataArrayOffset = view.getUint32(offset + 0x40, littleEndian);
        userDataResDicOffset = view.getUint32(offset + 0x48, littleEndian);
        frameCount = view.getUint32(offset + 0x58, littleEndian);
        userDataCount = view.getUint16(offset + 0x60, littleEndian);
        materialAnimationCount = view.getUint16(offset + 0x62, littleEndian);
    }

    let materialAnimations: MaterialAnimation[] = [];
    let materialAnimationEntryOffset = materialAnimationArrayOffset;
    for (let materialAnimationIndex = 0; materialAnimationIndex < materialAnimationCount; materialAnimationIndex++) {
        const name = readBinStr(buffer, view.getUint32(materialAnimationEntryOffset + 0x0, littleEndian), littleEndian);
        const curveArrayOffset = view.getUint32(materialAnimationEntryOffset + 0x18, littleEndian);
        const curveCount = view.getUint16(materialAnimationEntryOffset + 0x38, littleEndian);
        const curves = parseCurves(buffer, fresVersion, curveArrayOffset, curveCount, littleEndian);

        materialAnimations.push({ name, curves });
        materialAnimationEntryOffset += 0x40;
    }

    const userData = parseUserData(buffer, fresVersion, userDataArrayOffset, userDataCount, littleEndian);

    return { name, frameCount, materialAnimations, userData };
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
        0x00050003,
        0x00080000, // Super Mario Odyssey
        0x00090000,
    ];

    const major = version >> 16;
    const minor = version >> 8 & 0xFF;
    const micro = version & 0xFF;
    const fresVersion: Version = { major, minor, micro };

    assert(supportedVersions.includes(version));

    const fileNameOffs = view.getUint16(0x20, littleEndian);
    const fileName = readBinStr(buffer, fileNameOffs, littleEndian);

    function parseResDic(resDicOffs: number): string[] {
        const names: string[] = [];
        if (resDicOffs === 0)
            return names;

        // Signature
        assert(view.getUint32(resDicOffs + 0x00, littleEndian) === 0x00000000);
        const tableCount = view.getUint32(resDicOffs + 0x04, littleEndian);

        let resDicTableIdx = resDicOffs + 0x18;
        for (let i = 0; i < tableCount; i++) {
            // There's a fancy search tree in here which I don't care about at all...
            names.push(readBinStr(buffer, view.getUint32(resDicTableIdx + 0x08, littleEndian), littleEndian));
            resDicTableIdx += 0x10;
        }
        return names;
    }

    const fmdlArrayOffset = view.getUint32(0x28, littleEndian);
    const fmdlResDicOffset = view.getUint32(0x30, littleEndian);

    let memoryPoolInfoOffs;
    let externalFilesArrayOffset;
    let externalFilesResDicOffset;
    let fskaArrayOffset;
    let fskaResDicOffset;
    let fmaaArrayOffset;
    let fmaaResDicOffset;

    if (fresVersion.major < 9) {
        fskaArrayOffset = view.getUint32(0x38, littleEndian);
        fskaResDicOffset = view.getUint32(0x40, littleEndian);
        fmaaArrayOffset = view.getUint32(0x48, littleEndian);
        fmaaResDicOffset = view.getUint32(0x50, littleEndian);
        memoryPoolInfoOffs = view.getUint32(0x90, littleEndian);
        externalFilesArrayOffset = view.getUint32(0x98, littleEndian);
        externalFilesResDicOffset = view.getUint32(0xA0, littleEndian);
    }
    else {
        fskaArrayOffset = view.getUint32(0x58, littleEndian);
        fskaResDicOffset = view.getUint32(0x60, littleEndian);
        fmaaArrayOffset = view.getUint32(0x68, littleEndian);
        fmaaResDicOffset = view.getUint32(0x70, littleEndian);
        memoryPoolInfoOffs = view.getUint32(0xB0, littleEndian);
        externalFilesArrayOffset = view.getUint32(0xB8, littleEndian);
        externalFilesResDicOffset = view.getUint32(0xC0, littleEndian);
    }

    // First, read our memory pool info. This stores our buffers.
    const memoryPoolSize = memoryPoolInfoOffs !== 0 ? view.getUint32(memoryPoolInfoOffs + 0x04, littleEndian) : 0;
    const memoryPoolDataOffs = memoryPoolInfoOffs !== 0 ? view.getUint32(memoryPoolInfoOffs + 0x08, littleEndian) : 0;
    const memoryPoolBuffer = memoryPoolInfoOffs !== 0 ? buffer.subarray(memoryPoolDataOffs, memoryPoolSize) : null;

    const fmdlNames = parseResDic(fmdlResDicOffset);
    let fmdlTableIdx = fmdlArrayOffset;
    const fmdl: FMDL[] = [];
    for (let i = 0; i < fmdlNames.length; i++) {
        const name = fmdlNames[i];
        assert(readString(buffer, fmdlTableIdx + 0x00, 0x04) === 'FMDL');
        const fmdl_ = parseFMDL(buffer, memoryPoolBuffer!, fresVersion, fmdlTableIdx, littleEndian);
        assert(fmdl_.name === name);
        fmdl.push(fmdl_);
        fmdlTableIdx += 0x78;
    }

    const fskaNames = parseResDic(fskaResDicOffset);
    let fskaTableIdx = fskaArrayOffset;
    const fska: FSKA[] = [];
    for (let i = 0; i < fskaNames.length; i++) {
        assert(readString(buffer, fskaTableIdx + 0x00, 0x04) === 'FSKA');
        const fska_ = parseFSKA(buffer, fresVersion, fskaTableIdx, littleEndian);
        fska.push(fska_);
        if (fresVersion.major < 9) {
            fskaTableIdx += 0x60;
        }
        else {
            fskaTableIdx += 0x50;
        }
    }

    const fmaaNames = parseResDic(fmaaResDicOffset);
    let fmaaTableIdx = fmaaArrayOffset;
    const fmaa: FMAA[] = [];
    for (let i = 0; i < fmaaNames.length; i++) {
        assert(readString(buffer, fmaaTableIdx + 0x00, 0x04) === 'FMAA');
        const fmaa_ = parseFMAA(buffer, fresVersion, fmaaTableIdx, littleEndian);
        fmaa.push(fmaa_);
        if (fresVersion.major < 9) {
            fmaaTableIdx += 0x78;
        }
        else {
            fmaaTableIdx += 0x70;
        }
    }

    const externalFileNames = parseResDic(externalFilesResDicOffset);
    const externalFiles: ExternalFile[] = [];
    let externalFilesTableIdx = externalFilesArrayOffset;
    for (let i = 0; i < externalFileNames.length; i++) {
        const name = externalFileNames[i];
        const offs = view.getUint32(externalFilesTableIdx + 0x00, littleEndian);
        const size = view.getUint32(externalFilesTableIdx + 0x08, littleEndian);
        const fileBuffer = buffer.subarray(offs, size);
        externalFiles.push({ name, buffer: fileBuffer });
        externalFilesTableIdx += 0x10;
    }

    return { fmdl, fska, fmaa, externalFiles };
}
