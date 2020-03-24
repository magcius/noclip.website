import * as F3DEX2 from "./f3dex2";
import * as RDP from "../Common/N64/RDP";
import * as MIPS from "./mips";

import ArrayBufferSlice from "../ArrayBufferSlice";
import { RSPSharedOutput, OtherModeH_Layout, OtherModeH_CycleType } from "../BanjoKazooie/f3dex";
import { vec3, vec4 } from "gl-matrix";
import { assert, hexzero, assertExists, nArray } from "../util";
import { TextFilt, ImageFormat, ImageSize } from "../Common/N64/Image";
import { Endianness } from "../endian";
import { findNewTextures } from "./animation";
import { MotionParser, Motion, Splash, Direction } from "./motion";
import { Vec3UnitY, Vec3One, bitsAsFloat32 } from "../MathHelpers";
import {parseParticles, ParticleSystem } from "./particles";

export interface Level {
    sharedCache: RDP.TextureCache;
    skybox: Room | null;
    rooms: Room[];
    objectInfo: ObjectDef[];
    collision: CollisionTree | null;
    zeroOne: ZeroOne;
    projectiles: ProjectileData[];
    fishTable: FishEntry[];
    levelParticles: ParticleSystem;
    pesterParticles: ParticleSystem;
}

export interface Room {
    node: GFXNode;
    objects: ObjectSpawn[];
    animation: AnimationData | null;
}

export interface Model {
    sharedOutput: RSPSharedOutput;
    rspState: F3DEX2.RSPState;
    rspOutput: F3DEX2.RSPOutput | null;
}

export interface ObjectSpawn {
    id: number;
    behavior: number;
    pos: vec3;
    euler: vec3;
    scale: vec3;
    path?: Path;
}

export interface ActorDef {
    id: number;
    nodes: GFXNode[];
    sharedOutput: RSPSharedOutput;
    scale: vec3;
    center: vec3;
    radius: number;
    flags: number;
    spawn: SpawnType;
    stateGraph: StateGraph;
    globalPointer: number;
}

export interface StaticDef {
    id: number;
    node: GFXNode;
    sharedOutput: RSPSharedOutput;
}

export type ObjectDef = ActorDef | StaticDef;

export function isActor(def: ObjectDef): def is ActorDef {
    return !!(def as any).stateGraph;
}

export interface LevelArchive {
    Name: number;
    Data: ArrayBufferSlice;
    Code: ArrayBufferSlice;
    StartAddress: number;
    CodeStartAddress: number;
    Header: number;
    Objects: number;
    Collision: number;
    ParticleData: ArrayBufferSlice;
};

export interface DataRange {
    data: ArrayBufferSlice;
    start: number;
}

interface ZeroOne {
    animations: AnimationData[];
    nodes: GFXNode[];
    sharedOutput: RSPSharedOutput;
}

export interface ProjectileData {
    nodes: GFXNode[];
    animations: AnimationData[];
    sharedOutput: RSPSharedOutput;
}

export class DataMap {
    constructor(public ranges: DataRange[]) { }

    public getView(addr: number): DataView {
        const range = this.getRange(addr);
        return range.data.createDataView(addr - range.start);
    }

    public getRange(addr: number): DataRange {
        for (let i = 0; i < this.ranges.length; i++) {
            const offset = addr - this.ranges[i].start;
            if (0 <= offset && offset < this.ranges[i].data.byteLength)
                return this.ranges[i];
        }
        throw `no matching range for ${hexzero(addr, 8)}`;
    }

    public deref(addr: number): number {
        return this.getView(addr).getUint32(0);
    }
}

export const enum SpawnType {
    GROUND,
    FLYING,
    OTHER,
}

function getSpawnType(addr: number): SpawnType {
    switch (addr) {
        case 0x362EE0: // normal spawn
        case 0x362E10: // spawn plus some other gfx function?
            return SpawnType.GROUND;
        case 0x362E5C: // normal flying
        case 0x362DC4: // flying plus other gfx function
            return SpawnType.FLYING;
    }
    return SpawnType.OTHER;
}

// the cart only appears during the intro and outro cutscenes
// each level has a starting animation set in a function on level load,
// and an ending animation set by the gate object when the player is close enough
// these are just the intro animations for now
function getCartAnimationAddresses(id: number): number[] {
    switch (id) {
        case 16: return [0x8013C580, 0x8013CEA0];
        case 18: return [0x8013D920, 0x8013E3D0];
        case 24: return [0x801174E0, 0x801182F0];
        case 22: return [0x8014A660, 0x8014B450];
        case 20: return [0x80147540, 0x80148420];
        case 26: return [0x80120520, 0x801212A0];
        case 28: return [0x80119AE0, 0x8011A970];
    }
    throw `bad level ID`;
}

export function parseLevel(archives: LevelArchive[]): Level {
    const level = archives[0];

    const dataMap = new DataMap([
        { data: level.Data, start: level.StartAddress },
        { data: level.Code, start: level.CodeStartAddress },
    ]);
    for (let i = 1; i < archives.length; i++) {
        dataMap.ranges.push(
            { data: archives[i].Data, start: archives[i].StartAddress },
            { data: archives[i].Code, start: archives[i].CodeStartAddress },
        );
    }

    const rooms: Room[] = [];
    const roomHeader = dataMap.deref(level.Header);

    const view = dataMap.getView(roomHeader);
    const pathRooms = view.getUint32(0x00);
    const nonPathRooms = view.getUint32(0x04);
    const skyboxDescriptor = view.getUint32(0x08);

    const sharedCache = new RDP.TextureCache();

    let skybox: Room | null = null;

    if (skyboxDescriptor > 0) {
        const skyboxView = dataMap.getView(skyboxDescriptor);
        const skyboxDL = skyboxView.getUint32(0x00);
        const skyboxMats = skyboxView.getUint32(0x08);
        const animData = skyboxView.getUint32(0x0C);
        const materials = skyboxMats !== 0 ? parseMaterialData(dataMap, dataMap.deref(skyboxMats)) : [];
        const skyboxState = new F3DEX2.RSPState(new RSPSharedOutput(), dataMap);
        initDL(skyboxState, true);
        const skyboxModel = runRoomDL(dataMap, skyboxDL, [skyboxState], materials);

        const node: GFXNode = {
            billboard: 0,
            model: skyboxModel,
            translation: vec3.create(),
            euler: vec3.create(),
            scale: vec3.clone(Vec3One),
            parent: -1,
            materials,
        };

        let animation: AnimationData | null = null;
        if (animData !== 0) {
            const animStart = dataMap.deref(animData);
            const mats: AnimationTrack[] = [];
            for (let i = 0; i < materials.length; i++) {
                const track = parseAnimationTrack(dataMap, dataMap.deref(animStart + 4*i))!;
                findNewTextures(dataMap, track, node, i);
                mats.push(track);
            }
            animation = {fps: 30, frames: 0, tracks: [null], materialTracks: [mats]};
        }

        skybox = {
            node,
            objects: [],
            animation,
        };
    }

    const pathView = dataMap.getView(pathRooms);
    let offs = 0;
    while (pathView.getUint32(offs) !== 0) {
        rooms.push(parseRoom(dataMap, pathView.getUint32(offs), sharedCache));
        offs += 4;
    }

    // also different material handling?
    const nonPathView = dataMap.getView(nonPathRooms);
    offs = 0;
    while (nonPathView.getUint32(offs) !== 0) {
        rooms.push(parseRoom(dataMap, nonPathView.getUint32(offs), sharedCache));
        offs += 4;
    }

    if (level.Name === 0x1C)
        // rainbow cloud spawns things dynamically
        rooms[0].objects.push(
            {
                id: 0x97,
                behavior: 1,
                pos: vec3.fromValues(0, 100, 500),
                euler: vec3.create(),
                scale: vec3.clone(Vec3One),
            },
            {
                id: 0x3e9,
                behavior: 0,
                pos: vec3.fromValues(0, 0, 10000),
                euler: vec3.fromValues(0, Math.PI, 0),
                scale: vec3.clone(Vec3One),
            },
        );

    spawnParser.dataMap = dataMap;
    const fishTable = parseFishTable(dataMap, level.Name);

    const objectInfo: ObjectDef[] = [];
    if (level.Objects !== 0) {
        const objFunctionView = dataMap.getView(level.Objects);
        offs = 0;
        while (objFunctionView.getInt32(offs) !== 0) {
            const id = objFunctionView.getInt32(offs + 0x00);
            const initFunc = objFunctionView.getUint32(offs + 0x04);
            offs += 0x10;
            parseObject(dataMap, id, initFunc, objectInfo);
        }
    }

    if (level.Name === 16)
        parseObject(dataMap, 1006, 0x802CBDA0, objectInfo);

    const statics = dataMap.deref(level.Header + 0x04);
    if (statics !== 0) {
        const staticView = dataMap.getView(statics);
        offs = 0;
        while (true) {
            const id = staticView.getInt32(offs + 0x00);
            if (id === -1)
                break;
            const func = staticView.getUint32(offs + 0x04);
            const dlStart = staticView.getUint32(offs + 0x08);
            assert(func === 0x800e30b0, hexzero(func, 8));

            const sharedOutput = new RSPSharedOutput();
            const states = [new F3DEX2.RSPState(sharedOutput, dataMap)];
            initDL(states[0], true);

            const model = runRoomDL(dataMap, dlStart, states);
            const node: GFXNode = {
                model,
                billboard: 0,
                parent: -1,
                translation: vec3.create(),
                euler: vec3.create(),
                scale: vec3.clone(Vec3One),
                materials: [],
            };
            objectInfo.push({ id, node, sharedOutput });
            offs += 0x0C;
        }
    }

    const zeroOne = buildZeroOne(dataMap, level.Name);
    const projectiles = buildProjectiles(dataMap);

    let collision: CollisionTree | null = null;
    if (level.Collision !== 0)
        collision = parseCollisionTree(dataMap, level.Collision);

    const levelParticles = parseParticles(archives[0].ParticleData, false);
    const pesterParticles = parseParticles(archives[1].ParticleData, true);

    return { rooms, skybox, sharedCache, objectInfo, collision, zeroOne, projectiles, fishTable, levelParticles, pesterParticles };
}

function parseObject(dataMap: DataMap, id: number, initFunc: number, defs: ObjectDef[]): void {
    const initView = dataMap.getView(initFunc);
    assert(dataFinder.parseFromView(initView) || initFunc === 0x802EAF18, `bad parse for init function ${hexzero(initFunc, 8)}`);
    const objectView = dataMap.getView(dataFinder.dataAddress);

    const graphStart = objectView.getUint32(0x00);
    const materials = objectView.getUint32(0x04);
    const renderer = objectView.getUint32(0x08);
    const animationStart = objectView.getUint32(0x0C);
    const scale = getVec3(objectView, 0x10);
    const center = getVec3(objectView, 0x1C);
    const radius = objectView.getFloat32(0x28) * scale[1];
    const flags = objectView.getUint16(0x2C);
    const extraTransforms = objectView.getUint32(0x2E) >>> 8;

    vec3.div(center, center, scale);
    vec3.scale(scale, scale, 0.1);

    const sharedOutput = new RSPSharedOutput();
    try {
        const nodes = parseGraph(dataMap, graphStart, materials, renderer, sharedOutput);
        const stateGraph = parseStateGraph(dataMap, animationStart, nodes);
        defs.push({ id, flags, nodes, scale, center, radius, sharedOutput, spawn: getSpawnType(dataFinder.spawnFunc), stateGraph, globalPointer: dataFinder.globalRef });
    } catch (e) {
        console.warn("failed parse", id, e);
    }
}

class ObjectDataFinder extends MIPS.NaiveInterpreter {
    public spawnFunc = 0;
    public dataAddress = 0;
    public globalRef = 0

    public reset(): void {
        super.reset();
        this.spawnFunc = 0;
        this.dataAddress = 0;
        this.globalRef = 0;
    }

    protected handleFunction(func: number, a0: MIPS.Register, a1: MIPS.Register, a2: MIPS.Register, a3: MIPS.Register, stackArgs: MIPS.Register[]): number {
        this.spawnFunc = func;
        this.dataAddress = assertExists(stackArgs[1]).value; // stack+0x14
        return 0;
    }

    handleStore(op: MIPS.Opcode, value: MIPS.Register, target: MIPS.Register, offset: number): void {
        if (op === MIPS.Opcode.SW && value.lastOp === MIPS.Opcode.JAL)
            this.globalRef = target.value;
    }
}

const dataFinder = new ObjectDataFinder();

export interface GFXNode {
    model?: Model;
    billboard: number;
    parent: number;
    translation: vec3;
    euler: vec3;
    scale: vec3;
    materials: MaterialData[];
}

interface TileParams {
    xShift: number;
    yShift: number;
    width: number;
    height: number;
}

interface TextureParams {
    fmt: ImageFormat,
    siz: ImageSize,
    width: number,
    height: number,
}

export interface MaterialTextureEntry {
    tex: number,
    pal: number,
    index: number,
}

export interface MaterialData {
    flags: number;
    textureStart: number;
    paletteStart: number;

    scale: number;
    shift: number;
    halve: number;
    yScale: number;
    xScale: number;

    tiles: TileParams[];
    textures: TextureParams[];

    primLOD: number;
    primColor: vec4;
    envColor: vec4;
    blendColor: vec4;
    diffuse: vec4;
    ambient: vec4;

    usedTextures: MaterialTextureEntry[];
    optional: boolean;
}

export const ColorFlagStart = 9;

export const enum MaterialFlags {
    Tex1    = 0x0001,
    Tex2    = 0x0002,
    Palette = 0x0004,
    PrimLOD = 0x0008,
    Special = 0x0010, // smoothly moves through a list of textures
    Tile0   = 0x0020, // set tile0 position
    Tile1   = 0x0040, // set tile1 position
    Scale   = 0x0080, // emit texture command, enabling tile0 and scaling

    Prim    = 0x0200, // set prim color
    Env     = 0x0400,
    Blend   = 0x0800,
    Diffuse = 0x1000,
    Ambient = 0x2000,
}

export function getVec3(view: DataView, offs: number): vec3 {
    return vec3.fromValues(
        view.getFloat32(offs + 0x00),
        view.getFloat32(offs + 0x04),
        view.getFloat32(offs + 0x08),
    );
}

export function getColor(view: DataView, offs: number): vec4 {
    return vec4.fromValues(
        view.getUint8(offs + 0x00) / 0xFF,
        view.getUint8(offs + 0x01) / 0xFF,
        view.getUint8(offs + 0x02) / 0xFF,
        view.getUint8(offs + 0x03) / 0xFF,
    );
}

function parseMaterialData(dataMap: DataMap, listStart: number): MaterialData[] {
    if (listStart === 0)
        return [];

    const materialList: MaterialData[] = [];
    const range = dataMap.getRange(listStart);
    const listView = range.data.createDataView();
    let offs = listStart - range.start;
    while (true) {
        const scrollEntry = listView.getUint32(offs);
        if (scrollEntry === 0)
            break;
        offs += 4;
        const scrollView = dataMap.getView(scrollEntry);

        const flags = scrollView.getUint16(0x30);

        const textureStart = scrollView.getUint32(0x04);
        const paletteStart = scrollView.getUint32(0x2C);

        const scale = scrollView.getUint16(0x08);
        const shift = scrollView.getUint16(0x0A);
        const halve = scrollView.getUint32(0x10);
        const xScale = scrollView.getFloat32(0x1C);
        const yScale = scrollView.getFloat32(0x20);

        const primColor = getColor(scrollView, 0x50);
        const envColor = getColor(scrollView, 0x58);
        const blendColor = getColor(scrollView, 0x5C);
        const diffuse = getColor(scrollView, 0x60);
        const ambient = getColor(scrollView, 0x64);

        const primLOD = scrollView.getUint8(0x54) / 255;

        const tiles: TileParams[] = [];
        tiles.push({
            width: scrollView.getUint16(0x0C),
            height: scrollView.getUint16(0x0E),
            xShift: scrollView.getFloat32(0x14),
            yShift: scrollView.getFloat32(0x18),
        });
        tiles.push({
            width: scrollView.getUint16(0x38),
            height: scrollView.getUint16(0x3A),
            xShift: scrollView.getFloat32(0x3C),
            yShift: scrollView.getFloat32(0x40),
        });

        const textures: TextureParams[] = [];
        textures.push({
            fmt: scrollView.getUint8(0x02),
            siz: scrollView.getUint8(0x03),
            width: 0, // dimensions of first texture are set elsewhere
            height: 0,
        });
        textures.push({
            fmt: scrollView.getUint8(0x32),
            siz: scrollView.getUint8(0x33),
            width: scrollView.getUint16(0x34),
            height: scrollView.getUint16(0x36),
        });

        materialList.push({
            flags: flags === 0 ? 0xA1 : flags, // empty flag means default, set up just a basic scrolling texture
            textureStart, paletteStart, tiles, textures, primLOD, halve, usedTextures: [],
            shift, scale, xScale, yScale, primColor, envColor, blendColor, diffuse, ambient, optional: false,
        });
    }
    return materialList;
}

type graphRenderer = (dataMap: DataMap, displayList: number, states: F3DEX2.RSPState[], materials?: MaterialData[]) => Model;

function selectRenderer(addr: number): graphRenderer {
    switch (addr) {
        case 0x80014F98:
        case 0x800a15D8:
        case 0x803594DC: // object
            return runRoomDL;
        case 0x8035942C: // object, fog
        case 0x8035958C: // object
            return runSplitDL;
        case 0X802DE26C: // moltres: set 2 cycle and no Z update
            return moltresDL;
        case 0x80359534: // object
        case 0x800A1608:
        case 0x802DFAE4: // volcano smoke: disable TLUT, set xlu
            return runMultiDL;
        case 0x80359484: // object
        case 0x800A16B0: // just the zero-one?
            return runMultiSplitDL;

        default: throw `unknown renderfunc ${hexzero(addr, 8)}`;
    }
}

function parseGraph(dataMap: DataMap, graphStart: number, materialList: number, renderFunc: number, output: RSPSharedOutput): GFXNode[] {
    const view = dataMap.getView(graphStart);
    const nodes: GFXNode[] = [];

    const parentIndices: number[] = [];

    const states = nArray(2, () => new F3DEX2.RSPState(output, dataMap));

    const renderer = selectRenderer(renderFunc);
    initDL(states[0], true);
    initDL(states[1], false);

    let currIndex = 0;
    let offs = 0;
    while (true) {
        const billboard = view.getUint8(offs + 0x02) >>> 4;
        const depth = view.getUint16(offs + 0x02) & 0xFFF;
        if (depth === 0x12)
            break;
        let dl = view.getUint32(offs + 0x04);
        const translation = getVec3(view, offs + 0x08);
        const euler = getVec3(view, offs + 0x14);
        const scale = getVec3(view, offs + 0x20);

        const parent = depth === 0 ? -1 : assertExists(parentIndices[depth - 1]);
        parentIndices[depth] = currIndex;

        const node: GFXNode = { billboard, translation, euler, scale, parent, materials: [] };
        if (dl > 0) {
            node.materials = materialList === 0 ? [] : parseMaterialData(dataMap, dataMap.deref(materialList + currIndex * 4));
            node.model = renderer(dataMap, dl, states, node.materials);
            states[0].clear();
            states[1].clear();
        }
        nodes.push(node);
        offs += 0x2c;
        currIndex++;
    }
    return nodes;
}

function parseRoom(dataMap: DataMap, roomStart: number, sharedCache: RDP.TextureCache): Room {
    const view = dataMap.getView(roomStart);

    const roomGeoStart = view.getUint32(0x00);
    const pos = getVec3(view, 0x04);
    const yaw = view.getFloat32(0x10);
    assert(yaw === 0);
    const staticSpawns = view.getUint32(0x18);
    const objectSpawns = view.getUint32(0x1C);
    // one more list here

    vec3.scale(pos, pos, 100);
    const roomView = dataMap.getView(roomGeoStart);
    const dlStart = roomView.getUint32(0x00);
    const materialData = roomView.getUint32(0x04);
    const animData = roomView.getUint32(0x08);
    const renderer = roomView.getUint32(0x0C);
    const graphStart = roomView.getUint32(0x10);
    const moreAnimData = roomView.getUint32(0x18); // TODO: understand relationship between this and animData
    const animTimeScale = roomView.getUint32(0x1C);

    const sharedOutput = new RSPSharedOutput();
    sharedOutput.textureCache = sharedCache;
    const rspState = new F3DEX2.RSPState(sharedOutput, dataMap);
    initDL(rspState, true);

    const materials: MaterialData[] = materialData !== 0 ? parseMaterialData(dataMap, dataMap.deref(materialData)) : [];
    const model = runRoomDL(dataMap, dlStart, [rspState], materials);
    const node: GFXNode = {
        model,
        billboard: 0,
        parent: -1,
        translation: pos,
        euler: vec3.create(),
        scale: vec3.clone(Vec3One),
        materials,
    };

    let animation: AnimationData | null = null;
    if (animData !== 0) {
        animation = {fps: 30, frames: 0, tracks: [null], materialTracks: parseMaterialAnimation(dataMap, animData, [node])};
    }

    const objects: ObjectSpawn[] = [];
    if (staticSpawns > 0) {
        const objView = dataMap.getView(staticSpawns);
        let offs = 0;
        while (true) {
            const id = objView.getInt32(offs + 0x00);
            if (id === -1)
                break;
            const objPos = getVec3(objView, offs + 0x04);
            vec3.scale(objPos, objPos, 100);
            vec3.add(objPos, objPos, pos);
            const euler = getVec3(objView, offs + 0x10);
            const scale = getVec3(objView, offs + 0x1C);
            objects.push({ id, behavior: 0, pos: objPos, euler, scale });
            offs += 0x28;
        }
    }
    if (objectSpawns > 0) {
        const objView = dataMap.getView(objectSpawns);
        let offs = 0;
        while (true) {
            const id = objView.getInt32(offs + 0x00);
            if (id === -1)
                break;
            const behavior = objView.getInt32(offs + 0x04);
            const objPos = getVec3(objView, offs + 0x08);
            vec3.scale(objPos, objPos, 100);
            vec3.add(objPos, objPos, pos);
            const euler = getVec3(objView, offs + 0x14);
            const scale = getVec3(objView, offs + 0x20);
            const pathAddr = objView.getUint32(offs + 0x2c);
            const newSpawn: ObjectSpawn = { id, behavior, pos: objPos, euler, scale };
            if (pathAddr !== 0)
                newSpawn.path = parsePath(dataMap, pathAddr);
            objects.push(newSpawn);
            offs += 0x30;
        }
    }
    return { node, objects, animation};
}

function initDL(rspState: F3DEX2.RSPState, opaque: boolean): void {
    rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_SHADE);
    if (opaque) {
        rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
        rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_LIGHTING);
    } else
        rspState.gDPSetOtherModeL(0, 29, 0x005049D8); // translucent surfaces
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    // some objects seem to assume this gets set, might rely on stage rendering first
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
}

function runRoomDL(dataMap: DataMap, displayList: number, states: F3DEX2.RSPState[], materials: MaterialData[] = []): Model {
    const rspState = states[0];
    F3DEX2.runDL_F3DEX2(rspState, displayList, materialDLHandler(materials));
    const rspOutput = rspState.finish();
    return { sharedOutput: rspState.sharedOutput, rspState, rspOutput };
}

// run two display lists, before and after pushing a matrix
function runSplitDL(dataMap: DataMap, dlPair: number, states: F3DEX2.RSPState[], materials: MaterialData[] = []): Model {
    const view = dataMap.getView(dlPair);
    const firstDL = view.getUint32(0x00);
    const secondDL = view.getUint32(0x04);
    const rspState = states[0];
    rspState.SP_MatrixIndex = 1;
    if (firstDL !== 0)
        F3DEX2.runDL_F3DEX2(rspState, firstDL, materialDLHandler(materials));
    rspState.SP_MatrixIndex = 0;
    if (secondDL !== 0)
        F3DEX2.runDL_F3DEX2(rspState, secondDL, materialDLHandler(materials));
    const rspOutput = rspState.finish();
    return { sharedOutput: rspState.sharedOutput, rspState, rspOutput };
}

function moltresDL(dataMap: DataMap, dlPair: number, states: F3DEX2.RSPState[], materials: MaterialData[] = []): Model {
    return runSplitDL(dataMap, dlPair, states, materials);
}


function runMultiDL(dataMap: DataMap, dlList: number, states: F3DEX2.RSPState[], materials: MaterialData[] = []): Model {
    const view = dataMap.getView(dlList);
    const handler = materialDLHandler(materials);

    let offs = 0;
    while (true) {
        const index = view.getUint32(offs + 0x00);
        const dlStart = view.getUint32(offs + 0x04);
        if (index === 4)
            break;
        F3DEX2.runDL_F3DEX2(states[index], dlStart, handler);
        offs += 8;
    }
    let rspOutput = states[0].finish();
    let xluOutput = states[1].finish();
    if (rspOutput === null)
        rspOutput = xluOutput;
    else if (xluOutput !== null)
        rspOutput.drawCalls.push(...xluOutput.drawCalls);

    return {sharedOutput: states[0].sharedOutput, rspState: states[0], rspOutput };
}

function runMultiSplitDL(dataMap: DataMap, dlList: number, states: F3DEX2.RSPState[], materials: MaterialData[] = []): Model {
    const view = dataMap.getView(dlList);
    let offs = 0;
    while (true) {
        const index = view.getUint32(offs);
        if (index === 4)
            break;
        runSplitDL(dataMap, dlList + offs + 4, [states[index]], materials);
        offs += 0xC;
    }
    let rspOutput = states[0].finish();
    let xluOutput = states[1].finish();
    if (rspOutput === null)
        rspOutput = xluOutput;
    else if (xluOutput !== null)
        rspOutput.drawCalls.push(...xluOutput.drawCalls);

    return {sharedOutput: states[0].sharedOutput, rspState: states[0], rspOutput };
}

function materialDLHandler(scrollData: MaterialData[]): F3DEX2.dlRunner {
    return function (state: F3DEX2.RSPState, addr: number): void {
        assert((addr >>> 24) === 0x0E, `bad dl jump address ${hexzero(addr, 8)}`);
        state.materialIndex = (addr >>> 3) & 0xFF;
        // insert the display list that would be generated
        const scroll = assertExists(scrollData[(addr >>> 3) & 0xFF]);
        if (scroll.flags & MaterialFlags.Palette) {
            state.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, state.dataMap.deref(scroll.paletteStart));
            if (scroll.flags & (MaterialFlags.Tex1 | MaterialFlags.Tex2)) {
                state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_4b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
                state.gDPLoadTLUT(5, scroll.textures[0].siz === ImageSize.G_IM_SIZ_8b ? 256 : 16);
            }
        }
        // skip lights, env, blend for now
        if (scroll.flags & (MaterialFlags.Prim | MaterialFlags.Special | MaterialFlags.PrimLOD))
            state.gSPSetPrimColor(scroll.primLOD, scroll.primColor[0] * 0xFF, scroll.primColor[1] * 0xFF, scroll.primColor[2] * 0xFF, scroll.primColor[3] * 0xFF);
        if (scroll.flags & (MaterialFlags.Tex2 | MaterialFlags.Special)) {
            const siz2 = scroll.textures[1].siz === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;

            // guess at texture index, we'll load the right one later
            const texOffset = (scroll.flags & (MaterialFlags.Tex1 | MaterialFlags.Special)) === 0 ? 0 : 4;

            state.gDPSetTextureImage(scroll.textures[1].fmt, siz2, 0, state.dataMap.deref(scroll.textureStart + texOffset));
            if (scroll.flags & (MaterialFlags.Tex1 | MaterialFlags.Special)) {
                let texels = scroll.textures[1].width * scroll.textures[1].height;
                switch (scroll.textures[1].siz) {
                    case ImageSize.G_IM_SIZ_4b:
                        texels = (texels + 4) >> 2;
                        break;
                    case ImageSize.G_IM_SIZ_8b:
                        texels = (texels + 1) >> 1;
                }
                const dxt = (1 << (14 - scroll.textures[1].siz)) / scroll.textures[1].width;
                state.gDPLoadBlock(6, 0, 0, texels, dxt);
            }
        }

        if (scroll.flags & (MaterialFlags.Tex1 | MaterialFlags.Special))
            state.gDPSetTextureImage(scroll.textures[0].fmt, scroll.textures[0].siz, 0, state.dataMap.deref(scroll.textureStart));

        const adjXScale = scroll.halve === 0 ? scroll.xScale : scroll.xScale / 2;
        if (scroll.flags & MaterialFlags.Tile0) {
            const uls = (scroll.tiles[0].width * scroll.tiles[0].xShift + scroll.shift) / adjXScale;
            const ult = (scroll.tiles[0].height * (1 - scroll.tiles[0].yShift) + scroll.shift) / scroll.yScale - scroll.tiles[0].height;
            state.gDPSetTileSize(0, uls << 2, ult << 2, (scroll.tiles[0].width + uls - 1) << 2, (scroll.tiles[0].height + ult - 1) << 2);
        }
        if (scroll.flags & MaterialFlags.Tile1) {
            const uls = (scroll.tiles[1].width * scroll.tiles[1].xShift + scroll.shift) / adjXScale;
            const ult = (scroll.tiles[1].height * (1 - scroll.tiles[1].yShift) + scroll.shift) / scroll.yScale - scroll.tiles[1].height;
            state.gDPSetTileSize(1, uls << 2, ult << 2, (scroll.tiles[1].width + uls - 1) << 2, (scroll.tiles[1].height + ult - 1) << 2);
        }
        if (scroll.flags & MaterialFlags.Scale)
            state.gSPTexture(true, 0, 0, (1 << 21) / scroll.scale / adjXScale, (1 << 21) / scroll.scale / scroll.yScale);
    };
}


export const enum EntryKind {
    Exit            = 0x00,
    InitFunc        = 0x01,
    Block           = 0x02,
    // for both models and materials, though the bits map to different fields
    LerpBlock       = 0x03,
    Lerp            = 0x04,
    SplineVelBlock  = 0x05,
    SplineVel       = 0x06,
    SplineEnd       = 0x07,
    SplineBlock     = 0x08,
    Spline          = 0x09,
    StepBlock       = 0x0A,
    Step            = 0x0B,
    Skip            = 0x0C,
    Path            = 0x0D, // only models
    Loop            = 0x0E,
    // model animation only
    SetFlags        = 0x0F,
    Func            = 0x10,
    MultiFunc       = 0x11,
    // material color only
    ColorStepBlock  = 0x12,
    ColorStep       = 0x13,
    ColorLerpBlock  = 0x14,
    ColorLerp       = 0x15,
    SetColor        = 0x16, // choose based on flags, also directly sets update time???
}

export const enum PathKind {
    Linear,
    Bezier,
    BSpline,
    Hermite,
}

export interface Path {
    kind: PathKind,
    length: number,
    duration: number,
    segmentRate: number,
    times: Float32Array,
    points: Float32Array,
    quartics: Float32Array,
}

export interface AnimatorData {
    kind: EntryKind,
    flags: number,
    increment: number,
    data: Float32Array,
}

export interface AnimationData {
    fps: number;
    frames: number;
    tracks: (AnimationTrack | null)[];
    materialTracks: (AnimationTrack | null)[][];
}

function parsePath(dataMap: DataMap, addr: number): Path {
    const view = dataMap.getView(addr);

    const kind: PathKind = view.getUint8(0x00);
    const length = view.getUint16(0x02);
    const segmentRate = view.getFloat32(0x04);
    const pointList = view.getUint32(0x08);
    const duration = view.getFloat32(0x0C);
    const timeList = view.getUint32(0x10);
    const quarticList = view.getUint32(0x14);

    const timeData = dataMap.getRange(timeList);
    const times = timeData.data.createTypedArray(Float32Array, timeList - timeData.start, length, Endianness.BIG_ENDIAN);

    let pointCount = (length + 2) * 3;
    if (kind === PathKind.Bezier)
        pointCount = length * 9;
    if (kind === PathKind.Linear)
        pointCount = length * 3;

    const pointData = dataMap.getRange(pointList);
    const points = pointData.data.createTypedArray(Float32Array, pointList - pointData.start, pointCount, Endianness.BIG_ENDIAN);

    let quartics: Float32Array;
    if (quarticList !== 0) {
         const quarticData = dataMap.getRange(quarticList);
        quartics = quarticData.data.createTypedArray(Float32Array, quarticList - quarticData.start, (length - 1) * 5, Endianness.BIG_ENDIAN);
    } else
        quartics = new Float32Array(0);

    return { kind, length, segmentRate, duration, times, points, quartics };
}

export interface AnimationTrack {
    entries: TrackEntry[];
    loopStart: number;
}

export interface TrackEntry {
    kind: EntryKind;
    flags: number;
    increment: number;
    block: boolean;
    data: Float32Array;
    path: Path | null;
    colors: vec4[];
}

function bitCount(bits: number): number {
    let count = 0;
    bits = bits >>> 0;
    while (bits > 0) {
        if (bits & 1)
            count++;
        bits = bits >>> 1;
    }
    return count;
}

function entryDataSize(kind: EntryKind, count: number): number {
    switch (kind) {
        case EntryKind.Exit:
        case EntryKind.InitFunc:
        case EntryKind.Block:
        case EntryKind.Skip:
        case EntryKind.Path:
        case EntryKind.Loop:
        case EntryKind.SetFlags:
        case EntryKind.Func:
            return 0;
        case EntryKind.SplineVel:
        case EntryKind.SplineVelBlock:
            return 2 * count;
    }
    return count;
}

// return whether the animation should wait for the current transitions to finish
// before setting new values
function entryShouldBlock(kind: EntryKind): boolean {
    switch (kind) {
        case EntryKind.Block:
        case EntryKind.LerpBlock:
        case EntryKind.SplineVelBlock:
        case EntryKind.SplineBlock:
        case EntryKind.StepBlock:
        case EntryKind.SetFlags:
        case EntryKind.Func:
        case EntryKind.MultiFunc:
        case EntryKind.ColorStepBlock:
        case EntryKind.ColorLerpBlock:
            return true;
    }
    return false;
}

function parseAnimationTrack(dataMap: DataMap, addr: number): AnimationTrack | null {
    if (addr === 0)
        return null;
    const range = dataMap.getRange(addr);
    const view = range.data.createDataView();

    const entryStarts: number[] = [];
    const entries: TrackEntry[] = [];

    let offs = addr - range.start;
    while (true) {
        entryStarts.push(offs);
        const kind: EntryKind = view.getUint8(offs + 0x00) >>> 1;
        const flags = (view.getUint32(offs + 0x00) >>> 15) & 0x3FF;
        const increment = view.getUint16(offs + 0x02) & 0x7FFF;

        offs += 4;
        if (kind === EntryKind.Loop) {
            const loop = view.getUint32(offs);
            const loopStart = entryStarts.findIndex((start) => start + range.start === loop);
            assert(loopStart >= 0, `bad loop start address ${hexzero(loopStart, 8)}`);
            return { entries, loopStart };
        }
        if (kind === EntryKind.Exit)
            return { entries, loopStart: -1 };

        const block = entryShouldBlock(kind);

        let data: Float32Array;
        const colors: vec4[] = [];

        const count = entryDataSize(kind, bitCount(flags));
        if (kind >= EntryKind.ColorStepBlock) {
            for (let i = 0; i < count; i++) {
                colors.push(getColor(view, offs));
                offs += 4;
            }
            data = new Float32Array(0);
        } else {
            data = range.data.createTypedArray(Float32Array, offs, count, Endianness.BIG_ENDIAN);
            offs += count * 4;
        }

        const newEntry: TrackEntry = { kind, flags, increment, block, data, path: null, colors };
        if (kind === EntryKind.Path) {
            newEntry.path = parsePath(dataMap, view.getUint32(offs));
            offs += 4;
        }
        entries.push(newEntry);
    }
}

function parseAnimations(dataMap: DataMap, addresses: number[], nodes: GFXNode[]): AnimationData[] {
    const anims: AnimationData[] = [];
    for (let i = 0; i < addresses.length; i++) {
        const view = dataMap.getView(addresses[i]);
        let fps = 30 * view.getFloat32(0x00);
        if (fps === 0)
            fps = 30; // TODO: understand what's going on here

        const frames = view.getFloat32(0x04);
        const trackList = view.getUint32(0x08);
        const materialData = view.getUint32(0x0C);
        const someIDs = view.getUint32(0x10);

        const tracks: (AnimationTrack | null)[] = [];
        const trackView = dataMap.getView(trackList);
        for (let i = 0; i < nodes.length; i++) {
            const trackStart = trackView.getUint32(4 * i);
            tracks.push(parseAnimationTrack(dataMap, trackStart));
        }
        anims.push({ fps, frames, tracks, materialTracks: parseMaterialAnimation(dataMap, materialData, nodes) });
    }

    if (anims.length === 0) // make sure materials load default textures
        parseMaterialAnimation(dataMap, 0, nodes);
    return anims;
}

function parseMaterialAnimation(dataMap: DataMap, addr: number, nodes: GFXNode[]): (AnimationTrack | null)[][] {
    const materialTracks: (AnimationTrack | null)[][] = [];
    if (addr !== 0) {
        const materialView = dataMap.getView(addr);
        for (let i = 0; i < nodes.length; i++) {
            const matListStart = materialView.getUint32(4 * i);
            const nodeMats: (AnimationTrack | null)[] = [];
            for (let j = 0; j < nodes[i].materials.length; j++) {
                const newTrack = matListStart === 0 ? null : parseAnimationTrack(dataMap, dataMap.deref(matListStart + 4 * j));
                findNewTextures(dataMap, newTrack, nodes[i], j);
                nodeMats.push(newTrack);
            }
            materialTracks.push(nodeMats);
        }
    } else {
        // any materials with textures must be able to use the default
        for (let i = 0; i < nodes.length; i++) {
            for (let j = 0; j < nodes[i].materials.length; j++) {
                findNewTextures(dataMap, null, nodes[i], j);
            }
        }
    }
    return materialTracks;
}

function buildZeroOne(dataMap: DataMap, id: number, ): ZeroOne {
    const graphStart = 0x803AAA30;
    const materials = 0x8039D938;
    const sharedOutput = new RSPSharedOutput();
    const nodes = parseGraph(dataMap, graphStart, materials, 0x800A16B0, sharedOutput);
    const animAddrs = getCartAnimationAddresses(id);
    const tracks: (AnimationTrack | null)[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const trackStart = dataMap.deref(animAddrs[0] + 4 * i);
        tracks.push(parseAnimationTrack(dataMap, trackStart));
    }

    const animations: AnimationData[] = [{
        fps: 15,
        frames: 0,
        tracks,
        materialTracks: parseMaterialAnimation(dataMap, animAddrs[1], nodes),
    }];

    return {nodes, sharedOutput, animations}
}

function buildProjectiles(dataMap: DataMap): ProjectileData[] {
    const out: ProjectileData[] = [];
    { // apple
        const sharedOutput = new RSPSharedOutput();
        const nodes = parseGraph(dataMap, 0x800EAED0, 0x800EAC58, 0x800A15D8, sharedOutput);
        const animations: AnimationData[] = [{
            fps: 12,
            frames: 0,
            tracks: [null, null],
            materialTracks: parseMaterialAnimation(dataMap, 0x800EAF60, nodes),
        }];
        out.push({ nodes, sharedOutput, animations });
    }
    { // pester ball
        const sharedOutput = new RSPSharedOutput();
        const nodes = parseGraph(dataMap, 0x800E9138, 0x800E8EB8, 0x800A15D8, sharedOutput);
        const animations: AnimationData[] = [{
            fps: 12,
            frames: 0,
            tracks: [null, null],
            materialTracks: parseMaterialAnimation(dataMap, 0x800E91C0, nodes),
        }];
        out.push({ nodes, sharedOutput, animations });
    }
    { // water splash
        const sharedOutput = new RSPSharedOutput();
        const nodes = parseGraph(dataMap, 0x800EB430, 0x800EB510, 0x800A1608, sharedOutput);
        const tracks: (AnimationTrack | null)[] = [];
        for (let i = 0; i < nodes.length; i++)
            tracks.push(parseAnimationTrack(dataMap, dataMap.deref(0x800EAFB0 + 4 * i)));
        const animations: AnimationData[] = [{
            fps: 27,
            frames: 0,
            tracks,
            materialTracks: parseMaterialAnimation(dataMap, 0x800EB0C0, nodes),
        }];
        out.push({ nodes, sharedOutput, animations });
    }
    { // lava splash
        const sharedOutput = new RSPSharedOutput();
        const nodes = parseGraph(dataMap, 0x800EDAB0, 0x800EDB90, 0x800A1608, sharedOutput);
        const tracks: (AnimationTrack | null)[] = [];
        for (let i = 0; i < nodes.length; i++)
            tracks.push(parseAnimationTrack(dataMap, dataMap.deref(0x800ED5B0 + 4 * i)));
        const animations: AnimationData[] = [{
            fps: 27,
            frames: 0,
            tracks,
            materialTracks: parseMaterialAnimation(dataMap, 0x800ED6B0, nodes),
        }];
        out.push({ nodes, sharedOutput, animations });
    }

    return out;
}

export interface GroundPlane {
    normal: vec3; // not actually normalized, really the equation coefficients
    offset: number;
    type: number;
}

export interface CollisionTree {
    line: vec3;
    posSubtree: CollisionTree | null;
    posPlane: GroundPlane | null;
    negSubtree: CollisionTree | null;
    negPlane: GroundPlane | null;
}

export function findGroundHeight(tree: CollisionTree | null, x: number, z: number): number {
    return computePlaneHeight(findGroundPlane(tree, x, z), x, z);
}

export function computePlaneHeight(plane: GroundPlane, x: number, z: number): number {
    if (plane === null)
        return 0;
    if (plane.normal[1] === 0)
        return 0;
    return -100 * (x * plane.normal[0] / 100 + z * plane.normal[2] / 100 + plane.offset) / plane.normal[1];
}

// returned if there *is* ground collision data, but nothing is found
// maybe never happens?
const nullPlane: GroundPlane = {
    normal: vec3.create(),
    type: 0,
    offset: 0,
}

// ground result for a level without ground collision data (rainbow cloud)
const defaultPlane: GroundPlane = {
    normal: vec3.clone(Vec3UnitY),
    type: -1,
    offset: 0,
};

export function findGroundPlane(tree: CollisionTree | null, x: number, z: number): GroundPlane {
    x/= 100;
    z/= 100;
    if (tree === null)
        return defaultPlane;
    while (true) {
        const test = x * tree.line[0] + z * tree.line[1] + tree.line[2];
        if (test > 0) {
            if (tree.posPlane)
                return tree.posPlane;
            if (tree.posSubtree === null)
                return nullPlane;
            tree = tree.posSubtree;
        } else {
            if (tree.negPlane)
                return tree.negPlane;
            if (tree.negSubtree === null)
                return nullPlane;
            tree = tree.negSubtree;
        }
    }
}

function parseCollisionTree(dataMap: DataMap, addr: number): CollisionTree {
    const view = dataMap.getView(addr);
    const planeData = view.getUint32(0x00);
    const treeData = view.getUint32(0x04);
    // can be followed by another pair for ceilings

    const planeList: GroundPlane[] = [];
    const planeView = dataMap.getView(planeData);
    const treeView = dataMap.getView(treeData);

    return parseCollisionSubtree(treeView, planeView, planeList, 0);
}

function parseCollisionSubtree(treeView: DataView, planeView: DataView, planeList: GroundPlane[], index: number): CollisionTree {
    const offs = index * 0x1C;
    const line = getVec3(treeView, offs + 0x00);
    const posTreeIdx = treeView.getInt32(offs + 0x0C);
    const negTreeIdx = treeView.getInt32(offs + 0x10);
    const posPlaneIdx = treeView.getInt32(offs + 0x14);
    const negPlaneIdx = treeView.getInt32(offs + 0x18);

    function getPlane(index: number): GroundPlane | null {
        if (index === -1)
            return null;
        while (planeList.length < index + 1) {
            const start = planeList.length * 0x14;
            const x = planeView.getFloat32(start + 0x00);
            const y = planeView.getFloat32(start + 0x04);
            const z = planeView.getFloat32(start + 0x08);
            planeList.push({
                normal: vec3.fromValues(x, z, y), // the plane equation uses z up
                offset: planeView.getFloat32(start + 0x0C),
                type: planeView.getUint32(start + 0x10) >>> 8,
            });
        }
        return planeList[index];
    }

    const posSubtree = posTreeIdx > -1 ? parseCollisionSubtree(treeView, planeView, planeList, posTreeIdx) : null;
    const negSubtree = negTreeIdx > -1 ? parseCollisionSubtree(treeView, planeView, planeList, negTreeIdx) : null;
    const posPlane = getPlane(posPlaneIdx);
    const negPlane = getPlane(negPlaneIdx);

    return { line, posSubtree, posPlane, negSubtree, negPlane };
}

export const enum InteractionType {
    PokefluteA      = 0x05,
    PokefluteB      = 0x06,
    PokefluteC      = 0x07,
    // sent if a pester ball would have hit if another object hadn't been closer
    PesterAlmost    = 0x08,
    PesterHit       = 0x09,
    PesterLanded    = 0x0A,
    // Unused         0x0B

    // the apple signals are analogous to the pester ball ones
    AppleAlmost     = 0x0C,
    AppleHit        = 0x0D,
    AppleLanded     = 0x0E,
    FindApple       = 0x0F,
    NearPlayer      = 0x10,
    CheckCollision  = 0x11, // check for collision outside of normal process
    PhotoTaken      = 0x12, // sent to every object when a photo is taken
    EnterRoom       = 0x13,
    GravelerLanded  = 0x14,
    AppleRemoved    = 0x15,
    TargetRemoved   = 0x16,
    PhotoFocus      = 0x17, // checks if the camera is focused at the same pokemon for a long time
    PhotoSubject    = 0x18,
    Collided        = 0x1A, // collided with another object, at most once per collision round (in game)

    EndMarker       = 0x3A,
    // not used by game
    Basic,
    Random,
    Flag,
    NotFlag,
    Behavior,
    NonzeroBehavior,
    NoTarget,
    HasTarget,
    HasApple,
    OverSurface,
    Unknown,
}

export interface StateEdge {
    type: InteractionType;
    param: number;
    index: number;
    auxFunc: number;
}

interface Signal {
    value: number;
    target: number;
    condition: InteractionType;
    conditionParam: number;
}

export interface StateBlock {
    animation: number;
    motion: Motion[] | null;
    auxAddress: number;
    force: boolean;
    signals: Signal[];
    wait: WaitParams | null;

    flagSet: number;
    flagClear: number;
    ignoreGround?: boolean;
    eatApple?: boolean;
    forwardSpeed?: number;
    tangible?: boolean;
    splash?: Splash;
    spawn?: SpawnData;

    edges: StateEdge[];
}

export interface WaitParams {
    // allows the standard set of interactions (proximity, pester ball, etc)
    // but cannot prevent the object from responding to signals
    allowInteraction: boolean;
    interactions: StateEdge[];
    duration: number;
    durationRange: number;
    loopTarget: number;
    endCondition: number;
}

interface State {
    startAddress: number;
    blocks: StateBlock[];
    doCleanup: boolean;
}

interface StateGraph {
    states: State[];
    animations: AnimationData[];
}

function parseStateGraph(dataMap: DataMap, addr: number, nodes: GFXNode[]): StateGraph {
    const defaultAnimation = dataMap.deref(addr);
    const initFunc = dataMap.deref(addr + 0x04); // used to set initial state

    const states: State[] = [];
    const animationAddresses: number[] = [];

    if (defaultAnimation !== 0)
        animationAddresses.push(defaultAnimation);

    parseStateSubgraph(dataMap, initFunc, states, animationAddresses);
    const animations = parseAnimations(dataMap, animationAddresses, nodes);

    return {states, animations};
}

export const enum GeneralFuncs {
    RunProcess  = 0x08C28,
    EndProcess  = 0x08F2C,

    Signal      = 0x0B774,
    SignalAll   = 0x0B830,
    Yield       = 0x0BCA8,

    AnimateNode = 0x11090,

    ArcTan      = 0x19ABC,
    Random      = 0x19DB0,
    RandomInt   = 0x19E14,
    GetRoom     = 0xE2184,
}

export const enum StateFuncs {
    SetAnimation    = 0x35F138,
    ForceAnimation  = 0x35F15C,
    SetMotion       = 0x35EDF8,
    SetState        = 0x35EC58,
    InteractWait    = 0x35FBF0,
    Wait            = 0x35FC54,
    Random          = 0x35ECAC,
    RunAux          = 0x35ED90,
    EndAux          = 0x35EDC8,
    Cleanup         = 0x35FD70,
    EatApple        = 0x36010C,

    SpawnActorHere  = 0x35FE24,
    SpawnActor      = 0x363C48,

    SplashAt        = 0x35E174,
    SplashBelow     = 0x35E1D4,
    DratiniSplash   = 0x35E238,
    SplashOnImpact  = 0x35E298,

    // only in cave
    DanceInteract   = 0x2C1440,
    DanceInteract2  = 0x2C0140,
}

export const enum ObjectField {
    ObjectFlags     = 0x08,
    Tangible        = 0x10,
    // on the root node
    TranslationX    = 0x1C,
    TranslationY    = 0x20,
    TranslationZ    = 0x24,
    // on the root node transform
    Pitch           = 0x1C,
    Yaw             = 0x20,
    Roll            = 0x24,
    ScaleX          = 0x2C,
    ScaleY          = 0x30,
    ScaleZ          = 0x34,

    Transform       = 0x4C,
    ParentFlags     = 0x50, // actually on the parent object

    Apple           = 0x64,
    Target          = 0x70,
    Behavior        = 0x88,
    StateFlags      = 0x8C,
    Timer           = 0x90,
    ForwardSpeed    = 0x98,
    VerticalSpeed   = 0x9C,
    MovingYaw       = 0xA0,
    LoopTarget      = 0xA4,
    FrameTarget     = 0xA8,
    Transitions     = 0xAC,

    StoredValues    = 0xB0,
    Mystery         = 0xC0,
    GroundList      = 0xCC,

    Path            = 0xE8,
    PathParam       = 0xEC,
}

export const enum EndCondition {
    Animation   = 0x01,
    Motion      = 0x02,
    Timer       = 0x04,
    Aux         = 0x08,
    Target      = 0x10,
    Pause       = 0x20, // used to pause motion, not as a condition
    Misc        = 0x1000,

    Dance       = 0x010000, // special dance-related behavior in cave
    // from flags on the parent object
    Hidden      = 0x020000,
    PauseAnim   = 0x040000,
    // a separate set of object flags
    Collide     = 0x080000,
    AllowBump   = 0x200000,
}

function emptyStateBlock(block: StateBlock): boolean {
    return block.animation === -1 && block.motion === null && block.signals.length === 0 && block.flagClear === 0 && block.auxAddress === -1 && block.spawn === undefined &&
    block.flagSet === 0 && block.ignoreGround === undefined && block.eatApple === undefined && block.forwardSpeed === undefined && block.tangible === undefined && block.splash === undefined;
}

const motionParser = new MotionParser();

export const fakeAuxFlag = 0x1000;

const dummyRegs: MIPS.Register[] = nArray(2, () => <MIPS.Register> {value: 0, lastOp: MIPS.Opcode.NOP});
class StateParser extends MIPS.NaiveInterpreter {
    public state: State;
    public currWait: WaitParams;
    public currBlock: StateBlock;
    public trivial = true;
    public stateIndex = -1;
    public recentRandom = 0;
    public loadAddress = 0;

    constructor(public dataMap: DataMap, startAddress: number, public allStates: State[], public animationAddresses: number[]) {
        super();
        this.state = {
            startAddress,
            blocks: [],
            doCleanup: false,
        };
        this.trivial = true;
        this.stateIndex = -1;
    }

    public parse(): boolean {
        return super.parseFromView(this.dataMap.getView(this.state.startAddress));
    }

    public reset(): void {
        super.reset();
        this.trivial = true;
        this.recentRandom = 0;
        this.loadAddress = 0;
        this.stateIndex = -1;
        this.currWait = {
            allowInteraction: true,
            interactions: [],
            duration: 0,
            durationRange: 0,
            loopTarget: 0,
            endCondition: 0,
        };
        this.currBlock = {
            edges: [],
            animation: -1,
            force: false,
            motion: null,
            auxAddress: -1,
            signals: [],
            flagSet: 0,
            flagClear: 0,
            wait: null,
        };
    }

    private markNontrivial(): void {
        if (this.trivial) {
            assert(this.stateIndex === -1);
            this.trivial = false;
            this.stateIndex = this.allStates.length;
            this.allStates.push(this.state);
        }
    }

    protected handleFunction(func: number, a0: MIPS.Register, a1: MIPS.Register, a2: MIPS.Register, a3: MIPS.Register, stackArgs: MIPS.Register[], branch: MIPS.BranchInfo | null): number {
        if (func !== StateFuncs.SetState || branch !== null)
            this.markNontrivial();
        switch (func) {
            case StateFuncs.SetState: {
                const index = a1.value === 0 ? -1 : parseStateSubgraph(this.dataMap, a1.value, this.allStates, this.animationAddresses);
                if (index === -1) {
                    // no next state, we're done
                    assert(branch === null, `bad transition to null ${hexzero(this.state.startAddress, 8)} ${branch?.comparator}`);
                    return 0;
                }
                if (this.trivial && branch === null) {
                    // this state can be ignored, point to the real one
                    this.stateIndex = index;
                    return 0;
                }
                let type = InteractionType.Basic;
                let param = 0;
                if (branch !== null) {
                    param = branch.comparator.value;
                    if (branch.comparator.lastOp === MIPS.Opcode.ANDI || branch.comparator.lastOp === MIPS.Opcode.AND) {
                        type = InteractionType.Flag;
                        if (branch.op === MIPS.Opcode.BNE || branch.op === MIPS.Opcode.BNEL)
                            type = InteractionType.NotFlag;
                        param = branch.comparator.value;
                    } else if (branch.comparator.lastOp === MIPS.Opcode.ADDIU) {
                        type = branch.comparator.value < 10 ? InteractionType.Behavior : InteractionType.OverSurface;
                    } else if (branch.comparator.lastOp === MIPS.Opcode.LW) {
                        // see if we are testing an object member against 0
                        switch (branch.comparator.value) {
                            case ObjectField.Behavior: {
                                type = InteractionType.Behavior;
                                if (branch.op === MIPS.Opcode.BEQ || branch.op === MIPS.Opcode.BEQL)
                                    type = InteractionType.NonzeroBehavior;
                            } break;
                            case ObjectField.Target: {
                                type = InteractionType.NoTarget;
                                if (branch.op === MIPS.Opcode.BEQ || branch.op === MIPS.Opcode.BEQL)
                                    type = InteractionType.HasTarget;
                            } break;
                            case ObjectField.Apple: {
                                type = InteractionType.HasApple;
                            } break;
                            default:
                                this.valid = false;
                                type = InteractionType.Unknown;
                        }
                    } else if (branch.comparator.lastOp === MIPS.Opcode.ORI) {
                        // this is admittedly a bit of a stretch, but it's a very rare condition
                        type = InteractionType.OverSurface;
                    } else {
                        this.valid = false;
                        type = InteractionType.Unknown;
                    }
                }
                this.addEdge({type, param, index, auxFunc: 0});
            } break;
            case StateFuncs.Random: {
                let randomStart = a1.value;
                if (a1.value < 0x80000000)
                    randomStart = this.loadAddress; // only used by one starmie state
                const randomView = this.dataMap.getView(randomStart);
                let offs = 0;
                let total = 0;
                while (true) {
                    const weight = randomView.getInt32(offs + 0x00);
                    if (weight === 0)
                        break;
                    total += weight;
                    offs += 8;
                }
                assert(total > 0, `empty random transition`);
                offs = 0;
                while (true) {
                    const weight = randomView.getInt32(offs + 0x00);
                    if (weight === 0)
                        break;
                    const stateAddr = randomView.getUint32(offs + 0x04);
                    const state = parseStateSubgraph(this.dataMap, stateAddr, this.allStates, this.animationAddresses);
                    this.addEdge({ type: InteractionType.Random, index: state, param: weight / total, auxFunc: 0 });
                    offs += 8;
                }
                this.done = true;
            } break;
            case StateFuncs.ForceAnimation:
                this.currBlock.force = true;
            case StateFuncs.SetAnimation: {
                if (a1.lastOp !== MIPS.Opcode.ADDIU || a1.value < 0x80000000) {
                    this.valid = false;
                    break;
                }
                let index = this.animationAddresses.findIndex((a) => a == a1.value);
                if (index === -1) {
                    index = this.animationAddresses.length;
                    this.animationAddresses.push(a1.value);
                }
                this.currBlock.animation = index;
            } break;
            case StateFuncs.SetMotion: {
                if (a1.value === 0x802D6B14 && this.state.startAddress === 0x802DB4A8)
                    break; // this function chooses motion based on the behavior param, fix later
                if (a1.value !== 0) {
                    motionParser.parse(this.dataMap, a1.value, this.animationAddresses);
                    this.currBlock.motion = motionParser.blocks;
                } else
                    this.currBlock.motion = [];
            } break;
            case StateFuncs.Wait:
                this.currWait.allowInteraction = false;
            case StateFuncs.InteractWait: {
                this.currWait.endCondition = a1.value;
                this.currBlock.wait = this.currWait;
                this.state.blocks.push(this.currBlock);

                this.currWait = {
                    allowInteraction: true,
                    interactions: [],
                    duration: 0,
                    durationRange: 0,
                    loopTarget: 0,
                    endCondition: 0,
                };
                this.currBlock = {
                    edges: [],
                    animation: -1,
                    force: false,
                    motion: null,
                    auxAddress: -1,
                    signals: [],
                    flagSet: 0,
                    flagClear: 0,
                    wait: null,
                };
            } break;
            // first waits a second with hard-coded transitions, then the loop like DanceInteract
            case StateFuncs.DanceInteract2:
                dummyRegs[0].lastOp = MIPS.Opcode.ADDIU;
                dummyRegs[0].value = 0x802C6D60;
                dummyRegs[1].lastOp = MIPS.Opcode.LW;
                this.handleStore(MIPS.Opcode.SW, dummyRegs[0], dummyRegs[1], ObjectField.Transitions);
                dummyRegs[0].lastOp = MIPS.Opcode.ADDIU;
                dummyRegs[0].value = 30;
                dummyRegs[1].lastOp = MIPS.Opcode.LW;
                this.handleStore(MIPS.Opcode.SW, dummyRegs[0], dummyRegs[1], ObjectField.Timer);
                dummyRegs[0].value = EndCondition.Timer;
                this.handleFunction(StateFuncs.InteractWait, a0, dummyRegs[0], a2, a3, stackArgs, branch);
            // calls interactWait in a loop until there's no song playing
            case StateFuncs.DanceInteract: {
                dummyRegs[0].lastOp = MIPS.Opcode.LW;
                this.handleStore(MIPS.Opcode.SW, a1, dummyRegs[0], ObjectField.Transitions);
                dummyRegs[0].value = EndCondition.Dance;
                this.handleFunction(StateFuncs.InteractWait, a0, dummyRegs[0], a2, a3, stackArgs, branch);
            } break;
            case GeneralFuncs.Yield: {
                // this is usually used to yield until the next frame, but can also serve as an interactionless wait
                // so add a new wait condition to the current block, preserving any data for the next wait
                if (a0.value > 1) {
                    this.currBlock.wait = {
                        allowInteraction: false,
                        interactions: [],
                        duration: a0.value / 30,
                        durationRange: 0,
                        loopTarget: 0,
                        endCondition: EndCondition.Timer,
                    };
                    this.state.blocks.push(this.currBlock);
                    this.currBlock = {
                        edges: [],
                        animation: -1,
                        force: false,
                        motion: null,
                        auxAddress: -1,
                        signals: [],
                        flagSet: 0,
                        flagClear: 0,
                        wait: null,
                    };
                }
            } break;
            case GeneralFuncs.SignalAll: {
                // only fails because we aren't actually handling conditionals
                // assert(a0.value === 3, `signal to unknown link ${hexzero(this.state.startAddress, 8)} ${a0.value}`);
                this.currBlock.signals.push({value: a1.value, target: 0, condition: InteractionType.Basic, conditionParam: 0});
            } break;
            case GeneralFuncs.Signal: {
                const target = (a0.value > 0x80000000 || a0.value === ObjectField.Target) ? a0.value : 0;
                this.currBlock.signals.push({value: a1.value, target, condition: InteractionType.Basic, conditionParam: 0});
            } break;
            case GeneralFuncs.RunProcess: {
                if (a1.value === 0x80000000 + GeneralFuncs.AnimateNode)
                    break;
                spawnParser.parseFromView(this.dataMap.getView(a1.value));
                if (spawnParser.foundSpawn) {
                    assert(spawnParser.data.id !== 0 && this.currBlock.spawn === undefined);
                    this.currBlock.spawn = spawnParser.data;
                }
            } break;
            case StateFuncs.RunAux: {
                if (a1.value === 0x802C7F74) { // lapras uses an auxiliary function for its normal state logic
                    this.handleFunction(StateFuncs.SetState, a0, a1, a2, a3, stackArgs, null);
                    this.done = true;
                } else
                    this.currBlock.auxAddress = a1.value;
            } break;
            case StateFuncs.EndAux: {
                assert(this.currBlock.auxAddress === -1);
                this.currBlock.auxAddress = 0;
            }

            case GeneralFuncs.RandomInt: {
                this.recentRandom = a0.value;
                return a0.value;
            }
            case StateFuncs.Cleanup: {
                this.state.doCleanup = true;
            } break;
            case StateFuncs.EatApple: {
                this.currBlock.eatApple = true;
            } break;
            case StateFuncs.SplashAt:
            case StateFuncs.SplashBelow:
            case StateFuncs.DratiniSplash: {
                assert(this.currBlock.splash === undefined)
                this.currBlock.splash = {
                    kind: "splash",
                    onImpact: false,
                    index: -1,
                    scale: Vec3One,
                };
            } break;
            default:
                if (func > 0x200000 && func < 0x350200) {
                    // see if level-specific functions are spawning something
                    spawnParser.parseFromView(this.dataMap.getView(0x80000000 + func));
                    if (spawnParser.foundSpawn) {
                        assert(spawnParser.data.id !== 0 && this.currBlock.spawn === undefined);
                        this.currBlock.spawn = spawnParser.data;
                    }
                }
                this.valid = false;
        }
        return 0;
    }

    protected handleStore(op: MIPS.Opcode, value: MIPS.Register, target: MIPS.Register, offset: number) {
        this.markNontrivial();
        if (op === MIPS.Opcode.SW && (target.lastOp === MIPS.Opcode.LW || target.lastOp === MIPS.Opcode.NOP)) {
            // this looks like setting a struct field - LW comes from loading the object struct from the parent,
            // while NOP probably means using one of the function arguments
            switch (offset) {
                case ObjectField.Transitions: { // interactions
                    if (value.value === 0)
                        return;
                    let transitionStart = value.value;
                    if (value.lastOp !== MIPS.Opcode.ADDIU || value.value < 0x80000000)
                        transitionStart = this.loadAddress;
                    const tView = this.dataMap.getView(transitionStart);
                    let offs = 0;
                    while (true) {
                        const type: InteractionType = tView.getInt32(offs + 0x00);
                        if (type === InteractionType.EndMarker)
                            break;
                        const stateAddr = tView.getUint32(offs + 0x04);
                        const param = tView.getFloat32(offs + 0x08);
                        let auxFunc = tView.getUint32(offs + 0x0C);
                        // special handling for poliwag, which sets some animations in aux
                        if (auxFunc === 0x802DCB0C)
                            auxFunc = 0x1000 | parseStateSubgraph(this.dataMap, auxFunc, this.allStates, this.animationAddresses);
                        offs += 0x10;
                        this.currWait.interactions.push({
                            type,
                            param,
                            index: stateAddr > 0 ? parseStateSubgraph(this.dataMap, stateAddr, this.allStates, this.animationAddresses) : -1,
                            auxFunc,
                        });
                    }
                } break;
                case ObjectField.Timer: {
                    if (value.lastOp !== MIPS.Opcode.ADDIU)
                        this.valid = false; // starmie sets this using a separate variable
                    this.currWait.duration = value.value / 30;
                    // hacky way to recover random ranges: when we see calls to randomInt, we set v0 to the maximum
                    // then, if we used random recently, and duration is long enough to have been a sum with v0, assume it was random
                    if (this.recentRandom > 30 && this.recentRandom <= value.value) {
                        this.currWait.duration -= this.recentRandom / 30;
                        this.currWait.durationRange = this.recentRandom / 30;
                        this.recentRandom = 0;
                    }
                } break;
                case ObjectField.LoopTarget: {
                    this.currWait.loopTarget = value.value;
                } break;

                case ObjectField.StateFlags: {
                    if (value.lastOp === MIPS.Opcode.ORI || value.lastOp === MIPS.Opcode.OR)
                        this.currBlock.flagSet |= (value.value >>> 0);
                    else if ((value.lastOp === MIPS.Opcode.ANDI || value.lastOp === MIPS.Opcode.AND) && value.value < 0)
                        this.currBlock.flagClear |= ~(value.value >>> 0);
                    else
                        console.warn('unknown flag op', value.lastOp, hexzero(value.value, 8))
                } break;
                case ObjectField.ParentFlags: {
                    if (value.lastOp === MIPS.Opcode.ORI || value.lastOp === MIPS.Opcode.OR)
                        this.currBlock.flagSet |= value.value * EndCondition.Hidden;
                    else if ((value.lastOp === MIPS.Opcode.ANDI || value.lastOp === MIPS.Opcode.AND) && value.value < 0)
                        this.currBlock.flagClear |= (~value.value) * EndCondition.Hidden;
                    else if (value.lastOp === MIPS.Opcode.NOP && value.value === 0)
                        this.currBlock.flagClear |= EndCondition.Hidden | EndCondition.PauseAnim;
                } break;
                case ObjectField.Tangible: {
                    this.currBlock.tangible = value.value === 1;
                } break;
                case ObjectField.GroundList: {
                    this.currBlock.ignoreGround = value.value !== 0;
                } break;
                case ObjectField.FrameTarget:
                case ObjectField.Apple:
                case ObjectField.StoredValues:
                case ObjectField.Mystery:
                    break;

                default:
                    this.valid = false;
            }
        } else if (op === MIPS.Opcode.SWC1 && (target.lastOp === MIPS.Opcode.LW || target.lastOp === MIPS.Opcode.NOP) && offset === ObjectField.ForwardSpeed) {
            this.currBlock.forwardSpeed = bitsAsFloat32(value.value);
        } else if (op === MIPS.Opcode.SH && (target.lastOp === MIPS.Opcode.LW || target.lastOp === MIPS.Opcode.NOP)) {
            if (offset === ObjectField.ObjectFlags) {
                if (value.lastOp === MIPS.Opcode.ORI || value.lastOp === MIPS.Opcode.OR){
                    this.currBlock.flagSet |= (value.value >>> 9) * EndCondition.Collide;
                } else if ((value.lastOp === MIPS.Opcode.ANDI || value.lastOp === MIPS.Opcode.AND) && (value.value >>> 0) > 0x8000){
                    this.currBlock.flagClear |= (~value.value >>> 9) * EndCondition.Collide;
                }
            }
        } else {
            if (op === MIPS.Opcode.SW && value.value > 0x80000000 && this.loadAddress === 0)
                this.loadAddress = value.value;
            this.valid = false;
        }
    }

    protected finish(): void {
        if (!emptyStateBlock(this.currBlock))
            this.state.blocks.push(this.currBlock);
    }

    private addEdge(edge: StateEdge): void {
        if (emptyStateBlock(this.currBlock) && this.state.blocks.length > 0) {
            // we haven't done anything since the last block, so append it there
            this.state.blocks[this.state.blocks.length - 1].edges.push(edge);
        } else {
            this.currBlock.edges.push(edge);
            this.state.blocks.push(this.currBlock);
            // don't worry about any wait data: it will be overwritten by the state change
            // or used later in this state
            this.currBlock = {
                edges: [],
                animation: -1,
                force: false,
                motion: null,
                auxAddress: -1,
                signals: [],
                flagSet: 0,
                flagClear: 0,
                wait: null,
            };
        }
    }
}

function parseStateSubgraph(dataMap: DataMap, addr: number, states: State[], animationAddresses: number[]): number {
    const existingState = states.findIndex((s) => s.startAddress === addr);
    if (existingState >= 0)
        return existingState;

    const parser = new StateParser(dataMap, addr, states, animationAddresses);
    parser.parse();

    if (!parser.trivial)
        fixupState(states[parser.stateIndex], animationAddresses);

    return parser.stateIndex;
}

export const fakeAux = 0x123456;

// make minor changes to specific states
function fixupState(state: State, animationAddresses: number[]): void {
    switch (state.startAddress) {
        // switch statements
        case 0x802DBBA0: {
            state.blocks[0].edges[0].type = InteractionType.Behavior;
            state.blocks[0].edges[0].param = 1;
            state.blocks[0].edges[1].type = InteractionType.Behavior;
            state.blocks[0].edges[1].param = 2;
            state.blocks[0].edges[2].type = InteractionType.Behavior;
            state.blocks[0].edges[2].param = 3;
            state.blocks[0].edges[3].type = InteractionType.NonzeroBehavior;
        } break;
        case 0x802D8BB8: {
            state.blocks[0].edges[0].type = InteractionType.Behavior;
            state.blocks[0].edges[0].param = 3;
            state.blocks[0].edges[1].type = InteractionType.Behavior;
            state.blocks[0].edges[1].param = 4;
        } break;
        // does one of two options based on distance - we just take the first
        case 0x802DDB60: {
            state.blocks[0].edges.push(state.blocks[1].edges[1]);
            state.blocks.splice(1);
        } break;
        // ignore porygon camera shot loop
        case 0x802DD398: {
            state.blocks[0].edges = [];
        } break;
        // squirtle clears its bobbing behavior in an odd way
        case 0x802CB9BC:
        case 0x802CBC74:
        case 0x802CBD74: {
            state.blocks[0].auxAddress = 0;
        } break;
        // add fake handling for lapras photo interaction
        case 0x802C7F74: {
            state.blocks[0].wait!.allowInteraction = true;
            state.blocks[0].wait!.interactions.push({ type: InteractionType.PhotoSubject, param: 0, index: -1, auxFunc: fakeAux });
            state.blocks[1].wait!.allowInteraction = true;
            state.blocks[1].wait!.interactions.push({ type: InteractionType.PhotoSubject, param: 0, index: -1, auxFunc: fakeAux });
        } break;
        // fix second signal value (conditionals again)
        case 0x802D97B8: {
            state.blocks[1].signals[0].condition = InteractionType.Behavior;
            state.blocks[1].signals[0].conditionParam = 1;
            state.blocks[1].signals[1].condition = InteractionType.Behavior;
            state.blocks[1].signals[1].conditionParam = 2;
            state.blocks[1].signals[1].value = 0x28;
        } break;
        // restrict weepinbell pool signal
        case 0x802BF894: {
            state.blocks[2].signals[0].condition = InteractionType.OverSurface;
        } break;
        // ignore victreebel distance check
        case 0x802BFE34: {
            assert(state.blocks.length === 3);
            state.blocks.splice(0, 1);
        } break;
        // send signal from motion
        case 0x802DC4F0:
        case 0x802DC590: {
            state.blocks[1].signals.push({
                target: 0,
                value: 0x1C,
                condition: InteractionType.OverSurface,
                conditionParam: 0,
            });
        } break;
        // set splash scale
        case 0x802CA020: {
            assertExists(state.blocks[0].splash).scale = vec3.fromValues(15, 15, 10);
        } break;
        // state transition after cleanup - maybe fix this automatically?
        case 0x802BEB24: {
            assert(state.doCleanup);
            state.blocks[0].edges = [];
        } break;
        // staryu random animation
        case 0x802CD0B8: {
            const index = animationAddresses.indexOf(0x802D3808);
            assert(index >= 0);
            // create a duplicate block, and use actor code to randomly pick one
            state.blocks.push({
                animation: index,
                force: false,
                edges: state.blocks[0].edges, // copy existing edges

                motion: null,
                auxAddress: -1,
                wait: null,
                flagClear: 0,
                flagSet: 0,
                signals: [],
            });
        } break;
        // let actor choose signals
        case 0x802CD4F4: {
            state.blocks[1].signals[0].condition = InteractionType.Unknown;
            state.blocks[1].signals[1].condition = InteractionType.Unknown;
            state.blocks[1].signals[2].condition = InteractionType.Unknown;
        } break;
        // mark edge as off by default
        case 0x802D9074: {
            state.blocks[0].edges[0].type = InteractionType.Unknown;
        } break;
        // these spawns look like they were copied from elsewhere, without changing the ID
        // they work in game, but break our simple detection logic
        case 0x802D9B8C: {
            assert(state.blocks[0].spawn !== undefined);
            state.blocks[0].spawn.id = 1002;
        } break;
        case 0x802D9C84: {
            assert(state.blocks[0].spawn !== undefined);
            state.blocks[0].spawn.id = 5;
        } break;
        // carry over timer from previous state
        case 0x802E7D04: {
            assert(state.blocks[0].wait !== null);
            state.blocks[0].wait.duration = 6;
        } break;
        // add psyduck initial state
        case 0x802DB0A0: {
            const firstEdge = state.blocks[0].edges[0];
            state.blocks[0].edges.splice(1, 0, {
                param: 2,
                type: firstEdge.type,
                index: firstEdge.index,
                auxFunc: firstEdge.auxFunc,
            });
        } break;
        // add signal condition
        case 0x802DB78C: {
            state.blocks[2].signals[0].condition = InteractionType.Behavior;
            state.blocks[2].signals[0].conditionParam = 2;
        } break;
    }
}

interface SpawnData {
    id: number;
    behavior: number;
    scale: vec3;
    yaw: Direction;
}

class SpawnParser extends MIPS.NaiveInterpreter {
    public dataMap: DataMap;
    public data: SpawnData;
    public foundSpawn = false;

    public reset(): void {
        super.reset();
        this.data = {
            id: 0,
            behavior: -1,
            scale: vec3.clone(Vec3One),
            yaw: Direction.Constant,
        };
        this.foundSpawn = false;
    }

    protected handleFunction(func: number, a0: MIPS.Register, a1: MIPS.Register, a2: MIPS.Register, a3: MIPS.Register, stackArgs: MIPS.Register[]): number {
        if (func === StateFuncs.SpawnActor) {
            assert(this.data.id !== 0);
            this.data.behavior = 0;
            this.foundSpawn = true;
        } else if (func === StateFuncs.SpawnActorHere) {
            this.data.id = a1.value;
            this.foundSpawn = true;
        }
        return 0;
    }

    protected handleStore(op: MIPS.Opcode, value: MIPS.Register, target: MIPS.Register, offset: number): void {
        if (op === MIPS.Opcode.SW && offset === 0 && target.lastOp === MIPS.Opcode.ADDIU && this.data.id === 0)
            this.data.id = value.value;
        if (!this.foundSpawn)
            return; // can't modify parameters until we have a pointer
        if (op === MIPS.Opcode.SW && target.lastOp === MIPS.Opcode.LW && offset === ObjectField.Behavior)
            this.data.behavior = value.value;
        else if (op === MIPS.Opcode.SWC1 && target.lastOp === MIPS.Opcode.LW && target.value === ObjectField.Transform && value.lastOp === MIPS.Opcode.MULS) {
            switch (offset) {
                case ObjectField.ScaleX:
                case ObjectField.ScaleY:
                case ObjectField.ScaleZ:
                    this.data.scale[(offset - ObjectField.ScaleX) >>> 2] = value.value; break;
            }
        } else if (op === MIPS.Opcode.SWC1 && target.lastOp === MIPS.Opcode.LW && target.value === ObjectField.Transform && value.lastOp === MIPS.Opcode.ADDS) {
            switch (offset) {
                case ObjectField.ScaleX:
                case ObjectField.ScaleY:
                case ObjectField.ScaleZ:
                    this.data.scale[(offset - ObjectField.ScaleX) >>> 2] = 2; break;
                case ObjectField.Yaw:
                    this.data.yaw = Direction.Backward; break;
            }
        } else if (op === MIPS.Opcode.SWC1 && target.lastOp === MIPS.Opcode.LW && target.value === ObjectField.Transform && value.lastOp === MIPS.Opcode.LWC1) {
            if (offset === ObjectField.Yaw && value.value === ObjectField.Yaw)
                this.data.yaw = Direction.Forward;
        }
    }

    protected finish(): void {
        if (!this.foundSpawn)
            return;
        if (this.data.id > 0x80000000)
            this.data.id = this.dataMap.deref(this.data.id);
        for (let i = 0; i < 3; i++) {
            let value = this.data.scale[i];
            if (value === 1)
                continue;
            if (value > 0x80000000)
                value = this.dataMap.deref(value);
            this.data.scale[i] = bitsAsFloat32(value);
        }
    }
}

const spawnParser = new SpawnParser();

export interface FishEntry {
    probability: number;
    id: number;
}

function parseFishTable(dataMap: DataMap, id: number): FishEntry[] {
    let fishStart = 0;
    switch (id) {
        case 16: fishStart = 0x802CC004; break;
        case 18: fishStart = 0x802EE120; break;
        case 20: fishStart = 0x802C6368; break;
        case 22: fishStart = 0x802E2908; break;
        case 24: fishStart = 0x802E0EA4; break;
        case 26: fishStart = 0x802D29B4; break;
    }
    if (fishStart === 0)
        return [];
    const fish: FishEntry[] = [];
    const view = dataMap.getView(fishStart);
    let offs = 0;
    let total = 0;
    while (true) {
        const probability = view.getInt8(offs + 0x00);
        const spawner = view.getUint32(offs + 0x04);
        offs += 8;

        if (probability < 0)
            break; // table ended
        total += probability;
        if (spawner === 0) {
            fish.push({ probability, id: 0 });
            break;
        }
        spawnParser.parseFromView(dataMap.getView(spawner));
        assert(spawnParser.data.id !== 0);
        fish.push({ probability, id: spawnParser.data.id });
    }
    if (id === 22)
        total = 100;
    for (let i = 0; i < fish.length; i++)
        fish[i].probability /= total;
    return fish;
}