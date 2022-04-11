import * as Viewer from '../viewer';
import * as Textures from './textures';
import * as RDP from '../Common/N64/RDP';
import * as RSP from '../Common/N64/RSP';
import * as F3DEX from '../BanjoKazooie/f3dex';

import { assert, assertExists, align, nArray } from "../util";
import { F3DEX_Program } from "../BanjoKazooie/render";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x2, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxCompareMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { ImageFormat, getImageFormatName, ImageSize, getImageSizeName, getSizBitsPerPixel } from "../Common/N64/Image";
import { DeviceProgram } from "../Program";
import { computeViewMatrix } from '../Camera';
import { calcBillboardMatrix, CalcBillboardFlags } from '../MathHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { Color, colorNewFromRGBA, colorNewCopy, White } from "../Color";

import { GloverObjbank, GloverTexbank } from './parsers';

export const enum GloverRendererLayer {
    OPAQUE,
    OPAQUE_BILLBOARD,
    XLU,
    // XLU_BILLBOARD, // TODO: remove once sure it's not needed
    OVERLAY,
    FOOTPRINTS,
    WEATHER,
}

// Stray RDP defines
export const G_TX_LOADTILE = 7
export const G_TX_RENDERTILE = 0
export const G_TX_NOMIRROR = 0
export const G_TX_WRAP = 0
export const G_TX_MIRROR = 1
export const G_TX_CLAMP = 2
export const G_TX_NOMASK = 0
export const G_TX_NOLOD = 0

export interface GenericRenderable {
    destroy: (device: GfxDevice) => void;
    prepareToRender: (device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) => void;
    visible: boolean;
}

export class SceneLighting {
    public diffuseColor: vec3[] = [];
    public diffuseDirection: vec3[] = [];
    public ambientColor: vec3 = vec3.fromValues(.5, .5, .5);
};

export function setRenderMode(rspState: GloverRSPState, decal: boolean, xlu: boolean, overlay: boolean, alpha: number): void {    
    // TODO: prehist 1 bridge still doesn't have right depth behavior

    assert(0 <= alpha && alpha <= 1);

    rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001

    if (overlay) {
        rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_ZB_CLD_SURF, RDP.RENDER_MODES.G_RM_ZB_CLD_SURF2);
        // TODO: the active line of code here reproduces how
        //       colorful the exit cone is on hardware, but
        //       the commented-out line is what the code actually
        //       does. Investigate this.
        rspState.gDPSetCombine(0xFC121624, 0xff2fffff); // gsDPSetCombineMode(G_CC_MODULATEIA, G_CC_MODULATEIA)
        // rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // gsDPSetCombineMode(G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM)
        rspState.gDPSetPrimColor(0, 0, 0xFF, 0xFF, 0xFF, alpha * 255);
    } else {
        if (xlu) {
            if (decal) {
                rspState.gDPSetCombine(0xFCFF97FF, 0xFFFCFE38); // gsDPSetCombineLERP(0, 0, 0, TEXEL0, TEXEL0, 0, PRIMITIVE, 0, 0, 0, 0, COMBINED, 0, 0, 0, COMBINED));
            } else {
                rspState.gDPSetCombine(0xFC127FFF, 0xfffff638); // gsDPSetCombineLERP(TEXEL0, 0, SHADE, 0, 0, 0, 0, PRIMITIVE, 0, 0, 0, COMBINED, 0, 0, 0, COMBINED));
            }
            rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_PASS, RDP.RENDER_MODES.G_RM_AA_ZB_XLU_SURF2);
        } else {
            if (decal) {
                rspState.gDPSetCombine(0xFC127FFF, 0xfffff238); // gsDPSetCombineMode(G_CC_MODULATEIDECALA, G_CC_PASS2));
                rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_PASS, RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE2);
            } else {
                rspState.gDPSetCombine(0xFC127FFF, 0xfffff638); //  gsDPSetCombineLERP(TEXEL0, 0, SHADE, 0, 0, 0, 0, PRIMITIVE, 0, 0, 0, COMBINED, 0, 0, 0, COMBINED));
                rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_PASS, RDP.RENDER_MODES.G_RM_AA_ZB_OPA_SURF2);
            }
        }
        rspState.gDPSetPrimColor(0, 0, 0x00, 0x00, 0x00, alpha * 255); // 0xFA000000, (*0x801ec878) & 0xFF);
    }
}

export function makeVertexBufferData(v: F3DEX.Vertex[]): Float32Array {
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

    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public vertexBufferData: Float32Array;

    constructor(private device: GfxDevice, private renderCache: GfxRenderCache, private textureCache: RDP.TextureCache, private segmentBuffers: ArrayBufferSlice[], private drawCall: DrawCall) {
        const textures = textureCache.textures;
        for (let i = 0; i < textures.length; i++) {
            const tex = textures[i];
            this.textures.push(RDP.translateToGfxTexture(device, tex));
            this.samplers.push(RDP.translateSampler(device, renderCache, tex));
        }

        this.vertexBufferData = makeVertexBufferData(drawCall.vertices);
        if (drawCall.dynamicGeometry) {
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic
            );
            device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexBufferData.buffer));
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.vertexBufferData.buffer);
        }

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

    public updateTextures(): void {
        const textures = this.textureCache.textures;
        for (let i = 0; i < textures.length; i++) {
            const tex = textures[i];
            const reprocessed_tex = RDP.translateTileTexture(this.segmentBuffers, tex.dramAddr, tex.dramPalAddr, tex.tile, false);
            this.device.uploadTextureData(this.textures[i], 0, [reprocessed_tex.pixels]);
        }

    }

    public updateBuffers(): void {
        assert(this.drawCall.dynamicGeometry);
        this.vertexBufferData = makeVertexBufferData(this.drawCall.vertices);
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexBufferData.buffer));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++)
            device.destroyTexture(this.textures[i]);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
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

    public textureCache: RDP.TextureCache = new RDP.TextureCache();
    private vertexCache: F3DEX.Vertex[] = [];

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new F3DEX.TextureState();
    private SP_MatrixStackDepth = 0;

    private DP_PrimColor: Color = colorNewFromRGBA(1,1,1,1);
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

        const old_fmt = tile.fmt;
        const old_line = tile.line;
        if (textlut !== 0) {
            tile.fmt = ImageFormat.G_IM_FMT_CI;
        }
        if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
            const palTmem = 0x100 + (tile.palette << 4);
            dramPalAddr = assertExists(this.DP_TMemTracker.get(palTmem));
        } else {
            dramPalAddr = 0;
        }

        // Textures in Glover texbanks aren't line-padded, so it's important
        // to force this to 0 here lest some textures produce buffer overrruns
        tile.line = 0;

        const texIdx = this.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile, false);
        tile.line = old_line;
        tile.fmt = old_fmt;
        return texIdx;
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

            if (this.textures.isDynamic(this.DP_TextureImageState.addr) === true) {
                dc.dynamicTextures.add(this.DP_TextureImageState.addr);
            }
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
        dc.DP_PrimColor = colorNewCopy(this.DP_PrimColor);
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

    public gDPSetPrimColor(m: number, l: number, r: number, g: number, b: number, a: number) {
        this.DP_PrimColor.r = r / 0xFF;
        this.DP_PrimColor.g = g / 0xFF;
        this.DP_PrimColor.b = b / 0xFF;
        this.DP_PrimColor.a = a / 0xFF;
        this.stateChanged = true;
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

    public gDPSetRenderMode(c0: number, c1: number) {
        this.gDPSetOtherModeL(3, 0x1D, c0 | c1);
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

export function initializeRenderState(rspState: GloverRSPState): void {
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


export const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];


export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public SP_TextureState = new F3DEX.TextureState();
    public DP_OtherModeL: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_Combine: RDP.CombineParams;
    public DP_PrimColor: Color = colorNewFromRGBA(1,1,1,1);

    public textureIndices: number[] = [];
    public textureCache: RDP.TextureCache;

    public vertexCount: number = 0;
    public vertices: F3DEX.Vertex[] = [];

    public renderData: DrawCallRenderData | null = null;

    public dynamicGeometry: boolean = false;
    public dynamicTextures: Set<number> = new Set<number>();
    public lastTextureUpdate: number = 0;

    // TODO: delete
    // public originalUVs: number[] = [];

    public destroy(device: GfxDevice): void {
        if (this.renderData !== null) {
            this.renderData.destroy(device);
            this.renderData = null;
        }
    }
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

    constructor(private drawCall: DrawCall, private textureCache: RDP.TextureCache, private sceneLights: SceneLighting | null = null) {
        assert(drawCall.renderData !== null);
        this.reloadTextureMappings();
        this.megaStateFlags = RDP.translateRenderMode(this.drawCall.DP_OtherModeL);
        this.setBackfaceCullingEnabled(false);
        this.createProgram();
    }

    // TODO: destroy?

    public reloadTextureMappings() {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = this.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = this.drawCall.renderData!.textures[idx];
                this.textureMappings[i].gfxSampler = this.drawCall.renderData!.samplers[idx];
            }
        }
    }

    private createProgram(): void {
        const nLights = (this.sceneLights !== null) ? this.sceneLights.diffuseColor.length : 0;
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine, .5, [], nLights);
        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled && this.drawCall.textureIndices.length) {
            program.defines.set('USE_TEXTURE', '1');
        }

        const shade = (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX.RSP_Geometry.G_LIGHTING) {
            program.defines.set('LIGHTING', '1');
            if (this.sceneLights !== null) {
                program.defines.set('PARAMETERIZED_LIGHTING', '1');
            }
        }

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
        const cullMode = v ? GfxCullMode.Back : F3DEX.translateCullMode(this.drawCall.SP_GeometryMode);
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4, isSkybox: boolean = false, isBillboard: boolean = false): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.drawCall.renderData!.inputLayout, this.drawCall.renderData!.inputState);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawPrimitives(this.drawCall.vertexCount);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12*2 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (!isSkybox) {
            computeViewMatrix(DrawCallInstance.viewMatrixScratch, viewerInput.camera);
        } else {
            mat4.identity(DrawCallInstance.viewMatrixScratch);
        }

        mat4.mul(DrawCallInstance.modelViewScratch, DrawCallInstance.viewMatrixScratch, drawMatrix);
        if (isBillboard) {
            calcBillboardMatrix(DrawCallInstance.modelViewScratch, DrawCallInstance.modelViewScratch, CalcBillboardFlags.UseRollGlobal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
        }
        offs += fillMatrix4x3(mappedF32, offs, DrawCallInstance.modelViewScratch);


        this.computeTextureMatrix(DrawCallInstance.texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, DrawCallInstance.texMatrixScratch);

        this.computeTextureMatrix(DrawCallInstance.texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, DrawCallInstance.texMatrixScratch);

        const primColor = this.drawCall.DP_PrimColor;
        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillVec4(comb, offs, primColor.r, primColor.g, primColor.b, primColor.a);
        // TODO: set this properly:
        offs += fillVec4(comb, offs, 1, 1, 1, this.envAlpha);   // environment color
        renderInstManager.submitRenderInst(renderInst);
    }
}

export function f3dexFromGeometry(geo: GloverObjbank.Geometry, faceIdx: number, faceVertIdx: number, alpha: number = 1.0) : F3DEX.Vertex {
    const f3dexVertex = new F3DEX.Vertex();

    const vertIdx = (faceVertIdx === 0) ? geo.faces[faceIdx].v0 :
                            (faceVertIdx === 1) ? geo.faces[faceIdx].v1 :
                                geo.faces[faceIdx].v2;

    const geoVert = geo.vertices[vertIdx];

    f3dexVertex.x = Math.floor(geoVert.x);
    f3dexVertex.y = Math.floor(geoVert.y);
    f3dexVertex.z = Math.floor(geoVert.z);

    f3dexVertex.tx = (faceVertIdx == 0) ? geo.uvs[faceIdx].u1.raw :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].u2.raw :
                                geo.uvs[faceIdx].u3.raw;
    f3dexVertex.ty = (faceVertIdx == 0) ? geo.uvs[faceIdx].v1.raw :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].v2.raw :
                                geo.uvs[faceIdx].v3.raw;

    const colorsNorms = geo.colorsNorms[vertIdx];
    f3dexVertex.c0 = ((colorsNorms >>> 24) & 0xFF) / 0xFF;
    f3dexVertex.c1 = ((colorsNorms >>> 16) & 0xFF) / 0xFF;
    f3dexVertex.c2 = ((colorsNorms >>>  8) & 0xFF) / 0xFF;

    f3dexVertex.a = alpha;

    return f3dexVertex;
}

export function loadRspTexture(rspState: GloverRSPState, textureHolder: Textures.GloverTextureHolder, textureId: number,
    cmS: number = G_TX_WRAP | G_TX_NOMIRROR,
    cmT: number = G_TX_WRAP | G_TX_NOMIRROR,): number
{

    const texFile = textureHolder.idToTexture.get(textureId);
    const dataAddr = textureHolder.getSegmentDataAddr(textureId);
    const palAddr = textureHolder.getSegmentPaletteAddr(textureId);

    if (texFile === undefined || dataAddr === undefined || palAddr === undefined)
        throw `Texture 0x${textureId.toString(16)} not loaded`;

    const indexedImage = texFile.compressionFormat === 0 ||
                            texFile.compressionFormat === 1; 

    // Set up texture state

    // TODO: figure out how/when to set cmS/cmT

    if (indexedImage) {
        rspState.gDPSetOtherModeH(0x0E, 0x02, 0x8000); // gsDPSetTextureLUT(G_TT_RGBA16)

        rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 1, textureId);

        rspState.gDPSetTile(
            texFile.colorFormat,
            texFile.compressionFormat == 0 ? ImageSize.G_IM_SIZ_4b : ImageSize.G_IM_SIZ_8b,
            0, 0x0100, G_TX_LOADTILE, 0,
            cmT, 0, 0,
            cmS, 0, 0);

        rspState.gDPLoadTLUT(G_TX_LOADTILE, texFile.compressionFormat == 0 ? 15 : 255);

        rspState.gDPSetTextureImage(texFile.colorFormat, ImageSize.G_IM_SIZ_16b, 1, textureId);
        
        rspState.gDPSetTile(
            texFile.colorFormat,
            ImageSize.G_IM_SIZ_16b,
            0, 0x0000, G_TX_LOADTILE, 0,
            cmT, texFile.maskt, G_TX_NOLOD,
            cmS, texFile.masks, G_TX_NOLOD);


        rspState.gDPLoadBlock(G_TX_LOADTILE, 0, 0, 0, 0);

        rspState.gDPSetTile(
            texFile.colorFormat,
            texFile.compressionFormat == 0 ? ImageSize.G_IM_SIZ_4b : ImageSize.G_IM_SIZ_8b,
            0, 0x0000, G_TX_RENDERTILE, 0,
            cmT, texFile.maskt, G_TX_NOLOD,
            cmS, texFile.masks, G_TX_NOLOD)

        rspState.gDPSetTileSize(G_TX_RENDERTILE,
            0, 0,
            (texFile.width - 1) * 4, (texFile.height - 1) * 4);

        rspState.DP_TileState[G_TX_RENDERTILE].fmt = ImageFormat.G_IM_FMT_CI;
    } else {
        rspState.gDPSetOtherModeH(0x0E, 0x02, 0x0000); // gsDPSetTextureLUT(G_TT_NONE)

        const siz = texFile.compressionFormat == 2 ? ImageSize.G_IM_SIZ_16b : ImageSize.G_IM_SIZ_32b;
        rspState.gDPSetTextureImage(texFile.colorFormat, siz, 1, textureId);
        
        rspState.gDPSetTile(
            texFile.colorFormat,
            siz,
            0, 0x0000, G_TX_LOADTILE, 0,
            cmT, texFile.maskt, G_TX_NOLOD,
            cmS, texFile.masks, G_TX_NOLOD);


        rspState.gDPLoadBlock(G_TX_LOADTILE, 0, 0, 0, 0);

        rspState.gDPSetTile(
            texFile.colorFormat,
            siz,
            0, 0x0000, G_TX_RENDERTILE, 0,
            cmT, 0, G_TX_NOLOD,
            cmS, 0, G_TX_NOLOD)

        rspState.gDPSetTileSize(G_TX_RENDERTILE,
            0, 0,
            (texFile.width - 1) * 4, (texFile.height - 1) * 4);

    }

    return rspState.textureCache.translateTileTexture(rspState.segmentBuffers, dataAddr, palAddr, rspState.DP_TileState[G_TX_RENDERTILE], false);
}
