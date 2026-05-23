
// Skeletal animator for the WoE Granny (.gr2) models.
//
// The parser (granny.ts) gives us a skeleton (bones with a local rest transform,
// a parent index and an inverse-bind matrix) and an animation: per-bone keyframe
// curves for position (xyz), orientation (quaternion) and scale-shear (3x3).
//
// This samples those curves at a clip time, composes per-bone world matrices by
// walking the hierarchy (bone world = parent.world * bone.local), and produces
// the skinning palette the GPU needs: skinMatrix[i] = boneWorld[i] *
// inverseBind[i]. Multiplying a rest-space vertex by that palette (weighted by
// its bone weights) puts it in the animated frame.
//
// Timing is frame-rate INDEPENDENT: the clock is advanced by real elapsed
// seconds, accumulated, looped against the clip duration, and clamped after a
// stall so a long pause can't burst the animation forward.

import { mat4, quat, vec3 } from "gl-matrix";
import { GrannyAnimation, GrannyBone, GrannyCurve, GrannySkeleton, GrannyTransformTrack } from "./granny.js";

// Cap on bones uploaded as skinning matrices. The staged WoE models top out at
// 43 bones; 64 leaves headroom and matches a common skinning-uniform size.
export const GRANNY_MAX_BONES = 64;

// Beyond this real-time gap (seconds) we stop accumulating — a tab-out / hitch
// shouldn't fast-forward the clip by an arbitrary amount.
const MAX_DT = 0.25;

// Samples a curve at time `t` (seconds) into `out` (length = curve.dimension).
// The RO clips store dense keyframes (knot times are the clip's sample grid), so
// a piecewise-linear blend between the two bracketing knots is faithful here —
// the high keyframe density makes higher-order B-spline reconstruction visually
// indistinguishable. A single-knot curve is constant. `slerp` is used for the
// 4-wide orientation curve, plain lerp for the 3-/9-wide ones.
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

    // Locate the segment [k, k+1] containing t (clamp to the ends).
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
    // Linear scan is fine: a frame samples each curve once and n is small (<=~260).
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

// Scratch composing a single bone's local matrix from its sampled (or rest)
// translation / rotation / scale-shear.
const tmpPos = vec3.create();
const tmpRot = quat.create();
const tmpScaleShear = mat4.create();
const tmpLocal = mat4.create();
const posBuf = new Float32Array(3);
const quatBuf = new Float32Array(4);
const ssBuf = new Float32Array(9);

// Builds a bone's local matrix into `out`. Uses the animated curve value when a
// track curve exists, otherwise the bone's rest transform component. The order
// is translation * rotation * scaleShear (Granny composes its transform the same
// way: position, then orientation, then the scale-shear 3x3).
function composeLocal(bone: GrannyBone, track: GrannyTransformTrack | undefined, t: number, out: mat4): void {
    // Translation.
    if (track !== undefined && track.position !== null) {
        sampleCurve(track.position, t, posBuf, false);
        vec3.set(tmpPos, posBuf[0], posBuf[1], posBuf[2]);
    } else {
        vec3.set(tmpPos, bone.translation[0], bone.translation[1], bone.translation[2]);
    }
    // Rotation (quaternion).
    if (track !== undefined && track.orientation !== null) {
        sampleCurve(track.orientation, t, quatBuf, true);
        quat.set(tmpRot, quatBuf[0], quatBuf[1], quatBuf[2], quatBuf[3]);
        quat.normalize(tmpRot, tmpRot);
    } else {
        quat.set(tmpRot, bone.rotation[0], bone.rotation[1], bone.rotation[2], bone.rotation[3]);
    }
    // Scale-shear (row-major 3x3 -> column-major 4x4).
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

// Drives one model's skeleton: holds the clip clock and produces a fresh
// skinning palette each frame. Frame-rate independent (advanced by real dt).
export class GrannyAnimator {
    private clock = 0;
    private boneWorld: mat4[] = [];
    // The inverse-bind (inverse rest-world) per bone. We derive it from the rest
    // pose we compose ourselves rather than the file's stored InverseWorldTransform:
    // most WoE skeletons' stored matrix matches our rest world exactly, but a few
    // (e.g. the treasure box) bake an extra root-frame rotation into the stored
    // matrix that isn't in the local-transform chain. Inverting our own rest world
    // makes rest == identity for every model and keeps animation deltas correct.
    private inverseBind: mat4[] = [];
    public readonly skinMatrices: Float32Array; // GRANNY_MAX_BONES * 16, column-major
    public readonly boneCount: number;
    // The clips this skeleton cycles through (idle, then any action clips). Empty
    // for a static model. Each clip's per-bone track lookup (by name) is in
    // trackForAnim[clipIndex][boneIndex].
    private animations: GrannyAnimation[] = [];
    private trackForAnim: (GrannyTransformTrack | undefined)[][] = [];
    private index = 0; // which clip is playing

    // Accepts the full clip set: the model plays them in order, advancing to the
    // next when one finishes (wrapping), so a viewer sees every animation rather
    // than a single looping idle. A skeleton with no usable clip stays at rest.
    constructor(private skeleton: GrannySkeleton, animations: GrannyAnimation[]) {
        this.animations = animations.filter((a) => a.duration > 0 &&
            a.tracks.some((t) => t.position !== null || t.orientation !== null || t.scaleShear !== null));
        this.boneCount = Math.min(skeleton.bones.length, GRANNY_MAX_BONES);
        this.skinMatrices = new Float32Array(GRANNY_MAX_BONES * 16);
        for (let i = 0; i < GRANNY_MAX_BONES; i++) {
            this.boneWorld.push(mat4.create());
            this.inverseBind.push(mat4.create());
            // Initialise the palette to identity so an un-posed bone is a no-op.
            this.skinMatrices[i * 16 + 0] = 1;
            this.skinMatrices[i * 16 + 5] = 1;
            this.skinMatrices[i * 16 + 10] = 1;
            this.skinMatrices[i * 16 + 15] = 1;
        }
        // Per clip, map each skeleton bone to that clip's track by name (clips are
        // 1:1 with the skeleton, but match defensively so a missing track leaves
        // the bone at rest).
        for (const anim of this.animations) {
            const byName = new Map<string, GrannyTransformTrack>();
            for (const tr of anim.tracks)
                if (tr.boneName !== null)
                    byName.set(tr.boneName, tr);
            this.trackForAnim.push(skeleton.bones.map((b) => b.name !== null ? byName.get(b.name) : undefined));
        }

        // Compute each bone's rest world by walking the hierarchy from rest
        // locals, then invert for the bind matrix.
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

        // Build the initial (rest / time-0) palette so a model is correctly
        // posed before the first update.
        this.pose();
    }

    public hasAnimation(): boolean {
        return this.animations.length > 0;
    }

    // Advances the current clip by real elapsed seconds; when it finishes, moves
    // to the next clip (wrapping) so the model cycles through its whole set.
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

    // Samples every bone at the current clock (in the current clip) and composes
    // the skinning palette.
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
            // skin = boneWorld * inverseBind.
            mat4.multiply(tmpLocal, this.boneWorld[i], this.inverseBind[i]);
            this.skinMatrices.set(tmpLocal, i * 16);
        }
    }
}
