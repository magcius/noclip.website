import ArrayBufferSlice from "../ArrayBufferSlice";
import { readFileSync } from "fs";
import { assert, readString } from "../util";

import * as tex from "./tex";

// FIXME: This has been copy-pasted everywhere, it's maybe time to move it to
// util.js or something.
function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return ArrayBufferSlice.fromView(b);
}

/*
 * ROM
 * - 0x39850: data.bin (compressed)
 *          - 0x28080: file table, last offset points to file name table
 * - 0x7eb270: texture config
 * - 0x1d5ca00: file name table
 * - 0x1d65f40: texture data
 * - 0x1ff7ca0: texture list
 */

// Offset into raw ROM.
// data.bin is an abitrary name given by the decomp project, it contains
// offsets to files and a bunch data we don't care about.
const compressedDatabinOffset = 0x39850;
const textureDataOffset = 0x1d65f40;
const textureDataSize = 0x291d60;
const textureListOffset = textureDataOffset + textureDataSize;
const textureListEndOffset = 0x1ffea20;
const textureListSize = textureListEndOffset - textureListOffset;

export const NumTextures = (textureListSize / tex.textureListEntryStructSize) - 1;

// Abusing enums to avoid repeating a var name prefix. Sue me.
enum TextureConfigOffset {
    Base = 0x7eb270,
    Size = 0x000b50,

    WallHitStart = 0x007eb430,
    WallHitEnd = WallHitStart + 18 * tex.textureConfigStructSize,
}

// Offset into decompressed "data" section.
const filesTableOffset = 0x28080;

// PD64 assets are stored into named files, sometimes the contents are
// compressed, sometimes not, sometimes files wrap multiple section of
// compressed data.
// A "Z" name suffix is sometimes used to denote compressed data.
// Don't attempt to read from offset to offset+size directly, the data must go
// through decompress first.
interface FileEntry {
    offset: number; // uint32, offset into ROM
    size: number; // uint32, raw size in ROM
    name: string;
}

// Returns list of offsets into the raw ROM.
function readFileOffsets(data: ArrayBufferSlice): number[] {
    const view = data.createDataView();
    let i = filesTableOffset;
    const ret: number[] = [];

    while (true) {
        const offset = view.getUint32(i);
        // First entry is 0, that's a recurring pattern in this ROM.
        if (ret.length > 0 && offset === 0) {
            break;
        }

        ret.push(offset);
        i += 4;
    }

    return ret;
}

// Returns a list of strings that maps 1:1 to readFileTable.
// The file name table is a table of offsets into the raw ROM, starting at the
// table offset.
// Names are nul-terminated strings then padded to align to 8 bytes.
function readFileNames(rom: ArrayBufferSlice, tableAddr: number): string[] {
    const view = rom.createDataView();
    let i = tableAddr;
    const ret: string[] = [];

    while (true) {
        const offset = view.getUint32(i);
        if (ret.length > 0 && offset === 0) {
            break;
        }

        ret.push(readString(rom, tableAddr + offset));

        i += 4;
    }

    return ret;
};

// Parses the ROM to find the internal file-system that contains game assets.
function readFileTable(rom: ArrayBufferSlice, databin: ArrayBufferSlice): FileEntry[] {
    const fileOffsets = readFileOffsets(databin);
    const fileNames = readFileNames(rom, fileOffsets[fileOffsets.length - 1]);

    // There's one missing name because the last fileOffsets entry is not
    // really a file, only the end offset of the previous file which also
    // happens to be the start of the name table.
    // Thus fileNames contains the first empty entry and all the files,
    // fileOffsets has the first empty entry, all the files, and the
    // terminating pseudo-entry.
    if (fileOffsets.length !== (fileNames.length+1)) {
        throw new Error("file offset and name tables do not match");
    }

    const ret: FileEntry[] = [];
    for (let i = 0; i < fileNames.length; i++) {
        ret.push({
            offset: fileOffsets[i],
            name: fileNames[i],
            size: fileOffsets[i+1] - fileOffsets[i],
        });
    }

    return ret.slice(1); // Skip the first empty entry.
}

export type Inflater = (raw: ArrayBufferSlice) => ArrayBufferSlice;

export default class ROM {
    private readonly rom: ArrayBufferSlice;
    public readonly files: FileEntry[];

    public readonly textureList: tex.TextureListEntry[];

    // TODO: find if we care about this one.
    public readonly textureConfig: tex.TextureConfig[];
    public readonly textureData: ArrayBufferSlice[];

    constructor(path: string, public readonly decompress: Inflater) {
        this.rom = fetchDataSync(path);
        const databin = decompress(this.rom.subarray(compressedDatabinOffset));
        this.files = readFileTable(this.rom, databin);
        this.textureList = this.readTextureList();
        this.textureConfig = this.readTextureConfig();
        this.textureData = this.readTextureData();
        assert(this.textureData.length === NumTextures, `expected ${NumTextures} textures, got ${this.textureData.length}`);
    }

    // Returns the raw uncompressed (if applicable) data for a file.
    // If the file was not compressed, the returned buffer is a slice of the raw ROM.
    public openFile(path: string): ArrayBufferSlice {
        const entry = this.files.find(f => f.name === path);
        if (!entry) {
            throw new Error(`File not found: ${path}`);
        }

        const raw = this.rom.subarray(entry.offset, entry.size);
        return this.decompress(raw);
    }

    private readTextureList(): tex.TextureListEntry[] {
        const ret: tex.TextureListEntry[] = [];
        const view = this.rom.createDataView(textureListOffset, textureListSize);

        for (
            let offset = 0;
            offset < textureListSize;
            offset += tex.textureListEntryStructSize
        ) {
            ret.push({
                soundSurfaceType: (view.getUint8(offset) & 0xF0) >>> 4,
                surfaceType: view.getUint8(offset) & 0xF0,
                dataOffset:  view.getUint32(offset) & 0x00FFFFFF,
            });
        }

        return ret;
    }

    // These are quite a mess, there's no single list it's an agglomeration of
    // global variables and entries generated by parsing static display lists.
    private readTextureConfig(): tex.TextureConfig[] {
        const ret: tex.TextureConfig[] = [];
        const view = this.rom.createDataView();

        for (
            let offset = TextureConfigOffset.WallHitStart;
            offset < TextureConfigOffset.WallHitEnd;
            offset += tex.textureConfigStructSize
        ) {
            ret.push(tex.textureConfigFromView(view, offset));
        }

        return ret;
    }

    private readTextureData(): ArrayBufferSlice[] {
        const ret: ArrayBufferSlice[] = [];

        this.textureList.forEach((entry, i) => {
            // Last entry only there to get data len for the one before.
            // In the ROM, the texture count is hardcoded.
            if (i >= this.textureList.length-1) {
                return;
            }

            // Only one of these in ntsc-final, but is exists.
            if (
                (i < this.textureList.length - 1) &&
                (entry.dataOffset === this.textureList[i+1].dataOffset)
            ) {
                console.warn(`textureList entry #${i} has no data`);
                // Don't return, we need the indices to match textureList.
                // We'll have an empty file, it's OK.
            }

            const offset = textureDataOffset + entry.dataOffset;
            const len = this.textureList[i+1].dataOffset - entry.dataOffset;

            ret.push(this.rom.subarray(offset, len));
        });

        return ret;
    }
}
