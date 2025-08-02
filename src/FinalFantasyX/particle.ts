import { ReadonlyVec3, ReadonlyVec4, mat4, vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as GS from "../Common/PS2/GS.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { CalcBillboardFlags, calcBillboardMatrix, clamp, computeModelMatrixS, computeModelMatrixSRT, getMatrixAxisX, getMatrixAxisY, getMatrixTranslation, invlerp, lerp, MathConstants, normToLength, randomRange, scaleMatrix, setMatrixAxis, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3One, Vec3UnitZ, Vec3Zero } from "../MathHelpers.js";
import { assert, assertExists, hexzero, nArray } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";
import { Texture } from "./bin.js";
import { BufferFiller, BufferPoolManager, ElectricRenderer, EulerOrder, FFXToNoclip, FlipbookData, FlipbookRenderer, FullScreenColor, GeoParticleInstance, GeoParticleMode, LevelModelData, RainRenderer, TextureData, prevFrameBinding, rotationMatrixFromEuler } from "./render.js";
import { LevelObjectHolder } from "./script.js";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { Blue, Green, Magenta, White, colorFromRGBA, colorNewFromRGBA } from "../Color.js";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { MagicLayout } from "./magic.js";
import { fillVec3v } from "../gfx/helpers/UniformBufferHelpers.js";

const PARTICLE_VEC_COUNT = 26;
const FRAME_RATE = 30;

export class Particle {
    emitter: Emitter;
    created: number;
    parent: Particle | null;
    next: Particle | null;
    scratch: (ScratchBuffer | undefined)[] = [];

    visible = true;
    t: number;
    prevT: number;
    flags = 0;
    public pose = mat4.create();
    public render = mat4.create();

    // instructions reference extra scratch
    public vecs = nArray(PARTICLE_VEC_COUNT, () => vec4.create());

    constructor(public id: number) {
        this.reset();
    }

    public reset(): void {
        this.t = 0;
        this.prevT = -.01;
        this.flags = 0;
        this.next = null;
        this.parent = null;
        this.visible = true;
        mat4.identity(this.pose);
        mat4.identity(this.render);

        for (let i = 0; i < this.vecs.length; i++)
            vec4.zero(this.vecs[i]);
    }

    public freeChain(system: ParticleSystem): void {
        if (this.next !== null) {
            this.next.freeChain(system);
            this.next = null;
        }
        for (let i = 0; i < this.scratch.length; i++) {
            const s = this.scratch[i];
            if (s) {
                s.inUse = false;
                this.scratch[i] = undefined;
            }
        }
        returnParticle(this, system);
    }

    public crossed(t: number): boolean {
        return this.prevT < t && this.t >= t;
    }
}

interface InstructionData {
    t: number;
}

function currInstructionData<T extends InstructionData>(t: number, data: T[]): T {
    let curr = data[0];
    for (let i = 0; i < data.length; i++) {
        if (data[i].t <= t)
            curr = data[i];
    }
    return curr;
}

interface Vec4Data {
    t: number;
    vec: vec4;
}

interface RandomStepData {
    t: number;
    target: number;
    vec: vec4;
    peaked: boolean;
}

type Remapper = (offs: number, types?: string[]) => number;

class Instruction {
    public opcode: number;
    public renders = false; // just for validation

    public update(p: Particle, system: ParticleSystem): void { }

    public reset(p: Particle): void { }

    public loop(p: Particle): void {
        this.reset(p); // by default, same as reset
    }

    public render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void { }

    public renderAll(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void { }

    public clipEmitter(): boolean { return false; } // by default, leave distant emitters running
}

abstract class ScratchInstruction<T extends InstructionData> extends Instruction {
    public data: T[] = [];
    public scratchIndex = 0;
    public abstract scratchSize(): number;
    public abstract initScratch(buf: ScratchBuffer, data: T): void;
}

function ensureScratch<T extends InstructionData>(inst: ScratchInstruction<T>, p: Particle, data: ParticleData): ScratchBuffer {
    const curr = p.scratch[inst.scratchIndex];
    if (curr)
        return curr;
    const buf = getScratch(data);
    p.scratch[inst.scratchIndex] = buf;
    inst.initScratch(buf, currInstructionData(p.t, inst.data));
    return buf;
}

class NOP extends Instruction {}

class Step extends Instruction {
    public base: number;
    constructor(public data: Vec4Data[], r: Remapper, offsets: Uint32Array) {
        super();
        this.base = r(offsets[0]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.base], p.vecs[this.base], currData.vec);
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.base]);
    }
}

class LoopStep extends Step {
    public override loop(p: Particle): void {
        vec4.sub(p.vecs[this.base], p.vecs[this.base], this.data[0].vec);
    }
}

const enum Distribution {
    UNIFORM,
    TRIANGLE,
    CUSP,
}

function randomFactor(dist: Distribution): number {
    switch (dist) {
        case Distribution.UNIFORM: return Math.random() * 2 - 1;
        case Distribution.TRIANGLE: return Math.random() + Math.random() - 1;
        case Distribution.CUSP: return Math.random() * (Math.random() * 2 - 1);
    }
}

function randomCuboid(dst: vec4, base: vec4, range: vec4, dist: Distribution): void {
    for (let i = 0; i < 3; i++)
        dst[i] = base[i] + range[i] * randomFactor(dist);
}

const enum RandomRange {
    SYMMETRIC,
    POSITIVE,
    NEGATIVE,
}

class RandomStep extends Instruction {
    private range = RandomRange.SYMMETRIC;
    constructor(public data: RandomStepData[], r: Remapper, offsets: Uint32Array) {
        super();
        for (let d of data) {
            if (d.target >= 0)
                d.target = r(d.target);
        }
    }

    public static range(mode: RandomRange): TypedInstructionBuilder<RandomStepData> {
        return (data: RandomStepData[], r: Remapper, offsets: Uint32Array) => {
            const inst = new RandomStep(data, r, offsets);
            inst.range = mode;
            return inst;
        }
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t)) {
            let factor = randomFactor(currData.peaked ? Distribution.TRIANGLE : Distribution.UNIFORM);
            if (this.range != RandomRange.SYMMETRIC) // shift from [-1,1] to [0,1]
                factor = (factor + 1)/2;
            if (this.range === RandomRange.NEGATIVE)
                factor *= -1;
            if (currData.target >= 0)
                vec4.scaleAndAdd(p.vecs[currData.target], p.vecs[currData.target], currData.vec, factor);
        }
    }
}

class SetValue extends Instruction {
    public base: number;

    constructor(public data: Vec4Data[], r: Remapper, offsets: Uint32Array) {
        super();
        this.base = r(offsets[0]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t)) {
            p.vecs[this.base][0] = currData.vec[0];
            p.vecs[this.base][1] = currData.vec[1];
            p.vecs[this.base][2] = currData.vec[2];
        }
    }

    public override reset(p: Particle): void {
        p.vecs[this.base][3] = 1;
    }

    public override loop(p: Particle): void {}
}

class Velocity extends Instruction {
    public base: number;
    public vel: number;

    constructor(public data: Vec4Data[], r: Remapper, offsets: Uint32Array) {
        super();
        this.base = r(offsets[0]);
        this.vel = r(offsets[1]);
    }

    public static reverse(data: Vec4Data[], r: Remapper, offsets: Uint32Array): Instruction {
        const v = new Velocity(data, r, offsets);
        const temp = v.vel;
        v.vel = v.base;
        v.base = temp;
        return v;
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        vec4.scaleAndAdd(p.vecs[this.base], p.vecs[this.base], p.vecs[this.vel], dt);
        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.vel], p.vecs[this.vel], currData.vec);
            // accumulate one frame of new velocity, could make this continuous instead
            const newDT = p.t - currData.t;
            vec4.scaleAndAdd(p.vecs[this.base], p.vecs[this.base], currData.vec, 1 + newDT);
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.vel]);
    }
}

class ColorVelocity extends Instruction {
    public base: number;
    public vel: number;

    constructor(public data: Vec4Data[], r: Remapper, offsets: Uint32Array) {
        super();
        this.base = r(offsets[0]);
        this.vel = r(offsets[1]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t))
            vec4.add(p.vecs[this.vel], p.vecs[this.vel], currData.vec);
        // update on integer crossings to ensure accuracy with game
        if (p.prevT < (p.t | 0))
            vec4.add(p.vecs[this.base], p.vecs[this.base], p.vecs[this.vel]);
        for (let i = 0; i < 4; i++) {
            p.vecs[this.base][i] %= 0x10000;
            p.vecs[this.vel][i] %= 0x10000;
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.vel]);
    }
}

const instScr3 = vec3.create();
const instScr4 = vec4.create();
class RandomCube extends Instruction {
    public random: number;
    private range = RandomRange.SYMMETRIC;
    constructor(public data: RandomStepData[], r: Remapper, offsets: Uint32Array) {
        super();
        for (let d of data) {
            if (d.target >= 0)
                d.target = r(d.target);
        }
        this.random = r(offsets[0]);
    }
    public static range(mode: RandomRange): TypedInstructionBuilder<RandomStepData> {
        return (data: RandomStepData[], r: Remapper, offsets: Uint32Array) => {
            const inst = new RandomCube(data, r, offsets);
            inst.range = mode;
            return inst;
        }
    }
    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const rand = p.vecs[this.random];
        if (p.crossed(0)) {
            rand[0] = randomFactor(currData.peaked ? Distribution.TRIANGLE : Distribution.UNIFORM);
            rand[1] = randomFactor(currData.peaked ? Distribution.TRIANGLE : Distribution.UNIFORM);
            rand[2] = randomFactor(currData.peaked ? Distribution.TRIANGLE : Distribution.UNIFORM);
            if (this.range !== RandomRange.SYMMETRIC) {
                const sign = this.range === RandomRange.POSITIVE ? 1 : -1;
                for (let i = 0; i < 3; i++)
                    rand[i] = sign * (rand[i] + 1)/2;
            }
        }
        if (p.crossed(currData.t) && currData.target >= 0) {
            vec4.mul(instScr4, rand, currData.vec);
            vec4.add(p.vecs[currData.target], p.vecs[currData.target], instScr4);
        }
    }
}


class SetPos extends Instruction {
    public pos: number;

    constructor(r: Remapper, offsets: Uint32Array) {
        super();
        this.pos = r(offsets[0]);
    }

    public override update(p: Particle): void {
        const pos = p.vecs[this.pos];
        p.pose[12] = pos[0];
        p.pose[13] = pos[1];
        p.pose[14] = pos[2];
    }
}

class PosScale extends Instruction {
    public pos: number;
    public scale: number;

    constructor(r: Remapper, offsets: Uint32Array) {
        super();
        this.pos = r(offsets[0]);
        this.scale = r(offsets[1]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const diag = p.vecs[this.scale];
        const pos = p.vecs[this.pos];
        p.pose[0] = diag[0];
        p.pose[5] = diag[1];
        p.pose[10] = diag[2];
        p.pose[12] = pos[0];
        p.pose[13] = pos[1];
        p.pose[14] = pos[2];
    }
}

interface PointLightData {
    t: number;
    radius: number;
    lightGroup: number;
    strength: number;
}

class PointLight extends Instruction {
    public override renders = true;
    public pos: number;
    public color: number;

    constructor(public data: PointLightData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.pos = r(offsets[2]);
        this.color = r(offsets[1]);
    }
}

interface PointLightGroupData {
    t: number;
    radius: number;
    lightGroup: number;
    strength: number;
    pattern: number;
}

class PointLightGroup extends Instruction {
    public override renders = true;
    public pos: number;
    public color: number;
    public scale: number; // of the pattern

    constructor(public data: PointLightData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.color = r(offsets[1]);
        this.pos = r(offsets[2]);
        this.scale = r(offsets[3]);
    }
}

const toRad = MathConstants.TAU / 0x10000;
class PosRotScale extends Instruction {
    public pos: number;
    public euler: number;
    public scale: number;

    constructor(public order: EulerOrder, r: Remapper, offsets: Uint32Array) {
        super();
        this.pos = r(offsets[0]);
        this.euler = r(offsets[1]);
        this.scale = r(offsets[2]);
    }

    public static order(order: EulerOrder): SimpleBuilder {
        return (r: Remapper, offsets: Uint32Array) => new PosRotScale(order, r, offsets);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const pos = p.vecs[this.pos];
        const euler = p.vecs[this.euler];
        const scale = p.vecs[this.scale];
        if (this.order === EulerOrder.XYZ) {
            computeModelMatrixSRT(
                p.pose,
                scale[0], scale[1], scale[2],
                euler[0] * toRad, euler[1]*toRad, euler[2]*toRad,
                pos[0], pos[1], pos[2],
            );
        } else {
            vec3.set(instScr3, euler[0], euler[1], euler[2]);
            vec3.scale(instScr3, instScr3, toRad);
            rotationMatrixFromEuler(p.pose, instScr3, this.order);
            scaleMatrix(p.pose, p.pose, scale[0], scale[1], scale[2]);
            vec3.set(instScr3, pos[0], pos[1], pos[2]);
            setMatrixTranslation(p.pose, instScr3);
        }
    }
}

class ComposedMatrix extends Instruction {
    public override render(p: Particle): void {
        mat4.mul(p.render, p.emitter.toView, p.pose);
    }
}

const viewScratch = vec3.create();
function preserveViewAtPoint(dst: mat4, view: mat4, preCorrected = false): void {
    getMatrixTranslation(viewScratch, dst);
    // correct screen coordinates, and also fix translation if view doesn't already
    mat4.mul(dst, FFXToNoclip, dst);
    // if (preCorrected)
    //     transformVec3Mat4w0(viewScratch, FFXToNoclip, viewScratch);
    // else
    //     getMatrixTranslation(viewScratch, dst);
    transformVec3Mat4w1(viewScratch, view, viewScratch);
    // if (!preCorrected)
    //     transformVec3Mat4w0(viewScratch, FFXToNoclip, viewScratch);
    setMatrixTranslation(dst, viewScratch);
}

class StandardMatrix extends Instruction {
    public override render(p: Particle): void {
        mat4.scale(p.render, p.pose, p.emitter.scale);
        preserveViewAtPoint(p.render, p.emitter.toView, false);
    }
}

// This differs from game logic, but I think implements the intent
// it's used for e.g. the salvage ship spotlights, to make sure the spotlight mesh
// is always billboarded along its axis (the Y axis)
// the game logic preserves the emitter's Y, which won't be the mesh's
class AxialBillboardMatrix extends Instruction {
    public override render(p: Particle): void {
        mat4.mul(p.render, p.emitter.toView, p.pose);
        calcBillboardMatrix(p.render, p.render, CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.UseZPlane);
    }
}

interface EnabledData {
    t: number;
    enabled: boolean;
}

class ApplyParent extends Instruction {
    constructor(public data: EnabledData[], r: Remapper, offsets: Uint32Array) {
        super();
    }

    public override update(p: Particle, system: ParticleSystem): void {
        if (p.parent === null) {
            console.warn("missing parent for", p);
            return;
        }
        const currData = currInstructionData(p.t, this.data);
        if (currData.enabled) {
            getMatrixTranslation(instScr3, p.pose);
            transformVec3Mat4w1(instScr3, p.parent.pose, instScr3);
            setMatrixTranslation(p.pose, instScr3);
        }
    }
}

interface SimpleFlipbookData {
    t: number;
    index: number;
    speed: number;
    fog: boolean;
    fade: boolean;
    depth: boolean;
}

function flipbookFrameAtT(frames: FlipbookFrame[], t: number, speed: number): number {
    let idx = 0;
    t *= speed;
    while (t >= frames[idx].duration) {
        t -= frames[idx].duration;
        if (idx === frames.length - 1) {
            if (frames[idx].flags & 0x80)
                idx = 0;
            else {
                return idx;
            }
        } else
            idx++;
    }
    return idx;
}

function updateFlipbook(state: vec4, frames: FlipbookFrame[], dt: number, speed: number): void {
    state[1] += dt * speed;
    while (state[1] >= frames[state[0]].duration) {
        state[1] -= frames[state[0]].duration;
        if (state[0] === frames.length - 1) {
            if (frames[state[0]].flags & 0x80)
                state[0] = 0;
            state[1] = 0;
        } else
            state[0]++;
    }
}

const colorScratch = vec4.create();
class SimpleFlipbook extends Instruction {
    public override renders = true;
    private color = 0;
    private frame = 0;
    private depth = 0;

    constructor(public data: SimpleFlipbookData[], r: Remapper, offsets: Uint32Array, program: Program) {
        super();
        for (let i = 1; i < data.length; i++)
            assert((data[i].index === data[0].index && data[i].speed === data[0].speed) || data[i].t === program.lifetime);
        this.frame = r(offsets[0]);
        this.color = r(offsets[1]);
        this.depth = r(offsets[3]);
    }

    public override renderAll(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        if (this.data[0].index === 0xFFFF)
            return;
        const flip = assertExists(data.flipbooks[this.data[0].index]);
        for (let curr: Particle | null = p; curr !== null; curr = curr.next) {
            if (!curr.visible)
                continue;
            const state = curr.vecs[this.frame];
            getColor(colorScratch, curr, this.color);
            const depth = this.data[0].depth ? p.vecs[this.depth][0] : 0;
            data.flipbookRenderer.render(renderInstManager, viewerInput, flip, state[0], colorScratch, curr.render, depth);
            if (curr.prevT >= 0)
                updateFlipbook(state, flip.flipbook.frames, curr.t - curr.prevT, this.data[0].speed);
        }
    }

    public override reset(p: Particle): void {
        p.vecs[this.frame][0] = 0;
        p.vecs[this.frame][1] = 0;
    }
}

interface FlippedFlipbookData {
    t: number;
    index: number;
    speed: number;
    fog: boolean;
    fade: boolean;
    depth: boolean;
    flipX: boolean;
    flipY: boolean;
}

class FlippedFlipbook extends Instruction {
    public override renders = true;
    private color = 0;
    private state = 0;
    private pos = 0;
    private scale = 0;

    constructor(public data: FlippedFlipbookData[], r: Remapper, offsets: Uint32Array) {
        super();
        for (let i = 1; i < data.length; i++)
            assert(data[i].index === data[0].index && data[i].speed === data[0].speed);
        this.state = r(offsets[0]);
        this.pos = r(offsets[1]);
        this.scale = r(offsets[2]);
        this.color = r(offsets[3]);
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const flip = assertExists(data.flipbooks[this.data[0].index]);
        const currData = currInstructionData(p.t, this.data);
        if (p.vecs[this.state][2] === 0) {
            p.vecs[this.state][2] = currData.flipX ? Math.sign(Math.random() - .5) : 1;
            p.vecs[this.state][3] = currData.flipY ? Math.sign(Math.random() - .5) : 1;
        }
        const state = p.vecs[this.state];
        getColor(colorScratch, p, this.color);
        // overwrite render matrix!
        mat4.identity(p.render);
        const diag = p.vecs[this.scale];
        const pos = p.vecs[this.pos];
        p.render[0] = diag[0] * p.vecs[this.state][2] * p.emitter.scale[0];
        p.render[5] = diag[1] * p.vecs[this.state][3] * p.emitter.scale[1];
        p.render[10] = diag[2] * p.emitter.scale[2];
        p.render[12] = pos[0];
        p.render[13] = pos[1];
        p.render[14] = pos[2];
        mat4.mul(p.render, p.emitter.toView, p.render);

        data.flipbookRenderer.render(renderInstManager, viewerInput, flip, state[0], colorScratch, p.render);
        if (p.prevT >= 0)
            updateFlipbook(state, flip.flipbook.frames, p.t - p.prevT, this.data[0].speed);
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }
}

interface FlipbookClusterData {
    t: number;
    index: number;
    childCount: number;
    speed: number;
    offsetRange: vec4;
    offsedPeaked: boolean;
    vel: vec4;
    velRange: vec4;
    accel: vec4;
    scale: vec4;
    scaleRange: vec4;
    scaleVel: vec4;
    scaleAccel: vec4;
    rollRange: number;
    resetCount: number;
    resetInterval: number;
    fog: boolean;
    fade: boolean;
    adjustDepth: boolean;
    depthOffset: vec4;
    depthScale: vec4;
    depthType: number;
    mirrorFlags: number;
}

function normalizeColumns(dst: mat4): void {
    const x = 1 / Math.hypot(dst[0], dst[1], dst[2]);
    const y = 1 / Math.hypot(dst[4], dst[5], dst[6]);
    const z = 1 / Math.hypot(dst[8], dst[9], dst[10]);
    dst[0] *= x;
    dst[1] *= x;
    dst[2] *= x;
    dst[4] *= y;
    dst[5] *= y;
    dst[6] *= y;
    dst[8] *= z;
    dst[9] *= z;
    dst[10] *= z;
}

const CLUSTER_VEC_COUNT = 3;

class ClusterChild {
    public pos = vec4.create();
    public vel = vec4.create();
    public scale = vec4.create();
    public roll = 0;
    public startT = 0;
    public mirrorX = false;
    public mirrorY = false;
}

const childScr = new ClusterChild();

function getChild(buf: ScratchBuffer, i: number, child: ClusterChild): void {
    buf.get4(i * CLUSTER_VEC_COUNT + 0, child.pos);
    buf.get4(i * CLUSTER_VEC_COUNT + 1, child.vel);
    buf.get4(i * CLUSTER_VEC_COUNT + 2, child.scale);
    child.startT = child.pos[3];
    child.roll = child.vel[3];
    const flags = child.scale[3];
    child.mirrorX = (flags & 1) !== 0;
    child.mirrorY = (flags & 2) !== 0;
}

function setChild(buf: ScratchBuffer, i: number, child: ClusterChild): void {
    child.pos[3] = child.startT;
    child.vel[3] = child.roll;
    let flags = child.mirrorX ? 1 : 0;
    if (child.mirrorY)
        flags |= 2;
    child.scale[3] = flags;
    buf.set4(i * CLUSTER_VEC_COUNT + 0, child.pos);
    buf.set4(i * CLUSTER_VEC_COUNT + 1, child.vel);
    buf.set4(i * CLUSTER_VEC_COUNT + 2, child.scale);
}

const enum ClusterMode {
    DEFAULT, // a cluster of individually-animated flipbook particles
    MOVING, // leaves a trail as the emitter moves
    CAMERA, // leaves a trail at an offset from the camera
    FIXED,
}

const awkwardInverse = mat4.create();
const viewHelper = mat4.create();
class FlipbookCluster extends ScratchInstruction<FlipbookClusterData> {
    public override renders = true;
    private state: number;
    private colorSource: number;
    private pos: number;
    private mode = ClusterMode.DEFAULT;

    private colorCount: number;

    static mode(mode: ClusterMode): TypedInstructionBuilder<FlipbookClusterData> {
        return (data: FlipbookClusterData[], r: Remapper, offsets: Uint32Array, program: Program) => {
            const inst = new FlipbookCluster(data, r, offsets, program);
            inst.mode = mode;
            return inst;
        };
    }

    constructor(data: FlipbookClusterData[], r: Remapper, offsets: Uint32Array,  private program: Program) {
        super();
        this.data = data;
        this.state = r(offsets[0]); //  ??? ; emit timer ; phase
        this.colorSource = r(offsets[1]);
        this.pos = r(offsets[2]);

        // the children can actually live longer than the main particle loop,
        // but the colors they access are zero, so they effectively die
        // there's a slight logic difference between the cluster opcodes
        // as far as how they actually compute this length, but it's not meaningful
        // (one uses lifetime, one loop length)
        this.colorCount = Math.min(program.loopLength, program.lifetime - 1);
        for (let i = 0; i < data.length; i++) {
            // we take a shortcut and just record the initial state of each child
            // make sure we never have to account for changing acceleration
            assert(vec4.exactEquals(data[i].accel, data[0].accel) || data[i].t === program.lifetime);
            // assert(vec4.exactEquals(data[i].scaleAccel, data[0].scaleAccel) || data[i].t === program.lifetime); // home entrance fails this
            // this instruction prevents the particle from dying as long as there are active children
            // this could cause weird behavior if it switched to new data without looping
            // ... but this does indeed happen
            // assert(data[i].t !== program.lifetime - 1);
            if (this.mode === ClusterMode.FIXED) {
                assert(vec4.len(data[i].vel) === 0);
            }
        }
    }

    public override clipEmitter(): boolean {
        // gagazet uses these for snow, and they shouldn't all be active at once
        return this.mode === ClusterMode.CAMERA;
    }

    public override scratchSize(): number {
        return this.colorCount*4 + this.data[0].childCount * CLUSTER_VEC_COUNT * 4;
    }

    public override initScratch(buf: ScratchBuffer, data: FlipbookClusterData): void {
        childScr.startT = -1;
        for (let i = 0; i < data.childCount; i++)
            setChild(buf, i, childScr);
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const scratch = ensureScratch(this, p, data);
        const dt = p.t - p.prevT;
        const stateVec = p.vecs[this.state];
        const currFame = viewerInput.time * FRAME_RATE / 1000;

        const childEnd = currData.childCount * CLUSTER_VEC_COUNT;
        const colorIndex = p.t | 0;
        if (p.prevT < colorIndex && colorIndex < this.colorCount) {
            // crossed an integer boundary
            scratch.set4(childEnd + colorIndex, p.vecs[this.colorSource]);
        }

        // reset/init some children
        if (stateVec[1] <= 0 && p.emitter.state === EmitterState.RUNNING) {
            stateVec[1] = currData.resetInterval;
            for (let i = 0; i < currData.resetCount; i++) {
                childScr.startT = currFame;
                vec4.zero(childScr.pos);
                randomCuboid(childScr.vel, currData.vel, currData.velRange, Distribution.UNIFORM);
                if (this.mode === ClusterMode.MOVING) {
                    childScr.pos[0] = p.emitter.pose[12];
                    childScr.pos[1] = p.emitter.pose[13];
                    childScr.pos[2] = p.emitter.pose[14];
                } else if (this.mode === ClusterMode.CAMERA) {
                    childScr.pos[0] = viewerInput.camera.worldMatrix[12];
                    childScr.pos[1] = -viewerInput.camera.worldMatrix[13];
                    childScr.pos[2] = -viewerInput.camera.worldMatrix[14];
                }
                randomCuboid(childScr.pos, childScr.pos, currData.offsetRange, currData.offsedPeaked ? Distribution.CUSP : Distribution.UNIFORM);
                // note that the random factor is in [-1,1], but the author likely thought it was in [0,1]
                vec4.scaleAndAdd(childScr.scale, currData.scale, currData.scaleRange, 2 * randomFactor(Distribution.UNIFORM) - 1);
                childScr.roll = currData.rollRange * randomFactor(Distribution.UNIFORM) * MathConstants.DEG_TO_RAD;
                childScr.mirrorX = (currData.mirrorFlags & 2) !== 0 && Math.random() > .5;
                childScr.mirrorY = (currData.mirrorFlags & 1) !== 0 && Math.random() > .5;
                setChild(scratch, stateVec[2], childScr);
                stateVec[2]++;
                if (stateVec[2] === currData.childCount)
                    stateVec[2] = 0;
            }
        }
        stateVec[1] -= dt;

        // the game applies the emitter's scale relative to its world position via
        // V.E.N^T.V^T
        // for V the view matrix, E the emitter transform, and N E with normalized columns (generally the identity)
        // but this breaks billboarding unless the scale is isotropic or the emitter is aligned to the camera.
        // Instead, get an approximation of the visual scale of the emitter in view space
        // and post-scale the render matrix
        getMatrixAxisX(instScr3, viewerInput.camera.worldMatrix);
        vec3.mul(instScr3, p.emitter.scale, instScr3);
        const xScale = vec3.len(instScr3);
        getMatrixAxisY(instScr3, viewerInput.camera.worldMatrix);
        vec3.mul(instScr3, p.emitter.scale, instScr3);
        const yScale = vec3.len(instScr3);

        let livingChildren = false;
        const flip = assertExists(data.flipbooks[currData.index]);
        // update and render children
        for (let i = 0; i < currData.childCount; i++) {
            getChild(scratch, i, childScr);
            const t = currFame - childScr.startT;
            if (childScr.startT < 0 || t >= this.colorCount)
                continue;
            livingChildren = true;

            if (this.mode !== ClusterMode.FIXED) {
                vec4.scaleAndAdd(childScr.pos, childScr.pos, childScr.vel, t);
                vec4.scaleAndAdd(childScr.pos, childScr.pos, currData.accel, t * t / 2);
            }
            vec4.scaleAndAdd(childScr.scale, childScr.scale, currData.scaleVel, t);
            vec4.scaleAndAdd(childScr.scale, childScr.scale, currData.scaleAccel, t * t / 2);
            const flipbookFrame = flipbookFrameAtT(flip.flipbook.frames, t, currData.speed);

            // render
            vec4.add(instScr4, childScr.pos, p.vecs[this.pos]);
            computeModelMatrixSRT(renderScratch,
                childScr.scale[0] * (childScr.mirrorX ? -1 : 1), childScr.scale[1] * (childScr.mirrorY ? -1 : 1), childScr.scale[2],
                0, 0, childScr.roll,
                instScr4[0], instScr4[1], instScr4[2],
            );
            if (this.mode === ClusterMode.DEFAULT || this.mode === ClusterMode.FIXED) {
                for (let j = 0; j < 3; j++) {
                    renderScratch[4*j] *= xScale;
                    renderScratch[4*j+1] *= yScale;
                }
                preserveViewAtPoint(renderScratch, p.emitter.toView);
            } else {
                renderScratch[13] *= -1;
                renderScratch[14] *= -1;
                preserveViewAtPoint(renderScratch, viewerInput.camera.viewMatrix);
            }
            scratch.get4(childEnd + (t | 0), colorScratch);
            vec4.mul(colorScratch, p.emitter.color, colorScratch);
            vec4.scale(colorScratch, colorScratch, 1/0x4000);
            data.flipbookRenderer.render(renderInstManager, viewerInput, flip, flipbookFrame, colorScratch, renderScratch);
        }

        const cutoff = this.program.lifetime - 1;
        if (p.t >= cutoff && livingChildren) {
            // wait for children to finish before advancing
            p.t = cutoff;
            p.prevT = p.t - dt;
        }
    }
}

interface PyreflyData {
    t: number;
    flipbook: number;
    speed: number;
    maxScale: number;
    minScale: number;
    sizeRange: number;
    startGap: number;
    trailLength: number;
    renderHead: boolean;
    rotate: boolean;
    steps: vec4[];
}

const trailScratch = nArray(4, () => vec3.create());
const renderScratch = mat4.create();
class Pyrefly extends ScratchInstruction<PyreflyData> {
    public override renders = true;
    private static bufferCount = 0x1C;

    private colors: number;
    private state: number; // flipbook t, trail phase, rng
    constructor(data: PyreflyData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.data = data;
        this.colors = r(offsets[0], nArray(6, ()=>"v"));
        this.state = r(-1);
        // for (let d of data)
        //     assert(d.trailLength <= TRAIL_POINT_COUNT && d.rotate);
    }

    public override scratchSize(): number {
        return Pyrefly.bufferCount * 4;
    }

    public override initScratch(buf: ScratchBuffer, data: PyreflyData): void {
        for (let i = 0; i < Pyrefly.bufferCount; i++) {
            buf.set(i, instScr3);
        }
    }

    public override reset(p: Particle): void {
        this.loop(p);
        p.vecs[this.state][2] = Math.random() * 0x1000;
    }

    public override loop(p: Particle): void {
        for (let i = 0; i < 6; i++)
            vec4.zero(p.vecs[this.colors + i]);
        p.vecs[this.state][0] = 0;
        p.vecs[this.state][1] = 0;
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        vec4.scaleAndAdd(p.vecs[this.colors+0], p.vecs[this.colors + 0], p.vecs[this.colors + 2], dt);
        vec4.scaleAndAdd(p.vecs[this.colors+1], p.vecs[this.colors + 1], p.vecs[this.colors + 4], dt);
        vec4.scaleAndAdd(p.vecs[this.colors+2], p.vecs[this.colors + 2], p.vecs[this.colors + 3], dt);
        vec4.scaleAndAdd(p.vecs[this.colors+4], p.vecs[this.colors + 4], p.vecs[this.colors + 5], dt);

        if (p.crossed(currData.t))
            for (let i = 0; i < 6; i++)
                vec4.add(p.vecs[this.colors + i], p.vecs[this.colors + i], currData.steps[i]);

        getMatrixTranslation(instScr3, p.pose);
        const scratch = ensureScratch(this, p, system.data);
        const newPhase = p.vecs[this.state][1] - dt;
        if (newPhase < (p.vecs[this.state][1] | 0)) {
            const index = newPhase < 0 ? (Pyrefly.bufferCount - 1) : (newPhase | 0) % Pyrefly.bufferCount;
            scratch.set(index, instScr3);
        }
        p.vecs[this.state][1] = (newPhase + Pyrefly.bufferCount) % Pyrefly.bufferCount;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        const scratch = ensureScratch(this, p, data);

        let rng = p.vecs[this.state][2];
        const flipbookT = p.vecs[this.state][0];
        const flipbook = assertExists(data.flipbooks[currData.flipbook]);

        const trailHead = p.vecs[this.state][1] | 0;
        let trailIndex = (trailHead + 1) % Pyrefly.bufferCount;
        const pos = scratch.get(trailHead, trailScratch[0])
        const startPoint = scratch.get(trailHead, trailScratch[1]);
        const endPoint = scratch.get(trailIndex, trailScratch[2]);
        let currSegLength = vec3.dist(startPoint, endPoint);
        let lengthAcc = currSegLength;

        const args = trailArgsScratch;
        args.pointCount = 0;
        args.maxLength = currData.trailLength - 1;
        args.headScale = currData.maxScale;
        args.tailScale = currData.minScale;
        args.scaleRange = currData.sizeRange;
        args.commonFrame = flipbook.flipbook.frames.length === 1;
        assert(args.commonFrame || flipbook.flipbook.trailCompatible);
        vec4.mul(args.headColor, p.emitter.color, p.vecs[this.colors + 0]);
        vec4.scale(args.headColor, args.headColor, 1/0x4000);
        vec4.mul(args.tailColor, p.emitter.color, p.vecs[this.colors + 1]);
        vec4.scale(args.tailColor, args.tailColor, 1/0x4000);

        for (let i = 0; i < currData.trailLength; i++) {
            // simple lcg, meant to be consistent for a given index in the trail
            rng = (rng * 0x80D + 7) & 0xFFFF;
            const trailFrac = i/(currData.trailLength - 1);
            const taperScale = lerp(currData.maxScale, currData.minScale, trailFrac);

            if (i === 0) {
                if (!currData.renderHead)
                    continue;
            } else {
                const gap = currData.startGap * taperScale/currData.maxScale;
                while (lengthAcc < gap) {
                    vec3.copy(startPoint, endPoint);
                    trailIndex = (trailIndex + 1) % Pyrefly.bufferCount;
                    if (trailIndex === trailHead)
                        break;
                    scratch.get(trailIndex, endPoint);
                    currSegLength = vec3.dist(startPoint, endPoint);
                    lengthAcc += currSegLength;
                }
                if (lengthAcc < gap)
                    break; // not enough length remaining

                lengthAcc -= gap;
                vec3.lerp(pos, startPoint, endPoint, 1 - lengthAcc/currSegLength);
            }
            const v = trailScratch[3];
            transformVec3Mat4w1(v, p.emitter.toView, pos);
            vec3.copy(args.points[args.pointCount], v);
            const rngFrac = rng/0x10000;
            vec3.set(args.params[args.pointCount++], rng, rngFrac, 1 - args.tailScale*rngFrac);
        }

        // one combined draw
        const axis = trailScratch[3];
        mat4.identity(renderScratch);
        getMatrixAxisX(axis, p.pose);
        vec3.scale(axis, axis, p.emitter.scale[0]);
        setMatrixAxis(renderScratch, axis, null, null);
        getMatrixAxisY(axis, p.pose);
        vec3.scale(axis, axis, p.emitter.scale[1]);
        setMatrixAxis(renderScratch, null, axis, null);
        const baseFrame = (flipbookT/flipbook.flipbook.frames[0].duration) % flipbook.flipbook.frames.length;
        if (args.pointCount > 0)
            data.flipbookRenderer.renderTrail(device, renderInstManager, flipbook, baseFrame, renderScratch, args);

        p.vecs[this.state][0] = flipbookT + currData.speed * dt;
    }
}

interface FlipbookTrailData {
    t: number;
    flipbook: number;
    speed: number;
    maxScale: number;
    minScale: number;
    startGap: number;
    trailLength: number;
    headColor: vec4;
    tailColor: vec4;
    renderHead: boolean;
    fog: boolean;
    fade: boolean;
    depthOffset: boolean;
}

export interface TrailArgs {
    points: vec3[];
    params: vec3[]; // t, angle, scale
    pointCount: number;
    maxLength: number;
    headColor: vec4;
    tailColor: vec4;
    headScale: number;
    tailScale: number;
    scaleRange: number;
    commonFrame: boolean;
}

const TRAIL_POINT_COUNT = 256;

export const trailArgsScratch: TrailArgs = {
    points: nArray(TRAIL_POINT_COUNT, () => vec3.create()),
    params: nArray(TRAIL_POINT_COUNT, () => vec3.create()),
    pointCount: 0,
    maxLength: 0,
    headColor: vec4.create(),
    tailColor: vec4.create(),
    headScale: 0,
    tailScale: 0,
    scaleRange: 0,
    commonFrame: false,
}

class FlipbookTrail extends ScratchInstruction<FlipbookTrailData> {
    public override renders = true;
    private static bufferCount = 0x1F;
    private varTail = false;

    private state: number; // flipbook t, flipbook dur, trail phase, rng
    private alpha: number;
    constructor(data: FlipbookTrailData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.data = data;
        this.state = r(offsets[0]);
        this.alpha = r(offsets[1]);
        for (let d of data)
            assert(d.trailLength <= TRAIL_POINT_COUNT);
    }

    public static VarTail(data: FlipbookTrailData[], r: Remapper, offsets: Uint32Array): Instruction {
        const i = new FlipbookTrail(data, r, offsets);
        i.varTail = true;
        return i;
    }

    public override scratchSize(): number {
        return FlipbookTrail.bufferCount * 4;
    }

    public override initScratch(buf: ScratchBuffer, data: FlipbookTrailData): void {
        for (let i = 0; i < FlipbookTrail.bufferCount; i++) {
            buf.set(i, instScr3);
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override loop(p: Particle): void { }

    public override update(p: Particle, system: ParticleSystem): void {
        const dt = p.t - p.prevT;

        getMatrixTranslation(instScr3, p.pose);
        const scratch = ensureScratch(this, p, system.data);
        const newPhase = p.vecs[this.state][2] - dt;
        if (newPhase < (p.vecs[this.state][2] | 0)) {
            const index = newPhase < 0 ? (FlipbookTrail.bufferCount - 1) : (newPhase | 0) % FlipbookTrail.bufferCount;
            scratch.set(index, instScr3);
        }
        p.vecs[this.state][2] = (newPhase + FlipbookTrail.bufferCount) % FlipbookTrail.bufferCount;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (currData.flipbook === 0xFFFF)
            return;

        const scratch = ensureScratch(this, p, data);
        const flipbook = assertExists(data.flipbooks[currData.flipbook]);
        const frame = p.vecs[this.state][0];

        const trailHead = p.vecs[this.state][2] | 0;
        let trailIndex = (trailHead + 1) % FlipbookTrail.bufferCount;
        const pos = scratch.get(trailHead, trailScratch[0]);
        const startPoint = scratch.get(trailHead, trailScratch[1]);
        const endPoint = scratch.get(trailIndex, trailScratch[2]);
        let currSegLength = vec3.dist(startPoint, endPoint);
        let lengthAcc = currSegLength;

        const args = trailArgsScratch;
        args.pointCount = 0;
        args.maxLength = currData.trailLength - 1;
        args.headScale = currData.maxScale;
        args.tailScale = currData.minScale;
        args.scaleRange = 0;
        args.commonFrame = true;
        if (this.varTail) {
            getColor(args.headColor, p, this.alpha);
            vec4.mul(args.tailColor, p.emitter.color, currData.tailColor);
            vec4.scale(args.tailColor, args.tailColor, 1/0x4000);
        } else {
            vec4.mul(args.headColor, p.emitter.color, currData.headColor);
            args.headColor[3] *= p.vecs[this.alpha][3] / 0x4000;
            vec4.mul(args.tailColor, p.emitter.color, currData.tailColor);
            args.tailColor[3] *= p.vecs[this.alpha][3] / 0x4000;
        }

        for (let i = 0; i < currData.trailLength; i++) {
            const trailFrac = i/(currData.trailLength - 1);
            const taperScale = lerp(currData.maxScale, currData.minScale, trailFrac);

            if (i === 0) {
                // technically we should be passing this info to the renderer to tweak scale
                if (!currData.renderHead)
                    continue;
            } else {
                const gap = currData.startGap * taperScale/currData.maxScale;
                while (lengthAcc < gap) {
                    vec3.copy(startPoint, endPoint);
                    trailIndex = (trailIndex + 1) % FlipbookTrail.bufferCount;
                    if (trailIndex === trailHead)
                        break;
                    scratch.get(trailIndex, endPoint);
                    currSegLength = vec3.dist(startPoint, endPoint);
                    lengthAcc += currSegLength;
                }
                if (lengthAcc < gap)
                    break; // not enough length remaining

                lengthAcc -= gap;
                vec3.lerp(pos, startPoint, endPoint, 1 - lengthAcc/currSegLength);
            }
            const v = trailScratch[3];
            transformVec3Mat4w1(v, p.emitter.toView, pos);
            vec3.copy(args.points[args.pointCount], v);
            vec3.set(args.params[args.pointCount++], 0, 0, 1);
        }
        // set base transform matrix
        const axis = trailScratch[3];
        mat4.identity(renderScratch);
        getMatrixAxisX(axis, p.pose);
        vec3.scale(axis, axis, p.emitter.scale[0]);
        setMatrixAxis(renderScratch, axis, null, null);
        getMatrixAxisY(axis, p.pose);
        vec3.scale(axis, axis, p.emitter.scale[1]);
        setMatrixAxis(renderScratch, null, axis, null);
        if (args.pointCount > 0)
            data.flipbookRenderer.renderTrail(device, renderInstManager, flipbook, frame, renderScratch, args);
        updateFlipbook(p.vecs[this.state], flipbook.flipbook.frames, dt, currData.speed);
    }
}

interface UVScrollGeoData {
    t: number;
    geoIndex: number;
    uInc: vec4;
    vInc: vec4;
    flags: number;
    fog: boolean;
    fade: boolean;
    flag2000: boolean;
    depthOffset: boolean;
}

const floatLimit = Math.pow(2, 128);
const floatMax = vec4.fromValues(floatLimit, floatLimit, floatLimit, floatLimit);
const floatMin = vec4.fromValues(-floatLimit, -floatLimit, -floatLimit, -floatLimit);

function clampVec4(v: vec4): void {
    vec4.min(v, v, floatMax);
    vec4.max(v, v, floatMin);
}

function getColor(dst: vec4, p: Particle, colorIndex: number): void {
    vec4.mul(dst, p.vecs[colorIndex], p.emitter.color);
    // PS2 shifts color comps by 7 to byte range, and texture "modulate" mode treats 0x80 as 1,
    // so full color is 0x80 << 7, or 4000
    vec4.scale(dst, dst, 1 / 0x4000);
}

class UVScrollGeo extends Instruction {
    public override renders = true;
    private u: number;
    private v: number;
    private colorMod: number;
    private depth: number;
    constructor(public data: UVScrollGeoData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.colorMod = r(offsets[0]);
        this.u = r(offsets[2], nArray(2, ()=>"v"));
        this.v = this.u + 1;
        this.depth = r(offsets[3]);
    }

    public override loop(p: Particle): void {
        vec4.zero(p.vecs[this.u]);
        vec4.zero(p.vecs[this.v]);
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        p.vecs[this.u][1] += dt * p.vecs[this.u][2];
        p.vecs[this.u][0] += dt * p.vecs[this.u][1];

        p.vecs[this.v][1] += dt * p.vecs[this.v][2];
        p.vecs[this.v][0] += dt * p.vecs[this.v][1];

        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.u], p.vecs[this.u], currData.uInc);
            vec4.add(p.vecs[this.v], p.vecs[this.v], currData.vInc);
        }

        if (currData.geoIndex === 0xffff)
            return;

        getColor(colorScratch, p, this.colorMod);
        const depthOffset = currData.depthOffset ? p.vecs[this.depth][0] : 0;
        const mode = currData.fog ? GeoParticleMode.FOG : GeoParticleMode.DEFAULT;
        assertExists(data.geos[currData.geoIndex]).prepareToRender(renderInstManager, p.render, -1, p.vecs[this.u][0], p.vecs[this.v][0], colorScratch, depthOffset, mode);
    }
}

interface WrapUVScrollGeoData {
    t: number;
    geoIndex: number;
    uInc: vec4;
    vInc: vec4;
    flags: number;
    blendMode: number;
    blendAlpha: number;
    fog: boolean;
    fade: boolean;
    flag2000: boolean;
    depthOffset: boolean;
    useWater: boolean;
    waterTexSlot: number;
    waterTexDur: number;
}

const enum GeoPos {
    DEFAULT,
    ORIGIN,
    CAMERA,
}

class WrapUVScrollGeo extends Instruction {
    public override renders = true;
    private u: number;
    private v: number;
    private texFrame: number;
    private colorMod: number;
    private depth: number;
    private pos = GeoPos.DEFAULT;
    constructor(public data: WrapUVScrollGeoData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.colorMod = r(offsets[0]);
        this.u = r(offsets[2], ["v", "v", "v"]);
        this.v = this.u + 1;
        this.texFrame = this.u + 2;
        this.depth = r(offsets[3]);
    }

    public static atOrigin(data: WrapUVScrollGeoData[], r: Remapper, offsets: Uint32Array): WrapUVScrollGeo {
        const inst = new WrapUVScrollGeo(data, r, offsets);
        inst.pos = GeoPos.ORIGIN;
        return inst;
    }

    public static atCamera(data: WrapUVScrollGeoData[], r: Remapper, offsets: Uint32Array): WrapUVScrollGeo {
        const inst = new WrapUVScrollGeo(data, r, offsets);
        inst.pos = GeoPos.CAMERA;
        return inst;
    }

    public override reset(p: Particle): void {
        p.vecs[this.u][3] = 0;
    }

    public override loop(p: Particle): void {
        p.vecs[this.u][1] = 0;
        p.vecs[this.u][2] = 0;
        p.vecs[this.v][1] = 0;
        p.vecs[this.v][2] = 0;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (p.vecs[this.u][3] === 0) {
            p.vecs[this.u][3] = 1;
            p.vecs[this.u][0] = currData.uInc[0];
            p.vecs[this.v][0] = currData.vInc[0];
        }
        if (p.crossed(currData.t)) {
            const oldU = p.vecs[this.u][0];
            const oldV = p.vecs[this.v][0];
            vec4.add(p.vecs[this.u], p.vecs[this.u], currData.uInc);
            vec4.add(p.vecs[this.v], p.vecs[this.v], currData.vInc);
            p.vecs[this.u][0] = oldU;
            p.vecs[this.v][0] = oldV;
        }

        p.vecs[this.u][1] += dt * p.vecs[this.u][2];
        p.vecs[this.u][0] = (p.vecs[this.u][0] + dt * p.vecs[this.u][1]) % 0x8000;

        p.vecs[this.v][1] += dt * p.vecs[this.v][2];
        p.vecs[this.v][0] = (p.vecs[this.v][0] + dt * p.vecs[this.v][1]) % 0x8000;

        if (this.pos === GeoPos.ORIGIN) {
            mat4.copy(p.render, p.pose);
            p.render[12] -= p.emitter.pos[0];
            p.render[13] -= p.emitter.pos[1];
            p.render[14] -= p.emitter.pos[2];
            mat4.mul(p.render, p.emitter.toView, p.render);
        } else if (this.pos === GeoPos.CAMERA) {
            mat4.copy(p.render, p.emitter.pose);
            p.render[12] = viewerInput.camera.worldMatrix[12];
            p.render[13] = -viewerInput.camera.worldMatrix[13];
            p.render[14] = -viewerInput.camera.worldMatrix[14];
            // the spheres are smaller than our near clip
            vec3.set(posScratch, 10, 10, 10);
            mat4.scale(p.render, p.render, posScratch);
            mat4.mul(p.render, p.render, p.pose);
            mat4.mul(p.render, FFXToNoclip, p.render);
            mat4.mul(p.render, viewerInput.camera.viewMatrix, p.render);
        }

        getColor(colorScratch, p, this.colorMod);
        const depthOffset = currData.depthOffset ? p.vecs[this.depth][0] : 0;
        const mode = currData.fog ? GeoParticleMode.FOG : GeoParticleMode.DEFAULT;
        const geo = assertExists(data.geos[currData.geoIndex])
        if (currData.useWater) {
            p.vecs[this.texFrame][0] += dt / currData.waterTexDur;
            const water = data.getWaterTexture(currData.waterTexSlot, p.vecs[this.texFrame][0] | 0);
            if (water) {
                for (let i = 0; i < geo.drawCalls.length; i++) {
                    geo.drawCalls[i].textureMappings[0].gfxTexture = water;
                }
            }
        }
        geo.prepareToRender(renderInstManager, p.render, -1, p.vecs[this.u][0], p.vecs[this.v][0], colorScratch, depthOffset, mode, currData.flags);
    }
}

interface WibbleUVScrollGeoData {
    t: number;
    geoIndex: number;
    uInc: vec4;
    vInc: vec4;
    wibbleOffset: vec4;
    wibbleVelocity: vec4;
    wibbleStrength: vec4;
    waterTexSlot: number;
    waterTexDur: number;
    blendMode: number;
    blendAlpha: number;
    backCull: boolean;
    flag2000: boolean;
    fog: boolean;
    zTest: boolean;
}

class WibbleUVScrollGeo extends Instruction {
    public override renders = true;
    private u: number;
    private v: number;
    private wibble: number;
    private texFrame: number;
    private colorMod: number;
    constructor(public data: WibbleUVScrollGeoData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.colorMod = r(offsets[0]);
        this.u = r(offsets[2], ["curve","curve","v","v"]);
        this.v = this.u + 1;
        this.wibble = this.u + 2;
        this.texFrame = this.u + 3;
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.u]);
        vec4.zero(p.vecs[this.v]);
        vec4.zero(p.vecs[this.wibble]);
    }

    public override loop(p: Particle): void {
        p.vecs[this.u][1] = 0;
        p.vecs[this.u][2] = 0;
        p.vecs[this.v][1] = 0;
        p.vecs[this.v][2] = 0;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.u], p.vecs[this.u], currData.uInc);
            vec4.add(p.vecs[this.v], p.vecs[this.v], currData.vInc);
        }
        p.vecs[this.u][1] += dt * p.vecs[this.u][2];
        p.vecs[this.u][0] = (p.vecs[this.u][0] + dt * p.vecs[this.u][1]) % 0x8000;
        p.vecs[this.v][1] += dt * p.vecs[this.v][2];
        p.vecs[this.v][0] = (p.vecs[this.v][0] + dt * p.vecs[this.v][1]) % 0x8000;

        // wibbling almost always zero'd out?
        // bevelle - two fates almost has it
        vec4.scaleAndAdd(p.vecs[this.wibble], p.vecs[this.wibble], currData.wibbleVelocity, dt);
        p.vecs[this.texFrame][0] += dt / currData.waterTexDur;

        getColor(colorScratch, p, this.colorMod);
        const mode = currData.fog ? GeoParticleMode.FOG : GeoParticleMode.DEFAULT;
        const geo = assertExists(data.geos[currData.geoIndex]);
        const water = data.getWaterTexture(currData.waterTexSlot, p.vecs[this.texFrame][0] | 0);
        if (water) {
            for (let i = 0; i < geo.drawCalls.length; i++) {
                geo.drawCalls[i].textureMappings[0].gfxTexture = water;
            }
        }
        geo.prepareToRender(renderInstManager, p.render, -1, p.vecs[this.u][0], p.vecs[this.v][0], colorScratch, 0, mode);
    }
}

interface SimpleGeoData {
    t: number;
    geoIndex: number;
    blend: number;
    flags: number;
    fog: boolean;
    fade: boolean;
    flag2000: boolean;
    depthOffset: boolean;
}
class SimpleGeo extends Instruction {
    public override renders = true;
    private colorMod: number;
    private depth: number;
    constructor(public data: SimpleGeoData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.colorMod = r(offsets[0]);
        this.depth = r(offsets[2]);
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        if (currData.geoIndex === 0xFFFF)
            return;
        getColor(colorScratch, p, this.colorMod);
        // TODO: override blend mode to 0x44 for op 0x50?
        const depthOffset = currData.depthOffset ? p.vecs[this.depth][0] : 0;
        const mode = currData.fog ? GeoParticleMode.FOG : GeoParticleMode.DEFAULT;
        let flags = currData.flags;
        // not really sure what this does, but at the very least is has the same effect of drawing early before depth sorting
        if (currData.flag2000)
            flags |= 2;
        assertExists(data.geos[currData.geoIndex]).prepareToRender(renderInstManager, p.render, currData.blend, 0, 0, colorScratch, depthOffset, mode, flags);
    }
}

class FakeGeo extends Instruction {
    public override renders = true;
    public index = -1;

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        vec4.set(colorScratch, 1, 1, 1, 1);
        assertExists(data.geos[this.index]).prepareToRender(renderInstManager, p.render, -1, 0, 0, colorScratch);
    }
}

function emitAtPositions<T extends BaseEmitData>(parent: Particle, system: ParticleSystem, lastPos: number, data: T, source: SubEmitter<T>): number {
    if (data.count <= 0 || data.program < 0)
        return lastPos;
    const emitter = parent.emitter;
    const pattern = assertExists(system.data.data.patterns[data.pattern]);
    const prog = emitter.behavior.programs[data.program];
    const geo = assertExists(system.data.data.geometry[pattern.geoIndex]);
    const indexCount = pattern.indices.length;
    let currIndex = lastPos;
    // console.log("emitting", data.count, "of", data.program, "from", emitter.data.id, emitter.data.behavior)
    for (let i = 0; i < data.count; i++) {
        const p = emitter.emit(system, data.program);
        p.parent = parent;
        if (data.random) {
            currIndex = (Math.random() * indexCount) | 0;
        }
        // a couple of cases of reading past the end of the array into unrelated data
        const pointIndex = Math.min(pattern.indices[currIndex], geo.points.length - 1);
        source.onEmit(parent, data, p, geo.points[pointIndex], prog);
        if (!data.random) {
            currIndex = (currIndex + 1) % indexCount;
        }
    }
    return currIndex;
}

interface SubEmitter<T> {
    onEmit(parent: Particle, data:T, particle: Particle, pos: ReadonlyVec3, program: Program): void;
}

interface BaseEmitData {
    pattern: number;
    program: number;
    count: number;
    random: boolean;
}

interface EmitData {
    t: number;
    pattern: number;
    count: number;
    scale: number;
    period: number;
    program: number;
    random: boolean;
    transform: boolean;
    childPos: number;
    childDir: number;
    childAngle: number;
}

class PeriodicEmit extends Instruction {
    public override renders = true;
    protected state: number;
    private atOrigin = false;
    constructor(public data: EmitData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]); // last emit position index; emit timer; done
    }

    public static atOrigin(data: EmitData[], r: Remapper, offsets: Uint32Array): PeriodicEmit {
        const inst = new PeriodicEmit(data, r, offsets);
        inst.atOrigin = true;
        return inst;
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override loop(p: Particle): void {}

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        // game actually resets the timer even if nothing is emitted, but that causes some issues due to our variable timestep
        if (p.vecs[this.state][1] <= 0 && p.vecs[this.state][2] === 0 && currData.count > 0) {
            p.vecs[this.state][0] = emitAtPositions(p, system, p.vecs[this.state][0], currData, this);
            p.vecs[this.state][1] = currData.period;
            if (currData.period === 0)
                p.vecs[this.state][2] = 1;
        }
        p.vecs[this.state][1] -= dt;
    }

    public onEmit(parent: Particle, data: EmitData, p: Particle, pos: ReadonlyVec3, program: Program): void {
        const posDest = assertExists(program.vecMap.get(data.childPos));
        vec3.copy(instScr3, pos);
        if (data.transform) {
            transformVec3Mat4w1(instScr3, parent.pose, instScr3);
        }
        if (this.atOrigin) {
            instScr3[0] -= parent.emitter.pose[12];
            instScr3[1] -= parent.emitter.pose[13];
            instScr3[2] -= parent.emitter.pose[14];
        }
        p.vecs[posDest][0] = instScr3[0];
        p.vecs[posDest][1] = instScr3[1];
        p.vecs[posDest][2] = instScr3[2];
        if (data.childAngle >= 0) {
            const angleDest = assertExists(program.vecMap.get(data.childAngle));
            p.vecs[angleDest][0] = Math.atan2(pos[0], -pos[1]) / toRad;
            p.vecs[angleDest][1] = 0;
            p.vecs[angleDest][2] = Math.atan2(-pos[2], Math.hypot(pos[0], pos[1])) / toRad;
        }
    }
}

class ResettingPeriodicEmit extends PeriodicEmit {
    public override loop(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }
}

class PeriodicSimpleEmit extends Instruction {
    public override renders = true;
    private state: number;
    constructor(public data: EmitData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]); // last emit position index; emit timer; done
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (currData.count <= 0 || currData.program < 0)
            return;

        if (p.vecs[this.state][1] <= 0 && p.vecs[this.state][2] === 0) {
            const map = p.emitter.behavior.programs[currData.program].vecMap;
            const toSet = assertExists(map.get(currData.childPos));
            const pattern = assertExists(system.data.data.patterns[currData.pattern]);
            const indexCount = pattern.indices.length;
            let currIndex = p.vecs[this.state][0];
            // console.log("emitting", data.count, "of", data.program, "from", emitter.data.id, emitter.data.behavior)
            for (let i = 0; i < currData.count; i++) {
                if (currData.random) {
                    currIndex = (Math.random() * indexCount) | 0;
                }
                const child = p.emitter.emit(system, currData.program);
                child.parent = p;
                child.vecs[toSet][0] = currIndex;
                currIndex = (currIndex + 1) % indexCount;
            }
            p.vecs[this.state][0] = currIndex;
            p.vecs[this.state][1] = currData.period;
            if (currData.period === 0)
                p.vecs[this.state][2] = 1;
        }
        p.vecs[this.state][1] -= dt;
    }
}

interface ChildSetupData {
    t: number;
    pattern: number;
}

class ChildSetup extends Instruction {
    private index: number;
    private pos: number;
    constructor(public data: ChildSetupData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.index = r(offsets[0]); // last emit position index; emit timer; done
        this.pos = r(offsets[1]); // last emit position index; emit timer; done
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (currData.pattern < 0)
            return;

        const pattern = assertExists(system.data.data.patterns[currData.pattern]);
        const geo = assertExists(system.data.data.geometry[pattern.geoIndex]);
        const rawIndex = p.vecs[this.index][0];
        // guard against reading too far
        const pointIndex = Math.min(pattern.indices[rawIndex], geo.points.length - 1);
        transformVec3Mat4w1(posScratch, assertExists(p.parent).pose, geo.points[pointIndex]);
        vec4.set(p.vecs[this.pos], posScratch[0], posScratch[1], posScratch[2], 1);
    }
}

interface RandomEmitData {
    t: number;
    pattern: number;
    count: number;
    scale: number;
    mask: number;
    program: number;
    random: boolean;
    childPos: number;
    childDir: number;
}

class RandomEmit extends Instruction {
    public override renders = true;
    private state: number;
    constructor(public data: RandomEmitData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]); // last emit position index; emit timer
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        // the game ANDs a random byte with the mask every frame and emits on zero
        // match that rate
        let shouldEmit = false;
        if (currData.mask !== 0) {
            let bitCount = 0;

            for (let i = 0; i < 8; i++) {
                if (currData.mask & (1 << i))
                    bitCount++;
            }
            const rate = dt / (1 << bitCount);
            shouldEmit = Math.random() < rate;
        } else {
            // mask being 0 really means "every frame"
            shouldEmit = p.prevT < (p.t | 0);
        }
        if (shouldEmit) {
            p.vecs[this.state][0] = emitAtPositions(p, system, p.vecs[this.state][0], currData, this);
        }
    }

    public onEmit(parent: Particle, data: RandomEmitData, p: Particle, pos: ReadonlyVec3, program: Program): void {
        const posDest = assertExists(program.vecMap.get(data.childPos));
        const deltaDest = assertExists(program.vecMap.get(data.childDir));

        transformVec3Mat4w1(instScr3, parent.pose, pos);
        p.vecs[posDest][0] = instScr3[0];
        p.vecs[posDest][1] = instScr3[1];
        p.vecs[posDest][2] = instScr3[2];
        transformVec3Mat4w0(instScr3, parent.pose, pos);
        normToLength(instScr3, data.scale);
        p.vecs[deltaDest][0] = instScr3[0];
        p.vecs[deltaDest][1] = instScr3[1];
        p.vecs[deltaDest][2] = instScr3[2];
    }
}

interface SimpleEmitData {
    t: number;
    program: number;
    period: number;
    childPos: number;
}

class SimpleEmit extends Instruction {
    public override renders = true;
    private state: number;
    private pos: number;
    constructor(public data: SimpleEmitData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.pos = r(offsets[0]);
        this.state = r(offsets[1]); // done; emit timer
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        if (p.vecs[this.state][1] <= 0 && p.vecs[this.state][0] === 0) {
            if (currData.program < 0)
                return;
            const child = p.emitter.emit(system, currData.program);
            child.parent = p;
            const posDest = assertExists(p.emitter.behavior.programs[currData.program].vecMap.get(currData.childPos));
            vec4.copy(child.vecs[posDest], p.vecs[this.pos]);
            p.vecs[this.state][1] = currData.period;
            if (currData.period === 0)
                p.vecs[this.state][0] = 1;
        }
        p.vecs[this.state][1] -= dt;
    }
}

interface DualEmitData {
    t: number;
    program: number;
    mask: number;
    count: number;
    random: boolean;
    pattern: number;
    deltaPattern: number;
    childPos: number;
    childDelta: number;
}

class DualEmit extends Instruction {
    public override renders = true;
    private state: number;
    constructor(public data: DualEmitData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]); // unused ; emit timer
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        // the game allows for these to differ, hopefully never happens
        assert(currData.pattern === currData.deltaPattern);
        const dt = p.t - p.prevT;
        // the game ANDs a random byte with the mask every frame and emits on zero
        // match that rate
        let bitCount = 0;
        for (let i = 0; i < 8; i++) {
            if (currData.mask & (1 << i))
                bitCount++;
        }
        const rate = dt / (1 << bitCount);
        if (Math.random() < rate) {
            p.vecs[this.state][0] = emitAtPositions(p, system, p.vecs[this.state][0], currData, this);
        }
    }

    public onEmit(parent: Particle, data: DualEmitData, p: Particle, pos: ReadonlyVec3, program: Program): void {
        const posDest = assertExists(program.vecMap.get(data.childPos));
        const deltaDest = assertExists(program.vecMap.get(data.childDelta));
        vec3.copy(instScr3, pos);
        // we pre-scaled the pose translation, so scale this down to match, then undo it
        transformVec3Mat4w1(instScr3, parent.pose, instScr3);
        p.vecs[posDest][0] = instScr3[0];
        p.vecs[posDest][1] = instScr3[1];
        p.vecs[posDest][2] = instScr3[2];
        getMatrixTranslation(instScr3, parent.pose);
        p.vecs[deltaDest][0] = p.vecs[posDest][0] - instScr3[0];
        p.vecs[deltaDest][1] = p.vecs[posDest][1] - instScr3[1];
        p.vecs[deltaDest][2] = p.vecs[posDest][2] - instScr3[2];
    }
}

interface ChainState {
    next: number;
    child: number;
    descCount: number;
    targetProgram: number;
    currLength: number;
    flags: ChainFlags;
    startIndex: number;
    endIndex: number;
    pointsTraveled: number;
}

const chainStateScratch: ChainState = {
    next: 255,
    child: 255,
    descCount: 0,
    targetProgram: 255,
    currLength: 0,
    flags: 0,
    startIndex: 0,
    endIndex: 0,
    pointsTraveled: 0,
}

interface ChainVertex {
    pos: vec3;
    dir: vec3;
    child: number;
    shrink: number;
}

const chainVtxScratch: ChainVertex = {
    pos: vec3.create(),
    dir: vec3.create(),
    child: 255,
    shrink: 0,
}

interface ChainParams {
    t: number;
    chainCount: number;
    elementCount: number;
}

export class PointChain extends Instruction {
    public static baseSize = 5; // length; flags; traveled; next, child, descCount target; start, end, ;
    public static pointSize = 8; // pos.xyz, child; dir.xyz, shrink

    public stride: number;

    constructor(public chainCount: number, public vertexCount: number, r: Remapper, offsets: Uint32Array) {
        super();
        this.stride = PointChain.baseSize + this.vertexCount * PointChain.pointSize;
    }

    public static with(chains: number, elements: number): SimpleBuilder {
        return (r: Remapper, offsets: Uint32Array) => new PointChain(chains, elements, r, offsets);
    }

    public scratchSize(): number {
        return this.chainCount * (PointChain.baseSize + this.vertexCount * PointChain.pointSize);
    }

    public getState(buffer: ScratchBuffer, index: number, dst: ChainState): ChainState {
        const offs = index * this.stride;
        dst.currLength = buffer.data[offs + 0];
        dst.flags = buffer.data[offs + 1];
        dst.pointsTraveled = buffer.data[offs + 2];

        dst.next = buffer.u8View[4*offs + 12];
        dst.child = buffer.u8View[4*offs + 13];
        dst.descCount = buffer.u8View[4*offs + 14];
        dst.targetProgram = buffer.u8View[4*offs + 15];

        dst.startIndex = buffer.u8View[4*offs + 16];
        dst.endIndex = buffer.u8View[4*offs + 17];
        return dst;
    }

    public setState(buffer: ScratchBuffer, index: number, state: ChainState): void {
        const offs = index * this.stride;
        buffer.data[offs + 0] = state.currLength;
        buffer.data[offs + 1] = state.flags;
        buffer.data[offs + 2] = state.pointsTraveled;

        buffer.u8View[4*(offs + 3) + 0] = state.next;
        buffer.u8View[4*(offs + 3) + 1] = state.child;
        buffer.u8View[4*(offs + 3) + 2] = state.descCount;
        buffer.u8View[4*(offs + 3) + 3] = state.targetProgram;
        buffer.u8View[4*(offs + 3) + 4] = state.startIndex;
        buffer.u8View[4*(offs + 3) + 5] = state.endIndex;
    }

    public unusedIndex(buffer: ScratchBuffer): number {
        for (let i = 0; i < this.chainCount; i++) {
            // check flags
            if (buffer.data[i*this.stride + 1] === 0) {
                return i;
            }
        }
        return 255;
    }

    public getVertex(buffer: ScratchBuffer, chain: number, index: number, state: ChainVertex): ChainVertex {
        const offs = chain * this.stride + PointChain.baseSize + index * PointChain.pointSize;
        state.pos[0] = buffer.data[offs + 0];
        state.pos[1] = buffer.data[offs + 1];
        state.pos[2] = buffer.data[offs + 2];
        state.child = buffer.data[offs + 3];
        state.dir[0] = buffer.data[offs + 4];
        state.dir[1] = buffer.data[offs + 5];
        state.dir[2] = buffer.data[offs + 6];
        state.shrink = buffer.data[offs + 7];
        return state;
    }

    public setVertex(buffer: ScratchBuffer, chain: number, index: number, state: ChainVertex): void {
        const offs = chain * this.stride + PointChain.baseSize + index * PointChain.pointSize;
        buffer.data[offs + 0] = state.pos[0];
        buffer.data[offs + 1] = state.pos[1];
        buffer.data[offs + 2] = state.pos[2];
        buffer.data[offs + 3] = state.child;
        buffer.data[offs + 4] = state.dir[0];
        buffer.data[offs + 5] = state.dir[1];
        buffer.data[offs + 6] = state.dir[2];
        buffer.data[offs + 7] = state.shrink;
    }
}

const enum ChainFlags {
    INACTIVE     = 0,
    ACTIVE       = 0x0001, // not actually in game
    FIXED_LENGTH = 0x0002,
    HIT_MAX      = 0x0004,
    ORPHANED     = 0x0008,
    REMOVE       = 0x0010,
    DONE_GROWING = 0x0020,
    DONE_AT_MAX  = 0x0080,
    FIXED_TARGET = 0x0100,
    INHERIT_POS  = 0x0200,
    NORM_DIR     = 0x0400,
    REVERSE      = 0x1000,
    ATTRACTED    = 0x2000,
}

interface ElectricColorData {
    t: number;
    colorAccs: vec4[];
    widthVel: number;
    perturbVel: number;
    tipAccel: number;
    targetVel: number;
    maxDescs: number;
}

class ElectricColor extends Instruction {
    public vels: number;


    public state: number; // flags ; first chain index;
    public params: number; // width; noise strength; target strength; tip speed
    public colors: number;
    public paramVels: number; // width, perturb, tip accel, target,
    public colorVels: number;

    constructor(public data: ElectricColorData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.paramVels = r(offsets[0], nArray(5, ()=>"v"));
        this.colorVels = this.paramVels + 1;

        this.state = r(offsets[1], ["elecState", "elecParams", "v", "v", "v", "v"]);
        this.params = this.state + 1;
        this.colors = this.state + 2;

        console.log(data);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t)) {
            for (let i = 0; i < 4; i++)
                vec4.add(p.vecs[this.colorVels + i], p.vecs[this.colorVels + i], currData.colorAccs[i]);
            p.vecs[this.paramVels][0] += currData.widthVel;
            p.vecs[this.paramVels][0] += currData.perturbVel;
            p.vecs[this.paramVels][0] += currData.tipAccel;
            p.vecs[this.paramVels][0] += currData.targetVel;
        }
        // update on integer crossings to ensure accuracy with game
        if (p.prevT < (p.t | 0)) {
            for (let i = 0; i < 4; i++)
                vec4.add(p.vecs[this.colors + i], p.vecs[this.colors + i], p.vecs[this.colorVels + i]);
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.paramVels]);
        for (let i = 0; i < 4; i++)
            vec4.zero(p.vecs[this.colorVels + i]);
    }
}

interface ElectricData {
    t: number;
    targetProgram: number;
    targetOffset: number;
    core: vec4;
    edge: vec4;
    coreStep: vec4;
    edgeStep: vec4;
    totalDisplacement: number;
    widthDelta: number;
    endWidthFrac: number;
    coreWidthFrac: number;
    shrinkFrac: number;
    shrinkStep: number;
    perturbDelta: number;
    tipAccel: number;
    targetStrengthDelta: number;
    angleRange: number;
    maxDescendants: number;
    randomMask: number;
    blendMode: number;
    detach: boolean;
    normalizeDir: boolean;
    reversed: boolean;
    inheritPos: boolean;
}

function toVec3(dst: vec3, src: vec4): void {
    vec3.set(dst, src[0], src[1], src[2]);
}

const vec4Zero: ReadonlyVec4 = vec4.create();

function updateTarget(p: Particle, target: number, data: ElectricData, dst: vec3): ReadonlyVec4 {
    const targetP = p.emitter.particles[target];
    if (!targetP) {
        vec3.zero(dst);
        return vec4Zero;
    }
    getMatrixTranslation(dst, targetP.pose);
    const prog = p.emitter.behavior.programs[target];
    for (let j = prog.instructions.length - 1; j >= 0; j--) {
        const inst = prog.instructions[j];
        if (inst instanceof ElectricTarget)
            return targetP.vecs[inst.state];
    }
    throw `not a target`;
}

const posArg = vec3.create();
const dirArg = vec3.create();
const posScratch = vec3.create();
const dirScratch = vec3.create();
const targetScratch = vec3.create();
const deltaScratch = vec3.create();
const colorScr = colorNewFromRGBA(1,1,1,1);

class Electricity extends ScratchInstruction<ElectricData> implements BufferFiller {
    public chain: PointChain;
    public state: number; // flags ; first chain index;
    public params: number; // width; noise strength; target strength; tip speed
    public colors: number;
    public direction: number;

    public maxLength: number;

    private tempChain = 0;
    private tempParticle: Particle;
    private tempState: ChainState;
    private tempBuffer: ScratchBuffer;

    constructor(data: ElectricData[], r: Remapper, offsets: Uint32Array, program: Program) {
        super();
        this.state = r(offsets[0], ["elecState", "elecParams", "v", "v", "v", "v"]);
        this.params = this.state + 1;
        this.colors = this.state + 2;
        this.direction = r(offsets[2]);
        this.data = data;

        // find the chain
        for (let i = 0; i < program.instructions.length; i++) {
            const inst = program.instructions[i];
            if (!(inst instanceof PointChain))
                continue;
            this.chain = inst;
            break;
        }
        assertExists(this.chain);
        this.maxLength = this.chain.vertexCount - 1;
        // some data shouldn't change
        for (let i = 0; i < data.length; i++) {
            // assert(data[i].blendMode === 0); // additive fails in magic
            // assert(data[i].targetProgram === data[0].targetProgram);
            // assert(data[i].normalizeDir === data[0].normalizeDir); // fails in magic
            // assert(data[i].detach === data[0].detach);
            // assert(data[i].inheritPos === data[0].inheritPos); // fails in magic
            // assert(data[i].maxDescendants === data[0].maxDescendants || this.chain.chainCount === 1);
            // one instance of reverse differing, but can't matter
            // assert(data[i].reverse === data[0].reverse || data[i].t === program.lifetime);
        }
    }

    public override reset(p: Particle): void {
        p.vecs[this.state][0] = 0;
        p.vecs[this.state][1] = -1; // no active chains
        this.loop(p);
    }

    public override loop(p: Particle): void {
        vec4.zero(p.vecs[this.params]);
        for (let i = 0; i < 4; i++)
            vec4.zero(p.vecs[this.colors + i]);
    }

    public override scratchSize(): number {
        return this.chain.scratchSize();
    }

    public override initScratch(buf: ScratchBuffer, data: ElectricData): void {
        chainStateScratch.child = 255;
        chainStateScratch.next = 255;
        chainStateScratch.flags = ChainFlags.INACTIVE;
        for (let i = 0; i < this.chain.chainCount; i++)
            this.chain.setState(buf, i, chainStateScratch);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const currData = currInstructionData(p.t, this.data);
        const stepSize = currData.totalDisplacement / (this.maxLength);
        const dt = p.t - p.prevT;
        let lengthInc = dt * p.vecs[this.params][3];

        getMatrixTranslation(posArg, p.pose);
        toVec3(dirArg, p.vecs[this.direction]);
        transformVec3Mat4w0(dirArg, p.pose, dirArg);
        vec3.normalize(dirArg, dirArg);

        const scratch = ensureScratch(this, p, system.data);

        if (p.crossed(currData.t)) {
            if (currData.t === 0) {
                const index = this.chain.unusedIndex(scratch);
                // prepend a new chain, if there are any left
                if (index < this.chain.chainCount) {
                    const state = chainStateScratch;
                    state.next = p.vecs[this.state][1];
                    p.vecs[this.state][1] = index;
                    state.child = 255;
                    state.currLength = 0;
                    state.targetProgram = currData.targetProgram;
                    state.flags = ChainFlags.ACTIVE | ChainFlags.FIXED_TARGET;
                    state.startIndex = 0;
                    state.endIndex = 0;
                    state.descCount = 0;
                    state.pointsTraveled = 0;
                    if (currData.inheritPos)
                        state.flags |= ChainFlags.INHERIT_POS;
                    if (currData.detach)
                        state.flags |= ChainFlags.DONE_AT_MAX;
                    this.chain.setState(scratch, index, state);
                    const vtx = chainVtxScratch;
                    vec3.copy(vtx.pos, posArg);
                    vec3.copy(vtx.dir, dirArg);
                    vtx.child = 255;
                    vtx.shrink = 0;
                    this.chain.setVertex(scratch, index, 0, vtx);
                }
            }
            vec4.add(p.vecs[this.colors + 0], p.vecs[this.colors + 0], currData.core);
            vec4.add(p.vecs[this.colors + 1], p.vecs[this.colors + 1], currData.edge);
            vec4.add(p.vecs[this.colors + 2], p.vecs[this.colors + 2], currData.coreStep);
            vec4.add(p.vecs[this.colors + 3], p.vecs[this.colors + 3], currData.edgeStep);
            p.vecs[this.params][0] += currData.widthDelta;
            p.vecs[this.params][1] += currData.perturbDelta;
            p.vecs[this.params][2] += currData.targetStrengthDelta;
            p.vecs[this.params][3] += currData.tipAccel;
            const newDT = p.t - currData.t;
            lengthInc += (1 + newDT) * currData.tipAccel;
        }

        let chainIndex = p.vecs[this.state][1];
        if (dt > 0) {
            while (chainIndex < this.chain.chainCount) {
                const state = this.chain.getState(scratch, chainIndex, chainStateScratch);
                if (state.flags & ChainFlags.INHERIT_POS) {
                    const vtx = this.chain.getVertex(scratch, chainIndex, state.startIndex, chainVtxScratch);
                    vec3.copy(vtx.pos, posArg);
                    vec3.copy(vtx.dir, dirArg);
                    this.chain.setVertex(scratch, chainIndex, state.startIndex, chainVtxScratch);
                }

                const remove = this.updateSingleChain(p, currData, scratch, state, chainIndex, lengthInc / stepSize, (p.t | 0) > p.prevT);
                if (remove) {
                    state.flags = ChainFlags.INACTIVE;
                    // remove from chain
                }
                this.chain.setState(scratch, chainIndex, state);
                chainIndex = state.next;
            }
        }
    }

    private updateSingleChain(p: Particle, data: ElectricData, scratch: ScratchBuffer, state: ChainState, chainIndex: number, lengthInc: number, updateExisting: boolean): boolean {
        if (state.flags & ChainFlags.ORPHANED) {
            if ((state.flags & ChainFlags.DONE_GROWING) === 0)
                return true; // remove incomplete children of removed chains
            state.flags &= ~ChainFlags.ORPHANED;
            state.flags |= ChainFlags.FIXED_TARGET;
        }

        const startLength = state.currLength;
        let newLength = state.currLength + lengthInc;
        let newCount = (newLength | 0) - (startLength | 0);
        let newStart = (state.startIndex + newCount) % this.chain.vertexCount;
        let newEnd = (state.endIndex + newCount) % this.chain.vertexCount;
        let target = state.targetProgram;
        if (state.flags & ChainFlags.FIXED_LENGTH) {
            // unused?
        } else if (!(state.flags & ChainFlags.HIT_MAX) && newLength >= this.maxLength) {
            // we *just* hit the max
            if (state.flags & ChainFlags.DONE_AT_MAX)
                state.flags |= ChainFlags.DONE_GROWING;
            if (state.flags & ChainFlags.DONE_GROWING) {
                // if we're done, for this or other reasons, we just follow the chain
                state.flags &= ~ChainFlags.INHERIT_POS;
                state.flags |= ChainFlags.HIT_MAX;
                newStart = (newLength | 0) - this.maxLength;
                newEnd = (newStart + this.chain.vertexCount - 1) % this.chain.vertexCount;
            } else {
                newLength = this.maxLength;
                newEnd = (state.startIndex + this.chain.vertexCount - 1) % this.chain.vertexCount;
            }
        }
        if (state.flags & ChainFlags.DONE_GROWING) {
            // reset if something catches up...
        } else {
            // keep head rooted until we're done growing
            newStart = state.startIndex;
            if (state.flags & ChainFlags.FIXED_TARGET)
                target = data.targetProgram;
        }

        let targetParams: ReadonlyVec4 = updateTarget(p, target, data, targetScratch);
        const perturbStrength = p.vecs[this.params][1];
        const targetStrength = p.vecs[this.params][2];

        const count = newStart == newEnd ? 0 :
            newStart < newEnd ? newEnd - newStart + 1 :
                this.maxLength - newStart + newEnd + 2;

        const stepSize = data.totalDisplacement / (this.maxLength);
        let vtxIndex = newStart;
        let prevShrink = 0;
        let inNewVertices = false;
        for (let i = 0; i < count; i++, vtxIndex++) {
            if (vtxIndex === this.chain.vertexCount)
                vtxIndex = 0;
            const vtx = this.chain.getVertex(scratch, chainIndex, vtxIndex, chainVtxScratch);
            if (i === 0) {
                vec3.copy(posScratch, vtx.pos);
                vec3.copy(dirScratch, vtx.dir);
                if ((state.flags & ChainFlags.FIXED_TARGET) && !(state.flags & ChainFlags.DONE_GROWING)) {
                    this.computeDirection(dirScratch, targetScratch, posScratch, targetParams, targetStrength, data);
                    vec3.lerp(dirScratch, vtx.dir, dirScratch, perturbStrength);
                    if (data.normalizeDir)
                        vec3.normalize(dirScratch, dirScratch);
                }
            } else {
                if (inNewVertices || updateExisting) {
                    vec3.scaleAndAdd(vtx.pos, posScratch, dirScratch, stepSize);
                    // direction is computed with respect to *previous* position
                    this.computeDirection(dirScratch, targetScratch, posScratch, targetParams, targetStrength, data);
                    const newShrink = clamp(prevShrink + data.shrinkStep * (2 * Math.random() - 1), 0, 1);
                    if (inNewVertices) {
                        // new this frame
                        vtx.shrink = newShrink;
                        vtx.child = 255;
                        vec3.copy(vtx.dir, dirScratch);
                        // maybe add child chain
                    } else {
                        // previously existed
                        vtx.shrink = lerp(vtx.shrink, newShrink, perturbStrength);
                        vec3.lerp(vtx.dir, vtx.dir, dirScratch, perturbStrength);
                        // propagate state to children
                    }
                    this.chain.setVertex(scratch, chainIndex, vtxIndex, chainVtxScratch);
                }
                vec3.copy(posScratch, vtx.pos);
                vec3.copy(dirScratch, vtx.dir);
            }
            prevShrink = vtx.shrink;

            const distToTarget = vec3.dist(vtx.pos, targetScratch);
            if (distToTarget < targetParams[2]) {
                // try to advance to the next target
                const nextTarget = targetParams[3];
                // console.log("reached target", target, nextTarget);
                if (nextTarget < 0) {
                    // no more target points, unparent children of remaining elts
                    newEnd = vtxIndex;
                    newLength -= count - i - 1;
                    break;
                }
                target = nextTarget;
                targetParams = updateTarget(p, target, data, targetScratch);
                if (i === 0) {
                    state.targetProgram = target;
                }
            }
            if (vtxIndex === state.endIndex)
                inNewVertices = true;
        }
        state.currLength = newLength;
        state.startIndex = newStart;
        state.endIndex = newEnd;
        return false;
    }

    private computeDirection(dir: vec3, target: ReadonlyVec3, pos: ReadonlyVec3, params: ReadonlyVec4 | null, targetStrength: number, data: ElectricData): void {
        if (!params)
            return;
        vec3.sub(deltaScratch, target, pos);
        const dist = vec3.len(deltaScratch);
        vec3.normalize(deltaScratch, deltaScratch);
        // see Target
        const attractCutoff = params[0];
        const lerpDelta = params[1];
        const threshold = params[2];
        // add 0 @ attractCutoff, lerpDelta @ threshold
        // if closer than threshold, we will end up overshooting, but there won't be another point
        if (dist < attractCutoff)
            targetStrength += lerpDelta * invlerp(attractCutoff, threshold, dist);
        vec3.lerp(deltaScratch, dir, deltaScratch, targetStrength);
        if (data.normalizeDir)
            vec3.normalize(deltaScratch, deltaScratch);
        const angleRange = data.angleRange * MathConstants.DEG_TO_RAD * Math.PI; // not a typo, original game has an extra factor of pi
        const angle = angleRange * (2 * Math.random() - 1);
        const axis = (3 * Math.random()) | 0;
        switch (axis) {
            case 0: vec3.rotateX(dir, deltaScratch, Vec3Zero, angle); break;
            case 1: vec3.rotateY(dir, deltaScratch, Vec3Zero, angle); break;
            case 2: vec3.rotateZ(dir, deltaScratch, Vec3Zero, angle); break;
        }
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const scratch = ensureScratch(this, p, data);

        if (data.debug) {
            const ctx = getDebugOverlayCanvas2D();

            let chainIndex = p.vecs[this.state][1];
            while (chainIndex < this.chain.chainCount) {
                const state = this.chain.getState(scratch, chainIndex, chainStateScratch);
                let idx = state.startIndex;
                let i = 0;
                while (true) {
                    if (idx === this.chain.vertexCount)
                        idx = 0;
                    const elt = this.chain.getVertex(scratch, chainIndex, idx, chainVtxScratch);
                    vec3.copy(dirScratch, posScratch);
                    transformVec3Mat4w1(posScratch, p.emitter.pose, elt.pos);
                    transformVec3Mat4w1(posScratch, FFXToNoclip, posScratch);
                    vec4.scaleAndAdd(colorScratch, p.vecs[this.colors + 1], p.vecs[this.colors + 3], i);
                    vec4.scale(colorScratch, colorScratch, 1/0x8000);
                    colorFromRGBA(colorScr, colorScratch[0], colorScratch[1], colorScratch[2], colorScratch[3]);
                    if (idx !== state.startIndex)
                        drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, posScratch, dirScratch, colorScr);
                    else
                        drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, posScratch, Green, 5)
                    if (idx === state.endIndex)
                        break;
                    idx++;
                    i++;
                }

                chainIndex = state.next;
            }
        }

        let chainIndex = p.vecs[this.state][1];
        while (chainIndex < this.chain.chainCount) {
            const state = this.chain.getState(scratch, chainIndex, chainStateScratch);
            this.tempChain = chainIndex;
            this.tempParticle = p;
            this.tempState = state;
            this.tempState = state;
            this.tempBuffer = scratch;
            let count = state.endIndex - state.startIndex + 1;
            if (state.endIndex < state.startIndex)
                count += this.chain.vertexCount;
            if (count > 2)
                data.electricRenderer.render(device, renderInstManager, viewerInput, p.vecs, this.colors, count, this,
                    currData.coreWidthFrac,
                    currData.reversed ? 0 : state.pointsTraveled,
                );
            chainIndex = state.next;
        }
    }

    fillBuffer(buf: Float32Array, viewerInput: ViewerRenderInput): void {
        const p = this.tempParticle;
        let i = 0;
        let offs = 0;

        // this width is divided by the depth, then added to the screen space position, so it's effectively in pixel units
        // we can get the appropriate world-space size by dividing by the scale of the PS2 projection matrix
        const baseWidth = p.vecs[this.params][0] * p.emitter.scale[0] / 0x200;
        mat4.mul(renderScratch, FFXToNoclip, p.emitter.pose);
        mat4.mul(renderScratch, viewerInput.camera.viewMatrix, renderScratch);

        const currData = currInstructionData(p.t, this.data);
        let idx = currData.reversed ? this.tempState.endIndex : this.tempState.startIndex;
        const end = currData.reversed ? this.tempState.startIndex : this.tempState.endIndex;
        const step = currData.reversed ? -1 : 1;

        const prevPos = targetScratch;
        const prevDir = deltaScratch;

        while (true) {
            if (idx === this.chain.vertexCount)
                idx = 0;
            if (idx < 0)
                idx = this.chain.vertexCount - 1;
            const width = lerp(1, currData.endWidthFrac, i / (this.chain.vertexCount - 1)) * baseWidth;
            const elt = this.chain.getVertex(this.tempBuffer, this.tempChain, idx, chainVtxScratch);
            vec3.copy(prevPos, posScratch);
            vec3.copy(prevDir, dirScratch);
            transformVec3Mat4w1(posScratch, renderScratch, elt.pos);
            offs += fillVec3v(buf, offs, posScratch, 0);

            vec3.scale(posScratch, posScratch, 1/posScratch[2]);
            vec3.sub(dirScratch, posScratch, prevPos);
            vec3.normalize(dirScratch, dirScratch);
            if (i > 1) {
                vec3.add(prevDir, prevDir, dirScratch);
                vec3.cross(prevDir, prevDir, Vec3UnitZ);
                normToLength(prevDir, width * (1 - elt.shrink * currData.shrinkFrac));
                fillVec3v(buf, offs - 8, prevDir, 1); // overwrite the previous edge with the proper value
            }
            offs += fillVec3v(buf, offs, Vec3Zero, 0); // we need to know the next point to set this properly

            if (idx === end)
                break;
            idx += step;
            i++;
        }
    }
}

interface ElectricTargetData {
    t: number;
    threshold: number;
    attractCutoff: number;
    maxLerpDelta: number;
    nextTargetProgram: number;
    sourceOffset: number;
}

class ElectricTarget extends Instruction {
    public override renders = true;
    public state: number;
    constructor(public data: ElectricTargetData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
    }

    public override update(p: Particle): void {
        const currData = currInstructionData(p.t, this.data);
        p.vecs[this.state][0] = currData.attractCutoff;
        p.vecs[this.state][1] = currData.maxLerpDelta;
        p.vecs[this.state][2] = currData.threshold;
        const nextExists = p.emitter.particles[currData.nextTargetProgram] !== null;
        p.vecs[this.state][3] = nextExists ? currData.nextTargetProgram : -1;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        if (!data.debug)
            return;
        const ctx = getDebugOverlayCanvas2D();
        getMatrixTranslation(posScratch, p.pose);
        transformVec3Mat4w1(posScratch, FFXToNoclip, posScratch);
        drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, posScratch, Blue);
        drawWorldSpaceText(ctx, viewerInput.camera.clipFromWorldMatrix, posScratch, `${p.emitter.particles.indexOf(p)}=>${p.vecs[this.state][3]}`, 10*p.emitter.spec.behavior);
    }
}

interface DepthData {
    t: number;
    scale: vec4;
    offset: vec4;
    space: number;
}

const enum DepthSpace {
    EMITTER = 0,
    VIEW = 1,
    WORLD = 2,
}

class DepthOffset extends Instruction {
    public mtx: number;
    constructor(public data: DepthData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.mtx = r(offsets[0]);
        for (let i = 0; i < data.length; i++) {
            assert(vec4.exactEquals(data[0].scale, data[i].scale));
            // assert(vec4.exactEquals(data[0].offset, data[i].offset)); // macalania trials?
        }
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const data = this.data[0];
        // if (data.scale[0] !== data.scale[1] || data.scale[0] !== data.scale[2] || data.scale[0] !== 1)
        //     debugger
        if (data.space === DepthSpace.VIEW) {
            p.vecs[this.mtx][0] = data.offset[2];
        // } else if (vec4.len(data.offset) > .001) {
        //     debugger
        }
    }
}

class BillboardDepthOffset extends Instruction {
    public mtx: number;
    constructor(public data: DepthData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.mtx = r(offsets[0]);
        assert(data.length === 1)
        // for (let i = 0; i < 3; i++)
        //     assert(data[0].scale[i] === 1)
                // console.log("weird scale", data[0].scale)
        // if (vec4.len(data[0].offset) > 0)
        //     console.log(data[0].space, data[0].offset);
    }

    public override update(p: Particle, system: ParticleSystem): void {
        const data = this.data[0];
        // if (data.scale[0] !== data.scale[1] || data.scale[0] !== data.scale[2] || data.scale[0] !== 1)
        //     debugger
        if (data.space === DepthSpace.VIEW) {
            p.vecs[this.mtx][0] = data.offset[2];
        // } else if (vec4.len(data.offset) > .001) {
        //     debugger
        }
    }
}

interface RainData {
    t: number;
    range: number;
    count: number;
    vel: vec4;
    velRange: vec4;
    baseLength: number;
    lengthRange: number;
}

const velScratch = vec3.create();

class Rain extends ScratchInstruction<RainData> {
    public override renders = true;
    private color: number;
    constructor(data: RainData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.data = data;
        this.color = r(offsets[0]);
        assert(data.length === 1);
    }

    public override scratchSize(): number {
        return this.data[0].count * 4 * 2;
    }

    public override initScratch(buf: ScratchBuffer, data: RainData): void {}

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = this.data[0];
        const dt = p.t - p.prevT;

        const scratch = ensureScratch(this, p, data);

        getMatrixTranslation(posScratch, viewerInput.camera.worldMatrix);
        transformVec3Mat4w0(posScratch, FFXToNoclip, posScratch);
        for (let i = 0; i < currData.count; i++) {
            scratch.get(i, instScr3);
            let badIndex = -1;
            for (let comp = 0; comp < 3; comp++) {
                if (instScr3[comp] > posScratch[comp] + currData.range) {
                    badIndex = comp;
                    instScr3[comp] = posScratch[comp] - currData.range + 1;
                    break;
                } else if (instScr3[comp] < posScratch[comp] - currData.range) {
                    badIndex = comp;
                    instScr3[comp] = posScratch[comp] + currData.range - 1;
                    break;
                }
            }
            if (badIndex < 0 && scratch.data[4*i + 3] > 0) {
                scratch.get(currData.count + i, velScratch);
                vec3.scaleAndAdd(instScr3, instScr3, velScratch, dt);
                scratch.set(i, instScr3);
            } else {
                for (let comp = 0; comp < 3; comp++) {
                    if (comp === badIndex)
                        continue;
                    instScr3[comp] = posScratch[comp] + randomRange(currData.range);
                }
                scratch.set(i, instScr3);
                scratch.data[4*i + 3] = currData.baseLength + randomRange(currData.lengthRange);
                randomCuboid(instScr4, currData.vel, currData.velRange, Distribution.UNIFORM);
                scratch.set4(currData.count + i, instScr4);
            }
        }
        getColor(colorScratch, p, this.color);
        data.rainRenderer.render(device, renderInstManager, viewerInput, colorScratch, currData.vel, scratch.data, currData.count);
    }
}

interface CircleBlurData {
    t: number;
    inc: vec4;
    width: number;
    height: number;
    usePrevFrame: boolean;
    flags: number;
}

class CircleBlur extends Instruction {
    public override renders = true;
    private mtx: number;
    private state: number;
    private color: number;
    constructor(public data: CircleBlurData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
        this.color = r(offsets[1]);
        this.mtx = r(offsets[2]);
        // for (let i = 0; i < data.length; i++)
        //     assert(data[i].usePrevFrame);
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {

    }
}

interface GeoBlurData {
    t: number;
    geo: number;
    inc: vec4;
    flags: number;
    mulZ: number;
}

class GeoBlur extends Instruction {
    public override renders = true;
    private mtx: number;
    private state: number;
    private color: number;
    constructor(public data: GeoBlurData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
        this.color = r(offsets[1]);
        this.mtx = r(offsets[2]);
        for (let i = 0; i < data.length; i++) {
            // assert(data[i].flags === 1); // prev frame, don't load or store computed UVs
            assert(data[i].geo === data[0].geo);
        }
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        p.vecs[this.state][1] += dt * p.vecs[this.state][2];
        p.vecs[this.state][0] += dt * p.vecs[this.state][1];
        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.state], p.vecs[this.state], currData.inc);
        }

        if (currData.geo === 0xFFFF)
            return;
        getColor(colorScratch, p, this.color);
        // in principle we should modify the alpha that gets used for blending here based on dt
        assertExists(data.geos[currData.geo]).prepareToRender(manager, p.render, -1, 0, 0, colorScratch, 0, currData.mulZ !== 0 ? GeoParticleMode.BLUR_Z : GeoParticleMode.BLUR, 0, p.vecs[this.state][0]);
    }
}

interface OverlayData {
    t: number;
    tex: number;
    tbp: number;
    cbp: number;
    width: number;
    height: number;
    du: number;
    dv: number;
    uVel: number;
    vVel: number;
    blendAlpha: number;
    blendMode: number;
}

class Overlay extends Instruction {
    public override renders = true;
    private state: number;
    private color: number;
    constructor(public data: OverlayData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.color = r(offsets[0]);
        this.state = r(offsets[1]);
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.state]);
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
    }
}

export interface WaterArgs {
    xPhase: ReadonlyVec4;
    xAmplitude: ReadonlyVec4;
    xFrequency: ReadonlyVec4;
    diagPhase: ReadonlyVec4;
    diagAmplitude: ReadonlyVec4;
    diagFrequency: ReadonlyVec4;
    radius: number;
    fog: boolean;
}

const waterScratch: WaterArgs = {
    xPhase: null!,
    xAmplitude: null!,
    xFrequency: null!,
    diagPhase: null!,
    diagAmplitude: null!,
    diagFrequency: null!,
    radius: 0,
    fog: false,
};

interface WaterData {
    t: number;
    geo: number;
    uInc: vec4;
    vInc: vec4;
    xAmplitude: vec4;
    xSpeed: vec4;
    xFrequency: vec4;
    diagAmplitude: vec4;
    diagSpeed: vec4;
    diagFrequency: vec4;
    waterTexSlot: number;
    waterTexDur: number;
    blendAlpha: number;
    blendMode: number;
    cull: boolean;
    flag2000: boolean;
    fog: boolean;
    zTest: boolean;
    radius: number;
    worldGrid: boolean;
}

class Water extends Instruction {
    public override renders = true;
    private u: number;
    private v: number;
    private color: number;
    private xPhase: number;
    private diagPhase: number;
    private texState: number;
    constructor(public data: WaterData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.color = r(offsets[0]);
        this.u = r(offsets[2], ["curve", "curve", "v", "v", "waterTex"]);
        this.v = this.u + 1;
        this.xPhase = this.u + 2;
        this.diagPhase = this.u + 3;
        this.texState = this.u + 4;
        assert(data.length === 1);
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.u]);
        vec4.zero(p.vecs[this.v]);
        vec4.zero(p.vecs[this.xPhase]);
        vec4.zero(p.vecs[this.diagPhase]);
    }

    public override loop(p: Particle): void {
        p.vecs[this.u][1] = 0;
        p.vecs[this.u][2] = 0;
        p.vecs[this.v][1] = 0;
        p.vecs[this.v][2] = 0;
    }

    public override render(p: Particle, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (p.crossed(currData.t)) {
            vec4.add(p.vecs[this.u], p.vecs[this.u], currData.uInc);
            vec4.add(p.vecs[this.v], p.vecs[this.v], currData.vInc);
        }
        p.vecs[this.u][1] += dt*p.vecs[this.u][2];
        p.vecs[this.u][0] = (p.vecs[this.u][0] + dt*p.vecs[this.u][1]) % 0x8000;
        p.vecs[this.v][1] += dt*p.vecs[this.v][2];
        p.vecs[this.v][0] = (p.vecs[this.v][0] + dt*p.vecs[this.v][1]) % 0x8000;

        vec4.scaleAndAdd(p.vecs[this.xPhase], p.vecs[this.xPhase], currData.xSpeed, dt);
        vec4.scaleAndAdd(p.vecs[this.diagPhase], p.vecs[this.diagPhase], currData.diagSpeed, dt);
        p.vecs[this.texState][0] += dt/currData.waterTexDur;

        getColor(colorScratch, p, this.color);

        waterScratch.xPhase = p.vecs[this.xPhase];
        waterScratch.xAmplitude = currData.xAmplitude;
        waterScratch.xFrequency = currData.xFrequency;
        waterScratch.diagPhase = p.vecs[this.diagPhase];
        waterScratch.diagAmplitude = currData.diagAmplitude;
        waterScratch.diagFrequency = currData.diagFrequency;
        waterScratch.radius = currData.radius / Math.abs(p.pose[0]);
        waterScratch.fog = currData.fog;

        const geo = assertExists(data.geos[currData.geo]);
        const water = data.getWaterTexture(currData.waterTexSlot, p.vecs[this.texState][0] | 0);
        if (water) {
            for (let i = 0; i < geo.drawCalls.length; i++) {
                geo.drawCalls[i].textureMappings[0].gfxTexture = water;
            }
        }
        geo.renderWater(renderInstManager, p.render, p.vecs[this.u][0], p.vecs[this.v][0], colorScratch, waterScratch);
    }
}

interface SimpleGlareData {
    t: number;
    flipbook: number;
    color: vec4;
    scale: number;
}

class SimpleGlare extends Instruction {
    public override renders = true;
    private base = 0;
    private state = 0;

    constructor(public data: SimpleGlareData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
        this.base = r(offsets[1], ["v", "glare"]) + 1;
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        const flipbook = assertExists(data.flipbooks[currData.flipbook]);

        computeModelMatrixS(renderScratch, currData.scale * p.emitter.scale[0], currData.scale * p.emitter.scale[1], 1);
        getMatrixTranslation(posScratch, p.pose);
        transformVec3Mat4w1(posScratch, p.emitter.toView, posScratch);
        setMatrixTranslation(renderScratch, posScratch);

        vec4.mul(colorScratch, currData.color, p.emitter.color);
        colorScratch[3] *= p.vecs[this.base][0];
        data.flipbookRenderer.render(manager, viewerInput, flipbook, p.vecs[this.state][0], colorScratch, renderScratch, 0, true);
        updateFlipbook(p.vecs[this.state], flipbook.flipbook.frames, dt, 0x200);
    }
}

interface ScaledGlareData {
    t: number;
    flipbook: number;
    color: vec4;
    maxScale: number;
    maxRadius: number;
    xScaleMode: number;
    yScaleMode: number;
}

class ScaledGlare extends Instruction {
    public override renders = true;
    private base = 0;
    private state = 0;

    constructor(public data: ScaledGlareData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
        this.base = r(offsets[1], ["v", "glare"]) + 1;
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (currData.flipbook === 0xFFFF)
            return;

        const flipbook = assertExists(data.flipbooks[currData.flipbook]);
        const ratio = 1 - clamp(p.vecs[this.base][3]/currData.maxRadius, 0, 1);
        let xScale = currData.maxScale * p.emitter.scale[0];
        let yScale = currData.maxScale * p.emitter.scale[1];
        if (currData.xScaleMode === 1)
            xScale *= ratio;
        else if (currData.xScaleMode === 2)
            xScale *= 1 + ratio;
        if (currData.yScaleMode === 1)
            yScale *= ratio;
        else if (currData.yScaleMode === 2)
            yScale *= 1 + ratio;
        computeModelMatrixS(renderScratch, xScale, yScale, 1);
        getMatrixTranslation(posScratch, p.pose);
        transformVec3Mat4w1(posScratch, p.emitter.toView, posScratch);
        setMatrixTranslation(renderScratch, posScratch);

        vec4.mul(colorScratch, currData.color, p.emitter.color);
        colorScratch[3] *= p.vecs[this.base][0];
        data.flipbookRenderer.render(manager, viewerInput, flipbook, p.vecs[this.state][0], colorScratch, renderScratch, 0, true);
        updateFlipbook(p.vecs[this.state], flipbook.flipbook.frames, dt, 0x200);
    }
}

interface MoreGlareData {
    t: number;
    flipbook: number;
    color: vec4;
    scale: number;
    scaleDist: number;
    alphaDist: number;
}

class MoreGlare extends Instruction {
    public override renders = true;
    private base = 0;
    private state = 0;

    constructor(public data: MoreGlareData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.state = r(offsets[0]);
        this.base = r(offsets[1], ["v", "glare"]) + 1;
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;

        if (currData.flipbook === 0xFFFF)
            return;

        const flipbook = assertExists(data.flipbooks[currData.flipbook]);
        const ratio = currData.scale * p.vecs[this.base][3]/currData.scaleDist;
        let xScale = -ratio * p.emitter.scale[0];
        let yScale = ratio * p.emitter.scale[1];

        computeModelMatrixS(renderScratch, xScale, yScale, 1);
        getMatrixTranslation(posScratch, p.pose);
        transformVec3Mat4w1(posScratch, p.emitter.toView, posScratch);
        setMatrixTranslation(renderScratch, posScratch);

        vec4.mul(colorScratch, currData.color, p.emitter.color);
        colorScratch[3] *= clamp(p.vecs[this.base][3]/currData.alphaDist, 0, 1)
        data.flipbookRenderer.render(manager, viewerInput, flipbook, p.vecs[this.state][0], colorScratch, renderScratch, 0, true);
        updateFlipbook(p.vecs[this.state], flipbook.flipbook.frames, dt, 0x200);
    }
}

interface GlareBaseData {
    t: number;
    maxDist: number;
    distReduction: number;
    factor: number;
    viewDir: boolean; // as opposed to based on screen distance, unused
}

class GlareBase extends Instruction {
    private translate = 0;
    private state = 0; // alpha ; factor ; maxDist ; dist

    constructor(public data: GlareBaseData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.translate = r(offsets[0], ["v", "glare"]);
        this.state = this.translate + 1;
        // false in an actor magic in lake macalania
        // for (let d of data)
        //     assert(d.viewDir)
    }

    public override reset(p: Particle): void {
        vec4.zero(p.vecs[this.translate]);
        vec4.zero(p.vecs[this.state]);
    }

    public override render(p: Particle, device: GfxDevice, manager: GfxRenderInstManager, viewerInput: ViewerRenderInput, data: ParticleData): void {
        const currData = currInstructionData(p.t, this.data);
        if (p.crossed(currData.t)) {
            p.vecs[this.state][1] += currData.factor;
            p.vecs[this.state][2] += currData.maxDist;
        }
        const factor = p.vecs[this.state][1];
        const maxDist = p.vecs[this.state][2] - currData.distReduction;
        // this function does a bunch of work, but seemingly all that's ever used
        // is an alpha fade based on the distance from the glare source
        getMatrixTranslation(posScratch, p.pose);
        transformVec3Mat4w1(posScratch, p.emitter.toView, posScratch);
        const dist = vec3.len(posScratch);
        p.vecs[this.state][3] = Math.hypot(posScratch[0], posScratch[1]);
        vec3.scale(posScratch, posScratch, 1/dist);
        let fade = 1 - clamp((1 + posScratch[2])/.6, 0, 1);
        if (factor > 0) {
            getMatrixTranslation(deltaScratch, p.pose);
            const align = vec3.dot(deltaScratch, posScratch);
            fade *= 1 - clamp((1-align)/(2*factor), 0, 1);
        }
        if (maxDist > 0) {
            fade *= 1 - clamp(dist / maxDist, 0, 1);
        } else {
            fade = 0;
        }
        p.vecs[this.state][0] = fade;
    }
}

interface AttractingTargetData {
    t: number;
    minDist: number;
    repelDist: number;
}

class AttractingTarget extends Instruction {
    public override renders = true;
    public state: number;
    public vec: number;
    constructor(public data: AttractingTargetData[], r: Remapper, offsets: Uint32Array) {
        super();
        this.vec = r(offsets[0]);
        this.state = r(offsets[1]);
    }

    public override update(p: Particle): void {
        const currData = currInstructionData(p.t, this.data);
        p.vecs[this.state][0] = currData.minDist;
        p.vecs[this.state][1] = currData.repelDist;
        p.vecs[this.state][2] = this.vec;
    }
}

interface AttractData {
    t: number;
    target: number;
    offset: number;
}

class Attract extends Instruction {
    public override renders = true;
    public src: number;
    public dst: number;
    constructor(public data: AttractData[], r: Remapper, offsets: Uint32Array) {
        super();
        // seems like these
        this.src = r(offsets[0]);
        this.dst = r(offsets[1]);
    }

    public override update(p: Particle): void {
        const currData = currInstructionData(p.t, this.data);
        const dt = p.t - p.prevT;
        if (currData.target < 0)
            return;
        const target = assertExists(p.emitter.particles[currData.target]);
        const paramsIndex = assertExists(p.emitter.behavior.programs[currData.target].vecMap.get(currData.offset));
        const params = target.vecs[paramsIndex];
        vec4.sub(instScr4, target.vecs[params[2]], p.vecs[this.src]);
        instScr4[3] = 0;
        const dist = vec4.len(instScr4);
        if (dist < params[0]) {
            vec4.normalize(instScr4, instScr4);
            vec4.scale(instScr4, instScr4, dt * params[1] * (1-dist/params[0]));
            vec4.add(p.vecs[this.dst], p.vecs[this.dst], instScr4);
        }
    }
}

class UnknownInstruction extends Instruction {
    constructor(public raw: number, public first: number, public offs: number) {
        super();
    }
}

interface DataParser<T extends InstructionData> {
    size: number;
    parse: (view: DataView, offs: number) => T;
}

function getT(view: DataView, offs: number): number {
    const t = view.getInt32(offs, true);
    return t < 0 ? t : t / 0x1000;
}

const vecP: DataParser<Vec4Data> = {
    size: 0x20,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        vec: vec4FromView(view, offs + 0x10, true),
    }),
};

const ivecP: DataParser<Vec4Data> = {
    size: 0x20,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        vec: ivec4FromView(view, offs + 0x10, true),
    }),
};

const hvecP: DataParser<Vec4Data> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        vec: hvec4FromView(view, offs + 0x8, true),
    }),
};

const randP: DataParser<RandomStepData> = {
    size: 0x30,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        target: view.getInt32(offs + 0x04, true),
        vec: vec4FromView(view, offs + 0x10, true),
        peaked: view.getInt8(offs + 0x20) !== 0,
    }),
};

const irandP: DataParser<RandomStepData> = {
    size: 0x30,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        target: view.getInt32(offs + 0x04, true),
        vec: ivec4FromView(view, offs + 0x10, true),
        peaked: view.getInt8(offs + 0x20) !== 0,
    }),
};

const hrandP: DataParser<RandomStepData> = {
    size: 0x18,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        target: view.getInt32(offs + 0x04, true),
        vec: hvec4FromView(view, offs + 0x8, true),
        peaked: view.getInt8(offs + 0x10) !== 0,
    }),
};

const enabledP: DataParser<EnabledData> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        enabled: view.getInt32(offs + 0x4, true) !== -1,
    }),
};

const simpleFlipbookP: DataParser<SimpleFlipbookData> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x4, true),
        speed: view.getUint16(offs + 0x8, true),
        fog: false,
        fade: false,
        depth: false,
    }),
};

const paramFlipbookP: DataParser<SimpleFlipbookData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x4, true),
        speed: view.getUint16(offs + 0x8, true),
        fog: view.getUint8(offs + 0xC) !== 0,
        fade: view.getUint8(offs + 0xD) !== 0,
        depth: view.getUint8(offs + 0xE) !== 0,
    }),
};

const flippedFlipbookP: DataParser<FlippedFlipbookData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x4, true),
        speed: view.getUint16(offs + 0x8, true),
        fog: view.getUint8(offs + 0xC) !== 0,
        fade: view.getUint8(offs + 0xD) !== 0,
        depth: view.getUint8(offs + 0xE) !== 0,
        flipX: (view.getUint8(offs + 0xF) & 2) !== 0,
        flipY: (view.getUint8(offs + 0xF) & 1) !== 0,
    }),
};

const clusterFlipbookP: DataParser<FlipbookClusterData> = {
    size: 0x100,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x04, true),
        childCount: view.getUint32(offs + 0x08, true),
        speed: view.getUint16(offs + 0x0C, true),
        offsetRange: vec4FromView(view, offs + 0x10, true),
        offsedPeaked: view.getUint8(offs + 0x20) !== 0,
        vel: vec4FromView(view, offs + 0x40, true),
        velRange: vec4FromView(view, offs + 0x50, true),
        accel: vec4FromView(view, offs + 0x60, true),
        scale: vec4FromView(view, offs + 0x70, true),
        scaleRange: vec4FromView(view, offs + 0x80, true),
        scaleVel: vec4FromView(view, offs + 0x90, true),
        scaleAccel: vec4FromView(view, offs + 0xA0, true),
        rollRange: view.getFloat32(offs + 0xB8, true),
        resetCount: view.getUint8(offs + 0xC0),
        resetInterval: view.getUint8(offs + 0xC1),
        fog: view.getUint8(offs + 0xC2) !== 0,
        fade: view.getUint8(offs + 0xC3) !== 0,
        adjustDepth: view.getUint8(offs + 0xC4) !== 0,
        depthOffset: vec4FromView(view, offs + 0xD0, true),
        depthScale: vec4FromView(view, offs + 0xE0, true),
        depthType: view.getUint8(offs + 0xF0),
        mirrorFlags: view.getUint8(offs + 0xF1),
    }),
};

const clusterFlipbookNoMirrorP: DataParser<FlipbookClusterData> = {
    size: 0x100,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x04, true),
        childCount: view.getUint32(offs + 0x08, true),
        speed: view.getUint16(offs + 0x0C, true),
        offsetRange: vec4FromView(view, offs + 0x10, true),
        offsedPeaked: view.getUint8(offs + 0x20) !== 0,
        vel: vec4FromView(view, offs + 0x40, true),
        velRange: vec4FromView(view, offs + 0x50, true),
        accel: vec4FromView(view, offs + 0x60, true),
        scale: vec4FromView(view, offs + 0x70, true),
        scaleRange: vec4FromView(view, offs + 0x80, true),
        scaleVel: vec4FromView(view, offs + 0x90, true),
        scaleAccel: vec4FromView(view, offs + 0xA0, true),
        rollRange: view.getFloat32(offs + 0xB8, true),
        resetCount: view.getUint8(offs + 0xC0),
        resetInterval: view.getUint8(offs + 0xC1),
        fog: view.getUint8(offs + 0xC2) !== 0,
        fade: view.getUint8(offs + 0xC3) !== 0,
        adjustDepth: view.getUint8(offs + 0xC4) !== 0,
        depthOffset: vec4FromView(view, offs + 0xD0, true),
        depthScale: vec4FromView(view, offs + 0xE0, true),
        depthType: view.getUint8(offs + 0xF0),
        mirrorFlags: 0,
    }),
};

const clusterFlipbookNoMirrorSmallerP: DataParser<FlipbookClusterData> = {
    size: 0xF0,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x04, true),
        childCount: view.getUint32(offs + 0x08, true),
        speed: view.getUint16(offs + 0x0C, true),
        offsetRange: vec4FromView(view, offs + 0x10, true),
        offsedPeaked: view.getUint8(offs + 0x20) !== 0,
        vel: vec4FromView(view, offs + 0x30, true),
        velRange: vec4FromView(view, offs + 0x40, true),
        accel: vec4FromView(view, offs + 0x50, true),
        scale: vec4FromView(view, offs + 0x60, true),
        scaleRange: vec4FromView(view, offs + 0x70, true),
        scaleVel: vec4FromView(view, offs + 0x80, true),
        scaleAccel: vec4FromView(view, offs + 0x90, true),
        rollRange: view.getFloat32(offs + 0xA8, true),
        resetCount: view.getUint8(offs + 0xB0),
        resetInterval: view.getUint8(offs + 0xB1),
        fog: view.getUint8(offs + 0xB2) !== 0,
        fade: view.getUint8(offs + 0xB3) !== 0,
        adjustDepth: view.getUint8(offs + 0xB4) !== 0,
        depthOffset: vec4FromView(view, offs + 0xC0, true),
        depthScale: vec4FromView(view, offs + 0xD0, true),
        depthType: view.getUint8(offs + 0xE0),
        mirrorFlags: 0,
    }),
};

const clusterFlipbookNoVelP: DataParser<FlipbookClusterData> = {
    size: 0xF0,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        index: view.getUint32(offs + 0x04, true),
        childCount: view.getUint32(offs + 0x08, true),
        speed: view.getUint16(offs + 0x0C, true),
        offsetRange: vec4FromView(view, offs + 0x10, true),
        offsedPeaked: view.getUint8(offs + 0x20) !== 0,
        vel: vec4FromView(view, offs + 0x40, true),
        velRange: vec4FromView(view, offs + 0x50, true),
        accel: vec4.create(),
        scale: vec4FromView(view, offs + 0x60, true),
        scaleRange: vec4FromView(view, offs + 0x70, true),
        scaleVel: vec4FromView(view, offs + 0x80, true),
        scaleAccel: vec4FromView(view, offs + 0x90, true),
        rollRange: view.getFloat32(offs + 0xA8, true),
        resetCount: view.getUint8(offs + 0xB0),
        resetInterval: view.getUint8(offs + 0xB1),
        fog: view.getUint8(offs + 0xB2) !== 0,
        fade: view.getUint8(offs + 0xB3) !== 0,
        adjustDepth: view.getUint8(offs + 0xB4) !== 0,
        depthOffset: vec4FromView(view, offs + 0xC0, true),
        depthScale: vec4FromView(view, offs + 0xD0, true),
        depthType: view.getUint8(offs + 0xE0),
        mirrorFlags: 0,
    }),
};

const pyreflyP: DataParser<PyreflyData> = {
    size: 0x50,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x04, true),
        speed: view.getUint32(offs + 0x08, true),
        maxScale: view.getFloat32(offs + 0x0C, true),
        minScale: view.getFloat32(offs + 0x10, true),
        sizeRange: view.getFloat32(offs + 0x14, true),
        startGap: view.getFloat32(offs + 0x18, true),
        trailLength: view.getUint8(offs + 0x1C),
        renderHead: view.getUint8(offs + 0x1D) !== 0,
        rotate: view.getUint16(offs + 0x1E, true) !== 0,
        steps: [
            hvec4FromView(view, offs + 0x20, true),
            hvec4FromView(view, offs + 0x28, true),
            hvec4FromView(view, offs + 0x30, true),
            hvec4FromView(view, offs + 0x38, true),
            hvec4FromView(view, offs + 0x40, true),
            hvec4FromView(view, offs + 0x48, true),
        ],
    }),
};

const flipbookTrailP: DataParser<FlipbookTrailData> = {
    size: 0x24,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x04, true),
        speed: view.getUint32(offs + 0x08, true),
        maxScale: view.getFloat32(offs + 0x0C, true),
        minScale: view.getFloat32(offs + 0x10, true),
        headColor: colorFromView(view, offs + 0x14),
        tailColor: colorFromView(view, offs + 0x18),
        startGap: view.getFloat32(offs + 0x1C, true),
        trailLength: view.getUint8(offs + 0x20),
        renderHead: view.getUint8(offs + 0x22) !== 0,
        fog: false,
        fade: false,
        depthOffset: false,
    }),
};

const flipbookTrailParamsP: DataParser<FlipbookTrailData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x04, true),
        speed: view.getUint32(offs + 0x08, true),
        maxScale: view.getFloat32(offs + 0x0C, true),
        minScale: view.getFloat32(offs + 0x10, true),
        headColor: colorFromView(view, offs + 0x14),
        tailColor: colorFromView(view, offs + 0x18),
        startGap: view.getFloat32(offs + 0x1C, true),
        trailLength: view.getUint8(offs + 0x20),
        renderHead: view.getUint8(offs + 0x22) !== 0,
        fog: view.getUint8(0x23) !== 0,
        fade: view.getUint8(0x24) !== 0,
        depthOffset: view.getUint8(0x25) !== 0,
    }),
};

const flipbookTrailVarP: DataParser<FlipbookTrailData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x04, true),
        speed: view.getUint16(offs + 0x08, true),
        maxScale: 1,
        headColor: hvec4FromView(view, offs + 0x10, true),
        tailColor: vec4.create(),
        minScale: view.getFloat32(offs + 0x18, true),
        startGap: view.getFloat32(offs + 0x1C, true),
        trailLength: view.getUint16(offs + 0x20, true),
        renderHead: false,
        fog: false,
        fade: false,
        depthOffset: false,
    }),
};

const PointLightP: DataParser<PointLightData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        radius: view.getFloat32(offs + 0x4, true),
        lightGroup: view.getUint8(offs + 0x8),
        strength: view.getFloat32(offs + 0xC, true),
    }),
}

const PointLightGroupP: DataParser<PointLightGroupData> = {
    size: 0x14,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        radius: view.getFloat32(offs + 0x4, true),
        lightGroup: view.getUint8(offs + 0x8),
        strength: view.getFloat32(offs + 0xC, true),
        pattern: view.getInt16(offs + 0x10, true),
    }),
}

const uvScrollGeoP: DataParser<UVScrollGeoData> = {
    size: 0x24,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        flags: view.getUint8(offs + 0x20),
        fog: false,
        flag2000: false,
        fade: false,
        depthOffset: false,
        useWater: false,
        waterTexDur: 0,
        waterTexSlot: 0,
    }),
};

const uvScrollGeoNoFlagsP: DataParser<UVScrollGeoData> = {
    size: 0x20,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        flags: 0,
        fog: false,
        flag2000: false,
        fade: false,
        depthOffset: false,
    }),
};

const paramUVScrollGeoP: DataParser<UVScrollGeoData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        flags: view.getUint8(offs + 0x20),
        fog: view.getUint8(offs + 0x21) !== 0,
        flag2000: view.getUint8(offs + 0x22) !== 0,
        fade: view.getUint8(offs + 0x23) !== 0,
        depthOffset: view.getUint8(offs + 0x24) !== 0,
    }),
};

const wrapUVScrollGeoP: DataParser<WrapUVScrollGeoData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        blendMode: view.getUint8(offs + 0x20),
        blendAlpha: view.getUint8(offs + 0x21),
        flags: view.getUint8(offs + 0x22),
        fog: view.getUint8(offs + 0x23) !== 0,
        fade: view.getUint8(offs + 0x24) !== 0,
        flag2000: view.getUint8(offs + 0x25) !== 0,
        depthOffset: view.getUint8(offs + 0x26) !== 0,
        useWater: false,
        waterTexDur: 0,
        waterTexSlot: 0,
    }),
};

const wrapUVScrollGeoWaterP: DataParser<WrapUVScrollGeoData> = {
    size: 0x2C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        useWater: view.getUint8(offs + 0x21) !== 0,
        waterTexSlot: view.getUint8(offs + 0x22),
        waterTexDur: view.getUint8(offs + 0x23),
        blendMode: view.getUint8(offs + 0x24),
        blendAlpha: view.getUint8(offs + 0x25),
        flags: view.getUint8(offs + 0x26),
        fog: view.getUint8(offs + 0x27) !== 0,
        fade: view.getUint8(offs + 0x28) !== 0,
        flag2000: view.getUint8(offs + 0x29) !== 0,
        depthOffset: false,
    }),
};

const zeroWibbleUVScrollGeoP: DataParser<WibbleUVScrollGeoData> = {
    size: 0x2C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        waterTexSlot: view.getUint8(0x20),
        waterTexDur: view.getUint8(0x21),

        wibbleOffset: vec4.create(),
        wibbleVelocity: vec4.create(),
        wibbleStrength: vec4.create(),

        blendMode: view.getUint8(0x22),
        blendAlpha: view.getUint8(0x23),
        backCull: view.getUint8(offs + 0x24) !== 0,
        flag2000: view.getUint8(offs + 0x25) !== 0,
        fog: view.getUint8(offs + 0x26) !== 0,
        zTest: view.getUint8(offs + 0x27) !== 0,
        flags: view.getUint8(0x29),
    }),
};

const wibbleUVScrollGeoP: DataParser<WibbleUVScrollGeoData> = {
    size: 0x60,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),

        wibbleOffset: vec4FromView(view, offs + 0x20, true),
        wibbleVelocity: vec4FromView(view, offs + 0x30, true),
        wibbleStrength: vec4FromView(view, offs + 0x40, true),

        waterTexSlot: view.getUint8(offs + 0x50),
        waterTexDur: view.getUint8(offs + 0x51),
        blendMode: view.getUint8(offs + 0x52),
        blendAlpha: view.getUint8(offs + 0x53),
        backCull: view.getUint8(offs + 0x54) !== 0,
        flag2000: view.getUint8(offs + 0x55) !== 0,
        fog: view.getUint8(offs + 0x56) !== 0,
        zTest: view.getUint8(offs + 0x57) !== 0,
    }),
};

const wrapUVScrollGeoNoDepthP: DataParser<WrapUVScrollGeoData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        uInc: paddedVec4FromView(view, offs + 0x08, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        blendMode: view.getUint8(offs + 0x20),
        blendAlpha: view.getUint8(offs + 0x21),
        flags: view.getUint8(offs + 0x22),
        fog: view.getUint8(offs + 0x23) !== 0,
        fade: view.getUint8(offs + 0x24) !== 0,
        flag2000: view.getUint8(offs + 0x25) !== 0,
        depthOffset: false,
        useWater: false,
        waterTexDur: 0,
        waterTexSlot: 0,
    }),
};

const simpleGeoParamsP: DataParser<SimpleGeoData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        flags: view.getUint8(offs + 8),
        blend: -1,
        fog: view.getUint8(offs + 9) !== 0,
        flag2000: view.getUint8(offs + 0xa) !== 0,
        fade: view.getUint8(offs + 0xb) !== 0,
        depthOffset: view.getUint8(offs + 0xc) !== 0,
    }),
};

const simpleGeoP: DataParser<SimpleGeoData> = {
    size: 0x8,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        flags: 0,
        blend: -1,
        fog: false,
        flag2000: false,
        fade: false,
        depthOffset: false,
    }),
};

const simpleGeoFlagsP: DataParser<SimpleGeoData> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        blend: -1,
        flags: view.getUint8(offs + 0x8),
        fog: false,
        flag2000: false,
        fade: false,
        depthOffset: false,
    }),
};

const simpleGeoBlendP: DataParser<SimpleGeoData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geoIndex: view.getUint32(offs + 0x04, true),
        blend: view.getUint8(offs + 8),
        flags: view.getUint8(offs + 0xa),
        fog: view.getUint8(offs + 0xb) !== 0,
        flag2000: view.getUint8(offs + 0xc) !== 0,
        fade: view.getUint8(offs + 0xd) !== 0,
        depthOffset: view.getUint8(offs + 0xe) !== 0,
    }),
};

const childSetupP: DataParser<ChildSetupData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getInt16(offs + 0xC, true),
    }),
}

const emitDataRawP: DataParser<EmitData> = {
    size: 0x14,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        scale: 0,
        count: view.getUint8(offs + 0x6),
        period: view.getUint8(offs + 0x7),
        random: view.getUint8(offs + 0x8) !== 0,
        program: view.getInt32(offs + 0xC, true),
        childPos: view.getUint32(offs + 0x10, true),
        childDir: -1,
        transform: false,
        childAngle: -1,
    }),
}

const emitDataP: DataParser<EmitData> = {
    size: 0x14,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        scale: 0,
        count: view.getUint8(offs + 0x6),
        period: view.getUint8(offs + 0x7),
        random: view.getUint8(offs + 0x8) !== 0,
        program: view.getInt32(offs + 0xC, true),
        childPos: view.getUint32(offs + 0x10, true),
        hasDir: false,
        childDir: -1,
        transform: true,
        childAngle: -1,
    }),
}

const emitDataDirP: DataParser<EmitData> = {
    size: 0x20,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        scale: view.getFloat32(offs + 0x8, true),
        count: view.getUint8(offs + 0xC),
        period: view.getUint8(offs + 0xD),
        random: view.getUint8(offs + 0xE) !== 0,
        program: view.getInt32(offs + 0x10, true),
        childPos: view.getUint32(offs + 0x14, true),
        childDir: view.getUint32(offs + 0x1C, true),
        transform: true,
        childAngle: -1,
    }),
}

const emitDataAngleP: DataParser<EmitData> = {
    size: 0x1C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        count: view.getUint8(offs + 0x6),
        scale: 0,
        period: view.getUint8(offs + 0x7),
        random: view.getUint8(offs + 0x8) !== 0,
        program: view.getInt32(offs + 0xC, true),
        childPos: view.getUint32(offs + 0x10, true),
        childDir: -1,
        transform: false,
        childAngle: view.getUint32(offs + 0x18, true),
    }),
}

const randomEmitDataP: DataParser<RandomEmitData> = {
    size: 0x20,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        scale: view.getFloat32(offs + 0x8, true),
        count: view.getUint8(offs + 0xC),
        mask: view.getUint8(offs + 0xD),
        random: view.getUint8(offs + 0xE) !== 0,
        program: view.getInt32(offs + 0x10, true),
        childPos: view.getUint32(offs + 0x14, true),
        childDir: view.getUint32(offs + 0x1C, true),
    }),
}

const randomEmitDataNormalizedP: DataParser<RandomEmitData> = {
    size: 0x1C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        scale: 1,
        count: view.getUint8(offs + 0x6),
        mask: view.getUint8(offs + 0x7),
        random: view.getUint8(offs + 0x8) !== 0,
        program: view.getInt32(offs + 0xC, true),
        childPos: view.getUint32(offs + 0x10, true),
        childDir: view.getUint32(offs + 0x18, true),
    }),
}

const simpleEmitP: DataParser<SimpleEmitData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        program: view.getInt32(offs + 0x4, true),
        childPos: view.getUint32(offs + 0x8, true),
        period: view.getUint8(offs + 0xC),
    }),
}

const dualEmitP: DataParser<DualEmitData> = {
    size: 0x1C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        pattern: view.getUint16(offs + 0x4, true),
        deltaPattern: view.getUint16(offs + 0x6, true),
        count: view.getUint8(offs + 0x8),
        mask: view.getUint8(offs + 0x9),
        random: view.getUint8(offs + 0xA) !== 0,
        program: view.getInt32(offs + 0xC, true),
        childPos: view.getUint32(offs + 0x10, true),
        childDelta: view.getUint32(offs + 0x18, true),
    }),
}

const electricColorP: DataParser<ElectricColorData> = {
    size: 0x40,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        colorAccs: [
            hvec4FromView(view, offs + 8, true),
            hvec4FromView(view, offs + 0x10, true),
            hvec4FromView(view, offs + 0x18, true),
            hvec4FromView(view, offs + 0x20, true),
        ],
        widthVel: view.getFloat32(offs + 0x28, true),
        perturbVel: view.getFloat32(offs + 0x2C, true),
        tipAccel: view.getFloat32(offs + 0x30, true),
        targetVel: view.getFloat32(offs + 0x34, true),
        maxDescs: view.getUint8(offs + 0x38),
    })
}

const electricityP: DataParser<ElectricData> = {
    size: 0x60,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        targetProgram: view.getInt32(offs + 0x4, true),
        targetOffset: view.getInt32(offs + 0x8, true),
        core: hvec4FromView(view, offs + 0x10, true),
        edge: hvec4FromView(view, offs + 0x18, true),
        coreStep: hvec4FromView(view, offs + 0x20, true),
        edgeStep: hvec4FromView(view, offs + 0x28, true),
        totalDisplacement: view.getFloat32(offs + 0x30, true),
        widthDelta: view.getFloat32(offs + 0x34, true),
        endWidthFrac: view.getFloat32(offs + 0x38, true),
        coreWidthFrac: view.getFloat32(offs + 0x3C, true),
        shrinkFrac: view.getFloat32(offs + 0x40, true),
        shrinkStep: view.getFloat32(offs + 0x44, true),
        perturbDelta: view.getFloat32(offs + 0x48, true),
        tipAccel: view.getFloat32(offs + 0x4C, true),
        targetStrengthDelta: view.getFloat32(offs + 0x50, true),
        angleRange: view.getInt16(offs + 0x54, true),
        maxDescendants: view.getUint8(offs + 0x56),
        randomMask: view.getUint8(offs + 0x57),
        blendMode: view.getUint8(offs + 0x58),
        detach: view.getUint8(offs + 0x59) !== 0,
        normalizeDir: view.getUint8(offs + 0x5A) === 0,
        reversed: view.getUint8(offs + 0x5B) !== 0,
        inheritPos: view.getUint8(offs + 0x5C) !== 0,
    }),
};

const electricTargetP: DataParser<ElectricTargetData> = {
    size: 0x18,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        threshold: view.getFloat32(offs + 0x04, true),
        attractCutoff: view.getFloat32(offs + 0x08, true),
        maxLerpDelta: view.getFloat32(offs + 0x0C, true),
        nextTargetProgram: view.getInt32(offs + 0x10, true),
        sourceOffset: view.getInt32(offs + 0x14, true),
    }),
}

const depthP: DataParser<DepthData> = {
    size: 0x40,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        offset: paddedVec4FromView(view, offs + 0x10, true),
        scale: paddedVec4FromView(view, offs + 0x20, true),
        space: view.getUint8(offs + 0x30),
    }),
}

const rainP: DataParser<RainData> = {
    size: 0x40,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        range: view.getFloat32(offs + 0x4, true),
        count: view.getUint32(offs + 0x8, true),
        vel: paddedVec4FromView(view, offs + 0x10, true),
        velRange: paddedVec4FromView(view, offs + 0x20, true),
        baseLength: view.getFloat32(offs + 0x30, true),
        lengthRange: view.getFloat32(offs + 0x34, true),
    }),
}

const circleBlurP: DataParser<CircleBlurData> = {
    size: 0x1C,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        inc: paddedVec4FromView(view, offs + 0x4, true),
        width: view.getFloat32(offs + 0x10, true),
        height: view.getFloat32(offs + 0x14, true),
        usePrevFrame: view.getUint8(offs + 0x18) !== 0,
        flags: view.getUint8(offs + 0x19),
    }),
}

const geoBlurP: DataParser<GeoBlurData> = {
    size: 0x18,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geo: view.getUint32(offs + 0x4, true),
        inc: paddedVec4FromView(view, offs + 0x8, true),
        flags: view.getUint8(offs + 0x14),
        mulZ: view.getUint8(offs + 0x15),
    }),
}

const overlayP: DataParser<OverlayData> = {
    size: 0x28,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        tex: -1,
        tbp: view.getUint32(offs + 0x4, true),
        cbp: view.getUint32(offs + 0x8, true),
        width: view.getUint32(offs + 0xC, true),
        height: view.getUint32(offs + 0x10, true),
        du: view.getUint32(offs + 0x14, true),
        dv: view.getUint32(offs + 0x18, true),
        uVel: view.getUint32(offs + 0x1C, true),
        vVel: view.getUint32(offs + 0x20, true),
        blendAlpha: view.getUint8(offs + 0x24),
        blendMode: view.getUint8(offs + 0x25),
    }),
}

const waterP: DataParser<WaterData> = {
    size: 0xA0,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        geo: view.getUint32(offs + 0x4, true),
        uInc: paddedVec4FromView(view, offs + 0x8, true),
        vInc: paddedVec4FromView(view, offs + 0x14, true),
        diagAmplitude: vec4FromView(view, offs + 0x20, true),
        diagSpeed: vec4FromView(view, offs + 0x30, true),
        diagFrequency: vec4FromView(view, offs + 0x40, true),
        xAmplitude: vec4FromView(view, offs + 0x50, true),
        xSpeed: vec4FromView(view, offs + 0x60, true),
        xFrequency: vec4FromView(view, offs + 0x70, true),
        waterTexSlot: view.getUint8(offs + 0x80),
        waterTexDur: view.getUint8(offs + 0x81),
        blendMode: view.getUint8(offs + 0x82),
        blendAlpha: view.getUint8(offs + 0x83),
        cull: view.getUint8(offs + 0x84) !== 0,
        flag2000: view.getUint8(offs + 0x85) !== 0,
        fog: view.getUint8(offs + 0x86) !== 0,
        zTest: view.getUint8(offs + 0x87) !== 0,
        radius: view.getFloat32(offs + 0x8C, true),
        worldGrid: view.getUint8(offs + 0x90) !== 0,
    }),
}

const simpleGlareP: DataParser<SimpleGlareData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x4, true),
        color: colorFromView(view, offs + 0x8),
        scale: view.getFloat32(offs + 0xC, true),
    }),
}

const scaledGlareP: DataParser<ScaledGlareData> = {
    size: 0x14,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x4, true),
        color: colorFromView(view, offs + 0x8),
        maxScale: view.getFloat32(offs + 0xC, true),
        maxRadius: view.getUint16(offs + 0x10, true),
        xScaleMode: view.getUint8(offs + 0x12),
        yScaleMode: view.getUint8(offs + 0x13),
    }),
}

const moreGlareP: DataParser<MoreGlareData> = {
    size: 0x14,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        flipbook: view.getUint32(offs + 0x4, true),
        color: colorFromView(view, offs + 0x8),
        scale: view.getFloat32(offs + 0xC, true),
        scaleDist: view.getUint16(offs + 0x10, true),
        alphaDist: view.getUint8(offs + 0x12),
    }),
}

const glareBaseP: DataParser<GlareBaseData> = {
    size: 0x10,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        factor: view.getFloat32(offs + 0x4, true),
        maxDist: view.getFloat32(offs + 0x8, true),
        distReduction: view.getUint8(offs + 0xC),
        viewDir: view.getUint8(offs + 0xD) !== 0,
    }),
}

const glareVelP: DataParser<Vec4Data> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        vec: vec4.fromValues(
            0,
            view.getFloat32(offs + 4, true),
            view.getFloat32(offs + 8, true),
            0,
        ),
    })
}

const attractTargetP: DataParser<AttractingTargetData> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        minDist: view.getFloat32(offs + 4, true),
        repelDist: view.getFloat32(offs + 8, true),
    })
}

const attractP: DataParser<AttractData> = {
    size: 0xC,
    parse: (view: DataView, offs: number) => ({
        t: getT(view, offs),
        target: view.getInt32(offs + 4, true),
        offset: view.getInt32(offs + 8, true),
    })
}
interface FlipbookDraw {
    indexStart: number;
    rectCount: number;
    blend: number;
}

interface FlipbookFrame {
    flags: number;
    drawFlags: number;
    textureIndex: number;
    duration: number;
    draws: FlipbookDraw[];
}

export interface Flipbook {
    frames: FlipbookFrame[];
    indexData: Uint16Array;
    vertexData: Float32Array;
    textureIndex: number;
    trailCompatible: boolean;
}

interface ParticleDrawCall {
    startIndex: number;
    indexCount: number;
    texIndex: number;
}

interface ParticleGeometry {
    drawCalls: ParticleDrawCall[];
    vertexData: Float32Array,
    indexData: Uint16Array,
    vtxMin: vec3;
    vtxMax: vec3;
    center: vec3;
}

export interface ParticleGeometryEntry {
    flags: number;
    blendSettings: number;
    points: vec3[];
    geometry?: ParticleGeometry;
    lateBindingTex?: string;
}

interface Program {
    flags: number;
    start: number;
    lifetime: number;
    loopEnd: number;
    loopLength: number;
    instructions: Instruction[];
    vecMap: Map<number, number>;
}

interface EmitterBehavior {
    lifetime: number;
    ignoreLifetime: boolean;
    programs: Program[];
    allFuncs: Uint32Array;
    // the game turns off id=0 emitters when distant or offscreen
    // we mostly don't care, but some effects really shouldn't be on all the time
    shouldClip: boolean;
}

const enum BillboardType {
    NONE,
    FULL,
    Y_ONLY,
}

export interface EmitterSpec {
    pos: vec3;
    euler: vec3;
    scale: vec3;
    delay: number;
    behavior: number;
    maxDist: number;
    width: number;
    height: number;
    id: number;
    g: number;
    billboard: BillboardType;
    eulerOrder: number;
}

interface EmitPattern {
    geoIndex: number;
    indices: Uint16Array;
}

export interface LevelParticles {
    emitters: EmitterSpec[];
    flipbooks: (Flipbook | null)[];
    behaviors: EmitterBehavior[];
    geometry: ParticleGeometryEntry[];
    patterns: EmitPattern[];
    maxBufferSize: number;
    extraFlipbookIndex?: number;
    extraGeometryIndex?: number;
    spriteStartIndex?: number;
    runner?: ParticleRunner;
    magicEntries?: number[];
    magicProgram?: Int16Array;
    waterTextures: number[][];
}

class ScratchBuffer {
    public inUse = false;
    public data: Float32Array;
    public u8View: Uint8Array;

    constructor(size: number) {
        this.data = new Float32Array(size);
        this.u8View = new Uint8Array(this.data.buffer);
    }

    public get(i: number, dst: vec3): vec3 {
        vec3.set(dst, this.data[4*i+0], this.data[4*i+1], this.data[4*i+2]);
        return dst;
    }

    public set(i: number, dst: vec3): void {
        this.data[4*i + 0] = dst[0];
        this.data[4*i + 1] = dst[1];
        this.data[4*i + 2] = dst[2];
    }

    public get4(i: number, dst: vec4): vec4 {
        vec4.set(dst, this.data[4*i+0], this.data[4*i+1], this.data[4*i+2], this.data[4*i+3]);
        return dst;
    }

    public set4(i: number, dst: vec4): void {
        this.data[4*i + 0] = dst[0];
        this.data[4*i + 1] = dst[1];
        this.data[4*i + 2] = dst[2];
        this.data[4*i + 3] = dst[3];
    }
}

export class ParticleData {
    public flipbooks: (FlipbookData | null)[] = [];
    public geos: (GeoParticleInstance | null)[] = [];
    public buffers: ScratchBuffer[] = [];

    public rainRenderer: RainRenderer;
    public electricRenderer: ElectricRenderer;
    public flipbookRenderer: FlipbookRenderer;
    public fullscreen: FullScreenColor;

    public debug = false;

    constructor(public data: LevelParticles, device: GfxDevice, cache: GfxRenderCache, private textureData: TextureData[], bufferManager: BufferPoolManager) {
        this.rainRenderer = new RainRenderer(cache, bufferManager);
        this.electricRenderer = new ElectricRenderer(cache, bufferManager);
        this.flipbookRenderer = new FlipbookRenderer(cache, textureData, bufferManager);
        this.fullscreen = new FullScreenColor(cache);
        for (let f of data.flipbooks) {
            this.flipbooks.push(f ? new FlipbookData(device, cache, f) : null);
        }
        for (let g of data.geometry) {
            if (g.geometry) {
                const data = new LevelModelData(device, cache, g.geometry);
                this.geos.push(new GeoParticleInstance(cache, g, data, textureData));
            } else {
                this.geos.push(null);
            }
        }
    }

    public getWaterTexture(slot: number, frame: number): GfxTexture | null {
        const list = this.data.waterTextures[slot];
        if (list) {
            return this.textureData[list[frame % list.length]].gfxTexture;
        }
        return null;
    }

    public destroy(device: GfxDevice): void {
        this.rainRenderer.destroy(device);
        this.electricRenderer.destroy(device);
        for (let f of this.flipbooks)
            f?.destroy(device);
        for (let g of this.geos)
            g?.data.destroy(device);
    }
}

function getParticle(system: ParticleSystem, emitter: Emitter): Particle {
    if ((window as any).readyready)
        debugger
    let p = system.pool;
    if (p === null) {
        p = new Particle(system.uniqueCount++);
        if (system.uniqueCount % 100 === 0)
            console.log(system.uniqueCount);
    } else
        system.pool = p.next;
    p.reset();
    p.emitter = emitter;
    return p;
}

function returnParticle(p: Particle, system: ParticleSystem): void {
    p.next = system.pool;
    system.pool = p;
}

function getScratch(data: ParticleData): ScratchBuffer {
    let buf: ScratchBuffer | null = null;
    for (let i = 0; i < data.buffers.length; i++) {
        if (!data.buffers[i].inUse) {
            buf = data.buffers[i];
        }
    }
    if (buf === null) {
        buf = new ScratchBuffer(data.data.maxBufferSize);
        data.buffers.push(buf)
    }
    buf.inUse = true;
    return buf;
}

type SimpleConstructor = new (remap: Remapper, offsets: Uint32Array) => Instruction;
type TypedConstructor<T extends InstructionData> = new (data: T[], remap: Remapper, offsets: Uint32Array, program: Program) => Instruction;
type InstructionBuilder = (remap: Remapper, offsets: Uint32Array, program: Program, view: DataView, dataOffs: number, dataSize: number) => Instruction;
type TypedInstructionBuilder<T extends InstructionData> = (data: T[], remap: Remapper, offsets: Uint32Array, program: Program) => Instruction;
type SimpleBuilder = (remap: Remapper, offsets: Uint32Array) => Instruction;
interface InstructionFactoryEntry {
    rawOpcode: number;
    build: InstructionBuilder;
}

function parseData<T extends InstructionData>(view: DataView, dataOffs: number, datumSize: number, parser: DataParser<T>): T[] {
    const data: T[] = [];
    assert(parser.size === datumSize);
    while (view.getUint32(dataOffs, true) !== endTime) {
        data.push(parser.parse(view, dataOffs));
        dataOffs += datumSize;
    }
    if (data.length === 0) {
        // one instance of the only element being at the end time, don't want to bother handling this in general
        const final = parser.parse(view, dataOffs);
        final.t = -1;
        data.push(final);
    }
    return data;
}

function _(rawOpcode: number, constructor: SimpleConstructor): InstructionFactoryEntry;
function _<T extends InstructionData>(rawOpcode: number, constructor: TypedConstructor<T>, parser: DataParser<T>): InstructionFactoryEntry;
function _<T extends InstructionData>(rawOpcode: number, constructor:TypedConstructor<T> | SimpleConstructor, parser?: DataParser<T>): InstructionFactoryEntry {
    function build(remap: Remapper, offsets: Uint32Array, program: Program, view: DataView, dataOffs: number, datumSize: number): Instruction {
        if (parser) {
            const data = parseData(view, dataOffs, datumSize, parser);
            return new (constructor as TypedConstructor<T>)(data, remap, offsets, program);
        }
        return new (constructor as SimpleConstructor)(remap, offsets);
    }
    return {
        rawOpcode,
        build,
    };
}

function Q(rawOpcode: number, build: SimpleBuilder): InstructionFactoryEntry;
function Q<T extends InstructionData>(rawOpcode: number, builder: TypedInstructionBuilder<T>, parser?: DataParser<T>): InstructionFactoryEntry;
function Q<T extends InstructionData>(rawOpcode: number, builder: TypedInstructionBuilder<T> | SimpleBuilder, parser?: DataParser<T>): InstructionFactoryEntry {
    function build(remap: Remapper, offsets: Uint32Array, program: Program, view: DataView, dataOffs: number, datumSize: number): Instruction {
        if (parser) {
            const data = parseData(view, dataOffs, datumSize, parser);
            return (builder as TypedInstructionBuilder<T>)(data, remap, offsets, program);
        }
        return (builder as SimpleBuilder)(remap, offsets);
    }
    return {
        rawOpcode,
        build,
    };
}

const instructionTable: InstructionFactoryEntry[] = [
    _(0x00, Velocity, vecP),
    _(0x01, Velocity, ivecP),
    _(0x02, Velocity, vecP),
    _(0x03, ColorVelocity, hvecP),
    _(0x04, Velocity, vecP),
    _(0x05, Velocity, ivecP),
    _(0x06, Velocity, vecP),
    _(0x07, ColorVelocity, hvecP),
    _(0x08, Step, vecP),
    _(0x09, Step, ivecP),
    _(0x0A, Step, vecP),
    _(0x0B, Step, hvecP),
    _(0x0C, RandomStep, randP),
    _(0x0D, RandomStep, irandP),
    _(0x0E, RandomCube, randP),
    _(0x0F, NOP),
    Q(0x10, PosRotScale.order(EulerOrder.XYZ)),
    _(0x11, PosScale),
    _(0x12, ApplyParent, enabledP),
    _(0x13, ComposedMatrix),
    _(0x14, StandardMatrix),
    _(0x15, SimpleGeo, simpleGeoP),
    _(0x17, UVScrollGeo, uvScrollGeoNoFlagsP),
    _(0x18, SimpleFlipbook, simpleFlipbookP),
    Q(0x19, FlipbookTrail.VarTail, flipbookTrailVarP),
    _(0x1A, FlipbookTrail, flipbookTrailP),
    _(0x1B, PeriodicEmit, emitDataP),
    _(0x1C, ResettingPeriodicEmit, emitDataRawP),
    Q(0x1D, RandomStep.range(RandomRange.POSITIVE), randP),
    Q(0x1E, RandomStep.range(RandomRange.NEGATIVE), randP),
    _(0x1F, PeriodicEmit, emitDataDirP),
    _(0x20, GlareBase, glareBaseP),
    _(0x21, SimpleGlare, simpleGlareP),

    _(0x23, MoreGlare, moreGlareP),
    _(0x24, ScaledGlare, scaledGlareP),
    Q(0x2F, Velocity.reverse, glareVelP),
    Q(0x25, RandomCube.range(RandomRange.NEGATIVE), randP),
    Q(0x27, RandomCube.range(RandomRange.POSITIVE), randP),
    _(0x29, SimpleEmit, simpleEmitP),
    _(0x2C, ComposedMatrix), // writes a copy into the particle
    _(0x2D, CircleBlur, circleBlurP),
    _(0x2E, Pyrefly, pyreflyP),

    _(0x30, AxialBillboardMatrix),
    _(0x31, FlipbookCluster, clusterFlipbookNoMirrorP),
    _(0x32, GeoBlur, geoBlurP),
    _(0x33, WibbleUVScrollGeo, wibbleUVScrollGeoP),
    _(0x34, StandardMatrix), // + copy

    _(0x37, SimpleGeo, simpleGeoFlagsP),
    Q(0x38, PointChain.with(1, 16)),
    _(0x39, SetValue, vecP),
    _(0x3A, SetPos),
    _(0x3B, ElectricTarget, electricTargetP),
    _(0x3C, ElectricColor, electricColorP),
    _(0x3D, Electricity, electricityP),
    _(0x3E, RandomEmit, randomEmitDataNormalizedP),
    _(0x3F, RandomEmit, randomEmitDataP),
    Q(0x41, PointChain.with(1, 32)),
    _(0x43, PeriodicEmit, emitDataAngleP),
    Q(0x44, PointChain.with(1, 40)),
    Q(0x45, PointChain.with(4, 64)),
    _(0x46, DualEmit, dualEmitP),
    _(0x47, UVScrollGeo, uvScrollGeoP),
    Q(0x49, PointChain.with(4, 24)),
    Q(0x4A, PointChain.with(4, 16)),
    Q(0x4B, PointChain.with(16, 64)),
    Q(0x4C, PointChain.with(4, 48)),
    _(0x4D, DepthOffset, depthP),
    _(0x4E, UVScrollGeo, paramUVScrollGeoP),
    _(0x4F, BillboardDepthOffset, depthP),
    _(0x50, SimpleGeo, simpleGeoParamsP),
    _(0x51, SimpleFlipbook, paramFlipbookP),

    Q(0x53, PosRotScale.order(EulerOrder.YZX)),
    _(0x55, RandomStep, hrandP),
    _(0x58, Water, waterP),
    Q(0x5A, PointChain.with(1, 24)),
    Q(0x5B, PointChain.with(1, 8)),
    _(0x5C, AttractingTarget, attractTargetP),
    _(0x5D, Attract, attractP),
    _(0x5E, SimpleGeo, simpleGeoBlendP),
    _(0x61, Rain, rainP),
    _(0x63, FlipbookTrail, flipbookTrailParamsP),
    _(0x64, PointLight, PointLightP),
    Q(0x66, FlipbookCluster.mode(ClusterMode.CAMERA), clusterFlipbookNoMirrorSmallerP), // thunder plains fog, breath bubbles, sphere recordings
    _(0x68, Velocity, ivecP),
    _(0x69, LoopStep, vecP),
    _(0x6A, LoopStep, ivecP),
    _(0x6B, LoopStep, vecP),
    Q(0x6C, PosRotScale.order(EulerOrder.XYZ)),
    _(0x6D, ComposedMatrix),
    _(0x6E, WrapUVScrollGeo, wrapUVScrollGeoNoDepthP),
    _(0x70, WibbleUVScrollGeo, zeroWibbleUVScrollGeoP), // around the camera, sphere recording overlay effect
    Q(0x71, WrapUVScrollGeo.atCamera, wrapUVScrollGeoWaterP),
    _(0x72, ChildSetup, childSetupP),
    Q(0x73, PosRotScale.order(EulerOrder.ZXY)),
    _(0x74, PeriodicSimpleEmit, emitDataRawP),
    _(0x75, ColorVelocity, vecP),
    Q(0x76, PeriodicEmit.atOrigin, emitDataP),
    _(0x77, FlippedFlipbook, flippedFlipbookP),
    _(0x78, WrapUVScrollGeo, wrapUVScrollGeoP),
    Q(0x79, WrapUVScrollGeo.atOrigin, wrapUVScrollGeoP),
    // 7A depth matrix atOrigin
    _(0x7B, FlipbookCluster, clusterFlipbookP),

    Q(0x7F, FlipbookCluster.mode(ClusterMode.CAMERA), clusterFlipbookNoMirrorSmallerP), // some gagazet snow
    Q(0x80, PointChain.with(1, 48)),
    Q(0x83, FlipbookCluster.mode(ClusterMode.FIXED), clusterFlipbookNoVelP),
    Q(0x85, FlipbookCluster.mode(ClusterMode.MOVING), clusterFlipbookNoMirrorP),
    _(0x87, PointLightGroup, PointLightGroupP),
    Q(0x88, PointChain.with(4, 32)),
    _(0x8A, Overlay, overlayP),



    // magic only, made up indices
    Q(0x1001, PointChain.with(1, 128)),
    _(0x1002, FakeGeo),
    Q(0x1008, PointChain.with(1, 64)),
    Q(0x1011, PointChain.with(4, 128)),
];

export interface LevelParticleData {
    emitters: EmitterSpec[];
    behaviors: EmitterBehavior[];
    geometry: ParticleGeometryEntry[];
    flipbooks: (Flipbook | null)[];
}

function vec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
    );
}

function paddedVec4FromView(view: DataView, offset: number, littleEndian: boolean): vec4 {
    return vec4.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
        0,
    );
}

function vec4FromView(view: DataView, offset: number, littleEndian: boolean): vec4 {
    return vec4.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
        view.getFloat32(offset + 0xC, littleEndian),
    );
}

function ivec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getInt32(offset + 0x0, littleEndian),
        view.getInt32(offset + 0x4, littleEndian),
        view.getInt32(offset + 0x8, littleEndian),
    );
}

function ivec4FromView(view: DataView, offset: number, littleEndian: boolean): vec4 {
    return vec4.fromValues(
        view.getInt32(offset + 0x0, littleEndian),
        view.getInt32(offset + 0x4, littleEndian),
        view.getInt32(offset + 0x8, littleEndian),
        view.getInt32(offset + 0xC, littleEndian),
    );
}

function hvec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getInt16(offset + 0x0, littleEndian),
        view.getInt16(offset + 0x2, littleEndian),
        view.getInt16(offset + 0x4, littleEndian),
    );
}

function hvec4FromView(view: DataView, offset: number, littleEndian: boolean): vec4 {
    return vec4.fromValues(
        view.getInt16(offset + 0x0, littleEndian),
        view.getInt16(offset + 0x2, littleEndian),
        view.getInt16(offset + 0x4, littleEndian),
        view.getInt16(offset + 0x6, littleEndian),
    );
}

function colorFromView(view: DataView, offset: number): vec4 {
    return vec4.fromValues(
        view.getUint8(offset + 0x0) / 0xFF,
        view.getUint8(offset + 0x1) / 0xFF,
        view.getUint8(offset + 0x2) / 0xFF,
        view.getUint8(offset + 0x3) / 0x80,
    );
}

const clampBoth: GS.GSRegisterCLAMP = {
    wms: GS.GSWrapMode.CLAMP,
    wmt: GS.GSWrapMode.CLAMP,
    minu: 0,
    maxu: 0,
    minv: 0,
    maxv: 0,
};

function decodeTexture(gsMap: GS.GSMemoryMap, textures: Texture[], tex0: GS.GSRegisterTEX0, prefix="particle"): number {
    const width = 1 << tex0.tw;
    const height = 1 << tex0.th;
    const pixels = new Uint8Array(width * height * 4);

    assert(tex0.cpsm === GS.GSCLUTPixelStorageFormat.PSMCT32);
    if (tex0.psm === GS.GSPixelStorageFormat.PSMT4)
        GS.gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GS.GSPixelStorageFormat.PSMT8)
        GS.gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GS.GSPixelStorageFormat.PSMT8H)
        GS.gsMemoryMapReadImagePSMT8H_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GS.GSPixelStorageFormat.PSMT4HH)
        GS.gsMemoryMapReadImagePSMT4HH_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GS.GSPixelStorageFormat.PSMT4HL)
        GS.gsMemoryMapReadImagePSMT4HL_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GS.GSPixelStorageFormat.PSMCT16)
        GS.gsMemoryMapReadImagePSMCT16(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height);
    else
        return -1;
    // console.log("missing format", hexzero(tex0.psm, 2))

    const newTexture: Texture = {
        tex0,
        clamp: clampBoth,
        pixels,
        name: `${prefix}_${hexzero(tex0.tbp0, 4)}_${hexzero(tex0.cbp, 4)}`,
        width,
        height,
    };
    textures.push(newTexture);
    return textures.length - 1;
}

type textureDecoder = (tex0: GS.GSRegisterTEX0) => number;
const FLIPBOOK_VERTEX_STRIDE = 2 + 4 + 2; // 2 pos, 4 color, 2 uv

const interestingOps = new Map<number, string>([
    [0x19, "var trail"],
    // [ 0x1a, "trail"],
    // [ 0x24, "glare"],
    // [ 0x2D, "blur"],
    // [ 0x32, "blur"],
    // [ 0x37, "simle geo"],
    // [ 0x58, "water"],
    // [ 0x61, "rain"],
    // [ 0x63, "another trail"],
    // [ 0x66, "cam cluster"],
    // [ 0x83, "cam cluster"],
    // [ 0x85, "moving cluster"],
    // [ 0x8A, "overlay"],
])

const unkOps = new Map<number, string>([
    [ 0x20, "lens flare motion"],
    [ 0x21, "lens flare"],
    [ 0x22, "lens flare"],
    [ 0x23, "lens flare"],
    [ 0x24, "bloom/glare"],
    [ 0x2b, "muzzle flash math"], // bevelle wedding
    [ 0x2f, "basic"],
    [ 0x3c, "electric color vel"],
    [ 0x56, "dynamic vertices"], // besaid trials
    [ 0x58, "water???"], // boats
    [ 0x73, "omega ruins"],
    [ 0x73, "heal orb"],
    [ 0x74, "heal orb"],
    [ 0x7a, "translated mtx"], // ruins - stairs
    [ 0x82, "spectral keeper fight"],
    [ 0x8a, "screen overlay"], // lake bottom
    [ 0x8c, "jecht fight"],
    [ 0x8d, "jecht fight"],
    [ 0x8e, "jecht fight"],
])

function ceilLog(n: number): number {
    let i = 1;
    for (; n > (1 << i); i++);
    return i;
}

export function parseFlipbook(buffer: ArrayBufferSlice, flipStart: number, gsMap: GS.GSMemoryMap, textures: Texture[], magic: boolean): Flipbook {
    const findOrDecodeTexture = (tex0: GS.GSRegisterTEX0): number => {
        const textureIndex = textures.findIndex((t) => structsEqual(tex0, t.tex0));
        if (textureIndex !== -1)
            return textureIndex;
        return decodeTexture(gsMap, textures, tex0, magic ? "magic" : "particle");
    };

    const view = buffer.createDataView();

    let flipOffs = flipStart;
    const frameCount = view.getUint16(flipOffs + 0x04, true);
    flipOffs += 0x10;

    // precompute rectangle count
    let totalRects = 0;
    for (let j = 0; j < frameCount; j++, flipOffs += 0x08) {
        const frameOffs = view.getUint16(flipOffs + 0x00, true);
        totalRects += view.getUint16(frameOffs + flipStart + 2, true);
    }
    const indexData = new Uint16Array(totalRects * 6);
    const vertexData = new Float32Array(totalRects * 4 * FLIPBOOK_VERTEX_STRIDE);

    const frames: FlipbookFrame[] = [];
    totalRects = 0;
    flipOffs = flipStart + 0x10;
    let trailCompatible = true;
    for (let j = 0; j < frameCount; j++, flipOffs += 0x08) {
        const frameOffs = view.getUint16(flipOffs + 0x00, true);
        const duration = view.getUint16(flipOffs + 0x02, true);
        const flags = view.getUint8(flipOffs + 0x04);
        const newFrame = parseFlipbookFrame(buffer, frameOffs + flipStart, findOrDecodeTexture, indexData, vertexData, totalRects);
        newFrame.duration = duration;
        newFrame.flags = flags;
        frames.push(newFrame);
        if (newFrame.draws.length !== frames[0].draws.length)
            trailCompatible = false;
        for (let k = 0; k < newFrame.draws.length; k++) {
            const draw = newFrame.draws[k];
            if (trailCompatible) {
                if (draw.blend !== frames[0].draws[k].blend)
                    trailCompatible = false;
                // with multiple draws, all rect counts need to be the same so we can just shift indices
                if (newFrame.draws.length > 1 && draw.rectCount !== frames[0].draws[0].rectCount)
                    trailCompatible = false;
            }
            totalRects += draw.rectCount;
        }
    }

    // specified per frame, but it's always shared
    const textureIndex = frameCount > 0 ? frames[0].textureIndex : -1;
    // magic 241 has two textures
    // for (let f of frames)
    //     assert(f.textureIndex === textureIndex);
    return { frames, indexData, vertexData, textureIndex, trailCompatible };
}

interface WaterDetails {
    geos: number[],
    duration: number,
}

export function parseParticleData(buffer: ArrayBufferSlice, offs: number, gsMap: GS.GSMemoryMap, textures: Texture[], waterTextures: number[][], magic?: MagicLayout): LevelParticles {
    const view = buffer.createDataView();

    const emitterCount = view.getUint16(offs + 0x04, true);
    const behaviorCount = view.getUint16(offs + 0x06, true);
    const geoCount = view.getUint16(offs + 0x08, true);
    const flipbookCount = view.getUint16(offs + 0x0A, true);
    const patternCount = view.getUint16(offs + 0x0C, true);

    const behaviorStartOffs = view.getUint32(offs + 0x10, true) + offs;
    const geometryOffs = view.getUint32(offs + 0x14, true) + offs;
    const flipbookOffs = view.getUint32(offs + 0x18, true) + offs;
    const patternOffs = view.getUint32(offs + 0x1C, true) + offs;

    let runner: ParticleRunner | undefined;

    let pOffs = offs + 0x20;
    let emitters: EmitterSpec[] = [];
    if (!magic) {
        for (let i = 0; i < emitterCount; i++, pOffs += 0x50) {
            emitters.push({
                pos: vec3FromView(view, pOffs + 0x00, true),
                euler: ivec3FromView(view, pOffs + 0x10, true),
                scale: vec3FromView(view, pOffs + 0x20, true),
                delay: view.getInt32(pOffs + 0x30, true),
                behavior: view.getInt32(pOffs + 0x34, true),
                maxDist: view.getFloat32(pOffs + 0x38, true),
                height: view.getFloat32(pOffs + 0x3C, true),
                width: view.getFloat32(pOffs + 0x40, true),
                id: view.getUint16(pOffs + 0x44, true),
                g: view.getUint16(pOffs + 0x46, true),
                billboard: view.getUint8(pOffs + 0x4A),
                eulerOrder: view.getUint8(pOffs + 0x4B),
            });
            vec3.scale(emitters[i].pos, emitters[i].pos, 1);
            vec3.scale(emitters[i].euler, emitters[i].euler, toRad);
        }
        if (behaviorCount > 0)
            assert(pOffs === behaviorStartOffs);
    } else if (magic.special) {
        [emitters, runner] = magic.special(buffer, pOffs);
    } else {
        for (let i = 0; i < behaviorCount; i++) {
            const scale = vec3FromView(view, pOffs + 0x10 * i, true);
            if (vec3.equals(scale, Vec3One) && magic.id >= 0)
                vec3.scale(scale, scale, .05); // all 1 probably means it's set in the magic code
            emitters.push({
                // spread out emitters for debugging
                pos: vec3.create(), //vec3.fromValues((i - (behaviorCount-1)/2)*50, 0, 0),
                euler: vec3.create(),
                scale,
                delay: 0,
                behavior: i,
                maxDist: 0,
                height: 0,
                width: 0,
                id: 0,
                g: 0,
                billboard: 0,
                eulerOrder: 0,
            })
        }
    }

    const findOrDecodeTexture = (tex0: GS.GSRegisterTEX0): number => {
        const textureIndex = textures.findIndex((t) => structsEqual(tex0, t.tex0));
        if (textureIndex !== -1)
            return textureIndex;
        return decodeTexture(gsMap, textures, tex0, magic ? "magic" : "particle");
    };

    const blurGeos = new Set<number>();
    const trailFlips = new Set<number>();
    const waterGeos: WaterDetails[] = [];
    let maxBufferSize = 0;
    const behaviors: EmitterBehavior[] = [];
    for (let i = 0; i < behaviorCount; i++) {
        const behaviorOffs = view.getUint32(behaviorStartOffs + 4 * i, true) + offs;

        const lifetime = view.getUint32(behaviorOffs + 0x00, true) / 0x1000;
        const ignoreLifetime = view.getUint8(behaviorOffs + 0x04) !== 0;
        const funcOffs = view.getUint32(behaviorOffs + 0x08, true) + behaviorOffs;
        const funcCount = view.getUint32(funcOffs, true);
        const allFuncs = new Uint32Array(buffer.arrayBuffer, funcOffs + 4, funcCount);
        const programOffs = view.getUint32(behaviorOffs + 0x0C, true) + behaviorOffs;
        const programCount = view.getUint32(programOffs, true);
        const programStarts = new Uint32Array(buffer.arrayBuffer, programOffs + 4, programCount);
        assert(programStarts[0] === 0x10);

        const programs: Program[] = [];
        const behavior: EmitterBehavior = { allFuncs, programs, lifetime, ignoreLifetime, shouldClip: false };
        behaviors.push(behavior);

        for (let j = 0; j < programCount; j++) {
            let progOffs = behaviorOffs + programStarts[j];
            const nextOffset = view.getUint32(progOffs, true);
            if (j < programCount - 1)
                assert(nextOffset === programStarts[j + 1]);
            const flags = view.getUint32(progOffs + 0x0C, true);
            const start = view.getUint32(progOffs + 0x10, true) >>> 0xC;
            const lifetime = view.getUint32(progOffs + 0x14, true) >>> 0xC;
            const loopStart = view.getInt32(progOffs + 0x18, true) >> 0xC;
            // ugghhhh loopEnd can be negative, leading to the particle staying at t=0
            // hopefully this is rare
            const loopEnd = view.getInt32(progOffs + 0x1C, true) >> 0xC;
            const instrCount = view.getUint16(progOffs + 0x26, true);
            progOffs += 0x28;

            const instructions: Instruction[] = [];
            const vecMap = new Map<number, number>();
            const mapState = new VecMapState(vecMap);
            const newProg: Program = { start, flags, instructions, lifetime, loopLength: Math.abs(loopEnd - loopStart), loopEnd: Math.max(loopStart, loopEnd), vecMap };
            programs.push(newProg);
            // console.log("bhv", i, 'prog', j)
            for (let k = 0; k < instrCount; k++, progOffs += 0x10)
                instructions.push(parseInstruction(buffer, behaviorOffs, progOffs, newProg, mapState, magic?.funcMap));

            // validate
            let scratchCount = 0;
            let renderedSomething = false;
            for (let inst of instructions) {
                const op = inst.opcode;
                if (inst instanceof UnknownInstruction) {
                    console.log(`behavior ${i} program ${j} has unk ${op.toString(16)} ${unkOps.has(op) ? unkOps.get(op) : ""}`)
                }
                if (interestingOps.has(op))
                    console.log(`behavior ${i} program ${j} has op ${op.toString(16)} ${interestingOps.has(op) ? interestingOps.get(op) : ""}`)

                // if (inst instanceof DepthOffset) {
                //     if (vec4.len(inst.data[0].offset) > 0)
                //         console.log(`behavior ${i} program ${j} has depth ${op.toString(16)}`)
                // }
                // if ((inst as any).data) {
                //     const d = (inst as any).data[0];
                //     if (d.fog && d.geoIndex !== undefined)
                //         console.log(`behavior ${i} program ${j} has fog ${op.toString(16)}`)
                // }

                if (inst instanceof Overlay) {
                    for (let d of inst.data) {
                        const tw = ceilLog(d.width);
                        const th = ceilLog(d.height);
                        let tbw = (d.width + 0x3F) >>> 6;
                        if (tbw & 1)
                            tbw += 1;
                        const tex0: GS.GSRegisterTEX0 = {
                            tbp0: d.tbp,
                            tbw,
                            psm: GS.GSPixelStorageFormat.PSMT8,
                            tw,
                            th,
                            tcc: GS.GSTextureColorComponent.RGBA,
                            tfx: GS.GSTextureFunction.MODULATE,
                            cbp: d.cbp,
                            cpsm: GS.GSCLUTPixelStorageFormat.PSMCT32,
                            csm: GS.GSCLUTStorageMode.CSM1,
                            csa: 0,
                            cld: 1,
                        }
                        d.tex = findOrDecodeTexture(tex0);
                    }
                }

                if (inst instanceof GeoBlur)
                    blurGeos.add(inst.data[0].geo);
                if (inst instanceof Pyrefly || inst instanceof FlipbookTrail) {
                    // console.log(`behavior ${i} program ${j} has trail ${inst.data[0].flipbook}`)
                    trailFlips.add(inst.data[0].flipbook);
                }
                if (inst instanceof WibbleUVScrollGeo || (inst instanceof WrapUVScrollGeo && inst.data[0].useWater)) {
                    assert(inst.data.length === 1)
                    const slot = inst.data[0].waterTexSlot;
                    console.log("wibble", i, j, "slot", slot, inst.data[0].waterTexDur, inst.data[0].geoIndex)
                    // assert(wibbleGeos[slot] === undefined);
                    if (inst.data[0].waterTexDur > 0) {
                        if (waterGeos[slot]) {
                            assert(waterGeos[slot].duration === inst.data[0].waterTexDur);
                        } else {
                            waterGeos[slot] = {
                                duration: inst.data[0].waterTexDur,
                                geos: [],
                            }
                        }
                        waterGeos[slot].geos.push(inst.data[0].geoIndex);
                    }
                }
                if (inst instanceof Water) {
                    assert(inst.data.length === 1)
                    const slot = inst.data[0].waterTexSlot;
                    console.log("water wibble", i, j, "slot", slot, inst.data[0].waterTexDur, inst.data[0].geo)
                    if (waterGeos[slot]) {
                        assert(waterGeos[slot].duration === inst.data[0].waterTexDur);
                    } else {
                        waterGeos[slot] = {
                            duration: inst.data[0].waterTexDur,
                            geos: [],
                        }
                    }
                    waterGeos[slot].geos.push(inst.data[0].geo);
                }
                if (inst instanceof ScratchInstruction) {
                    const size = inst.scratchSize();
                    maxBufferSize = Math.max(size, maxBufferSize);
                    inst.scratchIndex = scratchCount++;
                }
                if (inst instanceof FakeGeo) {
                    // ughhhhhh
                    if (magic?.id === 0x54) {
                        inst.index = i === 0 ? 1 : 8;
                    }
                    if (magic?.id === 0x5C) {
                        inst.index = i === 0 ? 2 : 17;
                    }
                }
                renderedSomething ||= inst.renders;
                behavior.shouldClip = behavior.shouldClip || inst.clipEmitter();
            }
            assert(vecMap.size <= PARTICLE_VEC_COUNT);
            if (!renderedSomething)
                console.warn("behavior", i, "program", j, "may be unfinished");
        }
    }

    const flipbooks: Flipbook[] = [];
    for (let i = 0; i < flipbookCount; i++) {
        const flipStart = view.getUint32(flipbookOffs + 4 * i, true) + offs;
        const flip = parseFlipbook(buffer, flipStart, gsMap, textures, !!magic);
        if (trailFlips.has(i))
            assert(flip.trailCompatible);
        flipbooks.push(flip);
    }

    const geometry: ParticleGeometryEntry[] = [];
    let geoStart = geometryOffs;
    for (let i = 0; i < geoCount; i++, geoStart += 0x20) {
        const pointCount = view.getUint32(geoStart + 0x0, true);
        const pointStart = view.getUint32(geoStart + 0x14, true) + offs;
        const start = view.getUint32(geoStart + 0x1C, true) + offs;
        const points: vec3[] = [];
        for (let j = 0; j < pointCount; j++)
            points.push(hvec3FromView(view, pointStart + 6*j, true));
        geometry.push(parseGeometry(view, start, points, blurGeos.has(i), textures, gsMap, !!magic));
        if (blurGeos.has(i)) {
            const g = assertExists(geometry[i].geometry);
            assert(g.drawCalls.length === 1 && g.drawCalls[0].texIndex === -1);
        }
    }

    for (let details of waterGeos) {
        let baseTex = -1;
        for (let idx of details.geos) {
            const geo = assertExists(geometry[idx].geometry);
            assert(geo.drawCalls.length === 1);
            if (baseTex < 0)
                baseTex = geo.drawCalls[0].texIndex;
            else
                assert(baseTex === geo.drawCalls[0].texIndex);
        }
    }

    const patterns: EmitPattern[] = [];
    for (let i = 0; i < patternCount; i++) {
        const geoIndex = view.getUint16(patternOffs + 8*i + 0, true);
        const indexCount = view.getUint16(patternOffs + 8*i + 2, true);
        const indexStart = view.getUint32(patternOffs + 8*i + 4, true) + offs;
        const indices = new Uint16Array(buffer.arrayBuffer, indexStart, indexCount)
        patterns.push({geoIndex, indices});
        const max = geometry[geoIndex].points.length;
        for (let j = 0; j < indexCount; j++)
            if (indices[j] >= max) {
                console.warn("pattern", i, "has index", indices[j], "exceeding point count", max, "from geo", geoIndex)
            }
    }

    // const toSort: number[] = [];
    // for (let i = 0; i < unkCounts.length; i++) {
    //     if (unkCounts[i] > 0)
    //         toSort.push(i);
    // }
    // toSort.sort((a, b) => unkCounts[b] - unkCounts[a]);
    // for (let i = 0; i < 20 && i < toSort.length; i++)
    //     console.log(hexzero(toSort[i], 2), unkCounts[toSort[i]]);

    return { emitters, flipbooks, behaviors, geometry, patterns, maxBufferSize, runner, waterTextures};
}

function structsEqual(a: any, b: any): boolean {
    for (let field in a)
        if ((a as any)[field] !== (b as any)[field])
            return false;
    return true;
}

const FLIPBOOK_SCALE = 16; // account for fixed point format

function parseFlipbookFrame(buffer: ArrayBufferSlice, offs: number, decode: textureDecoder, indices: Uint16Array, vertices: Float32Array, rectIndex: number): FlipbookFrame {
    const view = buffer.createDataView();
    const drawFlags = view.getUint16(offs + 0x00, true);
    const rectCount = view.getUint16(offs + 0x02, true);
    let colorStart = view.getUint32(offs + 0x04, true);
    const tex0 = GS.getGSRegisterTEX0(view.getUint32(offs + 0x10, true), view.getUint32(offs + 0x14, true));

    const textureIndex = decode(tex0);
    const tris = (drawFlags & 8) !== 0;

    const firstIndex = rectIndex * 6;

    const draws: FlipbookDraw[] = [];
    let currDraw: FlipbookDraw | null = null;

    colorStart += offs;
    offs += 0x20;
    for (let i = 0; i < rectCount; i++, colorStart += 0x8, rectIndex++) {
        const currIndex = rectIndex * 6;
        const currOffset = rectIndex * 4 * FLIPBOOK_VERTEX_STRIDE;
        const currVert = 4 * rectIndex;

        indices[currIndex + 0] = currVert + 0;
        indices[currIndex + 1] = currVert + 1;
        indices[currIndex + 2] = currVert + 2;
        indices[currIndex + 3] = currVert + 2;
        indices[currIndex + 4] = currVert + 1;
        indices[currIndex + 5] = currVert + 3;

        if (tris) {
            for (let j = 0; j < 4; j++, offs += 4) {
                vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 0] = view.getInt16(offs + 0, true) / FLIPBOOK_SCALE;
                vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 1] = view.getInt16(offs + 2, true) / FLIPBOOK_SCALE;
            }
        } else {
            const x0 = view.getInt16(offs + 0x00, true) / FLIPBOOK_SCALE;
            const y0 = view.getInt16(offs + 0x02, true) / FLIPBOOK_SCALE;
            const x1 = view.getInt16(offs + 0x04, true) / FLIPBOOK_SCALE;
            const y1 = view.getInt16(offs + 0x06, true) / FLIPBOOK_SCALE;
            offs += 0x08;

            for (let j = 0; j < 4; j++) {
                vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 0] = j % 2 == 0 ? x0 : x1;
                vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 1] = j < 2 ? y0 : y1;
            }
        }

        const uMin = view.getInt16(offs + 0x00, true) / 0x1000;
        const vMin = view.getInt16(offs + 0x02, true) / 0x1000;
        const uRange = view.getInt16(offs + 0x04, true) / 0x1000;
        const vRange = view.getInt16(offs + 0x06, true) / 0x1000;
        offs += 0x08;

        const r = view.getUint8(colorStart + 0) / 0x80;
        const g = view.getUint8(colorStart + 1) / 0x80;
        const b = view.getUint8(colorStart + 2) / 0x80;
        const a = view.getUint8(colorStart + 3) / 0x80;

        // followed by some blend data
        for (let j = 0; j < 4; j++) {
            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 2] = r;
            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 3] = g;
            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 4] = b;
            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 5] = a;

            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 6] = uMin + (j % 2 == 0 ? 0 : uRange);
            vertices[currOffset + FLIPBOOK_VERTEX_STRIDE * j + 7] = vMin + (j < 2 ? 0 : vRange);
        }

        const blend = view.getUint8(colorStart + 4);
        // assert(blend === 0x48 || blend === 0x44 || blend === 0x42 || blend === 0);

        if (currDraw === null || currDraw.blend !== blend) {
            currDraw = {
                rectCount: 1,
                indexStart: firstIndex + 6 * i,
                blend: blend,
            };
            draws.push(currDraw);
        } else {
            currDraw.rectCount++;
        }
    }

    return { flags: 0, drawFlags, textureIndex, duration: 0, draws };
}

const enum GeometryPrimitive {
    COLOR_TRI = 0,
    TEX_TRI = 1,
    COLOR_QUAD = 2,
    TEX_QUAD = 3,
}

interface PrimitiveData {
    indices: number[];
    uvs: vec2[];
    colors: vec4[];
}

export function parseGeometry(view: DataView, start: number, points: vec3[], blur: boolean, textures: Texture[], gsMap: GS.GSMemoryMap, magic: boolean): ParticleGeometryEntry {
    const findOrDecodeTexture = (tex0: GS.GSRegisterTEX0): number => {
        const textureIndex = textures.findIndex((t) => structsEqual(tex0, t.tex0));
        if (textureIndex !== -1)
            return textureIndex;
        return decodeTexture(gsMap, textures, tex0, magic ? "magic" : "particle");
    };
    const flags = view.getUint32(start + 0x00, true);
    const geoOffs = view.getUint32(start + 0x04, true) + start; // color, index, UV
    const pointOffs = view.getUint32(start + 0x08, true) + start;
    const normalOffs = view.getUint32(start + 0x0C, true) + start;
    const vertexCount = view.getUint16(start + 0x12, true);
    const blendSettings = view.getUint16(start + 0x16, true);
    const vtxMin = vec3.fromValues(Infinity, Infinity, Infinity);
    const vtxMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    const entry: ParticleGeometryEntry = { flags, blendSettings, points};
    if (blur)
        entry.lateBindingTex = "prevFrame";

    if (vertexCount === 0 || geoOffs > view.buffer.byteLength || normalOffs > view.buffer.byteLength)
        return entry; // not sure what these are for

    const vertices: vec3[] = [];
    const vtxAverage = vec3.create();
    for (let i = 0; i < vertexCount; i++) {
        const v = hvec3FromView(view, pointOffs + 6*i, true);
        vertices.push(v);
        vec3.min(vtxMin, vtxMin, v);
        vec3.max(vtxMax, vtxMax, v);
        vec3.add(vtxAverage, vtxAverage, v);
    }
    vec3.scale(vtxAverage, vtxAverage, 1/vertexCount);
    const normals: vec3[] = [];
    for (let i = 0; i < vertexCount; i++) {
        if (normalOffs + 6*i +6 >= view.byteLength) {
            normals.push(vec3.clone(Vec3Zero));
            console.warn("went too far on normals")
            continue
        }
        const v = hvec3FromView(view, normalOffs + 6*i, true);
        vec3.scale(v, v, 1 / 0x1000);
        normals.push(v);
    }

    let offs = geoOffs;
    const primitiveMap = new Map<number, PrimitiveData[]>();
    let totalIndexCount = 0, totalVertexCount = 0;

    while (true) {
        const currPrimStart = offs;
        const rawPrimitive = view.getUint8(offs + 0x01);
        if (rawPrimitive === 0xFF)
            break;

        const primitive: GeometryPrimitive = rawPrimitive >>> 1;
        const primitiveCount = view.getUint16(offs + 0x02, true);
        const tex0 = GS.getGSRegisterTEX0(view.getUint32(offs + 0x08, true), view.getUint32(offs + 0x0C, true));

        const vertexPerPrim = primitive <= GeometryPrimitive.TEX_TRI ? 3 : 4;
        let primStride = 0;
        let hasTex = false;
        switch (primitive) {
            case GeometryPrimitive.COLOR_TRI: primStride = 3*4 + 4*2; break;
            case GeometryPrimitive.TEX_TRI: primStride = 3*4 + 4*2 + 3*4; hasTex = true; break;
            case GeometryPrimitive.COLOR_QUAD: primStride = 4*4 + 4*2; break;
            case GeometryPrimitive.TEX_QUAD: primStride = 4*4 + 4*2 + 4*4; hasTex = true; break;
            default: throw `bad primitive ${primitive}`;
        }
        if (rawPrimitive & 1) {
            // TODO: what?
            primStride += 8;
        }
        let texIndex = -1;
        if (hasTex && !blur) {
            if (tex0.cbp > 0)
                texIndex = findOrDecodeTexture(tex0);
            else
                entry.lateBindingTex = prevFrameBinding;
        }
        if (!primitiveMap.has(texIndex))
            primitiveMap.set(texIndex, []);
        const primList = primitiveMap.get(texIndex)!;
        offs += 0x10;

        for (let i = 0; i < primitiveCount; i++, offs += primStride) {
            const indexStart = offs + 4*vertexPerPrim;
            const uvStart = indexStart + 4*2; // always padded for alignment

            const indices: number[] = [];
            const colors: vec4[] = [];
            const uvs: vec2[] = [];
            for (let j = 0; j < vertexPerPrim; j++) {
                const v = view.getUint16(indexStart + 2*j, true);
                // if (v >= vertexCount) {
                //     hexdump(view.buffer, currPrimStart, 0x10 + 2*primStride);
                //     hexdump(view.buffer, offs, primStride)
                // }

                assert(v < vertexCount);
                indices.push(v);
                colors.push(vec4.fromValues(
                    view.getUint8(offs + 4*j + 0) / 0x80,
                    view.getUint8(offs + 4*j + 1) / 0x80,
                    view.getUint8(offs + 4*j + 2) / 0x80,
                    view.getUint8(offs + 4*j + 3) / 0x80,
                ));

                if (hasTex) {
                    uvs.push(vec2.fromValues(
                        view.getUint16(uvStart + 4*j + 0, true) / 0x1000,
                        view.getUint16(uvStart + 4*j + 2, true) / 0x1000,
                    ));
                }


            }
            totalVertexCount += vertexPerPrim;
            totalIndexCount += vertexPerPrim === 3 ? 3 : 6;
            primList.push({ indices, colors, uvs });
        }
    }
    const drawCalls: ParticleDrawCall[] = [];
    const VERTEX_STRIDE = 3 + 4 + 2 + 4;
    const vertexData = new Float32Array(VERTEX_STRIDE * totalVertexCount);
    const indexData = new Uint16Array(totalIndexCount);

    let indexOffs = 0, vtxOffs = 0, vtxIndex = 0;
    for (let [texIndex, list] of primitiveMap.entries()) {
        const startIndex = indexOffs;
        for (let prim of list) {
            indexData[indexOffs++] = vtxIndex;
            indexData[indexOffs++] = vtxIndex + 2;
            indexData[indexOffs++] = vtxIndex + 1;
            if (prim.indices.length === 4) {
                indexData[indexOffs++] = vtxIndex + 1;
                indexData[indexOffs++] = vtxIndex + 2;
                indexData[indexOffs++] = vtxIndex + 3;
            }

            for (let i = 0; i < prim.indices.length; i++, vtxIndex++, vtxOffs += VERTEX_STRIDE) {
                const v = prim.indices[i];
                vertexData[vtxOffs + 0] = vertices[v][0];
                vertexData[vtxOffs + 1] = vertices[v][1];
                vertexData[vtxOffs + 2] = vertices[v][2];

                vertexData[vtxOffs + 3] = prim.colors[i][0];
                vertexData[vtxOffs + 4] = prim.colors[i][1];
                vertexData[vtxOffs + 5] = prim.colors[i][2];
                vertexData[vtxOffs + 6] = prim.colors[i][3];

                if (prim.uvs.length > 0) {
                    vertexData[vtxOffs + 7] = prim.uvs[i][0];
                    vertexData[vtxOffs + 8] = prim.uvs[i][1];
                }

                vertexData[vtxOffs + 9] = normals[v][0];
                vertexData[vtxOffs + 10] = normals[v][1];
                vertexData[vtxOffs + 11] = normals[v][2];
            }
        }
        drawCalls.push({ texIndex, startIndex, indexCount: indexOffs - startIndex });
    }
    entry.geometry = { vertexData, indexData, drawCalls, vtxMin, vtxMax, center: vtxAverage };
    return entry;
}

const unkCounts = nArray(256, () => 0);

const endTime = 0xFFFFF000;

class VecMapState {
    private types = new Map<number, string[]>;
    private size = 0;

    constructor(public map: Map<number, number>) {}

    public remap(offs: number, currTypes = ["v"]): number {
        const next = this.size;
        if (offs >= 0) {
            const val = this.map.get(offs);
            if (val !== undefined) {
                const oldTypes = assertExists(this.types.get(offs));
                // check the type prefix is compatible
                for (let i = 0; i < oldTypes.length && i < currTypes.length; i++)
                    assert(oldTypes[i] === currTypes[i]);
                if (currTypes.length > oldTypes.length) {
                    this.types.set(offs, currTypes);
                    assert(next === val + oldTypes.length);
                    this.size += currTypes.length - oldTypes.length;
                }
                return val;
            }
        } else {
            // reserve arbitrary vecs at unused negative values
            while (this.map.has(offs))
                offs--;
        }
        this.types.set(offs, currTypes);
        this.map.set(offs, next);
        this.size += currTypes.length;
        return next;
    }
}

function parseInstruction(buffer: ArrayBufferSlice, blockStart: number, offs: number, prog: Program, map: VecMapState, opLookup?: number[]): Instruction {
    const view = buffer.createDataView();
    const rawOpcode = view.getUint32(offs + 0x00, true);
    const datumSize = view.getUint16(offs + 0x04, true);
    let dataOffs = view.getUint32(offs + 0x08, true) + blockStart;
    const indexOffs = view.getUint32(offs + 0x0C, true) + blockStart;

    const opcode = opLookup ? assertExists(opLookup[rawOpcode]) : rawOpcode;

    const factory = instructionTable.find((e) => e.rawOpcode === opcode);
    const indices = buffer.createTypedArray(Uint32Array, indexOffs);
    let i: Instruction;
    if (factory === undefined) {
        unkCounts[opcode]++;
        i = new UnknownInstruction(opcode, map.remap(indices[0]), indices[0]);
    } else {
        i = factory.build((offs, types?) => map.remap(offs, types), indices, prog, view, dataOffs, datumSize);
    }
    i.opcode = opcode;
    return i;
}

export const enum BindingFlags {
    NONE = 0,
    ACTOR = 1,
    LAYER = 2,
    MATERIAL = 4,
    PART = 8,
    PARENT_MASK = 0x0F,

    HIDE = 0x10,
    IGNORE_SCALE = 0x20,
    SET_SCALE = 0x40,
    STATIONARY = 0x100,

    POSITION = 0x8000, // actually somewhere else
}

const EMITTER_MAX_TIME = 0x70000;
export const EMITTER_DONE_TIMER = -0x1000;

export const enum EmitterState {
    RUNNING,
    ENDING,
    WAITING,
}

export class Emitter {
    public visible = true;
    public pos = vec3.create();
    public euler = vec3.create();
    public scale = vec3.create();

    public color = vec4.fromValues(1, 1, 1, 1);

    public pose = mat4.create();
    public toView = mat4.create();

    public behavior: EmitterBehavior;

    public particles: (Particle | null)[];
    public waitTimer: number;
    public t = 0;
    public prevT = -1;
    public state = EmitterState.RUNNING;

    public bindingID = -1;
    public bindingFlags: BindingFlags = BindingFlags.NONE;
    public bindingMatrix = mat4.create();
    public bindingSource = -1;

    constructor(public spec: EmitterSpec, particles: LevelParticleData) {
        this.behavior = particles.behaviors[spec.behavior];
        this.particles = nArray(this.behavior.programs.length, () => null);
        this.waitTimer = spec.delay;
        vec3.copy(this.pos, spec.pos);
        vec3.copy(this.euler, spec.euler);
        vec3.copy(this.scale, spec.scale);
    }

    public update(device: GfxDevice, objects: LevelObjectHolder, viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager, system: ParticleSystem): void {
        if (!this.visible)
            return;
        const frameDelta = Math.min(viewerInput.deltaTime * FRAME_RATE / 1000, 1);
        if (this.waitTimer === EMITTER_DONE_TIMER) {
            this.t += frameDelta;
        }
        if (this.waitTimer === EMITTER_DONE_TIMER || this.bindingFlags & BindingFlags.HIDE)
            return;
        this.updateMatrix(objects, viewerInput.camera.viewMatrix);
        if (this.spec.id === 0 && this.behavior.shouldClip && this.spec.maxDist >= 0) {
            transformVec3Mat4w0(instScr3, FFXToNoclip, this.pos);
            // game uses a view-space rectangle instead
            if (!viewerInput.camera.frustum.containsSphere(instScr3, Math.hypot(this.spec.width, this.spec.height)))
                return;
            transformVec3Mat4w1(instScr3, viewerInput.camera.viewMatrix, instScr3);
            if (instScr3[2] < -this.spec.maxDist)
                return;
        }

        if (this.waitTimer >= 0) {
            this.waitTimer -= frameDelta;
            if (this.waitTimer >= 0)
                return;
            // this doesn't seem to matter
            if (this.state === EmitterState.WAITING)
                this.state = EmitterState.ENDING;
            // just (re?)started
            this.t = 0;
            this.prevT = -1;
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p)
                    p.freeChain(system);
                this.particles[i] = null;
            }
        }

        // check if new programs have started
        for (let i = 0; i < this.behavior.programs.length; i++) {
            const prog = this.behavior.programs[i];
            if (this.prevT < prog.start && prog.start <= this.t) {
                this.emit(system, i)
            }
        }
        const hideMask = system.debug ? 0 : 1;

        // update all particles
        for (let i = 0; i < this.behavior.programs.length; i++) {
            const head = this.particles[i];
            if (head === null)
                continue;
            const prog = this.behavior.programs[i];
            const singleFrame = prog.lifetime === 1 && prog.loopEnd > 1;
            for (let j = 0; j < prog.instructions.length; j++) {
                // call all possible functions, most of which will be stubs
                if ((prog.flags & hideMask) === 0)
                    prog.instructions[j].renderAll(head, device, renderInstManager, viewerInput, system.data);
                for (let p: Particle | null = head; p !== null; p = p.next) {
                    // lighting only gets a single update frame in-game, but has "velocity" instructions
                    // which would cause it to change. instead, mimic game behavior by only doing the
                    // initial update for single-frame particles (and hope render() does nothing)
                    if (!singleFrame || p.prevT <= 0)
                        prog.instructions[j].update(p, system);
                    if (p.visible && (prog.flags & hideMask) === 0)
                        prog.instructions[j].render(p, device, renderInstManager, viewerInput, system.data);
                }
            }
            let prev: Particle | null = null;
            let p: Particle | null = head;
            while (p !== null) {
                p.prevT = p.t;
                p.t += frameDelta;
                const nextP: Particle | null = p.next;
                let nextPrev: Particle | null = p;
                if (this.state === EmitterState.RUNNING && p.t >= prog.loopEnd) {
                    p.t -= prog.loopLength;
                    p.prevT -= prog.loopLength;
                    for (let j = 0; j < prog.instructions.length; j++)
                        prog.instructions[j].loop(p);
                } else if (p.t >= prog.lifetime) {
                    if (prev === null)
                        this.particles[i] = p.next;
                    else
                        prev.next = p.next;
                    // delete just this particle
                    p.next = null;
                    p.freeChain(system);
                    nextPrev = prev;
                }
                p = nextP;
                prev = nextPrev;
            }
        }
        this.prevT = this.t;
        this.t += frameDelta;
        let done = false;
        if (this.behavior.ignoreLifetime) {
            if (this.state === EmitterState.RUNNING) {
                if (this.t > EMITTER_MAX_TIME) {
                    this.t = EMITTER_MAX_TIME;
                    this.prevT = this.t - frameDelta;
                }
            } else {
                // done if no particles, or only ones left are marked specially (typically emitters)
                done = true;
                for (let i = 0; i < this.particles.length; i++)
                    if (this.particles[i] !== null && this.behavior.programs[i].lifetime !== EMITTER_MAX_TIME)
                        done = false;
            }
        } else {
            done = this.t >= this.behavior.lifetime;
        }
        if (done)
            this.destroy(system);
    }

    public emit(system: ParticleSystem, index: number): Particle {
        const p = getParticle(system, this);
        p.next = this.particles[index];
        this.particles[index] = p;
        p.created = this.t;
        const prog = this.behavior.programs[index];
        for (let i = 0; i < prog.instructions.length; i++)
            prog.instructions[i].reset(p);
        return p;
    }

    public reset(system: ParticleSystem): void {
        this.destroy(system);
        this.waitTimer = this.spec.delay;
        vec3.copy(this.pos, this.spec.pos);
        vec3.copy(this.euler, this.spec.euler);
        vec3.copy(this.scale, this.spec.scale);
    }

    private destroy(system: ParticleSystem): void {
        this.waitTimer = EMITTER_DONE_TIMER;
        this.t = 0;
        for (let i = 0; i < this.particles.length; i++) {
            this.particles[i]?.freeChain(system);
            this.particles[i] = null;
        }
    }

    private updateMatrix(objects: LevelObjectHolder, viewMtx: mat4): void {
        rotationMatrixFromEuler(this.pose, this.euler, this.spec.eulerOrder);
        mat4.scale(this.pose, this.pose, this.scale);
        if (this.bindingFlags & BindingFlags.PARENT_MASK) {
            mat4.mul(this.pose, this.bindingMatrix, this.pose);
            if (this.bindingFlags & BindingFlags.ACTOR) {
                const a = assertExists(objects.actors[this.bindingID]);
                this.pose[12] += a.modelMatrix[12];
                this.pose[13] += a.modelMatrix[13];
                this.pose[14] += a.modelMatrix[14];
            } else if (this.bindingFlags & BindingFlags.PART) {
                mat4.mul(this.pose, objects.parts[this.bindingID].modelMatrix, this.pose);
            } else if (this.bindingFlags & BindingFlags.LAYER) {
                for (let i = 0; i < objects.parts.length; i++) {
                    if (objects.parts[i].part.layer === this.bindingID) {
                        mat4.mul(this.pose, objects.parts[i].modelMatrix, this.pose);
                        break;
                    }
                }
            }
        } else {
            setMatrixTranslation(this.pose, this.pos);
        }
        switch (this.spec.billboard) {
            case BillboardType.Y_ONLY:
            // TODO
            case BillboardType.FULL:
                // debugger;
                mat4.copy(this.toView, this.pose);
                preserveViewAtPoint(this.toView, viewMtx);
                break;
            case BillboardType.NONE:
                mat4.mul(this.toView, FFXToNoclip, this.pose);
                mat4.mul(this.toView, viewMtx, this.toView);
                break;
        }
    }
}

export type ParticleRunner = (t: number, sys: ParticleSystem, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, device: GfxDevice, objects: LevelObjectHolder) => void;

export class ParticleSystem {
    public loop = false;
    public active = false;
    public debug = false;
    public colorMult = vec3.fromValues(1, 1, 1);
    public emitters: Emitter[] = [];
    public t = 0;
    public uniqueCount = 0;
    public pool: Particle | null = null;

    constructor(public id: number, public data: ParticleData, private runner?: ParticleRunner) {
        let baseCount = 0;
        for (let e of data.data.emitters) {
            this.emitters.push(new Emitter(e, data.data));
            baseCount += data.data.behaviors[e.behavior].programs.length;
        }
        // populate pool
        for (let i = 0; i < baseCount; i++) {
            const p = new Particle(this.uniqueCount++);
            p.next = this.pool;
            this.pool = p;
        }
    }

    public reset(): void {
        for (let i = 0; i < this.emitters.length; i++) {
            this.emitters[i].reset(this);
        }
        this.t = 0;
    }

    public update(device: GfxDevice, objects: LevelObjectHolder, viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager): void {
        if (!this.active)
            return;

        if (this.t >= 0 && this.runner)
            this.runner(this.t, this, viewerInput, renderInstManager, device, objects);

        const wasWaiting = this.t < 0;
        this.t += Math.min(viewerInput.deltaTime * FRAME_RATE / 1000, 1);
        let allDone = true;
        for (let i = 0; i < this.emitters.length; i++) {
            const e = this.emitters[i];
            if (e.waitTimer !== EMITTER_DONE_TIMER && e.visible)
                allDone = false;
            e.update(device, objects, viewerInput, renderInstManager, this);
        }

        if (this.loop && allDone && this.t > 0) {
            if (wasWaiting)
                this.reset();
            else {
                this.t = -10;
                vec3.set(this.colorMult, 1, 1, 1);
            }
        }
    }
}