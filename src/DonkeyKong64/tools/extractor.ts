
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync } from "fs";

import * as BYML from '../../byml.js';
import { assert } from "../../util.js";
import { Zlib, inflateRawSync } from "zlib";
import { hexzero } from "../../util.js";
import { gunzipSync } from "zlib";
import { parseInstanceScripts, parseSetup as parseSetupData } from '../parse.js';
import {
    GeneratedSurfaceMaterial, SceneNodeMaterial,
    getGeneratedSurfaceAnimatedTextureBindings, getSceneNodeAnimatedTextureBindings,
    isGeneratedSurfaceMaterial, isSceneNodeMaterial,
} from '../material.js';

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
    const size = engine.bytesWritten;

    return 0x12 + size;
}

function cutZlibBuffer(buffer: ArrayBufferSlice, srcOffs: number): ArrayBufferSlice {
    const size = determineSizeOfZlibStream(buffer, srcOffs);
    return buffer.subarray(srcOffs, size);
}

const PointerTable = {
    PropGeometry: 4,
    ActorGeometry: 5,
    TexturesUncompressed: 7,
    Setup: 9,
    Scripts: 10,
    Animations: 11,
    HUDTextures: 14,
    Critters: 22,
} as const;

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

    // Map data table.
    const MapData: (ArrayBufferSlice | number)[] = [];
    let mapTableIdx = MapTableOffset;
    for (let i = 0; i < 0xD8; i++) {
        const mapDataPtr = view.getUint32(mapTableIdx + 0x00);

        const offs = (mapDataPtr & 0x7FFFFFFF) + PointerTableOffset;
        if (!!(mapDataPtr & 0x80000000)) {
            // Indirect reference to another map.
            const otherMap = view.getUint16(offs);
            MapData[i] = otherMap;
        } else {
            // TODO(jstpierre): Extract the proper size, and decompress on client.
            MapData[i] = cutZlibBuffer(romData, offs);
        }

        mapTableIdx += 0x04;
    }

    const backdropTextureIDs = new Map<number, number>([
        [0x0E, 0x2D], // Aztec beetle race

        [0x03, 0x2E], // K. Rool barrel: Lanky's maze

        [0x0B, 0x2E], // Stealthy Snoop (normal, no logo)
        [0x41, 0x2E], // Stealthy Snoop (normal)
        [0x7E, 0x2E], // Stealthy Snoop (very easy)
        [0x7F, 0x2E], // Stealthy Snoop (easy)
        [0x80, 0x2E], // Stealthy Snoop (hard)

        [0x42, 0x2E], // Mad Maze Maul (hard)
        [0x44, 0x2E], // Mad Maze Maul (easy)
        [0x45, 0x2E], // Mad Maze Maul (normal)
        [0x7C, 0x2E], // Mad Maze Maul (insane)

        [0x43, 0x2E], // Stash Snatch (normal)
        [0x4A, 0x2E], // Stash Snatch (easy)
        [0x4B, 0x2E], // Stash Snatch (hard)
        [0x7D, 0x2E], // Stash Snatch (insane)
    ]);

    function getTableOffset(table: number): number {
        return PointerTableOffset + view.getUint32(PointerTableOffset + table * 4);
    }

    function getTableCount(table: number): number {
        return view.getUint32(PointerTableOffset + 0x80 + table * 4);
    }

    function extractCompressedTable(table: number): (ArrayBufferSlice | number)[] {
        const tableOffset = getTableOffset(table);
        const files: (ArrayBufferSlice | number)[] = [];
        const firstFileForPointer = new Map<number, number>();
        for (let i = 0; i < getTableCount(table); i++) {
            const pointer = view.getUint32(tableOffset + i * 4);
            const nextTableStart = table < 31 ? view.getUint32(PointerTableOffset + (table + 1) * 4) : 0;
            if (!(pointer & 0x80000000) && nextTableStart !== 0 && pointer >= nextTableStart)
                break;
            const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
            if ((pointer & 0x80000000) !== 0)
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
        assert(index >= 0 && index < getTableCount(table));
        const pointer = view.getUint32(tableOffset + index * 4);
        const nextPointer = view.getUint32(tableOffset + (index + 1) * 4);
        assert((pointer & 0x80000000) === 0 && (nextPointer & 0x80000000) === 0);
        const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
        const nextOffs = (nextPointer & 0x7FFFFFFF) + PointerTableOffset;
        assert(nextOffs >= offs);
        return romData.subarray(offs, nextOffs - offs);
    }

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

    const globalASM = Buffer.concat([
        gunzipSync(romData.createTypedArray(Uint8Array, 0x113F0, 0xC29D4 - 0x113F0)),
        gunzipSync(romData.createTypedArray(Uint8Array, 0xC29D4, 0x949C)),
    ]);
    function globalAddressToOffset(address: number): number {
        const offs = address - 0x805FB300;
        assert(offs >= 0 && offs < globalASM.length);
        return offs;
    }

    const SpriteData = Array.from({ length: 176 }, (_, i) => {
        const address = globalASM.readUInt32BE(0x15A090 + i * 4);
        const offs = globalAddressToOffset(address);
        const imageCount = globalASM.readUInt16BE(offs + 0x12);
        return {
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
            images: Array.from({ length: imageCount }, (_, j) => globalASM.readUInt16BE(offs + 0x14 + j * 2)),
        };
    });
    const CustomScriptFunctionData = Array.from({ length: 118 }, (_, i) =>
        globalASM.readUInt32BE(0x14CB70 + i * 4));
    const EnvironmentParticleData = Array.from({ length: 13 }, (_, i) => {
        const offs = 0x14D8A0 + i * 0x20;
        return {
            map: globalASM.readUInt8(offs),
            start: [globalASM.readInt16BE(offs + 2), globalASM.readInt16BE(offs + 4), globalASM.readInt16BE(offs + 6)],
            end: [globalASM.readInt16BE(offs + 8), globalASM.readInt16BE(offs + 0x0A), globalASM.readInt16BE(offs + 0x0C)],
            gap: globalASM.readFloatBE(offs + 0x10),
            distance: globalASM.readInt16BE(offs + 0x14),
            baseScale: globalASM.readFloatBE(offs + 0x18),
            risingScale: globalASM.readFloatBE(offs + 0x1C),
        };
    });
    const actorModelByType = new Map(Array.from({ length: 0x80 }, (_, i) => {
        const offs = globalAddressToOffset(0x8074E8B0) + i * 0x30;
        return [globalASM.readUInt16BE(offs), globalASM.readUInt16BE(offs + 2)] as const;
    }));

    // Texture data table.
    const TexData: ArrayBufferSlice[] = [];
    // TODO(jstpierre): Proper count
    let texTableIdx = TextureTableOffset;
    const textureCount = Math.max(...SpriteData
        .filter((sprite) => sprite.table === 1)
        .flatMap((sprite) => sprite.images)) + 1;
    for (let i = 0; i < textureCount; i++) {
        const texDataPtr = view.getUint32(texTableIdx + 0x00);

        const offs = (texDataPtr & 0x7FFFFFFF) + PointerTableOffset;
        TexData[i] = cutZlibBuffer(romData, offs);

        texTableIdx += 0x04;
    }
    // The two panorama backdrops are given normal texture indices for later archive packing.
    const backdropTextureIndices = new Map<number, number>();
    for (const textureID of new Set(backdropTextureIDs.values())) {
        backdropTextureIndices.set(textureID, TexData.length);
        TexData.push(resolveTableEntry(HUDTextureData, textureID));
    }

    // Table 7 textures are uncompressed and used for animated map materials.
    const AnimTexData: ArrayBufferSlice[] = [];
    const uncompressedTextureCount = Math.max(0x3E1, Math.max(...SpriteData
        .filter((sprite) => sprite.table === 0)
        .flatMap((sprite) => sprite.images)) + 1);
    for (let i = 0; i < uncompressedTextureCount; i++)
        AnimTexData[i] = extractRawTableEntry(PointerTable.TexturesUncompressed, i);

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
        textureUsage: TextureUsage;
    }

    const supportedSceneNodeMaterials = new Set<number>([
        SceneNodeMaterial.Sand,
        SceneNodeMaterial.WaterStream,
        SceneNodeMaterial.Water,
        SceneNodeMaterial.GroundFog,
    ]);

    function scanTextureCommands(data: Buffer, start: number, end: number, output: Set<number>, excluded = new Set<number>()): void {
        assert(start >= 0 && start <= end && end <= data.byteLength);
        for (let offs = start; offs + 8 <= end; offs += 8) {
            if (data.readUInt8(offs) !== 0xFD)
                continue;
            const address = data.readUInt32BE(offs + 4);
            // Segment zero means an index into pointer table 25.
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

        // Surfaces use fixed textures that need to be accounted for.
        const generatedSurfaceStart = map.readUInt32BE(0x4C);
        const generatedSurfaceCount = map.readUInt32BE(generatedSurfaceStart);
        for (let i = 0; i < generatedSurfaceCount; i++) {
            const material = map.readUInt8(generatedSurfaceStart + 4 + i * 0x6C + 0x66);
            if (isGeneratedSurfaceMaterial(material)) {
                for (const binding of getGeneratedSurfaceAnimatedTextureBindings(material)) {
                    for (const textureID of binding.textureIDs)
                        usage.animated.add(textureID);
                }
            }
            switch (material) {
            case GeneratedSurfaceMaterial.Lava:
                usage.geometry.add(0x2EE);
                usage.geometry.add(0x2EF);
                break;
            case GeneratedSurfaceMaterial.Meadow:
                usage.geometry.add(0xF0);
                break;
            case GeneratedSurfaceMaterial.Dirt:
                usage.geometry.add(0x75C);
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
            if (supportedSceneNodeMaterials.has(material) && isSceneNodeMaterial(material)) {
                for (const binding of getSceneNodeAnimatedTextureBindings(material)) {
                    for (const textureID of binding.textureIDs)
                        usage.animated.add(textureID);
                }
            }
            switch (material) {
            case SceneNodeMaterial.Sand:
                usage.geometry.add(0x565);
                break;
            case SceneNodeMaterial.GroundFog:
                usage.geometry.add(0x1765);
                break;
            }
        }
    }

    function scanPropTextureUsage(prop: Buffer, usage: TextureUsage): void {
        const decalTexture = prop.readUInt16BE(0x28);
        if (decalTexture !== 0xFFFF)
            usage.geometry.add(decalTexture);

        const animatedTargets = new Set<number>();
        const indexedStart = prop.readUInt32BE(0x6C);
        if (indexedStart + 4 <= prop.length) {
            const count = prop.readUInt32BE(indexedStart);
            for (let i = 0; i < count; i++) {
                const offs = indexedStart + 4 + i * 0x84;
                if (offs + 0x84 > prop.length)
                    break;
                const frameCount = prop.readUInt32BE(offs + 0x0C);
                if (frameCount === 0 || frameCount > 0x1E)
                    continue;
                animatedTargets.add(prop.readUInt32BE(offs));
                for (let frame = 0; frame < frameCount; frame++)
                    usage.animated.add(frame === 0 ? prop.readUInt32BE(offs) : prop.readUInt32BE(offs + 0x0C + frame * 4));
            }
        }

        const layout = prop.readUInt8(0x1C);
        if (layout === 2) {
            // from func_global_asm_8063524C
            const runtimeStart = prop.readUInt32BE(0x70);
            if (runtimeStart + 4 <= prop.length) {
                const count = prop.readUInt32BE(runtimeStart);
                for (let i = 0; i < count; i++) {
                    const offs = runtimeStart + 4 + i * 0x30;
                    if (offs + 0x30 > prop.length)
                        break;
                    const texture = prop.readUInt16BE(offs);
                    const palette = prop.readUInt16BE(offs + 2);
                    if (!animatedTargets.has(texture))
                        usage.geometry.add(texture);
                    if (palette !== 0xFFFF)
                        usage.geometry.add(palette);
                }
            }
            return;
        }
        if (layout !== 1)
            return;
        scanTextureCommands(
            prop,
            Math.min(prop.readUInt32BE(0x40), prop.readUInt32BE(0x44)),
            prop.readUInt32BE(0x48),
            usage.geometry,
            animatedTargets,
        );
    }

    function scanActorTextureUsage(actor: Buffer, usage: TextureUsage): void {
        const runtimeBase = actor.readUInt32BE(0);
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
        const displayListTable = actor.readUInt32BE(4) - runtimeBase + 0x28;
        for (let i = 0; i < actor.readUInt8(0x21); i++)
            scanDisplayList(0x03000000 | (actor.readUInt32BE(displayListTable + i * 4) - runtimeBase));
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
        const propIDs = new Set(parseSetupData(ArrayBufferSlice.fromView(setup)).props.map(({ id }) => id));
        for (const script of parseInstanceScripts(ArrayBufferSlice.fromView(scripts))) {
            for (const block of script.blocks) {
                const condition = block.conditions.length === 1 ? block.conditions[0] : null;
                const resetsState = block.executions.some(({ opcode }) => opcode === 1);
                const usesPointSprite = block.executions.some(({ opcode, args }) =>
                    opcode === 7 && CustomScriptFunctionData[args[0]] === 0x80644EC8);
                if (propIDs.has(script.id) && condition?.opcode === 1 && condition.args[0] === 0 && !resetsState && usesPointSprite)
                    addSpriteTextureUsage(0x80720A7C, usage);
            }
        }
    }

    // Make self-contained map archives by resolving aliases and storing
    // appropriate prop geometry in the level archive.
    const levels: LevelSource[] = [];
    for (let mapID = 0; mapID < MapData.length; mapID++) {
        const mapData = resolveTableEntry(MapData, mapID);
        const setupData = resolveTableEntry(SetupData, mapID);
        const scriptData = resolveTableEntry(ScriptData, mapID);
        const map = gunzipSync(mapData.createTypedArray(Uint8Array));
        const setup = gunzipSync(setupData.createTypedArray(Uint8Array));
        const scripts = gunzipSync(scriptData.createTypedArray(Uint8Array));
        const parsedSetup = parseSetupData(ArrayBufferSlice.fromView(setup));
        const propTypes = new Set(parsedSetup.props.map(({ type }) => type));

        const PropGeometry = [];
        for (const type of propTypes) {
            if (type < PropGeometryData.length)
                PropGeometry.push({ Type: type, Data: resolveTableEntry(PropGeometryData, type) });
        }

        const actorModels = new Set<number>();
        const actorAnimations = new Set<number>();
        const actorDefinitions = new Map<number, number>();
        for (const { type } of parsedSetup.actors) {
            const model = actorModelByType.get(type + 0x10) ?? 0;
            actorDefinitions.set(type, model);
            if (model !== 0)
                actorModels.add(model);
            if (type === 0x10) {
                actorAnimations.add(0x402);
            } else if (type === 0x2A) {
                actorAnimations.add(0x402);
            } else if (type === 0x77) {
                actorAnimations.add(0x63F);
            }
        }
        const ActorDefinitions = [...actorDefinitions].map(([Type, Model]) => ({ Type, Model }));
        const ActorGeometry = [];
        for (const model of actorModels) {
            const tableIndex = model - 1; // Actor IDs are 1-based
            if (tableIndex < ActorGeometryData.length)
                ActorGeometry.push({ Model: model, Data: resolveTableEntry(ActorGeometryData, tableIndex) });
        }
        const animations = [...actorAnimations].map((id) => ({
            ID: id,
            // Table 11 stores uncompressed animations.
            Data: extractRawTableEntry(PointerTable.Animations, id),
        }));

        const environmentParticleData = EnvironmentParticleData.filter((entry) => entry.map === mapID);
        const textureUsage: TextureUsage = { geometry: new Set(), animated: new Set() };
        scanMapTextureUsage(map, textureUsage);
        for (const prop of PropGeometry)
            scanPropTextureUsage(gunzipSync(prop.Data.createTypedArray(Uint8Array)), textureUsage);
        for (const actor of ActorGeometry)
            scanActorTextureUsage(gunzipSync(actor.Data.createTypedArray(Uint8Array)), textureUsage);
        if (environmentParticleData.length > 0) {
            addSpriteTextureUsage(0x8072140C, textureUsage);
            addSpriteTextureUsage(0x8071FF18, textureUsage);
        }
        scanScriptedSpriteUsage(setup, scripts, textureUsage);

        const backdropTextureID = backdropTextureIDs.get(mapID);
        const backdropTextureIndex = backdropTextureID !== undefined
            ? backdropTextureIndices.get(backdropTextureID)!
            : null;
        if (backdropTextureIndex !== null)
            textureUsage.geometry.add(backdropTextureIndex);
        levels.push({
            MapData: mapData,
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
            textureUsage,
        });
    }

    // Instead of having one big archive for all the DK64 content (~16MB),
    // split it into multiple archives.
    //
    // Structure:
    //        $MAP.crg1: map archive, unique mesh/texture/... data
    //   common_$N.crg1: a shard containing data used by multiple maps
    //      common.crg1: resources used by all maps.
    //
    // This splitting reduces the average map load to ~1.1MB, down from
    // the ~4.25MB baseline for common.crg1 + $MAP.crg1.

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
        byteLength: number;
    }

    interface TextureOwnerSubset {
        key: string;
        resources: SharedTextureResource[];
        owners: number[];
        byteLength: number;
    }

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

    // Canonicalize subsets for determinism.
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

    const commonTextureGroups: CommonTextureGroup[] = Array.from({ length: commonTextureGroupCount }, () => ({
        resources: [],
        owners: new Set<number>(),
        byteLength: 0,
    }));

    function addSubsetToGroup(subset: TextureOwnerSubset, groupIndex: number): void {
        const group = commonTextureGroups[groupIndex];
        group.resources.push(...subset.resources);
        group.byteLength += subset.byteLength;
        for (const owner of subset.owners)
            group.owners.add(owner);
    }

    // To start, put the largest N subsets into a shard of its own.
    const seededSubsetCount = Math.min(commonTextureGroupCount, textureOwnerSubsets.length);
    for (let subsetIndex = 0; subsetIndex < seededSubsetCount; subsetIndex++)
        addSubsetToGroup(textureOwnerSubsets[subsetIndex], subsetIndex);

    // Then add the remaining subsets, attempting to minimize excess costs.
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
                const groupIndex = groupByTexture.get(`${kind}:${textureID}`);
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
            (geometryOwners.get(id)?.length ?? 0) === universalTextureOwnerCount),
        AnimTexData: makeTextureEntries(AnimTexData, (id) =>
            (animatedOwners.get(id)?.length ?? 0) === universalTextureOwnerCount),
    };
    const commonArchiveSize = writeArchive('common.crg1', common);

    const commonTextureGroupArchiveSizes: number[] = [];
    for (let groupIndex = 0; groupIndex < commonTextureGroups.length; groupIndex++) {
        const suffix = hexzero(groupIndex, 2).toUpperCase();
        const archive = resourcesToArchive(commonTextureGroups[groupIndex].resources);
        commonTextureGroupArchiveSizes[groupIndex] = writeArchive(`common_${suffix}.crg1`, archive);
    }

    let totalFetchedBytes = 0;
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
        };
        const commonTextureGroupIDs = commonTextureGroups
            .map((group, groupIndex) => group.owners.has(mapID) ? groupIndex : -1)
            .filter((groupIndex) => groupIndex >= 0);
        const level = {
            ...levelWithoutGroups,
            CommonTextureGroups: commonTextureGroupIDs,
        };
        const filename = `${hexzero(mapID, 2).toUpperCase()}.crg1`;
        const levelArchiveSize = writeArchive(filename, level);
        totalFetchedBytes += commonArchiveSize + levelArchiveSize
            + commonTextureGroupIDs.reduce((sum, groupIndex) => sum + commonTextureGroupArchiveSizes[groupIndex], 0);
    }
    console.log(`DK64 average fetch size: ${(totalFetchedBytes / levels.length / 0x400).toFixed(1)} KiB`);

}

main();
