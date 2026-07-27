
import * as F3DEX from '../BanjoKazooie/f3dex.js';
import * as RDP from '../Common/N64/RDP.js';

import { nArray, assert, assertExists, hexzero } from "../util.js";
import { ImageFormat } from "../Common/N64/Image.js";
import { vec4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { F3DEX2_GBI, RSP_Geometry } from '../PokemonSnap/f3dex2.js';

// Interpreter for N64 F3DEX2 microcode. The opcode and geometry-mode tables are identical
// to PokemonSnap's, so they are shared rather than forked.
export { RSP_Geometry };

// DK64 is the only port that uses opcode 0x00, to delimit map sections within a chunk
// display list, so it is not part of the shared table.
export const G_SNOOP = 0x00 as F3DEX2_GBI;

const G_MTX_LOAD = 0x02;
const G_MTX_PUSH = 0x04;

// RDP.TileState.cacheKey is derived from a segmented address, which is 32-bit. Animated
// texture frames have no single source address, so they are keyed above that range to
// guarantee they cannot collide with a real one.
const animatedTextureCacheKeyBase = 0x100000000;

export interface DrawTextureAnimation {
    textureIndices: number[];
    frameDuration: number;
    frameOffset: number;
    crossfadeGroup: number | null;
}

// DK64's per-texture state, parallel to the inherited DrawCall.textureIndices.
export interface DrawTextureBinding {
    animation: DrawTextureAnimation | undefined;
    scrollSpeed: number;
}

export class DrawCall extends F3DEX.DrawCall {
    public DP_PrimColor = vec4.fromValues(1, 1, 1, 1);
    public DP_EnvColor = vec4.fromValues(1, 1, 1, 1);
    public DP_PrimLOD = 0;
    public textureBindings: DrawTextureBinding[] = [];
}

export interface AnimatedTexture {
    segment: number;
    group: number;
    frameDuration: number;
    frameOffset?: number;
    crossfade?: boolean;
    frames: ArrayBufferSlice[];
}

export class RSPSharedOutput extends F3DEX.RSPSharedOutput {
    private animatedTextureSourceIDs = new WeakMap<ArrayBufferSlice, number>();
    private nextAnimatedTextureSourceID = 1;

    public getAnimatedTextureCacheKey(frame: ArrayBufferSlice): number {
        let sourceID = this.animatedTextureSourceIDs.get(frame);
        if (sourceID === undefined) {
            sourceID = this.nextAnimatedTextureSourceID++;
            this.animatedTextureSourceIDs.set(frame, sourceID);
        }
        return animatedTextureCacheKeyBase + sourceID;
    }
}

// same logic, just with the new type
export class RSPOutput extends F3DEX.RSPOutput {
    public override drawCalls: DrawCall[] = [];

    public override currentDrawCall = new DrawCall();

    public override newDrawCall(firstIndex: number): DrawCall {
        this.currentDrawCall = new DrawCall();
        this.currentDrawCall.firstIndex = firstIndex;
        this.drawCalls.push(this.currentDrawCall);
        return this.currentDrawCall;
    }
}

class TMemUpload {
    constructor(public addr: number, public dxt: number = -1) {
    }
}

// DK64 needs to trace each output vertex back to the DRAM address it was loaded from
// (for animated-texture relighting) and to the modelview matrices in effect when it was
// loaded (for prop animation), so the vertex cache carries both alongside the vertex.
class StagingVertex extends F3DEX.StagingVertex {
    public sourceAddress: number = 0;
    public modelViewMatrixIndices: number[] = [];
}

export class RSPState {
    private output = new RSPOutput();

    private stateChanged: boolean = false;
    private vertexCache = nArray(64, () => new StagingVertex());
    public vertexSourceAddresses: number[] = [];
    public vertexModelViewMatrixIndices: number[][] = [];

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new F3DEX.TextureState();

    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TextureImageState = new F3DEX.TextureImageState();
    private DP_TileState = nArray(8, () => new RDP.TileState());
    private DP_TMemUploadTracker = new Map<number, TMemUpload>();

    private DP_PrimColor = vec4.create();
    private DP_EnvColor = vec4.create();
    private DP_PrimLOD = 0;
    private textureScrollSpeeds: number[] = [];

    public SP_MatrixIndex = 0;
    // Animated props need to recompute a transform each frame: this stores matrix source indices.
    private matrixStack: number[][] = [];
    public DP_Half1 = 0;

    constructor(public textureBuffers: ArrayBufferSlice[], public segmentBuffers: ArrayBufferSlice[], public sharedOutput: RSPSharedOutput, private animatedTextures: AnimatedTexture[] = []) {
    }

    public finish(): RSPOutput | null {
        if (this.output.drawCalls.length === 0)
            return null;
        return this.output;
    }

    // partially reset the state to prepare for a new node
    public clear(): void {
        this.SP_MatrixIndex = 0;
        // start a new collection of drawcalls
        this.output = new RSPOutput();
        this.stateChanged = true;

        // mark any existing vertices as belonging to the parent
        for (let i = 0; i < this.vertexCache.length; i++) {
            this.vertexCache[i].matrixIndex = 1;
            this.vertexCache[i].outputIndex = -1;
        }
    }

    public setTextureScrollSpeeds(speeds: number[]): void {
        this.textureScrollSpeeds = speeds;
    }

    private _setGeometryMode(newGeometryMode: number) {
        if (this.SP_GeometryMode === newGeometryMode)
            return;
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
        const view = this.segmentBuffers[(dramAddr >>> 24)].createDataView(dramAddr & 0x00FFFFFF);

        for (let i = 0; i < n; i++) {
            const vertex = this.vertexCache[v0 + i];
            vertex.setFromView(view, i * 0x10);
            vertex.matrixIndex = this.SP_MatrixIndex;
            vertex.modelViewMatrixIndices = this.matrixStack[this.matrixStack.length - 1] ?? [];
            vertex.sourceAddress = dramAddr + i * 0x10;
        }
    }

    public gSPMatrix(dramAddr: number, matrixParams: number): void {
        const segment = dramAddr >>> 24;
        if (segment !== 0x04 && segment !== 0x09)
            return;
        const matrixIndex = (dramAddr & 0x00FFFFFF) >>> 6;
        const mvMatrix = this.matrixStack.pop() ?? [];
        if (matrixParams & G_MTX_PUSH)
            this.matrixStack.push(mvMatrix);
        this.matrixStack.push(
            matrixParams & G_MTX_LOAD ? [matrixIndex] : [...mvMatrix, matrixIndex],
        );
        this.SP_MatrixIndex = matrixIndex;
    }

    public gSPPopMatrix(): void {
        this.matrixStack.pop();
        const mvMatrix = this.matrixStack[this.matrixStack.length - 1] ?? [];
        this.SP_MatrixIndex = mvMatrix[mvMatrix.length - 1] ?? 0;
    }

    private _translateAnimatedTextureFrames(frames: ArrayBufferSlice[], segment: number, dramAddr: number, tile: RDP.TileState, deinterleave: boolean): number[] {
        const oldCacheKey = tile.cacheKey;
        const segmentBuffers: ArrayBufferSlice[] = [];
        const textureIndices = frames.map((frame) => {
            segmentBuffers[segment] = frame;
            tile.cacheKey = this.sharedOutput.getAnimatedTextureCacheKey(frame);
            return this.sharedOutput.textureCache.translateTileTexture(segmentBuffers, dramAddr, 0, tile, deinterleave);
        });
        tile.cacheKey = oldCacheKey;
        return textureIndices;
    }

    private _translateTileTexture(tileIndex: number): { textureIndex: number; animation?: DrawTextureAnimation } {
        const tile = this.DP_TileState[tileIndex];
        const cache = assertExists(this.DP_TMemUploadTracker.get(tile.tmem));
        const segment = (cache.addr >>> 24) & 0xFF;

        const animation = this.animatedTextures.find((entry) =>
            segment === 0 ? entry.segment === 0 && entry.group === cache.addr : entry.segment === segment);
        if (animation !== undefined) {
            const textureIndices = this._translateAnimatedTextureFrames(
                animation.frames,
                segment === 0 ? 0x01 : segment,
                segment === 0 ? 0x01000000 : cache.addr,
                tile,
                cache.dxt === 0,
            );
            return {
                textureIndex: textureIndices[0],
                animation: segment !== 0 || textureIndices.length > 1 ? {
                    textureIndices,
                    frameDuration: animation.frameDuration,
                    frameOffset: animation.frameOffset ?? 0,
                    crossfadeGroup: segment === 0 && animation.crossfade ? animation.group : null,
                } : undefined,
            };
        }

        if (segment === 0x00) {
            // Load from texture index.
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x01] = assertExists(this.textureBuffers[cache.addr]);

            tile.cacheKey = cache.addr;

            let dramPalAddr: number;
            if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
                const textlut = (this.DP_OtherModeH >>> 14) & 0x03;
                // assert(textlut === RDP.TextureLUT.G_TT_RGBA16);

                const palTmem = 0x100 + (tile.palette << 4);
                const palCache = assertExists(this.DP_TMemUploadTracker.get(palTmem));
                segmentBuffers[0x02] = assertExists(this.textureBuffers[palCache.addr]);
                dramPalAddr = 0x02000000;
            } else {
                dramPalAddr = 0;
            }

            const deinterleave = cache.dxt === 0;
            return {
                textureIndex: this.sharedOutput.textureCache.translateTileTexture(segmentBuffers, 0x01000000, dramPalAddr, tile, deinterleave),
            };
        }
        console.warn(`Unknown texture segment type ${hexzero(segment, 0x02)}`);
        return { textureIndex: 0 };
    }

    private _flushTextures(dc: DrawCall): void {
        // If textures are not on, then we have no textures.
        // If combiners are not reading textures, then we have no textures.
        if (!this.SP_TextureState.on
            || (!RDP.combineParamsUsesT0(dc.DP_Combine) && !RDP.combineParamsUsesT1(dc.DP_Combine)))
            return;

        const lod_en = !!((this.DP_OtherModeH >>> 16) & 0x01);
        // TODO(jstpierre): Support mip-mapping
        if (false && lod_en) {
            assert(false);
        } else {
            // We're in TILE mode. Now check if we're in two-cycle mode.
            const cycletype = RDP.getCycleTypeFromOtherModeH(this.DP_OtherModeH);
            assert(cycletype === RDP.OtherModeH_CycleType.G_CYC_1CYCLE || cycletype === RDP.OtherModeH_CycleType.G_CYC_2CYCLE);

            const texture0 = this._translateTileTexture(this.SP_TextureState.tile);
            dc.textureIndices.push(texture0.textureIndex);
            dc.textureBindings.push({ animation: texture0.animation, scrollSpeed: this.textureScrollSpeeds[0] ?? 0 });

            if (!lod_en && RDP.combineParamsUsesT1(dc.DP_Combine)) {
                // In 2CYCLE mode, it uses tile and tile + 1.
                const texture1 = this._translateTileTexture(this.SP_TextureState.tile + 1);
                const crossfadeGroup = texture0.animation?.crossfadeGroup;
                const animation1 = texture1.animation;
                if (crossfadeGroup !== null && crossfadeGroup !== undefined
                    && animation1?.crossfadeGroup === crossfadeGroup)
                    animation1.frameOffset++;
                dc.textureIndices.push(texture1.textureIndex);
                dc.textureBindings.push({ animation: texture1.animation, scrollSpeed: this.textureScrollSpeeds[1] ?? 0 });
            }
        }
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this.output.newDrawCall(this.sharedOutput.indices.length);
            dc.SP_GeometryMode = this.SP_GeometryMode;
            dc.SP_TextureState.copy(this.SP_TextureState);
            dc.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
            dc.DP_OtherModeH = this.DP_OtherModeH;
            dc.DP_OtherModeL = this.DP_OtherModeL;
            vec4.copy(dc.DP_PrimColor, this.DP_PrimColor);
            vec4.copy(dc.DP_EnvColor, this.DP_EnvColor);
            dc.DP_PrimLOD = this.DP_PrimLOD;

            this._flushTextures(dc);
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();
        this.loadTriVertex(i0);
        this.loadTriVertex(i1);
        this.loadTriVertex(i2);
        this.sharedOutput.indices.push(
            this.vertexCache[i0].outputIndex,
            this.vertexCache[i1].outputIndex,
            this.vertexCache[i2].outputIndex,
        );
        this.output.currentDrawCall.indexCount += 3;
    }

    private loadTriVertex(i: number): void {
        const vertex = this.vertexCache[i];
        this.sharedOutput.loadVertex(vertex);
        this.vertexSourceAddresses[vertex.outputIndex] = vertex.sourceAddress;
        this.vertexModelViewMatrixIndices[vertex.outputIndex] = vertex.modelViewMatrixIndices;
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
        this.DP_TMemUploadTracker.set(tmemDst, new TMemUpload(this.DP_TextureImageState.addr));
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, texels: number, dxt: number): void {
        // First, verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);
        // Verify that we're loading into LOADTILE.
        assert(tileIndex === 7);

        const tile = this.DP_TileState[tileIndex];

        // Track the TMEM destination back to the originating DRAM address.
        this.DP_TMemUploadTracker.set(tile.tmem, new TMemUpload(this.DP_TextureImageState.addr, dxt));
        this.stateChanged = true;
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
        this.stateChanged = true;
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

    public gSPSetPrimColor(lod: number, r: number, g: number, b: number, a: number) {
        vec4.set(this.DP_PrimColor, r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
        this.DP_PrimLOD = lod / 0xFF;
        this.stateChanged = true;
    }

    public gSPSetEnvColor(r: number, g: number, b: number, a: number) {
        vec4.set(this.DP_EnvColor, r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
        this.stateChanged = true;
    }
}

export function runDL_F3DEX2(state: RSPState, addr: number): void {
    const segmentBuffer = state.segmentBuffers[(addr >>> 24) & 0xFF];
    const view = segmentBuffer.createDataView();

    for (let i = (addr & 0x00FFFFFF); i < segmentBuffer.byteLength; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3DEX2_GBI = w0 >>> 24;

        switch (cmd) {
            case F3DEX2_GBI.G_ENDDL:
                return;

            case F3DEX2_GBI.G_GEOMETRYMODE: {
                state.gSPClearGeometryMode(~(w0 & 0x00FFFFFF));
                state.gSPSetGeometryMode(w1);
             } break;

            case F3DEX2_GBI.G_SETTIMG: {
                const fmt = (w0 >>> 21) & 0x07;
                const siz = (w0 >>> 19) & 0x03;
                const w = (w0 & 0x0FFF) + 1;
                state.gDPSetTextureImage(fmt, siz, w, w1);
            } break;

            case F3DEX2_GBI.G_SETTILE: {
                const fmt = (w0 >>> 21) & 0x07;
                const siz = (w0 >>> 19) & 0x03;
                const line = (w0 >>> 9) & 0x1FF;
                const tmem = (w0 >>> 0) & 0x1FF;
                const tile = (w1 >>> 24) & 0x07;
                const palette = (w1 >>> 20) & 0x0F;
                const cmt = (w1 >>> 18) & 0x03;
                const maskt = (w1 >>> 14) & 0x0F;
                const shiftt = (w1 >>> 10) & 0x0F;
                const cms = (w1 >>> 8) & 0x03;
                const masks = (w1 >>> 4) & 0x0F;
                const shifts = (w1 >>> 0) & 0x0F;
                state.gDPSetTile(fmt, siz, line, tmem, tile, palette, cmt, maskt, shiftt, cms, masks, shifts);
            } break;

            case F3DEX2_GBI.G_LOADTLUT: {
                const tile = (w1 >>> 24) & 0x07;
                const count = (w1 >>> 14) & 0x3FF;
                state.gDPLoadTLUT(tile, count);
            } break;

            case F3DEX2_GBI.G_LOADBLOCK: {
                const uls = (w0 >>> 12) & 0x0FFF;
                const ult = (w0 >>> 0) & 0x0FFF;
                const tile = (w1 >>> 24) & 0x07;
                const lrs = (w1 >>> 12) & 0x0FFF;
                const dxt = (w1 >>> 0) & 0x0FFF;
                state.gDPLoadBlock(tile, uls, ult, lrs, dxt);
            } break;

            case F3DEX2_GBI.G_VTX: {
                const v0w = (w0 >>> 1) & 0xFF;
                const n = (w0 >>> 12) & 0xFF;
                const v0 = v0w - n;
                state.gSPVertex(w1, n, v0);
            } break;

            case F3DEX2_GBI.G_MTX:
                // Note that G_MTX_PUSH is inverted.
                state.gSPMatrix(w1, (w0 & 0xFF) ^ G_MTX_PUSH);
                break;

            case F3DEX2_GBI.G_TRI1: {
                const i0 = ((w0 >>> 16) & 0xFF) / 2;
                const i1 = ((w0 >>> 8) & 0xFF) / 2;
                const i2 = ((w0 >>> 0) & 0xFF) / 2;
                state.gSPTri(i0, i1, i2);
            } break;

            case F3DEX2_GBI.G_TRI2: {
                {
                    const i0 = ((w0 >>> 16) & 0xFF) / 2;
                    const i1 = ((w0 >>> 8) & 0xFF) / 2;
                    const i2 = ((w0 >>> 0) & 0xFF) / 2;
                    state.gSPTri(i0, i1, i2);
                }
                {
                    const i0 = ((w1 >>> 16) & 0xFF) / 2;
                    const i1 = ((w1 >>> 8) & 0xFF) / 2;
                    const i2 = ((w1 >>> 0) & 0xFF) / 2;
                    state.gSPTri(i0, i1, i2);
                }
            } break;

            case F3DEX2_GBI.G_DL: {
                runDL_F3DEX2(state, w1);
                // PUSH (0) resumes this list, NOPUSH(1) doesn't.
                if ((w0 & 0x00010000) !== 0)
                    return;
            } break;

            case F3DEX2_GBI.G_RDPSETOTHERMODE: {
                state.gDPSetOtherModeH(0, 24, w0 & 0x00FFFFFF);
                state.gDPSetOtherModeL(0, 32, w1);
            } break;

            case F3DEX2_GBI.G_SETOTHERMODE_H: {
                const len = ((w0 >>> 0) & 0xFF) + 1;
                const sft = 0x20 - ((w0 >>> 8) & 0xFF) - len;
                state.gDPSetOtherModeH(sft, len, w1);
            } break;

            case F3DEX2_GBI.G_SETOTHERMODE_L: {
                const len = ((w0 >>> 0) & 0xFF) + 1;
                const sft = 0x20 - ((w0 >>> 8) & 0xFF) - len;
                state.gDPSetOtherModeL(sft, len, w1);
            } break;

            case F3DEX2_GBI.G_SETCOMBINE: {
                state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
            } break;

            case F3DEX2_GBI.G_TEXTURE: {
                const level = (w0 >>> 11) & 0x07;
                const tile = (w0 >>> 8) & 0x07;
                const on = !!((w0 >>> 0) & 0x7F);
                const s = (w1 >>> 16) & 0xFFFF;
                const t = (w1 >>> 0) & 0xFFFF;
                state.gSPTexture(on, tile, level, s, t);
            } break;

            case F3DEX2_GBI.G_SETTILESIZE: {
                const uls = (w0 >>> 12) & 0x0FFF;
                const ult = (w0 >>> 0) & 0x0FFF;
                const tile = (w1 >>> 24) & 0x07;
                const lrs = (w1 >>> 12) & 0x0FFF;
                const lrt = (w1 >>> 0) & 0x0FFF;
                state.gDPSetTileSize(tile, uls, ult, lrs, lrt);
            } break;

            case F3DEX2_GBI.G_POPMTX: {
                state.gSPPopMatrix();
            } break;

            case F3DEX2_GBI.G_SETPRIMCOLOR: {
                const lod = (w0 >>> 0) & 0xFF;
                const r = (w1 >>> 24) & 0xFF;
                const g = (w1 >>> 16) & 0xFF;
                const b = (w1 >>> 8) & 0xFF;
                const a = (w1 >>> 0) & 0xFF;
                state.gSPSetPrimColor(lod, r, g, b, a);
            } break;

            case F3DEX2_GBI.G_SETBLENDCOLOR: {
                const r = (w1 >>> 24) & 0xFF;
                const g = (w1 >>> 16) & 0xFF;
                const b = (w1 >>> 8) & 0xFF;
                const a = (w1 >>> 0) & 0xFF;
                //state.gSPSetBlendColor(r, g, b, a);
            } break;

            case F3DEX2_GBI.G_SETENVCOLOR: {
                const r = (w1 >>> 24) & 0xFF;
                const g = (w1 >>> 16) & 0xFF;
                const b = (w1 >>> 8) & 0xFF;
                const a = (w1 >>> 0) & 0xFF;
                state.gSPSetEnvColor(r, g, b, a);
            } break;

            case F3DEX2_GBI.G_RDPHALF_1: {
                state.DP_Half1 = w1;
            } break;

            case F3DEX2_GBI.G_CULLDL:
            case F3DEX2_GBI.G_RDPFULLSYNC:
            case F3DEX2_GBI.G_RDPTILESYNC:
            case F3DEX2_GBI.G_RDPPIPESYNC:
            case F3DEX2_GBI.G_RDPLOADSYNC:
            case G_SNOOP:
                // Implementation not necessary.
                break;

            default:
                console.error(`Unknown DL opcode: ${cmd.toString(16)} ${hexzero(i, 8)}`);
        }
    }

    // Every display list must terminate with G_ENDDL; running past the end of the segment
    // means we mis-parsed a command length or followed a bad branch.
    throw new Error(`DK64: display list at ${hexzero(addr, 8)} ran past the end of its segment`);
}
