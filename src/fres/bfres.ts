
import * as GX2Texture from './gx2_texture';
import { GX2PrimitiveType, GX2IndexFormat, GX2AttribFormat } from './gx2_enum';

import { assert, readString } from 'util';

function readBinPtrT(view: DataView, offs: number, littleEndian: boolean) {
    return offs + view.getInt32(offs, littleEndian);
}

interface ResDicEntry {
    name: string;
    offs: number;
}

function parseResDic(view: DataView, tableOffs: number, littleEndian: boolean): ResDicEntry[] {
    const tableSize = view.getUint32(tableOffs + 0x00, littleEndian);
    const tableCount = view.getUint32(tableOffs + 0x04, littleEndian);
    assert(tableCount === tableCount);

    const entries: ResDicEntry[] = [];

    let tableIdx = tableOffs + 0x08;
    // Skip root entry.
    tableIdx += 0x10;
    for (let i = 0; i < tableCount; i++) {
        // There's a fancy search tree in here which I don't care about at all...
        const name = readString(view.buffer, readBinPtrT(view, tableIdx + 0x08, littleEndian));
        const offs = readBinPtrT(view, tableIdx + 0x0C, littleEndian);
        entries.push({ name, offs });
        tableIdx += 0x10;
    }

    return entries;
}

function parseFTEX(buffer: ArrayBuffer, entry: ResDicEntry, littleEndian: boolean): GX2Texture.DecodedTexture {
    const offs = entry.offs;
    const view = new DataView(buffer);

    assert(readString(buffer, offs + 0x00, 0x04) === 'FTEX');
    // GX2 is Wii U which is a little-endian system.
    assert(!littleEndian);

    const gx2SurfaceOffs = offs + 0x04;
    const texDataOffs = readBinPtrT(view, offs + 0xB0, littleEndian);
    const mipDataOffs = readBinPtrT(view, offs + 0xB4, littleEndian);

    const surface = GX2Texture.parseGX2Surface(buffer, gx2SurfaceOffs);
    const texture = GX2Texture.decodeSurface(surface, buffer, texDataOffs, mipDataOffs);
    return texture;
}

interface SubMesh {
    indexBufferCount: number;
    indexBufferOffset: number;
}

interface BufferData {
    stride: number;
    data: ArrayBuffer;
}

interface Mesh {
    primType: GX2PrimitiveType;
    indexFormat: GX2IndexFormat;
    indexBufferData: BufferData;
    submeshes: SubMesh[];
}

interface FSHP {
    name: string;
    fmatIndex: number;
    fvtxIndex: number;
    meshes: Mesh[];
}

interface VtxAttrib {
    name: string;
    bufferIndex: number;
    bufferStart: number;
    format: GX2AttribFormat;
}

interface FVTX {
    buffers: BufferData[];
    attribs: VtxAttrib[];
}

interface ShaderAssignDictEntry {
    key: string;
    value: string;
}

interface ShaderAssign {
    shaderArchiveName: string;
    shadingModelName: string;
    vertShaderInputDict: ShaderAssignDictEntry[];
    fragShaderInputDict: ShaderAssignDictEntry[];
    paramDict: ShaderAssignDictEntry[];
}

// XXX(jstpierre): Combines sampler and texture info
interface TextureAssign {
    attribName: string;
    textureName: string;
    ftexOffs: number;
}

enum UBOParameterType {
    Bool1,
    Bool2,
    Bool3,
    Bool4,
    Int1,
    Int2,
    Int3,
    Int4,
    Uint1,
    Uint2,
    Uint3,
    Uint4,
    Float1,
    Float2,
    Float3,
    Float4,
    _Reserved_0,
    Float2x2,
    Float2x3,
    Float2x4,
    _Reserved_1,
    Float3x2,
    Float3x3,
    Float3x4,
    _Reserved_2,
    Float4x2,
    Float4x3,
    Float4x4,
    SRT2D,
    SRT3D,
    TextureSRT,
}

interface UBOParameter {
    type: UBOParameterType;
    size: number;
    dataOffs: number;
    name: string;
}

enum RenderInfoParameterType {
    Int = 0,
    Float = 1,
    String = 2,
};

interface RenderInfoParameterNumber {
    type: RenderInfoParameterType.Int | RenderInfoParameterType.Float;
    name: string;
    data: number[];
}

interface RenderInfoParameterString {
    type: RenderInfoParameterType.String;
    name: string;
    data: string[];
}

type RenderInfoParameter = RenderInfoParameterNumber | RenderInfoParameterString;

interface FMAT {
    renderInfoParameters: RenderInfoParameter[];
    textureAssigns: TextureAssign[];
    materialParameterDataBuffer: ArrayBuffer;
    materialParameters: UBOParameter[];
    shaderAssign: ShaderAssign;
}

export interface FMDL {
    fshp: FSHP[];
    fvtx: FVTX[];
    fmat: FMAT[];
}

function parseFMDL(buffer: ArrayBuffer, entry: ResDicEntry, littleEndian: boolean): FMDL {
    const offs = entry.offs;
    const view = new DataView(buffer);

    assert(readString(buffer, offs + 0x00, 0x04) === 'FMDL');
    const fileName = readBinPtrT(view, offs + 0x04, littleEndian);
    const filePath = readBinPtrT(view, offs + 0x08, littleEndian);
    const fsklOffs = readBinPtrT(view, offs + 0x0C, littleEndian);
    const fvtxOffs = readBinPtrT(view, offs + 0x10, littleEndian);

    const fshpResDic = parseResDic(view, readBinPtrT(view, offs + 0x14, littleEndian), littleEndian);
    const fmatResDic = parseResDic(view, readBinPtrT(view, offs + 0x18, littleEndian), littleEndian);

    const fvtxCount = view.getUint16(offs + 0x20, littleEndian);
    const fshpCount = view.getUint16(offs + 0x22, littleEndian);
    const fmatCount = view.getUint16(offs + 0x24, littleEndian);

    assert(fshpCount === fshpResDic.length);
    assert(fmatCount === fmatResDic.length);

    function readBufferData(offs: number): BufferData {
        const size = view.getUint32(offs + 0x04, littleEndian);
        const stride = view.getUint16(offs + 0x02, littleEndian);
        const dataOffs = readBinPtrT(view, offs + 0x14, littleEndian);
        const data = buffer.slice(offs, offs + size);
        return { data, stride };
    }

    function parseShaderAssignDict(offs: number): ShaderAssignDictEntry[] {
        const resDic = parseResDic(view, offs, littleEndian);
        const entries = [];
        for (const entry of resDic) {
            const key = entry.name;
            const value = readString(buffer, entry.offs);
            entries.push({ key, value });
        }
        return entries;
    }

    // Vertex buffers.
    let fvtxIdx = fvtxOffs;
    const fvtx: FVTX[] = [];
    for (let i = 0; i < fvtxCount; i++) {
        assert(readString(buffer, fvtxIdx + 0x00, 0x04) === 'FVTX');
        const attribCount = view.getUint8(fvtxIdx + 0x04);
        const bufferCount = view.getUint8(fvtxIdx + 0x05);
        const sectionIndex = view.getUint16(fvtxIdx + 0x06);
        assert(i === sectionIndex);
        const vtxCount = view.getUint16(fvtxIdx + 0x08);
        const attribArrayOffs = readBinPtrT(view, fvtxIdx + 0x10, littleEndian);
        const bufferArrayOffs = readBinPtrT(view, fvtxIdx + 0x18, littleEndian);

        const attribs: VtxAttrib[] = [];
        let attribArrayIdx = attribArrayOffs;
        for (let j = 0; j < attribCount; j++) {
            const name = readString(buffer, readBinPtrT(view, attribArrayIdx + 0x00, littleEndian));
            const bufferIndex = view.getUint8(attribArrayIdx + 0x04);
            const bufferStart = view.getUint16(attribArrayIdx + 0x06, littleEndian);
            const format = view.getUint32(attribArrayIdx + 0x08, littleEndian);
            attribs.push({ name, bufferIndex, bufferStart, format });
            attribArrayIdx += 0x0C;
        }

        const buffers: BufferData[] = [];
        let bufferArrayIdx = bufferArrayOffs;
        for (let j = 0; j < bufferCount; j++) {
            const bufferData = readBufferData(bufferArrayIdx);
            assert(bufferData.stride === 0);
            buffers.push(bufferData);
            bufferArrayIdx += 0x18;
        }

        fvtx.push({ buffers, attribs });

        fvtxIdx += 0x20;
    }

    // Shapes.
    const fshp: FSHP[] = [];
    for (const fshpEntry of fshpResDic) {
        const offs = fshpEntry.offs;
        assert(readString(buffer, offs + 0x00, 0x04) === 'FSHP');
        const name = readString(buffer, readBinPtrT(view, offs + 0x04, littleEndian));
        const fmatIndex = view.getUint16(offs + 0x0E, littleEndian);
        const fsklIndex = view.getUint16(offs + 0x10, littleEndian);
        const fvtxIndex = view.getUint16(offs + 0x12, littleEndian);

        // Each mesh corresponds to one LoD.
        const meshArrayCount = view.getUint8(offs + 0x17);
        const meshArrayOffs = readBinPtrT(view, offs + 0x24, littleEndian);
        let meshArrayIdx = meshArrayOffs;
        const meshes: Mesh[] = [];
        for (let i = 0; i < meshArrayCount; i++) {
            const primType = view.getUint32(meshArrayIdx + 0x00, littleEndian);
            const indexFormat = view.getUint32(meshArrayIdx + 0x04, littleEndian);
            const indexBufferOffs = readBinPtrT(view, meshArrayIdx + 0x14, littleEndian);
            const indexBufferData = readBufferData(indexBufferOffs);

            const submeshArrayCount = view.getUint16(meshArrayIdx + 0x0C, littleEndian);
            const submeshArrayOffs = view.getUint32(meshArrayIdx + 0x10, littleEndian);
            let submeshArrayIdx = submeshArrayOffs;
            const submeshes: SubMesh[] = [];
            for (let j = 0; j < submeshArrayCount; j++) {
                const indexBufferOffset = view.getUint32(submeshArrayIdx + 0x00, littleEndian);
                const indexBufferCount = view.getUint32(submeshArrayIdx + 0x04, littleEndian);
                submeshes.push({ indexBufferOffset, indexBufferCount });
                submeshArrayIdx += 0x08;
            }
            meshes.push({ primType, indexFormat, indexBufferData, submeshes });

            meshArrayIdx += 0x1C;
        }
        fshp.push({ name, fmatIndex, fvtxIndex, meshes });
    }

    // Materials.
    const fmat: FMAT[] = [];
    for (const fmatEntry of fmatResDic) {
        const offs = fmatEntry.offs;
        assert(readString(buffer, offs + 0x00, 0x04) === 'FMAT');
        const name = readString(buffer, readBinPtrT(view, offs + 0x04, littleEndian));
        const renderInfoParameterCount = view.getUint16(offs + 0x0E, littleEndian);
        const textureReferenceCount = view.getUint8(offs + 0x10);
        const textureSamplerCount = view.getUint8(offs + 0x11);
        const materialParameterCount = view.getUint16(offs + 0x12);
        const materialParameterDataLength = view.getUint16(offs + 0x16);
        const renderInfoParameterResDic = parseResDic(view, readBinPtrT(view, offs + 0x1C, littleEndian), littleEndian);
        const renderStateOffs = readBinPtrT(view, offs + 0x20, littleEndian);
        const shaderAssignOffs = readBinPtrT(view, offs + 0x24, littleEndian);
        const textureReferenceArrayOffs = readBinPtrT(view, offs + 0x28, littleEndian);
        const textureSamplerArrayOffs = readBinPtrT(view, offs + 0x2C, littleEndian);
        const materialParameterArrayOffs = readBinPtrT(view, offs + 0x34, littleEndian);
        const materialParameterDataOffs = readBinPtrT(view, offs + 0x3C, littleEndian);

        const materialParameterDataBuffer = buffer.slice(materialParameterDataOffs, materialParameterDataOffs + materialParameterDataLength);

        const renderInfoParameters: RenderInfoParameter[] = [];
        for (const renderInfoParameterEntry of renderInfoParameterResDic) {
            const offs = renderInfoParameterEntry.offs;
            const arrayLength = view.getUint16(offs + 0x00, littleEndian);
            const type: RenderInfoParameterType = view.getUint8(offs + 0x02);
            const name = readString(buffer, readBinPtrT(view, offs + 0x04, littleEndian));

            let arrayIdx = offs + 0x08;
            switch (type) {
                case RenderInfoParameterType.Int: {
                    const data: number[] = [];
                    for (let i = 0; i < arrayLength; i++) {
                        data.push(view.getInt32(arrayIdx, littleEndian));
                        arrayIdx += 0x04;
                    }
                    renderInfoParameters.push({ type, name, data });
                    break;
                }

                case RenderInfoParameterType.Float: {
                    const data: number[] = [];
                    for (let i = 0; i < arrayLength; i++) {
                        data.push(view.getFloat32(arrayIdx, littleEndian));
                        arrayIdx += 0x04;
                    }
                    renderInfoParameters.push({ type, name, data });
                    break;
                }

                case RenderInfoParameterType.String: {
                    const data: string[] = [];
                    for (let i = 0; i < arrayLength; i++) {
                        data.push(readString(buffer, readBinPtrT(view, arrayIdx, littleEndian)));
                        arrayIdx += 0x04;
                    }
                    renderInfoParameters.push({ type, name, data });
                    break;
                }
            }
        }

        assert(textureSamplerCount === textureReferenceCount);

        let textureSamplerArrayIdx = textureSamplerArrayOffs;
        let textureReferenceArrayIdx = textureReferenceArrayOffs;
        const textureAssigns: TextureAssign[] = [];
        for (let i = 0; i < textureSamplerCount; i++) {
            const samplerParam0 = view.getUint32(textureSamplerArrayIdx + 0x00, littleEndian);
            const samplerParam1 = view.getUint32(textureSamplerArrayIdx + 0x04, littleEndian);
            const samplerParam2 = view.getUint32(textureSamplerArrayIdx + 0x08, littleEndian);
            const attribName = readString(buffer, readBinPtrT(view, textureSamplerArrayIdx + 0x10, littleEndian));
            const index = view.getUint8(textureSamplerArrayIdx + 0x14);
            assert(index === i);
            textureSamplerArrayIdx += 0x18;

            const textureName = readString(buffer, readBinPtrT(view, textureReferenceArrayIdx + 0x00, littleEndian));
            const ftexOffs = readBinPtrT(view, textureReferenceArrayIdx + 0x04, littleEndian);
            textureReferenceArrayIdx += 0x08;

            textureAssigns.push({ attribName, textureName, ftexOffs });
        }

        let materialParameterArrayIdx = materialParameterArrayOffs;
        const materialParameters: UBOParameter[] = [];
        for (let i = 0; i < materialParameterCount; i++) {
            const type = view.getUint8(materialParameterArrayIdx + 0x00);
            const size = view.getUint8(materialParameterArrayIdx + 0x01);
            const dataOffs = view.getUint16(materialParameterArrayIdx + 0x02, littleEndian);
            const index = view.getUint16(materialParameterArrayIdx + 0x0C, littleEndian);
            assert(index === i);
            const name = readString(buffer, readBinPtrT(view, materialParameterArrayIdx + 0x10, littleEndian));
            materialParameterArrayIdx += 0x14;
            materialParameters.push({ type, size, dataOffs, name });
        }

        // Shader assign.
        const shaderArchiveName = readString(buffer, readBinPtrT(view, shaderAssignOffs + 0x00, littleEndian));
        const shadingModelName = readString(buffer, readBinPtrT(view, shaderAssignOffs + 0x04, littleEndian));
        const vertShaderInputCount = view.getUint8(shaderAssignOffs + 0x0C);
        const vertShaderInputDict = parseShaderAssignDict(readBinPtrT(view, shaderAssignOffs + 0x10, littleEndian));
        assert(vertShaderInputDict.length === vertShaderInputCount);
        const fragShaderInputCount = view.getUint8(shaderAssignOffs + 0x0D);
        const fragShaderInputDict = parseShaderAssignDict(readBinPtrT(view, shaderAssignOffs + 0x14, littleEndian));
        assert(fragShaderInputDict.length === fragShaderInputCount);
        const paramDict = parseShaderAssignDict(readBinPtrT(view, shaderAssignOffs + 0x18, littleEndian));
        const paramCount = view.getUint16(shaderAssignOffs + 0x0E);
        assert(paramDict.length === paramCount);

        const shaderAssign: ShaderAssign = {
            shaderArchiveName,
            shadingModelName,
            vertShaderInputDict,
            fragShaderInputDict,
            paramDict,
        }

        fmat.push({ renderInfoParameters, textureAssigns, materialParameterDataBuffer, materialParameters, shaderAssign });
    }

    return { fvtx, fshp, fmat };
}

export interface TextureEntry {
    entry: ResDicEntry;
    texture: GX2Texture.DecodedTexture;
}

export interface ModelEntry {
    entry: ResDicEntry;
    fmdl: FMDL;
}

export interface FRES {
    textures: TextureEntry[];
    models: ModelEntry[];
}

export function parse(buffer: ArrayBuffer): FRES {
    const view = new DataView(buffer);

    assert(readString(buffer, 0x00, 0x04) === 'FRES');

    let littleEndian;
    switch (view.getUint16(0x08, false)) {
    case 0xFEFF:
        littleEndian = false;
        break;
    case 0xFFFE:
        littleEndian = true;
        break;
    default:
        throw new Error("Invalid BOM");
    }

    const version = view.getUint32(0x04, littleEndian);

    // v3.5.0.3, as seen in Splatoon.
    assert(version === 0x03050003);

    const fileNameOffs = readBinPtrT(view, 0x14, littleEndian);
    const fileName = readString(buffer, fileNameOffs);

    function parseResDicIdx(idx: number) {
        const tableOffs = readBinPtrT(view, 0x20 + idx * 0x04, littleEndian);
        const tableCount = view.getUint16(0x50 + idx * 0x02, littleEndian);
        const resDic = parseResDic(view, tableOffs, littleEndian);
        assert(tableCount === resDic.length);
        return resDic;
    }
    const fmdlTable = parseResDicIdx(0x00);
    const ftexTable = parseResDicIdx(0x01);

    const textures: TextureEntry[] = [];
    for (const entry of ftexTable) {
        const texture = parseFTEX(buffer, entry, littleEndian);
        textures.push({ entry, texture });
    }

    const models: ModelEntry[] = [];
    for (const entry of fmdlTable) {
        const fmdl = parseFMDL(buffer, entry, littleEndian);
        models.push({ entry, fmdl });
    }

    return { textures, models };
}
