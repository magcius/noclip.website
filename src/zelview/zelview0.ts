
import { mat4 } from 'gl-matrix';

import { runDL_F3DEX2, RSPOutput, RSPState } from './f3dex2';
import * as Render from './render';
import * as Viewer from '../viewer';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString } from '../util';

// Loads the ZELVIEW0 format.

class VFSEntry {
    public filename: string;
    public pStart: number;
    public pEnd: number;
    public vStart: number;
    public vEnd: number;
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

    public lookupFile(pStart: number): VFSEntry {
        for (const entry of this.entries)
            if (entry.pStart === pStart)
                return entry;
        throw Error(`File ${pStart} not found`);
        //return null;
    }
    public lookupAddress(banks: RomBanks, addr: number): number {
        const bankIdx = addr >>> 24;
        const offs = addr & 0x00FFFFFF;
        function findBank() {
            switch (bankIdx) {
                case 0x02: return banks.scene;
                case 0x03:
                    if (banks.room === undefined)
                        throw Error(`room is undefined`);
                    return banks.room;
                default: throw Error(`bank not found`);
            }
        }
        const bank = findBank();
        if (bank === null)
            throw Error(`null bank`);
            //return null;
        const absOffs = bank.vStart + offs;
        if (absOffs > bank.vEnd)
            throw Error(`absOffs out of range`);
            //return null;
        return absOffs;
    }
    public loadAddress(banks: RomBanks, addr: number): number {
        const offs = this.lookupAddress(banks, addr);
        return this.view.getUint32(offs);
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
    public bg: Render.RenderFunc;
    public textures: Viewer.Texture[];
}

export class Headers {
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

function readHeaders(rom: ZELVIEW0, offs: number, banks: RomBanks): Headers {
    const headers = new Headers();

    function loadAddress(addr: number): number {
        return rom.loadAddress(banks, addr);
    }

    function readCollision(collisionAddr: number) {
        const offs = rom.lookupAddress(banks, collisionAddr);

        function readVerts(N: number, addr: number): Uint16Array {
            let offs = rom.lookupAddress(banks, addr);
            const verts = new Uint16Array(N * 3);
            for (let i = 0; i < N; i++) {
                verts[i * 3 + 0] = rom.view.getInt16(offs + 0x00, false);
                verts[i * 3 + 1] = rom.view.getInt16(offs + 0x02, false);
                verts[i * 3 + 2] = rom.view.getInt16(offs + 0x04, false);
                offs += 0x06;
            }
            return verts;
        }
        const vertsN = rom.view.getUint16(offs + 0x0C, false);
        const vertsAddr = rom.view.getUint32(offs + 0x10, false);
        const verts = readVerts(vertsN, vertsAddr);

        function readPolys(N: number, addr: number): Uint16Array {
            let offs = rom.lookupAddress(banks, addr);
            const polys = new Uint16Array(N * 3);
            for (let i = 0; i < N; i++) {
                polys[i * 3 + 0] = rom.view.getUint16(offs + 0x02, false) & 0x0FFF;
                polys[i * 3 + 1] = rom.view.getUint16(offs + 0x04, false) & 0x0FFF;
                polys[i * 3 + 2] = rom.view.getUint16(offs + 0x06, false) & 0x0FFF;
                offs += 0x10;
            }
            return polys;
        }
        const polysN = rom.view.getUint16(offs + 0x14, false);
        const polysAddr = rom.view.getUint32(offs + 0x18, false);
        const polys = readPolys(polysN, polysAddr);

        function readWaters(N: number, addr: number): Uint16Array {
            // XXX: While we should probably keep the actual stuff about
            // water boxes, I'm just drawing them, so let's just record
            // a quad.
            let offs = rom.lookupAddress(banks, addr);
            const waters = new Uint16Array(N * 3 * 4);

            for (let i = 0; i < N; i++) {
                const x = rom.view.getInt16(offs + 0x00, false);
                const y = rom.view.getInt16(offs + 0x02, false);
                const z = rom.view.getInt16(offs + 0x04, false);
                const sx = rom.view.getInt16(offs + 0x06, false);
                const sz = rom.view.getInt16(offs + 0x08, false);
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
        const waters = readWaters(watersN, watersAddr);

        function readCamera(addr: number): mat4 {
            const skyboxCamera = loadAddress(addr + 0x04);
            const offs = rom.lookupAddress(banks, skyboxCamera);
            const x = rom.view.getInt16(offs + 0x00, false);
            const y = rom.view.getInt16(offs + 0x02, false);
            const z = rom.view.getInt16(offs + 0x04, false);
            const a = rom.view.getUint16(offs + 0x06, false) / 0xFFFF * (Math.PI * 2);
            const b = rom.view.getUint16(offs + 0x08, false) / 0xFFFF * (Math.PI * 2) + Math.PI;
            const c = rom.view.getUint16(offs + 0x0A, false) / 0xFFFF * (Math.PI * 2);
            const d = rom.view.getUint16(offs + 0x0C, false);

            const mtx = mat4.create();
            mat4.translate(mtx, mtx, [x, y, z]);
            mat4.rotateZ(mtx, mtx, c);
            mat4.rotateY(mtx, mtx, b);
            mat4.rotateX(mtx, mtx, -a);
            return mtx;
        }

        const cameraAddr = rom.view.getUint32(offs + 0x20, false);
        const camera = readCamera(cameraAddr);

        return { verts, polys, waters, camera };
    }

    function readRoom(file: VFSEntry): Headers {
        const banks2: RomBanks = { scene: banks.scene, room: file };
        return readHeaders(rom, file.vStart, banks2);
    }

    function readRooms(nRooms: number, roomTableAddr: number): Headers[] {
        const rooms = [];
        for (let i = 0; i < nRooms; i++) {
            const pStart = loadAddress(roomTableAddr);
            const file = rom.lookupFile(pStart);
            const room = readRoom(file);
            room.filename = file.filename;
            rooms.push(room);
            roomTableAddr += 8;
        }
        return rooms;
    }

    // function loadImage(gl: WebGL2RenderingContext, src: string) {
    //     const canvas = document.createElement('canvas');
    //     const ctx = canvas.getContext('2d')!;

    //     const texId = gl.createTexture();
    //     gl.bindTexture(gl.TEXTURE_2D, texId);
    //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    //     const img = document.createElement('img');
    //     img.src = src;

    //     const aspect = 1;

    //     img.onload = () => {
    //         canvas.width = img.width;
    //         canvas.height = img.height;
    //         ctx.drawImage(img, 0, 0);

    //         const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    //         gl.bindTexture(gl.TEXTURE_2D, texId);
    //         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgData.width, imgData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData.data);
    //     };

    //     // XXX: Should pull this dynamically at runtime.
    //     const imgWidth = 320;
    //     const imgHeight = 240;

    //     const imgAspect = imgWidth / imgHeight;
    //     // const viewportAspect = gl.viewportWidth / gl.viewportHeight;

    //     const x = imgAspect;

    //     const vertData = new Float32Array([
    //         /* x   y   z   u  v */
    //           -x, -1,  0,  0, 1,
    //            x, -1,  0,  1, 1,
    //           -x,  1,  0,  0, 0,
    //            x,  1,  0,  1, 0,
    //     ]);

    //     const vertBuffer = gl.createBuffer();
    //     gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
    //     gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.STATIC_DRAW);

    //     const idxData = new Uint8Array([
    //         0, 1, 2, 3,
    //     ]);

    //     const idxBuffer = gl.createBuffer();
    //     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
    //     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

    //     // 3 pos + 2 uv
    //     const VERTEX_SIZE = 5;
    //     const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

    //     return (renderState: RenderState) => {
    //         const gl = renderState.gl;
    //         const prog = (<Render.BillboardBGProgram> renderState.currentProgram);
    //         gl.disable(gl.BLEND);
    //         gl.disable(gl.DEPTH_TEST);
    //         gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
    //         gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
    //         gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    //         gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
    //         gl.enableVertexAttribArray(prog.positionLocation);
    //         gl.enableVertexAttribArray(prog.uvLocation);
    //         gl.bindTexture(gl.TEXTURE_2D, texId);
    //         gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
    //     };
    // }

    function readMesh(meshAddr: number): Mesh {
        const hdr = loadAddress(meshAddr);
        const type = (hdr >> 24);
        const nEntries = (hdr >> 16) & 0xFF;
        let entriesAddr = loadAddress(meshAddr + 4);

        const mesh = new Mesh();

        function readDL(addr: number): RSPOutput | null {
            const dlStart = loadAddress(addr);
            if (dlStart === 0)
                return null;

            console.log(`Reading DL from offset 0x${dlStart.toString(16)}`);

            const rspState = new RSPState();
            rspState.ramAddrBase = rom.lookupAddress(banks, dlStart & 0xFF000000); // TODO
            rspState.ramBuffer = rom.buffer; // TODO
            runDL_F3DEX2(rspState, dlStart); // TODO
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
            const bgOffs = rom.lookupAddress(banks, bg);
            const buffer = rom.buffer.slice(bgOffs);
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

    while (true) {
        const cmd1 = rom.view.getUint32(offs, false);
        const cmd2 = rom.view.getUint32(offs + 4, false);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType === HeaderCommands.End)
            break;

        switch (cmdType) {
            case HeaderCommands.Collision:
                headers.collision = readCollision(cmd2);
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
    return readHeaders(zelview0, file.vStart, banks);
}
