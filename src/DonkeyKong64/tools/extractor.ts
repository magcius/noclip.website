
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync } from "fs";

import * as BYML from '../../byml.js';
import { assert } from "../../util.js";
import { Zlib, gunzipSync, inflateRawSync } from "zlib";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer);
}

const pathBaseIn  = `./data/DonkeyKong64_Raw`;
const pathBaseOut = `./data/DonkeyKong64`;

function determineSizeOfZlibStream(buffer: ArrayBufferSlice, srcOffs: number): number {
    const view = buffer.createDataView();
    assert(view.getUint32(srcOffs + 0x00) === 0x1F8B0800);

    // typescript types are wrong, when info = true, then it returns a buffer and an engine
    const { engine } = inflateRawSync(buffer.createTypedArray(Uint8Array, srcOffs + 0x0A), { info: true }) as unknown as { buffer: Buffer, engine: Zlib };
    // `bytesWritten` is the number of compressed bytes consumed by the
    // inflater, not the number of bytes remaining in the ROM buffer.
    return 0x0A + engine.bytesWritten;
}

function cutZlibBuffer(buffer: ArrayBufferSlice, srcOffs: number): ArrayBufferSlice {
    const size = determineSizeOfZlibStream(buffer, srcOffs);
    return buffer.subarray(srcOffs, size);
}

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const view = romData.createDataView();

    // USA pointer table locations
    const PointerTableOffset = 0x101C50;
    const MapTableOffset = 0x15232C;
    const WallTableOffset = 0x43CBEC;
    const FloorTableOffset = 0x63CA6C;
    const SetupTableOffset = 0xD0E86C;
    const StructTableOffset = 0x82A06C;
    const ActorModelTableOffset = 0x8D3018;
    const TextureTableOffset = 0x118B638;
    const UncompressedTextureTableOffset = 0x981018;
    const ScriptTableOffset = 0xD3B56C;
    const CritterTableOffset = 0x1188BDC;
    const GlobalASMCodeROMOffset = 0x113F0;
    const GlobalASMDataROMOffset = 0xC29D4;
    const GlobalASMDataCompressedSize = 0x949C;
    const GlobalASMVirtualBase = 0x805FB300;
    const SpritePointerTableOffset = 0x15A090;
    const SpritePointerCount = 176;

    function extractMapTable(tableOffset: number, fileCount = 0xD8): (ArrayBufferSlice | number)[] {
        const files: (ArrayBufferSlice | number)[] = [];
        for (let i = 0; i < fileCount; i++) {
            const pointer = view.getUint32(tableOffset + i * 4);
            const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
            if (!!(pointer & 0x80000000))
                files[i] = view.getUint16(offs);
            else
                files[i] = cutZlibBuffer(romData, offs);
        }
        return files;
    }

    // Map data table.
    const MapData = extractMapTable(MapTableOffset);
    const SetupData = extractMapTable(SetupTableOffset);
    const ScriptData = extractMapTable(ScriptTableOffset);
    const CritterData = extractMapTable(CritterTableOffset, 0xB1);

    // SpriteData is stored in the compressed global overlay. This table is
    // the game's authoritative mapping from sprite IDs to texture frames,
    // formats, dimensions, and sprite-sheet layout.
    const globalASMCode = gunzipSync(romData.createTypedArray(Uint8Array, GlobalASMCodeROMOffset, GlobalASMDataROMOffset - GlobalASMCodeROMOffset));
    const globalASMData = gunzipSync(romData.createTypedArray(Uint8Array, GlobalASMDataROMOffset, GlobalASMDataCompressedSize));
    const globalASM = Buffer.concat([globalASMCode, globalASMData]);
    const SpriteData = [];
    for (let i = 0; i < SpritePointerCount; i++) {
        const address = globalASM.readUInt32BE(SpritePointerTableOffset + i * 4);
        const offs = address - GlobalASMVirtualBase;
        const imageCount = globalASM.readUInt16BE(offs + 0x12);
        const images = [];
        for (let j = 0; j < imageCount; j++)
            images.push(globalASM.readUInt16BE(offs + 0x14 + j * 2));
        SpriteData.push({
            address,
            id: globalASM.readUInt32BE(offs),
            imagesPerFrameHorizontal: globalASM.readUInt8(offs + 4),
            imagesPerFrameVertical: globalASM.readUInt8(offs + 5),
            flags: globalASM.readUInt8(offs + 6),
            codec: globalASM.readUInt8(offs + 7),
            params: Array.from(globalASM.subarray(offs + 8, offs + 0x0D)),
            table: globalASM.readUInt8(offs + 0x0D),
            width: globalASM.readUInt16BE(offs + 0x0E),
            height: globalASM.readUInt16BE(offs + 0x10),
            images,
        });
    }

    // Texture data table.
    const TexData: ArrayBufferSlice[] = [];
    const textureCount = Math.max(...SpriteData
        .filter((sprite) => sprite.table === 1)
        .flatMap((sprite) => sprite.images)) + 1;
    let texTableIdx = TextureTableOffset;
    for (let i = 0; i < textureCount; i++) {
        const texDataPtr = view.getUint32(texTableIdx + 0x00);

        const offs = (texDataPtr & 0x7FFFFFFF) + PointerTableOffset;
        TexData[i] = cutZlibBuffer(romData, offs);

        texTableIdx += 0x04;
    }

    // Table 7 contains uncompressed textures. Map geometry uses these for
    // animated materials, swapping the texture bound to an RSP segment every
    // few game ticks.
    const AnimTexData: ArrayBufferSlice[] = [];
    const uncompressedTextureCount = Math.max(0x3E1, Math.max(...SpriteData
        .filter((sprite) => sprite.table === 0)
        .flatMap((sprite) => sprite.images)) + 1);
    let animTexTableIdx = UncompressedTextureTableOffset;
    for (let i = 0; i < uncompressedTextureCount; i++) {
        const offs = view.getUint32(animTexTableIdx + 0x00) + PointerTableOffset;
        const nextOffs = view.getUint32(animTexTableIdx + 0x04) + PointerTableOffset;
        AnimTexData[i] = romData.slice(offs, nextOffs);
        animTexTableIdx += 0x04;
    }

    const crg1 = {
        MapData,
        SetupData,
        ScriptData,
        CritterData,
        SpriteData,
        TexData,
        AnimTexData,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/ROM_arc.crg1`, Buffer.from(data));
}

main();
