
// Implements Retro's TXTR (texture) format as seen in Metroid Prime 1.

import { ResourceSystem } from './resource';

import * as GX from '../gx/gx_enum';
import * as GX_Texture from '../gx/gx_texture';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { InputStream } from './stream';

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
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    mipCount: number;
    data: ArrayBufferSlice;
    paletteFormat: GX.TexPalette;
    paletteData: ArrayBufferSlice | null;
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string): TXTR {
    const txtrFormat = stream.readUint32();
    const name = resourceSystem.findResourceNameByID(assetID);
    const format: GX.TexFormat = txtrFormatRemap[txtrFormat];
    const width = stream.readUint16();
    const height = stream.readUint16();
    const mipCount = stream.readUint32();

    let paletteFormat: GX.TexPalette = 0;
    let paletteData: ArrayBufferSlice | null = null;

    switch (format) {
    case GX.TexFormat.C4:
    case GX.TexFormat.C8:
        paletteFormat = stream.readUint32();
        const palWidth: number = stream.readUint16();
        const palHeight: number = stream.readUint16();
        const palSize = GX_Texture.calcPaletteSize(format, paletteFormat);
        paletteData = stream.getBuffer().slice(stream.tell(), stream.tell() + palSize);
        stream.skip(palSize);
        break;

    case GX.TexFormat.C14X2:
        throw "whoops";
    }

    const data = stream.getBuffer().slice(stream.tell());
    return { name, format, width, height, mipCount, data, paletteFormat, paletteData };
}
