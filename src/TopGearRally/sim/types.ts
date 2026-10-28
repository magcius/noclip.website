export interface Ref<T> {
    value: T;
}

export function ref<T>(value: T): Ref<T> {
    return { value };
}

export interface Vec3f {
    x: number;
    y: number;
    z: number;
}

export interface Vec2f {
    x: number;
    y: number;
}

export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

export type Mtx4 = number[][];
export type Mtx3 = number[][];

export function vec3(x = 0, y = 0, z = 0): Vec3f {
    return { x, y, z };
}

export function quat(w = 0, x = 0, y = 0, z = 0): Quaternion {
    return { w, x, y, z };
}

export function mtx4(): Mtx4 {
    return [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ];
}

export function mtx3(): Mtx3 {
    return [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];
}

export function copyVec3(out: Vec3f, v: Vec3f): Vec3f {
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
    return out;
}

export function copyQuat(out: Quaternion, q: Quaternion): Quaternion {
    out.w = q.w;
    out.x = q.x;
    out.y = q.y;
    out.z = q.z;
    return out;
}

export function copyMtx(out: number[][], m: number[][]): number[][] {
    for (let r = 0; r < out.length; r++) {
        for (let c = 0; c < out[r].length; c++) {
            out[r][c] = m[r][c];
        }
    }
    return out;
}

export class RowView implements Vec3f {
    public constructor(private readonly row: number[]) {}

    public get x(): number {
        return this.row[0];
    }

    public set x(v: number) {
        this.row[0] = v;
    }

    public get y(): number {
        return this.row[1];
    }

    public set y(v: number) {
        this.row[1] = v;
    }

    public get z(): number {
        return this.row[2];
    }

    public set z(v: number) {
        this.row[2] = v;
    }
}

export class CameraFrame {
    public readonly m: Mtx4 = mtx4();
    public readonly forward = new RowView(this.m[0]);
    public readonly side = new RowView(this.m[1]);
    public readonly up = new RowView(this.m[2]);
    public readonly position = new RowView(this.m[3]);
    public fov = 0;

    public get forwardW(): number {
        return this.m[0][3];
    }

    public set forwardW(v: number) {
        this.m[0][3] = v;
    }

    public get sideW(): number {
        return this.m[1][3];
    }

    public set sideW(v: number) {
        this.m[1][3] = v;
    }

    public get upW(): number {
        return this.m[2][3];
    }

    public set upW(v: number) {
        this.m[2][3] = v;
    }

    public get positionW(): number {
        return this.m[3][3];
    }

    public set positionW(v: number) {
        this.m[3][3] = v;
    }
}

export function cameraFrame(): CameraFrame {
    return new CameraFrame();
}

export function copyCameraFrame(out: CameraFrame, frame: CameraFrame): CameraFrame {
    copyMtx(out.m, frame.m);
    out.fov = frame.fov;
    return out;
}

export interface TrackPoint {
    left: Vec3f;
    position: Vec3f;
    right: Vec3f;
    distance: number;
}

export interface TrackSection {
    address: number;
    child: TrackSection | null;
    next: TrackSection | null;
    gridMinX: number;
    gridMinY: number;
    gridMaxX: number;
    gridMaxY: number;
    pointCount: number;
    flags: number;
    points: TrackPoint[];
}

export interface TrackTriangle {
    normal: Vec3f;
    planeOffset: number;
    vertices: Vec3f[];
    index: number;
    surface: number;
}

export interface TrackGate {
    ends: Vec2f[];
    seconds: number;
}

export interface RigidBodyState {
    position: Vec3f;
    velocity: Vec3f;
    orientation: Quaternion;
    angularVelocity: Vec3f;
    spin: Quaternion;
}

export function rigidBodyState(): RigidBodyState {
    return { position: vec3(), velocity: vec3(), orientation: quat(), angularVelocity: vec3(), spin: quat() };
}

export function copyRigidBodyState(out: RigidBodyState, s: RigidBodyState): RigidBodyState {
    copyVec3(out.position, s.position);
    copyVec3(out.velocity, s.velocity);
    copyQuat(out.orientation, s.orientation);
    copyVec3(out.angularVelocity, s.angularVelocity);
    copyQuat(out.spin, s.spin);
    return out;
}

export const RIGID_BODY_FORCE_WORLD = 0;
export const RIGID_BODY_FORCE_BODY = 1;
export const RIGID_BODY_BOX = 0;
export const RIGID_BODY_BOX_1 = 1;
export const RIGID_BODY_NO_ROTATION = 2;

export interface RigidBodyForce {
    next: RigidBodyForce | null;
    frame: number;
    vector: Vec3f;
    point: Vec3f;
}

export function rigidBodyForce(): RigidBodyForce {
    return { next: null, frame: 0, vector: vec3(), point: vec3() };
}

export interface RigidBody {
    unreconstructed0: number;
    wheels: (RigidBody | null)[];
    unreconstructed14: number;
    forces: RigidBodyForce | null;
    kind: number;
    size: Vec3f;
    mass: number;
    inertia: Mtx3;
    inverseInertia: Mtx3;
    state: RigidBodyState;
    orientation: Mtx4;
    force: Vec3f;
    torque: Vec3f;
    stepStates: RigidBodyState[];
    ground: TrackTriangle | null;
    surface: number;
    groundNormal: Vec3f;
    groundOffset: number;
    contactFrames: number;
    springRate: number;
    damping: number;
    steerAngle: number;
    spinRate: number;
    radius: number;
    drive: number;
    brake: number;
    rollAngle: number;
    suspension: number;
    boxSize: Vec3f;
    boxCenterZ: number;
    impactPoint: Vec3f;
    uprightFrames: number;
    impactSpeed: number;
    tireType: number;
    vehicleImpactVolume: number;
    impactVolume: number;
    framesSinceImpact: number;
    framesSinceVehicleImpact: number;
    unreconstructed202: number;
    landed: number;
    skidding: number;
}

export function rigidBody(): RigidBody {
    return {
        unreconstructed0: 0,
        wheels: [null, null, null, null],
        unreconstructed14: 0,
        forces: null,
        kind: 0,
        size: vec3(),
        mass: 0,
        inertia: mtx3(),
        inverseInertia: mtx3(),
        state: rigidBodyState(),
        orientation: mtx4(),
        force: vec3(),
        torque: vec3(),
        stepStates: [rigidBodyState(), rigidBodyState()],
        ground: null,
        surface: 0,
        groundNormal: vec3(),
        groundOffset: 0,
        contactFrames: 0,
        springRate: 0,
        damping: 0,
        steerAngle: 0,
        spinRate: 0,
        radius: 0,
        drive: 0,
        brake: 0,
        rollAngle: 0,
        suspension: 0,
        boxSize: vec3(),
        boxCenterZ: 0,
        impactPoint: vec3(),
        uprightFrames: 0,
        impactSpeed: 0,
        tireType: 0,
        vehicleImpactVolume: 0,
        impactVolume: 0,
        framesSinceImpact: 0,
        framesSinceVehicleImpact: 0,
        unreconstructed202: 0,
        landed: 0,
        skidding: 0,
    };
}

export const MAX_PLAYERS = 4;
export const INPUT_RECORDERS = 2;
export const INPUT_HISTORY_SIZE = 128;

export interface PlayerInputState {
    buttons: number;
    heldButtons: number;
    repeatUp: number;
    repeatDown: number;
    repeatLeft: number;
    repeatRight: number;
    stickX: number;
    stickY: number;
    steering: number;
    steeringInput: number;
    controllerLayout: number;
    controllerMissing: number;
    recordBuffers: (Uint8Array | null)[];
    recordPositions: number[];
    recordLimits: number[];
    playbackBuffer: Uint8Array | null;
    playbackPosition: number;
    playbackLimit: number;
    history: number[];
    historyIndex: number;
    playerIndex: number;
}

export function playerInputState(playerIndex: number): PlayerInputState {
    return {
        buttons: 0,
        heldButtons: 0,
        repeatUp: 0,
        repeatDown: 0,
        repeatLeft: 0,
        repeatRight: 0,
        stickX: 0,
        stickY: 0,
        steering: 0,
        steeringInput: 0,
        controllerLayout: 0,
        controllerMissing: 0,
        recordBuffers: [null, null],
        recordPositions: [0, 0],
        recordLimits: [0, 0],
        playbackBuffer: null,
        playbackPosition: 0,
        playbackLimit: 0,
        history: new Array<number>(INPUT_HISTORY_SIZE).fill(0),
        historyIndex: 0,
        playerIndex,
    };
}

export const SEASONS = 6;
export const SEASON_RACES = 4;
export const PROFILE_RECORD_TRACKS = 10;

export interface PlayerProfile {
    championshipFlags: number;
    season: number;
    round: number;
    seasonPlaces: number[][];
    seasonPoints: number[];
    seasonTimes: number[][];
    lapRecords: number[];
    unlocks: number;
    unlockedTracks: number;
    unlockedWeathers: number;
    handling: number;
    transmission: number;
    tires: number;
    suspension: number;
    controllerLayout: number;
    raceRecords: number[];
}

export function playerProfile(): PlayerProfile {
    return {
        championshipFlags: 0,
        season: 0,
        round: 0,
        seasonPlaces: Array.from({ length: SEASONS }, () => new Array<number>(SEASON_RACES).fill(0)),
        seasonPoints: new Array<number>(SEASONS).fill(0),
        seasonTimes: Array.from({ length: SEASONS }, () => new Array<number>(SEASON_RACES).fill(0)),
        lapRecords: new Array<number>(PROFILE_RECORD_TRACKS).fill(0),
        unlocks: 0,
        unlockedTracks: 0,
        unlockedWeathers: 0,
        handling: 0,
        transmission: 0,
        tires: 0,
        suspension: 0,
        controllerLayout: 0,
        raceRecords: new Array<number>(PROFILE_RECORD_TRACKS).fill(0),
    };
}

export const VEHICLE_WHEELS = 4;
export const SPRAY_SEGMENTS = 9;
export const SPRAY_SEGMENT_VERTICES = 4;

export interface SprayVertex {
    ob: number[];
    tc: number[];
    cn: number[];
}

function sprayVertex(): SprayVertex {
    return { ob: [0, 0, 0], tc: [0, 0], cn: [0, 0, 0, 0] };
}
export const VEHICLE_LAP_TIMES = 5;
export const VEHICLE_DENT_SIDES = 8;
export const VEHICLE_CAMERAS = 6;
export const RACER_SLOTS = 20;
export const RAY_INSTANCES = 32;
export const VEHICLE_FORCES = 16;
export const CAR_GEAR_RATIOS = 7;
export const VEHICLE_CAMERA_COCKPIT = 0;
export const VEHICLE_CAMERA_CHASE = 1;
export const VEHICLE_CAMERA_BUMPER = 2;
export const VEHICLE_CAMERA_TRACKSIDE = 3;
export const VEHICLE_CAMERA_4 = 4;
export const VEHICLE_CAMERA_MIRROR = 5;
export const RACER_CLOCK_STOPPED = 0x3;
export const RACER_HELD = 0x1;
export const RACER_FINISHED = 0x2;
export const VEHICLE_GHOST = 2;

export interface VehicleModelInfo {
    car: number;
    wheels: Vec3f[];
    cockpitForward: number;
    mirrorForward: number;
    cockpitUp: number;
}

export interface RacerSlot {
    position: Vec3f;
    previousPosition: Vec3f;
    velocity: Vec3f;
    speedKph: number;
    section: TrackSection | null;
    pointIndex: number;
    lapTime: number;
    bestLapTime: number;
    totalTime: number;
    timeLeft: number;
    lap: number;
    distanceLaps: number;
    maxGate: number;
    gate: number;
    distance: number;
    racePosition: number;
    color: number[];
    vehicle: Vehicle | null;
    index: number;
    status: number;
    straggler: number;
}

export function racerSlot(index: number): RacerSlot {
    return {
        position: vec3(),
        previousPosition: vec3(),
        velocity: vec3(),
        speedKph: 0,
        section: null,
        pointIndex: 0,
        lapTime: 0,
        bestLapTime: 0,
        totalTime: 0,
        timeLeft: 0,
        lap: 0,
        distanceLaps: 0,
        maxGate: 0,
        gate: 0,
        distance: 0,
        racePosition: 0,
        color: [0, 0, 0],
        vehicle: null,
        index,
        status: 0,
        straggler: 0,
    };
}

export interface Vehicle {
    frame: CameraFrame;
    wheelFrames: CameraFrame[];
    index: number;
    skidFrames: number;
    body: RigidBody;
    wheelBodies: RigidBody[];
    forces: RigidBodyForce[];
    steerAngle: number;
    engineRpm: number;
    gearRatios: number[];
    torqueCurve: number[];
    finalDrive: number;
    gearCount: number;
    rearWheelDrive: number;
    transmission: number;
    tableIndex: number;
    throttle: number;
    brake: number;
    gear: number;
    frontLoad: number;
    frontSliding: number;
    rearLoad: number;
    rearSliding: number;
    steerReturn: number;
    skipDrive: number;
    customDecals: number;
    profile: PlayerProfile | null;
    tireType: number;
    suspensionStiffness: number;
    steeringMode: number;
    chosenTransmission: number;
    forcedForwardFrames: number;
    forcedReverseFrames: number;
    reverseFrames: number;
    forwardFrames: number;
    nearestRacers: (RacerSlot | null)[];
    racer: RacerSlot | null;
    slotCooldown: number;
    driver: ((vehicle: Vehicle) => void) | null;
    aiTarget: Vec3f;
    trackPoint: Vec3f;
    trackForward: Vec3f;
    trackSide: Vec3f;
    trackUp: Vec3f;
    trackSideDistance: number;
    trackOffset: Vec3f;
    trackSideOffset: number;
    previousListenerPosition: Vec3f;
    effectSound: number;
    effectVolume: number;
    effectPriority: number;
    dopplerFactor: number;
    cameraChanged: number;
    flyMode: number;
    previousPosition: Vec3f;
    section: TrackSection | null;
    pointIndex: number;
    trackDirection: Vec3f;
    maxGate: number;
    gate: number;
    lap: number;
    distanceLaps: number;
    lapTime: number;
    lapTimes: number[];
    bestLapTime: number;
    bestLap: number;
    totalTime: number;
    timeLeft: number;
    distance: number;
    racePosition: number;
    message: string | null;
    messageTime: number;
    subMessage: string | null;
    subMessageTime: number;
    messageText: string;
    groundHits: number;
    placedVelocity: Vec3f;
    speedKph: number;
    odometer: number;
    joltPosition: Vec3f;
    joltVelocity: Vec3f;
    joltOffset: Vec3f;
    exhaustTimer: number;
    exhaustPosition: Vec3f;
    smokeTimers: number[];
    smokePositions: Vec3f[];
    sprayFramesLeft: number[];
    spraySurfaces: number[];
    sprayPhases: number[];
    sprayAdvanced: number[];
    sprayPositions: Vec3f[];
    sprayVertices: SprayVertex[][][];
    sprayVelocities: number[][][][];
    spraySegmentSurfaces: number[][];
    sprayOrigin: Vec3f;
    inTunnel: number;
    cameraHeading: number;
    steering: number;
    pitchInput: number;
    accelerator: number;
    rollInput: number;
    fogFactor: number;
    activeCamera: CameraFrame;
    previousCamera: CameraFrame;
    cameras: CameraFrame[];
    chaseSpeed: number;
    chaseLag: number;
    lookAhead: number;
    lookAt: Vec3f;
    chasePosition: Vec3f;
    collisionPull: number;
    initialChasePosition: Vec3f;
    groundInstances: number[];
    groundInstanceCount: number;
    nearbyInstances: number[];
    nearbyInstanceCount: number;
    groundDistance: number;
    groundSurface: number;
    selectedCar: number;
    carModel: number;
    color: number[];
    ghostMode: number;
    opacity: number;
    otherLook: number;
    wrongWayFrames: number;
    gridX: number;
    gridY: number;
    input: PlayerInputState | null;
    model: VehicleModelInfo | null;
    dents: number[];
    dentJitter: number;
}

export function vehicle(index: number): Vehicle {
    const cameras = Array.from({ length: VEHICLE_CAMERAS }, () => cameraFrame());
    const v: Vehicle = {
        frame: cameraFrame(),
        wheelFrames: Array.from({ length: VEHICLE_WHEELS }, () => cameraFrame()),
        index,
        skidFrames: 0,
        body: rigidBody(),
        wheelBodies: Array.from({ length: VEHICLE_WHEELS }, () => rigidBody()),
        forces: Array.from({ length: VEHICLE_FORCES }, () => rigidBodyForce()),
        steerAngle: 0,
        engineRpm: 0,
        gearRatios: new Array<number>(CAR_GEAR_RATIOS).fill(0),
        torqueCurve: [0, 0, 0, 0],
        finalDrive: 0,
        gearCount: 0,
        rearWheelDrive: 0,
        transmission: 0,
        tableIndex: 0,
        throttle: 0,
        brake: 0,
        gear: 0,
        frontLoad: 0,
        frontSliding: 0,
        rearLoad: 0,
        rearSliding: 0,
        steerReturn: 0,
        skipDrive: 0,
        customDecals: 0,
        profile: null,
        tireType: 0,
        suspensionStiffness: 0,
        steeringMode: 0,
        chosenTransmission: 0,
        forcedForwardFrames: 0,
        forcedReverseFrames: 0,
        reverseFrames: 0,
        forwardFrames: 0,
        nearestRacers: new Array<RacerSlot | null>(RACER_SLOTS).fill(null),
        racer: null,
        slotCooldown: 0,
        driver: null,
        aiTarget: vec3(),
        trackPoint: vec3(),
        trackForward: vec3(),
        trackSide: vec3(),
        trackUp: vec3(),
        trackSideDistance: 0,
        trackOffset: vec3(),
        trackSideOffset: 0,
        previousListenerPosition: vec3(),
        effectSound: 0,
        effectVolume: 0,
        effectPriority: 0,
        dopplerFactor: 0,
        cameraChanged: 0,
        flyMode: 0,
        previousPosition: vec3(),
        section: null,
        pointIndex: 0,
        trackDirection: vec3(),
        maxGate: 0,
        gate: 0,
        lap: 0,
        distanceLaps: 0,
        lapTime: 0,
        lapTimes: new Array<number>(VEHICLE_LAP_TIMES).fill(0),
        bestLapTime: 0,
        bestLap: 0,
        totalTime: 0,
        timeLeft: 0,
        distance: 0,
        racePosition: 0,
        message: null,
        messageTime: 0,
        subMessage: null,
        subMessageTime: 0,
        messageText: "",
        groundHits: 0,
        placedVelocity: vec3(),
        speedKph: 0,
        odometer: 0,
        joltPosition: vec3(),
        joltVelocity: vec3(),
        joltOffset: vec3(),
        exhaustTimer: 0,
        exhaustPosition: vec3(),
        smokeTimers: [0, 0, 0, 0],
        smokePositions: Array.from({ length: VEHICLE_WHEELS }, () => vec3()),
        sprayFramesLeft: [0, 0, 0, 0],
        spraySurfaces: [0, 0, 0, 0],
        sprayPhases: [0, 0, 0, 0],
        sprayAdvanced: [0, 0, 0, 0],
        sprayPositions: Array.from({ length: VEHICLE_WHEELS }, () => vec3()),
        sprayVertices: Array.from({ length: VEHICLE_WHEELS }, () =>
            Array.from({ length: SPRAY_SEGMENTS }, () => Array.from({ length: SPRAY_SEGMENT_VERTICES }, sprayVertex)),
        ),
        sprayVelocities: Array.from({ length: VEHICLE_WHEELS }, () =>
            Array.from({ length: SPRAY_SEGMENTS }, () => Array.from({ length: SPRAY_SEGMENT_VERTICES }, () => [0, 0, 0])),
        ),
        spraySegmentSurfaces: Array.from({ length: VEHICLE_WHEELS }, () => new Array<number>(SPRAY_SEGMENTS).fill(0)),
        sprayOrigin: vec3(),
        inTunnel: 0,
        cameraHeading: 0,
        steering: 0,
        pitchInput: 0,
        accelerator: 0,
        rollInput: 0,
        fogFactor: 0,
        activeCamera: cameras[VEHICLE_CAMERA_CHASE],
        previousCamera: cameras[VEHICLE_CAMERA_CHASE],
        cameras,
        chaseSpeed: 0,
        chaseLag: 0,
        lookAhead: 0,
        lookAt: vec3(),
        chasePosition: vec3(),
        collisionPull: 0,
        initialChasePosition: vec3(),
        groundInstances: new Array<number>(RAY_INSTANCES).fill(0),
        groundInstanceCount: 0,
        nearbyInstances: new Array<number>(RAY_INSTANCES).fill(0),
        nearbyInstanceCount: 0,
        groundDistance: 0,
        groundSurface: 0,
        selectedCar: 0,
        carModel: 0,
        color: [0, 0, 0],
        ghostMode: 0,
        opacity: 1,
        otherLook: 0,
        wrongWayFrames: 0,
        gridX: 0,
        gridY: 0,
        input: null,
        model: null,
        dents: new Array<number>(VEHICLE_DENT_SIDES).fill(0),
        dentJitter: 0,
    };
    return v;
}
