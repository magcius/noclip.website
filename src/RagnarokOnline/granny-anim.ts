import { mat4, quat, vec3 } from "gl-matrix";
import { GrannyAnimation, GrannyBone, GrannyCurve, GrannySkeleton, GrannyTransformTrack } from "./granny.js";

export const GRANNY_MAX_BONES = 64;

const MAX_DT = 0.25;

const segment = { a: 0, b: 0, f: 0 };

function findSegment(curve: GrannyCurve, t: number): typeof segment {
    const knots = curve.knots;
    const n = knots.length;
    const dim = curve.dimension;
    if (n <= 1 || t <= knots[0]) {
        segment.a = segment.b = 0;
        segment.f = 0;
    } else if (t >= knots[n - 1]) {
        segment.a = segment.b = (n - 1) * dim;
        segment.f = 0;
    } else {
        let k = 0;
        while (k < n - 1 && knots[k + 1] <= t)
            k++;
        const t0 = knots[k], t1 = knots[k + 1];
        const span = t1 - t0;
        segment.a = k * dim;
        segment.b = (k + 1) * dim;
        segment.f = span > 1e-8 ? (t - t0) / span : 0;
    }
    return segment;
}

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchQuatA = quat.create();
const scratchQuatB = quat.create();

function sampleVec3(curve: GrannyCurve, t: number, out: vec3): void {
    if (curve.knots.length === 0)
        return;
    const ctrl = curve.controls;
    const { a, b, f } = findSegment(curve, t);
    vec3.set(scratchVec3A, ctrl[a], ctrl[a + 1], ctrl[a + 2]);
    if (a === b) {
        vec3.copy(out, scratchVec3A);
        return;
    }
    vec3.set(scratchVec3B, ctrl[b], ctrl[b + 1], ctrl[b + 2]);
    vec3.lerp(out, scratchVec3A, scratchVec3B, f);
}

function sampleQuat(curve: GrannyCurve, t: number, out: quat): void {
    if (curve.knots.length === 0)
        return;
    const ctrl = curve.controls;
    const { a, b, f } = findSegment(curve, t);
    quat.set(scratchQuatA, ctrl[a], ctrl[a + 1], ctrl[a + 2], ctrl[a + 3]);
    if (a === b) {
        quat.copy(out, scratchQuatA);
        return;
    }
    quat.set(scratchQuatB, ctrl[b], ctrl[b + 1], ctrl[b + 2], ctrl[b + 3]);
    quat.slerp(out, scratchQuatA, scratchQuatB, f);
}

function sampleMat3RowMajor(curve: GrannyCurve, t: number, out: Float32Array): void {
    if (curve.knots.length === 0)
        return;
    const ctrl = curve.controls;
    const { a, b, f } = findSegment(curve, t);
    if (a === b) {
        for (let i = 0; i < 9; i++)
            out[i] = ctrl[a + i];
        return;
    }
    for (let i = 0; i < 9; i++)
        out[i] = ctrl[a + i] + (ctrl[b + i] - ctrl[a + i]) * f;
}

const tmpPos = vec3.create();
const tmpRot = quat.create();
const tmpScaleShear = mat4.create();
const tmpLocal = mat4.create();
const ssBuf = new Float32Array(9);

function composeLocal(bone: GrannyBone, track: GrannyTransformTrack | undefined, t: number, out: mat4): void {
    if (track !== undefined && track.position !== null) {
        sampleVec3(track.position, t, tmpPos);
    } else {
        vec3.set(tmpPos, bone.translation[0], bone.translation[1], bone.translation[2]);
    }
    if (track !== undefined && track.orientation !== null) {
        sampleQuat(track.orientation, t, tmpRot);
        quat.normalize(tmpRot, tmpRot);
    } else {
        quat.set(tmpRot, bone.rotation[0], bone.rotation[1], bone.rotation[2], bone.rotation[3]);
    }
    let ss: Float32Array;
    if (track !== undefined && track.scaleShear !== null) {
        sampleMat3RowMajor(track.scaleShear, t, ssBuf);
        ss = ssBuf;
    } else {
        ss = bone.scaleShear;
    }
    mat4.identity(tmpScaleShear);

    tmpScaleShear[0] = ss[0]; tmpScaleShear[4] = ss[1]; tmpScaleShear[8] = ss[2];
    tmpScaleShear[1] = ss[3]; tmpScaleShear[5] = ss[4]; tmpScaleShear[9] = ss[5];
    tmpScaleShear[2] = ss[6]; tmpScaleShear[6] = ss[7]; tmpScaleShear[10] = ss[8];

    mat4.fromRotationTranslation(out, tmpRot, tmpPos);
    mat4.multiply(out, out, tmpScaleShear);
}

export class GrannyAnimator {
    private clock = 0;
    private boneWorld: mat4[] = [];

    private inverseBind: mat4[] = [];
    public readonly skinMatrices: Float32Array;
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

                const iw = bones[i].inverseBindPose;
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
