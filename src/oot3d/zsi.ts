
import * as CMB from './cmb';

import { assert, readString, hexdump } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { vec3, mat4, quat, mat3 } from 'gl-matrix';

const enum Version {
    Ocarina, Majora
}

export class ZSIScene {
    public rooms: string[] = [];
}

export class ZSIRoomSetup {
    public actors: Actor[] = [];
    public mesh: Mesh;
}

// Subset of Z64 command types.
const enum HeaderCommands {
    Actor = 0x01,
    Collision = 0x03,
    Rooms = 0x04,
    Mesh = 0x0A,
    End = 0x14,
    MultiSetup = 0x18,
}

export interface Mesh {
    opaque: CMB.CMB | null;
    transparent: CMB.CMB | null;
}

export interface Actor {
    actorId: number;
    modelMatrix: mat4;
    variable: number;
}

function readActors(version: Version, buffer: ArrayBufferSlice, nActors: number, offs: number): Actor[] {
    const view = buffer.createDataView();
    const actors: Actor[] = [];
    let actorTableIdx = offs;

    const q = quat.create();
    for (let i = 0; i < nActors; i++) {
        const actorId = view.getUint16(actorTableIdx + 0x00, true);
        const positionX = view.getInt16(actorTableIdx + 0x02, true);
        const positionY = view.getInt16(actorTableIdx + 0x04, true);
        const positionZ = view.getInt16(actorTableIdx + 0x06, true);
        const rotationX = view.getInt16(actorTableIdx + 0x08, true);
        const rotationY = view.getInt16(actorTableIdx + 0x0A, true) / 0x7FFF;
        const rotationZ = view.getInt16(actorTableIdx + 0x0E, true);
        const variable = view.getUint16(actorTableIdx + 0x0C, true);
        const modelMatrix = mat4.create();
        mat4.translate(modelMatrix, modelMatrix, [positionX, positionY, positionZ]);
        mat4.rotateY(modelMatrix, modelMatrix, rotationY * Math.PI);
        actors.push({ actorId, modelMatrix, variable });
        actorTableIdx += 0x10;
    }
    return actors;
}

function readRooms(version: Version, buffer: ArrayBufferSlice, nRooms: number, offs: number): string[] {
    const rooms: string[] = [];
    const roomSize = version === Version.Ocarina ? 0x44 : 0x34;
    for (let i = 0; i < nRooms; i++) {
        rooms.push(readString(buffer, offs, roomSize));
        offs += roomSize;
    }
    return rooms;
}

function readMesh(buffer: ArrayBufferSlice, offs: number): Mesh {
    const view = buffer.createDataView();

    const hdr = view.getUint32(offs);
    const type = (hdr >> 24);
    const nEntries = (hdr >> 16) & 0xFF;
    const entriesAddr = view.getUint32(offs + 4, true);

    if (nEntries === 0x00)
        return { opaque: null, transparent: null };

    assert(type === 0x02);
    assert(nEntries === 0x01);

    const opaqueAddr = view.getUint32(entriesAddr + 0x08, true);
    const transparentAddr = view.getUint32(entriesAddr + 0x0C, true);

    const opaque = opaqueAddr !== 0 ? CMB.parse(buffer.slice(opaqueAddr)) : null;
    const transparent = transparentAddr !== 0 ? CMB.parse(buffer.slice(transparentAddr)) : null;

    return { opaque, transparent };
}

// ZSI headers are a slight modification of the original Z64 headers.
function readSceneHeaders(version: Version, buffer: ArrayBufferSlice, offs: number = 0): ZSIScene {
    const view = buffer.createDataView();
    const zsi = new ZSIScene();

    while (true) {
        const cmd1 = view.getUint32(offs + 0x00, false);
        const cmd2 = view.getUint32(offs + 0x04, true);
        offs += 0x08;

        const cmdType = cmd1 >>> 24;

        if (cmdType == HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >>> 16) & 0xFF;
            zsi.rooms = readRooms(version, buffer, nRooms, cmd2);
            break;
        }
    }

    return zsi;
}

export function parseScene(buffer: ArrayBufferSlice): ZSIScene {
    const magic = readString(buffer, 0x00, 0x04);
    assert(['ZSI\x01', 'ZSI\x09'].includes(magic));
    const version = magic === 'ZSI\x01' ? Version.Ocarina : Version.Majora;
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readSceneHeaders(version, headersBuf);
}

// ZSI headers are a slight modification of the original Z64 headers.
function readRoomHeaders(version: Version, buffer: ArrayBufferSlice, offs: number = 0): ZSIRoomSetup[] {
    const view = buffer.createDataView();
    const roomSetups: ZSIRoomSetup[] = [];

    const mainSetup = new ZSIRoomSetup();
    roomSetups.push(mainSetup);

    while (true) {
        const cmd1 = view.getUint32(offs + 0x00, false);
        const cmd2 = view.getUint32(offs + 0x04, true);
        offs += 0x08;

        const cmdType = cmd1 >>> 24;

        if (cmdType == HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.MultiSetup: {
            const nSetups = (cmd1 >>> 16) & 0xFF;
            let setupIdx = cmd2;
            // Pick the first usable setup.
            for (let i = 0; i < nSetups; i++) {
                const setupOffs = view.getUint32(setupIdx, true);
                setupIdx += 0x04;
                if (setupOffs === 0)
                    continue;
                const subsetups = readRoomHeaders(version, buffer, setupOffs);
                assert(subsetups.length === 1);
                roomSetups.push(subsetups[0]);
            }
            // Still setups to try after this command.
            break;
        }
        case HeaderCommands.Actor:
            const nActors = (cmd1 >>> 16) & 0xFF;
            mainSetup.actors = readActors(version, buffer, nActors, cmd2);
            break;
        case HeaderCommands.Mesh:
            mainSetup.mesh = readMesh(buffer, cmd2);
            break;
        }
    }

    return roomSetups;
}

export function parseRooms(buffer: ArrayBufferSlice): ZSIRoomSetup[] {
    const magic = readString(buffer, 0x00, 0x04);
    assert(['ZSI\x01', 'ZSI\x09'].includes(magic));
    const version = magic === 'ZSI\x01' ? Version.Ocarina : Version.Majora;
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readRoomHeaders(version, headersBuf);
}
