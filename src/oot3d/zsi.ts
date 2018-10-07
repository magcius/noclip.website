
import * as CMB from './cmb';

import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

const enum Version {
    Ocarina, Majora
}

export class ZSI {
    mesh: Mesh = null;
    rooms: string[] = [];
    collision: Collision;
}

// Subset of Z64 command types.
const enum HeaderCommands {
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

function readRooms(version: Version, buffer: ArrayBufferSlice, nRooms: number, offs: number): string[] {
    const rooms = [];
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

interface Collision {
    waterboxes: Uint16Array;
}

function readCollision(buffer: ArrayBufferSlice, offs: number): Collision {
    const view = buffer.createDataView();
    const waterboxTableCount = view.getUint16(offs + 0x14, true);
    const waterboxTableOffs = view.getUint32(offs + 0x28, true);
    const waterboxes = new Uint16Array(waterboxTableCount * 3 * 4);
    let waterboxTableIdx = waterboxTableOffs;
    for (let i = 0; i < waterboxTableCount; i++) {
        const x = view.getInt16(waterboxTableIdx + 0x00, true);
        const y = view.getInt16(waterboxTableIdx + 0x02, true);
        const z = view.getInt16(waterboxTableIdx + 0x04, true);
        const sx = view.getInt16(waterboxTableIdx + 0x06, true);
        const sz = view.getInt16(waterboxTableIdx + 0x08, true);
        waterboxes[i*3*4+0] = x;
        waterboxes[i*3*4+1] = y;
        waterboxes[i*3*4+2] = z;
        waterboxes[i*3*4+3] = x + sx;
        waterboxes[i*3*4+4] = y;
        waterboxes[i*3*4+5] = z;
        waterboxes[i*3*4+6] = x;
        waterboxes[i*3*4+7] = y;
        waterboxes[i*3*4+8] = z + sz;
        waterboxes[i*3*4+9] = x + sx;
        waterboxes[i*3*4+10] = y;
        waterboxes[i*3*4+11] = z + sz;
        waterboxTableIdx += 0x10;
    }

    return { waterboxes };
}

// ZSI headers are a slight modification of the original Z64 headers.
function readHeaders(version: Version, buffer: ArrayBufferSlice, offs: number = 0): ZSI {
    const view = buffer.createDataView();

    const zsi = new ZSI();

    while (true) {
        const cmd1 = view.getUint32(offs, false);
        const cmd2 = view.getUint32(offs + 4, true);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType == HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.MultiSetup: {
            const nSetups = (cmd1 >> 16) & 0xFF;
            let setupIdx = cmd2;
            // Pick the first usable setup.
            for (let i = 0; i < nSetups; i++) {
                const setupOffs = view.getUint32(setupIdx, true);
                setupIdx += 0x04;
                if (setupOffs === 0)
                    continue;
                const setupZsi = readHeaders(version, buffer, setupOffs);
                if (setupZsi.rooms.length || setupZsi.mesh !== null)
                    return setupZsi;
            }
            // Still setups to try after this command.
            break;
        }
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >> 16) & 0xFF;
            zsi.rooms = readRooms(version, buffer, nRooms, cmd2);
            break;
        case HeaderCommands.Mesh:
            zsi.mesh = readMesh(buffer, cmd2);
            break;
        case HeaderCommands.Collision:
            zsi.collision = readCollision(buffer, cmd2);
            break;
        }
    }

    return zsi;
}

export function parse(buffer: ArrayBufferSlice): ZSI {
    const magic = readString(buffer, 0x00, 0x04);
    assert(['ZSI\x01', 'ZSI\x09'].includes(magic));
    const version = magic === 'ZSI\x01' ? Version.Ocarina : Version.Majora;
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readHeaders(version, headersBuf);
}
