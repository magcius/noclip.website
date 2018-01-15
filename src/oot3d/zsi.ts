
import * as CMB from 'cmb';

import { assert, readString } from 'util';

export class ZSI {
    mesh: Mesh;
    rooms: string[];
    collision: Collision;
}

// Subset of Z64 command types.
enum HeaderCommands {
    Collision = 0x03,
    Rooms = 0x04,
    Mesh = 0x0A,
    End = 0x14,
}

export class Mesh {
    opaque: CMB.CMB;
    transparent: CMB.CMB;
    textures: CMB.Texture[];
}

function readRooms(view: DataView, nRooms: number, offs: number): string[] {
    const rooms = [];
    for (let i = 0; i < nRooms; i++) {
        rooms.push(readString(view.buffer, offs, 0x44));
        offs += 0x44;
    }
    return rooms;
}

function readMesh(view: DataView, offs: number): Mesh {
    const mesh = new Mesh();

    const hdr = view.getUint32(offs);
    const type = (hdr >> 24);
    const nEntries = (hdr >> 16) & 0xFF;
    const entriesAddr = view.getUint32(offs + 4, true);

    assert(type === 0x02);
    assert(nEntries === 0x01);

    const opaqueAddr = view.getUint32(entriesAddr + 0x08, true);
    const transparentAddr = view.getUint32(entriesAddr + 0x0C, true);

    if (opaqueAddr !== 0)
        mesh.opaque = CMB.parse(view.buffer.slice(opaqueAddr));
    if (transparentAddr !== 0)
        mesh.transparent = CMB.parse(view.buffer.slice(transparentAddr));

    mesh.textures = [];
    if (mesh.opaque)
        mesh.textures = mesh.textures.concat(mesh.opaque.textures);
    if (mesh.transparent)
        mesh.textures = mesh.textures.concat(mesh.transparent.textures);

    return mesh;
}

interface Collision {
    waterboxes: Uint16Array;
}

function readCollision(view: DataView, offs: number): Collision {
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
function readHeaders(buffer: ArrayBuffer): ZSI {
    const view = new DataView(buffer);

    let offs = 0;
    const zsi = new ZSI();

    while (true) {
        const cmd1 = view.getUint32(offs, false);
        const cmd2 = view.getUint32(offs + 4, true);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType == HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >> 16) & 0xFF;
            zsi.rooms = readRooms(view, nRooms, cmd2);
            break;
        case HeaderCommands.Mesh:
            zsi.mesh = readMesh(view, cmd2);
            break;
        case HeaderCommands.Collision:
            zsi.collision = readCollision(view, cmd2);
            break;
        }
    }

    return zsi;
}

export function parse(buffer:ArrayBuffer): ZSI {
    assert(readString(buffer, 0x00, 0x04) === 'ZSI\x01');
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readHeaders(headersBuf);
}
