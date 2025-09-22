import { vec3, vec2 } from 'gl-matrix';
import { Light1 } from './f3dex.js';

//TODO (M-1): Move all this into course segments
export interface CourseInfo {
    courseOpa?: number;
    courseXlu?: number;
    itemBoxes: number;
    piranhaPlants?: number;
    cows?: number;
    foliage?: number;
    fallingRocks?: number
    palmTrees?: number;
    dkJungleTrees?: number;
    trackPath?: number;
    clouds?: Mk64Cloud[];
    cloudTex?: number;
}

export interface Mk64Cloud {
    rotY: number;
    posY: number;
    scalePercent: number;
    subType: number;
}

export interface SkyColor {
    top: number;
    bottom: number;
}

export interface Mk64AnimTrack {
    x: number[];
    y: number[];
    z: number[];
}

export interface Mk64Anim {
    duration: number
    translationTrack: Mk64AnimTrack;
    rotationTracks: Mk64AnimTrack[];
}

export interface Mk64Point {
    pos: vec3;
    param: number;
}

export interface Mk64ActorSpawnData {
    pos: vec3;
    params: number;
    posY: number;
}

// ===============================
// Luigi Raceway Data
// ===============================

const dLuigiRacewayClouds: Mk64Cloud[] = [
    { rotY: 0x04fa, posY: -10, scalePercent: 0x0096, subType: 0x0000 },
    { rotY: 0x4718, posY: 60, scalePercent: 0x007d, subType: 0x0000 },
    { rotY: 0x5550, posY: 70, scalePercent: 0x0096, subType: 0x0000 },
    { rotY: 0x954c, posY: 45, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0xae2e, posY: 40, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0x0e38, posY: 30, scalePercent: 0x0032, subType: 0x0001 },
    { rotY: 0xa384, posY: 50, scalePercent: 0x0064, subType: 0x0001 },
    { rotY: 0xd548, posY: 30, scalePercent: 0x0032, subType: 0x0001 },
    { rotY: 0x31c4, posY: 50, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0xaaa0, posY: 75, scalePercent: 0x0096, subType: 0x0002 },
    { rotY: 0xb8d8, posY: -7, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0xee2a, posY: 60, scalePercent: 0x0050, subType: 0x0002 },
];

// ===============================
// Bowser's Castle Data
// ===============================

//(M-1): I'm not good with names....
export enum ThwompType {
    Crusher = 1,
    Patrol,
    Chaser,
    Guard,
    Slider,
    Caged
}

export interface ThwompSpawn {
    x: number;
    z: number;
    type: number;
    groupIndex: number;
}

export const dThwompLights: Light1[] = [
    Light1.InitLight(255, 255, 255, 85, 85, 85, 0, -120, 0),
    Light1.InitLight(255, 255, 0, 85, 85, 0, 0, 120, 0),
    Light1.InitLight(255, 255, 255, 85, 85, 85, -66, 82, -55),
]

export const dDustAngleOffsets = [0, 0, 0x4000, 0x8000, 0x8000, 0xC000];

export const dDustPosOffsets: vec2[] = [
    [-8.0, 8.0], [8.0, 8.0],
    [0.0, 0.0], [8.0, -8.0],
    [-8.0, -8.0], [-0.0, 0.0],
];

//D_800E5740
export const dFlamePillarSpawnsA: vec3[] = [
    [1634, 20, -1198], [1755, 20, -1193], [1661, 20, -1146],
    [1762, 20, -1281], [1741, 20, -1133], [1787, 20, -1205],
    [1661, 20, -1250], [1583, 20, -1223], [1622, 20, -1280],
    [1781, 20, -1325], [1611, 20, -1166], [1790, 20, -1155],
    [1813, 20, -1253], [1647, 20, -1337], [1634, 20, -1198],
];

//D_800E579C
export const dFlamePillarSpawnsB: vec3[] = [
    [-106, -50, -822], [-89, -50, -739], [-146, -50, -677],
    [-106, -50, -923], [-181, -50, -805], [-167, -50, -897],
    [101, -50, -905], [171, -50, -809], [96, -50, -835],
    [100, -50, -765], [109, -50, -686], [184, -50, -717],
    [171, -50, -923], [-106, -50, -822], [-89, -50, -739],
];

//D_800E57F8
export const dFlamePillarSpawnsC: vec3[] = [
    [1768, -50, 35], [2019, -49, -44], [2125, -50, 110],
    [2019, -51, 224], [1592, -54, 686], [1539, -50, 175],
    [503, -52, 456], [614, -52, 377], [1806, -48, -146],
    [1806, -49, -45], [1806, -50, 135], [2026, -48, -150],
    [2026, -50, 60], [2092, -49, -71], [575, -54, 699],
];

export const dFireBreathsSpawns: vec3[] = [
    [2185, 117, -1782], [2185, 117, -1584],
    [1985, 117, -1782], [1985, 117, -1584]
];

export const dThwompSpawns150CC: ThwompSpawn[] = [
    { x: 800, z: -1750, type: ThwompType.Crusher, groupIndex: 0 },
    { x: 1100, z: -1750, type: ThwompType.Crusher, groupIndex: 1 },
    { x: 700, z: -1700, type: ThwompType.Patrol, groupIndex: 0 },
    { x: 1200, z: -1800, type: ThwompType.Patrol, groupIndex: 1 },
    { x: 1200, z: -2630, type: ThwompType.Chaser, groupIndex: 0 },
    { x: 1200, z: -2670, type: ThwompType.Chaser, groupIndex: 1 },
    { x: 2330, z: -2615, type: ThwompType.Guard, groupIndex: 0 },
    { x: 2330, z: -2645, type: ThwompType.Guard, groupIndex: 1 },
    { x: 2330, z: -2675, type: ThwompType.Guard, groupIndex: 2 },
    { x: 1430, z: -1745, type: ThwompType.Caged, groupIndex: 0 },
    { x: 2090, z: -1550, type: ThwompType.Slider, groupIndex: 0 },
    { x: 1850, z: -1550, type: ThwompType.Slider, groupIndex: 1 },
];

// ===============================
// Frappe Snowland
// ===============================

export const dSnowmanSpawns: Mk64Point[] = [
    { pos: [0x02b9, 0x0000, -0x0694], param: 0x03 }, { pos: [0x0052, 0x0000, -0x08c5], param: 0x05 },
    { pos: [0x001b, 0x0005, -0x0813], param: 0x05 }, { pos: [-0x0290, 0x0000, -0x06c7], param: 0x05 },
    { pos: [-0x05d9, 0x0000, -0x0053], param: 0x08 }, { pos: [-0x066b, 0x0000, -0x0019], param: 0x08 },
    { pos: [-0x060b, 0x0000, -0x0014], param: 0x08 }, { pos: [-0x05a5, 0x0000, -0x000a], param: 0x08 },
    { pos: [-0x05de, 0x0000, 0x003d], param: 0x08 }, { pos: [-0x0595, 0x0000, 0x004f], param: 0x08 },
    { pos: [-0x0632, 0x0000, 0x0047], param: 0x08 }, { pos: [-0x05bf, 0x0000, 0x009d], param: 0x08 },
    { pos: [-0x0603, 0x0000, 0x00af], param: 0x08 }, { pos: [-0x05cc, 0x0000, 0x012f], param: 0x08 },
    { pos: [-0x05a2, 0x0000, 0x0166], param: 0x08 }, { pos: [-0x05e6, 0x0000, 0x01aa], param: 0x08 },
    { pos: [-0x0299, 0x0000, 0x033e], param: 0x0A }, { pos: [-0x02bd, 0x0003, 0x0355], param: 0x0A },
    { pos: [-0x025a, 0x0000, 0x03a1], param: 0x0A },
];

// ===============================
// Yoshi Valley
// ===============================

const dYoshiValleyClouds: Mk64Cloud[] = [
    { rotY: 0x00b6, posY: 80, scalePercent: 0x0041, subType: 0x0000 },
    { rotY: 0x4718, posY: 60, scalePercent: 0x0064, subType: 0x0000 },
    { rotY: 0x18e2, posY: 50, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x0064, subType: 0x0000 },
    { rotY: 0x9ff6, posY: 45, scalePercent: 0x0032, subType: 0x0000 },
    { rotY: 0xc710, posY: 70, scalePercent: 0x003c, subType: 0x0000 },
    { rotY: 0x0aaa, posY: 30, scalePercent: 0x0064, subType: 0x0001 },
    { rotY: 0x5c6c, posY: 70, scalePercent: 0x0046, subType: 0x0001 },
    { rotY: 0x31c4, posY: 40, scalePercent: 0x0050, subType: 0x0002 },
    { rotY: 0xf1b8, posY: 40, scalePercent: 0x004b, subType: 0x0002 },
];

export const dFlagPoleSpawns: Mk64Point[] = [
    { pos: [-0x0386, 0x0046, -0x057e], param: 0x3800 },
    { pos: [-0x03b4, 0x0046, -0x05fd], param: 0x3800 },
    { pos: [-0x087a, 0x0000, 0x02d3], param: 0x0400 },
    { pos: [-0x0891, 0x0000, 0x02f9], param: 0x0400 },
];

export const dHedgehogSpawns: Mk64Point[] = [
    { pos: [-0x0693, -0x0050, -0x0058], param: 0x0009 },
    { pos: [-0x0664, -0x005d, -0x0093], param: 0x0009 },
    { pos: [-0x065c, -0x0056, -0x006c], param: 0x0009 },
    { pos: [-0x068c, -0x0045, -0x001e], param: 0x0009 },
    { pos: [-0x04cb, -0x001b, -0x03dd], param: 0x001a },
    { pos: [-0x04ed, -0x0029, -0x0370], param: 0x001a },
    { pos: [-0x053e, -0x003c, -0x033e], param: 0x001a },
    { pos: [-0x0595, -0x004e, -0x0351], param: 0x001a },
    { pos: [-0x05d4, -0x005e, -0x0306], param: 0x001a },
    { pos: [-0x05ad, -0x0057, -0x0310], param: 0x001a },
    { pos: [-0x05d0, -0x0059, -0x0354], param: 0x001a },
    { pos: [-0x0515, -0x002f, -0x0388], param: 0x001a },
    { pos: [-0x0a1b, -0x0038, -0x0103], param: 0x001c },
    { pos: [-0x09bd, -0x005e, -0x01c6], param: 0x001c },
    { pos: [-0x09ad, -0x0003, -0x0039], param: 0x001c },
];

export const dHedgehogPatrolPoints: vec3[] = [
    [-0x0672, -0x0056, -0x0072], [-0x067d, -0x005d, -0x0097], [-0x0682, -0x004b, -0x003a],
    [-0x0673, -0x0047, -0x001a], [-0x04aa, -0x0019, -0x03e7], [-0x04bd, -0x0020, -0x0360],
    [-0x04e1, -0x0027, -0x039f], [-0x0543, -0x003b, -0x0362], [-0x0593, -0x004b, -0x037b],
    [-0x05e5, -0x005f, -0x0329], [-0x05b8, -0x0058, -0x0336], [-0x0601, -0x005c, -0x0356],
    [-0x0a40, -0x002f, -0x00f1], [-0x09c9, -0x0059, -0x018d], [-0x09eb, -0x0003, -0x0042],
];

// ===============================
// Koopa Troopa Beach
// ===============================

const dKoopaBeachClouds: Mk64Cloud[] = [
    { rotY: 0x1554, posY: 30, scalePercent: 0x00c8, subType: 0x0000 },
    { rotY: 0xce2c, posY: 30, scalePercent: 0x00c8, subType: 0x0000 },
    { rotY: 0xa384, posY: 30, scalePercent: 0x00c8, subType: 0x0001 },
    { rotY: 0x070c, posY: 30, scalePercent: 0x00c8, subType: 0x0001 },
    { rotY: 0x4718, posY: 30, scalePercent: 0x00c8, subType: 0x0002 },
    { rotY: 0x8714, posY: 30, scalePercent: 0x00c8, subType: 0x0003 },
];

interface CrabSpawn {
    startX: number;
    endX: number;
    startZ: number;
    endZ: number;
}

export const dCrabSpawns: CrabSpawn[] = [
    { startX: -1809, endX: -1666, startZ: 625, endZ: 594 },
    { startX: -1852, endX: -1620, startZ: 757, endZ: 740 },
    { startX: -1478, endX: -1453, startZ: 1842, endZ: 1833 },
    { startX: -1418, endX: -1455, startZ: 1967, endZ: 1962 },
    { startX: -1472, endX: -1417, startZ: 2112, endZ: 2100 },
    { startX: -1389, endX: -1335, startZ: 2152, endZ: 2136 },
    { startX: 218, endX: 69, startZ: 693, endZ: 696 },
    { startX: 235, endX: 24, startZ: 528, endZ: 501 },
    { startX: 268, endX: 101, startZ: 406, endZ: 394 },
    { startX: 223, endX: 86, startZ: 318, endZ: 308 },

    //unused
    { startX: 382, endX: 303, startZ: 1122, endZ: 1169 },
    { startX: 143, endX: 282, startZ: 1070, endZ: 991 },
    { startX: 340, endX: 215, startZ: 867, endZ: 935 },
    { startX: 123, endX: 186, startZ: 858, endZ: 823 },
    { startX: 225, endX: 86, startZ: 704, endZ: 745 },
    { startX: 143, endX: 86, startZ: 562, endZ: 581 },
];

//D_800E6034
const dSeagullPathA: Mk64Point[] = [
    { pos: [50, 170, 500], param: 40 }, { pos: [50, 130, 200], param: 40 },
    { pos: [0, 170, 0], param: 40 }, { pos: [200, 100, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [-200, 50, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [200, 100, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [-200, 100, 500], param: 40 },
    { pos: [0, 250, 300], param: 40 }, { pos: [200, 50, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [-200, 100, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [200, 100, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [-200, 250, 0], param: 40 },
    { pos: [0, 170, 200], param: 40 }, { pos: [50, 100, 300], param: 40 },
    { pos: [50, 170, 400], param: 40 }, { pos: [50, 170, 500], param: 40 },
    { pos: [50, 170, 500], param: 40 },
];

//D_800E60F0
const dSeagullPathB: Mk64Point[] = [
    { pos: [0, 170, -500], param: 40 }, { pos: [200, 130, -400], param: 40 },
    { pos: [0, 170, -200], param: 40 }, { pos: [-200, 100, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [200, 100, 400], param: 40 },
    { pos: [0, 170, 500], param: 40 }, { pos: [-200, 100, 500], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [-200, 100, 200], param: 40 },
    { pos: [0, 170, 0], param: 40 }, { pos: [-100, 100, 200], param: 40 },
    { pos: [0, 170, 400], param: 40 }, { pos: [100, 100, 500], param: 40 },
    { pos: [0, 170, 700], param: 40 }, { pos: [-100, 230, 500], param: 40 },
    { pos: [0, 150, 400], param: 40 }, { pos: [100, 130, 300], param: 40 },
    { pos: [0, 170, 100], param: 40 }, { pos: [-100, 130, 300], param: 40 },
    { pos: [0, 170, 400], param: 40 }, { pos: [100, 130, 500], param: 40 },
    { pos: [0, 130, 700], param: 40 }, { pos: [0, 170, -500], param: 40 },
];

//D_800E61B4
const dSeagullPathC: Mk64Point[] = [
    { pos: [-150, 100, 0], param: 20 }, { pos: [-106, 150, -106], param: 20 },
    { pos: [0, 80, -150], param: 20 }, { pos: [106, 150, -106], param: 20 },
    { pos: [150, 100, 0], param: 20 }, { pos: [106, 150, 106], param: 20 },
    { pos: [0, 100, 150], param: 20 }, { pos: [-106, 100, 106], param: 20 },
    { pos: [-150, 130, 0], param: 20 }, { pos: [-106, 80, -106], param: 20 },
    { pos: [0, 100, -150], param: 20 }, { pos: [106, 140, -106], param: 20 },
    { pos: [150, 100, 0], param: 20 }, { pos: [106, 100, 106], param: 20 },
    { pos: [0, 150, 150], param: 20 }, { pos: [-106, 80, 106], param: 20 },
    { pos: [-150, 100, 0], param: 20 }, { pos: [-106, 150, -106], param: 20 },
    { pos: [0, 100, -150], param: 20 }, { pos: [106, 120, -106], param: 20 },
    { pos: [150, 100, 0], param: 20 }, { pos: [106, 40, 106], param: 20 },
    { pos: [0, 100, 150], param: 20 }, { pos: [-106, 100, 106], param: 20 },
    { pos: [-150, 100, 0], param: 20 },
];

//D_800E6280
const dSeagullPathD: Mk64Point[] = [
    { pos: [-50, 170, -500], param: 40 }, { pos: [-50, 130, -200], param: 40 },
    { pos: [0, 170, 0], param: 40 }, { pos: [-200, 100, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [200, 50, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [-200, 100, 0], param: 40 },
    { pos: [0, 170, -300], param: 40 }, { pos: [200, 100, -500], param: 40 },
    { pos: [0, 250, -300], param: 40 }, { pos: [-200, 50, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [200, 100, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [-200, 100, 0], param: 40 },
    { pos: [0, 170, 300], param: 40 }, { pos: [200, 250, 0], param: 40 },
    { pos: [0, 170, -200], param: 40 }, { pos: [-50, 100, -300], param: 40 },
    { pos: [-50, 170, -400], param: 40 }, { pos: [-50, 170, -500], param: 40 },
    { pos: [-50, 170, -500], param: 40 },
];

export const seagullPathList: Mk64Point[][] = [dSeagullPathA, dSeagullPathB, dSeagullPathC, dSeagullPathD];

// ===============================
// DK's Jungle Parkway
// ===============================

export const dDkJungleTorchSpawns: vec3[] = [
    [-602, -96, 104], [-737, -95, 310], [-848, -90, 541], [-861, -80, 770],
    [-701, -60, 944], [-430, -40, 924], [-219, -19, 800], [-54, -8, 624],
];

// ===============================
// Rainbow Road
// ===============================

export const dStaticNeonSpawns: vec3[] = [
    [1443.0, 1044.0, -5478.0], [1678.0, 1012.0, -4840.0],
    [-3924.0, 921.0, 2566.0], [-3311.0, 790.0, 3524.0],
    [-1284.0, 1341.0, 4527.0], [2268.0, 1041.0, 4456.0],
    [2820.0, 1109.0, 1985.0],
];

// ===============================
// Sherbet Land
// ===============================

const dSherbetLandClouds: Mk64Cloud[] = [
    { rotY: 0x4718, posY: 60, scalePercent: 0x007d, subType: 0x0000 },
    { rotY: 0x5550, posY: 70, scalePercent: 0x0096, subType: 0x0000 },
    { rotY: 0x954c, posY: 45, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0xf546, posY: 40, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0x0e38, posY: 30, scalePercent: 0x0032, subType: 0x0001 },
    { rotY: 0x0222, posY: 50, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0x1ffe, posY: 40, scalePercent: 0x004b, subType: 0x0002 },
    { rotY: 0x31c4, posY: 50, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0xaaa0, posY: 75, scalePercent: 0x0096, subType: 0x0002 },
    { rotY: 0xb8d8, posY: 55, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0xdff2, posY: 30, scalePercent: 0x0032, subType: 0x0002 },
];

//D_800E659C
export const dPenguinPath: Mk64Point[] = [
    { pos: [-20, 0, 0], param: 80 }, { pos: [-14, 0, -14], param: 80 }, { pos: [0, 0, -20], param: 80 },
    { pos: [14, 0, -14], param: 80 }, { pos: [20, 0, 0], param: 80 }, { pos: [14, 0, 14], param: 80 },
    { pos: [0, 0, 20], param: 80 }, { pos: [-14, 0, 14], param: 80 }, { pos: [-20, 0, 0], param: 80 },
    { pos: [-14, 0, -14], param: 80 }, { pos: [0, 0, -20], param: 80 }, { pos: [14, 0, -14], param: 80 },
    { pos: [20, 0, 0], param: 80 }, { pos: [14, 0, 14], param: 80 }, { pos: [0, 0, 20], param: 80 },
    { pos: [-14, 0, 14], param: 80 }, { pos: [-20, 0, 0], param: 80 }, { pos: [-14, 0, -14], param: 80 },
    { pos: [0, 0, -20], param: 80 }, { pos: [14, 0, -14], param: 80 }, { pos: [20, 0, 0], param: 80 },
    { pos: [14, 0, 14], param: 80 }, { pos: [0, 0, 20], param: 80 }, { pos: [-14, 0, 14], param: 80 },
    { pos: [-20, 0, 0], param: 80 },
];

// ===============================
// Moo Moo Farm
// ===============================
export const dMoleSpawns: vec3[] = [
    [771, 20, -2022], [807, 15, -2063], [847, 18, -2040], [913, 14, -2054], [939, 21, -1997],
    [941, 17, -2024], [994, 17, -1994], [863, 22, -2010], [1500, 2, 1140], [1510, 15, 1050],
    [1609, 21, 935], [1289, 3, 1269], [1468, 22, 1046], [1380, 12, 1154], [1297, 19, 1170],
    [1589, 11, 1004], [1414, 3, 1185], [1405, 4, 1254], [1463, 8, 1118], [701, 2, 1279],
    [811, 8, 1278], [791, 16, 1229], [876, 15, 1266], [984, 23, 1248], [891, 20, 1242],
    [920, 15, 1304], [823, 6, 1327], [717, 8, 1239], [695, 19, 1176], [628, 8, 1191],
    [724, 4, 1339]
];

// ===============================
// Banshee Boardwalk
// ===============================

export const D_800E5988: Mk64Point[] = [
    { pos: [0x0005, 0x0011, 0x0032], param: 0x0028 }, { pos: [0x0005, 0x000d, 0x0014], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0000], param: 0x0028 }, { pos: [0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x0028 }, { pos: [0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0032], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0028 }, { pos: [0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x0028 }, { pos: [0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0014], param: 0x0028 }, { pos: [0x0005, 0x000a, 0x001e], param: 0x0028 },
    { pos: [0x0005, 0x0011, 0x0028], param: 0x0028 }, { pos: [0x0005, 0x0011, 0x0032], param: 0x0028 },
    { pos: [0x0005, 0x0011, 0x0032], param: 0x0028 },
];


export const D_800E5A44: Mk64Point[] = [
    { pos: [0x0000, 0x0011, -0x0032], param: 0x0028 }, { pos: [0x0014, 0x000d, -0x0028], param: 0x0028 },
    { pos: [0x0000, 0x0011, -0x0014], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0028 }, { pos: [0x0014, 0x000a, 0x0028], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0032], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0032], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0028 }, { pos: [-0x0014, 0x000a, 0x0014], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0000], param: 0x0028 }, { pos: [-0x000a, 0x000a, 0x0014], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0028], param: 0x0028 }, { pos: [0x000a, 0x000a, 0x0032], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0046], param: 0x0028 }, { pos: [-0x000a, 0x0017, 0x0032], param: 0x0028 },
    { pos: [0x0000, 0x000f, 0x0028], param: 0x0028 }, { pos: [0x000a, 0x000d, 0x001e], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x000a], param: 0x0028 }, { pos: [-0x000a, 0x000d, 0x001e], param: 0x0028 },
    { pos: [0x0000, 0x0011, 0x0028], param: 0x0028 }, { pos: [0x000a, 0x000d, 0x0032], param: 0x0028 },
    { pos: [0x0000, 0x000d, 0x0046], param: 0x0028 }, { pos: [0x0000, 0x0011, -0x0032], param: 0x0028 },
];

export const D_800E5B08: Mk64Point[] = [
    { pos: [-0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [-0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, -0x000f], param: 0x0014 }, { pos: [0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, 0x000f], param: 0x0014 }, { pos: [-0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [-0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [-0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, -0x000f], param: 0x0014 }, { pos: [0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, 0x000f], param: 0x0014 }, { pos: [-0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [-0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [-0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, -0x000f], param: 0x0014 }, { pos: [0x000a, 0x000a, -0x000a], param: 0x0014 },
    { pos: [0x000f, 0x000a, 0x0000], param: 0x0014 }, { pos: [0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [0x0000, 0x000a, 0x000f], param: 0x0014 }, { pos: [-0x000a, 0x000a, 0x000a], param: 0x0014 },
    { pos: [-0x000f, 0x000a, 0x0000], param: 0x0014 },
];

export const D_800E5BD4: Mk64Point[] = [
    { pos: [0x0005, 0x0011, 0x0032], param: 0x001e }, { pos: [0x0005, 0x000d, 0x0014], param: 0x001e },
    { pos: [0x0000, 0x0011, 0x0000], param: 0x001e }, { pos: [0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x001e }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x001e }, { pos: [0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x001e }, { pos: [-0x0014, 0x000a, 0x0032], param: 0x001e },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x001e }, { pos: [0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x001e }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x001e }, { pos: [0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, -0x001e], param: 0x001e }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x001e },
    { pos: [0x0000, 0x0011, 0x0014], param: 0x001e }, { pos: [0x0005, 0x000a, 0x001e], param: 0x001e },
    { pos: [0x0005, 0x0011, 0x0028], param: 0x001e }, { pos: [0x0005, 0x0011, 0x0032], param: 0x001e },
    { pos: [0x0005, 0x0011, 0x0032], param: 0x001e },
];

export const D_800E5C90: Mk64Point[] = [
    { pos: [0x0000, 0x0011, -0x0032], param: 0x0019 }, { pos: [0x0014, 0x000d, -0x0028], param: 0x0019 },
    { pos: [0x0000, 0x0011, -0x0014], param: 0x0019 }, { pos: [-0x0014, 0x000a, 0x0000], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0019 }, { pos: [0x0014, 0x000a, 0x0028], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x0032], param: 0x0019 }, { pos: [-0x0014, 0x000a, 0x0032], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x001e], param: 0x0019 }, { pos: [-0x0014, 0x000a, 0x0014], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x0000], param: 0x0019 }, { pos: [-0x000a, 0x000a, 0x0014], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x0028], param: 0x0019 }, { pos: [0x000a, 0x000a, 0x0032], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x0046], param: 0x0019 }, { pos: [-0x000a, 0x0017, 0x0032], param: 0x0019 },
    { pos: [0x0000, 0x000f, 0x0028], param: 0x0019 }, { pos: [0x000a, 0x000d, 0x001e], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x000a], param: 0x0019 }, { pos: [-0x000a, 0x000d, 0x001e], param: 0x0019 },
    { pos: [0x0000, 0x0011, 0x0028], param: 0x0019 }, { pos: [0x000a, 0x000d, 0x0032], param: 0x0019 },
    { pos: [0x0000, 0x000d, 0x0046], param: 0x0019 }, { pos: [0x0000, 0x0011, -0x0032], param: 0x0019 },
];

export const D_800E5D54: Mk64Point[] = [
    { pos: [0x0000, 0x0010, 0x0000], param: 0x0032 }, { pos: [0x0000, 0x0010, 0x0002], param: 0x0000 },
    { pos: [0x0000, 0x0010, 0x0004], param: 0x0000 }, { pos: [0x0000, 0x0010, 0x0006], param: 0x0000 },
];

export const dBooPaths = [D_800E5988, D_800E5A44, D_800E5B08, D_800E5BD4, D_800E5C90]

// ===============================
// Royal Raceway
// ===============================

const dRoyalRacewayClouds: Mk64Cloud[] = [
    { rotY: 0x60b0, posY: 60, scalePercent: 0x007d, subType: 0x0000 },
    { rotY: 0xb8d8, posY: 55, scalePercent: 0x0064, subType: 0x0000 },
    { rotY: 0xd548, posY: 10, scalePercent: 0x0082, subType: 0x0000 },
    { rotY: 0xf1b8, posY: 35, scalePercent: 0x0064, subType: 0x0000 },
    { rotY: 0x04fa, posY: 70, scalePercent: 0x0096, subType: 0x0001 },
    { rotY: 0x4718, posY: 60, scalePercent: 0x007d, subType: 0x0001 },
    { rotY: 0x954c, posY: 45, scalePercent: 0x004b, subType: 0x0001 },
    { rotY: 0x0e38, posY: 30, scalePercent: 0x0032, subType: 0x0002 },
    { rotY: 0x8880, posY: 70, scalePercent: 0x0096, subType: 0x0002 },
    { rotY: 0x31c4, posY: 50, scalePercent: 0x0064, subType: 0x0003 },
    { rotY: 0x5056, posY: 40, scalePercent: 0x004b, subType: 0x0003 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x0064, subType: 0x0003 },
    { rotY: 0xaaa0, posY: 75, scalePercent: 0x0096, subType: 0x0003 },
];

// ===============================
// Kalimari Desert
// ===============================

const dDesertClouds: Mk64Cloud[] = [
    { rotY: 0x1ffe, posY: 40, scalePercent: 0x004b, subType: 0x0000 },
    { rotY: 0x60b0, posY: 60, scalePercent: 0x007d, subType: 0x0000 },
    { rotY: 0xb8d8, posY: 55, scalePercent: 0x0064, subType: 0x0000 },
    { rotY: 0x4718, posY: 60, scalePercent: 0x007d, subType: 0x0001 },
    { rotY: 0x954c, posY: 45, scalePercent: 0x004b, subType: 0x0001 },
    { rotY: 0xf546, posY: 40, scalePercent: 0x004b, subType: 0x0001 },
    { rotY: 0x0e38, posY: 30, scalePercent: 0x0032, subType: 0x0002 },
    { rotY: 0xa384, posY: 50, scalePercent: 0x0064, subType: 0x0002 },
    { rotY: 0xddd0, posY: 70, scalePercent: 0x0096, subType: 0x0002 },
    { rotY: 0x0222, posY: 50, scalePercent: 0x0064, subType: 0x0003 },
    { rotY: 0x31c4, posY: 50, scalePercent: 0x0064, subType: 0x0003 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x0064, subType: 0x0003 },
    { rotY: 0xaaa0, posY: 75, scalePercent: 0x0096, subType: 0x0003 },
];

// ===============================
// Toad's Turnpike
// ===============================

const dToadsTurnpikeStars: Mk64Cloud[] = [
    { rotY: 0x0222, posY: 50, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x04fa, posY: 70, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x093e, posY: 10, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x0e38, posY: 30, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x11c6, posY: 40, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x1554, posY: -10, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x1ddc, posY: 10, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x1ffe, posY: 48, scalePercent: 0x0019, subType: 0x0000 },
    { rotY: 0x271a, posY: 70, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x27d0, posY: -15, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x2c14, posY: 20, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x31c4, posY: 50, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x327a, posY: 0, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x3a4c, posY: 15, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x3ffc, posY: 45, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x40b2, posY: -35, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x4440, posY: 55, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x4718, posY: 60, scalePercent: 0x000c, subType: 0x0000 },
    { rotY: 0x4718, posY: 80, scalePercent: 0x000c, subType: 0x0000 },
    { rotY: 0x4aa6, posY: -10, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x5056, posY: 40, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x5550, posY: 70, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x60b0, posY: 60, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x6388, posY: -35, scalePercent: 0x0019, subType: 0x0000 },
    { rotY: 0x64f4, posY: 35, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x6aa4, posY: 75, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x7054, posY: 45, scalePercent: 0x0019, subType: 0x0000 },
    { rotY: 0x7498, posY: 20, scalePercent: 0x0012, subType: 0x0000 },
    { rotY: 0x7bb4, posY: -15, scalePercent: 0x001b, subType: 0x0000 },
    { rotY: 0x7ff8, posY: 55, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x8386, posY: 65, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x8880, posY: 70, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x954c, posY: 45, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x98da, posY: 60, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x9dd4, posY: 0, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xa384, posY: 70, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0xa43a, posY: 50, scalePercent: 0x0017, subType: 0x0000 },
    { rotY: 0xaaa0, posY: 75, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0xae2e, posY: 40, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0xb1bc, posY: 35, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0xb8d8, posY: -15, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xbc66, posY: -30, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0xc710, posY: 30, scalePercent: 0x000c, subType: 0x0000 },
];

// ===============================
// Wario Stadium
// ===============================

const dWarioStadiumStars: Mk64Cloud[] = [
    { rotY: 0x0222, posY: 80, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x04fa, posY: 100, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x093e, posY: 90, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x0e38, posY: 60, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x11c6, posY: 70, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x1554, posY: 120, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x1c70, posY: 30, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x1ffe, posY: 70, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x271a, posY: 100, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x2c14, posY: 50, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x31c4, posY: 80, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x3996, posY: 25, scalePercent: 0x000c, subType: 0x0000 },
    { rotY: 0x3a4c, posY: 55, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x3bb8, posY: 25, scalePercent: 0x000c, subType: 0x0000 },
    { rotY: 0x3ffc, posY: 75, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x4440, posY: 85, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x4718, posY: 90, scalePercent: 0x000c, subType: 0x0000 },
    { rotY: 0x4aa6, posY: 60, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x5056, posY: 70, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x5550, posY: 100, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x60b0, posY: 90, scalePercent: 0x0016, subType: 0x0000 },
    { rotY: 0x64f4, posY: 65, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x6aa4, posY: 105, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x7054, posY: 75, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0x71c0, posY: 120, scalePercent: 0x0012, subType: 0x0000 },
    { rotY: 0x7498, posY: 60, scalePercent: 0x0012, subType: 0x0000 },
    { rotY: 0x7ff8, posY: 85, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x8714, posY: 115, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0x8880, posY: 100, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x954c, posY: 75, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0x98da, posY: 60, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0x9dd4, posY: 50, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xa384, posY: 80, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xa43a, posY: 110, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xaaa0, posY: 105, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0xae2e, posY: 70, scalePercent: 0x0011, subType: 0x0000 },
    { rotY: 0xb1bc, posY: 65, scalePercent: 0x0014, subType: 0x0000 },
    { rotY: 0xb8d8, posY: 85, scalePercent: 0x000a, subType: 0x0000 },
    { rotY: 0xbc66, posY: 60, scalePercent: 0x000f, subType: 0x0000 },
    { rotY: 0xc710, posY: 100, scalePercent: 0x000a, subType: 0x0000 },
];

// ===============================
// General Data
// ===============================
export const dMapSkyColors: SkyColor[] = [
    { top: 0x80B8F8FF, bottom: 0xD8E8F8FF }, { top: 0xFFFFFFFF, bottom: 0xFFFFFFFF },
    { top: 0x300878FF, bottom: 0x000000FF }, { top: 0x000000FF, bottom: 0x000000FF },
    { top: 0x7146FFFF, bottom: 0xFFB863FF }, { top: 0x1C0B5AFF, bottom: 0x0063A4FF },
    { top: 0x309878FF, bottom: 0xD8E8F8FF }, { top: 0xEE90FFFF, bottom: 0xFFE0F0FF },
    { top: 0x80B8F8FF, bottom: 0xD8E8F8FF }, { top: 0x0012FFFF, bottom: 0xC5D3FFFF },
    { top: 0x00025EFF, bottom: 0xD14117FF }, { top: 0xC3E7FFFF, bottom: 0xFFC000FF },
    { top: 0x80B8F8FF, bottom: 0xD8E8F8FF }, { top: 0x000000FF, bottom: 0x000000FF },
    { top: 0x141E38FF, bottom: 0x283C6EFF }, { top: 0x80B8F8FF, bottom: 0xD8E8F8FF },
    { top: 0x000000FF, bottom: 0x000000FF }, { top: 0x7146FFFF, bottom: 0xFFB863FF },
    { top: 0xFFAE00FF, bottom: 0xFFE57CFF }, { top: 0x000000FF, bottom: 0x000000FF }
];

export const dCourseData: CourseInfo[] = [
    { courseOpa: 0x060097F8, itemBoxes: 0x06009498, cloudTex: 0x0300E000, clouds: dDesertClouds, piranhaPlants: 0x9518, foliage: 0x9570, trackPath: 0x060057B0 },
    { courseOpa: 0x060071B8, itemBoxes: 0x06007250, fallingRocks: 0x7230, trackPath: 0x060047F0 },
    { courseOpa: 0x06009148, courseXlu: 0x06009650, itemBoxes: 0x06009370, foliage: 0x9290, trackPath: 0x060051D0 },
    { courseOpa: 0x0600B5E0, courseXlu: 0x0600B6E8, itemBoxes: 0xB3D0, trackPath: 0x060047F0 },
    { courseOpa: 0x06018020, itemBoxes: 0x06018110, cloudTex: 0x03009800, clouds: dYoshiValleyClouds, foliage: 0x180A0, trackPath: 0x0600E150 },
    { courseOpa: 0x060076A0, itemBoxes: 0x06007810, foliage: 0x7718, trackPath: 0x060036E8 },
    { courseOpa: 0x060197C8, itemBoxes: 0x06018E78, cloudTex: 0x03009000, clouds: dKoopaBeachClouds, palmTrees: 0x18F70, trackPath: 0x0600B1A8 },
    { courseOpa: 0x0600DFE0, itemBoxes: 0x0600DB80, cloudTex: 0x0300E800, clouds: dRoyalRacewayClouds, piranhaPlants: 0xD9F0, foliage: 0xDA78, trackPath: 0x0600B828 },
    { courseOpa: 0x0600FD40, itemBoxes: 0x0600FDE8, cloudTex: 0x0300A000, clouds: dLuigiRacewayClouds, foliage: 0xFE80, trackPath: 0x0600A6D0 },
    { courseOpa: 0x06014088, itemBoxes: 0x060143E0, cloudTex: 0x0300F000, clouds: dYoshiValleyClouds, foliage: 0x14330, cows: 0x14200, trackPath: 0x0600EDE8 },
    { courseOpa: 0x06023C20, itemBoxes: 0x06023AE0, cloudTex: 0x00000000, clouds: dToadsTurnpikeStars, trackPath: 0x06003D30 },
    { courseOpa: 0x06022E00, itemBoxes: 0x06022E88, cloudTex: 0x0300B800, clouds: dDesertClouds, foliage: 0x22F08, trackPath: 0x06006EC0 },
    { courseOpa: 0x06009CE0, courseXlu: 0x06009D50, cloudTex: 0x03009000, clouds: dSherbetLandClouds, itemBoxes: 0x06009B80, trackPath: 0x06004DE8, },
    { courseXlu: 0x06016220, itemBoxes: 0x06016338, cloudTex: 0x00000000, clouds: dToadsTurnpikeStars, trackPath: 0x06001CF8 },
    { courseOpa: 0x0600CA78, courseXlu: 0x0600CD58, cloudTex: 0x00000000, clouds: dWarioStadiumStars, itemBoxes: 0x0600CB40, trackPath: 0x06005908 },//wario
    { courseOpa: 0x06000000, itemBoxes: 0x06000038 },
    { courseOpa: 0x06000000, itemBoxes: 0x06000080 },
    { courseOpa: 0x06000000, itemBoxes: 0x06000028 },
    { courseOpa: 0x060146D0, itemBoxes: 0x06013EC0, dkJungleTrees: 0x13F78, trackPath: 0x06007620 },
    { courseOpa: 0x06000000, itemBoxes: 0x06000058 },
];

export const dCourseCpuMaxSeparation: number[] = [
    50.0, 35.0, 35.0, 40.0, 35.0, 50.0,
    50.0, 50.0, 50.0, 50.0, 50.0, 50.0,
    50.0, 50.0, 50.0, -1.0, -1.0, -1.0,
    40.0, -1.0, 40.0
];

export const dCourseCpuMinSeparation: number[] = [
    0.3, 0.3, 0.2, 0.4, 0.0, 0.3,
    0.5, 0.4, 0.7, 0.5, 0.5, 0.3,
    0.3, 0.4, 0.6, 0.1, 0.5, 0.5,
    0.1, 0.5, 0.5
];