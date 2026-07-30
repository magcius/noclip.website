import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { mat4, quat, ReadonlyQuat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { assert, assertExists, readString } from '../util.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { fx32, TEX0 } from '../nns_g3d/NNS_G3D.js';
import { MPHAnimation, parseMPHAnimation } from './mph_anim.js';
import { fxAngle, MPHbin, parseMPH_Model, parseTEX0Texture } from './mph_binModel.js';
import { MPHLighting, MPHRenderer, MPHRendererOptions, MPHSceneMode } from './render.js';

const ENTITY_HEADER_SIZE = 0x24;
const ENTITY_ENTRY_SIZE = 0x18;
const ENTITY_TYPE_PLATFORM = 0;
const ENTITY_TYPE_OBJECT = 1;
const ENTITY_TYPE_DOOR = 3;
const ENTITY_TYPE_ITEM_SPAWN = 4;
const PLATFORM_DATA_SIZE = 0x24C;
const OBJECT_DATA_SIZE = 0x98;
const DOOR_DATA_SIZE = 0x68;
const ITEM_SPAWN_DATA_SIZE = 0x48;

interface MPHEntityEntry {
    nodeName: string;
    layerMask: number;
    dataOffset: number;
    dataLength: number;
    type: number;
    entityId: number;
}

interface MPHPlatformEntity extends MPHEntityEntry {
    modelId: number;
    active: boolean;
    delay: number;
    position: ReadonlyVec3;
    up: ReadonlyVec3;
    facing: ReadonlyVec3;
    positions: ReadonlyVec3[];
    rotations: ReadonlyQuat[];
    positionOffset: ReadonlyVec3;
    forwardSpeed: number;
    backwardSpeed: number;
    movementType: number;
    reverseType: number;
    flags: number;
    path: MPHPlatformPath;
}

interface MPHObjectEntity extends MPHEntityEntry {
    position: ReadonlyVec3;
    up: ReadonlyVec3;
    facing: ReadonlyVec3;
    modelId: number;
    initialState: number;
}

interface MPHDoorEntity extends MPHEntityEntry {
    position: ReadonlyVec3;
    up: ReadonlyVec3;
    facing: ReadonlyVec3;
    subtype: number;
    doorType: number;
}

interface MPHItemSpawnEntity extends MPHEntityEntry {
    position: ReadonlyVec3;
    parentEntityId: number;
    itemId: number;
    initialState: number;
}

export interface MPHEntities {
    platforms: MPHPlatformEntity[];
    objects: MPHObjectEntity[];
    doors: MPHDoorEntity[];
    itemSpawns: MPHItemSpawnEntity[];
}

interface MPHEntityModelSpec {
    modelFilename: string;
    animationFilename?: string;
    sharedTextureFilename?: string;
    paletteFilename?: string;
    paletteOverrides?: readonly { target: number; source: number }[];
    animationId?: number;
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

function readQuatFx(view: DataView, offs: number): quat {
    const dst = quat.fromValues(readFx32(view, offs + 0x00), readFx32(view, offs + 0x04), readFx32(view, offs + 0x08), readFx32(view, offs + 0x0C));
    return quat.normalize(dst, dst);
}

function parsePlatform(entry: MPHEntityEntry, view: DataView): MPHPlatformEntity {
    assert(entry.dataLength === PLATFORM_DATA_SIZE);
    const offs = entry.dataOffset;
    const positionCount = view.getUint16(offs + 0x3E, true);
    assert(positionCount <= 10);

    const positions: vec3[] = [];
    const rotations: quat[] = [];
    for (let i = 0; i < positionCount; i++) {
        positions.push(readVec3Fx(view, offs + 0x40 + i * 0x0C));
        rotations.push(readQuatFx(view, offs + 0xB8 + i * 0x10));
    }

    const platform: MPHPlatformPathSource = {
        ...entry,
        modelId: view.getUint32(offs + 0x2C, true),
        active: view.getUint8(offs + 0x32) !== 0,
        delay: view.getUint8(offs + 0x33),
        position: readVec3Fx(view, offs + 0x04),
        up: readVec3Fx(view, offs + 0x10),
        facing: readVec3Fx(view, offs + 0x1C),
        positions,
        rotations,
        positionOffset: readVec3Fx(view, offs + 0x158),
        forwardSpeed: readFx32(view, offs + 0x164),
        backwardSpeed: readFx32(view, offs + 0x168),
        movementType: view.getUint32(offs + 0x17C, true),
        reverseType: view.getUint32(offs + 0x184, true),
        flags: view.getUint32(offs + 0x188, true),
    };
    return { ...platform, path: buildPlatformPath(platform) };
}

function parseObject(entry: MPHEntityEntry, view: DataView): MPHObjectEntity {
    assert(entry.dataLength === OBJECT_DATA_SIZE);
    const offs = entry.dataOffset;
    return {
        ...entry,
        position: readVec3Fx(view, offs + 0x04),
        up: readVec3Fx(view, offs + 0x10),
        facing: readVec3Fx(view, offs + 0x1C),
        modelId: view.getInt32(offs + 0x30, true),
        initialState: view.getUint8(offs + 0x28) & 0x03,
    };
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

function parseItemSpawn(entry: MPHEntityEntry, view: DataView): MPHItemSpawnEntity {
    assert(entry.dataLength === ITEM_SPAWN_DATA_SIZE);
    const offs = entry.dataOffset;
    return {
        ...entry,
        position: readVec3Fx(view, offs + 0x04),
        parentEntityId: view.getInt16(offs + 0x28, true),
        itemId: view.getUint32(offs + 0x2C, true),
        initialState: view.getUint8(offs + 0x30),
    };
}

export function parseMPHEntities(buffer: ArrayBufferSlice, layerId: number): MPHEntities {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00, true) === 2);
    assert(layerId >= 0 && layerId < 16);

    const platforms: MPHPlatformEntity[] = [];
    const objects: MPHObjectEntity[] = [];
    const doors: MPHDoorEntity[] = [];
    const itemSpawns: MPHItemSpawnEntity[] = [];
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
        if (entry.type === ENTITY_TYPE_PLATFORM)
            platforms.push(parsePlatform(entry, view));
        else if (entry.type === ENTITY_TYPE_OBJECT)
            objects.push(parseObject(entry, view));
        else if (entry.type === ENTITY_TYPE_DOOR)
            doors.push(parseDoor(entry, view));
        else if (entry.type === ENTITY_TYPE_ITEM_SPAWN)
            itemSpawns.push(parseItemSpawn(entry, view));
    }

    assert(entryCount === view.getUint16(0x04 + layerId * 2, true));
    return { platforms, objects, doors, itemSpawns };
}

export interface MPHObjectMetadata {
    modelName: string;
    animationName: string | null;
    animationIds: readonly number[];
}

export interface MPHPlatformMetadata {
    modelName: string | null;
    animationName: string | null;
    animationId: number;
}

export interface MPHDoorMetadata {
    modelName: string;
    animationName: string;
}

export interface MPHItemMetadata {
    modelName: string;
    animated: boolean;
}

export interface MPHEntityMetadata {
    objects: readonly MPHObjectMetadata[];
    platforms: readonly MPHPlatformMetadata[];
    doors: readonly MPHDoorMetadata[];
    doorLockPaletteIds: readonly number[];
    items: readonly MPHItemMetadata[];
}

// From LoadObjectSubtypeResources @ 0x0216BB30 and LoadDoorTypeResources @ 0x02106508.
function getSharedTextureFilename(modelName: string): string | undefined {
    const equipment = /^(generic|alimbic|lava|ice|ruins)_(console|monitor|power|scanner|switch)_mdl$/.exec(modelName);
    if (equipment !== null)
        return `${equipment[1]}EquipTextureShare_img_Model.bin`;
    if (modelName === 'ghostswitch_mdl' || modelName === 'alimbicmorphballdoor_mdl')
        return 'AlimbicTextureShare_img_Model.bin';
    return undefined;
}

function getObjectModelSpec(metadata: MPHEntityMetadata, object: MPHObjectEntity): MPHEntityModelSpec | null {
    if (object.modelId === -1)
        return null;
    const object_ = assertExists(metadata.objects[object.modelId], `object model ${object.modelId}`);
    const animationId = object_.animationIds[object.initialState];
    const hasAnimation = object_.animationName !== null && animationId !== undefined && animationId >= 0;
    return {
        modelFilename: `${object_.modelName}_Model.bin`,
        animationFilename: hasAnimation ? `${object_.animationName}_Anim.bin` : undefined,
        sharedTextureFilename: getSharedTextureFilename(object_.modelName),
        animationId: hasAnimation ? animationId : undefined,
    };
}

function getPlatformModelSpec(metadata: MPHEntityMetadata, platform: MPHPlatformEntity): MPHEntityModelSpec | null {
    const platform_ = metadata.platforms[platform.modelId];
    if (platform_ === undefined || platform_.modelName === null)
        return null;
    return {
        modelFilename: `${platform_.modelName}_Model.bin`,
        animationFilename: platform_.animationName !== null ? `${platform_.animationName}_Anim.bin` : undefined,
        animationId: platform_.animationName !== null ? platform_.animationId : undefined,
    };
}

function getItemModelSpec(metadata: MPHEntityMetadata, item: MPHItemSpawnEntity): MPHEntityModelSpec {
    const item_ = assertExists(metadata.items[item.itemId], `item type ${item.itemId}`);
    return {
        modelFilename: `${item_.modelName}_Model.bin`,
        animationFilename: item_.animated ? `${item_.modelName}_Anim.bin` : undefined,
        animationId: item_.animated ? 0 : undefined,
    };
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
    if (spec.animationFilename !== undefined)
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

function createEntityModelRenderer(device: GfxDevice, cache: MPHEntityResourceCache, renderCache: GfxRenderCache, spec: MPHEntityModelSpec, options: MPHRendererOptions | ((animation: MPHAnimation | null) => MPHRendererOptions)): MPHRenderer {
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
    const animationFile = spec.animationFilename !== undefined ?
        cache.getFileData(`models/${spec.animationFilename}`) : null;
    const animation = animationFile !== null && spec.animationId !== undefined ?
        parseMPHAnimation(animationFile, spec.animationId, model.nodes.length) : null;
    const rendererOptions = typeof options === 'function' ? options(animation) : options;
    return new MPHRenderer(device, renderCache, model, texture, animation, { entityModel: true, ...rendererOptions });
}

const scratchPosition = vec3.create();
const scratchRotation = quat.create();
const scratchScale = vec3.create();

function calcOrientedModelMatrix(dst: mat4, position: ReadonlyVec3, facing: ReadonlyVec3, up: ReadonlyVec3, modelScale: number): void {
    const target = vec3.sub(vec3.create(), position, facing);
    mat4.targetTo(dst, position, target, up);
    mat4.scale(dst, dst, [modelScale, modelScale, modelScale]);
}

interface MPHPlatformPathStep {
    fromIndex: number;
    toIndex: number;
    durationInFrames: number;
}

interface MPHPlatformPath {
    steps: MPHPlatformPathStep[];
    cycleFrames: number;
    // Non-looping platforms hold their final keys.
    looping: boolean;
    phaseOffsetFrames: number;
}

type MPHPlatformPathSource = Omit<MPHPlatformEntity, 'path'>;

function segmentDuration(a: ReadonlyVec3, b: ReadonlyVec3, speed: number): number {
    return speed > 0 ? vec3.distance(a, b) / speed : 0;
}

// Alinos landing site lava rocks sink on player step. Simulate random sinking
// to make the viewer more interesting.
function calcPreviewPhaseFrames(platform: MPHPlatformPathSource, cycleFrames: number): number {
    const isInactiveLavaRock = !platform.active && platform.modelId >= 24 && platform.modelId <= 28;
    if (!isInactiveLavaRock || cycleFrames === 0)
        return 0;
    return (platform.entityId * 17 % 31) / 31 * cycleFrames;
}

function buildPlatformPath(platform: MPHPlatformPathSource): MPHPlatformPath {
    const { positions, delay, forwardSpeed, backwardSpeed } = platform;
    const steps: MPHPlatformPathStep[] = [];
    // Don't divide by zero on zero-delay platforms.
    const addStep = (fromIndex: number, toIndex: number, durationInFrames: number): void => {
        if (durationInFrames > 0)
            steps.push({ fromIndex, toIndex, durationInFrames });
    };
    const addMove = (fromIndex: number, toIndex: number, speed: number): void =>
        addStep(fromIndex, toIndex, segmentDuration(positions[fromIndex], positions[toIndex], speed));

    if (platform.reverseType === 2) {
        // Follow path once.
        for (let i = 0; i < positions.length - 1; i++) {
            addStep(i, i, delay);
            addMove(i, i + 1, forwardSpeed);
        }
    } else if (platform.reverseType === 1) {
        // Loop from last to first.
        for (let i = 0; i < positions.length; i++) {
            addStep(i, i, delay);
            addMove(i, (i + 1) % positions.length, forwardSpeed);
        }
    } else {
        // Alternate between endpoints.
        const last = positions.length - 1;
        addStep(0, 0, delay);
        for (let i = 0; i < last; i++)
            addMove(i, i + 1, forwardSpeed);
        addStep(last, last, delay);
        for (let i = last; i > 0; i--)
            addMove(i, i - 1, backwardSpeed);
    }

    let cycleFrames = 0;
    for (let i = 0; i < steps.length; i++)
        cycleFrames += steps[i].durationInFrames;
    const phaseOffsetFrames = calcPreviewPhaseFrames(platform, cycleFrames);
    return { steps, cycleFrames, looping: platform.reverseType !== 2, phaseOffsetFrames };
}

function setPlatformKey(dstPosition: vec3, dstRotation: quat, platform: MPHPlatformEntity, index: number): void {
    vec3.copy(dstPosition, platform.positions[index]);
    quat.copy(dstRotation, platform.rotations[index]);
}

function samplePlatformPath(dstPosition: vec3, dstRotation: quat, platform: MPHPlatformEntity, timeInMilliseconds: number): void {
    if (platform.positions.length === 0) {
        vec3.copy(dstPosition, platform.position);
        quat.identity(dstRotation);
        return;
    }

    const path = platform.path;
    if (path.cycleFrames === 0) {
        setPlatformKey(dstPosition, dstRotation, platform, 0);
        return;
    }

    const frameTime = timeInMilliseconds * 30 / 1000;
    let frame = path.looping ?
        (frameTime + path.phaseOffsetFrames) % path.cycleFrames :
        platform.active ? frameTime : 0;

    for (let i = 0; i < path.steps.length; i++) {
        const step = path.steps[i];
        if (frame <= step.durationInFrames) {
            const t = frame / step.durationInFrames;
            vec3.lerp(dstPosition, platform.positions[step.fromIndex], platform.positions[step.toIndex], t);
            quat.slerp(dstRotation, platform.rotations[step.fromIndex], platform.rotations[step.toIndex], t);
            return;
        }
        frame -= step.durationInFrames;
    }

    setPlatformKey(dstPosition, dstRotation, platform, path.looping ? 0 : platform.positions.length - 1);
}

function setupPlatformModelMatrix(dst: mat4, platform: MPHPlatformEntity, modelScale: number): void {
    if (platform.positions.length === 0) {
        const position = vec3.add(vec3.create(), platform.position, platform.positionOffset);
        calcOrientedModelMatrix(dst, position, platform.facing, platform.up, modelScale);
        return;
    }

    const position = vec3.add(vec3.create(), platform.positions[0], platform.positionOffset);
    mat4.fromRotationTranslationScale(dst, platform.rotations[0], position, [modelScale, modelScale, modelScale]);
}

function calcPlatformModelMatrix(dst: mat4, platform: MPHPlatformEntity, timeInMilliseconds: number, modelScale: number): void {
    samplePlatformPath(scratchPosition, scratchRotation, platform, timeInMilliseconds);
    vec3.add(scratchPosition, scratchPosition, platform.positionOffset);
    vec3.set(scratchScale, modelScale, modelScale, modelScale);
    mat4.fromRotationTranslationScale(dst, scratchRotation, scratchPosition, scratchScale);
}

// Stagger spawning to avoid synchronized bobs.
const ITEM_SPAWN_PREVIEW_PHASE_STEP = 0x2000;

function calcItemSpawnModelMatrix(dst: mat4, item: MPHItemSpawnEntity, phaseAngle: number, timeInMilliseconds: number, modelScale: number): void {
    const baseY = item.position[1] + 2662 / 0x1000;
    // UpdateItemInstance advances rotation by 0x300 angle units per tick and
    // uses the same phase for a 0x200-FX32 vertical bob.
    const ticks = timeInMilliseconds * 30 / 1000;
    const angle = fxAngle(phaseAngle + ticks * 0x300);
    const bob = Math.sin(angle) * (0x200 / 0x1000);
    mat4.fromYRotation(dst, angle);
    dst[12] = item.position[0];
    dst[13] = baseY + bob;
    dst[14] = item.position[2];
    vec3.set(scratchScale, modelScale, modelScale, modelScale);
    mat4.scale(dst, dst, scratchScale);
}

// Max door animation length is 2s, 6s lets us cycle open/hold/close for both
// doors across a connector without enabling visibility through.
const DOOR_OPEN_HOLD_DURATION = 2000;
const DOOR_HALF_CYCLE_DURATION = 6050;

export class MPHEntityFile {
    private movers: ((timeInMilliseconds: number) => void)[] = [];

    constructor(private entities: MPHEntities, private metadata: MPHEntityMetadata, private cache: MPHEntityResourceCache, private sceneMode: MPHSceneMode) {
    }

    public requestResources(): void {
        for (const platform of this.entities.platforms) {
            const spec = getPlatformModelSpec(this.metadata, platform);
            if (spec !== null)
                requestEntityModel(this.cache, spec);
        }
        for (const object of this.entities.objects) {
            const spec = getObjectModelSpec(this.metadata, object);
            if (spec !== null)
                requestEntityModel(this.cache, spec);
        }
        for (const door of this.entities.doors)
            requestEntityModel(this.cache, getDoorModelSpec(this.metadata, door));
        for (const item of this.entities.itemSpawns)
            requestEntityModel(this.cache, getItemModelSpec(this.metadata, item));
    }

    public createRenderers(device: GfxDevice, renderCache: GfxRenderCache, lighting: MPHLighting): MPHRenderer[] {
        const renderers: MPHRenderer[] = [];
        for (const platform of this.entities.platforms) {
            const spec = getPlatformModelSpec(this.metadata, platform);
            if (spec === null)
                continue;
            const renderer = createEntityModelRenderer(device, this.cache, renderCache, spec, {
                sceneMode: this.sceneMode,
                lighting,
            });
            if (platform.positions.length > 1)
                this.movers.push((time) => calcPlatformModelMatrix(renderer.modelMatrix, platform, time, renderer.modelScale));
            else
                setupPlatformModelMatrix(renderer.modelMatrix, platform, renderer.modelScale);
            renderers.push(renderer);
        }
        for (const object of this.entities.objects) {
            const spec = getObjectModelSpec(this.metadata, object);
            if (spec === null)
                continue;
            const renderer = createEntityModelRenderer(device, this.cache, renderCache, spec, {
                sceneMode: this.sceneMode,
                lighting,
            });
            calcOrientedModelMatrix(renderer.modelMatrix, object.position, object.facing, object.up, renderer.modelScale);
            renderers.push(renderer);
        }
        for (let index = 0; index < this.entities.doors.length; index++) {
            const door = this.entities.doors[index];
            const spec = getDoorModelSpec(this.metadata, door);
            const renderer = createEntityModelRenderer(device, this.cache, renderCache, spec, (animation) => {
                const animationDuration = Math.max(0, (animation?.node?.frameCount ?? 1) - 1) * 1000 / 30;
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
            calcOrientedModelMatrix(renderer.modelMatrix, door.position, door.facing, door.up, renderer.modelScale);
            renderers.push(renderer);
        }
        for (let index = 0; index < this.entities.itemSpawns.length; index++) {
            const item = this.entities.itemSpawns[index];
            const phaseAngle = index * ITEM_SPAWN_PREVIEW_PHASE_STEP;
            const renderer = createEntityModelRenderer(device, this.cache, renderCache, getItemModelSpec(this.metadata, item), {
                sceneMode: this.sceneMode,
                lighting,
            });
            this.movers.push((time) => calcItemSpawnModelMatrix(renderer.modelMatrix, item, phaseAngle, time, renderer.modelScale));
            renderers.push(renderer);
        }
        return renderers;
    }

    public update(timeInMilliseconds: number): void {
        for (let i = 0; i < this.movers.length; i++)
            this.movers[i](timeInMilliseconds);
    }
}
