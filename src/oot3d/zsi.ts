
import * as CMB from 'cmb';

function readString(buffer:ArrayBuffer, offs:number, length:number):string {
    const buf = new Uint8Array(buffer, offs, length);
    let S = '';
    for (let i = 0; i < length; i++) {
        if (buf[i] === 0)
            break;
        S += String.fromCharCode(buf[i]);
    }
    return S;
}

function assert(b:boolean) {
    if (!b) throw new Error("Assert fail");
}

export class ZSI {
    mesh:Mesh;
    rooms:string[];
}

// Subset of Z64 command types.
enum HeaderCommands {
    Rooms = 0x04,
    Mesh = 0x0A,
    End = 0x14,
}

export class Mesh {
    opaque:CMB.CMB;
    transparent:CMB.CMB;
    textures:CMB.Texture[];
}

function readRooms(view:DataView, nRooms:number, offs:number):string[] {
    const rooms = [];
    for (let i = 0; i < nRooms; i++) {
        rooms.push(readString(view.buffer, offs, 0x44));
        offs += 0x44;
    }
    return rooms;
}

function readMesh(view:DataView, offs:number):Mesh {
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

// ZSI headers are a slight modification of the original Z64 headers.
function readHeaders(buffer:ArrayBuffer):ZSI {
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
        }
    }

    return zsi;
}

export function parse(buffer:ArrayBuffer):ZSI {
    assert(readString(buffer, 0x00, 0x04) === 'ZSI\x01');
    const name = readString(buffer, 0x04, 0x0C);

    // ZSI header is done. It's that simple! Now for the actual data.
    const headersBuf = buffer.slice(0x10);
    return readHeaders(headersBuf);
}
