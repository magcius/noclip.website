import { vec2, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';
import * as SD from './stagedef';
import * as GX from '../gx/gx_enum';
import * as LZSS from '../Common/Compression/LZSS'

const COLI_HEADER_SIZE = 0x49C
const GOAL_SIZE = 0x14;
const BUMPER_SIZE = 0x20;
const JAMABAR_SIZE = 0x20;
const BANANA_SIZE = 0x10;
const COLI_CONE_SIZE = 0x20;
const COLI_SPHERE_SIZE = 0x14;
const COLI_CYLINDER_SIZE = 0x1C;
const FALLOUT_VOLUME_SIZE = 0x20;
const BACKGROUND_MODEL_SIZE = 0x38;
const ANIM_KEYFRAME_SIZE = 0x14;
const WORMHOLE_SIZE = 0x1C;
const BUTTON_SIZE = 0x18;
const COLI_TRI_SIZE = 0x40;

function parseVec3f(view: DataView, offset: number): vec3 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    const z = view.getFloat32(offset + 0x8);
    return vec3.fromValues(x, y, z)
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

function parseAnimKeyframeList(view: DataView, offset: number): SD.AnimKeyframe[] {
    const keyframes: SD.AnimKeyframe[] = [];
    const keyframeCount = view.getUint32(offset);
    const keyframeListOffs = view.getUint32(offset + 0x4);
    for (let i = 0; i < keyframeCount; i++) {
        const keyframeOffs = keyframeListOffs + i * ANIM_KEYFRAME_SIZE;
        const easing = view.getUint32(keyframeOffs + 0x0) as SD.Easing;
        const time = view.getFloat32(keyframeOffs + 0x4);
        const value = view.getFloat32(keyframeOffs + 0x8);
        keyframes.push({ easing, time, value });
    }
    return keyframes;
}

function parseAnimHeader(view: DataView, offset: number): SD.AnimHeader {
    const rotXKeyframes = parseAnimKeyframeList(view, offset + 0x0);
    const rotYKeyframes = parseAnimKeyframeList(view, offset + 0x8);
    const rotZKeyframes = parseAnimKeyframeList(view, offset + 0x10);
    const posXKeyframes = parseAnimKeyframeList(view, offset + 0x18);
    const posYKeyframes = parseAnimKeyframeList(view, offset + 0x20);
    const posZKeyframes = parseAnimKeyframeList(view, offset + 0x28);
    return {
        rotXKeyframes,
        rotYKeyframes,
        rotZKeyframes,
        posXKeyframes,
        posYKeyframes,
        posZKeyframes,
    };
}

function parseSlicedList<T>(view: DataView, offset: number, origList: T[], origListOffs: number, elemSize: number): T[] {
    const count = view.getUint32(offset);
    const listOffs = view.getUint32(offset + 0x4);
    const idx = (listOffs - origListOffs) / elemSize;
    return origList.slice(idx, idx + count);
}

export function parseStagedefLz(buffer: ArrayBufferSlice): SD.FileHeader {
    const view = buffer.createDataView();
    const compressedView = buffer.subarray(0x8).createDataView()
    const uncompressedSize = view.getUint32(0x4, true);
    const uncompressedBuffer = LZSS.decompress(compressedView, uncompressedSize);
    return parseStagedefUncompressed(uncompressedBuffer);
}

function parseStagedefUncompressed(buffer: ArrayBufferSlice): SD.FileHeader {
    const view = buffer.createDataView();

    const magicNumberA = view.getUint32(0x0);
    const magicNumberB = view.getUint32(0x4);

    // Start aka ball spawn
    const startOffs = view.getUint32(0x10);
    const startPos = parseVec3f(view, startOffs + 0x0);
    const startRot = parseVec3s(view, startOffs + 0xC);
    const start: SD.Start = { pos: startPos, rot: startRot };

    // Fallout plane
    const falloutPlaneOffs = view.getUint32(0x14);
    const falloutPlane: SD.FalloutPlane = { y: view.getFloat32(falloutPlaneOffs) };

    // Goals
    const goalCount = view.getUint32(0x18);
    const goalListOffs = view.getUint32(0x1C);
    const goals: SD.Goal[] = [];
    for (let i = 0; i < goalCount; i++) {
        const goalOffs = goalListOffs + i * GOAL_SIZE;
        const pos = parseVec3f(view, goalOffs + 0x0);
        const rot = parseVec3s(view, goalOffs + 0xc);
        const type = view.getUint16(goalOffs + 0x12) as SD.GoalType;
        goals.push({ pos, rot, type });
    }

    // Bumpers
    const bumperCount = view.getUint32(0x20);
    const bumperListOffs = view.getUint32(0x24);
    const bumpers: SD.Bumper[] = [];
    for (let i = 0; i < bumperCount; i++) {
        const bumperOffs = bumperListOffs + i * BUMPER_SIZE;
        const pos = parseVec3f(view, bumperOffs + 0x0);
        const rot = parseVec3s(view, bumperOffs + 0xc);
        const scale = parseVec3f(view, bumperOffs + 0x14);
        bumpers.push({ pos, rot, scale });
    }

    // Jamabars
    const jamabarCount = view.getUint32(0x28);
    const jamabarListOffs = view.getUint32(0x2C);
    const jamabars: SD.Jamabar[] = [];
    for (let i = 0; i < jamabarCount; i++) {
        const jamabarOffs = jamabarListOffs + i * JAMABAR_SIZE;
        const pos = parseVec3f(view, jamabarOffs + 0x0);
        const rot = parseVec3s(view, jamabarOffs + 0xc);
        const scale = parseVec3f(view, jamabarOffs + 0x14);
        jamabars.push({ pos, rot, scale });
    }

    // Bananas
    const bananaCount = view.getUint32(0x30);
    const bananaListOffs = view.getUint32(0x34);
    const bananas: SD.Banana[] = [];
    for (let i = 0; i < bananaCount; i++) {
        const bananaOffs = bananaListOffs + i * BANANA_SIZE;
        const pos = parseVec3f(view, bananaOffs + 0x0);
        const type = view.getUint32(bananaOffs + 0xC) as SD.BananaType;
        bananas.push({ pos, type });
    }

    // Collision cones
    const coliConeCount = view.getUint32(0x38);
    const coliConeListOffs = view.getUint32(0x3C);
    const coliCones: SD.ColiCone[] = [];
    for (let i = 0; i < coliConeCount; i++) {
        const coliConeOffs = coliConeListOffs + i * COLI_CONE_SIZE;
        const pos = parseVec3f(view, coliConeOffs + 0x0);
        const rot = parseVec3s(view, coliConeOffs + 0xC);
        const scale = parseVec3f(view, coliConeOffs + 0x14);
        coliCones.push({ pos, rot, scale });
    }

    // Collision spheres
    const coliSphereCount = view.getUint32(0x40);
    const coliSphereListOffs = view.getUint32(0x44);
    const coliSpheres: SD.ColiSphere[] = [];
    for (let i = 0; i < coliSphereCount; i++) {
        const coliSphereOffs = coliSphereListOffs + i * COLI_SPHERE_SIZE;
        const pos = parseVec3f(view, coliSphereOffs + 0x0);
        const radius = view.getFloat32(coliSphereOffs + 0xC);
        coliSpheres.push({ pos, radius });
    }

    // Collision cylinders
    const coliCylinderCount = view.getUint32(0x48);
    const coliCylinderListOffs = view.getUint32(0x4C);
    const coliCylinders: SD.ColiCylinder[] = [];
    for (let i = 0; i < coliCylinderCount; i++) {
        const coliCylinderOffs = coliCylinderListOffs + i * COLI_CYLINDER_SIZE;
        const pos = parseVec3f(view, coliCylinderOffs + 0x0);
        const radius = view.getFloat32(coliCylinderOffs + 0xC);
        const height = view.getFloat32(coliCylinderOffs + 0x10);
        const rot = parseVec3s(view, coliCylinderOffs + 0x14);
        coliCylinders.push({ pos, radius, height, rot });
    }

    // Fallout volumes
    const falloutVolumeCount = view.getUint32(0x50);
    const falloutVolumeListOffs = view.getUint32(0x54);
    const falloutVolumes: SD.FalloutVolume[] = [];
    for (let i = 0; i < falloutVolumeCount; i++) {
        const falloutVolumeOffs = falloutVolumeListOffs + i * FALLOUT_VOLUME_SIZE;
        const pos = parseVec3f(view, falloutVolumeOffs + 0x0);
        const size = parseVec3f(view, falloutVolumeOffs + 0xC);
        const rot = parseVec3s(view, falloutVolumeOffs + 0x18);
        falloutVolumes.push({ pos, size, rot });
    }

    // Background models
    const backgroundModelCount = view.getUint32(0x58);
    const backgroundModelListOffs = view.getUint32(0x5C);
    const backgroundModels: SD.BackgroundModel[] = [];
    for (let i = 0; i < backgroundModelCount; i++) {
        const backgroundModelOffs = backgroundModelListOffs + i * BACKGROUND_MODEL_SIZE;
        const modelName = readString(buffer, view.getUint32(backgroundModelOffs + 0x4));
        const pos = parseVec3f(view, backgroundModelOffs + 0xC);
        const rot = parseVec3s(view, backgroundModelOffs + 0x18);
        const scale = parseVec3s(view, backgroundModelOffs + 0x20);

        // Background anim header
        const backgroundAnimHeaderOffs = view.getUint32(backgroundModelOffs + 0x2C);
        const bgLoopPointSeconds = view.getFloat32(backgroundAnimHeaderOffs + 0x4);
        const bgRotXKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x10);
        const bgRotYKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x18);
        const bgRotZKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x20);
        const bgPosXKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x28);
        const bgPosYKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x30);
        const bgPosZKeyframes = parseAnimKeyframeList(view, backgroundAnimHeaderOffs + 0x38);
        const backgroundAnimHeader: SD.BackgroundAnimHeader = {
            loopPointSeconds: bgLoopPointSeconds,
            rotXKeyframes: bgRotXKeyframes,
            rotYKeyframes: bgRotYKeyframes,
            rotZKeyframes: bgRotZKeyframes,
            posXKeyframes: bgPosXKeyframes,
            posYKeyframes: bgPosYKeyframes,
            posZKeyframes: bgPosZKeyframes,
        };

        // Background anim 2 header
        const backgroundAnim2HeaderOffs = view.getUint32(backgroundModelOffs + 0x30);
        const bg2LoopPointSeconds = view.getFloat32(backgroundAnim2HeaderOffs + 0x4);
        const bg2Unk1Keyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x8);
        const bg2Unk2Keyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x10);
        const bg2RotXKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x18);
        const bg2RotYKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x20);
        const bg2RotZKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x28);
        const bg2PosXKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x30);
        const bg2PosYKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x38);
        const bg2PosZKeyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x40);
        const bg2Unk9Keyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x48);
        const bg2Unk10Keyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x50);
        const bg2Unk11Keyframes = parseAnimKeyframeList(view, backgroundAnim2HeaderOffs + 0x58);
        const backgroundAnim2Header: SD.BackgroundAnim2Header = {
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
        const effectHeaderOffs = view.getUint32(backgroundModelOffs + 0x34);
        // TODO fx1 and fx2 keyfranmes
        const effectTextureScrollOffs = view.getUint32(effectHeaderOffs + 0x10);
        const effectTextureScroll: SD.TextureScroll = { speed: parseVec3f(view, effectTextureScrollOffs + 0x0) };
        const effectHeader: SD.EffectHeader = { fx1Keyframes: [], fx2Keyframes: [], textureScroll: effectTextureScroll };

        const backgroundModel: SD.BackgroundModel = {
            modelName,
            pos,
            rot,
            scale,
            backgroundAnimHeader,
            backgroundAnim2Header,
            effectHeader,
        };
        backgroundModels.push(backgroundModel);
    }

    // Foreground models
    const foregroundModelCount = view.getUint32(0x60);
    const foregroundModelListOffs = view.getUint32(0x64);
    const foregroundModels: SD.ForegroundModel[] = [];
    // TODO actually parse 'em

    // Reflective stage models
    const reflectiveStageModelCount = view.getUint32(0x70);
    const reflectiveStageModelListOffs = view.getUint32(0x74);
    const reflectiveStageModels: SD.ReflectiveStageModel[] = [];
    // TODO actually parse 'em

    // TODO Stage model instances
    const stageModelInstances: SD.StageModelInstance[] = [];

    // TODO Stage model ptr As
    const stageModelPtrAs: SD.StageModelPtrA[] = [];

    // TODO Stage model ptr Bs
    const stageModelPtrBs: SD.StageModelPtrB[] = [];

    // Buttons
    const buttonCount = view.getUint32(0xA8);
    const buttonListOffs = view.getUint32(0xAC);
    const buttons: SD.Button[] = [];
    for (let i = 0; i < buttonCount; i++) {
        const buttonOffs = buttonListOffs + i * BUTTON_SIZE;
        const pos = parseVec3f(view, buttonOffs + 0x0);
        const rot = parseVec3s(view, buttonOffs + 0xC);
        const playbackState = view.getUint16(buttonOffs + 0x12) as SD.PlaybackState;
        const animGroupId = view.getUint16(buttonOffs + 0x14);
        buttons.push({ pos, rot, playbackState, animGroupId });
    }

    // Fog animation headers
    const fogAnimHeaderOffs = view.getUint32(0xB0);
    const fogStartDistanceKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x0);
    const fogEndDistanceKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x8);
    const fogRedKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x10);
    const fogGreenKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x18);
    const fogBlueKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x20);
    const fogUnkKeyframes = parseAnimKeyframeList(view, fogAnimHeaderOffs + 0x28);
    const fogAnimHeader: SD.FogAnimHeader = {
        startDistanceKeyframes: fogStartDistanceKeyframes,
        endDistanceKeyframes: fogEndDistanceKeyframes,
        redKeyframes: fogRedKeyframes,
        greenKeyframes: fogGreenKeyframes,
        blueKeyframes: fogBlueKeyframes,
        unkKeyframes: fogUnkKeyframes,
    };

    // Wormholes
    const wormholeCount = view.getUint32(0xB4);
    const wormholeListOffs = view.getUint32(0xB8);
    const wormholes: SD.Wormhole[] = [];
    const wormholeDestOffsets: number[] = [];
    for (let i = 0; i < wormholeCount; i++) {
        const wormholeOffs = wormholeListOffs + i * WORMHOLE_SIZE;
        const pos = parseVec3f(view, wormholeOffs + 0x4);
        const rot = parseVec3s(view, wormholeOffs + 0x10);
        // Record destination wormhole offsets, then add a reference after all wormholes are parsed.
        // For now, just link the wormhole to an empty object
        wormholeDestOffsets.push(view.getUint32(wormholeOffs + 0x18));
        const wormhole: SD.Wormhole = { pos: pos, rot: rot, destination: {} as SD.Wormhole };
    }
    // Fix wormhole destinations
    for (let i = 0; i < wormholeCount; i++) {
        const wormhole = wormholes[i];
        const destIdx = (wormholeDestOffsets[i] - wormholeListOffs) / WORMHOLE_SIZE;
        wormhole.destination = wormholes[destIdx];
    }

    // Fog
    const fogOffs = view.getUint32(0xBC);
    const fogType = view.getUint8(fogOffs + 0x0) as GX.FogType;
    const fogStartDistance = view.getFloat32(fogOffs + 0x4);
    const fogEndDistance = view.getFloat32(fogOffs + 0x8);
    const fogColor = parseVec3f(view, fogOffs + 0xc);
    const fog: SD.Fog = {
        type: fogType,
        startDistance: fogStartDistance,
        endDistance: fogEndDistance,
        color: fogColor,
    };

    const coliHeaderCount = view.getUint32(0x8);
    const coliHeaderListOffs = view.getUint32(0xC);
    const coliHeaders: SD.ColiHeader[] = [];
    for (let i = 0; i < coliHeaderCount; i++) {
        const coliHeaderOffs = coliHeaderListOffs + i * COLI_HEADER_SIZE;
        const origin = parseVec3f(view, coliHeaderOffs + 0x0);
        const initialRot = parseVec3s(view, coliHeaderOffs + 0xC);
        const animType = view.getUint16(coliHeaderOffs + 0x12) as SD.AnimType;
        const animHeaderOffs = view.getUint32(coliHeaderOffs + 0x14);
        const animHeader = parseAnimHeader(view, animHeaderOffs);
        const conveyorVel = parseVec3f(view, coliHeaderOffs + 0x18);

        // Parse coli grid tri indices first so we know how many tris we need to parse,
        // as the tri list does not indicate its length
        const coliTriListOffs = view.getUint32(coliHeaderOffs + 0x24);
        const coliTriIdxsOffs = view.getUint32(coliHeaderOffs + 0x28);
        const coliGridStartX = view.getFloat32(coliHeaderOffs + 0x2C);
        const coliGridStartZ = view.getFloat32(coliHeaderOffs + 0x30);
        const coliGridStepX = view.getFloat32(coliHeaderOffs + 0x34);
        const coliGridStepZ = view.getFloat32(coliHeaderOffs + 0x38);
        const coliGridCellsX = view.getUint32(coliHeaderOffs + 0x3C);
        const coliGridCellsZ = view.getUint32(coliHeaderOffs + 0x40);

        const coliTriIdxs: number[][] = [];

        for (let z = 0; z < coliGridCellsZ; z++) {
            for (let x = 0; x < coliGridCellsX; x++) {
                const gridIdx = z * coliGridCellsX + x;
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
                coliTriIdxs.push(triIdxList);
            }
        }

        let maxTriIdx = -1;
        for (let idxList of coliTriIdxs) {
            maxTriIdx = Math.max(maxTriIdx, Math.max(...idxList));
        }
        const numTris = maxTriIdx + 1;

        const coliTris: SD.ColiTri[] = [];

        // Parse collision tris
        for (let i = 0; i < numTris; i++) {
            const triOffs = coliTriListOffs + i * COLI_TRI_SIZE;
            const point1Pos = parseVec3f(view, triOffs + 0x0);
            const normal = parseVec3f(view, triOffs + 0xC);
            // TODO is this really from XY, or is it XZ?
            const rotFromXY = parseVec3s(view, triOffs + 0x18);
            const point2Point1Delta = parseVec2f(view, triOffs + 0x20);
            const point3Point1Delta = parseVec2f(view, triOffs + 0x28);
            const tangent = parseVec2f(view, triOffs + 0x30);
            const bitangent = parseVec2f(view, triOffs + 0x38);
            coliTris.push({
                point1Pos,
                normal,
                rotFromXY,
                point2Point1Delta,
                point3Point1Delta,
                tangent,
                bitangent,
            });
        }

        // "sub" means a subset of the entire stage's lists
        const subGoals = parseSlicedList(view, coliHeaderOffs + 0x44, goals, goalListOffs, GOAL_SIZE);
        const subBumpers = parseSlicedList(view, coliHeaderOffs + 0x4C, bumpers, bumperListOffs, BUMPER_SIZE);
        const subJamabars = parseSlicedList(view, coliHeaderOffs + 0x54, jamabars, jamabarListOffs, JAMABAR_SIZE);
        const subBananas = parseSlicedList(view, coliHeaderOffs + 0x5C, bananas, bananaListOffs, BANANA_SIZE);
        const subColiCones = parseSlicedList(view, coliHeaderOffs + 0x64, coliCones, coliConeListOffs, COLI_CONE_SIZE);
        const subColiSpheres = parseSlicedList(view, coliHeaderOffs + 0x6C, coliSpheres, coliSphereListOffs, COLI_SPHERE_SIZE);
        const subColiCylinders = parseSlicedList(view, coliHeaderOffs + 0x74, coliCylinders, coliCylinderListOffs, COLI_CYLINDER_SIZE);
        const subFalloutVolumes = parseSlicedList(view, coliHeaderOffs + 0x7C, falloutVolumes, falloutVolumeListOffs, FALLOUT_VOLUME_SIZE);
        // TODO reflective stage models, stage model instances, model A/B ptr

        const animGroupId = view.getUint16(coliHeaderOffs + 0xA4);

        const subButtons = parseSlicedList(view, coliHeaderOffs + 0xA8, buttons, buttonListOffs, BUTTON_SIZE);

        const seesawSensitivity = view.getFloat32(coliHeaderOffs + 0xB8);
        const seesawFriction = view.getFloat32(coliHeaderOffs + 0xBC);
        const seesawSpring = view.getFloat32(coliHeaderOffs + 0xC0);

        const subWormholes = parseSlicedList(view, coliHeaderOffs + 0xC4, wormholes, wormholeListOffs, WORMHOLE_SIZE);

        const initialPlaybackState = view.getUint32(coliHeaderOffs + 0xCC) as SD.PlaybackState;
        const loopPointSeconds = view.getFloat32(coliHeaderOffs + 0xD4);
        const textureScrollOffs = view.getUint32(coliHeaderOffs + 0xD8);
        const textureScroll: SD.TextureScroll = { speed: parseVec3f(view, textureScrollOffs) };

        coliHeaders.push({
            origin: origin,
            initialRot: initialRot,
            animType: animType,
            animHeader: animHeader,
            conveyorVel: conveyorVel,

            coliTris: coliTris,
            coliTriIdxs: coliTriIdxs,
            coliGridStartX: coliGridStartX,
            coliGridStartZ: coliGridStartZ,
            coliGridStepX: coliGridStepX,
            coliGridStepZ: coliGridStepZ,
            coliGridCellsX: coliGridCellsX,
            coliGridCellsZ: coliGridCellsZ,

            goals: subGoals,
            bumpers: subBumpers,
            jamabars: subJamabars,
            bananas: subBananas,
            coliCones: subColiCones,
            coliSpheres: subColiSpheres,
            coliCylinders: subColiCylinders,
            falloutVolumes: subFalloutVolumes,
            reflectiveStageModels: [],
            stageModelInstances: [],
            stageModelPtrB: [],
            animGroupId: animGroupId,

            buttons: subButtons,
            seesawSensitivity: seesawSensitivity,
            seesawFriction: seesawFriction,
            seesawSpring: seesawSpring,
            wormholes: subWormholes,
            initialPlaybackState: initialPlaybackState,
            loopPointSeconds: loopPointSeconds,
            textureScroll: textureScroll,
        });
    }

    return {
        magicNumberA,
        magicNumberB,
        coliHeaders,
        start,
        falloutPlane,
        goals,
        bumpers,
        jamabars,
        bananas,
        coliCones,
        coliSpheres,
        coliCylinders,
        falloutVolumes,
        backgroundModels,
        foregroundModels,
        reflectiveStageModels,
        stageModelInstances,
        stageModelPtrAs,
        stageModelPtrBs,
        buttons,
        fogAnimHeader,
        wormholes,
        fog,
    };
}