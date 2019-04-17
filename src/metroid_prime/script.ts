// Implements support for Retro Studios actor data
import { ResourceSystem } from "./resource";
import { readString } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec3 } from 'gl-matrix';
import { CMDL } from './cmdl';
import { Color } from "../gx/gx_material";
import { colorFromRGBA } from "../Color";

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
    ambient: Color = new Color(1, 1, 1, 1);
    options: WorldLightingOptions = WorldLightingOptions.NormalWorld;
    layerIdx: number = 0;
    maxAreaLights: Number = 4;
}

export class Entity {
    active: boolean;
    name: string;
    modelMatrix: mat4;
    model: CMDL;
    animParams: AnimationParameters;
    lightParams: LightParameters = new LightParameters;
}

export interface ScriptLayer {
    entities: Entity[];
}

function calcModelMtx(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const rX = Math.PI / 180 * rotationX;
    const rY = Math.PI / 180 * rotationY;
    const rZ = Math.PI / 180 * rotationZ;

    const sinX = Math.sin(rX), cosX = Math.cos(rX);
    const sinY = Math.sin(rY), cosY = Math.cos(rY);
    const sinZ = Math.sin(rZ), cosZ = Math.cos(rZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
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
        const posX = view.getFloat32(offs+0);
        const posY = view.getFloat32(offs+4);
        const posZ = view.getFloat32(offs+8);
        vec3.set(position, posX, posY, posZ);
        offs += 12;
    }
    if (hasRot) {
        const rotX = view.getFloat32(offs+0);
        const rotY = view.getFloat32(offs+4);
        const rotZ = view.getFloat32(offs+8);
        vec3.set(rotation, rotX, rotY, rotZ);
        offs += 12;
    }
    if (hasScale) {
        const scaleX = view.getFloat32(offs+0);
        const scaleY = view.getFloat32(offs+4);
        const scaleZ = view.getFloat32(offs+8);
        vec3.set(scale, scaleX, scaleY, scaleZ);
        offs += 12;
    }

    ent.modelMatrix = mat4.create();
    calcModelMtx(ent.modelMatrix, scale[0], scale[1], scale[2], rotation[0], rotation[1], rotation[2], position[0], position[1], position[2]);
    return offs - originalOffs;
}

function readAssetId(buffer: ArrayBufferSlice, offs: number, type: string, resourceSystem: ResourceSystem): any {
    const assetId = readString(buffer, offs, 4, false);
    return resourceSystem.loadAssetByID(assetId, type);
}

function readAnimationParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();
    ent.animParams = new AnimationParameters;
    ent.animParams.ancsID = readString(buffer, offs, 4);
    ent.animParams.charId = view.getUint32(offs+4);
    ent.animParams.animId = view.getUint32(offs+8);
    return 12;
}

function readLightParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();
    const ambR = view.getFloat32(offs+17);
    const ambG = view.getFloat32(offs+21);
    const ambB = view.getFloat32(offs+25);
    const ambA = view.getFloat32(offs+29);
    const options = view.getInt32(offs+34);
    const maxAreaLights = view.getInt32(offs+54);
    const layerIndex = view.getInt32(offs+59);

    // ent.lightParams is allocated by default
    // TODO(jstpierre): Is the * 255 right here? This function seems unused though.
    colorFromRGBA(ent.lightParams.ambient, ambR * 255, ambG * 255, ambB * 255, ambA * 255);
    ent.lightParams.options = options;
    ent.lightParams.maxAreaLights = maxAreaLights;
    ent.lightParams.layerIdx = layerIndex;
    
    return 63;
}

export function parseScriptLayer(buffer: ArrayBufferSlice, layerOffset: number, resourceSystem: ResourceSystem): ScriptLayer {
    const view = buffer.createDataView();
    const entities: Entity[] = [];
    let offs = layerOffset;
    offs += 1; // skipping 'version' byte which is always 0
    const numEnts = view.getUint32(offs);
    offs += 4;

    for (let i = 0; i < numEnts; i++)
    {
        const entityType = view.getUint8(offs);
        const entitySize = view.getUint32(offs+1);
        const nextEntity = offs + entitySize + 5;
        const entityId = view.getUint32(offs+5);
        const numLinks = view.getUint32(offs+9);
        offs += 17 + (numLinks * 12);

        switch (entityType)
        {
        case MP1EntityType.Actor: {
            const entity = new Entity;
            offs += readName(buffer, offs, entity);
            offs += readTransform(buffer, offs, entity, true, true, true);
            offs += 0xA0;
            entity.model = readAssetId(buffer, offs, 'CMDL', resourceSystem);
            offs += readAnimationParameters(buffer, offs+4, entity);
            offs += 0x81;
            entity.active = view.getUint8(offs) !== 0;
            entities.push(entity);
            break;
        }

        case MP1EntityType.Door: {
            const entity = new Entity;
            offs += readName(buffer, offs, entity);
            offs += readTransform(buffer, offs, entity, true, true, true);
            offs += readAnimationParameters(buffer, offs, entity);
            entities.push(entity);
            offs += 0xA1;
            entity.active = view.getUint8(offs) !== 0;
            break;
        }

        case MP1EntityType.Platform: {
            const entity = new Entity;
            offs += readName(buffer, offs, entity);
            offs += readTransform(buffer, offs, entity, true,  true, true);
            offs += 24;
            entity.model = readAssetId(buffer, offs, 'CMDL', resourceSystem);
            offs += readAnimationParameters(buffer, offs+4, entity);
            offs += 0x81;
            entity.active = view.getUint8(offs) !== 0;
            entities.push(entity);
            break;
        }
        }

        offs = nextEntity;
    }

    return { entities };
}