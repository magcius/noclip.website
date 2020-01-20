import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexMtxMode, TEX0, fx32, TEX0Texture, TEX0Palette, MDL0Material, MDL0Shape, MDL0Node, MDL0Model } from "../nns_g3d/NNS_G3D";
import { mat4, mat2d } from "gl-matrix";
import { Format } from "../SuperMario64DS/nitro_tex";
import { readString } from "../util";

export interface MPHbin {
    models: MDL0Model[];
    tex0: TEX0 | null;
    mphTex: MPHTexture;
}

export interface MPHPal {
    pal: ArrayBufferSlice;
}

export interface MPHTex {
    tex: ArrayBufferSlice;
}

export interface MPHTexture {
    pals: MPHPal[];
    texs: MPHTex[];
}

function parseMaterial(buffer: ArrayBufferSlice): MDL0Material {
    const view = buffer.createDataView();

    const name = readString(buffer, 0x00, 0x40, true);

    const cullMode = view.getUint8(0x41);
    const alpha = view.getUint16(0x42, true) * 0x10;
    const palID = view.getUint16(0x44, true);
    let palletID;
    if (palID === 0xFFFF) {
        palletID = 0;
    } else {
        palletID = palID;
    }
    const texID = view.getUint16(0x46, true);
    let textureID;
    if (palID === 0xFFFF) {
        textureID = 0;
    } else {
        textureID = texID;
    }    

    const texParams = view.getUint32(0x44, true);
    
    //const polyAttribs = 0xFF;
    const polyAttribs = view.getUint32(0x58, true);

    const origWidth = view.getUint16(0x74, true);
    const origHeight = view.getUint16(0x78, true);

    const texScaleS = 1 / origWidth;
    const texScaleT = 1 / origHeight;

    const texMatrix = mat2d.create();

    const textureName = `texture_${textureID}`; 
    const paletteName = `pallet_${palletID}`;

    return { name, textureName, paletteName, cullMode, alpha, polyAttribs, texParams, texMatrix, texScaleS, texScaleT };
}

function parseShape(buffer: ArrayBufferSlice, shapeBuff: ArrayBufferSlice ,index: number): MDL0Shape {
    const view = buffer.createDataView();

    const dlOffs = view.getUint32(0x00, true);
    const dlSize = view.getUint32(0x04, true);
    const bboxMinX = view.getUint32(0x08, true);
    const bboxMinY = view.getUint32(0x0C, true);
    const bboxMinZ = view.getUint32(0x10, true);
    const bboxMaxX = view.getUint32(0x14, true);
    const bboxMaxY = view.getUint32(0x18, true);
    const bboxMaxZ = view.getUint32(0x1C, true);

    const name = `polygon_${index}`;
    const dlBuffer = shapeBuff.slice(dlOffs, dlOffs + dlSize);

    return({ name, dlBuffer });
}

function parseNode(buffer: ArrayBufferSlice): MDL0Node {
    const view = buffer.createDataView();

    const name = readString(buffer, 0x00, 0x40, true);
    const jointMatrix = mat4.create();

    return { name, jointMatrix, };
}

function parsePallet(buffer: ArrayBufferSlice, PalBuffer: ArrayBufferSlice, index: number): TEX0Palette {
    const view = buffer.createDataView();

    const palletOffs = view.getUint32(0x00, true);
    const palletSize = view.getUint32(0x04, true);
    const name = `pallet_${index}`
    const palletDataStart = palletOffs;
    const palletDataEnd = palletDataStart + palletSize;

    const data = PalBuffer.slice(palletDataStart, palletDataEnd);

    return { name, data };
}

function parseTexture(buffer: ArrayBufferSlice, TexBuffer: ArrayBufferSlice, index: number): TEX0Texture {
    const view = buffer.createDataView();

    const name = `texture_${index}`;
    const mph_format = view.getUint16(0x00, true);
    const format = convertMPHTexToNitroTex(mph_format);
    const width = view.getUint16(0x02, true);
    const height = view.getUint16(0x04, true);
    const unk_0x06 = view.getUint16(0x06, true);
    const textureDataOffs = view.getUint32(0x08, true);
    const textureDataSize = view.getInt32(0x0C, true);
    const unk_0x10 = view.getUint32(0x10, true);
    const unk_0x14 = view.getUint32(0x14, true);
    const unk_0x18 = view.getUint32(0x18, true);
    const unk_0x1C = view.getUint32(0x1C, true);
    const unk_0x20 = view.getUint32(0x20, true);
    const unk_0x24 = view.getUint32(0x24, true);

    const color0 = false;

    const textureDataStart = textureDataOffs;
    const textureDataEnd = textureDataStart + textureDataSize;
    const texData = TexBuffer.slice(textureDataStart, textureDataEnd);

    let palIdxData: ArrayBufferSlice | null = null;

    // convert MPH Texture Format to Nitro Texture
    function convertMPHTexToNitroTex(format: number): Format {
        switch (format) {
            case 0: //                                    mph -> nns
                return Format.Tex_Palette4;   // 2Bpp      0      2
            case 1: 
                return Format.Tex_Palette16;  // 4Bpp      1      3
            case 2:
                return Format.Tex_Palette256; // 8Bpp      2      7
            case 3:
                return Format.Tex_CMPR_4x4;   // 4x4       3      5
            case 4:
                return Format.Tex_A5I3;       // A5I3      4      1
            case 5:
                return Format.Tex_Direct      // 16Bpp     5      4
            case 6:
                Format.Tex_A3I5;              // A3I5      6      6
            default:
                return Format.Tex_None;
        }
    }

    return { name, format, width, height, color0, texData, palIdxData };
}

export function parseMPH_Model(buffer: ArrayBufferSlice): MPHbin {
    const view = buffer.createDataView();

    const mtx_shmat = view.getInt32(0x00, true);
    const posScale = fx32(view.getInt32(0x04, true));
    const unk_0x08 = view.getInt32(0x08, true);
    const unk_0x0C = view.getInt32(0x0C, true);
    const materialOffset = view.getUint32(0x10, true);
    const shapeOffset = view.getUint32(0x14, true);
    const nodeOffset = view.getUint32(0x18, true);
    const unk_0x1C = view.getInt16(0x1C, true);
    const unk_0x1E = view.getInt8(0x1E);
    const unk_0x1F = view.getInt8(0x1F);
    const unk_0x20 = view.getUint32(0x20, true);
    const unk_0x24 = view.getUint32(0x24, true);
    const textureCount = view.getUint16(0x28, true);
    const unk_0x2A = view.getUint16(0x2A, true);
    const textureOffset = view.getUint32(0x2C, true);
    const palletCount = view.getUint16(0x30, true);
    const unk_0x32 = view.getUint16(0x32, true);
    const palletOffset = view.getUint32(0x34, true);
    const unk_0x38 = view.getUint16(0x38, true);
    const unk_0x3C = view.getUint16(0x3C, true);
    const node_init_pos = fx32(view.getInt32(0x40, true));
    const node_pos = fx32(view.getInt32(0x44, true));
    const materialCount = view.getUint16(0x48, true);
    const nodeCount = view.getUint16(0x4A, true);
    const unk_0x4C = view.getUint16(0x4C, true); // matrix fx 4x4
    const unk_0x50 = view.getUint16(0x50, true);
    const unk_0x54 = view.getUint16(0x54, true);
    const unk_0x58 = view.getUint16(0x58, true);
    const unk_0x5C = view.getUint16(0x5C, true);
    const meshCount = view.getUint16(0x60, true);
    const matrixCount = view.getUint16(0x62, true);

    // Material
    const materials: MDL0Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const matOffs = i * 0x84 + materialOffset;
        materials.push( parseMaterial(buffer.slice(matOffs)) );
    }

    // Dlist
    const shapes: MDL0Shape[] = [];
    for (let i = 0; i < meshCount; i++) {
        const shapeOffs = i * 0x20 + shapeOffset;
        shapes.push( parseShape(buffer.slice(shapeOffs), buffer, i) );
    }

    // Node
    const nodes: MDL0Node[] = [];
    for (var i = 0; i < nodeCount; i++) {
        const nodeOffs = i * 0xF0 + nodeOffset;
        nodes.push( parseNode(buffer.slice(nodeOffs)) );
    }

    // MPH_Pallet
    const pals: MPHPal[] = [];
    for (let i = 0; i < palletCount; i++) {
        const palDataStart = palletOffset + i * 0x10;
        const plaDataEnd = palDataStart + 0x10;
        const pal = buffer.slice(palDataStart, plaDataEnd);
        pals.push({ pal });
    }

    // MPH_Texture
    const texs: MPHTex[] = [];
    for (let i = 0; i < textureCount; i++) {
        const texDataStart = i * 0x28 + textureOffset;
        const texDataEnd = texDataStart + 0x28;
        const tex = buffer.slice(texDataStart, texDataEnd);
        texs.push({ tex });
    }

    const mphTex = { pals, texs };

    let tex0: TEX0 | null = null;

    // Model
    const texMtxMode = TexMtxMode.MAYA; // Where?
    const sbcBuffer = buffer.slice(0, 0x10); // bummy sbc for reuse MDL0 codes
    const models: MDL0Model[] = [];
    const name = `model_0`;
    models.push({ name, nodes, materials, shapes, sbcBuffer, posScale, texMtxMode });

    return { models, tex0, mphTex };
}

export function parseTEX0Texture(buffer: ArrayBufferSlice, tex: MPHTexture): TEX0 {
    // Pallet
    const palettes: TEX0Palette[] = [];
    for (let i = 0; i < tex.pals.length; i++) {
        palettes.push(parsePallet(tex.pals[i].pal, buffer, i));
    }

    // Texture
    const textures: TEX0Texture[] = [];
    for (let i = 0; i < tex.texs.length; i++) {
        textures.push(parseTexture(tex.texs[i].tex, buffer, i));
    }

    return { textures, palettes };
}