
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, readString } from "../../util";
import * as GX from '../../gx/gx_enum';

interface BREFFEffect {
}

export interface BREFF {
    effects: BREFFEffect[];
}

export function parseBREFF(buffer: ArrayBufferSlice): BREFF {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'REFF');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    const effectTableOffs = rootSectionOffs + 0x08 + view.getUint32(rootSectionOffs + 0x08);
    const nameLen = view.getUint16(rootSectionOffs + 0x14);
    const name = readString(buffer, rootSectionOffs + 0x18, nameLen);

    const effectTableCount = view.getUint16(effectTableOffs + 0x04);
    const effects: BREFFEffect[] = [];
    for (let i = 0, effectTableIdx = effectTableOffs + 0x08; i < effectTableCount; i++) {
        const effectNameLen = view.getUint16(effectTableIdx + 0x00);
        effectTableIdx += 0x02;

        const effectName = readString(buffer, effectTableIdx + 0x00, effectNameLen);
        effectTableIdx += effectNameLen;

        const effectDataOffs = view.getUint32(effectTableOffs + 0x00);
        const effectDataSize = view.getUint32(effectTableOffs + 0x04);
        effectTableIdx += 0x08;
    }

    return { effects };
}

interface BREFTTexture {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice | null;
    mipCount: number;
    paletteFormat: GX.TexPalette | null;
    paletteData: ArrayBufferSlice | null;
}

export interface BREFT {
    name: string;
    textures: BREFTTexture[];
}

export function parseBREFT(buffer: ArrayBufferSlice): BREFT {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'REFT');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    const textureTableOffs = rootSectionOffs + 0x08 + view.getUint32(rootSectionOffs + 0x08);
    const nameLen = view.getUint16(rootSectionOffs + 0x14);
    const name = readString(buffer, rootSectionOffs + 0x18, nameLen);

    const textureTableCount = view.getUint16(textureTableOffs + 0x04);
    const textures: BREFTTexture[] = [];
    for (let i = 0, textureTableIdx = textureTableOffs + 0x08; i < textureTableCount; i++) {
        const textureNameLen = view.getUint16(textureTableIdx + 0x00);
        textureTableIdx += 0x02;

        const textureName = readString(buffer, textureTableIdx + 0x00, textureNameLen);
        textureTableIdx += textureNameLen;

        const textureDataOffs = view.getUint32(textureTableOffs + 0x00);
        const textureDataSize = view.getUint32(textureTableOffs + 0x04);
        textureTableIdx += 0x08;

        const width = view.getUint16(textureDataOffs + 0x04);
        const height = view.getUint16(textureDataOffs + 0x06);
        const dataSize = view.getUint32(textureDataOffs + 0x08);
        const format = view.getUint8(textureDataOffs + 0x0C);
        const paletteFormat = view.getUint8(textureDataOffs + 0x0D);
        const paletteEntries = view.getUint16(textureDataOffs + 0x0E);
        const paletteSize = view.getUint32(textureDataOffs + 0x10);
        const mipmap = view.getUint8(textureDataOffs + 0x14);

        const mipCount = mipmap ? 999 : 1;
        const data = buffer.subarray(textureDataOffs + 0x20, dataSize);
        const paletteData = paletteSize !== 0 ? buffer.subarray(textureDataOffs + 0x20 + dataSize, paletteSize) : null;

        textures.push({ name: textureName, format, width, height, mipCount, data, paletteData, paletteFormat });
    }

    return { name, textures };
}
