
// AmusementVision's Texture format

import * as GX from '../gx/gx_enum';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert } from '../util';

export interface AVTexture {
    name: string;
    format: GX.TexFormat;
    offs: number;
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

function parseAvTplHeader(buffer: ArrayBufferSlice, idx:number, basebuffer: ArrayBufferSlice): AVTexture {
    let view = buffer.createDataView();

    assert(view.getUint16(0x0E) == 0x1234);
    const name = `texture_`+idx;
    const format: GX.TexFormat = view.getUint32(0x00);
    const offs = view.getUint32(0x04);
    const width = view.getUint16(0x08);
    const height = view.getUint16(0x0A);
    const mipCount = view.getUint16(0x0C);
    const data = basebuffer.slice(offs);
    
    const paletteFormat:GX.TexPalette  | null = null;
    const paletteData:ArrayBufferSlice | null = null;

    return { name, format, offs, width, height, mipCount, data, paletteFormat, paletteData };
}

export function parseAvTpl(buffer: ArrayBufferSlice):AVTpl {
    let view = buffer.createDataView();
    const textures: AVTexture[] = [];

    let entryCount = view.getUint32(0x00);
    let enableCount = 0;
    for (let i = 0; i < entryCount; i++){
        let offs = 0x10 * i + 0x04;
        const texture = parseAvTplHeader(buffer.slice(offs), i, buffer);
        if (texture.offs === 0 && texture.width === 0 && texture.height === 0 && texture.mipCount === 0){
            continue;
        }
        textures.push( texture );
        enableCount++;
    }
    const count = enableCount;

    return { count, textures };
}