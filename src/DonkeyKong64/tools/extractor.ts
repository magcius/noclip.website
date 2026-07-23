
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

    // USA ROM pointer-table directory. The first 32 words are table offsets,
    // relative to PointerTableOffset, and the next 32 words are slot counts.
    // Some sparse tables pad their final slots with the next table's start;
    // extractCompressedTable stops at that sentinel.
    //
    // Extraction inventory (names match `pointertable_e` in the DK64 decomp):
    // 00 MIDI: TODO: not extracted; audio playback is not implemented.
    // 01 map geometry: extracted as MapData; TODO: interpret every map-header
    //    section, scene-node variant, and runtime material handler.
    // 02 map walls: TODO: not extracted or interpreted (wall collision).
    // 03 map floors: TODO: not extracted or interpreted (floor collision).
    // 04 prop geometry: extracted as PropGeometryData; TODO: interpret every
    //    prop header/display-list variant, animation, and LOD path.
    // 05 actor geometry: TODO: not extracted or rendered.
    // 06 unused: TODO: verify that no retail map references this table.
    // 07 uncompressed textures: partially extracted as AnimTexData; TODO:
    //    archive the complete table instead of only known map/sprite frames.
    // 08 cutscenes: TODO: not extracted or interpreted.
    // 09 setup: extracted raw as SetupData; model2 props are partially
    //    interpreted; TODO: identify the 0x24-byte middle records and render
    //    actor/model1 entries and all remaining model2 behaviors.
    // 10 instance scripts: extracted raw as ScriptData; TODO: interpret the
    //    complete condition/action language and stateful object behavior.
    // 11 animations: TODO: not extracted or interpreted.
    // 12 text: TODO: not extracted or interpreted.
    // 13 animation code: TODO: not extracted or interpreted.
    // 14 HUD textures: TODO: not extracted; not map geometry.
    // 15 paths: TODO: not extracted or interpreted.
    // 16 spawners/fences: TODO: not extracted or rendered.
    // 17 DKTV: TODO: not extracted; not map geometry.
    // 18 triggers/loading zones: TODO: not extracted or visualized.
    // 19 unknown: TODO: identify, inventory references, and extract if needed.
    // 20 unknown per-map data: TODO: identify, extract, and interpret.
    // 21 autowalks: TODO: not extracted or visualized.
    // 22 ambient critters: extracted raw as CritterData; TODO: interpret all
    //    region fields and render the critters.
    // 23 exits: TODO: not extracted or visualized.
    // 24 race checkpoints: TODO: not extracted or visualized.
    // 25 compressed geometry textures: partially extracted as TexData; TODO:
    //    archive all entries rather than only the range reached by sprites.
    // 26 uncompressed sizes: TODO: not extracted; retain when generic pointer
    //    table extraction needs the game's authoritative decompressed sizes.
    // 27 unused: TODO: verify that no retail map/runtime path uses it.
    // 28 unused: TODO: verify that no retail map/runtime path uses it.
    // 29 unused: TODO: verify that no retail map/runtime path uses it.
    // 30 unused: TODO: verify that no retail map/runtime path uses it.
    // 31 unused: TODO: verify that no retail map/runtime path uses it.
    //
    // Data outside the pointer tables which is currently archived:
    // SpriteData, CustomScriptFunctionData, and EnvironmentParticleData come
    // from the global overlay. TODO: inventory other map-rendering tables in
    // overlays as they are discovered instead of leaving implicit constants.
    // TODO: locate this directory by ROM revision/signature; all addresses and
    // overlay offsets below currently describe only the USA ROM.
    const PointerTableOffset = 0x101C50;
    const PointerTableCountOffset = PointerTableOffset + 0x80;
    const PointerTable = {
        MapGeometry: 1,
        PropGeometry: 4,
        TexturesUncompressed: 7,
        Setup: 9,
        Scripts: 10,
        Critters: 22,
        TexturesGeometry: 25,
    } as const;
    const GlobalASMCodeROMOffset = 0x113F0;
    const GlobalASMDataROMOffset = 0xC29D4;
    const GlobalASMDataCompressedSize = 0x949C;
    const GlobalASMVirtualBase = 0x805FB300;
    const SpritePointerTableOffset = 0x15A090;
    const SpritePointerCount = 176;
    const CustomScriptFunctionTableOffset = 0x14CB70;
    const CustomScriptFunctionCount = 118;
    const EnvironmentParticleTableOffset = 0x14D8A0;
    const EnvironmentParticleCount = 13;

    function getTableOffset(table: number): number {
        return PointerTableOffset + view.getUint32(PointerTableOffset + table * 4);
    }

    function getTableCount(table: number): number {
        return view.getUint32(PointerTableCountOffset + table * 4);
    }

    function extractCompressedTable(table: number): (ArrayBufferSlice | number)[] {
        const tableOffset = getTableOffset(table);
        const fileCount = getTableCount(table);
        const files: (ArrayBufferSlice | number)[] = [];
        const firstFileForPointer = new Map<number, number>();
        for (let i = 0; i < fileCount; i++) {
            const pointer = view.getUint32(tableOffset + i * 4);
            const nextTableStart = table < 31 ? view.getUint32(PointerTableOffset + (table + 1) * 4) : 0;
            if (!(pointer & 0x80000000) && nextTableStart !== 0 && pointer >= nextTableStart)
                break;
            const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
            if (!!(pointer & 0x80000000))
                files[i] = view.getUint16(offs);
            else if (firstFileForPointer.has(pointer))
                files[i] = firstFileForPointer.get(pointer)!;
            else {
                firstFileForPointer.set(pointer, i);
                files[i] = cutZlibBuffer(romData, offs);
            }
        }
        return files;
    }

    const MapData = extractCompressedTable(PointerTable.MapGeometry);
    const PropGeometryData = extractCompressedTable(PointerTable.PropGeometry);
    const SetupData = extractCompressedTable(PointerTable.Setup);
    const ScriptData = extractCompressedTable(PointerTable.Scripts);
    const CritterData = extractCompressedTable(PointerTable.Critters);

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
    const CustomScriptFunctionData = [];
    for (let i = 0; i < CustomScriptFunctionCount; i++)
        CustomScriptFunctionData.push(globalASM.readUInt32BE(CustomScriptFunctionTableOffset + i * 4));
    const EnvironmentParticleData = [];
    for (let i = 0; i < EnvironmentParticleCount; i++) {
        const offs = EnvironmentParticleTableOffset + i * 0x20;
        EnvironmentParticleData.push({
            map: globalASM.readUInt8(offs + 0x00),
            start: [
                globalASM.readInt16BE(offs + 0x02),
                globalASM.readInt16BE(offs + 0x04),
                globalASM.readInt16BE(offs + 0x06),
            ],
            end: [
                globalASM.readInt16BE(offs + 0x08),
                globalASM.readInt16BE(offs + 0x0A),
                globalASM.readInt16BE(offs + 0x0C),
            ],
            gap: globalASM.readFloatBE(offs + 0x10),
            distance: globalASM.readInt16BE(offs + 0x14),
            baseScale: globalASM.readFloatBE(offs + 0x18),
            risingScale: globalASM.readFloatBE(offs + 0x1C),
        });
    }

    // Texture data table.
    const TexData: ArrayBufferSlice[] = [];
    const textureCount = Math.max(...SpriteData
        .filter((sprite) => sprite.table === 1)
        .flatMap((sprite) => sprite.images)) + 1;
    let texTableIdx = getTableOffset(PointerTable.TexturesGeometry);
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
    let animTexTableIdx = getTableOffset(PointerTable.TexturesUncompressed);
    for (let i = 0; i < uncompressedTextureCount; i++) {
        const offs = view.getUint32(animTexTableIdx + 0x00) + PointerTableOffset;
        const nextOffs = view.getUint32(animTexTableIdx + 0x04) + PointerTableOffset;
        AnimTexData[i] = romData.slice(offs, nextOffs);
        animTexTableIdx += 0x04;
    }

    const crg1 = {
        MapData,
        PropGeometryData,
        SetupData,
        ScriptData,
        CritterData,
        SpriteData,
        CustomScriptFunctionData,
        EnvironmentParticleData,
        TexData,
        AnimTexData,
    };

    const data = BYML.write(crg1, BYML.FileType.CRG1);
    writeFileSync(`${pathBaseOut}/ROM_arc.crg1`, Buffer.from(data));
}

main();
