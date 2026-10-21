import { SimTrack } from "./track.js";
import {
    MAX_PLAYERS,
    PlayerInputState,
    PlayerProfile,
    RACER_SLOTS,
    RacerSlot,
    Vehicle,
    playerInputState,
    playerProfile,
    racerSlot,
    vehicle,
} from "./types.js";

export const MAX_VEHICLES = 4;
export const GAME_MODE_CHAMPIONSHIP = 0;
export const GAME_MODE_ARCADE = 1;
export const GAME_MODE_TIME_ATTACK = 2;
export const GAME_MODE_PRACTICE = 3;
export const GAME_MODE_DEMO = 4;
export const GAME_MODE_AFTER_SEASON = 5;
export const RACE_SESSION_ATTRACT = 0;
export const RACE_SESSION_CREDIT_CAPTIONS = 1;
export const RACE_SESSION_SCROLLING_CREDITS = 2;
export const TRACK_DESERT = 0;
export const TRACK_MOUNTAIN = 1;
export const TRACK_COASTLINE = 2;
export const TRACK_STRIP_MINE = 3;
export const TRACK_JUNGLE = 4;
export const TRACK_MIRRORED = 5;
export const WEATHER_SUNNY = 0;
export const WEATHER_FOG = 1;
export const WEATHER_RAIN = 2;
export const WEATHER_SNOW = 3;
export const WEATHER_NIGHT = 4;

export interface Globals {
    g_LoadedTrack: SimTrack;
    g_aVehicles: Vehicle[];
    g_aRacerSlots: RacerSlot[];
    g_aPlayerInputState: PlayerInputState[];
    g_aSeasonSaveBuffers: PlayerProfile[];
    g_pActiveProfile: PlayerProfile;
    g_fFrameDeltaTime: number;
    g_dwFrameDeltaMs: number;
    g_dwElapsedTimeMs: number;
    g_dwGameMode: number;
    g_dwRaceSessionType: number;
    g_dwSelectedTrackId: number;
    g_dwTrackMirrored: number;
    g_dwViewportMirrored: number;
    g_dwNumLocalPlayers: number;
    g_dwNumVehicles: number;
    g_dwNumActiveVehicles: number;
    g_dwNumViewports: number;
    g_dwTotalLaps: number;
    g_dwCurrentWeather: number;
    g_dwWeatherActive: number;
    g_dwSnowMode: number;
    g_dwRainMode: number;
    g_dwNightMode: number;
    g_dwRandomSeed: number;
    g_dwRacePauseState: number;
    g_dwMultiplayerMode: number;
    gInstantReplayActive: number;
    g_aViewportRects: { vehicleIndex: number }[];
    g_dwReplayCameraHoldTimer: number;
    g_dwReplayCameraSwitchTimer: number;
    g_bTrackCollisionFrameToggle: number;
    g_dwRaceFinishOrderCounter: number;
    g_fCameraFovRadians: number;
    extra: Record<string, unknown>;
}

export const G = {} as Globals;

export function initGlobals(track: SimTrack, selectedTrackId: number): Globals {
    const profiles = [playerProfile(), playerProfile()];
    G.g_LoadedTrack = track;
    G.g_aVehicles = Array.from({ length: MAX_VEHICLES }, (_, i) => vehicle(i));
    G.g_aRacerSlots = Array.from({ length: RACER_SLOTS }, (_, i) => racerSlot(i));
    G.g_aPlayerInputState = Array.from({ length: MAX_PLAYERS }, (_, i) => playerInputState(i));
    G.g_aSeasonSaveBuffers = profiles;
    G.g_pActiveProfile = profiles[0];
    G.g_fFrameDeltaTime = 0;
    G.g_dwFrameDeltaMs = 0;
    G.g_dwElapsedTimeMs = 0;
    G.g_dwGameMode = GAME_MODE_CHAMPIONSHIP;
    G.g_dwRaceSessionType = RACE_SESSION_ATTRACT;
    G.g_dwSelectedTrackId = selectedTrackId;
    G.g_dwTrackMirrored = 0;
    G.g_dwViewportMirrored = 0;
    G.g_dwNumLocalPlayers = 1;
    G.g_dwNumVehicles = 1;
    G.g_dwNumActiveVehicles = 1;
    G.g_dwNumViewports = 1;
    G.g_dwTotalLaps = 3;
    G.g_dwCurrentWeather = WEATHER_SUNNY;
    G.g_dwWeatherActive = 0;
    G.g_dwSnowMode = 0;
    G.g_dwRainMode = 0;
    G.g_dwNightMode = 0;
    G.g_dwRandomSeed = 0;
    G.g_dwRacePauseState = 0;
    G.g_dwMultiplayerMode = 0;
    G.gInstantReplayActive = 0;
    G.g_aViewportRects = [{ vehicleIndex: 0 }, { vehicleIndex: 1 }];
    G.g_dwReplayCameraHoldTimer = 0;
    G.g_dwReplayCameraSwitchTimer = 0;
    G.g_bTrackCollisionFrameToggle = 0;
    G.g_dwRaceFinishOrderCounter = 0;
    G.g_fCameraFovRadians = Math.fround(0.5235988);
    G.extra = {};
    return G;
}
