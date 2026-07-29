import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { mat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { assert, assertExists, readString } from '../util.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { MPHAnimation, parseMPHAnimation } from './mph_anim.js';
import { MPHbin, parseMPH_Model, parseTEX0Texture } from './mph_binModel.js';
import { MPHRenderer, MPHRendererOptions, MPHSceneMode, MPH_VIEWER_SCALE } from './render.js';
import { fx32, TEX0 } from '../nns_g3d/NNS_G3D.js';

const ENTITY_HEADER_SIZE = 0x24;
const ENTITY_ENTRY_SIZE = 0x18;
const ENTITY_TYPE_DOOR = 3;
const DOOR_DATA_SIZE = 0x68;

interface MPHEntityEntry {
    nodeName: string;
    layerMask: number;
    dataOffset: number;
    dataLength: number;
    type: number;
    entityId: number;
}

interface MPHDoorEntity extends MPHEntityEntry {
    position: ReadonlyVec3;
    up: ReadonlyVec3;
    facing: ReadonlyVec3;
    subtype: number;
    doorType: number;
}

interface MPHEntities {
    doors: MPHDoorEntity[];
}

interface MPHEntityModelSpec {
    modelFilename: string;
    animationFilename: string;
    sharedTextureFilename?: string;
    paletteFilename?: string;
    paletteOverrides?: readonly { target: number; source: number }[];
    animationId: number;
}

export interface MPHEntityResourceCache {
    fetchMPFile(path: string): Promise<void>;
    getFileData(path: string): ArrayBufferSlice | null;
}

function readFx32(view: DataView, offs: number): number {
    return fx32(view.getInt32(offs, true));
}

function readVec3Fx(view: DataView, offs: number): vec3 {
    return vec3.fromValues(readFx32(view, offs + 0x00), readFx32(view, offs + 0x04), readFx32(view, offs + 0x08));
}

function parseDoor(entry: MPHEntityEntry, view: DataView): MPHDoorEntity {
    assert(entry.dataLength === DOOR_DATA_SIZE);
    const offs = entry.dataOffset;
    return {
        ...entry,
        position: readVec3Fx(view, offs + 0x04),
        up: readVec3Fx(view, offs + 0x10),
        facing: readVec3Fx(view, offs + 0x1C),
        subtype: view.getUint32(offs + 0x38, true),
        doorType: view.getUint32(offs + 0x3C, true),
    };
}

export function parseMPHEntities(buffer: ArrayBufferSlice, layerId: number): MPHEntities {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00, true) === 2);
    assert(layerId >= 0 && layerId < 16);

    const doors: MPHDoorEntity[] = [];
    let entryCount = 0;
    for (let offs = ENTITY_HEADER_SIZE; offs + ENTITY_ENTRY_SIZE <= view.byteLength; offs += ENTITY_ENTRY_SIZE) {
        const dataOffset = view.getUint32(offs + 0x14, true);
        if (dataOffset === 0)
            break;

        const layerMask = view.getUint16(offs + 0x10, true);
        if ((layerMask & (1 << layerId)) === 0)
            continue;

        entryCount++;
        const dataLength = view.getUint16(offs + 0x12, true);
        assert(dataOffset + dataLength <= view.byteLength);
        const entry: MPHEntityEntry = {
            nodeName: readString(buffer, offs, 0x10, true),
            layerMask,
            dataOffset,
            dataLength,
            type: view.getUint16(dataOffset + 0x00, true),
            entityId: view.getInt16(dataOffset + 0x02, true),
        };
        if (entry.type === ENTITY_TYPE_DOOR)
            doors.push(parseDoor(entry, view));
    }

    assert(entryCount === view.getUint16(0x04 + layerId * 2, true));
    return { doors };
}

export interface MPHDoorMetadata {
    modelName: string;
    animationName: string;
}

export interface MPHEntityMetadata {
    doors: readonly MPHDoorMetadata[];
    doorLockPaletteIds: readonly number[];
}

// The morph ball door draws its textures from a shared model.
// LoadDoorTypeResources @ 0x02106508 picks this in code, so it isn't part of
// any extractable table.
function getSharedTextureFilename(modelName: string): string | undefined {
    if (modelName === 'alimbicmorphballdoor_mdl')
        return 'AlimbicTextureShare_img_Model.bin';
    return undefined;
}

function getDoorModelSpec(metadata: MPHEntityMetadata, door: MPHDoorEntity): MPHEntityModelSpec {
    const door_ = assertExists(metadata.doors[door.doorType], `door type ${door.doorType}`);
    let paletteOverrides: { target: number; source: number }[] | undefined;
    if (door.doorType === 0 || door.doorType === 3) {
        const paletteId = assertExists(metadata.doorLockPaletteIds[door.subtype], `door lock subtype ${door.subtype}`);
        paletteOverrides = [{ target: 1, source: paletteId }];
        if (door.doorType === 3)
            paletteOverrides.push({ target: 2, source: paletteId });
    }
    return {
        modelFilename: `${door_.modelName}_Model.bin`,
        animationFilename: `${door_.animationName}_Anim.bin`,
        sharedTextureFilename: getSharedTextureFilename(door_.modelName),
        paletteFilename: paletteOverrides !== undefined ? 'AlimbicPalettes_pal_Model.bin' : undefined,
        paletteOverrides,
        animationId: 0,
    };
}

function requestEntityModel(cache: MPHEntityResourceCache, spec: MPHEntityModelSpec): void {
    cache.fetchMPFile(`models/${spec.modelFilename}`);
    cache.fetchMPFile(`models/${spec.animationFilename}`);
    if (spec.sharedTextureFilename !== undefined)
        cache.fetchMPFile(`models/${spec.sharedTextureFilename}`);
    if (spec.paletteFilename !== undefined)
        cache.fetchMPFile(`models/${spec.paletteFilename}`);
}

interface MPHSharedTexture {
    file: ArrayBufferSlice;
    bin: MPHbin;
}

function createEntityModelRenderer(device: GfxDevice, cache: MPHEntityResourceCache, renderCache: GfxRenderCache, spec: MPHEntityModelSpec, options: (animation: MPHAnimation) => MPHRendererOptions): MPHRenderer {
    const modelFile = assertExists(cache.getFileData(`models/${spec.modelFilename}`));
    let shared: MPHSharedTexture | null = null;
    if (spec.sharedTextureFilename !== undefined) {
        const file = assertExists(cache.getFileData(`models/${spec.sharedTextureFilename}`));
        shared = { file, bin: parseMPH_Model(file) };
    }

    const model = parseMPH_Model(modelFile, shared?.bin.mphTex ?? null);
    let texture: TEX0;
    if (model.tex0 !== null)
        texture = model.tex0;
    else if (model.mphTex.texs.length === 0 && shared !== null)
        texture = parseTEX0Texture(shared.file, shared.bin.mphTex);
    else
        texture = parseTEX0Texture(modelFile, model.mphTex);

    if (spec.paletteFilename !== undefined) {
        const paletteFile = assertExists(cache.getFileData(`models/${spec.paletteFilename}`));
        const paletteTexture = parseTEX0Texture(paletteFile, parseMPH_Model(paletteFile).mphTex);
        for (const override of spec.paletteOverrides ?? [])
            texture.palettes[override.target] = { ...assertExists(paletteTexture.palettes[override.source]), name: `pallet_${override.target}` };
    }
    const animationFile = assertExists(cache.getFileData(`models/${spec.animationFilename}`));
    const animation = parseMPHAnimation(animationFile, spec.animationId, model.nodes.length);
    return new MPHRenderer(device, renderCache, model, texture, animation, { entityModel: true, ...options(animation) });
}

function calcDoorModelMatrix(dst: mat4, door: MPHDoorEntity, modelScale: number): void {
    const position = vec3.scale(vec3.create(), door.position, MPH_VIEWER_SCALE);
    const target = vec3.sub(vec3.create(), position, door.facing);
    mat4.targetTo(dst, position, target, door.up);
    mat4.scale(dst, dst, [modelScale, modelScale, modelScale]);
}

// Max door animation length is 2s, 6s lets us cycle open/hold/close for both
// doors across a connector without enabling visibility through.
const DOOR_OPEN_HOLD_DURATION = 2000;
const DOOR_HALF_CYCLE_DURATION = 6050;

export class MPHEntityFile {
    constructor(private entities: MPHEntities, private metadata: MPHEntityMetadata, private cache: MPHEntityResourceCache, private sceneMode: MPHSceneMode) {
    }

    public requestResources(): void {
        for (const door of this.entities.doors)
            requestEntityModel(this.cache, getDoorModelSpec(this.metadata, door));
    }

    public createRenderers(device: GfxDevice, renderCache: GfxRenderCache): MPHRenderer[] {
        return this.entities.doors.map((door, index) => {
            const spec = getDoorModelSpec(this.metadata, door);
            const renderer = createEntityModelRenderer(device, this.cache, renderCache, spec, (animation) => {
                const animationDuration = Math.max(0, (animation.node?.frameCount ?? 1) - 1) * 1000 / 30;
                return {
                    sceneMode: this.sceneMode,
                    mapAnimationTime: (time) => {
                        let phase = (time + (index & 1) * DOOR_HALF_CYCLE_DURATION) % (DOOR_HALF_CYCLE_DURATION * 2);
                        if (phase < DOOR_OPEN_HOLD_DURATION)
                            return animationDuration;
                        phase -= DOOR_OPEN_HOLD_DURATION;
                        if (phase < animationDuration)
                            return animationDuration - phase;
                        if (phase < DOOR_HALF_CYCLE_DURATION)
                            return 0;
                        phase -= DOOR_HALF_CYCLE_DURATION;
                        if (phase < animationDuration)
                            return phase;
                        return animationDuration;
                    },
                };
            });
            calcDoorModelMatrix(renderer.modelMatrix, door, renderer.modelScale);
            return renderer;
        });
    }
}
