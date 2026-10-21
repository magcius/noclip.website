import { f, sqrtf } from "./f32.js";
import { G, GAME_MODE_AFTER_SEASON, GAME_MODE_ARCADE, GAME_MODE_CHAMPIONSHIP, GAME_MODE_DEMO, WEATHER_SNOW } from "./globals.js";
import { TRACK_SECTION_ALTERNATE } from "./track.js";
import {
    RACER_FINISHED,
    RACER_HELD,
    SEASONS,
    SEASON_RACES,
    TrackPoint,
    TrackSection,
    VEHICLE_CAMERA_BUMPER,
    VEHICLE_CAMERA_CHASE,
    VEHICLE_CAMERA_COCKPIT,
    VEHICLE_CAMERA_TRACKSIDE,
    Vec3f,
    Vehicle,
    copyVec3,
    vec3,
} from "./types.js";
import {
    TestLineSegmentIntersection,
    Vec3fAdd,
    Vec3fAddInPlace,
    Vec3fCross,
    Vec3fDirection,
    Vec3fDistance,
    Vec3fDot,
    Vec3fLength,
    Vec3fLerp,
    Vec3fMidpoint,
    Vec3fMulAddInPlace,
    Vec3fNormalize,
    Vec3fScale,
    Vec3fScaleInPlace,
    Vec3fSubtract,
} from "./vecmath.js";
import { SetVehicleVelocity, UpdateVehiclePhysicsFrame } from "./vehicle.js";
import { RespawnVehicle } from "./vehiclesetup.js";
import { PlaceTrackCamera } from "./camera.js";
import { TransferFlags } from "./input.js";

export const TRACE_DEPTH = 8;

const INPUT_RIGHT = 0x0001;
const INPUT_DOWN = 0x0002;
const INPUT_LEFT = 0x0004;
const INPUT_UP = 0x0008;
const INPUT_Z = 0x8000;
const INPUT_ACCELERATE = 0x00010000;
const INPUT_REVERSE = 0x00020000;
const INPUT_BRAKE = 0x00040000;
const INPUT_EBRAKE = 0x00080000;
const INPUT_VIEW_COCKPIT = 0x01000000;
const INPUT_VIEW_TRACKSIDE = 0x02000000;
const INPUT_VIEW_CHASE = 0x04000000;
const INPUT_VIEW_BUMPER = 0x08000000;
const INPUT_VIEWS = 0x0f000000;
const INPUT_RECORDED_ACTIONS = 0x003f0000;

const STEER_DEAD_ZONE = f(0.1);
const STEER_RANGE = f(0.9);
const DRIVE_DEAD_ZONE = f(0.25);
const DRIVE_RANGE = f(0.75);
const CAMERA_POINT_MAX_DROP = f(10.0);
const CAMERA_POINT_FAR = f(16777216.0);
const CAMERA_POINT_RANGE_SQUARED = f(22500.0);
const REPLAY_VIEW_FRAMES = 60;
const REPLAY_CHOSEN_VIEW_FRAMES = 450;
const JOLT_GRAVITY = f(0.326666683);
const JOLT_THRESHOLD = f(0.025);
const JOLT_MAX_ONCE = f(2.5);
const JOLT_MAX = f(5.0);
const VICTORY_LOOK_AHEAD = f(15.0);
const VICTORY_SPEED = f(27.0);
const VICTORY_SLOW_DISTANCE = f(114.5);
const VICTORY_END_DISTANCE = f(168.5);
const VICTORY_BRAKE_DISTANCE = f(167.5);
const VICTORY_STOP_DISTANCE = f(168.4);
const VICTORY_STEER_SCALE = f(3.0);
const VICTORY_CENTERING = f(0.2);
const TRACE_LANE_SHARE = f(0.2);
const AI_LOOK_BASE = f(20.0);
const AI_LOOK_PER_SPEED = f(3.0);
const AI_LOOK_MAX = f(80.0);
const AI_TARGET_FOLLOW = f(0.5);
const AI_TARGET_PULL = f(0.4);
const AI_LOOK_TIME = f(0.4);
const AI_CORRECT_SPEED = f(10.0);
const AI_SIGN_DEAD_ZONE = f(0.1);
const AI_WIDE_HALF_WIDTH = f(5.0);
const AI_SIDE_MARGIN = f(3.0);
const AI_NARROW_SHARE = f(0.4);
const AI_UNSTICK_FRAMES = 60;
const AI_STUCK_CHECK_FRAMES = 31;
const AI_STUCK_SPEED = f(1.0);
const AI_REVERSE_FLIP_FRAMES = 151;
const AI_REVERSE_RESET_FRAMES = 271;
const AI_REVERSE_RESET_TO = 30;
const AI_PASS_RANGE = f(90.0);
const AI_PASS_SIDE = f(3.0);
const AI_PASS_PUSH = f(10.0);
const AI_PASS_PUSH_MAX = f(5.0);
const AI_HOLD_SPEED = f(3.0);
const AI_HOLD_SCALE = f(0.015625);
const AI_HOLD_MAX = f(0.4);
const AI_ARCADE_SNOW_RETENTION = f(0.99);
const AI_ARCADE_RETENTION = f(0.999);
const AI_MAX_SPIN = f(1.0);
const ARCADE_WEATHERS = 3;

const DATA_SEGMENT_RAM = 0x8025f000;
const UP_AXIS_ADDRESS = 0x8028bab0;
const RETENTION_ADDRESS = 0x8028b9f0;
const REPLAY_COCKPIT_NEXT_ADDRESS = 0x8028b9ec;

const traceArray = (): Vec3f[] => Array.from({ length: TRACE_DEPTH }, () => vec3());

export const g_vUpAxis: Vec3f = vec3(0, 0, 1);
export const g_aafAiVelocityRetention: number[][][] = Array.from({ length: SEASONS }, () =>
    Array.from({ length: SEASON_RACES }, () => [0, 0]),
);
export const g_afVehicleJolts: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
export const g_avBestLeftLane = traceArray();
export const g_avBestCenterLine = traceArray();
export const g_avBestRightLane = traceArray();
export const g_avTraceLeftLane = traceArray();
export const g_avTraceLeftHalf = traceArray();
export const g_avTraceCenterLine = traceArray();
export const g_avTraceRightHalf = traceArray();
export const g_avTraceRightLane = traceArray();
export const g_vTraceFarPoint: Vec3f = vec3();
export const g_vTraceHalfwayPoint: Vec3f = vec3();
export const drivingGlobals = {
    g_bReplayCockpitNext: 0,
    g_dwBestTraceDepth: 0,
    g_pBestTraceSection: null as TrackSection | null,
    g_dwBestTracePoint: 0,
    g_dwBestTraceLength: 0,
    g_dwTraceUnusedA: 0,
    g_dwTraceUnusedB: 0,
    g_bTraceBlocked: 0,
    g_bAiNudgeLeft: 0,
    g_bAiNudgeRight: 0,
};

export function loadDrivingData(dataSegment: DataView): void {
    const at = (address: number): number => address - DATA_SEGMENT_RAM;
    g_vUpAxis.x = dataSegment.getFloat32(at(UP_AXIS_ADDRESS));
    g_vUpAxis.y = dataSegment.getFloat32(at(UP_AXIS_ADDRESS + 4));
    g_vUpAxis.z = dataSegment.getFloat32(at(UP_AXIS_ADDRESS + 8));
    for (let s = 0; s < SEASONS; s++) {
        for (let r = 0; r < SEASON_RACES; r++) {
            for (let k = 0; k < 2; k++) {
                g_aafAiVelocityRetention[s][r][k] = dataSegment.getFloat32(at(RETENTION_ADDRESS) + ((s * SEASON_RACES + r) * 2 + k) * 4);
            }
        }
    }
    drivingGlobals.g_bReplayCockpitNext = dataSegment.getInt32(at(REPLAY_COCKPIT_NEXT_ADDRESS));
}

export function ClearPerFrameVariables(): void {
    for (const lanes of [
        g_avBestLeftLane,
        g_avBestCenterLine,
        g_avBestRightLane,
        g_avTraceLeftLane,
        g_avTraceLeftHalf,
        g_avTraceCenterLine,
        g_avTraceRightHalf,
        g_avTraceRightLane,
    ]) {
        for (const v of lanes) {
            v.x = v.y = v.z = 0;
        }
    }
    g_vTraceFarPoint.x = g_vTraceFarPoint.y = g_vTraceFarPoint.z = 0;
    g_vTraceHalfwayPoint.x = g_vTraceHalfwayPoint.y = g_vTraceHalfwayPoint.z = 0;
    drivingGlobals.g_dwBestTraceDepth = 0;
    drivingGlobals.g_pBestTraceSection = null;
    drivingGlobals.g_dwBestTracePoint = 0;
    drivingGlobals.g_dwBestTraceLength = 0;
    drivingGlobals.g_dwTraceUnusedA = 0;
    drivingGlobals.g_dwTraceUnusedB = 0;
    drivingGlobals.g_bTraceBlocked = 0;
    drivingGlobals.g_bAiNudgeLeft = 0;
    drivingGlobals.g_bAiNudgeRight = 0;
}

export function AddVehicleJolt(index: number, amount: number): void {
    if (JOLT_MAX_ONCE < amount) {
        amount = JOLT_MAX_ONCE;
    }
    g_afVehicleJolts[index] = f(g_afVehicleJolts[index] + amount);
    if (JOLT_MAX < g_afVehicleJolts[index]) {
        g_afVehicleJolts[index] = JOLT_MAX;
    }
}

function IsVehicleViewed(vehicle: Vehicle): boolean {
    return (
        vehicle.index === G.g_aViewportRects[0].vehicleIndex ||
        (G.g_dwNumViewports >= 2 && vehicle.index === G.g_aViewportRects[1].vehicleIndex)
    );
}

function ChooseReplayCamera(vehicle: Vehicle): void {
    const trackside = vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE];
    const chosen = vec3();
    let best = CAMERA_POINT_FAR;
    for (const point of G.g_LoadedTrack.cameraPoints) {
        const dx = f(vehicle.frame.position.x - point.x);
        const dy = f(vehicle.frame.position.y - point.y);
        const dz = f(vehicle.frame.position.z - point.z);
        if (!(CAMERA_POINT_MAX_DROP < dz)) {
            const distance = f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
            if (distance < best) {
                best = distance;
                copyVec3(chosen, point);
            }
        }
    }
    if (best < CAMERA_POINT_RANGE_SQUARED) {
        if (
            vehicle.activeCamera !== trackside ||
            trackside.position.x !== chosen.x ||
            trackside.position.y !== chosen.y ||
            trackside.position.z !== chosen.z
        ) {
            vehicle.cameraChanged = 1;
        }
        copyVec3(trackside.position, chosen);
        vehicle.activeCamera = trackside;
    } else if (vehicle.activeCamera === trackside) {
        vehicle.cameraChanged = 1;
        if (drivingGlobals.g_bReplayCockpitNext || G.g_dwReplayCameraHoldTimer) {
            vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
        } else {
            vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_CHASE];
        }
        G.g_dwReplayCameraSwitchTimer = REPLAY_VIEW_FRAMES;
        drivingGlobals.g_bReplayCockpitNext = drivingGlobals.g_bReplayCockpitNext ? 0 : 1;
    }
}

function ChooseVehicleView(vehicle: Vehicle): void {
    const input = vehicle.input!;
    let choose = false;
    let hold = false;
    if (vehicle.racer!.status & RACER_FINISHED && IsVehicleViewed(vehicle)) {
        if (G.g_dwReplayCameraSwitchTimer === 0) {
            choose = true;
        }
    } else if (
        (G.g_dwGameMode === GAME_MODE_DEMO || G.g_dwGameMode === GAME_MODE_AFTER_SEASON || G.gInstantReplayActive) &&
        IsVehicleViewed(vehicle)
    ) {
        if (G.g_dwReplayCameraSwitchTimer !== 0) {
            G.g_dwReplayCameraSwitchTimer--;
            hold = true;
        } else {
            choose = true;
        }
    } else if (IsVehicleViewed(vehicle)) {
        G.g_dwReplayCameraSwitchTimer = 0;
    }
    if (choose) {
        ChooseReplayCamera(vehicle);
        hold = true;
    }
    if (hold && input.buttons & INPUT_VIEWS) {
        G.g_dwReplayCameraSwitchTimer = REPLAY_CHOSEN_VIEW_FRAMES;
    }
    if (input.buttons & INPUT_VIEW_COCKPIT) {
        vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
        vehicle.cameraChanged = 1;
        TransferFlags(input, INPUT_VIEW_COCKPIT);
    }
    if (input.buttons & INPUT_VIEW_TRACKSIDE) {
        PlaceTrackCamera(vehicle);
        vehicle.cameraChanged = 1;
        TransferFlags(input, INPUT_VIEW_TRACKSIDE);
    }
    if (input.buttons & INPUT_VIEW_CHASE) {
        vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_CHASE];
        vehicle.cameraChanged = 1;
        TransferFlags(input, INPUT_VIEW_CHASE);
    }
    if (G.g_dwNumViewports === 1 && input.buttons & INPUT_VIEW_BUMPER) {
        vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_BUMPER];
        vehicle.cameraChanged = 1;
        TransferFlags(input, INPUT_VIEW_BUMPER);
    }
}

function ReadVehicleControls(vehicle: Vehicle): void {
    const input = vehicle.input!;
    const steering = input.steering;
    if (STEER_DEAD_ZONE < steering) {
        vehicle.steering = f(f(steering - STEER_DEAD_ZONE) / STEER_RANGE);
        vehicle.steering = f(vehicle.steering * -vehicle.steering);
    } else if (steering < -STEER_DEAD_ZONE) {
        vehicle.steering = f(f(steering + STEER_DEAD_ZONE) / STEER_RANGE);
        vehicle.steering = f(vehicle.steering * vehicle.steering);
    } else {
        vehicle.steering = 0;
    }
    ChooseVehicleView(vehicle);
    const stickY = input.stickY;
    if (DRIVE_DEAD_ZONE < stickY) {
        vehicle.accelerator = f(f(stickY - DRIVE_DEAD_ZONE) / DRIVE_RANGE);
        vehicle.accelerator = f(vehicle.accelerator * vehicle.accelerator);
    } else if (stickY < -DRIVE_DEAD_ZONE) {
        vehicle.accelerator = f(f(stickY + DRIVE_DEAD_ZONE) / DRIVE_RANGE);
        vehicle.accelerator = f(vehicle.accelerator * -vehicle.accelerator);
    } else {
        vehicle.accelerator = 0;
    }
    if (vehicle.flyMode) {
        vehicle.rollInput = 0;
    }
    const buttons = input.buttons;
    if (buttons & INPUT_Z) {
        if (!vehicle.flyMode) {
            vehicle.accelerator = 1;
        }
    } else if (vehicle.flyMode) {
        vehicle.pitchInput = vehicle.accelerator;
        vehicle.accelerator = 0;
    }
    if (input.buttons & INPUT_UP) {
        vehicle.accelerator = 1;
    }
    if (input.buttons & INPUT_DOWN) {
        vehicle.accelerator = -1;
    }
    if (input.buttons & INPUT_RIGHT) {
        if (vehicle.flyMode) {
            vehicle.rollInput = 1;
        } else {
            vehicle.steering = -1;
        }
    }
    if (input.buttons & INPUT_LEFT) {
        if (vehicle.flyMode) {
            vehicle.rollInput = -1;
        } else {
            vehicle.steering = 1;
        }
    }
}

function DriveAfterSeason(vehicle: Vehicle): void {
    const input = vehicle.input!;
    const ahead = vec3();
    const velocity = vec3();
    Vec3fMulAddInPlace(vehicle.frame.position, vehicle.frame.forward, VICTORY_LOOK_AHEAD);
    ComputeTrackPosition(vehicle);
    copyVec3(ahead, vehicle.trackForward);
    Vec3fMulAddInPlace(vehicle.frame.position, vehicle.frame.forward, -VICTORY_LOOK_AHEAD);
    ComputeTrackPosition(vehicle);
    input.buttons = (input.buttons & ~(INPUT_VIEWS | INPUT_RECORDED_ACTIONS)) >>> 0;
    if (vehicle.distance < VICTORY_SLOW_DISTANCE) {
        Vec3fScale(velocity, vehicle.trackForward, VICTORY_SPEED);
    } else {
        Vec3fScale(velocity, vehicle.trackForward, f(f(VICTORY_END_DISTANCE - vehicle.distance) * 0.5));
        if (VICTORY_BRAKE_DISTANCE < vehicle.distance) {
            input.buttons = (input.buttons | INPUT_BRAKE) >>> 0;
            if (VICTORY_STOP_DISTANCE < vehicle.distance) {
                velocity.x = velocity.y = velocity.z = 0;
            }
        } else {
            input.buttons = (input.buttons | INPUT_EBRAKE) >>> 0;
        }
    }
    vehicle.steerAngle = f(Vec3fDot(ahead, vehicle.frame.side) * VICTORY_STEER_SCALE);
    velocity.x = f(velocity.x - f(vehicle.trackOffset.x * VICTORY_CENTERING));
    velocity.y = f(velocity.y - f(vehicle.trackOffset.y * VICTORY_CENTERING));
    SetVehicleVelocity(vehicle, velocity.x, velocity.y, velocity.z);
}

function SwingJoltWeight(vehicle: Vehicle): void {
    const corner = vec3();
    const predicted = vec3();
    const previousOffset = vec3();
    Vec3fAdd(corner, vehicle.frame.position, vehicle.frame.forward);
    Vec3fAddInPlace(corner, vehicle.frame.side);
    Vec3fAdd(predicted, vehicle.joltPosition, vehicle.joltVelocity);
    copyVec3(previousOffset, vehicle.joltOffset);
    Vec3fSubtract(vehicle.joltOffset, vehicle.joltPosition, corner);
    const length = Vec3fLength(vehicle.joltOffset);
    if (length !== 0) {
        Vec3fScaleInPlace(vehicle.joltOffset, f(f(length / f(1 + length)) / length));
    }
    const jolt = f(sqrtf(Vec3fDistance(vehicle.joltOffset, previousOffset)) / f(Vec3fLength(vehicle.joltVelocity) + 1));
    if (JOLT_THRESHOLD < jolt) {
        AddVehicleJolt(vehicle.index, f(jolt + jolt));
    }
    copyVec3(vehicle.joltPosition, corner);
    Vec3fSubtract(vehicle.joltVelocity, vehicle.joltPosition, predicted);
    vehicle.joltVelocity.z = f(vehicle.joltVelocity.z - JOLT_GRAVITY);
}

export function ProcessVehicleInputAndPhysics(vehicle: Vehicle): void {
    const input = vehicle.input!;
    if (G.g_dwTrackMirrored) {
        input.steering = -input.steering;
    }
    ReadVehicleControls(vehicle);
    if (G.g_dwGameMode === GAME_MODE_AFTER_SEASON) {
        DriveAfterSeason(vehicle);
    }
    UpdateVehiclePhysicsFrame(vehicle);
    if (!vehicle.flyMode) {
        SwingJoltWeight(vehicle);
    }
    RespawnVehicle(vehicle);
}

export function UpdatePhysicsStep(vehicle: Vehicle): void {
    ProcessVehicleInputAndPhysics(vehicle);
}

function pointAt(section: TrackSection, index: number): TrackPoint {
    if (index >= 0 && index < section.points.length) {
        return section.points[index];
    }
    const track = G.g_LoadedTrack;
    const o = section.address - track.pointerBase + 0x40 + index * 0x28;
    const read = (p: number): Vec3f => vec3(track.view.getFloat32(p), track.view.getFloat32(p + 4), track.view.getFloat32(p + 8));
    return { left: read(o), position: read(o + 0x0c), right: read(o + 0x18), distance: track.view.getFloat32(o + 0x24) };
}

function copyTrace(out: Vec3f[], source: Vec3f[], count: number): void {
    for (let i = 0; i < count; i++) {
        copyVec3(out[i], source[i]);
    }
}

export function TraceTrackSplineRecursive(vehicle: Vehicle, depth: number, pointIndex: number, section: TrackSection | null): number {
    const D = drivingGlobals;
    let found = 0;
    if (section === null) {
        section = G.g_LoadedTrack.rootSection;
        pointIndex = 0;
    }
    if (depth === 0) {
        D.g_dwBestTraceDepth = 0;
        D.g_dwTraceUnusedB = 0;
        D.g_dwTraceUnusedA = 0;
        D.g_bTraceBlocked = 0;
    } else {
        if (depth > TRACE_DEPTH || section.flags & TRACK_SECTION_ALTERNATE) {
            return 0;
        }
        const last = depth - 1;
        const point = section.points[pointIndex];
        Vec3fLerp(g_avTraceRightLane[last], point.left, point.right, TRACE_LANE_SHARE);
        copyVec3(g_avTraceCenterLine[last], point.position);
        Vec3fLerp(g_avTraceLeftLane[last], point.right, point.left, TRACE_LANE_SHARE);
        Vec3fMidpoint(g_avTraceLeftHalf[last], g_avTraceLeftLane[last], g_avTraceCenterLine[last]);
        Vec3fMidpoint(g_avTraceRightHalf[last], g_avTraceRightLane[last], g_avTraceCenterLine[last]);
        const middle = { x: f(f(point.right.x + point.left.x) * 0.5), y: f(f(point.right.y + point.left.y) * 0.5) };
        let blocked = false;
        for (let i = 1; i < last; i++) {
            if (!TestLineSegmentIntersection(vehicle.frame.position, middle, g_avTraceLeftLane[i], g_avTraceRightLane[i])) {
                D.g_bTraceBlocked = 1;
                blocked = true;
                break;
            }
        }
        if (!blocked && D.g_dwBestTraceDepth < depth) {
            D.g_dwBestTraceDepth = depth;
            D.g_pBestTraceSection = section;
            D.g_dwBestTracePoint = pointIndex;
            if (depth >= 3) {
                if (TestLineSegmentIntersection(vehicle.frame.position, g_avTraceCenterLine[2], g_avTraceLeftHalf[1], g_avTraceLeftLane[1])) {
                    D.g_bAiNudgeLeft = 0;
                    D.g_bAiNudgeRight = 1;
                } else if (
                    TestLineSegmentIntersection(vehicle.frame.position, g_avTraceCenterLine[2], g_avTraceRightHalf[1], g_avTraceRightLane[1])
                ) {
                    D.g_bAiNudgeLeft = 1;
                    D.g_bAiNudgeRight = 0;
                } else {
                    D.g_bAiNudgeLeft = 0;
                    D.g_bAiNudgeRight = 0;
                }
            } else {
                D.g_bAiNudgeLeft = 0;
                D.g_bAiNudgeRight = 0;
            }
            copyVec3(g_vTraceHalfwayPoint, g_avTraceCenterLine[depth >> 1]);
            copyVec3(g_vTraceFarPoint, g_avTraceCenterLine[depth - 1]);
            copyTrace(g_avBestLeftLane, g_avTraceLeftLane, depth);
            copyTrace(g_avBestCenterLine, g_avTraceCenterLine, depth);
            copyTrace(g_avBestRightLane, g_avTraceRightLane, depth);
            D.g_dwBestTraceLength = depth;
            found = 1;
        }
    }
    pointIndex++;
    if (pointIndex === section.pointCount) {
        let child = section.child;
        if (child === null) {
            child = G.g_LoadedTrack.rootSection;
        }
        for (; child !== null; child = child.next) {
            found |= TraceTrackSplineRecursive(vehicle, depth + 1, 0, child);
        }
    } else {
        found |= TraceTrackSplineRecursive(vehicle, depth + 1, pointIndex, section);
    }
    return found;
}

export function ComputeTrackPosition(vehicle: Vehicle): void {
    const fromTangent = vec3();
    const toTangent = vec3();
    const fromMiddle = vec3();
    const toMiddle = vec3();
    const flat = vec3();
    const fromOffset = vec3();
    const toOffset = vec3();
    const section = vehicle.section!;
    const span = f(section.points[vehicle.pointIndex].distance - section.points[vehicle.pointIndex + 1].distance);
    Vec3fSubtract(fromTangent, section.points[vehicle.pointIndex].left, section.points[vehicle.pointIndex].position);
    Vec3fSubtract(toTangent, section.points[vehicle.pointIndex + 1].left, section.points[vehicle.pointIndex + 1].position);
    Vec3fMidpoint(toTangent, fromTangent, toTangent);
    fromTangent.x = -toTangent.y;
    fromTangent.y = toTangent.x;
    fromTangent.z = 0;
    Vec3fMidpoint(toTangent, section.points[vehicle.pointIndex].position, section.points[vehicle.pointIndex + 1].position);
    Vec3fSubtract(toTangent, vehicle.frame.position, toTangent);

    let fromSection: TrackSection;
    let toSection: TrackSection;
    let from: number;
    let to: number;
    if (Vec3fDot(fromTangent, toTangent) < 0) {
        fromSection = section;
        from = vehicle.pointIndex;
        if (from + 1 === fromSection.pointCount) {
            toSection = fromSection.child!;
            while (toSection.flags & TRACK_SECTION_ALTERNATE) {
                toSection = toSection.next!;
            }
            to = 0;
        } else {
            toSection = fromSection;
            to = from + 1;
        }
    } else {
        fromSection = section;
        from = vehicle.pointIndex - 1;
        toSection = section;
        to = vehicle.pointIndex;
    }

    const fromA = pointAt(fromSection, from);
    const fromB = pointAt(fromSection, from + 1);
    const toA = pointAt(toSection, to);
    const toB = pointAt(toSection, to + 1);
    Vec3fDirection(fromTangent, fromA.position, fromB.position);
    Vec3fDirection(toTangent, toA.position, toB.position);
    Vec3fScaleInPlace(fromTangent, f(span * 0.5));
    Vec3fScaleInPlace(toTangent, f(span * 0.5));
    Vec3fMidpoint(fromMiddle, fromA.position, fromB.position);
    Vec3fMidpoint(toMiddle, toA.position, toB.position);
    flat.x = vehicle.frame.position.x;
    flat.y = vehicle.frame.position.y;
    flat.z = 0;
    Vec3fSubtract(fromOffset, flat, fromMiddle);
    Vec3fSubtract(toOffset, flat, toMiddle);
    const fromAlong = Vec3fDot(fromOffset, fromTangent);
    const toAlong = -Vec3fDot(toOffset, toTangent);
    const length = Vec3fDistance(fromMiddle, toMiddle);
    const t = f(f(f(length * fromAlong) / f(fromAlong + toAlong)) / length);
    const t2 = f(t * t);
    const t3 = f(t2 * t);

    Vec3fScale(vehicle.trackPoint, fromMiddle, f(f(f(t3 + t3) - f(3 * t2)) + 1));
    Vec3fMulAddInPlace(vehicle.trackPoint, toMiddle, f(f(-2 * t3) + f(3 * t2)));
    Vec3fMulAddInPlace(vehicle.trackPoint, fromTangent, f(f(t3 - f(t2 + t2)) + t));
    Vec3fMulAddInPlace(vehicle.trackPoint, toTangent, f(t3 - t2));
    Vec3fLerp(vehicle.trackForward, toTangent, fromTangent, t);
    Vec3fNormalize(vehicle.trackForward);
    Vec3fCross(vehicle.trackSide, vehicle.trackUp, vehicle.trackForward);
    Vec3fNormalize(vehicle.trackSide);
    Vec3fCross(vehicle.trackUp, vehicle.trackForward, vehicle.trackSide);
    Vec3fSubtract(vehicle.trackOffset, vehicle.frame.position, vehicle.trackPoint);
    vehicle.trackSideOffset = Vec3fDot(vehicle.trackSide, vehicle.trackOffset);
    vehicle.trackSideDistance = vehicle.trackSideOffset < 0 ? -vehicle.trackSideOffset : vehicle.trackSideOffset;
}

function AiSign(value: number): number {
    if (AI_SIGN_DEAD_ZONE < value) {
        return 1;
    }
    if (value < -AI_SIGN_DEAD_ZONE) {
        return -1;
    }
    return 0;
}

function FindAiLookPoint(vehicle: Vehicle, out: Vec3f): void {
    let section = vehicle.section!;
    let index = vehicle.pointIndex;
    let look = f(f(Vec3fLength(vehicle.placedVelocity) * AI_LOOK_PER_SPEED) + AI_LOOK_BASE);
    copyVec3(out, section.points[index].position);
    if (AI_LOOK_MAX < look) {
        look = AI_LOOK_MAX;
    }
    let points = section.points;
    let p = index;
    for (;;) {
        const step = f(points[p].distance - points[p + 1].distance);
        index++;
        p++;
        look = f(look - step);
        if (index === section.pointCount) {
            section = section.child!;
            index = 0;
            while (section.flags & TRACK_SECTION_ALTERNATE) {
                section = section.next!;
            }
            points = section.points;
            p = 0;
        }
        if (look < 0) {
            break;
        }
    }
    copyVec3(out, points[p].position);
}

function MeasureAiRoutePosition(vehicle: Vehicle): number {
    const section = vehicle.section!;
    Vec3fDirection(vehicle.trackForward, section.points[vehicle.pointIndex].position, section.points[vehicle.pointIndex + 1].position);
    Vec3fSubtract(vehicle.trackSide, section.points[vehicle.pointIndex].left, section.points[vehicle.pointIndex].right);
    Vec3fCross(vehicle.trackUp, vehicle.trackForward, vehicle.trackSide);
    Vec3fNormalize(vehicle.trackUp);
    Vec3fCross(vehicle.trackSide, vehicle.trackUp, vehicle.trackForward);
    Vec3fNormalize(vehicle.trackSide);
    Vec3fSubtract(vehicle.trackOffset, vehicle.frame.position, section.points[vehicle.pointIndex].position);
    Vec3fMulAddInPlace(vehicle.trackOffset, vehicle.placedVelocity, AI_LOOK_TIME);
    return Vec3fDot(vehicle.trackSide, vehicle.trackOffset);
}

function CorrectAiLine(vehicle: Vehicle, sideOffset: number, sideDistance: number, heading: number, halfWidth: number, across: Vec3f): number {
    const D = drivingGlobals;
    const input = vehicle.input!;
    let limit: number;
    let steer = 0;
    if (AI_WIDE_HALF_WIDTH < halfWidth) {
        limit = f(halfWidth - AI_SIDE_MARGIN);
    } else {
        limit = f(halfWidth * AI_NARROW_SHARE);
    }
    const past = (): number => f(f(sideDistance - limit) / sideDistance);
    if (limit < sideDistance) {
        if (0 < sideOffset) {
            if (heading > -0.05) {
                D.g_bAiNudgeLeft = 0;
                D.g_bAiNudgeRight = 1;
                steer = f(f(f(heading * f(-0.2)) * past()) + f(0.03));
            } else if (heading < -0.15) {
                D.g_bAiNudgeLeft = 1;
                D.g_bAiNudgeRight = 0;
                steer = f(f(f(heading * f(-0.3)) * past()) + f(0.1));
            }
        } else if (heading < 0.05) {
            D.g_bAiNudgeLeft = 1;
            D.g_bAiNudgeRight = 0;
            steer = f(f(f(heading * f(0.2)) * past()) + f(0.03));
        } else if (heading > 0.15) {
            D.g_bAiNudgeLeft = 0;
            D.g_bAiNudgeRight = 1;
            steer = f(f(f(heading * f(0.3)) * past()) + f(0.1));
        }
    } else if (AI_CORRECT_SPEED < Vec3fLength(vehicle.placedVelocity)) {
        const velocitySign = AiSign(Vec3fDot(vehicle.placedVelocity, vehicle.trackSide));
        const wheelSign = AiSign(Vec3fDot(vehicle.wheelFrames[0].forward, across));
        const forwardSign = AiSign(Vec3fDot(vehicle.frame.forward, across));
        if (velocitySign !== 0 || forwardSign !== 0) {
            if (velocitySign !== 0 && velocitySign + forwardSign === 0) {
                if (velocitySign === 1 && wheelSign === 1) {
                    D.g_bAiNudgeRight = 0;
                    D.g_bAiNudgeLeft = 1;
                } else if (velocitySign === -1 && wheelSign === -1) {
                    D.g_bAiNudgeRight = 1;
                    D.g_bAiNudgeLeft = 0;
                }
                steer = f(0.1);
            } else if (velocitySign !== 0 && velocitySign === forwardSign) {
                if (velocitySign === 1 && wheelSign === 1) {
                    D.g_bAiNudgeRight = 1;
                    D.g_bAiNudgeLeft = 0;
                } else if (velocitySign === -1 && wheelSign === -1) {
                    D.g_bAiNudgeRight = 0;
                    D.g_bAiNudgeLeft = 1;
                }
                steer = f(0.4);
            } else if (wheelSign !== 0 || forwardSign !== 0) {
                if (wheelSign === 0 && velocitySign === 0) {
                    input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
                } else if (wheelSign === forwardSign) {
                    if (wheelSign === 1) {
                        D.g_bAiNudgeRight = 1;
                        D.g_bAiNudgeLeft = 0;
                    } else if (wheelSign === -1) {
                        D.g_bAiNudgeRight = 0;
                        D.g_bAiNudgeLeft = 1;
                    }
                    steer = f(0.5);
                    input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
                } else if (wheelSign === 0 || wheelSign + velocitySign !== 0) {
                    input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
                }
            }
        }
    }
    return steer;
}

function bestCenterLine(i: number): Vec3f {
    return i < TRACE_DEPTH ? g_avBestCenterLine[i] : g_avBestRightLane[i - TRACE_DEPTH];
}

function ReadAiLineAhead(vehicle: Vehicle): number {
    const input = vehicle.input!;
    const toLeft = vec3();
    const ahead = vec3();
    const normal = vec3();
    let i = 0;
    while (i < drivingGlobals.g_dwBestTraceDepth) {
        Vec3fSubtract(toLeft, g_avBestLeftLane[i], g_avBestCenterLine[i]);
        Vec3fSubtract(ahead, bestCenterLine(i + 1), g_avBestCenterLine[i]);
        Vec3fCross(normal, ahead, toLeft);
        Vec3fNormalize(normal);
        const climb = Vec3fDot(vehicle.placedVelocity, normal);
        const lateral = f(Vec3fDot(vehicle.placedVelocity, toLeft) * f(0.03));
        i++;
        let excess: number;
        if (climb < lateral) {
            excess = lateral;
        } else if (lateral < -climb) {
            excess = -lateral;
        } else {
            excess = climb;
        }
        if (f(i * 6) < excess) {
            input.buttons = ((input.buttons & ~INPUT_ACCELERATE) | INPUT_BRAKE) >>> 0;
            return 2;
        }
        if (f(i * 4.5) < excess) {
            input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
            return 2;
        }
        if (f(i * 3) < excess) {
            return f(1.3);
        }
    }
    return 1;
}

function ShapeAiSteering(side: number, steer: number): number {
    const D = drivingGlobals;
    if (steer < f(0.01)) {
        steer = f(0.01);
    }
    if (side < 0) {
        if (D.g_bAiNudgeLeft) {
            if (side < -f(f(0.2) / steer)) {
                side = f(side - f(steer * side));
            } else {
                side = f(side + f(0.2));
            }
        } else if (D.g_bAiNudgeRight) {
            if (side < -f(f(0.2) / steer)) {
                side = f(side + f(steer * side));
            } else {
                side = f(side - f(0.2));
            }
        }
        side = f(1 + side);
        return f(f(f(f(side * side) * side) * side) - 1);
    }
    if (D.g_bAiNudgeLeft) {
        if (f(f(0.2) / steer) < side) {
            side = f(side + f(steer * side));
        } else {
            side = f(side + f(0.2));
        }
    } else if (D.g_bAiNudgeRight) {
        if (f(f(0.2) / steer) < side) {
            side = f(side - f(steer * side));
        } else {
            side = f(side - f(0.2));
        }
    }
    side = f(1 - side);
    return f(1 - f(f(f(side * side) * side) * side));
}

function ApplyAiDrive(vehicle: Vehicle, side: number, forwardSpeed: number): void {
    const input = vehicle.input!;
    const speed = Vec3fLength(vehicle.placedVelocity);
    let reverse: boolean;
    if (0 <= vehicle.accelerator) {
        if (vehicle.forcedReverseFrames !== 0) {
            vehicle.forcedReverseFrames--;
            reverse = true;
        } else if (forwardSpeed < -1) {
            input.buttons = (input.buttons | INPUT_BRAKE) >>> 0;
            return;
        } else {
            reverse = false;
        }
    } else if (vehicle.forcedForwardFrames !== 0) {
        vehicle.forcedForwardFrames--;
        reverse = false;
    } else if (1 < forwardSpeed) {
        input.buttons = (input.buttons | INPUT_BRAKE) >>> 0;
        return;
    } else {
        reverse = true;
    }

    if (!reverse) {
        input.steering = -side;
        vehicle.forwardFrames++;
        if (vehicle.forwardFrames >= AI_STUCK_CHECK_FRAMES && speed < AI_STUCK_SPEED) {
            vehicle.forcedReverseFrames = AI_UNSTICK_FRAMES;
            vehicle.reverseFrames = 0;
            vehicle.forwardFrames = 0;
        }
        return;
    }
    input.buttons = (input.buttons | INPUT_ACCELERATE) >>> 0;
    input.steering = side < 0 ? -1 : 1;
    input.buttons = (input.buttons | INPUT_REVERSE) >>> 0;
    if (vehicle.reverseFrames >= AI_REVERSE_FLIP_FRAMES) {
        if (vehicle.reverseFrames >= AI_REVERSE_RESET_FRAMES) {
            vehicle.reverseFrames = AI_REVERSE_RESET_TO;
        } else {
            input.steering = f(input.steering * -1.0);
        }
    }
    vehicle.reverseFrames++;
    if (vehicle.reverseFrames >= AI_STUCK_CHECK_FRAMES && speed < AI_STUCK_SPEED) {
        vehicle.forcedForwardFrames = AI_UNSTICK_FRAMES;
        vehicle.reverseFrames = 0;
        vehicle.forwardFrames = 0;
    }
}

function PassAiVehicles(vehicle: Vehicle, sideOffset: number): number {
    let best = AI_PASS_RANGE;
    let push = 0;
    let found = -1;
    for (let i = 0; i < G.g_dwNumVehicles; i++) {
        const other = G.g_aRacerSlots[i].vehicle;
        if (other === null || other === vehicle) {
            continue;
        }
        const lapLength = G.g_LoadedTrack.rootSection.points[0].distance;
        let gap = f(other.distance - vehicle.distance);
        while (lapLength < gap) {
            gap = f(gap - lapLength);
        }
        while (gap < -lapLength) {
            gap = f(gap + lapLength);
        }
        if (0 < gap && gap < best) {
            best = gap;
            const sideGap = f(other.trackSideOffset - sideOffset);
            if (sideGap < AI_PASS_SIDE) {
                push = f(f(1 - f(gap * f(1 / 90))) * -AI_PASS_PUSH);
                if (push < -AI_PASS_PUSH_MAX) {
                    push = -AI_PASS_PUSH_MAX;
                }
                found = i;
            } else if (-AI_PASS_SIDE < sideGap) {
                push = f(f(1 - f(gap * f(1 / 90))) * AI_PASS_PUSH);
                if (AI_PASS_PUSH_MAX < push) {
                    push = AI_PASS_PUSH_MAX;
                }
                found = i;
            }
        }
    }
    if (found !== -1) {
        sideOffset = f(sideOffset + push);
        vehicle.trackSideDistance = sideOffset < 0 ? -sideOffset : sideOffset;
    }
    return sideOffset;
}

function HoldAiToRoute(vehicle: Vehicle, sideOffset: number, halfWidth: number, forwardSpeed: number): void {
    const velocity = vehicle.body.state.velocity;
    if (vehicle.trackSideDistance < f(halfWidth + 1)) {
        let hold = f(f(forwardSpeed - AI_HOLD_SPEED) * AI_HOLD_SCALE);
        if (hold < 0) {
            hold = f(hold * f(-0.25));
        }
        if (AI_HOLD_MAX < hold) {
            hold = AI_HOLD_MAX;
        }
        const along = Vec3fDot(velocity, vehicle.trackForward);
        Vec3fDot(velocity, vehicle.trackSide);
        const upward = Vec3fDot(velocity, vehicle.trackUp);
        const across = -f(sideOffset * hold);
        Vec3fScale(velocity, vehicle.trackForward, along);
        Vec3fMulAddInPlace(velocity, vehicle.trackSide, across);
        Vec3fMulAddInPlace(velocity, vehicle.trackUp, upward);
    }
    if (G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP) {
        Vec3fScaleInPlace(velocity, g_aafAiVelocityRetention[G.g_pActiveProfile.season][G.g_pActiveProfile.round][vehicle.racer!.straggler]);
    } else if (G.g_dwGameMode === GAME_MODE_ARCADE) {
        let weather = (((G.g_dwCurrentWeather - 1) << 16) >> 16);
        if (weather >= ARCADE_WEATHERS || weather < 0) {
            weather = 0;
        }
        Vec3fScaleInPlace(velocity, weather === WEATHER_SNOW - 1 ? AI_ARCADE_SNOW_RETENTION : AI_ARCADE_RETENTION);
    }
}

function PlanAiDrive(vehicle: Vehicle): void {
    const D = drivingGlobals;
    const input = vehicle.input!;
    const target = vec3();
    const direction = vec3();
    const across = vec3();
    const unread = vec3();
    const edge = vec3();
    if (input.buttons & INPUT_VIEW_TRACKSIDE) {
        vehicle.cameraChanged = 1;
        PlaceTrackCamera(vehicle);
    }
    FindAiLookPoint(vehicle, target);
    if (TraceTrackSplineRecursive(vehicle, 0, vehicle.pointIndex, vehicle.section)) {
        Vec3fMidpoint(g_vTraceFarPoint, g_vTraceFarPoint, g_vTraceHalfwayPoint);
        if (vehicle.aiTarget.x === 0 && vehicle.aiTarget.y === 0 && vehicle.aiTarget.z === 0) {
            copyVec3(vehicle.aiTarget, g_vTraceFarPoint);
        } else {
            Vec3fLerp(vehicle.aiTarget, vehicle.aiTarget, g_vTraceFarPoint, f(AI_TARGET_FOLLOW + G.g_fFrameDeltaTime));
        }
    }
    Vec3fLerp(vehicle.aiTarget, vehicle.aiTarget, target, AI_TARGET_PULL);
    const forwardSpeed = Vec3fDot(vehicle.placedVelocity, vehicle.frame.forward);
    Vec3fDirection(direction, vehicle.frame.position, vehicle.aiTarget);
    const up = copyVec3(vec3(), g_vUpAxis);
    Vec3fCross(across, up, direction);
    Vec3fCross(unread, direction, across);
    let side = Vec3fDot(vehicle.frame.side, direction);
    vehicle.accelerator = Vec3fDot(vehicle.frame.forward, direction);
    input.buttons = (input.buttons | INPUT_ACCELERATE) >>> 0;

    let sideOffset = MeasureAiRoutePosition(vehicle);
    const heading = Vec3fDot(vehicle.frame.forward, vehicle.trackSide);
    D.g_bAiNudgeLeft = 0;
    D.g_bAiNudgeRight = 0;
    const sideDistance = sideOffset < 0 ? -sideOffset : sideOffset;
    const point = vehicle.section!.points[vehicle.pointIndex];
    Vec3fSubtract(edge, point.left, point.position);
    const halfWidth = Vec3fDot(vehicle.trackSide, edge);
    const steer = CorrectAiLine(vehicle, sideOffset, sideDistance, heading, halfWidth, across);

    const multiplier = ReadAiLineAhead(vehicle);
    if (AI_CORRECT_SPEED < Vec3fLength(vehicle.placedVelocity)) {
        side = f(side * multiplier);
        if (1 < side) {
            input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
            side = 1;
        } else if (side < -1) {
            side = -1;
            input.buttons = (input.buttons & ~INPUT_ACCELERATE) >>> 0;
        }
    }
    side = ShapeAiSteering(side, steer);
    ApplyAiDrive(vehicle, side, forwardSpeed);

    ComputeTrackPosition(vehicle);
    sideOffset = PassAiVehicles(vehicle, sideOffset);
    if (AI_HOLD_SPEED < forwardSpeed) {
        HoldAiToRoute(vehicle, sideOffset, halfWidth, forwardSpeed);
    }
}

export function UpdateAiVehicleBehavior(vehicle: Vehicle): void {
    const spin = vehicle.body.state.angularVelocity;
    if (!(vehicle.racer!.status & RACER_HELD)) {
        PlanAiDrive(vehicle);
    }
    const length = Vec3fLength(spin);
    if (AI_MAX_SPIN < length && vehicle.wheelBodies[0].contactFrames) {
        Vec3fScaleInPlace(spin, f(1 / length));
    }
    UpdateVehiclePhysicsFrame(vehicle);
    RespawnVehicle(vehicle);
}

export function DriveAiVehicle(vehicle: Vehicle): void {
    UpdateAiVehicleBehavior(vehicle);
}
