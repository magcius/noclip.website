
// Skeletal animator for Granny (.gr2) models. Samples per-bone keyframe curves,
// composes bone-world matrices through the hierarchy, and produces the skinning
// palette skinMatrix[i] = boneWorld[i] * inverseBind[i].

import { mat4, quat, vec3 } from "gl-matrix";
import { GrannyAnimation, GrannyBone, GrannyCurve, GrannySkeleton, GrannyTransformTrack } from "./granny.js";

// WoE models top out at 43 bones; 64 leaves headroom.
export const GRANNY_MAX_BONES = 64;

// Hitch cap — a long pause shouldn't fast-forward the clip.
const MAX_DT = 0.25;

// RO clips are dense enough that piecewise-linear is visually indistinguishable
// from a true B-spline reconstruction. `slerp` for the orientation curve, lerp
// for the rest.
function sampleCurve(curve: GrannyCurve, t: number, out: Float32Array, slerpQuat: boolean): void {
    const dim = curve.dimension;
    const knots = curve.knots;
    const ctrl = curve.controls;
    const n = knots.length;

    if (n === 0)
        return;
    if (n === 1) {
        for (let i = 0; i < dim; i++)
            out[i] = ctrl[i];
        return;
    }

    if (t <= knots[0]) {
        for (let i = 0; i < dim; i++)
            out[i] = ctrl[i];
        return;
    }
    if (t >= knots[n - 1]) {
        const base = (n - 1) * dim;
        for (let i = 0; i < dim; i++)
            out[i] = ctrl[base + i];
        return;
    }
    let k = 0;
    while (k < n - 1 && knots[k + 1] <= t)
        k++;
    const t0 = knots[k], t1 = knots[k + 1];
    const span = t1 - t0;
    const f = span > 1e-8 ? (t - t0) / span : 0;
    const a = k * dim, b = (k + 1) * dim;

    if (slerpQuat && dim === 4) {
        sampleQuat[0] = ctrl[a]; sampleQuat[1] = ctrl[a + 1]; sampleQuat[2] = ctrl[a + 2]; sampleQuat[3] = ctrl[a + 3];
        sampleQuatB[0] = ctrl[b]; sampleQuatB[1] = ctrl[b + 1]; sampleQuatB[2] = ctrl[b + 2]; sampleQuatB[3] = ctrl[b + 3];
        quat.slerp(sampleQuatOut, sampleQuat, sampleQuatB, f);
        out[0] = sampleQuatOut[0]; out[1] = sampleQuatOut[1]; out[2] = sampleQuatOut[2]; out[3] = sampleQuatOut[3];
    } else {
        for (let i = 0; i < dim; i++)
            out[i] = ctrl[a + i] + (ctrl[b + i] - ctrl[a + i]) * f;
    }
}

const sampleQuat = quat.create();
const sampleQuatB = quat.create();
const sampleQuatOut = quat.create();

const tmpPos = vec3.create();
const tmpRot = quat.create();
const tmpScaleShear = mat4.create();
const tmpLocal = mat4.create();
const posBuf = new Float32Array(3);
const quatBuf = new Float32Array(4);
const ssBuf = new Float32Array(9);

// Composes bone-local as translation * rotation * scaleShear (Granny's order).
function composeLocal(bone: GrannyBone, track: GrannyTransformTrack | undefined, t: number, out: mat4): void {
    if (track !== undefined && track.position !== null) {
        sampleCurve(track.position, t, posBuf, false);
        vec3.set(tmpPos, posBuf[0], posBuf[1], posBuf[2]);
    } else {
        vec3.set(tmpPos, bone.translation[0], bone.translation[1], bone.translation[2]);
    }
    if (track !== undefined && track.orientation !== null) {
        sampleCurve(track.orientation, t, quatBuf, true);
        quat.set(tmpRot, quatBuf[0], quatBuf[1], quatBuf[2], quatBuf[3]);
        quat.normalize(tmpRot, tmpRot);
    } else {
        quat.set(tmpRot, bone.rotation[0], bone.rotation[1], bone.rotation[2], bone.rotation[3]);
    }
    let ss: Float32Array;
    if (track !== undefined && track.scaleShear !== null) {
        sampleCurve(track.scaleShear, t, ssBuf, false);
        ss = ssBuf;
    } else {
        ss = bone.scaleShear;
    }
    mat4.identity(tmpScaleShear);
    // Granny stores the 3x3 row-major; transpose into the column-major mat4.
    tmpScaleShear[0] = ss[0]; tmpScaleShear[4] = ss[1]; tmpScaleShear[8] = ss[2];
    tmpScaleShear[1] = ss[3]; tmpScaleShear[5] = ss[4]; tmpScaleShear[9] = ss[5];
    tmpScaleShear[2] = ss[6]; tmpScaleShear[6] = ss[7]; tmpScaleShear[10] = ss[8];

    mat4.fromRotationTranslation(out, tmpRot, tmpPos);
    mat4.multiply(out, out, tmpScaleShear);
}

export class GrannyAnimator {
    private clock = 0;
    private boneWorld: mat4[] = [];
    // Derived from our own composed rest pose rather than the file's stored
    // InverseWorldTransform: a few models (e.g. treasure box) bake an extra
    // root-frame rotation into the stored matrix that isn't in the local chain.
    private inverseBind: mat4[] = [];
    public readonly skinMatrices: Float32Array; // GRANNY_MAX_BONES * 16, column-major
    public readonly boneCount: number;
    private animations: GrannyAnimation[] = [];
    private trackForAnim: (GrannyTransformTrack | undefined)[][] = [];
    private index = 0;

    constructor(private skeleton: GrannySkeleton, animations: GrannyAnimation[]) {
        this.animations = animations.filter((a) => a.duration > 0 &&
            a.tracks.some((t) => t.position !== null || t.orientation !== null || t.scaleShear !== null));
        this.boneCount = Math.min(skeleton.bones.length, GRANNY_MAX_BONES);
        this.skinMatrices = new Float32Array(GRANNY_MAX_BONES * 16);
        for (let i = 0; i < GRANNY_MAX_BONES; i++) {
            this.boneWorld.push(mat4.create());
            this.inverseBind.push(mat4.create());
            this.skinMatrices[i * 16 + 0] = 1;
            this.skinMatrices[i * 16 + 5] = 1;
            this.skinMatrices[i * 16 + 10] = 1;
            this.skinMatrices[i * 16 + 15] = 1;
        }
        for (const anim of this.animations) {
            const byName = new Map<string, GrannyTransformTrack>();
            for (const tr of anim.tracks)
                if (tr.boneName !== null)
                    byName.set(tr.boneName, tr);
            this.trackForAnim.push(skeleton.bones.map((b) => b.name !== null ? byName.get(b.name) : undefined));
        }

        const bones = skeleton.bones;
        const restWorld: mat4[] = [];
        for (let i = 0; i < this.boneCount; i++) {
            composeLocal(bones[i], undefined, 0, tmpLocal);
            const w = mat4.create();
            const parent = bones[i].parentIndex;
            if (parent >= 0 && parent < i)
                mat4.multiply(w, restWorld[parent], tmpLocal);
            else
                mat4.copy(w, tmpLocal);
            restWorld.push(w);
            if (!mat4.invert(this.inverseBind[i], w)) {
                // Singular rest world: fall back to the file's stored matrix.
                const iw = bones[i].inverseWorld;
                for (let j = 0; j < 16; j++)
                    this.inverseBind[i][j] = iw[j];
            }
        }

        this.pose();
    }

    public hasAnimation(): boolean {
        return this.animations.length > 0;
    }

    public update(dtSeconds: number): void {
        if (this.animations.length === 0)
            return;
        let dt = dtSeconds;
        if (!(dt > 0))
            return;
        if (dt > MAX_DT)
            dt = MAX_DT;
        this.clock += dt;
        // Drain whole clips so a long dt advances past short ones correctly.
        let dur = this.animations[this.index].duration;
        while (this.clock >= dur) {
            this.clock -= dur;
            this.index = (this.index + 1) % this.animations.length;
            dur = this.animations[this.index].duration;
        }
        this.pose();
    }

    private pose(): void {
        const bones = this.skeleton.bones;
        const t = this.clock;
        const tracks = this.animations.length > 0 ? this.trackForAnim[this.index] : null;
        for (let i = 0; i < this.boneCount; i++) {
            const bone = bones[i];
            composeLocal(bone, tracks !== null ? tracks[i] : undefined, t, tmpLocal);
            const parent = bone.parentIndex;
            if (parent >= 0 && parent < i)
                mat4.multiply(this.boneWorld[i], this.boneWorld[parent], tmpLocal);
            else
                mat4.copy(this.boneWorld[i], tmpLocal);
            mat4.multiply(tmpLocal, this.boneWorld[i], this.inverseBind[i]);
            this.skinMatrices.set(tmpLocal, i * 16);
        }
    }
}
