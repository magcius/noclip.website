import { mat3, vec3 } from "gl-matrix";
import { nArray } from "../../util";
import { DescentDataReader } from "./DataReader";
import { POLYOBJ_MAX_SUBMODELS } from "./Polymodel";

export enum DescentObjectType {
    NONE = -1,
    WALL = 0,
    FIREBALL = 1,
    ROBOT = 2,
    HOSTAGE = 3,
    PLAYER = 4,
    WEAPON = 5,
    CAMERA = 6,
    POWERUP = 7,
    DEBRIS = 8,
    CONTROLCEN = 9,
    FLARE = 10,
    CLUTTER = 11,
    GHOST = 12,
    LIGHT = 13,
    COOP = 14,
    MARKER = 15,
}

export enum DescentControlType {
    NONE = 0,
    AI = 1,
    EXPLOSION = 2,
    FLYING = 4,
    SLEW = 5,
    FLYTHROUGH = 6,
    WEAPON = 9,
    REPAIRCEN = 10,
    MORPH = 11,
    DEBRIS = 12,
    POWERUP = 13,
    LIGHT = 14,
    REMOTE = 15,
    CONTROLCEN = 16,
}

export enum DescentMovementType {
    NONE = 0,
    PHYSICS = 1,
    SPINNING = 3,
}

export enum DescentRenderType {
    NONE = 0,
    POLYOBJ = 1,
    FIREBALL = 2,
    LASER = 3,
    HOSTAGE = 4,
    POWERUP = 5,
    MORPH = 6,
    WEAPONVCLIP = 7,
}

export type DescentObjectControlTypeNone = {
    type: DescentControlType.NONE;
};

const AI_FLAGS_COUNT = 11;
export type DescentObjectControlTypeAI = {
    type: DescentControlType.AI;
    behavior: number;
    ai_flags: number[];
    hide_segment: number;
    hide_index: number;
    path_length: number;
    path_index: number;
};

export type DescentObjectControlTypeExplosion = {
    type: DescentControlType.EXPLOSION;
    spawn_time: number;
    delete_time: number;
    delete_object: number;
};

export type DescentObjectControlTypeFlying = {
    type: DescentControlType.FLYING;
};

export type DescentObjectControlTypeSlew = {
    type: DescentControlType.SLEW;
};

export type DescentObjectControlTypeFlythrough = {
    type: DescentControlType.FLYTHROUGH;
};

export type DescentObjectControlTypeWeapon = {
    type: DescentControlType.WEAPON;
    parent_type: number;
    parent_num: number;
    parent_sig: number;
};

export type DescentObjectControlTypeRepairCen = {
    type: DescentControlType.REPAIRCEN;
};

export type DescentObjectControlTypeMorph = {
    type: DescentControlType.MORPH;
};

export type DescentObjectControlTypeDebris = {
    type: DescentControlType.DEBRIS;
};

export type DescentObjectControlTypePowerup = {
    type: DescentControlType.POWERUP;
    count: number;
};

export type DescentObjectControlTypeLight = {
    type: DescentControlType.LIGHT;
    intensity: number;
};

export type DescentObjectControlTypeRemote = {
    type: DescentControlType.REMOTE;
};

export type DescentObjectControlTypeControlCen = {
    type: DescentControlType.CONTROLCEN;
};

export type DescentObjectControlType =
    | DescentObjectControlTypeNone
    | DescentObjectControlTypeAI
    | DescentObjectControlTypeExplosion
    | DescentObjectControlTypeFlying
    | DescentObjectControlTypeSlew
    | DescentObjectControlTypeFlythrough
    | DescentObjectControlTypeWeapon
    | DescentObjectControlTypeRepairCen
    | DescentObjectControlTypeMorph
    | DescentObjectControlTypeDebris
    | DescentObjectControlTypePowerup
    | DescentObjectControlTypeLight
    | DescentObjectControlTypeRemote
    | DescentObjectControlTypeControlCen;

export const OBJECT_PHYSICS_FLAGS_TURNROLL = 1;
export const OBJECT_PHYSICS_FLAGS_LEVELLING = 2;
export const OBJECT_PHYSICS_FLAGS_BOUNCE = 4;
export const OBJECT_PHYSICS_FLAGS_WIGGLE = 8;
export const OBJECT_PHYSICS_FLAGS_STICK = 16;
export const OBJECT_PHYSICS_FLAGS_PERSISTENT = 32;
export const OBJECT_PHYSICS_FLAGS_USES_THRUST = 64;

export type DescentObjectMovementTypeNone = {
    type: DescentMovementType.NONE;
};

export type DescentObjectMovementTypePhysics = {
    type: DescentMovementType.PHYSICS;
    velocity: vec3;
    thrust: vec3;
    mass: number;
    drag: number;
    brakes: number;
    angular_velocity: vec3;
    rotational_thrust: vec3;
    turn_roll: number;
    flags: number;
};

export type DescentObjectMovementTypeSpinning = {
    type: DescentMovementType.SPINNING;
    spin_rate: number;
};

export type DescentObjectMovementType =
    | DescentObjectMovementTypeNone
    | DescentObjectMovementTypePhysics
    | DescentObjectMovementTypeSpinning;

export type DescentObjectRenderTypeVClip = {
    vclip_num: number;
    frame_time: number;
    frame_number: number;
};

export type DescentObjectRenderTypeNone = {
    type: DescentRenderType.NONE;
};

export type DescentObjectRenderTypePolyobj = {
    type: DescentRenderType.POLYOBJ;
    model_num: number;
    body_angles: vec3[];
    flags: number;
    texture_override: number;
};

export type DescentObjectRenderTypeFireball = {
    type: DescentRenderType.FIREBALL;
} & DescentObjectRenderTypeVClip;

export type DescentObjectRenderTypeLaser = {
    type: DescentRenderType.LASER;
};

export type DescentObjectRenderTypeHostage = {
    type: DescentRenderType.HOSTAGE;
} & DescentObjectRenderTypeVClip;

export type DescentObjectRenderTypePowerup = {
    type: DescentRenderType.POWERUP;
} & DescentObjectRenderTypeVClip;

export type DescentObjectRenderTypeMorph = {
    type: DescentRenderType.MORPH;
};

export type DescentObjectRenderTypeWeaponVClip = {
    type: DescentRenderType.WEAPONVCLIP;
} & DescentObjectRenderTypeVClip;

export type DescentObjectRenderType =
    | DescentObjectRenderTypeNone
    | DescentObjectRenderTypePolyobj
    | DescentObjectRenderTypeFireball
    | DescentObjectRenderTypeLaser
    | DescentObjectRenderTypeHostage
    | DescentObjectRenderTypePowerup
    | DescentObjectRenderTypeMorph
    | DescentObjectRenderTypeWeaponVClip;

function readObjectMovementType(
    reader: DescentDataReader,
    gameDataVersion: number,
    typeId: DescentMovementType,
): DescentObjectMovementType {
    switch (typeId) {
        case DescentMovementType.PHYSICS:
            return {
                type: DescentMovementType.PHYSICS,
                velocity: reader.readFixVector(),
                thrust: reader.readFixVector(),
                mass: reader.readFix(),
                drag: reader.readFix(),
                brakes: reader.readFix(),
                angular_velocity: reader.readFixVector(),
                rotational_thrust: reader.readFixVector(),
                turn_roll: reader.readInt16(),
                flags: reader.readInt16(),
            };
        case DescentMovementType.SPINNING:
            return {
                type: DescentMovementType.SPINNING,
                spin_rate: reader.readFix(),
            };
        default:
            return { type: typeId };
    }
}

function readObjectControlType(
    reader: DescentDataReader,
    gameDataVersion: number,
    typeId: DescentControlType,
): DescentObjectControlType {
    switch (typeId) {
        case DescentControlType.AI: {
            const t: DescentObjectControlTypeAI = {
                type: DescentControlType.AI,
                behavior: reader.readUint8(),
                ai_flags: nArray(AI_FLAGS_COUNT, () => reader.readUint8()),
                hide_segment: reader.readInt16(),
                hide_index: reader.readInt16(),
                path_length: reader.readInt16(),
                path_index: reader.readInt16(),
            };
            if (gameDataVersion <= 25) reader.offset += 4;
            return t;
        }
        case DescentControlType.EXPLOSION:
            return {
                type: DescentControlType.EXPLOSION,
                spawn_time: reader.readFix(),
                delete_time: reader.readFix(),
                delete_object: reader.readInt16(),
            };
        case DescentControlType.POWERUP:
            return {
                type: DescentControlType.POWERUP,
                count: gameDataVersion >= 25 ? reader.readInt32() : 1,
            };
        case DescentControlType.WEAPON:
            return {
                type: DescentControlType.WEAPON,
                parent_type: reader.readInt16(),
                parent_num: reader.readInt16(),
                parent_sig: reader.readInt32(),
            };
        case DescentControlType.LIGHT:
            return {
                type: DescentControlType.LIGHT,
                intensity: reader.readFix(),
            };
        default:
            return { type: typeId };
    }
}

function readPolymodelFixAngles(reader: DescentDataReader): vec3 {
    const p = reader.readInt16() / 65536.0;
    const b = reader.readInt16() / 65536.0;
    const h = reader.readInt16() / 65536.0;
    return vec3.fromValues(p, b, h);
}

function readObjectRenderType(
    reader: DescentDataReader,
    gameDataVersion: number,
    typeId: DescentRenderType,
): DescentObjectRenderType {
    switch (typeId) {
        case DescentRenderType.POLYOBJ:
            return {
                type: DescentRenderType.POLYOBJ,
                model_num: reader.readInt32(),
                body_angles: nArray(POLYOBJ_MAX_SUBMODELS, () =>
                    readPolymodelFixAngles(reader),
                ),
                flags: reader.readInt32(),
                texture_override: reader.readInt32(),
            };
        case DescentRenderType.FIREBALL:
        case DescentRenderType.HOSTAGE:
        case DescentRenderType.POWERUP:
        case DescentRenderType.WEAPONVCLIP:
            return {
                type: typeId,
                vclip_num: reader.readInt32(),
                frame_time: reader.readFix(),
                frame_number: reader.readUint8(),
            };
        default:
            return { type: typeId };
    }
}

export class DescentObject {
    constructor(
        public type: number,
        public subtypeId: number,
        public controlType: DescentObjectControlType,
        public movementType: DescentObjectMovementType,
        public renderType: DescentObjectRenderType,
        public flags: number,
        public segmentNum: number,
        public position: vec3,
        public orientation: mat3,
        public size: number,
        public shields: number,
        public containsType: number,
        public containsId: number,
        public containsCount: number,
    ) {}
}

export function readObject(reader: DescentDataReader, gameDataVersion: number) {
    const type = reader.readInt8() as DescentObjectType;
    const subtype_id = reader.readUint8();
    const control_type_id = reader.readUint8() as DescentControlType;
    const movement_type_id = reader.readUint8() as DescentMovementType;
    const render_type_id = reader.readUint8() as DescentRenderType;
    const flags = reader.readUint8();
    const seg_num = reader.readInt16();
    const position = reader.readFixVector();
    const orientation = reader.readFixMatrix();
    const size = reader.readFix();
    const shields = reader.readFix();
    reader.readFixVector();
    const contains_type = reader.readInt8() as DescentObjectType;
    const contains_id = reader.readUint8();
    const contains_count = reader.readUint8();

    const movement_type = readObjectMovementType(
        reader,
        gameDataVersion,
        movement_type_id,
    );
    const control_type = readObjectControlType(
        reader,
        gameDataVersion,
        control_type_id,
    );
    const render_type = readObjectRenderType(
        reader,
        gameDataVersion,
        render_type_id,
    );

    return new DescentObject(
        type,
        subtype_id,
        control_type,
        movement_type,
        render_type,
        flags,
        seg_num,
        position,
        orientation,
        size,
        shields,
        contains_type,
        contains_id,
        contains_count,
    );
}
