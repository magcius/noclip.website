
// Nitro System Binary TeXture

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { parseResDictGeneric } from "./nsbmd";
import * as NITRO_TEX from "../SuperMario64DS/nitro_tex";

export interface TEX0Texture {
    name: string;
    format: NITRO_TEX.Format;
    width: number;
    height: number;
    color0: boolean;
    texData: ArrayBufferSlice;
    palIdxData: ArrayBufferSlice | null;
}

export interface TEX0Palette {
    name: string;
    data: ArrayBufferSlice;
}

export interface TEX0 {
    textures: TEX0Texture[];
    palettes: TEX0Palette[];
}

export function parseTex0Block(buffer: ArrayBufferSlice): TEX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) == 'TEX0');
    const size = view.getUint32(0x04, true);

    const textureSize = view.getUint16(0x0C, true);
    const textureDictOffs = view.getUint16(0x0E, true);
    const textureDataOffs = view.getUint32(0x14, true);

    const tex4x4Size = view.getUint16(0x1C, true);
    const tex4x4DataOffs = view.getUint32(0x24, true);
    const tex4x4PalIdxDataOffs = view.getUint32(0x28, true);

    const textureDict = parseResDictGeneric(buffer, textureDictOffs, (view, entryTableIdx) => {
        const texImageParamW0 = view.getUint32(entryTableIdx + 0x00, true);
        const texImageParam = NITRO_TEX.parseTexImageParam(texImageParamW0);
        let texData: ArrayBufferSlice;
        let palIdxData: ArrayBufferSlice | null = null;

        const imageOffs = (texImageParamW0 & 0xFFFF) << 3;
        if (texImageParam.format === NITRO_TEX.Format.Tex_CMPR_4x4) {
            const texDataStart = tex4x4DataOffs + imageOffs;
            const palIdxDataStart = tex4x4PalIdxDataOffs + (imageOffs >>> 1);
            texData = buffer.slice(texDataStart);
            palIdxData = buffer.slice(palIdxDataStart);
        } else {
            const texDataStart = textureDataOffs + imageOffs;
            texData = buffer.slice(texDataStart);
        }

        return { texData, palIdxData, texImageParam };
    });

    const paletteDictOffs = view.getUint16(0x34, true);
    const paletteDataOffs = view.getUint32(0x38, true);
    const paletteDict = parseResDictGeneric(buffer, paletteDictOffs, (view, entryTableIdx) => {
        const dataStart = paletteDataOffs + (view.getUint16(entryTableIdx + 0x00, true) << 3);
        const data = buffer.slice(dataStart);
        return { data };
    });

    const textures: TEX0Texture[] = [];
    for (const textureDictEntry of textureDict) {
        const name = textureDictEntry.name;
        const { format, width, height, color0 } = textureDictEntry.value.texImageParam;
        const { texData, palIdxData } = textureDictEntry.value;
        textures.push({ name, format, width, height, color0, texData, palIdxData });
    }

    const palettes: TEX0Palette[] = [];
    for (const paletteDictEntry of paletteDict) {
        const name = paletteDictEntry.name;
        const data = paletteDictEntry.value.data;
        palettes.push({ name, data });
    }

    return { textures, palettes };
}

export interface BTX0 {
    tex0: TEX0;
}

export function parse(buffer: ArrayBufferSlice): BTX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x06) === 'BTX0\xFF\xFE');
    const version = view.getUint16(0x06, true);
    assert(version === 0x01);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1);
    
    const tex0Offs = view.getUint32(0x10, true);
    const tex0 = parseTex0Block(buffer.slice(tex0Offs));

    return { tex0 };
}
