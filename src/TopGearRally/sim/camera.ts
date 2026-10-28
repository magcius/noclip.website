import { cosf, f, sinf } from "./f32.js";
import { G, GAME_MODE_AFTER_SEASON } from "./globals.js";
import { BuildTrackTriangleCache, g_aTriCacheTriangles, g_awTriCacheTriCount } from "./physics.js";
import {
    CameraFrame,
    RAY_INSTANCES,
    TrackTriangle,
    VEHICLE_CAMERA_BUMPER,
    VEHICLE_CAMERA_CHASE,
    VEHICLE_CAMERA_COCKPIT,
    VEHICLE_CAMERA_MIRROR,
    VEHICLE_CAMERA_TRACKSIDE,
    Vec3f,
    Vehicle,
    copyCameraFrame,
    copyVec3,
    vec3,
} from "./types.js";
import {
    PointInTriangle3D,
    Vec3fAdd,
    Vec3fAddInPlace,
    Vec3fCross,
    Vec3fDistance,
    Vec3fDivideInPlace,
    Vec3fDot,
    Vec3fLength,
    Vec3fLerp,
    Vec3fMulAdd,
    Vec3fMulAddInPlace,
    Vec3fNegate,
    Vec3fNormalize,
    Vec3fScale,
    Vec3fScaleByInverse,
    Vec3fScaleInPlace,
    Vec3fSubtract,
    Vec3fSubtractInPlace,
} from "./vecmath.js";

const TRACK_CLEARANCE = f(0.1);
const CHASE_DISTANCE = f(11.0);
const CHASE_DISTANCE_SPLIT_SCREEN = f(19.8);
const CHASE_HEIGHT = f(2.4);
const CHASE_DISTANCE_AFTER_SEASON = f(13.0);
const LOOK_AT_HEIGHT = f(0.66);
const LOCKED_LOOK_AT_HEIGHT = f(1.1);
const LOOK_AHEAD_SLOW = f(2.0);
const LOOK_AHEAD_SLOW_SPEED = f(3.5);
const LOOK_AHEAD_FAST_SPEED = f(7.0);
const LOOK_AHEAD_SLOPE = f(0.571428597);
const LOOK_AHEAD_STEP = f(0.1);
const CHASE_SPEED_FLOOR = f(2.5);
const CHASE_SPEED_MAX = f(31.4159279);
const CHASE_LAG_SCALE = f(0.3);
const CHASE_KEEP = f(0.95);
const CHASE_NEW = f(0.05);
const CHASE_PULL_SCALE = f(18.181818);
const CHASE_LAG_NUMERATOR = f(0.15);
const CHASE_LAG_NUMERATOR_REPLAY = f(0.5);
const CHASE_THRESHOLD = f(0.07);
const CHASE_SPEED_COEFF = f(0.00954929646);
const PULL_MIN = f(0.02);
const PULL_MAX = f(0.055);
const PULL_STEP = f(0.01);
const PULL_DEFAULT = f(0.05);
const PULL_DECAY = f(0.005);
const REPLAY_HOLD_FRAMES = 30;
const REPLAY_SWITCH_FRAMES = 60;
const COCKPIT_AIM_DISTANCE = f(-20.0);
const BUMPER_FORWARD = f(0.5);
const TRACKSIDE_NEAR = f(1.0);
const TRACKSIDE_FAR = f(101.0);
const TRACKSIDE_FAR_DISTANCE = f(100.0);
const TRACKSIDE_COS_SCALE = f(0.0418879017);
const TRACKSIDE_COS_WEIGHT = f(0.1);
const TRACKSIDE_BIAS = f(0.7);
const TRACKSIDE_MID = f(51.0);
const TRACKSIDE_DISTANCE_SCALE = f(0.004);
const START_CHASE_HEIGHT = f(4.0);
const START_CHASE_REPLAY_FORWARD = f(10.0);
const START_LOOK_AHEAD = f(2.0);
const TRACKSIDE_FORWARD = f(6.0);
const TRACKSIDE_SIDE = f(2.0);
const FRUSTUM_CORNER_SHARE = f(0.75);

export const FRUSTUM_POINTS = 6;
export const FRUSTUM_CAMERA = 0;
export const FRUSTUM_RIGHT_TOP = 1;
export const FRUSTUM_LEFT_TOP = 2;
export const FRUSTUM_LEFT_BOTTOM = 3;
export const FRUSTUM_RIGHT_BOTTOM = 4;
export const FRUSTUM_FAR = 5;

export const cameraGlobals = {
    g_bVehicleTrackCollisionCorrected: 0,
    g_pActiveCameraVehicle: null as Vehicle | null,
    g_dwCameraRayHitCount: 0,
    g_dwRearViewMirrorMode: 0,
    g_fCameraRayGroundDistance: 0,
    g_dwCameraRayGroundSurface: 0,
    g_dwCameraRayNearbyCount: 0,
    gFrustumFar: 0,
    g_fFrustumFovAngle: 0,
};

export const g_awCameraRayHitInstances: number[] = new Array<number>(RAY_INSTANCES).fill(0);
export const g_awCameraRayNearbyInstances: number[] = new Array<number>(RAY_INSTANCES).fill(0);
export const g_afFrustumCenter: Vec3f = vec3();
export const g_vFrustumHalfRight: Vec3f = vec3();
export const g_vFrustumHalfUp: Vec3f = vec3();
export const g_avFrustumPoints: Vec3f[] = Array.from({ length: FRUSTUM_POINTS }, () => vec3());

function FindTrackHit(slots: number[], slotCount: number, start: Vec3f, direction: Vec3f, limit: number, hitPoint: Vec3f): TrackTriangle | null {
    const toVertex = vec3();
    const point = vec3();
    let hit: TrackTriangle | null = null;
    for (let i = 0; i < slotCount; i++) {
        const triangles = g_aTriCacheTriangles[slots[i]];
        const end = g_awTriCacheTriCount[slots[i]];
        for (let k = 0; k !== end; k++) {
            const triangle = triangles[k];
            const facing = Vec3fDot(direction, triangle.normal);
            if (!(facing < 0.0)) {
                continue;
            }
            Vec3fSubtract(toVertex, triangle.vertices[0], start);
            const t = f(Vec3fDot(toVertex, triangle.normal) / facing);
            if (!(0.0 < t) || !(t < limit)) {
                continue;
            }
            Vec3fMulAdd(point, start, direction, t);
            if (PointInTriangle3D(point, triangle.vertices[0], triangle.vertices[1], triangle.vertices[2], triangle.normal)) {
                limit = t;
                hit = triangle;
                copyVec3(hitPoint, point);
            }
        }
    }
    return hit;
}

export function ResolveVehicleTrackCollision(vehicle: Vehicle, camera: CameraFrame, target: Vec3f): void {
    const direction = vec3();
    const hitPoint = vec3();
    const offset = vec3();
    const slots = [0, 0];

    cameraGlobals.g_bVehicleTrackCollisionCorrected = 0;
    slots[0] = BuildTrackTriangleCache(vehicle.lookAt.x, vehicle.lookAt.y);
    slots[1] = BuildTrackTriangleCache(camera.position.x, camera.position.y);
    const slotCount = slots[0] === slots[1] ? 1 : 2;

    Vec3fSubtract(direction, camera.position, vehicle.lookAt);
    const length = Vec3fLength(direction);
    let limit = length !== 0.0 ? f(f(length + TRACK_CLEARANCE) / length) : 1.0;
    let hit = FindTrackHit(slots, slotCount, vehicle.lookAt, direction, limit, hitPoint);
    if (hit === null) {
        return;
    }

    Vec3fSubtract(direction, camera.position, target);
    limit = 1.0;
    hit = FindTrackHit(slots, slotCount, target, direction, limit, hitPoint);
    if (hit === null) {
        return;
    }
    const distance = Vec3fDistance(camera.position, vehicle.lookAt);
    Vec3fMulAdd(camera.position, hitPoint, hit.normal, TRACK_CLEARANCE);
    Vec3fSubtract(offset, camera.position, vehicle.lookAt);
    const newLength = Vec3fLength(offset);
    if (distance < newLength && newLength !== 0.0) {
        Vec3fScaleInPlace(offset, f(distance / newLength));
        Vec3fAdd(camera.position, vehicle.lookAt, offset);
    }
    cameraGlobals.g_bVehicleTrackCollisionCorrected = 1;
}

export function UpdateCameraChase(vehicle: Vehicle, camera: CameraFrame, share: number): void {
    const offset = vec3();

    if (vehicle.flyMode) {
        Vec3fMulAdd(camera.position, vehicle.frame.position, vehicle.frame.up, CHASE_HEIGHT);
        Vec3fMulAdd(camera.position, camera.position, vehicle.frame.forward, G.g_dwNumViewports === 1 ? -CHASE_DISTANCE : -CHASE_DISTANCE_SPLIT_SCREEN);
        return;
    }

    camera.position.z = f(camera.position.z - CHASE_HEIGHT);
    Vec3fSubtract(offset, camera.position, vehicle.frame.position);
    let length = Vec3fLength(offset);
    if (length !== 0.0) {
        if (G.g_dwNumViewports === 1) {
            Vec3fScaleInPlace(offset, f(CHASE_DISTANCE / length));
        } else {
            Vec3fScaleInPlace(offset, f(CHASE_DISTANCE_SPLIT_SCREEN / length));
        }
    }

    if (G.gInstantReplayActive) {
        Vec3fScale(camera.position, vehicle.frame.forward, CHASE_DISTANCE);
    } else if (G.g_dwGameMode === GAME_MODE_AFTER_SEASON) {
        Vec3fScale(camera.position, vehicle.frame.side, -CHASE_DISTANCE);
        Vec3fMulAddInPlace(camera.position, vehicle.frame.forward, -CHASE_DISTANCE_AFTER_SEASON);
    } else {
        Vec3fScale(camera.position, vehicle.frame.forward, -CHASE_DISTANCE);
    }
    length = Vec3fLength(camera.position);
    if (length !== 0.0) {
        Vec3fScaleInPlace(camera.position, f(CHASE_DISTANCE / length));
    }

    Vec3fLerp(camera.position, camera.position, offset, share);
    Vec3fAddInPlace(camera.position, vehicle.frame.position);
    camera.position.z = f(camera.position.z + CHASE_HEIGHT);
}

export function UpdateCameraLookAtTarget(vehicle: Vehicle): void {
    if (vehicle.flyMode) {
        Vec3fMulAdd(vehicle.lookAt, vehicle.frame.position, vehicle.frame.up, LOCKED_LOOK_AT_HEIGHT);
        return;
    }
    vehicle.lookAt.x = vehicle.frame.position.x;
    vehicle.lookAt.y = vehicle.frame.position.y;
    vehicle.lookAt.z = f(vehicle.frame.position.z + LOOK_AT_HEIGHT);
    const speed = Vec3fLength(vehicle.body.state.angularVelocity);
    if (G.g_dwGameMode === GAME_MODE_AFTER_SEASON) {
        return;
    }

    let target = 0.0;
    if (speed < LOOK_AHEAD_SLOW_SPEED) {
        target = LOOK_AHEAD_SLOW;
    } else if (speed < LOOK_AHEAD_FAST_SPEED) {
        target = f(4.0 - f(speed * LOOK_AHEAD_SLOPE));
    }
    if (vehicle.lookAhead < target) {
        vehicle.lookAhead = f(vehicle.lookAhead + LOOK_AHEAD_STEP);
        if (target < vehicle.lookAhead) {
            vehicle.lookAhead = target;
        }
    } else if (target < vehicle.lookAhead) {
        vehicle.lookAhead = f(vehicle.lookAhead - LOOK_AHEAD_STEP);
        if (vehicle.lookAhead < target) {
            vehicle.lookAhead = target;
        }
    }
    Vec3fMulAddInPlace(vehicle.lookAt, vehicle.frame.forward, vehicle.lookAhead);
}

export function ComputeCameraBasis(vehicle: Vehicle, camera: CameraFrame): void {
    const direction = vec3();

    Vec3fSubtract(direction, vehicle.lookAt, camera.position);
    const length = Vec3fLength(direction);
    if (length !== 0.0) {
        Vec3fScaleByInverse(camera.forward, direction, length);
    } else if (Vec3fLength(camera.forward) === 0.0) {
        camera.forward.x = vehicle.frame.forward.x;
        camera.forward.y = vehicle.frame.forward.y;
        camera.forward.z = vehicle.frame.forward.z;
    }
    if (vehicle.flyMode) {
        Vec3fCross(camera.side, vehicle.frame.up, camera.forward);
    } else {
        direction.x = 0.0;
        direction.y = 0.0;
        direction.z = 1.0;
        Vec3fCross(camera.side, direction, camera.forward);
    }
    Vec3fCross(camera.up, camera.forward, camera.side);
}

export function PlaceTrackCamera(vehicle: Vehicle): void {
    const trackside = vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE];
    vehicle.activeCamera = trackside;
    Vec3fMulAdd(trackside.position, vehicle.frame.position, vehicle.frame.forward, TRACKSIDE_FORWARD);
    Vec3fMulAddInPlace(trackside.position, vehicle.frame.side, TRACKSIDE_SIDE);
    Vec3fAddInPlace(trackside.position, vehicle.frame.up);
    vehicle.cameraChanged = 2;
}

export function UpdateCameraSystem(vehicle: Vehicle): void {
    const target = vec3();
    const chase = vehicle.cameras[VEHICLE_CAMERA_CHASE];
    const cockpit = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
    const bumper = vehicle.cameras[VEHICLE_CAMERA_BUMPER];
    const trackside = vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE];
    const mirror = vehicle.cameras[VEHICLE_CAMERA_MIRROR];

    target.x = chase.position.x;
    target.y = chase.position.y;
    target.z = chase.position.z;
    let speed = Vec3fLength(vehicle.body.state.angularVelocity);
    const lagSource = f(Vec3fLength(vehicle.body.state.velocity) * CHASE_LAG_SCALE);
    let lag = lagSource;
    speed = speed > CHASE_SPEED_FLOOR ? f(speed - CHASE_SPEED_FLOOR) : 0.0;
    if (CHASE_SPEED_MAX < speed) {
        speed = CHASE_SPEED_MAX;
    }
    if (CHASE_SPEED_MAX < lagSource) {
        lag = CHASE_SPEED_MAX;
    }
    if (vehicle.chaseSpeed < speed) {
        vehicle.chaseSpeed = speed;
    } else {
        vehicle.chaseSpeed = f(f(vehicle.chaseSpeed * CHASE_KEEP) + f(speed * CHASE_NEW));
    }
    vehicle.chaseLag = f(f(vehicle.chaseLag * CHASE_KEEP) + f(lag * CHASE_NEW));
    const pull = vehicle.collisionPull;
    chase.position.x = vehicle.chasePosition.x;
    chase.position.y = vehicle.chasePosition.y;
    chase.position.z = vehicle.chasePosition.z;
    vehicle.chaseLag = f(vehicle.chaseLag * f(1.0 - f(pull * CHASE_PULL_SCALE)));

    const lagNumerator = G.gInstantReplayActive ? CHASE_LAG_NUMERATOR_REPLAY : CHASE_LAG_NUMERATOR;
    const chaseTerm = f(vehicle.chaseSpeed * CHASE_SPEED_COEFF);
    const lagTerm = f(vehicle.chaseLag * f(lagNumerator / CHASE_SPEED_MAX));
    if (CHASE_THRESHOLD < f(pull + f(chaseTerm - lagTerm))) {
        UpdateCameraChase(vehicle, chase, 0.0);
    } else {
        UpdateCameraChase(vehicle, chase, f(f(f(CHASE_THRESHOLD - pull) - chaseTerm) + lagTerm));
    }
    UpdateCameraLookAtTarget(vehicle);
    vehicle.chasePosition.x = chase.position.x;
    vehicle.chasePosition.y = chase.position.y;
    vehicle.chasePosition.z = chase.position.z;

    if (!vehicle.flyMode) {
        ResolveVehicleTrackCollision(vehicle, chase, target);
        if (cameraGlobals.g_bVehicleTrackCollisionCorrected) {
            if (G.gInstantReplayActive) {
                G.g_dwReplayCameraHoldTimer = REPLAY_HOLD_FRAMES;
                if (vehicle.activeCamera === chase) {
                    vehicle.activeCamera = cockpit;
                    vehicle.cameraChanged = 2;
                    G.g_dwReplayCameraSwitchTimer = REPLAY_SWITCH_FRAMES;
                }
            }
            if (vehicle.collisionPull < PULL_MIN) {
                vehicle.collisionPull = PULL_MIN;
            } else {
                vehicle.collisionPull = f(vehicle.collisionPull + PULL_STEP);
                if (PULL_MAX < vehicle.collisionPull) {
                    vehicle.collisionPull = PULL_MAX;
                }
            }
            vehicle.collisionPull = PULL_DEFAULT;
        } else {
            if (G.g_dwReplayCameraHoldTimer !== 0) {
                G.g_dwReplayCameraHoldTimer--;
            }
            vehicle.collisionPull = f(vehicle.collisionPull - PULL_DECAY);
            if (vehicle.collisionPull < 0.0) {
                vehicle.collisionPull = 0.0;
            }
        }
    }

    ComputeCameraBasis(vehicle, chase);

    const frame = vehicle.frame;
    if (vehicle.flyMode) {
        copyCameraFrame(cockpit, frame);
    } else {
        const model = vehicle.model!;
        cockpit.position.x = f(f(model.cockpitUp * frame.up.x) + f(frame.position.x + f(frame.forward.x * model.cockpitForward)));
        cockpit.position.y = f(f(model.cockpitUp * frame.up.y) + f(frame.position.y + f(frame.forward.y * model.cockpitForward)));
        cockpit.position.z = f(f(model.cockpitUp * frame.up.z) + f(frame.position.z + f(frame.forward.z * model.cockpitForward)));
        Vec3fMulAddInPlace(cockpit.forward, frame.forward, COCKPIT_AIM_DISTANCE);
        Vec3fNegate(cockpit.forward, cockpit.forward);
        Vec3fNormalize(cockpit.forward);
        copyVec3(cockpit.side, frame.side);
        Vec3fCross(cockpit.up, cockpit.forward, cockpit.side);
    }

    copyCameraFrame(bumper, cockpit);
    Vec3fMulAddInPlace(bumper.position, frame.forward, BUMPER_FORWARD);

    trackside.up.x = 0.0;
    trackside.up.y = 0.0;
    trackside.up.z = 1.0;
    Vec3fAdd(trackside.forward, frame.position, frame.up);
    Vec3fSubtractInPlace(trackside.forward, trackside.position);
    let distance = Vec3fLength(trackside.forward);
    Vec3fDivideInPlace(trackside.forward, distance);
    Vec3fCross(trackside.side, trackside.up, trackside.forward);
    Vec3fCross(trackside.up, trackside.forward, trackside.side);
    if (distance <= TRACKSIDE_NEAR) {
        distance = 0.0;
    } else if (TRACKSIDE_FAR <= distance) {
        distance = TRACKSIDE_FAR_DISTANCE;
    } else {
        distance = f(distance - TRACKSIDE_NEAR);
    }
    const zoom = f(
        f(f(cosf(f(f(distance - 1.0) * TRACKSIDE_COS_SCALE)) * TRACKSIDE_COS_WEIGHT) + TRACKSIDE_BIAS) +
            f(f(TRACKSIDE_MID - distance) * TRACKSIDE_DISTANCE_SCALE),
    );
    trackside.fov = f(zoom * G.g_fCameraFovRadians);
    bumper.fov = G.g_fCameraFovRadians;
    chase.fov = G.g_fCameraFovRadians;
    cockpit.fov = G.g_fCameraFovRadians;
    mirror.fov = G.g_fCameraFovRadians;

    const model = vehicle.model!;
    mirror.position.x = f(f(model.cockpitUp * frame.up.x) + f(frame.position.x + f(f(frame.forward.x * model.mirrorForward) + f(frame.forward.x * model.mirrorForward))));
    mirror.position.y = f(f(model.cockpitUp * frame.up.y) + f(frame.position.y + f(f(frame.forward.y * model.mirrorForward) + f(frame.forward.y * model.mirrorForward))));
    mirror.position.z = f(f(model.cockpitUp * frame.up.z) + f(frame.position.z + f(f(frame.forward.z * model.mirrorForward) + f(frame.forward.z * model.mirrorForward))));
    mirror.forward.x = -frame.forward.x;
    mirror.forward.y = -frame.forward.y;
    mirror.forward.z = -frame.forward.z;
    mirror.side.x = -frame.side.x;
    mirror.side.z = -frame.side.z;
    mirror.side.y = -frame.side.y;
    copyVec3(mirror.up, frame.up);
    vehicle.previousCamera = vehicle.activeCamera;
}

export function InitCameraForVehicle(vehicle: Vehicle): void {
    const position = vec3();
    const chase = vehicle.cameras[VEHICLE_CAMERA_CHASE];

    if (G.g_dwGameMode === GAME_MODE_AFTER_SEASON) {
        vehicle.activeCamera = chase;
        vehicle.previousCamera = chase;
    } else {
        vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
        vehicle.previousCamera = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
    }
    Vec3fMulAdd(chase.position, vehicle.frame.position, vehicle.frame.up, START_CHASE_HEIGHT);
    if (G.gInstantReplayActive) {
        Vec3fMulAddInPlace(chase.position, vehicle.frame.forward, START_CHASE_REPLAY_FORWARD);
    }
    Vec3fSubtractInPlace(chase.position, vehicle.frame.forward);
    position.x = chase.position.x;
    position.y = chase.position.y;
    position.z = chase.position.z;
    const trackside = vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE];
    trackside.position.x = position.x;
    vehicle.chasePosition.x = position.x;
    vehicle.initialChasePosition.x = position.x;
    trackside.position.y = position.y;
    vehicle.chasePosition.y = position.y;
    vehicle.initialChasePosition.y = position.y;
    trackside.position.z = position.z;
    vehicle.chasePosition.z = position.z;
    vehicle.initialChasePosition.z = position.z;
    vehicle.collisionPull = 0.0;
    vehicle.lookAhead = START_LOOK_AHEAD;
}

export function ClearCameraChanged(vehicle: Vehicle): void {
    vehicle.cameraChanged = 0;
}

export function SetupFrustumCorners(camera: CameraFrame, fov: number, farDistance: number, width: number, height: number): void {
    const halfWidth = f(sinf(fov) * farDistance);
    let halfHeight = f(f(halfWidth * height) / width);
    const points = g_avFrustumPoints;

    if (G.g_dwNumViewports === 2) {
        halfHeight = f(halfHeight * 0.5);
    }
    points[FRUSTUM_CAMERA].x = camera.position.x;
    points[FRUSTUM_CAMERA].y = camera.position.y;
    points[FRUSTUM_CAMERA].z = camera.position.z;
    Vec3fMulAdd(g_afFrustumCenter, points[FRUSTUM_CAMERA], camera.forward, farDistance);
    Vec3fScale(g_vFrustumHalfRight, camera.side, halfWidth);
    Vec3fScale(g_vFrustumHalfUp, camera.up, halfHeight);
    points[FRUSTUM_FAR].x = g_afFrustumCenter.x;
    points[FRUSTUM_FAR].y = g_afFrustumCenter.y;
    points[FRUSTUM_FAR].z = g_afFrustumCenter.z;

    Vec3fAdd(points[FRUSTUM_RIGHT_TOP], g_afFrustumCenter, g_vFrustumHalfRight);
    Vec3fAddInPlace(points[FRUSTUM_RIGHT_TOP], g_vFrustumHalfUp);
    Vec3fAdd(points[FRUSTUM_RIGHT_BOTTOM], g_afFrustumCenter, g_vFrustumHalfRight);
    Vec3fSubtractInPlace(points[FRUSTUM_RIGHT_BOTTOM], g_vFrustumHalfUp);
    Vec3fSubtract(points[FRUSTUM_LEFT_TOP], g_afFrustumCenter, g_vFrustumHalfRight);
    Vec3fAddInPlace(points[FRUSTUM_LEFT_TOP], g_vFrustumHalfUp);
    Vec3fSubtract(points[FRUSTUM_LEFT_BOTTOM], g_afFrustumCenter, g_vFrustumHalfRight);
    Vec3fSubtractInPlace(points[FRUSTUM_LEFT_BOTTOM], g_vFrustumHalfUp);

    Vec3fLerp(points[FRUSTUM_LEFT_TOP], points[FRUSTUM_LEFT_TOP], points[FRUSTUM_CAMERA], FRUSTUM_CORNER_SHARE);
    Vec3fLerp(points[FRUSTUM_LEFT_BOTTOM], points[FRUSTUM_LEFT_BOTTOM], points[FRUSTUM_CAMERA], FRUSTUM_CORNER_SHARE);
    Vec3fLerp(points[FRUSTUM_RIGHT_TOP], points[FRUSTUM_RIGHT_TOP], points[FRUSTUM_CAMERA], FRUSTUM_CORNER_SHARE);
    Vec3fLerp(points[FRUSTUM_RIGHT_BOTTOM], points[FRUSTUM_RIGHT_BOTTOM], points[FRUSTUM_CAMERA], FRUSTUM_CORNER_SHARE);
    cameraGlobals.gFrustumFar = farDistance;
    cameraGlobals.g_fFrustumFovAngle = fov;
}
