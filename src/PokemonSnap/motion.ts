import * as MIPS from "./mips";
import { ObjectField, Path, findGroundHeight, findGroundPlane, CollisionTree, computePlaneHeight, DataMap, StateFuncs, EndCondition, GeneralFuncs } from "./room";
import { bitsAsFloat32, angleDist, clampRange, clamp, Vec3Zero } from "../MathHelpers";
import { vec3, mat4 } from "gl-matrix";
import { getPathPoint, getPathTangent } from "./animation";
import { hexzero, assert, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { LevelGlobals } from "./actor";

const enum MotionFuncs {
    PathPoint       = 0x01FCA4,
    NodePos         = 0x0A5E98,
    FindGround      = 0x0E41D8,

    RiseBy          = 0x360300,
    RiseTo          = 0x36044C,
    FallBy          = 0x360590,
    FallTo          = 0x3606E8,
    Projectile      = 0x360AB8,
    MoveForward     = 0x360F1C,
    RandomCircle    = 0x361110,
    GetSong         = 0x361440,
    FaceTarget      = 0x36148C,
    WalkToTarget    = 0x361748,
    WalkToTarget2   = 0x36194C,     // functionally identical
    SetTarget       = 0x361B50,
    StepToPoint     = 0x361B68,
    ApproachPoint   = 0x361E58,
    ResetPos        = 0x362050,
    Path            = 0x3620C8,
    WaterSplash     = 0x35E174,
    SplashOnImpact  = 0x35E298,
}

export class MotionData {
    public stateFlags: number;

    public currMotion: Motion[] = [];
    public currBlock: number;
    public storedValues = nArray(3, () => 0);

    public pathParam: number;
    public start = -1;
    public auxStart = -1;
    public startPos = vec3.create();
    public movingYaw: number;
    public ySpeed: number;

    public refPosition = vec3.create();
    public storedPos = vec3.create();
    public ignoreGround: boolean;
    public groundType = 0;
    public groundHeight = 0;

    public path?: Path;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.stateFlags = 0;

        this.currMotion = [];
        this.currBlock = 0;

        this.pathParam = 0;
        this.start = -1;
        this.auxStart = -1;
        vec3.copy(this.startPos, Vec3Zero);
        this.movingYaw = 0;
        this.ySpeed = 0;
        this.ignoreGround = false;
        vec3.copy(this.refPosition, Vec3Zero);
        vec3.copy(this.storedPos, Vec3Zero);
    }
}

const enum PathStart {
    Begin,
    Random,
    Resume,
    SkipFirst,
    FirstSegment,
    StoredSegment,
}

interface StoredValue {
    index: number;
}

type ObjParam = number | StoredValue;

function lookupValue(data: MotionData, param: ObjParam): number {
    if (typeof param === "number")
        return param;
    else
        return data.storedValues[param.index];
}

export interface FollowPath {
    kind: "path";
    speed: ObjParam;
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
    forwardSpeed: number;
    radius: number;
    maxTurn: number;
    flags: number;
}

interface Vertical {
    kind: "vertical";
    target: ObjParam;
    asDelta: boolean;
    forwardSpeed: number;
    startSpeed: number;
    g: number;
    minVel: number;
    maxVel: number;
    direction: number;
}

interface RandomCircle {
    kind: "random";
    forwardSpeed: number;
    radius: number;
    maxTurn: number;
}

const enum Direction {
    Forward,
    Backward,
    Constant,
    Impact,
}

interface Projectile {
    kind: "projectile";
    ySpeed: number;
    forwardSpeed: number;
    direction: Direction;
    yaw: number; // only used if direction is constant
    g: number;
    moveForward: boolean;
}

interface Animation {
    kind: "animation";
    index: number;
    force: boolean;
}

interface Linear {
    kind: "linear";
    duration: number;
    velocity: vec3;
    turnSpeed: number;
}

export const enum BasicMotionKind {
    Placeholder,
    Wait,
    Song,
}

interface BasicMotion {
    kind: "basic";
    subtype: BasicMotionKind;
    param: number;
}

export type Motion = BasicMotion | FollowPath | FaceTarget | RandomCircle | WalkToTarget | Projectile | Animation | Vertical | Linear;

export class MotionParser extends MIPS.NaiveInterpreter {
    public blocks: Motion[] = [];
    private dataMap: DataMap;
    private animations: number[];
    private timer = 0;
    private forwardSpeed = 0;
    private ySpeed = 0;
    private yawDirection = Direction.Forward;
    private movingYaw = 0;
    private positionOffset = vec3.create();
    private yawOffset = 0;

    public reset(): void {
        super.reset();
        this.blocks = [];
        this.timer = 0;
        this.forwardSpeed = 0;
        this.ySpeed = 0;
        this.movingYaw = 0;
        vec3.copy(this.positionOffset, Vec3Zero);
        this.yawOffset = 0;
    }

    public parse(dataMap: DataMap, startAddress: number, animations: number[]): boolean {
        this.dataMap = dataMap;
        this.animations = animations;
        return super.parseFromView(dataMap.getView(startAddress));
    }

    private getFloatValue(reg: MIPS.Register): number {
        let value = 0;
        if (reg.value > 0x80000000 && reg.value < 0x80400000)
            value = bitsAsFloat32(this.dataMap.deref(reg.value));
        else
            value = bitsAsFloat32(reg.value);
        assert((value === 0 || Math.abs(value) > 1e-6) && Math.abs(value) < 1e6, `bad float value ${hexzero(reg.value, 8)}}`);
        return value;
    }

    private getFloatParam(reg: MIPS.Register): ObjParam {
        if (reg.value < 0x100) {
            const index = (reg.value - ObjectField.StoredValues) >>> 2;
            if (index >= 3) {
                console.warn("bad stored value index", index);
                return { index: 0 };
            }
            return { index };
        } else
            return this.getFloatValue(reg);
    }

    protected handleFunction(func: number, a0: MIPS.Register, a1: MIPS.Register, a2: MIPS.Register, a3: MIPS.Register, stackArgs: (MIPS.Register | null)[], branch: MIPS.BranchInfo | null): number {
        switch (func) {
            case MotionFuncs.ResetPos:
                break;
            case StateFuncs.ForceAnimation:
            case StateFuncs.SetAnimation: {
                const force = func === StateFuncs.ForceAnimation;
                if (a1.lastOp !== MIPS.Opcode.ADDIU || a1.value < 0x80000000) {
                    this.valid = false;
                    console.warn("bad animation address in motion", hexzero(a1.value, 8));
                    break;
                }
                let index = this.animations.findIndex((a) => a == a1.value);
                if (index === -1) {
                    index = this.animations.length;
                    this.animations.push(a1.value);
                }
                this.blocks.push({ kind: "animation", index, force });
            } break;
            case MotionFuncs.Path: {
                let start = PathStart.Begin;
                if (a1.lastOp === MIPS.Opcode.LW) {
                    if (a1.value === ObjectField.PathParam)
                        start = PathStart.Resume;
                    else if (a1.value === 4)
                        start = PathStart.SkipFirst;
                    else if (a1.value === 0)
                        start = PathStart.StoredSegment;
                    else
                        console.warn("unknown path start", a1.value);
                } else if (a1.lastOp === MIPS.Opcode.JAL)
                    start = PathStart.Random;
                else if ((a1.lastOp !== MIPS.Opcode.MFC1 && a1.lastOp !== MIPS.Opcode.ADDIU && a1.lastOp !== MIPS.Opcode.NOP) || a1.value !== 0)
                    console.warn("unknown path start", a1.lastOp, a1.value);

                let end: ObjParam = 0;
                if (a2.lastOp === MIPS.Opcode.LW && a2.value === 4)
                    start = PathStart.FirstSegment;
                else if (start !== PathStart.StoredSegment)
                    end = this.getFloatValue(a2);
                this.blocks.push({
                    kind: "path",
                    start,
                    end,
                    speed: this.getFloatParam(a3),
                    maxTurn: this.getFloatValue(stackArgs[0]!),
                    flags: stackArgs[1]!.value,
                });
            } break;
            case MotionFuncs.Projectile: {
                this.blocks.push({
                    kind: "projectile",
                    g: this.getFloatValue(a1),
                    moveForward: a2.value === 1,
                    ySpeed: this.ySpeed,
                    forwardSpeed: this.forwardSpeed,
                    direction: this.yawDirection,
                    yaw: this.movingYaw,
                });
            } break;
            case MotionFuncs.RiseBy:
            case MotionFuncs.RiseTo:
            case MotionFuncs.FallBy:
            case MotionFuncs.FallTo: {
                const asDelta = (func === MotionFuncs.RiseBy || func === MotionFuncs.FallBy);
                const direction = func === MotionFuncs.FallBy || func === MotionFuncs.FallTo ? -1 : 1;
                this.blocks.push({
                    kind: "vertical",
                    asDelta,
                    startSpeed: this.ySpeed,
                    forwardSpeed: this.forwardSpeed,
                    target: this.getFloatParam(a1),
                    g: this.getFloatValue(a2),
                    minVel: this.getFloatValue(a3),
                    maxVel: this.getFloatValue(stackArgs[0]!),
                    direction,
                });
            } break;
            case MotionFuncs.RandomCircle: {
                this.blocks.push({
                    kind: "random",
                    forwardSpeed: this.forwardSpeed,
                    radius: this.getFloatValue(a1),
                    maxTurn: this.getFloatValue(a2),
                });
            } break;
            case MotionFuncs.WalkToTarget:
            case MotionFuncs.WalkToTarget2: {
                this.blocks.push({
                    kind: "walkToTarget",
                    forwardSpeed: this.forwardSpeed,
                    radius: this.getFloatValue(a1),
                    maxTurn: this.getFloatValue(a2),
                    flags: a3.value | MoveFlags.Ground,
                });
            } break;
            case MotionFuncs.FaceTarget: {
                this.blocks.push({
                    kind: "faceTarget",
                    maxTurn: this.getFloatValue(a1),
                    flags: a2.value,
                });
            } break;
            case MotionFuncs.GetSong: {
                this.blocks.push({
                    kind: "basic",
                    subtype: BasicMotionKind.Song,
                    param: 0,
                });
            } break;
            case StateFuncs.InteractWait: {
                assert(a1.value === EndCondition.Timer && this.timer > 0);
                this.blocks.push({
                    kind: "basic",
                    subtype: BasicMotionKind.Wait,
                    param: this.timer,
                });
                this.timer = 0;
            } break;
            case GeneralFuncs.Yield: {
                // same idea as in StateParser
                if (a0.value > 1) {
                    this.blocks.push({
                        kind: "basic",
                        subtype: BasicMotionKind.Wait,
                        param: a0.value / 30,
                    });
                }
            } break;
        }
        return 0;
    }

    protected handleStore(op: MIPS.Opcode, value: MIPS.Register, target: MIPS.Register, offset: number): void {
        if (op === MIPS.Opcode.SW || op === MIPS.Opcode.SWC1) {
            // same condition as StateParser, looks like loading a struct field
            switch (offset) {
                case 0x4:
                case 0x8:
                case 0xC: {
                    if ((value.lastOp !== MIPS.Opcode.ADDS && value.lastOp !== MIPS.Opcode.SUBS) || value.value < 0x100)
                        break;
                    let delta = this.getFloatValue(value);
                    if (value.lastOp === MIPS.Opcode.SUBS)
                        delta *= -1;
                    if (target.lastOp === MIPS.Opcode.ADDIU && target.value === 4)
                        this.positionOffset[(offset - 4) >>> 2] = delta;
                    else if (target.lastOp === MIPS.Opcode.ADDIU && target.value === 0x14) {
                        assert(offset === 0xC);
                        this.yawOffset = delta;
                    }
                } break;
                case ObjectField.TranslationX:
                case ObjectField.TranslationY:
                case ObjectField.TranslationZ: {
                    if (op !== MIPS.Opcode.SWC1 || target.lastOp !== MIPS.Opcode.LW || target.value !== 0x48 )
                        break;
                    if (!(value.lastOp === MIPS.Opcode.ADDS || value.lastOp === MIPS.Opcode.SUBS) || value.value < 0x100)
                        break;
                    let delta = this.getFloatValue(value);
                    if (value.lastOp === MIPS.Opcode.SUBS)
                        delta *= -1;
                    this.positionOffset[(offset - ObjectField.TranslationX) >> 2] = delta;
                } break;
                case ObjectField.Timer: {
                    assert(op === MIPS.Opcode.SW && value.lastOp === MIPS.Opcode.ADDIU);
                    this.timer = value.value / 30;
                } break;
                case ObjectField.ForwardSpeed: {
                    assert(op === MIPS.Opcode.SWC1);
                    this.forwardSpeed = this.getFloatValue(value);
                } break;
                case ObjectField.VerticalSpeed: {
                    assert(op === MIPS.Opcode.SWC1);
                    this.ySpeed = this.getFloatValue(value);
                } break;
                case ObjectField.MovingYaw: {
                    if (value.lastOp === MIPS.Opcode.JAL)
                        this.yawDirection = Direction.Impact; // assume this is from an atan2
                    else if (value.lastOp === MIPS.Opcode.ADDS) {
                        this.yawDirection = Direction.Backward;
                    } else if ((value.lastOp === MIPS.Opcode.LWC1 && value.value > 0x80000000) || value.lastOp === MIPS.Opcode.NOP) {
                        this.yawDirection = Direction.Constant;
                        this.movingYaw = this.getFloatValue(value);
                    }
                } break;
            }
        }
    }

    protected handleLoop(op: MIPS.Opcode, left: MIPS.Register, right: MIPS.Register, offset: number): void {
        let frames = 0;
        if (!(op === MIPS.Opcode.BNE || op === MIPS.Opcode.BNEL) ||
            !(left.lastOp === MIPS.Opcode.ADDIU || left.lastOp === MIPS.Opcode.NOP) ||
            !(right.lastOp === MIPS.Opcode.ADDIU || right.lastOp === MIPS.Opcode.NOP)
        )
            return; // doesn't look like a for loop
        if (left.value > 15 && right.value === 0)
            frames = left.value + 1;
        else if (left.value === 1 && right.value > 15)
            frames = right.value;
        const velocity = vec3.clone(this.positionOffset);
        vec3.scale(velocity, velocity, 30);
        this.blocks.push({
            kind: "linear",
            duration: frames / 30,
            velocity,
            turnSpeed: this.yawOffset * 30,
        });
    }

    protected finish(): void {
        // if we couldn't understand the function, add a placeholder 5 second wait
        if (this.blocks.length === 0)
            this.blocks.push({
                kind: "basic",
                subtype: BasicMotionKind.Placeholder,
                param: 5,
            });
    }
}

const enum MoveFlags {
    Ground      = 0x01,
    SnapTurn    = 0x02,
    ConstHeight = 0x10,
    SmoothTurn  = 0x80,
}

export interface Target {
    translation: vec3;
}

const blockScratch = vec3.create();
export function motionBlockInit(data: MotionData, pos: vec3, euler: vec3, viewerInput: ViewerRenderInput, target: Target | null): MotionResult {
    data.start = viewerInput.time;
    vec3.copy(data.startPos, pos);
    const block: Motion = data.currMotion[data.currBlock];
    switch (block.kind) {
        case "path": {
            switch (block.start) {
                case PathStart.Resume:
                    break; // do nothing
                case PathStart.Begin:
                case PathStart.FirstSegment:
                    data.pathParam = 0; break;
                case PathStart.Random:
                    data.pathParam = Math.random(); break;
                case PathStart.SkipFirst:
                    data.pathParam = data.path!.times[1]; break;
                case PathStart.StoredSegment:
                    data.pathParam = data.path!.times[data.storedValues[0]]; break;
            }
        } break;
        case "projectile": {
            switch (block.direction) {
                case Direction.Forward:
                    break;
                case Direction.Backward:
                    data.movingYaw = euler[1] + Math.PI; break;
                case Direction.Constant: {
                    data.movingYaw = block.yaw;
                    euler[1] = block.yaw;
                } break;
                case Direction.Impact: {
                    // move directly away from camera position at time of impact
                    mat4.getTranslation(blockScratch, viewerInput.camera.worldMatrix);
                    vec3.sub(blockScratch, pos, blockScratch);
                    data.movingYaw = Math.atan2(blockScratch[0], blockScratch[2]);
                } break;
            }
        } break;
        case "vertical": {
            data.ySpeed = block.startSpeed;
        } break;
        case "random": {
            const centerAngle = euler[1] + Math.PI * (1 + 2 / 3 * Math.floor(Math.random() * 3));
            data.refPosition[0] = pos[0] + block.radius * Math.sin(centerAngle);
            data.refPosition[2] = pos[2] + block.radius * Math.cos(centerAngle);
            data.movingYaw = centerAngle - Math.PI;
        } break;
        case "walkToTarget": {
            if (target === null)
                return MotionResult.Done;
            vec3.copy(data.refPosition, target.translation);
        } break;
        case "faceTarget": {
            if (block.flags & 0x20)
                mat4.getTranslation(data.refPosition, viewerInput.camera.worldMatrix);
            else if (target !== null)
                vec3.copy(data.refPosition, target.translation);
            else
                return MotionResult.Done;
        } break;
    }
    return MotionResult.None;
}

const moveScratch = vec3.create();
// attempt to apply the given displacement, returning whether motion was blocked
function attemptMove(pos: vec3, end: vec3, data: MotionData, globals: LevelGlobals, flags: number): boolean {
    if (!data.ignoreGround && !groundOkay(globals.collision, end[0], end[2]))
        return true;
    vec3.sub(moveScratch, end, pos);
    vec3.normalize(moveScratch, moveScratch); // then multiplies by some scale factor?
    // vec3.scale(moveScratch, moveScratch, 1)
    if (!data.ignoreGround && !groundOkay(globals.collision, pos[0] + moveScratch[0], pos[2] + moveScratch[2]))
        return true;

    const ground = findGroundPlane(globals.collision, end[0], end[2]);
    if (ground !== null)
        data.groundType = ground.type;
    else
        data.groundType = -1;
    data.groundHeight = computePlaneHeight(ground, end[0], end[2]);

    if (flags & MoveFlags.ConstHeight && pos[1] !== data.groundHeight)
        return true;
    pos[0] = end[0];
    pos[2] = end[2];
    if (flags & MoveFlags.Ground)
        pos[1] = data.groundHeight;
    return false;
}

function groundOkay(collision: CollisionTree | null, x: number, z: number): boolean {
    const ground = findGroundPlane(collision, x, z);
    if (ground === null)
        return true; // not being over ground is fine
    switch (ground.type) {
        case 0x7F66:
        case 0xFF00:
        case 0x337FB2:
        case 0x4CCCCC:
        case 0x7F6633:
        case 0x7F667F:
        case 0xFF0000:
        case 0xFF4C19:
        case 0xFF7FB2:
            return false;
    }
    return true;
}

export const enum MotionResult {
    None,
    Update,
    Done,
}

export function canHearSong(pos: vec3, globals: LevelGlobals): boolean {
    if (globals.currentSong === 0)
        return false;
    return vec3.dist(pos, globals.translation) < 2500; // game radius is 1400 for song effects
}

function stepYawTowards(euler: vec3, target: number, maxTurn: number, dt: number): boolean {
    const dist = angleDist(euler[1], target);
    euler[1] += clampRange(dist, maxTurn * dt * 30);
    return Math.abs(dist) < maxTurn * dt * 30;
}

const tangentScratch = vec3.create();
const posScratch = vec3.create();
export function followPath(pos: vec3, euler: vec3, data: MotionData, block: FollowPath, dt: number, globals: LevelGlobals): MotionResult {
    if (!!(data.stateFlags & EndCondition.Pause) || !data.path)
        return MotionResult.None;
    data.pathParam += 30 * lookupValue(data, block.speed) * dt / data.path.duration;
    let end = block.end;
    if (block.start === PathStart.StoredSegment)
        end = data.path.times[data.storedValues[1]];
    else if (block.start === PathStart.FirstSegment)
        end = data.path.times[1];
    if (end > 0 && data.pathParam > end)
        return MotionResult.Done;
    data.pathParam = data.pathParam % 1;
    const oldY = pos[1];
    getPathPoint(pos, data.path, data.pathParam);
    vec3.scale(pos, pos, 100);
    if (block.flags & MoveFlags.ConstHeight)
        pos[1] = oldY;
    else if (block.flags & MoveFlags.Ground)
        pos[1] = findGroundHeight(globals.collision, pos[0], pos[2]);
    if (block.flags & (MoveFlags.SmoothTurn | MoveFlags.SnapTurn)) {
        getPathTangent(tangentScratch, data.path, data.pathParam);
        const yaw = Math.atan2(tangentScratch[0], tangentScratch[2]);
        if (block.flags & MoveFlags.SnapTurn)
            euler[1] = yaw;
        else
            stepYawTowards(euler, yaw, block.maxTurn, dt);
    }
    return MotionResult.Update;
}

export function projectile(pos: vec3, data: MotionData, block: Projectile, t: number, globals: LevelGlobals): MotionResult {
    t = (t - data.start) / 1000;
    vec3.set(tangentScratch,
        Math.sin(data.movingYaw) * block.forwardSpeed,
        block.ySpeed,
        Math.cos(data.movingYaw) * block.forwardSpeed,
    );
    vec3.scaleAndAdd(posScratch, data.startPos, tangentScratch, t);
    posScratch[1] += block.g * t * t * 15; // g is actually given in m/s/frame
    if (block.moveForward)
        attemptMove(pos, posScratch, data, globals, 0);
    pos[1] = posScratch[1];
    if (30 * t * block.g + block.ySpeed < 0 && pos[1] < data.groundHeight) {
        pos[1] = data.groundHeight;
        return MotionResult.Done;
    }
    return MotionResult.Update;
}

export function vertical(pos: vec3, euler: vec3, data: MotionData, block: Vertical, dt: number): MotionResult {
    if (data.stateFlags & EndCondition.Pause)
        return MotionResult.None;
    pos[0] += Math.sin(euler[1]) * block.forwardSpeed * dt;
    pos[1] += data.ySpeed * dt * block.direction;
    pos[2] += Math.cos(euler[1]) * block.forwardSpeed * dt;
    if (block.g !== 0) {
        data.ySpeed += 30 * block.g * dt; // always increase, this is speed
        data.ySpeed = clamp(data.ySpeed, block.minVel, block.maxVel);
    }
    const target = lookupValue(data, block.target);
    if ((block.asDelta && Math.abs(data.startPos[1] - pos[1]) >= target) ||
        (!block.asDelta && pos[1] > target === block.direction > 0) // above target if rising, below if falling
    )
        return MotionResult.Done;
    return MotionResult.Update;
}

export function randomCircle(pos: vec3, euler: vec3, data: MotionData, block: RandomCircle, dt: number, globals: LevelGlobals): MotionResult {
    data.movingYaw += dt * block.forwardSpeed / block.radius;
    posScratch[0] = data.refPosition[0] + block.radius * Math.sin(data.movingYaw);
    posScratch[2] = data.refPosition[2] + block.radius * Math.cos(data.movingYaw);
    if (attemptMove(pos, posScratch, data, globals, MoveFlags.Ground))
        return MotionResult.Done;
    stepYawTowards(euler, data.movingYaw + Math.PI / 2, block.maxTurn, dt);
    return MotionResult.Update;
}

export function linear(pos: vec3, euler: vec3, data: MotionData, block: Linear, dt: number, t: number): MotionResult {
    vec3.scaleAndAdd(pos, pos, block.velocity, dt);
    euler[1] += block.turnSpeed * dt;
    if ((t - data.start) / 1000 >= block.duration)
        return MotionResult.Done;
    return MotionResult.Update;
}

export function walkToTarget(pos: vec3, euler: vec3, data: MotionData, block: WalkToTarget, target: Target | null, dt: number, globals: LevelGlobals): MotionResult {
    if (block.flags & 2) {
        if (target === null)
            return MotionResult.Done;
        vec3.copy(data.refPosition, target.translation);
    }
    const yawToTarget = Math.atan2(data.refPosition[0] - pos[0], data.refPosition[2] - pos[2]);
    vec3.copy(posScratch, pos);
    posScratch[0] += block.forwardSpeed * dt * Math.sin(yawToTarget);
    posScratch[2] += block.forwardSpeed * dt * Math.cos(yawToTarget);
    if (attemptMove(pos, posScratch, data, globals, block.flags))
        return MotionResult.Done;
    stepYawTowards(euler, yawToTarget, block.maxTurn, dt);
    if (vec3.dist(data.refPosition, pos) < block.radius) {
        data.stateFlags |= EndCondition.Target;
        return MotionResult.Done;
    }
    return MotionResult.Update;
}

export function faceTarget(pos: vec3, euler: vec3, data: MotionData, block: FaceTarget, target: Target | null, dt: number, globals: LevelGlobals): MotionResult {
    if (block.flags & 2) {
        if (block.flags & 0x20)
            vec3.copy(data.refPosition, globals.translation);
        else if (target === null)
            return MotionResult.Done;
        else
            vec3.copy(data.refPosition, target.translation);
    }
    if ((block.flags & 4) && !canHearSong(pos, globals))
        return MotionResult.Done;
    let targetYaw = Math.atan2(data.refPosition[0] - pos[0], data.refPosition[2] - pos[2]);
    if (block.flags & 0x40)
        targetYaw += Math.PI;
    if (stepYawTowards(euler, targetYaw, block.maxTurn, dt) && !(block.flags & 8))
        return MotionResult.Done;
    return MotionResult.Update;
}