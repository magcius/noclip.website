import ArrayBufferSlice from "../ArrayBufferSlice.js";

const PDT1_MAGIC = 0x31544450;
export const PDT1_VERSION = 1;
const PDT1_HEADER_SIZE = 0x10;
const PDT1_ENTRY_SIZE = 0x10;

export interface PerfectDarkTexture {
    id: number;
    width: number;
    height: number;
    pixels: ArrayBufferSlice;
}

export type PerfectDarkTextureBank = Map<number, PerfectDarkTexture>;

export function parsePerfectDarkTextureBank(buffer: ArrayBufferSlice): PerfectDarkTextureBank {
    const view = buffer.createDataView();
    if (view.byteLength < PDT1_HEADER_SIZE)
        throw new Error("Perfect Dark texture bank is smaller than its header");
    if (view.getUint32(0x00, true) !== PDT1_MAGIC)
        throw new Error("Invalid Perfect Dark texture bank magic");
    if (view.getUint32(0x04, true) !== PDT1_VERSION)
        throw new Error(`Unsupported Perfect Dark texture bank version ${view.getUint32(0x04, true)}`);

    const textureCount = view.getUint32(0x08, true);
    const tableOffset = view.getUint32(0x0c, true);
    const tableEnd = tableOffset + textureCount * PDT1_ENTRY_SIZE;
    if (tableOffset < PDT1_HEADER_SIZE || tableEnd > view.byteLength)
        throw new Error("Perfect Dark texture bank contains an out-of-range table");

    const textures: PerfectDarkTextureBank = new Map();
    for (let i = 0; i < textureCount; i++) {
        const entryOffset = tableOffset + i * PDT1_ENTRY_SIZE;
        const id = view.getUint16(entryOffset + 0x00, true);
        const width = view.getUint16(entryOffset + 0x02, true);
        const height = view.getUint16(entryOffset + 0x04, true);
        const pixelOffset = view.getUint32(entryOffset + 0x08, true);
        const pixelLength = view.getUint32(entryOffset + 0x0c, true);
        const pixelEnd = pixelOffset + pixelLength;
        if (textures.has(id))
            throw new Error(`Perfect Dark texture bank contains duplicate texture ${id}`);
        if (width === 0 || height === 0 || pixelLength !== width * height * 4)
            throw new Error(`Perfect Dark texture ${id} has invalid dimensions or pixel length`);
        if (pixelOffset < tableEnd || pixelEnd > view.byteLength)
            throw new Error(`Perfect Dark texture ${id} pixels are outside the texture bank`);
        textures.set(id, { id, width, height, pixels: buffer.slice(pixelOffset, pixelEnd) });
    }
    return textures;
}
