/*
 * SMB1 stagedef types and parsing (.lz in stage directories).
 *
 * SMB1 stagedef format: https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=stagedefFormat2#spec-stagedefFormat2-section-collisionHeader
 * SMB1 decompilation (potentially more up to date): https://github.com/camthesaxman/smb-decomp
 */

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
    originPos: vec3;
    originRot: vec3;
    animType: AnimType;
    anim: ItemgroupAnim;
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
    levelModels: LevelModel[];
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

import { vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZSS from "../Common/Compression/LZSS";
import { readString } from "../util";

const ITEMGROUP_SIZE = 0xc4;
const GOAL_SIZE = 0x14;
const BUMPER_SIZE = 0x20;
const JAMABAR_SIZE = 0x20;
const BANANA_SIZE = 0x10;
const COLI_CONE_SIZE = 0x20;
const COLI_SPHERE_SIZE = 0x14;
const COLI_CYLINDER_SIZE = 0x1c;
// const FALLOUT_VOLUME_SIZE = 0x20;
const BG_MODEL_SIZE = 0x38;
const ANIM_KEYFRAME_SIZE = 0x14;
const COLI_TRI_SIZE = 0x40;
const LEVEL_MODEL_SIZE = 0xc;

function parseVec3f(view: DataView, offset: number): vec3 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    const z = view.getFloat32(offset + 0x8);
    return vec3.fromValues(x, y, z);
}

function parseVec2f(view: DataView, offset: number): vec2 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    return vec2.fromValues(x, y);
}

function parseVec3s(view: DataView, offset: number): vec3 {
    const x = view.getInt16(offset);
    const y = view.getInt16(offset + 0x2);
    const z = view.getInt16(offset + 0x4);
    return vec3.fromValues(x, y, z);
}

function parseKeyframeList(view: DataView, offset: number): Keyframe[] {
    const keyframes: Keyframe[] = [];
    const keyframeCount = view.getUint32(offset);
    const keyframeListOffs = view.getUint32(offset + 0x4);
    for (let i = 0; i < keyframeCount; i++) {
        const keyframeOffs = keyframeListOffs + i * ANIM_KEYFRAME_SIZE;
        const easeType = view.getUint32(keyframeOffs + 0x0) as EaseType;
        const time = view.getFloat32(keyframeOffs + 0x4);
        const value = view.getFloat32(keyframeOffs + 0x8);
        keyframes.push({ easeType: easeType, time, value });
    }
    return keyframes;
}

function parseAnimHeader(view: DataView, offset: number): ItemgroupAnim {
    const rotXKeyframes = parseKeyframeList(view, offset + 0x0);
    const rotYKeyframes = parseKeyframeList(view, offset + 0x8);
    const rotZKeyframes = parseKeyframeList(view, offset + 0x10);
    const posXKeyframes = parseKeyframeList(view, offset + 0x18);
    const posYKeyframes = parseKeyframeList(view, offset + 0x20);
    const posZKeyframes = parseKeyframeList(view, offset + 0x28);
    return {
        rotXKeyframes,
        rotYKeyframes,
        rotZKeyframes,
        posXKeyframes,
        posYKeyframes,
        posZKeyframes,
    };
}

function parseSlicedList<T>(
    view: DataView,
    offset: number,
    origList: T[],
    origListOffs: number,
    elemSize: number
): T[] {
    const count = view.getUint32(offset);
    const listOffs = view.getUint32(offset + 0x4);
    const idx = (listOffs - origListOffs) / elemSize;
    return origList.slice(idx, idx + count);
}

export function parseStagedefLz(buffer: ArrayBufferSlice): Stage {
    const view = buffer.createDataView();
    const compressedView = buffer.subarray(0x8).createDataView();
    const uncompressedSize = view.getUint32(0x4, true);
    const uncompressedBuffer = LZSS.decompress(compressedView, uncompressedSize);
    return parseStagedefUncompressed(uncompressedBuffer);
}

function parseStagedefUncompressed(buffer: ArrayBufferSlice): Stage {
    const view = buffer.createDataView();

    const unk0 = view.getUint32(0x0);
    const unk4 = view.getUint32(0x4);

    // Start aka ball spawn
    const startOffs = view.getUint32(0x10);
    const startPos = parseVec3f(view, startOffs + 0x0);
    const startRot = parseVec3s(view, startOffs + 0xc);
    const initBallPose: InitBallPose = { pos: startPos, rot: startRot };

    // Fallout plane
    const falloutPlaneOffs = view.getUint32(0x14);
    const falloutPlane: FalloutPlane = { y: view.getFloat32(falloutPlaneOffs) };

    // Goals
    const goalCount = view.getUint32(0x18);
    const goalListOffs = view.getUint32(0x1c);
    const goals: Goal[] = [];
    for (let i = 0; i < goalCount; i++) {
        const goalOffs = goalListOffs + i * GOAL_SIZE;
        const pos = parseVec3f(view, goalOffs + 0x0);
        const rot = parseVec3s(view, goalOffs + 0xc);
        const typeStr = readString(buffer, goalOffs + 0x12, 1, false);
        let type: GoalType;
        if (typeStr == "B") type = GoalType.Blue;
        else if (typeStr == "G") type = GoalType.Green;
        else if (typeStr == "R") type = GoalType.Red;
        else throw new Error(`Unknown goal type '${typeStr}'`);
        goals.push({ pos, rot, type });
    }

    // Bumpers
    const bumperCount = view.getUint32(0x28);
    const bumperListOffs = view.getUint32(0x2c);
    const bumpers: Bumper[] = [];
    for (let i = 0; i < bumperCount; i++) {
        const bumperOffs = bumperListOffs + i * BUMPER_SIZE;
        const pos = parseVec3f(view, bumperOffs + 0x0);
        const rot = parseVec3s(view, bumperOffs + 0xc);
        const scale = parseVec3f(view, bumperOffs + 0x14);
        bumpers.push({ pos, rot, scale });
    }

    // Jamabars
    const jamabarCount = view.getUint32(0x30);
    const jamabarListOffs = view.getUint32(0x34);
    const jamabars: Jamabar[] = [];
    for (let i = 0; i < jamabarCount; i++) {
        const jamabarOffs = jamabarListOffs + i * JAMABAR_SIZE;
        const pos = parseVec3f(view, jamabarOffs + 0x0);
        const rot = parseVec3s(view, jamabarOffs + 0xc);
        const scale = parseVec3f(view, jamabarOffs + 0x14);
        jamabars.push({ pos, rot, scale });
    }

    // Bananas
    const bananaCount = view.getUint32(0x38);
    const bananaListOffs = view.getUint32(0x3c);
    const bananas: Banana[] = [];
    for (let i = 0; i < bananaCount; i++) {
        const bananaOffs = bananaListOffs + i * BANANA_SIZE;
        const pos = parseVec3f(view, bananaOffs + 0x0);
        const type = view.getUint32(bananaOffs + 0xc) as BananaType;
        bananas.push({ pos, type });
    }

    // Collision cones
    const coliConeCount = view.getUint32(0x30);
    const coliConeListOffs = view.getUint32(0x34);
    const coliCones: ColiCone[] = [];
    for (let i = 0; i < coliConeCount; i++) {
        const coliConeOffs = coliConeListOffs + i * COLI_CONE_SIZE;
        const pos = parseVec3f(view, coliConeOffs + 0x0);
        const rot = parseVec3s(view, coliConeOffs + 0xc);
        const scale = parseVec3f(view, coliConeOffs + 0x14);
        coliCones.push({ pos, rot, scale });
    }

    // Collision spheres
    const coliSphereCount = view.getUint32(0x38);
    const coliSphereListOffs = view.getUint32(0x3c);
    const coliSpheres: ColiSphere[] = [];
    for (let i = 0; i < coliSphereCount; i++) {
        const coliSphereOffs = coliSphereListOffs + i * COLI_SPHERE_SIZE;
        const pos = parseVec3f(view, coliSphereOffs + 0x0);
        const radius = view.getFloat32(coliSphereOffs + 0xc);
        coliSpheres.push({ pos, radius });
    }

    // Collision cylinders
    const coliCylinderCount = view.getUint32(0x40);
    const coliCylinderListOffs = view.getUint32(0x44);
    const coliCylinders: ColiCylinder[] = [];
    for (let i = 0; i < coliCylinderCount; i++) {
        const coliCylinderOffs = coliCylinderListOffs + i * COLI_CYLINDER_SIZE;
        const pos = parseVec3f(view, coliCylinderOffs + 0x0);
        const radius = view.getFloat32(coliCylinderOffs + 0xc);
        const height = view.getFloat32(coliCylinderOffs + 0x10);
        const rot = parseVec3s(view, coliCylinderOffs + 0x14);
        coliCylinders.push({ pos, radius, height, rot });
    }

    // // Fallout volumes
    // const falloutVolumeCount = view.getUint32(0x50);
    // const falloutVolumeListOffs = view.getUint32(0x54);
    // const falloutVolumes: FalloutVolume[] = [];
    // for (let i = 0; i < falloutVolumeCount; i++) {
    //     const falloutVolumeOffs = falloutVolumeListOffs + i * FALLOUT_VOLUME_SIZE;
    //     const pos = parseVec3f(view, falloutVolumeOffs + 0x0);
    //     const size = parseVec3f(view, falloutVolumeOffs + 0xC);
    //     const rot = parseVec3s(view, falloutVolumeOffs + 0x18);
    //     falloutVolumes.push({ pos, size, rot });
    // }

    // Level models
    const levelModelCount = view.getUint32(0x58);
    const levelModelListOffs = view.getUint32(0x5c);
    const levelModels: LevelModel[] = [];
    for (let i = 0; i < levelModelCount; i++) {
        const levelModelOffs = levelModelListOffs + i * LEVEL_MODEL_SIZE;
        const flags = view.getUint32(levelModelOffs + 0x0);
        const modelName = readString(buffer, view.getUint32(levelModelOffs + 0x4));
        levelModels.push({ flags, modelName });
    }

    // Background models
    const bgModelCount = view.getUint32(0x68);
    const bgModelListOffs = view.getUint32(0x6c);
    const bgModels: BgModel[] = [];
    for (let i = 0; i < bgModelCount; i++) {
        const bgModelOffs = bgModelListOffs + i * BG_MODEL_SIZE;
        const modelName = readString(buffer, view.getUint32(bgModelOffs + 0x4));
        const pos = parseVec3f(view, bgModelOffs + 0xc);
        const rot = parseVec3s(view, bgModelOffs + 0x18);
        const scale = parseVec3s(view, bgModelOffs + 0x20);

        // Background anim header
        const bgAnimOffs = view.getUint32(bgModelOffs + 0x2c);
        const bgLoopPointSeconds = view.getFloat32(bgAnimOffs + 0x4);
        const bgRotXKeyframes = parseKeyframeList(view, bgAnimOffs + 0x10);
        const bgRotYKeyframes = parseKeyframeList(view, bgAnimOffs + 0x18);
        const bgRotZKeyframes = parseKeyframeList(view, bgAnimOffs + 0x20);
        const bgPosXKeyframes = parseKeyframeList(view, bgAnimOffs + 0x28);
        const bgPosYKeyframes = parseKeyframeList(view, bgAnimOffs + 0x30);
        const bgPosZKeyframes = parseKeyframeList(view, bgAnimOffs + 0x38);
        const bgAnim: BgAnim = {
            loopPointSeconds: bgLoopPointSeconds,
            rotXKeyframes: bgRotXKeyframes,
            rotYKeyframes: bgRotYKeyframes,
            rotZKeyframes: bgRotZKeyframes,
            posXKeyframes: bgPosXKeyframes,
            posYKeyframes: bgPosYKeyframes,
            posZKeyframes: bgPosZKeyframes,
        };

        // Background anim 2 header
        const bgAnim2Offs = view.getUint32(bgModelOffs + 0x30);
        const bg2LoopPointSeconds = view.getFloat32(bgAnim2Offs + 0x4);
        const bg2Unk1Keyframes = parseKeyframeList(view, bgAnim2Offs + 0x8);
        const bg2Unk2Keyframes = parseKeyframeList(view, bgAnim2Offs + 0x10);
        const bg2RotXKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x18);
        const bg2RotYKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x20);
        const bg2RotZKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x28);
        const bg2PosXKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x30);
        const bg2PosYKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x38);
        const bg2PosZKeyframes = parseKeyframeList(view, bgAnim2Offs + 0x40);
        const bg2Unk9Keyframes = parseKeyframeList(view, bgAnim2Offs + 0x48);
        const bg2Unk10Keyframes = parseKeyframeList(view, bgAnim2Offs + 0x50);
        const bg2Unk11Keyframes = parseKeyframeList(view, bgAnim2Offs + 0x58);
        const bgAnim2: BgAnim2 = {
            loopPointSeconds: bg2LoopPointSeconds,
            unk1Keyframes: bg2Unk1Keyframes,
            unk2Keyframes: bg2Unk2Keyframes,
            rotXKeyframes: bg2RotXKeyframes,
            rotYKeyframes: bg2RotYKeyframes,
            rotZKeyframes: bg2RotZKeyframes,
            posXKeyframes: bg2PosXKeyframes,
            posYKeyframes: bg2PosYKeyframes,
            posZKeyframes: bg2PosZKeyframes,
            unk9Keyframes: bg2Unk9Keyframes,
            unk10Keyframes: bg2Unk10Keyframes,
            unk11Keyframes: bg2Unk11Keyframes,
        };

        // Effect header
        // const effectHeaderOffs = view.getUint32(bgModelOffs + 0x34);
        // TODO fx1 and fx2 keyfranmes
        // const effectTextureScrollOffs = view.getUint32(effectHeaderOffs + 0x10);

        const bgModel: BgModel = {
            modelName,
            pos,
            rot,
            scale,
            bgAnim,
            bgAnim2,
        };
        bgModels.push(bgModel);
    }

    // // Foreground models
    // const foregroundModelCount = view.getUint32(0x60);
    // const foregroundModelListOffs = view.getUint32(0x64);
    // const fgModels: FgModel[] = [];
    // // TODO actually parse 'em

    // // Reflective stage models
    // const reflectiveModelCount = view.getUint32(0x70);
    // const reflectiveModelListOffs = view.getUint32(0x74);
    // const reflectiveModels: ReflectiveModel[] = [];
    // // TODO actually parse 'em

    // // TODO Stage model instances
    // const stageModelInstances: StageModelInstance[] = [];

    // // TODO Stage model ptr As
    // const stageModelPtrAs: StageModelPtrA[] = [];

    // // TODO Stage model ptr Bs
    // const stageModelPtrBs: StageModelPtrB[] = [];

    // // Fog animation headers
    // const fogAnimHeaderOffs = view.getUint32(0xB0);
    // const fogStartDistanceKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x0);
    // const fogEndDistanceKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x8);
    // const fogRedKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x10);
    // const fogGreenKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x18);
    // const fogBlueKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x20);
    // const fogUnkKeyframes = parseKeyframeList(view, fogAnimHeaderOffs + 0x28);
    // const fogAnimHeader: FogAnimHeader = {
    //     startDistanceKeyframes: fogStartDistanceKeyframes,
    //     endDistanceKeyframes: fogEndDistanceKeyframes,
    //     redKeyframes: fogRedKeyframes,
    //     greenKeyframes: fogGreenKeyframes,
    //     blueKeyframes: fogBlueKeyframes,
    //     unkKeyframes: fogUnkKeyframes,
    // };

    const itemgroupCount = view.getUint32(0x8);
    const itemgroupListOffs = view.getUint32(0xc);
    const itemgroups: Itemgroup[] = [];
    for (let i = 0; i < itemgroupCount; i++) {
        const coliHeaderOffs = itemgroupListOffs + i * ITEMGROUP_SIZE;
        const initPos = parseVec3f(view, coliHeaderOffs + 0x0);
        const initRot = parseVec3s(view, coliHeaderOffs + 0xc);
        const animType = view.getUint16(coliHeaderOffs + 0x12) as AnimType;
        const animHeaderOffs = view.getUint32(coliHeaderOffs + 0x14);
        const animHeader = parseAnimHeader(view, animHeaderOffs);
        // const conveyorVel = parseVec3f(view, coliHeaderOffs + 0x18);

        // Parse coli grid tri indices first so we know how many tris we need to parse,
        // as the tri list does not indicate its length
        const coliTriListOffs = view.getUint32(coliHeaderOffs + 0x1c);
        const coliTriIdxsOffs = view.getUint32(coliHeaderOffs + 0x20);
        const gridOriginX = view.getFloat32(coliHeaderOffs + 0x24);
        const gridOriginZ = view.getFloat32(coliHeaderOffs + 0x28);
        const gridStepX = view.getFloat32(coliHeaderOffs + 0x2c);
        const gridStepZ = view.getFloat32(coliHeaderOffs + 0x30);
        const gridCellCountX = view.getUint32(coliHeaderOffs + 0x34);
        const gridCellCountZ = view.getUint32(coliHeaderOffs + 0x38);

        const gridCellTris: number[][] = [];

        for (let z = 0; z < gridCellCountZ; z++) {
            for (let x = 0; x < gridCellCountX; x++) {
                const gridIdx = z * gridCellCountX + x;
                // Index into the array of s16 pointers
                // Original game had null offsets for empty grid cells,
                // we just use empty lists
                const triIdxListOffs = view.getUint32(coliTriIdxsOffs + gridIdx * 4);
                const triIdxList: number[] = [];
                if (triIdxListOffs != 0) {
                    for (let triIdxIdx = 0; ; triIdxIdx++) {
                        const triIdx = view.getInt16(triIdxListOffs + triIdxIdx * 2);
                        if (triIdx != -1) {
                            triIdxList.push(triIdx);
                        } else {
                            break;
                        }
                    }
                }
                gridCellTris.push(triIdxList);
            }
        }

        let maxTriIdx = -1;
        for (let idxList of gridCellTris) {
            maxTriIdx = Math.max(maxTriIdx, Math.max(...idxList));
        }
        const numTris = maxTriIdx + 1;

        const coliTris: ColiTri[] = [];

        // Parse collision tris
        for (let i = 0; i < numTris; i++) {
            const triOffs = coliTriListOffs + i * COLI_TRI_SIZE;
            const point1Pos = parseVec3f(view, triOffs + 0x0);
            const normal = parseVec3f(view, triOffs + 0xc);
            const rotFromXY = parseVec3s(view, triOffs + 0x18);
            const point2Point1Delta = parseVec2f(view, triOffs + 0x20);
            const point3Point1Delta = parseVec2f(view, triOffs + 0x28);
            const tangent = parseVec2f(view, triOffs + 0x30);
            const bitangent = parseVec2f(view, triOffs + 0x38);
            coliTris.push({
                pos: point1Pos,
                normal,
                rot: rotFromXY,
                vert2: point2Point1Delta,
                vert3: point3Point1Delta,
                edge2Normal: tangent,
                edge3Normal: bitangent,
            });
        }

        // "sub" means a subset of the stage's list
        const subGoals = parseSlicedList(
            view,
            coliHeaderOffs + 0x3c,
            goals,
            goalListOffs,
            GOAL_SIZE
        );
        const subBumpers = parseSlicedList(
            view,
            coliHeaderOffs + 0x4c,
            bumpers,
            bumperListOffs,
            BUMPER_SIZE
        );
        const subJamabars = parseSlicedList(
            view,
            coliHeaderOffs + 0x54,
            jamabars,
            jamabarListOffs,
            JAMABAR_SIZE
        );
        const subBananas = parseSlicedList(
            view,
            coliHeaderOffs + 0x5c,
            bananas,
            bananaListOffs,
            BANANA_SIZE
        );
        const subColiCones = parseSlicedList(
            view,
            coliHeaderOffs + 0x64,
            coliCones,
            coliConeListOffs,
            COLI_CONE_SIZE
        );
        const subColiSpheres = parseSlicedList(
            view,
            coliHeaderOffs + 0x6c,
            coliSpheres,
            coliSphereListOffs,
            COLI_SPHERE_SIZE
        );
        const subColiCylinders = parseSlicedList(
            view,
            coliHeaderOffs + 0x74,
            coliCylinders,
            coliCylinderListOffs,
            COLI_CYLINDER_SIZE
        );
        const subLevelModels = parseSlicedList(
            view,
            coliHeaderOffs + 0x7c,
            levelModels,
            levelModelListOffs,
            LEVEL_MODEL_SIZE
        );
        // const subFalloutVolumes = parseSlicedList(view, coliHeaderOffs + 0x7C, falloutVolumes, falloutVolumeListOffs, FALLOUT_VOLUME_SIZE);
        // TODO reflective stage models, stage model instances, model A/B ptr

        // const loopPointSeconds = view.getFloat32(coliHeaderOffs + 0xD4);
        // const textureScrollOffs = view.getUint32(coliHeaderOffs + 0xD8);
        // const textureScroll: TextureScroll = { speed: parseVec3f(view, textureScrollOffs) };

        itemgroups.push({
            originPos: initPos,
            originRot: initRot,
            animType: animType,
            anim: animHeader,
            // conveyorVel: conveyorVel,

            coliTris: coliTris,
            gridCellTris: gridCellTris,
            gridOriginX: gridOriginX,
            gridOriginZ: gridOriginZ,
            gridStepX: gridStepX,
            gridStepZ: gridStepZ,
            gridCellCountX: gridCellCountX,
            gridCellCountZ: gridCellCountZ,

            goals: subGoals,
            bumpers: subBumpers,
            jamabars: subJamabars,
            bananas: subBananas,
            coliCones: subColiCones,
            coliSpheres: subColiSpheres,
            coliCylinders: subColiCylinders,
            levelModels: subLevelModels,
            // reflectiveStageModels: [],
            // stageModelInstances: [],
            // stageModelPtrB: [],

            // textureScroll: textureScroll,
        });
    }

    return {
        unk0,
        unk4,
        itemgroups,
        initBallPose,
        falloutPlane,
        goals,
        bumpers,
        jamabars,
        bananas,
        levelModels,
        bgModels,
        // fgModels: [],
        // reflectiveModels: [],
    };
}