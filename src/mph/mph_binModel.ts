import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexMtxMode, TEX0, fx32, TEX0Texture, TEX0Palette, MDL0Model, MDL0Material, MDL0Shape, MDL0Node } from "../nns_g3d/NNS_G3D";
import { GfxCullMode } from "../gfx/platform/GfxPlatform";
import { mat4, mat2d } from "gl-matrix";
import { Color } from "../SuperMario64DS/nitro_gx";
import { Butler } from "../SuperMarioGalaxy/MiscActor";
import { Format } from "../SuperMario64DS/nitro_tex";
import { VertexData } from "../SuperMario64DS/render";

export interface MPHbin {
    models: MDL0Model[];
    tex0: TEX0 | null;
}

function parseModel(buffer: ArrayBufferSlice): MDL0Model {
    const view = buffer.createDataView();

    const posScale = fx32(view.getInt32(0x04, true));

    const countMaterial = view.getUint16(0x48, true);
    const countNode = view.getUint16(0x4A, true);

    const countMesh = view.getUint16(0x60, true);
    const countMatrix = view.getUint16(0x62, true);

    const materials: MDL0Material[] = [];

    const shapes: MDL0Shape[] = [];

    const nodes: MDL0Node[] = [];

    const texMtxMode = TexMtxMode.MAYA; // Where?

    const sbcBuffer = buffer.slice(0, 0x10); // What?

    return { name, nodes, materials, shapes, sbcBuffer, posScale, texMtxMode };
}


function parseTexture(buffer: ArrayBufferSlice): TEX0 {
    const view = buffer.createDataView();




    const palettes: TEX0Palette[] = [];
    //for (const paletteDictEntry of paletteDict) {
    //    const name = paletteDictEntry.name;
    //    const data = paletteDictEntry.value.data;
    //    palettes.push({ name, data });
    //}

    const textureOffs = view.getUint32(0x2C, true);
    const textureCount = view.getUint32(0x30, true);

    const sectionZise = 0x28;
    const textures: TEX0Texture[] = [];
    for (var i = 0; i < textureCount; i++) {
        const textureOffset = i * sectionZise + textureOffs;
        const mph_format = view.getUint16(textureOffset + 0x00, true);
        const format = convertMPHTexToNitroTex(mph_format);
        const width = view.getUint16(textureOffset + 0x02, true);
        const height = view.getUint16(textureOffset + 0x04, true);
        const textureDataOffs = view.getUint32(textureOffset + 0x08, true);
        const textureDataSize = view.getUint32(textureOffset + 0x0C, true);
        const unk_0x10 = view.getUint32(textureOffset + 0x10, true);
        const unk_0x14 = view.getUint32(textureOffset + 0x14, true);
        const unk_0x18 = view.getUint32(textureOffset + 0x18, true);
        const unk_0x1C = view.getUint32(textureOffset + 0x1C, true);
        const unk_0x20 = view.getUint32(textureOffset + 0x20, true);
        const unk_0x24 = view.getUint32(textureOffset + 0x24, true);

        const color0 = true;

        const textureDataStart = textureDataOffs;
        const textureDataEnd = textureDataOffs + textureDataSize;
        const texData = buffer.slice(textureDataStart, textureDataEnd);

        const palIdxData = null; // For waht?

        textures.push({ name, format, width, height, color0, texData, palIdxData });
    }

    // convert MPH Texture Format to Nitro Texture
    function convertMPHTexToNitroTex(format: number): Format {
        switch (format) {
            case 0: //                                    mph -> nns
                return Format.Tex_Palette4;   // 2Bpp      0      2
            case 1: 
                return Format.Tex_Palette16;  // 4Bpp      1      3
            case 2:
                return Format.Tex_Direct;     // 8Bpp      2      7
            case 3:
                return Format.Tex_CMPR_4x4;   // 4x4       3      5
            case 4:
                return Format.Tex_A3I5;       // A3I5      4      1
            case 5:
                return Format.Tex_Palette256; // 16Bpp     5      4
            case 6:
                Format.Tex_A5I3;              // A5I3      6      6
            default:
                return Format.Tex_None;
        }
    }

    return { textures, palettes };
}

export function parseMPH_Model(buffer: ArrayBufferSlice): MPHbin {
    const view = buffer.createDataView();

    const models: MDL0Model[] = [];
    models.push(parseModel(buffer));

    // Textures
    let tex0: TEX0 | null = null;
    tex0 = parseTexture(buffer);

    return { models, tex0 };
}