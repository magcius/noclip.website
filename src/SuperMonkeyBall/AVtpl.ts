/*
 * AmusementVision's Texture format
 *
 * Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)
 */

import ArrayBufferSlice from '../ArrayBufferSlice';
import * as GX from '../gx/gx_enum';
import { TextureInputGX } from '../gx/gx_texture';
import { assert } from '../util';

// todo(complexplane): Just use TextureInputGX?
export interface AVTexture extends TextureInputGX {
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

export interface AVTpl {
    textures: AVTexture[];
}

function parseAvTplHeader(buffer: ArrayBufferSlice, prefix: number, idx: number, basebuffer: ArrayBufferSlice): AVTexture {
    let view = buffer.createDataView();

    assert(view.getUint16(0x0E) == 0x1234);
    const name = `texture_${prefix}_${idx}`;
    const format: GX.TexFormat = view.getUint32(0x00);
    const offs = view.getUint32(0x04);
    const width = view.getUint16(0x08);
    const height = view.getUint16(0x0A);
    const mipCount = view.getUint16(0x0C);
    const data = basebuffer.slice(offs);

    const paletteFormat: GX.TexPalette | null = null;
    const paletteData: ArrayBufferSlice | null = null;

    return { name, format, offs, width, height, mipCount, data, paletteFormat, paletteData };
}

export function parseAvTpl(buffer: ArrayBufferSlice, prefix: number): AVTpl {
    let view = buffer.createDataView();
    const textures: AVTexture[] = [];

    let entryCount = view.getUint32(0x00);
    let offs = 0x04;
    for (let i = 0; i < entryCount; i++) {
        const texture = parseAvTplHeader(buffer.slice(offs), prefix, i, buffer);
        offs += 0x10;
        if (texture.offs === 0 && texture.width === 0 && texture.height === 0 && texture.mipCount === 0) {
            continue;
        }
        textures.push(texture);
    }

    return { textures };
}
