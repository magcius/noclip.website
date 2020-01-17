
import { mat4 } from 'gl-matrix';
import * as F3DZEX from './f3dzex';
import { runDL_F3DZEX, RSPOutput, RSPState, RSPSharedOutput } from './f3dzex';
import * as Viewer from '../viewer';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, hexzero } from '../util';

// Loads the ZELVIEW0 format.

class VFSEntry {
    public filename: string;
    public pStart: number;
    public pEnd: number;
    public vStart: number;
    public vEnd: number;
}

export interface Rom {
    lookupAddress: (addr: number) => { buffer: ArrayBufferSlice, offs: number };
}

export interface RomBanks {
    scene: VFSEntry;
    room?: VFSEntry;
}

export class ZELVIEW0 {
    public entries: VFSEntry[];
    public sceneFile: VFSEntry;
    public buffer: ArrayBufferSlice;
    public view: DataView;
    public sharedOutput: RSPSharedOutput;

    public lookupFile(pStart: number): VFSEntry {
        for (const entry of this.entries)
            if (entry.pStart === pStart)
                return entry;
        throw Error(`File containing 0x${pStart.toString(16)} not found`);
    }

    public loadScene(scene: VFSEntry): Headers {
        return readScene(this, scene);
    }

    public loadMainScene() {
        return this.loadScene(this.sceneFile);
    }
}

export class Mesh {
    public opaque: (RSPOutput | null)[] = [];
    public transparent: (RSPOutput | null)[] = [];
    //public bg: Render.RenderFunc;
    public textures: Viewer.Texture[];
}

export class Headers {
    public rom: Rom;
    public filename: string;
    public collision: any;
    public mesh: Mesh | null;
    public rooms: Headers[] = [];
}

export function readZELVIEW0(buffer: ArrayBufferSlice): ZELVIEW0 {
    const view = buffer.createDataView();

    const MAGIC = "ZELVIEW0";
    if (readString(buffer, 0, MAGIC.length, false) !== MAGIC)
        throw new Error("Invalid ZELVIEW0 file");

    let offs = 0x08;
    const count = view.getUint8(offs);
    offs += 0x04;
    const mainFile = view.getUint8(offs);
    offs += 0x04;

    function readVFSEntry(): VFSEntry {
        const entry: VFSEntry = new VFSEntry();
        entry.filename = readString(buffer, offs, 0x30);
        offs += 0x30;
        entry.pStart = view.getUint32(offs, true);
        entry.pEnd = view.getUint32(offs + 0x04, true);
        entry.vStart = view.getUint32(offs + 0x08, true);
        entry.vEnd = view.getUint32(offs + 0x0C, true);
        offs += 0x10;
        return entry;
    }

    const entries: VFSEntry[] = [];
    for (let i = 0; i < count; i++)
        entries.push(readVFSEntry());

    const zelview0 = new ZELVIEW0();
    zelview0.entries = entries;
    zelview0.sceneFile = entries[mainFile];
    zelview0.view = view;
    zelview0.buffer = buffer;

    return zelview0;
}

enum HeaderCommands {
    Spawns = 0x00,
    Actors = 0x01,
    Camera = 0x02,
    Collision = 0x03,
    Rooms = 0x04,
    WindSettings = 0x05,
    EntranceList = 0x06,
    SpecialObjects = 0x07,
    SpecialBehavior = 0x08,
    // 0x09 is unknown
    Mesh = 0x0A,
    Objects = 0x0B,
    // 0x0C is unused
    Waypoints = 0x0D,
    Transitions = 0x0E,
    Environment = 0x0F,
    Time = 0x10,
    Skybox = 0x11,
    End = 0x14,
}

function readHeaders(rom: ZELVIEW0, offs: number, banks: RomBanks, sharedOutput: RSPSharedOutput): Headers {
    const headers = new Headers();

    function lookupAddress(addr: number): { buffer: ArrayBufferSlice, offs: number } {
        const bankIdx = addr >>> 24;
        const offs = addr & 0x00FFFFFF;
        function findBank() {
            switch (bankIdx) {
                case 0x02: return banks.scene;
                case 0x03:
                    if (banks.room === undefined)
                        throw Error(`room is undefined`);
                    return banks.room;
                default:
                    console.error(`bank for 0x${hexzero(addr, 8)} not found`);
                    throw Error(`bank not found`);
            }
        }
        const bank = findBank();
        if (bank === null)
            throw Error(`null bank`);
        const absOffs = bank.vStart + offs;
        if (absOffs > bank.vEnd)
            throw Error(`absOffs out of range`);
        return { buffer: rom.buffer, offs: absOffs };
    }

    headers.rom = { lookupAddress: lookupAddress };
    
    function loadAddress(addr: number): number {
        const lkup = lookupAddress(addr);
        return lkup.buffer.createDataView().getUint32(lkup.offs);
    }

    function readCollision(collisionAddr: number) {
        const lkup = lookupAddress(collisionAddr);
        const view = lkup.buffer.createDataView();
        const offs = lkup.offs;

        function readVerts(N: number, addr: number): Uint16Array {
            const lkup = lookupAddress(addr);
            const view = lkup.buffer.createDataView();
            let offs = lkup.offs;

            const verts = new Uint16Array(N * 3);
            for (let i = 0; i < N; i++) {
                verts[i * 3 + 0] = view.getInt16(offs + 0x00, false);
                verts[i * 3 + 1] = view.getInt16(offs + 0x02, false);
                verts[i * 3 + 2] = view.getInt16(offs + 0x04, false);
                offs += 0x06;
            }
            return verts;
        }

        const vertsN = rom.view.getUint16(offs + 0x0C, false);
        const vertsAddr = rom.view.getUint32(offs + 0x10, false);
        const verts = readVerts(vertsN, vertsAddr);

        function readPolys(N: number, addr: number): Uint16Array {
            const lkup = lookupAddress(addr);
            const view = lkup.buffer.createDataView();
            let offs = lkup.offs;

            const polys = new Uint16Array(N * 3);
            for (let i = 0; i < N; i++) {
                polys[i * 3 + 0] = view.getUint16(offs + 0x02, false) & 0x0FFF;
                polys[i * 3 + 1] = view.getUint16(offs + 0x04, false) & 0x0FFF;
                polys[i * 3 + 2] = view.getUint16(offs + 0x06, false) & 0x0FFF;
                offs += 0x10;
            }
            return polys;
        }

        const polysN = view.getUint16(offs + 0x14, false);
        const polysAddr = view.getUint32(offs + 0x18, false);
        const polys = readPolys(polysN, polysAddr);

        function readWaters(N: number, addr: number): Uint16Array {
            // XXX: While we should probably keep the actual stuff about
            // water boxes, I'm just drawing them, so let's just record
            // a quad.
            const lkup = lookupAddress(addr);
            const view = lkup.buffer.createDataView();
            let offs = lkup.offs;

            const waters = new Uint16Array(N * 3 * 4);

            for (let i = 0; i < N; i++) {
                const x = view.getInt16(offs + 0x00, false);
                const y = view.getInt16(offs + 0x02, false);
                const z = view.getInt16(offs + 0x04, false);
                const sx = view.getInt16(offs + 0x06, false);
                const sz = view.getInt16(offs + 0x08, false);
                waters[i*3*4+0] = x;
                waters[i*3*4+1] = y;
                waters[i*3*4+2] = z;
                waters[i*3*4+3] = x + sx;
                waters[i*3*4+4] = y;
                waters[i*3*4+5] = z;
                waters[i*3*4+6] = x;
                waters[i*3*4+7] = y;
                waters[i*3*4+8] = z + sz;
                waters[i*3*4+9] = x + sx;
                waters[i*3*4+10] = y;
                waters[i*3*4+11] = z + sz;
                offs += 0x10;
            }
            return waters;
        }

        const watersN = rom.view.getUint16(offs + 0x24, false);
        const watersAddr = rom.view.getUint32(offs + 0x28, false);
        //const waters = readWaters(watersN, watersAddr);
        // TODO: implement waters
        const waters = new Uint16Array([]);

        function readCamera(addr: number): mat4 {
            const skyboxCamera = loadAddress(addr + 0x04);
            const lkup = lookupAddress(skyboxCamera);
            const view = lkup.buffer.createDataView();
            const offs = lkup.offs;
            const x = view.getInt16(offs + 0x00, false);
            const y = view.getInt16(offs + 0x02, false);
            const z = view.getInt16(offs + 0x04, false);
            const a = view.getUint16(offs + 0x06, false) / 0xFFFF * (Math.PI * 2);
            const b = view.getUint16(offs + 0x08, false) / 0xFFFF * (Math.PI * 2) + Math.PI;
            const c = view.getUint16(offs + 0x0A, false) / 0xFFFF * (Math.PI * 2);
            const d = view.getUint16(offs + 0x0C, false);

            const mtx = mat4.create();
            mat4.translate(mtx, mtx, [x, y, z]);
            mat4.rotateZ(mtx, mtx, c);
            mat4.rotateY(mtx, mtx, b);
            mat4.rotateX(mtx, mtx, -a);
            return mtx;
        }

        const cameraAddr = view.getUint32(offs + 0x20, false);
        const camera = readCamera(cameraAddr);

        return { verts, polys, waters, camera };
    }

    function readRoom(file: VFSEntry): Headers {
        const banks2: RomBanks = { scene: banks.scene, room: file };
        return readHeaders(rom, file.vStart, banks2, sharedOutput);
    }

    function readRooms(nRooms: number, roomTableAddr: number): Headers[] {
        const rooms = [];
        for (let i = 0; i < nRooms; i++) {
            const pStart = loadAddress(roomTableAddr);
            console.log(`room ${i} pStart 0x${hexzero(pStart, 8)}`);
            const file = rom.lookupFile(pStart);
            const room = readRoom(file);
            room.filename = file.filename;
            rooms.push(room);
            roomTableAddr += 8;
        }
        return rooms;
    }

    function readMesh(meshAddr: number): Mesh {
        const hdr = loadAddress(meshAddr);
        const type = (hdr >> 24);
        const nEntries = (hdr >> 16) & 0xFF;
        let entriesAddr = loadAddress(meshAddr + 4);

        const mesh = new Mesh();

        function readDL(addr: number): RSPOutput | null {
            const dlAddr = loadAddress(addr);
            if (dlAddr === 0)
                return null;

            const rspState = new RSPState({ lookupAddress: lookupAddress }, sharedOutput);
            runDL_F3DZEX(rspState, { lookupAddress: lookupAddress }, dlAddr);
            rspState.finish();
            const rspOutput = rspState.finish();

            return rspOutput;
        }

        if (type === 0) {
            for (let i = 0; i < nEntries; i++) {
                mesh.opaque.push(readDL(entriesAddr));
                mesh.transparent.push(readDL(entriesAddr + 4));
                entriesAddr += 8;
            }
        } else if (type === 1) {
            // The last entry always seems to contain the BG. Not sure
            // what the other data is about... maybe the VR skybox for rotating scenes?
            const lastEntry = nEntries - 1;
            const bg = loadAddress(meshAddr + (lastEntry * 0x0C) + 0x08);
            const bgOffs = lookupAddress(bg);
            const buffer = bgOffs.buffer.slice(bgOffs.offs);
            //const blob = new Blob([buffer.castToBuffer()], { type: 'image/jpeg' });
            //const url = window.URL.createObjectURL(blob);
            //mesh.bg = loadImage(gl, url);
        } else if (type === 2) {
            for (let i = 0; i < nEntries; i++) {
                mesh.opaque.push(readDL(entriesAddr + 8));
                mesh.transparent.push(readDL(entriesAddr + 12));
                entriesAddr += 16;
            }
        }

        mesh.opaque = mesh.opaque.filter((dl) => !!dl);
        mesh.transparent = mesh.transparent.filter((dl) => !!dl);

        mesh.textures = [];
        //mesh.opaque.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); });
        //mesh.transparent.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); });

        return mesh;
    }

    headers.rooms = [];
    headers.mesh = null;

    const startOffs = offs;

    console.log(`Starting parsing at 0x${offs.toString(16)}`);

    while (true) {
        const cmd1 = rom.view.getUint32(offs, false);
        const cmd2 = rom.view.getUint32(offs + 4, false);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType === HeaderCommands.End)
            break;

        switch (cmdType) {
            case HeaderCommands.Collision:
                // TODO: implement collisions
                //headers.collision = readCollision(cmd2);
                break;
            case HeaderCommands.Rooms:
                const nRooms = (cmd1 >> 16) & 0xFF;
                headers.rooms = readRooms(nRooms, cmd2);
                break;
            case HeaderCommands.Mesh:
                headers.mesh = readMesh(cmd2);
                break;
        }
    }
    return headers;
}

function readScene(zelview0: ZELVIEW0, file: VFSEntry): Headers {
    const banks: RomBanks = { scene: file };
    zelview0.sharedOutput = new F3DZEX.RSPSharedOutput();
    return readHeaders(zelview0, file.vStart, banks, zelview0.sharedOutput);
}
