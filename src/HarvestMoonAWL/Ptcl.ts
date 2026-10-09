
// The VFX/particle system 
// map.ptl - behaviour definitions
// map.txg  - particle textures
// map1-p-ptcl.oqt - where each is placed in the world

import { mat3, mat4, vec3 } from "gl-matrix";

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { lerp } from "../MathHelpers.js";
import * as Cloud from "./Cloud.js";
import * as Env from "./Env.js";

//#region map.ptl

// only three of the nine HSD shapes appear in AWL
export const enum PtlShape {
    Disc = 0,
    Line = 1,
    Rect = 5,
}

const KIND_HAS_GRAVITY = 1 << 0;
const KIND_HAS_FRICTION = 1 << 1;

const KIND_BLEND_SHIFT = 22;
const KIND_BLEND_MASK = 3;
const KIND_Z_WRITE = 1 << 3;
const KIND_NO_Z_TEST = 1 << 28;

const KIND_EMIT_IMMEDIATELY = 1 << 8;

export interface PtlMotionEvent {
    tick: number;
    // set replaces the vector outright, add accumulates onto it.
    set: boolean;
    position: boolean; // false = velocity
    // undefined = don't change this axis
    x: number | undefined;
    y: number | undefined;
    z: number | undefined;
}

export interface PtlRamp<T> {
    startTick: number;
    duration: number;
    target: T;
}

export interface PtlRecord {
    shape: PtlShape;
    texGroup: number;
    life: number;

    grav: number;
    fric: number;
    vel: vec3;
    radius: number;
    random: number;
    size: number;
    param1: number;
    param2: number;
    param3: number;

    texturePose: number;
    motion: PtlMotionEvent[];
    sizeRamps: PtlRamp<number>[];
    colorRamps: PtlRamp<Color>[];
    // Could we parse to record end?
    // If false: effect renders, but script doesn't run
    cmdListValid: boolean;
    scriptEndTick: number;

    hasGravity: boolean;
    hasFriction: boolean;
    emitImmediately: boolean;
    blendMode: number;
    zTest: boolean;
    zWrite: boolean;
}

export function materialKeyForRecord(rec: PtlRecord): string {
    return `particle:b${rec.blendMode}:${rec.zTest ? "zt" : "zn"}:${rec.zWrite ? "zw" : "zr"}`;
}

const CMDLIST_OFFSET = 0x3C;

export function parse(buffer: ArrayBufferSlice): PtlRecord[] {
    const view = buffer.createDataView();

    const numRecords = view.getUint32(0x08);
    const offsets: number[] = [];
    for (let i = 0; i < numRecords; i++)
        offsets.push(view.getUint32(0x0C + i * 0x04));

    const records: PtlRecord[] = [];
    for (let i = 0; i < numRecords; i++) {
        const offs = offsets[i];
        const end = i + 1 < numRecords ? offsets[i + 1] : buffer.byteLength;

        const typeRaw = view.getUint16(offs + 0x00);
        const kind = view.getUint32(offs + 0x08);
        const rec: PtlRecord = {
            shape: (typeRaw & 0x07) as PtlShape,
            texGroup: view.getUint16(offs + 0x02),
            life: view.getUint16(offs + 0x06),
            grav: view.getFloat32(offs + 0x0C),
            fric: view.getFloat32(offs + 0x10),
            vel: vec3.fromValues(view.getFloat32(offs + 0x14), view.getFloat32(offs + 0x18), view.getFloat32(offs + 0x1C)),
            radius: view.getFloat32(offs + 0x20),
            random: view.getFloat32(offs + 0x28),
            size: view.getFloat32(offs + 0x2C),
            param1: view.getFloat32(offs + 0x30),
            param2: view.getFloat32(offs + 0x34),
            param3: view.getFloat32(offs + 0x38),

            texturePose: 0,
            motion: [],
            sizeRamps: [],
            colorRamps: [],
            cmdListValid: false,
            scriptEndTick: Infinity,

            hasGravity: !!(kind & KIND_HAS_GRAVITY),
            hasFriction: !!(kind & KIND_HAS_FRICTION),
            emitImmediately: !!(kind & KIND_EMIT_IMMEDIATELY),
            blendMode: (kind >>> KIND_BLEND_SHIFT) & KIND_BLEND_MASK,
            zTest: !(kind & KIND_NO_Z_TEST),
            zWrite: !!(kind & KIND_Z_WRITE),
        };

        walkCommands(rec, view, offs + CMDLIST_OFFSET, end);
        records.push(rec);
    }

    return records;
}

const SKIPPED_OPCODE_OPERAND_BYTES: { [op: number]: number } = {
    0xA8: 12, // 3 x f32
    0xAC: 9,  // u8 + 2 x f32
    0xAD: 0,
    0xED: 9,  // f32 + f32 + u8
};

function walkCommands(rec: PtlRecord, view: DataView, start: number, end: number): void {
    const motion: PtlMotionEvent[] = [];
    const sizeRamps: PtlRamp<number>[] = [];
    const colorRamps: PtlRamp<Color>[] = [];
    let tick = 0;
    let p = start;

    const readCount = (): number => {
        let cnt = view.getUint8(p++);
        if (cnt & 0x80)
            cnt = ((cnt & 0x7F) << 8) + view.getUint8(p++);
        return cnt;
    };

    while (p < end) {
        const op = view.getUint8(p++);

        if (op < 0x80) {
            let wait = op & 0x1F;
            if (op & 0x20)
                wait = wait * 0x100 + view.getUint8(p++);
            if ((op & 0xC0) === 0x40)
                rec.texturePose = view.getUint8(p++);
            tick += wait;
        } else if (op >= 0x80 && op < 0xA0) {
            const axes = op & 0x07;
            const ev: PtlMotionEvent = {
                tick,
                set: (op & 0x08) === 0,
                position: op < 0x90,
                x: undefined, y: undefined, z: undefined,
            };
            if (axes & 0x4) { ev.x = view.getFloat32(p); p += 4; }
            if (axes & 0x2) { ev.y = view.getFloat32(p); p += 4; }
            if (axes & 0x1) { ev.z = view.getFloat32(p); p += 4; }
            motion.push(ev);
        } else if (op === 0xA0) {
            const duration = readCount();
            const target = view.getFloat32(p); p += 4;
            sizeRamps.push({ startTick: tick, duration, target });
        } else if (op >= 0xC0 && op < 0xE0) {
            const duration = readCount();
            if (op < 0xD0) {
                const r = view.getUint8(p + 0), g = view.getUint8(p + 1);
                const b = view.getUint8(p + 2), a = view.getUint8(p + 3);
                colorRamps.push({ startTick: tick, duration, target: colorNewFromRGBA(r / 255, g / 255, b / 255, a / 255) });
            }
            p += 4;
        } else if (op === 0xFE || op === 0xFF) {
            rec.motion = motion;
            rec.sizeRamps = sizeRamps;
            rec.colorRamps = colorRamps;
            rec.cmdListValid = true;
            rec.scriptEndTick = tick;
            return;
        } else if (SKIPPED_OPCODE_OPERAND_BYTES[op] !== undefined) {
            p += SKIPPED_OPCODE_OPERAND_BYTES[op];
        } else {
            return;
        }
    }
}

//#endregion

//#region p-ptcl placement
// What each index is:
//   0 waterfall
//   1 mist        waterfall mist
//   2 smoke       Nina and Galen's chimney
//   3 (unused)
//   4 plasma      Dary's house
//   5 spigot      Water at the farm
export const PTCL_TYPE_ID_BASE = 10000;

export function ptclTypeIndex(typeId: number): number {
    return typeId - PTCL_TYPE_ID_BASE;
}

//#endregion

//#region simulation

// The chimney smoke is affected by wind. 
export const WIND_PHASE_TICKS = 45;
const WIND_SPEED_SCALE = 0.01;
const WIND_GUST_DC = 1.0;
const WIND_GUST_AC = 0.2;
const WIND_RISE = 0.02;

export const WIND_DRIVEN_TYPE_INDEX = 2;

export function windGeneratorVelocity(dst: vec3, octant: number, speed: number, phaseTicks: number): void {
    Cloud.windDrift(dst, octant, speed);
    const osc = Math.sin(2 * Math.PI * (phaseTicks % WIND_PHASE_TICKS) / WIND_PHASE_TICKS);
    vec3.scale(dst, dst, WIND_SPEED_SCALE * (WIND_GUST_DC + WIND_GUST_AC * osc));
    dst[1] = WIND_RISE;
}

export interface ParticleTypeConfig {
    record: PtlRecord;
    windDriven: boolean;
}

function effectiveLife(rec: PtlRecord): number {
    return Math.min(rec.life, rec.scriptEndTick);
}

const MAX_TICK_STEPS_PER_FRAME = 8;

export const SIZE_TO_HALF_EXTENT = 1.0;

export class Particle {
    public age = 0;
    public alive = false;
    public readonly pos = vec3.create();
    public readonly vel = vec3.create();
    public size = 1;
    public readonly color: Color = colorNewFromRGBA(1, 1, 1, 1);
}

const scratchSpawn = vec3.create();

function computeEmissionFrame(rec: PtlRecord): mat3 | null {
    const FLT_MIN = 1.1754944e-38, EPS = 1.1920929e-7;
    if (rec.shape === PtlShape.Line)
        return null;
    const speed = vec3.length(rec.vel);
    if (speed <= EPS)
        return null;
    const v = vec3.scale(vec3.create(), rec.vel, 1 / speed);

    // degenerate axis, snap to +-90 degrees fallback
    const az = Math.abs(v[2]) < FLT_MIN ? (v[1] >= 0 ? Math.PI / 2 : -Math.PI / 2)
                                        : Math.atan2(v[1], v[2]);
    const a = Math.sin(az), b = Math.cos(az);
    const projected = v[1] * a + v[2] * b;
    const el = Math.abs(projected) < FLT_MIN ? (v[0] >= 0 ? Math.PI / 2 : -Math.PI / 2)
                                             : Math.atan2(v[0], projected);
    const se = Math.sin(el), ce = Math.cos(el);

    const m = mat3.create();
    m[0] = ce;      m[3] = 0;   m[6] = se;
    m[1] = -a * se; m[4] = b;   m[7] = a * ce;
    m[2] = -b * se; m[5] = -a;  m[8] = b * ce;
    return m;
}

let emitterSeedCounter = 0;

const EMIT_EPSILON = 1.1920929e-7;

export class ParticleEmitter {
    public particles: Particle[] = [];
    public worldMatrix = mat4.create();

    private emitRate: number;
    private emitAccumulator: number;
    private tickAccumulator = 0;
    // identical across reloads
    private seed: number;
    private lifeTicks: number;

    private emissionFrame: mat3 | null;

    private readonly generatorVel = vec3.create();
    private windPhase = 0;
    private windOctant = Cloud.DEFAULT_WIND_OCTANT;
    private windSpeed = Cloud.DEFAULT_WIND_SPEED;

    constructor(public config: ParticleTypeConfig) {
        const rec = config.record;
        this.seed = (0x9E3779B9 + Math.imul(emitterSeedCounter++, 0x85EBCA6B)) >>> 0;
        this.emitRate = rec.random;
        this.lifeTicks = effectiveLife(rec);

        if (rec.emitImmediately)
            this.emitAccumulator = this.emitRate >= 0 ? 1 - EMIT_EPSILON : (EMIT_EPSILON < 1 + this.emitRate ? 1 : 0);
        else
            this.emitAccumulator = this.emitRate >= 0 ? this.rand() : 0;

        const capacity = Math.max(1, Math.ceil(Math.abs(this.emitRate) * this.lifeTicks) + 1);
        for (let i = 0; i < capacity; i++)
            this.particles.push(new Particle());

        vec3.copy(this.generatorVel, rec.vel);
        this.emissionFrame = computeEmissionFrame(rec);
    }

    private rand(): number {
        let x = this.seed;
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        this.seed = x;
        return x / 0x100000000;
    }

    private spawnOffset(out: vec3): void {
        const rec = this.config.record;
        const eps = 1e-4;
        vec3.zero(out);

        let spread = false;
        if (rec.shape === PtlShape.Disc && Math.abs(rec.radius) > eps) {
            const angle = lerp(rec.param1, rec.param2, this.rand());
            const r = rec.radius * this.rand();
            out[0] = r * Math.cos(angle);
            out[1] = r * Math.sin(angle);
            spread = true;
        } else if (rec.shape === PtlShape.Rect) {
            out[0] = (this.rand() - 0.5) * rec.param1;
            out[1] = (this.rand() - 0.5) * rec.param2;
            out[2] = (this.rand() - 0.5) * rec.param3;
            spread = true;
        }

        if (spread && this.emissionFrame !== null)
            vec3.transformMat3(out, out, this.emissionFrame);
    }

    private spawn(p: Particle): void {
        const rec = this.config.record;

        p.age = 0;
        p.alive = true;

        vec3.copy(p.vel, this.generatorVel);
        for (const ev of rec.motion) {
            if (ev.tick !== 0 || ev.position)
                continue;
            applyMotionEvent(p.vel, ev);
        }

        this.spawnOffset(scratchSpawn);
        vec3.copy(p.pos, scratchSpawn);

        for (const ev of rec.motion) {
            if (ev.tick !== 0 || !ev.position)
                continue;
            applyMotionEvent(p.pos, ev);
        }

        p.size = evaluateSizeRamps(rec.sizeRamps, 0, rec.size);
        evaluateColorRamps(p.color, rec.colorRamps, 0);
    }

    private tick(): void {
        const rec = this.config.record;

        if (this.config.windDriven) {
            this.windPhase = (this.windPhase + 1) % WIND_PHASE_TICKS;
            windGeneratorVelocity(this.generatorVel, this.windOctant, this.windSpeed, this.windPhase);
        }

        for (const p of this.particles) {
            if (!p.alive)
                continue;
            if (rec.hasFriction)
                vec3.scale(p.vel, p.vel, rec.fric);
            if (rec.hasGravity)
                p.vel[1] -= rec.grav;
            vec3.add(p.pos, p.pos, p.vel);

            p.size = evaluateSizeRamps(rec.sizeRamps, p.age, rec.size);
            evaluateColorRamps(p.color, rec.colorRamps, p.age);

            if (++p.age >= this.lifeTicks)
                p.alive = false;
        }

        if (this.emitRate >= 0)
            this.emitAccumulator += this.emitRate * this.rand();
        else
            this.emitAccumulator -= this.emitRate;

        while (this.emitAccumulator >= 1) {
            this.emitAccumulator -= 1;
            const free = this.particles.find((p) => !p.alive);
            if (free === undefined)
                break;
            this.spawn(free);
        }
    }

    public update(deltaTimeMs: number, windOctant: number, windSpeed: number): void {
        this.windOctant = windOctant;
        this.windSpeed = windSpeed;

        this.tickAccumulator += (deltaTimeMs / 1000) * Env.ROM_LOGIC_FPS;
        let steps = 0;
        while (this.tickAccumulator >= 1 && steps < MAX_TICK_STEPS_PER_FRAME) {
            this.tickAccumulator -= 1;
            this.tick();
            steps++;
        }
        if (this.tickAccumulator > MAX_TICK_STEPS_PER_FRAME)
            this.tickAccumulator = 0;
    }
}

function applyMotionEvent(dst: vec3, ev: PtlMotionEvent): void {
    if (ev.x !== undefined) dst[0] = ev.set ? ev.x : dst[0] + ev.x;
    if (ev.y !== undefined) dst[1] = ev.set ? ev.y : dst[1] + ev.y;
    if (ev.z !== undefined) dst[2] = ev.set ? ev.z : dst[2] + ev.z;
}

function evaluateSizeRamps(ramps: PtlRamp<number>[], age: number, base: number): number {
    let value = base;
    for (const ramp of ramps) {
        if (age < ramp.startTick)
            break;
        if (ramp.duration <= 0 || age >= ramp.startTick + ramp.duration) {
            value = ramp.target;
            continue;
        }
        return lerp(value, ramp.target, (age - ramp.startTick) / ramp.duration);
    }
    return value;
}

const scratchColorFrom: Color = colorNewFromRGBA(1, 1, 1, 1);

function evaluateColorRamps(dst: Color, ramps: PtlRamp<Color>[], age: number): void {
    dst.r = dst.g = dst.b = dst.a = 1;
    scratchColorFrom.r = scratchColorFrom.g = scratchColorFrom.b = scratchColorFrom.a = 1;
    for (const ramp of ramps) {
        if (age < ramp.startTick)
            return;
        if (ramp.duration <= 0 || age >= ramp.startTick + ramp.duration) {
            dst.r = ramp.target.r; dst.g = ramp.target.g;
            dst.b = ramp.target.b; dst.a = ramp.target.a;
            scratchColorFrom.r = dst.r; scratchColorFrom.g = dst.g;
            scratchColorFrom.b = dst.b; scratchColorFrom.a = dst.a;
            continue;
        }
        const t = (age - ramp.startTick) / ramp.duration;
        dst.r = lerp(scratchColorFrom.r, ramp.target.r, t);
        dst.g = lerp(scratchColorFrom.g, ramp.target.g, t);
        dst.b = lerp(scratchColorFrom.b, ramp.target.b, t);
        dst.a = lerp(scratchColorFrom.a, ramp.target.a, t);
        return;
    }
}

//#endregion
