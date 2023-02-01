
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
    doorActors: Actor[];
    environmentSettings: ZSIEnvironmentSettings[];
    skyboxSettings: number;
}

export class ZSIRoomSetup {
    public actors: Actor[] = [];
    public mesh: Mesh;
}

export class ZSIEnvironmentSettings {
    public ambientLightColor: vec3 = vec3.fromValues(0.5, 0.5, 0.5);
    public primaryLightDir: vec3 = vec3.fromValues(-0.007874016, -0.047244094, 0.8976378);
    public primaryLightColor: vec3 = vec3.fromValues(0.8, 0.8, 0.8);
    public secondaryLightDir: vec3 = vec3.fromValues(-0.19685039, 0.79527557, -0.496063);
    public secondaryLightColor: vec3 = vec3.create();
    public fogColor: vec3 = vec3.fromValues(0.5, 0.5, 0.5);
    public fogStart: number = 996.0;
    public fogEnd: number = 12800.0;
    public drawDistance: number = 20000.0;

    public copy(o: ZSIEnvironmentSettings): void {
        vec3.copy(this.ambientLightColor, o.ambientLightColor);
        vec3.copy(this.primaryLightDir, o.primaryLightDir);
        vec3.copy(this.primaryLightColor, o.primaryLightColor);
        vec3.copy(this.secondaryLightDir, o.secondaryLightDir);
        vec3.copy(this.secondaryLightColor, o.secondaryLightColor);
        vec3.copy(this.fogColor, o.fogColor);
        this.fogStart = o.fogStart;
        this.fogEnd = o.fogEnd;
        this.drawDistance = o.drawDistance;
    }
}

// Subset of Z64 command types.
const enum HeaderCommands {
    Actor = 0x01,
    Collision = 0x03,
    Rooms = 0x04,
    Mesh = 0x0A,
    DoorActor = 0x0E,
    SkyboxSettings = 0x11,
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
    timeSpawnFlags: number;
}

function readActors(version: Version, buffer: ArrayBufferSlice, nActors: number, offs: number): Actor[] {
    const view = buffer.createDataView();
    const actors: Actor[] = [];
    let actorTableIdx = offs;

    const q = quat.create();
    for (let i = 0; i < nActors; i++) {
        const actorIdFlags = view.getUint16(actorTableIdx + 0x00, true);
        const actorId = actorIdFlags & 0x0FFF;
        const positionX = view.getInt16(actorTableIdx + 0x02, true);
        const positionY = view.getInt16(actorTableIdx + 0x04, true);
        const positionZ = view.getInt16(actorTableIdx + 0x06, true);
        const rotationX = view.getInt16(actorTableIdx + 0x08, true);
        const rotationY = view.getInt16(actorTableIdx + 0x0A, true);
        const rotationZ = view.getInt16(actorTableIdx + 0x0C, true);
        const variable = view.getUint16(actorTableIdx + 0x0E, true);

        let timeSpawnFlags = 0xFF;

        const modelMatrix = mat4.create();

        if (version === Version.Ocarina) {
            const rotScale = 180 / 0x7FFF;
            quat.fromEuler(q, rotationX * rotScale, rotationY * rotScale, rotationZ * rotScale);
            mat4.fromRotationTranslation(modelMatrix, q, [positionX, positionY, positionZ]);
        } else if (version === Version.Majora) {
            // Interpreting these variables is a bit complex in Majora's Mask.
            const rotX = rotationX >> 7;
            const rotY = rotationY >> 7;
            const rotZ = rotationZ >> 7;
            // TODO(jstpierre): Figure out the proper rotation. Seems like it's in degrees already?
            quat.fromEuler(q, rotX, rotY, rotZ);
            mat4.fromRotationTranslation(modelMatrix, q, [positionX, positionY, positionZ]);
            timeSpawnFlags = ((rotationX & 0x07) << 7) | (rotationY & 0x7F);
        }

        actors.push({ actorId, modelMatrix, variable, timeSpawnFlags });
        actorTableIdx += 0x10;
    }
    return actors;
}

function readDoorActors(version: Version, buffer: ArrayBufferSlice, nActors: number, offs: number): Actor[] {
    const view = buffer.createDataView();
    const actors: Actor[] = [];
    let actorTableIdx = offs;

    const q = quat.create();
    for (let i = 0; i < nActors; i++) {
        const roomFront = view.getUint8(actorTableIdx + 0x00);
        const transitionEffectFront = view.getUint8(actorTableIdx + 0x01);
        const roomBack = view.getUint8(actorTableIdx + 0x02);
        const transitionEffectBack = view.getUint8(actorTableIdx + 0x03);
        const actorId = view.getUint16(actorTableIdx + 0x04, true);
        const positionX = view.getInt16(actorTableIdx + 0x06, true);
        const positionY = view.getInt16(actorTableIdx + 0x08, true);
        const positionZ = view.getInt16(actorTableIdx + 0x0A, true);
        const rotationY = view.getInt16(actorTableIdx + 0x0C, true) / 0x7FFF;
        const variable = view.getUint16(actorTableIdx + 0x0E, true);
        const modelMatrix = mat4.create();
        quat.fromEuler(q, 0, rotationY * 180, 0);
        mat4.fromRotationTranslation(modelMatrix, q, [positionX, positionY, positionZ]);
        actors.push({ actorId, modelMatrix, variable, timeSpawnFlags: 0xFF });
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

function readEnvironmentSettings(version: Version, buffer: ArrayBufferSlice, nEnvironmentSettings: number, offs: number) {
    const view = buffer.createDataView();
    const environmentSettings: ZSIEnvironmentSettings[] = [];

    for (let i = 0; i < nEnvironmentSettings; i++) {
        let setting = new ZSIEnvironmentSettings;

        const drawDistance =  version === Version.Majora ? view.getFloat32(offs + 0x1C, true) : view.getFloat32(offs + 0x00, true);
        const fogEnd = version === Version.Majora ? view.getFloat32(offs + 0x18, true) : view.getFloat32(offs + 0x04, true);
        const fogStart =  (version === Version.Majora ? view.getUint16(offs + 0x16, true) : view.getUint16(offs + 0x08, true)) & 0x03FF;

        const ambientColR = view.getUint8(offs + 0x0A) / 0xFF;
        const ambientColG = view.getUint8(offs + 0x0B) / 0xFF;
        const ambientColB = view.getUint8(offs + 0x0C) / 0xFF;

        const firstDiffuseLightDirX = view.getInt8(offs + 0x0D) / 0x7F;
        const firstDiffuseLightDirY = view.getInt8(offs + 0x0E) / 0x7F;
        const firstDiffuseLightDirZ = view.getInt8(offs + 0x0F) / 0x7F;

        const firstDiffuseLightColR = view.getUint8(offs + 0x10) / 0xFF;
        const firstDiffuseLightColG = view.getUint8(offs + 0x11) / 0xFF;
        const firstDiffuseLightColB = view.getUint8(offs + 0x12) / 0xFF;
        
        const secondDiffuseLightDirX = view.getInt8(offs + 0x13) / 0x7F;
        const secondDiffuseLightDirY = view.getInt8(offs + 0x14) / 0x7F;
        const secondDiffuseLightDirZ = view.getInt8(offs + 0x15) / 0x7F;
        
        const secondDiffuseLightColR = view.getUint8(offs + 0x16) / 0xFF;
        const secondDiffuseLightColG = view.getUint8(offs + 0x17) / 0xFF;
        const secondDiffuseLightColB = view.getUint8(offs + 0x18) / 0xFF;

        const fogColorR = (version === Version.Majora ? view.getUint8(offs + 0x12) : view.getUint8(offs + 0x19)) / 0xFF;
        const fogColorG = (version === Version.Majora ? view.getUint8(offs + 0x13) : view.getUint8(offs + 0x1A)) / 0xFF;
        const fogColorB = (version === Version.Majora ? view.getUint8(offs + 0x14) : view.getUint8(offs + 0x1B)) / 0xFF;
        
        offs += (version === Version.Majora) ? 0x20 : 0x1C;

        setting.drawDistance = drawDistance;
        setting.fogStart = (fogStart >= 996) ? 996: fogStart;
        setting.fogEnd = (fogEnd >= 12800) ? version === Version.Majora ? 3000 : 5000 : fogEnd;
        setting.ambientLightColor = vec3.fromValues(ambientColR, ambientColG, ambientColB);
        setting.primaryLightDir = vec3.fromValues(firstDiffuseLightDirX, firstDiffuseLightDirY, firstDiffuseLightDirZ);
        setting.primaryLightColor = vec3.fromValues(firstDiffuseLightColR, firstDiffuseLightColG, firstDiffuseLightColB);
        setting.secondaryLightDir = vec3.fromValues(secondDiffuseLightDirX, secondDiffuseLightDirY, secondDiffuseLightDirZ);
        setting.secondaryLightColor = vec3.fromValues(secondDiffuseLightColR, secondDiffuseLightColG, secondDiffuseLightColB);
        setting.fogColor = vec3.fromValues(fogColorR, fogColorG, fogColorB);

        //HACK(M-1) Until I figure how to handle "outdoor lighting"
        if(vec3.equals(setting.primaryLightDir, [0, 0, 0]) && vec3.equals(setting.secondaryLightDir, [0, 0, 0])){
            setting.primaryLightDir = vec3.fromValues(0.5, 0.5, 0.5);
            setting.secondaryLightDir = vec3.fromValues(-0.5, -0.5, -0.5);
            setting.primaryLightColor = vec3.fromValues(1, 1, 1);
            setting.secondaryLightColor = vec3.fromValues(0, 0, 0);
        }
        if(vec3.equals(setting.fogColor, [0,0,0])){
            setting.fogColor = vec3.fromValues(0.5, 0.5, 0.5)
        }
        if(vec3.equals(setting.ambientLightColor, [0,0,0])){
            setting.ambientLightColor = vec3.fromValues(0.5, 0.5, 0.5)
        }

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
    let doorActors: Actor[] = [];
    let skyboxSettings = 0;

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
        case HeaderCommands.DoorActor:
            const nActors = (cmd1 >>> 16) & 0xFF;
            doorActors = readDoorActors(version, buffer, nActors, cmd2);
            break;
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >>> 16) & 0xFF;
            rooms = readRooms(version, buffer, nRooms, cmd2);
            break;
        case HeaderCommands.SkyboxSettings:
            skyboxSettings = cmd2;
            break;
        }
    }

    return { name, rooms, doorActors, environmentSettings, skyboxSettings };
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
        case HeaderCommands.Actor: {
            const nActors = (cmd1 >>> 16) & 0xFF;
            mainSetup.actors = readActors(version, buffer, nActors, cmd2);
            break;
        }
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
