
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

import * as BYML from '../../byml.js';
import { assert, hexzero } from "../../util.js";
import { Zlib, gunzipSync, inflateRawSync } from "zlib";
import { parseInstanceScripts, parseSetup as parseSetupData } from '../parse.js';
import type { InstanceScript, Setup } from '../parse.js';
import {
    GeneratedSurfaceMaterial, SceneNodeMaterial,
    getGeneratedSurfaceAnimatedTextureBindings, getSceneNodeAnimatedTextureBindings,
    isGeneratedSurfaceMaterial, isSceneNodeMaterial,
} from '../material.js';

export const PointerTable = {
    MapGeometry: 1,
    PropGeometry: 4,
    ActorGeometry: 5,
    TexturesUncompressed: 7,
    Setup: 9,
    Scripts: 10,
    Animations: 11,
    HUDTextures: 14,
    Spawners: 16,
    Critters: 22,
    TexturesGeometry: 25,
} as const;

export interface DK64SpriteDefinition {
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

export interface DK64EnvironmentParticle {
    map: number;
    start: number[];
    end: number[];
    gap: number;
    distance: number;
    baseScale: number;
    risingScale: number;
}

export interface DK64ActorDefinition {
    tableIndex: number;
    type: number;
    model: number;
    behavior: number;
    name: string;
    words: number[];
}

export interface DK64LightAnimationKeyframe {
    intensity: number;
    color: number[];
    radius: number;
    duration: number;
}

export interface DK64PropGeometry {
    name: string;
    layout: number;
    mainDisplayListStart: number;
    secondaryDisplayListStart: number;
    vertexStart: number;
    matrixAnimationStart: number;
    matrixDataStart: number;
    decal: {
        texture: number;
        rotationStep: number;
        footprint: number[];
        textureSize: number[];
        format: number;
        size: number;
        fade: number[];
        alpha: number;
        flags: number;
    } | null;
    indexedTextures: { target: number; crossfade: number; duration: number; frameCount: number; frames: number[] }[];
    runtimeQuads: {
        texture: number;
        palette: number;
        dimensions: number[];
        format: number;
        size: number;
        x: number[];
        y: number[];
        z: number[];
        s: number[];
        t: number[];
    }[];
}

export interface DK64ActorGeometry {
    runtimeBase: number;
    boneCount: number;
    displayLists: { pointer: number; localOffset: number }[];
    skeletonOffset: number;
    auxiliaryData: { headerOffset: number; start: number; end: number }[];
}

/**
 * Read-only access to the USA DK64 ROM structures used by the archive
 * extractor. Inspection tools use this API too, so pointer-table and overlay
 * knowledge has a single owner.
 */
export class DK64Extractor {
    public static readonly PointerTableOffset = 0x101C50;
    public static readonly PointerTableCountOffset = DK64Extractor.PointerTableOffset + 0x80;
    public static readonly GlobalASMVirtualBase = 0x805FB300;

    private static readonly GlobalASMCodeROMOffset = 0x113F0;
    private static readonly GlobalASMDataROMOffset = 0xC29D4;
    private static readonly GlobalASMDataCompressedSize = 0x949C;
    private static readonly SpritePointerTableOffset = 0x15A090;
    private static readonly SpritePointerCount = 176;
    private static readonly CustomScriptFunctionTableOffset = 0x14CB70;
    private static readonly EnvironmentParticleTableOffset = 0x14D8A0;
    private static readonly EnvironmentParticleCount = 13;
    private static readonly LightAnimationTableAddress = 0x80748430;
    private static readonly LightAnimationCount = 27;
    private static readonly ActorDefinitionTableAddress = 0x8074E8B0;
    private static readonly ActorDefinitionCount = 0x80;
    private static readonly ActorBehaviorTableAddress = 0x8074C0A0;

    private globalASM: Buffer | null = null;

    constructor(public readonly rom: Buffer, private readonly reportRedirect: (message: string) => void = console.log) {
    }

    public getTableOffset(table: number): number {
        return DK64Extractor.PointerTableOffset
            + this.rom.readUInt32BE(DK64Extractor.PointerTableOffset + table * 4);
    }

    public getTableCount(table: number): number {
        return this.rom.readUInt32BE(DK64Extractor.PointerTableCountOffset + table * 4);
    }

    public getPointerTableData(table: number, fileID: number, name = `Table ${table}`): Buffer {
        return this.getPointerTableDataAt(this.getTableOffset(table), fileID, name, new Set());
    }

    public extractCompressedTable(table: number): (Buffer | number)[] {
        const tableOffset = this.getTableOffset(table);
        const files: (Buffer | number)[] = [];
        const firstFileForPointer = new Map<number, number>();
        for (let i = 0; i < this.getTableCount(table); i++) {
            const pointer = this.rom.readUInt32BE(tableOffset + i * 4);
            const nextTableStart = table < 31
                ? this.rom.readUInt32BE(DK64Extractor.PointerTableOffset + (table + 1) * 4) : 0;
            if (!(pointer & 0x80000000) && nextTableStart !== 0 && pointer >= nextTableStart)
                break;
            const offs = (pointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
            if ((pointer & 0x80000000) !== 0)
                files[i] = this.rom.readUInt16BE(offs);
            else if (firstFileForPointer.has(pointer))
                files[i] = firstFileForPointer.get(pointer)!;
            else {
                firstFileForPointer.set(pointer, i);
                assert(this.rom.readUInt32BE(offs) === 0x1F8B0800);
                const { engine } = inflateRawSync(this.rom.subarray(offs + 0x0A), { info: true }) as unknown as { buffer: Buffer, engine: Zlib };
                files[i] = this.rom.subarray(offs, offs + 0x0A + engine.bytesWritten);
            }
        }
        return files;
    }

    public extractCompressedTableEntry(table: number, index: number): Buffer {
        const tableOffset = this.getTableOffset(table);
        assert(index >= 0 && index < this.getTableCount(table));
        const pointer = this.rom.readUInt32BE(tableOffset + index * 4);
        assert((pointer & 0x80000000) === 0);
        const offs = (pointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
        assert(this.rom.readUInt32BE(offs) === 0x1F8B0800);
        const { engine } = inflateRawSync(this.rom.subarray(offs + 0x0A), { info: true }) as unknown as { buffer: Buffer, engine: Zlib };
        return this.rom.subarray(offs, offs + 0x0A + engine.bytesWritten);
    }

    public extractRawTableEntry(table: number, index: number): Buffer {
        const tableOffset = this.getTableOffset(table);
        assert(index >= 0 && index < this.getTableCount(table));
        const pointer = this.rom.readUInt32BE(tableOffset + index * 4);
        const nextPointer = this.rom.readUInt32BE(tableOffset + (index + 1) * 4);
        assert((pointer & 0x80000000) === 0);
        assert((nextPointer & 0x80000000) === 0);
        const offs = (pointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
        const nextOffs = (nextPointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
        assert(nextOffs >= offs);
        return this.rom.subarray(offs, nextOffs);
    }

    private getPointerTableDataAt(tableOffset: number, fileID: number, name: string, visited: Set<number>): Buffer {
        assert(!visited.has(fileID));
        visited.add(fileID);
        const pointer = this.rom.readUInt32BE(tableOffset + fileID * 4);
        const romOffset = (pointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
        if ((pointer & 0x80000000) !== 0) {
            const targetFileID = this.rom.readUInt16BE(romOffset);
            this.reportRedirect(`${name} ${hexzero(fileID, 2)} redirects to ${hexzero(targetFileID, 2)}`);
            return this.getPointerTableDataAt(tableOffset, targetFileID, name, visited);
        }

        if (this.rom.readUInt32BE(romOffset) === 0x1F8B0800)
            return inflateRawSync(this.rom.subarray(romOffset + 0x0A));
        const nextPointer = this.rom.readUInt32BE(tableOffset + (fileID + 1) * 4);
        const nextROMOffset = (nextPointer & 0x7FFFFFFF) + DK64Extractor.PointerTableOffset;
        return this.rom.subarray(romOffset, nextROMOffset);
    }

    public getMap(mapID: number): Buffer {
        return this.getPointerTableData(PointerTable.MapGeometry, mapID, 'Map');
    }

    public getPropGeometry(type: number): Buffer {
        return this.getPointerTableData(PointerTable.PropGeometry, type, 'Prop geometry');
    }

    public parsePropGeometry(data: Buffer): DK64PropGeometry {
        const indexedTextures: DK64PropGeometry['indexedTextures'] = [];
        const indexedStart = data.readUInt32BE(0x6C);
        if (indexedStart + 4 <= data.length) {
            const count = data.readUInt32BE(indexedStart);
            for (let i = 0; i < count; i++) {
                const offs = indexedStart + 4 + i * 0x84;
                if (offs + 0x84 > data.length)
                    break;
                const frameCount = data.readUInt32BE(offs + 0x0C);
                indexedTextures.push({
                    target: data.readUInt32BE(offs),
                    crossfade: data.readUInt32BE(offs + 4),
                    duration: data.readUInt32BE(offs + 8),
                    frameCount,
                    frames: Array.from(
                        { length: Math.max(1, Math.min(frameCount, 0x1E)) },
                        (_, frame) => frame === 0 ? data.readUInt32BE(offs) : data.readUInt32BE(offs + 0x0C + frame * 4),
                    ),
                });
            }
        }
        const runtimeQuads: DK64PropGeometry['runtimeQuads'] = [];
        const runtimeStart = data.readUInt32BE(0x70);
        if (data.readUInt8(0x1C) === 2 && runtimeStart + 4 <= data.length) {
            const count = data.readUInt32BE(runtimeStart);
            for (let i = 0; i < count; i++) {
                const offs = runtimeStart + 4 + i * 0x30;
                if (offs + 0x30 > data.length)
                    break;
                const values = (base: number, stride: number) =>
                    Array.from({ length: 4 }, (_, j) => data.readInt16BE(offs + base + j * stride));
                runtimeQuads.push({
                    texture: data.readUInt16BE(offs),
                    palette: data.readUInt16BE(offs + 2),
                    dimensions: [data.readUInt8(offs + 0x2C), data.readUInt8(offs + 0x2D)],
                    format: data.readUInt8(offs + 0x2F),
                    size: data.readUInt8(offs + 0x2E),
                    x: values(0x04, 2),
                    y: values(0x0C, 2),
                    z: values(0x14, 2),
                    s: values(0x1C, 4),
                    t: values(0x1E, 4),
                });
            }
        }
        const decalTexture = data.readUInt16BE(0x28);
        return {
            name: data.subarray(0x0C, 0x20).toString('ascii').split('\0')[0],
            layout: data.readUInt8(0x1C),
            mainDisplayListStart: data.readUInt32BE(0x40),
            secondaryDisplayListStart: data.readUInt32BE(0x44),
            vertexStart: data.readUInt32BE(0x48),
            matrixAnimationStart: data.readUInt32BE(0x64),
            matrixDataStart: data.readUInt32BE(0x68),
            decal: decalTexture === 0xFFFF ? null : {
                texture: decalTexture,
                rotationStep: data.readInt16BE(0x2C),
                footprint: [data.readInt16BE(0x2E), data.readInt16BE(0x30)],
                textureSize: [data.readUInt8(0x32), data.readUInt8(0x33)],
                format: data.readUInt8(0x34) & 0x07,
                size: data.readUInt8(0x35),
                fade: [data.readUInt8(0x36) * 10, data.readUInt8(0x37) * 10],
                alpha: data.readUInt8(0x38),
                flags: data.readUInt8(0x39),
            },
            indexedTextures,
            runtimeQuads,
        };
    }

    public getActorGeometry(model: number): Buffer {
        assert(model > 0);
        return this.getPointerTableData(PointerTable.ActorGeometry, model - 1, 'Actor geometry');
    }

    public parseActorGeometry(data: Buffer): DK64ActorGeometry {
        const runtimeBase = data.readUInt32BE(0);
        const localOffset = (address: number) => address - runtimeBase + 0x28;
        const displayListTable = localOffset(data.readUInt32BE(4));
        const displayLists = Array.from({ length: data.readUInt8(0x21) }, (_, i) => {
            const pointer = data.readUInt32BE(displayListTable + i * 4);
            return { pointer, localOffset: localOffset(pointer) };
        });
        const pointers = [0x0C, 0x10, 0x14]
            .map((headerOffset) => ({ headerOffset, pointer: data.readUInt32BE(headerOffset) }))
            .filter(({ pointer }) => pointer >= runtimeBase && localOffset(pointer) < data.length)
            .sort((a, b) => a.pointer - b.pointer);
        return {
            runtimeBase,
            boneCount: data.readUInt8(0x20),
            displayLists,
            skeletonOffset: localOffset(data.readUInt32BE(8)),
            auxiliaryData: pointers.map(({ headerOffset, pointer }, i) => ({
                headerOffset,
                start: localOffset(pointer),
                end: i + 1 < pointers.length ? localOffset(pointers[i + 1].pointer) : data.length,
            })),
        };
    }

    public getSetup(mapID: number): Buffer {
        return this.getPointerTableData(PointerTable.Setup, mapID, 'Setup');
    }

    public getScripts(mapID: number): Buffer {
        return this.getPointerTableData(PointerTable.Scripts, mapID, 'Scripts');
    }

    public parseSetup(data: Buffer): Setup {
        return parseSetupData(ArrayBufferSlice.fromView(data));
    }

    public getParsedSetup(mapID: number): Setup {
        return this.parseSetup(this.getSetup(mapID));
    }

    public parseScripts(data: Buffer): InstanceScript[] {
        return parseInstanceScripts(ArrayBufferSlice.fromView(data));
    }

    public getAnimation(id: number): Buffer {
        return this.getPointerTableData(PointerTable.Animations, id, 'Animation');
    }

    public getGeometryTexture(id: number): Buffer {
        return this.getPointerTableData(PointerTable.TexturesGeometry, id, 'Texture');
    }

    public getSpawners(mapID: number): Buffer {
        return this.getPointerTableData(PointerTable.Spawners, mapID, 'Spawners');
    }

    public getCritters(mapID: number): Buffer {
        return this.getPointerTableData(PointerTable.Critters, mapID, 'Critters');
    }

    public getGlobalASM(): Buffer {
        if (this.globalASM === null) {
            const code = gunzipSync(this.rom.subarray(
                DK64Extractor.GlobalASMCodeROMOffset,
                DK64Extractor.GlobalASMDataROMOffset,
            ));
            const data = gunzipSync(this.rom.subarray(
                DK64Extractor.GlobalASMDataROMOffset,
                DK64Extractor.GlobalASMDataROMOffset + DK64Extractor.GlobalASMDataCompressedSize,
            ));
            this.globalASM = Buffer.concat([code, data]);
        }
        return this.globalASM;
    }

    public globalAddressToOffset(address: number): number {
        const offs = address - DK64Extractor.GlobalASMVirtualBase;
        assert(offs >= 0 && offs < this.getGlobalASM().length);
        return offs;
    }

    public getSpriteDefinitions(): DK64SpriteDefinition[] {
        const globalASM = this.getGlobalASM();
        const sprites: DK64SpriteDefinition[] = [];
        for (let i = 0; i < DK64Extractor.SpritePointerCount; i++) {
            const address = globalASM.readUInt32BE(DK64Extractor.SpritePointerTableOffset + i * 4);
            const offs = this.globalAddressToOffset(address);
            const imageCount = globalASM.readUInt16BE(offs + 0x12);
            sprites.push({
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
            });
        }
        return sprites;
    }

    public getEnvironmentParticles(): DK64EnvironmentParticle[] {
        const globalASM = this.getGlobalASM();
        return Array.from({ length: DK64Extractor.EnvironmentParticleCount }, (_, i) => {
            const offs = DK64Extractor.EnvironmentParticleTableOffset + i * 0x20;
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

    public getActorDefinitions(): DK64ActorDefinition[] {
        const globalASM = this.getGlobalASM();
        return Array.from({ length: DK64Extractor.ActorDefinitionCount }, (_, tableIndex) => {
            const offs = this.globalAddressToOffset(DK64Extractor.ActorDefinitionTableAddress) + tableIndex * 0x30;
            const type = globalASM.readUInt16BE(offs);
            return {
                tableIndex,
                type,
                model: globalASM.readUInt16BE(offs + 2),
                behavior: globalASM.readUInt32BE(
                    this.globalAddressToOffset(DK64Extractor.ActorBehaviorTableAddress) + type * 4,
                ),
                name: globalASM.subarray(offs + 0x14, offs + 0x2C).toString('ascii').split('\0')[0],
                words: Array.from({ length: 11 }, (_, i) => globalASM.readUInt32BE(offs + 4 + i * 4)),
            };
        });
    }

    public getLightAnimations(): DK64LightAnimationKeyframe[][] {
        const globalASM = this.getGlobalASM();
        const table = this.globalAddressToOffset(DK64Extractor.LightAnimationTableAddress);
        return Array.from({ length: DK64Extractor.LightAnimationCount }, (_, animation) => {
            const keyframes: DK64LightAnimationKeyframe[] = [];
            for (let keyframe = 0; keyframe < 5; keyframe++) {
                const offs = table + animation * 0x3C + keyframe * 0x0C;
                const duration = globalASM.readInt16BE(offs + 0x0A);
                if (duration === 0)
                    break;
                keyframes.push({
                    intensity: globalASM.readFloatBE(offs),
                    color: [globalASM.readUInt8(offs + 4), globalASM.readUInt8(offs + 5), globalASM.readUInt8(offs + 6)],
                    radius: globalASM.readInt16BE(offs + 8),
                    duration,
                });
            }
            return keyframes;
        });
    }

    public getCustomScriptFunctionAddress(index: number): number {
        return this.getGlobalASM().readUInt32BE(DK64Extractor.CustomScriptFunctionTableOffset + index * 4);
    }

    public getCustomScriptFunctionAddresses(count = 118): number[] {
        return Array.from({ length: count }, (_, index) => this.getCustomScriptFunctionAddress(index));
    }
}

const pathBaseIn  = `./data/DonkeyKong64_Raw`;
const pathBaseOut = `./data/DonkeyKong64`;

function main() {
    const rom = readFileSync(`${pathBaseIn}/rom.z64`);
    const extractor = new DK64Extractor(rom);

    // USA ROM pointer-table directory. The first 32 words are table offsets,
    // relative to PointerTableOffset, and the next 32 words are slot counts.
    // Some sparse tables pad their final slots with the next table's start;
    // extractCompressedTable stops at that sentinel.
    // TODO: locate this directory by ROM revision/signature; all addresses and
    // overlay offsets below currently describe only the USA ROM.
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

    const extractCompressedTable = (table: number): (ArrayBufferSlice | number)[] =>
        extractor.extractCompressedTable(table)
            .map((entry) => typeof entry === 'number' ? entry : ArrayBufferSlice.fromView(entry));
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
    const SpriteData = extractor.getSpriteDefinitions();
    const CustomScriptFunctionData = extractor.getCustomScriptFunctionAddresses();
    const EnvironmentParticleData = extractor.getEnvironmentParticles();
    const actorModelByType = new Map(extractor.getActorDefinitions()
        .map(({ type, model }) => [type, model] as const));

    const TexData: ArrayBufferSlice[] = [];
    const textureCount = Math.max(...SpriteData
        .filter((sprite) => sprite.table === 1)
        .flatMap((sprite) => sprite.images)) + 1;
    for (let i = 0; i < textureCount; i++)
        TexData[i] = ArrayBufferSlice.fromView(extractor.extractCompressedTableEntry(PointerTable.TexturesGeometry, i));
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
    for (let i = 0; i < uncompressedTextureCount; i++)
        AnimTexData[i] = ArrayBufferSlice.fromView(extractor.extractRawTableEntry(PointerTable.TexturesUncompressed, i));

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
            // Segment zero is an index into pointer table 25. Other segments
            // are supplied by map/prop animation descriptors handled below.
            if ((address >>> 24) === 0 && !excluded.has(address))
                output.add(address);
        }
    }

    function scanMapTextureUsage(map: Buffer, usage: TextureUsage): UnhandledMapFeature[] {
        const unhandled = new Map<string, UnhandledMapFeature>();
        const addUnhandled = (kind: string, material: number): void => {
            const key = `${kind}:${material}`;
            const entry = unhandled.get(key);
            if (entry !== undefined)
                entry.Count++;
            else
                unhandled.set(key, { Kind: kind, Material: material, Count: 1 });
        };
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
            if (isGeneratedSurfaceMaterial(material)) {
                for (const binding of getGeneratedSurfaceAnimatedTextureBindings(material)) {
                    for (const textureID of binding.textureIDs)
                        usage.animated.add(textureID);
                }
            } else
                addUnhandled('GeneratedSurfaceMaterial', material);
            switch (material) {
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
            if (!supportedSceneNodeMaterials.has(material))
                addUnhandled('SceneNodeMaterial', material);
            if (supportedSceneNodeMaterials.has(material) && isSceneNodeMaterial(material)) {
                for (const binding of getSceneNodeAnimatedTextureBindings(material)) {
                    for (const textureID of binding.textureIDs)
                        usage.animated.add(textureID);
                }
            }
            switch (material) {
            case SceneNodeMaterial.Sand:
                // func_global_asm_8063C784 loads the complete RGBA16 mip
                // chain used by scene-node sand material 2.
                usage.geometry.add(0x565);
                break;
            case SceneNodeMaterial.GroundFog:
                usage.geometry.add(0x1765);
                break;
            }
        }
        return [...unhandled.values()].sort((a, b) =>
            a.Kind.localeCompare(b.Kind) || a.Material - b.Material,
        );
    }

    function scanPropTextureUsage(prop: Buffer, usage: TextureUsage): void {
        const parsed = extractor.parsePropGeometry(prop);
        if (parsed.decal !== null)
            usage.geometry.add(parsed.decal.texture);

        // Indexed prop animations leave their target IDs in segment zero,
        // even though both the target and frames come from table 7. Exclude
        // those placeholders from the table-25 command scan.
        const animatedTargets = new Set<number>();
        for (const texture of parsed.indexedTextures) {
            if (texture.frameCount === 0 || texture.frameCount > 0x1E)
                continue;
            animatedTargets.add(texture.target);
            for (const frame of texture.frames)
                usage.animated.add(frame);
        }

        if (parsed.layout === 2) {
            // func_global_asm_8063524C builds one textured quad from each
            // 0x30-byte descriptor. The first texture is the image and the
            // optional second texture is its CI palette.
            for (const quad of parsed.runtimeQuads) {
                if (!animatedTargets.has(quad.texture))
                    usage.geometry.add(quad.texture);
                if (quad.palette !== 0xFFFF)
                    usage.geometry.add(quad.palette);
            }
            return;
        }
        if (parsed.layout !== 1)
            return;
        scanTextureCommands(
            prop,
            Math.min(parsed.mainDisplayListStart, parsed.secondaryDisplayListStart),
            parsed.vertexStart,
            usage.geometry,
            animatedTargets,
        );
    }

    function scanActorTextureUsage(actor: Buffer, usage: TextureUsage): void {
        const parsed = extractor.parseActorGeometry(actor);
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
        for (const { pointer } of parsed.displayLists)
            scanDisplayList(0x03000000 | (pointer - parsed.runtimeBase));
        const descriptorPointer = actor.readUInt32BE(0x10);
        let descriptorOffs = descriptorPointer - parsed.runtimeBase + 0x28;
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
        const propIDs = new Set(extractor.parseSetup(setup).props.map(({ id }) => id));
        for (const script of extractor.parseScripts(scripts)) {
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

    // Resolve aliases before writing so each map archive is self-contained.
    // Prop geometry is selected from the setup file, avoiding geometry for
    // every other level.
    const levels: LevelSource[] = [];
    for (let mapID = 0; mapID < MapData.length; mapID++) {
        const mapData = resolveTableEntry(MapData, mapID);
        const setupData = resolveTableEntry(SetupData, mapID);
        const scriptData = resolveTableEntry(ScriptData, mapID);
        const map = extractor.getMap(mapID);
        const setup = extractor.getSetup(mapID);
        const scripts = extractor.getScripts(mapID);
        const parsedSetup = extractor.parseSetup(setup);
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
            Data: ArrayBufferSlice.fromView(extractor.extractRawTableEntry(PointerTable.Animations, id)),
        }));

        const environmentParticleData = EnvironmentParticleData.filter((entry) => entry.map === mapID);
        const textureUsage: TextureUsage = { geometry: new Set(), animated: new Set() };
        const UnhandledMapFeatures = scanMapTextureUsage(map, textureUsage);
        for (const prop of PropGeometry)
            scanPropTextureUsage(extractor.getPropGeometry(prop.Type), textureUsage);
        for (const actor of ActorGeometry)
            scanActorTextureUsage(extractor.getActorGeometry(actor.Model), textureUsage);
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

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])
    main();
