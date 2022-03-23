import { vec2, vec3 } from 'gl-matrix';
import * as GX from '../gx/gx_enum';

export const enum BananaType {
    Single,
    Bunch,
}

// TODO these are bitflags, not enum (although I suppose it's still correct)
export const enum AnimType {
    Loop,
    Once,
    Seesaw,
}

export const enum PlaybackState {
    Forward,
    Pause,
    Backward,
    FastForward,
    FastBackward,
}

export const enum GoalType {
    Blue = 0x0001,
    Green = 0x0101,
    Red = 0x0201,
}

export const enum Easing {
    Constant,
    Linear,
    Smooth,
}

export interface AnimKeyframe {
    easing: number; // integer (enum?)
    time: number; // float
    value: number; // float
}

export interface AnimHeader {
    rotXKeyframes: AnimKeyframe[];
    rotYKeyframes: AnimKeyframe[];
    rotZKeyframes: AnimKeyframe[];
    posXKeyframes: AnimKeyframe[];
    posYKeyframes: AnimKeyframe[];
    posZKeyframes: AnimKeyframe[];
}

export interface BackgroundAnim2Header {
    loopPointSeconds: number;
    unk1Keyframes: AnimKeyframe[];
    unk2Keyframes: AnimKeyframe[];
    posXKeyframes: AnimKeyframe[];
    posYKeyframes: AnimKeyframe[];
    posZKeyframes: AnimKeyframe[];
    rotXKeyframes: AnimKeyframe[];
    rotYKeyframes: AnimKeyframe[];
    rotZKeyframes: AnimKeyframe[];
    unk9Keyframes: AnimKeyframe[];
    unk10Keyframes: AnimKeyframe[];
    unk11Keyframes: AnimKeyframe[];
}

export interface BackgroundAnimHeader {
    loopPointSeconds: number,
    posXKeyframes: AnimKeyframe[];
    posYKeyframes: AnimKeyframe[];
    posZKeyframes: AnimKeyframe[];
    rotXKeyframes: AnimKeyframe[];
    rotYKeyframes: AnimKeyframe[];
    rotZKeyframes: AnimKeyframe[];
}

export interface EffectHeader {
    fx1Keyframes: Effect1[];
    fx2Keyframes: Effect2[];
    textureScroll: TextureScroll;
}

export interface Effect1 {
    // ??
}

export interface Effect2 {
    // ??
}

export interface TextureScroll {
    speed: vec3;
}

export interface BackgroundModel {
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    backgroundAnimHeader: BackgroundAnimHeader;
    backgroundAnim2Header: BackgroundAnim2Header;
    effectHeader: EffectHeader;
}

export interface Banana {
    pos: vec3;
    type: BananaType;
}

export interface StageModelInstance {
    stageModelA: StageModelPtrA;
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export interface FogAnimHeader {
    startDistanceKeyframes: AnimKeyframe[];
    endDistanceKeyframes: AnimKeyframe[];
    redKeyframes: AnimKeyframe[];
    blueKeyframes: AnimKeyframe[];
    greenKeyframes: AnimKeyframe[];
    unkKeyframes: AnimKeyframe[];
}

export interface ColiCone {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export interface Bumper {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export interface ReflectiveStageModel {
    modelName: string;
}

export interface FalloutPlane {
    y: number;
}

export interface StageModel {
    modelName: string;
}

export interface ColiHeader {
    origin: vec3;
    initialRot: vec3;
    animType: AnimType;
    animHeader: AnimHeader;
    conveyorVel: vec3;

    coliTris: ColiTri[];
    // Given cell coord (x, z), coliTriIdxs[z * coliGridCellsX + x] gives you
    // a list of tri indices in that cell
    coliTriIdxs: number[][];
    coliGridStartX: number;
    coliGridStartZ: number;
    coliGridStepX: number;
    coliGridStepZ: number;
    coliGridCellsX: number;
    coliGridCellsZ: number;

    goals: Goal[];
    bumpers: Bumper[];
    jamabars: Jamabar[];
    bananas: Banana[];
    coliCones: ColiCone[];
    coliSpheres: ColiSphere[];
    coliCylinders: ColiCylinder[];
    falloutVolumes: FalloutVolume[];
    reflectiveStageModels: ReflectiveStageModel[];
    stageModelInstances: StageModelInstance[];
    stageModelPtrB: StageModelPtrB[];
    animGroupId: number; // For use with buttons - Must be non-zero if you want to assign a group ID

    buttons: Button[];
    seesawSensitivity: number;
    seesawFriction: number;
    seesawSpring: number;
    wormholes: Wormhole[];
    initialPlaybackState: PlaybackState;
    loopPointSeconds: number;
    textureScroll: TextureScroll;
}

export interface StageModelPtrA {
    stageModel: StageModel;
}

export interface ForegroundModel {
    // Some other unknown fields are here...
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    backgroundAnim2Header: BackgroundAnim2Header;
}

export interface StageModelPtrB {
    stageModelA: StageModelPtrA;
}

export interface ColiSphere {
    pos: vec3;
    radius: number;
}

export interface FileHeader {
    magicNumberA: number;
    magicNumberB: number;
    coliHeaders: ColiHeader[];
    start: Start;
    falloutPlane: FalloutPlane;
    goals: Goal[];
    bumpers: Bumper[];
    jamabars: Jamabar[];
    bananas: Banana[];
    coliCones: ColiCone[];
    coliSpheres: ColiSphere[];
    coliCylinders: ColiCylinder[];
    falloutVolumes: FalloutVolume[];
    backgroundModels: BackgroundModel[];
    foregroundModels: ForegroundModel[];
    reflectiveStageModels: ReflectiveStageModel[];
    stageModelInstances: StageModelInstance[];
    stageModelPtrAs: StageModelPtrA[];
    stageModelPtrBs: StageModelPtrB[];
    buttons: Button[];
    fogAnimHeader: FogAnimHeader;
    wormholes: Wormhole[];
    fog: Fog;
}

export interface Jamabar {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export interface FalloutVolume {
    pos: vec3;
    size: vec3;
    rot: vec3;
}

export interface ColiTri {
    point1Pos: vec3;
    normal: vec3;
    rotFromXY: vec3;
    point2Point1Delta: vec2;
    point3Point1Delta: vec2;
    tangent: vec2;
    bitangent: vec2;
}

export interface Goal {
    pos: vec3;
    rot: vec3;
    type: GoalType;
}

export interface Wormhole {
    pos: vec3;
    rot: vec3;
    destination: Wormhole;
}

export interface ColiCylinder {
    pos: vec3;
    radius: number;
    height: number;
    rot: vec3;
}

export interface Start {
    pos: vec3;
    rot: vec3;
}

export interface Button {
    pos: vec3;
    rot: vec3;
    playbackState: PlaybackState;
    animGroupId: number;
}

export interface Fog {
    type: GX.FogType;
    startDistance: number;
    endDistance: number;
    color: vec3; // TODO use a noclip Color type?
}
