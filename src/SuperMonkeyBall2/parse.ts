import { vec2, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';
import * as Stagedef from './stagedef';
import * as GX from '../gx/gx_enum';

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

function parseVec3f(view: DataView, offset: number): vec3 {
    const x = view.getFloat32(offset);
    const y = view.getFloat32(offset + 0x4);
    const z = view.getFloat32(offset + 0x8);
    return vec3.fromValues(x, y, z)
}

function parseVec3s(view: DataView, offset: number): vec3 {
    const x = view.getInt16(offset);
    const y = view.getInt16(offset + 0x2);
    const z = view.getInt16(offset + 0x4);
    return vec3.fromValues(x, y, z);
}

function parseAnimKeyframeList(view: DataView, offset: number): Stagedef.AnimKeyframe[] {
    const keyframes: Stagedef.AnimKeyframe[] = [];
    const keyframeCount = view.getUint32(offset);
    const keyframeListOffs = view.getUint32(offset + 0x4);
    for (let i = 0; i < keyframeCount; i++) {
        const keyframeOffs = keyframeListOffs + i * ANIM_KEYFRAME_SIZE;
        const easing = view.getUint32(keyframeOffs + 0x0) as Stagedef.Easing;
        const time = view.getFloat32(keyframeOffs + 0x4);
        const value = view.getFloat32(keyframeOffs + 0x8);
        keyframes.push({ easing, time, value });
    }
    return keyframes;
}

export function parseStagedefLz(buffer: ArrayBufferSlice): Stagedef.FileHeader {
    const view = buffer.createDataView();

    const magicNumberA = view.getUint32(0x0);
    const magicNumberB = view.getUint32(0x4);

    // Start aka ball spawn
    const startOffs = view.getUint32(0x10);
    const startPos = parseVec3f(view, startOffs + 0x0);
    const startRot = parseVec3s(view, startOffs + 0xC);
    const start: Stagedef.Start = { pos: startPos, rot: startRot };

    // Fallout plane
    const falloutPlaneOffs = view.getUint32(0x14);
    const falloutPlane: Stagedef.FalloutPlane = { y: view.getFloat32(falloutPlaneOffs) };

    // Goals
    const goalCount = view.getUint32(0x18);
    const goalListOffs = view.getUint32(0x1C);
    const goals: Stagedef.Goal[] = [];
    for (let i = 0; i < goalCount; i++) {
        const goalOffs = goalListOffs + i * GOAL_SIZE;
        const pos = parseVec3f(view, goalOffs + 0x0);
        const rot = parseVec3s(view, goalOffs + 0xc);
        const type = view.getUint16(goalOffs + 0x12) as Stagedef.GoalType;
        goals.push({ pos, rot, type });
    }

    // Bumpers
    const bumperCount = view.getUint32(0x20);
    const bumperListOffs = view.getUint32(0x24);
    const bumpers: Stagedef.Bumper[] = [];
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
    const jamabars: Stagedef.Jamabar[] = [];
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
    const bananas: Stagedef.Banana[] = [];
    for (let i = 0; i < bananaCount; i++) {
        const bananaOffs = bananaListOffs + i * BANANA_SIZE;
        const pos = parseVec3f(view, bananaOffs + 0x0);
        const type = view.getUint32(bananaOffs + 0xC) as Stagedef.BananaType;
        bananas.push({ pos, type });
    }

    // Collision cones
    const coliConeCount = view.getUint32(0x38);
    const coliConeListOffs = view.getUint32(0x3C);
    const coliCones: Stagedef.ColiCone[] = [];
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
    const coliSpheres: Stagedef.ColiSphere[] = [];
    for (let i = 0; i < coliSphereCount; i++) {
        const coliSphereOffs = coliSphereListOffs + i * COLI_SPHERE_SIZE;
        const pos = parseVec3f(view, coliSphereOffs + 0x0);
        const radius = view.getFloat32(coliSphereOffs + 0xC);
        coliSpheres.push({ pos, radius });
    }

    // Collision cylinders
    const coliCylinderCount = view.getUint32(0x48);
    const coliCylinderListOffs = view.getUint32(0x4C);
    const coliCylinders: Stagedef.ColiCylinder[] = [];
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
    const falloutVolumes: Stagedef.FalloutVolume[] = [];
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
    const backgroundModels: Stagedef.BackgroundModel[] = [];
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
        const backgroundAnimHeader: Stagedef.BackgroundAnimHeader = {
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
        const backgroundAnim2Header: Stagedef.BackgroundAnim2Header = {
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
        const effectTextureScroll: Stagedef.TextureScroll = { speed: parseVec3f(view, effectTextureScrollOffs + 0x0) };
        const effectHeader: Stagedef.EffectHeader = { fx1Keyframes: [], fx2Keyframes: [], textureScroll: effectTextureScroll };

        const backgroundModel: Stagedef.BackgroundModel = {
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
    const foregroundModels: Stagedef.ForegroundModel[] = [];
    // TODO actually parse 'em

    // Reflective stage models
    const reflectiveStageModelCount = view.getUint32(0x70);
    const reflectiveStageModelListOffs = view.getUint32(0x74);
    const reflectiveStageModels: Stagedef.ReflectiveStageModel[] = [];
    // TODO actually parse 'em

    // TODO Stage model instances
    const stageModelInstances: Stagedef.StageModelInstance[] = [];

    // TODO Stage model ptr As
    const stageModelPtrAs: Stagedef.StageModelPtrA[] = [];

    // TODO Stage model ptr Bs
    const stageModelPtrBs: Stagedef.StageModelPtrB[] = [];

    // Buttons
    const buttonCount = view.getUint32(0xA8);
    const buttonListOffs = view.getUint32(0xAC);
    const buttons: Stagedef.Button[] = [];
    for (let i = 0; i < buttonCount; i++) {
        const buttonOffs = buttonListOffs + i * BUTTON_SIZE;
        const pos = parseVec3f(view, buttonOffs + 0x0);
        const rot = parseVec3s(view, buttonOffs + 0xC);
        const playbackState = view.getUint16(buttonOffs + 0x12);
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
    const fogAnimHeader: Stagedef.FogAnimHeader = {
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
    const wormholes: Stagedef.Wormhole[] = [];
    const wormholeDestOffsets: number[] = [];
    for (let i = 0; i < wormholeCount; i++) {
        const wormholeOffs = wormholeListOffs + i * WORMHOLE_SIZE;
        const pos = parseVec3f(view, wormholeOffs + 0x4);
        const rot = parseVec3s(view, wormholeOffs + 0x10);
        // Record destination wormhole offsets, then add a reference after all wormholes are parsed.
        // For now, just link the wormhole to an empty object
        wormholeDestOffsets.push(view.getUint32(wormholeOffs + 0x18));
        const wormhole: Stagedef.Wormhole = { pos: pos, rot: rot, destination: {} as Stagedef.Wormhole };
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
    const fog: Stagedef.Fog = {
        type: fogType,
        startDistance: fogStartDistance,
        endDistance: fogEndDistance,
        color: fogColor,
    };

    const coliHeaderCount = view.getUint32(0x8);
    const coliHeaderListOffs = view.getUint32(0xC);
    const coliHeaders: Stagedef.ColiHeader[] = [];
    for (let i = 0; i < coliHeaderCount; i++) {
        const coliHeaderOffs = coliHeaderListOffs + i * COLI_HEADER_SIZE;
        const coliHeader = parseColiHeader(view, coliHeaderOffs);
        coliHeaders.push(coliHeader);
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