
// Implements support for Retro Studios actor data

import { ResourceSystem } from "./resource";
import { readString } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec3 } from 'gl-matrix';
import { CMDL } from './cmdl';
import { ANCS } from './ancs';
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
    Debris                  = 0x1B,
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
    DebrisExtended          = 0x45,
    IceSheegoth             = 0x4B,
    PlayerActor             = 0x4C,
    Flaahgra                = 0x4D,
    FishCloud               = 0x4F,
    JellyZap                = 0x54,
    Thardus                 = 0x58,
    WallCrawlerSwarm        = 0x5A,
    FlaahgraTentacle        = 0x5C,
    ThardusRockProjectile   = 0x5F,
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
    IceZoomer               = 0x78,
    Puffer                  = 0x79,
    Tryclops                = 0x7A,
    Ridley                  = 0x7B,
    Seedling                = 0x7C,
    Burrower                = 0x7F,
    ScriptBeam              = 0x81,
    MetroidPrimeStage2      = 0x83,
    MetroidPrimeStage1      = 0x84,
    OmegaPirate             = 0x86,
    PhazonPool              = 0x87,
    PhazonHealingNodule     = 0x88,
    EnergyBall              = 0x8B
}

export class AnimationParameters {
    ancs: ANCS;
    charID: number;
    animID: number;
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

    public getRenderModel() : CMDL {
        if (this.animParams != null &&
            this.animParams.ancs != null &&
            this.animParams.ancs.characters.length > 0)
        {
            const model = this.animParams.ancs.characters[0].model;
            if (model != null) {
                return model;
            }
        }

        return this.model;
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

function readAnimationParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity, resourceSystem: ResourceSystem): number {
    const view = buffer.createDataView();
    ent.animParams = new AnimationParameters();
    const ancsID = readString(buffer, offs, 4, false);
    ent.animParams.ancs = resourceSystem.loadAssetByID(ancsID, 'ANCS');
    ent.animParams.charID = view.getUint32(offs + 0x04);
    ent.animParams.animID = view.getUint32(offs + 0x08);
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
        entityTableIdx += 0x11 + (numLinks * 0xC);

        // This code was auto-generated based on Prime World Editor script templates
        switch (entityType) {
            case MP1EntityType.Actor: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0xC4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xC8, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xD4, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0x155));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Door: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x24, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x30, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x83, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0xD1));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Platform: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x3C, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x40, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x4C, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0xCD));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.NewIntroBoss: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Pickup: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x54, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x58, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x64, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0xE1));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Beetle: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Debris: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x55, 'CMDL', resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x59, entity);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.WarWasp: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SpacePirate: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlyingPirate: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ElitePirate: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x29B, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidBeta: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ChozoGhost: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.BloodFlower: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlickerBat: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PuddleSpore: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PuddleToadGamma: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FireFlea: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetareeAlpha: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SpankWeed: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Parasite: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Ripper: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Drone: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x124, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x130));
                readActorParameters(buffer, entityTableIdx + 0x16D, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1C0, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidAlpha: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.DebrisExtended: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x8C, 'CMDL', resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x90, entity);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.IceSheegoth: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PlayerActor: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0xC4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xC8, entity, resourceSystem);
                entity.animParams.charID = 2;
                readActorParameters(buffer, entityTableIdx + 0xD4, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0x154));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Flaahgra: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FishCloud: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x25, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x29, entity, resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.JellyZap: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Thardus: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.WallCrawlerSwarm: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.active = !!(view.getUint8(entityTableIdx + 0x24));
                readActorParameters(buffer, entityTableIdx + 0x25, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x78, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xA6, entity, resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlaahgraTentacle: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ThardusRockProjectile: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.GunTurret: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x40, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x4C, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x9F, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Babygoth: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Eyeball: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1BC, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Magdolite: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SnakeWeedSwarm: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, false, true);
                entity.active = !!(view.getUint8(entityTableIdx + 0x18));
                readAnimationParameters(buffer, entityTableIdx + 0x19, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x25, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x78, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ActorContraption: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0xC4, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xD0, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x123, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x165));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Oculus: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Geemer: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AtomicAlpha: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AmbientAI: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0xC0, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xCC, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x11F, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x159));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AtomicBeta: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.IceZoomer: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Puffer: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Tryclops: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Ridley: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Seedling: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Burrower: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidPrimeStage2: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidPrimeStage1: {
                const entity = new Entity(entityId);
                entityTableIdx += 0x04;
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x24A, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x256));
                readActorParameters(buffer, entityTableIdx + 0x293, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x2E6, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.OmegaPirate: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x29B, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PhazonPool: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetId(buffer, entityTableIdx + 0x25, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PhazonHealingNodule: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entityTableIdx += 0x1E7;
                entityTableIdx += readString(buffer, entityTableIdx).length + 1;
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.EnergyBall: {
                const entity = new Entity(entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetId(buffer, entityTableIdx + 0x1B8, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
        }

        entityTableIdx = nextEntity;
    }

    return { entities };
}