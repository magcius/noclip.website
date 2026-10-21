import { cosf, f, sinf, sqrtf, u8 } from "./f32.js";
import { G, GAME_MODE_ARCADE, GAME_MODE_PRACTICE, GAME_MODE_TIME_ATTACK } from "./globals.js";
import { TRACK_SECTION_ALTERNATE } from "./track.js";
import {
    CAR_GEAR_RATIOS,
    Mtx4,
    PlayerInputState,
    Quaternion,
    RACER_CLOCK_STOPPED,
    RACER_HELD,
    RAY_INSTANCES,
    RIGID_BODY_BOX_1,
    RIGID_BODY_FORCE_BODY,
    RIGID_BODY_FORCE_WORLD,
    RIGID_BODY_NO_ROTATION,
    RACER_SLOTS,
    Ref,
    RigidBody,
    RowView,
    TrackPoint,
    TrackSection,
    VEHICLE_CAMERA_BUMPER,
    VEHICLE_CAMERA_CHASE,
    VEHICLE_CAMERA_COCKPIT,
    VEHICLE_CAMERA_MIRROR,
    VEHICLE_CAMERA_TRACKSIDE,
    VEHICLE_WHEELS,
    Vec3f,
    Vehicle,
    VehicleModelInfo,
    CameraFrame,
    copyMtx,
    copyRigidBodyState,
    vec3,
} from "./types.js";
import {
    PointInTriangle3D,
    SegmentCrossesLine2D,
    Vec3fAddInPlace,
    Vec3fCross,
    Vec3fDistance,
    Vec3fDot,
    Vec3fMulAdd,
    Vec3fNegate,
    Vec3fNormalize,
    Vec3fScale,
    Vec3fSubtract,
} from "./vecmath.js";
import {
    ApplyRigidBodyImpulse,
    ComputeDeltaQuaternion,
    InitRigidBody,
    Mtx4fInverseRotate,
    Mtx4x4TransformPoint,
    QuaternionMultiply,
    QuaternionNormalize,
    QuaternionToMatrix,
    SetRigidBodyForce,
} from "./rigidbody.js";
import {
    ApplySideGrip,
    BuildTrackTriangleCache,
    ComputeDampingForces,
    ComputeDragForce,
    ComputeSpringForces,
    ComputeVehicleForces,
    DriveWheel,
    StepVehicleCollisions,
    UpdateWheelHeights,
    g_aTriCacheTriangles,
    g_awTriCacheTriCount,
} from "./physics.js";
import { guMtxCatF, guRotateF } from "./gu.js";
import { UpdateCameraSystem } from "./camera.js";
import { TransferFlags } from "./input.js";

export const VEHICLE_FORCE_SPRING_0 = 0;
export const VEHICLE_FORCE_SPRING_1 = 1;
export const VEHICLE_FORCE_SPRING_2 = 2;
export const VEHICLE_FORCE_SPRING_3 = 3;
export const VEHICLE_FORCE_DAMPER_0 = 4;
export const VEHICLE_FORCE_DAMPER_1 = 5;
export const VEHICLE_FORCE_DAMPER_2 = 6;
export const VEHICLE_FORCE_DAMPER_3 = 7;
export const VEHICLE_FORCE_GRAVITY = 8;
export const VEHICLE_FORCE_FRONT_WHEEL_GRAVITY = 9;
export const VEHICLE_FORCE_REAR_WHEEL_GRAVITY = 10;
export const VEHICLE_FORCE_DRAG = 11;
export const VEHICLE_FORCE_WHEEL_0 = 12;
export const VEHICLE_FORCE_WHEEL_1 = 13;
export const VEHICLE_FORCE_WHEEL_2 = 14;
export const VEHICLE_FORCE_WHEEL_3 = 15;

export const CAR_MODELS = 13;
export const VEHICLE_MODEL_SLOTS = 4;
export const SEASONS = 6;
export const SEASON_RACES = 4;
export const ARCADE_CAR_CLASSES = 4;
export const ARCADE_WEATHERS = 3;

const INPUT_ACCELERATE = 0x00010000;
const INPUT_REVERSE = 0x00020000;
const INPUT_BRAKE = 0x00040000;
const INPUT_GEAR_UP = 0x00100000;
const INPUT_GEAR_DOWN = 0x00200000;

const POINT_KEEP_DISTANCE = 64.0;
const ROUTE_DISTANCE_WINDOW = 1000.0;
const GRID_PATCH_MIN_X = 56;
const GRID_PATCH_END_X = 59;
const GRID_PATCH_MIN_Y = 23;
const GRID_PATCH_END_Y = 28;
const GRID_PATCH_X = 57;
const GRID_PATCH_Y = 25;
const GRID_CELL = 32;
const GRID_CELLS = 64;
const WRONG_WAY_FRAMES = 32;
const WRONG_WAY_FLASH = 0x10;
const WRONG_WAY_TIME = 0.25;
const RAY_HEADROOM = 1.5;
const RAY_NEARBY_DISTANCE = 5.0;
const RAY_CEILING_DEPTH = -1.0;
const FLY_SPEED = 100.0;
const FLY_TURN_RATE = f(3.141592741);
const FLY_TURN_SCALE = f(0.4);
const INPUT_REVERSE_TOGGLE = 1 << 17;
const INPUT_FLY_LEVEL = 0x10;
const REAR_DRIVE_SHARE = 2.0;
const FRONT_DRIVE_SHARE = 0.0;
const FRONT_BRAKE_DRIVE_LIMIT = f(1.0e-4);
const SPEED_TO_DISPLAY = f(2.24);
const HALF_PI = f(1.570796371);
const DEFAULT_CAMERA_FOV = f(0.5235987902);
const PHYSICS_STEP = f(1.0 / 30.0);
const WHEEL_DRAW_DROP = f(0.254);
const TWO_RAD_TO_DEG = f(114.5915527);
const PI_F = f(3.141592741);
const TWO_PI_F = f(6.283185482);
const STICK_STEERING_LAYOUT = 4;
const STICK_DEAD_ZONE = f(0.07);
const IDLE_RPM = 800.0;
const MIN_RPM = 900.0;
const MAX_RPM = 8000.0;
const SHIFT_DOWN_RPM = 4000.0;
const SHIFT_UP_RPM = 6000.0;
const MAX_RPM_CHANGE = 400.0;

export const sWrongWay = "%yyWRONG WAY";

export interface CarModel {
    name: string;
    modelRom: number;
    modelRomEnd: number;
    modelSize: number;
    dashboardRom: number;
    driveType: number;
    engineLayout: number;
    acceleration: number;
    maxSpeed: number;
    gearCount: number;
    shadowLength: number;
    shadowHalfWidth: number;
}

export interface CarPhysicsSpec {
    gearRatios: number[];
    torqueCurve: number[];
    finalDrive: number;
    gearCount: number;
    rearWheelDrive: number;
    boxSize: Vec3f;
    boxCenterZ: number;
    tableIndex: number;
}

export interface Season {
    raceCount: number;
    pointsNeeded: number;
    cars: number[];
    unlocks: number;
    races: number[][];
}

export interface ArcadeTimes {
    gateBonuses: number[];
    startTime: number;
}

export const g_aCarModels: CarModel[] = [];
export const g_aCarPhysicsSpecs: CarPhysicsSpec[] = [];
export const g_abPlayerColorsRgb: number[][] = [];
export const g_SeasonTable: Season[] = [];
export const g_aTrackArcadeTimes: (ArcadeTimes[][] | null)[] = [];
export let g_dwCarCount = 0;
export let g_dwNumTracks = 0;
export let g_fSteerLock = 0;
export let g_fSteerRate = 0;
export let g_fSteerGain = 0;
export let g_fSteerLockLoss = 0;
export let g_wSteerGainSpeedShare = 0;
export const g_aVehicleModels: (VehicleModelInfo | null)[] = new Array<VehicleModelInfo | null>(VEHICLE_MODEL_SLOTS).fill(null);
export const g_adwVehicleModelSlotCars: number[] = new Array<number>(VEHICLE_MODEL_SLOTS).fill(0);
export const g_aCarModelInfos: (VehicleModelInfo | null)[] = new Array<VehicleModelInfo | null>(CAR_MODELS).fill(null);

const DATA_SEGMENT_RAM = 0x8025f000;

export function loadCarData(dataSegment: DataView): void {
    const o = (address: number): number => address - DATA_SEGMENT_RAM;
    const inside = (address: number): boolean => address >= DATA_SEGMENT_RAM && address < DATA_SEGMENT_RAM + dataSegment.byteLength;
    const string = (address: number): string => {
        if (!inside(address)) {
            return "";
        }
        let s = "";
        for (let p = o(address); p < dataSegment.byteLength; p++) {
            const c = dataSegment.getUint8(p);
            if (c === 0) {
                break;
            }
            s += String.fromCharCode(c);
        }
        return s;
    };
    const floats = (at: number, count: number): number[] => Array.from({ length: count }, (_, i) => dataSegment.getFloat32(at + i * 4));

    g_dwNumTracks = dataSegment.getInt32(o(0x8028ae04));
    g_dwCarCount = dataSegment.getInt32(o(0x8028ae08));

    g_aCarModels.length = 0;
    for (let car = 0; car < CAR_MODELS; car++) {
        const b = o(0x8028ae0c) + car * 0x60;
        g_aCarModels.push({
            name: string(dataSegment.getUint32(b)),
            modelRom: dataSegment.getUint32(b + 0x14),
            modelRomEnd: dataSegment.getUint32(b + 0x18),
            modelSize: dataSegment.getUint32(b + 0x1c),
            dashboardRom: dataSegment.getUint32(b + 0x20),
            driveType: dataSegment.getInt32(b + 0x3c),
            engineLayout: dataSegment.getInt32(b + 0x40),
            acceleration: dataSegment.getFloat32(b + 0x44),
            maxSpeed: dataSegment.getFloat32(b + 0x48),
            gearCount: dataSegment.getInt32(b + 0x54),
            shadowLength: dataSegment.getFloat32(b + 0x58),
            shadowHalfWidth: dataSegment.getFloat32(b + 0x5c),
        });
    }

    g_aCarPhysicsSpecs.length = 0;
    for (let car = 0; car < CAR_MODELS; car++) {
        const b = o(0x8028b330) + car * 0x4c;
        const box = floats(b + 0x38, 3);
        g_aCarPhysicsSpecs.push({
            gearRatios: floats(b, CAR_GEAR_RATIOS),
            torqueCurve: floats(b + 0x1c, 4),
            finalDrive: dataSegment.getFloat32(b + 0x2c),
            gearCount: dataSegment.getInt32(b + 0x30),
            rearWheelDrive: dataSegment.getInt32(b + 0x34),
            boxSize: vec3(box[0], box[1], box[2]),
            boxCenterZ: dataSegment.getFloat32(b + 0x44),
            tableIndex: dataSegment.getInt32(b + 0x48),
        });
    }

    g_fSteerLock = dataSegment.getFloat32(o(0x8028b720));
    g_fSteerRate = dataSegment.getFloat32(o(0x8028b724));
    g_fSteerGain = dataSegment.getFloat32(o(0x8028b728));
    g_fSteerLockLoss = dataSegment.getFloat32(o(0x8028b72c));
    g_wSteerGainSpeedShare = dataSegment.getInt16(o(0x8028b730));

    g_abPlayerColorsRgb.length = 0;
    for (let i = 0; i < RACER_SLOTS; i++) {
        const b = o(0x8028b904) + i * 3;
        g_abPlayerColorsRgb.push([dataSegment.getUint8(b), dataSegment.getUint8(b + 1), dataSegment.getUint8(b + 2)]);
    }

    g_SeasonTable.length = 0;
    for (let s = 0; s < SEASONS; s++) {
        const b = o(0x8028b944) + s * 0x1c;
        g_SeasonTable.push({
            raceCount: dataSegment.getInt32(b + 0x08),
            pointsNeeded: dataSegment.getInt32(b + 0x0c),
            cars: [dataSegment.getUint8(b + 0x10), dataSegment.getUint8(b + 0x11)],
            unlocks: dataSegment.getUint16(b + 0x12),
            races: Array.from({ length: SEASON_RACES }, (_, r) => [dataSegment.getUint8(b + 0x14 + r * 2), dataSegment.getUint8(b + 0x15 + r * 2)]),
        });
    }

    g_aTrackArcadeTimes.length = 0;
    for (let track = 0; track < g_dwNumTracks; track++) {
        const item = dataSegment.getUint32(o(0x80271d1c) + track * 4);
        if (!inside(item) || !inside(item + 0x17c - 1)) {
            g_aTrackArcadeTimes.push(null);
            continue;
        }
        const b = o(item) + 0x2c;
        g_aTrackArcadeTimes.push(Array.from({ length: ARCADE_CAR_CLASSES }, (_, c) =>
            Array.from({ length: ARCADE_WEATHERS }, (_, w) => {
                const t = b + (c * ARCADE_WEATHERS + w) * 0x1c;
                return { gateBonuses: floats(t, 6), startTime: dataSegment.getFloat32(t + 0x18) };
            })));
    }
}

export function vehicleModelInfoFromModel(car: number, model: DataView): VehicleModelInfo {
    const wheels: Vec3f[] = [];
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        const b = 0xe0 + i * 12;
        wheels.push(vec3(model.getFloat32(b), model.getFloat32(b + 4), model.getFloat32(b + 8)));
    }
    return {
        car,
        wheels,
        cockpitForward: model.getFloat32(0xb0),
        mirrorForward: model.getFloat32(0xb4),
        cockpitUp: model.getFloat32(0xb8),
    };
}

function fieldRef<T, K extends keyof T>(object: T, key: K): Ref<T[K]> {
    return {
        get value(): T[K] {
            return object[key];
        },
        set value(v: T[K]) {
            object[key] = v;
        },
    };
}

export function FinishFrameMatrix(m: Mtx4): void {
    m[2][3] = 0.0;
    m[1][3] = 0.0;
    m[0][3] = 0.0;
    m[3][3] = 1.0;
}

function TrackPointDirection(out: Vec3f, point: TrackPoint): void {
    out.x = f(point.left.y - point.right.y);
    out.y = f(point.right.x - point.left.x);
    out.z = 0.0;
}

export function UpdateVehicleTrackPosition(vehicle: Vehicle): number {
    const track = G.g_LoadedTrack;
    const direction = vec3();
    const offset = vec3();
    const x = vehicle.frame.position.x;
    const y = vehicle.frame.position.y;
    const z = vehicle.frame.position.z;
    let checked = 1;
    let bestPoint = -1;
    let bestSection = 0;
    let gridX = u8(vehicle.gridX);
    let gridY = u8(vehicle.gridY);
    let section: TrackSection;
    let p: number;

    if (G.g_dwSelectedTrackId === 3 || G.g_dwSelectedTrackId === 8) {
        if (gridX >= GRID_PATCH_MIN_X && gridX < GRID_PATCH_END_X && gridY >= GRID_PATCH_MIN_Y && gridY < GRID_PATCH_END_Y) {
            gridX = GRID_PATCH_X;
            gridY = GRID_PATCH_Y;
            checked = 0;
        }
    }
    const intoLap = f(vehicle.distance - f(track.rootSection.points[0].distance * f(vehicle.distanceLaps)));

    let found = false;
    if (checked) {
        const current = vehicle.section!;
        if (!SegmentCrossesLine2D(current.points[vehicle.pointIndex].left, current.points[vehicle.pointIndex].right, vehicle.previousPosition, vehicle.frame.position) &&
            !SegmentCrossesLine2D(current.points[vehicle.pointIndex + 1].left, current.points[vehicle.pointIndex + 1].right, vehicle.previousPosition, vehicle.frame.position) &&
            Vec3fDistance(vehicle.frame.position, current.points[vehicle.pointIndex].position) < POINT_KEEP_DISTANCE) {
            found = true;
        }
    }

    if (found) {
        section = vehicle.section!;
        p = vehicle.pointIndex;
    } else {
        let best = f(track.maxX - track.minX);
        best = f(best * best);
        for (let i = 0; i < track.sections.length; i++) {
            if (vehicle.index >= G.g_dwNumLocalPlayers && G.g_dwGameMode !== GAME_MODE_TIME_ATTACK && (track.sections[i].flags & TRACK_SECTION_ALTERNATE)) {
                continue;
            }
            section = track.sections[i];
            if (gridX < section.gridMinX || section.gridMaxX < gridX || gridY < section.gridMinY || section.gridMaxY < gridY) {
                continue;
            }
            if (checked) {
                const lapLength = track.rootSection.points[0].distance;
                if (ROUTE_DISTANCE_WINDOW < f(f(lapLength - section.points[0].distance) - intoLap)) {
                    continue;
                }
                if (ROUTE_DISTANCE_WINDOW < f(intoLap - f(lapLength - section.points[section.pointCount].distance))) {
                    continue;
                }
            }
            const count = section.pointCount;
            for (p = 0; p < count; p++) {
                const point = section.points[p];
                const dx = f(point.position.x - x);
                const dy = f(point.position.y - y);
                const dz = f(point.position.z - z);
                const distance = f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
                if (distance < best) {
                    TrackPointDirection(direction, point);
                    Vec3fSubtract(offset, vehicle.frame.position, point.position);
                    if (0.0 <= Vec3fDot(direction, offset)) {
                        best = distance;
                        bestPoint = p;
                        bestSection = i;
                    }
                }
            }
        }
        if (bestPoint === -1) {
            return 0;
        }
        section = track.sections[bestSection];
        p = bestPoint;
    }

    const point = section.points[p];
    TrackPointDirection(direction, point);
    Vec3fNormalize(direction);
    Vec3fSubtract(offset, vehicle.frame.position, point.position);
    let change = f(Vec3fDot(direction, offset) + f(f(track.rootSection.points[0].distance * f(vehicle.distanceLaps + 1)) - point.distance));
    change = f(change - vehicle.distance);
    if (!checked || (-ROUTE_DISTANCE_WINDOW < change && change < ROUTE_DISTANCE_WINDOW)) {
        vehicle.distance = f(vehicle.distance + change);
    }
    vehicle.section = section;
    vehicle.pointIndex = p;
    vehicle.trackDirection.x = direction.x;
    vehicle.trackDirection.y = direction.y;
    vehicle.trackDirection.z = direction.z;
    return 1;
}

export function UpdateRaceTimers(vehicle: Vehicle): void {
    if (vehicle.racer!.status & RACER_CLOCK_STOPPED) {
        return;
    }
    if (G.g_dwGameMode === GAME_MODE_PRACTICE) {
        vehicle.lapTime = f(vehicle.lapTime + G.g_fFrameDeltaTime);
        return;
    }
    vehicle.totalTime = f(vehicle.totalTime + G.g_fFrameDeltaTime);
    vehicle.lapTime = f(vehicle.lapTime + G.g_fFrameDeltaTime);
    if (G.g_dwGameMode === GAME_MODE_ARCADE) {
        vehicle.timeLeft = f(vehicle.timeLeft - G.g_fFrameDeltaTime);
        if (vehicle.timeLeft < 0.0) {
            vehicle.timeLeft = 0.0;
        }
    }
}

export function UpdateHudMessageTimers(vehicle: Vehicle): void {
    if (vehicle.messageTime !== 0) {
        vehicle.messageTime = f(vehicle.messageTime - G.g_fFrameDeltaTime);
        if (vehicle.messageTime <= 0.0) {
            vehicle.messageTime = 0.0;
            vehicle.message = null;
        }
    } else if (vehicle.subMessageTime !== 0) {
        vehicle.subMessageTime = f(vehicle.subMessageTime - G.g_fFrameDeltaTime);
        if (vehicle.subMessageTime <= 0.0) {
            vehicle.subMessageTime = 0.0;
            vehicle.subMessage = null;
        }
    }
}

export function CheckWrongWayWarning(vehicle: Vehicle): void {
    if (G.g_LoadedTrack.rootSection !== null) {
        if (vehicle.lap < G.g_dwTotalLaps && !vehicle.flyMode && Vec3fDot(vehicle.trackDirection, vehicle.frame.forward) < 0.0) {
            vehicle.wrongWayFrames++;
            if (vehicle.wrongWayFrames >= WRONG_WAY_FRAMES && (vehicle.wrongWayFrames & WRONG_WAY_FLASH) === WRONG_WAY_FLASH) {
                if (vehicle.message === null) {
                    vehicle.message = sWrongWay;
                    vehicle.subMessage = null;
                    vehicle.messageTime = WRONG_WAY_TIME;
                }
            } else if (vehicle.message === sWrongWay) {
                vehicle.subMessage = null;
                vehicle.message = null;
            }
        } else {
            vehicle.wrongWayFrames = 0;
        }
    }
}

export function FloatToInt(value: number): number {
    return Math.trunc(value) | 0;
}

export function UpdateVehicleGridPosition(vehicle: Vehicle): void {
    if (G.g_LoadedTrack.rootSection === null) {
        return;
    }
    vehicle.gridX = u8(FloatToInt(f(vehicle.frame.position.x / GRID_CELL)));
    vehicle.gridY = u8(FloatToInt(f(vehicle.frame.position.y / GRID_CELL)));
    if (vehicle.gridX >= GRID_CELLS) {
        vehicle.gridX = GRID_CELLS - 1;
    }
    if (vehicle.gridY >= GRID_CELLS) {
        vehicle.gridY = GRID_CELLS - 1;
    }
    UpdateVehicleTrackPosition(vehicle);
}

export function CastRayAgainstTrack(
    outPoint: Vec3f | null,
    outNormal: Vec3f | null,
    origin: Vec3f,
    groundInstances: number[],
    groundInstanceCount: Ref<number>,
    nearbyInstances: number[],
    nearbyCount: Ref<number>,
    groundDistance: Ref<number>,
    groundSurface: Ref<number>,
): number {
    const track = G.g_LoadedTrack;
    const ceilingNormal = vec3(0.0, 0.0, 1.0);
    const groundNormal = vec3(0.0, 0.0, 1.0);
    const line = vec3();
    const direction = vec3();
    const toVertex = vec3();
    const hit = vec3();
    let groundHits = 0;
    let groundCount = 0;
    let nearby = 0;
    let ceilingTriangle = 0;
    let ceilingInstance = 0;
    let j: number;
    let instance: number;

    let nearest = f(track.maxZ - track.minZ);
    nearest = f(f(nearest * nearest) + 1.0);
    let nearestCeiling = nearest;
    let groundZ = origin.z;
    let ceilingZ = origin.z;
    direction.x = 0.0;
    direction.y = 0.0;
    direction.z = 1.0;
    line.x = origin.x;
    line.y = origin.y;
    line.z = 1.0;
    groundSurface.value = 0;

    const slot = BuildTrackTriangleCache(line.x, line.y);
    const triangles = g_aTriCacheTriangles[slot];
    const end = g_awTriCacheTriCount[slot];
    for (let t = 0; t !== end; t++) {
        const triangle = triangles[t];
        if (triangle.normal.z < 0.0) {
            continue;
        }
        const denominator = Vec3fDot(direction, triangle.normal);
        if (denominator === 0.0) {
            continue;
        }
        Vec3fSubtract(toVertex, triangle.vertices[0], line);
        Vec3fMulAdd(hit, line, direction, f(Vec3fDot(toVertex, triangle.normal) / denominator));
        if (!PointInTriangle3D(hit, triangle.vertices[0], triangle.vertices[1], triangle.vertices[2], triangle.normal)) {
            continue;
        }

        let below = f(f(origin.z + RAY_HEADROOM) - hit.z);
        if (0.0 <= below) {
            groundHits++;
            if (below < nearest) {
                groundSurface.value = triangle.index;
                nearest = below;
                groundZ = hit.z;
                if (triangle.normal.z < 0.0) {
                    Vec3fNegate(groundNormal, triangle.normal);
                } else {
                    groundNormal.x = triangle.normal.x;
                    groundNormal.y = triangle.normal.y;
                    groundNormal.z = triangle.normal.z;
                }
                if (groundCount < RAY_INSTANCES) {
                    groundInstances[groundCount++] = groundInstances[0];
                }
                groundInstances[0] = (track.surfaces[triangle.index].instance + 1) & 0xffff;
                if (below < RAY_NEARBY_DISTANCE) {
                    for (j = track.triangleNearbyInstances[triangle.index]; track.nearbyInstances[j] !== 0; j++) {
                        if (nearby < RAY_INSTANCES) {
                            nearbyInstances[nearby++] = nearbyInstances[0];
                        }
                        nearbyInstances[0] = track.nearbyInstances[j];
                    }
                }
            } else if (groundCount < RAY_INSTANCES) {
                groundInstances[groundCount++] = (track.surfaces[triangle.index].instance + 1) & 0xffff;
                if (below < RAY_NEARBY_DISTANCE) {
                    j = track.triangleNearbyInstances[triangle.index];
                    for (instance = track.nearbyInstances[j]; instance !== 0; instance = track.nearbyInstances[++j]) {
                        if (nearby < RAY_INSTANCES) {
                            nearbyInstances[nearby++] = instance;
                        }
                    }
                }
            }
        }

        below = f(below - RAY_HEADROOM);
        if (below <= 0.0 && below < nearestCeiling) {
            ceilingInstance = (track.surfaces[triangle.index].instance + 1) & 0xffff;
            if (RAY_CEILING_DEPTH < below) {
                ceilingTriangle = triangle.index;
                nearestCeiling = below;
                ceilingZ = hit.z;
                if (triangle.normal.z < 0.0) {
                    Vec3fNegate(ceilingNormal, triangle.normal);
                } else {
                    ceilingNormal.x = triangle.normal.x;
                    ceilingNormal.y = triangle.normal.y;
                    ceilingNormal.z = triangle.normal.z;
                }
            }
        }
    }

    if (groundHits !== 0) {
        if (outPoint !== null) {
            outPoint.z = groundZ;
            groundDistance.value = f(nearest - RAY_HEADROOM);
        }
        if (outNormal !== null) {
            outNormal.x = groundNormal.x;
            outNormal.y = groundNormal.y;
            outNormal.z = groundNormal.z;
        }
    } else {
        j = track.triangleNearbyInstances[ceilingTriangle & 0xffff];
        for (instance = track.nearbyInstances[j]; instance !== 0; instance = track.nearbyInstances[++j]) {
            if (nearby >= RAY_INSTANCES) {
                nearbyInstances[RAY_INSTANCES - 1] = instance;
                break;
            }
            nearbyInstances[nearby++] = instance;
        }
        if (groundCount < RAY_INSTANCES) {
            groundInstances[groundCount] = ceilingInstance;
        } else {
            groundInstances[RAY_INSTANCES - 1] = ceilingInstance;
        }
        if (outPoint !== null) {
            outPoint.z = ceilingZ;
        }
        if (outNormal !== null) {
            outNormal.x = ceilingNormal.x;
            outNormal.y = ceilingNormal.y;
            outNormal.z = ceilingNormal.z;
        }
    }
    groundInstanceCount.value = 1;
    nearbyCount.value = nearby;
    return groundHits;
}

export function UpdateVehiclePhysicsFrame(vehicle: Vehicle): void {
    const wheels = vehicle.body.wheels as RigidBody[];
    const step = vec3();
    const dt = G.g_fFrameDeltaTime;

    if (vehicle.flyMode) {
        Vec3fScale(step, vehicle.frame.forward, f(f(vehicle.accelerator * dt) * FLY_SPEED));
        Vec3fAddInPlace(vehicle.frame.position, step);
        SetVehiclePosition(vehicle, vehicle.frame.position.x, vehicle.frame.position.y, vehicle.frame.position.z);
        SetVehicleVelocity(vehicle, 0.0, 0.0, 0.0);
        SetVehicleTurnRate(vehicle, 0.0, 0.0, 0.0);
        vehicle.engineRpm = 0.0;
        RotateVehicleByEuler(
            vehicle,
            f(f(f(vehicle.steering * FLY_TURN_RATE) * FLY_TURN_SCALE) * dt),
            f(f(f(vehicle.pitchInput * FLY_TURN_RATE) * FLY_TURN_SCALE) * dt),
            f(f(f(vehicle.rollInput * FLY_TURN_RATE) * FLY_TURN_SCALE) * dt),
        );
        if (vehicle.input!.buttons & INPUT_FLY_LEVEL) {
            vehicle.frame.up.x = 0.0;
            vehicle.frame.up.y = 0.0;
            vehicle.frame.up.z = 1.0;
            Vec3fCross(vehicle.frame.side, vehicle.frame.up, vehicle.frame.forward);
            Vec3fCross(vehicle.frame.up, vehicle.frame.forward, vehicle.frame.side);
            TransferFlags(vehicle.input!, INPUT_FLY_LEVEL);
        }
    } else {
        vehicle.groundHits = CastRayAgainstTrack(
            vehicle.frame.position,
            vehicle.frame.up,
            vehicle.frame.position,
            vehicle.groundInstances,
            fieldRef(vehicle, "groundInstanceCount"),
            vehicle.nearbyInstances,
            fieldRef(vehicle, "nearbyInstanceCount"),
            fieldRef(vehicle, "groundDistance"),
            fieldRef(vehicle, "groundSurface"),
        );
        wheels[1].steerAngle = 0.0;
        wheels[0].steerAngle = wheels[1].steerAngle;
        UpdateVehicleEngineAndGearbox(vehicle);
        wheels[3].steerAngle = vehicle.steerAngle;
        wheels[2].steerAngle = vehicle.steerAngle;
        for (let i = 0; i < VEHICLE_WHEELS; i++) {
            wheels[i].drive = 0.0;
        }
        for (let i = 0; i < VEHICLE_WHEELS; i++) {
            wheels[i].brake = 0.0;
        }
        if (0.0 < vehicle.throttle) {
            if ((vehicle.input!.buttons & INPUT_REVERSE_TOGGLE) && vehicle.gear === 1) {
                vehicle.throttle = -vehicle.throttle;
            }
            if (vehicle.rearWheelDrive) {
                wheels[0].drive = f(-vehicle.throttle * REAR_DRIVE_SHARE);
                wheels[1].drive = f(-vehicle.throttle * REAR_DRIVE_SHARE);
                wheels[2].drive = f(-vehicle.throttle * FRONT_DRIVE_SHARE);
                wheels[3].drive = f(-vehicle.throttle * FRONT_DRIVE_SHARE);
            } else {
                for (let i = 0; i < VEHICLE_WHEELS; i++) {
                    wheels[i].drive = -vehicle.throttle;
                }
            }
        }
        if (vehicle.brake < 0.0) {
            wheels[0].brake = -vehicle.brake;
            wheels[1].brake = -vehicle.brake;
            wheels[0].drive = 0.0;
            wheels[1].drive = 0.0;
            const drive = wheels[2].drive < 0.0 ? -wheels[2].drive : wheels[2].drive;
            if (drive < FRONT_BRAKE_DRIVE_LIMIT) {
                wheels[2].brake = -vehicle.brake;
                wheels[3].brake = -vehicle.brake;
            }
        }
        SimulateVehiclePhysicsSubstep(vehicle);
    }

    TransformAllWheelMatrices(vehicle);
    if (vehicle.wheelBodies[1].contactFrames) {
        const velocity = vehicle.body.state.velocity;
        vehicle.speedKph = f(sqrtf(f(f(velocity.z * velocity.z) + f(f(velocity.x * velocity.x) + f(velocity.y * velocity.y)))) * SPEED_TO_DISPLAY);
    }
    for (let i = 0; i < G.g_dwNumViewports; i++) {
        if (vehicle.index === G.g_aViewportRects[i].vehicleIndex) {
            UpdateCameraSystem(vehicle);
            return;
        }
    }
}

export function SetVehiclePosition(vehicle: Vehicle, x: number, y: number, z: number): void {
    vehicle.frame.position.x = x;
    vehicle.frame.position.y = y;
    vehicle.frame.position.z = z;
    vehicle.sprayOrigin.x = x;
    vehicle.sprayOrigin.y = y;
    vehicle.sprayOrigin.z = z;
    vehicle.body.state.position.x = x;
    vehicle.body.state.position.y = y;
    vehicle.body.state.position.z = z;
    vehicle.body.stepStates[1].position.x = x;
    vehicle.body.stepStates[1].position.y = y;
    vehicle.body.stepStates[1].position.z = z;
    vehicle.body.stepStates[0].position.x = x;
    vehicle.body.stepStates[0].position.y = y;
    vehicle.body.stepStates[0].position.z = z;
    QuaternionToMatrix(vehicle.body.orientation, vehicle.body.state);
}

function COPY_ORIENTATION_TO_STEPS(vehicle: Vehicle): void {
    const q = vehicle.body.state.orientation;
    const s0 = vehicle.body.stepStates[0].orientation;
    const s1 = vehicle.body.stepStates[1].orientation;
    s1.w = q.w;
    s0.w = q.w;
    s1.x = q.x;
    s0.x = q.x;
    s1.y = q.y;
    s0.y = q.y;
    s1.z = q.z;
    s0.z = q.z;
}

export function InitVehicleOrientationFromAngle(vehicle: Vehicle, angle: number): void {
    const forwardX = cosf(angle);
    const forwardY = sinf(angle);
    const sideX = cosf(f(angle + HALF_PI));
    const sideY = sinf(f(angle + HALF_PI));
    const half = f(angle * 0.5);

    vehicle.frame.forward.x = forwardX;
    vehicle.frame.forward.y = forwardY;
    vehicle.frame.forward.z = 0.0;
    vehicle.frame.side.x = sideX;
    vehicle.frame.side.y = sideY;
    vehicle.frame.side.z = 0.0;
    vehicle.frame.up.x = 0.0;
    vehicle.frame.up.y = 0.0;
    vehicle.frame.up.z = 1.0;
    vehicle.body.state.orientation.w = cosf(half);
    vehicle.body.state.orientation.x = 0.0;
    vehicle.body.state.orientation.y = 0.0;
    vehicle.body.state.orientation.z = sinf(half);
    COPY_ORIENTATION_TO_STEPS(vehicle);
    QuaternionToMatrix(vehicle.body.orientation, vehicle.body.state);
}

export function MatrixToQuaternion(m: Mtx4, q: Quaternion): void {
    if (0.0 <= m[0][0]) {
        if (0.0 <= f(m[1][1] + m[2][2])) {
            q.w = f(f(f(1.0 + m[0][0]) + m[1][1]) + m[2][2]);
            q.x = f(m[1][2] - m[2][1]);
            q.y = f(m[2][0] - m[0][2]);
            q.z = f(m[0][1] - m[1][0]);
        } else {
            q.w = f(m[1][2] - m[2][1]);
            q.x = f(f(f(1.0 + m[0][0]) - m[1][1]) - m[2][2]);
            q.y = f(m[0][1] + m[1][0]);
            q.z = f(m[2][0] + m[0][2]);
        }
    } else if (m[2][2] <= m[1][1]) {
        q.w = f(m[2][0] - m[0][2]);
        q.x = f(m[0][1] + m[1][0]);
        q.y = f(f(f(1.0 - m[0][0]) + m[1][1]) - m[2][2]);
        q.z = f(m[1][2] + m[2][1]);
    } else {
        q.w = f(m[0][1] - m[1][0]);
        q.x = f(m[2][0] + m[0][2]);
        q.y = f(m[1][2] + m[2][1]);
        q.z = f(f(f(1.0 - m[0][0]) - m[1][1]) + m[2][2]);
    }
    QuaternionNormalize(q);
}

export function SetVehicleFrameMatrix(vehicle: Vehicle, m: Mtx4): void {
    copyMtx(vehicle.frame.m, m);
    MatrixToQuaternion(m, vehicle.body.state.orientation);
    COPY_ORIENTATION_TO_STEPS(vehicle);
    QuaternionToMatrix(vehicle.body.orientation, vehicle.body.state);
}

export function SetVehicleVelocity(vehicle: Vehicle, x: number, y: number, z: number): void {
    const placed = vehicle.placedVelocity;

    vehicle.body.state.velocity.x = x;
    vehicle.body.state.velocity.y = y;
    vehicle.body.state.velocity.z = z;
    vehicle.body.stepStates[1].velocity.x = x;
    vehicle.body.stepStates[1].velocity.y = y;
    vehicle.body.stepStates[1].velocity.z = z;
    vehicle.body.stepStates[0].velocity.x = x;
    vehicle.body.stepStates[0].velocity.y = y;
    vehicle.body.stepStates[0].velocity.z = z;
    placed.x = x;
    placed.y = y;
    placed.z = z;
}

export function RotateVehicleByEuler(vehicle: Vehicle, yaw: number, pitch: number, roll: number): void {
    const orientation = vehicle.body.state.orientation;
    const turn: Quaternion = { w: 0, x: 0, y: 0, z: 0 };
    let sine: number;

    yaw = f(yaw * 0.5);
    pitch = f(pitch * 0.5);
    roll = f(roll * 0.5);
    sine = sinf(yaw);
    turn.w = cosf(yaw);
    turn.x = 0.0;
    turn.y = 0.0;
    turn.z = sine;
    QuaternionMultiply(orientation, orientation, turn);
    sine = sinf(pitch);
    turn.w = cosf(pitch);
    turn.x = 0.0;
    turn.y = sine;
    turn.z = 0.0;
    QuaternionMultiply(orientation, orientation, turn);
    sine = sinf(roll);
    turn.w = cosf(roll);
    turn.x = sine;
    turn.y = 0.0;
    turn.z = 0.0;
    QuaternionMultiply(orientation, orientation, turn);
    QuaternionNormalize(orientation);
    COPY_ORIENTATION_TO_STEPS(vehicle);
}

export function SetVehicleTurnRate(vehicle: Vehicle, x: number, y: number, z: number): void {
    vehicle.body.state.angularVelocity.x = x;
    vehicle.body.state.angularVelocity.y = y;
    vehicle.body.state.angularVelocity.z = z;
    vehicle.body.stepStates[1].angularVelocity.x = x;
    vehicle.body.stepStates[1].angularVelocity.y = y;
    vehicle.body.stepStates[1].angularVelocity.z = z;
    vehicle.body.stepStates[0].angularVelocity.x = x;
    vehicle.body.stepStates[0].angularVelocity.y = y;
    vehicle.body.stepStates[0].angularVelocity.z = z;
}

export function InitVehicleColorAndPhysics(vehicle: Vehicle): void {
    InitVehiclePhysics(vehicle);
}

export function SetVehicleModelSlot(vehicle: Vehicle, slot: number): void {
    vehicle.model = g_aVehicleModels[slot];
    InitVehicleColorAndPhysics(vehicle);
}

export function InstallVehicleModel(vehicle: Vehicle, slot: number, car: number): void {
    g_aVehicleModels[slot] = g_aCarModelInfos[car];
    g_adwVehicleModelSlotCars[slot] = car;
    SetVehicleModelSlot(vehicle, slot);
}

export function ResetVehicleState(vehicle: Vehicle): void {
    FinishFrameMatrix(vehicle.frame.m);
    FinishFrameMatrix(vehicle.cameras[VEHICLE_CAMERA_COCKPIT].m);
    vehicle.cameras[VEHICLE_CAMERA_COCKPIT].fov = DEFAULT_CAMERA_FOV;
    FinishFrameMatrix(vehicle.cameras[VEHICLE_CAMERA_CHASE].m);
    vehicle.cameras[VEHICLE_CAMERA_CHASE].fov = DEFAULT_CAMERA_FOV;
    FinishFrameMatrix(vehicle.cameras[VEHICLE_CAMERA_BUMPER].m);
    vehicle.cameras[VEHICLE_CAMERA_BUMPER].fov = DEFAULT_CAMERA_FOV;
    FinishFrameMatrix(vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE].m);
    vehicle.cameras[VEHICLE_CAMERA_TRACKSIDE].fov = DEFAULT_CAMERA_FOV;
    FinishFrameMatrix(vehicle.cameras[VEHICLE_CAMERA_MIRROR].m);
    vehicle.cameras[VEHICLE_CAMERA_MIRROR].fov = DEFAULT_CAMERA_FOV;
    vehicle.activeCamera = vehicle.cameras[VEHICLE_CAMERA_COCKPIT];
    vehicle.model = null;
    FinishFrameMatrix(vehicle.wheelFrames[0].m);
    FinishFrameMatrix(vehicle.wheelFrames[1].m);
    FinishFrameMatrix(vehicle.wheelFrames[2].m);
    FinishFrameMatrix(vehicle.wheelFrames[3].m);
    SetVehicleVelocity(vehicle, 0.0, 0.0, 0.0);
    vehicle.section = null;
    vehicle.pointIndex = 0;
    vehicle.previousCamera = null as unknown as CameraFrame;

    const spec = g_aCarPhysicsSpecs[vehicle.carModel];
    for (let i = 0; i < CAR_GEAR_RATIOS; i++) {
        vehicle.gearRatios[i] = spec.gearRatios[i];
    }
    vehicle.torqueCurve[0] = spec.torqueCurve[0];
    vehicle.torqueCurve[1] = spec.torqueCurve[1];
    vehicle.torqueCurve[2] = spec.torqueCurve[2];
    vehicle.torqueCurve[3] = spec.torqueCurve[3];
    vehicle.finalDrive = spec.finalDrive;
    vehicle.gearCount = spec.gearCount;
    vehicle.transmission = vehicle.chosenTransmission;
    vehicle.rearWheelDrive = spec.rearWheelDrive;
    vehicle.body.boxSize.x = spec.boxSize.x;
    vehicle.body.boxSize.y = spec.boxSize.y;
    vehicle.body.boxSize.z = spec.boxSize.z;
    vehicle.body.boxCenterZ = spec.boxCenterZ;
    vehicle.tableIndex = spec.tableIndex;
}

export function BindPlayerInputToVehicle(vehicle: Vehicle): void {
    vehicle.input = G.g_aPlayerInputState[G.g_aVehicles.indexOf(vehicle)];
}

function SignOf(x: number): number {
    return x === 0.0 ? 0.0 : (0.0 < x ? 1.0 : -1.0);
}

function AbsOf(x: number): number {
    return x < 0.0 ? -x : x;
}

const AXES = ["x", "y", "z"] as const;

function KeepUnreversed(v: Vec3f, axis: number, damped: number): void {
    const key = AXES[axis];
    v[key] = SignOf(damped) === SignOf(v[key]) ? damped : 0.0;
}

export function SimulateVehiclePhysicsSubstep(vehicle: Vehicle): void {
    const body = vehicle.body;
    const state = body.state;
    const wheels = body.wheels as RigidBody[];
    const rearLoad = fieldRef(vehicle, "rearLoad");
    const frontLoad = fieldRef(vehicle, "frontLoad");
    const rearSliding = fieldRef(vehicle, "rearSliding");
    const frontSliding = fieldRef(vehicle, "frontSliding");

    body.forces = vehicle.forces[VEHICLE_FORCE_SPRING_0];
    wheels[0].forces = vehicle.forces[VEHICLE_FORCE_WHEEL_0];
    wheels[1].forces = vehicle.forces[VEHICLE_FORCE_WHEEL_2];
    wheels[2].forces = vehicle.forces[VEHICLE_FORCE_WHEEL_1];
    wheels[3].forces = vehicle.forces[VEHICLE_FORCE_WHEEL_3];
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        wheels[i].forces!.vector.x = 0.0;
        wheels[i].forces!.vector.y = 0.0;
        wheels[i].forces!.vector.z = 0.0;
    }
    ComputeSpringForces(body);
    if (vehicle.skipDrive) {
        vehicle.skipDrive = 0;
    } else {
        vehicle.frontLoad = 0.0;
        vehicle.rearLoad = 0.0;
        vehicle.rearSliding = 0;
        DriveWheel(body, wheels[0], rearLoad, rearSliding, PHYSICS_STEP);
        DriveWheel(body, wheels[1], rearLoad, rearSliding, PHYSICS_STEP);
        DriveWheel(body, wheels[2], frontLoad, frontSliding, PHYSICS_STEP);
        DriveWheel(body, wheels[3], frontLoad, frontSliding, PHYSICS_STEP);
        vehicle.skipDrive = 0;
    }
    body.force.x = 0.0;
    body.force.y = 0.0;
    body.force.z = 0.0;
    body.torque.x = 0.0;
    body.torque.y = 0.0;
    body.torque.z = 0.0;
    ComputeVehicleForces(body);
    ApplyRigidBodyImpulse(state, body, PHYSICS_STEP);
    ApplySideGrip(body, PHYSICS_STEP, rearLoad, frontLoad, rearSliding, frontSliding);
    ComputeDeltaQuaternion(state);

    body.forces = vehicle.forces[VEHICLE_FORCE_DAMPER_0];
    wheels[0].forces = null;
    wheels[2].forces = null;
    wheels[1].forces = null;
    wheels[3].forces = null;
    ComputeDragForce(body, vehicle.forces[VEHICLE_FORCE_DRAG]);
    ComputeDampingForces(body);
    body.force.x = 0.0;
    body.force.y = 0.0;
    body.force.z = 0.0;
    body.torque.x = 0.0;
    body.torque.y = 0.0;
    body.torque.z = 0.0;
    ComputeVehicleForces(body);
    copyRigidBodyState(body.stepStates[1], state);
    ApplyRigidBodyImpulse(body.stepStates[1], body, PHYSICS_STEP);
    for (let axis = 0; axis < 3; axis++) {
        KeepUnreversed(state.angularVelocity, axis, body.stepStates[1].angularVelocity[AXES[axis]]);
        KeepUnreversed(state.velocity, axis, body.stepStates[1].velocity[AXES[axis]]);
    }

    copyRigidBodyState(body.stepStates[0], state);
    ComputeDeltaQuaternion(body.stepStates[0]);
    ComputeDeltaQuaternion(body.stepStates[0]);
    StepVehicleCollisions(body);
    copyRigidBodyState(state, body.stepStates[1]);
    UpdateWheelHeights(body);
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        QuaternionToMatrix(wheels[i].orientation, wheels[i].state);
    }
}

function PLACE_WHEEL(out: CameraFrame, body: RigidBody, wheel: RigidBody): void {
    Mtx4x4TransformPoint(out.position, body.orientation, new RowView(wheel.orientation[3]));
}

function STEER_WHEEL(out: Mtx4, wheel: RigidBody, roll: Mtx4, steer: Mtx4): void {
    guRotateF(roll, wheel.rollAngle, 0.0, 1.0, 0.0);
    guRotateF(steer, f(wheel.steerAngle * TWO_RAD_TO_DEG), 0.0, 0.0, 1.0);
    guMtxCatF(roll, steer, out);
}

function DROP_WHEELS(vehicle: Vehicle, sign: number): void {
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        const m = vehicle.wheelBodies[i].orientation;
        m[3][2] = sign > 0 ? f(m[3][2] + WHEEL_DRAW_DROP) : f(m[3][2] - WHEEL_DRAW_DROP);
    }
}

function mtx(): Mtx4 {
    return [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
}

export function TransformAllWheelMatrices(vehicle: Vehicle): void {
    const roll = mtx();
    const turn = mtx();
    const steer = mtx();
    const body = vehicle.body;

    guRotateF(turn, body.rollAngle, 1.0, 0.0, 0.0);
    guMtxCatF(turn, body.orientation, vehicle.frame.m);
    DROP_WHEELS(vehicle, 1);
    guRotateF(turn, vehicle.wheelBodies[0].rollAngle, 0.0, 1.0, 0.0);
    guMtxCatF(turn, body.orientation, vehicle.wheelFrames[2].m);
    PLACE_WHEEL(vehicle.wheelFrames[2], body, vehicle.wheelBodies[0]);
    guRotateF(turn, vehicle.wheelBodies[2].rollAngle, 0.0, 1.0, 0.0);
    guMtxCatF(turn, body.orientation, vehicle.wheelFrames[3].m);
    PLACE_WHEEL(vehicle.wheelFrames[3], body, vehicle.wheelBodies[2]);
    STEER_WHEEL(turn, vehicle.wheelBodies[1], roll, steer);
    guMtxCatF(turn, body.orientation, vehicle.wheelFrames[1].m);
    PLACE_WHEEL(vehicle.wheelFrames[1], body, vehicle.wheelBodies[1]);
    STEER_WHEEL(turn, vehicle.wheelBodies[3], roll, steer);
    guMtxCatF(turn, body.orientation, vehicle.wheelFrames[0].m);
    PLACE_WHEEL(vehicle.wheelFrames[0], body, vehicle.wheelBodies[3]);
    DROP_WHEELS(vehicle, -1);
}

function SteerByStick(vehicle: Vehicle, stick: number): void {
    const local = vec3();
    let gain = 0;
    let share = 1;
    let most: number;
    let least: number;
    let target: number;
    let current: number;

    if (0.0 < stick) {
        stick = f(stick - STICK_DEAD_ZONE);
        if (stick < 0.0) {
            stick = 0.0;
        }
    } else {
        stick = f(stick + STICK_DEAD_ZONE);
        if (0.0 < stick) {
            stick = 0.0;
        }
    }
    let kph = vehicle.speedKph;
    Mtx4fInverseRotate(local, vehicle.body.orientation, vehicle.body.state.velocity);
    let forward = local.x;
    if (forward < 10.0) {
        forward = 10.0;
    }
    if (70.0 < forward) {
        forward = 70.0;
    }
    if (kph < 140.0) {
        kph = 140.0;
    }
    if (340.0 < kph) {
        kph = 340.0;
    }
    kph = f(kph - 140.0);
    switch (vehicle.steeringMode) {
    case 0:
        g_fSteerLock = 14.0;
        g_fSteerRate = f(0.01);
        g_fSteerGain = 6.0;
        g_fSteerLockLoss = 10.0;
        gain = g_fSteerGain;
        g_wSteerGainSpeedShare = 0;
        share = g_wSteerGainSpeedShare;
        break;
    case 1:
        g_fSteerLock = 14.0;
        g_fSteerRate = f(0.01);
        g_fSteerGain = 6.0;
        g_fSteerLockLoss = 10.0;
        gain = 3.0;
        g_wSteerGainSpeedShare = 0;
        share = g_wSteerGainSpeedShare;
        break;
    case 2:
        g_fSteerLock = 17.0;
        g_fSteerRate = f(0.1);
        g_fSteerGain = 16.0;
        g_fSteerLockLoss = 14.0;
        gain = g_fSteerGain;
        g_wSteerGainSpeedShare = 0;
        share = g_wSteerGainSpeedShare;
        break;
    }
    let rate = g_fSteerRate;

    const lock = f(g_fSteerLock - f(f(forward / 90.0) * g_fSteerLockLoss));
    if (AbsOf(stick) < f(0.001)) {
        most = f(f(lock * PI_F) / 180.0);
        least = f(f(-lock * PI_F) / 180.0);
        target = 0.0;
    } else if (stick < -0.75) {
        most = f(f(lock * PI_F) / 180.0);
        least = f(f(-lock * PI_F) / 180.0);
        target = most;
    } else if (0.75 < stick) {
        least = f(f(-lock * PI_F) / 180.0);
        most = f(f(lock * PI_F) / 180.0);
        target = least;
    } else {
        gain = f(gain - f(f(share * f(gain / 2.0)) * f(kph / 200.0)));
        target = f(-stick * f(f(gain * PI_F) / 180.0));
        most = f(f(lock * PI_F) / 180.0);
        least = f(f(-lock * PI_F) / 180.0);
    }
    if (most < target) {
        target = most;
    }
    if (target < least) {
        target = least;
    }

    current = vehicle.steerAngle;
    let returning = SignOf(current) !== SignOf(target) ? 1 : 0;
    if (!returning) {
        returning = (0.0 < current && target < current) || (current < 0.0 && current < target) ? 1 : 0;
    }
    if (current === 0.0) {
        returning = 0;
        vehicle.steerReturn = 0;
        current = vehicle.steerAngle;
    }
    const down = target < current;
    const up = current < target;
    if (down && vehicle.steerReturn < 0) {
        returning = 1;
    }
    if (up && vehicle.steerReturn > 0) {
        returning = 1;
    }
    if (returning) {
        vehicle.steerReturn = down ? -1 : 1;
        rate = 1.0;
        current = vehicle.steerAngle;
        if (SignOf(target) !== SignOf(current)) {
            target = 0.0;
        }
    } else {
        vehicle.steerReturn = 0;
        current = vehicle.steerAngle;
    }
    if (AbsOf(f(current - target)) < rate) {
        vehicle.steerAngle = target;
    } else if (target < current) {
        vehicle.steerAngle = f(current - rate);
    } else {
        vehicle.steerAngle = f(current + rate);
    }
}

export function UpdateVehicleEngineAndGearbox(vehicle: Vehicle): void {
    const input = vehicle.input as PlayerInputState;
    const stick = input.steering;
    let gear: number;

    if (input.controllerLayout === STICK_STEERING_LAYOUT) {
        const amount = AbsOf(stick);
        const root = sqrtf(amount);
        vehicle.steerAngle = f(f(f(-f(sqrtf(f(sqrtf(f(sqrtf(amount) * amount)) * root)) * SignOf(stick)) * 10.0) * PI_F) / 180.0);
    } else {
        SteerByStick(vehicle, stick);
    }

    const previous = vehicle.engineRpm;
    if (vehicle.engineRpm < IDLE_RPM) {
        vehicle.engineRpm = IDLE_RPM;
    }
    if (vehicle.transmission) {
        if (vehicle.gear >= 2 && vehicle.engineRpm < SHIFT_DOWN_RPM) {
            vehicle.gear--;
        } else if (vehicle.gear < vehicle.gearCount && SHIFT_UP_RPM < vehicle.engineRpm && !(input.buttons & INPUT_REVERSE)) {
            vehicle.gear++;
        }
    } else if (vehicle.gear > 0 && (input.buttons & INPUT_GEAR_DOWN)) {
        TransferFlags(input, INPUT_GEAR_DOWN);
        vehicle.gear--;
    } else if (vehicle.gear < vehicle.gearCount && (input.buttons & INPUT_GEAR_UP) && !(input.buttons & INPUT_REVERSE)) {
        TransferFlags(input, INPUT_GEAR_UP);
        vehicle.gear++;
    }
    const buttons = input.buttons;

    let extra = 0.0;
    const rpm = vehicle.engineRpm;
    if (G.g_dwGameMode === GAME_MODE_ARCADE && vehicle.racePosition === 1) {
        const gap = f(AbsOf(f(G.g_aVehicles[vehicle.index ^ 1].distance - vehicle.distance)) * 0.5);
        if (gap < 18.0) {
            extra = 0.0;
        } else {
            extra = f(gap - 18.0);
            if (30.0 < extra) {
                extra = 30.0;
            }
        }
    }
    const c = vehicle.torqueCurve;
    let torque = f(f(f(f(f(f(f(c[0] * rpm) * rpm) * rpm) + f(f(c[1] * rpm) * rpm)) + f(c[2] * rpm)) + c[3]) + extra);
    if (!vehicle.transmission) {
        torque = f(torque * 1.03);
    }
    if (!(buttons & INPUT_ACCELERATE)) {
        torque = 0.0;
    }
    vehicle.throttle = f(torque * 7.0);
    if (vehicle.racer!.status & RACER_HELD) {
        vehicle.gear = 0;
        gear = 0;
    } else {
        gear = vehicle.gear;
        if (gear === 0) {
            vehicle.gear = 1;
            gear = 1;
        }
    }
    if (gear) {
        vehicle.engineRpm = f(vehicle.gearRatios[gear] * f(f(-f(vehicle.wheelBodies[1].spinRate / TWO_PI_F) * 60.0) * vehicle.finalDrive));
    } else {
        if (input.buttons & INPUT_ACCELERATE) {
            vehicle.engineRpm = f(vehicle.engineRpm + 300.0);
        } else {
            vehicle.engineRpm = f(vehicle.engineRpm - 200.0);
        }
        vehicle.throttle = 0.0;
    }

    if (vehicle.engineRpm < 0.0) {
        vehicle.engineRpm = -vehicle.engineRpm;
    }
    if (vehicle.engineRpm < MIN_RPM) {
        vehicle.engineRpm = MIN_RPM;
    }
    if (MAX_RPM < vehicle.engineRpm) {
        vehicle.engineRpm = MAX_RPM;
    }
    let change = f(vehicle.engineRpm - previous);
    if (MAX_RPM_CHANGE < AbsOf(change)) {
        change = f(SignOf(change) * MAX_RPM_CHANGE);
    }
    vehicle.brake = 0.0;
    vehicle.engineRpm = f(previous + change);
    if (input.buttons & INPUT_BRAKE) {
        vehicle.brake = -140000.0;
    }
}

function INIT_WHEEL_BODY(wheel: RigidBody, px: number, py: number): void {
    wheel.ground = null;
    wheel.kind = RIGID_BODY_NO_ROTATION;
    wheel.spinRate = 0;
    wheel.suspension = 0;
    wheel.mass = 0.0;
    wheel.size.x = 0.0;
    wheel.size.y = 0.0;
    wheel.size.z = 0.0;
    InitRigidBody(wheel);
    wheel.state.position.x = px;
    wheel.state.position.y = py;
    wheel.state.position.z = f(-0.1);
    wheel.state.angularVelocity.x = 0.0;
    wheel.state.angularVelocity.y = 0.0;
    wheel.state.angularVelocity.z = 0.0;
    wheel.state.orientation.w = 1.0;
    wheel.state.orientation.x = 0.0;
    wheel.state.orientation.y = 0.0;
    wheel.state.orientation.z = 0.0;
    wheel.state.velocity.x = 0.0;
    wheel.state.velocity.y = 0.0;
    wheel.state.velocity.z = 0.0;
    QuaternionToMatrix(wheel.orientation, wheel.state);
}

function INIT_BODY_FORCE(vehicle: Vehicle, force: number, px: number, py: number): void {
    SetRigidBodyForce(vehicle.forces[force], 0.0, 0.0, 0.0, px, py, 0.0, RIGID_BODY_FORCE_BODY);
}

export function InitVehiclePhysics(vehicle: Vehicle): void {
    vehicle.skipDrive = 1;
    vehicle.gear = 0;
    vehicle.steerAngle = 0.0;
    vehicle.engineRpm = 0.0;
    const model = vehicle.model;
    if (model !== null) {
        const body = vehicle.body;
        const forces = vehicle.forces;
        body.kind = RIGID_BODY_BOX_1;
        body.size.y = 2.0;
        body.mass = 1000.0;
        body.size.x = 3.5;
        body.size.z = 1.5;
        InitRigidBody(body);
        body.state.position.x = 0.0;
        body.state.position.y = 0.0;
        body.state.position.z = 2.0;
        body.state.velocity.x = 0.0;
        body.state.velocity.y = 0.0;
        body.state.velocity.z = 0.0;
        body.state.orientation.x = 0.0;
        body.state.orientation.y = 0.0;
        body.state.orientation.z = 0.0;
        body.state.angularVelocity.x = 0.0;
        body.state.angularVelocity.y = 0.0;
        body.state.angularVelocity.z = 0.0;
        body.state.orientation.w = 1.0;
        QuaternionToMatrix(body.orientation, body.state);
        body.springRate = f(f(f(vehicle.suspensionStiffness * 4.0) + 20.0) * 16000.0);
        body.damping = -3000.0;

        INIT_WHEEL_BODY(vehicle.wheelBodies[0], model.wheels[2].x, model.wheels[2].y);
        INIT_WHEEL_BODY(vehicle.wheelBodies[2], model.wheels[2].x, -model.wheels[2].y);
        INIT_WHEEL_BODY(vehicle.wheelBodies[1], model.wheels[1].x, model.wheels[1].y);
        INIT_WHEEL_BODY(vehicle.wheelBodies[3], model.wheels[1].x, -model.wheels[1].y);
        body.wheels[0] = vehicle.wheelBodies[0];
        body.wheels[1] = vehicle.wheelBodies[2];
        body.wheels[2] = vehicle.wheelBodies[1];
        body.wheels[3] = vehicle.wheelBodies[3];

        const wheelGravity = f(-f(10.5 * f(9.81)));
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_SPRING_0, -1.5, -1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_SPRING_2, -1.5, 1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_SPRING_1, 1.5, -1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_SPRING_3, 1.5, 1.0);
        SetRigidBodyForce(forces[VEHICLE_FORCE_GRAVITY], 0.0, 0.0, -15450.75, 0.0, 0.0, 0.0, RIGID_BODY_FORCE_WORLD);
        SetRigidBodyForce(forces[VEHICLE_FORCE_FRONT_WHEEL_GRAVITY], 0.0, 0.0, wheelGravity, 0.0, 0.0, 0.0, RIGID_BODY_FORCE_WORLD);
        SetRigidBodyForce(forces[VEHICLE_FORCE_REAR_WHEEL_GRAVITY], 0.0, 0.0, wheelGravity, 0.0, 0.0, 0.0, RIGID_BODY_FORCE_WORLD);
        forces[VEHICLE_FORCE_SPRING_0].next = forces[VEHICLE_FORCE_SPRING_2];
        forces[VEHICLE_FORCE_SPRING_2].next = forces[VEHICLE_FORCE_SPRING_1];
        forces[VEHICLE_FORCE_SPRING_1].next = forces[VEHICLE_FORCE_SPRING_3];
        forces[VEHICLE_FORCE_GRAVITY].next = null;
        forces[VEHICLE_FORCE_SPRING_3].next = forces[VEHICLE_FORCE_GRAVITY];
        body.forces = forces[VEHICLE_FORCE_SPRING_0];

        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_WHEEL_0, 0.0, 0.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_WHEEL_2, 0.0, 0.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_WHEEL_1, 0.0, 0.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_WHEEL_3, 0.0, 0.0);
        vehicle.wheelBodies[0].forces = forces[VEHICLE_FORCE_WHEEL_0];
        vehicle.wheelBodies[2].forces = forces[VEHICLE_FORCE_WHEEL_2];
        vehicle.wheelBodies[1].forces = forces[VEHICLE_FORCE_WHEEL_1];
        forces[VEHICLE_FORCE_REAR_WHEEL_GRAVITY].next = null;
        forces[VEHICLE_FORCE_FRONT_WHEEL_GRAVITY].next = null;
        forces[VEHICLE_FORCE_WHEEL_0].next = forces[VEHICLE_FORCE_REAR_WHEEL_GRAVITY];
        forces[VEHICLE_FORCE_WHEEL_2].next = forces[VEHICLE_FORCE_REAR_WHEEL_GRAVITY];
        forces[VEHICLE_FORCE_WHEEL_1].next = forces[VEHICLE_FORCE_FRONT_WHEEL_GRAVITY];
        forces[VEHICLE_FORCE_WHEEL_3].next = forces[VEHICLE_FORCE_FRONT_WHEEL_GRAVITY];
        vehicle.wheelBodies[3].forces = forces[VEHICLE_FORCE_WHEEL_3];

        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_DAMPER_0, -1.5, -1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_DAMPER_2, -1.5, 1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_DAMPER_1, 1.5, -1.0);
        INIT_BODY_FORCE(vehicle, VEHICLE_FORCE_DAMPER_3, 1.5, 1.0);
        SetRigidBodyForce(forces[VEHICLE_FORCE_DRAG], 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, RIGID_BODY_FORCE_WORLD);
        forces[VEHICLE_FORCE_DAMPER_0].next = forces[VEHICLE_FORCE_DAMPER_2];
        forces[VEHICLE_FORCE_DAMPER_2].next = forces[VEHICLE_FORCE_DAMPER_1];
        forces[VEHICLE_FORCE_DRAG].next = null;
        vehicle.steerReturn = 0;
        vehicle.frontLoad = 0;
        vehicle.rearLoad = 0;
        forces[VEHICLE_FORCE_DAMPER_3].next = forces[VEHICLE_FORCE_DRAG];
        body.tireType = vehicle.tireType;
        forces[VEHICLE_FORCE_DAMPER_1].next = forces[VEHICLE_FORCE_DAMPER_3];
    }
    vehicle.rearSliding = 0;
    vehicle.frontSliding = 0;
}
