
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray, assert, assertExists, hexzero } from "../util";
import { parseTLUT, ImageFormat, getImageFormatName, ImageSize, getImageSizeName, TextureLUT, decodeTex_RGBA16, decodeTex_IA8, decodeTex_RGBA32, decodeTex_CI4, decodeTex_CI8, TextFilt } from "../Common/N64/Image";

// Interpreter for N64 F3DEX microcode.

export const enum GeometryMode {
    G_SHADE = 0x04,
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

export class TextureImageState {
    public fmt: number = 0;
    public siz: number = 0;
    public w: number = 0;
    public addr: number = 0;

    public set(fmt: number, siz: number, w: number, addr: number) {
        this.fmt = fmt; this.siz = siz; this.w = w; this.addr = addr;
    }
}

export class TileState {
    public fmt: number = 0;
    public siz: number = 0;
    public line: number = 0;
    public tmem: number = 0;
    public palette: number = 0;
    public cmt: number = 0;
    public maskt: number = 0;
    public shiftt: number = 0;
    public cms: number = 0;
    public masks: number = 0;
    public shifts: number = 0;
    public uls: number = 0;
    public ult: number = 0;
    public lrs: number = 0;
    public lrt: number = 0;

    public set(fmt: number, siz: number, line: number, tmem: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.fmt = fmt; this.siz = siz; this.line = line; this.tmem = tmem; this.palette = palette; this.cmt = cmt; this.maskt = maskt; this.shiftt = shiftt; this.cms = cms; this.masks = masks; this.shifts = shifts;
    }

    public setSize(uls: number, ult: number, lrs: number, lrt: number): void {
        this.uls = uls; this.ult = ult; this.lrs = lrs; this.lrt = lrt;
    }

    public copy(o: TileState): void {
        this.set(o.fmt, o.siz, o.line, o.tmem, o.palette, o.cmt, o.maskt, o.shiftt, o.cms, o.masks, o.shifts);
        this.setSize(o.uls, o.ult, o.lrs, o.lrt);
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

    public copy(v: Vertex): void {
        this.x = v.x; this.y = v.y; this.z = v.z; this.tx = v.tx; this.ty = v.ty;
        this.c0 = v.c0; this.c1 = v.c1; this.c2 = v.c2; this.a = v.a;
    }
}

class StagingVertex extends Vertex {
    public outputIndex: number = -1;

    public setFromView(view: DataView, offs: number): void {
        this.outputIndex = -1;

        this.x = view.getInt16(offs + 0x00);
        this.y = view.getInt16(offs + 0x02);
        this.z = view.getInt16(offs + 0x04);
        // flag (unused)
        this.tx = (view.getInt16(offs + 0x08) / 0x40) + 0.5;
        this.ty = (view.getInt16(offs + 0x0A) / 0x40) + 0.5;
        this.c0 = view.getUint8(offs + 0x0C) / 0xFF;
        this.c1 = view.getUint8(offs + 0x0D) / 0xFF;
        this.c2 = view.getUint8(offs + 0x0E) / 0xFF;
        this.a = view.getUint8(offs + 0x0F) / 0xFF;
    }
}

export class Texture {
    public name: string;
    public format = 'rgba8';
    public tile = new TileState();

    constructor(tile: TileState, public dramAddr: number, public dramPalAddr: number, public width: number, public height: number, public pixels: Uint8Array) {
        this.tile.copy(tile);
        this.name = hexzero(this.dramAddr, 8);
    }
}

export function getImageFormatString(fmt: ImageFormat, siz: ImageSize): string {
    return `${getImageFormatName(fmt)}${getImageSizeName(siz)}`;
}

export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public SP_TextureState = new TextureState();
    public DP_OtherModeL: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_CombineL: number = 0;
    public DP_CombineH: number = 0;

    public textureIndices: number[] = [];

    public firstIndex: number = 0;
    public indexCount: number = 0;
}

export class RSPOutput {
    public vertices: Vertex[] = [];
    public indices: number[] = [];
    public drawCalls: DrawCall[] = [];
    public textures: Texture[] = [];

    public currentDrawCall = new DrawCall();

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

const enum OtherModeH_Layout {
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

function translateTLUT(dst: Uint8Array, segmentBuffers: ArrayBufferSlice[], dramAddr: number, siz: ImageSize): void {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    const srcIdx = dramAddr & 0x00FFFFFF;
    parseTLUT(dst, view, srcIdx, siz, TextureLUT.G_TT_RGBA16);
}

const tlutColorTable = new Uint8Array(256 * 4);

function getTileWidth(tile: TileState): number {
    if (tile.masks !== 0)
        return 1 << tile.masks;
    else
        return ((tile.lrs - tile.uls) >>> 2) + 1;
}

function getTileHeight(tile: TileState): number {
    if (tile.maskt !== 0)
        return 1 << tile.maskt;
    else
        return ((tile.lrt - tile.ult) >>> 2) + 1;
}

function translateTile_CI4(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    translateTLUT(tlutColorTable, segmentBuffers, dramPalAddr, ImageSize.G_IM_SIZ_4b);

    const tileW = getTileWidth(tile);
    const tileH = getTileHeight(tile);

    // TODO(jstpierre): Support more tile parameters
    assert(tile.shifts === 0); // G_TX_NOLOD
    assert(tile.shiftt === 0); // G_TX_NOLOD

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    decodeTex_CI4(dst, view, srcIdx, tileW, tileH, tlutColorTable);
    return new Texture(tile, dramAddr, dramPalAddr, tileW, tileH, dst);
}

function translateTile_CI8(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    translateTLUT(tlutColorTable, segmentBuffers, dramPalAddr, ImageSize.G_IM_SIZ_8b);

    const tileW = getTileWidth(tile);
    const tileH = getTileHeight(tile);

    // TODO(jstpierre): Support more tile parameters
    assert(tile.shifts === 0); // G_TX_NOLOD
    assert(tile.shiftt === 0); // G_TX_NOLOD

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    decodeTex_CI8(dst, view, srcIdx, tileW, tileH, tlutColorTable);
    return new Texture(tile, dramAddr, dramPalAddr, tileW, tileH, dst);
}

function translateTile_RGBA16(segmentBuffers: ArrayBufferSlice[], dramAddr: number, tile: TileState): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();

    const tileW = ((tile.lrs - tile.uls) >>> 2) + 1;
    const tileH = ((tile.lrt - tile.ult) >>> 2) + 1;

    // TODO(jstpierre): Support more tile parameters
    assert(tile.shifts === 0); // G_TX_NOLOD
    assert(tile.shiftt === 0); // G_TX_NOLOD
    assert(tile.masks === 0 || (1 << tile.masks) === tileW);
    assert(tile.maskt === 0 || (1 << tile.maskt) === tileH);

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    decodeTex_RGBA16(dst, view, srcIdx, tileW, tileH);
    return new Texture(tile, dramAddr, 0, tileW, tileH, dst);
}

function translateTile_IA8(segmentBuffers: ArrayBufferSlice[], dramAddr: number, tile: TileState): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();

    const tileW = ((tile.lrs - tile.uls) >>> 2) + 1;
    const tileH = ((tile.lrt - tile.ult) >>> 2) + 1;

    // TODO(jstpierre): Support more tile parameters
    assert(tile.shifts === 0); // G_TX_NOLOD
    assert(tile.shiftt === 0); // G_TX_NOLOD
    assert(tile.masks === 0 || (1 << tile.masks) === tileW);
    assert(tile.maskt === 0 || (1 << tile.maskt) === tileH);

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    decodeTex_IA8(dst, view, srcIdx, tileW, tileH);
    return new Texture(tile, dramAddr, 0, tileW, tileH, dst);
}

function translateTile_RGBA32(segmentBuffers: ArrayBufferSlice[], dramAddr: number, tile: TileState): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();

    const tileW = ((tile.lrs - tile.uls) >>> 2) + 1;
    const tileH = ((tile.lrt - tile.ult) >>> 2) + 1;

    // TODO(jstpierre): Support more tile parameters
    assert(tile.shifts === 0); // G_TX_NOLOD
    assert(tile.shiftt === 0); // G_TX_NOLOD
    assert(tile.masks === 0 || (1 << tile.masks) === tileW);
    assert(tile.maskt === 0 || (1 << tile.maskt) === tileH);

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    decodeTex_RGBA32(dst, view, srcIdx, tileW, tileH);
    return new Texture(tile, dramAddr, 0, tileW, tileH, dst);
}

function translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState): Texture {
    switch ((tile.fmt << 4) | tile.siz) {
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_4b):  return translateTile_CI4(segmentBuffers, dramAddr, dramPalAddr, tile);
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_8b):  return translateTile_CI8(segmentBuffers, dramAddr, dramPalAddr, tile);
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_8b):  return translateTile_IA8(segmentBuffers, dramAddr, tile);
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_16b): return translateTile_RGBA16(segmentBuffers, dramAddr, tile);
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_32b): return translateTile_RGBA32(segmentBuffers, dramAddr, tile);
    default:
        throw new Error(`Unknown image format ${tile.fmt} / ${tile.siz}`);
    }
}

export class TextureCache {
    public textures: Texture[] = [];

    public translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState): number {
        const existingIndex = this.textures.findIndex((t) => t.dramAddr === dramAddr);
        if (existingIndex >= 0) {
            const texture = this.textures[existingIndex];
            assert(texture.dramAddr === dramAddr);
            assert(texture.dramPalAddr === dramPalAddr);
            return existingIndex;
        } else {
            const texture = translateTileTexture(segmentBuffers, dramAddr, dramPalAddr, tile);
            const index = this.textures.length;
            this.textures.push(texture);
            return index;
        }
    }
}

function getSizBitsPerPixel(siz: ImageSize): number {
    switch (siz) {
    case ImageSize.G_IM_SIZ_4b:  return 4;
    case ImageSize.G_IM_SIZ_8b:  return 8;
    case ImageSize.G_IM_SIZ_16b: return 16;
    case ImageSize.G_IM_SIZ_32b: return 32;
    }
}

export class RSPState {
    private output = new RSPOutput();

    private stateChanged: boolean = false;
    private vertexCache = nArray(64, () => new StagingVertex());
    private textureCache = new TextureCache();

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new TextureState();

    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TextureImageState = new TextureImageState();
    private DP_TileState = nArray(8, () => new TileState());
    private DP_TMemTracker = new Map<number, number>();

    constructor(public segmentBuffers: ArrayBufferSlice[]) {
    }

    public finish(): RSPOutput {
        this.output.textures = this.textureCache.textures;
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
        this.SP_TextureState.set(on, tile, level, s, t);
        this.stateChanged = true;
    }

    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        const view = this.segmentBuffers[(dramAddr >>> 24)].createDataView();
        let addrIdx = dramAddr & 0x00FFFFFF;
        for (let i = 0; i < n; i++) {
            this.vertexCache[v0 + i].setFromView(view, addrIdx);
            addrIdx += 0x10;
        }
    }

    private _translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex];

        const dramAddr = assertExists(this.DP_TMemTracker.get(tile.tmem));

        let dramPalAddr: number;
        if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
            const textlut = (this.DP_OtherModeH >>> 14) & 0x03;
            // assert(textlut === TextureLUT.G_TT_RGBA16);

            const palTmem = 0x100 + (tile.palette << 4);
            dramPalAddr = assertExists(this.DP_TMemTracker.get(palTmem));
        } else {
            dramPalAddr = 0;
        }

        return this.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile);
    }

    private _flushTextures(dc: DrawCall): void {
        // If textures are not on, then we have no textures.
        if (!this.SP_TextureState.on)
            return;

        const lod_en = !!((this.DP_OtherModeH >>> 16) & 0x01);
        if (lod_en) {
            // TODO(jstpierre): Support mip-mapping
            assert(false);
        } else {
            // We're in TILE mode. Now check if we're in two-cycle mode.
            const cycletype = getCycleTypeFromOtherModeH(this.DP_OtherModeH);
            assert(cycletype === OtherModeH_CycleType.G_CYC_1CYCLE || cycletype === OtherModeH_CycleType.G_CYC_2CYCLE);

            // XXX(jstpierre): Hack for Banjo-Kazooie mipmaps. If we want to use mipmaps,
            // use G_TX_LOADTILE, which we just loaded into TMEM from. I assume the game
            // uses the G_DL call to 0x30000000 with DL generated by e.g. guLoadTextureBlockMipMap
            // to set up the mipmap tiles in practice. Will have to figure out how to emulate that...
            if (this.SP_TextureState.level === 2) {
                assert(this.SP_TextureState.tile === 2);
                this.DP_TileState[2].copy(this.DP_TileState[7]);
                assert(this.DP_TileState[2].lrs === (31 << 2));
                assert(this.DP_TileState[2].lrt === (47 << 2));
                this.DP_TileState[2].lrt = this.DP_TileState[2].lrs;
                this.DP_TileState[0].copy(this.DP_TileState[2]);
            }

            dc.textureIndices.push(this._translateTileTexture(this.SP_TextureState.tile));

            if (cycletype === OtherModeH_CycleType.G_CYC_2CYCLE) {
                // In 2CYCLE mode, it uses tile and tile + 1.
                dc.textureIndices.push(this._translateTileTexture(this.SP_TextureState.tile + 1));
            }
        }
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this.output.newDrawCall();
            this._flushTextures(dc);
            dc.SP_GeometryMode = this.SP_GeometryMode;
            dc.SP_TextureState.copy(this.SP_TextureState);
            dc.DP_CombineL = this.DP_CombineL;
            dc.DP_CombineH = this.DP_CombineH;
            dc.DP_OtherModeH = this.DP_OtherModeH;
            dc.DP_OtherModeL = this.DP_OtherModeL;
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();

        this.output.pushVertex(this.vertexCache[i0]);
        this.output.pushVertex(this.vertexCache[i1]);
        this.output.pushVertex(this.vertexCache[i2]);
    }

    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    public gDPSetTile(fmt: number, siz: number, line: number, tmem: number, tile: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.DP_TileState[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
    }

    public gDPLoadTLUT(tile: number, count: number): void {
        // Track the TMEM destination back to the originating DRAM address.
        const tmemDst = this.DP_TileState[tile].tmem;
        this.DP_TMemTracker.set(tmemDst, this.DP_TextureImageState.addr);
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, lrs: number, dxt: number): void {
        // First, verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);
        // Verify that we're loading into LOADTILE.
        assert(tileIndex === 7);

        const tile = this.DP_TileState[tileIndex];
        // Compute the texture size from lrs/dxt. This is required for mipmapping to work correctly
        // in B-K due to hackery.
        const numWordsTotal = lrs + 1;
        const numWordsInLine = (1 << 11) / dxt;
        const numPixelsInLine = (numWordsInLine * 8 * 8) / getSizBitsPerPixel(tile.siz);
        tile.lrs = (numPixelsInLine - 1) << 2;
        tile.lrt = (((numWordsTotal / numWordsInLine) / 4) - 1) << 2;

        // Track the TMEM destination back to the originating DRAM address.
        this.DP_TMemTracker.set(tile.tmem, this.DP_TextureImageState.addr);
        this.stateChanged = true;
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
        this.stateChanged = true;
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
        this.stateChanged = true;
    }

    public gDPSetCombine(w0: number, w1: number): void {
        this.DP_CombineH = w0;
        this.DP_CombineL = w1;
        this.stateChanged = true;
    }
}

enum F3DEX_GBI {
    // DMA
    G_MTX               = 0x01,
    G_MOVEMEM           = 0x03,
    G_VTX               = 0x04,
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
    G_TRI2              = 0xB1,
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
}

export function runDL_F3DEX(state: RSPState, addr: number): void {
    const segmentBuffer = state.segmentBuffers[(addr >>> 24) & 0xFF];
    const view = segmentBuffer.createDataView();

    for (let i = (addr & 0x00FFFFFF); i < segmentBuffer.byteLength; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3DEX_GBI = w0 >>> 24;
        // console.log(hexzero(i, 8), F3DEX_GBI[cmd], hexzero(w0, 8), hexzero(w1, 8));

        switch (cmd) {
        case F3DEX_GBI.G_ENDDL:
            return;

        case F3DEX_GBI.G_CLEARGEOMETRYMODE:
            state.gSPClearGeometryMode(w1);
            break;

        case F3DEX_GBI.G_SETGEOMETRYMODE:
            state.gSPSetGeometryMode(w1);
            break;

        case F3DEX_GBI.G_TEXTURE: {
            const level = (w0 >>> 11) & 0x07;
            let   tile  = (w0 >>> 8) & 0x07;
            const on    = !!((w0 >>> 0) & 0x7F);
            const s     = (w1 >>> 16) & 0xFFFF;
            const t     = (w1 >>> 0)  & 0xFFFF;
            state.gSPTexture(on, tile, level, s, t);
        } break;

        case F3DEX_GBI.G_SETTIMG: {
            const fmt = (w0 >>> 21) & 0x07;
            const siz = (w0 >>> 19) & 0x03;
            const w   = (w0 & 0x0FFF) + 1;
            state.gDPSetTextureImage(fmt, siz, w, w1);
        } break;

        case F3DEX_GBI.G_SETTILE: {
            const fmt =     (w0 >>> 21) & 0x07;
            const siz =     (w0 >>> 19) & 0x03;
            const line =    (w0 >>>  9) & 0x1FF;
            const tmem =    (w0 >>>  0) & 0x1FF;
            const tile    = (w1 >>> 24) & 0x07;
            const palette = (w1 >>> 20) & 0x0F;
            const cmt =     (w1 >>> 18) & 0x03;
            const maskt =   (w1 >>> 14) & 0x0F;
            const shiftt =  (w1 >>> 10) & 0x0F;
            const cms =     (w1 >>>  8) & 0x03;
            const masks =   (w1 >>>  4) & 0x0F;
            const shifts =  (w1 >>>  0) & 0x0F;
            state.gDPSetTile(fmt, siz, line, tmem, tile, palette, cmt, maskt, shiftt, cms, masks, shifts);
        } break;

        case F3DEX_GBI.G_LOADTLUT: {
            const tile = (w1 >>> 24) & 0x07;
            const count = (w1 >>> 14) & 0x3FF;
            state.gDPLoadTLUT(tile, count);
        } break;

        case F3DEX_GBI.G_LOADBLOCK: {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const dxt =  (w1 >>>  0) & 0x0FFF;
            state.gDPLoadBlock(tile, uls, ult, lrs, dxt);
        } break;

        case F3DEX_GBI.G_VTX: {
            const v0 = (w0 >>> 16) & 0xFF;
            const n = (w0 >>> 10) & 0x3F;
            state.gSPVertex(w1, n, v0);
        } break;

        case F3DEX_GBI.G_TRI1: {
            const i0 = ((w1 >>> 16) & 0xFF) / 2;
            const i1 = ((w1 >>>  8) & 0xFF) / 2;
            const i2 = ((w1 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        } break;

        case F3DEX_GBI.G_TRI2: {
        {
            const i0 = ((w0 >>> 16) & 0xFF) / 2;
            const i1 = ((w0 >>>  8) & 0xFF) / 2;
            const i2 = ((w0 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>> 16) & 0xFF) / 2;
            const i1 = ((w1 >>>  8) & 0xFF) / 2;
            const i2 = ((w1 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        } break;

        case F3DEX_GBI.G_DL: {
            // TODO(jstpierre): Figure out the right segment address that this wants.
        } break;

        case F3DEX_GBI.G_SETOTHERMODE_H: {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            state.gDPSetOtherModeH(sft, len, w1);
        } break;

        case F3DEX_GBI.G_SETOTHERMODE_L: {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            state.gDPSetOtherModeL(sft, len, w1);
        } break;

        case F3DEX_GBI.G_SETCOMBINE: {
            state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
        } break;

        case F3DEX_GBI.G_SETTILESIZE: {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const lrt =  (w1 >>>  0) & 0x0FFF;
            state.gDPSetTileSize(tile, uls, ult, lrs, lrt);
        } break;

        case F3DEX_GBI.G_RDPFULLSYNC:
        case F3DEX_GBI.G_RDPTILESYNC:
        case F3DEX_GBI.G_RDPPIPESYNC:
        case F3DEX_GBI.G_RDPLOADSYNC:
            // Implementation not necessary.
            break;

        default:
            console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
        }
    }
}
