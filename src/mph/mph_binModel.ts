import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexMtxMode, TEX0, fx32, TEX0Texture, TEX0Palette, MDL0Material, MDL0Shape, MDL0Node, MDL0Model } from "../nns_g3d/NNS_G3D";
import { mat4, mat2d, mat2 } from "gl-matrix";
import { Format } from "../SuperMario64DS/nitro_tex";
import { readString } from "../util";

export interface MPHbin {
    models: MDL0Model[];
    tex0: TEX0 | null;
    mphTex: MPHTexture;
    meshs: MPHMesh[];
    mtx_shmat: number;
}

interface MPHMesh {
    matID: number;
    shapeID: number;
}

interface MPHPal {
    pal: ArrayBufferSlice;
}

interface MPHTex {
    tex: ArrayBufferSlice;
    width: number;
    height: number;
}

export interface MPHTexture {
    pals: MPHPal[];
    texs: MPHTex[];
}

function parseMaterial(buffer: ArrayBufferSlice, texs:MPHTex[]): MDL0Material {
    const view = buffer.createDataView();

    const name = readString(buffer, 0x00, 0x40, true);

    const cullMode = view.getUint8(0x41);
    const alpha = view.getInt8(0x42);
    const wireFrame = view.getInt8(0x43);
    const palID = view.getUint16(0x44, true);
    let palletIndex;
    if (palID == 0xFFFF) {
        palletIndex = 0;
    } else {
        palletIndex = palID;
    }
    const texID = view.getUint16(0x46, true);
    let textureIndex;
    if (texID == 0xFFFF) {
        textureIndex = 0;
    } else {
        textureIndex = texID;
    }

    const texParams = view.getUint16(0x48, true);

    const polyAttribs = view.getInt32(0x54, true);

    const texScaleS = view.getInt16(0x64, true);
    const texScaleT = view.getInt16(0x68, true);

    const scaleWidth = view.getInt16(0x74, true);
    const scaleHeight = view.getInt16(0x78, true);
    const rot_Z = view.getInt16(0x7C, true);

    //const mat44 = mat4.create();



    //function setup_texcoord_matrix(dst: mat4, scale_s:number, scale_t:number, rot_z:number, scale_width:number, scale_height:number, width:number, height:number) {
    //    const scaled_width = width * scaleWidth;
    //    const scaled_height = height * scaleHeight;

    //    if (rot_z) {

    //    } else {

    //    }
    //}


    const m00 = 1 / texs[textureIndex].width;
    const m01 = 0;
    const m10 = 0;
    const m11 = 1 / texs[textureIndex].height;
    const tx = 0;
    const ty = 0;
    const texMatrix = mat2d.create();
    mat2d.set(texMatrix, m00, m01, m10, m11, tx, ty);

    const textureName = `texture_${textureIndex}`; 
    const paletteName = `pallet_${palletIndex}`;

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

function parseMesh(buffer: ArrayBufferSlice): MPHMesh {
    const view = buffer.createDataView();

    const matID = view.getUint16(0x00, true);
    const shapeID = view.getUint16(0x02, true);

    return { matID, shapeID }
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
                return Format.Tex_Palette256; // 8Bpp      2      4
            case 3:
                return Format.Tex_CMPR_4x4;   // 4x4       3      5
            case 4:
                return Format.Tex_A5I3;       // A5I3      4      6
            case 5:
                return Format.Tex_Direct      // 16Bpp     5      7
            case 6:
                return Format.Tex_A3I5;       // A3I5      6      1
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
    const meshOffset = view.getUint32(0x24, true);
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


    // Mesh
    const meshs: MPHMesh[] = [];
    for (let i = 0; i < meshCount; i++) {
        const meshOffs = i * 0x04 + meshOffset;
        meshs.push( parseMesh(buffer.slice(meshOffs)) );
    }

    // MPH_Texture
    const texs: MPHTex[] = [];
    for (let i = 0; i < textureCount; i++) {
        const texDataStart = i * 0x28 + textureOffset;
        const texDataEnd = texDataStart + 0x28;
        const tex = buffer.slice(texDataStart, texDataEnd);
        const width = view.getInt16(texDataStart+0x2, true);
        const height = view.getInt16(texDataStart + 0x4, true);
        texs.push({ tex, width, height });
    }

    // MPH_Pallet
    const pals: MPHPal[] = [];
    for (let i = 0; i < palletCount; i++) {
        const palDataStart = palletOffset + i * 0x10;
        const plaDataEnd = palDataStart + 0x10;
        const pal = buffer.slice(palDataStart, plaDataEnd);
        pals.push({ pal });
    }

    // Material
    const materials: MDL0Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const matOffs = i * 0x84 + materialOffset;

        materials.push( parseMaterial(buffer.slice(matOffs), texs) );
    }

    // Dlist
    const shapes: MDL0Shape[] = [];
    for (let i = 0; i < meshCount; i++) {
        const shapeOffs = i * 0x20 + shapeOffset;
        shapes.push( parseShape(buffer.slice(shapeOffs), buffer, i) );
    }

    // Node
    const nodes: MDL0Node[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const nodeOffs = i * 0xF0 + nodeOffset;
        nodes.push( parseNode(buffer.slice(nodeOffs)) );
    }
    const mphTex = { pals, texs };

    let tex0: TEX0 | null = null;

    // Model
    const texMtxMode = TexMtxMode.MAYA; // Where?
    const sbcBuffer = buffer.slice(0, 0x10); // bummy sbc for reuse MDL0 codes
    const models: MDL0Model[] = [];
    const name = `model_0`;
    models.push({ name, nodes, materials, shapes, sbcBuffer, posScale, texMtxMode });

    return { models, tex0, mphTex, meshs, mtx_shmat };
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