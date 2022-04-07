// AmusementVision's texture format
// Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)

import ArrayBufferSlice from "../ArrayBufferSlice";
import * as GX from "../gx/gx_enum";
import { TextureInputGX } from "../gx/gx_texture";
import { assert, leftPad } from "../util";

function parseAVTplHeader(
    texHeaderBuffer: ArrayBufferSlice,
    tplName: string,
    idx: number,
    tplBuffer: ArrayBufferSlice
): TextureInputGX {
    let view = texHeaderBuffer.createDataView();

    assert(view.getUint16(0x0e) == 0x1234);
    const name = `${tplName}_${leftPad(idx.toString(), 3, "0")}`;
    const format: GX.TexFormat = view.getUint32(0x00);
    const offs = view.getUint32(0x04);
    const width = view.getUint16(0x08);
    const height = view.getUint16(0x0a);
    const mipCount = view.getUint16(0x0c);
    const data = tplBuffer.slice(offs);

    const paletteFormat: GX.TexPalette | null = null;
    const paletteData: ArrayBufferSlice | null = null;

    return { name, format, width, height, mipCount, data, paletteFormat, paletteData };
}

// Not every texture index is filled as some textures may be invalid
export type AVTpl = Map<number, TextureInputGX>;

export function parseAVTpl(buffer: ArrayBufferSlice, tplName: string): AVTpl {
    let view = buffer.createDataView();
    const textures: AVTpl = new Map();

    let entryCount = view.getUint32(0x00);
    let offs = 0x04;
    for (let i = 0; i < entryCount; i++) {
        const texture = parseAVTplHeader(buffer.slice(offs), tplName, i, buffer);
        offs += 0x10;
        if (texture.width === 0 && texture.height === 0 && texture.mipCount === 0) {
            continue;
        }
        textures.set(i, texture);
    }

    return textures;
}
