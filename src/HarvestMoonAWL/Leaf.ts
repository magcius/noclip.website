// A single leaf that occasionally drops from a tree and flutters to the ground. 
// Spawn location identified from anchors on certain trees
// Scheduler attempts to spawn one per second from an onscreen anchor

import { vec3 } from "gl-matrix";

import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";
import { OqtFile, OqtLeafGroup, oqtTypeId } from "./Oqt.js";
import { Rng } from "./Rng.js";

//#region Constants

export const POOL_SIZE = 60;
export const SPAWN_INTERVAL_FRAMES = 30;
export const SPAWN_HEIGHT = 3.0;

export const RNG_DIVISOR = 10000;
export const ANGLE_MODULUS = 0xf570;
export const RADIUS_MODULUS = 0x2711;
export const RADIUS_OFFSET = 10000;

export const FALL_PER_FRAME = 0.02;

export const WIND_DRIFT_SCALE = 0.05;

export const SWAY_AMPLITUDE = 0.3;
export const FLUTTER_PERIOD_FRAMES = 60;

export const TILT_DEGREES = 60.0;

export const QUAD_HALF_SIZE = 0.05;

export const IMAGE_COUNT = 6;

export function seasonFileName(seasonIndex: number): string {
    return `mapleaf-s${seasonIndex}.oqt`;
}

//#endregion

//#region Anchors

export interface LeafAnchor {
    pos: vec3;
    imageIndex: number;
}

export interface LeafAnchorGroup {
    center: vec3;
    radius: number;
    start: number;
    count: number;
}

function groupSphere(group: OqtLeafGroup): LeafAnchorGroup {
    const hx = (group.bboxMax[0] - group.bboxMin[0]) * 0.5;
    const hy = (group.bboxMax[1] - group.bboxMin[1]) * 0.5;
    const hz = (group.bboxMax[2] - group.bboxMin[2]) * 0.5;
    return {
        center: vec3.fromValues(group.bboxMin[0] + hx, group.bboxMin[1] + hy, group.bboxMin[2] + hz),
        radius: Math.hypot(hx, hy, hz),
        start: group.start,
        count: group.count,
    };
}

export interface LeafAnchorSet {
    anchors: LeafAnchor[];
    groups: LeafAnchorGroup[];
}

export function parseAnchors(file: OqtFile): LeafAnchorSet {
    return {
        anchors: file.instances.map((inst): LeafAnchor => ({
            pos: vec3.fromValues(inst.pos[0], inst.pos[1], inst.pos[2]),
            imageIndex: oqtTypeId(inst) % IMAGE_COUNT,
        })),
        groups: file.groups.map(groupSphere),
    };
}

//#endregion

//#region Falling Leaf

export interface FallingLeaf {
    alive: boolean;
    x: number;
    y: number;
    z: number;
    drawX: number;
    drawY: number;
    drawZ: number;
    swayX: number;
    swayZ: number;
    groundY: number;
    imageIndex: number;
    phaseFrames: number;
    tiltRadians: number;
    anchorIndex: number;
}

function newLeaf(): FallingLeaf {
    return {
        alive: false, x: 0, y: 0, z: 0, drawX: 0, drawY: 0, drawZ: 0,
        swayX: 0, swayZ: 0, groundY: 0, imageIndex: 0, phaseFrames: 0, tiltRadians: 0, anchorIndex: -1,
    };
}

export function flutterPhase(phaseFrames: number): number {
    return Math.sin((2 * Math.PI) * (phaseFrames / FLUTTER_PERIOD_FRAMES));
}

//#endregion

//#region LeafField

const scratchDrift = vec3.create();

export class LeafField {
    public leaves: FallingLeaf[] = [];
    // Does this tree already have a falling leaf?
    private busy: boolean[] = [];
    private anchorSet: LeafAnchorSet = { anchors: [], groups: [] };
    private spawnCounter = 0;
    private rng: Rng;
    // Rebuilt on every spawn attempt - avoid allocating each second.
    private candidates: number[] = [];

    constructor(seed: number = 1) {
        this.rng = new Rng(seed >>> 0 || 1);
        for (let i = 0; i < POOL_SIZE; i++)
            this.leaves.push(newLeaf());
    }

    // Handle season change - clear all current falling leaves
    public setAnchors(anchorSet: LeafAnchorSet): void {
        this.anchorSet = anchorSet;
        this.busy = new Array(anchorSet.anchors.length).fill(false);
        for (const leaf of this.leaves)
            leaf.alive = false;
        this.spawnCounter = 0;
    }

    public get anchors(): LeafAnchor[] {
        return this.anchorSet.anchors;
    }

    private freeLeaf(): FallingLeaf | null {
        for (const leaf of this.leaves)
            if (!leaf.alive)
                return leaf;
        return null;
    }

    private spawn(isGroupVisible: (group: LeafAnchorGroup) => boolean): void {
        const anchors = this.anchorSet.anchors;
        if (anchors.length === 0)
            return;

        this.candidates.length = 0;
        for (const group of this.anchorSet.groups) {
            if (!isGroupVisible(group))
                continue;
            for (let i = 0; i < group.count; i++) {
                const index = group.start + i;
                if (!this.busy[index])
                    this.candidates.push(index);
            }
        }

        const n = Math.min(this.candidates.length, anchors.length);
        if (n === 0)
            return;

        this.emit(this.candidates[this.rng.next() % n]);
    }

    private emit(anchorIndex: number): boolean {
        const anchor = this.anchorSet.anchors[anchorIndex];
        const angle = (this.rng.next() % ANGLE_MODULUS) / RNG_DIVISOR;
        const radius = ((this.rng.next() % RADIUS_MODULUS) + RADIUS_OFFSET) / RNG_DIVISOR;

        const leaf = this.freeLeaf();
        if (leaf === null)
            return false;

        leaf.alive = true;
        leaf.x = anchor.pos[0] + radius * Math.cos(angle);
        leaf.z = anchor.pos[2] + radius * Math.sin(angle);
        leaf.y = anchor.pos[1] + SPAWN_HEIGHT;
        leaf.groundY = anchor.pos[1];
        leaf.imageIndex = anchor.imageIndex;
        leaf.anchorIndex = anchorIndex;

        const swayAngle = (this.rng.next() % ANGLE_MODULUS) / RNG_DIVISOR;
        leaf.swayX = SWAY_AMPLITUDE * Math.cos(swayAngle);
        leaf.swayZ = SWAY_AMPLITUDE * Math.sin(swayAngle);
        leaf.phaseFrames = 0;
        leaf.tiltRadians = 0;
        leaf.drawX = leaf.x;
        leaf.drawY = leaf.y;
        leaf.drawZ = leaf.z;

        this.busy[anchorIndex] = true;
        return true;
    }

    private tick(windOctant: number, windSpeed: number, frames: number): void {
        Cloud.windDrift(scratchDrift, windOctant, windSpeed);
        const dx = scratchDrift[0] * WIND_DRIFT_SCALE * frames;
        const dz = scratchDrift[2] * WIND_DRIFT_SCALE * frames;
        const dy = FALL_PER_FRAME * frames;

        for (const leaf of this.leaves) {
            if (!leaf.alive)
                continue;

            leaf.x += dx;
            leaf.z += dz;
            leaf.y -= dy;

            const s = flutterPhase(leaf.phaseFrames);
            leaf.drawX = leaf.x + leaf.swayX * s;
            leaf.drawZ = leaf.z + leaf.swayZ * s;
            leaf.drawY = leaf.y;
            leaf.phaseFrames = (leaf.phaseFrames + frames) % FLUTTER_PERIOD_FRAMES;
            leaf.tiltRadians = (TILT_DEGREES * s) * (Math.PI / 180);

            if (leaf.y <= leaf.groundY) {
                leaf.alive = false;
                if (leaf.anchorIndex >= 0 && leaf.anchorIndex < this.busy.length)
                    this.busy[leaf.anchorIndex] = false;
                leaf.anchorIndex = -1;
            }
        }
    }

    public update(windOctant: number, windSpeed: number, deltaSeconds: number, isGroupVisible: (group: LeafAnchorGroup) => boolean): void {
        const frames = deltaSeconds * Env.ROM_LOGIC_FPS;
        if (frames <= 0)
            return;

        this.spawnCounter += frames;
        while (this.spawnCounter >= SPAWN_INTERVAL_FRAMES) {
            this.spawnCounter -= SPAWN_INTERVAL_FRAMES;
            this.spawn(isGroupVisible);
        }

        this.tick(windOctant, windSpeed, frames);
    }
}

//#endregion
