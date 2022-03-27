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
}

export const enum PlaybackState {
    Forward,
    Pause,
    Backward,
    FastForward,
    FastBackward,
}

export const enum GoalType {
    Blue,
    Green,
    Red,
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

// export type EffectHeader = {
//     fx1Keyframes: Effect1[];
//     fx2Keyframes: Effect2[];
//     textureScroll: TextureScroll;
// }

// export type Effect1 = {
//     // ??
// }

// export type Effect2 = {
//     // ??
// }

export type BgModel = {
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    backgroundAnimHeader: BackgroundAnimHeader;
    backgroundAnim2Header: BackgroundAnim2Header;
    // effectHeader: EffectHeader;
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

export type ReflectiveModel = {
    modelName: string;
}

export type FalloutPlane = {
    y: number;
}

export type StageModel = {
    modelName: string;
}

export type Itemgroup = {
    initPos: vec3;
    initRot: vec3;
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
}

export type StageModelPtrA = {
    stageModel: StageModel;
}

export type FgModel = {
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
    unk0: number;
    unk4: number;
    itemgroups: Itemgroup[];
    initBallPose: InitBallPose;
    falloutPlane: FalloutPlane;
    goals: Goal[];
    bumpers: Bumper[];
    jamabars: Jamabar[];
    bananas: Banana[];
    bgModels: BgModel[];
    fgModels: FgModel[];
    reflectiveModels: ReflectiveModel[];
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

export type ColiCylinder = {
    pos: vec3;
    radius: number;
    height: number;
    rot: vec3;
}

export type InitBallPose = {
    pos: vec3;
    rot: vec3;
}
