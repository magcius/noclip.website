import * as RDP from '../Common/N64/RDP.js';
import * as F3DEX from '../BanjoKazooie/f3dex.js';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { RSP_Geometry, TextureImageState, TextureState } from "../BanjoKazooie/f3dex.js";
import { getSizBitsPerPixel, ImageFormat, ImageSize, TextFilt } from "../Common/N64/Image.js";
import { assert, assertExists, nArray } from "../gfx/platform/GfxPlatformUtil.js";
import { Color, colorFromRGBA8, colorNewCopy, White } from '../Color.js';
import { G_TX_CLAMP, G_TX_LOADTILE, G_TX_MIRROR, G_TX_NOLOD, G_TX_NOMASK, G_TX_NOMIRROR, G_TX_RENDERTILE, G_TX_WRAP } from '../Glover/render.js';
import { RENDER_MODES } from '../Common/N64/RDP.js';
import { vec3 } from 'gl-matrix';
import { BinAngleToRad } from './utils.js';

const G_TX_DXT_FRAC = 11;
const G_TEXTURE_IMAGE_FRAC = 2;

export class Light1 {
    public diffuseColor: vec3 = vec3.create();
    public ambientColor: vec3 = vec3.create();
    public direction: vec3 = vec3.create();

    public static InitLight(r: number, g: number, b: number, aR: number, aG: number, aB: number, x: number, y: number, z: number): Light1 {
        const light = new Light1();

        light.setDiffuseDirection(r, g, b, x, y, z);
        light.setAmbient(aR, aG, aB);

        return light;
    }

    public setDiffuseDirection(r: number, g: number, b: number, x: number, y: number, z: number) {
        vec3.set(this.diffuseColor, r / 0xFF, g / 0xFF, b / 0xFF);
        vec3.set(this.direction, x / 0x7F, y / 0x7F, z / 0x7F);
        vec3.normalize(this.direction, this.direction);
    }

    public setAmbient(r: number, g: number, b: number) {
        vec3.set(this.ambientColor, r / 0xFF, g / 0xFF, b / 0xFF);
    }

    public setLightDirectionFromAngles(yaw: number, pitch: number): void {
        const p = pitch * BinAngleToRad;
        const y = yaw * BinAngleToRad;

        const sinP = Math.sin(p), cosP = Math.cos(p);
        const sinY = Math.sin(y), cosY = Math.cos(y);

        this.direction[0] = (cosP * sinY);
        this.direction[1] = (sinP);
        this.direction[2] = -(cosP * cosY);
    }

    public copy(o: Light1): void {
        vec3.copy(this.diffuseColor, o.diffuseColor);
        vec3.copy(this.ambientColor, o.ambientColor);
        vec3.copy(this.direction, o.direction);
    }

    public equals(o: Light1): void {
        vec3.equals(this.diffuseColor, o.diffuseColor);
        vec3.equals(this.ambientColor, o.ambientColor);
        vec3.equals(this.direction, o.direction);
    }
}

export class MkDrawCall extends F3DEX.DrawCall {
    public vertices: F3DEX.Vertex[] = [];
    public vertexCount: number = 0;

    public fogNear: number = 0;
    public fogFar: number = 0;
    public fogColor: Color = colorNewCopy(White);

    public light: Light1 = new Light1();
}

export class MkRSPOutput {
    constructor(public drawCalls: MkDrawCall[], public textureCache: RDP.TextureCache) {
    }
}

export class MkRSPState implements F3DEX.RSPStateInterface {
    private stateChanged: boolean = false;
    private outputDrawCalls: MkDrawCall[] = [];
    private currentDrawCall = new MkDrawCall();

    private vertexCache: F3DEX.Vertex[] = [];
    public textureCache: RDP.TextureCache = new RDP.TextureCache();

    private SP_Light: Light1 = new Light1();
    private SP_GeometryMode: number = 0;
    private SP_TextureState = new TextureState();
    protected SP_MatrixStackDepth = 0;

    //private DP_PrimColor: Color = colorNewCopy(White);
    //private DP_EnvColor: Color = colorNewCopy(White);
    private DP_FogColor: Color = colorNewCopy(White);
    private fogNear: number = 0;
    private fogFar: number = 0;
    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;

    private DP_TextureImageState = new TextureImageState();
    public DP_TileState = nArray(8, () => new RDP.TileState());
    private DP_TMemTracker = new Map<number, number>();

    constructor(public segmentBuffers: ArrayBufferSlice[]) {
        for (let i = 0; i < 64; i++) {
            this.vertexCache.push(new F3DEX.Vertex());
        }
    }

    public initStateMk64(): void {
        this.gDPSetCombine(0xFCFFFFFF, 0xFFFE793C);//G_CC_SHADE
        this.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_CULL_BACK | RSP_Geometry.G_SHADING_SMOOTH);
        this.gDPSetRenderMode(RENDER_MODES.G_RM_AA_ZB_OPA_SURF, RENDER_MODES.G_RM_AA_ZB_OPA_SURF2);
        this.gsDPSetTextureFilter(TextFilt.G_TF_BILERP);
    }

    private clear(): void {
        this.stateChanged = true;
        this.outputDrawCalls = [];
        this.currentDrawCall = new MkDrawCall();
    }

    public finish(): MkRSPOutput | null {
        if (this.outputDrawCalls.length === 0)
            return null;

        const output = new MkRSPOutput(
            this.outputDrawCalls,
            this.textureCache
        );

        this.clear();
        return output;
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

    public gSPResetMatrixStackDepth(value: number): void {
        this.SP_MatrixStackDepth = value;
    }

    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        this.SP_TextureState.set(on, tile, level, s / 0x10000, t / 0x10000);
        this.stateChanged = true;
    }

    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        assert(v0 + n < this.vertexCache.length);
        const segment = this.segmentBuffers[(dramAddr >>> 24)];
        const addrIdx = dramAddr & 0x00FFFFFF;
        const view = segment.createDataView(addrIdx, n * 0x10);
        const scratchVertex = new F3DEX.StagingVertex();

        let writeIdx = v0;
        for (let offs = 0; offs < view.byteLength; offs += 0x10) {
            const writeVtx = this.vertexCache[writeIdx];
            scratchVertex.setFromView(view, offs);
            writeVtx.copy(scratchVertex);
            writeVtx.matrixIndex = 0;
            writeIdx += 1;
        }
    }

    public gSPModifyVertex(vtx: number, where: number, val: number): void {
        console.error("gSPModifyVertex() is not supported by this RSPStateInteface implementation");
    }

    private _translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex];

        const dramAddr = assertExists(this.DP_TMemTracker.get(tile.tmem));

        let dramPalAddr: number;
        if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
            const palTmem = 0x100 + (tile.palette << 4);
            dramPalAddr = assertExists(this.DP_TMemTracker.get(palTmem));
        } else {
            dramPalAddr = 0;
        }

        return this.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile);
    }

    private _flushTextures(dc: MkDrawCall): void {
        // If textures are not on, then we have no textures.
        if (!this.SP_TextureState.on)
            return;

        const lod_en = !!((this.DP_OtherModeH >>> 16) & 0x01);
        if (lod_en) {
            assert(false);
        } else {
            // We're in TILE mode. Now check if we're in two-cycle mode.
            const cycletype = RDP.getCycleTypeFromOtherModeH(this.DP_OtherModeH);
            assert(cycletype === RDP.OtherModeH_CycleType.G_CYC_1CYCLE || cycletype === RDP.OtherModeH_CycleType.G_CYC_2CYCLE);

            dc.textureIndices.push(this._translateTileTexture(this.SP_TextureState.tile));

            if (this.SP_TextureState.level == 0 && RDP.combineParamsUsesT1(dc.DP_Combine)) {
                // if tex1 is used, and it isn't a mipmap, load it
                // In 2CYCLE mode, it uses tile and tile + 1.
                dc.textureIndices.push(this._translateTileTexture(this.SP_TextureState.tile + 1));
            }
        }
    }

    public _newDrawCall(): MkDrawCall {
        const dc = new MkDrawCall();
        dc.SP_GeometryMode = this.SP_GeometryMode;
        dc.SP_TextureState.copy(this.SP_TextureState);
        dc.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
        dc.DP_OtherModeH = this.DP_OtherModeH;
        dc.DP_OtherModeL = this.DP_OtherModeL;
        dc.fogNear = this.fogNear;
        dc.fogFar = this.fogFar;
        dc.fogColor = colorNewCopy(this.DP_FogColor);
        dc.light.copy(this.SP_Light);
        return dc;
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this._newDrawCall();
            this.currentDrawCall = dc
            this.outputDrawCalls.push(dc);
            this._flushTextures(dc);
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();

        let v = new F3DEX.Vertex();
        v.copy(this.vertexCache[i0]);
        this.currentDrawCall.vertices.push(v);
        v = new F3DEX.Vertex();
        v.copy(this.vertexCache[i1]);
        this.currentDrawCall.vertices.push(v);
        v = new F3DEX.Vertex();
        v.copy(this.vertexCache[i2]);
        this.currentDrawCall.vertices.push(v);

        this.currentDrawCall.vertexCount += 3;
    }

    public gDPSetFogColor(rgba8: number): void {
        colorFromRGBA8(this.DP_FogColor, rgba8)
        this.stateChanged = true;
    }

    public gSPFogPosition(near: number, far: number): void {
        this.fogNear = near;
        this.fogFar = far;
    }

    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    public gDPSetTile(fmt: number, siz: number, line: number, tmem: number, tile: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.DP_TileState[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
        this.stateChanged = true;
    }

    public gDPLoadTLUT(tile: number, count: number): void {
        // Track the TMEM destination back to the originating DRAM address.
        const tmemDst = this.DP_TileState[tile].tmem;
        this.DP_TMemTracker.set(tmemDst, this.DP_TextureImageState.addr);
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, lrs: number, dxt: number): void {
        assert(uls === 0 && ult === 0);

        const tile = this.DP_TileState[tileIndex];
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


    public gMoveMem(w0: number, w1: number): void {
        const segment = this.segmentBuffers[(w1 >>> 24)];
        const addr = w1 & 0x00FFFFFF;
        const view = segment.createDataView(addr, 12);

        switch ((w0 >>> 16) & 0xFF) {
            case 0x86: {
                const diffuseColor: vec3 = [
                    view.getUint8(0x00) / 0xFF,
                    view.getUint8(0x01) / 0xFF,
                    view.getUint8(0x02) / 0xFF,
                ];

                const direction: vec3 = [
                    view.getInt8(0x08) / 0x7F,
                    view.getInt8(0x09) / 0x7F,
                    view.getInt8(0x0A) / 0x7F,
                ];

                vec3.normalize(direction, direction);

                if (!vec3.equals(this.SP_Light.diffuseColor, diffuseColor) || !vec3.equals(this.SP_Light.direction, direction)) {
                    this.stateChanged = true;
                }

                this.SP_Light.diffuseColor = diffuseColor;
                this.SP_Light.direction = direction;
            } break;

            // HACK! (M-1): We know mk64 only uses one light. The last light is the ambient light
            case 0x88: {
                const ambientColor: vec3 = [
                    view.getUint8(0x00) / 0xFF,
                    view.getUint8(0x01) / 0xFF,
                    view.getUint8(0x02) / 0xFF,
                ];

                if (!vec3.equals(this.SP_Light.ambientColor, ambientColor)) {
                    this.stateChanged = true;
                }

                this.SP_Light.ambientColor = ambientColor;
            } break;
        }
    }

    public gDPLoadTLUT_pal256(dram: number): void {
        this.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, dram);
        this.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_4b, 0, 0x100, G_TX_LOADTILE, 0, 0, 0, 0, 0, 0, 0);
        this.gDPLoadTLUT(G_TX_LOADTILE, 255);
    }

    public rsp_load_texture(texture: number, width: number, height: number): void {
        this.gDPLoadTextureBlock(texture, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_8b, width, height, 0, G_TX_NOMIRROR | G_TX_CLAMP, G_TX_NOMIRROR | G_TX_CLAMP, G_TX_NOMASK, G_TX_NOMASK, G_TX_NOLOD, G_TX_NOLOD);
    }

    public rsp_load_texture_mask(texture: number, width: number, height: number, maskS: number): void {
        this.gDPLoadTextureBlock(texture, ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_8b, width, height, 0, G_TX_MIRROR | G_TX_WRAP, G_TX_NOMIRROR | G_TX_CLAMP, maskS, G_TX_NOMASK, G_TX_NOLOD, G_TX_NOLOD);
    }

    public setLight1(light: Light1): void {
        this.SP_Light = light;
        this.stateChanged = true;
    }

    public gDPLoadTextureBlock(timg: number, fmt: number, siz: number, width: number, height: number, pal: number, cms: number, cmt: number, masks: number, maskt: number, shifts: number, shiftt: number): void {

        function CalcDtx(b_txl: number): number {
            const txlWords = Math.max(1, (width * b_txl) / 8);
            return Math.floor(((1 << G_TX_DXT_FRAC) + txlWords - 1) / txlWords);
        }

        let inc: number = 0;
        let shift: number = 0;
        let sizInBytes: number = 0;
        let lineBytes: number = 0;
        let loadBlockSize: ImageSize = ImageSize.G_IM_SIZ_32b;

        if (siz !== ImageSize.G_IM_SIZ_32b)
            loadBlockSize = ImageSize.G_IM_SIZ_16b;

        switch (siz) {
            case ImageSize.G_IM_SIZ_4b:
                lineBytes = 0;
                sizInBytes = 0;
                shift = 2;
                inc = 3;
                break;
            case ImageSize.G_IM_SIZ_8b:
                lineBytes = 1;
                sizInBytes = 1;
                shift = 1;
                inc = 1;
                break;
            case ImageSize.G_IM_SIZ_16b:
                lineBytes = 2;
                sizInBytes = 2;
                break;
            case ImageSize.G_IM_SIZ_32b:
                lineBytes = 2;
                sizInBytes = 4;
                break;
        }

        this.gDPSetTextureImage(fmt, loadBlockSize, 1, timg);
        this.gDPSetTile(fmt, loadBlockSize, 0, 0, G_TX_LOADTILE, 0, cmt, maskt, shiftt, cms, masks, shifts);
        this.gDPLoadBlock(G_TX_LOADTILE, 0, 0, (((width) * (height) + inc) >>> shift) - 1, CalcDtx(sizInBytes));
        this.gDPSetTile(fmt, siz, (((width) * lineBytes) + 7) >>> 3, 0, G_TX_RENDERTILE, pal, cmt, maskt, shiftt, cms, masks, shifts);
        this.gDPSetTileSize(G_TX_RENDERTILE, 0, 0, ((width) - 1) << G_TEXTURE_IMAGE_FRAC, ((height) - 1) << G_TEXTURE_IMAGE_FRAC);
    }

    public gDPSetRenderMode(c0: number, c1: number) {
        this.gDPSetOtherModeL(3, 0x1D, c0 | c1);
    }

    public gsDPSetTextureFilter(texFilter: TextFilt) {
        this.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, texFilter << RDP.OtherModeH_Layout.G_MDSFT_TEXTFILT);
    }
}