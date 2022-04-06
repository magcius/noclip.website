import { vec2, vec3 } from "gl-matrix";

export const enum BananaType {
    Single,
    Bunch,
}

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

export const enum EaseType {
    Constant,
    Linear,
    Smooth,
}

export type Keyframe = {
    easeType: EaseType;
    time: number; // Percent of total animation duration (1-100)?
    value: number; // Translation or rotation in degrees
};

export type ItemgroupAnim = {
    rotXKeyframes: Keyframe[];
    rotYKeyframes: Keyframe[];
    rotZKeyframes: Keyframe[];
    posXKeyframes: Keyframe[];
    posYKeyframes: Keyframe[];
    posZKeyframes: Keyframe[];
};

export type BgAnim = {
    loopPointSeconds: number;
    posXKeyframes: Keyframe[];
    posYKeyframes: Keyframe[];
    posZKeyframes: Keyframe[];
    rotXKeyframes: Keyframe[];
    rotYKeyframes: Keyframe[];
    rotZKeyframes: Keyframe[];
};

export type BgAnim2 = {
    loopPointSeconds: number;
    unk1Keyframes: Keyframe[];
    unk2Keyframes: Keyframe[];
    posXKeyframes: Keyframe[];
    posYKeyframes: Keyframe[];
    posZKeyframes: Keyframe[];
    rotXKeyframes: Keyframe[];
    rotYKeyframes: Keyframe[];
    rotZKeyframes: Keyframe[];
    unk9Keyframes: Keyframe[];
    unk10Keyframes: Keyframe[];
    unk11Keyframes: Keyframe[];
};

export type BgModel = {
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    bgAnim: BgAnim;
    bgAnim2: BgAnim2;
    // effectHeader: EffectHeader;
};

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

// export type TextureScroll = {
//     speed: vec3;
// }

// export type BgModel = {
//     modelName: string;
//     pos: vec3;
//     rot: vec3;
//     scale: vec3;
//     backgroundAnimHeader: BackgroundAnimHeader;
//     backgroundAnim2Header: BackgroundAnim2Header;
//     // effectHeader: EffectHeader;
// }

// Visual model for the stage itself, parented to itemgroups
export type LevelModel = {
    flags: number;
    modelName: string;
};

export type Banana = {
    pos: vec3;
    type: BananaType;
};

export type StageModelInstance = {
    stageModelA: StageModelPtrA;
    pos: vec3;
    rot: vec3;
    scale: vec3;
};

export type FogAnim = {
    startDistanceKeyframes: Keyframe[];
    endDistanceKeyframes: Keyframe[];
    redKeyframes: Keyframe[];
    blueKeyframes: Keyframe[];
    greenKeyframes: Keyframe[];
    unkKeyframes: Keyframe[];
};

export type ColiCone = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
};

export type Bumper = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
};

// export type ReflectiveModel = {
//     modelName: string;
// }

export type FalloutPlane = {
    y: number;
};

export type StageModel = {
    modelName: string;
};

export type Itemgroup = {
    initPos: vec3;
    initRot: vec3;
    animType: AnimType;
    animHeader: ItemgroupAnim;
    // conveyorVel: vec3;

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
};

export type StageModelPtrA = {
    stageModel: StageModel;
};

// export type FgModel = {
//     // Some other unknown fields are here...
//     modelName: string;
//     pos: vec3;
//     rot: vec3;
//     scale: vec3;
//     backgroundAnim2Header: BackgroundAnim2Header;
// }

export type StageModelPtrB = {
    stageModelA: StageModelPtrA;
};

export type ColiSphere = {
    pos: vec3;
    radius: number;
};

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
    levelModels: LevelModel[];
    bgModels: BgModel[];
    // fgModels: FgModel[];
    // reflectiveModels: ReflectiveModel[];
};

export type Jamabar = {
    pos: vec3;
    rot: vec3;
    scale: vec3;
};

export type FalloutVolume = {
    pos: vec3;
    size: vec3;
    rot: vec3;
};

export type ColiTri = {
    // Transform from triangle space to itemgroup space
    pos: vec3; // Position of vertex 1
    normal: vec3; // Normal in itemgroup space
    rot: vec3; // Rotation from XY plane

    // Triangle space (tri in XY plane, vertex 1 on origin, vertex 2 on (+)X axis)

    // Vertex 1 in triangle space is (0, 0)
    vert2: vec2;
    vert3: vec2;
    // Edge 1 normal in triangle space is (0, 1)
    edge2Normal: vec2; // Normal of edge from vertex 2 -> vertex 3, in triangle space
    edge3Normal: vec2; // Normal of edge from vertex 3 -> vertex 1, in triangle space
};

export type Goal = {
    pos: vec3;
    rot: vec3;
    type: GoalType;
};

export type ColiCylinder = {
    pos: vec3;
    radius: number;
    height: number;
    rot: vec3;
};

export type InitBallPose = {
    pos: vec3;
    rot: vec3;
};
