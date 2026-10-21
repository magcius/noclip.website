import { cosf, f, s16, sinf, sqrtf, u16, u32, u8 } from "./f32.js";
import { G, GAME_MODE_DEMO, WEATHER_SNOW } from "./globals.js";
import {
    BuildSkewSymmetricMatrix,
    ComputeDeltaQuaternion,
    CopyMatrix4x4To3x3,
    IntegrateRigidBodyState,
    Mtx3fMulVec3f,
    Mtx3fMultiply,
    Mtx3x3MulVec3f,
    Mtx4fInverseRotate,
    Mtx4x4TransformPoint,
    MtxBuildScaledInverse,
    QuaternionToMatrix,
    SolveLinearSystem3x3,
    SubtractMatrix3x3,
    Transpose4x4Into3x3,
    TransposeCopyMatrix3x3,
    Vec3fNormalizeFast,
} from "./rigidbody.js";
import { LookupTrackGridCell, NextGridCellTriangle, TRACK_SURFACE_SLOW, gridCursor } from "./track.js";
import {
    Mtx3,
    Mtx4,
    RIGID_BODY_FORCE_BODY,
    RIGID_BODY_FORCE_WORLD,
    RIGID_BODY_NO_ROTATION,
    RacerSlot,
    Ref,
    RigidBody,
    RigidBodyForce,
    RigidBodyState,
    TrackTriangle,
    VEHICLE_GHOST,
    VEHICLE_WHEELS,
    Vec3f,
    copyRigidBodyState,
    mtx3,
    mtx4,
    vec3,
} from "./types.js";

export const GRIP_WEATHERS = 3;
export const TRACK_SURFACES = 8;
export const COLLISION_TRIANGLE_NODES = 200;
export const TRI_CACHE_SLOTS = 4;
export const TRI_CACHE_TRIANGLES = 150;

const WHEEL_WEIGHT_SHARE = f(f(9.81) * f(0.3));
const MAX_SPIN_RATE = 300.0;
const SLOW_GRIP_SPEED = 27.0;
const SLIDE_LOAD = 8000.0;
const SLIDING_REAR_SLIDE_LOAD = 5600.0;
const LEAN_STEP = f(0.2666666806);
const MAX_IMPACT_SPEED = 27.0;
const GRIP_WEATHER_DRY = 0;
const COLLISION_STEPS = 4;
const UPRIGHT_FRAMES = 35;
const UPRIGHT_LIMIT = 0.5;

const F_0_1 = f(0.1);
const F_0_2 = f(0.2);
const F_0_9 = f(0.9);
const F_0_002 = f(0.002);
const F_0_0001 = f(0.0001);
const F_1E_05 = f(1e-5);
const F_0_999 = f(0.999);
const F_0_3 = f(0.3);
const F_0_4 = f(0.4);
const F_1_05 = f(1.05);
const F_0_45 = f(0.45);
const F_RAD_TO_DEG = f(57.29577637);
const F_ONE_THIRTIETH = f(1.0 / 30.0);

export interface CollisionTriangleNode {
    triangle: TrackTriangle | null;
    next: CollisionTriangleNode | null;
}

function trackTriangle(): TrackTriangle {
    return { normal: vec3(), planeOffset: 0, vertices: [], index: 0, surface: 0 };
}

export const g_aCollisionTriangleNodes: CollisionTriangleNode[] = Array.from({ length: COLLISION_TRIANGLE_NODES }, () => ({ triangle: null, next: null }));
export let g_pCollisionTriangleList: CollisionTriangleNode | null = null;
export let g_pNextCollisionTriangleNode = -1;
export let g_dwCollisionContactType = 0;
export let g_pCollisionTriangle: TrackTriangle | null = null;

export const g_afSurfaceGrip: number[][] = [
    [0.08, 0.08, 0.08, 0.085, 0.08, 0.08, 0.08, 0.08].map(f),
    [0.08, 0.08, 0.07, 0.075, 0.08, 0.08, 0.08, 0.08].map(f),
    [0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06].map(f),
];
export const g_afSurfaceMaxLoad: number[][] = [
    [90000, 90000, 90000, 80000, 90000, 90000, 90000, 90000],
    [90000, 90000, 90000, 90000, 90000, 90000, 90000, 90000],
    [120000, 120000, 120000, 120000, 120000, 120000, 120000, 120000],
];
export const g_afSurfaceSlipLoad: number[][] = [
    [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
    [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
    [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
];

export const g_vecUnitX: Vec3f = vec3(1, 0, 0);
export const g_vecUnitY: Vec3f = vec3(0, 1, 0);
export const g_vecUnitZ: Vec3f = vec3(0, 0, 1);
export const g_vecNegUnitZ: Vec3f = vec3(0, 0, -1);
export const g_vVehicleObbHalfExtents: Vec3f = vec3(2.5, 1, 1);
export const g_vCollisionContact: Vec3f = vec3();
export let g_fCollisionContactW = 0;
export const g_vCollisionPenetration: Vec3f = vec3();

export const g_aTriCacheTriangles: TrackTriangle[][] = Array.from({ length: TRI_CACHE_SLOTS }, () => Array.from({ length: TRI_CACHE_TRIANGLES }, trackTriangle));
export const g_awTriCacheSectorId: number[] = [0, 0, 0, 0];
export const g_awTriCacheTriCount: number[] = [0, 0, 0, 0];
export const g_adwTriCacheLruStamp: number[] = [0, 0, 0, 0];
export let g_dwTriCacheLruCounter = 0;

function Abs(x: number): number {
    return x < 0.0 ? -x : x;
}

function Sign(x: number): number {
    return x === 0.0 ? 0.0 : 0.0 < x ? 1.0 : -1.0;
}

function Component(v: Vec3f, axis: number): number {
    return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
}

function ImpactVolume(speed: number): number {
    return u8(u32(f(f(f(speed * 127.0) / MAX_IMPACT_SPEED) + 128.0)));
}

function Dot(a: Vec3f, b: Vec3f): number {
    return f(f(b.z * a.z) + f(f(a.x * b.x) + f(a.y * b.y)));
}

function BodySpeed(body: RigidBody): number {
    const v = body.state.velocity;
    return sqrtf(f(f(v.z * v.z) + f(f(v.x * v.x) + f(v.y * v.y))));
}

function CrossInto(out: Vec3f, a: Vec3f, b: Vec3f): void {
    out.x = f(f(a.y * b.z) - f(b.y * a.z));
    out.y = f(f(a.z * b.x) - f(b.z * a.x));
    out.z = f(f(a.x * b.y) - f(b.x * a.y));
}

function AddInto(out: Vec3f, a: Vec3f): void {
    out.x = f(a.x + out.x);
    out.y = f(a.y + out.y);
    out.z = f(a.z + out.z);
}

export function ResetCollisionCaches(): void {
    for (let slot = 0; slot < TRI_CACHE_SLOTS; slot++) {
        g_awTriCacheSectorId[slot] = 0;
        g_adwTriCacheLruStamp[slot] = 0;
        g_awTriCacheTriCount[slot] = 0;
        for (let i = 0; i < TRI_CACHE_TRIANGLES; i++) {
            const triangle = g_aTriCacheTriangles[slot][i];
            triangle.normal.x = 0.0;
            triangle.normal.y = 0.0;
            triangle.normal.z = 0.0;
            triangle.planeOffset = 0.0;
            triangle.vertices = [];
        }
    }
    for (let slot = 0; slot < COLLISION_TRIANGLE_NODES; slot++) {
        g_aCollisionTriangleNodes[slot].triangle = null;
        g_aCollisionTriangleNodes[slot].next = null;
    }
    g_pCollisionTriangleList = null;
    g_pNextCollisionTriangleNode = -1;
    g_dwTriCacheLruCounter = 0;
}

export function SumBodyForces(body: RigidBody): void {
    const vector = vec3();
    const arm = vec3();
    const torque = vec3();
    for (let force = body.forces; force !== null; force = force.next) {
        switch (force.frame) {
            case RIGID_BODY_FORCE_WORLD:
                vector.x = force.vector.x;
                vector.y = force.vector.y;
                vector.z = force.vector.z;
                break;
            case RIGID_BODY_FORCE_BODY:
                Mtx3x3MulVec3f(vector, body.orientation, force.vector);
                break;
        }
        AddInto(body.force, vector);
        if (body.kind !== RIGID_BODY_NO_ROTATION) {
            Mtx3x3MulVec3f(arm, body.orientation, force.point);
            CrossInto(torque, arm, vector);
            AddInto(body.torque, torque);
        }
    }
}

export function SumWheelForces(body: RigidBody, wheel: RigidBody): void {
    const along = vec3();
    const flat = vec3();
    const local = vec3();
    const position = vec3();
    const arm = vec3();
    const torque = vec3();
    for (let force = wheel.forces; force !== null; force = force.next) {
        if (force.frame === RIGID_BODY_FORCE_WORLD) {
            Mtx4fInverseRotate(local, body.orientation, force.vector);
        }
        if (force.frame === RIGID_BODY_FORCE_BODY) {
            local.x = force.vector.x;
            local.y = force.vector.y;
            local.z = force.vector.z;
        }
        flat.x = local.x;
        flat.y = local.y;
        flat.z = 0.0;
        Mtx3x3MulVec3f(along, body.orientation, flat);
        AddInto(wheel.force, local);
        if (wheel.contactFrames) {
            position.x = wheel.orientation[3][0];
            position.y = wheel.orientation[3][1];
            position.z = wheel.orientation[3][2];
            Mtx3x3MulVec3f(arm, body.orientation, position);
            CrossInto(torque, arm, along);
            AddInto(body.torque, torque);
        }
    }
}

export function ComputeVehicleAccelerations(body: RigidBody): void {
    const local = vec3();
    const acceleration = vec3();
    const angular = vec3();
    const spin = vec3();
    const w = body.wheels as RigidBody[];
    Mtx4fInverseRotate(local, body.orientation, body.force);
    body.force.x = local.x;
    body.force.y = local.y;
    body.force.z = local.z;
    acceleration.x = f(f(f(f(f(body.force.x + w[0].force.x) + w[1].force.x) + w[2].force.x) + w[3].force.x) / body.mass);
    acceleration.y = f(f(f(f(f(body.force.y + w[0].force.y) + w[1].force.y) + w[2].force.y) + w[3].force.y) / body.mass);
    acceleration.z = f(body.force.z / body.mass);
    Mtx3x3MulVec3f(body.force, body.orientation, acceleration);
    Mtx4fInverseRotate(angular, body.orientation, body.torque);
    Mtx3fMulVec3f(spin, body.inverseInertia, angular);
    Mtx3x3MulVec3f(body.torque, body.orientation, spin);
}

export function ComputeVehicleForces(body: RigidBody): void {
    const w = body.wheels as RigidBody[];
    body.force.z = 0.0;
    body.force.y = 0.0;
    body.force.x = 0.0;
    body.torque.z = 0.0;
    body.torque.y = 0.0;
    body.torque.x = 0.0;
    for (let i = 0; i < 4; i++) {
        w[i].force.x = 0.0;
        w[i].force.y = 0.0;
        w[i].force.z = 0.0;
    }
    SumBodyForces(body);
    SumWheelForces(body, w[0]);
    SumWheelForces(body, w[1]);
    SumWheelForces(body, w[2]);
    SumWheelForces(body, w[3]);
    ComputeVehicleAccelerations(body);
}

function SpinVelocity(turn: Vec3f, body: RigidBody, arm: Vec3f): void {
    const av = body.state.angularVelocity;
    turn.x = f(f(av.y * arm.z) - f(arm.y * av.z));
    turn.y = f(f(av.z * arm.x) - f(arm.z * av.x));
    turn.z = f(f(av.x * arm.y) - f(arm.x * av.y));
}

function CopyBodyVelocity(out: Vec3f, body: RigidBody): void {
    out.x = body.state.velocity.x;
    out.y = body.state.velocity.y;
    out.z = body.state.velocity.z;
}

export function ComputeWheelLocalVelocity(out: Vec3f, body: RigidBody, wheel: RigidBody): void {
    const point = vec3();
    const turn = vec3();
    const arm = vec3();
    point.x = wheel.state.position.x;
    point.y = wheel.state.position.y;
    point.z = 0.0;
    Mtx3x3MulVec3f(arm, body.orientation, point);
    CopyBodyVelocity(out, body);
    SpinVelocity(turn, body, arm);
    point.x = f(turn.x + out.x);
    point.y = f(turn.y + out.y);
    point.z = f(turn.z + out.z);
    Mtx4fInverseRotate(out, body.orientation, point);
}

export function GetWheelWorldVelocity(out: Vec3f, body: RigidBody, wheel: RigidBody): void {
    const point = vec3();
    const turn = vec3();
    const arm = vec3();
    point.x = wheel.state.position.x;
    point.y = wheel.state.position.y;
    point.z = wheel.state.position.z;
    Mtx3x3MulVec3f(arm, body.orientation, point);
    CopyBodyVelocity(out, body);
    SpinVelocity(turn, body, arm);
    AddInto(out, turn);
}

export function GetBodyPointVelocity(out: Vec3f, body: RigidBody, point: Vec3f): void {
    const copy = vec3(point.x, point.y, point.z);
    const turn = vec3();
    const arm = vec3();
    Mtx3x3MulVec3f(arm, body.orientation, copy);
    CopyBodyVelocity(out, body);
    SpinVelocity(turn, body, arm);
    AddInto(out, turn);
}

function BrakeSlowing(wheel: RigidBody): number {
    return f(f(Sign(wheel.spinRate) * -Abs(wheel.brake) * 2.0) / wheel.radius);
}

function SlideShare(body: RigidBody, grip: number, weather: number, surface: number, load: number): number {
    let clamped = load;
    if (g_afSurfaceMaxLoad[weather][surface] < load) {
        clamped = g_afSurfaceMaxLoad[weather][surface];
    }
    if (clamped < g_afSurfaceSlipLoad[weather][surface]) {
        clamped = g_afSurfaceSlipLoad[weather][surface];
    }
    let keep = f(f(f(g_afSurfaceSlipLoad[weather][surface] / clamped) * 20.0) * grip);
    if ((body.wheels[2] as RigidBody).steerAngle === 0.0) {
        keep = f(keep * 1.5);
    }
    if (Abs(keep) > 1.0) {
        keep = 1.0;
    }
    return keep;
}

export function ApplySideGrip(body: RigidBody, dt: number, rearLoad: Ref<number>, frontLoad: Ref<number>, rearSliding: Ref<number>, frontSliding: Ref<number>): void {
    const w = body.wheels as RigidBody[];
    const point = vec3();
    const velocity = vec3();
    const rear = vec3();
    const front = vec3();
    const old = vec3();
    const lateral = vec3();
    const local = vec3();
    let skid = 0.0;
    let both = 0;
    let load: number;
    let limit: number;
    let grip: number;
    let keep: number;
    let lateralSpeed: number;
    let speed: number;
    let slowGrip: number;

    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        if (!w[i].ground) {
            w[i].contactFrames = 0;
        }
    }

    let frontBrake = BrakeSlowing(w[2]);
    let rearBrake = BrakeSlowing(w[0]);
    const quarter = f(body.mass / 4.0);
    const dt2 = f(dt * dt);
    frontBrake = f(frontBrake / quarter);
    rearBrake = f(rearBrake / quarter);
    frontBrake = f(frontBrake * dt2);
    rearBrake = f(rearBrake * dt2);
    if (Abs(frontBrake) > 1.0) {
        frontBrake = f(Sign(frontBrake) * 1.5);
    }
    if (Abs(rearBrake) > 1.0) {
        rearBrake = f(Sign(rearBrake) * 1.5);
    }

    point.x = w[0].state.position.x;
    point.y = 0.0;
    point.z = 0.0;
    GetBodyPointVelocity(velocity, body, point);
    Mtx4fInverseRotate(rear, body.orientation, velocity);

    let weather = s16(G.g_dwCurrentWeather - 1);
    const rearSurfaceA = w[0].surface;
    const rearSurfaceB = w[1].surface;
    const frontSurfaceA = w[2].surface;
    const frontSurfaceB = w[3].surface;
    if (weather >= GRIP_WEATHERS || weather < 0) {
        weather = GRIP_WEATHER_DRY;
    }
    body.skidding = 0;

    if ((w[0].contactFrames || w[1].contactFrames) && (w[2].contactFrames || w[3].contactFrames)) {
        const rearSurface = (rearSurfaceA + rearSurfaceB + 1) >> 1;
        load = f(Abs(rearLoad.value) + f(f(Abs(rear.y) * body.mass) / dt));
        both = 1;
        limit = SLIDE_LOAD;
        if (Abs(frontBrake) > 0.0001) {
            load = f(load + f(10000.0 * (Abs(rearBrake) > 0.0001 ? 1 : 0)));
        } else {
            load = f(load + f(100000.0 * (Abs(rearBrake) > 0.0001 ? 1 : 0)));
        }
        if (rearSliding.value) {
            limit = SLIDING_REAR_SLIDE_LOAD;
        }
        rearSliding.value = 0;
        grip = f(g_afSurfaceGrip[weather][rearSurface] - 0.002 * (body.tireType - 1));
        keep = SlideShare(body, grip, weather, rearSurface, load);
        if (load < limit) {
            skid = 0.0;
            lateralSpeed = 0.0;
        } else {
            speed = BodySpeed(body);
            if (speed < SLOW_GRIP_SPEED) {
                slowGrip = f(f(f(SLOW_GRIP_SPEED - speed) * F_0_1) / SLOW_GRIP_SPEED);
                if (keep < slowGrip) {
                    keep = slowGrip;
                }
            }
            rear.y = f(rear.y - f(rear.y * keep));
            skid = f(rear.y * keep);
            rearSliding.value = 1;
            lateralSpeed = rear.y;
        }
        if (Abs(rear.x) > 1.0) {
            rear.y = lateralSpeed;
            if (Abs(f(lateralSpeed / rear.x)) > 0.25) {
                body.skidding = 0x80;
            }
        } else {
            rear.y = lateralSpeed;
            if (Abs(lateralSpeed) > 1.0) {
                body.skidding = 0x80;
            } else {
                body.skidding = 0;
            }
        }
        const slowed = rear.x;
        rear.x = f(rear.x - rearBrake);
        if (Abs(rear.x) > F_1E_05 && Sign(rear.x) !== Sign(slowed)) {
            rear.x = 0.0;
        }
    } else {
        rearSliding.value = 0;
    }

    point.x = w[2].state.position.x;
    GetBodyPointVelocity(velocity, body, point);
    Mtx4fInverseRotate(front, body.orientation, velocity);

    if ((w[2].contactFrames || w[3].contactFrames) && (w[0].contactFrames || w[1].contactFrames)) {
        both = 1;
        point.x = cosf(w[2].steerAngle);
        point.y = sinf(w[2].steerAngle);
        point.z = 0.0;
        old.x = front.x;
        old.y = front.y;
        old.z = front.z;
        const d = f(f(old.z * point.z) + f(f(point.x * old.x) + f(point.y * old.y)));
        front.x = f(point.x * d);
        front.y = f(point.y * d);
        front.z = f(point.z * d);
        lateral.x = f(old.x - front.x);
        lateral.y = f(old.y - front.y);
        lateral.z = f(old.z - front.z);
        lateralSpeed = sqrtf(f(f(lateral.z * lateral.z) + f(f(lateral.x * lateral.x) + f(lateral.y * lateral.y))));
        load = f(Abs(frontLoad.value) + f(f(lateralSpeed * body.mass) / dt));
        limit = SLIDE_LOAD;
        load = f(load + f(10000.0 * (Abs(frontBrake) > 0.0001 ? 1 : 0)));
        if (frontSliding.value) {
            limit = f(SLIDE_LOAD * 0.7);
        }
        frontSliding.value = 0;
        if (limit < load) {
            const frontSurface = (frontSurfaceA + frontSurfaceB + 1) >> 1;
            grip = f(g_afSurfaceGrip[weather][frontSurface] - f(F_0_002 * f(body.tireType - 1)));
            keep = SlideShare(body, grip, weather, frontSurface, load);
            speed = BodySpeed(body);
            if (speed < SLOW_GRIP_SPEED) {
                slowGrip = f(f(f(SLOW_GRIP_SPEED - speed) * F_0_1) / SLOW_GRIP_SPEED);
                if (keep < slowGrip) {
                    keep = slowGrip;
                }
            }
            lateral.x = f(lateral.x * keep);
            lateral.y = f(lateral.y * keep);
            lateral.z = f(lateral.z * keep);
            front.x = f(old.x - lateral.x);
            front.y = f(old.y - lateral.y);
            front.z = f(old.z - lateral.z);
            frontSliding.value = 1;
        }
    }

    if (both) {
        const forward = f(f(rear.x + front.x) / 2.0);
        const yaw = f(f(rear.y - front.y) / f(w[0].state.position.x - w[2].state.position.x));
        const side = f(rear.y - f(yaw * w[0].state.position.x));
        Mtx4fInverseRotate(local, body.orientation, body.state.angularVelocity);
        local.z = yaw;
        Mtx3x3MulVec3f(body.state.angularVelocity, body.orientation, local);
        Mtx4fInverseRotate(local, body.orientation, body.state.velocity);
        local.x = forward;
        local.y = side;
        Mtx3x3MulVec3f(body.state.velocity, body.orientation, local);
    }

    if (Abs(skid) > 0.5) {
        skid = f(Sign(skid) * 0.5);
    }
    const target = f(f(skid / 0.5) * -4.0);
    const lean = body.rollAngle;
    if (Abs(f(lean - target)) < LEAN_STEP) {
        body.rollAngle = target;
    } else if (lean < target) {
        body.rollAngle = f(lean + LEAN_STEP);
    } else {
        body.rollAngle = f(lean - LEAN_STEP);
    }
}

export function DriveWheel(body: RigidBody, wheel: RigidBody, load: Ref<number>, sliding: Ref<number>, dt: number): void {
    const w = body.wheels as RigidBody[];
    const unitY = vec3(g_vecUnitY.x, g_vecUnitY.y, g_vecUnitY.z);
    const axle = vec3();
    const forward = vec3();
    const side = vec3();
    const roll = vec3();
    const slide = vec3();
    const velocity = vec3();
    const weight = vec3();
    const push = vec3();
    const local = vec3();
    const normal = wheel.groundNormal;

    if (!wheel.ground) {
        return;
    }
    if (normal.z < 0.7) {
        return;
    }
    Mtx3x3MulVec3f(axle, body.orientation, unitY);
    CrossInto(forward, axle, normal);
    CrossInto(side, normal, forward);
    const c = cosf(wheel.steerAngle);
    const s = sinf(wheel.steerAngle);
    roll.x = f(forward.x * c);
    roll.y = f(forward.y * c);
    roll.z = f(forward.z * c);
    slide.x = f(forward.x * -s);
    slide.y = f(forward.y * -s);
    slide.z = f(forward.z * -s);
    forward.x = f(side.x * s);
    forward.y = f(side.y * s);
    forward.z = f(side.z * s);
    AddInto(roll, forward);
    forward.x = f(side.x * c);
    forward.y = f(side.y * c);
    forward.z = f(side.z * c);
    AddInto(slide, forward);

    if (w[0].contactFrames && w[2].contactFrames && w[1].contactFrames && w[3].contactFrames) {
        GetWheelWorldVelocity(velocity, body, wheel);
        const rollSpeed = f(f(roll.z * velocity.z) + f(f(velocity.x * roll.x) + f(velocity.y * roll.y)));
        weight.x = 0.0;
        weight.y = 0.0;
        weight.z = f(f(f(body.mass + f(4.0 * wheel.mass)) * WHEEL_WEIGHT_SHARE) + f(f(wheel.state.position.z - -0.97) * 0.0));
        const pressure = f(f(normal.z * weight.z) + f(f(weight.x * normal.x) + f(weight.y * normal.y)));
        const drive = wheel.drive;
        let force = f(drive / wheel.radius);
        const grip = f(pressure * 3.0);
        load.value = f(load.value + f(force / 2.0));
        if (sliding.value) {
            force = f(force * 0.9);
        }
        if (Abs(grip) < Abs(force)) {
            const ratio = f(grip / force);
            force = f(force * (Abs(ratio) * 0.1));
        }
        push.x = f(roll.x * -force);
        push.y = f(roll.y * -force);
        push.z = f(roll.z * -force);
        Mtx4fInverseRotate(local, body.orientation, push);
        const vector = (wheel.forces as RigidBodyForce).vector;
        AddInto(vector, local);
        wheel.spinRate = f(wheel.spinRate + f(f(drive - f(wheel.radius * force)) * dt));
        wheel.spinRate = f(wheel.spinRate - f(f(wheel.spinRate * wheel.radius) + rollSpeed) * 0.4);
        if (Abs(wheel.spinRate) > MAX_SPIN_RATE) {
            wheel.spinRate = f(Sign(wheel.spinRate) * 300.0);
        }
    } else {
        wheel.spinRate = f(wheel.spinRate + f(wheel.drive * dt));
        if (Abs(wheel.spinRate) > MAX_SPIN_RATE) {
            wheel.spinRate = f(Sign(wheel.spinRate) * 300.0);
        }
    }

    wheel.rollAngle = f(wheel.rollAngle - f(f(wheel.spinRate * F_RAD_TO_DEG) * dt));
    while (wheel.rollAngle > 360.0) {
        wheel.rollAngle = f(wheel.rollAngle - 360.0);
    }
    while (wheel.rollAngle < 0.0) {
        wheel.rollAngle = f(wheel.rollAngle + 360.0);
    }
}

export function IsPointInTrackTriangle(triangle: TrackTriangle, point: Vec3f): number {
    let axis: number;
    let inside = 0;
    const n = triangle.normal;
    if (Abs(n.y) < Abs(n.x)) {
        axis = Abs(n.z) < Abs(n.x) ? 0 : 2;
    } else {
        axis = Abs(n.z) < Abs(n.y) ? 1 : 2;
    }
    const i1 = (axis + 1) % 3;
    const i2 = (axis + 2) % 3;
    const u0 = Component(triangle.vertices[0], i1);
    const v0 = Component(triangle.vertices[0], i2);
    const pu = f(Component(point, i1) - u0);
    const pv = f(Component(point, i2) - v0);
    const au = f(Component(triangle.vertices[1], i1) - u0);
    const av = f(Component(triangle.vertices[1], i2) - v0);
    const bu = f(Component(triangle.vertices[2], i1) - u0);
    const bv = f(Component(triangle.vertices[2], i2) - v0);
    if (au === 0.0) {
        const beta = f(pu / bu);
        if (0.0 <= beta && beta <= 1.0) {
            const alpha = f(f(pv - f(beta * bv)) / av);
            inside = 0.0 <= alpha && f(alpha + beta) <= 1.0 ? 1 : 0;
        }
    } else {
        const beta = f(f(f(pv * au) - f(pu * av)) / f(f(bv * au) - f(bu * av)));
        if (0.0 <= beta && beta <= 1.0) {
            const alpha = f(f(pu - f(beta * bu)) / au);
            inside = 0.0 <= alpha && f(alpha + beta) <= 1.0 ? 1 : 0;
        }
    }
    return inside;
}

export function PlaneDistance(normal: Vec3f, offset: number, point: Vec3f): number {
    return f(f(f(point.z * normal.z) + f(f(normal.x * point.x) + f(normal.y * point.y))) + offset);
}

function RecordImpact(body: RigidBody, speed: number): void {
    body.impactSpeed = u8(u32(speed));
    if (body.impactSpeed < 10) {
        body.impactSpeed = 0;
    } else {
        body.impactPoint.x = g_vCollisionContact.x;
        body.impactPoint.y = g_vCollisionContact.y;
        body.impactPoint.z = g_vCollisionContact.z;
    }
}

function RecordImpactVolume(body: RigidBody, speed: number): void {
    const volume = ImpactVolume(speed);
    body.impactVolume = body.impactVolume < volume ? volume : body.impactVolume;
}

export function BounceOffPlane(body: RigidBody, normal: Vec3f, damp: number, spin: number): number {
    const velocity = body.stepStates[1].velocity;
    const angular = body.stepStates[1].angularVelocity;
    const impulse = vec3();
    const pivot = vec3();
    const scale = vec3();
    const turn = vec3();
    const basis = mtx4();
    let damping: number;

    const into = f(f(velocity.z * normal.z) + f(f(normal.x * velocity.x) + f(normal.y * velocity.y)));
    if (0.0 <= into) {
        return 0;
    }
    const bounce = into * 1.05;
    impulse.x = f(normal.x * bounce);
    impulse.y = f(normal.y * bounce);
    impulse.z = f(normal.z * bounce);
    velocity.x = f(velocity.x - impulse.x);
    velocity.y = f(velocity.y - impulse.y);
    velocity.z = f(velocity.z - impulse.z);
    if (body.framesSinceImpact < 10) {
        damping = F_0_9;
    } else {
        let speed = Abs(into);
        if (MAX_IMPACT_SPEED < speed) {
            speed = MAX_IMPACT_SPEED;
        }
        RecordImpact(body, speed);
        RecordImpactVolume(body, speed);
        damping = F_0_9;
        velocity.x = f(velocity.x * damping);
        velocity.y = f(velocity.y * damping);
        velocity.z = f(velocity.z * damping);
    }
    if (damp) {
        velocity.x = f(velocity.x * damping);
        velocity.y = f(velocity.y * damping);
        velocity.z = f(velocity.z * damping);
    }
    if (!spin) {
        return 1;
    }

    pivot.x = normal.y;
    pivot.y = normal.z;
    pivot.z = normal.x;
    basis[1][0] = f(f(normal.y * pivot.z) - f(pivot.y * normal.z));
    basis[1][1] = f(f(normal.z * pivot.x) - f(pivot.z * normal.x));
    basis[1][2] = f(f(normal.x * pivot.y) - f(pivot.x * normal.y));
    basis[2][0] = f(f(normal.y * basis[1][2]) - f(basis[1][1] * normal.z));
    basis[2][1] = f(f(normal.z * basis[1][0]) - f(basis[1][2] * normal.x));
    basis[2][2] = f(f(normal.x * basis[1][1]) - f(basis[1][0] * normal.y));
    basis[0][0] = normal.x;
    basis[0][1] = normal.y;
    basis[0][2] = normal.z;
    Mtx3x3MulVec3f(scale, basis, normal);
    Mtx3x3MulVec3f(turn, basis, angular);
    turn.x = f(turn.x * scale.x);
    turn.y = f(turn.y * scale.y);
    turn.z = f(turn.z * scale.z);
    Mtx4fInverseRotate(angular, basis, turn);
    return 1;
}

export function UnusedCollisionResponseStub(_body: unknown, _normal: unknown, _damp: unknown): number {
    return 1;
}

export function ApplyCollisionImpulse(body: RigidBody, point: Vec3f, normal: Vec3f, friction: number, restitution: number): number {
    const velocity = body.stepStates[1].velocity;
    const angular = body.stepStates[1].angularVelocity;
    const transpose = mtx3();
    const rotation = mtx3();
    const skew = mtx3();
    const a = mtx3();
    const b = mtx3();
    const k = mtx3();
    const unit = mtx3();
    const arm = vec3();
    const motion = vec3();
    const across = vec3();
    const slide = vec3();
    const target = vec3();
    const impulse = vec3();
    const linear = vec3();
    const turn = vec3();
    const spin = vec3();

    const copy = vec3(point.x, point.y, point.z);
    TransposeCopyMatrix3x3(transpose, rotation, body.orientation);
    Mtx3fMulVec3f(arm, transpose, copy);
    motion.x = f(f(angular.y * arm.z) - f(arm.y * angular.z));
    motion.y = f(f(angular.z * arm.x) - f(arm.z * angular.x));
    motion.z = f(f(angular.x * arm.y) - f(arm.x * angular.y));
    motion.x = f(velocity.x + motion.x);
    motion.y = f(velocity.y + motion.y);
    motion.z = f(velocity.z + motion.z);
    let into = f(f(motion.z * normal.z) + f(f(normal.x * motion.x) + f(normal.y * motion.y)));
    if (0.0 <= into) {
        return 0;
    }

    BuildSkewSymmetricMatrix(skew, arm);
    Mtx3fMultiply(a, body.inverseInertia, rotation);
    Mtx3fMultiply(b, transpose, a);
    Mtx3fMultiply(k, b, skew);
    Mtx3fMultiply(a, skew, k);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            unit[i][j] = i === j ? 1.0 : 0.0;
        }
    }
    const inverseMass = f(1.0 / body.mass);
    unit[0][0] = inverseMass;
    unit[1][1] = inverseMass;
    unit[2][2] = inverseMass;
    SubtractMatrix3x3(k, unit, a);

    into = f(f(motion.z * normal.z) + f(f(normal.x * motion.x) + f(normal.y * motion.y)));
    across.x = f(normal.x * into);
    across.y = f(normal.y * into);
    across.z = f(normal.z * into);
    let speed = Abs(into);
    if (MAX_IMPACT_SPEED < speed) {
        speed = MAX_IMPACT_SPEED;
    }
    RecordImpact(body, speed);
    if (body.framesSinceImpact >= 11 && restitution < F_0_0001) {
        RecordImpactVolume(body, speed);
        across.x = f(across.x * F_0_9);
        across.y = f(across.y * F_0_9);
        across.z = f(across.z * F_0_9);
        motion.x = f(motion.x * F_0_9);
        motion.y = f(motion.y * F_0_9);
        motion.z = f(motion.z * F_0_9);
    }
    slide.x = f(motion.x - across.x);
    slide.y = f(motion.y - across.y);
    slide.z = f(motion.z - across.z);
    if (friction) {
        slide.x = f(slide.x * F_0_2);
        slide.y = f(slide.y * F_0_2);
        slide.z = f(slide.z * F_0_2);
    } else {
        slide.x = 0.0;
        slide.y = 0.0;
        slide.z = 0.0;
    }
    target.x = f(across.x + slide.x);
    target.y = f(across.y + slide.y);
    target.z = f(across.z + slide.z);
    SolveLinearSystem3x3(impulse, k, target);
    linear.x = f(impulse.x * f(1.0 / body.mass));
    linear.y = f(impulse.y * f(1.0 / body.mass));
    linear.z = f(impulse.z * f(1.0 / body.mass));
    CrossInto(turn, arm, impulse);
    Mtx3fMulVec3f(spin, b, turn);
    const bounce = f(F_1_05 + restitution);
    linear.x = f(linear.x * bounce);
    linear.y = f(linear.y * bounce);
    linear.z = f(linear.z * bounce);
    spin.x = f(spin.x * bounce);
    spin.y = f(spin.y * bounce);
    spin.z = f(spin.z * bounce);
    velocity.x = f(velocity.x - linear.x);
    velocity.y = f(velocity.y - linear.y);
    velocity.z = f(velocity.z - linear.z);
    angular.x = f(angular.x - spin.x);
    angular.y = f(angular.y - spin.y);
    angular.z = f(angular.z - spin.z);
    return 1;
}

export function PushCollisionTriangle(triangle: TrackTriangle): void {
    const node = g_aCollisionTriangleNodes[g_pNextCollisionTriangleNode++];
    node.triangle = triangle;
    node.next = g_pCollisionTriangleList;
    g_pCollisionTriangleList = node;
}

export function PrintCollisionTriangleCount(): void {
    let count = 0;
    for (let node = g_pCollisionTriangleList; node !== null; node = node.next) {
        count = s16(count + 1);
    }
}

function FaceOutcode(v: Vec3f): number {
    let code = 0;
    if (v.x > 0.5) {
        code = 0x1;
    } else if (v.x < -0.5) {
        code = 0x2;
    }
    if (v.y > 0.5) {
        code |= 0x4;
    } else if (v.y < -0.5) {
        code |= 0x8;
    }
    if (v.z > 0.5) {
        code |= 0x10;
    } else if (v.z < -0.5) {
        code |= 0x20;
    }
    return code;
}

function OutcodePair(code: number, mask: number, low: number, sum: number, bound: number): number {
    if (mask & (low * 3)) {
        if (mask & low && sum > bound) {
            code |= low;
        } else if (mask & (low * 2) && sum < -bound) {
            code |= low * 2;
        }
    }
    return code;
}

function EdgeOutcode(v: Vec3f, mask: number): number {
    let code = 0;
    code = OutcodePair(code, mask, 0x1, f(v.y + v.x), 1.0);
    code = OutcodePair(code, mask, 0x4, f(v.x - v.y), 1.0);
    code = OutcodePair(code, mask, 0x10, f(v.z + v.x), 1.0);
    code = OutcodePair(code, mask, 0x40, f(v.x - v.z), 1.0);
    code = OutcodePair(code, mask, 0x100, f(v.z + v.y), 1.0);
    code = OutcodePair(code, mask, 0x400, f(v.y - v.z), 1.0);
    return code;
}

function CornerOutcode(v: Vec3f, mask: number): number {
    let code = 0;
    code = OutcodePair(code, mask, 0x1, f(v.z + f(v.x + v.y)), 1.5);
    code = OutcodePair(code, mask, 0x4, f(f(v.x + v.y) - v.z), 1.5);
    code = OutcodePair(code, mask, 0x10, f(v.z + f(v.x - v.y)), 1.5);
    code = OutcodePair(code, mask, 0x40, f(f(v.x - v.y) - v.z), 1.5);
    return code;
}

export function ClassifyTriangleInUnitCube(triangle: Vec3f[]): number {
    let shared = -1;
    let code: number;
    for (let i = 0; i < 3; i++) {
        code = FaceOutcode(triangle[i]);
        if (code === 0) {
            return 1;
        }
        shared &= code;
    }
    if (shared) {
        return 0;
    }
    code = -1;
    for (let i = 0; i < 3; i++) {
        code = EdgeOutcode(triangle[i], code);
        if (code === 0) {
            break;
        }
    }
    if (code) {
        return 0;
    }
    code = -1;
    for (let i = 0; i < 3; i++) {
        code = CornerOutcode(triangle[i], code);
        if (code === 0) {
            break;
        }
    }
    if (code) {
        return 0;
    }
    return -1;
}

export function CountTriangleWinding(triangle: Vec3f[], normal: Vec3f, point: Vec3f): number {
    const n = [Abs(normal.x), Abs(normal.y), Abs(normal.z)];
    let axis: number;
    let i0: number;
    let i1: number;
    let winding = 0;
    if (n[2] < n[0]) {
        axis = n[1] < n[0] ? 0 : 1;
    } else {
        axis = (n[2] < n[1] ? 0 : 1) + 1;
    }
    if (Component(normal, axis) < 0.0) {
        i0 = (axis + 2) % 3;
        i1 = (axis + 1) % 3;
    } else {
        i0 = (axis + 1) % 3;
        i1 = (axis + 2) % 3;
    }
    const p0 = Component(point, i0);
    for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3;
        const a0 = Component(triangle[edge], i0);
        const b0 = Component(triangle[next], i0);
        const cross0 = (p0 < b0 ? 1 : 0) - (p0 < a0 ? 1 : 0);
        if (cross0) {
            const b1 = Component(triangle[next], i1);
            const p1 = Component(point, i1);
            const a1 = Component(triangle[edge], i1);
            const cross1 = (p1 < b1 ? 1 : 0) - (p1 < a1 ? 1 : 0);
            if (cross1) {
                if (f(f(cross0 * f(p0 - a0)) * f(b1 - a1)) <= f(f(b0 - a0) * f(cross0 * f(p1 - a1)))) {
                    winding += cross0;
                }
            } else if (a1 <= p1) {
                winding += cross0;
            }
        }
    }
    return winding;
}

export function DoesSegmentCrossUnitCube(start: Vec3f, end: Vec3f): number {
    const d = [f(end.x - start.x), f(end.y - start.y), f(end.z - start.z)];
    const sign = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        sign[i] = d[i] < 0.0 ? -1 : 1;
    }
    for (let i = 0; i < 3; i++) {
        if (f(sign[i] * Component(start, i)) > 0.5) {
            return 0;
        }
        if (f(sign[i] * Component(end, i)) < -0.5) {
            return 0;
        }
    }
    for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const k = (i + 2) % 3;
        const across = f(f(d[k] * Component(start, j)) - f(Component(start, k) * d[j]));
        const reach = f(f(f(sign[k] * d[j]) + f(d[k] * sign[j])) * 0.5);
        if (f(reach * reach) < f(across * across)) {
            return 0;
        }
    }
    return 1;
}

export function DoesTriangleCrossUnitCube(triangle: Vec3f[], normal: Vec3f): number {
    for (let edge = 0; edge < 3; edge++) {
        if (DoesSegmentCrossUnitCube(triangle[edge], triangle[(edge + 1) % 3])) {
            return 1;
        }
    }
    const sx = normal.x < 0.0 ? -1 : 1;
    const sy = normal.y < 0.0 ? -1 : 1;
    const sz = normal.z < 0.0 ? -1 : 1;
    const t = f(
        f(f(f(normal.x * triangle[0].x) + f(normal.y * triangle[0].y)) + f(normal.z * triangle[0].z)) /
            f(f(sz * normal.z) + f(f(normal.x * sx) + f(normal.y * sy))),
    );
    if ((t - -0.5) * (t - 0.5) <= 0.0) {
        const point = vec3(f(sx * t), f(sy * t), f(sz * t));
        return CountTriangleWinding(triangle, normal, point);
    }
    return 0;
}

export function IsTriangleInUnitCube(triangle: Vec3f[], normal: Vec3f): number {
    const inside = ClassifyTriangleInUnitCube(triangle);
    if (inside === -1) {
        return DoesTriangleCrossUnitCube(triangle, normal);
    }
    return inside;
}

function TriangleInBox(corners: Vec3f[], normal: Vec3f, box: Mtx4, t: TrackTriangle): void {
    const e1 = vec3();
    const e2 = vec3();
    Mtx4x4TransformPoint(corners[0], box, t.vertices[0]);
    Mtx4x4TransformPoint(corners[1], box, t.vertices[1]);
    Mtx4x4TransformPoint(corners[2], box, t.vertices[2]);
    e1.x = f(corners[1].x - corners[0].x);
    e1.y = f(corners[1].y - corners[0].y);
    e1.z = f(corners[1].z - corners[0].z);
    e2.x = f(corners[2].x - corners[0].x);
    e2.y = f(corners[2].y - corners[0].y);
    e2.z = f(corners[2].z - corners[0].z);
    CrossInto(normal, e1, e2);
}

export function CollectTrianglesInBox(body: RigidBody, box: Mtx4): number {
    const corners = [vec3(), vec3(), vec3()];
    const normal = vec3();
    let found = 0;
    const slot = BuildTrackTriangleCache(body.orientation[3][0], body.orientation[3][1]);
    const count = g_awTriCacheTriCount[slot];
    const triangles = g_aTriCacheTriangles[slot];
    if (G.g_bTrackCollisionFrameToggle) {
        for (let i = count - 1; i >= 0; i--) {
            TriangleInBox(corners, normal, box, triangles[i]);
            if (IsTriangleInUnitCube(corners, normal)) {
                PushCollisionTriangle(triangles[i]);
                found++;
            }
        }
    } else {
        for (let i = 0; i < count; i++) {
            TriangleInBox(corners, normal, box, triangles[i]);
            if (IsTriangleInUnitCube(corners, normal)) {
                PushCollisionTriangle(triangles[i]);
                found++;
            }
        }
    }
    return found;
}

export function UnusedTrackCollisionStub(_body: unknown): number {
    return 0;
}

function GroundDistance(wheel: RigidBody, point: Vec3f): number {
    if (PlaneDistance(wheel.groundNormal, wheel.groundOffset, point) < 0.0) {
        return -PlaneDistance(wheel.groundNormal, wheel.groundOffset, point);
    }
    return PlaneDistance(wheel.groundNormal, wheel.groundOffset, point);
}

export function TipBalancedVehicle(body: RigidBody): number {
    let wheel: RigidBody | null = null;
    const corner = vec3();
    const point = vec3();
    const velocity = vec3();
    const nudge = vec3();

    QuaternionToMatrix(body.orientation, body.stepStates[0]);
    let nearest = 100.0;
    let touching = 0;
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        if (!(body.wheels[i] as RigidBody).contactFrames) {
            continue;
        }
        touching++;
        wheel = body.wheels[i] as RigidBody;
        corner.x = f(Sign(wheel.state.position.x) * f(body.boxSize.x * 0.5));
        corner.y = f(Sign(wheel.state.position.y) * f(body.boxSize.y * 0.5));
        corner.z = f(f(-body.boxSize.z * 0.5) + body.boxCenterZ);
        Mtx4x4TransformPoint(point, body.orientation, corner);
        const distance = GroundDistance(wheel, point);
        if (!(nearest < distance)) {
            nearest = distance;
        }
    }
    if (touching >= 3 || touching <= 0) {
        return 0;
    }
    if (nearest > 0.6) {
        return 0;
    }
    const ground = (wheel as RigidBody).groundNormal;
    GetBodyPointVelocity(velocity, body, corner);
    const along = f(f(ground.z * velocity.z) + f(f(velocity.x * ground.x) + f(velocity.y * ground.y)));
    if (Abs(along) > F_0_1) {
        return 0;
    }
    const o = body.orientation;
    const tilt = f(f(body.groundNormal.z * o[0][2]) + f(f(o[0][0] * body.groundNormal.x) + f(o[0][1] * body.groundNormal.y)));
    nudge.x = 0.0;
    nudge.y = 0.0 < tilt ? F_0_1 : -F_0_1;
    nudge.z = 0.0;
    Mtx3x3MulVec3f(point, body.orientation, nudge);
    const spin = body.stepStates[0].angularVelocity;
    for (let i = 0; i < 2; i++) {
        AddInto(spin, point);
    }
    ComputeDeltaQuaternion(body.stepStates[0]);
    return 1;
}

export function ComputeCollisionPenetration(body: RigidBody, normal: Vec3f, offset: number, contact: Vec3f, triangle: Vec3f[]): void {
    let distance: number;
    if (g_dwCollisionContactType !== 2) {
        distance = f(f(f(contact.z * normal.z) + f(f(normal.x * contact.x) + f(normal.y * contact.y))) - offset);
    } else {
        const middle = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
            middle[i] = f(Component(triangle[2], i) + f(Component(triangle[0], i) + Component(triangle[1], i)));
            middle[i] = f(middle[i] / 3.0);
        }
        const half = f((middle[0] < 0.0 ? -1 : 1) * 0.5);
        if (Abs(middle[0]) < Abs(middle[1])) {
            if (Abs(middle[0]) < Abs(middle[2])) {
                g_vCollisionContact.z = 0.0;
                g_vCollisionContact.y = g_vCollisionContact.z;
                g_vCollisionContact.x = half;
            } else {
                g_vCollisionContact.y = 0.0;
                g_vCollisionContact.x = g_vCollisionContact.y;
                g_vCollisionContact.z = half;
            }
        } else if (Abs(middle[1]) < Abs(middle[2])) {
            g_vCollisionContact.z = 0.0;
            g_vCollisionContact.x = g_vCollisionContact.z;
            g_vCollisionContact.y = half;
        } else {
            g_vCollisionContact.y = 0.0;
            g_vCollisionContact.x = g_vCollisionContact.y;
            g_vCollisionContact.z = half;
        }
        distance = f(f(f(g_vCollisionContact.z * normal.z) + f(f(normal.x * g_vCollisionContact.x) + f(normal.y * g_vCollisionContact.y))) - offset);
        g_vCollisionContact.x = f(g_vCollisionContact.x * body.boxSize.x);
        g_vCollisionContact.x = f(g_vCollisionContact.x * body.boxSize.y);
        g_fCollisionContactW = f(g_fCollisionContactW * body.boxSize.z);
    }
    g_vCollisionPenetration.x = f(normal.x * -distance);
    g_vCollisionPenetration.y = f(normal.y * -distance);
    g_vCollisionPenetration.z = f(normal.z * -distance);
}

export function CollideBodyWithTriangles(body: RigidBody, box: Mtx4): number {
    const corners = [vec3(), vec3(), vec3()];
    const normal = vec3();
    const along = vec3();
    const half = vec3();
    const back = vec3();
    let spin = 0;
    let hit = 0;
    let hits = 0;

    for (let node = g_pCollisionTriangleList; node !== null; node = node.next) {
        const triangle = node.triangle as TrackTriangle;
        TriangleInBox(corners, normal, box, triangle);
        if (!IsTriangleInUnitCube(corners, normal)) {
            continue;
        }
        Vec3fNormalizeFast(normal);
        let resist = 1;
        const distance = f(f(corners[0].z * normal.z) + f(f(normal.x * corners[0].x) + f(normal.y * corners[0].y)));
        g_dwCollisionContactType = 0;
        hits = s16(hits + 1);
        if (G.g_dwGameMode === GAME_MODE_DEMO) {
            if (Abs(normal.x) > F_0_999 || Abs(normal.y) > F_0_999 || Abs(normal.z) > F_0_999) {
                g_dwCollisionContactType = 1;
                spin = 1;
            } else if (Abs(distance) < 0.5) {
                spin = 0;
                g_dwCollisionContactType = 2;
            }
        }
        along.x = f(normal.x * distance);
        along.y = f(normal.y * distance);
        along.z = f(normal.z * distance);
        half.x = f((along.x < 0.0 ? -1 : 1) * 0.5);
        half.y = f((along.y < 0.0 ? -1 : 1) * 0.5);
        half.z = f((along.z < 0.0 ? -1 : 1) * 0.5);
        g_vCollisionContact.x = f(half.x * body.boxSize.x);
        g_vCollisionContact.y = f(half.y * body.boxSize.y);
        g_vCollisionContact.z = f(f(half.z * body.boxSize.z) + body.boxCenterZ);
        g_pCollisionTriangle = triangle;
        ComputeCollisionPenetration(body, normal, distance, half, corners);
        if (UPRIGHT_LIMIT < body.orientation[2][2]) {
            resist = 0;
        }
        let moved: number;
        if (g_dwCollisionContactType === 1) {
            moved = BounceOffPlane(body, g_pCollisionTriangle.normal, resist, spin);
        } else {
            moved = ApplyCollisionImpulse(body, g_vCollisionContact, g_pCollisionTriangle.normal, resist, 0.0);
        }
        if (moved) {
            hit = 1;
            const s0 = body.stepStates[0];
            const s1 = body.stepStates[1];
            back.x = f(s1.position.x - s0.position.x);
            back.y = f(s1.position.y - s0.position.y);
            back.z = f(s1.position.z - s0.position.z);
            const push = f(f(f(triangle.normal.z * back.z) + f(f(back.x * triangle.normal.x) + f(back.y * triangle.normal.y))) * 1.1);
            back.x = f(triangle.normal.x * push);
            back.y = f(triangle.normal.y * push);
            back.z = f(triangle.normal.z * push);
            s1.position.x = f(s1.position.x - back.x);
            s1.position.y = f(s1.position.y - back.y);
            s1.position.z = f(s1.position.z - back.z);
            s1.orientation.w = s0.orientation.w;
            s1.orientation.y = s0.orientation.y;
            s1.orientation.x = s0.orientation.x;
            ComputeDeltaQuaternion(s1);
            QuaternionToMatrix(body.orientation, s1);
        }
    }
    if (hits) {
        body.framesSinceImpact = 0;
    } else if (body.framesSinceImpact < 40) {
        body.framesSinceImpact++;
    }
    return hit;
}

export function StepVehicleCollisions(body: RigidBody): void {
    const scale = vec3();
    const box = mtx4();

    g_pCollisionTriangleList = null;
    g_pNextCollisionTriangleNode = 0;
    g_vCollisionContact.x = 0.0;
    g_vCollisionContact.y = 0.0;
    g_vCollisionContact.z = 0.0;
    g_vCollisionPenetration.x = 0.0;
    g_vCollisionPenetration.y = 0.0;
    g_vCollisionPenetration.z = 0.0;
    g_dwCollisionContactType = 0;
    g_pCollisionTriangle = null;
    scale.y = F_0_1;
    scale.x = F_0_1;
    scale.z = F_0_1;
    MtxBuildScaledInverse(body.orientation, box, scale);
    CollectTrianglesInBox(body, box);
    scale.x = f(1.0 / body.boxSize.x);
    scale.y = f(1.0 / body.boxSize.y);
    scale.z = f(1.0 / body.boxSize.z);
    let remaining = F_ONE_THIRTIETH;
    if (F_0_002 < remaining) {
        const step = f(F_ONE_THIRTIETH / COLLISION_STEPS);
        do {
            TipBalancedVehicle(body);
            CollideVehicles();
            IntegrateRigidBodyState(body.stepStates[1], body.stepStates[0], step);
            QuaternionToMatrix(body.orientation, body.stepStates[1]);
            MtxBuildScaledInverse(body.orientation, box, scale);
            box[3][2] = f(box[3][2] - body.boxCenterZ);
            if (CollideBodyWithTriangles(body, box)) {
                ComputeDeltaQuaternion(body.stepStates[1]);
                QuaternionToMatrix(body.orientation, body.stepStates[1]);
            }
            copyRigidBodyState(body.stepStates[0], body.stepStates[1]);
            remaining = f(remaining - step);
        } while (F_0_002 < remaining);
    }
    QuaternionToMatrix(body.orientation, body.stepStates[1]);
    copyRigidBodyState(body.stepStates[0], body.stepStates[1]);
    if (body.orientation[2][2] < UPRIGHT_LIMIT) {
        if (body.uprightFrames < 0) {
            body.uprightFrames = -1;
        }
        body.uprightFrames--;
    } else {
        body.uprightFrames = UPRIGHT_FRAMES;
    }
}

export function ComputeDragForce(body: RigidBody, force: RigidBodyForce): void {
    const v = body.state.velocity;
    const w = body.wheels as RigidBody[];
    force.vector.x = f(v.x * -110.0);
    force.vector.y = f(v.y * -110.0);
    force.vector.z = f(v.z * -110.0);
    if (
        4.0 < BodySpeed(body) &&
        G.g_dwCurrentWeather !== WEATHER_SNOW &&
        (w[0].surface === TRACK_SURFACE_SLOW || w[1].surface === TRACK_SURFACE_SLOW || w[2].surface === TRACK_SURFACE_SLOW || w[3].surface === TRACK_SURFACE_SLOW)
    ) {
        force.vector.x = f(force.vector.x + f(v.x * -220.0));
        force.vector.y = f(force.vector.y + f(v.y * -220.0));
        force.vector.z = f(force.vector.z + f(v.z * -220.0));
    }
}

export function CastWheelRay(body: RigidBody, wheel: RigidBody): number {
    const down = vec3(g_vecNegUnitZ.x, g_vecNegUnitZ.y, g_vecNegUnitZ.z);
    const start = vec3();
    const origin = vec3();
    const direction = vec3();
    const hit = vec3();
    let nearest = 100.0;
    start.x = wheel.state.position.x;
    start.y = wheel.state.position.y;
    start.z = 0.0;
    Mtx4x4TransformPoint(origin, body.orientation, start);
    Mtx3x3MulVec3f(direction, body.orientation, down);
    wheel.ground = null;
    const slot = BuildTrackTriangleCache(origin.x, origin.y);
    const count = g_awTriCacheTriCount[slot];
    const triangles = g_aTriCacheTriangles[slot];
    for (let i = 0; i < count; i++) {
        const triangle = triangles[i];
        const n = triangle.normal;
        let distance = PlaneDistance(n, triangle.planeOffset, origin);
        if (!(distance > -2.0) || !(distance < 2.0)) {
            continue;
        }
        const facing = f(f(direction.z * n.z) + f(f(n.x * direction.x) + f(n.y * direction.y)));
        if (!(Abs(facing) > 0.001)) {
            continue;
        }
        distance = f(-f(triangle.planeOffset + f(f(origin.z * n.z) + f(f(n.x * origin.x) + f(n.y * origin.y)))) / facing);
        hit.x = f(direction.x * distance);
        hit.y = f(direction.y * distance);
        hit.z = f(direction.z * distance);
        hit.x = f(origin.x + hit.x);
        hit.y = f(origin.y + hit.y);
        hit.z = f(origin.z + hit.z);
        if (!(distance > -2.0) || !(distance < 2.0) || !(distance < nearest)) {
            continue;
        }
        if (!(n.z > 0.2)) {
            continue;
        }
        if (!IsPointInTrackTriangle(triangle, hit)) {
            continue;
        }
        wheel.ground = triangle;
        nearest = distance;
        wheel.surface = triangle.surface;
        wheel.groundNormal.x = n.x;
        wheel.groundNormal.y = n.y;
        wheel.groundNormal.z = n.z;
        wheel.groundOffset = triangle.planeOffset;
    }
    return nearest;
}

export function UpdateWheelHeights(body: RigidBody): void {
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        const wheel = body.wheels[i] as RigidBody;
        let height = -CastWheelRay(body, wheel);
        wheel.suspension = height;
        if (height > 0.0) {
            height = 0.0;
        }
        if (height < -0.4) {
            wheel.state.position.z = -F_0_4;
        } else {
            wheel.state.position.z = height;
        }
    }
}

export function ComputeSpringForces(body: RigidBody): void {
    let force = body.forces as RigidBodyForce;
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        force.vector.y = 0.0;
        force.vector.x = 0.0;
        const wheel = body.wheels[i] as RigidBody;
        const previous = s16(wheel.contactFrames);
        if (wheel.contactFrames < 100) {
            wheel.contactFrames++;
        }
        let extension = wheel.suspension;
        if (extension <= -0.3999) {
            wheel.contactFrames = 0;
            extension = -F_0_3;
        }
        if (0.0 < extension) {
            extension = 0.0;
        }
        let compression = f(extension - -0.3);
        if (compression < 0.0) {
            compression = 0.0;
        }
        force.vector.z = f(f(compression * (Sign(compression) * compression)) * body.springRate);
        if (wheel.contactFrames && !previous) {
            body.landed = 0x80;
        }
        force = force.next as RigidBodyForce;
    }
}

export function ComputeDampingForces(body: RigidBody): void {
    let force = body.forces as RigidBodyForce;
    const velocity = vec3();
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        force.vector.y = 0.0;
        force.vector.x = 0.0;
        const wheel = body.wheels[i] as RigidBody;
        ComputeWheelLocalVelocity(velocity, body, wheel);
        let damping: number;
        if (wheel.contactFrames === 0) {
            damping = 0.0;
        } else if (velocity.z < 0.0) {
            damping = 0.0;
        } else {
            damping = f(velocity.z * body.damping);
        }
        force.vector.z = damping;
        force = force.next as RigidBodyForce;
    }
}

function GridSector(x: number, y: number): number {
    return s16(((Math.trunc(y) / 32) | 0) * 64 + ((Math.trunc(x) / 32) | 0));
}

export function InvalidateTriCacheSectorAt(x: number, y: number): number {
    const sector = GridSector(x, y);
    for (let slot = 0; slot < TRI_CACHE_SLOTS; slot++) {
        if (sector === g_awTriCacheSectorId[slot]) {
            g_adwTriCacheLruStamp[slot] = 0;
            g_awTriCacheSectorId[slot] = 0;
            return 1;
        }
    }
    return 0;
}

export function BuildTrackTriangleCache(x: number, y: number): number {
    const track = G.g_LoadedTrack;
    const e1 = vec3();
    const e2 = vec3();
    let best = 0;

    g_dwTriCacheLruCounter = u32(g_dwTriCacheLruCounter + 1);
    const sector = GridSector(x, y);
    let oldest = 0x40000000;
    for (let slot = 0; slot < TRI_CACHE_SLOTS; slot++) {
        if (sector === g_awTriCacheSectorId[slot]) {
            g_adwTriCacheLruStamp[slot] = g_dwTriCacheLruCounter;
            return slot;
        }
        if (g_adwTriCacheLruStamp[slot] < oldest) {
            best = slot;
            oldest = g_adwTriCacheLruStamp[slot];
        }
    }
    g_adwTriCacheLruStamp[best] = g_dwTriCacheLruCounter;
    g_awTriCacheSectorId[best] = u16(sector);
    const triangles = g_aTriCacheTriangles[best];
    let count = 0;
    const cell = LookupTrackGridCell(track, x, y);
    const cursor = gridCursor(cell);
    if (cell !== 0) {
        let index: number;
        while ((index = NextGridCellTriangle(track, cursor)) !== 0) {
            if (triangles[count] === undefined) {
                triangles[count] = trackTriangle();
            }
            const triangle = triangles[count];
            const corners = track.surfaces[index].vertices;
            triangle.vertices = [track.vertices[corners[0]], track.vertices[corners[1]], track.vertices[corners[2]]];
            triangle.index = s16(index);
            triangle.surface = track.triangleFlags[index] & 7;
            const v = triangle.vertices;
            e1.x = f(v[1].x - v[0].x);
            e1.y = f(v[1].y - v[0].y);
            e1.z = f(v[1].z - v[0].z);
            e2.x = f(v[2].x - v[0].x);
            e2.y = f(v[2].y - v[0].y);
            e2.z = f(v[2].z - v[0].z);
            CrossInto(triangle.normal, e1, e2);
            Vec3fNormalizeFast(triangle.normal);
            triangle.planeOffset = -Dot(triangle.normal, v[0]);
            count++;
        }
    }
    g_awTriCacheTriCount[best] = u16(count);
    return best;
}

function Reach(a: number, p: number, q: number, r: number, s: number, t: number, u: number): number {
    return f(f(f(a + f(p * q)) + f(r * s)) + f(t * u));
}

function Reach4(p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number): number {
    return f(f(f(f(p * q) + f(r * s)) + f(t * u)) + f(v * w));
}

function Project(p: number, q: number, r: number, s: number, t: number, u: number): number {
    return Abs(f(f(f(p * q) + f(r * s)) + f(t * u)));
}

function Across(p: number, q: number, r: number, s: number): number {
    return Abs(f(f(p * q) - f(r * s)));
}

export function TestObbIntersection(rotation: Mtx3, offset: Vec3f, halfA: Vec3f, halfB: Vec3f): number {
    const m = rotation;
    const tx = offset.x;
    const ty = offset.y;
    const tz = offset.z;
    const ax = halfA.x;
    const ay = halfA.y;
    const az = halfA.z;
    const bx = halfB.x;
    const by = halfB.y;
    const bz = halfB.z;
    const r = m.map((row) => row.map(Abs));
    let overlap = 1;
    overlap &= Abs(tx) <= Reach(ax, bx, r[0][0], by, r[0][1], r[0][2], bz) ? 1 : 0;
    overlap &= Project(tx, m[0][0], ty, m[1][0], m[2][0], tz) <= Reach(bx, ax, r[0][0], ay, r[1][0], r[2][0], az) ? 1 : 0;
    overlap &= Abs(ty) <= Reach(ay, bx, r[1][0], by, r[1][1], r[1][2], bz) ? 1 : 0;
    overlap &= Abs(tz) <= Reach(az, bx, r[2][0], by, r[2][1], r[2][2], bz) ? 1 : 0;
    overlap &= Project(tx, m[0][1], ty, m[1][1], m[2][1], tz) <= Reach(by, ax, r[0][1], ay, r[1][1], r[2][1], az) ? 1 : 0;
    overlap &= Project(tx, m[0][2], ty, m[1][2], m[2][2], tz) <= Reach(bz, ax, r[0][2], ay, r[1][2], r[2][2], az) ? 1 : 0;
    overlap &= Across(tz, m[1][0], m[2][0], ty) <= Reach4(ay, r[2][0], az, r[1][0], by, r[0][2], bz, r[0][1]) ? 1 : 0;
    overlap &= Across(tz, m[1][1], m[2][1], ty) <= Reach4(ay, r[2][1], az, r[1][1], bx, r[0][2], bz, r[0][0]) ? 1 : 0;
    overlap &= Across(tz, m[1][2], m[2][2], ty) <= Reach4(ay, r[2][2], az, r[1][2], bx, r[0][1], by, r[0][0]) ? 1 : 0;
    overlap &= Across(tx, m[2][0], m[0][0], tz) <= Reach4(ax, r[2][0], az, r[0][0], by, r[1][2], bz, r[1][1]) ? 1 : 0;
    overlap &= Across(tx, m[2][1], m[0][1], tz) <= Reach4(ax, r[2][1], az, r[0][1], bx, r[1][2], bz, r[1][0]) ? 1 : 0;
    overlap &= Across(tx, m[2][2], m[0][2], tz) <= Reach4(ax, r[2][2], az, r[0][2], bx, r[1][1], by, r[1][0]) ? 1 : 0;
    overlap &= Across(ty, m[0][0], m[1][0], tx) <= Reach4(ax, r[1][0], ay, r[0][0], by, r[2][2], bz, r[2][1]) ? 1 : 0;
    overlap &= Across(ty, m[0][1], m[1][1], tx) <= Reach4(ax, r[1][1], ay, r[0][1], bx, r[2][2], bz, r[2][0]) ? 1 : 0;
    overlap &= Across(ty, m[0][2], m[1][2], tx) <= Reach4(ax, r[1][2], ay, r[0][2], bx, r[2][1], by, r[2][0]) ? 1 : 0;
    return overlap;
}

function PushVehicle(slot: RacerSlot, state: RigidBodyState, shared: Vec3f, towards: Vec3f, normal: Vec3f): void {
    const body = (slot.vehicle as NonNullable<RacerSlot["vehicle"]>).body;
    const arm = vec3(f(towards.x * 2.5), f(towards.y * 2.5), f(towards.z * 2.5));
    const local = vec3();
    Mtx4fInverseRotate(local, body.orientation, arm);
    state.velocity.x = f(state.velocity.x - shared.x);
    state.velocity.y = f(state.velocity.y - shared.y);
    state.velocity.z = f(state.velocity.z - shared.z);
    copyRigidBodyState(body.stepStates[1], body.state);
    ApplyCollisionImpulse(body, local, normal, 0, F_0_45);
    copyRigidBodyState(body.state, body.stepStates[1]);
    const v1 = body.stepStates[1].velocity;
    v1.x = f(shared.x + v1.x);
    v1.y = f(shared.y + v1.y);
    v1.z = f(shared.z + v1.z);
    body.stepStates[0].velocity.x = v1.x;
    body.stepStates[0].velocity.y = v1.y;
    body.stepStates[0].velocity.z = v1.z;
    state.velocity.x = f(shared.x + state.velocity.x);
    state.velocity.y = f(shared.y + state.velocity.y);
    state.velocity.z = f(shared.z + state.velocity.z);
}

export function CollideVehicles(): void {
    const slots = G.g_aRacerSlots;
    const apart = vec3();
    const offset = vec3();
    const local = vec3();
    const extents = vec3();
    const shared = vec3();
    const back = vec3();
    const transposeB = mtx3();
    const rotationA = mtx3();
    const relative = mtx3();

    for (let i = 0; i < G.g_dwNumVehicles; i++) {
        const va = slots[i].vehicle;
        if (va === null || va.ghostMode === VEHICLE_GHOST) {
            continue;
        }
        va.body.framesSinceVehicleImpact = u8(va.body.framesSinceVehicleImpact + 1);
        const sa = va.body.state;
        for (let j = i + 1; j < G.g_dwNumVehicles; j++) {
            const vb = slots[j].vehicle;
            if (vb === null || vb.ghostMode === VEHICLE_GHOST) {
                continue;
            }
            const sb = vb.body.state;
            apart.x = f(sa.position.x - sb.position.x);
            apart.y = f(sa.position.y - sb.position.y);
            apart.z = f(sa.position.z - sb.position.z);
            if (!(sqrtf(f(f(apart.z * apart.z) + f(f(apart.x * apart.x) + f(apart.y * apart.y)))) < 5.0)) {
                continue;
            }
            extents.x = g_vVehicleObbHalfExtents.x;
            extents.y = g_vVehicleObbHalfExtents.y;
            extents.z = g_vVehicleObbHalfExtents.z;
            Transpose4x4Into3x3(transposeB, vb.body.orientation);
            CopyMatrix4x4To3x3(rotationA, va.body.orientation);
            Mtx3fMultiply(relative, transposeB, rotationA);
            offset.x = f(sa.position.x - sb.position.x);
            offset.y = f(sa.position.y - sb.position.y);
            offset.z = f(sa.position.z - sb.position.z);
            Mtx3fMulVec3f(local, rotationA, offset);
            if (!TestObbIntersection(relative, local, extents, extents)) {
                return;
            }
            Vec3fNormalizeFast(apart);
            const speedA = f(f(apart.z * sa.velocity.z) + f(f(sa.velocity.x * apart.x) + f(sa.velocity.y * apart.y)));
            const speedB = f(f(f(sb.velocity.x * apart.x) + f(sb.velocity.y * apart.y)) + f(sb.velocity.z * apart.z));
            const mean = f(f(speedA + speedB) * 0.5);
            shared.x = f(apart.x * mean);
            shared.y = f(apart.y * mean);
            shared.z = f(apart.z * mean);
            let closing = mean < speedA ? -f(mean - speedA) : f(mean - speedA);
            if (MAX_IMPACT_SPEED < closing) {
                closing = MAX_IMPACT_SPEED;
            }
            if (va.body.framesSinceVehicleImpact >= 41) {
                const volume = u8(u32(f(f(f(127.0 * closing) / MAX_IMPACT_SPEED) + 128.0)));
                va.body.vehicleImpactVolume = volume;
                vb.body.vehicleImpactVolume = volume;
            }
            va.body.framesSinceVehicleImpact = 0;
            back.x = f(apart.x * -1.0);
            back.y = f(apart.y * -1.0);
            back.z = f(apart.z * -1.0);
            PushVehicle(slots[i], sa, shared, back, apart);
            PushVehicle(slots[j], sb, shared, apart, back);
        }
    }
}
