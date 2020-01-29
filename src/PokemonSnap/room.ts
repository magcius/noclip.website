import * as F3DEX2 from "./f3dex2";

import ArrayBufferSlice from "../ArrayBufferSlice";
import { RSPOutput, RSPSharedOutput, OtherModeH_Layout, OtherModeH_CycleType } from "../BanjoKazooie/f3dex";
import { vec3 } from "gl-matrix";
import { assert, hexzero } from "../util";
import { TextFilt } from "../Common/N64/Image";


export interface Room {
    mesh: Mesh;
    pos: vec3;
    isSkybox: boolean;
}

export interface Mesh {
    sharedOutput: RSPSharedOutput;
    rspState: F3DEX2.RSPState;
    rspOutput: RSPOutput | null;
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

    if (skyboxDescriptor > 0) {
        const skyboxDL = view.getUint32(skyboxDescriptor - map.StartAddress);
        const mesh = runRoomDL(map.Data, map.StartAddress, skyboxDL);
        rooms.push({pos: vec3.create(), mesh, isSkybox: true});
    }

    offs = staticRooms - map.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(map.Data, map.StartAddress, view.getUint32(offs)));
        offs += 4;
    }

    offs = dynamicRooms - map.StartAddress;
    while (view.getUint32(offs) !== 0) {
        rooms.push(parseRoom(map.Data, map.StartAddress, view.getUint32(offs)));
        offs += 4;
    }

    return rooms;
}


function parseRoom(data: ArrayBufferSlice, startAddress: number, roomStart: number): Room {
    const view = data.createDataView();

    let offs = roomStart - startAddress;
    const roomGeoStart = view.getUint32(offs + 0x00);
    const pos = vec3.fromValues(
        view.getFloat32(offs + 0x04),
        view.getFloat32(offs + 0x08),
        view.getFloat32(offs + 0x0C),
    );
    const yaw = view.getFloat32(offs + 0x10);
    assert(yaw === 0)
    const objectSpawns = view.getUint32(offs + 0x1C); // other lists before and after

    vec3.scale(pos, pos, 100);
    const roomOffs = roomGeoStart - startAddress;
    const dlStart = view.getUint32(roomOffs + 0x00);
    const uvScrollData = view.getUint32(roomOffs + 0x04);
    const renderer = view.getUint32(roomOffs + 0x0C);

    const mesh = runRoomDL(data, startAddress, dlStart)

    return {pos, mesh, isSkybox: false};
}

function runRoomDL(data: ArrayBufferSlice, dataStart: number, dlStart: number): Mesh {
    const sharedOutput = new RSPSharedOutput();
    const rspState = new F3DEX2.RSPState([data], sharedOutput, dataStart);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    rspState.gSPSetGeometryMode(F3DEX2.RSP_Geometry.G_SHADE);
    rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    F3DEX2.runDL_F3DEX2(rspState, dlStart);
    const rspOutput = rspState.finish();
    return {sharedOutput, rspState, rspOutput};
}