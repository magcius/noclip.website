import * as Viewer from '../viewer';
import * as Textures from './textures';
import * as RDP from '../Common/N64/RDP';
import * as RSP from '../Common/N64/RSP';
import * as F3DEX from '../BanjoKazooie/f3dex';

import { assert, assertExists, nArray } from "../util";
import { F3DEX_Program } from "../BanjoKazooie/render";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRendererLayer, setSortKeyDepthKey, setSortKeyDepth  } from "../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxCompareMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { ImageFormat, getImageFormatName, ImageSize, getImageSizeName, getSizBitsPerPixel } from "../Common/N64/Image";
import { DeviceProgram } from "../Program";
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { GloverObjbank, GloverTexbank } from './parsers';

// Stray RDP defines
const G_TX_LOADTILE = 7
const G_TX_RENDERTILE = 0
const G_TX_NOMIRROR = 0
const G_TX_WRAP = 0
const G_TX_MIRROR = 1
const G_TX_CLAMP = 2
const G_TX_NOMASK = 0
const G_TX_NOLOD = 0

// TODO: Separate render boilerplate classes and actor classes into separate files

// TODO: proper pipeline initialization:
// void initializeModes() {
//     /* @ram_offset: 0x8013CBBC */    
//     DL_CMD(dl_cursor, gsDPPipelineMode(G_PM_NPRIMITIVE)); // 0xba001701 0x00000000
//     DL_CMD(dl_cursor, gsDPSetScissor(G_SC_NON_INTERLACE, 0, 0, 320, 240)); // 0xed000000 0x005003c0
//     DL_CMD(dl_cursor, gsDPSetTextureLOD(G_TL_TILE)); // 0xba001001 0x00000000
//     DL_CMD(dl_cursor, gsDPSetTextureLUT(G_TT_NONE)); // 0xba000e02 0x00000000
//     DL_CMD(dl_cursor, gsDPSetTextureDetail(G_TD_CLAMP)); // 0xba001102 0x00000000
//     DL_CMD(dl_cursor, gsDPSetTexturePersp(G_TP_PERSP)); // 0xba001301 0x00080000
//     DL_CMD(dl_cursor, gsDPSetTextureFilter(G_TF_BILERP)); // 0xba000c02 0x00002000
//     DL_CMD(dl_cursor, gsDPSetTextureConvert(G_TC_FILT)); // 0xba000903 0x00000c00
//     DL_CMD(dl_cursor, gsDPSetCombineKey(G_CK_NONE)); // 0xba000801 0x00000000
//     DL_CMD(dl_cursor, gsDPSetAlphaCompare(G_AC_NONE)); // 0xb9000002 0x00000000
//     DL_CMD(dl_cursor, gsDPSetBlendColor(0xFF, 0xFF, 0xFF, 0x00)); // 0xf9000000 0xffffff00
//     DL_CMD(dl_cursor, gsDPSetColorDither(G_CD_MAGICSQ)); // 0xba000602 0x00000000
//     DL_CMD(dl_cursor, gsDPSetDepthImage(0x80000430)); // 0xfe000000 0x80000430
//     DL_CMD(dl_cursor, gsDPSetPrimColor(0, 0, 0x00, 0x00, 0x00, 0xFF)); // 0xfa000000 0x000000ff
//     DL_CMD(dl_cursor, gsDPSetDepthSource(G_ZS_PIXEL)); // 0xb9000201 0x00000000
//     DL_CMD(dl_cursor, gsDPPipeSync()); // 0xe7000000 0x00000000
// }
// void initializeViewport() {
//     /* @ram_offset: 0x8013CA1C */
//     viewport->vscale[0] = qu142(160); // *(u16 *)0x80202270 = 0x0280;
//     viewport->vscale[1] = qu142(120); // *(u16 *)0x80202272 = 0x01e0;
//     viewport->vscale[2] = qu142(127.75); // *(u16 *)0x80202274 = 0x01ff;
//     viewport->vscale[3] = qu142(0); // *(u16 *)0x80202276 = 0x0000;
//     viewport->vtrans[0] = qu142(160); // *(u16 *)0x80202278 = 0x0280;
//     viewport->vtrans[1] = qu142(120); // *(u16 *)0x8020227a = 0x01e0;
//     viewport->vtrans[2] = qu142(127.75); // *(u16 *)0x8020227c = 0x01ff;
//     viewport->vtrans[3] = qu142(0); // *(u16 *)0x8020227e = 0x0000;
//     DL_CMD(dl_cursor, gsSPViewport(viewport)); // 0x03800010, viewport
//     DL_CMD(dl_cursor, gsSPClearGeometryMode(
//                           G_ZBUFFER | G_SHADE | G_CULL_BOTH | G_FOG |
//                           G_LIGHTING | G_TEXTURE_GEN | G_TEXTURE_GEN_LINEAR
//                           | G_LOD | G_SHADING_SMOOTH)); // 0xb6000010, 0x001f3205);  
//     DL_CMD(dl_cursor, gsSPSetGeometryMode(G_CULL_BACK)); // 0xb7000000, 0x00002000
//     if (*G_SHADING_MODE == 1) {
//         DL_CMD(dl_cursor, gsSPSetGeometryMode(G_SHADE | G_SHADING_SMOOTH)); // 0xb7000000, 0x00000204
//     } else if (*G_SHADING_MODE == 2) {
//         DL_CMD(dl_cursor, gsSPSetGeometryMode(G_SHADE | G_LIGHTING | G_SHADING_SMOOTH)); // 0xb7000000, 0x00020204
//     }
// }
// void initializePipeline () {
//     /* @ram_offset: 0x8013CEEC */
//     initializeModes();
//     initializeViewport();
//     if (*G_TEXTURE_MODE != 0) {
//         DL_CMD(dl_cursor, gsDPSetTextureFilter(G_TF_BILERP)); // 0xba000c02 0x00002000
//         if (*G_TEXTURE_MODE == 2) {
//             DL_CMD(dl_cursor, gsSPTexture(qu016(0.999985), qu016(0.999985), 5, G_TX_RENDERTILE, G_ON)); // 0xbb002801 0xFFFFFFFF
//             DL_CMD(dl_cursor, gsDPSetTextureDetail(G_TD_CLAMP)); // 0xba001102 0x00000000
//             DL_CMD(dl_cursor, gsDPSetTextureLOD(G_TL_LOD)); // 0xba001001 0x00010000
//             DL_CMD(dl_cursor, gsDPPipelineMode(G_PM_1PRIMITIVE)); // 0xba001701 0x00800000
//             if (*G_SHADING_MODE == 0) {
//                 DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_TRILERP, G_CC_DECALRGB2)); // 0xfc26a1ff 0x1ffc923c
//             } else {
//                 DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_TRILERP, G_CC_MODULATEI2)); // 0xfc26a004 0x1ffc93fc
//             }
//         } else {
//             DL_CMD(dl_cursor,  gsSPTexture(qu016(0.999985), qu016(0.999985), 0, G_TX_RENDERTILE, G_ON)); // 0xbb000001 0xfffffff
//             if (*G_SHADING_MODE == 0) {
//                 DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_DECALRGB, G_CC_DECALRGB)); // 0xfcffffff 0xfffcf87c
//             } else {
//                 DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_MODULATEI, G_CC_MODULATEI)); // 0xfc127e24 0xfffff9fc
//             }
//         }
//     } else {
//         DL_CMD(dl_cursor, gsSPTexture(0, 0, 0, G_TX_RENDERTILE, G_OFF)); // 0xbb000000 0x00000000
//         if (*G_SHADING_MODE == 0) {
//             DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_PRIMITIVE, G_CC_PRIMITIVE)); // 0xfcffffff 0xfffdf6fb
//         } else {
//             DL_CMD(dl_cursor, gsDPSetCombineMode(G_CC_SHADE, G_CC_SHADE)); // 0xfcffffff 0xfffe793c
//         }
//     }
// }
function makeVertexBufferData(v: F3DEX.Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = v[i].matrixIndex;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

export class DrawCallRenderData {
    public textures: GfxTexture[] = [];
    public samplers: GfxSampler[] = [];

    public dynamicBufferCopies: GfxBuffer[] = [];
    public dynamicStateCopies: GfxInputState[] = [];

    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public vertexBufferData: Float32Array;

    constructor(device: GfxDevice, renderCache: GfxRenderCache, textureCache: RDP.TextureCache, drawCall: DrawCall) {
        const textures = textureCache.textures;
        for (let i = 0; i < textures.length; i++) {
            const tex = textures[i];
            this.textures.push(RDP.translateToGfxTexture(device, tex));
            this.samplers.push(RDP.translateSampler(device, renderCache, tex));
        }

        this.vertexBufferData = makeVertexBufferData(drawCall.vertices);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.vertexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0*0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: null,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], null);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++)
            device.destroyTexture(this.textures[i]);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        for (let i = 0; i < this.dynamicBufferCopies.length; i++)
            device.destroyBuffer(this.dynamicBufferCopies[i]);
        for (let i = 0; i < this.dynamicStateCopies.length; i++)
            device.destroyInputState(this.dynamicStateCopies[i]);
    }
}

export class GloverRSPOutput {
    constructor(public drawCalls: DrawCall[], public textureCache: RDP.TextureCache) {
    }
}

export class GloverRSPState implements F3DEX.RSPStateInterface {
    private outputDrawCalls: DrawCall[] = [];
    private currentDrawCall = new DrawCall();

    private stateChanged: boolean = false;

    private textureCache: RDP.TextureCache = new RDP.TextureCache();
    private vertexCache: F3DEX.Vertex[] = [];

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new F3DEX.TextureState();
    private SP_MatrixStackDepth = 0;

    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TextureImageState = new F3DEX.TextureImageState();
    public DP_TileState = nArray(8, () => new RDP.TileState());
    private DP_TMemTracker = new Map<number, number>();

    constructor(public segmentBuffers: ArrayBufferSlice[], private textures: Textures.GloverTextureHolder) {
        for (let i = 0; i < 64; i++) {
            this.vertexCache.push(new F3DEX.Vertex());
        }
    }

    public finish(): GloverRSPOutput | null {
        if (this.outputDrawCalls.length === 0)
            return null;

        return new GloverRSPOutput(
            this.outputDrawCalls,
            this.textureCache
        );
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
        // This is the texture we're using to rasterize triangles going forward.
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
            writeVtx.matrixIndex = this.SP_MatrixStackDepth;
            writeIdx += 1;
        }
    }

    public gSPModifyVertex(vtx: number, where: number, val: number): void {
        assert(vtx < this.vertexCache.length);
        const vertex = this.vertexCache[vtx];
        if (where == F3DEX.MODIFYVTX_Locations.G_MWO_POINT_RGBA) {
            vertex.c0 = ((val >>> 24) & 0xFF) / 0xFF;
            vertex.c1 = ((val >>> 16) & 0xFF) / 0xFF;
            vertex.c2 = ((val >>>  8) & 0xFF) / 0xFF;
            vertex.a =  ((val >>>  0) & 0xFF) / 0xFF;
        } else if (where == F3DEX.MODIFYVTX_Locations.G_MWO_POINT_ST) {
            vertex.tx = ((val >>> 16) & 0xFFFF) / 2**5;
            vertex.ty = ((val >>>  0) & 0xFFFF) / 2**5;
        } else if (where == F3DEX.MODIFYVTX_Locations.G_MWO_POINT_XYSCREEN) {
            vertex.x = (val >>> 16) & 0xFFFF;
            vertex.y = (val >>>  0) & 0xFFFF;
        } else if (where == F3DEX.MODIFYVTX_Locations.G_MWO_POINT_ZSCREEN) {
            vertex.z = (val >>> 16) & 0xFFFF;
        } else {
            console.error(`Unknown gSPModifyVertex location: ${where.toString(16)}`);
        }
    }

    public _translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex];

        const dramAddr = assertExists(this.DP_TMemTracker.get(tile.tmem));

        let dramPalAddr: number;

        const textlut = (this.DP_OtherModeH >>> 14) & 0x03;
        const forceIndexing = textlut !== 0; 
        if (tile.fmt === ImageFormat.G_IM_FMT_CI || forceIndexing === true) {
            const palTmem = 0x100 + (tile.palette << 4);
            dramPalAddr = assertExists(this.DP_TMemTracker.get(palTmem));
        } else {
            dramPalAddr = 0;
        }

        return this.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile, false, forceIndexing);
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

    public _newDrawCall(): DrawCall {
        const dc = new DrawCall();
        dc.SP_GeometryMode = this.SP_GeometryMode;
        dc.SP_TextureState.copy(this.SP_TextureState);
        dc.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
        dc.DP_OtherModeH = this.DP_OtherModeH;
        dc.DP_OtherModeL = this.DP_OtherModeL;
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
        this.currentDrawCall.vertices.push(
            new F3DEX.Vertex().copy(this.vertexCache[i0]),
            new F3DEX.Vertex().copy(this.vertexCache[i1]),
            new F3DEX.Vertex().copy(this.vertexCache[i2]));
        this.currentDrawCall.vertexCount += 3;
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

        const actualAddr = this.textures.getSegmentPaletteAddr(this.DP_TextureImageState.addr);
        if (actualAddr === undefined){
            console.error(`Texture 0x${this.DP_TextureImageState.addr.toString(16)} not loaded`);
        } else {
            this.DP_TMemTracker.set(tmemDst, actualAddr);
        }
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
        const actualAddr = this.textures.getSegmentDataAddr(this.DP_TextureImageState.addr);
        if (actualAddr === undefined){
            console.error(`Texture 0x${this.DP_TextureImageState.addr.toString(16)} not loaded`);
        } else {
            this.DP_TMemTracker.set(tile.tmem, actualAddr);
        }
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
}

function initializeRenderState(rspState: GloverRSPState): void {
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_PIPELINE, 1, 0x00000000); // G_PM_NPRIMITIVE
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0x00000000); // G_TL_TILE
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTLUT, 2, 0x00000000); // G_TT_NONE
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTDETAIL, 2, 0x00000000); // G_TD_CLAMP
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTPERSP, 1, 0x00080000); // G_TP_PERSP
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, 0x00002000); // G_TF_BILERP
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTCONV, 3, 0x00000c00); // G_TC_FILT
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_COMBKEY, 1, 0x00000000); // G_CK_NONE
    rspState.gDPSetOtherModeL(RDP.OtherModeL_Layout.G_MDSFT_ALPHACOMPARE, 2, 0x00000000); // G_AC_NONE
    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_RGBDITHER, 2, 0x00000000); // G_CD_MAGICSQ
    rspState.gDPSetOtherModeL(RDP.OtherModeL_Layout.G_MDSFT_ZSRCSEL, 1, 0x00000000); // G_ZS_PIXEL
}


const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];


export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public SP_TextureState = new F3DEX.TextureState();
    public DP_OtherModeL: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_Combine: RDP.CombineParams;

    public textureIndices: number[] = [];
    public textureCache: RDP.TextureCache;

    public vertexCount: number = 0;
    public vertices: F3DEX.Vertex[] = [];

    public renderData: DrawCallRenderData | null = null;
}

export class DrawCallInstance {
    static viewMatrixScratch = mat4.create();
    static modelViewScratch = mat4.create();
    static texMatrixScratch = mat4.create();
    private textureEntry: RDP.Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public envAlpha = 1;
    public visible = true;

    constructor(private drawCall: DrawCall, private drawMatrix: mat4, textureCache: RDP.TextureCache) {
        assert(drawCall.renderData !== null);

        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = this.drawCall.renderData!.textures[idx];
                this.textureMappings[i].gfxSampler = this.drawCall.renderData!.samplers[idx];
            }
        }
        this.megaStateFlags = F3DEX.translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL)
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const combParams = vec4.create();
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled && this.drawCall.textureIndices.length) {
            program.defines.set('USE_TEXTURE', '1');
        }

        const shade = (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_LIGHTING)
            program.defines.set('LIGHTING', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');


        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? F3DEX.translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.None;
        this.megaStateFlags.cullMode = cullMode;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            RSP.calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, depthKey = 0): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.drawCall.renderData!.inputLayout, this.drawCall.renderData!.inputState);

        renderInst.setGfxProgram(this.gfxProgram);
        if (depthKey > 0)
            renderInst.sortKey = setSortKeyDepthKey(renderInst.sortKey, depthKey)
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawPrimitives(this.drawCall.vertexCount);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12*2 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(DrawCallInstance.viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(DrawCallInstance.viewMatrixScratch, viewerInput.camera);

        mat4.mul(DrawCallInstance.modelViewScratch, DrawCallInstance.viewMatrixScratch, this.drawMatrix);
        offs += fillMatrix4x3(mappedF32, offs, DrawCallInstance.modelViewScratch);

        this.computeTextureMatrix(DrawCallInstance.texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, DrawCallInstance.texMatrixScratch);

        this.computeTextureMatrix(DrawCallInstance.texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, DrawCallInstance.texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        // TODO: set these properly, this mostly just reproduces vertex*texture
        offs += fillVec4(comb, offs, 0, 0, 0, 1);   // primitive color
        offs += fillVec4(comb, offs, 1, 1, 1, this.envAlpha);   // environment color
        renderInstManager.submitRenderInst(renderInst);
    }
}


class ActorMeshNode {
    private static rendererCache: Map<number, GloverMeshRenderer> = new Map<number, GloverMeshRenderer>();

    public renderer: GloverMeshRenderer;

    public children: ActorMeshNode[] = [];

    // TODO: store animation data

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        segments: ArrayBufferSlice[],
        textures: Textures.GloverTextureHolder,
        public mesh: GloverObjbank.Mesh) 
    {
        if (ActorMeshNode.rendererCache.get(mesh.id) === undefined) {
            this.renderer = new GloverMeshRenderer(device, cache, segments, textures, mesh);
            ActorMeshNode.rendererCache.set(mesh.id, this.renderer);
        } else {
            this.renderer = ActorMeshNode.rendererCache.get(mesh.id)!;
        }

        let current_child = mesh.child;
    while (current_child !== undefined) {
            this.children.push(new ActorMeshNode(device, cache, segments, textures, current_child));
            current_child = current_child.sibling;
        }
    }

    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, parentMatrix: mat4, parentScale: number[] = [1,1,1]) {
        const drawMatrix = mat4.clone(parentMatrix);

        // TODO: animation
        const rotation = this.mesh.rotation[0];
        const translation = this.mesh.translation[0];
        const scale = this.mesh.scale[0];

        const rotXlateMatrix = mat4.create();
        mat4.fromQuat(rotXlateMatrix, [rotation.v1, rotation.v2, rotation.v3, rotation.v4])
        rotXlateMatrix[12] = translation.v1 * parentScale[0];
        rotXlateMatrix[13] = translation.v2 * parentScale[1];
        rotXlateMatrix[14] = translation.v3 * parentScale[2];

        mat4.mul(drawMatrix, rotXlateMatrix, drawMatrix);

        for (let child of this.children) {
            child.prepareToRender(device, renderInstManager, viewerInput, drawMatrix);
        }
        
        drawMatrix[0] *= scale.v1;
        drawMatrix[5] *= scale.v2;
        drawMatrix[10] *= scale.v3;

        this.renderer.prepareToRender(device, renderInstManager, viewerInput, drawMatrix);
    }
}

export class GloverActorRenderer {

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private inputState: GfxInputState;

    public rootMesh: ActorMeshNode;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        private actorObject: GloverObjbank.ObjectRoot,
        public modelMatrix: mat4)
    {
        /* Object bank in first segment, then one
           texture bank for each subsequent */
        const segments = textures.textureSegments();
        segments[0] = new ArrayBufferSlice(actorObject._io.buffer);

        this.megaStateFlags = {};

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        this.rootMesh = new ActorMeshNode(device, cache, segments, textures, actorObject.mesh)
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        const sceneParamsSize = 16;

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        this.rootMesh.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        // TODO
    }
}

function f3dexFromGeometry(geo: GloverObjbank.Geometry, faceIdx: number, faceVertIdx: number, alpha: number = 1.0) : F3DEX.Vertex {
    const f3dexVertex = new F3DEX.Vertex();

    const vertIdx = (faceVertIdx == 0) ? geo.faces[faceIdx].v0 :
                            (faceVertIdx == 1) ? geo.faces[faceIdx].v1 :
                                geo.faces[faceIdx].v2;

    const geoVert = geo.vertices[vertIdx];

    f3dexVertex.x = Math.floor(geoVert.x);
    f3dexVertex.y = Math.floor(geoVert.y);
    f3dexVertex.z = Math.floor(geoVert.z);

    f3dexVertex.tx = (faceVertIdx == 0) ? geo.uvs[faceIdx].u1.value :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].u2.value :
                                geo.uvs[faceIdx].u3.value
    f3dexVertex.ty = (faceVertIdx == 0) ? geo.uvs[faceIdx].v1.value :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].v2.value :
                                geo.uvs[faceIdx].v3.value


    const colorsNorms = geo.colorsNorms[vertIdx];
    f3dexVertex.c0 = ((colorsNorms >>> 24) & 0xFF) / 0xFF;
    f3dexVertex.c1 = ((colorsNorms >>> 16) & 0xFF) / 0xFF;
    f3dexVertex.c2 = ((colorsNorms >>>  8) & 0xFF) / 0xFF;

    f3dexVertex.a = alpha;

    return f3dexVertex;
}

class GloverMeshRenderer {
    private rspOutput: GloverRSPOutput | null;
    private visible = true;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private segments: ArrayBufferSlice[],
        private textures: Textures.GloverTextureHolder,
        private meshData: GloverObjbank.Mesh)
    {
        const buffer = meshData._io.buffer;
        const rspState = new GloverRSPState(segments, textures);

        initializeRenderState(rspState);

        // TODO: choose texture and blend modes properly based on decomp'ed pipeline initialization code
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER | F3DEX.RSP_Geometry.G_SHADE | F3DEX.RSP_Geometry.G_SHADING_SMOOTH);
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000, 0.999985 * 0x10000);
        rspState.gDPSetCombine(0xfc26a1ff, 0x1ffc923c); // (G_CC_TRILERP, G_CC_DECALRGB2)
        rspState.gDPSetOtherModeL(3, 0x1D, 0x00552038); // gsDPSetRenderMode(G_RM_RA_ZB_OPA_SURF, G_RM_RA_ZB_OPA_SURF2);

        if (meshData.displayListPtr != 0) {
            const displayListOffs = meshData.displayListPtr & 0x00FFFFFF;
            F3DEX.runDL_F3DEX(rspState, displayListOffs);
            this.rspOutput = rspState.finish();
        } else {
            this.rspOutput = this.loadDynamicModel(meshData.geometry, rspState);
        }

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.renderData = new DrawCallRenderData(device, cache, this.rspOutput.textureCache, drawCall);
            }
        }
    }

    private loadDynamicModel(geo: GloverObjbank.Geometry, rspState: GloverRSPState): GloverRSPOutput {
        const drawCalls: DrawCall[] = []
        const uniqueTextures = new Set<number>()
        const textureCache = new RDP.TextureCache()
        for (let textureId of geo.textureIds) {
            uniqueTextures.add(textureId);
        }
        for (let textureId of uniqueTextures) {
            const texFile = this.textures.idToTexture.get(textureId);
            const dataAddr = this.textures.getSegmentDataAddr(textureId);
            const palAddr = this.textures.getSegmentPaletteAddr(textureId);
            if (texFile === undefined || dataAddr === undefined ||
                palAddr === undefined)
            {
                console.error(`Texture 0x${textureId.toString(16)} not loaded`);
                continue;
            }

            const forceIndexing = texFile.compressionFormat == 0 ||
                                    texFile.compressionFormat == 1; 

            // Set up texture state

            // TODO: figure out how/when to set this:
            const mirror = false;

            if (forceIndexing) {
                rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, textureId);

                rspState.gDPSetTile(
                    texFile.colorFormat,
                    texFile.compressionFormat == 0 ? ImageSize.G_IM_SIZ_4b : ImageSize.G_IM_SIZ_8b,
                    0, 0x0100, G_TX_LOADTILE, 0,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), 0, 0,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), 0, 0);

                rspState.gDPLoadTLUT(G_TX_LOADTILE, texFile.compressionFormat == 0 ? 15 : 255);

                rspState.gDPSetTextureImage(texFile.colorFormat, ImageSize.G_IM_SIZ_16b, 1, textureId);
                
                rspState.gDPSetTile(
                    texFile.colorFormat,
                    ImageSize.G_IM_SIZ_16b,
                    0, 0x0000, G_TX_LOADTILE, 0,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), texFile.maskt, G_TX_NOLOD,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), texFile.masks, G_TX_NOLOD);


                rspState.gDPLoadBlock(G_TX_LOADTILE, 0, 0, 0, 0);

                rspState.gDPSetTile(
                    texFile.colorFormat,
                    texFile.compressionFormat == 0 ? ImageSize.G_IM_SIZ_4b : ImageSize.G_IM_SIZ_8b,
                    0, 0x0000, G_TX_RENDERTILE, 0,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), texFile.maskt, G_TX_NOLOD,
                    G_TX_WRAP | (mirror ? G_TX_MIRROR : G_TX_NOMIRROR), texFile.masks, G_TX_NOLOD)

                rspState.gDPSetTileSize(G_TX_RENDERTILE,
                    0, 0,
                    (texFile.width - 1) * 4, (texFile.height - 1) * 4);

            } else {
                console.error("TODO: non-indexed texture loads for dynamic models")
            }
            // Set up draw call
            let drawCall = rspState._newDrawCall();

            const textureIdx = textureCache.translateTileTexture(this.segments, dataAddr, palAddr, rspState.DP_TileState[G_TX_RENDERTILE], false, forceIndexing);
            drawCall.textureIndices.push(textureIdx);

            for (let faceIdx = 0; faceIdx < geo.nFaces; faceIdx++) {
                if (geo.textureIds[faceIdx] != textureId) {
                    continue;
                }
                drawCall.vertices.push(
                    f3dexFromGeometry(geo, faceIdx, 0),
                    f3dexFromGeometry(geo, faceIdx, 1),
                    f3dexFromGeometry(geo, faceIdx, 2)
                );
                drawCall.vertexCount += 3;
            }
            drawCalls.push(drawCall)
        }
        return new GloverRSPOutput(drawCalls, textureCache);

    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4): void {
        if (!this.visible)
            return;

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                const drawCallInstance = new DrawCallInstance(drawCall, drawMatrix, this.rspOutput.textureCache);
                drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, false);
            }
        }
    }


    public destroy(device: GfxDevice): void {
        // TODO
    }

}