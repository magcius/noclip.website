
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { parseResDictGeneric } from "./nsbmd";
import * as NITRO_TEX from "../sm64ds/nitro_tex";

export interface TEX0Texture {
    name: string;
    format: NITRO_TEX.Format;
    width: number;
    height: number;
    color0: boolean;
    data: ArrayBufferSlice;
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
    const size = view.getUint32(0x04);

    const textureDictOffs = view.getUint16(0x0E, true);
    const textureDataOffs = view.getUint32(0x14, true);
    const textureDict = parseResDictGeneric(buffer, textureDictOffs, (view, entryTableIdx) => {
        const texImageParamW0 = view.getUint32(entryTableIdx + 0x00, true);
        const texImageParam = NITRO_TEX.parseTexImageParam(texImageParamW0);
        const dataStart = textureDataOffs + (8 << (texImageParamW0 & 0x7F));
        const data = buffer.slice(dataStart);
        return { data, texImageParam };
    });

    const paletteDictOffs = view.getUint16(0x0E, true);
    const paletteDataOffs = view.getUint32(0x14, true);
    const paletteDict = parseResDictGeneric(buffer, paletteDictOffs, (view, entryTableIdx) => {
        const dataStart = paletteDataOffs + (8 << view.getUint16(entryTableIdx + 0x00, true));
        const data = buffer.slice(dataStart);
        return { data };
    });

    const textures: TEX0Texture[] = [];
    for (const textureDictEntry of textureDict) {
        const name = textureDictEntry.name;
        const { format, width, height, color0 } = textureDictEntry.value.texImageParam;
        const data = textureDictEntry.value.data;
        textures.push({ name, format, width, height, color0, data });
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
    assert(version === 0x02);
    const fileSize = view.getUint32(0x08, true);
    assert(view.getUint16(0x0C, true) === 0x10);
    const dataBlocks = view.getUint16(0x0E, true);
    assert(dataBlocks === 1);
    
    const tex0Offs = view.getUint32(0x10, true);
    const tex0 = parseTex0Block(buffer.slice(tex0Offs));

    return { tex0 };
}
