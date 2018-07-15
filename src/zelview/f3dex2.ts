
import { mat4, vec3, vec4 } from 'gl-matrix';

import * as Render from './render';
import * as ZELVIEW0 from './zelview0';

import { CullMode, RenderState, RenderFlags, BlendMode } from '../render';
import * as Viewer from '../viewer';

function extractBits(value: number, offset: number, bits: number) {
    return (value >> offset) & ((1 << bits) - 1);
}

// Zelda uses the F3DEX2 display list format. This implements
// a simple (and probably wrong!) HLE renderer for it.

type CmdFunc = (renderState: RenderState) => void;

const OtherModeH = {
    CYCLETYPE_SFT: 20,
    CYCLETYPE_LEN: 2,
};

const CYCLETYPE = {
    _1CYCLE: 0,
    _2CYCLE: 1,
    COPY: 2,
    FILL: 3,
}

const enum UCodeCommands {
    VTX = 0x01,
    TRI1 = 0x05,
    TRI2 = 0x06,
    GEOMETRYMODE = 0xD9,

    SETOTHERMODE_L = 0xE2,
    SETOTHERMODE_H = 0xE3,

    DL = 0xDE,
    ENDDL = 0xDF,

    MTX = 0xDA,
    POPMTX = 0xD8,

    TEXTURE = 0xD7,
    LOADTLUT = 0xF0,
    LOADBLOCK = 0xF3,
    SETTILESIZE = 0xF2,
    SETTILE = 0xF5,
    SETPRIMCOLOR = 0xF9,
    SETENVCOLOR = 0xFB,
    SETCOMBINE = 0xFC,
    SETTIMG = 0xFD,
    RDPLOADSYNC = 0xE6,
    RDPPIPESYNC = 0xE7,
}

class State {
    public gl: WebGL2RenderingContext;
    public programMap: {[hash: string]: Render.F3DEX2Program} = {};

    public cmds: CmdFunc[];
    public textures: Viewer.Texture[];

    public mtx: mat4;
    public mtxStack: mat4[];

    public vertexBuffer: Float32Array;
    public vertexData: number[];
    public vertexOffs: number;

    public geometryMode: number = 0;
    public combiners: Readonly<Render.Combiners>;
    public otherModeL: number = 0;
    public otherModeH: number = (CYCLETYPE._2CYCLE << OtherModeH.CYCLETYPE_SFT);
    
    public primColor: vec4 = vec4.clone([1, 1, 1, 1]);
    // FIXME: Initial envColor depends on which map is loaded, and can be animated.
    public envColor: vec4 = vec4.clone([0, 0, 0, 0.5]);

    public palettePixels: Uint8Array;
    public textureImageAddr: number;
    public currentTile: TextureTile;
    public textureTiles: TextureTile[] = [];

    public rom: ZELVIEW0.ZELVIEW0;
    public banks: ZELVIEW0.RomBanks;

    public lookupAddress(addr: number) {
        return this.rom.lookupAddress(this.banks, addr);
    }
    
    public getDLProgram(params: Render.F3DEX2ProgramParameters): Render.F3DEX2Program {
        const hash = Render.hashF3DEX2Params(params);
        if (!(hash in this.programMap)) {
            this.programMap[hash] = new Render.F3DEX2Program(params);
        }
        return this.programMap[hash];
    }

    public pushProgramCmds() {
        // Clone all relevant fields to prevent the closure from seeing different data than
        // intended.
        const envColor = vec4.clone(this.envColor);
        const primColor = vec4.clone(this.primColor);
        const geometryMode = this.geometryMode;
        const otherModeL = this.otherModeL;
        const otherModeH = this.otherModeH;

        const progParams: Render.F3DEX2ProgramParameters = {
            use2Cycle: (extractBits(otherModeH, OtherModeH.CYCLETYPE_SFT, OtherModeH.CYCLETYPE_LEN) == CYCLETYPE._2CYCLE),
            combiners: this.combiners,
        };

        // TODO: Don't call getDLProgram if state didn't change, because it can be expensive.
        const prog = this.getDLProgram(progParams);

        let alphaTestMode: number;
        if (otherModeL & OtherModeL.FORCE_BL) {
            alphaTestMode = 0;
        } else {
            alphaTestMode = ((otherModeL & OtherModeL.CVG_X_ALPHA) ? 0x1 : 0 |
                                (otherModeL & OtherModeL.ALPHA_CVG_SEL) ? 0x2 : 0);
        }

        flushTexture(this)
        var textures: TextureTile[] = []
        // TODO: handle tiles other than 0 and 1 if needed?
        if (this.textureTiles[0] && this.textureTiles[0].addr != 0)
            textures[0] = Object.assign({}, this.textureTiles[0])
        if (this.textureTiles[1] && this.textureTiles[1].addr != 0)
            textures[1] = Object.assign({}, this.textureTiles[1])

        this.cmds.push((renderState: RenderState) => {
            const gl = renderState.gl;

            renderState.useProgram(prog);
            renderState.bindModelView();

            gl.uniform1i(prog.texture0Location, 0);
            gl.uniform1i(prog.texture1Location, 1);

            gl.uniform4fv(prog.envLocation, envColor);
            gl.uniform4fv(prog.primLocation, primColor);

            for (let i = 0; i < 2; i++) {
                gl.activeTexture(gl.TEXTURE0 + i);
                if (textures[i])
                {
                    gl.bindTexture(gl.TEXTURE_2D, textures[i].glTextureId);
                    gl.uniform2fv(prog.txsLocation[i], [1 / textures[i].width, 1 / textures[i].height]);
                }
                else
                {
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    gl.uniform2fv(prog.txsLocation[i], [1, 1]);
                }
            }

            gl.activeTexture(gl.TEXTURE0);
            
            const lighting = !!(geometryMode & GeometryMode.LIGHTING);
            // When lighting is disabled, the vertex colors are passed to the rasterizer as the SHADE attribute.
            // When lighting is enabled, the vertex colors represent normals and SHADE is computed by the RSP.
            const useVertexColors = lighting ? 0 : 1;
            gl.uniform1i(prog.useVertexColorsLocation, useVertexColors);

            gl.uniform1i(prog.alphaTestLocation, alphaTestMode);
        });
    }
}

type TextureDestFormat = "i8" | "i8_a8" | "rgba8";

interface TextureTile {
    width: number;
    height: number;
    pixels: Uint8Array;
    addr: number;
    format: number;
    dstFormat: TextureDestFormat;

    // XXX(jstpierre): Move somewhere else?
    glTextureId: WebGLTexture;

    // Internal size data.
    lrs: number; lrt: number;
    uls: number; ult: number;
    maskS: number; maskT: number; lineSize: number;

    // wrap modes
    cms: number; cmt: number;
}

// 3 pos + 2 uv + 4 color/nrm
const VERTEX_SIZE = 9;
const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

function readVertex(state: State, which: number, addr: number) {
    const rom = state.rom;
    const offs = state.lookupAddress(addr);
    const posX = rom.view.getInt16(offs + 0, false);
    const posY = rom.view.getInt16(offs + 2, false);
    const posZ = rom.view.getInt16(offs + 4, false);

    const pos = vec3.clone([posX, posY, posZ]);
    vec3.transformMat4(pos, pos, state.mtx);

    const txU = rom.view.getInt16(offs + 8, false) * (1 / 32);
    const txV = rom.view.getInt16(offs + 10, false) * (1 / 32);

    const vtxArray = new Float32Array(state.vertexBuffer.buffer, which * VERTEX_BYTES, VERTEX_SIZE);
    vtxArray[0] = pos[0]; vtxArray[1] = pos[1]; vtxArray[2] = pos[2];
    vtxArray[3] = txU; vtxArray[4] = txV;

    vtxArray[5] = rom.view.getUint8(offs + 12) / 255;
    vtxArray[6] = rom.view.getUint8(offs + 13) / 255;
    vtxArray[7] = rom.view.getUint8(offs + 14) / 255;
    vtxArray[8] = rom.view.getUint8(offs + 15) / 255;
}

function cmd_VTX(state: State, w0: number, w1: number) {
    const N = (w0 >> 12) & 0xFF;
    const V0 = ((w0 >> 1) & 0x7F) - N;
    let addr = w1;

    for (let i = 0; i < N; i++) {
        const which = V0 + i;
        readVertex(state, which, addr);
        addr += 16;
    }
}

function flushDraw(state: State) {
    const gl = state.gl;

    const vtxBufSize = state.vertexData.length / VERTEX_SIZE;
    const vtxOffs = state.vertexOffs;
    const vtxCount = vtxBufSize - vtxOffs;
    state.vertexOffs = vtxBufSize;
    if (vtxCount === 0)
        return;

    state.pushProgramCmds()
    state.cmds.push((renderState: RenderState) => {
        const gl = renderState.gl;
        gl.drawArrays(gl.TRIANGLES, vtxOffs, vtxCount);
    });
}

function translateTRI(state: State, idxData: Uint8Array) {
    idxData.forEach((idx, i) => {
        const offs = idx * VERTEX_SIZE;
        for (let i = 0; i < VERTEX_SIZE; i++) {
            state.vertexData.push(state.vertexBuffer[offs + i]);
        }
    });
}

function tri(idxData: Uint8Array, offs: number, cmd: number) {
    idxData[offs + 0] = (cmd >> 17) & 0x7F;
    idxData[offs + 1] = (cmd >> 9) & 0x7F;
    idxData[offs + 2] = (cmd >> 1) & 0x7F;
}

function flushTexture(state: State) {
    if (state.textureTiles[0] && state.textureTiles[0].addr != 0)
        loadTile(state, state.textureTiles[0]);
    if (state.textureTiles[1] && state.textureTiles[0].addr != 0)
        loadTile(state, state.textureTiles[1])
}

function cmd_TRI1(state: State, w0: number, w1: number) {
    flushTexture(state);
    const idxData = new Uint8Array(3);
    tri(idxData, 0, w0);
    translateTRI(state, idxData);
}

function cmd_TRI2(state: State, w0: number, w1: number) {
    flushTexture(state);
    const idxData = new Uint8Array(6);
    tri(idxData, 0, w0); tri(idxData, 3, w1);
    translateTRI(state, idxData);
}

const GeometryMode = {
    CULL_FRONT: 0x0200,
    CULL_BACK: 0x0400,
    LIGHTING: 0x020000,
};

function cmd_GEOMETRYMODE(state: State, w0: number, w1: number) {
    flushDraw(state)

    state.geometryMode = state.geometryMode & ((~w0) & 0x00FFFFFF) | w1;
    const newMode = state.geometryMode;

    const renderFlags = new RenderFlags();

    const cullFront = newMode & GeometryMode.CULL_FRONT;
    const cullBack = newMode & GeometryMode.CULL_BACK;

    if (cullFront && cullBack)
        renderFlags.cullMode = CullMode.FRONT_AND_BACK;
    else if (cullFront)
        renderFlags.cullMode = CullMode.FRONT;
    else if (cullBack)
        renderFlags.cullMode = CullMode.BACK;
    else
        renderFlags.cullMode = CullMode.NONE;

    state.cmds.push((renderState: RenderState) => {
        renderState.useFlags(renderFlags);
    });
}

const OtherModeL = {
    Z_CMP: 0x0010,
    Z_UPD: 0x0020,
    ZMODE_DEC: 0x0C00,
    CVG_X_ALPHA: 0x1000,
    ALPHA_CVG_SEL: 0x2000,
    FORCE_BL: 0x4000,
};

function cmd_SETOTHERMODE_L(state: State, w0: number, w1: number) {
    flushDraw(state);
    
    const len = extractBits(w0, 0, 8) + 1;
    const sft = Math.max(0, 32 - extractBits(w0, 8, 8) - len);
    const mask = ((1 << len) - 1) << sft;

    state.otherModeL = (state.otherModeL & ~mask) | (w1 & mask);

    const renderFlags = new RenderFlags();
    const newMode = state.otherModeL;

    renderFlags.depthTest = !!(newMode & OtherModeL.Z_CMP);
    renderFlags.depthWrite = !!(newMode & OtherModeL.Z_UPD);

    let alphaTestMode: number;
    if (newMode & OtherModeL.FORCE_BL) {
        alphaTestMode = 0;
        renderFlags.blendMode = BlendMode.ADD;
    } else {
        alphaTestMode = ((newMode & OtherModeL.CVG_X_ALPHA) ? 0x1 : 0 |
                            (newMode & OtherModeL.ALPHA_CVG_SEL) ? 0x2 : 0);
        renderFlags.blendMode = BlendMode.NONE;
    }

    state.cmds.push((renderState: RenderState) => {
        const gl = renderState.gl;
        
        renderState.useFlags(renderFlags);

        if (newMode & OtherModeL.ZMODE_DEC) {
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(-0.5, -0.5);
        } else {
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }
    });
}

function cmd_SETOTHERMODE_H(state: State, w0: number, w1: number) {
    flushDraw(state);

    const len = extractBits(w0, 0, 8) + 1;
    const sft = Math.max(0, 32 - extractBits(w0, 8, 8) - len);
    const mask = ((1 << len) - 1) << sft;

    state.otherModeH = (state.otherModeH & ~mask) | (w1 & mask);
}

function cmd_DL(state: State, w0: number, w1: number) {
    runDL(state, w1);
}

function cmd_MTX(state: State, w0: number, w1: number) {
    if (w1 & 0x80000000) state.mtx = state.mtxStack.pop();
    w1 &= ~0x80000000;

    state.geometryMode = 0;
    state.otherModeL = 0;

    state.mtxStack.push(state.mtx);
    state.mtx = mat4.clone(state.mtx);

    const rom = state.rom;
    let offs = state.lookupAddress(w1);

    const mtx = mat4.create();

    for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
            const mt1 = rom.view.getUint16(offs, false);
            const mt2 = rom.view.getUint16(offs + 32, false);
            mtx[(x * 4) + y] = ((mt1 << 16) | (mt2)) * (1 / 0x10000);
            offs += 2;
        }
    }

    mat4.multiply(state.mtx, state.mtx, mtx);
}

function cmd_POPMTX(state: State, w0: number, w1: number) {
    state.mtx = state.mtxStack.pop();
}

function cmd_TEXTURE(state: State, w0: number, w1: number) {
    // XXX(jstpierre): Bring this back at some point.

    /*
    const boundTexture = {};
    state.boundTexture = boundTexture;

    const s = w1 >> 16;
    const t = w1 & 0x0000FFFF;

    state.boundTexture.scaleS = (s + 1) / 0x10000;
    state.boundTexture.scaleT = (t + 1) / 0x10000;
    */
}

function cmd_SETCOMBINE(state: State, w0: number, w1: number) {
    flushDraw(state);

    state.combiners = Object.freeze({
        colorCombiners: Object.freeze([
            Object.freeze({
                subA: extractBits(w0, 20, 4),
                subB: extractBits(w1, 28, 4),
                mul: extractBits(w0, 15, 5),
                add: extractBits(w1, 15, 3),
            }),
            Object.freeze({
                subA: extractBits(w0, 5, 4),
                subB: extractBits(w1, 24, 4),
                mul: extractBits(w0, 0, 5),
                add: extractBits(w1, 6, 3),
            }),
        ]),
        alphaCombiners: Object.freeze([
            Object.freeze({
                subA: extractBits(w0, 12, 3),
                subB: extractBits(w1, 12, 3),
                mul: extractBits(w0, 9, 3),
                add: extractBits(w1, 9, 3),
            }),
            Object.freeze({
                subA: extractBits(w1, 21, 3),
                subB: extractBits(w1, 3, 3),
                mul: extractBits(w1, 18, 3),
                add: extractBits(w1, 0, 3),
            }),
        ]),
    });
}

function cmd_SETENVCOLOR(state: State, w0: number, w1: number) {
    flushDraw(state);

    state.envColor = vec4.clone([
        extractBits(w1, 24, 8) / 255,
        extractBits(w1, 16, 8) / 255,
        extractBits(w1, 8, 8) / 255,
        extractBits(w1, 0, 8) / 255,
    ]);
}

function cmd_SETPRIMCOLOR(state: State, w0: number, w1: number) {
    flushDraw(state);

    state.primColor = vec4.clone([
        extractBits(w1, 24, 8) / 255,
        extractBits(w1, 16, 8) / 255,
        extractBits(w1, 8, 8) / 255,
        extractBits(w1, 0, 8) / 255,
    ]);
}

function r5g5b5a1(dst: Uint8Array, dstOffs: number, p: number) {
    let r, g, b, a;

    r = (p & 0xF800) >> 11;
    r = (r << (8 - 5)) | (r >> (10 - 8));

    g = (p & 0x07C0) >> 6;
    g = (g << (8 - 5)) | (g >> (10 - 8));

    b = (p & 0x003E) >> 1;
    b = (b << (8 - 5)) | (b >> (10 - 8));

    a = (p & 0x0001) ? 0xFF : 0x00;

    dst[dstOffs + 0] = r;
    dst[dstOffs + 1] = g;
    dst[dstOffs + 2] = b;
    dst[dstOffs + 3] = a;
}

function cmd_SETTIMG(state: State, w0: number, w1: number) {
    const format = (w0 >> 21) & 0x7;
    const size = (w0 >> 19) & 0x3;
    const width = (w0 & 0x1000) + 1;
    const addr = w1;
    state.textureImageAddr = addr;
}

function cmd_SETTILE(state: State, w0: number, w1: number) {
    state.currentTile = {
        format: (w0 >> 16) & 0xFF,
        cms: (w1 >> 8) & 0x3,
        cmt: (w1 >> 18) & 0x3,
        // tmem: w0 & 0x1FF,
        lineSize: (w0 >> 9) & 0x1FF,
        // palette: (w1 >> 20) & 0xF,
        // shiftS: w1 & 0xF,
        // shiftT: (w1 >> 10) & 0xF,
        maskS: (w1 >> 4) & 0xF,
        maskT: (w1 >> 14) & 0xF,

        width: 0, height: 0, dstFormat: null,
        pixels: null, addr: 0, glTextureId: null,
        uls: 0, ult: 0, lrs: 0, lrt: 0,
    };
}

function cmd_SETTILESIZE(state: State, w0: number, w1: number) {
    const tileIdx = (w1 >> 24) & 0x7;
    // XXX(jstpierre): Multiple tiles?
    const tile = state.currentTile;

    tile.uls = (w0 >> 14) & 0x3FF;
    tile.ult = (w0 >> 2) & 0x3FF;
    tile.lrs = (w1 >> 14) & 0x3FF;
    tile.lrt = (w1 >> 2) & 0x3FF;

    calcTextureSize(tile);
}

function cmd_LOADTLUT(state: State, w0: number, w1: number) {
    const rom = state.rom;

    // XXX: properly implement uls/ult/lrs/lrt
    const size = ((w1 & 0x00FFF000) >> 14) + 1;
    const dst = new Uint8Array(size * 4);

    let srcOffs = state.lookupAddress(state.textureImageAddr);
    let dstOffs = 0;

    for (let i = 0; i < size; i++) {
        const pixel = rom.view.getUint16(srcOffs, false);
        r5g5b5a1(dst, dstOffs, pixel);
        srcOffs += 2;
        dstOffs += 4;
    }

    state.palettePixels = dst;
}

function tileCacheKey(state: State, tile: TextureTile) {
    // XXX: Do we need more than this?
    const srcOffs = state.lookupAddress(tile.addr);
    return srcOffs;
}

// XXX: This is global to cut down on resources between DLs.
const tileCache = new Map<number, TextureTile>();
function loadTile(state: State, texture: TextureTile) {
    if (texture.glTextureId)
        return;

    const key = tileCacheKey(state, texture);
    const otherTile = tileCache.get(key);
    if (!otherTile) {
        translateTexture(state, texture);
        tileCache.set(key, texture);
    } else if (texture !== otherTile) {
        texture.glTextureId = otherTile.glTextureId;
    }
}

function convert_CI4(state: State, texture: TextureTile) {
    const palette = state.palettePixels;
    if (!palette)
        return;

    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);
    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);
            let idx;

            idx = ((b & 0xF0) >> 4) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];

            idx = (b & 0x0F) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
        }
    }

    texture.pixels = dst;
}

function convert_I4(state: State, texture: TextureTile) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);

            let p;
            p = (b & 0xF0) >> 4;
            p = p << 4 | p;
            dst[i++] = p;
            dst[i++] = p;

            p = (b & 0x0F);
            p = p << 4 | p;
            dst[i++] = p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_IA4(state: State, texture: TextureTile) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);
            let p; let pm;

            p = (b & 0xF0) >> 4;
            pm = p & 0x0E;
            dst[i++] = (pm << 4 | pm);
            dst[i++] = (p & 0x01) ? 0xFF : 0x00;

            p = (b & 0x0F);
            pm = p & 0x0E;
            dst[i++] = (pm << 4 | pm);
            dst[i++] = (p & 0x01) ? 0xFF : 0x00;
        }
    }

    texture.pixels = dst;
}

function convert_CI8(state: State, texture: TextureTile) {
    const palette = state.palettePixels;
    if (!palette)
        return;

    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            let idx = state.rom.view.getUint8(srcOffs) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            srcOffs++;
        }
    }

    texture.pixels = dst;
}

function convert_I8(state: State, texture: TextureTile) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const p = state.rom.view.getUint8(srcOffs++);
            dst[i++] = p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_IA8(state: State, texture: TextureTile) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const b = state.rom.view.getUint8(srcOffs++);
            let p;

            p = (b & 0xF0) >> 4;
            p = p << 4 | p;
            dst[i++] = p;

            p = (b & 0x0F);
            p = p >> 4 | p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_RGBA16(state: State, texture: TextureTile) {
    const rom = state.rom;
    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const pixel = rom.view.getUint16(srcOffs, false);
            r5g5b5a1(dst, i, pixel);
            i += 4;
            srcOffs += 2;
        }
    }

    texture.pixels = dst;
}

function convert_IA16(state: State, texture: TextureTile) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            dst[i++] = state.rom.view.getUint8(srcOffs++);
            dst[i++] = state.rom.view.getUint8(srcOffs++);
        }
    }

    texture.pixels = dst;
}

function textureToCanvas(texture: TextureTile): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    if (texture.dstFormat === "i8") {
        for (let si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
            imgData.data[di + 0] = texture.pixels[si];
            imgData.data[di + 1] = texture.pixels[si];
            imgData.data[di + 2] = texture.pixels[si];
            imgData.data[di + 3] = 255;
        }
    } else if (texture.dstFormat === "i8_a8") {
        for (let si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
            imgData.data[di + 0] = texture.pixels[si];
            imgData.data[di + 1] = texture.pixels[si];
            imgData.data[di + 2] = texture.pixels[si];
            imgData.data[di + 3] = texture.pixels[si + 1];
        }
    } else if (texture.dstFormat === "rgba8") {
        imgData.data.set(texture.pixels);
    }

    canvas.title = '0x' + texture.addr.toString(16) + '  ' + texture.format.toString(16) + '  ' + texture.dstFormat;
    ctx.putImageData(imgData, 0, 0);

    const surfaces = [ canvas ];
    return { name: canvas.title, surfaces };
}

function translateTexture(state: State, texture: TextureTile) {
    const gl = state.gl;

    function convertTexturePixels() {
        switch (texture.format) {
        // 4-bit
        case 0x40: return convert_CI4(state, texture);    // CI
        case 0x60: return convert_IA4(state, texture);    // IA
        case 0x80: return convert_I4(state, texture);     // I
        // 8-bit
        case 0x48: return convert_CI8(state, texture);    // CI
        case 0x68: return convert_IA8(state, texture);    // IA
        case 0x88: return convert_I8(state, texture);     // I
        // 16-bit
        case 0x10: return convert_RGBA16(state, texture); // RGBA
        case 0x70: return convert_IA16(state, texture);   // IA
        default: console.error("Unsupported texture", texture.format.toString(16));
        }
    }

    texture.dstFormat = calcTextureDestFormat(texture);

    const srcOffs = state.lookupAddress(texture.addr);
    if (srcOffs !== null)
        convertTexturePixels();

    if (!texture.pixels) {
        if (texture.dstFormat === "i8")
            texture.pixels = new Uint8Array(texture.width * texture.height);
        else if (texture.dstFormat === "i8_a8")
            texture.pixels = new Uint8Array(texture.width * texture.height * 2);
        else if (texture.dstFormat === "rgba8")
            texture.pixels = new Uint8Array(texture.width * texture.height * 4);
    }

    function translateWrap(cm: number) {
        switch (cm) {
            case 1: return gl.MIRRORED_REPEAT;
            case 2: return gl.CLAMP_TO_EDGE;
            case 3: return gl.CLAMP_TO_EDGE;
            default: return gl.REPEAT;
        }
    }

    const texId = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texId);
    // Filters are set to NEAREST here because filtering is performed in the fragment shader.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrap(texture.cms));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrap(texture.cmt));

    let glFormat;
    if (texture.dstFormat === "i8")
        glFormat = gl.LUMINANCE;
    else if (texture.dstFormat === "i8_a8")
        glFormat = gl.LUMINANCE_ALPHA;
    else if (texture.dstFormat === "rgba8")
        glFormat = gl.RGBA;

    gl.texImage2D(gl.TEXTURE_2D, 0, glFormat, texture.width, texture.height, 0, glFormat, gl.UNSIGNED_BYTE, texture.pixels);
    texture.glTextureId = texId;

    state.textures.push(textureToCanvas(texture));
}

function calcTextureDestFormat(texture: TextureTile): TextureDestFormat {
    switch (texture.format & 0xE0) {
    case 0x00: return "rgba8"; // RGBA
    case 0x40: return "rgba8"; // CI -- XXX -- do we need to check the palette type?
    case 0x60: return "i8_a8"; // IA
    case 0x80: return "i8_a8"; // I
    default: throw new Error("Invalid texture type");
    }
}

function calcTextureSize(texture: TextureTile) {
    let maxTexel, lineShift;
    switch (texture.format) {
    // 4-bit
    case 0x00: maxTexel = 4096; lineShift = 4; break; // RGBA
    case 0x40: maxTexel = 4096; lineShift = 4; break; // CI
    case 0x60: maxTexel = 8196; lineShift = 4; break; // IA
    case 0x80: maxTexel = 8196; lineShift = 4; break; // I
    // 8-bit
    case 0x08: maxTexel = 2048; lineShift = 3; break; // RGBA
    case 0x48: maxTexel = 2048; lineShift = 3; break; // CI
    case 0x68: maxTexel = 4096; lineShift = 3; break; // IA
    case 0x88: maxTexel = 4096; lineShift = 3; break; // I
    // 16-bit
    case 0x10: maxTexel = 2048; lineShift = 2; break; // RGBA
    case 0x50: maxTexel = 2048; lineShift = 0; break; // CI
    case 0x70: maxTexel = 2048; lineShift = 2; break; // IA
    case 0x90: maxTexel = 2048; lineShift = 0; break; // I
    // 32-bit
    case 0x18: maxTexel = 1024; lineShift = 2; break; // RGBA
    default:
        throw "whoops";
    }

    const lineW = texture.lineSize << lineShift;
    const tileW = texture.lrs - texture.uls + 1;
    const tileH = texture.lrt - texture.ult + 1;

    const maskW = 1 << texture.maskS;
    const maskH = 1 << texture.maskT;

    let lineH;
    if (lineW > 0)
        lineH = Math.min(maxTexel / lineW, tileH);
    else
        lineH = 0;

    let width;
    if (texture.maskS > 0 && (maskW * maskH) <= maxTexel)
        width = maskW;
    else if ((tileW * tileH) <= maxTexel)
        width = tileW;
    else
        width = lineW;

    let height;
    if (texture.maskT > 0 && (maskW * maskH) <= maxTexel)
        height = maskH;
    else if ((tileW * tileH) <= maxTexel)
        height = tileH;
    else
        height = lineH;

    texture.width = width;
    texture.height = height;
}

type CommandFunc = (state: State, w0: number, w1: number) => void;

const CommandDispatch: { [n: number]: CommandFunc } = {};
CommandDispatch[UCodeCommands.VTX] = cmd_VTX;
CommandDispatch[UCodeCommands.TRI1] = cmd_TRI1;
CommandDispatch[UCodeCommands.TRI2] = cmd_TRI2;
CommandDispatch[UCodeCommands.GEOMETRYMODE] = cmd_GEOMETRYMODE;
CommandDispatch[UCodeCommands.DL] = cmd_DL;
CommandDispatch[UCodeCommands.MTX] = cmd_MTX;
CommandDispatch[UCodeCommands.POPMTX] = cmd_POPMTX;
CommandDispatch[UCodeCommands.SETOTHERMODE_L] = cmd_SETOTHERMODE_L;
CommandDispatch[UCodeCommands.SETOTHERMODE_H] = cmd_SETOTHERMODE_H;
CommandDispatch[UCodeCommands.LOADTLUT] = cmd_LOADTLUT;
CommandDispatch[UCodeCommands.TEXTURE] = cmd_TEXTURE;
CommandDispatch[UCodeCommands.SETCOMBINE] = cmd_SETCOMBINE;
CommandDispatch[UCodeCommands.SETENVCOLOR] = cmd_SETENVCOLOR;
CommandDispatch[UCodeCommands.SETPRIMCOLOR] = cmd_SETPRIMCOLOR;
CommandDispatch[UCodeCommands.SETTIMG] = cmd_SETTIMG;
CommandDispatch[UCodeCommands.SETTILE] = cmd_SETTILE;
CommandDispatch[UCodeCommands.SETTILESIZE] = cmd_SETTILESIZE;

const F3DEX2 = {};

function loadTextureBlock(state: State, cmds: number[][]) {
    flushDraw(state)

    const tileIdx = (cmds[5][1] >> 24) & 0x7;

    cmd_SETTIMG(state, cmds[0][0], cmds[0][1]);
    cmd_SETTILE(state, cmds[5][0], cmds[5][1]); // state.currentTile is constructed here
    cmd_SETTILESIZE(state, cmds[6][0], cmds[6][1]);
    state.currentTile.addr = state.textureImageAddr;

    state.textureTiles[tileIdx] = state.currentTile
}

function runDL(state: State, addr: number) {
    function collectNextCmds(): number[][] {
        const L = [];
        let voffs = offs;
        for (let i = 0; i < 8; i++) {
            const cmd0 = rom.view.getUint32(voffs, false);
            const cmd1 = rom.view.getUint32(voffs + 4, false);
            L.push([cmd0, cmd1]);
            voffs += 8;
        }
        return L;
    }
    function matchesCmdStream(cmds: number[][], needle: number[]): boolean {
        for (let i = 0; i < needle.length; i++)
            if (cmds[i][0] >>> 24 !== needle[i])
                return false;
        return true;
    }

    const rom = state.rom;
    let offs = state.lookupAddress(addr);
    if (offs === null)
        return;
    while (true) {
        const cmd0 = rom.view.getUint32(offs, false);
        const cmd1 = rom.view.getUint32(offs + 4, false);

        const cmdType = cmd0 >>> 24;
        if (cmdType === UCodeCommands.ENDDL)
            break;

        // Texture uploads need to be special.
        if (cmdType === UCodeCommands.SETTIMG) {
            const nextCmds = collectNextCmds();
            if (matchesCmdStream(nextCmds, [UCodeCommands.SETTIMG, UCodeCommands.SETTILE, UCodeCommands.RDPLOADSYNC, UCodeCommands.LOADBLOCK, UCodeCommands.RDPPIPESYNC, UCodeCommands.SETTILE, UCodeCommands.SETTILESIZE])) {
                loadTextureBlock(state, nextCmds);
                offs += 7 * 8;
                continue;
            }
        }

        const func = CommandDispatch[cmdType];
        if (func)
            func(state, cmd0, cmd1);
        offs += 8;
    }

    flushDraw(state);
}

export class DL {
    constructor(public vao: WebGLVertexArrayObject, public cmds: CmdFunc[], public textures: Viewer.Texture[]) {
    }

    render(renderState: RenderState) {
        const gl = renderState.gl;
        gl.bindVertexArray(this.vao);
        this.cmds.forEach((cmd) => {
            cmd(renderState);
        })
        gl.bindVertexArray(null);
    }
}

export function readDL(gl: WebGL2RenderingContext, rom: ZELVIEW0.ZELVIEW0, banks: ZELVIEW0.RomBanks, startAddr: number): DL {
    const state = new State();

    state.gl = gl;
    state.cmds = [];
    state.textures = [];

    state.mtx = mat4.create();
    state.mtxStack = [state.mtx];

    state.vertexBuffer = new Float32Array(32 * VERTEX_SIZE);
    state.vertexData = [];
    state.vertexOffs = 0;

    state.rom = rom;
    state.banks = banks;

    runDL(state, startAddr);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vertBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(state.vertexData), gl.STATIC_DRAW);

    gl.vertexAttribPointer(Render.F3DEX2Program.a_Position, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.vertexAttribPointer(Render.F3DEX2Program.a_UV, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
    gl.vertexAttribPointer(Render.F3DEX2Program.a_Shade, 4, gl.FLOAT, false, VERTEX_BYTES, 5 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(Render.F3DEX2Program.a_Position);
    gl.enableVertexAttribArray(Render.F3DEX2Program.a_UV);
    gl.enableVertexAttribArray(Render.F3DEX2Program.a_Shade);

    gl.bindVertexArray(null);

    return new DL(vao, state.cmds, state.textures);
}
