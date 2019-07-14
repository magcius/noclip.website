
// Implements support for Retro Studios actor data

import { ResourceSystem } from "./resource";
import { readString } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec3 } from 'gl-matrix';
import { CMDL } from './cmdl';
import { Color } from "../gx/gx_material";
import { colorFromRGBA } from "../Color";
import { computeModelMatrixSRT, MathConstants } from "../MathHelpers";

export const enum MP1EntityType {
    Actor                   = 0x00,
    Door                    = 0x03,
    Platform                = 0x08,
    NewIntroBoss            = 0x0E,
    Pickup                  = 0x11,
    Beetle                  = 0x16,
    DamageableTrigger       = 0x1A,
    WarWasp                 = 0x21,
    SpacePirate             = 0x24,
    FlyingPirate            = 0x25,
    ElitePirate             = 0x26,
    MetroidBeta             = 0x27,
    ChozoGhost              = 0x28,
    BloodFlower             = 0x2D,
    FlickerBat              = 0x2E,
    PuddleSpore             = 0x31,
    PuddleToadGamma         = 0x34,
    FireFlea                = 0x36,
    MetareeAlpha            = 0x37,
    SpankWeed               = 0x3B,
    Parasite                = 0x3D,
    Ripper                  = 0x3F,
    Drone                   = 0x43,
    MetroidAlpha            = 0x44,
    IceSheegoth             = 0x4B,
    Flaahgra                = 0x4D,
    FishCloud               = 0x4F,
    JellyZap                = 0x54,
    Thardus                 = 0x58,
    WallCrawlerSwarm        = 0x5A,
    FlaahgraTentacle        = 0x5C,
    GunTurret               = 0x64,
    Babygoth                = 0x66,
    Eyeball                 = 0x67,
    Magdolite               = 0x6B,
    SnakeWeedSwarm          = 0x6D,
    ActorContraption        = 0x6E,
    Oculus                  = 0x6F,
    Geemer                  = 0x70,
    AtomicAlpha             = 0x72,
    AmbientAI               = 0x75,
    AtomicBeta              = 0x77,
    Puffer                  = 0x79,
    Tryclops                = 0x7A,
    Ridley                  = 0x7B,
    Seedling                = 0x7C,
    Burrower                = 0x7F,
    ScriptBeam              = 0x81,
    MetroidPrimeStage2      = 0x83,
    MetroidPrimeRelay       = 0x84,
    OmegaPirate             = 0x86,
    PhazonPool              = 0x87,
    PhazonHealingNodule     = 0x88
}

export class AnimationParameters {
    ancsID: string;
    charId: number;
    animId: number;
}

export const enum WorldLightingOptions {
    Zero = 0,
    NormalWorld = 1,
    NoShadowCast = 2,
    DisableWorld = 3
}

export class LightParameters {
    public ambient: Color = new Color(1, 1, 1, 1);
    public options: WorldLightingOptions = WorldLightingOptions.NormalWorld;
    public layerIdx: number = 0;
    public maxAreaLights: Number = 4;
}

export class Entity {
    public active: boolean;
    public name: string;
    public modelMatrix: mat4;
    public model: CMDL;
    public animParams: AnimationParameters;
    public lightParams: LightParameters = new LightParameters();

    constructor(public entityId: number) {
    }
}

export interface ScriptLayer {
    entities: Entity[];
}

function readName(buffer: ArrayBufferSlice, offs: number, ent: Entity) : number {
    ent.name = readString(buffer, offs);
    return ent.name.length + 1;
}

function readTransform(buffer: ArrayBufferSlice, offs: number, ent: Entity, hasPos: boolean, hasRot: boolean, hasScale: boolean): number {
    const view = buffer.createDataView();
    const originalOffs = offs;

    let position: vec3 = vec3.fromValues(0, 0, 0);
    let rotation: vec3 = vec3.fromValues(0, 0, 0);
    let scale: vec3 = vec3.fromValues(1, 1, 1);

    if (hasPos) {
        const posX = view.getFloat32(offs + 0x00);
        const posY = view.getFloat32(offs + 0x04);
        const posZ = view.getFloat32(offs + 0x08);
        vec3.set(position, posX, posY, posZ);
        offs += 0x0C;
    }

    if (hasRot) {
        const rotX = view.getFloat32(offs + 0x00) * MathConstants.DEG_TO_RAD;
        const rotY = view.getFloat32(offs + 0x04) * MathConstants.DEG_TO_RAD;
        const rotZ = view.getFloat32(offs + 0x08) * MathConstants.DEG_TO_RAD;
        vec3.set(rotation, rotX, rotY, rotZ);
        offs += 0x0C;
    }

    if (hasScale) {
        const scaleX = view.getFloat32(offs + 0x00);
        const scaleY = view.getFloat32(offs + 0x04);
        const scaleZ = view.getFloat32(offs + 0x08);
        vec3.set(scale, scaleX, scaleY, scaleZ);
        offs += 0x0C;
    }

    ent.modelMatrix = mat4.create();
    computeModelMatrixSRT(ent.modelMatrix, scale[0], scale[1], scale[2], rotation[0], rotation[1], rotation[2], position[0], position[1], position[2]);
    return offs - originalOffs;
}

function readAssetId(buffer: ArrayBufferSlice, offs: number, type: string, resourceSystem: ResourceSystem): any {
    const assetId = readString(buffer, offs, 4, false);
    return resourceSystem.loadAssetByID(assetId, type);
}

function readAnimationParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();
    ent.animParams = new AnimationParameters();
    ent.animParams.ancsID = readString(buffer, offs, 4);
    ent.animParams.charId = view.getUint32(offs + 0x04);
    ent.animParams.animId = view.getUint32(offs + 0x08);
    return 0x0C;
}

function readLightParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();

    const castsShadow = view.getUint8(offs + 0x00);
    const shadowScale = view.getFloat32(offs + 0x01);
    const shadowTesselation = view.getUint32(offs + 0x05);
    const shadowAlpha = view.getFloat32(offs + 0x09);
    const maxShadowHeight = view.getFloat32(offs + 0x0D);
    const ambR = view.getFloat32(offs + 0x11);
    const ambG = view.getFloat32(offs + 0x15);
    const ambB = view.getFloat32(offs + 0x19);
    const ambA = view.getFloat32(offs + 0x1D);
    const makeLights = view.getUint8(offs + 0x21);
    const options = view.getUint32(offs + 0x22);
    const maxAreaLights = view.getUint32(offs + 0x26);
    const layerIndex = view.getUint32(offs + 0x3B);

    // ent.lightParams is allocated by default
    // colorFromRGBA(ent.lightParams.ambient, ambR, ambG, ambB, ambA);
    // ent.lightParams.options = options;
    // ent.lightParams.maxAreaLights = maxAreaLights;
    // ent.lightParams.layerIdx = layerIndex;

    return 0x3F;
}

function readScannableParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    return 0x04;
}

function readVisorParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    return 0x06;
}

function readActorParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();
    const originalOffs = offs;
    offs += readLightParameters(buffer, offs, ent);
    offs += readScannableParameters(buffer, offs, ent);
    const cmdlXray = view.getUint32(offs + 0x00);
    const cskrXray = view.getUint32(offs + 0x04);
    const cmdlThermal = view.getUint32(offs + 0x08);
    const cskrThermal = view.getUint32(offs + 0x0C);
    const globalTimeProvider = view.getUint8(offs + 0x10);
    const fadeInTime = view.getFloat32(offs + 0x11);
    const fadeOutTime = view.getFloat32(offs + 0x15);
    offs += 0x19;
    offs += readVisorParameters(buffer, offs, ent);
    const thermalHeat = view.getUint8(offs + 0x00);
    const renderUnsorted = view.getUint8(offs + 0x01);
    const noSortThermal = view.getUint8(offs + 0x02);
    const thermalMag = view.getFloat32(offs + 0x03);
    offs += 0x07;
    return offs - originalOffs;
}

export function parseScriptLayer(buffer: ArrayBufferSlice, layerOffset: number, resourceSystem: ResourceSystem): ScriptLayer {
    const view = buffer.createDataView();
    const entities: Entity[] = [];
    let entityTableIdx = layerOffset;
    entityTableIdx += 1; // skipping 'version' byte which is always 0
    const numEnts = view.getUint32(entityTableIdx);
    entityTableIdx += 4;

    for (let i = 0; i < numEnts; i++) {
        const entityType = view.getUint8(entityTableIdx + 0x00);
        const entitySize = view.getUint32(entityTableIdx + 0x01);
        const nextEntity = entityTableIdx + entitySize + 0x05;
        const entityId = view.getUint32(entityTableIdx + 0x05);
        const numLinks = view.getUint32(entityTableIdx + 0x09);
        entityTableIdx += 17 + (numLinks * 12);

        switch (entityType) {
        case MP1EntityType.Actor: {
            const entity = new Entity(entityId);
            entityTableIdx += readName(buffer, entityTableIdx, entity);
            entityTableIdx += readTransform(buffer, entityTableIdx, entity, true, true, true);
            entityTableIdx += 0xA0;
            entity.model = readAssetId(buffer, entityTableIdx, 'CMDL', resourceSystem);
            entityTableIdx += readAnimationParameters(buffer, entityTableIdx, entity);
            entityTableIdx += readActorParameters(buffer, entityTableIdx, entity);
            const looping = !!(view.getUint8(entityTableIdx + 0x00));
            const immovable = !!(view.getUint8(entityTableIdx + 0x01));
            const solid = !!(view.getUint8(entityTableIdx + 0x02));
            const cameraPassthrough = !!(view.getUint8(entityTableIdx + 0x03));
            const active = !!(view.getUint8(entityTableIdx + 0x04));
            entity.active = active;
            entities.push(entity);
            break;
        }

        case MP1EntityType.Door: {
            const entity = new Entity(entityId);
            entityTableIdx += readName(buffer, entityTableIdx, entity);
            entityTableIdx += readTransform(buffer, entityTableIdx, entity, true, true, true);
            entityTableIdx += readAnimationParameters(buffer, entityTableIdx, entity);
            entityTableIdx += 0xA1;
            entity.active = view.getUint8(entityTableIdx) !== 0;
            entities.push(entity);
            break;
        }

        case MP1EntityType.Platform: {
            const entity = new Entity(entityId);
            entityTableIdx += readName(buffer, entityTableIdx, entity);
            entityTableIdx += readTransform(buffer, entityTableIdx, entity, true,  true, true);
            entityTableIdx += 24;
            entity.model = readAssetId(buffer, entityTableIdx, 'CMDL', resourceSystem);
            entityTableIdx += readAnimationParameters(buffer, entityTableIdx+4, entity);
            entityTableIdx += 0x81;
            entity.active = view.getUint8(entityTableIdx) !== 0;
            entities.push(entity);
            break;
        }
        }

        entityTableIdx = nextEntity;
    }

    return { entities };
}