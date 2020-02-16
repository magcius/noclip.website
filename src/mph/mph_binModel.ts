import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexMtxMode, TEX0, fx32, TEX0Texture, TEX0Palette, MDL0Material, MDL0Shape, MDL0Node, MDL0Model, calcTexMtx, fx16 } from "../nns_g3d/NNS_G3D";
import { mat4, mat2d, mat2, mat3, vec3 } from "gl-matrix";
import { Format } from "../SuperMario64DS/nitro_tex";
import { readString } from "../util";
import { colorNew } from "../Color";
import { fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";

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

interface MPHNode {
    name: string;
    parent: number;
    child: number;
    next: number;
    meshID: number;
    node_transform: mat4;
}

interface MPHPal {
    pal: ArrayBufferSlice;
}

interface MPHTex {
    tex: ArrayBufferSlice;
    width: number;
    height: number;
    color0: boolean;
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
    const palletIndex = view.getUint16(0x44, true);
    const textureIndex = view.getUint16(0x46, true);
    const texParams = view.getUint16(0x48, true);
    const diffuse = colorNew(view.getInt8(0x4A), view.getInt8(0x4B), view.getInt8(0x4C));
    const ambient = colorNew(view.getInt8(0x4D), view.getInt8(0x4E), view.getInt8(0x4F));
    const specular = colorNew(view.getInt8(0x50), view.getInt8(0x51), view.getInt8(0x52));
    const field_0x53 = view.getInt8(0x53);
    const polyAttribs = view.getInt32(0x54, true);

    const texcoord_transform_mode = view.getInt32(0x5C, true);
    const texcoord_animation_id = view.getInt32(0x60, true);
    const matrix_id = view.getInt32(0x64, true);
    const scaleS = fx32(view.getInt32(0x68, true));
    const scaleT = fx32(view.getInt32(0x6C, true));
    const rot_Z = fx16(view.getUint16(0x70, true));
    const field_0x72 = view.getInt16(0x72, true);
    const scaleWidth = fx32(view.getInt32(0x74, true));
    const scaleHeight = fx32(view.getInt32(0x78, true));
    const material_animation_id = 0;
    const field_0x7E = view.getInt16(0x7E, true);
    const packed_repeat_mode = view.getInt8(0x80);
    const field_0x81 = view.getInt8(0x81);
    const field_0x82 = view.getInt16(0x82, true);

    let textureName; 
    let paletteName;

    const texMatrix = mat2d.create();

    let width;
    let height;
    if (palletIndex == 0xFFFF || textureIndex == 0xFFFF) {
        paletteName = null;
        textureName = null;
        width = 1.0;
        height = 1.0;
    } else {
        //texs[textureIndex].color0 = true;
        paletteName = `pallet_${palletIndex}`;
        textureName = `texture_${textureIndex}`;
        width = texs[textureIndex].width;
        height = texs[textureIndex].height;
    }
    let cosR = 1.0;
    let sinR = 0.0;

    if (Math.abs(rot_Z) > 0) {
        const theta = rot_Z;
        sinR = Math.sin(theta);
        cosR = Math.cos(theta);
    }

    const texScaleS = 1 / width;
    const texScaleT = 1 / height;

    const translationS = scaleWidth * width;
    const translationT = scaleHeight * height;

    calcTexMtx(texMatrix, TexMtxMode.MAYA, texScaleS, texScaleT, scaleS, scaleT, sinR, cosR, translationS, translationT);

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

function parseNode(buffer: ArrayBufferSlice): MPHNode {
    const view = buffer.createDataView();

    let vec1 = vec3.create();
    let vec2 = vec3.create();
    const node_transform = mat4.create();
    const name = readString(buffer, 0x00, 0x40, true);
    const parent = view.getInt16(0x40, true);
    const child = view.getInt16(0x42, true);
    const next = view.getInt16(0x44, true);
    const field_0x46 = view.getInt16(0x46, true);
    const enabled = view.getInt32(0x48, true);
    const mesh_count = view.getInt16(0x4C, true);
    const meshID = view.getInt16(0x4E, true);
    const field_0x50 = view.getInt32(0x50, true);
    const field_0x54 = view.getInt32(0x54, true);
    const field_0x58 = view.getInt32(0x58, true);
    const field_0x5C = view.getInt16(0x54, true);
    const field_0x5E = view.getInt16(0x5E, true);
    const field_0x60 = view.getInt16(0x60, true);
    const field_0x62 = view.getInt16(0x62, true);
    const field_0x64 = view.getInt32(0x64, true);
    const field_0x68 = view.getInt32(0x68, true);
    const field_0x6C = view.getInt32(0x6C, true);
    const field_0x70 = view.getInt32(0x70, true);

    vec3.set(vec1, fx32(view.getInt32(0x74, true)), fx32(view.getInt32(0x78, true)), fx32(view.getInt32(0x7C, true)));
    vec3.set(vec2, fx32(view.getInt32(0x80, true)), fx32(view.getInt32(0x84, true)), fx32(view.getInt32(0x88, true)));

    const type = view.getUint8(0x8C);
    const field_8D = view.getInt8(0x8D);
    const field_8E = view.getInt16(0x8E, true);

    node_transform[15] = 1;

    node_transform[0] = fx32(view.getInt32(0x90, true));
    node_transform[4] = fx32(view.getInt32(0x94, true));
    node_transform[8] = fx32(view.getInt32(0x98, true));

    node_transform[1] = fx32(view.getInt32(0x9C, true));
    node_transform[5] = fx32(view.getInt32(0xA0, true));
    node_transform[9] = fx32(view.getInt32(0xA4, true));

    node_transform[2] = fx32(view.getInt32(0xA8, true));
    node_transform[6] = fx32(view.getInt32(0xAC, true));
    node_transform[10] = fx32(view.getInt32(0xB0, true));

    node_transform[3] = fx32(view.getInt32(0xB4, true));
    node_transform[7] = fx32(view.getInt32(0xB8, true));
    node_transform[11] = fx32(view.getInt32(0xBC, true));

    const field_0xC0 = view.getInt32(0xC0, true);
    const field_0xC4 = view.getInt32(0xC4, true);
    const field_0xC8 = view.getInt32(0xC8, true);
    const field_0xCC = view.getInt32(0xCC, true);
    const field_0xD0 = view.getInt32(0xD0, true);
    const field_0xD4 = view.getInt32(0xD4, true);
    const field_0xD8 = view.getInt32(0xD8, true);
    const field_0xDC = view.getInt32(0xDC, true);
    const field_0xE0 = view.getInt32(0xE0, true);
    const field_0xE4 = view.getInt32(0xE4, true);
    const field_0xE8 = view.getInt32(0xE8, true);
    const field_0xEC = view.getInt32(0xEC, true);

    return { name, parent, child, next, meshID, node_transform };
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
    const mph_format = view.getInt8(0x00);
    const field_0x01 = view.getInt8(0x01);
    const width = view.getUint16(0x02, true);
    const height = view.getUint16(0x04, true);
    const field_0x06 = view.getUint16(0x06, true);
    const textureDataOffs = view.getUint32(0x08, true);
    const textureDataSize = view.getInt32(0x0C, true);
    const field_0x10 = view.getUint32(0x10, true);
    const field_0x14 = view.getUint32(0x14, true);
    const vram_offset = view.getInt32(0x18, true);
    const opaque = view.getInt32(0x1C, true);
    const some_value = view.getInt32(0x20, true);
    const packed_size = view.getUint8(0x24);
    const native_texture_format = view.getUint8(0x25);
    const texture_obj_ref = view.getInt16(0x26, true);

    const format = convertMPHTexToNitroTex(mph_format);
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
        const color0 = false;
        texs.push({ tex, width, height, color0 });
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
    const MPHNode: MPHNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const nodeOffs = i * 0xF0 + nodeOffset;
        MPHNode.push( parseNode(buffer.slice(nodeOffs)) );
    }
    const nodes: MDL0Node[] = [];

    const mphTex = { pals, texs };

    let tex0: TEX0 | null = null;

    // Model
    const texMtxMode = TexMtxMode.MAYA;
    const sbcBuffer = buffer.slice(0, 0x10); // dummy sbc for reuse MDL0 codes
    const models: MDL0Model[] = [];
    const name = `model_0`;

    const jointMatrix = mat4.create();
    nodes.push({ name, jointMatrix });

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
        textures[i].color0 = !!tex.texs[i].color0;
    }

    return { textures, palettes };
}