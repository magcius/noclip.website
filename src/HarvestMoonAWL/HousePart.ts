// Animation associated with buildings

import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";

import * as Act from "./Act.js";
import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";
import { cameraRay, rayBoxDistance } from "./Util.js";
import type { ModelInstance } from "./Render.js";

//#region The ROM table

export const enum PartAnimMode {
    // Single door leaf
    DoorSingle = 0,
    // A mirrored double door
    DoorDouble = 1,
    // A second entrance for the same building - barn
    DoorSecondary = 2,
    // Continuous rotation, windmill
    Spin = 3,
}

export interface HousePartAnim {
    houseTypeIndex: number;
    mode: PartAnimMode;
}

// Type 2 (the barn) appears twice, so this is a flat list rather than a per-type lookup.
export const HOUSE_PART_ANIM: readonly HousePartAnim[] = [
    { houseTypeIndex: 0, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 1, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 2, mode: PartAnimMode.DoorSecondary },
    { houseTypeIndex: 2, mode: PartAnimMode.DoorDouble },
    { houseTypeIndex: 3, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 4, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 5, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 6, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 7, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 8, mode: PartAnimMode.DoorDouble },
    { houseTypeIndex: 9, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 10, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 11, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 12, mode: PartAnimMode.DoorDouble },
    { houseTypeIndex: 13, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 14, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 15, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 16, mode: PartAnimMode.DoorDouble },
    { houseTypeIndex: 17, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 18, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 19, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 20, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 21, mode: PartAnimMode.DoorSingle },
    { houseTypeIndex: 22, mode: PartAnimMode.Spin },
];

export const SPIN_TURN_DEG = -360.0;

export const STEP_DIVISOR = Env.ROM_LOGIC_FPS;

export const WIND_SPEED_DIVISOR = Cloud.WIND_SPEED_DIVISOR;

//#endregion

//#region Windmill Rotor

export const SPIN_PART_INDEX = 1;

export function spinPartIndexForAct(actName: string): number | null {
    for (const e of HOUSE_PART_ANIM) {
        if (e.mode !== PartAnimMode.Spin)
            continue;
        if (Act.HOUSE_CATALOG[e.houseTypeIndex] === actName)
            return SPIN_PART_INDEX;
    }
    return null;
}

export function revolutionsPerSecond(windSpeed: number): number {
    return (windSpeed / WIND_SPEED_DIVISOR) / STEP_DIVISOR * Env.ROM_LOGIC_FPS;
}

export class SpinField {
    public phase = 0;

    public update(deltaSeconds: number, windSpeed: number): void {
        const p = this.phase + revolutionsPerSecond(windSpeed) * deltaSeconds;
        this.phase = p - Math.floor(p);
    }
}

//#endregion

//#region Hinge Transform

export const enum HingeAxis {
    X,
    Y,
}

export interface Hinge {
    modelMatrix: mat4;
    world: mat4;
    base: mat4;
    baseInv: mat4;
    axis: HingeAxis;
    degrees: number;
}

export function makeHinge(modelMatrix: mat4, world: ReadonlyMat4, base: ReadonlyMat4, axis: HingeAxis, degrees: number): Hinge {
    const baseInv = mat4.create();
    mat4.invert(baseInv, base);
    return { modelMatrix, world: mat4.clone(world), base: mat4.clone(base), baseInv, axis, degrees };
}

const scratchHinge = mat4.create();

export function applyHinges(hinges: readonly Hinge[], t: number): void {
    for (const h of hinges) {
        const angle = h.degrees * (Math.PI / 180) * t;
        if (h.axis === HingeAxis.X)
            mat4.fromXRotation(scratchHinge, angle);
        else
            mat4.fromYRotation(scratchHinge, angle);
        mat4.mul(h.modelMatrix, h.base, scratchHinge);
        mat4.mul(h.modelMatrix, h.modelMatrix, h.baseInv);
        mat4.mul(h.modelMatrix, h.world, h.modelMatrix);
    }
}

//#endregion

//#region Doors

export const DOOR_SWING_DEG = -88.0;
export const DOOR_SWING_MIRROR_DEG = 88.0;

export const DOOR_SHUT_TARGET = 0.0;
export const DOOR_OPEN_TARGET = 1.0;

export const enum DoorState {
    ShutStill = 0,
    Moving = 1,
    OpenStill = 2,
}

export const DOOR_SPEED = 1.0;

// Not ROM-derived
export const DOOR_DWELL_SECONDS = 1.0;

export function doorTargetPerSecond(): number {
    return DOOR_SPEED / STEP_DIVISOR * Env.ROM_LOGIC_FPS;
}

export const DOOR_AIM_MAX_DISTANCE = 6.0;

export interface DoorLeaf {
    partIndex: number;
    degrees: number;
}

export function doorLeaves(mode: PartAnimMode): readonly DoorLeaf[] {
    switch (mode) {
    case PartAnimMode.DoorSingle:
        return [{ partIndex: 1, degrees: DOOR_SWING_DEG }];
    case PartAnimMode.DoorDouble:
        return [{ partIndex: 1, degrees: DOOR_SWING_DEG }, { partIndex: 2, degrees: DOOR_SWING_MIRROR_DEG }];
    case PartAnimMode.DoorSecondary:
        return [{ partIndex: 3, degrees: DOOR_SWING_DEG }];
    default:
        return [];
    }
}

const PLAYER_HOUSE_STAGE_TYPE_INDICES = [23, 24, 25];

function actHasHouseType(actName: string, houseTypeIndex: number): boolean {
    if (Act.HOUSE_CATALOG[houseTypeIndex] === actName)
        return true;
    return houseTypeIndex === 0 && PLAYER_HOUSE_STAGE_TYPE_INDICES.some((i) => Act.HOUSE_CATALOG[i] === actName);
}

export function doorLeafSetsForAct(actName: string): (readonly DoorLeaf[])[] {
    const out: (readonly DoorLeaf[])[] = [];
    for (const e of HOUSE_PART_ANIM) {
        if (e.mode === PartAnimMode.Spin || !actHasHouseType(actName, e.houseTypeIndex))
            continue;
        out.push(doorLeaves(e.mode));
    }
    return out;
}

export class Door {
    public angle = DOOR_SHUT_TARGET;
    public target = DOOR_SHUT_TARGET;
    public dwell = 0.0;
    public hinges: Hinge[] = [];
    public readonly boundsMin = vec3.fromValues(Infinity, Infinity, Infinity);
    public readonly boundsMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    // Disables doors hidden by layers
    public gate: ModelInstance | null = null;

    public get pickable(): boolean {
        return this.hinges.length > 0 && (this.gate === null || this.gate.visible);
    }

    public get state(): DoorState {
        if (this.angle !== this.target)
            return DoorState.Moving;
        return this.angle === DOOR_OPEN_TARGET ? DoorState.OpenStill : DoorState.ShutStill;
    }

    public trigger(): void {
        if (this.state !== DoorState.ShutStill)
            return;
        this.target = DOOR_OPEN_TARGET;
        this.dwell = DOOR_DWELL_SECONDS;
    }

    public update(deltaSeconds: number): void {
        if (this.angle === this.target) {
            if (this.target === DOOR_OPEN_TARGET) {
                this.dwell -= deltaSeconds;
                if (this.dwell <= 0.0)
                    this.target = DOOR_SHUT_TARGET;
            }
            return;
        }
        const rising = this.target > this.angle;
        this.angle += (rising ? 1 : -1) * doorTargetPerSecond() * deltaSeconds;
        if (rising ? this.angle > this.target : this.angle < this.target)
            this.angle = this.target;
        applyHinges(this.hinges, this.angle);
    }
}

const scratchCorner = vec3.create();

function growByBox(door: Door, localMin: ReadonlyVec3, localMax: ReadonlyVec3, world: ReadonlyMat4): void {
    for (let i = 0; i < 8; i++) {
        vec3.set(scratchCorner,
            (i & 1) !== 0 ? localMax[0] : localMin[0],
            (i & 2) !== 0 ? localMax[1] : localMin[1],
            (i & 4) !== 0 ? localMax[2] : localMin[2]);
        vec3.transformMat4(scratchCorner, scratchCorner, world);
        vec3.min(door.boundsMin, door.boundsMin, scratchCorner);
        vec3.max(door.boundsMax, door.boundsMax, scratchCorner);
    }
}

// Increase interaction bounds when a door is open
export function growDoorBounds(door: Door, hinge: Hinge, localMin: ReadonlyVec3, localMax: ReadonlyVec3): void {
    applyHinges([hinge], DOOR_OPEN_TARGET);
    growByBox(door, localMin, localMax, hinge.modelMatrix);
    applyHinges([hinge], DOOR_SHUT_TARGET);
    growByBox(door, localMin, localMax, hinge.modelMatrix);
}

const scratchEye = vec3.create();
const scratchForward = vec3.create();

// Determine which door the camera is looking at
export function pickDoor(doors: readonly Door[], cameraWorldMatrix: ReadonlyMat4): Door | null {
    cameraRay(scratchEye, scratchForward, cameraWorldMatrix);
    let best: Door | null = null;
    let bestDistance = DOOR_AIM_MAX_DISTANCE;
    for (const door of doors) {
        if (!door.pickable)
            continue;
        const t = rayBoxDistance(scratchEye, scratchForward, door.boundsMin, door.boundsMax);
        if (t < 0 || t > bestDistance)
            continue;
        best = door;
        bestDistance = t;
    }
    return best;
}

export function updateDoors(doors: readonly Door[], deltaSeconds: number): void {
    for (const door of doors)
        door.update(deltaSeconds);
}

//#endregion
