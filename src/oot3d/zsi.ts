
import * as CMB from './cmb';

import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, quat, vec3 } from 'gl-matrix';

const enum Version {
    Ocarina, Majora
}

export interface ZSIScene {
    name: string;
    rooms: string[];
    environmentSettings: ZSIEnvironmentSettings[];
}

export class ZSIRoomSetup {
    public actors: Actor[] = [];
    public mesh: Mesh;
}

export class ZSIEnvironmentSettings {
    public ambientLightCol: vec3 = vec3.create();
    public primaryLightDir: vec3 = vec3.create();
    public primaryLightCol: vec3 = vec3.create();
    public secondaryLightDir: vec3 = vec3.create();
    public secondaryLightCol: vec3 = vec3.create();
    public fogCol: vec3 = vec3.create();
    public fogStart: number = 0.0;
    public drawDistance: number = 0.0;
    public fogMin: number = 0.0;
    public fogMax: number = 0.0;
}

// Subset of Z64 command types.
const enum HeaderCommands {
    Actor = 0x01,
    Collision = 0x03,
    Rooms = 0x04,
    Mesh = 0x0A,
    End = 0x14,
    MultiSetup = 0x18,
    EnvironmentSettings = 0x0F,
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
        const rotationX = view.getInt16(actorTableIdx + 0x08, true) / 0x7FFF;
        const rotationY = view.getInt16(actorTableIdx + 0x0A, true) / 0x7FFF;
        const rotationZ = view.getInt16(actorTableIdx + 0x0C, true) / 0x7FFF;
        const variable = view.getUint16(actorTableIdx + 0x0E, true);
        const modelMatrix = mat4.create();
        quat.fromEuler(q, rotationX * 180, rotationY * 180, rotationZ * 180);
        mat4.fromRotationTranslation(modelMatrix, q, [positionX, positionY, positionZ]);
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

function readEnvironmentSettings(version: Version, buffer: ArrayBufferSlice, nEnvironmentSettings: number, offs: number)
{
    const view = buffer.createDataView();
    const environmentSettings: ZSIEnvironmentSettings[] = [];

    for (let i = 0; i < nEnvironmentSettings; i++) {
        let setting = new ZSIEnvironmentSettings;

        const colSize = 0x03;
        const dirSize = 0x03;
        const fogSize = 0x04;
        const distanceSize = 0x04;

        console.log(offs.toString(16));

        const drawDistance = view.getFloat32(offs + 0x00, true);
        setting.drawDistance = drawDistance;
        console.log("drawDistance " + drawDistance);
        offs += distanceSize;

        const fogStart = view.getFloat32(offs + 0x00, true);
        setting.fogStart = fogStart;
        console.log("fogStart " + fogStart);
        offs += fogSize;

        const mysteryValue = view.getUint16(offs);
        console.log("mystery value " + mysteryValue.toString(16));
        console.log("mystery as int " + mysteryValue);
        const mysteryA = view.getUint8(offs + 0x00);
        setting.fogMin = mysteryA / 255.0;
        const mysteryB = view.getUint8(offs + 0x01);
        setting.fogMax = mysteryB / 255.0;
        console.log("mystery value A " + mysteryA.toString(16));
        console.log("mystery value B " + mysteryB.toString(16));
        console.log("fogMin " + setting.fogMin);
        console.log("fogMax " + setting.fogMax);

        offs += 0x02;
        
        const ambientColR = view.getUint8(offs + 0x00) / 255.0;
        const ambientColG = view.getUint8(offs + 0x01) / 255.0;
        const ambientColB = view.getUint8(offs + 0x02) / 255.0;
        setting.ambientLightCol = vec3.fromValues(ambientColR, ambientColG, ambientColB);
        offs += colSize;
        
        const firstDiffuseLightDirX = view.getUint8(offs + 0x00) / 255.0;
        const firstDiffuseLightDirY = view.getUint8(offs + 0x01) / 255.0;
        const firstDiffuseLightDirZ = view.getUint8(offs + 0x02) / 255.0;
        setting.primaryLightDir = vec3.fromValues(firstDiffuseLightDirX, firstDiffuseLightDirY, firstDiffuseLightDirZ);
        offs += dirSize;
        
        const firstDiffuseLightColR = view.getUint8(offs + 0x00) / 255.0;
        const firstDiffuseLightColG = view.getUint8(offs + 0x01) / 255.0;
        const firstDiffuseLightColB = view.getUint8(offs + 0x02) / 255.0;
        setting.primaryLightCol = vec3.fromValues(firstDiffuseLightColR, firstDiffuseLightColG, firstDiffuseLightColB);
        offs += colSize;
        
        const secondDiffuseLightDirX = view.getUint8(offs + 0x00) / 255.0;
        const secondDiffuseLightDirY = view.getUint8(offs + 0x01) / 255.0;
        const secondDiffuseLightDirZ = view.getUint8(offs + 0x02) / 255.0;
        setting.secondaryLightDir = vec3.fromValues(secondDiffuseLightDirX, secondDiffuseLightDirY, secondDiffuseLightDirZ);
        offs += dirSize;

        const secondDiffuseLightColR = view.getUint8(offs + 0x00) / 255.0;
        const secondDiffuseLightColG = view.getUint8(offs + 0x01) / 255.0;
        const secondDiffuseLightColB = view.getUint8(offs + 0x02) / 255.0;
        setting.secondaryLightCol = vec3.fromValues(secondDiffuseLightColR, secondDiffuseLightColG, secondDiffuseLightColB);
        offs += colSize;

        const fogColR = view.getUint8(offs + 0x00) / 255.0;
        const fogColG = view.getUint8(offs + 0x01) / 255.0;
        const fogColB = view.getUint8(offs + 0x02) / 255.0;
        setting.fogCol = vec3.fromValues(fogColR, fogColG, fogColB);
        offs += colSize;

        environmentSettings.push(setting);
    }

    return environmentSettings;
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
function readSceneHeaders(version: Version, name: string, buffer: ArrayBufferSlice, offs: number = 0): ZSIScene {
    const view = buffer.createDataView();
    let rooms: string[] = [];
    let environmentSettings: ZSIEnvironmentSettings[] = [];

    while (true) {
        const cmd1 = view.getUint32(offs + 0x00, false);
        const cmd2 = view.getUint32(offs + 0x04, true);

        offs += 0x08;

        const cmdType = cmd1 >>> 24;

        if (cmdType == HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.EnvironmentSettings:
            const nEnvironmentSettings = (cmd1 >>> 16) & 0xFF;
            environmentSettings = readEnvironmentSettings(version, buffer, nEnvironmentSettings, cmd2);
            break;
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >>> 16) & 0xFF;
            rooms = readRooms(version, buffer, nRooms, cmd2);
            break;
        }
    }

    return { name, rooms, environmentSettings };
}

export function parseScene(buffer: ArrayBufferSlice): ZSIScene {
    const magic = readString(buffer, 0x00, 0x04);
    assert(['ZSI\x01', 'ZSI\x09'].includes(magic));
    const version = magic === 'ZSI\x01' ? Version.Ocarina : Version.Majora;
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readSceneHeaders(version, name, headersBuf);
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
