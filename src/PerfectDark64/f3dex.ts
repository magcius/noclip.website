import * as F3DEX from "../BanjoKazooie/f3dex";
import * as RDP from "../Common/N64/RDP";
import { AABB } from "../Geometry";
import { GfxProgram, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ReadonlyVec3, vec4, mat4 } from "gl-matrix";
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP.js';
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { nArray, assert, hexzero0x } from "../util";

import { Program } from "./shaders";
import * as tex from "./tex";

// Vertex as used by the RSP.
export interface Vertex {
    x:      number; // uint16
    y:      number; // uint16
    z:      number; // uint16
    flags:  number; // uint8
    color:  number; // uint8
    s:      number; // uint16
    t:      number; // uint16
};
export const vertexStructSize = 12;

export function toReadonlyVec3(v: Vertex): ReadonlyVec3 {
    return [v.x, v.y, v.z];
}

// Vertex as used by our shader.
interface ComputedVertex extends Vertex {
    cr: number; // uint8, color/normal
    cg: number; // uint8, color/normal
    cb: number; // uint8, color/normal
    ca: number; // uint8, color/normal
}
const computedVertexElementsCount = 5 + 4; // no flags/color in vertex buffer

// Don't look, I'm ashamed.
function computedVertexKey(vtx: ComputedVertex): string {
    return [
        vtx.x, vtx.y, vtx.z,
        vtx.flags, vtx.color,
        vtx.s, vtx.t,
        vtx.cr, vtx.cg, vtx.cb, vtx.ca
    ].join(',');
}

export interface Color {
    r: number; // uint8
    g: number; // uint8
    b: number; // uint8
    a: number; // uint8
};
export const colorStructSize = 4;

export function loadColorFromView(view: DataView, offset: number): Color {
    return {
        r:  view.getUint8(offset + 0),
        g:  view.getUint8(offset + 1),
        b:  view.getUint8(offset + 2),
        a:  view.getUint8(offset + 3),
    };
}

export function loadVertexFromView(view: DataView, offset: number): Vertex {
    return {
        x:      view.getInt16(offset),
        y:      view.getInt16(offset + 2),
        z:      view.getInt16(offset + 4),
        flags:  view.getUint8(offset + 6),
        color: view.getUint8(offset + 7),
        s:      view.getInt16(offset + 8),
        t:      view.getInt16(offset + 10),
    };
}

export enum Command {
    G_SPNOOP            = 0x00,
    G_VTX               = 0x04,
    G_COL               = 0x07,// like  G_VTX but for vertex colors.
    G_TRI4              = 0xB1,
    G_CLEARGEOMETRYMODE = 0xB6,
    G_SETGEOMETRYMODE   = 0xB7,
    G_ENDDL             = 0xB8,
    G_SETOTHERMODE_L    = 0xB9,
    G_SETOTHERMODE_H    = 0xBA,
    G_TEXTURE           = 0xBB,
    G_TRI1              = 0xBF,
	// Used in stored assets and unpacks to multiple commands.
    G_NOOP              = 0xC0,
    G_LOADTLUT          = 0xF0,
    G_SETCOMBINE        = 0xFC,
    G_SETENVCOLOR       = 0xFB,
    G_SETTIMG           = 0xFD,

	G_RDPFULLSYNC     = 0xE9,
	G_RDPTILESYNC     = 0xE8,
	G_RDPPIPESYNC     = 0xE7,
	G_RDPLOADSYNC     = 0xE6,
}

export enum Segment {
    Physical  = 0,
    Title     = 2,
    ModelMTX  = 3,
    ModelVTX  = 4,
    ModelCol1 = 5,
    ModelCol2 = 6,
    BGCol     = 13,
    BGVtx     = 14, // 0x0E
    BGDL      = 15,
}

export enum GeometryMode {
    G_ZBUFFER            = 0x00000001,
    G_SHADE              = 0x00000004,
    G_TEXTURE_ENABLE     = 0x00000002,
    G_SHADING_SMOOTH     = 0x00000200,
    G_CULL_FRONT         = 0x00001000,
    G_CULL_BACK          = 0x00002000,
    G_CULL_BOTH          = 0x00003000,
    G_FOG                = 0x00010000,
    G_LIGHTING           = 0x00020000,
    G_TEXTURE_GEN        = 0x00040000,
    G_TEXTURE_GEN_LINEAR = 0x00080000,
    G_LOD                = 0x00100000,
    G_CLIPPING           = 0x00000000,
}

function translateCullMode(gm: GeometryMode): GfxCullMode {
    const cullFront = !!(gm & GeometryMode.G_CULL_FRONT);
    const cullBack = !!(gm & GeometryMode.G_CULL_BACK);

    // There's LOTS of these and I don't know what to make of it.
    // It's used where I would have culled back faces so that's what I'll do.
    const cullBoth = !!(gm & GeometryMode.G_CULL_BOTH);

    if (cullBoth || cullBack) {
        return GfxCullMode.Back;
    }

    if (cullFront) {
        return GfxCullMode.Front;
    }

    return GfxCullMode.None;
}

function bitfield(v: number, pos: number, width: number): number {
	return (v >>> pos) & ((1<<width) - 1);
}

export class GFX {
    constructor(
        public readonly w0: number, // uint32
        public readonly w1: number, // uint32
    ) {
        assert(this.w0 >= 0 && this.w0 <= 0xFFFFFFFF);
        assert(this.w1 >= 0 && this.w1 <= 0xFFFFFFFF);
    }

    public c0(pos: number, width: number): number {
        return bitfield(this.w0, pos, width)
    }
    public c1(pos: number, width: number): number {
        return bitfield(this.w1, pos, width)
    }

    public static readFromView(view: DataView, offset: number): GFX {
        return new GFX(
            view.getUint32(offset),
            view.getUint32(offset + 4),
        );
    }

    public command(): Command {
        return (this.w0 >>> 24) & 0xFF;
    }
}
export const gfxStructSize = 8;

export class Mesh {
    public inputLayout: GfxInputLayout;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number = 0;
    public isSkybox: boolean = false;
    public texture: GfxTexture | null = null;
    public cullMode: GfxCullMode = GfxCullMode.None;
    public wrapS: GfxWrapMode = GfxWrapMode.Repeat;
    public wrapT: GfxWrapMode = GfxWrapMode.Repeat;
    public aabb: AABB;
    public texMatrix: mat4 = mat4.create();
    public gfxProgram: GfxProgram|null = null;

    public SP_GeometryMode: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_OtherModeL: number = 0;
    public DP_EnvColor = vec4.create();
    public DP_Combine: RDP.CombineParams = {
        c0: { a: RDP.CCMUX.TEXEL0, b: RDP.CCMUX.ADD_ZERO, c: RDP.CCMUX.PRIMITIVE, d: RDP.CCMUX.ADD_ZERO },
        c1: { a: RDP.CCMUX.TEXEL0, b: RDP.CCMUX.ADD_ZERO, c: RDP.CCMUX.PRIMITIVE, d: RDP.CCMUX.ADD_ZERO },
        a0: { a: RDP.ACMUX.TEXEL0, b: RDP.ACMUX.ZERO,     c: RDP.ACMUX.PRIMITIVE, d: RDP.ACMUX.ZERO     },
        a1: { a: RDP.ACMUX.TEXEL0, b: RDP.ACMUX.ZERO,     c: RDP.ACMUX.PRIMITIVE, d: RDP.ACMUX.ZERO     },
    };

    // Set by and for the renderer and the code around it, not the interpreter.
    public sortKeyBase: number;

    // Returns true if the mesh has been successfuly built an can be rendered.
    public isValid(): boolean {
        return this.indexCount > 0;
    }

    public destroy(device: GfxDevice): void {
        if (!this.isValid()) {
            return;
        }

        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class MeshBuilder {
    public vertices: ComputedVertex[] = [];
    public indices: number[] = [];
    public texture: GfxTexture | null = null;
    public textureNumber: number | null = null;
    public SP_GeometryMode: GeometryMode = 0;
    public wrapS: GfxWrapMode;
    public wrapT: GfxWrapMode;
    public aabb: AABB = new AABB();
    public texMatrix: mat4 = mat4.create();

    public DP_EnvColor = vec4.create();
    public DP_Combine: RDP.CombineParams;
    public DP_OtherModeH: number = 0;
    public DP_OtherModeL: number = 0;

    public vtxToIndex: Map<string, number> = new Map();

    public pushFace(verts: ComputedVertex[]): void {
        // Deduping indices, the ugly way.
        // The key makes me barf but it's 44k deduped indices across Area 51.
        verts.forEach(v => {
            const key = computedVertexKey(v);
            const existingIndex = this.vtxToIndex.get(key);
            if (existingIndex !== undefined) {
                this.indices.push(existingIndex);
            } else {
                const index = this.vertices.length;
                this.vertices.push(v);
                this.indices.push(index);
                this.vtxToIndex.set(key, index);
                this.aabb.unionPoint(toReadonlyVec3(v));
            }
        });
    }

    public buildMesh(device: GfxDevice, cache: GfxRenderCache): Mesh {
        const mesh = new Mesh();

        if (this.indices.length == 0) {
            console.warn("attempted to build an empty mesh");
            return mesh;
        }

        mesh.texture = this.texture;
        mesh.cullMode = translateCullMode(this.SP_GeometryMode);
        mesh.wrapS = this.wrapS;
        mesh.wrapT = this.wrapT;
        mesh.aabb = this.aabb;
        mesh.texMatrix = this.texMatrix;
        mesh.DP_Combine = this.DP_Combine;
        mesh.DP_OtherModeH = this.DP_OtherModeH;
        mesh.DP_OtherModeL = this.DP_OtherModeL;
        mesh.SP_GeometryMode = this.SP_GeometryMode;

        vec4.copy(mesh.DP_EnvColor, this.DP_EnvColor);

        const vertexArray = new Float32Array(this.vertices.length * computedVertexElementsCount);
        this.vertices.forEach((v, i) => {
            vertexArray.set(
                [
                    v.x, v.y, v.z,
                    v.s, v.t,
                    v.cr, v.cg, v.cb, v.ca,
                ],
                i * computedVertexElementsCount,
            );
        });
        this.vertices = [];

        const indexArray = new Uint16Array(this.indices.length);
        indexArray.set(this.indices);
        mesh.indexCount = this.indices.length;
        this.indices = [];

        mesh.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexArray.buffer);
        device.setResourceName(mesh.vertexBuffer, "mesh vertex buffer");
        mesh.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexArray.buffer);
        device.setResourceName(mesh.indexBuffer, "mesh index buffer");

        mesh.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                {
                    location: Program.a_Position,
                    format: GfxFormat.F32_RGB,
                    bufferByteOffset: 0,
                    bufferIndex: 0,
                },
                {
                    location: Program.a_TexCoord,
                    format: GfxFormat.F32_RG,
                    bufferByteOffset: 3*4,
                    bufferIndex: 0,
                },
                {
                    location: Program.a_VertexColor,
                    format: GfxFormat.F32_RGBA,
                    bufferByteOffset: 5*4,
                    bufferIndex: 0,
                },
            ],

            vertexBufferDescriptors: [{
                byteStride: computedVertexElementsCount * 4,
                frequency: GfxVertexBufferFrequency.PerVertex,
            }],

            indexBufferFormat: GfxFormat.U16_R,
        });

        return mesh;
    }
}

interface SegmentAddress {
    segment: Segment;
    address: number;
}

function segAddr(addr: number): SegmentAddress {
    return {
        segment: (addr & 0xFF000000) >>> 24,
        address: addr & 0x00FFFFFF,
    };
}

// Contains some c/c from PokemonSnap implementation.
export class Interpreter {
    private vtxSegments: Vertex[][] = [];
    private colSegments: Color[][] = [];
    private vtxCache: Vertex[] = Array<Vertex>(16);
    private colCache: Color[] = [];
    private SP_GeometryMode: GeometryMode = 0; // bitflags

    private SP_TextureState = new F3DEX.TextureState();
    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_EnvColor = vec4.create();
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TileState = nArray(8, () => new RDP.TileState());
    private DP_TextureImageState = new F3DEX.TextureImageState();

    private cur: MeshBuilder = new MeshBuilder();
    private meshes: MeshBuilder[] = [];

    constructor(
        private textureCache: tex.TextureListHolder,
    ) {
        this.vtxSegments[Segment.BGVtx] = [];
        this.colSegments[Segment.BGCol] = [];
    }

    private flush() {
        if (this.cur !== null) {
            this.cur.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
            vec4.copy(this.cur.DP_EnvColor, this.DP_EnvColor);
            this.cur.DP_OtherModeH = this.DP_OtherModeH;
            this.cur.DP_OtherModeL = this.DP_OtherModeL;

            this.cur.SP_GeometryMode = this.SP_GeometryMode;
            const tile = this.DP_TileState[this.SP_TextureState.tile];
            this.cur.wrapT = texModeToGfx(tile.cmt);
            this.cur.wrapS = texModeToGfx(tile.cms);

            if (this.SP_TextureState.on && this.cur.textureNumber !== null) {
                const meta: tex.InflatedTexture = this.textureCache.getMetadata(this.cur.textureNumber)!;
                calcTextureMatrixFromRSPState(
                    this.cur.texMatrix,
                    this.SP_TextureState.s, this.SP_TextureState.t,
                    meta.width, meta.height,
                    tile.shifts, tile.shiftt,
                );
            } else {
                mat4.identity(this.cur.texMatrix);
            }

            this.meshes.push(this.cur);
        }

        this.cur = new MeshBuilder();
    }

    public build(device: GfxDevice, cache: GfxRenderCache): Mesh[] {
        this.flush();

        const ret: Mesh[] = [];
        this.meshes.forEach(v => ret.push(v.buildMesh(device, cache)));
        return ret.filter(v => v.isValid());
    }

    public setSegmentVertices(segment: Segment, vertices: Vertex[]): void {
        switch(segment) {
            case Segment.BGVtx:
                this.vtxSegments[segment] = vertices;
                break;
            default:
                throw new Error(`Unexpected segment: ` + hexzero0x(segment));
        }
    }

    public setSegmentColors(segment: Segment, colors: Color[]): void {
        switch(segment) {
            case Segment.BGCol:
                this.colSegments[segment] = colors;
                break;
            default:
                throw new Error(`Unexpected segment: ` + hexzero0x(segment));
        }
    }

    public processGFX(gfx: GFX): void {
        switch(gfx.command()) {
            case Command.G_ENDDL:
                return;
            case Command.G_VTX:
                this.gSPVertex(gfx);
                break;
            case Command.G_TRI1:
                this.gSPTri(
                    gfx.c1(16, 8),
                    gfx.c1(8, 8),
                    gfx.c1(0, 8),
                );
                break;
            case Command.G_TRI4:
                this.gSPTri4(gfx);
                break;
            case Command.G_COL:
                this.gSPColor(gfx);
                break;
            case Command.G_SETGEOMETRYMODE:
                this.SP_GeometryMode |= gfx.w1;
                break;
            case Command.G_CLEARGEOMETRYMODE:
                this.SP_GeometryMode &= ~gfx.w1;
                break;

            case Command.G_LOADTLUT: {
                const tile = (gfx.w1 >>> 24) & 0x07;
                const count = (gfx.w1 >>> 14) & 0x3FF;
                this.gDPLoadTLUT(tile, count);
            } break;

            case Command.G_SETTIMG: {
                const fmt = (gfx.w0 >>> 21) & 0x07;
                const siz = (gfx.w0 >>> 19) & 0x03;
                const w = (gfx.w0 & 0x0FFF) + 1;
                this.gDPSetTextureImage(fmt, siz, w, gfx.w1);
            } break;

            case Command.G_SETENVCOLOR: {
                const r = (gfx.w1 >>> 24) & 0xFF;
                const g = (gfx.w1 >>> 16) & 0xFF;
                const b = (gfx.w1 >>> 8) & 0xFF;
                const a = (gfx.w1 >>> 0) & 0xFF;
                this.gSPSetEnvColor(r, g, b, a);
            } break;

            case Command.G_TEXTURE: {
                const level = (gfx.w0 >>> 11) & 0x07;
                const tile = (gfx.w0 >>> 8) & 0x07;
                const on = !!((gfx.w0 >>> 0) & 0x7F);
                const s = (gfx.w1 >>> 16) & 0xFFFF;
                const t = (gfx.w1 >>> 0) & 0xFFFF;
                this.gSPTexture(on, tile, level, s, t);
            } break;

            case Command.G_SETCOMBINE:
                this.gDPSetCombine(gfx.w0 & 0x00FFFFFF, gfx.w1);
                break;

            case Command.G_SETOTHERMODE_H: {
                const len = (gfx.w0 >>> 0) & 0xFF;
                const sft = (gfx.w0 >>> 8) & 0xFF;
                this.gDPSetOtherModeH(sft, len, gfx.w1);
            } break;

            case Command.G_SETOTHERMODE_L: {
                const len = (gfx.w0 >>> 0) & 0xFF;
                const sft = (gfx.w0 >>> 8) & 0xFF;
                this.gDPSetOtherModeL(sft, len, gfx.w1);
            } break;

            case Command.G_NOOP: // 0xC0
                this.unpackTextureGFX(gfx);
                break;

            case Command.G_SPNOOP:
            case Command.G_RDPFULLSYNC:
            case Command.G_RDPTILESYNC:
            case Command.G_RDPPIPESYNC:
            case Command.G_RDPLOADSYNC:
                // NOOP
                break
            default: {
                const cmd = gfx.command() << 24 >>> 24;
                console.warn("unknown command:", cmd, hexzero0x(gfx.command()).slice(8));
                break;
            }
        }
    }

    private gSPVertex(gfx: GFX): void {
        const src = segAddr(gfx.w1);
        const srcIndex = src.address / vertexStructSize;
        const n = gfx.c0(0, 16) / vertexStructSize;
        const dstIndex = gfx.c0(16, 4);

        if (dstIndex+n > this.vtxCache.length) {
            throw new Error("vtxCache overflow");
        }

        for (let i = 0; i < n; i++) {
            this.vtxCache[dstIndex + i] = this.vtxSegments[src.segment][srcIndex + i];
        }
    }

    // Got conflicting info between obviously wrong comments in the decomp and
    // the port implementation. I'll do what the port does and hope for the best.
    private gSPColor(gfx: GFX): void {
        const src = segAddr(gfx.w1);
        this.colCache = this.colSegments[src.segment].slice(src.address / 4);
    }

    private gSPTri(a:number, b:number, c:number): void {
        assert(a < 16 && b < 16 && c < 16, "vertex index out of vtxCache bounds");

        const verts: ComputedVertex[] = [
            { ...this.vtxCache[a], cr: 0, cg: 0, cb: 0, ca: 0, },
            { ...this.vtxCache[b], cr: 0, cg: 0, cb: 0, ca: 0, },
            { ...this.vtxCache[c], cr: 0, cg: 0, cb: 0, ca: 0, },
        ];

        verts.forEach(v => {
            v.s /= 0x20;
            v.t /= 0x20;

            const col: Color = this.colCache[v.color >>> 2];
            if (col !== undefined) {
                v.cr = col.r / 255.0;
                v.cg = col.g / 255.0;
                v.cb = col.b / 255.0;
                v.ca = col.a / 255.0;
            }
        });

        this.cur.pushFace(verts);
    }

    private gSPTri4(gfx: GFX): void {
        const tri = (a:number, b:number, c:number): void => {
            if (a == 0 && b == 0 && c == 0) {
                return;
            }

            this.gSPTri(a, b, c);
        };

        tri(
            gfx.c1(0, 4),
            gfx.c1(4, 4),
            gfx.c0(0, 4),
        )
        tri(
            gfx.c1(8, 4),
            gfx.c1(12, 4),
            gfx.c0(4, 4),
        )
        tri(
            gfx.c1(16, 4),
            gfx.c1(20, 4),
            gfx.c0(8, 4),
        )
        tri(
            gfx.c1(24, 4),
            gfx.c1(28, 4),
            gfx.c0(12, 4),
        )
    }

    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        // console.debug("gDPSetTextureImage", fmt, siz, w, addr);
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    public gDPSetTile(fmt: number, siz: number, line: number, tmem: number, tile: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        // console.debug("gDPSetTile", fmt, siz, line, tmem, tile, palette, cmt, maskt, shiftt, cms, masks, shifts);
        this.DP_TileState[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
    }

    public gDPLoadTLUT(tile: number, count: number): void {
        console.debug("gDPLoadTLUT", tile, count);
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, texels: number, dxt: number): void {
        console.debug("gDPLoadBlock", tileIndex, uls, ult, texels, dxt);
        // Verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        // console.debug("gDPSetTileSize", tile, uls, ult, lrs, lrt);
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
    }

    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        // console.debug("gSPTexture", on, tile, level, s, t);
        // This is the texture we're using to rasterize triangles going forward.
        this.SP_TextureState.set(on, tile, level, s / 0x10000, t / 0x10000);
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
    }

    public gDPSetCombine(w0: number, w1: number): void {
        this.DP_CombineH = w0;
        this.DP_CombineL = w1;
    }

    public gSPSetEnvColor(r: number, g: number, b: number, a: number) {
        vec4.set(this.DP_EnvColor, r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
    }

    public unpackTextureGFX(gfx: GFX): void {
        const textureNumber = gfx.w1 & 0xfff;

        if (!this.setCurrentTexture(textureNumber)) {
            return;
        }

        const meta: tex.InflatedTexture = this.textureCache.getMetadata(this.cur.textureNumber!)!;

        this.gSPTexture(true /* G_ON */, 0 /* G_TX_RENDERTILE */, 1, 0xFFFF, 0xFFFF);
        this.gDPSetTextureImage(meta.imageFormat, meta.imageSize, 1, 0);

        this.DP_TileState[0].cms = (gfx.w0 >>> 22) & 3;
        this.DP_TileState[0].cmt = (gfx.w0 >>> 20) & 3;

        const offset = (gfx.w0 >>> 18) & 3;
        const base = offset === 2 ? 2 : 0;
        this.gDPSetTileSize(
            0,
            base,
            base,
            base + (meta.width - 1) << 2,
            base + (meta.height - 1) << 2,
        );
    }

    public setCurrentTexture(textureNumber: number): boolean {
        if (textureNumber === this.cur.textureNumber) {
            return false;
        }

        if (this.cur.indices.length > 0) {
            this.flush();
        }

        const viewerTexture = this.textureCache.getByTextureNumber(textureNumber);
        if (viewerTexture === undefined) {
            this.cur.texture = null;
            this.cur.textureNumber = textureNumber;
            return false;
        }

        this.cur.texture = viewerTexture.gfxTexture;
        this.cur.textureNumber = textureNumber;

        return true;
    }
}

function texModeToGfx(mode: number): GfxWrapMode {
    switch(mode) {
        case 0:
            return GfxWrapMode.Repeat;
        case 1:
            return GfxWrapMode.Clamp;
        case 2:
            return GfxWrapMode.Mirror;
    }

    throw new Error(`invalid texture wrap mode: ${mode}`);
}
