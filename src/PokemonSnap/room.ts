import * as F3DEX2 from "./f3dex2";
import * as RDP from "../Common/N64/RDP";

import ArrayBufferSlice from "../ArrayBufferSlice";
import { RSPSharedOutput, OtherModeH_Layout, OtherModeH_CycleType } from "../BanjoKazooie/f3dex";
import { vec3, vec4 } from "gl-matrix";
import { assert, hexzero, assertExists, nArray } from "../util";
import { TextFilt, ImageFormat, ImageSize } from "../Common/N64/Image";
import { Endianness } from "../endian";
import { getPointHermite } from "../Spline";


export interface Level {
    sharedCache: RDP.TextureCache;
    skybox: GFXNode | null;
    rooms: Room[];
    objectInfo: ObjectDef[];
    collision: CollisionTree | null;
}

export interface Room {
    graph: GFXNode;
    objects: ObjectSpawn[];
}

export interface Model {
    sharedOutput: RSPSharedOutput;
    rspState: F3DEX2.RSPState;
    rspOutput: F3DEX2.RSPOutput | null;
}

export interface ObjectSpawn {
    id: number;
    pos: vec3;
    euler: vec3;
    scale: vec3;
}

export interface ObjectDef {
    id: number;
    graph: GFXNode;
    sharedOutput: RSPSharedOutput;
    scale: vec3;
    flags: number;
    spawn: SpawnType;
}

export interface LevelArchive {
    Name: number,
    Data: ArrayBufferSlice,
    Code: ArrayBufferSlice,
    StartAddress: number,
    CodeStartAddress: number,
    Rooms: number,
    Objects: number,
    Collision: number,
};

export interface DataRange {
    data: ArrayBufferSlice;
    start: number;
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
    switch(addr) {
        case 0x362EE0: // normal spawn
        case 0x362E10: // spawn plus some other gfx function?
            return SpawnType.GROUND;
        case 0x362E5C: // normal flying
        case 0x362DC4: // flying plus other gfx function
            return SpawnType.FLYING;
    }
    return SpawnType.OTHER;
}

export function parseLevel(archives: LevelArchive[]): Level {
    const level = archives[0];
    const view = level.Data.createDataView();

    const rooms: Room[] = [];
    let offs = level.Rooms - level.StartAddress;
    const pathRooms = view.getUint32(offs + 0x00);
    const nonPathRooms = view.getUint32(offs + 0x04);
    const skyboxDescriptor = view.getUint32(offs + 0x08);

    const sharedCache = new RDP.TextureCache();

    let skybox: GFXNode | null = null;

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

    if (skyboxDescriptor > 0) {
        const skyboxDL = view.getUint32(skyboxDescriptor - level.StartAddress);
        const skyboxMats = view.getUint32(skyboxDescriptor + 0x08 - level.StartAddress);
        const materials = skyboxMats !== 0 ? parseMaterialData(dataMap, dataMap.deref(skyboxMats)) : [];
        const skyboxState = new F3DEX2.RSPState([], new RSPSharedOutput(), dataMap);
        const skyboxModel = runRoomDL(dataMap, skyboxDL, skyboxState, materials);
        skybox = {
            model: skyboxModel,
            translation: vec3.create(),
            euler: vec3.create(),
            scale: vec3.fromValues(1, 1, 1),
            children: [],
            track: null,
        };
    }

    offs = pathRooms - level.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(dataMap, view.getUint32(offs), sharedCache));
        offs += 4;
    }

    offs = nonPathRooms - level.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(dataMap, view.getUint32(offs), sharedCache));
        offs += 4;
    }

    if (level.Name === 0x1C)
        // rainbow cloud spawns things dynamically
        rooms[0].objects.push(
            {
                id: 0x97,
                pos: vec3.fromValues(0, 100, 500),
                euler: vec3.create(),
                scale: vec3.fromValues(1, 1, 1)
            },
            {
                id: 0x3e9,
                pos: vec3.fromValues(0, 0, 10000),
                euler: vec3.fromValues(0, Math.PI, 0),
                scale: vec3.fromValues(1, 1, 1)
            },
        );

    const objectInfo: ObjectDef[] = [];
    if (level.Objects !== 0) {
        const objFunctionView = dataMap.getView(level.Objects);
        offs = 0;
        while (objFunctionView.getInt32(offs) !== 0) {
            const id = objFunctionView.getInt32(offs + 0x00);
            const initFunc = objFunctionView.getUint32(offs + 0x04);
            offs += 0x10;

            const initData = findObjectData(dataMap, initFunc);
            const objectView = dataMap.getView(initData.address);

            const graphStart = objectView.getUint32(0x00);
            const materials = objectView.getUint32(0x04);
            const renderer = objectView.getUint32(0x08);
            const animations = objectView.getUint32(0x0C);
            const scale = getVec3(objectView, 0x10);
            vec3.scale(scale, scale, 0.1);
            // four floats
            const flags = objectView.getUint16(0x2C);
            const extraTransforms = objectView.getUint32(0x2E) >>> 8;

            let animationList = 0;
            if (animations !== 0) {
                // just use first animation for now
                const firstAnimation = dataMap.deref(animations);
                if (firstAnimation !== 0)
                    animationList = dataMap.deref(firstAnimation + 0x08);
            }

            const sharedOutput = new RSPSharedOutput();
            const objectState = new F3DEX2.RSPState([], sharedOutput, dataMap);
            try {
                const graph = parseGraph(dataMap, graphStart, materials, animationList, renderer, objectState);
                objectInfo.push({ id, flags, graph, scale, sharedOutput, spawn: getSpawnType(initData.spawnFunc) });
            } catch (e) {
                console.warn("failed parse", e);
            }

        }
    }

    let collision: CollisionTree | null = null;
    if (level.Collision !== 0)
        collision = parseCollisionTree(dataMap, level.Collision)

    return { rooms, skybox, sharedCache, objectInfo, collision };
}

const enum MIPSOpcode {
    JAL     = 0X03,
    BEQ     = 0x04,
    BNE     = 0x05,
    ADDIU   = 0x09,
    ANDI    = 0x0C,
    LUI     = 0x0F,
    LW      = 0x23,
    SW      = 0x2B,
}

interface InitParams {
    address: number;
    spawnFunc: number;
}

function findObjectData(dataMap: DataMap, addr: number): InitParams {
    const view = dataMap.getView(addr);
    // registers to keep track of
    const regs = nArray(32, () => 0);
    let LUIReg = -1;
    let address = -1;
    let spawnFunc = -1;
    let offs = 0;
    while (true) {
        const instr = view.getUint32(offs + 0x00);
        const rs = (instr >>> 21) & 0x1f;
        const rt = (instr >>> 16) & 0x1f;
        const imm = (instr >>> 0) & 0xffff;
        switch (instr >>> 26) {
            case MIPSOpcode.BEQ:
            case MIPSOpcode.BNE:
            case MIPSOpcode.ANDI:
            case MIPSOpcode.SW:
            case MIPSOpcode.LW:
                break;
            case MIPSOpcode.ADDIU:
                regs[rt] = regs[rs] + view.getInt16(offs + 0x02);
                if (rt === rs && rs === LUIReg)
                    address = regs[rt];
                break;
            case MIPSOpcode.LUI:
                regs[rt] = (imm << 16) >>> 0;
                LUIReg = rt;
                break;
            case MIPSOpcode.JAL:
                spawnFunc = 4 * ((instr >>> 0) & 0xFFFFFF);
                break;
            default:
                throw `couldn't find data ${hexzero(instr, 8)} ${hexzero(addr, 8)}`;
        }
        if (spawnFunc >= 0 && address >= 0)
            return { spawnFunc, address };
        offs += 4;
    }
}

export interface GFXNode {
    model?: Model;
    children: GFXNode[];
    translation: vec3;
    euler: vec3;
    scale: vec3;
    track: AnimationTrack | null;
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

interface Material {
    flags: number;
    textureAddresses: number[];
    paletteAddresses: number[];

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
}

const enum UVScrollFlags {
    Tex1    = 0x0001,
    Tex2    = 0x0002,
    Palette = 0x0004,
    PrimLOD = 0x0008,
    Special = 0x0010, // behaves like 0x203, with extra logic
    Scroll0 = 0x0020, // set tile0 position
    Scroll1 = 0x0040, // set tile1 position, variable dimensions
    Scale   = 0x0080, // emit texture command, enabling tile0 and scaling
    // unused
    Prim    = 0x0200, // set prim color
    Env     = 0x0400,
    Blend   = 0x0800,
    Diffuse = 0x1000,
    Ambient = 0x2000,
}

function getVec3(view: DataView, offs: number): vec3 {
    return vec3.fromValues(
        view.getFloat32(offs + 0x00),
        view.getFloat32(offs + 0x04),
        view.getFloat32(offs + 0x08),
    );
}

function getColor(view: DataView, offs: number): vec4 {
    return vec4.fromValues(
        view.getUint8(offs + 0x00),
        view.getUint8(offs + 0x01),
        view.getUint8(offs + 0x02),
        view.getUint8(offs + 0x03),
    );
}

function parseMaterialData(dataMap: DataMap, listStart: number): Material[] {
    if (listStart === 0)
        return [];

    const materialList: Material[] = [];
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
        const textureAddresses: number[] = [];
        const paletteAddresses: number[] = [];

        if (textureStart > 0) { // only missing in rainbow cloud skybox?
            const textureView = dataMap.getView(textureStart);
            let textureOffs = 0;
            while (true) {
                const addr = textureView.getUint32(textureOffs);
                if (addr === 0)
                    break;
                textureAddresses.push(addr);
                textureOffs += 4;
            }
        }

        if (paletteStart > 0) {
            const paletteView = dataMap.getView(paletteStart);
            let paletteOffs = 0;
            while (true) {
                const addr = paletteView.getUint32(paletteOffs);
                if (addr === 0)
                    break;
                paletteAddresses.push(addr);
                paletteOffs += 4;
            }
        }
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

        const primLOD = scrollView.getUint8(0x54);

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
            flags, textureAddresses, paletteAddresses, tiles, textures, primLOD, halve,
            shift, scale, xScale, yScale, primColor, envColor, blendColor, diffuse, ambient,
        });
        // empty flag means default, set up just a basic scrolling texture
        if (materialList[materialList.length - 1].flags === 0)
            materialList[materialList.length - 1].flags = 0xa1;
    }
    return materialList;
}

type graphRenderer = (dataMap: DataMap, displayList: number, state: F3DEX2.RSPState, materials?: Material[]) => Model;

function selectRenderer(addr: number): graphRenderer | null {
    switch (addr) {
        case 0x800a15D8:
        case 0x803594DC: // object
            return runRoomDL;
        case 0x8035942C: // object, fog
        case 0x8035958C: // object
        case 0X802DE26C: // moltres: set 2 cycle and no Z update
            return runSplitDL;
        case 0x80359534: // object
        case 0x800A1608: // maybe XLU?
        case 0x802DFAE4: // volcano smoke: disable TLUT, set xlu
            return runMultiDL;
        case 0x80359484: // object
            return runMultiSplitDL;

        default: console.warn('unknown renderfunc', hexzero(addr, 8));
    }
    return null;
}

function parseGraph(dataMap: DataMap, graphStart: number, materialList: number, animatorList: number, renderFunc: number, state: F3DEX2.RSPState, rootNode: GFXNode | null = null): GFXNode {
    const view = dataMap.getView(graphStart);
    const parentList: GFXNode[] = [];

    let currIndex = 0;
    let offs = 0;
    while (true) {
        const id = view.getUint32(offs + 0x00) & 0xFFF;
        if (id === 0x12)
            break;
        let dl = view.getUint32(offs + 0x04);
        const translation = getVec3(view, offs + 0x08);
        const euler = getVec3(view, offs + 0x14);
        const scale = getVec3(view, offs + 0x20);
        const node: GFXNode = { translation, euler, scale, children: [], track: null };
        if (dl > 0) {
            const materials = materialList === 0 ? [] : parseMaterialData(dataMap, dataMap.deref(materialList + currIndex));
            const renderer = selectRenderer(renderFunc);
            if (renderer !== null) {
                node.model = renderer(dataMap, dl, state, materials);
                state.clear();
            }
            if (animatorList !== 0)
                node.track = parseAnimationTrack(dataMap, dataMap.deref(animatorList + currIndex));
        }
        if (id === 0) {
            assert(rootNode === null);
            rootNode = node;
        } else {
            const parent = assertExists(parentList[id - 1]);
            parent.children.push(node);
        }
        parentList[id] = node;
        offs += 0x2c;
        currIndex += 4;
    }
    if (rootNode === null)
        throw `empty graph`;
    else
        return rootNode;
}

function parseRoom(dataMap: DataMap, roomStart: number, sharedCache: RDP.TextureCache): Room {
    const view = dataMap.getView(roomStart);

    const roomGeoStart = view.getUint32(0x00);
    const pos = getVec3(view, 0x04);
    const yaw = view.getFloat32(0x10);
    assert(yaw === 0);
    const objectSpawns = view.getUint32(0x1C); // other lists before and after

    vec3.scale(pos, pos, 100);
    const roomView = dataMap.getView(roomGeoStart);
    const dlStart = roomView.getUint32(0x00);
    const materialData = roomView.getUint32(0x04);
    const renderer = roomView.getUint32(0x0C);
    const graphStart = roomView.getUint32(0x10);
    const animData = roomView.getUint32(0x18);
    const animTimeScale = roomView.getUint32(0x1C);

    const sharedOutput = new RSPSharedOutput();
    sharedOutput.textureCache = sharedCache;
    const rspState = new F3DEX2.RSPState([], sharedOutput, dataMap);

    const materials: Material[] = materialData !== 0 ? parseMaterialData(dataMap, dataMap.deref(materialData)) : [];
    // for now, materials are just handled statically, using their initial state
    const model = runRoomDL(dataMap, dlStart, rspState, materials);
    const graph: GFXNode = {
        model,
        translation: pos,
        euler: vec3.create(),
        scale: vec3.fromValues(1, 1, 1),
        children: [],
        track: null,
    };

    const objects: ObjectSpawn[] = [];
    if (objectSpawns > 0) {
        const objView = dataMap.getView(objectSpawns);
        let offs = 0;
        while (true) {
            const id = objView.getInt32(offs + 0x00);
            if (id === -1)
                break;
            const objPos = getVec3(objView, offs + 0x08);
            vec3.scale(objPos, objPos, 100);
            vec3.add(objPos, objPos, pos);
            const euler = getVec3(objView, offs + 0x14);
            const scale = getVec3(objView, offs + 0x20);
            const path = objView.getUint32(offs + 0x2c);
            objects.push({ id, pos: objPos, euler, scale });
            offs += 0x30;
        }
    }
    return { graph, objects };
}

function runOpaqueDL(dataMap: DataMap, dlStart: number, rspState: F3DEX2.RSPState, materials: Material[] = []): F3DEX2.RSPState {
    rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_SHADE | F3DEX2.RSP_Geometry.G_LIGHTING);
    rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    // some objects seem to assume this gets set, might rely on stage rendering first
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
    F3DEX2.runDL_F3DEX2(rspState, dlStart, materialDLHandler(materials));
    return rspState;
}

function runRoomDL(dataMap: DataMap, displayList: number, state: F3DEX2.RSPState, materials: Material[] = []): Model {
    const rspState = runOpaqueDL(dataMap, displayList, state, materials);
    const rspOutput = rspState.finish();
    return { sharedOutput: rspState.sharedOutput, rspState, rspOutput };
}

// run two display lists, before and after pushing a matrix
function runSplitDL(dataMap: DataMap, dlPair: number, rspState: F3DEX2.RSPState, materials: Material[] = []): Model {
    const view = dataMap.getView(dlPair);
    const firstDL = view.getUint32(0x00);
    const secondDL = view.getUint32(0x04);
    rspState.SP_MatrixIndex = 1;
    if (firstDL !== 0)
        runOpaqueDL(dataMap, firstDL, rspState, materials);
    rspState.SP_MatrixIndex = 0;
    if (secondDL !== 0)
        if (firstDL === 0)
            rspState = runOpaqueDL(dataMap, secondDL, rspState, materials);
        else
            F3DEX2.runDL_F3DEX2(rspState, secondDL, materialDLHandler(materials));
    const rspOutput = rspState.finish();
    return { sharedOutput: rspState.sharedOutput, rspState, rspOutput };
}

function runMultiDL(dataMap: DataMap, dlList: number, rspState: F3DEX2.RSPState, materials: Material[] = []): Model {
    const view = dataMap.getView(dlList);
    let offs = 0;
    let model: Model;
    while (true) {
        const index = view.getUint32(offs + 0x00);
        const dlStart = view.getUint32(offs + 0x04);
        // TODO: figure out what the display lists referenced by the indices mean. transparency?
        if (index !== 4) {
            return runRoomDL(dataMap, dlStart, rspState, materials);
        }
        offs += 8;
    }
}

function runMultiSplitDL(dataMap: DataMap, dlList: number, rspState: F3DEX2.RSPState, materials: Material[] = []): Model {
    const view = dataMap.getView(dlList);
    let offs = 0;
    while (true) {
        const index = view.getUint32(offs);
        if (index !== 4) {
            return runSplitDL(dataMap, dlList + offs + 4, rspState, materials);
        }
        offs += 0xC;
    }
}

function materialDLHandler(scrollData: Material[]): F3DEX2.dlRunner {
    return function (state: F3DEX2.RSPState, addr: number): void {
        assert((addr >>> 24) === 0x0E, `bad dl jump address ${hexzero(addr, 8)}`);
        // insert the display list that would be generated
        const scroll = assertExists(scrollData[(addr >>> 3) & 0xFF]);
        if (scroll.flags & UVScrollFlags.Palette) {
            state.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, scroll.paletteAddresses[0]);
            if (scroll.flags & (UVScrollFlags.Tex1 | UVScrollFlags.Tex2)) {
                state.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_4b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
                state.gDPLoadTLUT(5, scroll.textures[0].siz === ImageSize.G_IM_SIZ_8b ? 256 : 16);
            }
        }
        // skip lights, env, blend for now
        if (scroll.flags & (UVScrollFlags.Prim | UVScrollFlags.Special | UVScrollFlags.PrimLOD))
            state.gSPSetPrimColor(scroll.primLOD, scroll.primColor[0], scroll.primColor[1], scroll.primColor[2], scroll.primColor[3]);
        if (scroll.flags & (UVScrollFlags.Tex2 | UVScrollFlags.Special)) {
            const siz2 = scroll.textures[1].siz === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
            state.gDPSetTextureImage(scroll.textures[1].fmt, siz2, 0, scroll.textureAddresses[0]);
            if (scroll.flags & (UVScrollFlags.Tex1 | UVScrollFlags.Special)) {
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

        if (scroll.flags & (UVScrollFlags.Tex1 | UVScrollFlags.Special))
            state.gDPSetTextureImage(scroll.textures[0].fmt, scroll.textures[0].siz, 0, scroll.textureAddresses[0]);

        const adjXScale = scroll.halve === 0 ? scroll.xScale : scroll.xScale / 2;
        if (scroll.flags & UVScrollFlags.Scroll0) {
            const uls = (scroll.tiles[0].width * scroll.tiles[0].xShift + scroll.shift) / adjXScale;
            const ult = (scroll.tiles[0].height * (1 - scroll.tiles[0].yShift) + scroll.shift) / scroll.yScale - scroll.tiles[0].height;
            state.gDPSetTileSize(0, uls << 2, ult << 2, (scroll.tiles[0].width + uls - 1) << 2, (scroll.tiles[0].height + ult - 1) << 2);
        }
        if (scroll.flags & UVScrollFlags.Scroll1) {
            const uls = (scroll.tiles[1].width * scroll.tiles[1].xShift + scroll.shift) / adjXScale;
            const ult = (scroll.tiles[1].height * (1 - scroll.tiles[1].yShift) + scroll.shift) / scroll.yScale - scroll.tiles[1].height;
            state.gDPSetTileSize(1, uls << 2, ult << 2, (scroll.tiles[1].width + uls - 1) << 2, (scroll.tiles[1].height + ult - 1) << 2);
        }
        if (scroll.flags & UVScrollFlags.Scale)
            state.gSPTexture(true, 0, 0, (1 << 21) / scroll.scale / adjXScale, (1 << 21) / scroll.scale / scroll.yScale);
    };
}

export const enum AnimatorValue {
    Pitch,
    Yaw,
    Roll,
    Path,
    X,
    Y,
    Z,
    ScaleX,
    ScaleY,
    ScaleZ,
}

export const enum EntryKind {
    Exit            = 0x00,
    InitFunc        = 0x01,
    Block           = 0x02,
    LerpBlock       = 0x03,
    Lerp            = 0x04,
    SplineVelBlock  = 0x05,
    SplineVel       = 0x06,
    SplineEnd       = 0x07,
    SplineBlock     = 0x08,
    Spline          = 0x09,
    StepBlock       = 0x0A,
    Step            = 0x0B,
    Skip             = 0x0C,
    Path            = 0x0D,
    Loop            = 0x0E,
    SetFlags        = 0x0F,
    Func            = 0x10,
    MultiFunc       = 0x11,
}

export const enum AnimatorOP {
    NOP,
    STEP,
    LERP,
    SPLINE,
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
    speed: number,
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

export class Animator {
    public op = AnimatorOP.NOP;
    public start = 0;
    public len = 1;
    public p0 = 0;
    public p1 = 0;
    public v0 = 0;
    public v1 = 0;
    public path: Path | null = null;

    constructor(public value: AnimatorValue) { }

    public getValue(t: number): number {
        switch (this.op) {
            case AnimatorOP.NOP: return 0;
            case AnimatorOP.STEP: return (t - this.start) > this.len ? this.p1 : this.p0;
            case AnimatorOP.LERP: return this.p0 + (t - this.start) * this.v0;
            case AnimatorOP.SPLINE: return getPointHermite(this.p0, this.p1, this.v0 / this.len, this.v1 / this.len, (t - this.start) * this.len);
        }
    }

    public reset(): void {
        this.op = AnimatorOP.NOP;
        this.start = 0;
        this.len = 1;
        this.p0 = 0;
        this.p1 = 0;
        this.v0 = 0;
        this.v1 = 0;
    }
}
interface Animation {
    increment: number;
    frames: number;
    // per node list of animators
    // per node per mat list of animators
}

function parsePath(dataMap: DataMap, addr: number): Path {
    const view = dataMap.getView(addr);

    const kind: PathKind = view.getUint8(0x00);
    const length = view.getUint16(0x02);
    const segmentRate = view.getFloat32(0x04);
    const pointList = view.getUint32(0x08);
    const speed = view.getFloat32(0x0C);
    const timeList = view.getUint32(0x10);
    const quarticList = view.getUint32(0x14);

    const timeData = dataMap.getRange(timeList);
    const times = timeData.data.createTypedArray(Float32Array, timeList - timeData.start, length, Endianness.BIG_ENDIAN);

    const pointData = dataMap.getRange(pointList);
    const points = pointData.data.createTypedArray(Float32Array, pointList - pointData.start, length * 3 * (kind === PathKind.Bezier ? 3 : 1), Endianness.BIG_ENDIAN);

    const quarticData = dataMap.getRange(quarticList);
    const quartics = quarticData.data.createTypedArray(Float32Array, quarticList - quarticData.start, (length - 1) * 5, Endianness.BIG_ENDIAN);

    return { kind, length, segmentRate, speed, times, points, quartics };
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
        case EntryKind.Lerp:
        case EntryKind.LerpBlock:
        case EntryKind.SplineEnd:
        case EntryKind.Spline:
        case EntryKind.SplineBlock:
        case EntryKind.Step:
        case EntryKind.StepBlock:
        case EntryKind.MultiFunc: // not actually floats
            return count;
        case EntryKind.SplineVel:
        case EntryKind.SplineVelBlock:
            return 2 * count;
    }
    return 0;
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

        const count = entryDataSize(kind, bitCount(flags));
        const data = range.data.createTypedArray(Float32Array, offs, count, Endianness.BIG_ENDIAN);
        offs += count * 4;

        const newEntry: TrackEntry = { kind, flags, increment, block, data, path: null };
        if (kind === EntryKind.Path) {
            newEntry.path = parsePath(dataMap, view.getUint32(offs));
            offs += 4;
        }
        entries.push(newEntry);
    }
}

interface GroundPlane {
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
    const plane = findGroundPlane(tree, x/100, z/100);
    if (plane === null)
        return 0;
    if (plane.normal[1] === 0)
        return 0;
    return -100*(x*plane.normal[0]/100 + z*plane.normal[2]/100 + plane.offset)/plane.normal[1];
}

function findGroundPlane(tree: CollisionTree | null, x: number, z: number): GroundPlane | null {
    if (tree === null)
        return null;
    while (true) {
        const test = x*tree.line[0] + z*tree.line[1] + tree.line[2];
        if (test > 0) {
            if (tree.posPlane)
                return tree.posPlane
            if (tree.posSubtree === null)
                return null
            tree = tree.posSubtree;
        } else {
            if (tree.negPlane)
                return tree.negPlane
            if (tree.negSubtree === null)
                return null
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
                type: planeView.getUint32(start + 0x10),
            });
        }
        return planeList[index];
    }

    const posSubtree = posTreeIdx > -1 ? parseCollisionSubtree(treeView, planeView, planeList, posTreeIdx) : null;
    const negSubtree = negTreeIdx > -1 ? parseCollisionSubtree(treeView, planeView, planeList, negTreeIdx) : null;
    const posPlane = getPlane(posPlaneIdx);
    const negPlane = getPlane(negPlaneIdx);

    return {line, posSubtree, posPlane, negSubtree, negPlane};
}