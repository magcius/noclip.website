import { DriveAiVehicle } from "./driving.js";
import { f, s16, s32 } from "./f32.js";
import { G, GAME_MODE_AFTER_SEASON, GAME_MODE_ARCADE, GAME_MODE_CHAMPIONSHIP, GAME_MODE_PRACTICE, GAME_MODE_TIME_ATTACK } from "./globals.js";
import { INPUT_BRAKE, INPUT_EBRAKE, INPUT_VIEWS } from "./input.js";
import { TRACK_SECTION_ALTERNATE, TRACK_SURFACE_START } from "./track.js";
import { RACER_FINISHED, RACER_HELD, RacerSlot, TrackGate, TrackPoint, TrackSection, VEHICLE_GHOST, Vec3f, Vehicle, VehicleModelInfo, copyVec3, vec3 } from "./types.js";
import { QuickSort } from "./util.js";
import {
    Atan2f,
    TestLineSegmentIntersection,
    Vec3fCross,
    Vec3fDirection,
    Vec3fDistance,
    Vec3fLength,
    Vec3fLerp,
    Vec3fMidpoint,
    Vec3fNormalize,
    Vec3fScaleInPlace,
    Vec3fSubtract,
} from "./vecmath.js";
import {
    CheckWrongWayWarning,
    InitVehiclePhysics,
    SetVehicleFrameMatrix,
    SetVehiclePosition,
    SetVehicleVelocity,
    UpdateHudMessageTimers,
    UpdateRaceTimers,
    UpdateVehicleGridPosition,
    g_abPlayerColorsRgb,
} from "./vehicle.js";
import { ResetVehicleEffects } from "./vehiclesetup.js";

const LEADING_RACERS = 13;
const STRAGGLER_SPACING = 600;
const STRAGGLER_START = 7760;
const RACER_SPACING = 550;
const NARROW_RACER_SPACING = 520;
const ARCADE_VEHICLES = 2;
const RACER_KINDS = 2;
const KEY_OTHER_PLAYER = f(1e10);
const KEY_FINISHED = f(1e9);
const RELEASE_KEY = 80000.0;
const SLOT_COOLDOWN_FRAMES = 60;
const ACQUIRE_HEIGHT = f(0.1);
const ACQUIRE_SPEED = f(50.0);
const ACQUIRE_UPRIGHT_FRAMES = 40;
const AI_START_GRACE = -180;
const LAP_MESSAGE_TIME = f(1.0);
const FINISH_MESSAGE_TIME = f(5.0);
const RECORD_MESSAGE_TIME = f(1.5);
const RECORD_SUB_MESSAGE_TIME = f(3.5);
const CHECKPOINT_MESSAGE_TIME = f(0.4);
const CHECKPOINT_SUB_MESSAGE_TIME = f(0.9);
const FINISH_OPACITY = f(0.9);
const RECORD_LAPS = 3;
const LAP_TIME_SCALE = f(100.0);
const PACE_SCALE = f(2.24);
const NO_PACE = f(1000.0);
const WAY_BEHIND = f(120.0);
const GHOST_FADE_RATE = f(1.6);
const TIME_ATTACK_GHOST_OPACITY = f(0.375);
const IDLE_RACER_STEP = f(2.22);
const FINISHED_STEERING_INPUT = -127;
const ARCADE_WEATHERS = 3;
const TRACK_COASTLINE = 2;
const TRACK_MIRROR_COASTLINE = 7;
const SOUND_EFFECT_CHANNELS = 5;

interface ArcadeTimes {
    gateBonuses: number[];
    startTime: number;
}

const ARCADE_TIME_ROWS: number[][][] = [
    [[57, 22, 22, 22, 22, 22, 60], [57, 24, 22, 22, 22, 22, 60], [57, 25, 23, 23, 23, 23, 60], [57, 22, 21, 22, 21, 16, 60], [57, 24, 21, 22, 21, 16, 60], [57, 25, 22, 23, 22, 17, 60], [33, 27, 22, 22, 19, 18, 40], [33, 27, 24, 24, 20, 18, 40], [33, 30, 27, 27, 22, 19, 40], [33, 27, 22, 21, 19, 18, 40], [33, 27, 24, 21, 19, 18, 40], [33, 30, 27, 24, 22, 21, 40]],
    [[87, 24, 19, 19, 19, 14, 90], [87, 26, 21, 21, 21, 14, 90], [87, 31, 26, 26, 26, 20, 90], [83, 18, 18, 18, 18, 14, 90], [83, 20, 20, 19, 19, 15, 90], [83, 25, 25, 24, 24, 20, 90], [45, 29, 27, 20, 19, 12, 50], [45, 30, 28, 21, 20, 11, 50], [55, 34, 32, 25, 26, 15, 60], [45, 28, 25, 19, 18, 11, 50], [45, 28, 27, 19, 17, 10, 50], [55, 31, 30, 22, 20, 10, 60]],
    [[47, 17, 17, 17, 17, 17, 50], [47, 18, 18, 17, 17, 17, 50], [47, 20, 20, 19, 19, 17, 50], [45, 14, 13, 13, 13, 13, 50], [45, 15, 14, 13, 13, 13, 50], [45, 17, 16, 15, 15, 15, 50], [30, 14, 13, 13, 12, 11, 40], [30, 16, 14, 13, 12, 11, 40], [30, 18, 16, 15, 14, 13, 40], [30, 13, 13, 12, 12, 11, 40], [30, 14, 14, 12, 12, 11, 40], [30, 16, 16, 14, 14, 14, 40]],
    [[57, 14, 14, 14, 14, 14, 60], [57, 16, 16, 16, 15, 14, 60], [57, 16, 16, 16, 15, 14, 60], [54, 12, 12, 12, 12, 12, 58], [54, 14, 14, 14, 13, 12, 58], [54, 14, 14, 14, 13, 12, 58], [20, 15, 19, 21, 9, 0, 25], [20, 17, 21, 20, 10, 0, 25], [25, 18, 22, 22, 10, 0, 30], [20, 15, 19, 21, 9, 0, 25], [20, 17, 21, 22, 10, 0, 25], [25, 17, 21, 22, 10, 0, 30]],
    [[57, 19, 19, 19, 19, 19, 60], [57, 21, 19, 19, 19, 19, 60], [57, 23, 21, 21, 21, 21, 60], [54, 17, 17, 17, 16, 16, 60], [54, 19, 17, 17, 16, 16, 60], [54, 21, 19, 19, 18, 18, 60], [25, 22, 22, 22, 20, 17, 30], [27, 24, 23, 22, 20, 17, 30], [27, 26, 25, 24, 22, 20, 30], [25, 22, 21, 21, 20, 17, 30], [27, 24, 23, 21, 20, 17, 30], [27, 26, 25, 23, 22, 19, 30]],
    new Array(12).fill([30, 30, 30, 30, 30, 30, 120]),
];

const ARCADE_TRACK_ROWS = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 5];

export const g_aArcadeTimes: ArcadeTimes[][][] = ARCADE_TRACK_ROWS.map((row) =>
    [0, 1, 2, 3].map((carClass) =>
        [0, 1, 2].map((weather) => {
            const values = ARCADE_TIME_ROWS[row][carClass * ARCADE_WEATHERS + weather];
            return { gateBonuses: values.slice(0, 6), startTime: values[6] };
        }),
    ),
);

export const g_vTrackRoutePoint: Vec3f = vec3();

export const racersGlobals = {
    g_pTrackRouteSection: null as TrackSection | null,
    g_dwTrackRoutePointIndex: 0,
    g_dwTrackRouteGates: 0,
    g_dwTrackRouteLaps: 0,
};

export const g_apszRaceProgressStrings: string[] = [
    "%ryFirst!",
    "%rySecond!",
    "%ryThird!",
    "%ryFourth",
    "%ryFifth",
    "%rySixth",
    "%ry7th",
    "%ry8th",
    "%ry9th",
    "%ry10th",
    "%ry11th",
    "%ry12th",
    "%ry13th",
    "%ry14th",
    "%ry15th",
    "%ry16th",
    "%ry17th",
    "%ry18th",
    "%ry19th",
    "%ry20th",
];

export const racersHooks = {
    PlayBeepSound: (): void => {},
    SetMaterialColor: (_model: VehicleModelInfo | null, _red: number, _green: number, _blue: number): void => {},
    DeformVehicleMeshByImpact: (_vehicle: Vehicle, _direction: Vec3f, _amount: number): void => {},
    g_aSoundEffectChannels: Array.from({ length: SOUND_EFFECT_CHANNELS }, () => ({ step: 0, volume: 0 })),
};

interface RacerProgress {
    progress: number;
    slot: number;
}

function FloatToInt(x: number): number {
    return x >= 2147483648 || x <= -2147483649 || x !== x ? 0x7fffffff : s32(x);
}

function format02(n: number): string {
    return n < 0 ? `-${-n}` : `${n}`.padStart(2, "0");
}

function FormatLapTime(seconds: number): string {
    const hundredths = s32(f(seconds * f(100.0)));
    const whole = s32(hundredths / 100);
    const minutes = s32(whole / 60);
    return `${minutes}'${format02(whole - minutes * 60)}"${format02(hundredths - whole * 100)}`;
}

function CROSSES_GATE(gate: TrackGate, from: Vec3f, to: Vec3f): number {
    return TestLineSegmentIntersection(gate.ends[1], gate.ends[0], from, to);
}

function COUNT_ROUTE_GATE(from: Vec3f, to: Vec3f): void {
    const track = G.g_LoadedTrack;
    if (track.gateCount) {
        const next = (racersGlobals.g_dwTrackRouteGates + 1) % track.gateCount;
        if (CROSSES_GATE(track.gates[next], from, to)) {
            racersGlobals.g_dwTrackRouteGates++;
            if (next === 0) {
                racersGlobals.g_dwTrackRouteLaps++;
            }
        }
    }
}

function SKIP_ALTERNATE_SECTIONS(section: TrackSection | null): TrackSection | null {
    while (section !== null && section.flags & TRACK_SECTION_ALTERNATE) {
        section = section.next;
    }
    return section;
}

export function FindTrackRoutePoint(section: TrackSection | null, distance: number): void {
    racersGlobals.g_dwTrackRouteGates = 0;
    racersGlobals.g_dwTrackRouteLaps = 0;
    for (;;) {
        section = SKIP_ALTERNATE_SECTIONS(section);
        if (section === null) {
            return;
        }
        for (let i = 0; i < section.pointCount; i++) {
            const span = f(section.points[i].distance - section.points[i + 1].distance);
            if (span < distance) {
                distance = f(distance - span);
                COUNT_ROUTE_GATE(section.points[i].position, section.points[i + 1].position);
                continue;
            }
            Vec3fLerp(g_vTrackRoutePoint, section.points[i + 1].position, section.points[i].position, f(distance / span));
            COUNT_ROUTE_GATE(section.points[i].position, g_vTrackRoutePoint);
            racersGlobals.g_pTrackRouteSection = section;
            racersGlobals.g_dwTrackRoutePointIndex = i;
            return;
        }
        section = section.child;
    }
}

export function AdvanceAlongTrackRoute(section: TrackSection | null, pointIndex: number, fraction: number, distance: number): void {
    for (;;) {
        section = SKIP_ALTERNATE_SECTIONS(section);
        if (section === null) {
            return;
        }
        for (; pointIndex < section.pointCount; pointIndex++) {
            const length = f(f(section.points[pointIndex].distance - section.points[pointIndex + 1].distance) * fraction);
            if (length < distance) {
                fraction = 1.0;
                distance = f(distance - length);
                continue;
            }
            Vec3fLerp(g_vTrackRoutePoint, section.points[pointIndex].position, section.points[pointIndex + 1].position, fraction);
            Vec3fLerp(g_vTrackRoutePoint, section.points[pointIndex + 1].position, g_vTrackRoutePoint, f(distance / length));
            racersGlobals.g_pTrackRouteSection = section;
            racersGlobals.g_dwTrackRoutePointIndex = pointIndex;
            return;
        }
        section = section.child;
        pointIndex = 0;
    }
}

function ARCADE_WEATHER(): number {
    let weather = s16(G.g_dwCurrentWeather - 1);
    if (weather >= ARCADE_WEATHERS || weather < 0) {
        weather = 0;
    }
    return weather;
}

function SELECTED_ARCADE_TIMES(weather: number): ArcadeTimes {
    return g_aArcadeTimes[G.g_dwSelectedTrackId][G.g_aVehicles[0].tableIndex][weather];
}

export function InitRacerSlot(slot: RacerSlot): void {
    let count: number;

    switch (G.g_dwGameMode | 0) {
        case GAME_MODE_ARCADE:
            count = ARCADE_VEHICLES;
            break;
        case GAME_MODE_CHAMPIONSHIP:
            count = G.g_dwNumLocalPlayers;
            break;
        default:
            count = G.g_dwNumActiveVehicles;
            break;
    }
    const index = G.g_aRacerSlots.indexOf(slot);
    slot.index = index;
    slot.color[0] = g_abPlayerColorsRgb[index][0];
    slot.color[1] = g_abPlayerColorsRgb[index][1];
    slot.color[2] = g_abPlayerColorsRgb[index][2];
    slot.status = 0;
    slot.straggler = index < (G.g_dwNumLocalPlayers | 0) + LEADING_RACERS ? 0 : 1;
    if (slot.index < count) {
        slot.vehicle = G.g_aVehicles[slot.index];
        slot.vehicle.racer = slot;
        return;
    }

    slot.vehicle = null;
    if (slot.straggler === 1) {
        slot.distance = f(STRAGGLER_SPACING * (slot.index - (G.g_dwNumLocalPlayers | 0)) - STRAGGLER_START);
    } else if (G.g_dwSelectedTrackId === TRACK_COASTLINE || G.g_dwSelectedTrackId === TRACK_MIRROR_COASTLINE) {
        slot.distance = f(slot.index * NARROW_RACER_SPACING);
    } else {
        slot.distance = f(slot.index * RACER_SPACING);
    }
    FindTrackRoutePoint(G.g_LoadedTrack.rootSection, slot.distance);
    slot.position.x = g_vTrackRoutePoint.x;
    slot.position.y = g_vTrackRoutePoint.y;
    slot.position.z = g_vTrackRoutePoint.z;
    slot.section = racersGlobals.g_pTrackRouteSection;
    slot.pointIndex = racersGlobals.g_dwTrackRoutePointIndex;
    slot.maxGate = slot.gate = racersGlobals.g_dwTrackRouteGates;
    slot.lap = slot.distanceLaps = racersGlobals.g_dwTrackRouteLaps;
    slot.previousPosition.x = slot.position.x;
    slot.previousPosition.y = slot.position.y;
    slot.previousPosition.z = slot.position.z;
    slot.lapTime = 0.0;
    slot.totalTime = 0.0;
    slot.bestLapTime = 0.0;
    slot.timeLeft = SELECTED_ARCADE_TIMES(ARCADE_WEATHER()).startTime;
    slot.racePosition = G.g_dwNumVehicles - slot.index - 1;
}

function CompareRacerProgressAsc(first: RacerProgress, second: RacerProgress): number {
    if (second.progress < first.progress) {
        return 1;
    }
    if (first.progress < second.progress) {
        return -1;
    }
    return 0;
}

export function SortRacersByPosition(): void {
    const entries: RacerProgress[] = [];
    let count = 0;

    for (let i = 0; i < G.g_dwNumVehicles; i++) {
        const slot = G.g_aRacerSlots[i];
        if (slot.status & RACER_FINISHED) {
            continue;
        }
        entries[count] = { slot: i, progress: slot.vehicle !== null ? slot.vehicle.distance : slot.distance };
        count++;
    }
    if (count) {
        QuickSort(entries, count, CompareRacerProgressAsc);
    }
    for (let i = 0; i < count; i++) {
        const slot = G.g_aRacerSlots[entries[i].slot];
        if (slot.vehicle !== null) {
            slot.vehicle.racePosition = G.g_dwNumVehicles - i - 1;
        } else {
            slot.racePosition = G.g_dwNumVehicles - i - 1;
        }
    }
}

function WrapHalfLap(distance: number, lapLength: number): number {
    if (f(lapLength * 0.5) < distance) {
        distance = f(distance - lapLength);
    } else if (distance < f(lapLength * -0.5)) {
        distance = f(distance + lapLength);
    }
    return distance;
}

function RacerSharingKey(slot: RacerSlot, player: Vehicle, lapLength: number): number {
    const vehicle = slot.vehicle;
    let gap: number;

    if (vehicle !== null) {
        if (vehicle !== player && vehicle.index < (G.g_dwNumLocalPlayers | 0)) {
            return KEY_OTHER_PLAYER;
        }
        if (
            G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP &&
            vehicle.index >= (G.g_dwNumLocalPlayers | 0) &&
            vehicle.racer!.status & RACER_FINISHED &&
            vehicle.ghostMode === VEHICLE_GHOST &&
            vehicle.opacity === 0.0
        ) {
            return KEY_FINISHED;
        }
        gap = f(f(player.distance - vehicle.distance) + f(f(vehicle.distanceLaps - player.distanceLaps) * lapLength));
        gap = WrapHalfLap(gap, lapLength);
        return f(Vec3fDistance(player.frame.position, vehicle.frame.position) + f(gap * gap));
    }
    if (G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP && slot.index >= (G.g_dwNumLocalPlayers | 0) && slot.status & RACER_FINISHED) {
        return KEY_FINISHED;
    }
    gap = f(f(f(slot.distanceLaps - player.distanceLaps) * lapLength) + f(player.distance - slot.distance));
    gap = WrapHalfLap(gap, lapLength);
    return f(Vec3fDistance(player.frame.position, slot.position) + f(gap * gap));
}

function ReleaseRacerVehicle(slot: RacerSlot, vehicle: Vehicle, _key: number): void {
    copyVec3(slot.position, vehicle.frame.position);
    copyVec3(slot.velocity, vehicle.placedVelocity);
    slot.speedKph = vehicle.speedKph;
    slot.section = vehicle.section;
    slot.pointIndex = vehicle.pointIndex;
    slot.lapTime = vehicle.lapTime;
    slot.bestLapTime = vehicle.bestLapTime;
    slot.totalTime = vehicle.totalTime;
    slot.timeLeft = vehicle.timeLeft;
    slot.lap = vehicle.lap;
    slot.distanceLaps = vehicle.distanceLaps;
    slot.maxGate = vehicle.maxGate;
    slot.gate = vehicle.gate;
    slot.distance = vehicle.distance;
    slot.racePosition = vehicle.racePosition;
}

function AcquireRacerVehicle(slot: RacerSlot, vehicle: Vehicle): void {
    const left = vec3();
    const nextLeft = vec3();

    slot.vehicle = vehicle;
    vehicle.speedKph = slot.speedKph;
    vehicle.section = slot.section;
    vehicle.pointIndex = slot.pointIndex;
    vehicle.lapTime = slot.lapTime;
    vehicle.bestLapTime = slot.bestLapTime;
    vehicle.totalTime = slot.totalTime;
    vehicle.timeLeft = slot.timeLeft;
    vehicle.lap = slot.lap;
    vehicle.distanceLaps = slot.distanceLaps;
    vehicle.maxGate = slot.maxGate;
    vehicle.gate = slot.gate;
    vehicle.distance = slot.distance;
    vehicle.racer = slot;
    vehicle.ghostMode = 0;
    vehicle.opacity = 1.0;
    vehicle.cameraChanged = 1;
    vehicle.racePosition = slot.racePosition;
    InitVehiclePhysics(vehicle);
    ResetVehicleEffects(vehicle);
    copyVec3(vehicle.previousPosition, slot.previousPosition);
    SetVehiclePosition(vehicle, slot.position.x, slot.position.y, f(slot.position.z + ACQUIRE_HEIGHT));
    vehicle.ghostMode = 0;
    vehicle.opacity = 1.0;
    vehicle.color[0] = slot.color[0];
    vehicle.color[1] = slot.color[1];
    vehicle.color[2] = slot.color[2];
    racersHooks.SetMaterialColor(vehicle.model, slot.color[0] >> 3, slot.color[1] >> 3, slot.color[2] >> 3);

    const points: TrackPoint[] = vehicle.section!.points;
    Vec3fSubtract(left, points[vehicle.pointIndex].left, points[vehicle.pointIndex].position);
    Vec3fSubtract(nextLeft, points[vehicle.pointIndex + 1].left, points[vehicle.pointIndex + 1].position);
    Vec3fDirection(vehicle.frame.forward, points[vehicle.pointIndex].position, points[vehicle.pointIndex + 1].position);
    Vec3fMidpoint(vehicle.frame.side, left, nextLeft);
    Vec3fCross(vehicle.frame.up, vehicle.frame.forward, vehicle.frame.side);
    Vec3fNormalize(vehicle.frame.up);
    Vec3fCross(vehicle.frame.side, vehicle.frame.up, vehicle.frame.forward);
    Vec3fNormalize(vehicle.frame.side);
    copyVec3(vehicle.trackDirection, vehicle.frame.forward);
    SetVehicleFrameMatrix(vehicle, vehicle.frame.m);
    if (vehicle.racer.status & RACER_HELD) {
        SetVehicleVelocity(vehicle, 0.0, 0.0, 0.0);
    } else {
        SetVehicleVelocity(vehicle, f(vehicle.frame.forward.x * ACQUIRE_SPEED), f(vehicle.frame.forward.y * ACQUIRE_SPEED), f(vehicle.frame.forward.z * ACQUIRE_SPEED));
    }
    for (const wheel of [0, 1, 3, 2]) {
        const body = vehicle.body.wheels[wheel]!;
        body.ground = null;
        body.contactFrames = 0;
        body.surface = TRACK_SURFACE_START;
    }
    vehicle.forcedForwardFrames = 0;
    vehicle.forcedReverseFrames = 0;
    vehicle.reverseFrames = 0;
    vehicle.forwardFrames = AI_START_GRACE;
    vehicle.body.uprightFrames = ACQUIRE_UPRIGHT_FRAMES;
    vehicle.steerAngle = 0.0;
}

export function ManageAiRacerSlots(player: Vehicle): void {
    const entries: RacerProgress[] = [];
    const freeVehicles: Vehicle[] = [];
    const lapLength = G.g_LoadedTrack.rootSection.points[0].distance;
    const numLocal = G.g_dwNumLocalPlayers | 0;

    for (let i = 0; i < G.g_dwNumVehicles; i++) {
        entries[i] = { progress: RacerSharingKey(G.g_aRacerSlots[i], player, lapLength), slot: i };
    }
    if (G.g_dwNumVehicles >= 2) {
        const progress = entries[player.index].progress;
        entries[player.index].progress = entries[0].progress;
        entries[0].progress = progress;
        entries[0].slot = player.index;
        entries[player.index].slot = 0;
        QuickSort(entries, G.g_dwNumVehicles - 1, CompareRacerProgressAsc, 1);
    }

    for (let kind = 0; kind !== RACER_KINDS; kind++) {
        let noVehicle = true;
        let freeCount = 0;
        let seen = 0;
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            const slot = G.g_aRacerSlots[entries[i].slot];
            if (slot.straggler !== kind || slot.index < numLocal) {
                continue;
            }
            const vehicle = slot.vehicle;
            if (seen <= 0) {
                seen++;
                if (vehicle === null) {
                    continue;
                }
                noVehicle = false;
                if (!(slot.status & RACER_FINISHED) || vehicle.ghostMode !== VEHICLE_GHOST || vehicle.opacity !== 0.0) {
                    continue;
                }
            } else {
                if (vehicle === null) {
                    continue;
                }
                noVehicle = false;
                if (vehicle.slotCooldown) {
                    continue;
                }
                if (!(RELEASE_KEY < entries[i].progress)) {
                    continue;
                }
            }
            ReleaseRacerVehicle(slot, vehicle, entries[i].progress);
            freeVehicles[freeCount++] = slot.vehicle!;
            slot.vehicle = null;
            vehicle.racer = null;
            vehicle.slotCooldown = SLOT_COOLDOWN_FRAMES;
        }
        if (noVehicle) {
            freeVehicles[freeCount++] = G.g_aVehicles[numLocal + kind];
        }
        if (freeCount === 0 || G.g_dwNumVehicles <= 0) {
            continue;
        }
        for (let i = 0; ; ) {
            const slot = G.g_aRacerSlots[entries[i].slot];
            if (slot.straggler === kind && slot.index >= numLocal && !(slot.status & RACER_FINISHED) && slot.vehicle === null) {
                AcquireRacerVehicle(slot, freeVehicles[--freeCount]);
            }
            player.nearestRacers[i] = G.g_aRacerSlots[entries[i].slot];
            i++;
            if (freeCount === 0 || i >= G.g_dwNumVehicles) {
                break;
            }
        }
    }
}

function GateInLap(gate: number, count: number): number {
    if (gate < 0) {
        return (count - ((-1 - gate) % count) - 1) % count;
    }
    return gate % count;
}

function LapBack(slot: RacerSlot): void {
    const track = G.g_LoadedTrack;
    slot.lap--;
    slot.distanceLaps--;
    slot.maxGate -= track.gateCount;
    slot.gate -= track.gateCount;
    if (track.rootSection !== null) {
        slot.distance = f(slot.distance - track.rootSection.points[0].distance);
    }
}

function FinishRacer(slot: RacerSlot, vehicle: Vehicle | null): void {
    slot.status |= RACER_FINISHED;
    if (vehicle !== null) {
        vehicle.opacity = FINISH_OPACITY;
        vehicle.totalTime = f(vehicle.totalTime - slot.lapTime);
        slot.lapTime = 0.0;
        vehicle.racePosition = G.g_dwRaceFinishOrderCounter;
        vehicle.message = g_apszRaceProgressStrings[G.g_dwRaceFinishOrderCounter];
        vehicle.messageTime = FINISH_MESSAGE_TIME;
        if (slot.index < (G.g_dwNumLocalPlayers | 0) && G.g_dwTotalLaps === RECORD_LAPS) {
            const records = G.g_pActiveProfile.raceRecords;
            const record = records[G.g_dwSelectedTrackId];
            if (record === 0.0 || vehicle.totalTime < record) {
                records[G.g_dwSelectedTrackId] = vehicle.totalTime;
                vehicle.subMessage = "%ryNEW COURSE RECORD!";
                vehicle.messageTime = RECORD_MESSAGE_TIME;
                vehicle.subMessageTime = RECORD_SUB_MESSAGE_TIME;
            }
        }
    }
    G.g_dwRaceFinishOrderCounter++;
}

function PassArcadeCheckpoint(slot: RacerSlot, gate: number): void {
    if (!G.gInstantReplayActive) {
        racersHooks.PlayBeepSound();
    }
    let gap = f(G.g_aVehicles[0].distance - G.g_aVehicles[1].distance);
    if (gap < 0.0) {
        gap = -gap;
    }
    let pace = f(slot.vehicle!.odometer / f(slot.vehicle!.totalTime * PACE_SCALE));
    if (pace === 0.0) {
        pace = NO_PACE;
    } else {
        pace = f(gap / pace);
    }
    for (let i = 0; i < (G.g_dwNumLocalPlayers | 0); i++) {
        const other = G.g_aRacerSlots[i].vehicle!;
        other.message = "%ryCheck Point!";
        other.messageTime = CHECKPOINT_MESSAGE_TIME;
        other.timeLeft = f(other.timeLeft + SELECTED_ARCADE_TIMES(ARCADE_WEATHER()).gateBonuses[gate]);
        if (G.g_dwNumLocalPlayers === 1) {
            other.messageText = `%ry${FormatLapTime(other.timeLeft)} Left`;
            other.subMessage = other.messageText;
            other.subMessageTime = CHECKPOINT_SUB_MESSAGE_TIME;
        } else if (other.totalTime !== 0.0) {
            other.messageText = `%ry${FormatLapTime(pace)}`;
            if (other.racePosition !== 0) {
                if (WAY_BEHIND < pace) {
                    other.subMessage = "%ryYou're way behind!";
                }
                other.messageText += " Behind";
            } else {
                other.messageText += " Ahead";
            }
            other.subMessage = other.messageText;
            other.subMessageTime = CHECKPOINT_SUB_MESSAGE_TIME;
        }
        other.maxGate = slot.maxGate;
    }
}

function ShowLapMessage(slot: RacerSlot, vehicle: Vehicle, message: string | null): void {
    vehicle.messageText = `%ryLAP ${slot.lap + 1}`;
    vehicle.message = vehicle.messageText;
    vehicle.messageTime = LAP_MESSAGE_TIME;
    if (message !== null) {
        vehicle.subMessage = message;
        vehicle.subMessageTime = LAP_MESSAGE_TIME;
    }
}

function ReachNewGate(slot: RacerSlot, vehicle: Vehicle | null, next: number, lapTime: number): void {
    slot.maxGate = slot.gate;
    if (next === 0) {
        if (slot.lap < G.g_dwTotalLaps) {
            let message: string | null = null;
            if (slot.bestLapTime === 0.0 || lapTime < slot.bestLapTime) {
                slot.bestLapTime = lapTime;
                if (slot.index < (G.g_dwNumLocalPlayers | 0)) {
                    slot.vehicle!.bestLap = slot.lap;
                    const records = G.g_pActiveProfile.lapRecords;
                    const record = records[G.g_dwSelectedTrackId];
                    if (record === 0.0 || slot.bestLapTime < record) {
                        records[G.g_dwSelectedTrackId] = slot.bestLapTime;
                        message = "%ryNEW LAP RECORD!";
                    } else if (slot.lap !== 0) {
                        message = "%ryBEST LAP!";
                    }
                }
            }
            if (vehicle !== null) {
                vehicle.lapTimes[slot.lap] = lapTime;
            }
            slot.lap++;
            slot.distanceLaps = slot.lap;
            slot.lapTime = f(slot.lapTime - lapTime);
            if (G.g_dwGameMode === GAME_MODE_PRACTICE) {
                if (slot.lap === 1) {
                    LapBack(slot);
                }
            } else if (vehicle !== null) {
                ShowLapMessage(slot, vehicle, message);
            }
        }
        if (G.g_dwTotalLaps === slot.lap) {
            FinishRacer(slot, vehicle);
            return;
        }
    }
    if (G.g_dwGameMode === GAME_MODE_ARCADE && slot.index < (G.g_dwNumLocalPlayers | 0) && 0.0 < slot.vehicle!.timeLeft) {
        PassArcadeCheckpoint(slot, next);
    }
}

function ReachGateAgain(slot: RacerSlot, vehicle: Vehicle | null, gate: TrackGate, lapTime: number): void {
    if (gate !== G.g_LoadedTrack.gates[0]) {
        return;
    }
    slot.distanceLaps++;
    if (slot.lap < slot.distanceLaps) {
        let message: string | null = null;
        if (slot.bestLapTime === 0.0 || lapTime < slot.bestLapTime) {
            slot.bestLapTime = lapTime;
            if (slot.index < (G.g_dwNumLocalPlayers | 0)) {
                slot.vehicle!.bestLap = slot.lap;
                const records = G.g_pActiveProfile.lapRecords;
                const record = records[G.g_dwSelectedTrackId];
                if (record === 0.0 || slot.bestLapTime < record) {
                    records[G.g_dwSelectedTrackId] = lapTime;
                    message = "%ryNEW LAP RECORD!";
                } else if (slot.lap !== 0) {
                    message = "%ryBEST LAP!";
                }
            }
        }
        if (vehicle !== null) {
            vehicle.lapTimes[slot.lap] = lapTime;
        }
        slot.lap = slot.distanceLaps;
        slot.lapTime = f(slot.lapTime - lapTime);
        if (vehicle !== null) {
            ShowLapMessage(slot, vehicle, message);
        }
    }
    if (G.g_dwGameMode === GAME_MODE_PRACTICE && slot.lap === 1) {
        LapBack(slot);
    }
}

export function UpdateRaceProgress(slot: RacerSlot): void {
    const vehicle = slot.vehicle;
    const track = G.g_LoadedTrack;

    if (track.gateCount === 0) {
        return;
    }
    if (vehicle !== null) {
        copyVec3(slot.position, vehicle.frame.position);
        copyVec3(slot.previousPosition, vehicle.previousPosition);
        slot.maxGate = vehicle.maxGate;
        slot.gate = vehicle.gate;
        slot.lap = vehicle.lap;
        slot.distanceLaps = vehicle.distanceLaps;
        slot.lapTime = vehicle.lapTime;
        slot.bestLapTime = vehicle.bestLapTime;
        slot.distance = vehicle.distance;
    }
    const current = GateInLap(slot.gate, track.gateCount);
    const next = (current + 1) % track.gateCount;
    const lapTime = f(f(FloatToInt(f(slot.lapTime * LAP_TIME_SCALE))) / LAP_TIME_SCALE);

    if (CROSSES_GATE(track.gates[current], slot.previousPosition, slot.position)) {
        if (current === 0) {
            slot.distanceLaps--;
        }
        if (current === slot.maxGate % track.gateCount && slot.gate < 0) {
            slot.gate += track.gateCount;
            slot.distanceLaps++;
            if (track.rootSection !== null) {
                slot.distance = f(slot.distance + track.rootSection.points[0].distance);
            }
        }
        slot.gate--;
    } else {
        const gate = track.gates[next];
        if (CROSSES_GATE(gate, slot.previousPosition, slot.position)) {
            slot.gate++;
            if (slot.maxGate < slot.gate) {
                ReachNewGate(slot, vehicle, next, lapTime);
            } else {
                ReachGateAgain(slot, vehicle, gate, lapTime);
            }
        }
    }

    if (vehicle !== null) {
        vehicle.maxGate = slot.maxGate;
        vehicle.gate = slot.gate;
        vehicle.lap = slot.lap;
        vehicle.distanceLaps = slot.distanceLaps;
        vehicle.lapTime = slot.lapTime;
        vehicle.bestLapTime = slot.bestLapTime;
        vehicle.distance = slot.distance;
    }
}

function DRIVE_RACER_VEHICLE(slot: RacerSlot): void {
    const vehicle = slot.vehicle!;
    copyVec3(vehicle.previousPosition, vehicle.frame.position);
    if (slot.vehicle!.driver !== null) {
        slot.vehicle!.driver(slot.vehicle!);
    }
}

export function UpdateRacerSlotMotion(slot: RacerSlot): void {
    if (slot.vehicle !== null && slot.vehicle.driver === DriveAiVehicle && G.g_dwGameMode !== GAME_MODE_AFTER_SEASON) {
        slot.vehicle.input!.buttons = (slot.vehicle.input!.buttons & INPUT_VIEWS) >>> 0;
        slot.vehicle.input!.steering = 0.0;
    }
    if (G.g_dwRacePauseState) {
        for (let i = 0; i !== SOUND_EFFECT_CHANNELS; i++) {
            racersHooks.g_aSoundEffectChannels[i].step = 0;
            racersHooks.g_aSoundEffectChannels[i].volume = 0;
        }
        return;
    }
    if (slot.status & RACER_HELD) {
        if (slot.vehicle === null) {
            return;
        }
        slot.vehicle.input!.buttons = (slot.vehicle.input!.buttons | INPUT_BRAKE) >>> 0;
        slot.vehicle.gear = 0;
        DRIVE_RACER_VEHICLE(slot);
        slot.vehicle.gear = 0;
        return;
    }
    if (slot.status & RACER_FINISHED) {
        if (slot.vehicle === null) {
            return;
        }
        if (G.g_dwGameMode !== GAME_MODE_CHAMPIONSHIP || slot.index < (G.g_dwNumLocalPlayers | 0)) {
            slot.vehicle.input!.buttons = INPUT_BRAKE | INPUT_EBRAKE;
            slot.vehicle.input!.steeringInput = FINISHED_STEERING_INPUT;
            slot.vehicle.input!.steering = -1.0;
        }
        if (G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP && slot.index >= (G.g_dwNumLocalPlayers | 0)) {
            slot.vehicle.ghostMode = VEHICLE_GHOST;
            slot.vehicle.opacity = f(slot.vehicle.opacity - G.g_fFrameDeltaTime);
            if (slot.vehicle.opacity < 0.0) {
                slot.vehicle.opacity = 0.0;
            }
        }
        DRIVE_RACER_VEHICLE(slot);
        return;
    }
    if (slot.vehicle !== null) {
        if (slot.vehicle.ghostMode === VEHICLE_GHOST) {
            slot.vehicle.opacity = f(slot.vehicle.opacity + f(G.g_fFrameDeltaTime * GHOST_FADE_RATE));
            if (G.g_dwGameMode === GAME_MODE_TIME_ATTACK && slot.index !== 0) {
                if (TIME_ATTACK_GHOST_OPACITY < slot.vehicle.opacity) {
                    slot.vehicle.opacity = TIME_ATTACK_GHOST_OPACITY;
                }
            } else if (1.0 <= slot.vehicle.opacity) {
                slot.vehicle.opacity = 1.0;
                slot.vehicle.ghostMode = 0;
            }
        }
        DRIVE_RACER_VEHICLE(slot);
        slot.vehicle.odometer = f(slot.vehicle.odometer + f(slot.vehicle.speedKph * G.g_fFrameDeltaTime));
        return;
    }

    copyVec3(slot.previousPosition, slot.position);
    const lapLength = G.g_LoadedTrack.rootSection.points[0].distance;
    const points = slot.section!.points;
    const point = slot.pointIndex;
    const fraction = f(
        f(f(f(lapLength * f(slot.distanceLaps + 1)) - slot.distance) - points[point + 1].distance) /
            f(points[point].distance - points[point + 1].distance),
    );
    const pacer = G.g_aVehicles[(G.g_dwNumLocalPlayers | 0) + slot.straggler];
    if (pacer.racer !== null) {
        AdvanceAlongTrackRoute(slot.section, slot.pointIndex, fraction, f(Vec3fLength(pacer.placedVelocity) * G.g_fFrameDeltaTime));
        slot.distance = f(slot.distance + f(Vec3fLength(G.g_aVehicles[(G.g_dwNumLocalPlayers | 0) + slot.straggler].placedVelocity) * G.g_fFrameDeltaTime));
    } else {
        AdvanceAlongTrackRoute(slot.section, slot.pointIndex, fraction, IDLE_RACER_STEP);
        slot.distance = f(slot.distance + IDLE_RACER_STEP);
    }
    slot.section = racersGlobals.g_pTrackRouteSection;
    slot.pointIndex = racersGlobals.g_dwTrackRoutePointIndex;
    copyVec3(slot.position, g_vTrackRoutePoint);
    Vec3fSubtract(slot.velocity, slot.position, slot.previousPosition);
    Vec3fScaleInPlace(slot.velocity, f(1.0 / G.g_fFrameDeltaTime));
    UpdateRaceProgress(slot);
}

export function UpdateRacerSlotRaceState(slot: RacerSlot): void {
    if (G.g_dwRacePauseState || slot.vehicle === null) {
        return;
    }
    if (slot.vehicle.body.impactSpeed) {
        racersHooks.DeformVehicleMeshByImpact(slot.vehicle, slot.vehicle.body.impactPoint, s16(slot.vehicle.body.impactSpeed));
        slot.vehicle.body.impactSpeed = 0;
    }
    UpdateRaceTimers(slot.vehicle);
    UpdateHudMessageTimers(slot.vehicle);
    CheckWrongWayWarning(slot.vehicle);
    UpdateRaceProgress(slot);
    UpdateVehicleGridPosition(slot.vehicle);
    Vec3fSubtract(slot.vehicle.placedVelocity, slot.vehicle.frame.position, slot.vehicle.previousPosition);
    Vec3fScaleInPlace(slot.vehicle.placedVelocity, f(1.0 / G.g_fFrameDeltaTime));
    slot.vehicle.cameraHeading = Atan2f(slot.vehicle.activeCamera.forward.x, slot.vehicle.activeCamera.forward.y);
    if (slot.vehicle.slotCooldown) {
        slot.vehicle.slotCooldown--;
    }
}
