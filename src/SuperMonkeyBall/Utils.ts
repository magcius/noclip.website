import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { clamp, transformVec3Mat4w0, Vec3UnitX } from "../MathHelpers";

export const S16_TO_RADIANS = Math.PI / 0x8000;
export const EPSILON = 1.1920928955078125e-7;
export const MKB_FPS = 60;

const SPIN_IN_FRAMES = 120; // Stage animations begin 2s before stage timer starts

/* Monkey Ball's concept of time in one place */
export class MkbTime {
    // Current animation time in frames@60fps, starting from zero
    private animTimeFrames: number = 0;
    private animTimeSeconds: number = 0;
    // Delta time in 60fps frames from last render frame
    private deltaTimeFrames: number = 0;
    // Time in frames remaining on the level's clock (aka what would be displayed on the goal)
    private stageTimeFrames: number = 0;
    // Time limit for beating the stage in frames (all stages are either 60 or 30)
    private stageTimeLimitFrames: number = 0;
    // Set when a goal is activated
    private stageTimeFrozen: boolean = false;

    constructor(stageTimeLimitSeconds: number) {
        this.stageTimeLimitFrames = stageTimeLimitSeconds * MKB_FPS;
    }

    public updateDeltaTimeSeconds(deltaSeconds: number): void {
        this.deltaTimeFrames = deltaSeconds * MKB_FPS;
        this.animTimeFrames += this.deltaTimeFrames;
        this.animTimeSeconds = this.animTimeFrames / MKB_FPS;
        if (!this.stageTimeFrozen) {
            this.stageTimeFrames = clamp(
                this.stageTimeLimitFrames - this.animTimeFrames + SPIN_IN_FRAMES,
                0,
                this.stageTimeLimitFrames
            );
        }
    }

    public getAnimTimeFrames(): number {
        return this.animTimeFrames;
    }

    public getAnimTimeSeconds(): number {
        return this.animTimeSeconds;
    }

    public getDeltaTimeFrames(): number {
        return this.deltaTimeFrames;
    }

    public getStageTimeFrames(): number {
        return this.stageTimeFrames;
    }

    public freezeStageTime(): void {
        this.stageTimeFrozen = true;
    }
}

export type Sphere = {
    center: vec3;
    radius: number;
}

export function parseVec3f(view: DataView, offset: number): vec3 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    const z = view.getFloat32(offset + 0x8);
    return vec3.fromValues(x, y, z);
}

export function parseVec2f(view: DataView, offset: number): vec2 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    return vec2.fromValues(x, y);
}

const scratchVec3a = vec3.create();
export function getMat4RotY(mtx: mat4): number {
    const res = scratchVec3a;
    transformVec3Mat4w0(res, mtx, Vec3UnitX);
    res[1] = 0;
    vec3.normalize(res, res);
    return Math.atan2(-res[2], res[0]);
}
