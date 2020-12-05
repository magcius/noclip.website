
// AmusementVision's Texture format

import * as GX from '../gx/gx_enum';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert } from '../util';

export interface AVTexture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    mipCount: number;
    data: ArrayBufferSlice;
    paletteFormat: GX.TexPalette | null;
    paletteData: ArrayBufferSlice | null;
}

export interface AVTpl{
    count: number;
    textures: AVTexture[];
}

function parseAvTplHeader(buffer: ArrayBufferSlice, idx:number): AVTexture {
    let view = buffer.createDataView();

    assert(view.getUint16(0x0E) == 0x1234);
    const name = "texture_"+idx;
    const format: GX.TexFormat = view.getUint32(0x00);
    const offs = view.getUint32(0x04);
    const width = view.getUint16(0x08);
    const height = view.getUint16(0x0A);
    const mipCount = view.getUint16(0x0C);

    const data = buffer.slice(offs);
    
    const paletteFormat:GX.TexPalette  | null = null;
    const paletteData:ArrayBufferSlice | null = null;


    return { name, format, width, height, mipCount, data, paletteFormat, paletteData };
}

export function parseAvTpl(buffer: ArrayBufferSlice):AVTpl {
    let view = buffer.createDataView();
    const textures: AVTexture[] = [];

    let count = view.getUint32(0x00);

    for (let i = 0; i < count; i++){
        const texture = parseAvTplHeader(buffer.slice(0x04), i);
        textures.push( texture );
    }

    return { count, textures };
}