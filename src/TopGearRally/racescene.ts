import { mat3, quat, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { TGRTrack } from "./data.js";
import { GAME_MODE_CHAMPIONSHIP, RaceOptions, RaceSession } from "./sim/race.js";
import { loadSimTrack } from "./sim/track.js";
import {
    CameraFrame,
    VEHICLE_CAMERA_BUMPER,
    VEHICLE_CAMERA_CHASE,
    VEHICLE_CAMERA_COCKPIT,
    VEHICLE_CAMERA_MIRROR,
    VEHICLE_CAMERA_TRACKSIDE,
    Vehicle,
} from "./sim/types.js";
import { g_aCarModelInfos, g_aCarModels, g_aCarPhysicsSpecs, g_aVehicleModels, g_adwVehicleModelSlotCars } from "./sim/vehicle.js";
import { CarAssets, CarPose, TGRCar } from "./vehiclerender.js";

const FRAME_MS = 1000 / 30;
const MAX_FRAMES_PER_UPDATE = 8;
const MAX_VEHICLES = 4;
const MIRRORED_TRACK_OFFSET = 5;
const CAMERA_CUT_DISTANCE = 20;

export interface RaceAssets extends CarAssets {
    carModels: Map<number, ArrayBufferSlice>;
}

export interface RaceDriverOptions {
    gameMode: number;
    sessionType?: number;
    recording?: Uint8Array;
    trackIndex: number;
    gameTrackId: number;
    mirrored: boolean;
    weather: number;
    canMirror: boolean;
    car?: number;
}

export interface RaceCarsView {
    entries: { car: TGRCar; vehicle: Vehicle; pose: CarPose }[];
    cameraVehicle: Vehicle;
    cockpitView: boolean;
    bumperView: boolean;
    tracksideCamera: boolean;
    replay: boolean;
}

export interface CameraPose {
    position: vec3;
    forward: vec3;
    up: vec3;
    fov: number;
}

type Matrix = number[][];

function copyMatrix(m: Matrix): Matrix {
    return m.map((row) => [...row]);
}

function interpolateMatrix(a: Matrix, b: Matrix, t: number): Matrix {
    const rotation = (m: Matrix): quat => {
        const r = mat3.fromValues(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]);
        return quat.normalize(quat.create(), quat.fromMat3(quat.create(), r));
    };
    const q = quat.slerp(quat.create(), rotation(a), rotation(b), t);
    const r = mat3.fromQuat(mat3.create(), q);
    const lerp = (x: number, y: number): number => x + (y - x) * t;
    return [
        [r[0], r[1], r[2], b[0][3]],
        [r[3], r[4], r[5], b[1][3]],
        [r[6], r[7], r[8], b[2][3]],
        [lerp(a[3][0], b[3][0]), lerp(a[3][1], b[3][1]), lerp(a[3][2], b[3][2]), b[3][3]],
    ];
}

interface VehicleSnapshot {
    frame: Matrix;
    wheels: Matrix[];
}

export class TGRRaceDriver {
    public session: RaceSession;
    public simulate = true;
    public view = VEHICLE_CAMERA_CHASE;
    private readonly slotCars: (TGRCar | null)[] = new Array(MAX_VEHICLES).fill(null);
    private readonly carRoms: number[] = new Array(MAX_VEHICLES).fill(-1);
    private accumulator = 0;
    private previous = new Map<Vehicle, VehicleSnapshot>();
    private previousCamera: { frame: CameraFrame; m: Matrix; fov: number } | null = null;

    public constructor(
        private readonly track: TGRTrack,
        private readonly assets: RaceAssets,
        public readonly options: RaceDriverOptions,
    ) {
        this.session = this.start();
    }

    public get canChooseView(): boolean {
        return this.options.gameMode === GAME_MODE_CHAMPIONSHIP;
    }

    public get mirrored(): boolean {
        return this.options.mirrored;
    }

    public setWeather(weather: number): void {
        this.options.weather = weather;
        this.session.setWeather(weather);
    }

    public restart(weather: number, mirrored: boolean): void {
        this.options.weather = weather;
        this.options.mirrored = this.options.canMirror && mirrored;
        this.session = this.start();
    }

    public get carNames(): string[] {
        return g_aCarModels.map((car) => car.name);
    }

    public get recordedCar(): number {
        return this.session.vehicles[0].carModel;
    }

    public setCar(car: number): void {
        this.options.car = car;
        const vehicle = this.session.activeCameraVehicle;
        const info = g_aCarModelInfos[car];
        if (info === null) {
            return;
        }
        vehicle.carModel = vehicle.selectedCar = car;
        g_aVehicleModels[vehicle.index] = info;
        g_adwVehicleModelSlotCars[vehicle.index] = car;
        vehicle.model = info;
        const spec = g_aCarPhysicsSpecs[car];
        vehicle.gearRatios.splice(0, vehicle.gearRatios.length, ...spec.gearRatios);
        vehicle.torqueCurve.splice(0, vehicle.torqueCurve.length, ...spec.torqueCurve);
        vehicle.finalDrive = spec.finalDrive;
        vehicle.gearCount = spec.gearCount;
        vehicle.gear = Math.min(vehicle.gear, spec.gearCount);
        vehicle.rearWheelDrive = spec.rearWheelDrive;
        vehicle.body.boxSize.x = spec.boxSize.x;
        vehicle.body.boxSize.y = spec.boxSize.y;
        vehicle.body.boxSize.z = spec.boxSize.z;
        vehicle.body.boxCenterZ = spec.boxCenterZ;
        vehicle.tableIndex = spec.tableIndex;
    }

    public setView(camera: number): void {
        this.view = camera;
        this.applyView();
    }

    public update(deltaMs: number): void {
        if (!this.simulate) {
            return;
        }
        this.accumulator += deltaMs;
        let frames = 0;
        while (this.accumulator >= FRAME_MS) {
            this.accumulator -= FRAME_MS;
            if (frames++ >= MAX_FRAMES_PER_UPDATE) {
                this.accumulator = 0;
                break;
            }
            this.snapshot();
            this.applyView();
            this.session.step();
            if (this.session.finished) {
                this.session = this.start();
            }
        }
    }

    public camera(): CameraPose {
        const frame = this.session.activeCamera;
        const t = this.alpha();
        const prev = this.previousCamera;
        const m = frame.m;
        const sameCamera = prev !== null && prev.frame === frame;
        const near =
            sameCamera && Math.hypot(prev.m[3][0] - m[3][0], prev.m[3][1] - m[3][1], prev.m[3][2] - m[3][2]) < CAMERA_CUT_DISTANCE;
        const a = near ? prev.m : m;
        const lerp = (x: number, y: number): number => x + (y - x) * t;
        const row = (i: number): vec3 => vec3.fromValues(lerp(a[i][0], m[i][0]), lerp(a[i][1], m[i][1]), lerp(a[i][2], m[i][2]));
        return {
            position: row(3),
            forward: vec3.normalize(vec3.create(), row(0)),
            up: vec3.normalize(vec3.create(), row(2)),
            fov: near ? lerp(prev.fov, frame.fov) : frame.fov,
        };
    }

    public cars(device: GfxDevice): RaceCarsView {
        const session = this.session;
        const seen = new Set<Vehicle>();
        const entries: { car: TGRCar; vehicle: Vehicle; pose: CarPose }[] = [];
        const t = this.alpha();
        for (const slot of session.racerSlots) {
            const vehicle = slot.vehicle;
            if (vehicle === null || seen.has(vehicle)) {
                continue;
            }
            seen.add(vehicle);
            const car = this.carFor(device, vehicle);
            if (car !== null) {
                entries.push({ car, vehicle, pose: this.pose(vehicle, t) });
            }
        }
        const cameraVehicle = session.activeCameraVehicle;
        const active = cameraVehicle.activeCamera;
        const cameras = cameraVehicle.cameras;
        return {
            entries,
            cameraVehicle,
            cockpitView: active === cameras[VEHICLE_CAMERA_COCKPIT] || active === cameras[VEHICLE_CAMERA_MIRROR],
            bumperView: active === cameras[VEHICLE_CAMERA_BUMPER],
            tracksideCamera: active === cameras[VEHICLE_CAMERA_TRACKSIDE],
            replay: cameraVehicle.input?.playbackBuffer !== null && cameraVehicle.input?.playbackBuffer !== undefined,
        };
    }

    public destroy(device: GfxDevice): void {
        for (const car of this.slotCars) {
            car?.destroy(device);
        }
    }

    private alpha(): number {
        return this.simulate ? Math.min(this.accumulator / FRAME_MS, 1) : 1;
    }

    private pose(vehicle: Vehicle, t: number): CarPose {
        const prev = this.previous.get(vehicle);
        const frame = vehicle.frame.m;
        if (prev === undefined || Math.hypot(prev.frame[3][0] - frame[3][0], prev.frame[3][1] - frame[3][1], prev.frame[3][2] - frame[3][2]) > CAMERA_CUT_DISTANCE) {
            return { frame, wheels: vehicle.wheelFrames.map((w) => w.m) };
        }
        return {
            frame: interpolateMatrix(prev.frame, frame, t),
            wheels: vehicle.wheelFrames.map((w, i) => interpolateMatrix(prev.wheels[i], w.m, t)),
        };
    }

    private snapshot(): void {
        const next = new Map<Vehicle, VehicleSnapshot>();
        for (const vehicle of this.session.vehicles) {
            next.set(vehicle, { frame: copyMatrix(vehicle.frame.m), wheels: vehicle.wheelFrames.map((w) => copyMatrix(w.m)) });
        }
        this.previous = next;
        const frame = this.session.activeCamera;
        this.previousCamera = { frame, m: copyMatrix(frame.m), fov: frame.fov };
    }

    private applyView(): void {
        if (!this.canChooseView) {
            return;
        }
        const vehicle = this.session.activeCameraVehicle;
        if (vehicle.activeCamera !== vehicle.cameras[this.view]) {
            vehicle.activeCamera = vehicle.cameras[this.view];
            vehicle.cameraChanged = 1;
        }
    }

    private carFor(device: GfxDevice, vehicle: Vehicle): TGRCar | null {
        const index = vehicle.index;
        const rom = g_aCarModels[vehicle.carModel]?.modelRom ?? -1;
        if (this.carRoms[index] !== rom) {
            this.slotCars[index]?.destroy(device);
            const model = this.assets.carModels.get(rom);
            this.slotCars[index] = model !== undefined ? new TGRCar(model, this.assets) : null;
            this.carRoms[index] = rom;
        }
        return this.slotCars[index];
    }

    private start(): RaceSession {
        const dataSegment = this.assets.dataSegment.createDataView();
        const options = this.options;
        const trackId = options.gameTrackId + (options.mirrored ? MIRRORED_TRACK_OFFSET : 0);
        let recording = options.recording;
        if (recording !== undefined && options.car !== undefined) {
            recording = recording.slice();
            recording[1] = options.car;
        }
        const raceOptions: RaceOptions = {
            gameMode: options.gameMode,
            sessionType: options.sessionType,
            recording,
            playerCar: recording === undefined ? options.car : undefined,
            weather: options.weather,
            autopilot: options.gameMode === GAME_MODE_CHAMPIONSHIP,
            trackId,
            dataSegment,
            carModel: (rom: number) => {
                const model = this.assets.carModels.get(rom);
                if (model === undefined) {
                    throw new Error(`TGR: missing car model 0x${rom.toString(16)}`);
                }
                return model.createDataView();
            },
        };
        const session = new RaceSession(loadSimTrack(this.track, trackId), raceOptions);
        this.previous.clear();
        this.previousCamera = null;
        this.accumulator = 0;
        return session;
    }
}
