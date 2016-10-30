
/// <reference path="../decl.d.ts" />

import * as F3DEX2 from './f3dex2';

// Loads the ZELVIEW0 format.

const mat4 = window.mat4;

function read0String(buffer, offs, length) {
    const buf = new Uint8Array(buffer, offs, length);
    const L = new Array(length);
    for (var i = 0; i < length; i++) {
        var elem = buf[i];
        if (elem == 0)
            break;
        L.push(String.fromCharCode(elem));
    }
    return L.join('');
}

class VFSEntry {
    filename:string;
    pStart:number; pEnd:number;
    vStart:number; vEnd:number;
}

export class ZELVIEW0 {
    entries:VFSEntry[];
    sceneFile:string;
    view:DataView;

    lookupFile(pStart) {
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.pStart === pStart)
                return entry;
        }
    }
    lookupAddress(banks, addr) {
        var bankIdx = addr >>> 24;
        var offs = addr & 0x00FFFFFF;
        function findBank(bankIdx) {
            switch (bankIdx) {
                case 0x02: return banks.scene;
                case 0x03: return banks.room;
                default: return null;
            }
        }
        var bank = findBank(bankIdx);
        if (bank === null)
            return null;
        var absOffs = bank.vStart + offs;
        if (absOffs > bank.vEnd)
            return null;
        return absOffs;
    }
    loadAddress(banks, addr) {
        var offs = this.lookupAddress(banks, addr);
        return this.view.getUint32(offs);
    }
    loadScene(gl, scene):Headers {
        return readScene(gl, this, scene);
    }
    loadMainScene(gl) {
        return this.loadScene(gl, this.sceneFile);
    }
}

class Mesh {
    opaque:F3DEX2.DL[] = [];
    transparent:F3DEX2.DL[] = [];
    bg:Function;
    textures:HTMLCanvasElement[];
}

export class Headers {
    filename:string;
    collision:any;
    mesh:Mesh;
    rooms:Headers[] = [];
}

export function readZELVIEW0(buffer:ArrayBuffer):ZELVIEW0 {
    const view = new DataView(buffer);

    const MAGIC = "ZELVIEW0";
    if (read0String(buffer, 0, MAGIC.length) != MAGIC)
        throw new Error("Invalid ZELVIEW0 file");

    let offs = 0x08;
    const count = view.getUint8(offs);
    offs += 0x04;
    const mainFile = view.getUint8(offs);
    offs += 0x04;

    function readVFSEntry():VFSEntry {
        const entry:VFSEntry = new VFSEntry();
        entry.filename = read0String(buffer, offs, 0x30);
        offs += 0x30;
        entry.pStart = view.getUint32(offs, true);
        entry.pEnd = view.getUint32(offs + 0x04, true);
        entry.vStart = view.getUint32(offs + 0x08, true);
        entry.vEnd = view.getUint32(offs + 0x0C, true);
        offs += 0x10;
        return entry;
    }

    const entries = [];
    for (let i = 0; i < count; i++)
        entries.push(readVFSEntry());

    const zelview0 = new ZELVIEW0();
    zelview0.entries = entries;
    zelview0.sceneFile = entries[mainFile];
    zelview0.view = view;

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

function readHeaders(gl, rom, offs, banks) {
    const headers = new Headers();

    function loadAddress(addr) {
        return rom.loadAddress(banks, addr);
    }

    function readCollision(collisionAddr) {
        let offs = rom.lookupAddress(banks, collisionAddr);

        function readVerts(N, addr) {
            let offs = rom.lookupAddress(banks, addr);
            const verts = new Uint16Array(N * 3);
            for (let i = 0; i < N; i++) {
                verts[i*3+0] = rom.view.getInt16(offs + 0x00, false);
                verts[i*3+1] = rom.view.getInt16(offs + 0x02, false);
                verts[i*3+2] = rom.view.getInt16(offs + 0x04, false);
                offs += 0x06;
            }
            return verts;
        }
        const vertsN = rom.view.getUint16(offs + 0x0C, false);
        const vertsAddr = rom.view.getUint32(offs + 0x10, false);
        const verts = readVerts(vertsN, vertsAddr);

        function readPolys(N, addr) {
            const polys = new Uint16Array(N * 3);
            let offs = rom.lookupAddress(banks, addr);
            for (let i = 0; i < N; i++) {
                polys[i*3+0] = rom.view.getUint16(offs + 0x02, false) & 0x0FFF;
                polys[i*3+1] = rom.view.getUint16(offs + 0x04, false) & 0x0FFF;
                polys[i*3+2] = rom.view.getUint16(offs + 0x06, false) & 0x0FFF;
                offs += 0x10;
            }
            return polys;
        }
        const polysN = rom.view.getUint16(offs + 0x14, false);
        const polysAddr = rom.view.getUint32(offs + 0x18, false);
        const polys = readPolys(polysN, polysAddr);

        function readWaters(N, addr) {
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

        function readCamera(addr) {
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

        return { verts: verts, polys: polys, waters: waters, camera: camera };
    }

    function readRoom(file) {
        const banks2 = Object.create(banks);
        banks2.room = file;
        return readHeaders(gl, rom, file.vStart, banks2);
    }

    function readRooms(nRooms, roomTableAddr) {
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

    function loadImage(gl, src) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const img = document.createElement('img');
        img.src = src;

        const aspect = 1;

        img.onload = function() {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgData.width, imgData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData.data);
        };

        // XXX: Should pull this dynamically at runtime.
        const imgWidth = 320;
        const imgHeight = 240;

        const imgAspect = imgWidth / imgHeight;
        const viewportAspect = gl.viewportWidth / gl.viewportHeight;

        const x = imgAspect / viewportAspect;

        const vertData = new Float32Array([
            /* x   y   z   u  v */
              -x, -1,  0,  0, 1,
               x, -1,  0,  1, 1,
              -x,  1,  0,  0, 0,
               x,  1,  0,  1, 0,
        ]);

        const vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.STATIC_DRAW);

        const idxData = new Uint8Array([
            0, 1, 2, 3,
        ]);

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

        // 3 pos + 2 uv
        const VERTEX_SIZE = 5;
        const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

        return function(renderState) {
            const gl = renderState.gl;
            const prog = renderState.currentProgram;
            gl.disable(gl.BLEND);
            gl.disable(gl.DEPTH_TEST);
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
            gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.enableVertexAttribArray(prog.uvLocation);
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
            gl.disableVertexAttribArray(prog.uvLocation);
        };
    }

    function readMesh(meshAddr) {
        const hdr = loadAddress(meshAddr);
        const type = (hdr >> 24);
        const nEntries = (hdr >> 16) & 0xFF;
        let entriesAddr = loadAddress(meshAddr + 4);

        const mesh = new Mesh();

        function readDL(addr) {
            const dlStart = loadAddress(addr);
            if (dlStart === 0)
                return null;

            return F3DEX2.readDL(gl, rom, banks, dlStart);
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
            const buffer = rom.view.buffer.slice(bgOffs);
            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = window.URL.createObjectURL(blob);
            mesh.bg = loadImage(gl, url);
        } else if (type === 2) {
            for (let i = 0; i < nEntries; i++) {
                mesh.opaque.push(readDL(entriesAddr + 8));
                mesh.transparent.push(readDL(entriesAddr + 12));
                entriesAddr += 16;
            }
        }

        mesh.opaque = mesh.opaque.filter(function(dl) { return !!dl; });
        mesh.transparent = mesh.transparent.filter(function(dl) { return !!dl; });

        mesh.textures = [];
        mesh.opaque.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); })
        mesh.transparent.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); })

        return mesh;
    }

    headers.rooms = [];
    headers.mesh = null;

    let startOffs = offs;

    while (true) {
        const cmd1 = rom.view.getUint32(offs, false);
        const cmd2 = rom.view.getUint32(offs + 4, false);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType == HeaderCommands.End)
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

function readScene(gl, zelview0, file):Headers {
    const banks = { scene: file };
    return readHeaders(gl, zelview0, file.vStart, banks);
}
