
import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec4 } from 'gl-matrix';
import { TextureFormat, decodeTexture, computeTextureByteSize } from './pica_texture';
import { GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import { makeMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

export interface VatrChunk {
    dataBuffer: ArrayBufferSlice;
    positionByteOffset: number;
    colorByteOffset: number;
    normalByteOffset: number;
    texCoord0ByteOffset: number;
    texCoord1ByteOffset: number;
    texCoord2ByteOffset: number;
    boneIndicesByteOffset: number;
    boneWeightsByteOffset: number;
}

export const enum Version {
    Ocarina, Majora, LuigisMansion
}

export class CMB {
    public name: string;
    public version: Version;
    public textures: Texture[] = [];
    public vatrChunk: VatrChunk;

    public materials: Material[] = [];
    public bones: Bone[] = [];
    public sepds: Sepd[] = [];
    public meshs: Mesh[] = [];
    public indexBuffer: ArrayBufferSlice;
}

export interface Bone {
    boneId: number;
    parentBoneId: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    translationX: number;
    translationY: number;
    translationZ: number;
}

export function calcModelMtx(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

function readSklChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'skl ');

    const boneTableCount = view.getUint32(0x08, true);

    const bones: Bone[] = [];
    let boneTableIdx = 0x10;
    for (let i = 0; i < boneTableCount; i++) {
        const boneId = view.getInt16(boneTableIdx + 0x00, true) & 0x0FFF;
        const parentBoneId = view.getInt16(boneTableIdx + 0x02, true);

        const scaleX = view.getFloat32(boneTableIdx + 0x04, true);
        const scaleY = view.getFloat32(boneTableIdx + 0x08, true);
        const scaleZ = view.getFloat32(boneTableIdx + 0x0C, true);
        const rotationX = view.getFloat32(boneTableIdx + 0x10, true);
        const rotationY = view.getFloat32(boneTableIdx + 0x14, true);
        const rotationZ = view.getFloat32(boneTableIdx + 0x18, true);
        const translationX = view.getFloat32(boneTableIdx + 0x1C, true);
        const translationY = view.getFloat32(boneTableIdx + 0x20, true);
        const translationZ = view.getFloat32(boneTableIdx + 0x24, true);

        const bone: Bone = { boneId, parentBoneId, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ };
        bones.push(bone);

        boneTableIdx += 0x28;
        if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
            boneTableIdx += 0x04;
    }
    cmb.bones = bones;
}

export enum TextureFilter {
    NEAREST = 0x2600,
    LINEAR = 0x2601,
    NEAREST_MIPMAP_NEAREST = 0x2700,
    LINEAR_MIPMAP_NEAREST = 0x2701,
    NEAREST_MIPMIP_LINEAR = 0x2702,
    LINEAR_MIPMAP_LINEAR = 0x2703,
}

export enum TextureWrapMode {
    CLAMP = 0x2900,
    REPEAT = 0x2901,
    CLAMP_TO_EDGE = 0x812F,
    MIRRORED_REPEAT = 0x8370,
}

export interface TextureBinding {
    index: number;
    textureIdx: number;
    minFilter: TextureFilter;
    magFilter: TextureFilter;
    wrapS: TextureWrapMode;
    wrapT: TextureWrapMode;
}

export interface Material {
    index: number;
    textureBindings: TextureBinding[];
    textureMatrices: mat4[];
    alphaTestReference: number;
    renderFlags: GfxMegaStateDescriptor;
    isTransparent: boolean;
}

export function calcTexMtx(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const sinR = Math.sin(rotation);
    const cosR = Math.cos(rotation);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleT * -sinR;
    dst[12] = translationS;

    dst[1]  = scaleS *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = translationT;
}

function readMatsChunk(cmb: CMB, buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mats');
    const count = view.getUint32(0x08, true);

    let offs = 0x0C;
    for (let i = 0; i < count; i++) {
        const numTextureBindings = view.getUint16(offs + 0x0C, true);
        const numTextureMatrices = view.getUint16(offs + 0x0E, true);

        let bindingOffs = offs + 0x10;
        const textureBindings: TextureBinding[] = [];
        for (let j = 0; j < 3; j++) {
            const textureIdx = view.getInt16(bindingOffs + 0x00, true);
            let minFilter = view.getUint16(bindingOffs + 0x04, true);
            // XXX(jstpierre): Hack to force trilinear filtering. Looks much better.
            if (minFilter === TextureFilter.LINEAR_MIPMAP_NEAREST)
                minFilter = TextureFilter.LINEAR_MIPMAP_LINEAR;
            const magFilter = view.getUint16(bindingOffs + 0x06, true);
            const wrapS = view.getUint16(bindingOffs + 0x08, true);
            const wrapT = view.getUint16(bindingOffs + 0x0A, true);
            textureBindings.push({ index: j, textureIdx, minFilter, magFilter, wrapS, wrapT });
            bindingOffs += 0x18;
        }

        let matricesOffs = offs + 0x58;
        const textureMatrices: mat4[] = [];
        for (let j = 0; j < 3; j++) {
            const flags = view.getUint32(matricesOffs + 0x00, true);
            const scaleS = view.getFloat32(matricesOffs + 0x04, true);
            const scaleT = view.getFloat32(matricesOffs + 0x08, true);
            const translationS = view.getFloat32(matricesOffs + 0x0C, true);
            const translationT = view.getFloat32(matricesOffs + 0x10, true);
            const rotation = view.getFloat32(matricesOffs + 0x14, true);
            const texMtx = mat4.create();
            calcTexMtx(texMtx, scaleS, scaleT, translationS, translationT, rotation);
            textureMatrices.push(texMtx);
            matricesOffs += 0x18;
        }

        const alphaTestEnable = !!view.getUint8(offs + 0x130);
        const alphaTestReference = alphaTestEnable ? (view.getUint8(offs + 0x131) / 0xFF) : -1;

        const blendEnable = !!view.getUint8(offs + 0x138);
        const isTransparent = blendEnable;
        const renderFlags = makeMegaState({
            blendSrcFactor: view.getUint16(offs + 0x13C, true) as GfxBlendFactor,
            blendDstFactor: view.getUint16(offs + 0x13E, true) as GfxBlendFactor,
            blendMode: blendEnable ? view.getUint16(offs + 0x140, true) as GfxBlendMode : GfxBlendMode.NONE,
            depthWrite: !isTransparent,
            cullMode: GfxCullMode.BACK,
        });
        cmb.materials.push({ index: i, textureBindings, textureMatrices, alphaTestReference, renderFlags, isTransparent });

        offs += 0x15C;

        if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
            offs += 0x10;
    }
}

export interface TextureLevel {
    width: number;
    height: number;
    pixels: Uint8Array;
    name: string;
}

export interface Texture {
    name: string;
    width: number;
    height: number;
    format: TextureFormat;
    levels: TextureLevel[];
    totalTextureSize: number;
}

export function parseTexChunk(buffer: ArrayBufferSlice, texData: ArrayBufferSlice | null, cmbName: string = ''): Texture[] {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'tex ');
    const count = view.getUint32(0x08, true);
    let offs = 0x0C;

    const textures: Texture[] = [];
    for (let i = 0; i < count; i++) {
        const size = view.getUint32(offs + 0x00, true);
        const maxLevel = view.getUint16(offs + 0x04, true);
        const unk06 = view.getUint16(offs + 0x06, true);
        const width = view.getUint16(offs + 0x08, true);
        const height = view.getUint16(offs + 0x0A, true);
        const format = view.getUint32(offs + 0x0C, true);
        let dataOffs = view.getUint32(offs + 0x10, true);
        const dataEnd = dataOffs + size;
        const texName = readString(buffer, offs + 0x14, 0x10);
        // TODO(jstpierre): Maybe find another way to dedupe? Name seems inconsistent.
        const name = `${cmbName}/${i}/${texName}`;
        offs += 0x24;

        const levels: TextureLevel[] = [];

        if (texData !== null) {
            let mipWidth = width, mipHeight = height;
            for (let i = 0; i < maxLevel; i++) {
                const pixels = decodeTexture(format, mipWidth, mipHeight, texData.slice(dataOffs, dataEnd));
                levels.push({ name, width: mipWidth, height: mipHeight, pixels });
                dataOffs += computeTextureByteSize(format, mipWidth, mipHeight);
                mipWidth /= 2;
                mipHeight /= 2;
            }
        }

        textures.push({ name, format, width, height, levels, totalTextureSize: size });
    }

    return textures;
}

function readTexChunk(cmb: CMB, buffer: ArrayBufferSlice, texData: ArrayBufferSlice | null): void {
    cmb.textures = parseTexChunk(buffer, texData, cmb.name);
}

function readVatrChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'vatr');
    const fullBufferSize = view.getUint32(0x04, true);

    let idx = 0x0C;

    function readSlice(baseOffs: number = 0): number {
        const size = view.getUint32(idx + 0x00, true);
        const offs = view.getUint32(idx + 0x04, true);
        idx += 0x08;

        if (size === 0)
            return -1;
        else
            return offs - baseOffs;
    }

    const baseOffs = readSlice();
    const dataBuffer = buffer.slice(baseOffs, fullBufferSize);

    const positionByteOffset = 0;
    const normalByteOffset = readSlice(baseOffs);

    let tangentByteOffset = 0;
    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        tangentByteOffset = readSlice(baseOffs);

    const colorByteOffset = readSlice(baseOffs);
    const texCoord0ByteOffset = readSlice(baseOffs);
    // TODO(jstpierre): Figure out how tex coords work, 'cuz this ain't it chief.
    const texCoord1ByteOffset = -1; readSlice(baseOffs);
    const texCoord2ByteOffset = -1; readSlice(baseOffs);

    const boneIndicesByteOffset = readSlice(baseOffs);
    const boneWeightsByteOffset = readSlice(baseOffs);

    cmb.vatrChunk = {
        dataBuffer,
        positionByteOffset,
        normalByteOffset,
        colorByteOffset,
        texCoord0ByteOffset,
        texCoord1ByteOffset,
        texCoord2ByteOffset,
        boneIndicesByteOffset,
        boneWeightsByteOffset,
    };
}

export class Mesh {
    public sepdIdx: number;
    public matsIdx: number;
}

function readMshsChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mshs');
    const count = view.getUint32(0x08, true);
    let idx = 0x10;
    for (let i = 0; i < count; i++) {
        const mesh = new Mesh();
        mesh.sepdIdx = view.getUint16(idx, true);
        mesh.matsIdx = view.getUint8(idx + 0x02);
        cmb.meshs.push(mesh);

        if (cmb.version === Version.Ocarina)
            idx += 0x04;
        else if (cmb.version === Version.Majora)
            idx += 0x0C;
        else if (cmb.version === Version.LuigisMansion)
            idx += 0x58;
    }
}

export enum DataType {
    Byte   = 0x1400,
    UByte  = 0x1401,
    Short  = 0x1402,
    UShort = 0x1403,
    Int    = 0x1404,
    UInt   = 0x1405,
    Float  = 0x1406,
}

export class Prm {
    public indexType: DataType;
    public count: number;
    public offset: number;
}

function readPrmChunk(cmb: CMB, buffer: ArrayBufferSlice): Prm {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prm ');

    const prm = new Prm();
    prm.indexType = view.getUint32(0x10, true);
    prm.count = view.getUint16(0x14, true);
    // No idea why this is always specified in terms of shorts, even when the indexType is byte...
    prm.offset = view.getUint16(0x16, true) * 2;

    return prm;
}

export const enum SkinningMode {
    SINGLE_BONE = 0x00,
    RIGID_SKINNING = 0x01,
    SMOOTH_SKINNING = 0x02,
}

// "Primitive Set"
export interface Prms {
    prm: Prm;
    skinningMode: SkinningMode;
    boneTable: Uint16Array;
}

function readPrmsChunk(cmb: CMB, buffer: ArrayBufferSlice): Prms {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prms');

    const prmCount = view.getUint32(0x08, true);
    assert(prmCount === 1);

    const skinningMode: SkinningMode = view.getUint16(0x0C, true);

    const boneTableCount = view.getUint16(0x0E, true);
    assert(boneTableCount < 0x10);
    const boneTable = new Uint16Array(boneTableCount);

    // This is likely an array of primitives in the set, but 3DS models are probably
    // rarely enough to over the bone table limit...
    const prmOffs = view.getUint32(0x14, true);

    const prm = readPrmChunk(cmb, buffer.slice(prmOffs));

    let boneTableIdx = view.getUint32(0x10, true);
    for (let i = 0; i < boneTableCount; i++) {
        boneTable[i] = view.getUint16(boneTableIdx, true);
        boneTableIdx += 0x02;
    }

    return { prm, skinningMode, boneTable };
}

export const enum SepdVertexAttribMode {
    ARRAY = 0,
    CONSTANT = 1,
}

export interface SepdVertexAttrib {
    mode: SepdVertexAttribMode;
    start: number;
    scale: number;
    dataType: DataType;
    constant: vec4;
}

export class Sepd {
    public prms: Prms[] = [];

    public position!: SepdVertexAttrib;
    public normal!: SepdVertexAttrib;
    public tangent: SepdVertexAttrib | null = null;
    public color!: SepdVertexAttrib;
    public texCoord0!: SepdVertexAttrib;
    public texCoord1!: SepdVertexAttrib;
    public texCoord2!: SepdVertexAttrib;
    public boneIndices!: SepdVertexAttrib;
    public boneWeights!: SepdVertexAttrib;

    public boneDimension: number;
}

// "Separate Data Shape"
function readSepdChunk(cmb: CMB, buffer: ArrayBufferSlice): Sepd {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sepd');
    const count = view.getUint16(0x08, true);

    const sepd = new Sepd();

    // Probably OBB / position offset before the sepd arrays?
    let sepdArrIdx = cmb.version === Version.LuigisMansion ? 0x3C : 0x24;

    function readVertexAttrib(): SepdVertexAttrib {
        const start = view.getUint32(sepdArrIdx + 0x00, true);
        const scale = view.getFloat32(sepdArrIdx + 0x04, true);
        const dataType: DataType = view.getUint16(sepdArrIdx + 0x08, true);
        const mode: SepdVertexAttribMode = view.getUint16(sepdArrIdx + 0x0A, true);
        const c0 = view.getFloat32(sepdArrIdx + 0x0C, true);
        const c1 = view.getFloat32(sepdArrIdx + 0x10, true);
        const c2 = view.getFloat32(sepdArrIdx + 0x14, true);
        const c3 = view.getFloat32(sepdArrIdx + 0x18, true);
        const constant: vec4 = vec4.fromValues(c0, c1, c2, c3);
        sepdArrIdx += 0x1C;
        return { start, scale, dataType, mode, constant };
    }

    sepd.position = readVertexAttrib();
    sepd.normal = readVertexAttrib();

    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        sepd.tangent = readVertexAttrib();

    sepd.color = readVertexAttrib();
    sepd.texCoord0 = readVertexAttrib();
    sepd.texCoord1 = readVertexAttrib();
    sepd.texCoord2 = readVertexAttrib();
    sepd.boneIndices = readVertexAttrib();
    sepd.boneWeights = readVertexAttrib();

    // take you to the next dimension, the
    sepd.boneDimension = view.getUint16(sepdArrIdx + 0x00, true);

    sepdArrIdx += 0x04;

    for (let i = 0; i < count; i++) {
        const prmsOffs = view.getUint16(sepdArrIdx + 0x00, true);
        sepd.prms.push(readPrmsChunk(cmb, buffer.slice(prmsOffs)));
        sepdArrIdx += 0x02;
        // sanity check.
        assert(sepd.prms[i].skinningMode === sepd.prms[0].skinningMode);
    }

    return sepd;
}

function readShpChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'shp ');
    const count = view.getUint32(0x08, true);

    let offs = 0x10;
    for (let i = 0; i < count; i++) {
        const sepdOffs = view.getUint16(offs, true);
        const sepd = readSepdChunk(cmb, buffer.slice(sepdOffs));
        cmb.sepds.push(sepd);
        offs += 0x02;
    }
}

function readSklmChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sklm');
    const mshsChunkOffs = view.getUint32(0x08, true);
    readMshsChunk(cmb, buffer.slice(mshsChunkOffs));

    const shpChunkOffs = view.getUint32(0x0C, true);
    readShpChunk(cmb, buffer.slice(shpChunkOffs));
}

export function parse(buffer: ArrayBufferSlice): CMB {
    const view = buffer.createDataView();
    const cmb = new CMB();

    assert(readString(buffer, 0x00, 0x04) === 'cmb ');

    const size = view.getUint32(0x04, true);
    cmb.name = readString(buffer, 0x10, 0x10);

    const numChunks = view.getUint32(0x08, true);
    if (numChunks === 0x0F)
        cmb.version = Version.LuigisMansion;
    else if (numChunks === 0x0A)
        cmb.version = Version.Majora
    else if (numChunks === 0x06)
        cmb.version = Version.Ocarina;
    else
        throw "whoops";

    let chunkIdx = 0x24;

    const sklChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklChunk(cmb, buffer.slice(sklChunkOffs));

    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        chunkIdx += 0x04; // Qtrs

    const matsChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readMatsChunk(cmb, buffer.slice(matsChunkOffs));

    const texDataOffs = view.getUint32(chunkIdx + 0x14, true);

    const texChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;

    readTexChunk(cmb, buffer.slice(texChunkOffs), texDataOffs !== 0 ? buffer.slice(texDataOffs) : null);

    const sklmChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklmChunk(cmb, buffer.slice(sklmChunkOffs));

    chunkIdx += 0x04; // Luts

    const vatrChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readVatrChunk(cmb, buffer.slice(vatrChunkOffs));

    const idxDataOffs = view.getUint32(chunkIdx, true);

    const idxDataCount = view.getUint32(0x20, true);
    cmb.indexBuffer = buffer.slice(idxDataOffs, idxDataOffs + idxDataCount * 2);

    return cmb;
}
