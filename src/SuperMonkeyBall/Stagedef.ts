/*
 * SMB1 stagedef types and parsing (.lz in stage directories).
 *
 * SMB1 stagedef format: https://craftedcart.github.io/SMBLevelWorkshop/documentation/index.html?page=stagedefFormat2#spec-stagedefFormat2-section-collisionHeader
 * SMB1 decompilation (potentially more up to date): https://github.com/camthesaxman/smb-decomp
 */

import { vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";
import { decompressLZ } from "./AVLZ";
import { parseVec2f, parseVec3f } from "./Utils";

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
    Smoothstep, // The game actually treats any value other than constant or linear as smoothstep, I've seen lots of different values
}

export type Keyframe = {
    easeType: EaseType;
    timeSeconds: number;
    value: number; // Translation, or rotation in degrees, or color r/g/b, etc
    tangentIn: number; // Left handle
    tangentOut: number; // Right handle
};

export type AnimGroupAnim = {
    rotXKeyframes: Keyframe[];
    rotYKeyframes: Keyframe[];
    rotZKeyframes: Keyframe[];
    posXKeyframes: Keyframe[];
    posYKeyframes: Keyframe[];
    posZKeyframes: Keyframe[];
};

// export type BgAnim = {
//     loopPointSeconds: number;
//     posXKeyframes: Keyframe[];
//     posYKeyframes: Keyframe[];
//     posZKeyframes: Keyframe[];
//     rotXKeyframes: Keyframe[];
//     rotYKeyframes: Keyframe[];
//     rotZKeyframes: Keyframe[];
// };

export type BgAnim = {
    loopStartSeconds: number;
    loopEndSeconds: number;

    scaleXKeyframes: Keyframe[];
    scaleYKeyframes: Keyframe[];
    scaleZKeyframes: Keyframe[];

    rotXKeyframes: Keyframe[];
    rotYKeyframes: Keyframe[];
    rotZKeyframes: Keyframe[];

    posXKeyframes: Keyframe[];
    posYKeyframes: Keyframe[];
    posZKeyframes: Keyframe[];

    visibleKeyframes: Keyframe[]; // Model visible if value >= 0.5?
    translucencyKeyframes: Keyframe[]; // 1 - alpha?
};

export const enum BgModelFlags {
    Visible = 1 << 0, // Sometimes other flags used for visibility?
}

export type NightWindowAnim = {
    pos: vec3;
    rot: vec3;
    id: number; // Which list of flipbook models to animate
};

export type StormFireAnim = {
    pos: vec3;
    frameOffset: number;
};

export type FlipbookAnims = {
    nightWindowAnims: NightWindowAnim[];
    stormFireAnims: StormFireAnim[];
};

export type BgObject = {
    flags: BgModelFlags;
    modelName: string;
    pos: vec3;
    rot: vec3;
    scale: vec3;
    translucency: number;
    anim: BgAnim | null;
    flipbookAnims: FlipbookAnims | null;
};

// export type TextureScroll = {
//     speed: vec3;
// }

// export type BgObject = {
//     modelName: string;
//     pos: vec3;
//     rot: vec3;
//     scale: vec3;
//     backgroundAnimHeader: BackgroundAnimHeader;
//     backgroundAnim2Header: BackgroundAnim2Header;
//     // effectHeader: EffectHeader;
// }

// Visual model for the stage itself, parented to anim groups
export type AnimGroupModel = {
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

export type AnimGroup = {
    originPos: vec3;
    originRot: vec3;
    animType: AnimType;
    anim: AnimGroupAnim | null;
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
    animGroupModels: AnimGroupModel[];
};

export type StageModelPtrA = {
    stageModel: StageModel;
};

// export type FgObject = {
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
    loopStartSeconds: number;
    loopEndSeconds: number;
    animGroups: AnimGroup[];
    initBallPose: InitBallPose;
    falloutPlane: FalloutPlane;
    goals: Goal[];
    bumpers: Bumper[];
    jamabars: Jamabar[];
    bananas: Banana[];
    levelModels: AnimGroupModel[];
    bgObjects: BgObject[];
    fgObjects: BgObject[]; // Like bg models but tilt with the stage, equivalent for us
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
    // Transform from triangle space to anim group space
    pos: vec3; // Position of vertex 1
    normal: vec3; // Normal in anim group space
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

const ANIM_GROUP_SIZE = 0xc4;
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
const ANIM_GROUP_MODEL_SIZE = 0xc;
const BG_ANIM_SIZE = 0x60;
const NIGHT_WINDOW_ANIM_SIZE = 0x14;
const STORM_FIRE_ANIM_SIZE = 0x10;

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
        const easeType = view.getInt32(keyframeOffs + 0x0) as EaseType;
        const timeSeconds = view.getFloat32(keyframeOffs + 0x4);
        const value = view.getFloat32(keyframeOffs + 0x8);
        const tangentIn = view.getFloat32(keyframeOffs + 0xc);
        const tangentOut = view.getFloat32(keyframeOffs + 0x10);
        keyframes.push({ easeType, timeSeconds, value, tangentIn, tangentOut });
    }
    return keyframes;
}

function parseAnimGroupAnim(view: DataView, offset: number): AnimGroupAnim | null {
    if (offset === 0) return null;
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

// TODO(complexplane): Parse from uncompressed stagedef to be consistent with GMA/TPLs
export function parseStagedefLz(buffer: ArrayBufferSlice): Stage {
    return parseStagedefUncompressed(decompressLZ(buffer));
}

function parseFlipbookAnims(view: DataView, offset: number): FlipbookAnims | null {
    if (offset === 0) return null;

    const nightWindowAnims: NightWindowAnim[] = [];
    const stormFireAnims: StormFireAnim[] = [];
    const nightWindowAnimCount = view.getInt32(offset + 0x0);
    const nightWindowAnimsOffs = view.getUint32(offset + 0x4);
    const stormFireAnimCount = view.getInt32(offset + 0x8);
    const stormFireAnimsOffs = view.getUint32(offset + 0xc);

    for (let i = 0; i < nightWindowAnimCount; i++) {
        const nightWindowAnimOffs = nightWindowAnimsOffs + i * NIGHT_WINDOW_ANIM_SIZE;
        const pos = parseVec3f(view, nightWindowAnimOffs + 0x0);
        const rot = parseVec3s(view, nightWindowAnimOffs + 0xc);
        const id = view.getInt8(nightWindowAnimOffs + 0x12);
        nightWindowAnims.push({ pos, rot, id });
    }
    for (let i = 0; i < stormFireAnimCount; i++) {
        const stormFireAnimOffs = stormFireAnimsOffs + i * STORM_FIRE_ANIM_SIZE;
        const pos = parseVec3f(view, stormFireAnimOffs + 0x0);
        const frameOffset = view.getInt8(stormFireAnimOffs + 0xc);
        stormFireAnims.push({ pos, frameOffset });
    }

    return { nightWindowAnims, stormFireAnims };
}

function parseBgModelList(buffer: ArrayBufferSlice, offset: number): BgObject[] {
    const view = buffer.createDataView();
    const bgModelCount = view.getUint32(offset);
    const bgModelListOffs = view.getUint32(offset + 0x4);
    const bgObjects: BgObject[] = [];
    for (let i = 0; i < bgModelCount; i++) {
        const bgObjectOffs = bgModelListOffs + i * BG_MODEL_SIZE;
        const flags = view.getUint32(bgObjectOffs + 0x0) as BgModelFlags;
        const modelName = readString(buffer, view.getUint32(bgObjectOffs + 0x4));
        const pos = parseVec3f(view, bgObjectOffs + 0xc);
        const rot = parseVec3s(view, bgObjectOffs + 0x18);
        const scale = parseVec3f(view, bgObjectOffs + 0x20);
        const translucency = view.getFloat32(bgObjectOffs + 0x2c);

        // Background anim
        let anim: BgAnim | null = null;
        const bgAnimOffs = view.getUint32(bgObjectOffs + 0x30);
        if (bgAnimOffs !== 0) {
            anim = {
                loopStartSeconds: view.getInt32(bgAnimOffs + 0x0),
                loopEndSeconds: view.getInt32(bgAnimOffs + 0x4),
                scaleXKeyframes: parseKeyframeList(view, bgAnimOffs + 0x8),
                scaleYKeyframes: parseKeyframeList(view, bgAnimOffs + 0x10),
                scaleZKeyframes: parseKeyframeList(view, bgAnimOffs + 0x18),
                rotXKeyframes: parseKeyframeList(view, bgAnimOffs + 0x20),
                rotYKeyframes: parseKeyframeList(view, bgAnimOffs + 0x28),
                rotZKeyframes: parseKeyframeList(view, bgAnimOffs + 0x30),
                posXKeyframes: parseKeyframeList(view, bgAnimOffs + 0x38),
                posYKeyframes: parseKeyframeList(view, bgAnimOffs + 0x40),
                posZKeyframes: parseKeyframeList(view, bgAnimOffs + 0x48),
                visibleKeyframes: parseKeyframeList(view, bgAnimOffs + 0x50),
                translucencyKeyframes: parseKeyframeList(view, bgAnimOffs + 0x58),
            };
        }

        const flipbookAnimsOffs = view.getUint32(bgObjectOffs + 0x34);
        const flipbookAnims = parseFlipbookAnims(view, flipbookAnimsOffs);

        const bgObject: BgObject = {
            flags,
            modelName,
            pos,
            rot,
            scale,
            anim,
            translucency,
            flipbookAnims,
        };
        bgObjects.push(bgObject);
    }
    return bgObjects;
}

function parseStagedefUncompressed(buffer: ArrayBufferSlice): Stage {
    const view = buffer.createDataView();

    const loopStartSeconds = view.getInt32(0x0);
    const loopEndSeconds = view.getInt32(0x4);

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

    // Anim group models
    const animGroupModelCount = view.getUint32(0x58);
    const animGroupModelListOffs = view.getUint32(0x5c);
    const animGroupModels: AnimGroupModel[] = [];
    for (let i = 0; i < animGroupModelCount; i++) {
        const levelModelOffs = animGroupModelListOffs + i * ANIM_GROUP_MODEL_SIZE;
        const flags = view.getUint32(levelModelOffs + 0x0);
        const modelName = readString(buffer, view.getUint32(levelModelOffs + 0x4));
        animGroupModels.push({ flags, modelName });
    }

    const bgObjects = parseBgModelList(buffer, 0x68);
    const fgObjects = parseBgModelList(buffer, 0x70);

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

    const animGroupCount = view.getUint32(0x8);
    const animGroupListOffs = view.getUint32(0xc);
    const animGroups: AnimGroup[] = [];
    for (let i = 0; i < animGroupCount; i++) {
        const coliHeaderOffs = animGroupListOffs + i * ANIM_GROUP_SIZE;
        const initPos = parseVec3f(view, coliHeaderOffs + 0x0);
        const initRot = parseVec3s(view, coliHeaderOffs + 0xc);
        const animType = view.getUint16(coliHeaderOffs + 0x12) as AnimType;
        const animHeaderOffs = view.getUint32(coliHeaderOffs + 0x14);
        const anim = parseAnimGroupAnim(view, animHeaderOffs);
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
        const subGoals = parseSlicedList(view, coliHeaderOffs + 0x3c, goals, goalListOffs, GOAL_SIZE);
        const subBumpers = parseSlicedList(view, coliHeaderOffs + 0x4c, bumpers, bumperListOffs, BUMPER_SIZE);
        const subJamabars = parseSlicedList(view, coliHeaderOffs + 0x54, jamabars, jamabarListOffs, JAMABAR_SIZE);
        const subBananas = parseSlicedList(view, coliHeaderOffs + 0x5c, bananas, bananaListOffs, BANANA_SIZE);
        const subColiCones = parseSlicedList(view, coliHeaderOffs + 0x64, coliCones, coliConeListOffs, COLI_CONE_SIZE);
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
        const subAnimGroupModels = parseSlicedList(
            view,
            coliHeaderOffs + 0x7c,
            animGroupModels,
            animGroupModelListOffs,
            ANIM_GROUP_MODEL_SIZE
        );
        // const subFalloutVolumes = parseSlicedList(view, coliHeaderOffs + 0x7C, falloutVolumes, falloutVolumeListOffs, FALLOUT_VOLUME_SIZE);
        // TODO reflective stage models, stage model instances, model A/B ptr

        // const loopPointSeconds = view.getFloat32(coliHeaderOffs + 0xD4);
        // const textureScrollOffs = view.getUint32(coliHeaderOffs + 0xD8);
        // const textureScroll: TextureScroll = { speed: parseVec3f(view, textureScrollOffs) };

        animGroups.push({
            originPos: initPos,
            originRot: initRot,
            animType: animType,
            anim: anim,
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
            animGroupModels: subAnimGroupModels,
            // reflectiveStageModels: [],
            // stageModelInstances: [],
            // stageModelPtrB: [],

            // textureScroll: textureScroll,
        });
    }

    return {
        loopStartSeconds,
        loopEndSeconds,
        animGroups: animGroups,
        initBallPose,
        falloutPlane,
        goals,
        bumpers,
        jamabars,
        bananas,
        levelModels: animGroupModels,
        bgObjects,
        fgObjects,
        // reflectiveModels: [],
    };
}
