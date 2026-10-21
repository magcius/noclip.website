import { CameraFrame, RACER_FINISHED, RACER_HELD, RacerSlot, VEHICLE_CAMERA_CHASE, VEHICLE_GHOST, Vehicle } from "./types.js";
import { f } from "./f32.js";
import {
    G,
    GAME_MODE_AFTER_SEASON,
    GAME_MODE_ARCADE,
    GAME_MODE_CHAMPIONSHIP,
    GAME_MODE_DEMO,
    GAME_MODE_TIME_ATTACK,
    MAX_VEHICLES,
    RACE_SESSION_ATTRACT,
    RACE_SESSION_CREDIT_CAPTIONS,
    RACE_SESSION_SCROLLING_CREDITS,
    WEATHER_FOG,
    WEATHER_NIGHT,
    WEATHER_RAIN,
    WEATHER_SNOW,
    WEATHER_SUNNY,
    initGlobals,
} from "./globals.js";
import { SimTrack } from "./track.js";
import { MAX_PLAYERS } from "./types.js";
import { ClearPerFrameVariables, DriveAiVehicle, UpdatePhysicsStep, loadDrivingData } from "./driving.js";
import { ClearCameraChanged, cameraGlobals } from "./camera.js";
import { InitRacerSlot, ManageAiRacerSlots, SortRacersByPosition, UpdateRacerSlotMotion, UpdateRacerSlotRaceState } from "./racers.js";
import { INPUT_A, INPUT_START, INPUT_Z, InitPlayerInputState, UpdateControllerState, loadInputData } from "./input.js";
import { InstallVehicleModel, g_aCarModelInfos, g_aCarModels, loadCarData, vehicleModelInfoFromModel } from "./vehicle.js";
import { ChooseVehicleCar, InitPlayerVehicleSlot, InitVehicleColor, SetupVehicleForRaceStart } from "./vehiclesetup.js";
import { ResetCollisionCaches } from "./physics.js";
import { InitParticleSystem, MoveTireSpray, UpdateAllVehicleEffects, resetEffects } from "./effects.js";
import { UpdatePrecipitationParticles, resetWeather } from "./weather.js";
import { SetRngSeed } from "./vecmath.js";
import { RECORDING_HEADER_SIZE, g_abPlaybackRecording } from "./replay.js";

export const ROM_GHOST_RECORDING = 0xad400;
export const ROM_CREDITS_RECORDING = 0xad740;
export const ROM_ENDING_RECORDING = 0xadb00;

export const RACE_PHASE_HOLD = 0;
export const RACE_PHASE_WAIT = 1;
export const RACE_PHASE_COUNTDOWN = 2;
export const RACE_PHASE_GO = 3;
export const RACE_PHASE_RACING = 4;
export const RACE_PHASE_FINISHED = 5;
export const RACE_PHASE_AFTER = 6;
export const RACE_PHASE_LEAVE = 7;

const DATA_SEGMENT_RAM = 0x8025f000;
const RACE_PHASE_TABLE_RAM = 0x802707d0;
const START_LIGHT_THRESHOLDS_RAM = 0x80270794;
const RACE_PHASES = 8;
const START_LIGHT_STEPS = 5;
const CHAMPIONSHIP_VEHICLES = 20;
const CHAMPIONSHIP_ACTIVE_VEHICLES = 3;
const ATTRACT_RACE_SECONDS = f(39.6);
const ENDING_RACE_SECONDS = f(140.0);
const AFTER_SEASON_RACE_SECONDS = f(16.0);
const FADE_SECONDS = f(0.2);
const CONFIRM_BUTTONS = INPUT_A | INPUT_START | INPUT_Z;
const RACE_STEP_NANOSECONDS = 33333333n;
const OS_CLOCK_RATE = 62500000n;
const MIRRORED_TRACK_FIRST = 5;
const MIRRORED_TRACK_LAST = 9;

interface RacePhaseStep {
    phase: number;
    seconds: number;
}

export interface RaceOptions {
    gameMode: number;
    sessionType?: number;
    trackId: number;
    weather?: number;
    recording?: Uint8Array;
    autopilot?: boolean;
    playerCar?: number;
    dataSegment: DataView;
    carModel: (romOffset: number) => DataView;
}

export function recordingTrack(recording: Uint8Array): number {
    return recording[0];
}

export class RaceSession {
    public readonly vehicles: Vehicle[];
    public readonly racerSlots: RacerSlot[];
    public finished = false;
    public frame = 0;

    private readonly phaseTable: RacePhaseStep[] = [];
    private readonly startLightThresholds: number[] = [];
    private phaseIndex = 0;
    private phase = 0;
    private phaseTimer = 0;
    private startLightsAnimation = 0;
    private startLightsStep = 0;
    private startLightsVisible = false;
    private startLightsDrop = 0;
    private exitState = false;
    private fadeLevel = 0;
    private fadeTarget = 0;
    private fadeRate = 0;
    private fadeSkipFrame = 0;
    private fadeAutoReverse = 0;
    private timestampBase = 0n;
    private previousElapsedMs = 0;
    private demoInterrupted = false;

    public constructor(track: SimTrack, private readonly options: RaceOptions) {
        const data = options.dataSegment;
        initGlobals(track, options.trackId);
        loadCarData(data);
        loadDrivingData(data);
        loadInputData(data);
        for (let i = 0; i < RACE_PHASES; i++) {
            const o = RACE_PHASE_TABLE_RAM - DATA_SEGMENT_RAM + i * 8;
            this.phaseTable.push({ phase: data.getInt32(o), seconds: data.getFloat32(o + 4) });
        }
        for (let i = 0; i < START_LIGHT_STEPS; i++) {
            this.startLightThresholds.push(data.getFloat32(START_LIGHT_THRESHOLDS_RAM - DATA_SEGMENT_RAM + i * 4));
        }
        for (let car = 0; car < g_aCarModels.length; car++) {
            if (g_aCarModels[car].modelRomEnd !== 0) {
                g_aCarModelInfos[car] = vehicleModelInfoFromModel(car, options.carModel(g_aCarModels[car].modelRom));
            }
        }
        for (let i = 0; i < MAX_PLAYERS; i++) {
            InitPlayerVehicleSlot(G.g_aVehicles[i]);
            InitPlayerInputState(G.g_aPlayerInputState[i]);
        }
        G.g_dwGameMode = options.gameMode;
        G.g_dwRaceSessionType = options.sessionType ?? RACE_SESSION_ATTRACT;
        G.g_dwCurrentWeather = options.weather ?? WEATHER_SUNNY;
        G.g_dwNumLocalPlayers = 1;
        InitVehicleColor(G.g_aVehicles[0]);
        ChooseVehicleCar(G.g_aVehicles[0]);
        if (options.playerCar !== undefined) {
            G.g_aVehicles[0].carModel = G.g_aVehicles[0].selectedCar = options.playerCar;
        }
        this.vehicles = G.g_aVehicles;
        this.racerSlots = G.g_aRacerSlots;
        resetEffects();
        resetWeather();
        this.InitRace();
    }

    public get activeCameraVehicle(): Vehicle {
        return G.g_aVehicles[G.g_aViewportRects[0].vehicleIndex];
    }

    public get activeCamera(): CameraFrame {
        return this.activeCameraVehicle.activeCamera;
    }

    public get activeVehicles(): Vehicle[] {
        return G.g_aVehicles.slice(0, G.g_dwNumActiveVehicles);
    }

    public get racePhase(): number {
        return this.phase;
    }

    public get trackMirrored(): boolean {
        return G.g_dwTrackMirrored !== 0;
    }

    public get weather(): number {
        return G.g_dwCurrentWeather;
    }

    public get elapsedMs(): number {
        return G.g_dwElapsedTimeMs;
    }

    public get startLights(): { visible: boolean; animation: number; drop: number } {
        return { visible: this.startLightsVisible, animation: this.startLightsAnimation, drop: this.startLightsDrop };
    }

    public step(): void {
        if (this.finished) {
            return;
        }
        if (this.frame > 0) {
            MoveTireSpray();
        }
        this.ProcessRacingScreen();
    }

    private SetupFromRecording(vehicle: Vehicle): void {
        const buffer = vehicle.input!.playbackBuffer!;
        vehicle.steeringMode = buffer[2];
        vehicle.chosenTransmission = buffer[3];
        vehicle.tireType = buffer[4];
        vehicle.suspensionStiffness = buffer[5];
        vehicle.input!.controllerLayout = buffer[6];
    }

    private SetupRaceVehicles(): void {
        switch (G.g_dwGameMode) {
            case GAME_MODE_CHAMPIONSHIP:
                G.g_dwNumVehicles = CHAMPIONSHIP_VEHICLES;
                G.g_dwNumActiveVehicles = CHAMPIONSHIP_ACTIVE_VEHICLES;
                for (let i = 0; i < G.g_dwNumLocalPlayers; i++) {
                    G.g_aVehicles[i].input!.playbackBuffer = null;
                    G.g_aVehicles[i].input!.recordBuffers[0] = null;
                    G.g_aVehicles[i].input!.recordBuffers[1] = null;
                }
                break;
            case GAME_MODE_DEMO: {
                G.g_dwCurrentWeather = 1;
                G.g_dwNumLocalPlayers = 1;
                G.g_dwNumVehicles = 1;
                G.g_dwNumActiveVehicles = 1;
                const vehicle = G.g_aVehicles[0];
                vehicle.customDecals = 0;
                const recording = this.options.recording!;
                g_abPlaybackRecording.fill(0);
                g_abPlaybackRecording.set(recording.subarray(0, g_abPlaybackRecording.length));
                vehicle.input!.playbackBuffer = g_abPlaybackRecording;
                vehicle.input!.playbackLimit = recording.length;
                vehicle.input!.playbackPosition = RECORDING_HEADER_SIZE;
                vehicle.input!.recordBuffers[0] = null;
                vehicle.input!.recordBuffers[1] = null;
                vehicle.color[0] = 0xff;
                vehicle.color[1] = 0xff;
                vehicle.color[2] = 0xff;
                G.g_dwSelectedTrackId = g_abPlaybackRecording[0];
                vehicle.carModel = vehicle.selectedCar = g_abPlaybackRecording[1];
                this.SetupFromRecording(vehicle);
                break;
            }
            default:
                G.g_dwNumVehicles = G.g_dwNumLocalPlayers;
                G.g_dwNumActiveVehicles = G.g_dwNumLocalPlayers;
                break;
        }
    }

    private InitRace(): void {
        SetRngSeed(123);
        if (G.g_dwGameMode !== GAME_MODE_ARCADE) {
            G.g_dwTotalLaps = 3;
        }
        G.g_bTrackCollisionFrameToggle = 0;
        this.SetupRaceVehicles();
        G.g_dwTrackMirrored = G.g_dwSelectedTrackId >= MIRRORED_TRACK_FIRST && G.g_dwSelectedTrackId <= MIRRORED_TRACK_LAST ? 1 : 0;
        G.g_dwNumViewports = G.g_dwNumLocalPlayers;
        G.g_aViewportRects[0].vehicleIndex = 0;
        G.g_aViewportRects[1].vehicleIndex = 1;

        let i = 0;
        if (G.g_dwGameMode === GAME_MODE_DEMO) {
            G.g_aVehicles[0].activeCamera = G.g_aVehicles[0].cameras[VEHICLE_CAMERA_CHASE];
            G.g_dwReplayCameraSwitchTimer = 180;
        } else {
            for (; i < G.g_dwNumLocalPlayers; i++) {
                const v = G.g_aVehicles[i];
                v.chosenTransmission = v.profile!.transmission;
                v.suspensionStiffness = v.profile!.suspension;
                v.tireType = v.profile!.tires;
                v.steeringMode = v.profile!.handling;
                v.input!.controllerLayout = v.profile!.controllerLayout;
            }
            for (; i < G.g_dwNumActiveVehicles; i++) {
                const v = G.g_aVehicles[i];
                v.chosenTransmission = 1;
                v.suspensionStiffness = 1;
                v.tireType = 2;
                v.steeringMode = 0;
                v.input!.controllerLayout = 0;
            }
        }

        for (i = 0; i < G.g_dwNumActiveVehicles; i++) {
            const v = G.g_aVehicles[i];
            v.opacity = 1.0;
            if (i < G.g_dwNumLocalPlayers) {
                v.driver = UpdatePhysicsStep;
                v.ghostMode = 0;
            } else if (G.g_dwGameMode === GAME_MODE_TIME_ATTACK) {
                v.driver = UpdatePhysicsStep;
                v.ghostMode = VEHICLE_GHOST;
                v.opacity = f(0.375);
            } else {
                ChooseVehicleCar(v);
                v.driver = DriveAiVehicle;
                v.ghostMode = 0;
            }
            if (!v.customDecals) {
                InstallVehicleModel(v, i, v.carModel);
            }
            SetupVehicleForRaceStart(v);
            v.flyMode = 0;
            v.message = null;
            v.subMessage = null;
        }
        if (this.options.autopilot && G.g_dwGameMode !== GAME_MODE_DEMO) {
            G.g_aVehicles[0].driver = DriveAiVehicle;
        }

        this.phaseIndex = G.g_dwGameMode === GAME_MODE_AFTER_SEASON ? 4 : 0;
        this.phase = this.phaseTable[this.phaseIndex].phase;
        this.phaseTimer = this.phaseTable[this.phaseIndex].seconds;
        G.g_dwRaceFinishOrderCounter = 0;
        for (i = 0; i < G.g_dwNumVehicles; i++) {
            InitRacerSlot(G.g_aRacerSlots[i]);
        }
        this.ApplyWeather(G.g_dwCurrentWeather);
        InitParticleSystem();
        ResetCollisionCaches();
        G.g_dwRacePauseState = 0;
        this.exitState = false;
        this.SetFadeTarget(1);
        this.timestampBase = 0n;
        this.previousElapsedMs = 0;
        G.g_dwElapsedTimeMs = 0;
        G.g_dwFrameDeltaMs = 0;
        G.g_fFrameDeltaTime = 0;
    }

    public setWeather(weather: number): void {
        G.g_dwCurrentWeather = weather;
        this.ApplyWeather(weather);
    }

    private ApplyWeather(weather: number): void {
        G.g_dwNightMode = G.g_dwRainMode = G.g_dwSnowMode = 0;
        switch (weather) {
            case WEATHER_SUNNY:
                G.g_dwWeatherActive = 0;
                break;
            case WEATHER_FOG:
                G.g_dwWeatherActive = 1;
                break;
            case WEATHER_RAIN:
                G.g_dwWeatherActive = 1;
                G.g_dwRainMode = 1;
                break;
            case WEATHER_SNOW:
                G.g_dwWeatherActive = 1;
                G.g_dwSnowMode = 1;
                break;
            case WEATHER_NIGHT:
                G.g_dwWeatherActive = 1;
                G.g_dwNightMode = 1;
                break;
        }
    }

    private UpdateFrameTiming(): void {
        this.timestampBase += (RACE_STEP_NANOSECONDS * OS_CLOCK_RATE) / 1000000000n;
        this.previousElapsedMs = G.g_dwElapsedTimeMs;
        G.g_dwElapsedTimeMs = Number((this.timestampBase * 1000000n) / OS_CLOCK_RATE / 1000n) >>> 0;
        UpdateControllerState();
        const delta = (G.g_dwElapsedTimeMs - this.previousElapsedMs) >>> 0;
        G.g_fFrameDeltaTime = f(f(delta) / f(1000.0));
        G.g_dwFrameDeltaMs = delta;
    }

    private AdvanceRacePhase(): void {
        this.phaseIndex++;
        this.phase = this.phaseTable[this.phaseIndex].phase;
        this.phaseTimer = this.phaseTable[this.phaseIndex].seconds;
    }

    private SetFadeTarget(target: number): void {
        this.fadeSkipFrame = 1;
        if (target < this.fadeLevel || target === 0.0) {
            if (this.fadeLevel === 1.0 || this.fadeRate <= 0.0) {
                this.fadeRate = f(-1.0 / FADE_SECONDS);
                this.fadeTarget = target;
            } else {
                this.fadeAutoReverse = 1;
            }
            return;
        }
        this.fadeTarget = target;
        this.fadeRate = f(1.0 / FADE_SECONDS);
    }

    private IsFadingOut(): boolean {
        return this.fadeRate < 0.0 || this.fadeAutoReverse !== 0;
    }

    private IsFadeComplete(): boolean {
        return this.fadeTarget === this.fadeLevel && !this.fadeAutoReverse;
    }

    private UpdateFade(): void {
        if (this.fadeSkipFrame) {
            this.fadeSkipFrame = 0;
            return;
        }
        if (this.fadeLevel === this.fadeTarget) {
            return;
        }
        const rate = this.fadeRate;
        this.fadeLevel = f(this.fadeLevel + f(rate * G.g_fFrameDeltaTime));
        if (rate < 0.0) {
            if (this.fadeLevel < this.fadeTarget) {
                this.fadeLevel = this.fadeTarget;
            }
        } else if (this.fadeTarget <= this.fadeLevel) {
            this.fadeLevel = this.fadeTarget;
            if (this.fadeAutoReverse) {
                this.fadeTarget = 0.0;
                this.fadeRate = -rate;
                this.fadeAutoReverse = 0;
            }
        }
    }

    private LeaveRace(): void {
        if (!this.exitState) {
            this.exitState = true;
            this.SetFadeTarget(0);
        }
    }

    private HoldBeforeStart(): void {
        this.startLightsVisible = true;
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            G.g_aRacerSlots[i].status |= RACER_HELD;
            const vehicle = G.g_aRacerSlots[i].vehicle;
            if (vehicle === null || vehicle.index >= G.g_dwNumLocalPlayers) {
                continue;
            }
            vehicle.messageTime = 1.0;
            switch (this.phase) {
                case RACE_PHASE_HOLD:
                    this.startLightsAnimation = -1;
                    this.startLightsStep = 0;
                    break;
                case RACE_PHASE_COUNTDOWN:
                    this.startLightsAnimation = 1;
                    if (this.phaseTimer < this.startLightThresholds[this.startLightsStep]) {
                        this.startLightsStep++;
                    }
                    break;
            }
        }
        this.startLightsDrop = 0.0;
    }

    private RunRacingPhase(): boolean {
        let allFinished = true;
        const total = G.g_aVehicles[0].totalTime;
        if (
            (G.g_dwGameMode === GAME_MODE_DEMO &&
                ((G.g_dwRaceSessionType === RACE_SESSION_SCROLLING_CREDITS && ENDING_RACE_SECONDS < total) ||
                    (G.g_dwRaceSessionType !== RACE_SESSION_SCROLLING_CREDITS && ATTRACT_RACE_SECONDS < total))) ||
            (G.g_dwGameMode === GAME_MODE_AFTER_SEASON && AFTER_SEASON_RACE_SECONDS < total)
        ) {
            if (!this.IsFadingOut()) {
                this.SetFadeTarget(0);
                this.exitState = true;
                allFinished = false;
            }
        }
        for (let i = 0; i < G.g_dwNumLocalPlayers; i++) {
            if (!(G.g_aRacerSlots[i].status & RACER_FINISHED)) {
                allFinished = false;
            }
        }
        if (allFinished) {
            return true;
        }
        if (G.g_dwGameMode === GAME_MODE_ARCADE && G.g_dwNumLocalPlayers === 1 && G.g_aVehicles[0].timeLeft === 0.0) {
            G.g_aVehicles[1].message = G.g_aVehicles[0].message = "%ryTIME UP!";
            G.g_aVehicles[1].messageTime = 2.0;
            G.g_aVehicles[0].messageTime = G.g_aVehicles[1].messageTime;
            return true;
        }
        return false;
    }

    private tick(): void {
        if (!G.g_dwRacePauseState) {
            this.phaseTimer = f(this.phaseTimer - G.g_fFrameDeltaTime);
            if (this.phaseTimer < 0.0) {
                this.AdvanceRacePhase();
            }
        }
    }

    private StepRacePhases(): void {
        if (this.phase < RACE_PHASE_GO) {
            this.HoldBeforeStart();
            this.tick();
        } else if (this.phase === RACE_PHASE_GO) {
            this.startLightsAnimation = 1;
            this.startLightsVisible = true;
            for (let i = 0; i < G.g_dwNumVehicles; i++) {
                G.g_aRacerSlots[i].status &= ~RACER_HELD;
            }
            const seconds = this.phaseTable[this.phaseIndex].seconds;
            this.startLightsDrop = f(f(seconds - this.phaseTimer) / seconds);
            this.startLightsDrop = f(this.startLightsDrop * f(15.0 * this.startLightsDrop));
            this.tick();
        } else if (this.phase === RACE_PHASE_RACING) {
            if (this.RunRacingPhase()) {
                this.AdvanceRacePhase();
            }
        } else if (this.phase === RACE_PHASE_FINISHED) {
            this.AdvanceRacePhase();
        } else if (this.phase === RACE_PHASE_AFTER) {
            this.tick();
        } else if (this.phase === RACE_PHASE_LEAVE) {
            if (!this.exitState) {
                this.SetFadeTarget(0);
                this.exitState = true;
            }
        }
    }

    private ProcessRaceButtons(): void {
        if (G.g_dwGameMode !== GAME_MODE_DEMO && G.g_dwGameMode !== GAME_MODE_AFTER_SEASON) {
            return;
        }
        if (this.IsFadingOut()) {
            return;
        }
        for (let i = 0; i < 2; i++) {
            if (G.g_aPlayerInputState[i].buttons & CONFIRM_BUTTONS) {
                this.demoInterrupted = true;
                this.exitState = true;
                this.SetFadeTarget(0);
            }
        }
    }

    private ProcessRacingScreen(): void {
        if (G.g_dwGameMode !== GAME_MODE_DEMO) {
            G.g_bTrackCollisionFrameToggle ^= 1;
        }
        this.UpdateFrameTiming();
        this.startLightsAnimation = 0;
        this.startLightsVisible = false;
        this.StepRacePhases();

        ClearPerFrameVariables();
        for (let i = 0; i < G.g_dwNumActiveVehicles; i++) {
            ClearCameraChanged(G.g_aVehicles[i]);
        }
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            UpdateRacerSlotMotion(G.g_aRacerSlots[i]);
        }
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            UpdateRacerSlotRaceState(G.g_aRacerSlots[i]);
        }
        if (G.g_dwGameMode === GAME_MODE_CHAMPIONSHIP) {
            for (let i = 0; i < G.g_dwNumLocalPlayers; i++) {
                ManageAiRacerSlots(G.g_aVehicles[i]);
            }
        }
        SortRacersByPosition();
        if (!G.g_dwRacePauseState) {
            UpdateAllVehicleEffects();
            UpdatePrecipitationParticles();
        }
        for (let i = 0; i < G.g_dwNumViewports; i++) {
            cameraGlobals.g_pActiveCameraVehicle = G.g_aVehicles[G.g_aViewportRects[i].vehicleIndex];
        }
        this.UpdateFade();
        this.ProcessRaceButtons();
        this.frame++;
        if (this.IsFadingOut() && this.IsFadeComplete()) {
            this.FinishRace();
        }
    }

    private FinishRace(): void {
        if (this.exitState) {
            for (let i = 0; i < MAX_VEHICLES; i++) {
                G.g_aVehicles[i].input!.playbackBuffer = null;
            }
            this.finished = true;
        }
    }

    public get interrupted(): boolean {
        return this.demoInterrupted;
    }
}

export { RACE_SESSION_ATTRACT, RACE_SESSION_CREDIT_CAPTIONS, RACE_SESSION_SCROLLING_CREDITS, GAME_MODE_CHAMPIONSHIP, GAME_MODE_DEMO };
