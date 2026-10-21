import { vec4 } from "gl-matrix";
import * as RDP from "../Common/N64/RDP.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { nArray } from "../util.js";
import { ImageFormat, getImageFormatName, ImageSize, getImageSizeName } from "../Common/N64/Image.js";
import { loadVertexFromView } from "../Common/N64/RSP.js";

export class TextureState {
    public on = false;
    public tile = 0;
    public level = 0;
    public s = 0;
    public t = 0;

    public set(on: boolean, tile: number, level: number, s: number, t: number): void {
        this.on = on;
        this.tile = tile;
        this.level = level;
        this.s = s;
        this.t = t;
    }

    public copy(o: TextureState): void {
        this.set(o.on, o.tile, o.level, o.s, o.t);
    }
}

export class Vertex {
    public x = 0;
    public y = 0;
    public z = 0;
    public tx = 0;
    public ty = 0;
    public c0 = 0;
    public c1 = 0;
    public c2 = 0;
    public a = 0;
    public matrixIndex = 0;
}

export function getImageFormatString(fmt: ImageFormat, siz: ImageSize): string {
    return `${getImageFormatName(fmt)}${getImageSizeName(siz)}`;
}

export enum LodMode {
    Tile,
    Lod,
    Detail,
}

export class DrawCall {
    public SP_GeometryMode = 0;
    public SP_TextureState = new TextureState();
    public DP_OtherModeL = 0;
    public DP_OtherModeH = 0;
    public DP_Combine: RDP.CombineParams;
    public DP_PrimColor = vec4.fromValues(1, 1, 1, 1);
    public DP_EnvColor = vec4.fromValues(1, 1, 1, 1);
    public lodMode = LodMode.Tile;
    public minLevel = 0;
    public textures: number[][] = [];
    public tiles: RDP.TileState[] = [];
    public firstIndex = 0;
    public indexCount = 0;
}

export class RSPSharedOutput {
    public textureCache = new RDP.TextureCache();
    public vertices: Vertex[] = [];
    public vertexSources: number[] = [];
    public indices: number[] = [];
}

export enum RSP_Geometry {
    G_ZBUFFER = 1 << 0,
    G_SHADE = 1 << 2,
    G_SHADING_SMOOTH = 1 << 9,
    G_CULL_FRONT = 1 << 12,
    G_CULL_BACK = 1 << 13,
    G_FOG = 1 << 16,
    G_LIGHTING = 1 << 17,
    G_TEXTURE_GEN = 1 << 18,
    G_TEXTURE_GEN_LINEAR = 1 << 19,
    G_CLIPPING = 1 << 23,
}

export class RSPState {
    public drawCalls: DrawCall[] = [];

    private currentDrawCall = new DrawCall();
    private stateChanged = false;
    private readonly vertexCache = nArray(64, () => 0);
    private SP_GeometryMode = 0;
    private readonly SP_TextureState = new TextureState();
    private DP_OtherModeL = 0;
    private DP_OtherModeH = 0;
    private DP_CombineL = 0;
    private DP_CombineH = 0;
    private DP_TextureImageAddr = 0;
    private readonly DP_TileState = nArray(8, () => new RDP.TileState());
    private readonly DP_TMemTracker = new Map<number, number>();
    private readonly DP_PrimColor = vec4.fromValues(1, 1, 1, 1);
    private readonly DP_EnvColor = vec4.fromValues(1, 1, 1, 1);
    private DP_PrimLodMin = 0;
    private tilesSet = 0;

    public constructor(
        public segmentBuffers: ArrayBufferSlice[],
        public sharedOutput: RSPSharedOutput,
    ) {}

    public gSPSetGeometryMode(mask: number): void {
        this.setGeometryMode(this.SP_GeometryMode | mask);
    }

    public gSPClearGeometryMode(mask: number): void {
        this.setGeometryMode(this.SP_GeometryMode & ~mask);
    }

    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        this.SP_TextureState.set(on, tile, level, s / 0x10000, t / 0x10000);
        this.stateChanged = true;
    }

    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        const view = this.segmentBuffers[(dramAddr >>> 24) & 0xff].createDataView();
        for (let i = 0; i < n; i++) {
            const offs = (dramAddr & 0x00ffffff) + i * 0x10;
            const vtx = new Vertex();
            loadVertexFromView(vtx, view, offs);
            this.sharedOutput.vertices.push(vtx);
            this.sharedOutput.vertexSources.push(offs);
            this.vertexCache[v0 + i] = this.sharedOutput.vertices.length - 1;
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this.flushDrawCall();
        this.sharedOutput.indices.push(this.vertexCache[i0], this.vertexCache[i1], this.vertexCache[i2]);
        this.currentDrawCall.indexCount += 3;
    }

    public gDPSetTextureImage(addr: number): void {
        this.DP_TextureImageAddr = addr;
    }

    public gDPSetTile(
        fmt: number,
        siz: number,
        line: number,
        tmem: number,
        tile: number,
        palette: number,
        cmt: number,
        maskt: number,
        shiftt: number,
        cms: number,
        masks: number,
        shifts: number,
    ): void {
        this.DP_TileState[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
        this.tilesSet |= 1 << tile;
        this.stateChanged = true;
    }

    public gDPLoadTLUT(tile: number): void {
        this.DP_TMemTracker.set(this.DP_TileState[tile].tmem, this.DP_TextureImageAddr);
        this.stateChanged = true;
    }

    public gDPLoadBlock(tileIndex: number): void {
        this.DP_TMemTracker.set(this.DP_TileState[tileIndex].tmem, this.DP_TextureImageAddr);
        this.stateChanged = true;
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
        this.stateChanged = true;
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = len >= 32 ? 0xffffffff : (((1 << len) - 1) << sft) >>> 0;
        const value = ((this.DP_OtherModeL & ~mask) | (w1 & mask)) >>> 0;
        if (value !== this.DP_OtherModeL) {
            this.DP_OtherModeL = value;
            this.stateChanged = true;
        }
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = len >= 32 ? 0xffffffff : (((1 << len) - 1) << sft) >>> 0;
        const value = ((this.DP_OtherModeH & ~mask) | (w1 & mask)) >>> 0;
        if (value !== this.DP_OtherModeH) {
            this.DP_OtherModeH = value;
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

    public gDPSetPrimColor(lodMin: number, r: number, g: number, b: number, a: number): void {
        this.DP_PrimLodMin = lodMin;
        vec4.set(this.DP_PrimColor, r / 0xff, g / 0xff, b / 0xff, a / 0xff);
        this.stateChanged = true;
    }

    public gDPSetEnvColor(r: number, g: number, b: number, a: number): void {
        vec4.set(this.DP_EnvColor, r / 0xff, g / 0xff, b / 0xff, a / 0xff);
        this.stateChanged = true;
    }

    public markStateChanged(): void {
        this.stateChanged = true;
        this.tilesSet = 0;
    }

    private setGeometryMode(mode: number): void {
        if (this.SP_GeometryMode !== mode) {
            this.stateChanged = true;
            this.SP_GeometryMode = mode;
        }
    }

    private lookupTMEM(tmem: number): number | undefined {
        const exact = this.DP_TMemTracker.get(tmem);
        if (exact !== undefined) {
            return exact;
        }
        let bestTmem = -1;
        let bestAddr = 0;
        for (const [trackedTmem, addr] of this.DP_TMemTracker) {
            if (trackedTmem <= tmem && trackedTmem > bestTmem) {
                bestTmem = trackedTmem;
                bestAddr = addr;
            }
        }
        return bestTmem >= 0 ? bestAddr + (tmem - bestTmem) * 8 : undefined;
    }

    private translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex & 7];
        const dramAddr = this.lookupTMEM(tile.tmem);
        if (dramAddr === undefined) {
            return -1;
        }
        let dramPalAddr = 0;
        if (tile.fmt === (ImageFormat.G_IM_FMT_CI as number)) {
            dramPalAddr = this.lookupTMEM(0x100 + (tile.palette << 4)) ?? 0;
        }
        try {
            return this.sharedOutput.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile, true, true);
        } catch (e) {
            if (e instanceof RangeError) {
                return -1;
            }
            throw e;
        }
    }

    private pushSlot(dc: DrawCall, levels: number[], tile: number): void {
        const state = new RDP.TileState();
        state.copy(this.DP_TileState[tile & 7]);
        dc.textures.push(levels);
        dc.tiles.push(state);
    }

    private translateChain(firstTile: number, levels: number): number[] {
        const chain: number[] = [];
        for (let level = 0; level < levels; level++) {
            if (level > 0 && !(this.tilesSet & (1 << ((firstTile + level) & 7)))) {
                break;
            }
            const index = this.translateTileTexture(firstTile + level);
            if (index < 0) {
                break;
            }
            chain.push(index);
        }
        return chain;
    }

    private flushTextures(dc: DrawCall): void {
        if (!this.SP_TextureState.on) {
            return;
        }
        const { tile, level } = this.SP_TextureState;
        const lodEnabled = ((this.DP_OtherModeH >>> 16) & 0x01) !== 0;
        if (lodEnabled) {
            const detail = ((this.DP_OtherModeH >>> 17) & 0x03) === 0x02;
            dc.lodMode = detail ? LodMode.Detail : LodMode.Lod;
            dc.minLevel = this.DP_PrimLodMin;
            const chain = this.translateChain(detail ? tile + 1 : tile, level + 1);
            if (chain.length === 0) {
                return;
            }
            this.pushSlot(dc, chain, detail ? tile + 1 : tile);
            if (detail) {
                const detailTexture = this.translateTileTexture(tile);
                if (detailTexture >= 0) {
                    this.pushSlot(dc, [detailTexture], tile);
                } else {
                    dc.lodMode = LodMode.Lod;
                }
            }
            return;
        }
        const tex0 = this.translateTileTexture(tile);
        if (tex0 < 0) {
            return;
        }
        this.pushSlot(dc, [tex0], tile);
        const twoCycle = ((this.DP_OtherModeH >>> 20) & 0x03) === 0x01;
        if (RDP.combineParamsUsesT1(dc.DP_Combine) || (twoCycle && RDP.combineParamsUseTexelsInSecondCycle(dc.DP_Combine))) {
            const tex1 = this.translateTileTexture(tile + 1);
            if (tex1 >= 0) {
                this.pushSlot(dc, [tex1], tile + 1);
            }
        }
    }

    private flushDrawCall(): void {
        if (!this.stateChanged) {
            return;
        }
        this.stateChanged = false;
        const dc = new DrawCall();
        dc.firstIndex = this.sharedOutput.indices.length;
        dc.SP_GeometryMode = this.SP_GeometryMode;
        dc.SP_TextureState.copy(this.SP_TextureState);
        dc.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
        dc.DP_OtherModeH = this.DP_OtherModeH;
        dc.DP_OtherModeL = this.DP_OtherModeL;
        vec4.copy(dc.DP_PrimColor, this.DP_PrimColor);
        vec4.copy(dc.DP_EnvColor, this.DP_EnvColor);
        this.flushTextures(dc);
        this.currentDrawCall = dc;
        this.drawCalls.push(dc);
    }
}

enum F3DEX_GBI {
    G_VTX = 0x04,
    G_DL = 0x06,
    G_TRI1 = 0xbf,
    G_TEXTURE = 0xbb,
    G_SETOTHERMODE_H = 0xba,
    G_SETOTHERMODE_L = 0xb9,
    G_ENDDL = 0xb8,
    G_SETGEOMETRYMODE = 0xb7,
    G_CLEARGEOMETRYMODE = 0xb6,
    G_TRI2 = 0xb1,
    G_SETTIMG = 0xfd,
    G_SETCOMBINE = 0xfc,
    G_SETENVCOLOR = 0xfb,
    G_SETPRIMCOLOR = 0xfa,
    G_SETTILE = 0xf5,
    G_LOADBLOCK = 0xf3,
    G_SETTILESIZE = 0xf2,
    G_LOADTLUT = 0xf0,
}

export function runDL_F3DEX(state: RSPState, addr: number): void {
    const segmentBuffer = state.segmentBuffers[(addr >>> 24) & 0xff];
    const view = segmentBuffer.createDataView();

    for (let i = addr & 0x00ffffff; i < segmentBuffer.byteLength; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        switch ((w0 >>> 24) as F3DEX_GBI) {
            case F3DEX_GBI.G_ENDDL:
                return;
            case F3DEX_GBI.G_CLEARGEOMETRYMODE:
                state.gSPClearGeometryMode(w1);
                break;
            case F3DEX_GBI.G_SETGEOMETRYMODE:
                state.gSPSetGeometryMode(w1);
                break;
            case F3DEX_GBI.G_TEXTURE:
                state.gSPTexture(
                    (w0 & 0x7f) !== 0,
                    (w0 >>> 8) & 0x07,
                    (w0 >>> 11) & 0x07,
                    (w1 >>> 16) & 0xffff,
                    w1 & 0xffff,
                );
                break;
            case F3DEX_GBI.G_SETTIMG:
                state.gDPSetTextureImage(w1);
                break;
            case F3DEX_GBI.G_SETTILE:
                state.gDPSetTile(
                    (w0 >>> 21) & 0x07,
                    (w0 >>> 19) & 0x03,
                    (w0 >>> 9) & 0x1ff,
                    w0 & 0x1ff,
                    (w1 >>> 24) & 0x07,
                    (w1 >>> 20) & 0x0f,
                    (w1 >>> 18) & 0x03,
                    (w1 >>> 14) & 0x0f,
                    (w1 >>> 10) & 0x0f,
                    (w1 >>> 8) & 0x03,
                    (w1 >>> 4) & 0x0f,
                    w1 & 0x0f,
                );
                break;
            case F3DEX_GBI.G_LOADTLUT:
                state.gDPLoadTLUT((w1 >>> 24) & 0x07);
                break;
            case F3DEX_GBI.G_LOADBLOCK:
                state.gDPLoadBlock((w1 >>> 24) & 0x07);
                break;
            case F3DEX_GBI.G_VTX:
                state.gSPVertex(w1, (w0 >>> 10) & 0x3f, ((w0 >>> 16) & 0xff) / 2);
                break;
            case F3DEX_GBI.G_TRI1:
                state.gSPTri(((w1 >>> 16) & 0xff) / 2, ((w1 >>> 8) & 0xff) / 2, (w1 & 0xff) / 2);
                break;
            case F3DEX_GBI.G_TRI2:
                state.gSPTri(((w0 >>> 16) & 0xff) / 2, ((w0 >>> 8) & 0xff) / 2, (w0 & 0xff) / 2);
                state.gSPTri(((w1 >>> 16) & 0xff) / 2, ((w1 >>> 8) & 0xff) / 2, (w1 & 0xff) / 2);
                break;
            case F3DEX_GBI.G_DL:
                runDL_F3DEX(state, w1);
                if (((w0 >>> 16) & 0xff) !== 0) {
                    return;
                }
                break;
            case F3DEX_GBI.G_SETOTHERMODE_H:
                state.gDPSetOtherModeH((w0 >>> 8) & 0xff, w0 & 0xff, w1);
                break;
            case F3DEX_GBI.G_SETOTHERMODE_L:
                state.gDPSetOtherModeL((w0 >>> 8) & 0xff, w0 & 0xff, w1);
                break;
            case F3DEX_GBI.G_SETCOMBINE:
                state.gDPSetCombine(w0 & 0x00ffffff, w1);
                break;
            case F3DEX_GBI.G_SETTILESIZE:
                state.gDPSetTileSize(
                    (w1 >>> 24) & 0x07,
                    (w0 >>> 12) & 0x0fff,
                    w0 & 0x0fff,
                    (w1 >>> 12) & 0x0fff,
                    w1 & 0x0fff,
                );
                break;
            case F3DEX_GBI.G_SETPRIMCOLOR:
                state.gDPSetPrimColor((w0 >>> 8) & 0xff, (w1 >>> 24) & 0xff, (w1 >>> 16) & 0xff, (w1 >>> 8) & 0xff, w1 & 0xff);
                break;
            case F3DEX_GBI.G_SETENVCOLOR:
                state.gDPSetEnvColor((w1 >>> 24) & 0xff, (w1 >>> 16) & 0xff, (w1 >>> 8) & 0xff, w1 & 0xff);
                break;
            default:
                break;
        }
    }
}
