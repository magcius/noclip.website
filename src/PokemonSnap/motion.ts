import * as MIPS from "./mips";
import { ObjectField, Path, findGroundHeight } from "./room";
import { bitsAsFloat32, angleDist, clampRange } from "../MathHelpers";
import { vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../viewer";
import { LevelGlobals } from "./render";
import { getPathPoint, getPathTangent } from "./animation";

const enum MotionFuncs {
    PathPoint       = 0x01FCA4,
    NodePos         = 0x0A5E98,
    FindGround      = 0x0E41D8,

    Jump            = 0x360300,
    Projectile      = 0x360AB8,
    MoveForward     = 0x360F1C,
    RandomCircle    = 0x361110,
    GetSong         = 0x361440,
    FaceTarget      = 0x36148C,
    WalkToTarget    = 0x361748,
    WalkToTarget2   = 0x36194C,     // functionally identical
    SetTarget       = 0x361B50,
    StepToTarget    = 0x361B68,
    ApproachTarget  = 0x361E58,
    ResetPos        = 0x362050,
    Path            = 0x3620C8,
    WaterSplash     = 0x35E174,
    SplashOnImpact  = 0x35E298,
}

export interface MotionData {
    refPosition: vec3;
    pathParam: number;
    paused: boolean;
    done: boolean;
    currMotion: Motion[];
    currBlock: number;
    allowWater: boolean;
    start: number;

    path?: Path;
}

const enum PathStart {
    Begin,
    Random,
    Resume,
    Unknown,
}

interface FollowPath {
    kind: "path";
    speed: number;
    start: PathStart;
    end: number;
    maxTurn: number;
    flags: number;
}

interface FaceTarget {
    kind: "faceTarget";
    maxTurn: number;
    flags: number;
}

interface WalkToTarget {
    kind: "walkToTarget";
    speed: number;
    radius: number;
    maxTurn: number;
    flags: number;
}

interface Jump {
    kind: "jump";
    height: number;
    minVel: number;
    maxVel: number;
    g: number;
}

interface RandomCircle {
    kind: "random";
    radius: number;
    step: number;
    flags: number;
}

interface Projectile {
    kind: "projectile";
    g: number;
    moveForward: boolean;
}

const enum BasicMotionKind {
    Placeholder,
}

interface BasicMotion {
    kind: "basic";
    subtype: BasicMotionKind;
    param: number;
}

export type Motion = BasicMotion | FollowPath | FaceTarget | WalkToTarget | Jump;

export class MotionParser extends MIPS.NaiveInterpreter {
    public blocks: Motion[] = [];

    public reset(): void {
        super.reset();
        this.blocks = [];
    }

    protected handleFunction(func: number, a0: MIPS.Register, a1: MIPS.Register, a2: MIPS.Register, a3: MIPS.Register, stackArgs: (MIPS.Register | null)[], branch: MIPS.BranchInfo | null): number {
        switch (func) {
            case MotionFuncs.ResetPos:
                break;
            case MotionFuncs.Path: {
                let start = PathStart.Begin;
                if (a1.lastOp === MIPS.Opcode.LW && a1.value === ObjectField.PathParam)
                    start = PathStart.Resume;
                else if (a1.lastOp === MIPS.Opcode.JAL)
                    start = PathStart.Random;
                else if ((a1.lastOp !== MIPS.Opcode.MFC1 && a1.lastOp !== MIPS.Opcode.ADDIU) || a1.value !== 0) {
                    console.warn("unknown path start", a1.lastOp, a1.value);
                    start = PathStart.Unknown;
                }

                this.blocks.push({
                    kind: "path",
                    start,
                    end: bitsAsFloat32(a2.value),
                    speed: 30 * bitsAsFloat32(a3.value),
                    maxTurn: bitsAsFloat32(stackArgs[0]!.value),
                    flags: stackArgs[1]!.value,
                });
            } break;
        }
        return 0;
    }

    protected finish(): void {
        // if we couldn't understand the function, add a placeholder so the motion ends
        if (this.blocks.length === 0)
            this.blocks.push({
                kind: "basic",
                subtype: BasicMotionKind.Placeholder,
                param: 0,
            });
    }
}

const enum PathFlags {
    Ground      = 0x01,
    SnapTurn    = 0x02,
    ConstHeight = 0x10,
    SmoothTurn  = 0x80,
}

export function nextMotionBlock(data: MotionData): void {
    if (++data.currBlock >= data.currMotion.length)
        return;
    const block: Motion = data.currMotion[data.currBlock];
    data.start = -1;
    switch (block.kind) {
        case "path": {
            if (block.start === PathStart.Begin)
                data.pathParam = 0;
            else if (block.start === PathStart.Random)
                data.pathParam = Math.random();
        } break;
    }
}

const tangentScratch = vec3.create();
export function runMotion(pos: vec3, euler: vec3, scale: vec3, data: MotionData, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
    if (data.currMotion.length === 0)
        return false;
    if (data.start < 0)
        data.start = viewerInput.time;
    let updated = false;
    while (data.currBlock < data.currMotion.length) {
        const block: Motion = data.currMotion[data.currBlock];
        switch (block.kind) {
            case "path": {
                if (data.paused || !data.path)
                    return updated;
                data.pathParam += block.speed * viewerInput.deltaTime / 1000 / data.path.duration;
                if (block.end > 0 && data.pathParam > block.end) {
                    nextMotionBlock(data);
                    return updated;
                }
                data.pathParam = data.pathParam % 1;
                const oldY = pos[1];
                getPathPoint(pos, data.path, data.pathParam);
                vec3.scale(pos, pos, 100);
                if (block.flags & PathFlags.ConstHeight)
                    pos[1] = oldY;
                else if (block.flags & PathFlags.Ground)
                    pos[1] = findGroundHeight(globals.collision, pos[0], pos[2]);
                if (block.flags & (PathFlags.SmoothTurn | PathFlags.SnapTurn)) {
                    getPathTangent(tangentScratch, data.path, data.pathParam);
                    const yaw = Math.atan2(tangentScratch[0], tangentScratch[2]);
                    if (block.flags & PathFlags.SnapTurn)
                        euler[1] = yaw;
                    else
                        euler[1] += clampRange(angleDist(euler[1], yaw), block.maxTurn * viewerInput.deltaTime * 30);
                }
                return true;
            } break;
            case "basic": {
                switch (block.subtype) {
                    case BasicMotionKind.Placeholder:
                        if (viewerInput.time - data.start > 5000)
                            nextMotionBlock(data);
                        else
                            return false;
                }
            } break;

            default:
                return false;
        }
    }
    data.done = true;
    return updated;
}