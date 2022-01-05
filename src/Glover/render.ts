import * as Viewer from '../viewer';
import * as Textures from './textures';
import * as RDP from '../Common/N64/RDP';
import * as RSP from '../Common/N64/RSP';
import * as F3DEX from '../BanjoKazooie/f3dex';
import * as Shadows from './shadows';

import * as RDPRenderModes from './rdp_render_modes';

import { assert, assertExists, align, nArray } from "../util";
import { F3DEX_Program } from "../BanjoKazooie/render";
import { mat4, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxCompareMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { ImageFormat, getImageFormatName, ImageSize, getImageSizeName, getSizBitsPerPixel } from "../Common/N64/Image";
import { DeviceProgram } from "../Program";
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { calcBillboardMatrix, CalcBillboardFlags } from '../MathHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { Color, colorNewFromRGBA, colorNewCopy, White } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";

import { GloverObjbank, GloverTexbank } from './parsers';
import { Flipbook, FlipbookType } from './framesets';

const depthScratch = vec3.create();
const lookatScratch = vec3.create();

// Stray RDP defines
const G_TX_LOADTILE = 7
const G_TX_RENDERTILE = 0
const G_TX_NOMIRROR = 0
const G_TX_WRAP = 0
const G_TX_MIRROR = 1
const G_TX_CLAMP = 2
const G_TX_NOMASK = 0
const G_TX_NOLOD = 0

export class SceneLighting {
    public diffuseColor: vec3[] = [];
    public diffuseDirection: vec3[] = [];
    public ambientColor: vec3 = vec3.fromValues(.5, .5, .5);
};

function setRenderMode(rspState: GloverRSPState, textured: boolean, xlu: boolean, zbuffer: boolean, alpha: number): void {    
    // This isn't exactly right but whatever, good enough

    const two_cycle = false;

    if (textured) {
        if (xlu) {
            // rspState.gDPSetCombineMode(G_CC_MODULATEI, G_CC_MODULATEIA);
            rspState.gDPSetCombine(0xFC127E24, 0xFF33F9FF);
        } else {
            // rspState.gDPSetCombineMode(G_CC_MODULATEIDECALA, G_CC_PASS2);
            rspState.gDPSetCombine(0xFC127FFF, 0xfffff238); 

        }
    } else {
        // rspState.gDPSetCombineLERP(TEXEL0, 0, SHADE, 0, 0, 0, 0, PRIMITIVE, TEXEL0, 0, SHADE, 0, 0, 0, 0, PRIMITIVE);// 0xFC127E24 0xFFFFF7FB;
        rspState.gDPSetCombine(0xFC127E24, 0xFFFFF7FB);
    }

    assert(0 <= alpha && alpha <= 1);
    rspState.gDPSetPrimColor(0, 0, 0x00, 0x00, 0x00, alpha * 255); // 0xFA000000, (*0x801ec878) & 0xFF);

    if (xlu) {
        if (zbuffer) {
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x005049D8
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_ZB_XLU_SURF,
                RDPRenderModes.G_RM_AA_ZB_XLU_SURF2);
        } else {
            rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB6000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x0C1841C8/0x005041C8
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_XLU_SURF,
                RDPRenderModes.G_RM_AA_XLU_SURF2);
        }
    } else if (textured) {
        if (zbuffer) {
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x0C193078/0x00553078
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_ZB_TEX_EDGE,
                RDPRenderModes.G_RM_AA_ZB_TEX_EDGE2);
        } else {
            rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB6000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x0C193048/0x00553048
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_TEX_EDGE,
                RDPRenderModes.G_RM_AA_TEX_EDGE2);
        }
    } else {
        if (zbuffer) {
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x0C192078/0x00552078
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_ZB_OPA_SURF,
                RDPRenderModes.G_RM_AA_ZB_OPA_SURF2);
        } else {
            rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB6000000 0x00000001
            rspState.gDPSetRenderMode( // 0xB900031D 0x0C192048/0x00552048
                (two_cycle) ? RDPRenderModes.G_RM_PASS : RDPRenderModes.G_RM_AA_OPA_SURF,
                RDPRenderModes.G_RM_AA_OPA_SURF2);
        }
    }
}


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
        // TODO: just patch the UVs in the old buffer, rather
        //       than making a whole new one
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

        // TODO: at one point this seemed necessary, unclear why.
        //       figure that out and remove it if it's really not:
        // tile.line = 0;

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
        this.currentDrawCall.vertices.push(
            new F3DEX.Vertex().copy(this.vertexCache[i0]),
            new F3DEX.Vertex().copy(this.vertexCache[i1]),
            new F3DEX.Vertex().copy(this.vertexCache[i2]));
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

    constructor(private drawCall: DrawCall, private drawMatrix: mat4, textureCache: RDP.TextureCache, private sceneLights: SceneLighting | null = null) {
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean = false, isBillboard: boolean = false): void {
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
            mat4.identity(DrawCallInstance.viewMatrixScratch), viewerInput.camera);
        }

        mat4.mul(DrawCallInstance.modelViewScratch, DrawCallInstance.viewMatrixScratch, this.drawMatrix);
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
        sceneLights: SceneLighting,
        public mesh: GloverObjbank.Mesh) 
    {
        if (ActorMeshNode.rendererCache.get(mesh.id) === undefined) {
            this.renderer = new GloverMeshRenderer(device, cache, segments, textures, sceneLights, mesh);
            ActorMeshNode.rendererCache.set(mesh.id, this.renderer);
        } else {
            this.renderer = ActorMeshNode.rendererCache.get(mesh.id)!;
        }

        let current_child = mesh.child;
        while (current_child !== undefined) {
            this.children.push(new ActorMeshNode(device, cache, segments, textures, sceneLights, current_child));
            current_child = current_child.sibling;
        }
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.renderer.setVertexColorsEnabled(enabled);
        for (let child of this.children) {
            child.setVertexColorsEnabled(enabled);
        }
    }

    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, parentMatrix: mat4, parentScale: vec3 = vec3.fromValues(1,1,1)) {
        const drawMatrix = mat4.clone(parentMatrix);

        // TODO: animation
        const rotation = this.mesh.rotation[0];
        const translation = this.mesh.translation[0];
        const scale = this.mesh.scale[0];
        const scaleVector = vec3.fromValues(scale.v1, scale.v2, scale.v3);

        const rotXlateMatrix = mat4.create();
        mat4.fromQuat(rotXlateMatrix, [rotation.v1, rotation.v2, rotation.v3, rotation.v4])
        rotXlateMatrix[12] = translation.v1 * parentScale[0];
        rotXlateMatrix[13] = translation.v2 * parentScale[1];
        rotXlateMatrix[14] = translation.v3 * parentScale[2];

        mat4.mul(drawMatrix, rotXlateMatrix, drawMatrix);

        for (let child of this.children) {
            child.prepareToRender(device, renderInstManager, viewerInput, drawMatrix, scaleVector);
        }
 
        mat4.scale(drawMatrix, drawMatrix, scaleVector); 

        this.renderer.prepareToRender(device, renderInstManager, viewerInput, drawMatrix);
    }

    public destroy(device: GfxDevice): void {
        if (ActorMeshNode.rendererCache.has(this.renderer.id)) {
            ActorMeshNode.rendererCache.delete(this.renderer.id);
            this.renderer.destroy(device);
        }
        for (let child of this.children) {
            child.destroy(device);
        }
    }


}

export class GloverActorRenderer implements Shadows.Collidable, Shadows.ShadowCaster {

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private inputState: GfxInputState;

    public rootMesh: ActorMeshNode;

    public visible: boolean = true;

    public sortKey: number;

    private showDebugInfo: boolean = false;

    private vec3Scratch: vec3 = vec3.create();

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number = 1;

    public modelMatrix: mat4 = mat4.create();


    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        public actorObject: GloverObjbank.ObjectRoot,
        public sceneLights: SceneLighting)
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

        this.rootMesh = new ActorMeshNode(device, cache, segments, textures, sceneLights, actorObject.mesh)

        // TODO: get scene lights out of level data

        // TODO: use render mode and actor type to identify other layers

        const layer = ((this.actorObject.mesh.renderMode & 0x2) != 0) ?
            GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer);
    }

    public getPosition(): vec3 {
        mat4.getTranslation(this.vec3Scratch, this.modelMatrix);
        return this.vec3Scratch;
    }

    public getRenderMode() {
        return this.actorObject.mesh.renderMode;
    }

    public setRenderMode(value: number, mask: number = 0xFFFFFFFF) {
        this.actorObject.mesh.renderMode &= ~mask;
        this.actorObject.mesh.renderMode |= value & mask;
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.rootMesh.setVertexColorsEnabled(enabled);        
    }

    public setDebugInfoVisible(enabled: boolean): void {
        this.showDebugInfo = enabled; 
    }

    public collides(rayOrigin: vec3, rayVector: vec3): Shadows.Collision | null {
        let closestIntersection = null;
        let closestFace = null;
        let closestIntersectionDist = Infinity;

        // TODO: iterate over child node meshes
        const geo = this.rootMesh.renderer.meshData.geometry;
        if (geo === undefined || geo.numFaces === 0) {
            return null;
        }
        for (let faceIdx = 0; faceIdx < geo.faces.length; faceIdx++) {
            const face = geo.faces[faceIdx];
            // TODO: don't reallocate every tri
            const v0 = geo.vertices[face.v0];
            const v1 = geo.vertices[face.v1];
            const v2 = geo.vertices[face.v2];
            const triangle = [
                vec3.fromValues(v0.x, v0.y, v0.z),
                vec3.fromValues(v1.x, v1.y, v1.z),
                vec3.fromValues(v2.x, v2.y, v2.z)
            ]
            vec3.transformMat4(triangle[0], triangle[0], this.modelMatrix);
            vec3.transformMat4(triangle[1], triangle[1], this.modelMatrix);
            vec3.transformMat4(triangle[2], triangle[2], this.modelMatrix);
            const intersection = Shadows.rayTriangleIntersection(rayOrigin, rayVector, triangle);
            if (intersection === null) {
                continue;
            } else {
                const dist = vec3.dist(intersection, rayOrigin);
                if (dist < closestIntersectionDist) {
                    closestIntersection = intersection;
                    closestIntersectionDist = dist;
                    closestFace = triangle;
                }
            }
        }
 
        if (closestIntersection !== null && closestFace !== null) {
            const v1 = vec3.sub(closestFace[1], closestFace[1], closestFace[0]);
            const v2 = vec3.sub(closestFace[2], closestFace[2], closestFace[0]);
            vec3.cross(closestFace[0], v1, v2);
            vec3.normalize(closestFace[0], closestFace[0]);
            return {
                position: closestIntersection
                normal: closestFace[0]
            };
        }
        return null;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.visible !== true) {
            return;
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
        mat4.getTranslation(lookatScratch, this.modelMatrix);

        template.sortKey = setSortKeyDepth(this.sortKey, vec3.distance(depthScratch, lookatScratch));

        if (this.showDebugInfo) {
            const txt = this.actorObject.mesh.name.replace(/\0/g, '') + "(0x" + this.actorObject.objId.toString(16) + ")\n" + this.actorObject.mesh.renderMode.toString(16);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, txt, 0, White, { outline: 6 });
            // TODO: remove
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, ""+vec3.distance(depthScratch, lookatScratch), 0, White, { outline: 6 });
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, this.actorObject.mesh.renderMode.toString(2), 0, White, { outline: 6 });
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, this.actorObject.mesh.name, 0, White, { outline: 6 });
        }


        if ((this.actorObject.mesh.renderMode & 0x8) == 0) {
            // TODO: make sure lighting is enabled for all children if this runs
            const n_lights = this.sceneLights.diffuseColor.length;
            const sceneParamsSize = 16 + n_lights * 8 + 4;
            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

            for (let i = 0; i < n_lights; i++) {
                offs += fillVec3v(mappedF32, offs, this.sceneLights.diffuseColor[i]);
            }
            for (let i = 0; i < n_lights; i++) {
                offs += fillVec3v(mappedF32, offs, this.sceneLights.diffuseDirection[i]);
            }
            offs += fillVec3v(mappedF32, offs, this.sceneLights.ambientColor);
        } else {
            const sceneParamsSize = 16;
            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);            
        }

        this.rootMesh.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.rootMesh.destroy(device);
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

    f3dexVertex.tx = (faceVertIdx == 0) ? geo.uvs[faceIdx].u1.raw :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].u2.raw :
                                geo.uvs[faceIdx].u3.raw
    f3dexVertex.ty = (faceVertIdx == 0) ? geo.uvs[faceIdx].v1.raw :
                            (faceVertIdx == 1) ? geo.uvs[faceIdx].v2.raw :
                                geo.uvs[faceIdx].v3.raw

    const colorsNorms = geo.colorsNorms[vertIdx];
    f3dexVertex.c0 = ((colorsNorms >>> 24) & 0xFF) / 0xFF;
    f3dexVertex.c1 = ((colorsNorms >>> 16) & 0xFF) / 0xFF;
    f3dexVertex.c2 = ((colorsNorms >>>  8) & 0xFF) / 0xFF;

    f3dexVertex.a = alpha;

    return f3dexVertex;
}

function loadRspTexture(rspState: GloverRSPState, textureHolder: Textures.GloverTextureHolder, textureId: number,
    cmS: number = G_TX_WRAP | G_TX_NOMIRROR,
    cmT: number = G_TX_WRAP | G_TX_NOMIRROR,): number
{

    const texFile = textureHolder.idToTexture.get(textureId);
    const dataAddr = textureHolder.getSegmentDataAddr(textureId);
    const palAddr = textureHolder.getSegmentPaletteAddr(textureId);
    if (texFile === undefined || dataAddr === undefined ||
        palAddr === undefined)
    {
        throw `Texture 0x${textureId.toString(16)} not loaded`;
        return 0;
    }

    const indexedImage = texFile.compressionFormat == 0 ||
                            texFile.compressionFormat == 1; 

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

class GloverMeshRenderer {
    public id: number;

    // General rendering attributes
    private rspOutput: GloverRSPOutput | null;
    private vertexColorsEnabled = true;

    // UV animation
    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;

    // TODO: remove:
    private log: string[] = [];
    private log_dumped = false;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private segments: ArrayBufferSlice[],
        private textures: Textures.GloverTextureHolder,
        private sceneLights: SceneLighting,
        public meshData: GloverObjbank.Mesh)
    {
        const buffer = meshData._io.buffer;
        const rspState = new GloverRSPState(segments, textures);
        const xlu = (this.meshData.renderMode & 0x2) != 0;
        const texturing = true;

        this.id = meshData.id;

        initializeRenderState(rspState);

        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_SHADE | F3DEX.RSP_Geometry.G_SHADING_SMOOTH);
        setRenderMode(rspState, texturing, xlu, true, 1.0);

        if ((this.meshData.renderMode & 0x8) == 0) {
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_LIGHTING);
        } else {
            rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_LIGHTING);
        }


        try {
            if (meshData.displayListPtr != 0) {
                // TODO: incorporate mesh alpha here
                const displayListOffs = meshData.displayListPtr & 0x00FFFFFF;
                rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000, 0.999985 * 0x10000);
                F3DEX.runDL_F3DEX(rspState, displayListOffs);
                this.rspOutput = rspState.finish();
            } else if (meshData.geometry.numFaces > 0) {
                rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
                this.rspOutput = this.loadDynamicModel(meshData.geometry, rspState, meshData.alpha/255);
            } else {
                this.rspOutput = null;
            }
        } catch (exc) {
            console.error(exc);
            this.rspOutput = null;
        }

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.renderData = new DrawCallRenderData(device, cache, this.rspOutput.textureCache, this.segments, drawCall);
            }
        }
    }

    private loadDynamicModel(geo: GloverObjbank.Geometry, rspState: GloverRSPState, alpha: number): GloverRSPOutput {
        const drawCalls: DrawCall[] = []
        const uniqueTextures = new Set<number>()
        for (let textureId of geo.textureIds) {
            uniqueTextures.add(textureId);
        }
        for (let textureId of uniqueTextures) {
            // Set up draw call
            const texFile = this.textures.idToTexture.get(textureId);

            if (texFile === undefined) {
                continue;
            }

            let drawCall = rspState._newDrawCall();
            drawCall.dynamicGeometry = true;
            if ((texFile.flags & 4) != 0) {
                drawCall.dynamicTextures.add(texFile.id);
            }

            drawCall.textureIndices.push(loadRspTexture(rspState, this.textures, textureId));

            for (let faceIdx = 0; faceIdx < geo.numFaces; faceIdx++) {
                if (geo.textureIds[faceIdx] != textureId) {
                    continue;
                }
                drawCall.vertices.push(
                    f3dexFromGeometry(geo, faceIdx, 0, alpha),
                    f3dexFromGeometry(geo, faceIdx, 1, alpha),
                    f3dexFromGeometry(geo, faceIdx, 2, alpha)
                );
                // TODO: delete
                // drawCall.originalUVs.push(
                //     drawCall.vertices[drawCall.vertices.length-3].tx,
                //     drawCall.vertices[drawCall.vertices.length-3].ty,
                //     drawCall.vertices[drawCall.vertices.length-2].tx,
                //     drawCall.vertices[drawCall.vertices.length-2].ty,
                //     drawCall.vertices[drawCall.vertices.length-1].tx,
                //     drawCall.vertices[drawCall.vertices.length-1].ty,
                // )
                drawCall.vertexCount += 3;
            }
            drawCalls.push(drawCall)
        }
        return new GloverRSPOutput(drawCalls, rspState.textureCache);
    }

    private animateWaterUVs(frameCount: number) {
        if (this.rspOutput === null || this.meshData.geometry.numFaces === 0) {
            return;
        }
        for (let drawCall of this.rspOutput.drawCalls) {
            if (drawCall.renderData === null) {
                continue;
            }

            let faceid = 0;
            let vtxid = 0;

            // const maxVal = 2.147484e9;
            // let uvIdx = 0;
            // assert(drawCall.originalUVs.length === drawCall.vertices.length * 2);
            for (let vertex of drawCall.vertices) {
                // let coordSum = vertex.x + vertex.z;

                // let harmonic = drawCall.originalUVs[uvIdx] + Math.sin((frameCount + coordSum) / 20.0) * 300.0;
                // vertex.tx = (harmonic < maxVal) ? harmonic : harmonic - maxVal;

                // harmonic = drawCall.originalUVs[uvIdx + 1] + Math.sin((coordSum*2 + 12*Math.PI + frameCount) / 25.0) * 300.0; // 12*PI=(double)37.699111848 from ram
                // vertex.ty = (harmonic < maxVal) ? harmonic : harmonic - maxVal;

                // uvIdx += 2;
                ///////////////////////////////////////////////////
                let coordSum = vertex.x + vertex.y + vertex.z;

                vertex.tx += Math.sin((frameCount + coordSum) / 20.0) * 8;

                // In the asm this minus is actually a + ? Audit the asm by hand maybe.
                vertex.ty += Math.sin((frameCount + Math.floor((coordSum - (coordSum < 0 ? 1 : 0)) / 2.0))/ 20.0) * 8;
                
                // vertex.tx = Math.floor(vertex.tx);
                // vertex.ty = Math.floor(vertex.ty);
                // vertex.tx = (vertex.tx > 0x7FFF) ? vertex.tx - 0xFFFF : vertex.tx;
                // vertex.ty = (vertex.ty > 0x7FFF) ? vertex.ty - 0xFFFF : vertex.ty;

                // TODO: remove:
                // if (!this.log_dumped) {
                //     this.log.push(frameCount + ",0x" + this.meshData.id.toString(16) + "," + faceid + "," + vtxid + "," + vertex.tx + "," + vertex.ty)
                //     vtxid += 1;
                //     if(vtxid==3){
                //         vtxid=0;
                //         faceid+=1;
                //     }
                // }
            }
            drawCall.renderData.updateBuffers();
        }

        // TODO: remove:
        // if (frameCount >= 500) {
        //     if (!this.log_dumped) {
        //         var data = new Blob([this.log.join("\n")], {type: 'text/plain'});

        //         // https://stackoverflow.com/questions/19327749/javascript-blob-filename-without-link
        //         var a = document.createElement("a");
        //         document.body.appendChild(a);
        //         a.setAttribute("style", "display: none");
        //         a.href = window.URL.createObjectURL(data);
        //         a.download = "data.csv";
        //         a.click();
        //         window.URL.revokeObjectURL(a.href);

        //         this.log_dumped = true;

        //     }
        // }
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.vertexColorsEnabled = enabled;        
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4): void {
        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > 50) {
            if ((this.meshData.renderMode & 0x20) !== 0) {
                this.animateWaterUVs(this.frameCount);
            }
            this.lastFrameAdvance = 0;
            this.frameCount += 1;
            this.frameCount &= 0xFFFF;
        }

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                if (drawCall.dynamicTextures.size > 0) {
                    if (drawCall.lastTextureUpdate < this.textures.lastAnimationTick) {
                        drawCall.lastTextureUpdate = viewerInput.time;
                        drawCall.renderData!.updateTextures();
                    }
                }
                // TODO: remove
                // if (this.meshData.id ==  0x52DFE077) {
                //     console.log(drawCall.vertices);
                // },
                const drawCallInstance = new DrawCallInstance(drawCall, drawMatrix, this.rspOutput.textureCache, this.sceneLights);
                if (!this.vertexColorsEnabled) {
                    drawCallInstance.setVertexColorsEnabled(false);
                }
                drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, false);
            }
        }

    }


    public destroy(device: GfxDevice): void {
        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.destroy(device);
            }
        }
    }

}

export class GloverBackdropRenderer {
    static projectionMatrix = mat4.create();

    private rspOutput: GloverRSPOutput | null;

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private inputState: GfxInputState;

    private drawMatrix = mat4.create();

    private backdropWidth: number = 0; 
    private backdropHeight: number = 0; 

    public sortKey: number;
    public textureId: number;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        private backdropObject: GloverLevel.Backdrop,
        private primitiveColor: number[])
    {
        /* Object bank in first segment, then one
           texture bank for each subsequent */
        const segments = textures.textureSegments();

        this.sortKey = backdropObject.sortKey;
        this.textureId = backdropObject.textureId;

        this.megaStateFlags = {};

        const texFile = this.textures.idToTexture.get(this.textureId);
        if (texFile === undefined) {
            throw `Texture 0x${this.textureId.toString(16)} not loaded`;
        }

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        const rspState = new GloverRSPState(segments, textures);

        initializeRenderState(rspState);
        setRenderMode(rspState, true, false, true, 1.0);

        rspState.gDPSetOtherModeH(0x14, 0x02, 0x0000); // gsDPSetCycleType(G_CYC_1CYCLE)
        rspState.gDPSetCombine(0xFC119623, 0xFF2FFFFF);
        rspState.gDPSetRenderMode(RDPRenderModes.G_RM_AA_XLU_SURF, RDPRenderModes.G_RM_AA_XLU_SURF2);
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        rspState.gDPSetPrimColor(0, 0, primitiveColor[0], primitiveColor[1], primitiveColor[2], 0xFF);

        let drawCall = rspState._newDrawCall();

        drawCall.textureIndices.push(loadRspTexture(rspState, this.textures, this.textureId, 
            G_TX_WRAP | G_TX_NOMIRROR,
            G_TX_CLAMP | G_TX_NOMIRROR
        ));

        let sX = 0;
        let sY = 0;
        let sW = texFile.width * 2;
        let sH = texFile.height;

        let ulS = 0;
        let ulT = 0;
        let lrS = sW * 32;
        let lrT = sH * 32;

        if (backdropObject.flipY != 0) {
            [ulT, lrT] = [lrT, ulT];
        } 

        sW *= backdropObject.scaleX / 1024;
        sH *= backdropObject.scaleY / 1024;

        const spriteCoords = [
            [sX, sY, ulS, ulT],
            [sX, sY + sH, ulS, lrT],
            [sX + sW, sY + sH, lrS, lrT],

            [sX, sY, ulS, ulT],
            [sX + sW, sY, lrS, ulT],
            [sX + sW, sY + sH,  lrS, lrT],
        ];

        for (let coords of spriteCoords) {
            const v = new F3DEX.Vertex();
            v.x = coords[0];
            v.y = coords[1];
            v.z = 0;
            v.tx = coords[2];
            v.ty = coords[3];
            v.c0 = 0xFF;
            v.c1 = 0xFF;
            v.c2 = 0xFF;
            v.a = 0xFF;
            drawCall.vertexCount += 1;
            drawCall.vertices.push(v)
        }

        drawCall.renderData = new DrawCallRenderData(device, cache, rspState.textureCache, rspState.segmentBuffers, drawCall);
        this.rspOutput = new GloverRSPOutput([drawCall], rspState.textureCache);

        this.backdropWidth = sW;
        this.backdropHeight = sH;

    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        const sceneParamsSize = 16;
        const view = viewerInput.camera.viewMatrix;
        const aspect = viewerInput.backbufferWidth / viewerInput.backbufferHeight;
        const yaw = Math.atan2(-view[2], view[0]) / (Math.PI * 2);
        const pitch = Math.asin(view[6]) / (Math.PI * 2);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);

        mat4.ortho(GloverBackdropRenderer.projectionMatrix, 0, 640, 640 / aspect, 0, -1, 1);
        offs += fillMatrix4x4(mappedF32, offs, GloverBackdropRenderer.projectionMatrix);

        mat4.fromTranslation(this.drawMatrix, [
            -(yaw + 0.5) * this.backdropObject.scrollSpeedX * this.backdropWidth / 2,
            Math.min(((-Math.sin(pitch*2*Math.PI)*500 + this.backdropObject.offsetY)/2) + (136/(this.backdropObject.scaleY/1024)), 0),
            0
        ]);

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                const drawCallInstance = new DrawCallInstance(drawCall, this.drawMatrix, this.rspOutput.textureCache);
                drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, true);
            }
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.destroy(device);
            }
        }
    }
}

export class GloverFlipbookRenderer implements Shadows.ShadowCaster{
    private rspOutput: GloverRSPOutput | null;

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private inputState: GfxInputState;

    public drawMatrix: mat4 = mat4.create();

    private frameDelay: number;
    private lastFrameAdvance: number = 0;
    private frameCounter: number = 0;
    public curFrame: number;

    private frames: number[] = [];

    private sortKey: number;

    public visible: boolean = true;
    
    public isGarib: boolean = false;

    public loop: boolean = true;

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number = 8;

    public playing: boolean = true;

    private vec3Scratch: vec3 = vec3.create();

    protected isBillboard: boolean = true;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        flipbookMetadata: Flipbook,
        startFrame: number = 0,
        private primColor: vec4 = [0, 0, 0, 255])
    {
        // TODO: move startFrame randomization into here
        this.curFrame = startFrame;

        const layer = GfxRendererLayer.TRANSLUCENT + 1; // TODO: this isn't right
        this.sortKey = makeSortKey(layer);

        this.megaStateFlags = {};

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        this.reloadFrameset(flipbookMetadata)
    }

    public getPosition(): vec3 {
        mat4.getTranslation(this.vec3Scratch, this.drawMatrix);
        return this.vec3Scratch;
    }

    protected initializePipeline(rspState: GloverRSPState) {
        initializeRenderState(rspState);
        setRenderMode(rspState, true, true, true, this.primColor[3]/255);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001

        if (this.primColor[3] !== 255) {
            rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM
        } else {
            rspState.gDPSetCombine(0xFC127FFF, 0xfffff238); // G_CC_MODULATEIDECALA, G_CC_PASS2
        }

        rspState.gDPSetPrimColor(0, 0, this.primColor[0], this.primColor[1], this.primColor[2], this.primColor[3]);
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
    }

    public reloadFrameset(flipbookMetadata: Flipbook): void {
        /* Object bank in first segment, then one
           texture bank for each subsequent */
        const segments = this.textures.textureSegments();

        // TODO: dispose of old render data, if it exists

        this.playing = true;

        this.curFrame = this.curFrame % flipbookMetadata.frameset.length;
        this.frameDelay = flipbookMetadata.frameDelay;
        this.frameCounter = this.frameDelay;

        if (flipbookMetadata.type == FlipbookType.Oneshot) {
            this.loop = false;
        } else {
            this.loop = true;
        }

        let frame_textures = []
        for (let frame_id of flipbookMetadata.frameset) {
            const texFile = this.textures.idToTexture.get(frame_id);
            if (texFile === undefined) {
                throw `Texture 0x${frame_id.toString(16)} not loaded`;
            }
            frame_textures.push(texFile);
        }

        const rspState = new GloverRSPState(segments, this.textures);

        this.initializePipeline(rspState);

        let drawCall = rspState._newDrawCall();

        this.frames = []
        for (let texture of frame_textures) {
            this.frames.push(loadRspTexture(rspState, this.textures, texture.id, 
                G_TX_CLAMP | G_TX_NOMIRROR,
                G_TX_CLAMP | G_TX_NOMIRROR
            ))
        }

        drawCall.textureIndices.push(this.frames[this.curFrame]);

        let sW = flipbookMetadata.startSize / 3;
        let sH = flipbookMetadata.startSize / 3;
        let sX = -sW/2;
        let sY = -sH/2;

        let ulS = 0;
        let ulT = 0;
        let lrS = frame_textures[0].width * 32;
        let lrT = frame_textures[0].height * 32;

        const spriteCoords = [
            [sX, sY, ulS, lrT],
            [sX, sY + sH, ulS, ulT],
            [sX + sW, sY + sH, lrS, ulT],

            [sX, sY, ulS, lrT],
            [sX + sW, sY, lrS, lrT],
            [sX + sW, sY + sH,  lrS, ulT],
        ];

        for (let coords of spriteCoords) {
            const v = new F3DEX.Vertex();
            v.x = coords[0];
            v.y = coords[1];
            v.z = 0;
            v.tx = coords[2];
            v.ty = coords[3];
            v.c0 = 0xFF;
            v.c1 = 0xFF;
            v.c2 = 0xFF;
            v.a = 0xFF;
            drawCall.vertexCount += 1;
            drawCall.vertices.push(v)
        }

        drawCall.renderData = new DrawCallRenderData(this.device, this.cache, rspState.textureCache, rspState.segmentBuffers, drawCall);
        this.rspOutput = new GloverRSPOutput([drawCall], rspState.textureCache);
    }

    public reset() {
        this.playing = true;
        this.frameCounter = this.frameDelay;
        this.curFrame = 0;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.visible !== true) {
            return;
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
        mat4.getTranslation(lookatScratch, this.drawMatrix);

        template.sortKey = setSortKeyDepth(this.sortKey, vec3.distance(depthScratch, lookatScratch));

        const sceneParamsSize = 16;

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);


        if (this.frames.length > 1 && this.frameDelay >= 0) {
            this.lastFrameAdvance += viewerInput.deltaTime;
            if (this.lastFrameAdvance > 50) {
                this.lastFrameAdvance = 0;

                if (this.frameCounter > 0) {
                    this.frameCounter -= 0x20;
                } else {
                    this.frameCounter += this.frameDelay;
                    this.curFrame += 1;

                    // TODO: tweens:
                    // if (startAlpha != endAlpha) {
                    //   if (tweenLength == 0) {
                    //     iVar4 = (endAlpha - startAlpha) *
                    //             (((*frameset)->n_frames - b->flipbookFrame) + -1);
                    //     uVar7 = (*frameset)->n_frames - 1;
                    //   }
                    //   else {
                    //     iVar4 = (endAlpha - startAlpha) * b->tweenFrame;
                    //     uVar7 = tweenLength;
                    //   }
                    //   (b->color).a = startAlpha + (iVar4 / uVar7);
                    // }
                    // if (startSize != endSize) {
                    //   uVar7 = (uint)b->tweenLength;
                    //   if (uVar7 == 0) {
                    //     iVar4 = (uVar3 - uVar2) *
                    //             (((*frameset)->n_frames - b->flipbookFrame) + -1);
                    //     uVar7 = (*frameset)->n_frames - 1;
                    //   }
                    //   else {
                    //     iVar4 = (uVar3 - uVar2) * b->tweenFrame;
                    //   }
                    //   sVar6 = uVar2 + (iVar4 / uVar7);
                    //   b->height = sVar6;
                    //   b->width = sVar6;
                    // }

                    if (this.curFrame >= this.frames.length) {
                        if (this.loop) {
                            this.curFrame = 0;
                            this.playing = true;
                        } else {
                            this.curFrame = this.frames.length - 1;
                            this.playing = false;
                        }
                    }
                }
            }
        }

        if (this.rspOutput !== null) {
            this.rspOutput.drawCalls[0].textureIndices[0] = this.frames[this.curFrame];

            for (let drawCall of this.rspOutput.drawCalls) {
                const drawCallInstance = new DrawCallInstance(drawCall, this.drawMatrix, this.rspOutput.textureCache);
                drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, false, this.isBillboard);
            }
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.destroy(device);
            }
        }
    }
}


export class GloverShadowRenderer extends GloverFlipbookRenderer {
    protected isBillboard: boolean = false;

    protected initializePipeline(rspState: GloverRSPState) {
        initializeRenderState(rspState);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001        
        rspState.gDPSetRenderMode(RDPRenderModes.G_RM_ZB_CLD_SURF, RDPRenderModes.G_RM_ZB_CLD_SURF2); // 0xb900031d 0x00504b50
        rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        rspState.gDPSetPrimColor(0, 0, 0, 0, 0, 0xFF); // TODO: paramaterize this
    }
    
    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder)
    {
        super(device, cache, textures, {
            frameset: [0x147b7297],
            frameDelay: 0,
            type: 1,
            startAlpha: 0xFF,
            endAlpha: 0xFF,
            startSize: 1,
            endSize: 1,
            flags: 0
        }, 0);
    }

}
