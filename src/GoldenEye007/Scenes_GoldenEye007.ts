
import { SceneDesc, SceneContext } from "../SceneBase";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneGfx, SceneGroup } from "../viewer";
import { EmptyScene } from "../Scenes_Test";
import Pako from "pako";
import { assert, readString, hexzero, nArray } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec3 } from "gl-matrix";
import { CombineParams, decodeCombineParams } from "../Common/N64/RDP";
import { loadVertexFromView } from "../Common/N64/RSP";
import { TextFilt, TexCM } from "../Common/N64/Image";
import { colorFromRGBA, colorNewCopy, White } from "../Color";

const pathBase = `GoldenEye007`;

function decompress1172(buffer: ArrayBufferSlice, offs: number): ArrayBufferSlice {
    const view = buffer.createDataView();
    assert(view.getUint16(offs + 0x00, false) === 0x1172);
    return new ArrayBufferSlice(Pako.inflateRaw(buffer.createTypedArray(Uint8Array, offs + 0x02), { raw: true }).buffer);
}

function maybeDecompress1172(buffer: ArrayBufferSlice, offs: number): ArrayBufferSlice {
    const view = buffer.createDataView();
    if (view.getUint16(offs + 0x00, false) === 0x1172) {
        return decompress1172(buffer, offs);
    } else {
        return buffer.slice(offs);
    }
}

export class TextureState {
    public on: boolean = false;
    public tile: number = 0;
    public level: number = 0;
    public s: number = 0;
    public t: number = 0;

    public set(on: boolean, tile: number, level: number, s: number, t: number): void {
        this.on = on; this.tile = tile; this.level = level; this.s = s; this.t = t;
    }

    public copy(o: TextureState): void {
        this.set(o.on, o.tile, o.level, o.s, o.t);
    }
}

export class Vertex {
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    // Texture coordinates.
    public tx: number = 0;
    public ty: number = 0;
    // Color or normals.
    public c0: number = 0;
    public c1: number = 0;
    public c2: number = 0
    // Alpha.
    public a: number = 0;
    // Pretend.
    public matrixIndex: number = 0;

    public copy(v: Vertex): void {
        this.x = v.x; this.y = v.y; this.z = v.z;
        this.matrixIndex = v.matrixIndex;
        this.tx = v.tx; this.ty = v.ty;
        this.c0 = v.c0; this.c1 = v.c1; this.c2 = v.c2; this.a = v.a;
    }
}

class StagingVertex extends Vertex {
    public outputIndex: number = -1;

    public setFromView(view: DataView, offs: number): void {
        this.outputIndex = -1;
        loadVertexFromView(this, view, offs);
    }
}

class GETextureState {
    public cms = TexCM.WRAP;
    public cmt = TexCM.WRAP;
    public stOffset: number = 0;
    public imageID: number = -1;

    public setFromCommand(w0: number, w1: number): void {
        const type = w0 & 0x0F;
        assert(type === 0x02);

        const mirrorS = !!(w0 & 0x00800000);
        const clampS  = !!(w0 & 0x00400000);
        this.cms = (mirrorS ? TexCM.MIRROR : 0) | (clampS ? TexCM.CLAMP : 0);

        const mirrorT = !!(w0 & 0x00200000);
        const clampT  = !!(w0 & 0x00100000);
        this.cmt = (mirrorT ? TexCM.MIRROR : 0) | (clampT ? TexCM.CLAMP : 0);

        this.stOffset = (w0 >>> 16) & 0x000F;
        this.imageID = w1 & 0x0000FFFF;
    }

    public copy(o: GETextureState): void {
        this.cms = o.cms;
        this.cmt = o.cmt;
        this.stOffset = o.stOffset;
        this.imageID = o.imageID;
    }
}

export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public SP_TextureState = new TextureState();
    public DP_OtherModeL: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_Combine: CombineParams;

    public GE_TextureState = new GETextureState();

    public firstIndex: number = 0;
    public indexCount: number = 0;
}

export class RSPOutput {
    public vertices: Vertex[] = [];
    public indices: number[] = [];
    public drawCalls: DrawCall[] = [];

    private currentDrawCall: DrawCall;

    constructor() {
        this.newDrawCall();
    }

    public pushVertex(v: StagingVertex): void {
        if (v.outputIndex === -1) {
            const n = new Vertex();
            n.copy(v);
            this.vertices.push(n);
            v.outputIndex = this.vertices.length - 1;
        }

        this.indices.push(v.outputIndex);
        this.currentDrawCall.indexCount++;
    }

    public newDrawCall(): DrawCall {
        this.currentDrawCall = new DrawCall();
        this.currentDrawCall.firstIndex = this.indices.length;
        this.drawCalls.push(this.currentDrawCall);
        return this.currentDrawCall;
    }
}

export const enum OtherModeH_Layout {
    G_MDSFT_BLENDMASK   = 0,
    G_MDSFT_ALPHADITHER = 4,
    G_MDSFT_RGBDITHER   = 6,
    G_MDSFT_COMBKEY     = 8,
    G_MDSFT_TEXTCONV    = 9,
    G_MDSFT_TEXTFILT    = 12,
    G_MDSFT_TEXTLUT     = 14,
    G_MDSFT_TEXTLOD     = 16,
    G_MDSFT_TEXTDETAIL  = 17,
    G_MDSFT_TEXTPERSP   = 19,
    G_MDSFT_CYCLETYPE   = 20,
    G_MDSFT_COLORDITHER = 22,
    G_MDSFT_PIPELINE    = 23,
}

export const enum OtherModeH_CycleType {
    G_CYC_1CYCLE = 0x00,
    G_CYC_2CYCLE = 0x01,
    G_CYC_COPY   = 0x02,
    G_CYC_FILL   = 0x03,
}

export function getCycleTypeFromOtherModeH(modeH: number): OtherModeH_CycleType {
    return (modeH >>> OtherModeH_Layout.G_MDSFT_CYCLETYPE) & 0x03;
}

export function getTextFiltFromOtherModeH(modeH: number): TextFilt {
    return (modeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03;
}

export class RSPState {
    private output = new RSPOutput();

    private stateChanged: boolean = false;
    private vertexCache = nArray(64, () => new StagingVertex());

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new TextureState();
    private SP_MatrixStackDepth = 0;

    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_EnvColor = colorNewCopy(White);

    private GE_TextureState = new GETextureState();

    constructor(public segmentBuffers: ArrayBufferSlice[]) {
    }

    public finish(): RSPOutput | null {
        if (this.output.drawCalls.length === 0)
            return null;

        return this.output;
    }

    private _setGeometryMode(newGeometryMode: number) {
        if (this.SP_GeometryMode === newGeometryMode)
            return;
        this.stateChanged = true;
        this.SP_GeometryMode = newGeometryMode;
    }

    public gSPSetGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode | mask);
    }

    public gSPClearGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode & ~mask);
    }

    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        // This is the texture we're using to rasterize triangles going forward.
        this.SP_TextureState.set(on, tile, level, s / 0x10000, t / 0x10000);
        this.stateChanged = true;
    }

    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        const segment = (dramAddr >>> 24);
        const view = this.segmentBuffers[segment].createDataView();

        let addrIdx = dramAddr & 0x00FFFFFF;
        for (let i = 0; i < n; i++) {
            this.vertexCache[v0 + i].setFromView(view, addrIdx);
            addrIdx += 0x10;
        }
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this.output.newDrawCall();
            dc.SP_GeometryMode = this.SP_GeometryMode;
            dc.SP_TextureState.copy(this.SP_TextureState);
            dc.DP_Combine = decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
            dc.DP_OtherModeH = this.DP_OtherModeH;
            dc.DP_OtherModeL = this.DP_OtherModeL;
            dc.GE_TextureState.copy(this.GE_TextureState);
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();

        this.output.pushVertex(this.vertexCache[i0]);
        this.output.pushVertex(this.vertexCache[i1]);
        this.output.pushVertex(this.vertexCache[i2]);
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
        if (DP_OtherModeL !== this.DP_OtherModeL) {
            this.DP_OtherModeL = DP_OtherModeL;
            this.stateChanged = true;
        }
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
        if (DP_OtherModeH !== this.DP_OtherModeH) {
            this.DP_OtherModeH = DP_OtherModeH;
            this.stateChanged = true;
        }
    }

    public gDPSetCombine(w0: number, w1: number): void {
        if (this.DP_CombineH !== w0 || this.DP_CombineL !== w1) {
            this.DP_CombineH = w0;
            this.DP_CombineL = w1;
            this.stateChanged = true;
        }
    }

    public gDPSetEnvColor(r: number, g: number, b: number, a: number): void {
        colorFromRGBA(this.DP_EnvColor, r, g, b, a);
        this.stateChanged = true;
    }

    public geTexture(w0: number, w1: number): void {
        this.GE_TextureState.setFromCommand(w0, w1);
        // Assume that things have changed.
        this.stateChanged = true;
    }
}

enum F3D_GBI {
    // DMA
    G_MTX               = 0x01,
    G_MOVEMEM           = 0x03,
    // G_VTX            = 0x04,
    GE_VTX              = 0x04,
    G_DL                = 0x06,

    // IMM
    G_TRI1              = 0xBF,
    G_CULLDL            = 0xBE,
    G_POPMTX            = 0xBD,
    G_MOVEWORD          = 0xBC,
    G_TEXTURE           = 0xBB,
    G_SETOTHERMODE_H    = 0xBA,
    G_SETOTHERMODE_L    = 0xB9,
    G_ENDDL             = 0xB8,
    G_SETGEOMETRYMODE   = 0xB7,
    G_CLEARGEOMETRYMODE = 0xB6,
    G_LINE3D            = 0xB5,
    G_RDPHALF_1         = 0xB4,
    G_RDPHALF_2         = 0xB3,
    G_MODIFYVTX         = 0xB2,
    // G_TRI2           = 0xB1,
    GE_TRI4             = 0xB1,
    G_BRANCH_Z          = 0xB0,
    G_LOAD_UCODE        = 0xAF,

    // RDP
    G_SETCIMG           = 0xFF,
    G_SETZIMG           = 0xFE,
    G_SETTIMG           = 0xFD,
    G_SETCOMBINE        = 0xFC,
    G_SETENVCOLOR       = 0xFB,
    G_SETPRIMCOLOR      = 0xFA,
    G_SETBLENDCOLOR     = 0xF9,
    G_SETFOGCOLOR       = 0xF8,
    G_SETFILLCOLOR      = 0xF7,
    G_FILLRECT          = 0xF6,
    G_SETTILE           = 0xF5,
    G_LOADTILE          = 0xF4,
    G_LOADBLOCK         = 0xF3,
    G_SETTILESIZE       = 0xF2,
    G_LOADTLUT          = 0xF0,
    G_RDPSETOTHERMODE   = 0xEF,
    G_SETPRIMDEPTH      = 0xEE,
    G_SETSCISSOR        = 0xED,
    G_SETCONVERT        = 0xEC,
    G_SETKEYR           = 0xEB,
    G_SETKEYFB          = 0xEA,
    G_RDPFULLSYNC       = 0xE9,
    G_RDPTILESYNC       = 0xE8,
    G_RDPPIPESYNC       = 0xE7,
    G_RDPLOADSYNC       = 0xE6,
    G_TEXRECTFLIP       = 0xE5,
    G_TEXRECT           = 0xE4,

    // Special.
    // no-op, interpreted CPU-side as a way of supplying textures.
    GE_TEXTURE          = 0xC0,
}

function runDL_F3D(state: RSPState, addr: number): void {
    const segmentBuffer = state.segmentBuffers[(addr >>> 24) & 0xFF];
    const view = segmentBuffer.createDataView();

    for (let i = (addr & 0x00FFFFFF); i < segmentBuffer.byteLength; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3D_GBI = w0 >>> 24;
        console.log(hexzero(i, 8), F3D_GBI[cmd], hexzero(w0, 8), hexzero(w1, 8));

        switch (cmd) {
        case F3D_GBI.G_ENDDL:
            return;

        case F3D_GBI.G_CLEARGEOMETRYMODE:
            state.gSPClearGeometryMode(w1);
            break;

        case F3D_GBI.G_SETGEOMETRYMODE:
            state.gSPSetGeometryMode(w1);
            break;

        case F3D_GBI.G_TEXTURE: {
            const level = (w0 >>> 11) & 0x07;
            let   tile  = (w0 >>> 8) & 0x07;
            const on    = !!((w0 >>> 0) & 0x7F);
            const s     = (w1 >>> 16) & 0xFFFF;
            const t     = (w1 >>> 0)  & 0xFFFF;
            state.gSPTexture(on, tile, level, s, t);
        } break;

        case F3D_GBI.GE_VTX: {
            // const v0 = ((w0 >>> 16) & 0xFF) / 2;
            // const n = (w0 >>> 0) & 0x3F;
            const v0 = 0;
            const n = (w0 >>> 20) & 0x0F;
            state.gSPVertex(w1, n, v0);
        } break;

        case F3D_GBI.G_TRI1: {
            const i0 = ((w1 >>> 16) & 0xFF) / 2;
            const i1 = ((w1 >>>  8) & 0xFF) / 2;
            const i2 = ((w1 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        } break;

        case F3D_GBI.GE_TRI4: {
        {
            const i0 = ((w1 >>>  0) & 0x0F);
            const i1 = ((w1 >>>  4) & 0x0F);
            const i2 = ((w0 >>>  0) & 0x0F);
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>>  8) & 0x0F);
            const i1 = ((w1 >>> 12) & 0x0F);
            const i2 = ((w0 >>>  4) & 0x0F);
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>> 16) & 0x0F);
            const i1 = ((w1 >>> 20) & 0x0F);
            const i2 = ((w0 >>>  8) & 0x0F);
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>> 24) & 0x0F);
            const i1 = ((w1 >>> 28) & 0x0F);
            const i2 = ((w0 >>> 12) & 0x0F);
            state.gSPTri(i0, i1, i2);
        }
        } break;

        case F3D_GBI.G_DL: {
            runDL_F3D(state, w1);
        } break;

        case F3D_GBI.G_SETOTHERMODE_H: {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            state.gDPSetOtherModeH(sft, len, w1);
        } break;

        case F3D_GBI.G_SETOTHERMODE_L: {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            state.gDPSetOtherModeL(sft, len, w1);
        } break;

        case F3D_GBI.G_SETCOMBINE: {
            state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
        } break;
        
        case F3D_GBI.G_SETENVCOLOR: {
            const r = ((w1 >>> 24) & 0xFF) / 0xFF;
            const g = ((w1 >>> 16) & 0xFF) / 0xFF;
            const b = ((w1 >>> 8) & 0xFF) / 0xFF;
            const a = ((w1 >>> 0) & 0xFF) / 0xFF;
            state.gDPSetEnvColor(r, g, b, a);
        } break;

        case F3D_GBI.G_RDPFULLSYNC:
        case F3D_GBI.G_RDPTILESYNC:
        case F3D_GBI.G_RDPPIPESYNC:
        case F3D_GBI.G_RDPLOADSYNC:
            // Implementation not necessary.
            break;

        case F3D_GBI.GE_TEXTURE: {
            // TODO(jstpierre)
            state.geTexture(w0, w1);
        } break;

        default:
            console.error(`Unknown DL opcode: ${F3D_GBI[cmd]} / ${hexzero(cmd, 4)}`);
        }
    }
}

interface FSFile {
    fileID: number;
    name: string;
    data: ArrayBufferSlice;
}

interface LevelTableEntry {
    levelID: number;
    bgName: string;
    stanName: string;
    globalScale: number;
}

interface ROM {
    fs: FSFile[];
    levelTable: LevelTableEntry[];
}

function parseROM(buffer: ArrayBufferSlice): ROM {
    const rodata = decompress1172(buffer, 0x21990);
    const rodataAddr = 0x80020D90;
    const view = rodata.createDataView();

    // Parse filesystem table.
    const fileCount = view.getUint16(0x27546);
    assert(fileCount === 727);

    const fs: FSFile[] = [];
    let fileTableIdx = 0x252C4;
    for (let i = 0; i < fileCount; i++) {
        const fileID = view.getUint32(fileTableIdx + 0x00);
        const nameAddr = view.getUint32(fileTableIdx + 0x04);
        const romAddr = view.getUint32(fileTableIdx + 0x08);
        if (romAddr !== 0) {
            const name = readString(rodata, (nameAddr - rodataAddr), 0x20, true);
            const data = maybeDecompress1172(buffer, romAddr);
            fs.push({ fileID, name, data });
        }
        fileTableIdx += 0x0C;
    }

    // Parse level table.
    const levelTable: LevelTableEntry[] = [];
    let levelTableIdx = 0x0236FC;
    for (let i = 0; i < 38; i++) {
        const levelID = view.getUint32(levelTableIdx + 0x00);
        const bgNameAddr = view.getUint32(levelTableIdx + 0x04);
        const bgName = readString(rodata, (bgNameAddr - rodataAddr), 0x20, true);
        const stanNameAddr = view.getUint32(levelTableIdx + 0x08);
        const stanName = readString(rodata, (stanNameAddr - rodataAddr), 0x20, true);
        const globalScale = view.getFloat32(levelTableIdx + 0x0C);
        const visibility = view.getFloat32(levelTableIdx + 0x10);
        const unknown = view.getFloat32(levelTableIdx + 0x14);
        levelTable.push({ levelID, bgName, stanName, globalScale });
        levelTableIdx += 0x18;
    }

    return { fs, levelTable };
}

interface BGRoomData {
    position: vec3;
    vertexData: ArrayBufferSlice;
    dlOpaData: ArrayBufferSlice;
    dlXluData: ArrayBufferSlice | null;
}

interface BGData {
    rooms: BGRoomData[];
}

function parseBG(bgData: ArrayBufferSlice): BGData {
    const view = bgData.createDataView();

    const roomTableOffs = view.getUint32(0x04) & 0x00FFFFFF;
    const portalTableOffs = view.getUint32(0x08) & 0x00FFFFFF;
    const visCmdTableOffs = view.getUint32(0x0C) & 0x00FFFFFF;

    let roomTableIdx = roomTableOffs;

    const rooms: BGRoomData[] = [];

    for (let i = 0; i < 1000; i++, roomTableIdx += 0x18) {
        const vertexDataOffs = view.getUint32(roomTableIdx + 0x00) & 0x00FFFFFF;
        const dlOpaOffs = view.getUint32(roomTableIdx + 0x04) & 0x00FFFFFF;
        const dlXluOffs = view.getUint32(roomTableIdx + 0x08) & 0x00FFFFFF;

        const x = view.getFloat32(roomTableIdx + 0x0C);
        const y = view.getFloat32(roomTableIdx + 0x10);
        const z = view.getFloat32(roomTableIdx + 0x14);

        // First room is always empty. Skip.
        if (vertexDataOffs === 0) {
            assert(i === 0);
            continue;
        }

        // Empty entry. Return.
        if (view.getUint32(vertexDataOffs) === 0)
            break;

        const position = vec3.fromValues(x, y, z);
        const vertexData = decompress1172(bgData, vertexDataOffs);
        const dlOpaData = decompress1172(bgData, dlOpaOffs);
        const dlXluData = dlXluOffs !== 0 ? decompress1172(bgData, dlXluOffs) : null;

        rooms.push({ position, vertexData, dlOpaData, dlXluData });
    }

    return { rooms };
}

class GoldenEye007LevelSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const romData = await dataFetcher.fetchData(`${pathBase}/rom.z64`);
        const rom = parseROM(romData);
        console.log(rom);

        // The first level, for now
        const level = rom.levelTable[0];
        const bgFile = rom.fs.find((file) => file.name === level.bgName)!;
        const bg = parseBG(bgFile.data);

        const room = bg.rooms[0];
        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x01] = room.dlOpaData;
        segmentBuffers[0x0e] = room.vertexData;
        const state = new RSPState(segmentBuffers);
        runDL_F3D(state, 0x01000000);
        console.log(state);

        return new EmptyScene();
    }
}

const sceneDescs = [
    new GoldenEye007LevelSceneDesc('Test'),
];

const id = 'GoldenEye007';
const name = 'GoldenEye: 007';

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
