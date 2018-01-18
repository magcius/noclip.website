
import * as GX2Texture from './gx2_texture';

import { assert, readString } from 'util';

function readBinPtrT(view: DataView, offs: number, littleEndian: boolean) {
    return offs + view.getUint32(offs, littleEndian);
}

interface ResDicEntry {
    name: string;
    offs: number;
}

function parseFTEX(buffer: ArrayBuffer, entry: ResDicEntry, littleEndian: boolean): GX2Texture.DecodedTexture {
    const offs = entry.offs;
    const view = new DataView(buffer);

    assert(readString(buffer, offs + 0x00, 0x04) === 'FTEX');
    // GX2 is Wii U which is a little-endian system.
    assert(!littleEndian);

    const gx2SurfaceOffs = offs + 0x04;
    const texDataOffs = readBinPtrT(view, offs + 0xB0, littleEndian);
    const mipDataOffs = readBinPtrT(view, offs + 0xB4, littleEndian);

    const surface = GX2Texture.parseGX2Surface(buffer, gx2SurfaceOffs);
    const texture = GX2Texture.decodeSurface(surface, buffer, texDataOffs, mipDataOffs);
    return texture;
}

interface TextureEntry {
    name: string;
    texture: GX2Texture.DecodedTexture;
}

export interface FRES {
    textures: TextureEntry[];
}

export function parse(buffer: ArrayBuffer): FRES {
    const view = new DataView(buffer);

    assert(readString(buffer, 0x00, 0x04) === 'FRES');

    let littleEndian;
    switch (view.getUint16(0x08, false)) {
    case 0xFEFF:
        littleEndian = false;
        break;
    case 0xFFFE:
        littleEndian = true;
        break;
    default:
        throw new Error("Invalid BOM");
    }

    const version = view.getUint32(0x04, littleEndian);

    // v3.5.0.3, as seen in Splatoon.
    assert(version === 0x03050003);

    const fileNameOffs = readBinPtrT(view, 0x14, littleEndian);
    const fileName = readString(buffer, fileNameOffs, 0xFF);

    function parseResDic(idx: number) {
        const tableOffs = readBinPtrT(view, 0x20 + idx * 0x04, littleEndian);
        const tableCount = view.getUint16(0x50 + idx * 0x02, littleEndian);

        const tableSize = view.getUint32(tableOffs + 0x00, littleEndian);
        const tableCount2 = view.getUint32(tableOffs + 0x04, littleEndian);
        assert(tableCount === tableCount2);

        const entries: ResDicEntry[] = [];

        let tableIdx = tableOffs + 0x08;
        // Skip root entry.
        tableIdx += 0x10;
        for (let i = 0; i < tableCount; i++) {
            // There's a fancy search tree in here which I don't care about at all...
            const name = readString(buffer, readBinPtrT(view, tableIdx + 0x08, littleEndian), 0xFF);
            const offs = readBinPtrT(view, tableIdx + 0x0C, littleEndian);
            entries.push({ name, offs });
            tableIdx += 0x10;
        }

        return entries;
    }

    const fmdlTable = parseResDic(0x00);
    const ftexTable = parseResDic(0x01);

    const textures: TextureEntry[] = [];
    for (const entry of ftexTable) {
        // Decode textures.
        const texture = parseFTEX(buffer, entry, littleEndian);
        const textureEntry = { name: entry.name, texture };
        textures.push(textureEntry);
    }

    return { textures };
}
