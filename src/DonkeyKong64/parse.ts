import { vec3 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import type { AnimatedTexture } from './f3dex2.js';
import {
    GeneratedSurfaceMaterial, SceneNodeMaterial, isGeneratedSurfaceMaterial,
    isSceneNodeMaterial,
} from './material.js';

export interface SetupProp {
    setupIndex: number;
    position: vec3;
    scale: number;
    unknown10: number;
    unknown14: number;
    rotation: vec3;
    unknown24: number;
    type: number;
    id: number;
    unknown2C: number;
    lightAnimation: number;
    flags: number;
}

export interface SetupMystery {
    words: readonly number[];
}

export interface SetupActor {
    setupIndex: number;
    position: vec3;
    scale: number;
    lightSpeed: number;
    lightColor: readonly [number, number, number];
    lightCone: readonly [number, number];
    unknown28: number;
    unknown2C: number;
    rotationY: number;
    type: number;
    id: number;
    unknown36: number;
}

export interface Setup {
    props: readonly SetupProp[];
    mystery: readonly SetupMystery[];
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
            unknown10: view.getUint32(offs + 0x10, false),
            unknown14: view.getUint32(offs + 0x14, false),
            rotation: vec3.fromValues(
                view.getFloat32(offs + 0x18, false),
                view.getFloat32(offs + 0x1C, false),
                view.getFloat32(offs + 0x20, false),
            ),
            unknown24: view.getFloat32(offs + 0x24, false),
            type: view.getUint16(offs + 0x28, false),
            id: view.getUint16(offs + 0x2A, false),
            unknown2C: view.getUint16(offs + 0x2C, false),
            lightAnimation: view.getUint8(offs + 0x2E),
            flags: view.getUint8(offs + 0x2F),
        });
    }

    const mysteryCount = view.getUint32(offs, false);
    offs += 4;
    const mystery: SetupMystery[] = [];
    for (let i = 0; i < mysteryCount; i++, offs += 0x24) {
        const words: number[] = [];
        for (let j = 0; j < 9; j++)
            words.push(view.getUint32(offs + j * 4, false));
        mystery.push({ words });
    }

    const actorCount = view.getUint32(offs, false);
    offs += 4;
    const actors: SetupActor[] = [];
    for (let i = 0; i < actorCount; i++, offs += 0x38) {
        actors.push({
            setupIndex: i,
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            lightSpeed: view.getFloat32(offs + 0x10, false),
            // The behavior passes these s32 fields through u16 temporaries,
            // and createLight finally truncates them to u8.
            lightColor: [
                view.getInt32(offs + 0x14, false) & 0xFF,
                view.getInt32(offs + 0x18, false) & 0xFF,
                view.getInt32(offs + 0x1C, false) & 0xFF,
            ],
            lightCone: [
                view.getFloat32(offs + 0x20, false),
                view.getFloat32(offs + 0x24, false),
            ],
            unknown28: view.getUint32(offs + 0x28, false),
            unknown2C: view.getUint32(offs + 0x2C, false),
            rotationY: view.getInt16(offs + 0x30, false),
            type: view.getUint16(offs + 0x32, false),
            id: view.getUint16(offs + 0x34, false),
            unknown36: view.getUint16(offs + 0x36, false),
        });
    }

    return { props, mystery, actors };
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
        scripts.push({ id, behavior, blocks });
    }
    return scripts;
}

export interface DisplayListInfo {
    ChunkID: number;
    dlStartAddr: number;
    VertStartIndex: number;
    textureAnimationGroup: number | null;
    materialIndex: SceneNodeMaterial | null;
}

export interface GeneratedSurface {
    textureScale: number;
    frequencyS: number;
    frequencyT: number;
    amplitudeS: number;
    amplitudeT: number;
    phaseSpeedS: number;
    phaseSpeedT: number;
    scrollSpeedS: number;
    scrollSpeedT: number;
    step: number;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    baseY: number;
    colorR: number;
    colorG: number;
    colorB: number;
    alphaBase: number;
    alphaRange: number;
    materialIndex: GeneratedSurfaceMaterial;
    columns: number;
    rows: number;
}

export class MapChunk {
    public ambientColor: vec3;
    public modulateVertexColors: boolean;
    public dlOffsets: number[] = [];
    public dlSizes: number[] = [];
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
        for (let i = 0, offs = 0x0C; i < 4; i++, offs += 8) {
            this.dlOffsets[i] = view.getInt32(offs + 0x00, false);
            this.dlSizes[i] = view.getUint32(offs + 0x04, false);
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
        for (let i = 0; i < 8; i++)
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
        const dlStart = view.getUint32(0x34, false);
        const vertStart = view.getUint32(0x38, false);
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
        const table = view.getUint32(0x48, false);
        const count = view.getUint32(table, false);
        for (let i = 0; i < count; i++) {
            const offs = table + 4 + i * 0x7C;
            const frames: ArrayBufferSlice[] = [];
            for (let j = 0; j < view.getUint8(offs + 3); j++) {
                const frame = animTexData[view.getUint32(offs + 0x0C + j * 4, false)];
                if (frame !== undefined)
                    frames.push(frame);
            }
            if (frames.length > 0) {
                this.animatedTextures.push({
                    segment: view.getUint8(offs),
                    group: view.getUint8(offs + 1),
                    frameDuration: view.getUint8(offs + 2),
                    frames,
                });
            }
        }
    }

    private parseGeneratedSurfaces(view: DataView): void {
        const table = view.getUint32(0x4C, false);
        const count = view.getUint32(table, false);
        for (let i = 0; i < count; i++) {
            const offs = table + 4 + i * 0x6C;
            const step = view.getInt16(offs + 0x44, false);
            const minX = view.getInt16(offs + 0x46, false);
            const minZ = view.getInt16(offs + 0x48, false);
            const maxX = view.getInt16(offs + 0x4A, false);
            const maxZ = view.getInt16(offs + 0x4C, false);
            const materialIndex = view.getUint8(offs + 0x66);
            if (!isGeneratedSurfaceMaterial(materialIndex))
                continue;
            this.generatedSurfaces.push({
                textureScale: view.getFloat32(offs + 0x00, false),
                frequencyS: view.getFloat32(offs + 0x04, false),
                frequencyT: view.getFloat32(offs + 0x08, false),
                amplitudeS: view.getFloat32(offs + 0x0C, false),
                amplitudeT: view.getFloat32(offs + 0x10, false),
                phaseSpeedS: view.getInt32(offs + 0x14, false),
                phaseSpeedT: view.getInt32(offs + 0x18, false),
                scrollSpeedS: view.getFloat32(offs + 0x34, false),
                scrollSpeedT: view.getFloat32(offs + 0x38, false),
                step, minX, minZ, maxX, maxZ,
                baseY: view.getInt16(offs + 0x4E, false),
                colorR: view.getUint8(offs + 0x61),
                colorG: view.getUint8(offs + 0x62),
                colorB: view.getUint8(offs + 0x63),
                alphaBase: view.getUint8(offs + 0x64),
                alphaRange: view.getUint8(offs + 0x65),
                materialIndex,
                columns: Math.trunc((maxX - minX) / step) + 2,
                rows: Math.trunc((maxZ - minZ) / step) + 2,
            });
        }
    }

    private parseDisplayLists(view: DataView, dlStart: number): void {
        if (this.chunkCount > 0) {
            for (const chunk of this.chunks) {
                for (let i = 0; i < 4; i++) {
                    const dlOffset = chunk.dlOffsets[i];
                    const dlSize = chunk.dlSizes[i];
                    if (dlOffset === -1 || dlSize === 0)
                        continue;
                    let snoopPresent = false;
                    for (let commandOffs = dlStart + dlOffset, end = commandOffs + dlSize; commandOffs < end; commandOffs += 8) {
                        if (view.getUint8(commandOffs) !== 0x00)
                            continue;
                        snoopPresent = true;
                        const sectionID = view.getUint32(commandOffs + 4, false);
                        const section = this.sections.find((entry) => entry.meshID === sectionID);
                        if (section !== undefined) {
                            this.displayLists.push({
                                ChunkID: chunk.id,
                                dlStartAddr: commandOffs - dlStart,
                                VertStartIndex: chunk.vertOffset / 0x10 + section.vertOffsets[i],
                                textureAnimationGroup: section.textureAnimationGroup,
                                materialIndex: null,
                            });
                        }
                    }
                    if (!snoopPresent) {
                        this.displayLists.push({
                            ChunkID: chunk.id,
                            dlStartAddr: dlOffset,
                            VertStartIndex: chunk.vertOffset / 0x10,
                            textureAnimationGroup: null,
                            materialIndex: null,
                        });
                    }
                }
            }
        } else {
            this.displayLists.push({
                ChunkID: -1, dlStartAddr: 0, VertStartIndex: 0,
                textureAnimationGroup: null, materialIndex: null,
            });
        }

        const rootNode = view.getUint32(0x30, false);
        const count = view.getUint8(rootNode + 0xC5);
        for (let i = 0; i < count; i++) {
            const dlStartAddr = view.getInt32(rootNode + 0x1C + i * 4, false);
            if (dlStartAddr < 0)
                continue;
            const materialIndex = view.getUint16(rootNode + 0x70 + i * 2, false);
            if (!isSceneNodeMaterial(materialIndex))
                continue;
            this.displayLists.push({
                ChunkID: -1, dlStartAddr, VertStartIndex: 0,
                textureAnimationGroup: null, materialIndex,
            });
        }
    }
}
