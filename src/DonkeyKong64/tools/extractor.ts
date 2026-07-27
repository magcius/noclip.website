
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync } from "fs";

import * as BYML from '../../byml.js';
import { assert } from "../../util.js";
import { Zlib, inflateRawSync } from "zlib";
import { hexzero } from "../../util.js";
import { gunzipSync } from "zlib";
import {
    AnimatedTextureEntry, GeneratedSurfaceEntry, MapHeader, SceneNodeEntry,
    parseInstanceScripts, parseSetup as parseSetupData,
} from '../parse.js';
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

// USA pointer table locations.
const PointerTableOffset = 0x101C50;
const MapTableOffset = 0x15232C;
const TextureTableOffset = 0x118B638;
const MapCount = 0xD8;

//#region ROM tables

// A pointer table entry is either a compressed file, or, with the high bit set, an
// index redirecting to another entry in the same table.
type TableEntry = ArrayBufferSlice | number;

class ROMTables {
    private view: DataView;

    constructor(private romData: ArrayBufferSlice) {
        this.view = romData.createDataView();
    }

    public getTableOffset(table: number): number {
        return PointerTableOffset + this.view.getUint32(PointerTableOffset + table * 4);
    }

    public getTableCount(table: number): number {
        return this.view.getUint32(PointerTableOffset + 0x80 + table * 4);
    }

    public extractCompressedTable(table: number): TableEntry[] {
        const tableOffset = this.getTableOffset(table);
        const files: TableEntry[] = [];
        const firstFileForPointer = new Map<number, number>();
        for (let i = 0; i < this.getTableCount(table); i++) {
            const pointer = this.view.getUint32(tableOffset + i * 4);
            const nextTableStart = table < 31 ? this.view.getUint32(PointerTableOffset + (table + 1) * 4) : 0;
            if (!(pointer & 0x80000000) && nextTableStart !== 0 && pointer >= nextTableStart)
                break;
            const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
            if ((pointer & 0x80000000) !== 0)
                files[i] = this.view.getUint16(offs);
            else if (firstFileForPointer.has(pointer))
                files[i] = firstFileForPointer.get(pointer)!;
            else {
                firstFileForPointer.set(pointer, i);
                files[i] = cutZlibBuffer(this.romData, offs);
            }
        }
        return files;
    }

    public extractRawTableEntry(table: number, index: number): ArrayBufferSlice {
        const tableOffset = this.getTableOffset(table);
        assert(index >= 0 && index < this.getTableCount(table));
        const pointer = this.view.getUint32(tableOffset + index * 4);
        const nextPointer = this.view.getUint32(tableOffset + (index + 1) * 4);
        assert((pointer & 0x80000000) === 0 && (nextPointer & 0x80000000) === 0);
        const offs = (pointer & 0x7FFFFFFF) + PointerTableOffset;
        const nextOffs = (nextPointer & 0x7FFFFFFF) + PointerTableOffset;
        assert(nextOffs >= offs);
        return this.romData.subarray(offs, nextOffs - offs);
    }

    // The map table lives outside the pointer table, but uses the same entry encoding.
    public extractMapTable(): TableEntry[] {
        const MapData: TableEntry[] = [];
        let mapTableIdx = MapTableOffset;
        for (let i = 0; i < MapCount; i++) {
            const mapDataPtr = this.view.getUint32(mapTableIdx + 0x00);

            const offs = (mapDataPtr & 0x7FFFFFFF) + PointerTableOffset;
            if (!!(mapDataPtr & 0x80000000)) {
                // Indirect reference to another map.
                MapData[i] = this.view.getUint16(offs);
            } else {
                // TODO(jstpierre): Extract the proper size, and decompress on client.
                MapData[i] = cutZlibBuffer(this.romData, offs);
            }

            mapTableIdx += 0x04;
        }
        return MapData;
    }

    public extractTextureTable(count: number): ArrayBufferSlice[] {
        const TexData: ArrayBufferSlice[] = [];
        let texTableIdx = TextureTableOffset;
        for (let i = 0; i < count; i++) {
            const texDataPtr = this.view.getUint32(texTableIdx + 0x00);
            TexData[i] = cutZlibBuffer(this.romData, (texDataPtr & 0x7FFFFFFF) + PointerTableOffset);
            texTableIdx += 0x04;
        }
        return TexData;
    }
}

function resolveTableEntry(table: TableEntry[], index: number): ArrayBufferSlice {
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

//#endregion

//#region globalASM tables

interface SpriteInfo {
    address: number;
    id: number;
    imagesPerFrameHorizontal: number;
    imagesPerFrameVertical: number;
    flags: number;
    codec: number;
    params: number[];
    table: number;
    width: number;
    height: number;
    images: number[];
}

interface EnvironmentParticle {
    map: number;
    start: number[];
    end: number[];
    gap: number;
    distance: number;
    baseScale: number;
    risingScale: number;
}

function loadGlobalASM(romData: ArrayBufferSlice): Buffer {
    return Buffer.concat([
        gunzipSync(romData.createTypedArray(Uint8Array, 0x113F0, 0xC29D4 - 0x113F0)),
        gunzipSync(romData.createTypedArray(Uint8Array, 0xC29D4, 0x949C)),
    ]);
}

function globalAddressToOffset(globalASM: Buffer, address: number): number {
    const offs = address - 0x805FB300;
    assert(offs >= 0 && offs < globalASM.length);
    return offs;
}

function parseSpriteData(globalASM: Buffer): SpriteInfo[] {
    return Array.from({ length: 176 }, (_, i) => {
        const address = globalASM.readUInt32BE(0x15A090 + i * 4);
        const offs = globalAddressToOffset(globalASM, address);
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
}

function parseCustomScriptFunctionData(globalASM: Buffer): number[] {
    return Array.from({ length: 118 }, (_, i) => globalASM.readUInt32BE(0x14CB70 + i * 4));
}

function parseEnvironmentParticleData(globalASM: Buffer): EnvironmentParticle[] {
    return Array.from({ length: 13 }, (_, i) => {
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
}

function parseActorModelByType(globalASM: Buffer): Map<number, number> {
    return new Map(Array.from({ length: 0x80 }, (_, i) => {
        const offs = globalAddressToOffset(globalASM, 0x8074E8B0) + i * 0x30;
        return [globalASM.readUInt16BE(offs), globalASM.readUInt16BE(offs + 2)] as const;
    }));
}

//#endregion

//#region Texture usage scanning

interface TextureUsage {
    geometry: Set<number>;
    animated: Set<number>;
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

function scanMapGeometryTextureUsage(map: Buffer, usage: TextureUsage): void {
    const dlStart = map.readUInt32BE(MapHeader.displayListStart);
    const vertStart = map.readUInt32BE(MapHeader.vertexStart);
    scanTextureCommands(map, dlStart, vertStart, usage.geometry);
}

function scanMapAnimatedTextureUsage(map: Buffer, usage: TextureUsage): void {
    const animatedStart = map.readUInt32BE(MapHeader.animatedTextureTable);
    const animatedCount = map.readUInt32BE(animatedStart);
    for (let i = 0; i < animatedCount; i++) {
        const offs = animatedStart + 4 + i * AnimatedTextureEntry.stride;
        const frameCount = map.readUInt8(offs + AnimatedTextureEntry.frameCount);
        for (let frame = 0; frame < frameCount; frame++)
            usage.animated.add(map.readUInt32BE(offs + AnimatedTextureEntry.frames + frame * 4));
    }
}

// Surfaces use fixed textures that need to be accounted for.
function scanGeneratedSurfaceTextureUsage(map: Buffer, usage: TextureUsage): void {
    const generatedSurfaceStart = map.readUInt32BE(MapHeader.generatedSurfaceTable);
    const generatedSurfaceCount = map.readUInt32BE(generatedSurfaceStart);
    for (let i = 0; i < generatedSurfaceCount; i++) {
        const offs = generatedSurfaceStart + 4 + i * GeneratedSurfaceEntry.stride;
        const material = map.readUInt8(offs + GeneratedSurfaceEntry.material);
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
}

function scanSceneNodeTextureUsage(map: Buffer, usage: TextureUsage): void {
    const rootNode = map.readUInt32BE(MapHeader.sceneNodeRoot);
    const specialDisplayListCount = map.readUInt8(rootNode + SceneNodeEntry.displayListCount);
    for (let i = 0; i < specialDisplayListCount; i++) {
        const displayList = map.readInt32BE(rootNode + SceneNodeEntry.displayLists + i * 4);
        const material = map.readUInt16BE(rootNode + SceneNodeEntry.materials + i * 2);
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

function scanMapTextureUsage(map: Buffer, usage: TextureUsage): void {
    scanMapGeometryTextureUsage(map, usage);
    scanMapAnimatedTextureUsage(map, usage);
    scanGeneratedSurfaceTextureUsage(map, usage);
    scanSceneNodeTextureUsage(map, usage);
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

function addSpriteTextureUsage(spriteByAddress: Map<number, SpriteInfo>, address: number, usage: TextureUsage): void {
    const sprite = spriteByAddress.get(address);
    if (sprite === undefined)
        return;
    const output = sprite.table === 0 ? usage.animated : usage.geometry;
    for (const image of sprite.images)
        output.add(image);
}

function scanScriptedSpriteUsage(ctx: ExtractContext, setup: Buffer, scripts: Buffer, usage: TextureUsage): void {
    const propIDs = new Set(parseSetupData(ArrayBufferSlice.fromView(setup)).props.map(({ id }) => id));
    for (const script of parseInstanceScripts(ArrayBufferSlice.fromView(scripts))) {
        for (const block of script.blocks) {
            const condition = block.conditions.length === 1 ? block.conditions[0] : null;
            const resetsState = block.executions.some(({ opcode }) => opcode === 1);
            const usesPointSprite = block.executions.some(({ opcode, args }) =>
                opcode === 7 && ctx.customScriptFunctions[args[0]] === 0x80644EC8);
            if (propIDs.has(script.id) && condition?.opcode === 1 && condition.args[0] === 0 && !resetsState && usesPointSprite)
                addSpriteTextureUsage(ctx.spriteByAddress, 0x80720A7C, usage);
        }
    }
}

//#endregion

//#region Level assembly

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

// Actors whose bind pose comes from an animation rather than the model itself.
const actorAnimationByType = new Map<number, number>([
    [0x10, 0x402],
    [0x2A, 0x402],
    [0x77, 0x63F],
]);

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
    EnvironmentParticleData: EnvironmentParticle[];
    textureUsage: TextureUsage;
}

// Everything buildLevelSource needs that is shared across all maps.
interface ExtractContext {
    rom: ROMTables;
    MapData: TableEntry[];
    SetupData: TableEntry[];
    ScriptData: TableEntry[];
    CritterData: TableEntry[];
    PropGeometryData: TableEntry[];
    ActorGeometryData: TableEntry[];
    actorModelByType: Map<number, number>;
    environmentParticles: EnvironmentParticle[];
    spriteByAddress: Map<number, SpriteInfo>;
    customScriptFunctions: number[];
    backdropTextureIndices: Map<number, number>;
}

function buildLevelSource(ctx: ExtractContext, mapID: number): LevelSource {
    const mapData = resolveTableEntry(ctx.MapData, mapID);
    const setupData = resolveTableEntry(ctx.SetupData, mapID);
    const scriptData = resolveTableEntry(ctx.ScriptData, mapID);
    const map = gunzipSync(mapData.createTypedArray(Uint8Array));
    const setup = gunzipSync(setupData.createTypedArray(Uint8Array));
    const scripts = gunzipSync(scriptData.createTypedArray(Uint8Array));
    const parsedSetup = parseSetupData(ArrayBufferSlice.fromView(setup));
    const propTypes = new Set(parsedSetup.props.map(({ type }) => type));

    const PropGeometry = [];
    for (const type of propTypes) {
        if (type < ctx.PropGeometryData.length)
            PropGeometry.push({ Type: type, Data: resolveTableEntry(ctx.PropGeometryData, type) });
    }

    const actorModels = new Set<number>();
    const actorAnimations = new Set<number>();
    const actorDefinitions = new Map<number, number>();
    for (const { type } of parsedSetup.actors) {
        const model = ctx.actorModelByType.get(type + 0x10) ?? 0;
        actorDefinitions.set(type, model);
        if (model !== 0)
            actorModels.add(model);
        const animation = actorAnimationByType.get(type);
        if (animation !== undefined)
            actorAnimations.add(animation);
    }
    const ActorDefinitions = [...actorDefinitions].map(([Type, Model]) => ({ Type, Model }));
    const ActorGeometry = [];
    for (const model of actorModels) {
        const tableIndex = model - 1; // Actor IDs are 1-based
        if (tableIndex < ctx.ActorGeometryData.length)
            ActorGeometry.push({ Model: model, Data: resolveTableEntry(ctx.ActorGeometryData, tableIndex) });
    }
    const animations = [...actorAnimations].map((id) => ({
        ID: id,
        // Table 11 stores uncompressed animations.
        Data: ctx.rom.extractRawTableEntry(PointerTable.Animations, id),
    }));

    const environmentParticleData = ctx.environmentParticles.filter((entry) => entry.map === mapID);
    const textureUsage: TextureUsage = { geometry: new Set(), animated: new Set() };
    scanMapTextureUsage(map, textureUsage);
    for (const prop of PropGeometry)
        scanPropTextureUsage(gunzipSync(prop.Data.createTypedArray(Uint8Array)), textureUsage);
    for (const actor of ActorGeometry)
        scanActorTextureUsage(gunzipSync(actor.Data.createTypedArray(Uint8Array)), textureUsage);
    if (environmentParticleData.length > 0) {
        addSpriteTextureUsage(ctx.spriteByAddress, 0x8072140C, textureUsage);
        addSpriteTextureUsage(ctx.spriteByAddress, 0x8071FF18, textureUsage);
    }
    scanScriptedSpriteUsage(ctx, setup, scripts, textureUsage);

    const backdropTextureID = backdropTextureIDs.get(mapID);
    const backdropTextureIndex = backdropTextureID !== undefined
        ? ctx.backdropTextureIndices.get(backdropTextureID)!
        : null;
    if (backdropTextureIndex !== null)
        textureUsage.geometry.add(backdropTextureIndex);
    return {
        MapData: mapData,
        Backdrop: backdropTextureID !== undefined
            ? { TextureID: backdropTextureID, TextureIndex: backdropTextureIndex! }
            : null,
        SetupData: setupData,
        ScriptData: scriptData,
        CritterData: mapID < ctx.CritterData.length ? resolveTableEntry(ctx.CritterData, mapID) : null,
        PropGeometry,
        ActorDefinitions,
        ActorGeometry,
        AnimationData: animations,
        EnvironmentParticleData: environmentParticleData,
        textureUsage,
    };
}

//#endregion

//#region Common texture sharding

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

function buildTextureOwners(levels: LevelSource[], kind: keyof TextureUsage): Map<number, number[]> {
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

// A resource is shardable when it is used by more than one map, but not by all of
// them -- single-owner textures go in the map archive, universal ones in common.crg1.
function collectSharedResources(kind: keyof TextureUsage, data: ArrayBufferSlice[], owners: Map<number, number[]>, universalOwnerCount: number): SharedTextureResource[] {
    const resources: SharedTextureResource[] = [];
    for (let id = 0; id < data.length; id++) {
        const resourceOwners = owners.get(id) ?? [];
        if (resourceOwners.length > 1 && resourceOwners.length < universalOwnerCount)
            resources.push({ kind, id, data: data[id], owners: resourceOwners });
    }
    return resources;
}

// Resources with the same owner set always shard together, so group them up front.
// Canonicalize the subsets for determinism.
function groupResourcesByOwnerSubset(resources: SharedTextureResource[]): TextureOwnerSubset[] {
    const subsetByKey = new Map<string, TextureOwnerSubset>();
    for (const resource of resources) {
        const key = resource.owners.join(',');
        let subset = subsetByKey.get(key);
        if (subset === undefined) {
            subset = { key, resources: [], owners: resource.owners, byteLength: 0 };
            subsetByKey.set(key, subset);
        }
        subset.resources.push(resource);
        subset.byteLength += resource.data.byteLength;
    }
    const subsets = [...subsetByKey.values()];
    subsets.sort((a, b) =>
        b.byteLength - a.byteLength
        || b.owners.length - a.owners.length
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    return subsets;
}

function addSubsetToGroup(group: CommonTextureGroup, subset: TextureOwnerSubset): void {
    group.resources.push(...subset.resources);
    group.byteLength += subset.byteLength;
    for (const owner of subset.owners)
        group.owners.add(owner);
}

// Greedy bin-packing: a shard's cost is its size times the number of maps that have
// to fetch it, so prefer the group where adding this subset grows that product least.
function packSubsetsIntoGroups(subsets: TextureOwnerSubset[], groupCount: number): CommonTextureGroup[] {
    const groups: CommonTextureGroup[] = Array.from({ length: groupCount }, () => ({
        resources: [],
        owners: new Set<number>(),
        byteLength: 0,
    }));

    // To start, put the largest N subsets into a shard of its own.
    const seededSubsetCount = Math.min(groupCount, subsets.length);
    for (let subsetIndex = 0; subsetIndex < seededSubsetCount; subsetIndex++)
        addSubsetToGroup(groups[subsetIndex], subsets[subsetIndex]);

    // Then add the remaining subsets, attempting to minimize excess costs.
    for (let subsetIndex = seededSubsetCount; subsetIndex < subsets.length; subsetIndex++) {
        const subset = subsets[subsetIndex];
        let bestGroup = 0;
        let bestCost = Infinity;
        let bestAddedOwners = Infinity;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const group = groups[groupIndex];
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
                    && group.byteLength < groups[bestGroup].byteLength)) {
                bestGroup = groupIndex;
                bestCost = incrementalCost;
                bestAddedOwners = addedOwners;
            }
        }
        addSubsetToGroup(groups[bestGroup], subset);
    }

    return groups;
}

// Every map must be able to reach each of its shared textures through a group it fetches.
function verifyCommonTextureGroups(levels: LevelSource[], groups: CommonTextureGroup[], geometryOwners: Map<number, number[]>, animatedOwners: Map<number, number[]>, universalOwnerCount: number): void {
    const groupByTexture = new Map<string, number>();
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        for (const resource of groups[groupIndex].resources)
            groupByTexture.set(`${resource.kind}:${resource.id}`, groupIndex);
    }
    for (let mapID = 0; mapID < levels.length; mapID++) {
        for (const kind of ['geometry', 'animated'] as const) {
            const owners = kind === 'geometry' ? geometryOwners : animatedOwners;
            for (const textureID of levels[mapID].textureUsage[kind]) {
                const ownerCount = owners.get(textureID)!.length;
                if (ownerCount === 1 || ownerCount === universalOwnerCount)
                    continue;
                const groupIndex = groupByTexture.get(`${kind}:${textureID}`);
                assert(groupIndex !== undefined && groups[groupIndex].owners.has(mapID));
            }
        }
    }
}

function parseCommonTextureGroupCountArg(): number {
    const prefix = '--common-texture-groups=';
    const arg = process.argv.find((entry) => entry.startsWith(prefix));
    const count = arg !== undefined ? Number.parseInt(arg.slice(prefix.length), 10) : 0x10;
    assert(Number.isInteger(count) && count >= 1 && count <= 0x20);
    return count;
}

//#endregion

//#region Archive writing

function makeTextureEntries(data: ArrayBufferSlice[], predicate: (id: number) => boolean): { ID: number, Data: ArrayBufferSlice }[] {
    const entries = [];
    for (let id = 0; id < data.length; id++) {
        if (predicate(id))
            entries.push({ ID: id, Data: data[id] });
    }
    return entries;
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

interface ArchiveSources {
    levels: LevelSource[];
    TexData: ArrayBufferSlice[];
    AnimTexData: ArrayBufferSlice[];
    SpriteData: SpriteInfo[];
    CustomScriptFunctionData: number[];
    geometryOwners: Map<number, number[]>;
    animatedOwners: Map<number, number[]>;
    commonTextureGroups: CommonTextureGroup[];
}

function writeArchives(sources: ArchiveSources): void {
    const { levels, TexData, AnimTexData, geometryOwners, animatedOwners, commonTextureGroups } = sources;
    const universalTextureOwnerCount = levels.length;

    const common = {
        SpriteData: sources.SpriteData,
        CustomScriptFunctionData: sources.CustomScriptFunctionData,
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
        const commonTextureGroupIDs = commonTextureGroups
            .map((group, groupIndex) => group.owners.has(mapID) ? groupIndex : -1)
            .filter((groupIndex) => groupIndex >= 0);
        const level = {
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
            CommonTextureGroups: commonTextureGroupIDs,
        };
        const filename = `${hexzero(mapID, 2).toUpperCase()}.crg1`;
        const levelArchiveSize = writeArchive(filename, level);
        totalFetchedBytes += commonArchiveSize + levelArchiveSize
            + commonTextureGroupIDs.reduce((sum, groupIndex) => sum + commonTextureGroupArchiveSizes[groupIndex], 0);
    }
    console.log(`DK64 average fetch size: ${(totalFetchedBytes / levels.length / 0x400).toFixed(1)} KiB`);
}

//#endregion

function main() {
    const romData = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const rom = new ROMTables(romData);
    const globalASM = loadGlobalASM(romData);
    const SpriteData = parseSpriteData(globalASM);

    const TexData = rom.extractTextureTable(Math.max(...SpriteData
        .filter((sprite) => sprite.table === 1)
        .flatMap((sprite) => sprite.images)) + 1);
    // The two panorama backdrops are given normal texture indices for later archive packing.
    const HUDTextureData = rom.extractCompressedTable(PointerTable.HUDTextures);
    const backdropTextureIndices = new Map<number, number>();
    for (const textureID of new Set(backdropTextureIDs.values())) {
        backdropTextureIndices.set(textureID, TexData.length);
        TexData.push(resolveTableEntry(HUDTextureData, textureID));
    }

    // Table 7 textures are uncompressed and used for animated map materials.
    const uncompressedTextureCount = Math.max(0x3E1, Math.max(...SpriteData
        .filter((sprite) => sprite.table === 0)
        .flatMap((sprite) => sprite.images)) + 1);
    const AnimTexData = Array.from({ length: uncompressedTextureCount }, (_, i) =>
        rom.extractRawTableEntry(PointerTable.TexturesUncompressed, i));

    const CustomScriptFunctionData = parseCustomScriptFunctionData(globalASM);
    const ctx: ExtractContext = {
        rom,
        MapData: rom.extractMapTable(),
        SetupData: rom.extractCompressedTable(PointerTable.Setup),
        ScriptData: rom.extractCompressedTable(PointerTable.Scripts),
        CritterData: rom.extractCompressedTable(PointerTable.Critters),
        PropGeometryData: rom.extractCompressedTable(PointerTable.PropGeometry),
        ActorGeometryData: rom.extractCompressedTable(PointerTable.ActorGeometry),
        actorModelByType: parseActorModelByType(globalASM),
        environmentParticles: parseEnvironmentParticleData(globalASM),
        spriteByAddress: new Map(SpriteData.map((sprite) => [sprite.address, sprite])),
        customScriptFunctions: CustomScriptFunctionData,
        backdropTextureIndices,
    };

    // Make self-contained map archives by resolving aliases and storing
    // appropriate prop geometry in the level archive.
    const levels = Array.from({ length: ctx.MapData.length }, (_, mapID) => buildLevelSource(ctx, mapID));

    const geometryOwners = buildTextureOwners(levels, 'geometry');
    const animatedOwners = buildTextureOwners(levels, 'animated');
    for (const textureID of geometryOwners.keys())
        assert(textureID >= 0 && textureID < TexData.length);
    for (const textureID of animatedOwners.keys())
        assert(textureID >= 0 && textureID < AnimTexData.length);

    const sharedResources = [
        ...collectSharedResources('geometry', TexData, geometryOwners, levels.length),
        ...collectSharedResources('animated', AnimTexData, animatedOwners, levels.length),
    ];
    const commonTextureGroups = packSubsetsIntoGroups(
        groupResourcesByOwnerSubset(sharedResources), parseCommonTextureGroupCountArg());
    verifyCommonTextureGroups(levels, commonTextureGroups, geometryOwners, animatedOwners, levels.length);

    writeArchives({
        levels, TexData, AnimTexData, SpriteData, CustomScriptFunctionData,
        geometryOwners, animatedOwners, commonTextureGroups,
    });
}

main();
