import * as F3DEX2 from "./f3dex2";

import ArrayBufferSlice from "../ArrayBufferSlice";
import {  RSPSharedOutput, OtherModeH_Layout, OtherModeH_CycleType, TextureCache } from "../BanjoKazooie/f3dex";
import { vec3, vec4 } from "gl-matrix";
import { assert, hexzero, assertExists } from "../util";
import { TextFilt, ImageFormat, ImageSize } from "../Common/N64/Image";


export interface Room {
    nodes: GFXNode[];
    isSkybox: boolean;
}

export interface Model {
    sharedOutput: RSPSharedOutput;
    rspState: F3DEX2.RSPState;
    rspOutput: F3DEX2.RSPOutput | null;
}

export interface MapArchive {
    Data: ArrayBufferSlice,
    StartAddress: number,
    Rooms: number,
};

export function parseMap(map: MapArchive): Room[] {
    const view = map.Data.createDataView();

    const rooms: Room[] = [];
    let offs = map.Rooms - map.StartAddress;
    const staticRooms = view.getUint32(offs + 0x00);
    const dynamicRooms = view.getUint32(offs + 0x04);
    const skyboxDescriptor = view.getUint32(offs + 0x08);

    const sharedCache = new TextureCache();

    if (skyboxDescriptor > 0) {
        const skyboxDL = view.getUint32(skyboxDescriptor - map.StartAddress);
        const skyboxMats = view.getUint32(skyboxDescriptor + 0x08 - map.StartAddress)
        const materials = skyboxMats !== 0 ? parseMaterialData(view, map.StartAddress, skyboxMats) : [];
        const model = runRoomDL(map.Data, map.StartAddress, skyboxDL, sharedCache, materials);
        const nodes = [{
            model,
            children: [],
            translation: vec3.create(),
            axis: vec3.create(),
            scale: vec3.create(),
        }]
        rooms.push({nodes, isSkybox: true});
    }

    offs = staticRooms - map.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(map.Data, map.StartAddress, view.getUint32(offs), sharedCache));
        offs += 4;
    }

    offs = dynamicRooms - map.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(map.Data, map.StartAddress, view.getUint32(offs), sharedCache));
        offs += 4;
    }

    return rooms;
}


interface GFXNode {
    model?: Model;
    children: GFXNode[];
    translation: vec3;
    axis: vec3;
    scale: vec3;
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

function getColor(view: DataView, offs: number): vec4 {
    return vec4.fromValues(
        view.getUint8(offs + 0x00),
        view.getUint8(offs + 0x01),
        view.getUint8(offs + 0x02),
        view.getUint8(offs + 0x03),
    );
}

function parseMaterialData(view: DataView, startAddress: number, matStart: number): Material[] {
    const materialList: Material[] = [];
    let offs = matStart - startAddress;
    const matList = view.getUint32(offs);
    offs = matList - startAddress;
    while (true) {
        const scrollEntry = view.getUint32(offs) - startAddress;
        if (scrollEntry < 0)
            break;
        offs += 4;

        const flags = view.getUint16(scrollEntry + 0x30);

        const textureStart = view.getUint32(scrollEntry + 0x04);
        const paletteStart = view.getUint32(scrollEntry + 0x2C);
        const textureAddresses: number[] = [];
        const paletteAddresses: number[] = [];

        let textureOffs = textureStart - startAddress;
        if (textureOffs > 0) { // only missing in rainbow cloud skybox?
            while (true) {
                const addr = view.getUint32(textureOffs);
                if (addr === 0)
                    break;
                textureAddresses.push(addr);
                textureOffs += 4;
            }
        }

        if (paletteStart > 0) {
            textureOffs = paletteStart - startAddress;
            while (true) {
                const addr = view.getUint32(textureOffs);
                if (addr === 0)
                    break;
                paletteAddresses.push(addr);
                textureOffs += 4;
            }
        }
        const scale = view.getUint16(scrollEntry + 0x08);
        const shift = view.getUint16(scrollEntry + 0x0A);
        const halve = view.getUint32(scrollEntry + 0x10);
        const xScale = view.getFloat32(scrollEntry + 0x1C);
        const yScale = view.getFloat32(scrollEntry + 0x20);

        const primColor = getColor(view, scrollEntry + 0x50);
        const envColor = getColor(view, scrollEntry + 0x58);
        const blendColor = getColor(view, scrollEntry + 0x5C);
        const diffuse = getColor(view, scrollEntry + 0x60);
        const ambient = getColor(view, scrollEntry + 0x64);

        const primLOD = view.getUint8(scrollEntry + 0x54);

        const tiles: TileParams[] = [];
        tiles.push({
            width: view.getUint16(scrollEntry + 0x0C),
            height: view.getUint16(scrollEntry + 0x0E),
            xShift: view.getFloat32(scrollEntry + 0x14),
            yShift: Math.random(),//view.getFloat32(scrollEntry + 0x18),
        });
        tiles.push({
            width: view.getUint16(scrollEntry + 0x38),
            height: view.getUint16(scrollEntry + 0x3A),
            xShift: Math.random(),// view.getFloat32(scrollEntry + 0x3C),
            yShift: view.getFloat32(scrollEntry + 0x40),
        });

        const textures: TextureParams[] = [];
        textures.push({
            fmt: view.getUint8(scrollEntry + 0x02),
            siz: view.getUint8(scrollEntry + 0x03),
            width: 0, // dimensions of first texture are set elsewhere
            height: 0,
        });
        textures.push({
            fmt: view.getUint8(scrollEntry + 0x32),
            siz: view.getUint8(scrollEntry + 0x33),
            width: view.getUint16(scrollEntry + 0x34),
            height: view.getUint16(scrollEntry + 0x36),
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

function parseRoom(data: ArrayBufferSlice, startAddress: number, roomStart: number, sharedCache: TextureCache): Room {
    const view = data.createDataView();

    let offs = roomStart - startAddress;
    const roomGeoStart = view.getUint32(offs + 0x00);
    const pos = vec3.fromValues(
        view.getFloat32(offs + 0x04),
        view.getFloat32(offs + 0x08),
        view.getFloat32(offs + 0x0C),
    );
    const yaw = view.getFloat32(offs + 0x10);
    assert(yaw === 0);
    const objectSpawns = view.getUint32(offs + 0x1C); // other lists before and after

    vec3.scale(pos, pos, 100);
    const roomOffs = roomGeoStart - startAddress;
    const dlStart = view.getUint32(roomOffs + 0x00);
    const materialData = view.getUint32(roomOffs + 0x04);
    const renderer = view.getUint32(roomOffs + 0x0C);
    const graph = view.getUint32(roomOffs + 0x10);
    const animData = view.getUint32(roomOffs + 0x18);
    const animTimeScale = view.getUint32(roomOffs + 0x1C);

    const materials: Material[] = materialData !== 0 ? parseMaterialData(view, startAddress, materialData) : [];
    // for now, materials are just handled statically, using their initial state
    const model = runRoomDL(data, startAddress, dlStart, sharedCache, materials);
    const nodes: GFXNode[] = [{
        model,
        translation: pos,
        axis: vec3.create(),
        scale: vec3.fromValues(1, 1, 1),
        children: [],
    }];

    // scene graph is pointless right now
    if (graph > 0) {
        offs = graph - startAddress;
        while (true) {
            const id = view.getUint32(offs + 0x00);
            if (id === 0x12)
                break;
            const dl = view.getUint32(offs + 0x04);
            const translation = vec3.fromValues(
                view.getFloat32(offs + 0x08),
                view.getFloat32(offs + 0x0C),
                view.getFloat32(offs + 0x10),
            );
            const axis = vec3.fromValues(
                view.getFloat32(offs + 0x14),
                view.getFloat32(offs + 0x18),
                view.getFloat32(offs + 0x1C),
            );
            const scale = vec3.fromValues(
                view.getFloat32(offs + 0x20),
                view.getFloat32(offs + 0x24),
                view.getFloat32(offs + 0x28),
            );
            const node: GFXNode = { translation, axis, scale, children: [] };
            if (dl > 0)
                node.model = runRoomDL(data, startAddress, dl, sharedCache);
            if (id === 0)
                nodes.push(node);
            else {
                const parent = assertExists(nodes[id - 1]);
                parent.children.push(node);
            }
            offs += 0x2c;
        }
    }

    return { nodes, isSkybox: false };
}

function runRoomDL(data: ArrayBufferSlice, dataStart: number, dlStart: number, sharedCache: TextureCache, materials: Material[] = []): Model {
    const sharedOutput = new RSPSharedOutput();
    sharedOutput.textureCache = sharedCache;
    const rspState = new F3DEX2.RSPState([data], sharedOutput, dataStart);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_SHADE);
    rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    const texs = [];
    if (materials.length > 0) {
        texs.push(materials[0].textureAddresses[0]);
        if (materials[0].paletteAddresses.length > 0)
            texs.push(materials[0].paletteAddresses[0]);
    }
    F3DEX2.runDL_F3DEX2(rspState, dlStart, materialDLHandler(materials));
    const rspOutput = rspState.finish();
    return { sharedOutput, rspState, rspOutput };
}

function materialDLHandler(scrollData: Material[]): F3DEX2.dlRunner {
    return function (state: F3DEX2.RSPState, addr: number): void {
        assert((addr >>> 24) === 0x0E);
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
            state.gDPSetTileSize(0, (uls - 1) << 2, (ult - 1) << 2, (scroll.tiles[0].width - 1), 4 * (scroll.tiles[0].height - 1) << 2);
        }
        if (scroll.flags & UVScrollFlags.Scroll1) {
            const uls = (scroll.tiles[1].width * scroll.tiles[1].xShift + scroll.shift) / adjXScale;
            const ult = (scroll.tiles[1].height * (1 - scroll.tiles[1].yShift) + scroll.shift) / scroll.yScale - scroll.tiles[1].height;
            state.gDPSetTileSize(0, (uls - 1) << 2, (ult - 1) << 2, (scroll.tiles[1].width + uls - 1) << 2, (scroll.tiles[1].height + ult - 1) << 2);
        }
        if (scroll.flags & UVScrollFlags.Scale)
            state.gSPTexture(true, 0, 0, (1 << 21) / scroll.scale / adjXScale, (1 << 21) / scroll.scale / scroll.yScale);
    };
}