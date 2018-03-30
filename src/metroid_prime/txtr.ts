
// Implements Retro's TXTR (texture) format as seen in Metroid Prime 1.

import { ResourceSystem } from './resource';

import * as GX from 'gx/gx_enum';
import * as GX_Texture from 'gx/gx_texture';
import ArrayBufferSlice from 'ArrayBufferSlice';

const txtrFormatRemap = [
    GX.TexFormat.I4,     // 0x00
    GX.TexFormat.I8,     // 0x01
    GX.TexFormat.IA4,    // 0x02
    GX.TexFormat.IA8,    // 0x03
    GX.TexFormat.C4,     // 0x04
    GX.TexFormat.C8,     // 0x05
    GX.TexFormat.C14X2,  // 0x06
    GX.TexFormat.RGB565, // 0x07
    GX.TexFormat.RGB5A3, // 0x08
    GX.TexFormat.RGBA8,  // 0x09
    GX.TexFormat.CMPR,   // 0x0A
];

export interface TXTR {
    format: GX.TexFormat;
    width: number;
    height: number;
    mipCount: number;
    data: ArrayBufferSlice;
    dataStart: number;
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice;
}

export function parse(resourceSystem: ResourceSystem, buffer: ArrayBufferSlice): TXTR {
    const view = buffer.createDataView();

    const txtrFormat = view.getUint32(0x00);
    const format: GX.TexFormat = txtrFormatRemap[txtrFormat];
    const width = view.getUint16(0x04);
    const height = view.getUint16(0x06);
    const mipCount = view.getUint32(0x08);

    let offs = 0x0C;

    let paletteFormat: GX.TexPalette = 0;
    let paletteData: ArrayBufferSlice = null;

    switch (format) {
    case GX.TexFormat.C4:
    case GX.TexFormat.C8:
        paletteFormat = view.getUint32(offs + 0x00);
        const palWidth: number = view.getUint32(offs + 0x04);
        const palHeight: number = view.getUint32(offs + 0x06);
        offs += 0x08;
        const palSize = GX_Texture.calcPaletteSize(format, paletteFormat);
        paletteData = buffer.slice(offs, offs + palSize);
        offs += palSize;
    case GX.TexFormat.C14X2:
        throw "whoops";
    }

    const dataStart = offs;
    const data = buffer;
    return { format, width, height, mipCount, data, dataStart, paletteFormat, paletteData };
}
