import { f, sqrtf } from "./f32.js";
import {
    Mtx3,
    Mtx4,
    Quaternion,
    RIGID_BODY_BOX,
    RIGID_BODY_BOX_1,
    RIGID_BODY_FORCE_BODY,
    RIGID_BODY_FORCE_WORLD,
    RIGID_BODY_NO_ROTATION,
    RigidBody,
    RigidBodyForce,
    RigidBodyState,
    Vec3f,
    vec3,
} from "./types.js";

const BOX_INERTIA_SHARE = f(0.0833333358);
const DEFAULT_STEER_ANGLE = f(0.174);
const AXES = ["x", "y", "z"] as const;

export function StubPhysics1(_data: unknown): void {}

export function StubPhysics2(_data: unknown): void {}

export function QuaternionMultiply(out: Quaternion, a: Quaternion, b: Quaternion): void {
    const bw = b.w, bx = b.x, by = b.y, bz = b.z;
    const aw = a.w, ax = a.x, ay = a.y, az = a.z;
    out.z = f(f(f(f(az * bw) - f(ay * bx)) + f(ax * by)) + f(aw * bz));
    out.y = f(f(f(f(ay * bw) + f(az * bx)) + f(aw * by)) - f(ax * bz));
    out.x = f(f(f(f(ax * bw) + f(aw * bx)) - f(az * by)) + f(ay * bz));
    out.w = f(f(f(f(aw * bw) - f(ax * bx)) - f(ay * by)) - f(az * bz));
}

export function QuaternionNormalize(q: Quaternion): void {
    const inverse = f(1.0 / sqrtf(f(f(q.z * q.z) + f(f(f(q.w * q.w) + f(q.x * q.x)) + f(q.y * q.y)))));
    q.w = f(q.w * inverse);
    q.x = f(q.x * inverse);
    q.y = f(q.y * inverse);
    q.z = f(q.z * inverse);
}

export function Vec3fNormalizeFast(v: Vec3f): void {
    const inverse = f(1.0 / sqrtf(f(f(v.z * v.z) + f(f(v.x * v.x) + f(v.y * v.y)))));
    v.x = f(v.x * inverse);
    v.y = f(v.y * inverse);
    v.z = f(v.z * inverse);
}

export function ComputeDeltaQuaternion(state: RigidBodyState): void {
    const h0 = f(state.angularVelocity.x * 0.5);
    const h1 = f(state.angularVelocity.y * 0.5);
    const h2 = f(state.angularVelocity.z * 0.5);
    const o = state.orientation;
    state.spin.w = f(f(f(-h0 * o.x) - f(h1 * o.y)) - f(o.z * h2));
    state.spin.x = f(f(f(o.w * h0) + f(h1 * o.z)) - f(o.y * h2));
    state.spin.y = f(f(f(o.w * h1) + f(h2 * o.x)) - f(o.z * h0));
    state.spin.z = f(f(f(o.w * h2) + f(h0 * o.y)) - f(o.x * h1));
}

export function ApplyRigidBodyImpulse(state: RigidBodyState, body: RigidBody, dt: number): void {
    const l0 = f(body.force.x * dt);
    const l1 = f(body.force.y * dt);
    const l2 = f(body.force.z * dt);
    const a0 = f(body.torque.x * dt);
    const a1 = f(body.torque.y * dt);
    const a2 = f(body.torque.z * dt);
    state.velocity.x = f(l0 + state.velocity.x);
    state.velocity.y = f(l1 + state.velocity.y);
    state.velocity.z = f(l2 + state.velocity.z);
    state.angularVelocity.x = f(a0 + state.angularVelocity.x);
    state.angularVelocity.y = f(a1 + state.angularVelocity.y);
    state.angularVelocity.z = f(a2 + state.angularVelocity.z);
}

export function QuaternionToMatrix(out: Mtx4, state: RigidBodyState): void {
    const q = state.orientation;
    const ww = f(q.w * q.w);
    const xx = f(q.x * q.x);
    const yy = f(q.y * q.y);
    const zz = f(q.z * q.z);
    const xy2 = f(q.y * f(q.x + q.x));
    const wz2 = f(q.z * f(q.w + q.w));
    const xz2 = f(q.z * f(q.x + q.x));
    const wy2 = f(q.y * f(q.w + q.w));
    const yz2 = f(q.z * f(q.y + q.y));
    const wx2 = f(q.x * f(q.w + q.w));
    out[0][0] = f(f(f(ww + xx) - yy) - zz);
    out[0][1] = f(xy2 + wz2);
    out[0][3] = 0.0;
    out[0][2] = f(xz2 - wy2);
    out[1][0] = f(xy2 - wz2);
    out[1][1] = f(f(f(ww - xx) + yy) - zz);
    out[1][3] = 0.0;
    out[1][2] = f(yz2 + wx2);
    out[2][3] = 0.0;
    out[2][1] = f(yz2 - wx2);
    out[2][0] = f(xz2 + wy2);
    out[2][2] = f(f(f(ww - xx) - yy) + zz);
    out[3][0] = state.position.x;
    out[3][1] = state.position.y;
    out[3][3] = 1.0;
    out[3][2] = state.position.z;
    StubPhysics2(out);
}

export function IntegrateRigidBodyState(out: RigidBodyState, input: RigidBodyState, dt: number): void {
    const m0 = f(input.velocity.x * dt);
    const m1 = f(input.velocity.y * dt);
    const m2 = f(input.velocity.z * dt);
    out.position.x = f(m0 + input.position.x);
    out.position.y = f(m1 + input.position.y);
    out.position.z = f(m2 + input.position.z);
    out.velocity.x = input.velocity.x;
    out.velocity.y = input.velocity.y;
    out.velocity.z = input.velocity.z;
    const t0 = f(input.spin.w * dt);
    const t1 = f(input.spin.x * dt);
    const t2 = f(input.spin.y * dt);
    const t3 = f(input.spin.z * dt);
    out.orientation.w = f(t0 + input.orientation.w);
    out.orientation.x = f(t1 + input.orientation.x);
    out.orientation.y = f(t2 + input.orientation.y);
    out.orientation.z = f(t3 + input.orientation.z);
    QuaternionNormalize(out.orientation);
    out.angularVelocity.x = input.angularVelocity.x;
    out.angularVelocity.y = input.angularVelocity.y;
    out.angularVelocity.z = input.angularVelocity.z;
    out.spin.w = input.spin.w;
    out.spin.x = input.spin.x;
    out.spin.y = input.spin.y;
    out.spin.z = input.spin.z;
}

export function SetRigidBodyForce(force: RigidBodyForce, x: number, y: number, z: number, pointX: number, pointY: number, pointZ: number, frame: number): void {
    force.frame = frame;
    force.vector.x = x;
    force.vector.y = y;
    force.vector.z = z;
    force.point.x = pointX;
    force.point.y = pointY;
    force.point.z = pointZ;
}

function mtxRowsMulVec3f(out: Vec3f, m: number[][], v: Vec3f): void {
    for (let i = 0; i < 3; i++) {
        out[AXES[i]] = 0.0;
        for (let k = 0; k < 3; k++) {
            out[AXES[i]] = f(out[AXES[i]] + f(m[i][k] * v[AXES[k]]));
        }
    }
}

function mtx3x3MulVec3f(out: Vec3f, m: number[][], v: Vec3f): void {
    for (let i = 0; i < 3; i++) {
        out[AXES[i]] = 0.0;
        for (let k = 0; k < 3; k++) {
            out[AXES[i]] = f(out[AXES[i]] + f(m[k][i] * v[AXES[k]]));
        }
    }
}

export function Mtx4fInverseRotate(out: Vec3f, m: Mtx4, v: Vec3f): void {
    mtxRowsMulVec3f(out, m, v);
}

export function Mtx3x3MulVec3f(out: Vec3f, m: Mtx4, v: Vec3f): void {
    mtx3x3MulVec3f(out, m, v);
}

export function Mtx4x4TransformPoint(out: Vec3f, m: Mtx4, v: Vec3f): void {
    mtx3x3MulVec3f(out, m, v);
    out.x = f(out.x + m[3][0]);
    out.y = f(out.y + m[3][1]);
    out.z = f(out.z + m[3][2]);
}

export function Mtx3fMulVec3f(out: Vec3f, m: Mtx3, v: Vec3f): void {
    mtxRowsMulVec3f(out, m, v);
}

export function ComputeRigidBodyAcceleration(body: RigidBody): void {
    body.force.x = f(body.force.x * f(1.0 / body.mass));
    body.force.y = f(body.force.y * f(1.0 / body.mass));
    body.force.z = f(body.force.z * f(1.0 / body.mass));
    if (body.kind === RIGID_BODY_NO_ROTATION) {
        return;
    }
    const local = vec3();
    const angular = vec3();
    Mtx4fInverseRotate(local, body.orientation, body.torque);
    Mtx3fMulVec3f(angular, body.inverseInertia, local);
    Mtx3x3MulVec3f(body.torque, body.orientation, angular);
}

export function ApplySingleForceWithDebug(body: RigidBody, force: RigidBodyForce): void {
    const vector = vec3();
    if (force.frame === RIGID_BODY_FORCE_WORLD) {
        vector.x = force.vector.x;
        vector.y = force.vector.y;
        vector.z = force.vector.z;
    } else if (force.frame === RIGID_BODY_FORCE_BODY) {
        Mtx3x3MulVec3f(vector, body.orientation, force.vector);
    }
    body.force.x = f(vector.x + body.force.x);
    body.force.y = f(vector.y + body.force.y);
    body.force.z = f(vector.z + body.force.z);
    if (body.kind !== RIGID_BODY_NO_ROTATION) {
        const arm = vec3();
        Mtx3x3MulVec3f(arm, body.orientation, force.point);
        const t0 = f(f(arm.y * vector.z) - f(vector.y * arm.z));
        const t1 = f(f(arm.z * vector.x) - f(vector.z * arm.x));
        const t2 = f(f(arm.x * vector.y) - f(vector.x * arm.y));
        body.torque.x = f(t0 + body.torque.x);
        body.torque.y = f(t1 + body.torque.y);
        body.torque.z = f(t2 + body.torque.z);
    }
}

export function ApplyAllForcesToBody(body: RigidBody): void {
    for (let force = body.forces; force !== null; force = force.next) {
        ApplySingleForceWithDebug(body, force);
    }
}

export function InitRigidBody(body: RigidBody): void {
    body.unreconstructed0 = 0;
    for (let i = 0; i < 4; i++) {
        body.wheels[i] = null;
    }
    body.unreconstructed14 = 0;
    body.contactFrames = 0;
    body.ground = null;
    body.spinRate = 0.0;
    body.drive = 0.0;
    body.brake = 0.0;
    body.steerAngle = DEFAULT_STEER_ANGLE;
    body.radius = 0.5;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            body.inertia[i][j] = i === j ? 1.0 : 0.0;
        }
    }
    if (body.kind === RIGID_BODY_BOX || body.kind === RIGID_BODY_BOX_1) {
        const zz = f(body.size.z * body.size.z);
        const yy = f(body.size.y * body.size.y);
        const boxShare = f(BOX_INERTIA_SHARE * body.mass);
        body.inertia[0][0] = f(f(zz + yy) * boxShare);
        const xx = f(body.size.x * body.size.x);
        body.inertia[1][1] = f(f(zz + xx) * boxShare);
        body.inertia[2][2] = f(f(yy + xx) * boxShare);
        StubPhysics1(body.inertia);
    }
    if (body.kind !== RIGID_BODY_NO_ROTATION) {
        body.inverseInertia[0][0] = f(1.0 / body.inertia[0][0]);
        body.inverseInertia[1][1] = f(1.0 / body.inertia[1][1]);
        body.inverseInertia[2][2] = f(1.0 / body.inertia[2][2]);
    }
    body.rollAngle = 0.0;
    body.suspension = 0.0;
}

export function BuildSkewSymmetricMatrix(out: Mtx3, v: Vec3f): void {
    out[2][2] = 0.0;
    out[1][1] = 0.0;
    out[0][0] = 0.0;
    out[0][1] = -v.z;
    out[0][2] = v.y;
    out[1][0] = v.z;
    out[1][2] = -v.x;
    out[2][0] = -v.y;
    out[2][1] = v.x;
}

export function TransposeCopyMatrix3x3(transpose: Mtx3, copy: Mtx3, m: Mtx4): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const value = m[i][j];
            transpose[j][i] = value;
            copy[i][j] = value;
        }
    }
}

export function Transpose4x4Into3x3(out: Mtx3, m: Mtx4): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[j][i] = m[i][j];
        }
    }
}

export function CopyMatrix4x4To3x3(out: Mtx3, m: Mtx4): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[i][j] = m[i][j];
        }
    }
}

export function Mtx3fMultiply(out: Mtx3, a: Mtx3, b: Mtx3): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[i][j] = f(f(f(a[i][0] * b[0][j]) + f(a[i][1] * b[1][j])) + f(a[i][2] * b[2][j]));
        }
    }
}

export function SubtractMatrix3x3(out: Mtx3, a: Mtx3, b: Mtx3): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[i][j] = f(a[i][j] - b[i][j]);
        }
    }
}

export function MtxBuildScaledInverse(m: Mtx4, out: Mtx4, scale: Vec3f): void {
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            out[i][j] = m[j][i];
            out[i][j] = f(out[i][j] * scale[AXES[j]]);
        }
        out[i][3] = 0.0;
    }
    out[3][3] = 1.0;
    const negated = vec3(-m[3][0], -m[3][1], -m[3][2]);
    const translation = vec3();
    Mtx3x3MulVec3f(translation, out, negated);
    out[3][0] = translation.x;
    out[3][1] = translation.y;
    out[3][2] = translation.z;
}

function CramerSum(b0: number, b1: number, b2: number, p0: number, p1: number, p2: number, p3: number, p4: number, p5: number): number {
    return f(f(b2 * p5) + f(f(f(f(f(-b0 * p0) + f(b0 * p1)) + f(b1 * p2)) - f(b1 * p3)) - f(b2 * p4)));
}

export function SolveLinearSystem3x3(out: Vec3f, a: Mtx3, b: Vec3f): void {
    let inverse = CramerSum(a[0][0], a[1][0], a[2][0], f(a[2][2] * a[1][1]), f(a[2][1] * a[1][2]), f(a[2][2] * a[0][1]), f(a[2][1] * a[0][2]), f(a[1][2] * a[0][1]), f(a[1][1] * a[0][2]));
    inverse = f(1.0 / inverse);
    out.x = f(CramerSum(b.x, b.y, b.z, f(a[2][2] * a[1][1]), f(a[2][1] * a[1][2]), f(a[2][2] * a[0][1]), f(a[2][1] * a[0][2]), f(a[1][2] * a[0][1]), f(a[1][1] * a[0][2])) * inverse);
    out.y = f(-CramerSum(b.x, b.y, b.z, f(a[2][2] * a[1][0]), f(a[2][0] * a[1][2]), f(a[2][2] * a[0][0]), f(a[2][0] * a[0][2]), f(a[1][2] * a[0][0]), f(a[1][0] * a[0][2])) * inverse);
    out.z = f(CramerSum(b.x, b.y, b.z, f(a[2][1] * a[1][0]), f(a[2][0] * a[1][1]), f(a[2][1] * a[0][0]), f(a[2][0] * a[0][1]), f(a[1][1] * a[0][0]), f(a[1][0] * a[0][1])) * inverse);
}
