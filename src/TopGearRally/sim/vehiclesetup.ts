import { cosf, f, s16, sinf } from "./f32.js";
import { G, GAME_MODE_ARCADE, GAME_MODE_CHAMPIONSHIP, GAME_MODE_DEMO, GAME_MODE_PRACTICE, GAME_MODE_TIME_ATTACK } from "./globals.js";
import { TRACK_SURFACE_START } from "./track.js";
import {
    RigidBody,
    SPRAY_SEGMENTS,
    SPRAY_SEGMENT_VERTICES,
    VEHICLE_CAMERA_CHASE,
    VEHICLE_DENT_SIDES,
    VEHICLE_GHOST,
    VEHICLE_WHEELS,
    Vehicle,
    copyVec3,
} from "./types.js";

const SPRAY_VERTEX_ALPHA = 0xff;
import { Atan2f, Vec3fDirection } from "./vecmath.js";
import { InitCameraForVehicle, UpdateCameraChase } from "./camera.js";
import {
    ARCADE_WEATHERS,
    BindPlayerInputToVehicle,
    InitVehicleOrientationFromAngle,
    InitVehiclePhysics,
    ResetVehicleState,
    SetVehicleModelSlot,
    SetVehiclePosition,
    SetVehicleTurnRate,
    SetVehicleVelocity,
    g_SeasonTable,
    g_aTrackArcadeTimes,
    g_abPlayerColorsRgb,
    g_dwNumTracks,
} from "./vehicle.js";

const CAR_CHOICE_SEASONS = 4;
const FALLBACK_CAR = 5;
const UNLOCK_BITS = 16;
const NEW_PROFILE_UNLOCKS = 0x102;
const NEW_PROFILE_TRACKS = 4;
const NEW_PROFILE_WEATHERS = 1;
const NEW_PROFILE_TRANSMISSION = 1;
const NEW_PROFILE_HANDLING = 0;
const NEW_PROFILE_SUSPENSION = 1;
const NEW_PROFILE_TIRES = 2;
const SAVED_PROFILES = 2;
const RESPAWN_FALL_DEPTH = 10.0;
const RESPAWN_HEIGHT = 2.0;
const RESPAWN_SPREAD = f(0.01);
const RESPAWN_OPACITY = f(0.1);
const GRID_COLUMN_SPACING = 3.0;
const GRID_ROW_SPACING = 8.0;
const GRID_HEIGHT = f(0.1);
const QUARTER_TURN = f(1.570796371);
const AI_START_GRACE = -180;
const SPRAY_FRAMES_STEP = f(0.137);
const SPRAY_FRAMES_SPREAD = f(0.034);
const SMOKE_TIMER_STEP = f(0.15);

export function ChooseVehicleCar(vehicle: Vehicle): void {
    const season = G.g_aVehicles[0].profile!.season;
    const unlockSeason = season >= CAR_CHOICE_SEASONS ? CAR_CHOICE_SEASONS - 1 : season;
    let car: number;

    if (vehicle.index >= G.g_dwNumLocalPlayers) {
        if (G.g_dwGameMode === GAME_MODE_ARCADE) {
            vehicle.carModel = G.g_aVehicles[0].carModel;
            return;
        }
        let unlocks = s16(g_SeasonTable[unlockSeason].unlocks);
        for (car = 0; car < UNLOCK_BITS; car++) {
            if (unlocks & 1) {
                break;
            }
            unlocks = s16(unlocks >> 1);
        }
        if (car === UNLOCK_BITS) {
            car = FALLBACK_CAR;
        }
        if (G.g_dwNumLocalPlayers < vehicle.index) {
            vehicle.carModel = car;
            return;
        }
        vehicle.carModel = g_SeasonTable[season].cars[vehicle.index - G.g_dwNumLocalPlayers];
        return;
    }
    if (G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP) {
        vehicle.carModel = g_SeasonTable[season].cars[0];
    }
}

export function InitVehicleColor(vehicle: Vehicle): void {
    ResetVehicleState(vehicle);
    const red = g_abPlayerColorsRgb[vehicle.index][0];
    const green = g_abPlayerColorsRgb[vehicle.index][1];
    const blue = g_abPlayerColorsRgb[vehicle.index][2];
    vehicle.ghostMode = 0;
    vehicle.otherLook = 0;
    vehicle.driver = null;
    vehicle.color[0] = red;
    vehicle.color[1] = green;
    vehicle.color[2] = blue;
}

export function InitPlayerVehicleSlot(vehicle: Vehicle): void {
    BindPlayerInputToVehicle(vehicle);
    vehicle.index = G.g_aVehicles.indexOf(vehicle);
    if (vehicle.index < SAVED_PROFILES) {
        const profile = G.g_aSeasonSaveBuffers[vehicle.index];
        vehicle.profile = profile;
        profile.championshipFlags = 0;
        profile.season = 0;
        profile.seasonPoints[0] = 0;
        profile.round = 0;
        profile.unlocks = NEW_PROFILE_UNLOCKS;
        profile.unlockedTracks = NEW_PROFILE_TRACKS;
        profile.unlockedWeathers = NEW_PROFILE_WEATHERS;
        profile.transmission = NEW_PROFILE_TRANSMISSION;
        profile.handling = NEW_PROFILE_HANDLING;
        profile.suspension = NEW_PROFILE_SUSPENSION;
        profile.tires = NEW_PROFILE_TIRES;
        profile.controllerLayout = 0;
        for (let i = 0; i < g_dwNumTracks; i++) {
            profile.lapRecords[i] = 0.0;
            profile.raceRecords[i] = 0.0;
        }
    } else {
        vehicle.profile = null;
    }
    ChooseVehicleCar(vehicle);
    vehicle.customDecals = 0;
}

export function RespawnVehicle(vehicle: Vehicle): void {
    if (vehicle.body.uprightFrames >= 0 && !(vehicle.frame.position.z < f(G.g_LoadedTrack.minZ - RESPAWN_FALL_DEPTH))) {
        return;
    }
    InitVehiclePhysics(vehicle);
    const point = vehicle.section!.points[vehicle.pointIndex];
    if (G.g_dwGameMode === GAME_MODE_TIME_ATTACK) {
        SetVehiclePosition(vehicle, point.position.x, point.position.y, f(point.position.z + RESPAWN_HEIGHT));
    } else {
        SetVehiclePosition(vehicle, f(point.position.x + f(vehicle.index * RESPAWN_SPREAD)), point.position.y, f(point.position.z + RESPAWN_HEIGHT));
    }
    InitVehicleOrientationFromAngle(vehicle, Atan2f(vehicle.trackDirection.x, vehicle.trackDirection.y));
    SetVehicleVelocity(vehicle, 0.0, 0.0, 0.0);
    SetVehicleTurnRate(vehicle, 0.0, 0.0, 0.0);
    const wheels = vehicle.body.wheels as RigidBody[];
    for (const i of [0, 1, 3, 2]) {
        wheels[i].ground = null;
        wheels[i].contactFrames = 0;
        wheels[i].surface = TRACK_SURFACE_START;
    }
    vehicle.forcedForwardFrames = 0;
    vehicle.forcedReverseFrames = 0;
    vehicle.reverseFrames = 0;
    vehicle.forwardFrames = AI_START_GRACE;
    vehicle.body.uprightFrames = 0;
    vehicle.ghostMode = VEHICLE_GHOST;
    vehicle.opacity = RESPAWN_OPACITY;
    UpdateCameraChase(vehicle, vehicle.cameras[VEHICLE_CAMERA_CHASE], 1.0);
    vehicle.cameraChanged = 1;
    copyVec3(vehicle.chasePosition, vehicle.cameras[VEHICLE_CAMERA_CHASE].position);
}

export function ResetVehicleEffects(vehicle: Vehicle): void {
    const start = f(vehicle.index * SPRAY_FRAMES_STEP);
    vehicle.sprayFramesLeft[0] = start;
    vehicle.sprayFramesLeft[1] = f(start + SPRAY_FRAMES_SPREAD);
    vehicle.sprayFramesLeft[2] = f(vehicle.sprayFramesLeft[1] + SPRAY_FRAMES_SPREAD);
    vehicle.sprayFramesLeft[3] = f(vehicle.sprayFramesLeft[2] + SPRAY_FRAMES_SPREAD);
    for (let i = VEHICLE_WHEELS - 1; i >= 0; i--) {
        vehicle.sprayAdvanced[i] = 0;
        vehicle.spraySurfaces[i] = TRACK_SURFACE_START;
    }
    for (let i = 0; i < VEHICLE_WHEELS; i++) {
        vehicle.smokeTimers[i] = f(i * SMOKE_TIMER_STEP);
    }
    for (let i = VEHICLE_WHEELS - 1; i >= 0; i--) {
        vehicle.sprayPhases[i] = 0.0;
        vehicle.sprayFramesLeft[i] = 0.0;
    }
    for (let wheel = 0; wheel < VEHICLE_WHEELS; wheel++) {
        for (let segment = 0; segment < SPRAY_SEGMENTS; segment++) {
            for (let k = 0; k < SPRAY_SEGMENT_VERTICES; k++) {
                const vertex = vehicle.sprayVertices[wheel][segment][k];
                vertex.ob[0] = vertex.ob[1] = vertex.ob[2] = 0;
                vertex.cn[0] = vertex.cn[1] = vertex.cn[2] = 0;
                vertex.cn[3] = SPRAY_VERTEX_ALPHA;
                const velocity = vehicle.sprayVelocities[wheel][segment][k];
                velocity[0] = velocity[1] = velocity[2] = 0;
            }
            vehicle.spraySegmentSurfaces[wheel][segment] = TRACK_SURFACE_START;
        }
    }
}

export function ClearVehicleDamageState(vehicle: Vehicle): void {
    for (let i = 0; i < VEHICLE_DENT_SIDES; i++) {
        vehicle.dents[i] = 0;
    }
    vehicle.dentJitter = 0;
}

export function SetupVehicleForRaceStart(vehicle: Vehicle): void {
    const track = G.g_LoadedTrack;
    let row: number;
    let column: number;

    ResetVehicleState(vehicle);
    if (G.g_dwGameMode === GAME_MODE_TIME_ATTACK || G.g_dwGameMode === GAME_MODE_DEMO ||
        (G.g_dwGameMode === GAME_MODE_PRACTICE && G.g_dwNumLocalPlayers === 1) ||
        G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP) {
        SetVehicleModelSlot(vehicle, vehicle.index);
        row = 0.0;
        column = 0.5;
    } else {
        SetVehicleModelSlot(vehicle, vehicle.index);
        row = vehicle.index >> 1;
        column = (vehicle.index & 1) ^ 1;
    }
    const forwardX = cosf(track.startHeading);
    const forwardY = sinf(track.startHeading);
    const sideX = cosf(f(track.startHeading + QUARTER_TURN));
    const sideY = sinf(f(track.startHeading + QUARTER_TURN));
    SetVehiclePosition(
        vehicle,
        f(f(track.startPosition.x - f(f(sideX * GRID_COLUMN_SPACING) * f(column - 0.5))) - f(f(forwardX * GRID_ROW_SPACING) * f(row + 1.0))),
        f(f(track.startPosition.y - f(f(sideY * GRID_COLUMN_SPACING) * f(column - 0.5))) - f(f(forwardY * GRID_ROW_SPACING) * f(row + 1.0))),
        f(track.startPosition.z + GRID_HEIGHT),
    );
    vehicle.distance = f(f(row + 0.5) * -GRID_ROW_SPACING);
    InitVehicleOrientationFromAngle(vehicle, track.startHeading);
    copyVec3(vehicle.previousPosition, vehicle.frame.position);
    copyVec3(vehicle.previousListenerPosition, vehicle.frame.position);
    InitCameraForVehicle(vehicle);
    vehicle.forcedForwardFrames = 0;
    vehicle.forcedReverseFrames = 0;
    vehicle.reverseFrames = 0;
    vehicle.forwardFrames = AI_START_GRACE;
    SetVehicleVelocity(vehicle, 0.0, 0.0, 0.0);

    const root = track.rootSection;
    if (root !== null) {
        vehicle.lapTime = 0.0;
        vehicle.totalTime = 0.0;
        vehicle.bestLapTime = 0.0;
        let weather = s16(G.g_dwCurrentWeather - 1);
        if (weather >= ARCADE_WEATHERS || weather < 0) {
            weather = 0;
        }
        const times = g_aTrackArcadeTimes[G.g_dwSelectedTrackId];
        vehicle.timeLeft = times !== null && times !== undefined ? times[vehicle.tableIndex][weather].startTime : 0.0;
        vehicle.pointIndex = 0;
        vehicle.section = root;
        Vec3fDirection(vehicle.trackDirection, root.points[0].position, root.points[1].position);
    } else {
        vehicle.trackDirection.y = 0.0;
        vehicle.trackDirection.z = 0.0;
        vehicle.trackDirection.x = 1.0;
    }

    vehicle.lap = 0;
    vehicle.bestLap = 0;
    vehicle.racePosition = G.g_dwNumVehicles - vehicle.index - 1;
    vehicle.maxGate = 0;
    if (vehicle.index < G.g_dwNumLocalPlayers || G.g_dwGameMode === GAME_MODE_ARCADE ||
        G.g_dwGameMode === GAME_MODE_TIME_ATTACK || G.g_dwGameMode === GAME_MODE_DEMO) {
        vehicle.distanceLaps = -1;
        vehicle.gate = -1;
    } else {
        vehicle.distanceLaps = 0;
        vehicle.gate = 0;
    }
    vehicle.groundInstanceCount = 0;
    vehicle.nearbyInstanceCount = 0;
    vehicle.cameraHeading = 0.0;
    vehicle.odometer = 0.0;
    vehicle.speedKph = 0.0;
    vehicle.joltPosition.x = 0.0;
    vehicle.joltPosition.y = 0.0;
    vehicle.joltPosition.z = 0.0;
    vehicle.joltVelocity.x = 0.0;
    vehicle.joltVelocity.y = 0.0;
    vehicle.joltVelocity.z = 0.0;
    vehicle.joltOffset.x = 0.0;
    vehicle.joltOffset.y = 0.0;
    vehicle.joltOffset.z = 0.0;
    vehicle.groundHits = 0;
    vehicle.slotCooldown = 0;
    ResetVehicleEffects(vehicle);
    ClearVehicleDamageState(vehicle);
    vehicle.cameraChanged = 0;
    vehicle.effectSound = 0;
    vehicle.effectVolume = 0;
    vehicle.effectPriority = 0;
    vehicle.dopplerFactor = 1.0;
}

export function UnusedRaceStartStub(_unused: number): void {
}
