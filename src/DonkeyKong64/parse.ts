import { vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { AnimatedTexture, G_NOOP } from './f3dex2.js';
import {
    GeneratedSurface, SceneNodeMaterial, isGeneratedSurfaceMaterial,
    isSceneNodeMaterial,
} from './material.js';

const displayListsPerChunk = 4;  // one DL per LOD
const vertexOffsetsPerSection = 8;  // offset per DL + extra slots
const mapVertexStride = 0x10;  // matches gSPVertex

export const MapHeader = {
    sceneNodeRoot: 0x30,
    displayListStart: 0x34,
    vertexStart: 0x38,
    animatedTextureTable: 0x48,
    generatedSurfaceTable: 0x4C,
} as const;

export const AnimatedTextureEntry = {
    stride: 0x7C,
    frameCount: 0x03,
    frames: 0x0C,
} as const;

export const GeneratedSurfaceEntry = {
    stride: 0x6C,
    material: 0x66,
} as const;

export const SceneNodeEntry = {
    displayListCount: 0xC5,
    displayLists: 0x1C,
    materials: 0x70,
} as const;

export interface SetupProp {
    setupIndex: number;
    position: vec3;
    scale: number;
    rotation: vec3;
    type: number;
    id: number;
    lightAnimation: number;
}

export interface SetupActor {
    position: vec3;
    scale: number;
    animationSpeed: number;
    lightColor: readonly [number, number, number];
    lightCone: readonly [number, number];
    rotationY: number;
    type: number;
    id: number;
}

export interface Setup {
    props: readonly SetupProp[];
    actors: readonly SetupActor[];
}

export function parseSetup(data: ArrayBufferSlice): Setup {
    const view = data.createDataView();
    let offs = 0;

    const propCount = view.getUint32(offs, false);
    offs += 4;
    const props: SetupProp[] = [];
    for (let i = 0; i < propCount; i++, offs += 0x30) {
        props.push({
            setupIndex: i,
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            rotation: vec3.fromValues(
                view.getFloat32(offs + 0x18, false),
                view.getFloat32(offs + 0x1C, false),
                view.getFloat32(offs + 0x20, false),
            ),
            type: view.getUint16(offs + 0x28, false),
            id: view.getUint16(offs + 0x2A, false),
            lightAnimation: view.getUint8(offs + 0x2E),
        });
    }

    const mysteryCount = view.getUint32(offs, false);
    offs += 4 + mysteryCount * 0x24;

    const actorCount = view.getUint32(offs, false);
    offs += 4;
    const actors: SetupActor[] = [];
    for (let remaining = actorCount; remaining > 0; remaining--, offs += 0x38) {
        actors.push({
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            animationSpeed: view.getFloat32(offs + 0x10, false),
            lightColor: [
                view.getInt32(offs + 0x14, false) & 0xFF,
                view.getInt32(offs + 0x18, false) & 0xFF,
                view.getInt32(offs + 0x1C, false) & 0xFF,
            ],
            lightCone: [
                view.getFloat32(offs + 0x20, false),
                view.getFloat32(offs + 0x24, false),
            ],
            rotationY: view.getInt16(offs + 0x30, false),
            type: view.getUint16(offs + 0x32, false),
            id: view.getUint16(offs + 0x34, false),
        });
    }

    return { props, actors };
}

export interface ScriptCommand {
    opcode: number;
    args: [number, number, number];
}

export interface ScriptBlock {
    conditions: ScriptCommand[];
    executions: ScriptCommand[];
}

export interface InstanceScript {
    offset: number;
    id: number;
    behavior: number;
    blocks: ScriptBlock[];
}

function parseScriptCommand(view: DataView, offs: number): ScriptCommand {
    return {
        opcode: view.getUint16(offs, false),
        args: [
            view.getInt16(offs + 2, false),
            view.getInt16(offs + 4, false),
            view.getInt16(offs + 6, false),
        ],
    };
}

export function parseInstanceScripts(data: ArrayBufferSlice): InstanceScript[] {
    const view = data.createDataView();
    const count = view.getUint16(0, false);
    const scripts: InstanceScript[] = [];
    let offs = 2;
    for (let scriptIndex = 0; scriptIndex < count; scriptIndex++) {
        const offset = offs;
        const id = view.getUint16(offs, false);
        const blockCount = view.getUint16(offs + 2, false);
        const behavior = view.getUint16(offs + 4, false);
        offs += 6;
        const blocks: ScriptBlock[] = [];
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
            const conditionCount = view.getUint16(offs, false);
            offs += 2;
            const conditions: ScriptCommand[] = [];
            for (let i = 0; i < conditionCount; i++, offs += 8)
                conditions.push(parseScriptCommand(view, offs));
            const executionCount = view.getUint16(offs, false);
            offs += 2;
            const executions: ScriptCommand[] = [];
            for (let i = 0; i < executionCount; i++, offs += 8)
                executions.push(parseScriptCommand(view, offs));
            blocks.push({ conditions, executions });
        }
        scripts.push({ offset, id, behavior, blocks });
    }
    return scripts;
}

export interface DisplayListInfo {
    chunkID: number;
    dlStartAddr: number;
    vertStartIndex: number;
    textureAnimationGroup: number | null;
    materialIndex: SceneNodeMaterial | null;
}

export class MapChunk {
    public ambientColor: vec3;
    public modulateVertexColors: boolean;
    public displayListRanges: { offset: number, size: number }[] = [];
    public vertOffset: number;
    public vertSize: number;
    public static readonly size = 0x34;

    constructor(bin: ArrayBufferSlice, public id: number) {
        const view = bin.createDataView();
        this.ambientColor = vec3.fromValues(
            view.getUint8(0x00) / 0xFF,
            view.getUint8(0x01) / 0xFF,
            view.getUint8(0x02) / 0xFF,
        );
        this.modulateVertexColors = view.getUint32(0x08, false) === 1;
        for (let i = 0, offs = 0x0C; i < displayListsPerChunk; i++, offs += 8) {
            this.displayListRanges[i] = {
                offset: view.getInt32(offs + 0x00, false),
                size: view.getUint32(offs + 0x04, false),
            };
        }
        this.vertOffset = view.getInt32(0x2C, false);
        this.vertSize = view.getUint32(0x30, false);
    }
}

export class MapSection {
    public meshID: number;
    public textureAnimationGroup: number;
    public vertOffsets: number[] = [];
    public static readonly size = 0x1C;

    constructor(bin: ArrayBufferSlice) {
        const view = bin.createDataView();
        this.textureAnimationGroup = view.getUint16(0x00, false);
        this.meshID = view.getUint16(0x02, false);
        for (let i = 0; i < vertexOffsetsPerSection; i++)
            this.vertOffsets[i] = view.getUint16(0x08 + i * 2, false);
    }
}

export class DK64Map {
    public vertBin: ArrayBufferSlice;
    public f3dexBin: ArrayBufferSlice;
    public chunkCount: number;
    public chunks: MapChunk[] = [];
    public sections: MapSection[] = [];
    public displayLists: DisplayListInfo[] = [];
    public animatedTextures: AnimatedTexture[] = [];
    public generatedSurfaces: GeneratedSurface[] = [];
    public effectPointSets: vec3[][] = [];
    public fogEnabled: boolean;
    public clipNear = 10;
    public clipFar: number;

    constructor(public bin: ArrayBufferSlice, animTexData: ArrayBufferSlice[]) {
        const view = bin.createDataView();
        this.fogEnabled = (view.getUint8(0x08) & 1) !== 0;
        this.clipFar = view.getInt16(0x0A, false);
        const dlStart = view.getUint32(MapHeader.displayListStart, false);
        const vertStart = view.getUint32(MapHeader.vertexStart, false);
        const vertEnd = view.getUint32(0x40, false);
        const sectionStart = view.getUint32(0x58, false);
        const sectionEnd = view.getUint32(0x5C, false);
        const chunkCountOffset = view.getUint32(0x64, false);
        const chunkStart = view.getUint32(0x68, false);

        this.parseEffectPointSets(view);
        this.parseAnimatedTextures(view, animTexData);
        this.parseGeneratedSurfaces(view);

        this.f3dexBin = bin.slice(dlStart, vertStart);
        this.vertBin = bin.slice(vertStart, vertEnd);
        this.chunkCount = view.getUint32(chunkCountOffset, false);
        for (let i = 0; i < this.chunkCount; i++)
            this.chunks.push(new MapChunk(bin.subarray(chunkStart + MapChunk.size * i, MapChunk.size), i));
        for (let i = 0; i * MapSection.size < sectionEnd - sectionStart; i++)
            this.sections.push(new MapSection(bin.subarray(sectionStart + i * MapSection.size + 4, MapSection.size)));

        this.parseDisplayLists(view, dlStart);
    }

    private parseEffectPointSets(view: DataView): void {
        const table = view.getUint32(0x40, false);
        const count = view.getInt32(table, false) + 1;
        for (let set = 0; set < count; set++) {
            const start = table + view.getUint32(table + 4 + set * 4, false);
            const end = table + view.getUint32(table + 8 + set * 4, false);
            const points: vec3[] = [];
            for (let offs = start; offs + 12 <= end; offs += 12) {
                points.push(vec3.fromValues(
                    view.getFloat32(offs + 0, false),
                    view.getFloat32(offs + 4, false),
                    view.getFloat32(offs + 8, false),
                ));
            }
            this.effectPointSets.push(points);
        }
    }

    private parseAnimatedTextures(view: DataView, animTexData: ArrayBufferSlice[]): void {
        const table = view.getUint32(MapHeader.animatedTextureTable, false);
        const count = view.getUint32(table, false);
        for (let i = 0; i < count; i++) {
            const offs = table + 4 + i * AnimatedTextureEntry.stride;
            const frames: ArrayBufferSlice[] = [];
            for (let j = 0; j < view.getUint8(offs + AnimatedTextureEntry.frameCount); j++) {
                const frame = animTexData[view.getUint32(offs + AnimatedTextureEntry.frames + j * 4, false)];
                if (frame !== undefined)
                    frames.push(frame);
            }
            if (frames.length > 0)
                this.animatedTextures.push(new AnimatedTexture({
                    segment: view.getUint8(offs),
                    group: view.getUint8(offs + 1),
                    frameDuration: view.getUint8(offs + 2),
                    frames,
                }));
        }
    }

    private parseGeneratedSurfaces(view: DataView): void {
        const table = view.getUint32(MapHeader.generatedSurfaceTable, false);
        const count = view.getUint32(table, false);
        for (let i = 0; i < count; i++) {
            const offs = table + 4 + i * GeneratedSurfaceEntry.stride;
            const materialIndex = view.getUint8(offs + GeneratedSurfaceEntry.material);
            if (!isGeneratedSurfaceMaterial(materialIndex))
                continue;
            this.generatedSurfaces.push(new GeneratedSurface(view, offs, materialIndex));
        }
    }

    private parseDisplayLists(view: DataView, dlStart: number): void {
        if (this.chunkCount > 0) {
            for (const chunk of this.chunks)
                for (let i = 0; i < displayListsPerChunk; i++)
                    this.parseChunkDisplayList(view, dlStart, chunk, i);
        } else {
            this.displayLists.push({
                chunkID: -1, dlStartAddr: 0, vertStartIndex: 0,
                textureAnimationGroup: null, materialIndex: null,
            });
        }

        this.parseSceneNodeDisplayLists(view);
    }

    private parseChunkDisplayList(view: DataView, dlStart: number, chunk: MapChunk, i: number): void {
        const { offset, size } = chunk.displayListRanges[i];
        if (offset === -1 || size === 0)
            return;

        // chunk display lists are either separated by G_NOOPs
        let noopPresent = false;
        for (let commandOffs = dlStart + offset, end = commandOffs + size; commandOffs < end; commandOffs += 8) {
            if (view.getUint8(commandOffs) !== G_NOOP)
                continue;
            noopPresent = true;
            const sectionID = view.getUint32(commandOffs + 4, false);
            const section = this.sections.find((entry) => entry.meshID === sectionID);
            if (section === undefined)
                continue;
            this.displayLists.push({
                chunkID: chunk.id,
                dlStartAddr: commandOffs - dlStart,
                vertStartIndex: chunk.vertOffset / mapVertexStride + section.vertOffsets[i],
                textureAnimationGroup: section.textureAnimationGroup,
                materialIndex: null,
            });
        }

        // or whole (no noops)
        if (!noopPresent) {
            this.displayLists.push({
                chunkID: chunk.id,
                dlStartAddr: offset,
                vertStartIndex: chunk.vertOffset / mapVertexStride,
                textureAnimationGroup: null,
                materialIndex: null,
            });
        }
    }

    private parseSceneNodeDisplayLists(view: DataView): void {
        const rootNode = view.getUint32(MapHeader.sceneNodeRoot, false);
        const count = view.getUint8(rootNode + SceneNodeEntry.displayListCount);
        for (let i = 0; i < count; i++) {
            const dlStartAddr = view.getInt32(rootNode + SceneNodeEntry.displayLists + i * 4, false);
            if (dlStartAddr < 0)
                continue;
            const materialIndex = view.getUint16(rootNode + SceneNodeEntry.materials + i * 2, false);
            if (!isSceneNodeMaterial(materialIndex))
                continue;
            this.displayLists.push({
                chunkID: -1, dlStartAddr, vertStartIndex: 0,
                textureAnimationGroup: null, materialIndex,
            });
        }
    }
}
