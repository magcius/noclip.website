import * as BIN from "./bin.js";
import { Actor, ActorFlags } from "./actor.js";
import { BindingFlags, Emitter, EMITTER_DONE_TIMER, EmitterState, ParticleData, ParticleSystem } from "./particle.js";
import { ActorPartInstance, BufferPoolManager, FFXToNoclip, LevelPartInstance, ShadowRenderer, TextureData } from "./render.js";
import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { angleDist, clamp, getMatrixTranslation, MathConstants, normToLengthAndAdd, randomRange, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One } from "../MathHelpers.js";
import { assert, assertExists, hexzero, leftPad, nArray } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";
import { getPointBspline } from "../Spline.js";
import { SceneContext } from "../SceneBase.js";
import { ActorCategory, FFXFolder, FFXRenderer, loadActorFile, loadFile } from "./scenes.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import InputManager from "../InputManager.js";
import { GSMemoryMap } from "../Common/PS2/GS.js";

 enum Opcode {
    NOP                = 0x00,
    OR_LOGIC           = 0x01,
    AND_LOGIC          = 0x02,
    OR                 = 0x03,
    XOR                = 0x04,
    AND                = 0x05,
    EQ                 = 0x06,
    NEQ                = 0x07,
    LTU                = 0x08,
    GTU                = 0x09,
    LT                 = 0x0A,
    GT                 = 0x0B,
    LTEU               = 0x0C,
    GTEU               = 0x0D,
    LTE                = 0x0E,
    GTE                = 0x0F,
    BIT                = 0x10,
    NOT_BIT            = 0x11,
    SLL                = 0x12,
    SRA                = 0x13,
    ADD                = 0x14,
    SUB                = 0x15,
    MUL                = 0x16,
    DIV                = 0x17,
    MOD                = 0x18,
    NOT_LOGIC          = 0x19,
    NEG                = 0x1A,
    NOT                = 0x1C,
    NOP_1D             = 0x1D,
    NOP_1E             = 0x1E,
    GET_DATUM          = 0x1F,
    SET_DATUM_W        = 0x20,
    SET_DATUM_T        = 0x21,
    GET_DATUM_INDEX    = 0x22,
    SET_DATUM_INDEX_W  = 0x23,
    SET_DATUM_INDEX_T  = 0x24,
    SET_RETURN_VALUE   = 0x25,
    GET_RETURN_VALUE   = 0x26,
    GET_DATUM_DESC     = 0x27,
    GET_TEST           = 0x28,
    GET_CASE           = 0x29,
    SET_TEST           = 0x2A,
    COPY               = 0x2B,
    SET_CASE           = 0x2C,
    CONST_INT          = 0x2D,
    IMM                = 0x2E,
    CONST_FLOAT        = 0x2F,
    JUMP               = 0x30,
    BNEZ               = 0x31,
    BEZ                = 0x32,
    CALL               = 0x33,
    RETURN             = 0x34,
    FUNC_RET           = 0x35,
    SIG_NOACK          = 0x36,
    SIG_ONSTART        = 0x37,
    SIG_ONEND          = 0x38,
    SIG_NOACK_SPEC     = 0x39,
    SIG_1_SPEC         = 0x3A,
    SIG_2_SPEC         = 0x3B,
    END                = 0x3C,
    CLEANUP_END        = 0x3D,
    TO_MAIN            = 0x3E,
    CLEANUP_TO_MAIN    = 0x3F,
    DYNAMIC            = 0x40,
    SIGS_LOW           = 0x45,
    SIGS_HIGH          = 0x53,
    CLEANUP_ALL_END    = 0x54,
    SET_JUMP           = 0x55,
    SET_BNEZ           = 0x56,
    SET_BEZ            = 0x57,
    FUNC               = 0x58,
    SET_INT            = 0x59,
    SET_FLOAT          = 0x5D,
    GET_INT            = 0x67,
    GET_FLOAT          = 0x6B,
    TEX_UNPACK_IMM     = 0x75,
    NOP_76             = 0x76,
    WAIT_DELETE        = 0x77,
    WAIT_SPEC_DELETE   = 0x78,
    EDIT_ENTRY_TABLE   = 0x79,
    SET_EDGE_TRIGGER   = 0x7A,
}

function isSignal(op: Opcode): boolean {
    if (op >= Opcode.SIG_NOACK && op <= Opcode.SIG_ONEND)
        return true;
    return op >= Opcode.SIGS_LOW && op <= Opcode.SIGS_HIGH;
}

class Stack {
    private values = nArray(20, () => 0);
    private index = 0;

    public pop(): number {
        assert(this.index > 0);
        return this.values[--this.index];
    }

    public push(x: number): void {
        this.values[this.index++] = x;
    }

    public copy(): void {
        this.push(this.values[this.index - 1]);
    }

    public empty(): boolean {
        return this.index === 0;
    }
}

const enum RotationFlags {
    NONE          = 0,
    CONST         = 1,
    EASE          = 2,
    LERP          = 3,
    SMOOTH_STEP   = 4,
    CONST_FOREVER = 5,
    TYPE_MASK     = 0x1F,

    LINK_ALL      = 0x0020,
    MATCH_ROLL    = 0x0040,
    MATCH_PITCH   = 0x0080,
    NO_OVERWRITE  = 0x0100,
    ALT_OMEGA     = 0x0200,
    CLOCKWISE     = 0x0400,
    FIXED_DIR     = 0x0800,
    SET_VEL       = 0x1000,
    UPDATE_TARGET = 0x2000,
    GO_FOREVER    = 0x4000,
    REL_TO_PATH   = 0x8000,
}

function reduceAngle(x: number): number {
    x = x % MathConstants.TAU;
    if (x > Math.PI)
        x -= MathConstants.TAU;
    else if (x < -Math.PI)
        x += MathConstants.TAU;
    return x;
}

type direction = -1 | 0 | 1;

export function angleStep(angle: number, target: number, step: number, dir: direction): number {
    let result = angle;
    if (dir === 0) {
        const dist = angleDist(angle, target);
        if (Math.abs(dist) <= step)
            result = target;
        else if (dist > 0)
            result = angle + Math.abs(step);
        else
            result = angle - Math.abs(step);
    } else {
        // this is the game's logic, which can have issues with target angles close to +/- pi
        const product = (angle - target)*(angle + dir*step - target);
        if (product <= 0)
            result = target;
        else
            result = angle + dir*step;
    }

    return reduceAngle(result);
}

class RotationState {
    public flags: RotationFlags = RotationFlags.NONE;
    public alignFrames = 0;
    public alignRateTimeScale = 0;
    public t = 0;
    public duration = 0;
    public omega = vec3.create();
    public altOmega = 0;
    public target = vec3.create();
    public delta = vec3.create();
    public saved = vec3.create();

    public targetPos: ReadonlyVec3 | null = null;

    public init(flags: number): void {
        switch (flags & RotationFlags.TYPE_MASK) {
            case RotationFlags.EASE: {
                let range = this.delta[0] | 0;
                if ((flags & RotationFlags.FIXED_DIR) && range > 0)
                    range -= MathConstants.TAU;
                if ((flags & RotationFlags.CLOCKWISE) && range < 0)
                    range += MathConstants.TAU;
                this.t = 0;
                this.duration = Math.min(Math.abs(5/6*this.omega[0]/range), 1); // actually time step
            } break;
            case RotationFlags.CONST:
            case RotationFlags.CONST_FOREVER:
                if (this.duration !== 0)
                    this.duration = 1/this.duration;
        }

        this.flags = flags;
        this.alignFrames = 0;
    }

    public update(dt: number, pos: PosState, motion: MotionState): void {
        let alignMult = 1;
        if (this.alignRateTimeScale > 0) {
            this.alignFrames += dt;
            alignMult = clamp(this.alignFrames/this.alignRateTimeScale, 1, 8);
        }

        const wasAtTarget = this.target[0] === pos.miscVec[1];
        const type = this.flags & RotationFlags.TYPE_MASK;
        if (this.flags & RotationFlags.REL_TO_PATH) {
            if (this.flags & RotationFlags.UPDATE_TARGET) {
                if (this.targetPos !== null) {
                    vec3.sub(scratchVec, this.targetPos, pos.pos);
                    const sphere = toSpherical(scratchVec);
                    this.target[0] = sphere.azimuth;
                    this.target[1] = sphere.inclination;
                } else {
                    console.warn("rotation missing target position");
                }
            }
            vec3.sub(scratchVec, motion.endPos, pos.pos);
            const sphere = toSpherical(scratchVec);
            this.delta[0] += sphere.azimuth - this.target[0];
            this.delta[1] += sphere.inclination - this.target[1];
            this.delta[0] = reduceAngle(this.delta[0]);
            this.delta[1] = reduceAngle(this.delta[1]);

            if (type === RotationFlags.CONST || type === RotationFlags.CONST_FOREVER || type === RotationFlags.EASE) {
                this.target[0] = sphere.azimuth;
                this.target[1] = sphere.inclination;
            }
        }

        if (type === RotationFlags.SMOOTH_STEP || type === RotationFlags.LERP) {
            this.t += dt;
            const frac = clamp(this.t/this.duration, 0, 1);
            let curve = frac;
            if (type === RotationFlags.SMOOTH_STEP)
                curve = frac < .5 ? 2*frac ** 2 : 1 - 2*(1 - frac) ** 2;
            vec3.zero(scratchVec);
            if (this.flags & RotationFlags.FIXED_DIR) {
                for (let i = 0; i < 3; i++) {
                    if (this.delta[i] > 0)
                        scratchVec[i] = -MathConstants.TAU;
                    else if (this.delta[i] < 0 && (this.flags & RotationFlags.CLOCKWISE))
                        scratchVec[i] = MathConstants.TAU;
                }
            }
            vec3.add(scratchVec, this.delta, scratchVec);
            vec3.scaleAndAdd(scratchVec, this.target, scratchVec, 1 - curve);
            // different angle ordering
            pos.miscVec[0] = scratchVec[1];
            pos.miscVec[1] = scratchVec[0];
            pos.miscVec[2] = scratchVec[2];
        } else if (type !== RotationFlags.NONE) {
            let extraMult = 1;
            if (type === RotationFlags.EASE) {
                this.t += this.duration*dt;
                if (this.t > 1 && wasAtTarget)
                    this.flags = (this.flags & ~RotationFlags.TYPE_MASK) | RotationFlags.CONST;
                this.t = clamp(this.t, 0, 1);
                extraMult = 1 - 2.4*(this.t - 0.5) ** 2; // parabola ranging from .4 to 1
            }
            if (this.flags & RotationFlags.REL_TO_PATH) {
                let dir: direction = 0;
                if (this.flags & RotationFlags.FIXED_DIR) {
                    dir = this.flags & RotationFlags.CLOCKWISE ? -1 : 1;
                }
                const velFactor = dt*extraMult*alignMult;
                const yawVel = this.flags & RotationFlags.ALT_OMEGA ? this.altOmega : this.omega[0];
                pos.miscVec[1] = angleStep(pos.miscVec[1], this.target[0], yawVel*velFactor, dir);
                pos.miscVec[0] = angleStep(pos.miscVec[0], this.target[1], this.omega[1]*velFactor, dir);
            } else {
                vec3.scale(scratchVec, this.omega, dt);
                pos.miscVec[0] += scratchVec[1];
                pos.miscVec[1] += scratchVec[0];
                pos.miscVec[2] += scratchVec[2];
            }
        }

        if (this.flags & RotationFlags.SET_VEL) {
            pos.velPitch = pos.miscVec[0];
            pos.velYaw = pos.miscVec[1];
        }
    }

    public isDone(angles: ReadonlyVec3): boolean {
        if (this.flags & RotationFlags.GO_FOREVER)
            return false;
        const type = this.flags & RotationFlags.TYPE_MASK;
        if (type === RotationFlags.LERP || type === RotationFlags.SMOOTH_STEP) {
            if (this.t > this.duration)
                return true;
        } else if (type === RotationFlags.CONST_FOREVER)
            return false;

        if (angles[1] !== this.target[0])
            return false;
        if ((this.flags & RotationFlags.MATCH_PITCH) && angles[0] !== this.target[1])
            return false;
        if ((this.flags & RotationFlags.MATCH_ROLL) && angles[2] !== this.target[2])
            return false;
        return true;
    }
}

const enum MotionFlags {
    NONE            = 0,
    TARGET_HORIZ    = 1,
    TARGET          = 2,
    ACCEL_HORIZ     = 3,
    ACCEL           = 4,
    SPLINE_THREE    = 5,
    SPLINE_FOUR     = 6,
    LERP            = 7,
    PROJECTILE      = 9, // 8 unused???

    LINK_ALL        = 0x20,
    TYPE_MASK       = 0x7F,

    NO_OVERWRITE    = 0x0100,
    INSTANT_TURN    = 0x0200,
    MATCH_HEIGHT    = 0x0400,
    FINAL_UPDATE    = 0x0800,
    REACHED_TARGET  = 0x1000,
    UPDATE_TARGET   = 0x2000,
    STOP_ROTATION   = 0x4000,
    ALIGN_TO_PATH   = 0x8000,
}

const moveScratch = vec3.create();
interface SphereCoords {
    r: number;
    inclination: number;
    azimuth: number;
}
const sphereScratch: SphereCoords = {
    r: 0,
    inclination: 0,
    azimuth: 0,
}

function toSpherical(src: ReadonlyVec3): SphereCoords {
    sphereScratch.azimuth = Math.atan2(src[2], src[0]);
    sphereScratch.inclination = Math.atan2(src[1], Math.hypot(src[0], src[2]));
    sphereScratch.r = vec3.len(src);
    return sphereScratch
}

class MotionState {
    public targetIndex = -1;
    public flags: MotionFlags = MotionFlags.NONE;
    public turnFrames = 0;
    public turnRateTimeScale = 1;
    public t = 0;
    public duration = 0;
    public dataStart = -1;
    public startSpeed = 0;
    public startYVel = 0;
    public startPos = vec3.create();
    public endPos = vec3.create();
    public g = 0;
    public posThreshold = 0;
    public yawStep = 0;
    public pitchStep = 0;

    public targetPos: ReadonlyVec3 | null = null;

    public reset(pos: ReadonlyVec3): void {
        this.t = 0;
        this.duration = 0;
        this.targetIndex = 0;
        this.flags = 0;
        this.g = 0;
        this.startYVel = 0;
        // *not* speed
        this.dataStart = -1;
        vec3.copy(this.startPos, pos);
        vec3.copy(this.endPos, pos);
    }

    public init(flags: number, start: ReadonlyVec3): void {
        switch (flags & MotionFlags.TYPE_MASK) {
            case MotionFlags.TARGET_HORIZ:
            case MotionFlags.TARGET:
            case MotionFlags.ACCEL_HORIZ:
            case MotionFlags.ACCEL: {
                if (this.duration !== 0)
                    this.duration = 1/this.duration;
            } break;
            case MotionFlags.SPLINE_THREE:
            case MotionFlags.SPLINE_FOUR: {
                this.t = 0;
            } break;
            case MotionFlags.LERP: {
                vec3.copy(this.startPos, start);
                this.startYVel = 0;
                this.t = 0
            } break;
            case MotionFlags.PROJECTILE: {
                const dy = this.endPos[1] - this.startPos[1];
                if (dy > 0)
                    this.startYVel *= -1;
                this.g = 2*(dy - this.startYVel);
                if (this.g < 0) {
                    this.g *= -1;
                    this.startYVel = dy - this.g/2;
                }
            } break;
        }
        this.flags = flags;
        this.turnFrames = 0;
    }

    public update(dt: number, pos: PosState, data: DataView): void {
        const targetFlags = MotionFlags.UPDATE_TARGET | MotionFlags.ALIGN_TO_PATH;
        if ((this.flags & targetFlags) === targetFlags) {
            vec3.copy(this.endPos, assertExists(this.targetPos));
            vec3.copy(this.startPos, pos.pos);
        }
        const moveType: MotionFlags = this.flags & MotionFlags.TYPE_MASK;

        let turnFrac = 1;
        if (this.turnRateTimeScale > 0 || moveType === MotionFlags.PROJECTILE || moveType === MotionFlags.LERP) {
            this.turnFrames += dt;
            turnFrac = clamp(this.turnFrames / this.turnRateTimeScale, 1, 8);
        }

        switch (moveType) {
            case MotionFlags.TARGET_HORIZ:
                this.endPos[1] = pos.pos[1];
                // fallthrough
            case MotionFlags.TARGET: {
                if (this.flags & MotionFlags.ALIGN_TO_PATH) {
                    vec3.sub(moveScratch, this.endPos, pos.pos);
                    if (moveScratch[0] !== 0 || moveScratch[2] !== 0) {
                        const sphere = toSpherical(moveScratch);
                        if (this.flags & MotionFlags.INSTANT_TURN) {
                            pos.velYaw = sphere.azimuth;
                            pos.velPitch = sphere.inclination;
                        } else {
                            pos.velYaw = angleStep(pos.velYaw, sphere.azimuth, this.yawStep * turnFrac, 0);
                            pos.velPitch = angleStep(pos.velPitch, sphere.inclination, this.pitchStep * turnFrac, 0);
                        }
                    }
                }
                // we should scale this by the timestep, but there's at least one place (macalania trials)
                // where the destination is actually unreachable. So we'll jump a little bit at the end
                const step = this.startSpeed / 10;
                if (vec3.dist(pos.pos, this.endPos) < step) {
                    this.flags |= MotionFlags.REACHED_TARGET;
                }
                // only used for actors, motion happens later
                pos.speed = this.startSpeed;
            } break;
            case MotionFlags.ACCEL_HORIZ:
            case MotionFlags.ACCEL: {
            } break;
            case MotionFlags.SPLINE_THREE: {
                this.t += dt;
                assert(this.dataStart >= 0);
                const count = data.getUint32(this.dataStart, true);
                assert(count > 2);
                const t = clamp(this.t / this.duration, 0, 1);
                const startIndex = (t * (count - 2)) | 0;
                const frac = t * (count - 2) - startIndex;
                const offs = this.dataStart + 0x10 + startIndex * 0x10;

                const a = .5 * (1 - frac) ** 2;
                const b = frac * (1 - frac) + .5;
                const c = .5 * frac ** 2;

                for (let i = 0; i < 3; i++) {
                    moveScratch[i] =
                        a * data.getFloat32(offs + 0 + 4*i, true) +
                        b * data.getFloat32(offs + 0x10 + 4*i, true) +
                        c * data.getFloat32(offs + 0x20 + 4*i, true);
                }
                vec3.sub(moveScratch, moveScratch, pos.pos);
                pos.speed = vec3.len(moveScratch);
                if (dt > 0) {
                    const sphere = toSpherical(moveScratch);
                    pos.velYaw = sphere.azimuth;
                    pos.velPitch = sphere.inclination;
                }
            } break;
            case MotionFlags.SPLINE_FOUR: {
                this.t += dt;
                assert(this.dataStart >= 0);
                const count = data.getUint32(this.dataStart, true);
                assert(count > 3);
                const t = clamp(this.t/this.duration, 0, 1);
                const startIndex = (t*(count - 3)) | 0;
                const frac = t*(count-3) - startIndex;
                const offs = this.dataStart + 0x10 + startIndex * 0x10;

                moveScratch[0] = getPointBspline(
                    data.getFloat32(offs + 0x00, true),
                    data.getFloat32(offs + 0x10, true),
                    data.getFloat32(offs + 0x20, true),
                    data.getFloat32(offs + 0x30, true),
                    frac,
                );
                moveScratch[1] = getPointBspline(
                    data.getFloat32(offs + 0x04, true),
                    data.getFloat32(offs + 0x14, true),
                    data.getFloat32(offs + 0x24, true),
                    data.getFloat32(offs + 0x34, true),
                    frac,
                );
                moveScratch[2] = getPointBspline(
                    data.getFloat32(offs + 0x08, true),
                    data.getFloat32(offs + 0x18, true),
                    data.getFloat32(offs + 0x28, true),
                    data.getFloat32(offs + 0x38, true),
                    frac,
                );
                vec3.sub(moveScratch, moveScratch, pos.pos);
                pos.speed = vec3.len(moveScratch);
                if (dt > 0) {
                    const sphere = toSpherical(moveScratch);
                    pos.velYaw = sphere.azimuth;
                    pos.velPitch = sphere.inclination;
                }
            } break;
            case MotionFlags.LERP: {
                const t = clamp(this.t / this.duration, 0, 1);
                this.t += dt;
                vec3.lerp(pos.pos, this.startPos, this.endPos, t);
                pos.speed = 0;
            } break;
            case MotionFlags.PROJECTILE: {
                this.t += dt;
                const t = clamp(this.t / this.duration, 0, 1);
                vec3.lerp(pos.pos, this.startPos, this.endPos, t);
                pos.pos[1] = this.startPos[1] + t*(this.startYVel + this.g * t/2);
                pos.speed = 0;
            } break;
        }
    }

    public isDone(pos: vec3): boolean {
        switch (this.flags & MotionFlags.TYPE_MASK) {
            case MotionFlags.TARGET_HORIZ:
            case MotionFlags.TARGET:
            case MotionFlags.ACCEL_HORIZ:
            case MotionFlags.ACCEL: {
                if (this.flags & MotionFlags.REACHED_TARGET) {
                    vec3.copy(pos, this.endPos);
                    return true;
                }
                const dist = this.flags & MotionFlags.MATCH_HEIGHT ?
                    vec3.dist(pos, this.endPos) :
                    Math.hypot(pos[0] - this.endPos[0], pos[2] - this.endPos[2]);
                return dist < this.posThreshold;
            } break;
            case MotionFlags.SPLINE_THREE:
            case MotionFlags.SPLINE_FOUR: {
                return this.t > this.duration;
            } break;
            case MotionFlags.LERP:
            case MotionFlags.PROJECTILE: {
                if (this.t > this.duration) {
                    vec3.copy(pos, this.endPos);
                    return true;
                }
            } break;
        }
        return false;
    }
}

interface PosState {
    targetIndex: number;
    pos: vec3;
    speed: number;
    miscVec: vec3; // different uses depending on motion/rotation
    velYaw: number;
    velPitch: number;

    collisionHeight: number;
    collisionRadius: number;
    facingAngleRange: number;
    interactRadius: number;
    otherRadius: number;
}

const enum ThreadWaitType {
    NONE,
    ACK,
    DELETE,
}

class Thread {
    public offset = 0;

    private callWorkers = nArray(3, () => -1);
    private callOffsets = nArray(3, () => -1);
    private callDepth = 0;

    public test = 0;
    public case = 0;
    public return = 0;
    public ranInit = false;

    public wait: ThreadWaitType = ThreadWaitType.NONE;
    public waitSource = 0;
    public waitThread = 0;
    public waitEntry = 0;
    public waitData = 0;
    public moreWaitData = 0;

    constructor(private script: EventScript, public currWorker: number, public motion: MotionState, public rotation: RotationState) { }

    public reset() {
        this.resetToEntry(0);
        this.waitData = ThreadWaitType.NONE;
        this.return = 0;
    }

    public goToLabel(index: number): void {
        this.ranInit = false;
        this.offset = this.script.data.workers[this.currWorker].labels[index];
    }

    public goToEntry(index: number): void {
        this.ranInit = false;
        this.offset = this.script.data.workers[this.currWorker].entrypoints[index];
    }

    public callWorker(index: number): void {
        this.callWorkers[this.callDepth] = this.currWorker;
        this.callOffsets[this.callDepth] = this.offset + 3; // assume this has an immediate
        this.currWorker = index;
        this.callDepth++;
        this.goToEntry(0);
    }

    public returnFromWorker(): void {
        this.callDepth--;
        this.currWorker = this.callWorkers[this.callDepth];
        this.ranInit = false;
        this.offset = this.callOffsets[this.callDepth];
    }

    public resetToEntry(entry: number) {
        if (this.callDepth > 0)
            this.currWorker = this.callWorkers[0];
        this.callDepth = 0;
        this.goToEntry(entry);
    }
}

const enum SignalType {
    NO_ACK,
    ON_START,
    ON_END,
    ACK,
}

const enum SignalStatus {
    NEW,
    OLD,
    PROCESSED,
}

interface Signal {
    type: SignalType;
    source: number;
    target: number;
    thread: number;
    entry: number;
    status: SignalStatus;
    prev: Signal | null;
    next: Signal | null;
}

function shouldCleanup(signal: Signal, cutoff: number, mode: SignalStatus): boolean {
    if (signal.thread <= cutoff)
        return false;
    if (mode === SignalStatus.NEW)
        return true;
    if (mode === SignalStatus.OLD)
        return signal.status !== SignalStatus.NEW;
    return signal.status !== SignalStatus.PROCESSED;
}

const enum WorkerFlags {
    NONE                = 0x00,
    ACTIVE              = 0x02,
    ERROR               = 0x08, // the opposite in game
    INIT_DONE           = 0x10,
    JUST_TURN           = 0x20,
    COLLISION_ACTIVE    = 0x80,
    UPDATED_COLLISION   = 0x10000, // mostly seems to prevent a stationary target from crossing an edge
    UPDATE_HIGH         = 0x10000000,
}

const enum PuppetType {
    NONE,
    ACTOR,
    CAMERA,
    UNKNOWN,
    LAYER,
    PART,
}

function threadCount(spec: BIN.WorkerSpec): number {
    if (spec.type === BIN.WorkerType.ZONE || spec.type === BIN.WorkerType.EDGE)
        return 2;
    return 9;

}

const workerScratch = mat4.create();
class Worker {
    public stack = new Stack();

    public signalQueue: Signal | null = null;
    public currSignal: Signal | null = null;
    public flags: WorkerFlags = 0;
    public moreFlags = 0;
    // actually part of flags
    public pendingCount = 0;
    public nextCount = 0;

    private threads: Thread[] = [];
    public threadBitflags = 0;
    public currThread = -1;

    public intVars: number[] = nArray(4, () => 0);
    public floatVars: number[] = nArray(4, () => 0);
    public turnAnimations: number[] = nArray(4, () => 0);

    public id = -1;
    public puppetType: PuppetType = PuppetType.NONE;
    public puppetID = -1;
    public actor: Actor | null = null;
    public savedAnimation = 0;
    public position: PosState;
    public motions: MotionState[];
    public rotations: RotationState[];

    public privateArrays: number[][] = [];

    public debug = false;

    constructor(private script: EventScript, public spec: BIN.WorkerSpec, public index: number) {
        this.position = {
            targetIndex: -1,
            pos: vec3.create(),
            speed: 0,
            miscVec: vec3.create(),
            velPitch: 0,
            velYaw: 0,
            collisionHeight: -1,
            collisionRadius: 1,
            facingAngleRange: 60*MathConstants.DEG_TO_RAD,
            interactRadius: 0,
            otherRadius: 0,
        };

        if (spec.type === BIN.WorkerType.MOTION) {
            this.threadBitflags = 0x1F7;
            this.position.collisionHeight = 5;
            this.position.collisionRadius = 1.5;
        } else if (spec.type !== BIN.WorkerType.UNKNOWN)
            this.threadBitflags = 0x1FF;
        if (spec.type === BIN.WorkerType.MOTION || spec.type === BIN.WorkerType.UNKNOWN)
            this.flags |= WorkerFlags.COLLISION_ACTIVE;
        this.flags |= WorkerFlags.ACTIVE;

        const threads = threadCount(spec);
        this.motions = nArray(threads, () => new MotionState());
        this.rotations = nArray(threads, () => new RotationState());

        for (let i = 0; i < threads; i++) {
            const newThread = new Thread(script, index, this.motions[i], this.rotations[i]);
            this.threads.push(newThread);
            this.resetThread(i);
        }

        for (let i = 0; i < script.data.arrays.length; i++) {
            const arr = script.data.arrays[i];
            if (arr.source !== BIN.ArraySource.PRIVATE)
                continue;
            this.privateArrays[i] = nArray(arr.count, () => 0);
        }
    }

    public getThread(index = this.currThread): Thread {
        return this.threads[clamp(index, 0, this.threads.length - 1)];
    }

    public decodeSignal(cutoff: number): void {
        if (this.signalQueue === null)
            return;
        if (cutoff < 0)
            cutoff = this.currThread;
        if (cutoff > 9)
            cutoff = -1;
        const sig = this.signalQueue;
        if (sig.type !== SignalType.ACK && sig.thread > cutoff) {
            this.currSignal = sig;
            this.currThread = sig.thread;
            if (sig.status !== SignalStatus.PROCESSED) {
                if (sig.type === SignalType.ON_START)
                    this.script.ack(sig);
                sig.status = SignalStatus.PROCESSED;
                const thread = this.getThread();
                thread.resetToEntry(sig.entry);
                this.resetThreadMotion(sig.thread);
            }
        }
        for (let sig: Signal | null = this.signalQueue; sig !== null; sig = sig.next) {
            if (sig.status === SignalStatus.NEW)
                sig.status = SignalStatus.OLD;
        }
    }

    public deleteOwnSignal(signal: Signal): void {
        if (signal === this.signalQueue)
            this.signalQueue = signal.next;
        this.script.deleteSignal(signal);
        if (this.currSignal === signal)
            this.currSignal = null;
    }

    public cleanupSignals(cutoff: number, status: SignalStatus): void {
        let sig = this.signalQueue;
        while (sig !== null) {
            const next = sig.next;
            if (shouldCleanup(sig, cutoff, status)) {
                if ((sig.type === SignalType.ON_START && sig.status !== SignalStatus.PROCESSED) || sig.type === SignalType.ON_END)
                    this.script.ack(sig);
                this.deleteOwnSignal(sig);
            }
            sig = next;
        }
    }

    private resetThread(index: number): void {
        const thread = this.getThread(index);
        thread.resetToEntry(0);
        thread.wait = ThreadWaitType.NONE;
        thread.return = 0;
        if (this.spec.type === BIN.WorkerType.MOTION)
            this.resetThreadMotion(index);
    }

    private resetThreadMotion(index: number): void {
        const m = this.motions[index];
        m.reset(this.position.pos);

        const r = this.rotations[index];
        r.flags = 0;
        r.targetPos = null;
        vec3.zero(r.target);
        vec3.zero(r.delta);

        const thread = this.getThread(index);
        thread.motion = m;
        thread.rotation = r;
    }

    public startThreadMotion(threadBits: number, flags: MotionFlags, target: number): void {
        const newMotion = this.motions[this.currThread];
        if (this.actor)
            this.actor.flags &= ~ActorFlags.ALLOW_TURNING;
        newMotion.targetPos = target >= 0 ? this.script.workers[target].position.pos : null;
        newMotion.init(flags, this.position.pos);
        this.getThread().motion = newMotion;
        const maxThread = flags & MotionFlags.LINK_ALL ? this.threads.length - 1 : this.currThread;
        for (let i = 0; i <= maxThread; i++) {
            if (threadBits & (1 << i)) {
                const thread = this.getThread(i);
                if ((flags & MotionFlags.NO_OVERWRITE) === 0 ||
                    (thread.motion.flags & ~MotionFlags.TYPE_MASK) === 0)
                    thread.motion = newMotion;
            }
        }
    }

    public stopThreadMotion(index: number): void {
        if (index < 0)
            index = this.currThread;
        const motion = this.threads[clamp(index, 0, this.threads.length - 1)].motion!;
        if (motion.flags & MotionFlags.STOP_ROTATION)
            this.stopThreadRotation(index);
        for (let i = 0; i < this.threads.length; i++) {
            const otherMotion = this.threads[i].motion;
            if (otherMotion === motion) {
                const newMotion = this.motions[i];
                this.threads[i].motion = newMotion;
                newMotion.t = motion.t;
                newMotion.duration = motion.duration;
                vec3.copy(newMotion.endPos, motion.endPos);
                newMotion.posThreshold = motion.posThreshold;
                newMotion.flags = MotionFlags.NONE;
            }
        }
    }

    public startThreadRotation(threadBits: number, flags: RotationFlags, target: number): void {
        if (this.actor)
            this.actor.flags &= ~ActorFlags.ALLOW_TURNING;
        const newRotation = this.rotations[this.currThread];
        newRotation.targetPos = target >= 0 ? this.script.workers[target].position.pos : null;
        newRotation.init(flags);
        this.getThread().rotation = newRotation;
        const maxThread = flags & RotationFlags.LINK_ALL ? this.threads.length - 1 : this.currThread;
        for (let i = 0; i <= maxThread; i++) {
            const thread = this.getThread(i);
            if (threadBits & (1 << i)) {
                if ((flags & RotationFlags.NO_OVERWRITE) === 0 ||
                    (thread.rotation.flags & ~RotationFlags.TYPE_MASK) === 0)
                    thread.rotation = newRotation;
            }
        }
    }

    public stopThreadRotation(index: number): void {
        if (index < 0)
            index = this.currThread;
        const rotation = this.threads[clamp(index, 0, this.threads.length - 1)].rotation;
        for (let i = 0; i < this.threads.length; i++) {
            const otherRotation = this.threads[i].rotation;
            if (otherRotation === rotation) {
                const newRotation = this.rotations[i];
                this.threads[i].rotation = newRotation;
                newRotation.t = rotation.t;
                newRotation.duration = rotation.duration;
                vec3.copy(newRotation.delta, rotation.delta);
                vec3.copy(newRotation.target, rotation.target);
                newRotation.flags = RotationFlags.NONE;
            }
        }
    }

    public finishThread(cutoff: number, runMain: boolean): void {
        if (this.currSignal !== null) {
            if (this.currSignal.type === SignalType.ON_END)
                this.script.ack(this.currSignal);
            this.deleteOwnSignal(this.currSignal);
        }
        if (cutoff > -1)
            this.cleanupSignals(cutoff, SignalStatus.OLD);
        this.decodeSignal(10);
        if (runMain) {
            const thread = this.getThread();
            thread.reset();
            thread.goToEntry(1);
            if (this.spec.type === BIN.WorkerType.MOTION)
                this.resetThreadMotion(this.currThread);
        }
        this.flags = this.flags | WorkerFlags.INIT_DONE;
    }

    public setTransform(parts: LevelPartInstance[]): void {
        mat4.fromXRotation(workerScratch, this.position.miscVec[0]);
        mat4.rotateY(workerScratch, workerScratch, this.position.miscVec[1]);
        mat4.rotateZ(workerScratch, workerScratch, this.position.miscVec[2]);
        setMatrixTranslation(workerScratch, this.position.pos);
        if (this.puppetType === PuppetType.LAYER) {
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].part.layer === this.puppetID) {
                    mat4.copy(parts[i].modelMatrix, workerScratch);
                }
            }
        } else if (this.puppetType === PuppetType.PART) {
            mat4.copy(parts[this.puppetID].modelMatrix, workerScratch);
        }
    }

    public apply(parts: LevelPartInstance[], dt: number): void {
        if ((this.flags & WorkerFlags.COLLISION_ACTIVE) === 0)
            return;
        const thread = this.getThread();
        if (this.spec.type === BIN.WorkerType.MOTION) {
            if (this.actor)
                vec3.copy(this.position.pos, this.actor.pos);
            thread.motion.update(dt, this.position, this.script.data.shared);
            thread.rotation.update(dt, this.position, thread.motion);
            if (this.flags & WorkerFlags.JUST_TURN) {
            } else {
                if (thread.motion.isDone(this.position.pos)) {
                    this.stopThreadMotion(-1);
                }
                if (thread.rotation.isDone(this.position.miscVec)) {
                    thread.rotation.flags &= RotationFlags.SET_VEL | RotationFlags.GO_FOREVER;
                    this.stopThreadRotation(-1);
                }
                this.setTransform(parts);
                if (this.actor) {
                    this.actor.targetHeading = this.position.velYaw;
                    this.actor.heading = this.position.miscVec[1];
                    this.actor.speed = thread.motion.flags === 0 ? 0 : this.position.speed;
                }
            }
            // the game doesn't actually do this
            // it seems like actors move separately (in particular, so they can clamp to the ground),
            // and position is only written by the motion logic at the end of each motion
            if (this.actor) {
                const type = thread.motion.flags & MotionFlags.TYPE_MASK;
                vec3.copy(this.actor.prevPos, this.actor.pos);
                vec3.zero(moveScratch);
                switch (type) {
                    case MotionFlags.TARGET: case MotionFlags.TARGET_HORIZ:
                        moveScratch[1] = Math.sin(this.position.velPitch);
                        moveScratch[0] = Math.cos(this.position.velPitch) * Math.cos(this.position.velYaw);
                        moveScratch[2] = Math.cos(this.position.velPitch) * Math.sin(this.position.velYaw);
                        vec3.scaleAndAdd(this.actor.pos, this.actor.pos, moveScratch, thread.motion.startSpeed * dt / 20);
                        break;
                    case MotionFlags.SPLINE_THREE: case MotionFlags.SPLINE_FOUR:
                        moveScratch[1] = Math.sin(this.position.velPitch);
                        moveScratch[0] = Math.cos(this.position.velPitch) * Math.cos(this.position.velYaw);
                        moveScratch[2] = Math.cos(this.position.velPitch) * Math.sin(this.position.velYaw);
                        vec3.scaleAndAdd(this.actor.pos, this.actor.pos, moveScratch, this.position.speed);
                    break;
                    case MotionFlags.PROJECTILE: case MotionFlags.LERP:
                        vec3.copy(this.actor.pos, this.position.pos);
                        this.actor.groundTri = -1;
                    break;
                }
            }
        }
    }

    public moveTargetTo(x: number, y: number, z: number, clearPrevious: boolean): void {
        vec3.set(this.position.pos, x, y, z);
        if (this.actor) {
            vec3.copy(this.actor.pos, this.position.pos);
            if (clearPrevious || (this.flags & WorkerFlags.INIT_DONE) === 0)
                vec3.copy(this.actor.prevPos, this.actor.pos);
            this.actor.groundTri = -1;
        }
    }
}

function compareSignals(a: Signal, b: Signal): number {
    // always append acks, probably doesn't matter
    if (a.type === SignalType.ACK)
        return 1;
    if (b.type === SignalType.ACK)
        return -1;
    return b.thread - a.thread;
}

const triScratch = nArray(3, () => vec3.create());

function fillMapTri(dst: vec3[], map: BIN.HeightMap, index: number): void {
    const tri = map.tris[index];
    for (let j = 0; j < 3; j++) {
        vec3.set(dst[j], map.vertices[4*tri.vertices[j] + 0], map.vertices[4*tri.vertices[j] + 1], map.vertices[4*tri.vertices[j] + 2]);
        vec3.scale(dst[j], dst[j], 1/map.scale);
    }
}

function pointsAreClockwise(a: ReadonlyVec3, b: ReadonlyVec3, c: ReadonlyVec3): boolean {
    const x0 = b[0] - a[0];
    const z0 = b[2] - a[2];
    const x1 = c[0] - b[0];
    const z1 = c[2] - b[2];
    return x0*z1 > z0*x1;
}

function triEdgeCrossedFlags(pos: ReadonlyVec3, verts: ReadonlyVec3[]): number {
    let out = 0;
    for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (pointsAreClockwise(verts[i], verts[j], pos))
            out |= 1 << i;
    }
    return out;
}

const normScratch = vec3.create();
const normScratch2 = vec3.create();
function triHeight(pos: ReadonlyVec3, verts: ReadonlyVec3[]): number {
    vec3.sub(normScratch, verts[1], verts[0]);
    vec3.sub(normScratch2, verts[2], verts[0]);
    vec3.cross(normScratch, normScratch, normScratch2);
    vec3.normalize(normScratch, normScratch);
    const base = vec3.dot(normScratch, verts[0]);
    const hDot = normScratch[0] * pos[0] + normScratch[2] * pos[2];
    return (base - hDot)/normScratch[1];
}

export interface RenderFlags {
    wireframe: boolean;
    textures: boolean;
    vertexColors: boolean;
}

class Edge {
    private done = false;

    constructor(public index: number, public positive: boolean) {}

    public update(script: EventScript, viewerInput: ViewerRenderInput): void {
        if (this.done)
            return;
        const c = script.workers[this.index];
        const dxStart = c.position.pos[0] - viewerInput.camera.worldMatrix[12];
        const dzStart = c.position.pos[2] + viewerInput.camera.worldMatrix[14];

        const dx = c.position.miscVec[0] - c.position.pos[0];
        const dz = c.position.miscVec[2] - c.position.pos[2];

        const side = dzStart*dx - dxStart*dz;
        if (side > 0 === this.positive) {
            this.done = script.sendSignal(SignalType.NO_ACK, -1, this.index, 1, 4);
        }
    }
}

export interface ActorResources {
    parts: ActorPartInstance[];
    model?: BIN.ActorModel;
    animations: BIN.Animation[];
    textures: TextureData[];
    particles?: ParticleData;
    fetched: number;
}

export interface RenderFlags {
    wireframe: boolean;
    textures: boolean;
    vertexColors: boolean;
    showObjects: boolean;
    showParticles: boolean;
    debugParticles: boolean;
}

const enum ButtonPress {
    NONE = 0,
    UP = 0x1000,
    RIGHT = 0x2000,
    DOWN = 0x4000,
    LEFT = 0x8000,
}

const enum TrialsLevel {
    DJOSE,
    MACALANIA,
}

const edgeScratch = vec3.create();
export class LevelObjectHolder {
    public effectData: BIN.PartEffect[];
    public animatedTextures: BIN.AnimatedTexture[];
    public map?: BIN.HeightMap;

    public parts: LevelPartInstance[] = [];
    public renderFlags: RenderFlags = {
        wireframe: false,
        textures: true,
        vertexColors: true,
        showObjects: true,
        showParticles: true,
        debugParticles: false,
    };
    public activeEffects = nArray<BIN.ActiveEffect>(64, () => ({
        active: false,
        runOnce: false,
        startFrame: 0,
        partIndex: -1,
        effectIndex: -1,
    }));
    public activeMagic = -1;
    public magic: ParticleSystem[] = [];
    public actors: (Actor | undefined)[] = [];
    public buttons: Button[] = [];
    public edges: Edge[] = [];
    public playerActive = true;
    public inBattle = false;
    public fog: BIN.FogParams;
    public lightDirs = mat4.create();
    public lightColors = mat4.create();
    public cameraPos = vec3.create();
    public t = 0;
    private loadedMotionGroups: Set<number> = new Set();
    public bufferManager = new BufferPoolManager();
    public particles: ParticleSystem;
    public shadows: ShadowRenderer;
    public actorsAfterXLU = true;
    public inputManager: InputManager;

    public pressedButton: ButtonPress = 0;
    public pushPosition = vec3.create();

    constructor(public mapID: number, public eventID: number, public cache: GfxRenderCache, public context: SceneContext, level: BIN.LevelData,
        public actorResources: Map<number, ActorResources>, textureData: TextureData[], public particleTex: GSMemoryMap) {

        this.effectData = level.geo.effects;
        this.animatedTextures = level.geo.animatedTextures;
        this.map = level.map;
        if (level.geo.fog)
            this.fog = level.geo.fog;
        else
            this.fog = {
                near: 0,
                far: 0,
                opacity: 0,
                color: vec3.create(),
            };
        this.particles = new ParticleSystem(-1, new ParticleData(level.particles, cache.device, cache, textureData, this.bufferManager));
        this.particles.active = true;
        this.shadows = new ShadowRenderer(cache, this.bufferManager);
        this.inputManager = context.inputManager;
    }

    public ensureActorResource(id: number): ActorResources {
        const existing = this.actorResources.get(id);
        if (existing)
            return existing;
        const res: ActorResources = {
            parts: [], animations: [], textures: [], fetched: 0
        };
        this.actorResources.set(id, res);
        return res;
    }

    public async loadActorResource(id: number, index: number): Promise<void> {
        const res = this.ensureActorResource(id);
        index++; // zero is really the model
        if (res.fetched & (1 << index))
            return;
        res.fetched |= 1 << index;
        const file = await loadActorFile(this.context, this.mapID, id, index);
        if (!file || file.byteLength === 0)
            return;
        const parsed = BIN.parseAnimation(file, false);
        if (parsed.length > 0)
            res.animations = res.animations.concat(parsed[0].animations);
    }

    public async loadMotionGroup(index: number): Promise<void> {
        if (this.loadedMotionGroups.has(index))
            return;
        this.loadedMotionGroups.add(index);
        const file = await loadFile(this.context, FFXFolder.EVENT, this.eventID*18 + 3 + index, true);
        if (!file || file.byteLength === 0)
            return;
        const parsed = BIN.parseAnimation(file, false);
        for (let g of parsed) {
            const res = this.actorResources.get(g.id);
            if (res)
                res.animations = res.animations.concat(g.animations);
        }
    }

    public snapToGround(pos: vec3): number {
        if (!this.map)
            return -1;
        const startY = pos[1];
        let groundTri = -1;
        for (let i = 0; i < this.map.tris.length; i++) {
            fillMapTri(triScratch, this.map, i);
            if (triEdgeCrossedFlags(pos, triScratch) !== 0) {
                continue;
            }
            const newY = triHeight(pos, triScratch);
            if (groundTri < 0 ||
                (newY < pos[1] && newY > startY) || // above current and below start
                (newY > pos[1] && pos[1] < startY) // below current, and current is above start
            ) {
                groundTri = i;
                pos[1] = newY;
            }
        }
        return groundTri;
    }

    public findMostRecentTri(startTri: number, pos: vec3, prevPos: ReadonlyVec3): number {
        const map = assertExists(this.map);
        // if we already had a triangle, make sure we stay in bounds
        // the game also has a height delta constraint,
        // but i'm not sure it ever matters because of the adjacency logic
        let currTri = startTri;
        for (let i = 0; i < 10; i++) {
            fillMapTri(triScratch, map, currTri);
            let triFlags = triEdgeCrossedFlags(pos, triScratch);
            if (triFlags === 0) {
                // contained in this tri, we're done
                break;
            }
            // which edge should we follow next?
            let edge = -1;
            switch (triFlags) {
                case 1:
                    edge = 0; break;
                case 2:
                    edge = 1; break;
                case 4:
                    edge = 2; break;
                // two edges, pick based on which side of the shared vertex we ended up on
                case 3:
                    edge = pointsAreClockwise(prevPos, pos, triScratch[1]) ? 1 : 0; break;
                case 6:
                    edge = pointsAreClockwise(prevPos, pos, triScratch[2]) ? 2 : 1; break;
                case 5:
                    edge = pointsAreClockwise(prevPos, pos, triScratch[0]) ? 0 : 2; break;
            }
            const nextTri = map.tris[currTri].edges[edge];
            if (nextTri < 0) {
                // put us back just inside the edge
                // the game actually steps the displacement back until it's back inside the triangle
                vec3.sub(edgeScratch, triScratch[(edge + 1) % 3], triScratch[edge]);
                vec3.set(edgeScratch, edgeScratch[2], 0, -edgeScratch[0]);
                vec3.normalize(edgeScratch, edgeScratch);
                const start = vec3.dot(edgeScratch, triScratch[edge]);
                const end = vec3.dot(edgeScratch, pos);
                normToLengthAndAdd(pos, edgeScratch, 1.1*(start - end));
            } else {
                currTri = nextTri;
            }
        }
        pos[1] = triHeight(pos, triScratch);
        return currTri;
    }

    public triNormAndLight(dst: vec3, tri: number, pos: ReadonlyVec3): number {
        const map = assertExists(this.map);
        fillMapTri(triScratch, map, tri);
        vec3.sub(edgeScratch, triScratch[1], triScratch[0]);
        vec3.sub(dst, triScratch[2], triScratch[0]);
        vec3.cross(dst, dst, edgeScratch);
        vec3.normalize(dst, dst);
        if (!map.hasLight)
            return 1;
        const triData = map.tris[tri];
        const a = vec3.dist(triScratch[0], pos);
        const b = vec3.dist(triScratch[1], pos);
        const c = vec3.dist(triScratch[2], pos);
        vec3.set(triScratch[0], a, b, c);
        vec3.normalize(triScratch[0], triScratch[0]);
        vec3.sub(triScratch[0], Vec3One, triScratch[0]);
        vec3.normalize(triScratch[0], triScratch[0]);
        triScratch[0][0] *= triData.light[0];
        triScratch[0][1] *= triData.light[1];
        triScratch[0][2] *= triData.light[2];
        return vec3.len(triScratch[0])/31;
    }
}

function deactivateEffect(level: LevelObjectHolder, partIndex: number, effectType: number): void {
    for (let i = 0; i < level.activeEffects.length; i++) {
        const effect = level.activeEffects[i];
        if (effect.active && effect.partIndex === partIndex &&
            (level.effectData[effect.effectIndex].type === effectType || effectType < 0))
            effect.active = false;
    }
}

export function activateEffect(level: LevelObjectHolder, partIndex: number, effectIndex: number, runOnce: boolean): void {
    assertExists(level.effectData[effectIndex]);
    const data = level.effectData[effectIndex];
    deactivateEffect(level, partIndex, data.type);
    for (let i = 0; i < level.activeEffects.length; i++) {
        const effect = level.activeEffects[i];
        if (effect.active)
            continue;
        effect.active = true;
        effect.partIndex = partIndex;
        effect.effectIndex = effectIndex;
        effect.runOnce = runOnce;
        effect.startFrame = -1; // will treat this frame as zero
        return;
    }
    console.warn("could not activate effect", effectIndex, "on part", partIndex);
}

const enum Global {
    HaveTinder = 0x180,
    HaveFlint = 0x181,
    GameMoment = 0xA00,
    BaajProgress = 0xA70,
    BlitzballTeamSizes = 0xA88,
    BlitzballTeamMembers = 0x141A,
    BlitzballMarks = 0x1455,
    BlitzballOpponent = 0x1465,
    BlitzballFormationsKnown = 0x1529,
    AlBhedPrimers = 0x3B24,
}

function truncateValue(raw: number, format: BIN.DataFormat): number {
    let min = 0, max = 0;
    switch (format) {
        case BIN.DataFormat.I8:
            min = -0x80; max = 0x7F; break;
        case BIN.DataFormat.U8:
            min = 0; max = 0xFF; break;
        case BIN.DataFormat.I16:
            min = 0; max = 0xFF; break;
        case BIN.DataFormat.U16:
            min = 0; max = 0xFF; break;
        case BIN.DataFormat.U32:
            return raw >>> 0;
        case BIN.DataFormat.I32:
            return raw | 0;
        case BIN.DataFormat.FLOAT:
            return raw;
    }
    return clamp(raw | 0, min, max);
}

function wrapValue(raw: number, format: BIN.DataFormat): number {
    let signed = false;
    const size = 8*BIN.byteSize(format);
    switch (format) {
        case BIN.DataFormat.I8:
        case BIN.DataFormat.I16:
        case BIN.DataFormat.I32:
            signed = true; break;
        case BIN.DataFormat.U8:
        case BIN.DataFormat.U16:
        case BIN.DataFormat.U32:
            signed = false; break;
        case BIN.DataFormat.FLOAT:
            return raw; // technically we could need to process 32-bit values, but seems unlikely
    }
    const shift = 32 - size;
    const mid = raw << shift;
    if (signed)
        return mid >> shift;
    else
        return mid >>> shift;
}


const funcArgCounts = new Map<number, number>([
    [0x0006, 3], // change equipment
    [0x0007, 1], // free actor?
    [0x0044, 0],
    [0x0051, 1],
    [0x0060, 1],
    [0x007F, 1],
    [0x00AA, 1],
    [0x00BB, 1], // default script timer???
    [0x00BC, 1],
    [0x00BE, 1],
    [0x00CA, 1],
    [0x00CB, 1],
    [0x00CE, 1],
    [0x00CF, 1],
    [0x00D5, 1], // wait for a file
    [0x00D6, 0], // wait for a file
    [0x00D7, 0], // rpc
    [0x00D8, 0],
    [0x00D9, 0], // wait for something
    [0x00DE, 0], // another wait
    [0x00E0, 1],
    [0x00E7, 2], // set char slot
    [0x00F2, 1],
    [0x00F3, 1],
    [0x00FB, 1], // some menu thing
    [0x00FD, 3],
    [0x00FE, 2],
    [0x0100, 3], // wait for file load?
    [0x0102, 1], // wait for file load?
    [0x0103, 1],
    [0x0104, 1],
    [0x0105, 0], // wait for something
    [0x0106, 3],
    [0x0108, 5],
    [0x0109, 1],
    [0x010A, 1],
    [0x010D, 1], // give item
    [0x010E, 0], // al bhed primers
    [0x0111, 0], // battle lineup
    [0x0112, 0],
    [0x0116, 1],
    [0x0117, 1], // sets some signal count flags, can probably implement
    [0x0119, 1],
    [0x011A, 3], // takes two array descriptors and an index
    [0x011B, 2],
    [0x011C, 1],
    [0x011D, 2],
    [0x011F, 3],
    [0x0120, 3],
    [0x0121, 1],
    [0x012A, 2], // something with UI digit display
    [0x012B, 1], // event flag 0x400000
    [0x0129, 4],
    [0x013D, 1], // wait for somethin
    [0x013F, 2], // text?
    [0x0143, 1],
    [0x0144, 1],
    [0x0145, 2],
    [0x0146, 1], // something with guidemap
    [0x0148, 2],
    [0x014A, 3],
    [0x0151, 1],
    [0x0155, 1],
    [0x0158, 1], // something footstep-related
    [0x015B, 2], // get treasure
    [0x015D, 1], // script flag 0x1b
    [0x016A, 2], // call some RPC, sound?
    [0x016B, 3], // call some RPC, sound?
    [0x016C, 0],
    [0x016D, 1],
    [0x016E, 2],
    [0x016F, 1], // set save sphere map entrance
    [0x0171, 1], // restore character HP
    [0x0172, 1], // restore character MP
    [0x017A, 1],
    [0x017E, 2],
    [0x017F, 1],
    [0x0180, 2],
    [0x0188, 1],
    [0x0194, 1],
    [0x01A8, 1],
    [0x01BA, 2], // something with a character
    [0x01BD, 1],
    [0x01BF, 0],
    [0x01C4, 1],
    [0x01CC, 0],
    [0x01CE, 0], // bind effect to actor?
    [0x01CF, 0], // something with actor
    [0x01D0, 0], // calls 01DF with worker index
    [0x01D1, 1], // debugging wait?
    [0x01DA, 4],
    [0x01DC, 0],
    [0x01DF, 1], // sets a flag on an actor's worker
    [0x01E2, 0],
    [0x01E4, 4],
    [0x01E5, 3],
    [0x01E6, 3],
    [0x01E9, 2], // text box related
    [0x01EB, 1],
    [0x01F2, 0], // get aeon list?
    [0x0201, 0], // disable footsteps + something else
    [0x0206, 0],
    [0x0207, 0],
    [0x0213, 1],
    [0x0220, 1],
    [0x022E, 4],
    [0x023F, 1],
    [0x0241, 1],
    [0x0256, 1], // set a text box value
    [0x0257, 1], // clear a text box value
    [0x1000, 4],
    [0x4001, 1],
    [0x4014, 1],
    [0x4015, 2],
    [0x4016, 2],
    [0x4017, 2],
    [0x4019, 1], // arg is unused?
    [0x401A, 1],
    [0x401F, 0], // free all actor data?
    [0x4020, 0], // free actor resources
    [0x4022, 1],
    [0x4036, 3], // set wind parameters
    [0x403B, 2],
    [0x403C, 1], // set some actor y position, water-related???
    [0x4045, 1], // sets something checked during player update?
    [0x5009, 1],
    [0x500C, 1], // does nothing
    [0x500D, 1], // depth flag?
    [0x500F, 1], // disable actor collision
    [0x5013, 1],
    [0x5014, 2],
    [0x5015, 4],
    [0x5020, 0],
    [0x5021, 1],
    [0x5022, 1],
    [0x502A, 1],
    [0x5034, 1],
    [0x503A, 1], // set actor distance cutoff?
    [0x503C, 1],
    [0x503D, 1], // unload actor
    [0x5041, 5], // 41-46 alternate the same logic, extra arg is index for another actor
    [0x5042, 5],
    [0x5043, 6],
    [0x5044, 6],
    [0x5045, 6],
    [0x5046, 6],
    [0x504C, 2],
    [0x5056, 1], // set processed (?) flag on this actor
    [0x5058, 1], // set processed (?) flag on all actors
    [0x505C, 1],
    [0x505D, 0],
    [0x5067, 1], // flag
    [0x506F, 1], // technically conditional on the worker having an actor
    [0x5073, 1], // flags
    [0x5076, 1],
    [0x5079, 1],
    [0x507A, 1],
    [0x507E, 2],
    [0x5085, 1], // shadow offset height
    [0x508E, 1],
    [0x6000, 1],
    [0x6001, 1],
    [0x6002, 3], // camera position
    [0x6003, 3],
    [0x6004, 3],
    [0x6005, 3],
    [0x6006, 6],
    [0x6007, 6],
    [0x6008, 6],
    [0x600F, 0],
    [0x6010, 1],
    [0x6011, 1],
    [0x6012, 1],
    [0x6014, 4],
    [0x6015, 4],
    [0x6016, 0],
    [0x6019, 0],
    [0x601A, 0], // wait for camera
    [0x601D, 4],
    [0x601E, 2],
    [0x6020, 3], // set camera target position
    [0x6021, 3], // get camera target position
    [0x6027, 3],
    [0x6029, 5],
    [0x602B, 3],
    [0x602D, 0],
    [0x602E, 1],
    [0x6030, 1],
    [0x6032, 4],
    [0x6034, 0],
    [0x6035, 4],
    [0x6038, 0],
    [0x603A, 1], // camera roll
    [0x603B, 1], // camera value
    [0x603C, 4], // camera
    [0x6042, 1],
    [0x6043, 1],
    [0x6045, 6],
    [0x6046, 4],
    [0x6047, 4],
    [0x6048, 0],
    [0x6049, 0],
    [0x604A, 0],
    [0x604B, 0], // 5E, 68, 6B just differ in one argument
    [0x605A, 3],
    [0x605B, 2],
    [0x605C, 5],
    [0x605D, 5],
    [0x605E, 6],
    [0x605F, 0],
    [0x6060, 0],
    [0x6063, 0],
    [0x6064, 1], // actually a wait function
    [0x6068, 6],
    [0x606B, 6],
    [0x6071, 6],
    [0x6076, 0],
    [0x607E, 1],
    [0x607F, 2],
    [0x6087, 0],
    [0x6088, 0],
    [0x7001, 1],
    [0x7022, 1],
    [0x703C, 1],
    [0x70A2, 1], // load battle file
    [0x70A4, 0],
    [0x800F, 1],
    [0x8010, 1],
    [0x8011, 3],
    [0x801D, 2],
    [0x801E, 1],
    [0x802C, 0],
    [0x8030, 2],
    [0x8032, 1], // some guidemap field
    [0x804F, 3],
    [0x805E, 1],
    [0xB000, 2], // play movie
    [0xB001, 0],
    [0xB004, 0],
    [0xB009, 0],
    [0xC02F, 2], // some camera threshold height
]);

const enum BlitzballAction {
    PASS,
    SHOOT,
    DRIBBLE,
}

interface TextVarState {
    value: number,
    mode: number,
}

interface Trigger {
    t: number;
    fn: () => void;
}

const scratchVec = vec3.create();
export class EventScript {
    public workers: Worker[] = [];
    private signalPool: Signal | null;

    private finishedInit = false;
    public mapID = -1;
    public mapEntranceID = 0;
    private flags = 0;
    public globals: number[] = [];
    private textVars = nArray(16, () => ({value: 0, mode: -1} as TextVarState));

    private miscFloat = 179; // ?????
    private miscInt = 0;
    private unkFlags = 0;
    private isBlitzball = false;

    public previousMap = 0;
    public previousEvent = 0;

    public triggers: Trigger[] = [];
    private modelsToLoad: number[] = [];

    public eventData: BIN.EventData | null = null;

    static async fromEvent(data: BIN.EventData, objects: LevelObjectHolder, mapID: number, globals: number[], renderer: FFXRenderer): Promise<EventScript> {
        const script = new EventScript(data.script, objects);
        script.eventData = data;
        script.mapID = mapID;
        script.globals = globals;
        script.isBlitzball = data.script.name === "bltz0000";

        script.initGlobals();
        let i = 0;
        // run worker init code
        while (!script.update(1)) {
            i++;
            if ( i > 10) {
                debugger
                break;
            }
            if (script.modelsToLoad.length > 0) {
                await Promise.all(script.modelsToLoad.map(m => renderer.loadAndParseActorModel(m)));
                script.modelsToLoad = [];
            }
        }
        script.update(0); // first real frame
        script.addButtons();
        return script;
    }

    constructor(public data: BIN.ScriptData, private objects: LevelObjectHolder) {
        let prev: Signal | null = null;
        for (let i = 0; i < 10*data.workers.length; i++) {
            const newSignal: Signal = {
                type: SignalType.NO_ACK,
                source: -1,
                target: -1,
                thread: -1,
                entry: -1,
                status: SignalStatus.NEW,
                prev: prev,
                next: null,
            };
            if (prev === null)
                this.signalPool = newSignal;
            else
                prev.next = newSignal;
            prev = newSignal;
        }
        for (let i = 0; i < data.workers.length; i++) {
            const spec = data.workers[i];
            if (spec.type === BIN.WorkerType.NONE)
                break;
            const c = new Worker(this, spec, i);
            this.workers.push(c);
            // push signals for init (high priority) and main logic (lowest priority)
            this.sendSignal(SignalType.NO_ACK, -1, i, 7, 0);
            this.sendSignal(SignalType.NO_ACK, -1, i, 0, 1);
            c.decodeSignal(10);
        }
    }

    public deleteSignal(signal: Signal): void {
        if (signal.next !== null)
            signal.next.prev = signal.prev;
        if (signal.prev !== null)
            signal.prev.next = signal.next;
        signal.prev = null;
        signal.next = this.signalPool;
        if (this.signalPool !== null)
            this.signalPool.prev = signal;
        this.signalPool = signal;
    }

    public ack(signal: Signal): boolean {
        return this.sendSignal(SignalType.ACK, signal.target, signal.source, signal.thread, signal.entry);
    }

    public sendSignal(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        if (target < 0)
            return false;
        if (this.workers[target].flags & WorkerFlags.ERROR)
            return false;
        const sig = this.signalPool!;
        this.signalPool = this.signalPool!.next;
        sig.type = type;
        sig.source = source;
        sig.target = target;
        sig.thread = clamp(thread, 0, threadCount(this.data.workers[target]) - 1);
        sig.entry = entry;
        sig.status = SignalStatus.NEW;
        let other = this.workers[target].signalQueue;
        if (other === null || compareSignals(sig, other) < 0) {
            sig.prev = null;
            sig.next = other;
            if (other !== null)
                other.prev = sig;
            this.workers[target].signalQueue = sig;
        } else {
            while (other.next !== null && compareSignals(sig, other.next) >= 0) {
                other = other.next;
            }
            sig.next = other.next;
            if (other.next !== null)
                other.next.prev = sig;
            other.next = sig;
            sig.prev = other;
        }
        if (source >= 0 && this.workers[source].flags & WorkerFlags.UPDATE_HIGH)
            this.workers[source].nextCount = 1;
        return true;
    }

    public sendSignalForEntry(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        for (let sig = this.workers[target].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
            if (sig.entry === entry)
                return false;
        }
        return this.sendSignal(type, source, target, thread, entry);
    }

    public sendSignalForThread(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        for (let sig = this.workers[target].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
            if (sig.thread === thread) {
                // console.warn(`skipping signal to w${target.toString(16)}e${entry.toString(16)} from w${source.toString(16)} due to existing e${sig.entry.toString(16)} from w${sig.source.toString(16)}`)
                return false;
            }
        }
        return this.sendSignal(type, source, target, thread, entry);
    }

    private tryRun(w: Worker, dt: number, apply: boolean): void {
        if (w.flags & WorkerFlags.ERROR)
            return;
        try {
            this.run(w, dt, apply);
        } catch (e) {
            w.flags |= WorkerFlags.ERROR | WorkerFlags.INIT_DONE;
            console.warn(`error running w${w.index.toString(16)} @ ${hexzero(w.getThread().offset, 4)}`, e);
        }
    }

    private run(w: Worker, dt: number, apply: boolean): void {
        let running = true;
        const thread = w.getThread();
        if ((w.flags & WorkerFlags.ACTIVE) === 0)
            return;
        if (thread.wait === ThreadWaitType.ACK) {
            // we sent a signal, wait for ack
            if (this.workers[thread.waitSource].flags & WorkerFlags.ERROR)
                throw `waiting on errored ${thread.waitSource}`;
            running = false;
            for (let sig = w.signalQueue; sig !== null; sig = sig.next) {
                if (sig.type === SignalType.ACK && sig.entry === thread.waitEntry && sig.thread === thread.waitThread && sig.source === thread.waitSource) {
                    w.deleteOwnSignal(sig);
                    running = true;
                    thread.wait = 0;
                    thread.waitEntry = 0;
                    thread.waitSource = 0;
                    thread.waitThread = 0;
                    break;
                }
            }
        } else if (thread.wait === ThreadWaitType.DELETE) {
            // wait for some signal to be deleted
            if (this.workers[thread.waitSource].flags & WorkerFlags.ERROR)
                throw `waiting on errored ${thread.waitSource}`;
            for (let sig = this.workers[thread.waitSource].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
                if (sig.entry === thread.waitEntry) {
                    running = false;
                    break;
                }
            }
            if (running) {
                thread.wait = 0;
                thread.waitEntry = 0;
                thread.waitSource = 0;
                thread.waitThread = 0;
            }
        }
        let counter = 0;
        while (running || !w.stack.empty()) {
            counter++;
            if (counter > 0x1000 && !this.isBlitzball)
                throw `running too long`;
            let nextOffset = thread.offset;
            const rawOp = this.data.code.getUint8(nextOffset++);
            let imm = 0;
            if ((rawOp & 0x80) !== 0) {
                imm = this.data.code.getUint16(nextOffset, true);
                nextOffset += 2;
            }
            const op: Opcode = rawOp & 0x7F;
            if (op === Opcode.NOP || op === Opcode.NOP_1D || op === Opcode.NOP_1E || op === Opcode.NOP_76) {
                // nothing
            } else if (op === Opcode.OR_LOGIC) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a !== 0 || b !== 0 ? 1 : 0);
            } else if (op === Opcode.AND_LOGIC) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a !== 0 && b !== 0 ? 1 : 0);
            } else if (op === Opcode.OR) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a | b);
            } else if (op === Opcode.XOR) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a ^ b);
            } else if (op === Opcode.AND) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a & b);
            } else if (op === Opcode.EQ) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a === b ? 1 : 0);
            } else if (op === Opcode.NEQ) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a !== b ? 1 : 0);
            } else if (op === Opcode.LTU || op === Opcode.LT) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a < b ? 1 : 0);
            } else if (op === Opcode.GTU || op === Opcode.GT) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a > b ? 1 : 0);
            } else if (op === Opcode.LTEU || op === Opcode.LTE) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a <= b ? 1 : 0);
            } else if (op === Opcode.GTEU || op === Opcode.GTE) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a >= b ? 1 : 0);
            } else if (op === Opcode.BIT) {
                const a = w.stack.pop() & 0x1F;
                const b = w.stack.pop();
                w.stack.push((b >> a) & 1);
            } else if (op === Opcode.NOT_BIT) {
                const a = w.stack.pop() & 0x1F;
                const b = w.stack.pop();
                w.stack.push(((b >> a) & 1) ^ 1);
            } else if (op === Opcode.SLL) {
                const a = w.stack.pop() & 0x1F;
                const b = w.stack.pop();
                w.stack.push(b << a);
            } else if (op === Opcode.SRA) {
                const a = w.stack.pop() & 0x1F;
                const b = w.stack.pop();
                w.stack.push(b >> a);
            } else if (op === Opcode.ADD) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a + b);
            } else if (op === Opcode.SUB) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(b - a);
            } else if (op === Opcode.MUL) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                w.stack.push(a*b);
            } else if (op === Opcode.DIV) {
                const a = w.stack.pop();
                const b = w.stack.pop();
                // ugh, this seems like the one thing that really depends on data types
                w.stack.push((b/a) | 0);
            } else if (op === Opcode.MOD) {
                const a = w.stack.pop() | 0;
                const b = w.stack.pop() | 0;
                w.stack.push(b % a);
            } else if (op === Opcode.NOT_LOGIC) {
                const a = w.stack.pop();
                w.stack.push(a === 0 ? 1 : 0);
            } else if (op === Opcode.NEG) {
                const a = w.stack.pop();
                w.stack.push(-a);
            } else if (op === Opcode.NOT) {
                const a = w.stack.pop();
                w.stack.push(~a);
            } else if (op === Opcode.GET_DATUM) {
                w.stack.push(this.readVariable(w, imm));
            } else if (op === Opcode.SET_DATUM_W || op === Opcode.SET_DATUM_T) {
                const rawValue = w.stack.pop();
                this.storeToVariable(w, imm, 0, rawValue, op === Opcode.SET_DATUM_T);
            } else if (op === Opcode.GET_DATUM_INDEX) {
                w.stack.push(this.readVariable(w, imm, w.stack.pop()));
            } else if (op === Opcode.SET_DATUM_INDEX_W || op === Opcode.SET_DATUM_INDEX_T) {
                const rawValue = w.stack.pop();
                const index = w.stack.pop();
                this.storeToVariable(w, imm, index, rawValue, op === Opcode.SET_DATUM_INDEX_T);
            } else if (op === Opcode.SET_RETURN_VALUE) {
                thread.return = w.stack.pop();
            } else if (op === Opcode.GET_RETURN_VALUE) {
                w.stack.push(thread.return);
            } else if (op === Opcode.GET_DATUM_DESC) {
                const index = w.stack.pop();
                // we should reconstruct the description here, but we aren't going to use it, anyway
                w.stack.push(imm);
            } else if (op === Opcode.GET_TEST) {
                w.stack.push(thread.test);
            } else if (op === Opcode.GET_CASE) {
                w.stack.push(thread.case);
            } else if (op === Opcode.SET_TEST) {
                thread.test = w.stack.pop();
            } else if (op === Opcode.COPY) {
                w.stack.copy();
            } else if (op === Opcode.SET_CASE) {
                thread.case = w.stack.pop();
            } else if (op === Opcode.CONST_INT) {
                w.stack.push(this.data.intConsts[imm]);
            } else if (op === Opcode.IMM) {
                // treat the immediate as signed
                if ((imm & 0x8000) === 0)
                    w.stack.push(imm);
                else
                    w.stack.push(imm - 0x10000);
            } else if (op === Opcode.CONST_FLOAT) {
                w.stack.push(this.data.floatConsts[imm]);
            } else if (op === Opcode.JUMP || op === Opcode.SET_JUMP) {
                if (op === Opcode.SET_JUMP)
                    thread.test = w.stack.pop();
                if (w.debug)
                    console.log(`w${hexzero(w.index,2)} jump to ${hexzero(imm,2)} (${thread.offset.toString(16)})`);
                thread.goToLabel(imm);
                continue;
            } else if (op === Opcode.BNEZ || op === Opcode.SET_BNEZ) {
                if (op === Opcode.SET_BNEZ)
                    thread.test = w.stack.pop();
                if (thread.test !== 0) {
                    thread.goToLabel(imm);
                    if (w.debug)
                        console.log(`w${hexzero(w.index,2)} jump to ${hexzero(imm,2)} (${thread.offset.toString(16)})`);
                    continue;
                }
            } else if (op === Opcode.BEZ || op === Opcode.SET_BEZ) {
                if (op === Opcode.SET_BEZ)
                    thread.test = w.stack.pop();
                if (thread.test === 0) {
                    thread.goToLabel(imm);
                    if (w.debug)
                        console.log(`w${hexzero(w.index,2)} jump to ${hexzero(imm,2)} (${thread.offset.toString(16)})`);
                    continue;
                }
            } else if (op === Opcode.CALL) {
                thread.callWorker(imm);
                continue;
            } else if (op === Opcode.RETURN) {
                thread.returnFromWorker();
                continue;
            } else if (op === Opcode.FUNC_RET || op === Opcode.FUNC) {
                if (!thread.ranInit) {
                    thread.ranInit = true;
                    // if (w.debug)
                    //     console.log(`w${hexzero(w.index,2)} call ${imm.toString(16)}`);
                    this.initScriptFunc(w, imm);
                }
                if (this.checkScriptFunc(w, imm, dt)) {
                    thread.ranInit = false;
                    const returnValue = this.runScriptFunc(w, imm, dt);
                    if (op === Opcode.FUNC_RET)
                        w.stack.push(returnValue);
                    else
                        thread.return = returnValue;
                    // 0 is game accurate, others are a hack to deal with camera motion loops
                    if ((imm === 0 || imm === 0x601A || imm === 0x6038 || imm === 0x0102) && w.stack.empty())
                        running = false;
                } else
                    break;
            } else if (isSignal(op)) {
                const entry = w.stack.pop();
                const target = w.stack.pop();
                const threadIndex = w.stack.pop();
                let signalType = SignalType.NO_ACK;
                const opOffset = op - Opcode.SIGS_LOW;
                if (op === Opcode.SIG_ONSTART || (opOffset >= 5 && opOffset < 10))
                    signalType = SignalType.ON_START;
                else if (op === Opcode.SIG_ONEND || opOffset >= 10)
                    signalType = SignalType.ON_END;

                if (opOffset > 0 && opOffset % 5 >= 2) {
                    // pre signal handler
                }
                let sent = false;
                if (w.debug)
                    console.log(`w${hexzero(w.index,2)} signal w${hexzero(target,2)}e${entry.toString(16)}`)
                if (opOffset < 0 || opOffset % 5 === 2)
                    sent = this.sendSignalForThread(signalType, w.index, target, threadIndex, entry);
                else if (opOffset % 5 === 0 || opOffset % 5 === 3)
                    sent = this.sendSignal(signalType, w.index, target, threadIndex, entry);
                else
                    sent = this.sendSignalForEntry(signalType, w.index, target, threadIndex, entry);

                if (sent && signalType !== SignalType.NO_ACK) {
                    thread.wait = ThreadWaitType.ACK;
                    thread.waitSource = target;
                    thread.waitThread = threadIndex;
                    thread.waitEntry = entry;
                    running = false;
                }
                w.stack.push(sent ? 1 : 0);
            } else if (op === Opcode.SIG_NOACK_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SIG_1_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SIG_2_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.END) {
                w.finishThread(-1, false);
                break;
            } else if (op === Opcode.CLEANUP_END) {
                w.finishThread(w.stack.pop(), false);
                break;
            } else if (op === Opcode.TO_MAIN) {
                w.finishThread(-1, true);
                break;
            } else if (op === Opcode.CLEANUP_TO_MAIN) {
                w.finishThread(w.stack.pop(), true);
                break;
            } else if (op === Opcode.CLEANUP_ALL_END) {
                w.finishThread(0, false);
                break;
            } else if (op >= Opcode.SET_INT && op < Opcode.SET_FLOAT) {
                w.intVars[op - Opcode.SET_INT] = w.stack.pop();
            } else if (op >= Opcode.SET_FLOAT && op < Opcode.GET_INT) {
                w.floatVars[op - Opcode.SET_FLOAT] = w.stack.pop();
            } else if (op >= Opcode.GET_INT && op < Opcode.GET_FLOAT) {
                w.stack.push(w.intVars[op - Opcode.GET_INT]);
            } else if (op >= Opcode.GET_FLOAT && op < Opcode.TEX_UNPACK_IMM) {
                w.stack.push(w.floatVars[op - Opcode.GET_FLOAT]);
            } else if (op === Opcode.TEX_UNPACK_IMM) {
            } else if (op === Opcode.WAIT_DELETE) {
                const entry = w.stack.pop();
                const target = w.stack.pop();
                for (let sig = assertExists(this.workers[target]).signalQueue; sig !== null; sig = sig.next) {
                    if (sig.type !== SignalType.ACK && sig.entry === entry) {
                        running = false;
                        thread.waitEntry = entry;
                        thread.waitSource = target;
                        thread.wait = ThreadWaitType.DELETE;
                        break;
                    }
                }
            } else if (op === Opcode.WAIT_SPEC_DELETE) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.EDIT_ENTRY_TABLE) {
                const entry = w.stack.pop();
                const thread = w.stack.pop();
                const array = w.stack.pop();
                console.log(`set default for t${thread} to s${hexzero(w.index, 2)}e${hexzero(entry, 2)}`);
                w.flags &= ~WorkerFlags.COLLISION_ACTIVE; // assume this is disabling interaction
            } else if (op === Opcode.SET_EDGE_TRIGGER) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else {
                throw `unknown op ${hexzero(op, 2)}`;
            }
            thread.offset = nextOffset;
            thread.ranInit = false;
        }

        if (apply)
            w.apply(this.objects.parts, dt);

    }

    private resolveAll(dt: number, force: boolean, resetCounters: boolean): void {
        // this whole function is written as a loop, but we're missing the logic that would make it happen
        // player interaction stuff here?
        for (let i = 0; i < this.workers.length; i++) {
            const w = this.workers[i];
            if (force || w.pendingCount > 0) {
                this.tryRun(w, dt, force);
            }
        }
        for (let i = 0; i < this.workers.length; i++) {
            const w = this.workers[i];
            if (force) {
                w.decodeSignal(-1);
                w.pendingCount = w.nextCount;
            } else {
                if (w.nextCount !== 0)
                    w.pendingCount = w.nextCount;
                if (w.pendingCount !== 0) {
                    w.pendingCount--;
                    w.decodeSignal(-1);
                }
            }
            if (resetCounters)
                w.flags &= ~WorkerFlags.UPDATE_HIGH;
        }
    }

    public update(dt: number): boolean {
        if (!this.finishedInit) {
            let allDone = true;
            for (let i = 0; i < this.workers.length; i++) {
                const w = this.workers[i];
                if ((w.flags & WorkerFlags.INIT_DONE) === 0) {
                    this.tryRun(w, dt, true);
                }
                if ((w.flags & WorkerFlags.INIT_DONE) === 0) {
                    allDone = false;
                }
            }
            this.finishedInit = allDone;
            if (allDone) {
                for (let i = 0; i < this.workers.length; i++) {
                    this.workers[i].decodeSignal(-1);
                }
            }
        } else {
            this.resolveAll(dt, true, false);
            this.resolveAll(dt, false, false);
            this.resolveAll(dt, false, true);
        }

        this.checkTriggers();
        return this.finishedInit;
    }

    public initScriptFunc(c: Worker, id: number): void {
        if (id === 0) {
            c.getThread().waitData = c.stack.pop();
            switch (this.data.name) {
                case "bjyt0400":
                    // don't wait for fire lighting animation
                    if (c.getThread().waitData > 1)
                        c.getThread().waitData = 1;
                    break;
                case "dome0700":
                    // pedestals wait for the camera to show the screen changing
                    if (c.index >= 0x2C && c.index <= 0x2F)
                        c.getThread().waitData = 1;
                    break;
                case "djyt0600":
                    if (c.index === 0x2C && c.getThread().waitData === 45)
                        c.getThread().waitData = 1;
                    if (c.actor && c.actor.id === 0x5071)
                        c.getThread().waitData = .5;
                    break;
                case "mcyt0500":
                    if (c.actor && c.actor.id === 0x5074)
                        c.getThread().waitData = .5;
                    if (c.index === 0x1E && c.getThread().waitData > 30)
                        c.getThread().waitData = 1;
                    if (c.index === 0x10)
                        c.getThread().waitData = 1;
                    break;
                case "cdsp0700":
                    if (c.index === 1 && c.getThread().waitData > 150)
                        c.getThread().waitData = 1;
            }
            if (!(c.flags & WorkerFlags.INIT_DONE))
                c.getThread().waitData = .5; // don't wait long during init
        } else if (id === 0x13B || id === 0x13C) {
            // wait on choice prompts
            c.getThread().waitData = 1;
        } else if (id === 0x00F6) {
            c.getThread().waitData = c.stack.pop();
            c.getThread().moreWaitData = Math.max(c.stack.pop(), 1);
        } else if (id === 0x7002) {
            const transition  = c.stack.pop();
            const encounter = c.stack.pop();
            console.log("starting battle", encounter.toString(16), transition);
            this.objects.inBattle = true;
        } else if (id === 0x8004) {
            c.getThread().waitData = c.stack.pop();
        } else if (id === 0x8005) {
            c.stack.pop();
            c.getThread().waitData = c.stack.pop();
        } else if (id === 0x601A) {
            c.getThread().waitData = 1; // force camera to wait
        } else if (id === 0x0001 || id === 0x0134) {
            // loading a model, game doesn't actually have a wait here
            const id = c.stack.pop();
            c.getThread().waitData = id;
        }
    }

    public setFlagBit(scriptIndex: number, bitIndex: number, on: boolean): number {
        const mask = 1 << bitIndex;
        const out = (this.flags & mask) !== 0;
        if (on)
            this.flags |= mask;
        else
            this.flags &= ~mask;
        return out ? 1 : 0;
    }

    public checkScriptFunc(c: Worker, id: number, dt: number): boolean {
        if (id === 0 || id === 0x13B || id === 0x13C || id === 0x601A) {
            c.getThread().waitData -= dt;
            return c.getThread().waitData <= 0;
        } else if (id === 0x005F)
            return false;
        else if (id === 0x001A) {
            const mask = c.getThread().motion.flags & MotionFlags.TYPE_MASK;
            return mask === 0;
        } else if (id === 0x001B)
            return (c.getThread().rotation.flags & RotationFlags.TYPE_MASK) === 0;
        else if (id === 0x00F6) {
            const index = c.getThread().waitData;
            if (index < 0)
                return true;
            const other = this.workers[index];
            const minThread = c.getThread().moreWaitData;
            for (let curr = other.signalQueue; curr; curr = curr.next) {
                if (curr.type === SignalType.ACK)
                    continue;
                if (curr.thread >= minThread)
                    return false;
            }
            return true;
        } else if (id === 0x0195) {
            if (this.data.name === "znkd0900" && c.index === 0x39) {
                return this.objects.magic[0].active;
            }
        } else if (id === 0x5003) {
            return !c.actor || !c.actor.model || !c.actor.animation.running;
        } else if (id === 0x501E) {
            return !c.actor || !c.actor.model || c.actor.animation.isDefault;
        } else if (id === 0x7002) {
            // not really correct, actually all script processing is suspended until the battle ends
            return !this.objects.inBattle;
        } else if (id === 0x8004 || id === 0x8005) {
            if (this.data.name === "djyt0600" && c.index === 0x2C)
                return true;
            const e = getFirstEmitter(this.objects, c.getThread().waitData);
            return !e || e.waitTimer === EMITTER_DONE_TIMER;
        } else if (id === 0x0001 || id === 0x0134) {
            // if we requested a model during init, pause the script until we actually loaded the file
            const id = c.getThread().waitData;
            if (c.flags & WorkerFlags.INIT_DONE)
                return true;
            const res = this.objects.actorResources.get(id);
            if (res && (res.fetched & 1) !== 0)
                return true;
            this.modelsToLoad.push(id);
            return false;
        }
        return true;
    }

    private storeToVariable(c: Worker, varIndex: number, eltIndex: number, rawValue: number, truncate: boolean): void {
        const arr = assertExists(this.data.arrays[varIndex]);
        const value = truncate ? truncateValue(rawValue, arr.elementType) : wrapValue(rawValue, arr.elementType);
        if (arr.values) {
            arr.values[eltIndex] = value;
        } else if (arr.source === BIN.ArraySource.GLOBAL) {
            this.globals[arr.offset + eltIndex*BIN.byteSize(arr.elementType)] = value;
        } else if (arr.source === BIN.ArraySource.PRIVATE) {
            assertExists(c.privateArrays[varIndex])[eltIndex] = value;
        } else
            console.warn(`ignoring write of ${value} to var${varIndex.toString(16)}[${eltIndex}] (${BIN.ArraySource[arr.source]}+${arr.offset.toString(16)})`);
    }

    private readVariable(c: Worker, varIndex: number, eltIndex = 0): number {
        const arr = assertExists(this.data.arrays[varIndex]);
        const index = clamp(eltIndex, 0, arr.count - 1);
        if (arr.values) {
            return arr.values[index];
        } else if (arr.source === BIN.ArraySource.GLOBAL) {
            return this.globals[arr.offset + index*BIN.byteSize(arr.elementType)] || 0;
        } else if (arr.source === BIN.ArraySource.PRIVATE) {
            return assertExists(c.privateArrays[varIndex])[index];
        }
        console.warn("getting", arr, "from", c.index)
        return 0;
    }

    private storeToArbitraryArray(c: Worker, desc: number, value: number): void {
        for (let i = 0; i < this.data.arrays.length; i++) {
            const arr = this.data.arrays[i];
            const delta = desc - arr.rawDesc;
            if (delta < 0 || delta > 0xFFFFFF)
                continue;
            const index = delta / BIN.byteSize(arr.elementType);
            if (index >= arr.count)
                continue;
            assert(index === (index | 0));
            this.storeToVariable(c, i, index, value, true);
            return;
        }
        throw `couldn't resolve ${desc.toString(16)} to a variable`;
    }

    public formatString(w: Worker, index: number): string {
        const info = this.eventData?.strings[index];
        if (!info)
            return "";
        let out = info.raw;
        for (let i = 0; i < info.seq.length; i++) {
            const part = info.seq[i];
            out = out.replaceAll(`{${i}}`, this.processStringVar(part.type, part.argument));
        }
        return out;
    }

    private processStringVar(type: BIN.ControlChar, argument: number): string {
        switch (type) {
            case BIN.ControlChar.VAR: {
                const tVar = this.textVars[argument];
                switch (tVar.mode) {
                    case 0:
                        return '<raw string>'; // set by 013F
                    case 1: case 2:
                        return tVar.value.toString(); // 2 should have comma separators
                    case 0x33:
                        return `ITEM[${tVar.value}]`;
                    case 0x34:
                        return `EQUIP[${tVar.value}]`;
                    case 0x35:
                        return `BATTLE[${tVar.value.toString(16)}]`;
                    case 0x36:
                        return `ABILITY[${tVar.value}]`;
                }
                if (tVar.mode >= 0x13 && tVar.mode < 0x24) {
                    tVar.mode += (tVar.value / 0xD0) | 0;
                    tVar.value %= 0xD0;
                    return this.processStringVar(tVar.mode, tVar.value);
                }
                if (tVar.mode >= 0x2B && tVar.mode <= 0x32 ) {
                    const asString = tVar.value.toString();
                    const width = tVar.mode - 0x2A;
                    return leftPad(asString, width);
                }
                return `fmt(${tVar.mode.toString(16)}, ${tVar.value.toString(16)})`;
            }
            case BIN.ControlChar.SPACE: return '    '; // seems like there are multiple different ways the game decides on the number of spaces
            case BIN.ControlChar.COLOR: case BIN.ControlChar.TIMER:
                return '';
        }
        return `${BIN.ControlChar[type]}[${argument}]`;
    }

    public runScriptFunc(c: Worker, id: number, dt: number): number {
        // special casing
        switch (this.data.name) {
            case "sins0400":
                this.objects.cameraPos[1] = 30; break; // set at correct height for pillars
            case "klyt1000": {
                if (c.index === 6 && id === 0x00A3) {
                    vec3.copy(this.objects.pushPosition, c.position.pos);
                    if (this.objects.pressedButton === ButtonPress.UP) {
                        if (c.position.pos[2] < 180 || c.position.pos[0] > 49 && c.position.pos[2] < 205) {
                            this.objects.pushPosition[2] -= 5;
                        } else if (c.position.pos[2] > 204)
                            this.storeToVariable(c, 0x24, 0, 1, false);
                    } else if (this.objects.pressedButton === ButtonPress.RIGHT && c.position.pos[0] < 50) {
                        this.objects.pushPosition[0] -= 5;
                    }
                }
            } break;
            case "bltz0000": {
                if (id === 0x0029 && c.index === 0x12) {
                    // perfectly vertical motion is frame rate dependent right now since it takes time to point upward
                    // this lets blitzball start
                    if (c.motions[c.currThread].endPos[1] === -800) {
                        c.position.miscVec[0] = -Math.PI / 2;
                    }
                }
                if (id === 0x0064) {
                    // reset timer so game never ends
                    // not actually related to 0064 (showing text), but it happens frequently enough
                    this.storeToVariable(c, 0x35, 0, 0, false);
                }
                if (c.currSignal?.entry === 0xA && c.index >= 2 && c.index < 8) {
                    // all players have the same movement code, but the logic for breaking at path waypoints
                    // is behind an if statement checking who has possession. sneakily switch it in time for the check
                    if (id === 0x101B && this.readVariable(c, 0x1A) === 16) {
                        // this function to calculate distance is called twice in the function
                        // the one we don't want is in a loop using variable 0x1A
                        assert(this.readVariable(c, 0xA7) === c.index - 2);
                        this.storeToVariable(c, 0xA7, 0, 123, false);
                    }
                    if (id === 0xE3 && this.readVariable(c, 0xA7) === 123) {
                        this.storeToVariable(c, 0xA7, 0, c.index - 2, false);
                    }
                }
            } break;
        }
        let raw = this.runScriptFuncActual(this.objects, c, id, dt);
        switch (this.data.name) {
            case "bsyt0100": {
                // make elevator go to the bottom
                if (c.index === 0x11 && id === 0x001C && Math.abs(4.3 - c.motions[1].endPos[1]) < .01 && c.motions[1].duration === 100) {
                    c.motions[1].endPos[1] = 140.71045;
                    c.motions[1].duration = 540;
                }
                // the sphere in the door is seemingly blocked by tidus in game
                if (c.actor && c.index === 0xD) {
                    if (c.currSignal?.entry === 10) {
                        c.actor.visible = false;
                        this.objects.particles.emitters[49].visible = false;
                    } else if (c.currSignal?.entry === 11) {
                        c.actor.visible = true;
                        this.objects.particles.emitters[49].visible = true;
                    }
                }
                // hide pedestal when elevator descends (not sure why this is needed)
                if (c.index === 0x11 && c.currSignal?.entry === 7) {
                    this.objects.actors[7]!.visible = false;
                    this.objects.actors[12]!.visible = false;
                    this.objects.particles.emitters[51].visible = false;
                }
            } break;
            case "mcyt0500": {
                if (c.index === 0x13 && id === 0x00A3) {
                    // chest annoyingly checks that you're all the way at the bottom
                    this.storeToVariable(c, 0x62, 0, 76, true);
                }
            } break;
            case "cdsp0700": {
                if ((c.index === 0 || c.index === 2) && id === 0x0018)
                    c.getThread().motion.flags = 0;
            } break;
            case "lchb1500": {
                if (id === 0x010B)
                    this.workers[5].stopThreadMotion(2)
            } break;
            case "znkd0900": {
                if (id === 0x501A && c.index === 2) {
                    const anim = assertExists(c.actor).animation;
                    if (anim.id === 0x10AA1019)
                        anim.loops = 2;
                } else if (id === 0x0013 && c.position.pos[1] < -135) {
                    // make tanker fall line up better
                    vec3.set(c.position.pos, 283, 83, -128);
                    vec3.copy(assertExists(c.actor).pos, c.position.pos);
                } else if (id === 0x8000 && this.objects.parts[27].visible) {
                    for (let i = 3; i <= 9; i++) {
                        assertExists(this.objects.actors[i]).visible = false;
                    }
                } else if (id === 0x5008 && (c.index === 0 || c.index === 1)) {
                    // keep them hidden during tanker sequence?
                    // if (c.actor)
                    //     c.actor.visible = false;
                }
            } break;
            case "cdsp0200": {
                if (id === 0x0018) {
                    if (c.index === 4 && c.currSignal?.entry === 10) {
                        c.getThread().motion.t -= 70; // delay oblitzerator until the platform actually moves
                    }
                    if (c.index === 0xD && c.currSignal?.entry === 6) {
                        this.workers[4].getThread().motion.t = 0;
                    }
                }
            } break;
            case "sins0400": {
                if (id === 0x101A)
                    raw /= 2; // trigger pillars more
            } break;
        }
        return raw;
    }

    private startMagic(id: number): void {
        for (let i = 0; i < this.objects.magic.length; i++)
            if (this.objects.magic[i].id === id) {
                const m = this.objects.magic[i];
                m.reset();
                m.active = true;
                break;
            }
    }

    private checkTriggers(): void {
        for (let i = 0; i < this.triggers.length; i++) {
            if (this.triggers[i].t <= this.objects.t) {
                this.triggers[i].fn();
                this.triggers.splice(i, 1);
                i--;
            }
        }
    }

    private maybeCreateZoneButton(c: Worker, x: number, z: number): void {
        const r = Math.hypot(x, z);
        switch (this.data.name) {
            case "dome0700": {
                if (c.spec.type === BIN.WorkerType.ZONE)
                    this.basicButton(c, 2, r);
                else if (c.spec.type === BIN.WorkerType.PLAYER_ZONE) {
                    switch (c.index) {
                        case 0x2C: case 0x2D: { // left pedestals
                            const b = this.basicButton(c, 2, 3);
                            b.pos[0] -= 8;
                            b.pos[1] -= 7;
                        } break;
                        case 0x2E: case 0x2F: { // right pedestals
                            const b = this.basicButton(c, 2, 3);
                            b.pos[0] += 8;
                            b.pos[1] -= 7;
                        } break;
                        case 0x33: case 0x34: { // sphere pedestals
                            const b = this.basicButton(c, 2, 3);
                            b.pos[0] += c.index === 0x33 ? -8 : 8;
                            b.pos[1] -= 7;
                            const sphereVar = c.index === 0x33 ? 0xD : 0xE;
                            b.enabledCheck = () => {
                                return (this.readVariable(c, sphereVar) === 0) !== (this.readVariable(c, 9) === 0);
                            };
                        } break;
                        case 0x30: case 0x31: { // second room pedestals
                            const b = this.basicButton(c, 2, 3);
                            b.pos[1] = -10;
                        } break;
                        case 0x35: { // first screen
                            const b = this.basicButton(c, 2, 6);
                            b.pos[1] = -20;
                        } break;
                        case 0x36: {// second screen
                            const b = this.basicButton(c, 2, 8);
                            b.pos[1] = -22;
                            b.pos[2] += 5;
                        } break;
                    }
                }
                return;
            }
            case "bjyt1000": {
                if (c.index >= 0x1E && c.index <= 0x23) {
                    const b = this.oneTimeButton(c.index, 2, 1);
                    vec3.copy(b.pos, c.position.pos);
                    b.pos[0] *= 1.08; // this is slightly dumb, move outwards
                    b.pos[1] -= 6;
                    return;
                }
            }
            case "kino0100": {
                if (c.index === 0x25) {
                    this.oneTimeButton(c.index, 5, r/2);
                } else {
                    // annoyingly, the game doesn't actually disable the "wrong" worker,
                    // since the player can't actually reach it
                    const b = this.basicButton(c, 5, r/2);
                    if (c.index === 0x23)
                        b.enabledCheck = () => {
                            return this.workers[0x18].position.pos[1] > 0;
                        }
                    if (c.index === 0x24)
                    b.enabledCheck = () => {
                        return this.workers[0x18].position.pos[1] < 0;
                    }
                }
                return;
            }
            case "kino0500": {
                if (c.index === 0x26)
                    return;
                const b = this.basicButton(c, 5, r/2);
                if (c.index === 0x27)
                    b.enabledCheck = () => {
                        return this.workers[0x12].position.pos[1] < 1;
                    }
                if (c.index === 0x28)
                    b.enabledCheck = () => {
                        return this.workers[0x12].position.pos[1] > 0;
                    }
                if (c.index === 0x29)
                    b.enabledCheck = () => {
                        return this.workers[0x13].position.pos[1] > 0;
                    }
                if (c.index === 0x2A)
                    b.enabledCheck = () => {
                        return this.workers[0x13].position.pos[1] < 0;
                    }
                return;
            }
            case "bsyt0100": {
                let dir = WallNorm.NONE;
                let variable = -1;
                switch (c.index) {
                    case 0x27: case 0x2B:
                        dir = WallNorm.POSX; break;
                    case 0x28:
                        dir = WallNorm.POSZ;
                        variable = 0x27;
                        break;
                    case 0x29:
                        dir = WallNorm.NONE;
                        variable = 0x27;
                        break;
                    case 0x2A:
                        dir = WallNorm.POSX;
                        variable = 0x28;
                        break;
                    case 0x2C:
                        dir = WallNorm.POSZ;
                        variable = 0x2D;
                        break;
                    case 0x2E:
                        dir = WallNorm.NEGZ; break;
                    case 0x25: {
                        const b = Button.Signal(this, this.objects, c.index, 2);
                        b.clickRadius = 3;
                        b.activeRadius = 150;
                        b.enabledCheck = (delta: ReadonlyVec3) => {
                            return delta[2] < 0;
                        }
                        vec3.set(b.pos, -27, -36, 140);
                        return;
                    } case 0x26: {
                        const b = Button.Signal(this, this.objects, c.index, 2);
                        b.clickRadius = 3;
                        b.activeRadius = 100;
                        b.enabledCheck = (delta: ReadonlyVec3) => {
                            return delta[0] > 0;
                        }
                        vec3.set(b.pos, -6, -33, 114);
                        return;
                    } case 0x2D: {
                        const b = Button.Signal(this, this.objects, c.index, 2);
                        b.clickRadius = 4;
                        b.activeRadius = 90;
                        b.enabledCheck = (delta: ReadonlyVec3) => {
                            return delta[2] < 0;
                        }
                        vec3.set(b.pos, -14, 21, -25);
                        return;
                    } default:
                        return;
                }
                const button = this.trialsButton(c.index, dir, variable);
                if (c.index === 0x2C) {
                    vec3.copy(button.pos, assertExists(this.objects.actors[7]).pos);
                    button.pos[1] -= 10;
                    button.pos[2] += 2;
                }
                return;
            }
            case "klyt1000": {
                let dir = WallNorm.NONE;
                // 1F is the one on the glyph wall that rises, I'm cheating a little but it ends up working
                switch (c.index) {
                    case 0x1C:
                        dir = WallNorm.NONE; break;
                    case 0x1D: case 0x1F: case 0x24:
                        dir = WallNorm.NEGZ; break;
                    case 0x1E:
                        dir = WallNorm.NEGX; break;
                    case 0x20: case 0x21: case 0x22: case 0x23:
                        dir = WallNorm.POSX; break;
                    case 0x29: {
                        const b = this.basicButton(c, 2, r);
                        b.activeRadius = 120;
                        return;
                    }
                    default:
                        return;
                }
                const b = this.trialsButton(c.index, dir);
                if (c.index === 0x22)
                    b.pos[1] = -20;
                return;
            }
            case "djyt0600": {
                if (c.index >= 0x30 && c.index <= 0x37) {
                    this.laterTrialsButton(c.index, TrialsLevel.DJOSE);
                } else if (c.index >= 0x38 && c.index <= 0x3C) {
                    const b = this.oneTimeButton(c.index, 2, 5);
                    b.activeRadius = 120;
                    b.enabledCheck = (delta: ReadonlyVec3) => {
                        return delta[1] < 15;
                    }
                    switch (c.index) {
                        case 0x38: vec3.set(b.pos, 31, -73, 118); break;
                        case 0x39: vec3.set(b.pos, 29, -73, 151); break;
                        case 0x3A: vec3.set(b.pos, 0, -73, 168); break;
                        case 0x3B: vec3.set(b.pos, -29, -73, 151); break;
                        case 0x3C: vec3.set(b.pos, -31, -73, 118); break;
                    }
                } else if (c.index === 0x3D) {
                    const b = this.oneTimeButton(c.index, 2, 5);
                    b.activeRadius = 100;
                    vec3.set(b.pos, 0, -25, 181);
                } else if (c.index === 0x3E) {
                    // destruction sphere
                    const b = this.laterTrialsButton(c.index, TrialsLevel.DJOSE);
                    if (c.index === 0x3E)
                        b.activeRadius = 35;
                } else if (c.index === 0x40) {
                    const b = this.oneTimeButton(c.index, 2, 2);
                    b.activeRadius = 100;
                    b.enabledCheck = () => {
                        return this.readVariable(this.workers[1], 0x57) === 1;
                    };
                    vec3.set(b.pos, -64, -23, 40);
                } else if (c.index === 0x43) {
                    const b = new Button(this, this.objects, c.index, ButtonType.PLAYER | ButtonType.COLLISION, () => {
                        this.objects.pressedButton = ButtonPress.NONE;
                        this.sendSignal(SignalType.NO_ACK, -1, c.index, 2, 2);
                    });
                    b.activeRadius = 120;
                    b.clickRadius = r;
                    vec3.copy(b.pos, c.position.pos);
                }
                return;
            }
            case "mcyt0500": {
                if (c.index >= 0x25 && c.index <= 0x2B && c.index !== 0x2A) {
                    this.laterTrialsButton(c.index, TrialsLevel.MACALANIA);
                } else if (c.index === 0x2A) {
                    const b = new Button(this, this.objects, 0xC, ButtonType.PLAYER | ButtonType.COLLISION | ButtonType.ACTOR | ButtonType.INVISIBLE, () => {
                        this.sendSignal(SignalType.NO_ACK, -1, c.index, 2, 2);
                    });
                    b.enabledCheck = () => {
                        if (this.readVariable(this.workers[1], 0x38) === 0)
                            return false;
                        const hasSphere = this.readVariable(this.workers[1], 0x26) !== 0;
                        const holding = this.readVariable(this.workers[1], 0x1F) !== 0;
                        return hasSphere !== holding;
                    };
                    b.activeRadius = 80;
                    b.clickRadius = 1.5;
                } else if (c.index === 0x2E) {
                    const b = new Button(this, this.objects, c.index, ButtonType.PLAYER | ButtonType.COLLISION, () => {
                        this.objects.pressedButton = ButtonPress.NONE;
                        this.sendSignal(SignalType.NO_ACK, -1, c.index, 2, 2);
                    });
                    b.activeRadius = 120;
                    b.clickRadius = r;
                    vec3.copy(b.pos, c.position.pos);
                } else if (c.index === 0x2F) {
                    const b = new Button(this, this.objects, c.index, ButtonType.PLAYER | ButtonType.COLLISION, () => {
                        this.objects.pressedButton = ButtonPress.NONE;
                        this.sendSignal(SignalType.NO_ACK, -1, c.index, 2, 2);
                    });
                    b.activeRadius = 120;
                    b.clickRadius = r;
                    vec3.copy(b.pos, c.position.pos);
                    b.enabledCheck = () => {
                        return this.readVariable(this.workers[1], 0x3A) !== 0;
                    }
                }
                return;
            }
        }
    }

    public runScriptFuncActual(objects: LevelObjectHolder, c: Worker, id: number, dt: number): number {
        switch (id) {
            case 0x0000:
                return 0;
            case 0x0001:
            case 0x0134:
                // in game this is not a wait function, we're doing this to load the file more ergonomically
                const actor = c.getThread().waitData;
                console.info(`loading ${charLabel(actor)} from w${c.index.toString(16)}`);
                c.puppetID = actor;
                c.puppetType = PuppetType.ACTOR;
                const a = new Actor(objects, actor);
                objects.actors[c.index] = a;
                vec3.copy(a.pos, c.position.pos);
                vec3.copy(a.prevPos, c.position.pos);
                a.heading = c.position.velYaw;
                a.targetHeading = c.position.velYaw;
                c.actor = a;
                this.actorButtons(a, objects, c.index);
                return 0;
            case 0x0002: {
                c.stack.pop(); // unused?
                c.stack.pop();
                c.puppetID = c.stack.pop();
                c.puppetType = PuppetType.CAMERA;
                return 0;
            } case 0x0003: {
                c.puppetID = c.stack.pop();
                c.puppetType = 3; // TODO: what
                return 0;
            } case 0x0004: {
                c.puppetID = c.stack.pop();
                c.puppetType = PuppetType.LAYER;
                return 0;
            } case 0x0005: {
                if (c.puppetType === PuppetType.LAYER || c.puppetID === PuppetType.PART) {
                    c.setTransform(this.objects.parts);
                }
                c.puppetID = 0;
                c.puppetType = PuppetType.NONE;
                return 0;
            } case 0x0010: {
                return this.mapEntranceID; // index of map entrance used to get here, might need to set this in some cases?
            }
            case 0x0011:
            case 0x010B: {
                // these differ in a parameter, seems to optionally reset a time value?
                const entrance = c.stack.pop();
                const event = c.stack.pop();
                console.log(`tried to start event ${event.toString(16)} entrance ${entrance} ${c.getThread().offset.toString(16)}`);
                // the script expects to end here, make sure we get back into a good state
                objects.playerActive = true;
                return 0;
            } case 0x0013: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                c.moveTargetTo(x, y, z, false);
                return 0;
            } case 0x0015: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                vec3.set(c.motions[c.currThread].endPos, x, y, z);
                vec3.copy(c.motions[c.currThread].startPos, c.position.pos);
                return 0;
            } case 0x0016: {
                const speed = c.stack.pop();
                c.motions[c.currThread].startSpeed = speed;
                return speed;
            } case 0x0017: {
                const threshold = c.stack.pop();
                c.motions[c.currThread].posThreshold = threshold;
                return threshold;
            } case 0x0018: {
                const target = c.stack.pop();
                const flags = c.stack.pop();
                const threadBits = c.stack.pop();
                c.startThreadMotion(threadBits, flags, target)
                return 0;
            } case 0x0019: {
                const target = c.stack.pop();
                const flags = c.stack.pop();
                const threadBits = c.stack.pop();
                c.startThreadRotation(threadBits, flags, target);
                return 0;
            } case 0x001A: {
                // wait for motion
                return 0;
            } case 0x001B: {
                // wait for rotation
                return 0;
            } case 0x001C: {
                const dt = c.stack.pop();
                const t = c.stack.pop();
                c.getThread().motion.t = t;
                c.getThread().motion.duration = dt;
                return t;
            }
            case 0x001D: {
                const duration = c.stack.pop();
                const t = c.stack.pop();
                const rot = c.getThread().rotation;
                if (duration > 0)
                    rot.duration = duration;
                else
                    rot.duration = 1;
                rot.t = t;
                return t;
            } case 0x001F: {
                const start = c.position.pos;
                const end = c.motions[c.currThread].endPos;
                return Math.atan2(end[2] - start[2], end[0] - start[0]);
            } case 0x0020: {
                const start = c.position.pos;
                const end = c.motions[c.currThread].endPos;
                return Math.asin((end[1]-start[1])/vec3.dist(start, end));
            } case 0x0021: {
                const angle = c.stack.pop();
                //c.motions[c.currThread].someAngleIDK = angle;
                return angle;
            } case 0x0023: {
                const angle = c.stack.pop();
                c.position.velYaw = angle;
                return angle;
            } case 0x0024: {
                const angle = c.stack.pop();
                c.position.velPitch = angle;
                return angle;
            }
            case 0x0025:
            case 0x0026:
            case 0x0027: {
                const index = id === 0x27 ? 2 : 0x26 - id;
                const angle = c.stack.pop();
                c.position.miscVec[index] = angle;
                return angle;
            }
            case 0x0028:
            case 0x0029:
            case 0x002A: {
                const angle = c.stack.pop();
                const rIndex = id - 0x28;
                const mIndex = id === 0x2A ? rIndex : 1 - rIndex;
                c.rotations[c.currThread].target[rIndex] = angle;
                c.rotations[c.currThread].delta[rIndex] = reduceAngle(c.position.miscVec[mIndex] - angle);
                if (c.index === 0) // let's not wait on the player turning
                    c.position.miscVec[mIndex] = angle;
                return angle;
            }
            case 0x002B: {
                const step = c.stack.pop();
                c.motions[c.currThread].yawStep = step;
                return step;
            }
            case 0x002C: {
                const step = c.stack.pop();
                c.motions[c.currThread].pitchStep = step;
                return step;
            }
            case 0x002D: {
                const r = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].posThreshold = r;
                return r;
            }
            case 0x002E:
            case 0x002F:
            case 0x0030: {
                c.rotations[c.currThread].omega[id - 0x2E] = c.stack.pop();
                return 0;
            }
            case 0x0033: {
                const index = c.stack.pop();
                if (index >= 0)
                    return index; // seems weird?
                return c.index;
            }
            case 0x0034: {
                c.threadBitflags |= 1 << c.stack.pop();
                return 0;
            }
            case 0x0035: {
                c.threadBitflags &= ~(1 << c.stack.pop());
                return 0;
            }
            case 0x0036: {
                const other = this.workers[c.stack.pop()];
                for (let i = 0; i < 9; i++) {
                    other.stopThreadMotion(i);
                }
                return 0;
            }
            case 0x0038:
            case 0x0039:
            case 0x003A: {
                const index = c.stack.pop();
                return this.workers[index].position.pos[id - 0x38];
            } case 0x003D: {
                vec3.copy(c.rotations[c.currThread].saved, c.position.miscVec);
                return 0;
            }
            case 0x003F:
            case 0x0040:
            case 0x0041: {
                return c.rotations[c.currThread].saved[id - 0x3F];
            }
            case 0x0042: {
                c.id = c.stack.pop();
                // more logic here
                return c.id;
            } case 0x0043: {
                // set this worker as the player?
                return c.id;
            } case 0x0044: {
                return this.objects.pressedButton;
            } case 0x004C: case 0x004D: {
                c.stack.pop();
                if (this.isBlitzball)
                    return 0;
                // assume this check is coming from clicking a button and we want to simulate the controller button
                return 1;
            } case 0x0054: {
                const ez = c.stack.pop();
                const ey = c.stack.pop();
                const ex = c.stack.pop();
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.PLAYER_EDGE || c.spec.type === BIN.WorkerType.EDGE) {
                    vec3.set(c.position.pos, x, y, z);
                    vec3.set(c.position.miscVec, ex, ey, ez);
                    c.flags |= WorkerFlags.COLLISION_ACTIVE | WorkerFlags.UPDATED_COLLISION;
                    return 1;
                }
                return 0;
            } case 0x0055: {
                const height = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.PLAYER_ZONE || c.spec.type === BIN.WorkerType.ZONE ||
                    c.spec.type === BIN.WorkerType.PLAYER_EDGE || c.spec.type === BIN.WorkerType.EDGE) {
                    c.position.collisionHeight = height;
                    c.flags |= WorkerFlags.UPDATED_COLLISION;
                    return 1;
                }
                return 0;
            }
            // identical
            case 0x0056:
            case 0x005C: {
                const set = c.stack.pop() !== 0;
                // console.log('setting collision', set, "for", c.index, c.spec.type)
                if (c.spec.type !== BIN.WorkerType.UNKNOWN && c.spec.type !== BIN.WorkerType.NONE && c.spec.type !== BIN.WorkerType.MOTION) {
                    c.flags = (c.flags & ~WorkerFlags.COLLISION_ACTIVE) | WorkerFlags.UPDATED_COLLISION;
                    if (set)
                        c.flags |= WorkerFlags.COLLISION_ACTIVE;
                    return 1;
                }
                return 0;
            } case 0x0057: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.PLAYER_ZONE || c.spec.type === BIN.WorkerType.ZONE) {
                    vec3.set(c.position.pos, x, y, z);
                    c.flags |= WorkerFlags.COLLISION_ACTIVE | WorkerFlags.UPDATED_COLLISION;
                    return 1;
                }
                return 0;
            }
            case 0x0058:
            case 0x0059: {
                let height = -1;
                if (id === 0x59)
                    height = c.stack.pop();
                const z = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.PLAYER_ZONE || c.spec.type === BIN.WorkerType.ZONE) {
                    c.position.collisionHeight = height;
                    c.position.miscVec[0] = x;
                    c.position.miscVec[2] = z;
                    c.flags |= WorkerFlags.UPDATED_COLLISION;
                    this.maybeCreateZoneButton(c, x, z);
                    return 1;
                }
                return 0;
            } case 0x005A: {
                const y = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.PLAYER_ZONE || c.spec.type === BIN.WorkerType.ZONE) {
                    c.position.miscVec[1] = y;
                    c.flags |= WorkerFlags.UPDATED_COLLISION;
                }
                return 0;
            } case 0x005D: {
                // console.log("player active", c.index.toString(16));
                objects.playerActive = true;
                return 1;
            } case 0x005E: {
                // console.log(`player inactive (w${c.index.toString(16)})`);
                objects.playerActive = false;
                return 0;
            } case 0x0061: {
                const r = c.stack.pop();
                c.position.interactRadius = r;
                c.flags |= WorkerFlags.UPDATED_COLLISION;
                return r;
            } case 0x0062: {
                const r = c.stack.pop();
                c.position.otherRadius = r;
                c.flags |= WorkerFlags.UPDATED_COLLISION;
                return r;
            } case 0x0063: {
                const range = c.stack.pop();
                c.position.facingAngleRange = range;
                c.flags |= WorkerFlags.UPDATED_COLLISION;
                return range;
            } case 0x0064: {
                const stringIndex = c.stack.pop();
                c.stack.pop();
                // don't print the blitzball logs (for now)
                if (this.isBlitzball && (stringIndex === 0x1B || stringIndex === 0x2F))
                    return 0;
                if (this.eventData)
                    console.log(this.formatString(c, stringIndex), c.getThread().offset.toString(16));
                return 0;
            } case 0x0065: {
                // text box setup
                c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                const boxIndex = c.stack.pop();
                return 0;
            } case 0x0066: {
                // more text box
                c.stack.pop();
                const boxIndex = c.stack.pop();
                return 0;
            } case 0x006A: {
                // lots of text box logic
                c.stack.pop();
                const boxIndex = c.stack.pop();
                return boxIndex;
            } case 0x006B: {
                // text box cleanup
                const boxIndex = c.stack.pop();
                return boxIndex;
            } case 0x006C: {
                const speed = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].startSpeed = speed;
                return speed;
            } case 0x006D: {
                const step = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].yawStep = step;
                return step;
            } case 0x006E: {
                const step = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].pitchStep = step;
                return step;
            } case 0x007C: case 0x0084: {
                // wait for text box to be done?
                let someBool = 0;
                if (id === 0x0084)
                    someBool = c.stack.pop();
                const boxIndex = c.stack.pop();
                return 0;
            }
            case 0x006F:
            case 0x0070:
            case 0x0071: {
                const vel = c.stack.pop();
                for (let i = 0; i < c.rotations.length; i++)
                    c.rotations[i].omega[id - 0x6F] = vel;
                return vel;
            } case 0x0074: {
                const frames = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].turnRateTimeScale = frames;
                return frames;
            } case 0x0076:
                return c.spec.type;
            case 0x0077: {
                this.workers[c.stack.pop()].stopThreadMotion(-1);
            } break;
            case 0x0078: {
                this.workers[c.stack.pop()].stopThreadRotation(-1);
            } break;
            case 0x007A: {
                const distB = c.stack.pop();
                const distA = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.EDGE || c.spec.type === BIN.WorkerType.PLAYER_EDGE) {
                    const currDist = vec3.dist(c.position.pos, c.position.miscVec);
                    if (currDist > 0) {
                        vec3.sub(scratchVec, c.position.miscVec, c.position.pos);
                        vec3.scaleAndAdd(c.position.pos, c.position.pos, scratchVec, -distA/currDist);
                        vec3.scaleAndAdd(c.position.miscVec, c.position.miscVec, scratchVec, distB/currDist);
                    }
                    c.flags |= WorkerFlags.UPDATED_COLLISION;
                    return 1;
                }
                return 0;
            }
            case 0x0080:
            case 0x0081:
            case 0x0082:
                if (this.eventData)
                    return this.eventData.mapPoints[this.mapEntranceID].pos[id - 0x80];
                else
                    return 0;
            case 0x0083:
                if (this.eventData)
                    return this.eventData.mapPoints[this.mapEntranceID].heading;
                else
                    return 0;
            case 0x0085:
                c.position.collisionRadius = c.stack.pop();
                return 1;
            case 0x0086:
                return this.mapID;
            case 0x0088:
                return this.previousMap;
            case 0x0089:
                return this.previousEvent;
            case 0x008D: {
                const step = c.stack.pop();
                //c.position.f_4c = step;
                return step;
            } case 0x008E: {
                const height = c.stack.pop();
                c.position.collisionHeight = height;
                return height;
            } case 0x008F: {
                // is text box done?
                const boxIndex = c.stack.pop();
                return 1;
            } case 0x0090: {
                return c.position.velYaw;
            } case 0x0091: {
                return c.position.miscVec[1];
            } case 0x0092: {
                return this.workers[c.stack.pop()].position.velYaw;
            } case 0x0093: {
                return this.workers[c.stack.pop()].position.miscVec[1];
            } case 0x0094: {
                const g = c.stack.pop();
                c.motions[c.currThread].g = g;
                return g;
            } case 0x0095: {
                if (c.actor)
                    c.actor.flags &= ~ActorFlags.ALLOW_TURNING;
                c.stopThreadRotation(-1);
                const angle = c.stack.pop();
                c.position.velYaw = angle;
                c.position.miscVec[1] = angle;
                c.setTransform(this.objects.parts);
                if (c.actor) {
                    c.actor.heading = angle;
                    c.actor.targetHeading = angle;
                }
                return angle;
            } case 0x0096: {
                c.stopThreadRotation(-1);
                const angle = c.stack.pop();
                c.position.velPitch = angle;
                c.position.miscVec[0] = angle;
                c.setTransform(this.objects.parts);
                return angle;
            } case 0x0097: {
                // get text box state
                const boxIndex = c.stack.pop();
                return 2;
            } case 0x0098: {
                const dt = c.stack.pop();
                const dataPointer = c.stack.pop();
                c.motions[c.currThread].t = 0;
                c.motions[c.currThread].duration = dt;
                assert((dataPointer >>> 24) === 0x78);
                c.motions[c.currThread].dataStart = dataPointer & 0xFFFFFF;
                return 1;
            } case 0x009A: {
                const index = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.EDGE || c.spec.type === BIN.WorkerType.ZONE)
                    c.position.targetIndex = index;
                return index;
            } case 0x009D: {
                // more text box
                c.stack.pop();
                const boxIndex = c.stack.pop();
                return boxIndex;
            } case 0x009E: {
                // technically this should be per box
                const value = c.stack.pop();
                const mode = c.stack.pop();
                const variable = c.stack.pop();
                const boxIndex = c.stack.pop();
                this.textVars[variable].mode = mode;
                this.textVars[variable].value = value;
                return boxIndex;
            }
            case 0x00A3: {
                // put object position into variables
                const zDst = c.stack.pop();
                const yDst = c.stack.pop();
                const xDst = c.stack.pop();

                const index = c.stack.pop();
                const other = this.workers[index];

                let pos = other.position.pos;
                if (index === 0) {
                    if (this.data.name === "djyt0600" || this.data.name === "mcyt0500" || this.data.name === "klyt1000") {
                        pos = this.objects.pushPosition;
                    } else {
                        // player (maybe need to validate?)
                        pos = objects.cameraPos;
                    }
                }
                this.storeToArbitraryArray(c, xDst, pos[0]);
                this.storeToArbitraryArray(c, yDst, pos[1]);
                this.storeToArbitraryArray(c, zDst, pos[2]);
                return 1;
            } case 0x00A4: {
                const first = c.stack.pop();
                const second = c.stack.pop();
                const firstPos = this.workers[first].position.pos;
                const secondPos = this.workers[second].position.pos;
                return vec3.dist(firstPos, secondPos);
            } case 0x00A5: {
                const first = c.stack.pop();
                const second = c.stack.pop();
                let a = first === 0 ? this.objects.cameraPos : this.workers[first].position.pos;
                let b = second === 0 ? this.objects.cameraPos : this.workers[second].position.pos;

                return Math.hypot(a[0]-b[0], a[2]-b[2]);
            } case 0x00A6: {
                const range = Math.max(c.stack.pop(), 1);
                return (Math.random()*range) | 0;
            } case 0x00A7: {
                const index = c.stack.pop();
                console.log('deactivating', index, "from", c.index);
                this.workers[index].flags &= ~WorkerFlags.ACTIVE;
                return 0;
            } case 0x00A8: {
                this.workers[c.stack.pop()].flags |= WorkerFlags.ACTIVE;
                return 1;
            }
            case 0x00B1: {
                const vel = c.stack.pop();
                c.motions[c.currThread].startYVel = vel;
                return vel;
            }
            case 0x00BD: {
                let level = c.stack.pop();
                if (level <= 0)
                    level = 1;
                c.cleanupSignals(level - 1, SignalStatus.OLD);
                return 0;
            }
            case 0x00BF:
            case 0x00C1:
            case 0x00C0:
                if (this.eventData)
                    return this.eventData.mapPoints[c.stack.pop()].pos[id - 0xBF];
                else
                    return 0;
            case 0x00C2:
                if (this.eventData)
                    return this.eventData.mapPoints[c.stack.pop()].heading;
                else
                    return 0;
            case 0x00C5: {
                c.turnAnimations[3] = c.stack.pop();
                c.turnAnimations[2] = c.stack.pop();
                c.turnAnimations[1] = c.stack.pop();
                c.turnAnimations[0] = c.stack.pop();
                break;
            } case 0x00C6: {
                const x = c.rotations[c.currThread].delta[0];
                let flags = x > 0 ? 1 : 0;
                if (Math.abs(x) >= this.miscFloat*MathConstants.DEG_TO_RAD)
                    flags |= 2;
                return flags;
            } case 0x00C7:
                return c.turnAnimations[c.stack.pop()];
            case 0x00C8: {
                // compute time needed for rotation
                const a = c.stack.pop();
                const b = c.stack.pop();
                const flags = c.stack.pop();
                const angle = Math.abs(reduceAngle(c.rotations[c.currThread].target[0] - c.position.miscVec[1]));
                if (flags & 2) {
                    return a*clamp(1.2*angle/Math.PI - .2, 0, 1);
                } else {
                    return b*clamp(2*angle/Math.PI, 0, 1);
                }
            }
            case 0x00C9:
                if (this.eventData)
                    return this.eventData.mapPoints[c.stack.pop()].entrypoint;
                else
                    return 0;
            case 0x00CF: {
                c.savedAnimation = c.stack.pop();
                return 0;
            }
            case 0x00D0:
                return c.savedAnimation;
            case 0x00D1: {
                for (let i = 0; i < c.motions.length; i++)
                    c.stopThreadMotion(i);
                return 0;
            }
            case 0x00D2: {
                for (let i = 0; i < c.motions.length; i++)
                    c.stopThreadRotation(i);
                return 0;
            }
            case 0x00DB: {
                const id = c.stack.pop();
                objects.activeMagic = -1;
                for (let i = 0; i < objects.magic.length; i++)
                    if (objects.magic[i].id === id)
                        objects.activeMagic = i;
                if (objects.activeMagic < 0)
                    console.warn("missing magic", id.toString(16))
                return 0;
            }
            case 0x00DC: {
                if (objects.activeMagic >= 0) {
                    const m = objects.magic[objects.activeMagic];
                    m.reset();
                    m.active = true;
                }
                return 0;
            }
            case 0x00DF: {
                // sound effect?
                c.stack.pop();
                return 0;
            }
            case 0x00E3: {
                const vel = c.stack.pop();
                c.rotations[c.currThread].altOmega = vel;
                return vel;
            }
            case 0x00E4: {
                const vel = c.stack.pop();
                for (let i = 0; i < c.rotations.length; i++)
                    c.rotations[i].altOmega = vel;
                return vel;
            }
            case 0x00E9: {
                const flag = c.stack.pop() !== 0;
                this.setFlagBit(-1, 0xC, flag);
                return flag ? 1 : 0;
            }
            case 0x00EC: {
                const id = c.stack.pop();
                // get the provided id's index in the battle formation?
                // or -1 if not found
                return -1;
            }
            case 0x00ED: {
                return c.id;
            }
            case 0x00EE: {
                const other = this.workers[c.stack.pop()];
                return (other.flags & WorkerFlags.JUST_TURN) ? 1 : 0;
            }
            case 0x00F4: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                const pos = c.position.pos;
                return Math.atan2(z - pos[2], x - pos[0]);
            }
            case 0x00F5: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                const pos = c.position.pos;
                const dx = x - pos[0];
                const dy = y - pos[1];
                const dz = z - pos[2];
                const r = Math.hypot(dx, dy, dz);
                return Math.atan2(dy, r);
            }
            case 0x00F6: {
                // wait for other worker to finish (by thread)
                return 0;
            }
            case 0x010B: {
                const entrance = c.stack.pop();
                const event = c.stack.pop();
                console.log("tried to start event", event, "entrance", entrance);
                // the script expects to end here, make sure we get back into a good state
                objects.playerActive = true;
                return 0;
            } case 0x010D: {
                const index = c.stack.pop();
                // goes through generic "give key item" internally
                if (index < 255) {
                    if (index < 26)
                        this.globals[Global.AlBhedPrimers] |= (1 << index);
                    return 1;
                }
                return 0;
            } case 0x010E: {
                return this.globals[Global.AlBhedPrimers] || 0;
            } case 0x0114: {
                const a = c.stack.pop();
                const b = c.stack.pop();
                this.setFlagBit(-1, 0x11, a !== 0);
                this.setFlagBit(-1, 0x12, b !== 0);
                return 0;
            }
            case 0x0116: case 0x0117: {
                const other = this.workers[c.stack.pop()];
                other.nextCount = 1;
                if (id === 0x0117)
                    other.flags |= WorkerFlags.UPDATE_HIGH;
                return 0;
            }
            case 0x0126: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                c.moveTargetTo(x, y, z, true);
                return 0;
            }
            case 0x0128: {
                const r = c.stack.pop();
                const index = c.stack.pop();
                const dist = vec3.dist(c.position.pos, this.workers[index].position.pos);
                return dist <= r ? 1 : 0;
            }
            case 0x0132:
            case 0x0133: {
                const set = c.stack.pop() !== 0;
                const other = this.workers[c.stack.pop()];
                if (other.spec.type === BIN.WorkerType.MOTION || other.spec.type === BIN.WorkerType.NONE)
                    return 0;
                other.flags &= ~WorkerFlags.COLLISION_ACTIVE;
                other.flags |= WorkerFlags.UPDATED_COLLISION;
                if (set)
                    other.flags |= WorkerFlags.COLLISION_ACTIVE;
                return 1;
            }
            case 0x013B:
            case 0x013C: {
                // presents a choice and waits for a response
                // these present different flags
                c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                c.stack.pop();
                c.stack.pop();
                const textIndex = c.stack.pop();
                const boxIndex = c.stack.pop();
                if (this.eventData)
                    console.log(this.formatString(c, textIndex), (c.getThread().offset.toString(16)));
                return this.getDialogChoice(c.index, textIndex);
            }
            case 0x013E: {
                const set = c.stack.pop() !== 0;
                c.flags &= 0x7FFFFFFF;
                if (set)
                    c.flags |= 0x80000000;
                return set ? 1 : 0;
            }
            case 0x0149: {
                const set = c.stack.pop() !== 0;
                this.setFlagBit(-1, 0x17, set);
                return set ? 1 : 0;
            }
            case 0x014E: {
                const y = c.stack.pop();
                const x = c.stack.pop();
                const r = c.stack.pop();
                if (Math.hypot(x,y) < r)
                    return 0;
                return Math.atan2(y,x);
            }
            case 0x0157: {
                this.unkFlags &= ~(1 << c.stack.pop());
                return 1;
            }
            case 0x015E:
                return this.setFlagBit(0, 0x1E, c.stack.pop() !== 0);
            case 0x0160:
                // key item check
                c.stack.pop();
                return 1;
            case 0x0174:
                return c.position.velPitch;
            case 0x0177: {
                const set = c.stack.pop() !== 0;
                c.flags &= ~0x400000;
                if (set)
                    c.flags |= 0x80400000;
                return set ? 1 : 0;
            }
            case 0x0181:
                return c.position.miscVec[2];
            case 0x0182:
                return this.workers[c.stack.pop()].position.miscVec[2];
            case 0x0183: {
                const angle = reduceAngle(c.stack.pop());
                c.position.miscVec[2] = angle;
                if (c.actor)
                    c.actor.flags &= ~ActorFlags.ALLOW_TURNING;
                if (c.puppetType === PuppetType.LAYER || c.puppetType === PuppetType.PART)
                    c.setTransform(this.objects.parts);
                return angle;
            } case 0x0195: {
                return 0; // wait for magic to start
            } case 0x0196: {
                const emitter = getFirstEmitter(objects, c.stack.pop());
                const target = c.puppetID;
                // console.log("binding emitter", emitter.spec.id, "to", target, c.puppetType);
                if (c.spec.type === BIN.WorkerType.MOTION && emitter) {
                    emitter.bindingID = target;
                    let flag: BindingFlags = BindingFlags.NONE;
                    switch (c.puppetType) {
                        case PuppetType.LAYER:
                            flag = BindingFlags.LAYER; break;
                        case PuppetType.PART:
                            flag = BindingFlags.PART; break;
                        default:
                            console.warn(c.index, "has wrong type to bind emitter");
                    }
                    emitter.bindingFlags |= flag;
                    emitter.bindingSource = c.index;
                }
                return 1;
            } case 0x0197: {
                c.puppetID = c.stack.pop();
                c.puppetType = PuppetType.PART;
                return 0;
            }
            case 0x0198:
            case 0x0199: {
                const runOnce = c.stack.pop() !== 0;
                const dataIndex = c.stack.pop();
                let index = c.puppetID;
                if (id === 0x198)
                    index = c.stack.pop();
                if (c.puppetType === PuppetType.PART) {
                    activateEffect(this.objects, index, dataIndex, runOnce);
                    return 1;
                }
                return 0;
            }
            case 0x019D: {
                c.stack.pop(); // whether to unload actor data?
                switch (c.puppetType) {
                    case PuppetType.ACTOR:
                        objects.actors[c.index] = undefined;
                        c.actor = null;
                        break;
                    case PuppetType.LAYER:
                    case PuppetType.PART:
                        // apply transform one last time
                        c.setTransform(objects.parts);
                        break;
                }
                c.puppetType = PuppetType.NONE;
                c.puppetID = 0;
                return 0;
            }
            case 0x019F: {
                let out = (this.flags & 0x22) !== 0;
                if (c.stack.pop() !== 0) {
                    if ((this.flags & 0x84000400) !== 0)
                    out = false;
                }
                // not sure what this means yet, we aren't setting any of these
                // return out ? 1 : 0;
                return 1;
            }
            // same logic, just with extra discarded params
            case 0x01A1:
                c.stack.pop();
            case 0x01A2:
                c.stack.pop();
            case 0x01A3:
                c.stack.pop();
            case 0x01A4: {
                const param = c.stack.pop();
                const part = c.stack.pop();
                objects.parts[part].effectParams[0] = param;
            } break;
            case 0x01A5: {
                const frame = c.stack.pop();
                const index = c.stack.pop();
                objects.animatedTextures[index].explicitIndex = frame;
                objects.animatedTextures[index].active = true;
                return 1;
            }
            case 0x01C8:
            case 0x01C9: {
                if (id === 0x1C8 && c.puppetType !== PuppetType.PART)
                    return 0;
                const type: BIN.LevelEffectType = c.stack.pop();
                let index = c.puppetID;
                if (id === 0x1C9)
                    index = c.stack.pop();
                console.log('deactivate effect', index);
                deactivateEffect(this.objects, index, type);
                return 1;
            }
            case 0x01CA: {
                c.moreFlags |= 4;
                return 1;
            }
            case 0x01CB: {
                const other = this.workers[c.stack.pop()];
                other.moreFlags |= 4;
                return 1;
            }
            case 0x01D0: {
                if (c.puppetType === PuppetType.ACTOR)
                    c.moreFlags |= 8;
                return 1;
            }
            case 0x01DF: {
                const other = this.workers[c.stack.pop()];
                if (other.puppetType === PuppetType.ACTOR)
                    other.moreFlags |= 8;
                return 1;
            }
            case 0x01E3: {
                // disable post effects
                return 0;
            }
            case 0x01F1: {
                this.miscFloat = c.stack.pop();
                return this.miscFloat;
            }
            case 0x01F1: {
                return this.miscFloat;
            }
            case 0x020B: {
                c.moreFlags |= 0x104;
                return 1;
            }
            /* --------- math -------------- */
            case 0x1001:
                return Math.sin(c.stack.pop());
            case 0x1002:
                return Math.cos(c.stack.pop());
            case 0x1006:
                return Math.sqrt(c.stack.pop());
            case 0x1019:
                return Math.abs(c.stack.pop());
            case 0x101A: {
                const y2 = c.stack.pop();
                const x2 = c.stack.pop();
                const y1 = c.stack.pop();
                const x1 = c.stack.pop();
                return Math.hypot(x1-x2, y1-y2);
            } case 0x101B: {
                const z2 = c.stack.pop();
                const y2 = c.stack.pop();
                const x2 = c.stack.pop();
                const z1 = c.stack.pop();
                const y1 = c.stack.pop();
                const x1 = c.stack.pop();
                return Math.hypot(x1-x2, y1-y2, z1-z2);
            }
            /* --------- scene transition ---------- */
            case 0x4003: {
                // fade in from color
                const r = c.stack.pop();
                const g = c.stack.pop();
                const b = c.stack.pop();
                const a = c.stack.pop();
                return 0;
            }
            case 0x4004: case 0x4005: case 0x4006: case 0x4007: {
                // fade in/out black/white
                const duration = c.stack.pop();
                return 0;
            }
            case 0x4008: {
                // screen overlay color
                const a = c.stack.pop();
                const b = c.stack.pop();
                const g = c.stack.pop();
                const r = c.stack.pop();
                return 0;
            }
            case 0x4009: {
                // dim screen effect
                const a = c.stack.pop();
                const b = c.stack.pop();
                const g = c.stack.pop();
                const r = c.stack.pop();
                return 0;
            }
            case 0x400A: {
                // motion blur effect
                c.stack.pop();
                return 0;
            }
            case 0x400C: {
                // disable color overlay
                return 0;
            }
            case 0x400D: {
                // wait for fade in/out
                return 0;
            }
            case 0x4013: {
                // set actor directional light
                const polar = c.stack.pop() * MathConstants.DEG_TO_RAD;
                const azimuth = c.stack.pop() * MathConstants.DEG_TO_RAD;
                const b = c.stack.pop();
                const g = c.stack.pop();
                const r = c.stack.pop();
                const index = c.stack.pop();
                objects.lightColors[index*4 + 0] = r/0x80;
                objects.lightColors[index*4 + 1] = g/0x80;
                objects.lightColors[index*4 + 2] = b/0x80;
                if (index < 3) {
                    objects.lightDirs[0*4 + index] = -Math.sin(azimuth) * Math.cos(polar);
                    objects.lightDirs[1*4 + index] = -Math.sin(polar);
                    objects.lightDirs[2*4 + index] = -Math.cos(azimuth) * Math.cos(polar);
                }
                return 0;
            }
            case 0x401A: {
                // camera cross fade
                const alpha = c.stack.pop();
                const duration = c.stack.pop();
                return 0;
            }
            case 0x4034: {
                // determines overall render order of actors vs XLU level parts
                objects.actorsAfterXLU = c.stack.pop() !== 0;
                return 0;
            }
            /* --------- character-related functions ---------- */
            case 0x5000:
            case 0x5002:
            case 0x501B:
            case 0x501D:
            case 0x5040: {
                const anim = c.stack.pop();
                if (c.actor) {
                    c.actor.animation.set(objects, anim);
                    if (anim === 0x50021000) {
                        // chests don't open until tidus has crouched down, skip that part
                        c.actor.animation.t = 25;
                    }
                }
                return 0;
            }
            case 0x5001: {
                const index = c.stack.pop();
                objects.loadMotionGroup(index);
                return 0;
            } case 0x5003:
                return 0; // wait for animation
            case 0x5005: {
                if (c.actor)
                    c.actor.animation.finish();
                return 0;
            } case 0x5006: {
                const scale = c.stack.pop();
                if (c.actor)
                    c.actor.scale = scale;
                return 0;
            } case 0x5007: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                const flags = c.stack.pop();
                if (c.actor)
                    console.log("SCALE", x, y, z, flags, c.actor?.id.toString(16))
                // if (c.actor)
                //     c.actor.scale = scale;
                return 0;
            } case 0x5008: {
                const hidden = c.stack.pop() !== 0;
                if (c.actor) {
                    const old = !c.actor.visible;
                    c.actor.visible = !hidden;
                    return old ? 1 : 0;
                }
                return 0;
            } case 0x500B: {
                const y = c.stack.pop();
                if (c.actor)
                    c.actor.groundY = y;
                return 0;
            } case 0x500E: {
                const ignore = c.stack.pop() !== 0;
                if (c.actor) {
                    if (ignore)
                        c.actor.flags |= ActorFlags.IGNORE_GROUND;
                    else
                        c.actor.flags &= ~ActorFlags.IGNORE_GROUND;
                }
                return 0;
            } case 0x5010: case 0x5061: {
                const offset = c.stack.pop();
                const id = c.stack.pop();
                objects.loadActorResource(id, offset);
                return 0;
            } case 0x5016: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                if (c.actor) {
                    vec3.set(c.actor.offset, x, y, z);
                }
                return 0;
            } case 0x5017: {
                const value = c.stack.pop();
                if (c.actor)
                    c.actor.floorMode = value;
                return 0;
            } case 0x501A: {
                const end = c.stack.pop();
                const start = c.stack.pop();
                const loops = c.stack.pop();
                c.stack.pop();
                const animID = c.stack.pop();
                if (c.actor) {
                    const defaultLoops = c.actor.animation.defaultLoops;
                    c.actor.animation.set(objects, animID, true);
                    if (defaultLoops < 0)
                        c.actor.animation.loops = loops;
                    c.actor.animation.t = start;
                    c.actor.animation.start = start;
                    if (end > 0)
                        c.actor.animation.end = end;
                    c.actor.animation.isCustom = true;
                }
                return 0;
            } case 0x501E: {
                return 0; // wait for animation
            } case 0x5025: {
                const value = c.stack.pop();
                const index = c.stack.pop();
                if (c.actor)
                    c.actor.animation.defaults[index] = value;
                return 0;
            } case 0x5028: {
                const value = c.stack.pop();
                if (c.actor) {
                    if (value <= 0)
                        c.actor.speedThreshold = 18;
                    else
                        c.actor.speedThreshold = value;
                }
                return 0;
            } case 0x5029: {
                const value = c.stack.pop();
                if (c.actor) {
                    c.actor.shadowEnabled = value === 1;
                }
                return 0;
            } case 0x502D: {
                const point = c.stack.pop();
                const parentIndex = c.stack.pop();
                // if (parentIndex < 0)
                //     console.warn(`detaching w${hexzero(c.index, 2)}`)
                // else
                //     console.warn(`attaching w${hexzero(c.index, 2)} to w${hexzero(parentIndex, 2)} ${c.getThread().offset.toString(16)}`)
                if (c.actor) {
                    if (parentIndex < 0) {
                        c.actor.attachPoint = -1;
                        if (c.actor.parent) {
                            c.actor.parent.children = c.actor.parent.children.filter(a => a !== c.actor);
                        }
                        c.actor.parent = null;
                    } else {
                        // seems like positions would be out of sync otherwise?
                        // assert(parentIndex < c.index);
                        c.actor.parent = assertExists(this.workers[parentIndex].actor);
                        c.actor.attachPoint = point;
                        c.actor.parent.children.push(c.actor);
                    }
                }
                return 0;
            } case 0x5032: {
                if (c.actor) {
                    const m = c.actor.model;
                    if (m) {
                        let list = 0;
                        const cat: ActorCategory = c.actor.id >>> 0xC;
                        if (cat === ActorCategory.WEP)
                            list = 2; // weapons seem to only have battle defaults
                        if (this.isBlitzball && (cat === ActorCategory.NPC || cat === ActorCategory.PC))
                            list = 1; // swimming
                        const anim = m.defaultAnimations[list][0];
                        if (anim !== undefined)
                            c.actor.animation.set(objects, anim);
                    }
                }
                return 0;
            }
            case 0x5033: { // fade out actor
                const duration = c.stack.pop();
                const targetOpacity = c.stack.pop();
                if (c.actor) {
                    // not really accurate, but we haven't really set this up
                    c.actor.visible = targetOpacity > 0;
                }
                return 0;
            }
            case 0x5039: {
                const r = c.stack.pop();
                if (c.actor && r > 0) {
                    c.actor.shadowRadius = r;
                }
                return 0;
            }
            case 0x5047:
            case 0x5048: {
                const anim = c.stack.pop();
                const otherWorker = c.stack.pop();
                if (this.workers[otherWorker].actor) {
                    this.workers[otherWorker].actor?.animation.set(objects, anim);
                }
                return 0;
            }
            case 0x504E: {
                const id = c.stack.pop();
                // console.info(`loading chrdata for ${charLabel(id)} from ${c.index}`);
                return 0;
            }
            case 0x504F: {
                // character data sync
                c.stack.pop();
                return 0;
            } case 0x5050: {
                const cutoff = c.stack.pop();
                const loops = c.stack.pop();
                // set some sort of animation cutoff trigger
                return 0;
            } case 0x5051: {
                if (c.actor) {
                    return c.actor.animation.t * 0x100;
                }
                return 0;
            } case 0x5054: {
                const hide = c.stack.pop() !== 0;
                const mask = 1 << c.stack.pop();
                let out = false;
                if (c.actor) {
                    out = (c.actor.hiddenParts & mask) !== 0;
                    c.actor.hiddenParts &= ~mask;
                    if (hide)
                        c.actor.hiddenParts |= mask;
                }
                return out ? 1 : 0;
            }
            case 0x5057: {
                // set actor processed (?) flag
                const cIndex = c.stack.pop();
                const flag = c.stack.pop() !== 0;
                return 0;
            } case 0x505A: {
                const addr = c.stack.pop();
                const index = c.stack.pop();
                return 0;
            } case 0x505C: {
                const length = c.stack.pop();
                if (c.actor) {
                    if (length === -1)
                        c.actor.animation.nextTransition = 0;
                    else if (length === 0)
                        c.actor.animation.nextTransition = 1;
                    else
                        c.actor.animation.nextTransition = length;
                }
                return 0;
            } case 0x505F: {
                const loops = c.stack.pop();
                if (c.actor) {
                    c.actor.animation.defaultLoops = loops;
                    c.actor.animation.loops = loops; // assuming this is always set right after 501b
                }
                return 0;
            } case 0x5063: {
                // character data sync
                c.stack.pop();
                c.stack.pop();
                return 0;
            } case 0x5065: {
                // console.log("loading motion group", c.stack.pop().toString(16));
                return 0;
            } case 0x5066: {
                // motion group data sync
                c.stack.pop();
                return 0;
            } case 0x5068: {
                // file read sync
                return 0;
            } case 0x5069: {
                // set cloth sim enabled
                c.stack.pop();
                return 0;
            } case 0x506D: {
                // set some angles on the actor
                c.stack.pop();
                c.stack.pop();
                return 0;
            } case 0x5071: {
                // sends new texture blits,
                c.stack.pop(); // unused?
                return 0;
            } case 0x5075: {
                if (c.actor)
                    return c.actor.animation.t * 0x100;
                return 0;
            } case 0x5078: {
                const id = c.stack.pop();
                const type = c.stack.pop();
                if (c.actor) {
                    if (type !== 4)
                        console.warn("tex anim type", type);
                    c.actor.setTextureAnimation(id)
                }
                return 0;
            } case 0x5087: {
                // mark all actors as having normals?
                return 0;
            } case 0x5088: {
                // set brightness?
                const frames = c.stack.pop(); // linear ramp duration
                const value = c.stack.pop();
                return 0;
            }
            /* ---------- battle ------------------------- */
            case 0x7002: {
                return 0; // started battle
            }
            /* ---------- rendering functions ------------ */
            case 0x8000: {
                const visible = c.stack.pop() !== 0;
                const layer = c.stack.pop();
                // console.log(visible ? "showing" : "hiding", "layer", layer);
                for (let i = 0; i < this.objects.parts.length; i++) {
                    if (this.objects.parts[i].part.layer === layer)
                        this.objects.parts[i].visible = visible;
                }
                return layer;
            }
            case 0x8002: {
                const active = c.stack.pop();
                const id = c.stack.pop();
                    // console.log((active === 0 ? "de" : "") + "activating", id);
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.id === id) {
                        if (active !== 0) {
                            e.state = EmitterState.RUNNING;
                            e.waitTimer = 0;
                        } else {
                            e.state = EmitterState.ENDING;
                        }
                    }
                }
                return active;
            }
            case 0x8003: {
                const id = c.stack.pop();
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.id === id) {
                        e.waitTimer = 0;
                        e.state = EmitterState.WAITING;
                    }
                }
                return 1;
            }
            case 0x8004:
            case 0x8005:
                return 0; // done waiting for emitter
            case 0x8008: {
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.id === 0)
                        continue;
                    e.waitTimer = -0x1000;
                }
                return 1;
            }
            case 0x8009: {
                const target = c.stack.pop();
                const emitter = getFirstEmitter(objects, c.stack.pop());
                // console.log("binding emitter", emitter.spec.id, "to", target, c.puppetType);
                if (c.spec.type === BIN.WorkerType.MOTION && emitter) {
                    emitter.bindingID = target;
                    let flag: BindingFlags = BindingFlags.NONE;
                    switch (c.puppetType) {
                        case PuppetType.ACTOR: {
                            flag = BindingFlags.ACTOR;
                            emitter.bindingID = c.index;
                            // target is actually joint index
                        } break;
                        case PuppetType.LAYER:
                            flag = BindingFlags.LAYER; break;
                        case PuppetType.PART:
                            flag = BindingFlags.PART; break;
                    }
                    emitter.bindingFlags |= flag;
                    emitter.bindingSource = c.index;
                }
                return 1;
            }
            case 0x800A: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                const id = c.stack.pop();
                if (c.spec.type === BIN.WorkerType.MOTION) {
                    const e = getFirstEmitter(objects, id);
                    if (e) {
                        assert((e.bindingFlags & BindingFlags.PARENT_MASK) !== 0 && e.bindingSource === c.index)
                        e.bindingMatrix[12] = x;
                        e.bindingMatrix[13] = y;
                        e.bindingMatrix[14] = z;
                        e.bindingFlags |= BindingFlags.POSITION;
                    }
                }
                return 1;
            }
            case 0x800B: {
                // this function seems kind of broken for id == 0,
                // it looks for a binding with nonzero id, then
                // unbinds the first zero-id
                // however, id=0 seems to always mean background environment effects,
                // so the second part just does nothing?
                const id = c.stack.pop();
                if (id !== 0) {
                    const emitter = getFirstEmitter(objects, id);
                    if (emitter) {
                        emitter.bindingFlags &= ~BindingFlags.PARENT_MASK;
                        emitter.bindingID = -1;
                    }
                }
                return 1;
            }
            case 0x800D: {
                const visible = c.stack.pop();
                const id = c.stack.pop();
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.id !== id)
                        continue;
                    if (visible)
                        e.bindingFlags &= ~BindingFlags.HIDE;
                    else
                        e.bindingFlags |= BindingFlags.HIDE;
                }
                return visible;
            }
            case 0x8035: {
                const active = c.stack.pop();
                const group = c.stack.pop();
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.g !== group)
                        continue;
                    if (active !== 0) {
                        e.state = EmitterState.RUNNING;
                        e.waitTimer = 0;
                    } else {
                        e.state = EmitterState.ENDING;
                    }
                }
                return active;
            }
            case 0x8036: {
                const visible = c.stack.pop();
                const group = c.stack.pop();
                for (let i = 0; i < objects.particles.emitters.length; i++) {
                    const e = objects.particles.emitters[i];
                    if (e.spec.g !== group)
                        continue;
                    if (visible !== 0) {
                        e.bindingFlags &= ~BindingFlags.HIDE;
                    } else {
                        e.bindingFlags |= BindingFlags.HIDE;
                    }
                }
                return visible;
            }
            case 0x8037: {
                objects.fog.opacity = c.stack.pop();
                objects.fog.far = c.stack.pop();
                objects.fog.near = c.stack.pop();
                return 1;
            }
            case 0x803C: {
                objects.fog.opacity = c.stack.pop();
                return 1;
            }
            case 0x803D: {
                return objects.fog.opacity;
            }
            case 0x803E: {
                objects.fog.color[2] = c.stack.pop()/0xFF;
                objects.fog.color[1] = c.stack.pop()/0xFF;
                objects.fog.color[0] = c.stack.pop()/0xFF;
                return 1;
            }
            case 0x803F:
            case 0x8040:
            case 0x8041: {
                objects.fog.color[id - 0x803F] = c.stack.pop()/0xFF;
                return 1;
            }
            case 0x8044: {
                return objects.fog.color[2]*0xFF;
            }
            case 0x805F: {
                const id = c.stack.pop();
                if (id !== 0) {
                    const emitter = getFirstEmitter(objects, id);
                    if (emitter)
                        emitter.waitTimer = -0x1000;
                }
                return 1;
            }
            /* ---------- movies  -----------------------------*/
            case 0xB003: {
                return 1700; // playback progress
            }
            /* ---------- misc... -----------------------------*/
            case 0xC052: {
                // loads a byte from memory
                return 0;
            }
            /* ---------- unimplemented functions ------------ */
            case 0x008B: // checking line crossing
                return -1;
            default:
                const count = funcArgCounts.get(id);
                if (count !== undefined) {
                    for (let i = 0; i < count; i++)
                        c.stack.pop();
                } else {
                    throw `unhandled func ${hexzero(id, 4)}`;
                }
        }
        return 0;
    }

    private getDialogChoice(workerIndex: number, stringIndex: number): number {
        // default to picking up/putting down spheres in trials
        if (isTrial(this.data.name))
            return 0;
        if (!this.isBlitzball)
            return 1;
        // copy the AI decision logic
        const ballHolder = this.readVariable(this.workers[workerIndex], 0xA7);
        const w = this.workers[ballHolder + 2];
        if (stringIndex >= 28 && stringIndex <= 32) {
            // which defender to break to
            const defenderCount = this.readVariable(w, 0xC0);
            let endurance = this.readVariable(w, 0x3C, ballHolder);
            let breakCount = 0;
            for (; breakCount < defenderCount; breakCount++) {
                endurance -= this.readVariable(w, 0x3A, this.readVariable(w, 0xC8, breakCount));
                if (endurance < 0)
                    break;
            }
            const pathProgress = this.readVariable(w, 0xC6);
            let action = BlitzballAction.PASS;
            if (breakCount === defenderCount) {
                let dribbleChance = 0;
                switch (pathProgress) {
                    case 0:
                        dribbleChance = .7; break;
                    case 1: case 2:
                        dribbleChance = .6; break;
                    case 3: case 4:
                        dribbleChance = .5; break;
                    case 5:
                        dribbleChance = .4; break;
                }
                if (Math.random() < dribbleChance)
                    action = BlitzballAction.DRIBBLE;
            }
            if (action !== BlitzballAction.DRIBBLE) {
                const shotValue = this.readVariable(w, 0x40, ballHolder);
                const shotFactor = pathProgress === 6 ? 9 : Math.pow(2, pathProgress - 4);
                const passValue = this.readVariable(w, 0x3E, ballHolder);
                const ref = Math.floor(shotValue * shotFactor);
                if (Math.random() < ref/(ref + passValue)) {
                    // are we close enough to shoot?
                    const dist = vec3.dist(w.position.pos, this.workers[0x15].position.pos);
                    let cutoff = dist/100;
                    if (shotValue >= 10)
                        cutoff *= Math.floor(shotValue / 10);
                    if (shotValue >= cutoff) {
                        action = BlitzballAction.SHOOT;
                    } else {
                        breakCount = defenderCount;
                        action = BlitzballAction.DRIBBLE;
                    }
                } else {
                    const myZ = w.position.pos[2];
                    let foundCloser = false;
                    for (let i = 2; i < 7; i++) {
                        if (this.workers[i].position.pos[2] > myZ) {
                            foundCloser = true;
                            break;
                        }
                    }
                    if (foundCloser || Math.random() < .6)
                        action = BlitzballAction.PASS;
                    else
                        action = BlitzballAction.SHOOT;
                }
                // maybe risk another tackle if we'll be blocked
                let blockTotal = 0;
                for (let i = breakCount; i < defenderCount; i++) {
                    blockTotal += this.readVariable(w, 0x42, this.readVariable(w, 0xC8, breakCount));
                }
                const scoreToCheck = action === BlitzballAction.SHOOT ? shotValue : passValue;
                if (scoreToCheck < blockTotal && Math.random() < .5) {
                    breakCount++;
                }
            }
            // sort of cheating here, this is the variable the game is going to use after the next choice dialog
            this.storeToVariable(w, 0x103, 0, action, false);
            return breakCount;
        }
        if (stringIndex >= 33 && stringIndex <= 40) {
            // post-break action, we already computed this above
            return this.readVariable(w, 0x103);
        }
        if (stringIndex === 60) {
            // determine pass target
            // pass to a ~random player closer to the goal than we are if there is one
            // otherwise, slightly more likely to pass to the next-most-advanced player
            const myZ = w.position.pos[2];
            let maxZ = -1000;
            let passIndex = -1;
            let maxIndex = -1;
            for (let i = 0; i < 5; i++) {
                if (i === ballHolder)
                    continue;
                const z = this.workers[i+2].position.pos[2];
                if (z > myZ) {
                    // game accurate, but obviously not uniform (should have read more Knuth)
                    if (passIndex < 0 || Math.random() < .5)
                        passIndex = i;
                } else if (z > maxZ) {
                    maxZ = z;
                    maxIndex = i;
                }
            }
            if (passIndex < 0) {
                if (Math.random() < .6) {
                    passIndex = maxIndex;
                } else {
                    // can't pass to ourself, so only four options
                    // the AI actually selects from all five and if it picks the ball carrier chooses to shoot instead
                    passIndex = randomRange(0, 4) | 0;
                    if (passIndex >= ballHolder)
                        passIndex++;
                }
            }
            // annoyingly the game wants the index in the list, not the player index
            if (passIndex > ballHolder)
                passIndex--;
            return passIndex;
        }
        return 1;
    }

    private addButtons(): void {
        switch (this.data.name) {
            case "bjyt0400":
                this.oneTimeButton(0x1F, 2, 7);
                // can't use the script for this as it's part of a big sequence
                const explode = new Button(this, this.objects, 0x1B, ButtonType.PLAYER | ButtonType.COLLISION | ButtonType.ONE_TIME, () => {
                        this.startMagic(0x1DF);
                        this.triggers.push({t: this.objects.t + 4, fn: () => {
                            for (let i = 0; i < this.objects.parts.length; i++) {
                                const p = this.objects.parts[i];
                                if (p.part.layer === 8 || p.part.layer === 9)
                                    p.visible = false;
                            }
                        }});
                });
                vec3.set(explode.pos, 0, -20, -185);
                explode.clickRadius = 20;
                break;
            case "sins0900":
                this.objects.edges.push(new Edge(0xD, false));
                break;
            case "cdsp0700": // underwater ship
                const screen = this.oneTimeButton(0x1A, 2, 2, ButtonType.PLAYER);
                vec3.set(screen.pos, 0, -65, -118);
                screen.activeRadius = 80;
                const power = this.oneTimeButton(0x1B, 2, 10, ButtonType.PLAYER);
                vec3.set(power.pos, 0, -50, 415);
                power.activeRadius = 200;
                break;
            case "djyt0600": {
                const type = ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR | ButtonType.INVISIBLE;
                const left = new Button(this, this.objects, 0xF, type, () => {
                    this.sendSignal(SignalType.NO_ACK, -1, 1, 1, 2);
                    getMatrixTranslation(this.objects.pushPosition, assertExists(this.objects.actors[1]).modelMatrix);
                    this.objects.pushPosition[0] += 5;
                    this.objects.pressedButton = ButtonPress.NONE;
                });
                left.clickRadius = 1.5;
                left.activeRadius = 80;
                left.enabledCheck = () => {
                    const hasSphere = this.readVariable(this.workers[1], 0x31) !== 0;
                    const holding = this.readVariable(this.workers[1], 0x28) !== 0;
                    return hasSphere !== holding;
                };
                const right = new Button(this, this.objects, 0x10, type, () => {
                    this.sendSignal(SignalType.NO_ACK, -1, 1, 1, 2);
                    getMatrixTranslation(this.objects.pushPosition, assertExists(this.objects.actors[1]).modelMatrix);
                    this.objects.pushPosition[0] -= 5;
                    this.objects.pressedButton = ButtonPress.NONE;
                });
                right.clickRadius = 1.5;
                right.activeRadius = 80;
                right.enabledCheck = () => {
                    const hasSphere = this.readVariable(this.workers[1], 0x32) !== 0;
                    const holding = this.readVariable(this.workers[1], 0x28) !== 0;
                    return hasSphere !== holding;
                };

                const top = new Button(this, this.objects, 0x12, type, () => {
                    this.sendSignal(SignalType.NO_ACK, -1, 6, 1, 2);
                });
                top.clickRadius = 1.5;
                top.activeRadius = 80;
                top.enabledCheck = () => {
                    if (!this.objects.actors[6]?.visible)
                        return false;
                    if (this.readVariable(this.workers[1], 0x55) !== 1)
                        return false;
                    const hasSphere = this.readVariable(this.workers[1], 0x34) !== 0;
                    const holding = this.readVariable(this.workers[1], 0x28) !== 0;
                    return hasSphere !== holding;
                };

                const pedestal = assertExists(this.objects.actors[1]);
                const push = new Button(this, this.objects, 1, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR, () => {
                    getMatrixTranslation(this.objects.pushPosition, pedestal.modelMatrix);
                    const angle = Math.atan2(
                        this.objects.cameraPos[2] - this.objects.pushPosition[2],
                        this.objects.cameraPos[0] - this.objects.pushPosition[0]
                    );
                    // this is in game coords, not noclip coords, so slightly different from below
                    if (Math.abs(angle + MathConstants.TAU/4) < MathConstants.TAU/8) {
                        assertExists(this.data.arrays[0x48].values)[0] = 8;
                        this.objects.pushPosition[2] -= 7;
                        this.objects.pressedButton = ButtonPress.UP;
                    } else {
                        assertExists(this.data.arrays[0x48].values)[0] = 2;
                        this.objects.pushPosition[0] -= 7;
                        this.objects.pressedButton = ButtonPress.RIGHT;
                    }
                });
                push.enabledCheck = (delta: ReadonlyVec3) => {
                    // only push from start position
                    if (Math.abs(pedestal.pos[0]) > 10 || (Math.abs(pedestal.pos[2] - 20) > 10))
                        return false;
                    if (delta[1] > 5 || delta[1] < -50)
                        return false;
                    const angle = Math.atan2(delta[2], delta[0]);
                    return Math.min(Math.abs(angle), Math.abs(angle + MathConstants.TAU/4)) < .6 * MathConstants.TAU / 8
                };
                push.clickRadius = 4;
                push.activeRadius = 120;
                push.offset[1] = 4;
            } break;
            case "mcyt0500": {
                const type = ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR | ButtonType.INVISIBLE;
                const pedestal = assertExists(this.objects.actors[1]);
                const sphere = new Button(this, this.objects, 8, type, () => {
                    this.objects.pressedButton = ButtonPress.NONE;
                    vec3.copy(this.objects.pushPosition, pedestal.pos);
                    this.objects.pushPosition[2] -= 7;
                    this.sendSignal(SignalType.NO_ACK, -1, 1, 1, 2);
                });
                sphere.clickRadius = 1.5;
                sphere.activeRadius = 80;
                sphere.enabledCheck = () => {
                    const hasSphere = this.readVariable(this.workers[1], 0x22) !== 0;
                    const holding = this.readVariable(this.workers[1], 0x1F) !== 0;
                    return hasSphere !== holding;
                };

                const push = new Button(this, this.objects, 1, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR, () => {
                    getMatrixTranslation(this.objects.pushPosition, pedestal.modelMatrix);
                    const angle = Math.atan2(
                        this.objects.cameraPos[2] - this.objects.pushPosition[2],
                        this.objects.cameraPos[0] - this.objects.pushPosition[0]
                    );
                    // this is in game coords, not noclip coords, so slightly different from below
                    if (Math.abs(angle + MathConstants.TAU/4) < MathConstants.TAU/8) {
                        // assertExists(this.data.arrays[0x48].values)[0] = 8;
                        this.objects.pushPosition[2] -= 7;
                        this.objects.pressedButton = ButtonPress.RIGHT;
                    } else {
                        // assertExists(this.data.arrays[0x48].values)[0] = 2;
                        this.objects.pushPosition[0] += 7;
                        if (this.objects.pushPosition[1] < 0)
                            this.objects.pressedButton = ButtonPress.LEFT;
                        else
                            this.objects.pressedButton = ButtonPress.UP;
                    }
                });
                push.enabledCheck = (delta: ReadonlyVec3) => {
                    if (delta[1] > 5 || delta[1] < -50)
                        return false;
                    const angle = Math.atan2(delta[2], delta[0]);
                    const dist = .6 * MathConstants.TAU/8;
                    if (Math.abs(angleDist(angle, MathConstants.TAU/2)) < dist && pedestal.pos[1] < 42) // seems like it gets stuck at the bottom
                        return true;
                    return Math.abs(angleDist(angle, -MathConstants.TAU/4)) < dist && pedestal.pos[1] > 5;
                };
                push.clickRadius = 4;
                push.activeRadius = 120;
                push.offset[1] = 4;

                this.objects.edges.push(new Edge(0x23, false));
            } break;
            case "klyt1000": {
                const pedestal = assertExists(this.objects.actors[6]);
                const push = new Button(this, this.objects, 6, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR, () => {
                    const isUp = pedestal.pos[2] < 180 || pedestal.pos[0] > 49;
                    this.objects.pressedButton = isUp ? ButtonPress.UP : ButtonPress.RIGHT;
                    this.sendSignal(SignalType.NO_ACK, -1, 6, 1, 4);
                });
                push.enabledCheck = () => {
                    return pedestal.pos[2] > 100 && this.readVariable(this.workers[6], 0x24, 0) === 0;
                };
                push.activeRadius = 120;
                push.clickRadius = 4;
                push.offset[1] = 4;
                const sphere = this.trialsButton(6, WallNorm.NONE);
                sphere.flags |= ButtonType.ACTOR
                vec3.set(sphere.offset, 0, 10, 2.5);
            } break;
        }
    }

    private actorButtons(actor: Actor, objects: LevelObjectHolder, index: number): void {
        switch (actor.id) {
            case 0x5001: case 0x50AB: { // save spheres
                const button = Button.Signal(this, objects, index, 2, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR);
                button.offset[1] = 6;
                button.clickRadius = 3;
            } break;
            case 0x5002: case 0x50AA: { // chests
                const button = Button.Signal(this, objects, index, 2, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR);
                button.offset[1] = 4;
                button.clickRadius = 4;
            } break;
            case 0x500B: { // al bhed primer
                const button = Button.Signal(this, objects, index, 2, ButtonType.COLLISION | ButtonType.PLAYER | ButtonType.ACTOR);
                button.clickRadius = 1;
            } break;
            // crane
            case 0x1085: {
                objects.loadActorResource(actor.id, 1);
                objects.loadActorResource(0x106e, 1);
                const button = new Button(this, objects, index, ButtonType.ACTOR | ButtonType.BATTLE, () => {
                    switch (actor.effectLevel) {
                    case 1:
                        actor.animation.setFromList(objects, 1, 17);
                        actor.animation.defaults[0] = actor.animation.id;
                        const lightning = assertExists(objects.magic.find((m) => m.id === 0x4E));
                        vec3.copy(lightning.emitters[0].pos, actor.pos);
                        lightning.emitters[0].pos[1] -= 20;
                        vec3.scale(lightning.emitters[0].scale, lightning.emitters[0].scale, 4);
                        lightning.active = true;
                        break;
                    case 2:
                        actor.animation.setFromList(objects, 1, 0xb0);
                        assertExists(objects.actors[4]).animation.setFromList(objects, 1, 0xc0);
                        assertExists(objects.magic.find((m) => m.id === 0x120)).active = true;
                        actor.animation.defaults[0] = assertExists(actor.model).defaultAnimations[1][18];
                        assertExists(objects.actors[4]).animation.defaults[0] = assertExists(assertExists(objects.actorResources.get(0x106e)).model).defaultAnimations[1][18];
                        break;
                    }
                    actor.effectLevel++;
                })
                button.clickRadius = 10;
                button.offset[1] = 5;
                button.enabledCheck = () => {
                    return objects.inBattle && actor.effectLevel < 3;
                }
            } break;
            // tanker
            case 0x10AA: {
                const model = assertExists(objects.actorResources.get(actor.id)?.model);
                const button = new Button(this, objects, index, ButtonType.ACTOR | ButtonType.BATTLE, () => {
                    switch (actor.effectLevel) {
                    case 0: case 1:
                        actor.animation.set(objects, model.defaultAnimations[1][0x38]);
                        break;
                    case 2:
                        actor.animation.set(objects, model.defaultAnimations[1][0x42]);
                        actor.animation.defaults[0] = model.defaultAnimations[1][0x19];
                        break;
                    case 3:
                        actor.animation.set(objects, model.defaultAnimations[1][0x43]);
                        actor.animation.defaults[0] = model.defaultAnimations[1][0x22];
                        break;
                    case 4:
                        objects.inBattle = false;
                        actor.magicManager?.startEffect(12);
                        break;
                    }
                    actor.effectLevel++;
                });
                button.clickRadius = 4;
            } break;
            case 0x506D: { // trials pedestal
                switch (this.data.name) {
                    case "bsyt0100": { // besaid trials
                        const b = new Button(this, objects, index, ButtonType.PLAYER | ButtonType.ACTOR | ButtonType.ONE_TIME, () => {
                            this.sendSignal(SignalType.NO_ACK, -1, 0x31, 2, 2);
                        });
                        b.clickRadius = 5;
                        b.offset[1] = 5;
                        b.enabledCheck = () => {
                            const readyVar = this.data.arrays[0x32];
                            return !!readyVar.values && readyVar.values[0] !== 0;
                        }
                    } break;
                }

            } break;
        }
    }

    private basicButton(c: Worker, message: number, radius: number): Button {
        const b = Button.Signal(this, this.objects, c.index, message);
        b.clickRadius = radius;
        vec3.copy(b.pos, c.position.pos);
        return b;
    }

    private oneTimeButton(target: number, message: number, radius: number, flags = ButtonType.PLAYER | ButtonType.COLLISION): Button {
        const b = Button.Signal(this, this.objects, target, message, flags | ButtonType.ONE_TIME);
        b.clickRadius = radius;
        return b;
    }

    private scanScript(worker: number, entry: number, endEntry: number, fn:(offs: number, op: Opcode, imm: number) => boolean): boolean {
        const entrypoints = this.data.workers[worker].entrypoints;
        const start = entrypoints[entry];
        const end = endEntry >= entrypoints.length ? this.data.workers[worker+1].entrypoints[0] : entrypoints[endEntry];
        let offs = start;
        while (offs < end) {
            const raw = this.data.code.getUint8(offs);
            const op: Opcode = raw & 0x7F;
            const hasImm = raw >= 0x80;
            const imm = hasImm ? this.data.code.getInt16(offs + 1, true) : 0;
            if (fn(offs, op, imm))
                return true;
            offs += hasImm ? 3 : 1;
        }
        return false;
    }

    private extractPositionAndOffset(dst: vec3, worker: number, entry: number): boolean {
        const found = this.scanScript(worker, entry, entry + 1, (offs: number, op: Opcode, imm: number) => {
            // look for position setting function
            if (op !== Opcode.FUNC || imm !== 0x0126)
                return false;
            offs -= 9;
            for (let i = 0; i < 3; i++) {
                const posOp = this.data.code.getUint8(offs++);
                const arg = this.data.code.getInt16(offs, true);
                offs += 2;
                if (posOp === (Opcode.IMM | 0x80)) {
                    dst[i] = arg;
                } else if (posOp === (Opcode.CONST_FLOAT | 0x80)) {
                    dst[i] = this.data.floatConsts[arg];
                } else {
                    return false;
                }
            }
            console.log('found position', worker, entry);
            return true;
        });
        if (!found)
            return false;
        // also check for offset
        this.scanScript(worker, entry, entry + 1, (offs: number, op: Opcode, imm: number) => {
            if (op !== Opcode.FUNC || imm !== 0x5016)
                return false;
            offs -= 9;
            for (let i = 0; i < 3; i++) {
                const posOp = this.data.code.getUint8(offs++);
                const arg = this.data.code.getInt16(offs, true);
                offs += 2;
                if (posOp === (Opcode.IMM | 0x80)) {
                    dst[i] += arg;
                } else if (posOp === (Opcode.CONST_FLOAT | 0x80)) {
                    dst[i] += this.data.floatConsts[arg];
                } else {
                    return false;
                }
            }
            return true;
        });
        return true;
    }

    private trialsButton(target: number, norm: WallNorm, variable = -1): Button {
        const b = Button.Signal(this, this.objects, target, 2);
        b.clickRadius = 1.5;
        b.activeRadius = 80;

        if (variable < 0) {
            // find the variable for this sphere holder (set during or main)
            this.scanScript(target, 0, 2, (offs: number, op: Opcode, imm: number) => {
                if (op === Opcode.SET_DATUM_W) {
                    variable = imm;
                    return true;
                }
                return false;
            });
        }
        b.enabledCheck = (delta: ReadonlyVec3) => {
            const arr = assertExists(this.data.arrays[variable]);
            const hasSphere = assertExists(arr.values)[0] !== 0;
            const holding = assertExists(this.workers[0].actor).children.length > 0;
            if (hasSphere === holding)
                return false;
            switch (norm) {
                case WallNorm.NEGX: return delta[0] < 0;
                case WallNorm.POSX: return delta[0] > 0;
                case WallNorm.NEGZ: return delta[2] < 0;
                case WallNorm.POSZ: return delta[2] > 0;
            }
            return true;
        }
        // check for position-setting calls
        const foundPos = this.scanScript(target, 2, 3, (offs: number, op: Opcode, imm: number) => {
            if (op !== Opcode.SIG_ONEND && op !== Opcode.SIG_ONSTART)
                return false;
            const worker = this.data.code.getUint16(offs - 5, true);
            const entry = this.data.code.getUint16(offs - 2, true);
            return this.extractPositionAndOffset(b.pos, worker, entry);
        });
        if (!foundPos) {
            console.warn("failed to get a position for", target.toString(16));
        }
        return b;
    }

    private laterTrialsButton(target: number, level: TrialsLevel): Button {
        const b = Button.Signal(this, this.objects, target, 2);
        b.clickRadius = 1.5;
        b.activeRadius = 80;

        // macalania
        let logicWorker = 0x1E;
        let holdingVar = 0x1F;
        let placeholder = 0x5074;
        let extraVar = -1;
        if (level === TrialsLevel.DJOSE) {
            logicWorker = 0x2B;
            holdingVar = 0x28;
            placeholder = 0x5071;
            extraVar = 0x21;
        }

        // the actual logic is in a shared worker
        let entry = -1;
        this.scanScript(target, 2, 3, (offs: number, op: Opcode, imm: number) => {
            if (op === Opcode.SIG_ONEND) {
                const worker = this.data.code.getUint16(offs - 5, true);
                if (worker === logicWorker) {
                    entry = this.data.code.getUint16(offs - 2, true);
                    return true;
                }
            }
            return false;
        });
        let sphereVar = -1;
        let gotPos = false;
        let possource = -1;
        if (entry >= 0) {
            this.scanScript(logicWorker, entry, entry + 1, (offs: number, op: Opcode, imm: number) => {
                if (sphereVar < 0 && op === Opcode.GET_DATUM && imm !== holdingVar && imm !== 6 && imm !== extraVar) {
                    sphereVar = imm;
                }
                if (!gotPos && op === Opcode.SIG_NOACK) {
                    const workerIdx = this.data.code.getUint16(offs - 5, true);
                    const worker = this.workers[workerIdx];
                    if (worker.actor && worker.actor.id === placeholder && !worker.actor.parent) {
                        // assume we've already run init to avoid having to parse the switch statement
                        // should be okay as the position markers come first
                        vec3.copy(b.pos, this.workers[workerIdx].position.pos);
                        possource = workerIdx;
                        gotPos = true;
                    }
                }
                return (sphereVar >= 0 && gotPos)
            });
        }
        console.log("djose", target.toString(16), entry.toString(16), sphereVar.toString(16), possource.toString(16))
        b.enabledCheck = (delta: ReadonlyVec3) => {
            const hasSphere = this.readVariable(this.workers[1], sphereVar) !== 0;
            const holding = this.readVariable(this.workers[1], holdingVar) !== 0;
            return hasSphere !== holding;
        }
        return b;
    }

    private initGlobals(): void {
        let moment = 0;
        switch (this.data.name) {
            case "znkd0600": moment = 2680; break; // the part where you can walk around, right before the opening cutscene reprise, so things aren't turning on and off
            case "znkd1000": moment = 3; break;
            case "znkd0801": moment = 10; break;
            case "znkd0900": moment = 18; break;
            case "bsvr0000": moment = 134; break;
            case "bsvr0200": moment = 300; break;
            case "lchb0800": moment = 486; break;
            case "djyt0100": moment = 1003; break; // 1003 will start opened
            case "djyt0600": moment = 995; break; // skip initial djose trials cutscene
            case "guad0000": moment = 1210; break;
            case "kami0000": moment = 1210; break;
            case "dome0200": moment = 2775; break; // zanarkand dome boss
            case "ikai0600": moment = 3000; break;
            case "sins0700": moment = 3360; break;
            case "mcyt0500": moment = 1542; break;
            case "bika0400": moment = 1800; break; // skip long home cutscene
            case "lchb1500": moment = 502; break; // luca ship boss
            case "bika0100": moment = 1800; break;
            case "kino0000":
                moment = 815;
                this.previousEvent = 79;
                break;
            case "kino0500":
                this.mapEntranceID = 2;
                break;
            case "cdsp0800":
                this.previousMap = 0x39;
                break;
        }
        this.globals[Global.GameMoment] = moment;
        this.globals[Global.HaveFlint] = 1;
        this.globals[Global.HaveTinder] = 1;
        if (this.isBlitzball) {
            this.globals[Global.BlitzballOpponent] = (Math.random()*5) | 0;
            for (let i = 0; i < 6; i++)
                this.globals[Global.BlitzballTeamSizes + i] = 6;
            let curr = 7;
            for (let i = 0; i < 48; i++) {
                if (i % 8 > 5)
                    continue;
                if (i === 40)
                    curr = 0;
                if (i === 41)
                    curr = 2;
                this.globals[Global.BlitzballTeamMembers + i] = curr++;
            }
            for (let i = 0; i < 6; i++)
                this.globals[Global.BlitzballMarks + i] = 0xFF;
        }
        if (this.data.name === "bjyt1000")
            this.globals[Global.BaajProgress] = 0x3F;
        else
            this.globals[Global.BaajProgress] = 0;
        this.globals[0x29c] = -50;
        // besaid villagers run on cycles that carry across maps,
        // only reset if we haven't already initialized
        // some other events re-sync to different values
        if (!this.globals[0x119]) {
            for (let i = 0x119; i <= 0x130; i++)
                this.globals[i] = 1; // set to one the first time you enter besaid
        }
        if (this.data.name === "bsvr0100") {
            // skip to middle of scene
            this.workers[0x19].deleteOwnSignal(this.workers[0x19].signalQueue?.next!)
            for (let i = 3; i < 8; i++) {
                this.sendSignal(SignalType.NO_ACK, 0x19, i, 2, 10);
            }
        }
    }
}

function getFirstEmitter(objects: LevelObjectHolder, id: number): Emitter | null {
    for (let i = 0; i < objects.particles.emitters.length; i++) {
        const e = objects.particles.emitters[i];
        if (e.spec.id === id) {
            return e;
        }
    }
    console.warn("couldn't find emitter", id);
    return null;
}

const charCategories = ["PC", "MON", "NPC", "SUM", "WEP", "OBJ", "SKL"];

export function charLabel(id: number): string {
    return `${charCategories[(id >>> 12) & 0xF]}:${hexzero(id & 0xFFF, 3)}`;
}

const enum ButtonType {
    DEFAULT = 0,
    ONE_TIME = 1,
    ACTOR = 2,
    COLLISION = 4,
    PLAYER = 8,
    BATTLE = 16,
    INVISIBLE = 32,
}

function isTrial(name: string): boolean {
    switch (name) {
        case "bsyt0100":
        case "klyt1000":
        case "djyt0600":
        case "mcyt0500":
        case "bvyt1100":
        case "dome0700":
            return true;
    }
    return false;
}

const enum WallNorm {
    NONE,
    POSX,
    POSZ,
    NEGX,
    NEGZ,
}

const buttonPos = vec3.create();
const camScratch = vec3.create();
class Button {
    private elem: HTMLElement;
    public pos = vec3.create();
    public offset = vec3.create();
    public clickRadius = 1;
    public activeRadius = 500;
    public enabledCheck: ((delta: ReadonlyVec3) => boolean) | null = null;

    private owner: Worker;
    private clicked = false;

    constructor(script: EventScript, levelObjects: LevelObjectHolder, public index: number, public flags: ButtonType, onClick: ()=>void, public label = "") {
        this.elem = document.createElement('div');
        this.elem.style.position = 'absolute';
        this.elem.style.pointerEvents = 'auto';
        this.elem.style.cursor = 'pointer';

        this.owner = script.workers[index];
        this.elem.onclick = () => {
            console.log("clicked", this.label)
            onClick();
            this.clicked = true;
        };
        if (isTrial(script.data.name)) {
            this.elem.addEventListener('mousemove', (e) => {
                levelObjects.inputManager.mouseX = e.clientX * window.devicePixelRatio;
                levelObjects.inputManager.mouseY = e.clientY * window.devicePixelRatio;
            });
        }
        levelObjects.context.uiContainer.appendChild(this.elem);
        levelObjects.buttons.push(this);
    }

    public static Signal(script: EventScript, levelObjects: LevelObjectHolder, index: number, message: number, flags = ButtonType.PLAYER | ButtonType.COLLISION): Button {
        return new Button(script, levelObjects, index, flags, () => {
            script.sendSignal(SignalType.NO_ACK, -1, index, 1, message);
        }, `w${hexzero(index, 2)}e${hexzero(message, 2)}`);
    }

    private computePos(objects: LevelObjectHolder, viewer: ViewerRenderInput, dst: vec3): boolean {
        if (!objects.playerActive && (this.flags & ButtonType.PLAYER))
            return false;
        if (this.clicked && (this.flags & ButtonType.ONE_TIME))
            return false;
        if ((this.owner.flags & WorkerFlags.COLLISION_ACTIVE) === 0 && (this.flags & ButtonType.COLLISION))
            return false;
        if (!objects.inBattle && (this.flags & ButtonType.BATTLE))
            return false;
        if (this.flags & ButtonType.ACTOR) {
            const actor = objects.actors[this.index];
            if (!actor || (!(this.flags & ButtonType.INVISIBLE) && !actor.visible))
                return false;
            getMatrixTranslation(this.pos, actor.modelMatrix)
            vec3.sub(this.pos, this.pos, this.offset);
        }
        transformVec3Mat4w0(buttonPos, FFXToNoclip, this.pos);

        getMatrixTranslation(camScratch, viewer.camera.worldMatrix);
        if (vec3.dist(buttonPos, camScratch) > this.activeRadius)
            return false;

        vec3.sub(camScratch, buttonPos, camScratch);
        if (this.enabledCheck && !this.enabledCheck(camScratch))
            return false;

        const camera = viewer.camera;

        // View-space point
        transformVec3Mat4w1(buttonPos, camera.viewMatrix, buttonPos);

        vec3.transformMat4(camScratch, buttonPos, camera.projectionMatrix);
        const screenX = (1 + camScratch[0])*window.innerWidth/2;
        const screenY = (1 - camScratch[1])*window.innerHeight/2;
        if (buttonPos[2] > 1.0)
            return false;

        buttonPos[0] += this.clickRadius;
        vec3.transformMat4(camScratch, buttonPos, camera.projectionMatrix);
        const radius = (1 + camScratch[0])*window.innerWidth/2 - screenX;
        if (radius > window.innerWidth / 4)
            return false;
        vec3.set(dst, screenX, screenY, radius);
        return true;
    }

    public update(objects: LevelObjectHolder, viewer: ViewerRenderInput): void {
        const elem = this.elem;

        if (this.computePos(objects, viewer, buttonPos)) {
            const radius = buttonPos[2];
            elem.style.left = `${buttonPos[0] - radius}px`;
            elem.style.top = `${buttonPos[1] - radius}px`;
            elem.style.width = `${radius*2}px`;
            elem.style.height = `${radius*2}px`;
            elem.style.display = 'block';
            elem.style.borderRadius = `10px`;
            elem.style.color = `#999999`;
        } else {
            elem.style.display = 'none';
        }
    }
}


type momentCondition = number[][] | null;

interface labelEdge {
    source: number;
    moments: momentCondition;
}

interface labelStatus {
    loadsModel: boolean;
    sources: labelEdge[];
}

type fakeStackValue = number | null | "moment" | "comparison";

// function orCondition(status: labelStatus, cond: momentCondition, other: boolean): void {
//     status.hasOtherCondition = status.hasOtherCondition || other;
//     if (!status.condition) {
//         status.condition = cond;
//         return;
//     }
//     if (cond)
//         status.condition = status.condition.concat(...cond);
// }

function union(a: momentCondition, b: momentCondition): momentCondition {
    if (!a || !b)
        return null;
    let ai = 0, bi = 0;
    const out: momentCondition = [];
    let curr: number[] | null = null;
    while (ai < a.length || bi < b.length) {
        let aLower, nextStart;
        if (ai < a.length && bi < b.length) {
            nextStart = Math.min(a[ai][0], b[bi][0]);
            aLower = a[ai][0] < b[bi][0];
        } else if (ai < a.length) {
            aLower = true;
            nextStart = a[ai][0];
        } else {
            aLower = false;
            nextStart = b[bi][0];
        }
        const nextEnd = aLower ? a[ai][1] : b[bi][1];
        if (!curr || nextStart > curr[1]) {
            curr = [nextStart, nextEnd];
            out.push(curr);
        } else {
            curr[1] = nextEnd;
        }
        if (aLower) {
            ai++;
        } else {
            bi++;
        }
    }
    return out;
}

function intersection(a: momentCondition, b: momentCondition): momentCondition {
    if (!a) {
        if (b)
            return new Array(...b);
        return null;
    }
    if (!b)
        return new Array(...a);
    let ai = 0, bi = 0;
    const out: momentCondition = [];
    while (ai < a.length && bi < b.length) {
        if (b[bi][1] <= a[ai][0]) {
            bi++;
            continue;
        }
        if (a[ai][1] <= b[bi][0]) {
            ai++;
            continue;
        }
        const left = Math.max(a[ai][0], b[bi][0]);
        const endA = a[ai][1], endB = b[bi][1];
        const right = Math.min(endA, endB);
        out.push([left, right]);
        if (endA <= endB)
            ai++;
        if (endB <= endA)
            bi++;
    }
    return out;
}

function flipSet(x: momentCondition): momentCondition {
    if (!x)
        return [];
    const out: momentCondition = [];
    let left = -Infinity;
    for (let r of x) {
        if (r[0] > left) {
            out.push([left, r[0]]);
        }
        left = r[1];
    }
    if (left < Infinity)
        out.push([left, Infinity]);
    return out;
}

type compOp = Opcode.LT | Opcode.LTE | Opcode.GT | Opcode.GTE | Opcode.EQ;

function flipOp(op: compOp): compOp {
    switch (op) {
        case Opcode.LT: return Opcode.GT;
        case Opcode.GT: return Opcode.LT;
        case Opcode.LTE: return Opcode.GTE;
        case Opcode.GTE: return Opcode.LTE;
        case Opcode.EQ: return Opcode.EQ;
    }
}


function makeComparison(op: compOp, left: fakeStackValue, right: fakeStackValue): momentCondition {
    if (right === "moment")
        return makeComparison(flipOp(op), right, left);
    if (left !== "moment" || typeof right !== "number")
        return [];
    switch (op) {
        case Opcode.LT: return [[-Infinity, right]];
        case Opcode.LTE: return [[-Infinity, right + 1]];
        case Opcode.GT: return [[right + 1, Infinity]];
        case Opcode.GTE: return [[right, Infinity]];
        case Opcode.EQ: return [[right, right + 1]];
    }
}

function checkGameMoments(data: BIN.ScriptData): number {
    // assume if the "game moment" is referenced it's the first variable
    if (!(data.arrays.length > 0 && data.arrays[0].source === BIN.ArraySource.GLOBAL && data.arrays[0].offset === 0xA00))
        return 0;
    const allModelConds: momentCondition[] = [];
    for (let w of data.workers) {
        if (w.type !== BIN.WorkerType.MOTION)
            continue;

        let offs = w.entrypoints[0];
        const statuses = new Map<number, labelStatus>();
        statuses.set(offs, {
            loadsModel: false,
            sources: [],
        });
        for (let val of w.labels) {
            if (val < w.entrypoints[1]) {
                statuses.set(val, {
                    loadsModel: false,
                    sources: [],
                });
            }
        }
        let currLabel = offs;
        let currCond: momentCondition = null;
        let caseIsMoment = false;
        let stack: (fakeStackValue)[] = [null, null];
        let comparison: momentCondition = null;
        let anyModel = false;

        const push = (x: fakeStackValue) => {
            stack[1] = stack[0];
            stack[0] = x;
        }

        const pop = () => {
            const x = stack[0];
            stack[0] = stack[1];
            stack[1] = null;
            return x;
        }

        while (true) {
            if (offs === w.entrypoints[1])
                break;
            if (w.labels.includes(offs)) {
                if (currLabel >= 0)
                    assertExists(statuses.get(offs)).sources.push({
                        source: currLabel,
                        moments: currCond,
                    });
                currLabel = offs;
                currCond = null;
            }

            const raw = data.code.getUint8(offs++);
            let imm = 0;
            if (raw & 0x80) {
                imm = data.code.getUint16(offs, true);
                offs += 2;
            }
            const op = raw & 0x7F;
            if (op === Opcode.GET_DATUM && imm === 0) {
                push("moment");
            } else if (op === Opcode.SET_CASE) {
                caseIsMoment = pop() === "moment";
            } else if (op === Opcode.GET_CASE) {
                if (caseIsMoment)
                    push("moment");
                else
                    push(null);
            } else if (op === Opcode.IMM) {
                push(imm);
            } else if (op === Opcode.JUMP || op === Opcode.SET_JUMP) {
                assertExists(statuses.get(w.labels[imm])).sources.push({
                    source: currLabel,
                    moments: currCond,
                })
                // we'll pick up the new one's conditions
                currCond = [];
                currLabel = -1;
            } else if (op === Opcode.LT || op === Opcode.LTU) {
                comparison = makeComparison(Opcode.LT, stack[0], stack[1]);
                push("comparison");
            } else if (op === Opcode.LTE || op === Opcode.LTEU) {
                comparison = makeComparison(Opcode.LTE, stack[0], stack[1]);
                push("comparison");
            } else if (op === Opcode.GT || op === Opcode.GTU) {
                comparison = makeComparison(Opcode.GT, stack[0], stack[1]);
                push("comparison");
            } else if (op === Opcode.GTE || op === Opcode.GTEU) {
                comparison = makeComparison(Opcode.GTE, stack[0], stack[1]);
                push("comparison");
            } else if (op === Opcode.EQ) {
                comparison = makeComparison(Opcode.EQ, stack[0], stack[1]);
                push("comparison");
            } else if (op === Opcode.FUNC || op === Opcode.FUNC_RET) {
                if (imm === 0x0001 || imm === 0x0134) {
                    // ignore main party
                    if (typeof stack[0] === "number" && stack[0] > 0xfff) {
                        assertExists(statuses.get(currLabel)).loadsModel = true;
                        anyModel = true;
                    }
                }
                pop();
                pop();
            } else if (op === Opcode.SET_BNEZ || op === Opcode.SET_BEZ) {
                const target = assertExists(statuses.get(w.labels[imm]));
                if (stack[0] === "comparison" && comparison) {
                    const trueCond = intersection(currCond, comparison);
                    const falseCond = intersection(currCond, flipSet(comparison));
                    target.sources.push({
                        source: currLabel,
                        moments: op === Opcode.SET_BNEZ ? trueCond : falseCond,
                    })
                    currCond = op === Opcode.SET_BNEZ ? falseCond : trueCond;
                } else {
                    target.sources.push({
                        source: currLabel,
                        moments: currCond,
                    })
                }
                comparison = null;
                pop();
            } else if (op === Opcode.NOT_LOGIC) {
                if (stack[0] === "comparison" && comparison) {
                    comparison = flipSet(comparison);
                } else {
                    push(null);
                }
            } else {
                push(null);
            }


        }
        if (anyModel) {
            const fullConditions = new Map<number, momentCondition>();
            const computeFull = (offs: number): momentCondition => {
                const cached = fullConditions.get(offs);
                if (cached !== undefined)
                    return cached;
                const status = assertExists(statuses.get(offs));
                let acc: momentCondition = [];
                if (offs === w.entrypoints[0])
                    acc = null;
                else {
                    // hopefully no loops
                    for (let edge of status.sources) {
                        acc = union(acc, intersection(edge.moments, computeFull(edge.source)));
                    }
                }
                fullConditions.set(offs, acc);
                return acc;
            }
            let models: momentCondition = [];
            for (let [o, st] of statuses.entries()) {
                const full = computeFull(o);
                if (st.loadsModel)
                    models = union(models, full);
            }
            if (models && models.length > 0)
                allModelConds.push(models);
        }
    }
    console.log(allModelConds);
    const allEndpoints = new Set<number>();
    for (let cond of allModelConds) {
        if (!cond)
            continue;
        for (let rng of cond) {
            allEndpoints.add(rng[0]);
            allEndpoints.add(rng[1]);
        }
    }
    const endPointList: number[] = new Array(...allEndpoints).sort((a,b) => a-b);
    const lookup: number[] = [];
    for (let i = 0; i < endPointList.length; i++) {
        lookup[endPointList[i]] = i;
    }
    const counts = nArray(endPointList.length, () => 0);
    for (let cond of allModelConds) {
        if (!cond)
            continue;
        for (let range of cond) {
            for (let i = lookup[range[0]]; i < lookup[range[1]]; i++) {
                counts[i]++;
            }
        }
    }
    console.log(endPointList, counts)
    let max = 0, out = 0;
    for (let i = 0; i < counts.length; i++) {
        if (counts[i] > max) {
            max = counts[i];
            out = endPointList[i];
        }
    }
    return out;
}