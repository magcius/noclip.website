import { vec4 } from "gl-matrix";
import * as RDP from "../Common/N64/RDP.js";

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { nArray, assert, hexzero } from "../util.js";
import {
    ImageFormat,
    getImageFormatName,
    ImageSize,
    getImageSizeName,
    getSizBitsPerPixel,
} from "../Common/N64/Image.js";
import { GfxCullMode } from "../gfx/platform/GfxPlatform.js";
import { loadVertexFromView } from "../Common/N64/RSP.js";

// Interpreter for N64 F3DEX microcode.

/**
 * RSP texture state tracking whether texturing is enabled and
 * tile parameters.
 */
export class TextureState {
    /** Whether texturing is enabled. */
    public on = false;
    /** Active tile index. */
    public tile = 0;
    /** Mipmap level. */
    public level = 0;
    /** S-axis texture coordinate scale. */
    public s = 0;
    /** T-axis texture coordinate scale. */
    public t = 0;

    /**
     * Set all texture state fields at once.
     * @param {boolean} on Whether texturing is enabled.
     * @param {number} tile Active tile index.
     * @param {number} level Mipmap level.
     * @param {number} s S-axis scale.
     * @param {number} t T-axis scale.
     */
    public set(on: boolean, tile: number, level: number, s: number, t: number): void {
        this.on = on;
        this.tile = tile;
        this.level = level;
        this.s = s;
        this.t = t;
    }

    /**
     * Copy all fields from another TextureState.
     * @param {TextureState} o Source state.
     */
    public copy(o: TextureState): void {
        this.set(o.on, o.tile, o.level, o.s, o.t);
    }
}

/** RDP texture image state set by G_SETTIMG. */
export class TextureImageState {
    /** Image format (G_IM_FMT). */
    public fmt = 0;
    /** Image size (G_IM_SIZ). */
    public siz = 0;
    /** Image width in pixels. */
    public w = 0;
    /** DRAM address of the texture image. */
    public addr = 0;

    /**
     * Set all texture image state fields at once.
     * @param {number} fmt Image format.
     * @param {number} siz Image size.
     * @param {number} w Width in pixels.
     * @param {number} addr DRAM address.
     */
    public set(fmt: number, siz: number, w: number, addr: number): void {
        this.fmt = fmt;
        this.siz = siz;
        this.w = w;
        this.addr = addr;
    }
}

/**
 * N64 RSP vertex with position, texture coordinates, colour/normal,
 * and alpha.
 */
export class Vertex {
    /** X position. */
    public x = 0;
    /** Y position. */
    public y = 0;
    /** Z position. */
    public z = 0;
    /** Texture S coordinate. */
    public tx = 0;
    /** Texture T coordinate. */
    public ty = 0;
    /** Colour or normal component 0. */
    public c0 = 0;
    /** Colour or normal component 1. */
    public c1 = 0;
    /** Colour or normal component 2. */
    public c2 = 0;
    /** Alpha component. */
    public a = 0;
    /** Matrix stack index for vertex transformation. */
    public matrixIndex = 0;

    /**
     * Copy all fields from another vertex.
     * @param {Vertex} v Source vertex.
     */
    public copy(v: Vertex): void {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        this.matrixIndex = v.matrixIndex;
        this.tx = v.tx;
        this.ty = v.ty;
        this.c0 = v.c0;
        this.c1 = v.c1;
        this.c2 = v.c2;
        this.a = v.a;
    }
}

/** Vertex used during display list interpretation before output deduplication. */
export class StagingVertex extends Vertex {
    /** Index into the shared output vertex array, or -1 if not yet committed. */
    public outputIndex = -1;

    /**
     * Loads vertex data from a DataView at the given byte offset.
     * @param {DataView} view Source data view.
     * @param {number} offs Byte offset into the view.
     */
    public setFromView(view: DataView, offs: number): void {
        this.outputIndex = -1;
        loadVertexFromView(this, view, offs);
    }
}

/**
 * Returns a human-readable string combining image format and size names.
 * @param {ImageFormat} fmt Image format.
 * @param {ImageSize} siz Image size.
 * @returns {string} Combined format and size name.
 */
export function getImageFormatString(fmt: ImageFormat, siz: ImageSize): string {
    return `${getImageFormatName(fmt)}${getImageSizeName(siz)}`;
}

/** Single draw call with a single pipeline state. */
export class DrawCall {
    /** RSP geometry mode flags for this draw call. */
    public SP_GeometryMode = 0;
    /** Texture state snapshot for this draw call. */
    public SP_TextureState = new TextureState();
    /** RDP OtherModeL register value. */
    public DP_OtherModeL = 0;
    /** RDP OtherModeH register value. */
    public DP_OtherModeH = 0;
    /** RDP colour combiner parameters. */
    public DP_Combine: RDP.CombineParams;
    /** Primitive colour set by G_SETPRIMCOLOR. */
    public DP_PrimColor = vec4.fromValues(1, 1, 1, 1);
    /** Environment colour set by G_SETENVCOLOR. */
    public DP_EnvColor = vec4.fromValues(1, 1, 1, 1);

    /** Indices into the texture cache for this draw call. */
    public textureIndices: number[] = [];

    /** Starting index in the shared index buffer. */
    public firstIndex = 0;
    /** Number of indices in this draw call. */
    public indexCount = 0;
}

/** Shared output buffers for vertices, indices, and textures across draw calls. */
export class RSPSharedOutput {
    /** Cache of decoded textures referenced by draw calls. */
    public textureCache = new RDP.TextureCache();
    /** All output vertices. */
    public vertices: Vertex[] = [];
    /** Triangle index buffer referencing vertices. */
    public indices: number[] = [];

    /**
     * Loads all vertices from a contiguous vertex data buffer.
     * @param {DataView} vertexData Source vertex data.
     */
    public setVertexBufferFromData(vertexData: DataView): void {
        const scratchVertex = new StagingVertex();

        // Ensure we don't read past the end (each vertex is 0x10 bytes).
        const end = vertexData.byteLength - 0x0f;
        for (let offs = 0; offs < end; offs += 0x10) {
            scratchVertex.setFromView(vertexData, offs);
            this.loadVertex(scratchVertex);
        }
    }

    /**
     * Commits a staging vertex to the output array if not already
     * committed.
     * @param {StagingVertex} v Staging vertex to commit.
     */
    public loadVertex(v: StagingVertex): void {
        if (v.outputIndex === -1) {
            const n = new Vertex();
            n.copy(v);
            this.vertices.push(n);
            v.outputIndex = this.vertices.length - 1;
        }
    }
}

/** Collects draw calls produced during display list interpretation. */
export class RSPOutput {
    /** All completed draw calls. */
    public drawCalls: DrawCall[] = [];

    /** The draw call currently being built. */
    public currentDrawCall = new DrawCall();

    /**
     * Creates a new draw call starting at the given index offset.
     * @param {number} firstIndex Starting index in the shared buffer.
     * @returns {DrawCall} The newly created draw call.
     */
    public newDrawCall(firstIndex: number): DrawCall {
        this.currentDrawCall = new DrawCall();
        this.currentDrawCall.firstIndex = firstIndex;
        this.drawCalls.push(this.currentDrawCall);
        return this.currentDrawCall;
    }
}

/** RSP geometry mode bit flags. */
export enum RSP_Geometry {
    /** Z-buffer enable. */
    G_ZBUFFER = 1 << 0,
    /** Shade enable. */
    G_SHADE = 1 << 2,
    /** Smooth (Gouraud) shading. */
    G_SHADING_SMOOTH = 1 << 9,
    /** Cull front-facing triangles. */
    G_CULL_FRONT = 1 << 12,
    /** Cull back-facing triangles. */
    G_CULL_BACK = 1 << 13,
    /** Fog enable. */
    G_FOG = 1 << 16,
    /** Lighting enable. */
    G_LIGHTING = 1 << 17,
    /** Texture coordinate generation. */
    G_TEXTURE_GEN = 1 << 18,
    /** Linear texture coordinate generation. */
    G_TEXTURE_GEN_LINEAR = 1 << 19,
    /** Clipping enable. */
    G_CLIPPING = 1 << 23,
}

/** Byte offsets within a vertex for G_MODIFYVTX. */
export enum MODIFYVTX_Locations {
    /** RGBA colour offset. */
    G_MWO_POINT_RGBA = 0x10,
    /** ST texture coordinate offset. */
    G_MWO_POINT_ST = 0x14,
    /** XY screen coordinate offset. */
    G_MWO_POINT_XYSCREEN = 0x18,
    /** Z screen coordinate offset. */
    G_MWO_POINT_ZSCREEN = 0x1c,
}

/**
 * Translates RSP geometry mode cull flags to a GfxCullMode value.
 * @param {number} m Geometry mode flags.
 * @returns {GfxCullMode} Translated cull mode.
 */
export function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & RSP_Geometry.G_CULL_FRONT);
    const cullBack = !!(m & RSP_Geometry.G_CULL_BACK);
    if (cullFront && cullBack) {
        throw new Error("whoops");
    } else if (cullFront) {
        return GfxCullMode.Front;
    } else if (cullBack) {
        return GfxCullMode.Back;
    } else {
        return GfxCullMode.None;
    }
}

/** Interface for RSP state machines that can interpret F3DEX display list commands. */
export interface RSPStateInterface {
    /** Segment address to buffer mappings. */
    segmentBuffers: ArrayBufferSlice[];

    /**
     * Finalizes interpretation and returns the output.
     * @returns {any} Interpretation output.
     */
    finish: () => unknown;
    /**
     * Enables the given geometry mode bits.
     * @param {number} mask Bits to set.
     */
    gSPSetGeometryMode: (mask: number) => void;
    /**
     * Clears the given geometry mode bits.
     * @param {number} mask Bits to clear.
     */
    gSPClearGeometryMode: (mask: number) => void;
    /**
     * Resets the matrix stack depth to the given value.
     * @param {number} value New stack depth.
     */
    gSPResetMatrixStackDepth: (value: number) => void;
    /**
     * Sets the texture state for subsequent triangles.
     * @param {boolean} on Whether texturing is enabled.
     * @param {number} tile Active tile index.
     * @param {number} level Mipmap level.
     * @param {number} s S-axis scale.
     * @param {number} t T-axis scale.
     */
    gSPTexture: (on: boolean, tile: number, level: number, s: number, t: number) => void;
    /**
     * Loads vertices from DRAM into the vertex cache.
     * @param {number} dramAddr DRAM address of vertex data.
     * @param {number} n Number of vertices to load.
     * @param {number} v0 Starting vertex cache index.
     */
    gSPVertex: (dramAddr: number, n: number, v0: number) => void;
    /**
     * Modifies a field of a cached vertex in-place.
     * @param {number} vtx Vertex cache index.
     * @param {number} where Field byte offset.
     * @param {number} val New value.
     */
    gSPModifyVertex: (vtx: number, where: number, val: number) => void;
    /**
     * Emits a single triangle from three vertex cache indices.
     * @param {number} i0 First vertex index.
     * @param {number} i1 Second vertex index.
     * @param {number} i2 Third vertex index.
     */
    gSPTri: (i0: number, i1: number, i2: number) => void;
    /**
     * Sets the texture image source for subsequent load commands.
     * @param {number} fmt Image format.
     * @param {number} siz Image size.
     * @param {number} w Width in pixels.
     * @param {number} addr DRAM address.
     */
    gDPSetTextureImage: (fmt: number, siz: number, w: number, addr: number) => void;
    /**
     * Configures a tile descriptor in the RDP tile table.
     * @param {number} fmt Image format.
     * @param {number} siz Image size.
     * @param {number} line Words per row.
     * @param {number} tmem TMEM offset.
     * @param {number} tile Tile index.
     * @param {number} palette Palette index.
     * @param {number} cmt T-axis clamp/mirror/wrap.
     * @param {number} maskt T-axis mask.
     * @param {number} shiftt T-axis shift.
     * @param {number} cms S-axis clamp/mirror/wrap.
     * @param {number} masks S-axis mask.
     * @param {number} shifts S-axis shift.
     */
    gDPSetTile: (
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
    ) => void;
    /**
     * Loads a TLUT (palette) into TMEM.
     * @param {number} tile Tile index.
     * @param {number} count Number of palette entries.
     */
    gDPLoadTLUT: (tile: number, count: number) => void;
    /**
     * Loads a contiguous block of texture data into TMEM.
     * @param {number} tileIndex Tile index.
     * @param {number} uls Upper-left S coordinate.
     * @param {number} ult Upper-left T coordinate.
     * @param {number} lrs Lower-right S coordinate.
     * @param {number} dxt DXT value.
     */
    gDPLoadBlock: (tileIndex: number, uls: number, ult: number, lrs: number, dxt: number) => void;
    /**
     * Sets the tile size (texture coordinate clamp/wrap bounds).
     * @param {number} tile Tile index.
     * @param {number} uls Upper-left S coordinate.
     * @param {number} ult Upper-left T coordinate.
     * @param {number} lrs Lower-right S coordinate.
     * @param {number} lrt Lower-right T coordinate.
     */
    gDPSetTileSize: (tile: number, uls: number, ult: number, lrs: number, lrt: number) => void;
    /**
     * Sets bits in the RDP OtherModeL register.
     * @param {number} sft Bit shift.
     * @param {number} len Bit length.
     * @param {number} w1 Value.
     */
    gDPSetOtherModeL: (sft: number, len: number, w1: number) => void;
    /**
     * Sets bits in the RDP OtherModeH register.
     * @param {number} sft Bit shift.
     * @param {number} len Bit length.
     * @param {number} w1 Value.
     */
    gDPSetOtherModeH: (sft: number, len: number, w1: number) => void;
    /**
     * Sets the RDP color combiner parameters.
     * @param {number} w0 High word.
     * @param {number} w1 Low word.
     */
    gDPSetCombine: (w0: number, w1: number) => void;
    /**
     * Handles G_MOVEMEM commands (optional).
     * @param {number} w0 High word.
     * @param {number} w1 Low word.
     */
    gMoveMem?: (w0: number, w1: number) => void;
    /**
     * Sets the primitive colour (optional).
     * @param {number} lod LOD fraction.
     * @param {number} r Red (0-255).
     * @param {number} g Green (0-255).
     * @param {number} b Blue (0-255).
     * @param {number} a Alpha (0-255).
     */
    gSPSetPrimColor?: (lod: number, r: number, g: number, b: number, a: number) => void;
    /**
     * Sets the environment colour (optional).
     * @param {number} r Red (0-255).
     * @param {number} g Green (0-255).
     * @param {number} b Blue (0-255).
     * @param {number} a Alpha (0-255).
     */
    gSPSetEnvColor?: (r: number, g: number, b: number, a: number) => void;
}

/** Default RSP state machine that interprets F3DEX commands into draw calls. */
export class RSPState implements RSPStateInterface {
    /**
     * When true, gSPVertex loads vertex data from segment buffers on-demand
     * instead of assuming vertices are preloaded.
     */
    public loadVerticesOnDemand = false;

    private readonly output = new RSPOutput();

    private stateChanged = false;
    private vertexCache = nArray(64, () => 0);

    private SP_GeometryMode = 0;
    private readonly SP_TextureState = new TextureState();
    private SP_MatrixStackDepth = 0;

    private DP_OtherModeL = 0;
    private DP_OtherModeH = 0;
    private DP_CombineL = 0;
    private DP_CombineH = 0;
    private readonly DP_TextureImageState = new TextureImageState();
    private readonly DP_TileState = nArray(8, () => new RDP.TileState());
    private readonly DP_TMemTracker: Map<number, number> = new Map();
    private readonly DP_PrimColor = vec4.fromValues(1, 1, 1, 1);
    private readonly DP_EnvColor = vec4.fromValues(1, 1, 1, 1);

    /**
     * Creates an RSP state with the given segment buffers and
     * shared output.
     * @param {ArrayBufferSlice[]} segmentBuffers Segment buffers.
     * @param {RSPSharedOutput} sharedOutput Shared output state.
     */
    public constructor(
        public segmentBuffers: ArrayBufferSlice[],
        public sharedOutput: RSPSharedOutput,
    ) {}

    /**
     * Finalizes interpretation and returns the RSPOutput, or null
     * if empty.
     * @returns {(RSPOutput|null)} Output or null if no draw calls.
     */
    public finish(): RSPOutput | null {
        if (this.output.drawCalls.length === 0) {
            return null;
        }
        return this.output;
    }

    /** @inheritdoc */
    public gSPSetGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode | mask);
    }

    /** @inheritdoc */
    public gSPClearGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode & ~mask);
    }

    /** @inheritdoc */
    public gSPResetMatrixStackDepth(value: number): void {
        this.SP_MatrixStackDepth = value;
    }

    /** @inheritdoc */
    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        // This is the texture we're using to rasterize triangles going forward.
        this.SP_TextureState.set(on, tile, level, s / 0x10000, t / 0x10000);
        this.stateChanged = true;
    }

    /** @inheritdoc */
    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        const addrIdx = dramAddr & 0x00ffffff;
        const baseIndex = (addrIdx / 0x10) >>> 0;

        if (this.loadVerticesOnDemand) {
            // Load vertex data directly from the segment buffer on-demand.
            // This is needed when the vertex buffer contains mixed
            // data (DLs, textures, etc.).
            const segBuffer = this.segmentBuffers[(dramAddr >>> 24) & 0xff];
            const view = segBuffer.createDataView();
            const scratchVertex = new StagingVertex();
            for (let i = 0; i < n; i++) {
                const offs = addrIdx + i * 0x10;
                if (offs + 0x10 <= view.byteLength) {
                    scratchVertex.setFromView(view, offs);
                    // Ensure vertex slot exists (expand array if needed).
                    while (this.sharedOutput.vertices.length <= baseIndex + i) {
                        this.sharedOutput.vertices.push(new Vertex());
                    }
                    const vtx = this.sharedOutput.vertices[baseIndex + i];
                    vtx.copy(scratchVertex);
                    vtx.matrixIndex = this.SP_MatrixStackDepth;
                }
                this.vertexCache[v0 + i] = baseIndex + i;
            }
        } else {
            // Preloaded mode: vertices already in sharedOutput.vertices.
            for (let i = 0; i < n; i++) {
                const vertexIndex = baseIndex + i;
                this.vertexCache[v0 + i] = vertexIndex;
                this.sharedOutput.vertices[vertexIndex].matrixIndex = this.SP_MatrixStackDepth;
            }
        }
    }

    /** @inheritdoc */
    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    public gSPModifyVertex(_vtx: number, _where: number, _val: number): void {
        console.error(
            "gSPModifyVertex() is not supported by this RSPStateInterface implementation",
        );
    }

    /** @inheritdoc */
    public gSPTri(i0: number, i1: number, i2: number): void {
        this.flushDrawCall();

        this.sharedOutput.indices.push(
            this.vertexCache[i0],
            this.vertexCache[i1],
            this.vertexCache[i2],
        );
        this.output.currentDrawCall.indexCount += 3;
    }

    /** @inheritdoc */
    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    /** @inheritdoc */
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
        this.DP_TileState[tile].set(
            fmt,
            siz,
            line,
            tmem,
            palette,
            cmt,
            maskt,
            shiftt,
            cms,
            masks,
            shifts,
        );
        this.stateChanged = true;
    }

    /** @inheritdoc */
    public gDPLoadTLUT(tile: number, _count: number): void {
        // Track the TMEM destination back to the originating DRAM address.
        const tmemDst = this.DP_TileState[tile].tmem;
        this.DP_TMemTracker.set(tmemDst, this.DP_TextureImageState.addr);
    }

    /** @inheritdoc */
    public gDPLoadBlock(
        tileIndex: number,
        uls: number,
        ult: number,
        lrs: number,
        dxt: number,
    ): void {
        // First, verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);

        const tile = this.DP_TileState[tileIndex];

        if (dxt !== 0) {
            // Compute the texture size from lrs/dxt. This is
            // required for mipmapping to work correctly in B-K
            // due to hackery.
            const numWordsTotal = lrs + 1;
            const numWordsInLine = (1 << 11) / dxt;
            const numPixelsInLine = (numWordsInLine * 8 * 8) / getSizBitsPerPixel(tile.siz);
            tile.lrs = (numPixelsInLine - 1) << 2;
            tile.lrt = (numWordsTotal / numWordsInLine / 4 - 1) << 2;
        }
        // When DXT=0, tile dimensions come from SETTILESIZE, not LOADBLOCK.

        // Track the TMEM destination back to the originating DRAM address.
        this.DP_TMemTracker.set(tile.tmem, this.DP_TextureImageState.addr);
        this.stateChanged = true;
    }

    /** @inheritdoc */
    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
    }

    /** @inheritdoc */
    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
        if (DP_OtherModeL !== this.DP_OtherModeL) {
            this.DP_OtherModeL = DP_OtherModeL;
            this.stateChanged = true;
        }
    }

    /** @inheritdoc */
    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
        if (DP_OtherModeH !== this.DP_OtherModeH) {
            this.DP_OtherModeH = DP_OtherModeH;
            this.stateChanged = true;
        }
    }

    /** @inheritdoc */
    public gDPSetCombine(w0: number, w1: number): void {
        if (this.DP_CombineH !== w0 || this.DP_CombineL !== w1) {
            this.DP_CombineH = w0;
            this.DP_CombineL = w1;
            this.stateChanged = true;
        }
    }

    /** @inheritdoc */
    public gSPSetPrimColor(lod: number, r: number, g: number, b: number, a: number): void {
        vec4.set(this.DP_PrimColor, r / 0xff, g / 0xff, b / 0xff, a / 0xff);
        this.stateChanged = true;
    }

    /** @inheritdoc */
    public gSPSetEnvColor(r: number, g: number, b: number, a: number): void {
        vec4.set(this.DP_EnvColor, r / 0xff, g / 0xff, b / 0xff, a / 0xff);
        this.stateChanged = true;
    }

    private _setGeometryMode(newGeometryMode: number): void {
        if (this.SP_GeometryMode === newGeometryMode) {
            return;
        }
        this.stateChanged = true;
        this.SP_GeometryMode = newGeometryMode;
    }

    private _lookupTMEM(tmem: number): number | undefined {
        // Exact match first.
        const exact = this.DP_TMemTracker.get(tmem);
        if (exact !== undefined) {
            return exact;
        }

        // If not found, find the nearest lower TMEM entry.
        // G_LOADBLOCK loads a contiguous region starting at a base TMEM offset.
        // Render tiles may reference sub-regions at higher TMEM offsets within
        // the same loaded block. The DRAM address offset = (tmem_diff * 8) bytes
        // since each TMEM word is 8 bytes (64 bits).
        let bestTmem = -1;
        let bestAddr: number | undefined = undefined;
        for (const [trackedTmem, addr] of this.DP_TMemTracker) {
            if (trackedTmem <= tmem && trackedTmem > bestTmem) {
                bestTmem = trackedTmem;
                bestAddr = addr;
            }
        }
        if (bestAddr !== undefined && bestTmem >= 0) {
            return bestAddr + (tmem - bestTmem) * 8;
        }
        return bestAddr;
    }

    private translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex];

        const dramAddr = this._lookupTMEM(tile.tmem);
        if (dramAddr === undefined) {
            return -1; // TMEM not loaded for this tile.
        }

        let dramPalAddr = 0;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
            const palTmem = 0x100 + (tile.palette << 4);
            const palAddr = this._lookupTMEM(palTmem);
            dramPalAddr = palAddr ?? 0;
        }

        // TGR texture data requires TMEM deinterleaving for correct decode.
        return this.sharedOutput.textureCache.translateTileTexture(
            this.segmentBuffers,
            dramAddr,
            dramPalAddr,
            tile,
            true,
        );
    }

    private flushTextures(dc: DrawCall): void {
        // If textures are not on, then we have no textures.
        if (!this.SP_TextureState.on) {
            return;
        }

        const lod_en = !!((this.DP_OtherModeH >>> 16) & 0x01);
        if (lod_en) {
            // TODO(jstpierre): Support mip-mapping.
            assert(false);
        } else {
            // We're in TILE mode. Now check if we're in two-cycle mode.
            const cycletype = RDP.getCycleTypeFromOtherModeH(this.DP_OtherModeH);
            assert(
                cycletype === RDP.OtherModeH_CycleType.G_CYC_1CYCLE ||
                    cycletype === RDP.OtherModeH_CycleType.G_CYC_2CYCLE,
            );

            const tex0 = this.translateTileTexture(this.SP_TextureState.tile);
            if (tex0 >= 0) {
                dc.textureIndices.push(tex0);
            }

            if (this.SP_TextureState.level === 0 && RDP.combineParamsUsesT1(dc.DP_Combine)) {
                const tex1 = this.translateTileTexture(this.SP_TextureState.tile + 1);
                if (tex1 >= 0) {
                    dc.textureIndices.push(tex1);
                }
            }
        }
    }

    private flushDrawCall(): void {
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
            this.flushTextures(dc);
        }
    }
}

/**
 * F3DEX microcode GBI (Graphics Binary Interface) command opcodes.
 */
export enum F3DEX_GBI {
    // DMA commands.
    /** Load matrix. */
    G_MTX = 0x01,
    /** Move memory. */
    G_MOVEMEM = 0x03,
    /** Load vertices. */
    G_VTX = 0x04,
    /** Branch to display list. */
    G_DL = 0x06,

    // Immediate commands.
    /** Single triangle. */
    G_TRI1 = 0xbf,
    /** Cull display list. */
    G_CULLDL = 0xbe,
    /** Pop matrix stack. */
    G_POPMTX = 0xbd,
    /** Move word. */
    G_MOVEWORD = 0xbc,
    /** Set texture parameters. */
    G_TEXTURE = 0xbb,
    /** Set OtherModeH bits. */
    G_SETOTHERMODE_H = 0xba,
    /** Set OtherModeL bits. */
    G_SETOTHERMODE_L = 0xb9,
    /** End display list. */
    G_ENDDL = 0xb8,
    /** Set geometry mode bits. */
    G_SETGEOMETRYMODE = 0xb7,
    /** Clear geometry mode bits. */
    G_CLEARGEOMETRYMODE = 0xb6,
    /** Draw 3D line. */
    G_LINE3D = 0xb5,
    /** RDP half word 1. */
    G_RDPHALF_1 = 0xb4,
    /** RDP half word 2. */
    G_RDPHALF_2 = 0xb3,
    /** Modify vertex. */
    G_MODIFYVTX = 0xb2,
    /** Two triangles. */
    G_TRI2 = 0xb1,
    /** Branch on Z. */
    G_BRANCH_Z = 0xb0,
    /** Load microcode. */
    G_LOAD_UCODE = 0xaf,

    // RDP commands.
    /** Set colour image. */
    G_SETCIMG = 0xff,
    /** Set Z image. */
    G_SETZIMG = 0xfe,
    /** Set texture image. */
    G_SETTIMG = 0xfd,
    /** Set colour combiner. */
    G_SETCOMBINE = 0xfc,
    /** Set environment colour. */
    G_SETENVCOLOR = 0xfb,
    /** Set primitive colour. */
    G_SETPRIMCOLOR = 0xfa,
    /** Set blend colour. */
    G_SETBLENDCOLOR = 0xf9,
    /** Set fog colour. */
    G_SETFOGCOLOR = 0xf8,
    /** Set fill colour. */
    G_SETFILLCOLOR = 0xf7,
    /** Fill rectangle. */
    G_FILLRECT = 0xf6,
    /** Set tile descriptor. */
    G_SETTILE = 0xf5,
    /** Load tile. */
    G_LOADTILE = 0xf4,
    /** Load block. */
    G_LOADBLOCK = 0xf3,
    /** Set tile size. */
    G_SETTILESIZE = 0xf2,
    /** Load TLUT (palette). */
    G_LOADTLUT = 0xf0,
    /** Set RDP other mode. */
    G_RDPSETOTHERMODE = 0xef,
    /** Set primitive depth. */
    G_SETPRIMDEPTH = 0xee,
    /** Set scissor rectangle. */
    G_SETSCISSOR = 0xed,
    /** Set colour convert. */
    G_SETCONVERT = 0xec,
    /** Set chroma key R. */
    G_SETKEYR = 0xeb,
    /** Set chroma key GB. */
    G_SETKEYFB = 0xea,
    /** RDP full sync. */
    G_RDPFULLSYNC = 0xe9,
    /** RDP tile sync. */
    G_RDPTILESYNC = 0xe8,
    /** RDP pipe sync. */
    G_RDPPIPESYNC = 0xe7,
    /** RDP load sync. */
    G_RDPLOADSYNC = 0xe6,
    /** Texture rectangle flipped. */
    G_TEXRECTFLIP = 0xe5,
    /** Texture rectangle. */
    G_TEXRECT = 0xe4,
}

/**
 * Interprets an F3DEX display list starting at the given
 * segmented address.
 * @param {RSPStateInterface} state RSP state machine.
 * @param {number} addr Segmented address of the display list.
 */
export function runDL_F3DEX(state: RSPStateInterface, addr: number): void {
    const segmentBuffer = state.segmentBuffers[(addr >>> 24) & 0xff];
    const view = segmentBuffer.createDataView();

    for (let i = addr & 0x00ffffff; i < segmentBuffer.byteLength; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3DEX_GBI = w0 >>> 24;
        if (window.debug) {
            console.debug(hexzero(i, 8), F3DEX_GBI[cmd], hexzero(w0, 8), hexzero(w1, 8));
        }

        switch (cmd) {
            case F3DEX_GBI.G_ENDDL:
                return;

            case F3DEX_GBI.G_CLEARGEOMETRYMODE:
                state.gSPClearGeometryMode(w1);
                break;

            case F3DEX_GBI.G_SETGEOMETRYMODE:
                state.gSPSetGeometryMode(w1);
                break;

            case F3DEX_GBI.G_TEXTURE:
                {
                    const level = (w0 >>> 11) & 0x07;
                    const tile = (w0 >>> 8) & 0x07;
                    const on = !!((w0 >>> 0) & 0x7f);
                    const s = (w1 >>> 16) & 0xffff;
                    const t = (w1 >>> 0) & 0xffff;
                    state.gSPTexture(on, tile, level, s, t);
                }
                break;

            case F3DEX_GBI.G_SETTIMG:
                {
                    const fmt = (w0 >>> 21) & 0x07;
                    const siz = (w0 >>> 19) & 0x03;
                    const w = (w0 & 0x0fff) + 1;
                    state.gDPSetTextureImage(fmt, siz, w, w1);
                }
                break;

            case F3DEX_GBI.G_SETTILE:
                {
                    const fmt = (w0 >>> 21) & 0x07;
                    const siz = (w0 >>> 19) & 0x03;
                    const line = (w0 >>> 9) & 0x1ff;
                    const tmem = (w0 >>> 0) & 0x1ff;
                    const tile = (w1 >>> 24) & 0x07;
                    const palette = (w1 >>> 20) & 0x0f;
                    const cmt = (w1 >>> 18) & 0x03;
                    const maskt = (w1 >>> 14) & 0x0f;
                    const shiftt = (w1 >>> 10) & 0x0f;
                    const cms = (w1 >>> 8) & 0x03;
                    const masks = (w1 >>> 4) & 0x0f;
                    const shifts = (w1 >>> 0) & 0x0f;
                    state.gDPSetTile(
                        fmt,
                        siz,
                        line,
                        tmem,
                        tile,
                        palette,
                        cmt,
                        maskt,
                        shiftt,
                        cms,
                        masks,
                        shifts,
                    );
                }
                break;

            case F3DEX_GBI.G_LOADTLUT:
                {
                    const tile = (w1 >>> 24) & 0x07;
                    const count = (w1 >>> 14) & 0x3ff;
                    state.gDPLoadTLUT(tile, count);
                }
                break;

            case F3DEX_GBI.G_LOADBLOCK:
                {
                    const uls = (w0 >>> 12) & 0x0fff;
                    const ult = (w0 >>> 0) & 0x0fff;
                    const tile = (w1 >>> 24) & 0x07;
                    const lrs = (w1 >>> 12) & 0x0fff;
                    const dxt = (w1 >>> 0) & 0x0fff;
                    state.gDPLoadBlock(tile, uls, ult, lrs, dxt);
                }
                break;

            case F3DEX_GBI.G_VTX:
                {
                    const v0 = ((w0 >>> 16) & 0xff) / 2;
                    const n = (w0 >>> 10) & 0x3f;
                    state.gSPVertex(w1, n, v0);
                }
                break;

            case F3DEX_GBI.G_TRI1:
                {
                    const i0 = ((w1 >>> 16) & 0xff) / 2;
                    const i1 = ((w1 >>> 8) & 0xff) / 2;
                    const i2 = ((w1 >>> 0) & 0xff) / 2;
                    state.gSPTri(i0, i1, i2);
                }
                break;

            case F3DEX_GBI.G_TRI2:
                {
                    {
                        const i0 = ((w0 >>> 16) & 0xff) / 2;
                        const i1 = ((w0 >>> 8) & 0xff) / 2;
                        const i2 = ((w0 >>> 0) & 0xff) / 2;
                        state.gSPTri(i0, i1, i2);
                    }
                    {
                        const i0 = ((w1 >>> 16) & 0xff) / 2;
                        const i1 = ((w1 >>> 8) & 0xff) / 2;
                        const i2 = ((w1 >>> 0) & 0xff) / 2;
                        state.gSPTri(i0, i1, i2);
                    }
                }
                break;

            case F3DEX_GBI.G_DL:
                {
                    runDL_F3DEX(state, w1);
                }
                break;

            case F3DEX_GBI.G_SETOTHERMODE_H:
                {
                    const len = (w0 >>> 0) & 0xff;
                    const sft = (w0 >>> 8) & 0xff;
                    state.gDPSetOtherModeH(sft, len, w1);
                }
                break;

            case F3DEX_GBI.G_SETOTHERMODE_L:
                {
                    const len = (w0 >>> 0) & 0xff;
                    const sft = (w0 >>> 8) & 0xff;
                    state.gDPSetOtherModeL(sft, len, w1);
                }
                break;

            case F3DEX_GBI.G_SETCOMBINE:
                {
                    state.gDPSetCombine(w0 & 0x00ffffff, w1);
                }
                break;

            case F3DEX_GBI.G_SETTILESIZE:
                {
                    const uls = (w0 >>> 12) & 0x0fff;
                    const ult = (w0 >>> 0) & 0x0fff;
                    const tile = (w1 >>> 24) & 0x07;
                    const lrs = (w1 >>> 12) & 0x0fff;
                    const lrt = (w1 >>> 0) & 0x0fff;
                    state.gDPSetTileSize(tile, uls, ult, lrs, lrt);
                }
                break;

            case F3DEX_GBI.G_POPMTX:
                {
                    // state.gSPPopMatrix();
                }
                break;

            case F3DEX_GBI.G_MODIFYVTX:
                {
                    const where = (w0 >>> 16) & 0x00ff;
                    const vtx = ((w0 >>> 0) & 0xffff) / 2;
                    const val = (w1 >>> 0) & 0xffffffff;
                    state.gSPModifyVertex(vtx, where, val);
                }
                break;

            case F3DEX_GBI.G_MOVEMEM:
                {
                    state.gMoveMem?.(w0, w1);
                }
                break;

            case F3DEX_GBI.G_CULLDL:
            case F3DEX_GBI.G_RDPFULLSYNC:
            case F3DEX_GBI.G_RDPTILESYNC:
            case F3DEX_GBI.G_RDPPIPESYNC:
            case F3DEX_GBI.G_RDPLOADSYNC:
                // Implementation not necessary.
                break;

            case F3DEX_GBI.G_SETPRIMCOLOR:
                {
                    const lod = (w0 >>> 0) & 0xff;
                    const r = (w1 >>> 24) & 0xff;
                    const g = (w1 >>> 16) & 0xff;
                    const b = (w1 >>> 8) & 0xff;
                    const a = (w1 >>> 0) & 0xff;
                    state.gSPSetPrimColor?.(lod, r, g, b, a);
                }
                break;

            case F3DEX_GBI.G_SETENVCOLOR:
                {
                    const r = (w1 >>> 24) & 0xff;
                    const g = (w1 >>> 16) & 0xff;
                    const b = (w1 >>> 8) & 0xff;
                    const a = (w1 >>> 0) & 0xff;
                    state.gSPSetEnvColor?.(r, g, b, a);
                }
                break;

            case F3DEX_GBI.G_SETBLENDCOLOR:
            case F3DEX_GBI.G_SETFOGCOLOR:
            case F3DEX_GBI.G_SETFILLCOLOR:
            case F3DEX_GBI.G_FILLRECT:
            case F3DEX_GBI.G_SETPRIMDEPTH:
            case F3DEX_GBI.G_SETSCISSOR:
            case F3DEX_GBI.G_RDPSETOTHERMODE:
            case F3DEX_GBI.G_SETCIMG:
            case F3DEX_GBI.G_SETZIMG:
                // Not yet implemented but should not be treated as errors.
                break;

            default:
                console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
        }
    }
}
