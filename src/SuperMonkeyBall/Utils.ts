import { mat4, vec3, vec4 } from "gl-matrix";
import { clamp } from "../MathHelpers";

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
