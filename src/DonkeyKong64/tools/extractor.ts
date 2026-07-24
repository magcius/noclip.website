
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync } from "fs";

import * as BYML from '../../byml.js';
import { assert, hexzero } from "../../util.js";
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
    // 05 actor geometry: every nonzero model referenced by a map's setup
    //    actors is extracted; unsupported model families opt out at runtime.
    // 06 unused: TODO: verify that no retail map references this table.
    // 07 uncompressed textures: partially extracted as AnimTexData; TODO:
    //    archive the complete table instead of only known map/sprite frames.
    // 08 cutscenes: TODO: not extracted or interpreted.
    // 09 setup: extracted raw as SetupData; model2 props are partially
    //    interpreted; TODO: identify the 0x24-byte middle records and render
    //    actor/model1 entries and all remaining model2 behaviors.
    // 10 instance scripts: extracted raw as ScriptData; TODO: interpret the
    //    complete condition/action language and stateful object behavior.
    // 11 animations: maps archive behavior-specific animations whose
    //    selection is understood; other actors render in their neutral pose.
    // 12 text: TODO: not extracted or interpreted.
    // 13 animation code: TODO: not extracted or interpreted.
    // 14 HUD textures: the pre-map panorama renderer uses entries 0x2D and
    //    0x2E on the maps selected by func_global_asm_80707980. Other HUD
    //    textures are not extracted until their rendering paths are handled.
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
        ActorGeometry: 5,
        TexturesUncompressed: 7,
        Setup: 9,
        Scripts: 10,
        Animations: 11,
        HUDTextures: 14,
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
    const ActorDefinitionTableOffset = 0x1535B0;
    const ActorDefinitionCount = 0x80;
    // func_global_asm_80707980's current_map jump table. These are the only
    // retail maps which dispatch to the camera-tracked panorama helper
    // func_global_asm_807069A4.
    const backdropTextureIDs = new Map<number, number>([
        [0x03, 0x2E], // K. Rool barrel: Lanky's maze
        [0x0B, 0x2E], // Stealthy Snoop (normal, no logo)
        [0x0E, 0x2D], // Aztec beetle race
        [0x41, 0x2E], // Stealthy Snoop (normal)
        [0x42, 0x2E], // Mad Maze Maul (hard)
        [0x43, 0x2E], // Stash Snatch (normal)
        [0x44, 0x2E], // Mad Maze Maul (easy)
        [0x45, 0x2E], // Mad Maze Maul (normal)
        [0x4A, 0x2E], // Stash Snatch (easy)
        [0x4B, 0x2E], // Stash Snatch (hard)
        [0x7C, 0x2E], // Mad Maze Maul (insane)
        [0x7D, 0x2E], // Stash Snatch (insane)
        [0x7E, 0x2E], // Stealthy Snoop (very easy)
        [0x7F, 0x2E], // Stealthy Snoop (easy)
        [0x80, 0x2E], // Stealthy Snoop (hard)
    ]);

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

    function extractRawTableEntry(table: number, index: number): ArrayBufferSlice {
        const tableOffset = getTableOffset(table);
        const fileCount = getTableCount(table);
        assert(index >= 0 && index < fileCount);
        const pointer = view.getUint32(tableOffset + index * 4);
        const nextPointer = view.getUint32(tableOffset + (index + 1) * 4);
        assert(!(pointer & 0x80000000));
        assert(!(nextPointer & 0x80000000));
        const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
        const nextOffs = (nextPointer & 0x7FFFFFFF) + PointerTableOffset;
        assert(nextOffs >= offs);
        return romData.subarray(offs, nextOffs - offs);
    }

    const MapData = extractCompressedTable(PointerTable.MapGeometry);
    const PropGeometryData = extractCompressedTable(PointerTable.PropGeometry);
    const ActorGeometryData = extractCompressedTable(PointerTable.ActorGeometry);
    const SetupData = extractCompressedTable(PointerTable.Setup);
    const ScriptData = extractCompressedTable(PointerTable.Scripts);
    const HUDTextureData = extractCompressedTable(PointerTable.HUDTextures);
    const CritterData = extractCompressedTable(PointerTable.Critters);

    function resolveTableEntry(table: (ArrayBufferSlice | number)[], index: number): ArrayBufferSlice {
        let entry = table[index];
        const visited = new Set<number>();
        while (typeof entry === 'number') {
            assert(!visited.has(entry));
            visited.add(entry);
            entry = table[entry];
        }
        assert(entry !== undefined);
        return entry;
    }

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
    const actorModelByType = new Map<number, number>();
    for (let i = 0; i < ActorDefinitionCount; i++) {
        const offs = ActorDefinitionTableOffset + i * 0x30;
        actorModelByType.set(globalASM.readUInt16BE(offs), globalASM.readUInt16BE(offs + 2));
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
    // Give the two HUD-source panoramas ordinary texture indices so the
    // existing owner analysis can keep single-map data local and shard shared
    // data without a backdrop-specific archive path.
    const backdropTextureIndices = new Map<number, number>();
    for (const textureID of new Set(backdropTextureIDs.values())) {
        backdropTextureIndices.set(textureID, TexData.length);
        TexData.push(resolveTableEntry(HUDTextureData, textureID));
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

    interface TextureUsage {
        geometry: Set<number>;
        animated: Set<number>;
    }

    interface LevelSource {
        MapData: ArrayBufferSlice;
        Backdrop: { TextureID: number, TextureIndex: number } | null;
        SetupData: ArrayBufferSlice;
        ScriptData: ArrayBufferSlice;
        CritterData: ArrayBufferSlice | null;
        PropGeometry: { Type: number, Data: ArrayBufferSlice }[];
        ActorDefinitions: { Type: number, Model: number }[];
        ActorGeometry: { Model: number, Data: ArrayBufferSlice }[];
        AnimationData: { ID: number, Data: ArrayBufferSlice }[];
        EnvironmentParticleData: typeof EnvironmentParticleData;
        UnhandledMapFeatures: UnhandledMapFeature[];
        textureUsage: TextureUsage;
    }

    interface UnhandledMapFeature {
        Kind: string;
        Material: number;
        Count: number;
    }

    // Keep these in sync with material.ts. The extraction summary makes new
    // runtime material IDs visible instead of letting them silently disappear.
    const GeneratedSurfaceMaterial = {
        Water: 0,
        Lava: 1,
        Meadow: 2,
        WaterFog: 3,
        Dirt: 4,
        LavaBright: 5,
        Acid: 6,
        WaterFire: 7,
        DirtCave: 8,
    } as const;
    const supportedGeneratedSurfaceMaterials = new Set<number>([
        GeneratedSurfaceMaterial.Water,
        GeneratedSurfaceMaterial.Lava,
        GeneratedSurfaceMaterial.Meadow,
        GeneratedSurfaceMaterial.WaterFog,
        GeneratedSurfaceMaterial.Dirt,
        GeneratedSurfaceMaterial.LavaBright,
        GeneratedSurfaceMaterial.Acid,
        GeneratedSurfaceMaterial.WaterFire,
        GeneratedSurfaceMaterial.DirtCave,
    ]);
    const SceneNodeMaterial = {
        Sand: 2,
        WaterStream: 3,
        Water: 4,
        GroundFog: 7,
    } as const;
    const supportedSceneNodeMaterials = new Set<number>([
        SceneNodeMaterial.Sand,
        SceneNodeMaterial.WaterStream,
        SceneNodeMaterial.Water,
        SceneNodeMaterial.GroundFog,
    ]);

    function inflatePointerTableData(data: ArrayBufferSlice, description: string): Buffer {
        try {
            // Pointer-table slices intentionally omit the gzip footer; the
            // runtime likewise inflates the raw DEFLATE payload after 0x0A.
            return inflateRawSync(data.createTypedArray(Uint8Array, 0x0A));
        } catch (e) {
            throw new Error(`Could not decompress ${description}`, { cause: e });
        }
    }

    function scanTextureCommands(data: Buffer, start: number, end: number, output: Set<number>, excluded = new Set<number>()): void {
        assert(start >= 0 && start <= end && end <= data.byteLength);
        for (let offs = start; offs + 8 <= end; offs += 8) {
            if (data.readUInt8(offs) !== 0xFD)
                continue;
            const address = data.readUInt32BE(offs + 4);
            // Segment zero is an index into pointer table 25. Other segments
            // are supplied by map/prop animation descriptors handled below.
            if ((address >>> 24) === 0 && !excluded.has(address))
                output.add(address);
        }
    }

    function scanMapTextureUsage(map: Buffer, usage: TextureUsage): void {
        const dlStart = map.readUInt32BE(0x34);
        const vertStart = map.readUInt32BE(0x38);
        scanTextureCommands(map, dlStart, vertStart, usage.geometry);

        const animatedStart = map.readUInt32BE(0x48);
        const animatedCount = map.readUInt32BE(animatedStart);
        for (let i = 0; i < animatedCount; i++) {
            const offs = animatedStart + 4 + i * 0x7C;
            const frameCount = map.readUInt8(offs + 3);
            for (let frame = 0; frame < frameCount; frame++)
                usage.animated.add(map.readUInt32BE(offs + 0x0C + frame * 4));
        }

        // Runtime-generated surfaces use fixed textures which do not appear
        // in G_SETTIMG commands as pointer-table indices.
        const generatedSurfaceStart = map.readUInt32BE(0x4C);
        const generatedSurfaceCount = map.readUInt32BE(generatedSurfaceStart);
        for (let i = 0; i < generatedSurfaceCount; i++) {
            const material = map.readUInt8(generatedSurfaceStart + 4 + i * 0x6C + 0x66);
            switch (material) {
            case GeneratedSurfaceMaterial.Water:
            case GeneratedSurfaceMaterial.WaterFog:
                usage.animated.add(0x3C5);
                break;
            case GeneratedSurfaceMaterial.Lava:
                // func_global_asm_80661B84 loads the CI4 image and its
                // RGBA16 palette for generated-surface material 1.
                usage.geometry.add(0x2EE);
                usage.geometry.add(0x2EF);
                break;
            case GeneratedSurfaceMaterial.Meadow:
                usage.geometry.add(0xF0);
                break;
            case GeneratedSurfaceMaterial.Dirt:
                usage.geometry.add(0x75C);
                break;
            case GeneratedSurfaceMaterial.LavaBright:
                usage.animated.add(0x3B9);
                break;
            case GeneratedSurfaceMaterial.Acid:
                usage.animated.add(0x3D2);
                break;
            case GeneratedSurfaceMaterial.WaterFire:
                usage.animated.add(0x3BA);
                usage.animated.add(0x3DB);
                break;
            case GeneratedSurfaceMaterial.DirtCave:
                usage.geometry.add(0xAF4);
                break;
            }
        }

        const rootNode = map.readUInt32BE(0x30);
        const specialDisplayListCount = map.readUInt8(rootNode + 0xC5);
        for (let i = 0; i < specialDisplayListCount; i++) {
            const displayList = map.readInt32BE(rootNode + 0x1C + i * 4);
            const material = map.readUInt16BE(rootNode + 0x70 + i * 2);
            if (displayList < 0)
                continue;
            switch (material) {
            case SceneNodeMaterial.Sand:
                // func_global_asm_8063C784 loads the complete RGBA16 mip
                // chain used by scene-node sand material 2.
                usage.geometry.add(0x565);
                break;
            case SceneNodeMaterial.WaterStream:
                // func_global_asm_8063CADC loads both scrolling RGBA16 layers.
                usage.animated.add(0x3B7);
                usage.animated.add(0x3B8);
                break;
            case SceneNodeMaterial.Water:
                usage.animated.add(0x3E0);
                break;
            case SceneNodeMaterial.GroundFog:
                usage.geometry.add(0x1765);
                break;
            }
        }
    }

    function inventoryUnhandledMapFeatures(map: Buffer): UnhandledMapFeature[] {
        const counts = new Map<string, UnhandledMapFeature>();
        const add = (kind: string, material: number): void => {
            const key = `${kind}:${material}`;
            const entry = counts.get(key);
            if (entry !== undefined)
                entry.Count++;
            else
                counts.set(key, { Kind: kind, Material: material, Count: 1 });
        };

        const generatedSurfaceStart = map.readUInt32BE(0x4C);
        const generatedSurfaceCount = map.readUInt32BE(generatedSurfaceStart);
        for (let i = 0; i < generatedSurfaceCount; i++) {
            const material = map.readUInt8(generatedSurfaceStart + 4 + i * 0x6C + 0x66);
            if (!supportedGeneratedSurfaceMaterials.has(material))
                add('GeneratedSurfaceMaterial', material);
        }

        const rootNode = map.readUInt32BE(0x30);
        const sceneNodeMaterialCount = map.readUInt8(rootNode + 0xC5);
        for (let i = 0; i < sceneNodeMaterialCount; i++) {
            const displayList = map.readInt32BE(rootNode + 0x1C + i * 4);
            const material = map.readUInt16BE(rootNode + 0x70 + i * 2);
            if (displayList >= 0 && !supportedSceneNodeMaterials.has(material))
                add('SceneNodeMaterial', material);
        }

        return [...counts.values()].sort((a, b) =>
            a.Kind.localeCompare(b.Kind) || a.Material - b.Material,
        );
    }

    function scanPropTextureUsage(prop: Buffer, usage: TextureUsage): void {
        const decalTexture = prop.readUInt16BE(0x28);
        if (decalTexture !== 0xFFFF)
            usage.geometry.add(decalTexture);

        // Indexed prop animations leave their target IDs in segment zero,
        // even though both the target and frames come from table 7. Exclude
        // those placeholders from the table-25 command scan.
        const animatedTargets = new Set<number>();
        const descriptorStart = prop.readUInt32BE(0x6C);
        if (descriptorStart + 4 <= prop.byteLength) {
            const descriptorCount = prop.readUInt32BE(descriptorStart);
            for (let i = 0; i < descriptorCount; i++) {
                const offs = descriptorStart + 4 + i * 0x84;
                if (offs + 0x84 > prop.byteLength)
                    break;
                const target = prop.readUInt32BE(offs);
                const frameCount = prop.readUInt32BE(offs + 0x0C);
                if (frameCount === 0 || frameCount > 0x1E)
                    continue;
                animatedTargets.add(target);
                usage.animated.add(target);
                for (let frame = 1; frame < frameCount; frame++)
                    usage.animated.add(prop.readUInt32BE(offs + 0x0C + frame * 4));
            }
        }

        if (prop.readUInt8(0x1C) === 2) {
            // func_global_asm_8063524C builds one textured quad from each
            // 0x30-byte descriptor. The first texture is the image and the
            // optional second texture is its CI palette.
            const descriptorStart = prop.readUInt32BE(0x70);
            if (descriptorStart + 4 <= prop.byteLength) {
                const descriptorCount = prop.readUInt32BE(descriptorStart);
                for (let i = 0; i < descriptorCount; i++) {
                    const offs = descriptorStart + 4 + i * 0x30;
                    if (offs + 0x30 > prop.byteLength)
                        break;
                    const texture = prop.readUInt16BE(offs);
                    if (!animatedTargets.has(texture))
                        usage.geometry.add(texture);
                    const palette = prop.readUInt16BE(offs + 2);
                    if (palette !== 0xFFFF)
                        usage.geometry.add(palette);
                }
            }
            return;
        }
        if (prop.readUInt8(0x1C) !== 1)
            return;
        const mainDisplayListStart = prop.readUInt32BE(0x40);
        const secondaryDisplayListStart = prop.readUInt32BE(0x44);
        const vertexStart = prop.readUInt32BE(0x48);
        scanTextureCommands(prop, Math.min(mainDisplayListStart, secondaryDisplayListStart), vertexStart, usage.geometry, animatedTargets);
    }

    function scanActorTextureUsage(actor: Buffer, usage: TextureUsage): void {
        const runtimeBase = actor.readUInt32BE(0);
        const displayListTable = actor.readUInt32BE(4) - runtimeBase + 0x28;
        const displayListCount = actor.readUInt8(0x21);
        const visited = new Set<number>();
        const scanDisplayList = (address: number): void => {
            if ((address >>> 24) !== 0x03)
                return;
            let offs = (address & 0x00FFFFFF) + 0x28;
            if (visited.has(offs))
                return;
            visited.add(offs);
            for (; offs + 8 <= actor.byteLength; offs += 8) {
                const opcode = actor.readUInt8(offs);
                const target = actor.readUInt32BE(offs + 4);
                if (opcode === 0xFD && (target >>> 24) === 0)
                    usage.geometry.add(target);
                else if (opcode === 0xDE)
                    scanDisplayList(target);
                else if (opcode === 0xDF)
                    return;
            }
        };
        for (let i = 0; i < displayListCount; i++) {
            const pointer = actor.readUInt32BE(displayListTable + i * 4);
            scanDisplayList(0x03000000 | (pointer - runtimeBase));
        }
        const descriptorPointer = actor.readUInt32BE(0x10);
        let descriptorOffs = descriptorPointer - runtimeBase + 0x28;
        if (descriptorPointer !== 0 && descriptorOffs >= 0 && descriptorOffs + 2 <= actor.byteLength) {
            const descriptorCount = actor.readUInt16BE(descriptorOffs);
            descriptorOffs += 2;
            for (let descriptor = 0; descriptor < descriptorCount; descriptor++) {
                if (descriptorOffs + 6 > actor.byteLength)
                    break;
                const frameCount = actor.readUInt16BE(descriptorOffs);
                descriptorOffs += 6;
                for (let frame = 0; frame < frameCount && descriptorOffs + 2 <= actor.byteLength; frame++, descriptorOffs += 2)
                    usage.geometry.add(actor.readUInt16BE(descriptorOffs));
            }
        }
    }

    const spriteByAddress = new Map(SpriteData.map((sprite) => [sprite.address, sprite]));
    function addSpriteTextureUsage(address: number, usage: TextureUsage): void {
        const sprite = spriteByAddress.get(address);
        if (sprite === undefined)
            return;
        const output = sprite.table === 0 ? usage.animated : usage.geometry;
        for (const image of sprite.images)
            output.add(image);
    }

    function scanScriptedSpriteUsage(setup: Buffer, scripts: Buffer, usage: TextureUsage): void {
        const propIDs = new Set<number>();
        const propCount = setup.readUInt32BE(0);
        for (let i = 0; i < propCount; i++)
            propIDs.add(setup.readUInt16BE(4 + i * 0x30 + 0x2A));

        const scriptCount = scripts.readUInt16BE(0);
        let offs = 2;
        for (let script = 0; script < scriptCount; script++) {
            const id = scripts.readUInt16BE(offs);
            const blockCount = scripts.readUInt16BE(offs + 2);
            offs += 6;
            for (let block = 0; block < blockCount; block++) {
                const conditionCount = scripts.readUInt16BE(offs);
                const conditionOpcode = conditionCount === 1 ? scripts.readUInt16BE(offs + 2) : -1;
                const conditionArg0 = conditionCount === 1 ? scripts.readInt16BE(offs + 4) : -1;
                offs += 2 + conditionCount * 8;
                const executionCount = scripts.readUInt16BE(offs);
                offs += 2;
                let resetsState = false;
                let usesPointSprite = false;
                for (let i = 0; i < executionCount; i++, offs += 8) {
                    const opcode = scripts.readUInt16BE(offs);
                    if (opcode === 1)
                        resetsState = true;
                    if (opcode === 7 && CustomScriptFunctionData[scripts.readInt16BE(offs + 2)] === 0x80644EC8)
                        usesPointSprite = true;
                }
                if (propIDs.has(id) && conditionOpcode === 1 && conditionArg0 === 0 && !resetsState && usesPointSprite)
                    addSpriteTextureUsage(0x80720A7C, usage);
            }
        }
        assert(offs <= scripts.byteLength);
    }

    // Resolve aliases before writing so each map archive is self-contained.
    // Prop geometry is selected from the setup file, avoiding geometry for
    // every other level.
    const levels: LevelSource[] = [];
    for (let mapID = 0; mapID < MapData.length; mapID++) {
        const mapData = resolveTableEntry(MapData, mapID);
        const setupData = resolveTableEntry(SetupData, mapID);
        const scriptData = resolveTableEntry(ScriptData, mapID);
        const map = inflatePointerTableData(mapData, `map data for map ${hexzero(mapID, 2).toUpperCase()}`);
        const setup = inflatePointerTableData(setupData, `setup data for map ${hexzero(mapID, 2).toUpperCase()}`);
        const scripts = inflatePointerTableData(scriptData, `script data for map ${hexzero(mapID, 2).toUpperCase()}`);
        const propCount = setup.readUInt32BE(0);
        const propTypes = new Set<number>();
        for (let i = 0; i < propCount; i++)
            propTypes.add(setup.readUInt16BE(4 + i * 0x30 + 0x28));

        const PropGeometry = [];
        for (const type of propTypes) {
            if (type < PropGeometryData.length)
                PropGeometry.push({ Type: type, Data: resolveTableEntry(PropGeometryData, type) });
        }

        let actorOffs = 4 + propCount * 0x30;
        const mysteryCount = setup.readUInt32BE(actorOffs);
        actorOffs += 4 + mysteryCount * 0x24;
        const actorCount = setup.readUInt32BE(actorOffs);
        actorOffs += 4;
        const actorModels = new Set<number>();
        const actorAnimations = new Set<number>();
        const actorDefinitions = new Map<number, number>();
        for (let i = 0; i < actorCount; i++, actorOffs += 0x38) {
            const type = setup.readUInt16BE(actorOffs + 0x32);
            const model = actorModelByType.get(type + 0x10) ?? 0;
            actorDefinitions.set(type, model);
            if (model !== 0)
                actorModels.add(model);
            if (type === 0x10) {
                actorAnimations.add(0x402);
            } else if (type === 0x2A) {
                actorAnimations.add(0x402);
            } else if (type === 0x77) {
                // ACTOR_BOOMBOX: func_global_asm_806A1F64 uses 0x63F during
                // normal gameplay and switches to 0x640 for cutscenes.
                actorAnimations.add(0x63F);
            }
        }
        const ActorDefinitions = [...actorDefinitions].map(([Type, Model]) => ({ Type, Model }));
        const ActorGeometry = [];
        for (const model of actorModels) {
            // Actor model IDs are one-based; pointer-table slot zero is model 1.
            const tableIndex = model - 1;
            if (tableIndex < ActorGeometryData.length)
                ActorGeometry.push({ Model: model, Data: resolveTableEntry(ActorGeometryData, tableIndex) });
        }
        const animations = [...actorAnimations].map((id) => ({
            ID: id,
            // Unlike the geometry tables, table 11 stores animation files
            // uncompressed. Preserve the exact pointer-bounded file.
            Data: extractRawTableEntry(PointerTable.Animations, id),
        }));

        const environmentParticleData = EnvironmentParticleData.filter((entry) => entry.map === mapID);
        const textureUsage: TextureUsage = { geometry: new Set(), animated: new Set() };
        scanMapTextureUsage(map, textureUsage);
        for (const prop of PropGeometry)
            scanPropTextureUsage(inflatePointerTableData(prop.Data, `prop ${hexzero(prop.Type, 4)}`), textureUsage);
        for (const actor of ActorGeometry) {
            const actorData = inflatePointerTableData(actor.Data, `actor model ${hexzero(actor.Model, 4)}`);
            scanActorTextureUsage(actorData, textureUsage);
        }
        if (environmentParticleData.length > 0) {
            addSpriteTextureUsage(0x8072140C, textureUsage);
            addSpriteTextureUsage(0x8071FF18, textureUsage);
        }
        scanScriptedSpriteUsage(setup, scripts, textureUsage);
        const UnhandledMapFeatures = inventoryUnhandledMapFeatures(map);

        const backdropTextureID = backdropTextureIDs.get(mapID);
        const backdropTextureIndex = backdropTextureID !== undefined
            ? backdropTextureIndices.get(backdropTextureID)!
            : null;
        if (backdropTextureIndex !== null)
            textureUsage.geometry.add(backdropTextureIndex);
        levels.push({
            MapData: mapData,
            // Both panorama branches use the same 320x240 source rectangle
            // and are rendered before map geometry.
            Backdrop: backdropTextureID !== undefined
                ? { TextureID: backdropTextureID, TextureIndex: backdropTextureIndex! }
                : null,
            SetupData: setupData,
            ScriptData: scriptData,
            CritterData: mapID < CritterData.length ? resolveTableEntry(CritterData, mapID) : null,
            PropGeometry,
            ActorDefinitions,
            ActorGeometry,
            AnimationData: animations,
            EnvironmentParticleData: environmentParticleData,
            UnhandledMapFeatures,
            textureUsage,
        });
    }

    function buildOwners(kind: keyof TextureUsage): Map<number, number[]> {
        const owners = new Map<number, number[]>();
        for (let mapID = 0; mapID < levels.length; mapID++) {
            for (const textureID of levels[mapID].textureUsage[kind]) {
                if (!owners.has(textureID))
                    owners.set(textureID, []);
                owners.get(textureID)!.push(mapID);
            }
        }
        return owners;
    }

    function makeTextureEntries(data: ArrayBufferSlice[], predicate: (id: number) => boolean): { ID: number, Data: ArrayBufferSlice }[] {
        const entries = [];
        for (let id = 0; id < data.length; id++) {
            if (predicate(id))
                entries.push({ ID: id, Data: data[id] });
        }
        return entries;
    }

    const geometryOwners = buildOwners('geometry');
    const animatedOwners = buildOwners('animated');
    for (const textureID of geometryOwners.keys())
        assert(textureID >= 0 && textureID < TexData.length);
    for (const textureID of animatedOwners.keys())
        assert(textureID >= 0 && textureID < AnimTexData.length);

    interface SharedTextureResource {
        kind: keyof TextureUsage;
        id: number;
        data: ArrayBufferSlice;
        owners: number[];
    }

    interface CommonTextureGroup {
        resources: SharedTextureResource[];
        owners: Set<number>;
        ownerRefCounts: number[];
        byteLength: number;
    }

    interface TextureOwnerSubset {
        key: string;
        resources: SharedTextureResource[];
        owners: number[];
        byteLength: number;
    }

    // A texture only belongs in the always-loaded archive when every map uses
    // it. All other shared textures are packed by map affinity to minimize
    // aggregate bytes fetched across the complete scene list.
    const universalTextureOwnerCount = levels.length;
    const commonTextureGroupCountArg = process.argv.find((arg) => arg.startsWith('--common-texture-groups='));
    const commonTextureGroupCount = commonTextureGroupCountArg !== undefined
        ? Number.parseInt(commonTextureGroupCountArg.slice('--common-texture-groups='.length), 10)
        : 0x10;
    assert(Number.isInteger(commonTextureGroupCount) && commonTextureGroupCount >= 1 && commonTextureGroupCount <= 0x20);
    const sharedResources: SharedTextureResource[] = [];
    for (let id = 0; id < TexData.length; id++) {
        const owners = geometryOwners.get(id) ?? [];
        if (owners.length > 1 && owners.length < universalTextureOwnerCount)
            sharedResources.push({ kind: 'geometry', id, data: TexData[id], owners });
    }
    for (let id = 0; id < AnimTexData.length; id++) {
        const owners = animatedOwners.get(id) ?? [];
        if (owners.length > 1 && owners.length < universalTextureOwnerCount)
            sharedResources.push({ kind: 'animated', id, data: AnimTexData[id], owners });
    }

    // Canonicalize exact consumer subsets before packing. This both gives the
    // seeding pass more useful units than individual textures and guarantees
    // deterministic ordering independent of Map/Set iteration details.
    const subsetByKey = new Map<string, TextureOwnerSubset>();
    for (const resource of sharedResources) {
        const key = resource.owners.join(',');
        let subset = subsetByKey.get(key);
        if (subset === undefined) {
            subset = { key, resources: [], owners: resource.owners, byteLength: 0 };
            subsetByKey.set(key, subset);
        }
        subset.resources.push(resource);
        subset.byteLength += resource.data.byteLength;
    }
    const textureOwnerSubsets = [...subsetByKey.values()];
    textureOwnerSubsets.sort((a, b) =>
        b.byteLength - a.byteLength
        || b.owners.length - a.owners.length
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

    // Seed each pack with one of the largest exact-owner subsets, then pack
    // the remaining subsets from largest to smallest. Adding a subset grows
    // the group for its existing consumers and can also make new maps fetch
    // every resource already in that group.
    const commonTextureGroups: CommonTextureGroup[] = Array.from({ length: commonTextureGroupCount }, () => ({
        resources: [],
        owners: new Set<number>(),
        ownerRefCounts: Array(levels.length).fill(0),
        byteLength: 0,
    }));
    const subsetGroup = new Map<TextureOwnerSubset, number>();

    function addSubsetToGroup(subset: TextureOwnerSubset, groupIndex: number): void {
        const group = commonTextureGroups[groupIndex];
        group.resources.push(...subset.resources);
        group.byteLength += subset.byteLength;
        subsetGroup.set(subset, groupIndex);
        for (const owner of subset.owners) {
            group.owners.add(owner);
            group.ownerRefCounts[owner]++;
        }
    }

    const seededSubsetCount = Math.min(commonTextureGroupCount, textureOwnerSubsets.length);
    for (let subsetIndex = 0; subsetIndex < seededSubsetCount; subsetIndex++)
        addSubsetToGroup(textureOwnerSubsets[subsetIndex], subsetIndex);

    for (let subsetIndex = seededSubsetCount; subsetIndex < textureOwnerSubsets.length; subsetIndex++) {
        const subset = textureOwnerSubsets[subsetIndex];
        let bestGroup = 0;
        let bestCost = Infinity;
        let bestAddedOwners = Infinity;
        for (let groupIndex = 0; groupIndex < commonTextureGroups.length; groupIndex++) {
            const group = commonTextureGroups[groupIndex];
            let addedOwners = 0;
            for (const owner of subset.owners) {
                if (!group.owners.has(owner))
                    addedOwners++;
            }
            const newOwnerCount = group.owners.size + addedOwners;
            const incrementalCost = (group.byteLength + subset.byteLength) * newOwnerCount
                - group.byteLength * group.owners.size;
            if (incrementalCost < bestCost
                || (incrementalCost === bestCost && addedOwners < bestAddedOwners)
                || (incrementalCost === bestCost && addedOwners === bestAddedOwners
                    && group.byteLength < commonTextureGroups[bestGroup].byteLength)) {
                bestGroup = groupIndex;
                bestCost = incrementalCost;
                bestAddedOwners = addedOwners;
            }
        }
        addSubsetToGroup(subset, bestGroup);
    }

    // The greedy pass gives every large subset a reasonable home. Revisit
    // those choices until moving any complete owner subset no longer reduces
    // total bytes fetched across all maps. The always-loaded archive is also
    // a candidate: a broadly used subset can be cheaper there than the
    // collateral over-fetch it causes inside a shard.
    const baseTextureKeys = new Set<string>();
    for (let pass = 0; pass < 0x20; pass++) {
        let moveCount = 0;
        for (const subset of textureOwnerSubsets) {
            const sourceIndex = subsetGroup.get(subset)!;
            if (sourceIndex < 0)
                continue;
            const source = commonTextureGroups[sourceIndex];
            let removedOwners = 0;
            for (const owner of subset.owners) {
                if (source.ownerRefCounts[owner] === 1)
                    removedOwners++;
            }
            const sourceOwnerCountAfterMove = source.owners.size - removedOwners;
            const sourceBytesAfterMove = source.byteLength - subset.byteLength;
            const oldSourceCost = source.byteLength * source.owners.size;
            const newSourceCost = sourceBytesAfterMove * sourceOwnerCountAfterMove;

            let bestDestination = sourceIndex;
            let bestDelta = 0;
            const moveToBaseDelta = newSourceCost
                + subset.byteLength * levels.length
                - oldSourceCost;
            if (moveToBaseDelta < bestDelta) {
                bestDelta = moveToBaseDelta;
                bestDestination = -1;
            }
            for (let destinationIndex = 0; destinationIndex < commonTextureGroups.length; destinationIndex++) {
                if (destinationIndex === sourceIndex)
                    continue;
                const destination = commonTextureGroups[destinationIndex];
                let addedOwners = 0;
                for (const owner of subset.owners) {
                    if (destination.ownerRefCounts[owner] === 0)
                        addedOwners++;
                }
                const oldDestinationCost = destination.byteLength * destination.owners.size;
                const newDestinationCost = (destination.byteLength + subset.byteLength)
                    * (destination.owners.size + addedOwners);
                const delta = newSourceCost + newDestinationCost - oldSourceCost - oldDestinationCost;
                if (delta < bestDelta) {
                    bestDelta = delta;
                    bestDestination = destinationIndex;
                }
            }
            if (bestDestination === sourceIndex)
                continue;

            for (const resource of subset.resources)
                source.resources.splice(source.resources.indexOf(resource), 1);
            source.byteLength -= subset.byteLength;
            for (const owner of subset.owners) {
                source.ownerRefCounts[owner]--;
                if (source.ownerRefCounts[owner] === 0)
                    source.owners.delete(owner);
            }
            if (bestDestination < 0) {
                for (const resource of subset.resources)
                    baseTextureKeys.add(`${resource.kind}:${resource.id}`);
                subsetGroup.set(subset, -1);
                moveCount++;
                continue;
            }

            const destination = commonTextureGroups[bestDestination];
            destination.resources.push(...subset.resources);
            destination.byteLength += subset.byteLength;
            for (const owner of subset.owners) {
                if (destination.ownerRefCounts[owner]++ === 0)
                    destination.owners.add(owner);
            }
            subsetGroup.set(subset, bestDestination);
            moveCount++;
        }
        if (moveCount === 0)
            break;
    }

    const groupByTexture = new Map<string, number>();
    for (let groupIndex = 0; groupIndex < commonTextureGroups.length; groupIndex++) {
        for (const resource of commonTextureGroups[groupIndex].resources)
            groupByTexture.set(`${resource.kind}:${resource.id}`, groupIndex);
    }
    for (let mapID = 0; mapID < levels.length; mapID++) {
        for (const kind of ['geometry', 'animated'] as const) {
            const owners = kind === 'geometry' ? geometryOwners : animatedOwners;
            for (const textureID of levels[mapID].textureUsage[kind]) {
                const ownerCount = owners.get(textureID)!.length;
                if (ownerCount === 1 || ownerCount === universalTextureOwnerCount)
                    continue;
                const key = `${kind}:${textureID}`;
                if (baseTextureKeys.has(key))
                    continue;
                const groupIndex = groupByTexture.get(key);
                assert(groupIndex !== undefined && commonTextureGroups[groupIndex].owners.has(mapID));
            }
        }
    }

    function resourcesToArchive(resources: SharedTextureResource[]): {
        TexData: { ID: number, Data: ArrayBufferSlice }[],
        AnimTexData: { ID: number, Data: ArrayBufferSlice }[],
    } {
        const sortedResources = [...resources].sort((a, b) =>
            (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
            || a.id - b.id,
        );
        return {
            TexData: sortedResources
                .filter((resource) => resource.kind === 'geometry')
                .map((resource) => ({ ID: resource.id, Data: resource.data })),
            AnimTexData: sortedResources
                .filter((resource) => resource.kind === 'animated')
                .map((resource) => ({ ID: resource.id, Data: resource.data })),
        };
    }

    function writeArchive(filename: string, archive: any): number {
        const data = BYML.write(archive, BYML.FileType.CRG1);
        writeFileSync(`${pathBaseOut}/${filename}`, Buffer.from(data));
        return data.byteLength;
    }

    const common = {
        SpriteData,
        CustomScriptFunctionData,
        TexData: makeTextureEntries(TexData, (id) =>
            (geometryOwners.get(id)?.length ?? 0) === universalTextureOwnerCount
            || baseTextureKeys.has(`geometry:${id}`)),
        AnimTexData: makeTextureEntries(AnimTexData, (id) =>
            (animatedOwners.get(id)?.length ?? 0) === universalTextureOwnerCount
            || baseTextureKeys.has(`animated:${id}`)),
    };
    const commonArchiveSize = writeArchive('common.crg1', common);

    const commonTextureGroupArchiveSizes: number[] = [];
    for (let groupIndex = 0; groupIndex < commonTextureGroups.length; groupIndex++) {
        const suffix = hexzero(groupIndex, 2).toUpperCase();
        const archive = resourcesToArchive(commonTextureGroups[groupIndex].resources);
        commonTextureGroupArchiveSizes[groupIndex] = writeArchive(`common_${suffix}.crg1`, archive);
    }

    const unknown = {
        TexData: makeTextureEntries(TexData, (id) => !geometryOwners.has(id)),
        AnimTexData: makeTextureEntries(AnimTexData, (id) => !animatedOwners.has(id)),
    };
    const unknownArchiveSize = writeArchive('unknown.crg1', unknown);

    const levelArchiveSizes: number[] = [];
    const singleCommonLevelArchiveSizes: number[] = [];
    const commonTextureGroupIDsByLevel: number[][] = [];
    for (let mapID = 0; mapID < levels.length; mapID++) {
        const source = levels[mapID];
        const levelWithoutGroups = {
            MapData: source.MapData,
            Backdrop: source.Backdrop,
            SetupData: source.SetupData,
            ScriptData: source.ScriptData,
            CritterData: source.CritterData,
            PropGeometry: source.PropGeometry,
            ActorDefinitions: source.ActorDefinitions,
            ActorGeometry: source.ActorGeometry,
            AnimationData: source.AnimationData,
            EnvironmentParticleData: source.EnvironmentParticleData,
            TexData: makeTextureEntries(TexData, (id) => geometryOwners.get(id)?.length === 1 && geometryOwners.get(id)![0] === mapID),
            AnimTexData: makeTextureEntries(AnimTexData, (id) => animatedOwners.get(id)?.length === 1 && animatedOwners.get(id)![0] === mapID),
            // Future rendering paths can set this when they deliberately
            // reference data whose ownership is not yet understood.
            UsesUnknownTextures: false,
        };
        const commonTextureGroupIDs = commonTextureGroups
            .map((group, groupIndex) => group.owners.has(mapID) ? groupIndex : -1)
            .filter((groupIndex) => groupIndex >= 0);
        const level = {
            ...levelWithoutGroups,
            CommonTextureGroups: commonTextureGroupIDs,
        };
        const filename = `${hexzero(mapID, 2).toUpperCase()}.crg1`;
        levelArchiveSizes[mapID] = writeArchive(filename, level);
        singleCommonLevelArchiveSizes[mapID] = BYML.write(levelWithoutGroups, BYML.FileType.CRG1).byteLength;
        commonTextureGroupIDsByLevel[mapID] = commonTextureGroupIDs;
    }

    const singleCommon = {
        SpriteData,
        CustomScriptFunctionData,
        TexData: makeTextureEntries(TexData, (id) => (geometryOwners.get(id)?.length ?? 0) > 1),
        AnimTexData: makeTextureEntries(AnimTexData, (id) => (animatedOwners.get(id)?.length ?? 0) > 1),
    };
    const singleCommonArchiveSize = BYML.write(singleCommon, BYML.FileType.CRG1).byteLength;

    const shardedTextureCount = commonTextureGroups.reduce((sum, group) => sum + group.resources.length, 0);
    const shardedTextureBytes = commonTextureGroups.reduce((sum, group) => sum + group.byteLength, 0);
    const idealAggregateTextureBytes = sharedResources.reduce(
        (sum, resource) => sum + resource.data.byteLength * resource.owners.length, 0,
    );
    const baseTextureBytes = sharedResources
        .filter((resource) => baseTextureKeys.has(`${resource.kind}:${resource.id}`))
        .reduce((sum, resource) => sum + resource.data.byteLength, 0);
    const packedAggregateTextureBytes = commonTextureGroups.reduce(
        (sum, group) => sum + group.byteLength * group.owners.size, 0,
    ) + baseTextureBytes * levels.length;
    const groupRequestsPerLevel = levels.map((_, mapID) =>
        commonTextureGroups.filter((group) => group.owners.has(mapID)).length,
    );
    const fetchedBytesPerLevel = levels.map((_, mapID) =>
        commonArchiveSize
        + levelArchiveSizes[mapID]
        + commonTextureGroupIDsByLevel[mapID].reduce(
            (sum, groupIndex) => sum + commonTextureGroupArchiveSizes[groupIndex], 0,
        ),
    );
    const singleCommonFetchedBytesPerLevel = levels.map((_, mapID) =>
        singleCommonArchiveSize + singleCommonLevelArchiveSizes[mapID],
    );
    const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const averageFetchedBytes = average(fetchedBytesPerLevel);
    const averageSingleCommonFetchedBytes = average(singleCommonFetchedBytesPerLevel);
    const fetchReduction = 1 - averageFetchedBytes / averageSingleCommonFetchedBytes;
    const formatBytes = (bytes: number): string => bytes >= 0x100000
        ? `${(bytes / 0x100000).toFixed(2)} MiB`
        : `${(bytes / 0x400).toFixed(1)} KiB`;

    const unhandledFeatureOwners = new Map<string, { feature: UnhandledMapFeature, maps: number[] }>();
    for (let mapID = 0; mapID < levels.length; mapID++) {
        for (const feature of levels[mapID].UnhandledMapFeatures) {
            const key = `${feature.Kind}:${feature.Material}`;
            let entry = unhandledFeatureOwners.get(key);
            if (entry === undefined) {
                entry = {
                    feature: { ...feature, Count: 0 },
                    maps: [],
                };
                unhandledFeatureOwners.set(key, entry);
            }
            entry.feature.Count += feature.Count;
            entry.maps.push(mapID);
        }
    }
    console.log('DK64 unhandled map-rendering inventory:');
    if (unhandledFeatureOwners.size === 0) {
        console.log('  none');
    } else {
        for (const { feature, maps } of unhandledFeatureOwners.values()) {
            const mapList = maps.map((mapID) => hexzero(mapID, 2).toUpperCase()).join(',');
            console.log(`  ${feature.Kind} ${feature.Material}: ${feature.Count} entries in maps ${mapList}`);
        }
    }

    console.log(`DK64 texture analysis (${levels.length} maps, minimizing aggregate fetched bytes):`);
    console.log(`  sharded textures: ${shardedTextureCount} (${shardedTextureBytes} bytes)`);
    console.log(`  optimizer promoted to always-loaded: ${baseTextureKeys.size} textures (${baseTextureBytes} bytes)`);
    console.log(`  groups requested per map: min ${Math.min(...groupRequestsPerLevel)}, average ${(groupRequestsPerLevel.reduce((a, b) => a + b, 0) / levels.length).toFixed(2)}, max ${Math.max(...groupRequestsPerLevel)}`);
    console.log(`  average shared-texture bytes: ideal ${(idealAggregateTextureBytes / levels.length).toFixed(0)}, packed ${(packedAggregateTextureBytes / levels.length).toFixed(0)} (${(packedAggregateTextureBytes / idealAggregateTextureBytes).toFixed(2)}x)`);
    console.log(`DK64 archive fetch analysis:`);
    console.log(`  common.crg1: ${formatBytes(commonArchiveSize)} (${commonArchiveSize} bytes)`);
    console.log(`  common_00..${hexzero(commonTextureGroupCount - 1, 2).toUpperCase()}.crg1 combined: ${formatBytes(commonTextureGroupArchiveSizes.reduce((sum, size) => sum + size, 0))}`);
    console.log(`  unknown.crg1: ${formatBytes(unknownArchiveSize)} (not loaded by current maps)`);
    console.log(`  average first-level fetch: ${formatBytes(averageFetchedBytes)}`);
    console.log(`  single-common baseline: ${formatBytes(averageSingleCommonFetchedBytes)}`);
    console.log(`  average fetch reduction: ${(fetchReduction * 100).toFixed(1)}%`);
    console.log(`  first-level fetch range: ${formatBytes(Math.min(...fetchedBytesPerLevel))} .. ${formatBytes(Math.max(...fetchedBytesPerLevel))}`);
    for (let groupIndex = 0; groupIndex < commonTextureGroups.length; groupIndex++) {
        const group = commonTextureGroups[groupIndex];
        console.log(`  common_${hexzero(groupIndex, 2).toUpperCase()}: ${group.resources.length} textures, ${formatBytes(commonTextureGroupArchiveSizes[groupIndex])}, ${group.owners.size} maps`);
    }
}

main();
