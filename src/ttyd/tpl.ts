
// Nintendo's "TPL" ("Texture PaLette") format.

import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";

export interface TPLTexture extends GX_Texture.Texture {
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    lodBias: number;
    edgeLOD: number;
    minLOD: number;
    maxLOD: number;
}

export interface TPL {
    textures: TPLTexture[];
}

export function parse(buffer: ArrayBufferSlice, textureNames?: string[]): TPL {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) === 0x0020AF30);
    const numTextures = view.getUint32(0x04);
    const headerSize = view.getUint32(0x08);
    assert(headerSize === 0x0C);

    if (textureNames !== undefined)
        assert(textureNames.length === numTextures);

    let textureTableIdx = headerSize;
    const textures: TPLTexture[] = [];
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
    
        // TODO(jstpierre): Is this right?
        const mipCount = (maxLOD - minLOD) + 1;
        const size = GX_Texture.calcTextureSize(format, width, height);
        const data = buffer.subarray(dataOffs, size);

        let paletteData: ArrayBufferSlice = undefined;
        let paletteFormat: GX.TexPalette = undefined;
        if (paletteOffs !== 0) {
            const nItems = view.getUint16(paletteOffs + 0x00);
            paletteFormat = view.getUint16(paletteOffs + 0x06);
            const paletteDataOffs = view.getUint16(paletteOffs + 0x0A);
            const paletteDataSize = GX_Texture.calcPaletteSize(format, paletteFormat);
            paletteData = buffer.subarray(paletteDataOffs, paletteDataSize);
        }

        const name = textureNames !== undefined ? textureNames[i] : `Texture${i}`;

        textures.push({
            name, mipCount, data, width, height, format,
            wrapS, wrapT, minFilter, magFilter,
            lodBias, edgeLOD, minLOD, maxLOD,
            paletteFormat, paletteData,
        });
    }

    return { textures };
}
