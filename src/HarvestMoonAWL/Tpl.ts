// Texture PaLette container
// Has some duplication with Paper Mario TTYD, keeping this separate as it's a small file.

import * as GX from '../gx/gx_enum.js';
import * as GX_Texture from '../gx/gx_texture.js';

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert } from "../util.js";

//#region Records

export interface TplTexture extends GX_Texture.TextureInputGX {
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    lodBias: number;
    edgeLOD: number;
    minLOD: number;
    maxLOD: number;
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice | null;
}

export interface Tpl {
    textures: TplTexture[];
}

//#endregion

//#region Parsing

export function parse(buffer: ArrayBufferSlice, textureNames?: string[]): Tpl {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x0020AF30);
    const numTextures = view.getUint32(0x04);
    const headerSize = view.getUint32(0x08);
    assert(headerSize === 0x0C);

    let textureTableIdx = headerSize;
    const textures: TplTexture[] = [];
    for (let i = 0; i < numTextures; i++) {
        const textureOffs = view.getUint32(textureTableIdx + 0x00);
        const paletteOffs = view.getUint32(textureTableIdx + 0x04);
        textureTableIdx += 0x08;
        assert(textureOffs !== 0);

        const height = view.getUint16(textureOffs + 0x00);
        const width = view.getUint16(textureOffs + 0x02);
        const format = view.getUint32(textureOffs + 0x04);
        const dataOffs = view.getUint32(textureOffs + 0x08);
        const wrapS = view.getUint32(textureOffs + 0x0C);
        const wrapT = view.getUint32(textureOffs + 0x10);
        const minFilter = view.getUint32(textureOffs + 0x14);
        const magFilter = view.getUint32(textureOffs + 0x18);
        const lodBias = view.getFloat32(textureOffs + 0x1C);
        const edgeLOD = view.getUint8(textureOffs + 0x20);
        const minLOD = view.getUint8(textureOffs + 0x21);
        const maxLOD = view.getUint8(textureOffs + 0x22);

        const mipCount = Math.max(1, (maxLOD - minLOD) + 1);
        const data = buffer.subarray(dataOffs);

        let paletteData: ArrayBufferSlice | null = null;
        let paletteFormat: GX.TexPalette = GX.TexPalette.IA8;
        if (paletteOffs !== 0) {
            paletteFormat = view.getUint32(paletteOffs + 0x04);
            const paletteDataOffs = view.getUint32(paletteOffs + 0x08);
            const paletteDataSize = GX_Texture.calcPaletteSize(format, paletteFormat);
            paletteData = buffer.subarray(paletteDataOffs, paletteDataSize);
        }

        const name = textureNames !== undefined && textureNames[i] !== undefined ? textureNames[i] : `Texture${i}`;

        textures.push({
            name, mipCount, data, width, height, format,
            wrapS, wrapT, minFilter, magFilter,
            lodBias, edgeLOD, minLOD, maxLOD,
            paletteFormat, paletteData,
        });
    }

    return { textures };
}

//#endregion
