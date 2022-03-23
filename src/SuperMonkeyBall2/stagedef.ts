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

export type AnimKeyframe = {
    easing: number; // integer (enum?)
    time: number; // float
    value: number; // float
}

export type AnimHeader = {
    rotXKeyframes: AnimKeyframe[];
    rotYKeyframes: AnimKeyframe[];
    rotZKeyframes: AnimKeyframe[];
    posXKeyframes: AnimKeyframe[];
    posYKeyframes: AnimKeyframe[];
    posZKeyframes: AnimKeyframe[];
}

export type BackgroundAnim2Header = {
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

export type BackgroundAnimHeader = {
    loopPointSeconds: number,
    posXKeyframes: AnimKeyframe[];
    posYKeyframes: AnimKeyframe[];
    posZKeyframes: AnimKeyframe[];
    rotXKeyframes: AnimKeyframe[];
    rotYKeyframes: AnimKeyframe[];
    rotZKeyframes: AnimKeyframe[];
}

export type EffectHeader = {
    fx1Keyframes: Effect1[];
    fx2Keyframes: Effect2[];
    textureScroll: TextureScroll;
}

export type Effect1 = {
    // ??
}

export type Effect2 = {
    // ??
}

export type TextureScroll = {
    speed: vec3;
}

export type BackgroundModel = {
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    backgroundAnimHeader: BackgroundAnimHeader;
    backgroundAnim2Header: BackgroundAnim2Header;
    effectHeader: EffectHeader;
}

export type Banana = {
    pos: vec3;
    type: BananaType;
}

export type StageModelInstance = {
    stageModelA: StageModelPtrA;
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export type FogAnimHeader = {
    startDistanceKeyframes: AnimKeyframe[];
    endDistanceKeyframes: AnimKeyframe[];
    redKeyframes: AnimKeyframe[];
    blueKeyframes: AnimKeyframe[];
    greenKeyframes: AnimKeyframe[];
    unkKeyframes: AnimKeyframe[];
}

export type ColiCone = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export type Bumper = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export type ReflectiveStageModel = {
    modelName: string;
}

export type FalloutPlane = {
    y: number;
}

export type StageModel = {
    modelName: string;
}

export type StageItemgroup = {
    origin: vec3;
    initialRot: vec3;
    animType: AnimType;
    animHeader: AnimHeader;
    conveyorVel: vec3;

    coliTris: ColiTri[];
    // Given cell coord (x, z), coliTriIdxs[z * coliGridCellsX + x] gives you
    // a list of tri indices in that cell
    gridCellTris: number[][];
    gridOriginX: number;
    gridOriginZ: number;
    gridStepX: number;
    gridStepZ: number;
    gridCellCountX: number;
    gridCellCountZ: number;

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

export type StageModelPtrA = {
    stageModel: StageModel;
}

export type ForegroundModel = {
    // Some other unknown fields are here...
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    backgroundAnim2Header: BackgroundAnim2Header;
}

export type StageModelPtrB = {
    stageModelA: StageModelPtrA;
}

export type ColiSphere = {
    pos: vec3;
    radius: number;
}

export type Stage = {
    magicNumberA: number;
    magicNumberB: number;
    itemgroups: StageItemgroup[];
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

export type Jamabar = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
}

export type FalloutVolume = {
    pos: vec3;
    size: vec3;
    rot: vec3;
}

export type ColiTri = {
    point1Pos: vec3;
    normal: vec3;
    rotFromXY: vec3;
    point2Point1Delta: vec2;
    point3Point1Delta: vec2;
    tangent: vec2;
    bitangent: vec2;
}

export type Goal = {
    pos: vec3;
    rot: vec3;
    type: GoalType;
}

export type Wormhole = {
    pos: vec3;
    rot: vec3;
    destination: Wormhole;
}

export type ColiCylinder = {
    pos: vec3;
    radius: number;
    height: number;
    rot: vec3;
}

export type Start = {
    pos: vec3;
    rot: vec3;
}

export type Button = {
    pos: vec3;
    rot: vec3;
    playbackState: PlaybackState;
    animGroupId: number;
}

export type Fog = {
    type: GX.FogType;
    startDistance: number;
    endDistance: number;
    color: vec3; // TODO use a noclip Color type?
}
