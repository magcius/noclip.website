
// .gpl geometry parser.

import { mat3, ReadonlyMat4, vec3 } from "gl-matrix";
import { getNormal, NORMAL_COUNT } from "./Normals.js";

import ArrayBufferSlice from "../ArrayBufferSlice.js";

//#region Block table

export interface GplBlock {
    index: number;
    recordOff: number;
    typeTag: number;
    elemCount: number;
    field0: number | null;
    field1: number | null;
    field2: number | null;
    field2Entries: [number, number, number][]; // (offset, a, b)
    field3: number | null;
    field4: number | null;
    field4Entries: [number, number][]; // (offset, value)
    numPositions: number | null;
    quantizeInfo: number | null;
    compCount: number | null;
    numTexCoords: number | null;
    uvQuantizeInfo: number | null;
    uvCompCount: number | null;
    numColors: number | null;
    colorQuantizeInfo: number | null;
    colorCompCount: number | null;
    normalArrayOff: number | null;
    numNormals: number | null;
    normalQuantizeInfo: number | null;
    normalCompCount: number | null;
}

function r32(view: DataView, o: number): number {
    return view.getInt32(o, false);
}

function w32(view: DataView, o: number, v: number): void {
    view.setInt32(o, v | 0, false);
}

function r16u(view: DataView, o: number): number {
    return view.getUint16(o, false);
}

export interface GplBlockTable {
    blocks: GplBlock[];
    view: DataView;
}

export function walkBlockTable(data: ArrayBufferSlice): GplBlockTable {
    const buf = data.arrayBuffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const view = new DataView(buf);
    const base = 0;

    const version = r32(view, base);
    if (version === -1)
        throw new Error("data already fixed up (or not GeoPalette data)");
    if (version !== 0x5BBC61)
        throw new Error(`unexpected GeoPalette version 0x${version.toString(16)} (expected 0x5bbc61)`);
    w32(view, base, -1);

    if (r32(view, base + 4) !== 0 && r32(view, base + 8) !== 0)
        w32(view, base + 8, r32(view, base + 8) + base);

    w32(view, base + 0x10, r32(view, base + 0x10) + base);

    const count = r32(view, base + 0xC);
    const arrayBase = r32(view, base + 0x10);

    const blocks: GplBlock[] = [];
    for (let i = 0; i < count; i++) {
        const entryOff = arrayBase + i * 8;
        const e0 = r32(view, entryOff) + base;
        w32(view, entryOff, e0);
        const e1 = r32(view, entryOff + 4) + base;
        w32(view, entryOff + 4, e1);
        const rec = r32(view, entryOff);

        const blk: GplBlock = {
            index: i,
            recordOff: rec,
            typeTag: view.getUint8(rec + 7),
            elemCount: r16u(view, rec + 4),
            field0: null, field1: null, field2: null, field2Entries: [],
            field3: null, field4: null, field4Entries: [],
            numPositions: null, quantizeInfo: null, compCount: null,
            numTexCoords: null, uvQuantizeInfo: null, uvCompCount: null,
            numColors: null, colorQuantizeInfo: null, colorCompCount: null,
            normalArrayOff: null, numNormals: null, normalQuantizeInfo: null, normalCompCount: null,
        };

        const f0 = r32(view, rec + 0);
        if (f0 !== 0) {
            const f0n = f0 + rec;
            w32(view, rec + 0, f0n);
            const inner = r32(view, f0n);
            if (inner !== 0)
                w32(view, f0n, inner + rec);
            blk.field0 = f0n;
            blk.numPositions = r16u(view, f0n + 4);
            blk.quantizeInfo = view.getUint8(f0n + 6);
            blk.compCount = view.getUint8(f0n + 7);
        }

        const f1 = r32(view, rec + 4);
        if (f1 !== 0) {
            const f1n = f1 + rec;
            w32(view, rec + 4, f1n);
            const inner = r32(view, f1n);
            if (inner !== 0)
                w32(view, f1n, inner + rec);
            blk.field1 = f1n;
            blk.numColors = r16u(view, f1n + 4);
            blk.colorQuantizeInfo = view.getUint8(f1n + 6);
            blk.colorCompCount = view.getUint8(f1n + 7);
        }

        const f2 = r32(view, rec + 8);
        if (f2 !== 0) {
            const f2n = f2 + rec;
            w32(view, rec + 8, f2n);
            const subcount = view.getUint8(rec + 0x14);
            for (let j = 0; j < subcount; j++) {
                const so = f2n + j * 0x10;
                let a = r32(view, so);
                if (a !== 0) {
                    a += rec;
                    w32(view, so, a);
                }
                let b = r32(view, so + 8);
                if (b !== 0) {
                    b += rec;
                    w32(view, so + 8, b);
                }
                blk.field2Entries.push([so, a, b]);
            }
            blk.field2 = f2n;
            if (blk.field2Entries.length > 0 && blk.field2Entries[0][1] !== 0) {
                const firstSo = blk.field2Entries[0][0];
                blk.numTexCoords = r16u(view, firstSo + 4);
                blk.uvQuantizeInfo = view.getUint8(firstSo + 6);
                blk.uvCompCount = view.getUint8(firstSo + 7);
            }
        }

        const f3 = r32(view, rec + 0xC);
        if (f3 !== 0) {
            const f3n = f3 + rec;
            w32(view, rec + 0xC, f3n);
            const inner = r32(view, f3n);
            if (inner !== 0)
                w32(view, f3n, inner + rec);
            blk.field3 = f3n;
            blk.normalArrayOff = r32(view, f3n);
            blk.numNormals = r16u(view, f3n + 4);
            blk.normalQuantizeInfo = view.getUint8(f3n + 6);
            blk.normalCompCount = view.getUint8(f3n + 7);
        }

        const f4 = r32(view, rec + 0x10);
        if (f4 !== 0) {
            const f4n = f4 + rec;
            w32(view, rec + 0x10, f4n);
            const g0 = r32(view, f4n);
            if (g0 !== 0)
                w32(view, f4n, g0 + rec);
            const g1 = r32(view, f4n + 4);
            if (g1 !== 0) {
                const g1n = g1 + rec;
                w32(view, f4n + 4, g1n);
                const subcount2 = r16u(view, f4n + 8);
                for (let j = 0; j < subcount2; j++) {
                    const so = g1n + j * 0x10;
                    let c = r32(view, so + 8);
                    if (c !== 0) {
                        c += rec;
                        w32(view, so + 8, c);
                    }
                    blk.field4Entries.push([so, c]);
                }
            }
            blk.field4 = f4n;
        }

        blocks.push(blk);
    }

    return { blocks, view };
}

//#endregion

//#region Display states

export const enum DisplayStateType { Texture = 1, Draw = 2, Mode = 3, Flag = 0x80 }

export const MODE_UNTEXTURED = 5;

export interface DisplayState {
    type: number;
    slot: number;
    setting: number;
    // Absolute file offset of the display list this record points at, 0 if none.
    listOff: number;
    listSize: number;
}

export function displayStates(view: DataView, block: GplBlock): DisplayState[] {
    return block.field4Entries.map(([so, listOff]): DisplayState => {
        const u0 = view.getUint32(so, false);
        return {
            type: u0 >>> 24,
            slot: (u0 >>> 16) & 0xFF,
            setting: view.getUint32(so + 4, false),
            listOff,
            listSize: view.getUint32(so + 0xC, false),
        };
    });
}

const enum VcdAttr { PnMtxIdx = 0, Pos = 1, Nrm = 2, Clr0 = 3, Clr1 = 4, Tex0 = 5 }
const enum VcdAttrType { None = 0, Direct = 1, Index8 = 2, Index16 = 3 }

function vcdAttr(vcd: number, attr: VcdAttr): VcdAttrType {
    return (vcd >>> (attr * 2)) & 3;
}

function vcdIndexWidth(vcd: number, attr: VcdAttr): number {
    const t = vcdAttr(vcd, attr);
    if (t === VcdAttrType.Index8)
        return 1;
    if (t === VcdAttrType.Index16)
        return 2;
    if (t === VcdAttrType.Direct)
        throw new Error(`direct (non-indexed) attribute ${attr} in vcd 0x${vcd.toString(16)}`);
    return 0;
}

export interface DrawPart {
    start: number;
    end: number;
    vcd: number;
    textureIndex: number | null;
    mode: number | null;
    textured: boolean;
}

export function drawParts(view: DataView, block: GplBlock): DrawPart[] {
    let currentTexture: number | null = null;
    let currentMode: number | null = null;
    let currentVcd: number | null = null;
    const parts: DrawPart[] = [];
    for (const st of displayStates(view, block)) {
        if (st.type === DisplayStateType.Texture)
            currentTexture = st.setting & 0xFFFF;
        else if (st.type === DisplayStateType.Mode)
            currentMode = st.setting;
        else if (st.type === DisplayStateType.Draw)
            currentVcd = st.setting;
        if (st.listOff !== 0 && st.listSize !== 0 && currentVcd !== null) {
            const hasTex0 = vcdAttr(currentVcd, VcdAttr.Tex0) !== VcdAttrType.None;
            parts.push({
                start: st.listOff, end: st.listOff + st.listSize, vcd: currentVcd,
                textureIndex: currentTexture, mode: currentMode,
                textured: hasTex0 && currentTexture !== null && currentMode !== MODE_UNTEXTURED,
            });
        }
    }
    return parts;
}

//#endregion

//#region Display list walk

type PrimKind = 'QUADS' | 'TRIANGLES' | 'TRISTRIP' | 'TRIFAN' | 'LINES' | 'LINESTRIP' | 'POINTS';

const PRIMITIVE_NAMES: { [base: number]: PrimKind } = {
    0x80: 'QUADS',
    0x90: 'TRIANGLES',
    0x98: 'TRISTRIP',
    0xA0: 'TRIFAN',
    0xA8: 'LINES',
    0xB0: 'LINESTRIP',
    0xB8: 'POINTS',
};

// Non-primitive GX commands interleaved between draw primitives
const CMD_LOAD_INDX_A = 0x20, CMD_LOAD_INDX_B = 0x28, CMD_LOAD_INDX_C = 0x30, CMD_LOAD_INDX_D = 0x38;
const CMD_LOAD_BP_REG = 0x61, CMD_LOAD_CP_REG = 0x08, CMD_LOAD_XF_REG = 0x10, CMD_NOP = 0x00;

function skipNonPrimitiveCommand(view: DataView, pos: number, end: number): number | null {
    const cmd = view.getUint8(pos);
    let nxt: number;
    if (cmd === CMD_NOP) {
        nxt = pos + 1;
    } else if (cmd === CMD_LOAD_INDX_A || cmd === CMD_LOAD_INDX_B || cmd === CMD_LOAD_INDX_C || cmd === CMD_LOAD_INDX_D || cmd === CMD_LOAD_BP_REG) {
        nxt = pos + 5;
    } else if (cmd === CMD_LOAD_CP_REG) {
        nxt = pos + 6;
    } else if (cmd === CMD_LOAD_XF_REG) {
        if (pos + 3 > end)
            return null;
        const length = view.getUint16(pos + 1, false) + 1;
        if (length > 0x10)
            return null;
        nxt = pos + 5 + 4 * length;
    } else {
        return null;
    }
    return nxt <= end ? nxt : null;
}

export interface GxVertex {
    positionIndex: number;
    normalIndex: number;
    uvIndex: number;
    color0Index: number | null;
}

export interface GxPrimitive {
    offset: number;
    kind: PrimKind;
    vertices: GxVertex[];
}

// The index widths of one display list's records
export interface VertexFormat {
    posWidth: number;    // 1 or 2
    normalWidth: number; // 0 (no NRM attribute), 1 or 2
    color0Width: number; // 0 (no CLR0 attribute), 1 or 2
    uvWidth: number;     // 0 (no TEX0 attribute), 1 or 2
}

export function vertexFormatFromVcd(vcd: number): VertexFormat {
    if (vcdAttr(vcd, VcdAttr.PnMtxIdx) !== VcdAttrType.None || vcdAttr(vcd, VcdAttr.Clr1) !== VcdAttrType.None || (vcd >>> 12) !== 0)
        throw new Error(`unsupported attributes in vcd 0x${vcd.toString(16)}`);
    const posWidth = vcdIndexWidth(vcd, VcdAttr.Pos);
    if (posWidth === 0)
        throw new Error(`vcd 0x${vcd.toString(16)} has no position attribute`);
    return {
        posWidth,
        normalWidth: vcdIndexWidth(vcd, VcdAttr.Nrm),
        color0Width: vcdIndexWidth(vcd, VcdAttr.Clr0),
        uvWidth: vcdIndexWidth(vcd, VcdAttr.Tex0),
    };
}

function vertexSize(fmt: VertexFormat): number {
    return fmt.posWidth + fmt.normalWidth + fmt.color0Width + fmt.uvWidth;
}

function readIndex(view: DataView, off: number, width: number): number {
    return width === 2 ? view.getUint16(off, false) : view.getUint8(off);
}

export function findDisplayList(view: DataView, start: number, end: number, fmt: VertexFormat): GxPrimitive[] {
    const vsize = vertexSize(fmt);
    const primitives: GxPrimitive[] = [];
    let pos = start;
    while (pos < end) {
        const opcode = view.getUint8(pos);

        const skipTo = skipNonPrimitiveCommand(view, pos, end);
        if (skipTo !== null) {
            pos = skipTo;
            continue;
        }

        const base = opcode & 0xF8;
        const name = PRIMITIVE_NAMES[base];
        if (name === undefined)
            break;
        if (pos + 3 > end)
            break;
        const count = view.getUint16(pos + 1, false);
        let vpos = pos + 3;
        if (vpos + count * vsize > end)
            break;

        const vertices: GxVertex[] = [];
        for (let i = 0; i < count; i++) {
            let off = vpos;
            const pi = readIndex(view, off, fmt.posWidth);
            off += fmt.posWidth;
            const ni = fmt.normalWidth ? readIndex(view, off, fmt.normalWidth) : 0;
            off += fmt.normalWidth;
            const ci = fmt.color0Width ? readIndex(view, off, fmt.color0Width) : null;
            off += fmt.color0Width;
            const ui = fmt.uvWidth ? readIndex(view, off, fmt.uvWidth) : 0;
            vertices.push({ positionIndex: pi, normalIndex: ni, uvIndex: ui, color0Index: ci });
            vpos += vsize;
        }
        primitives.push({ offset: pos, kind: name, vertices });
        pos = vpos;
    }
    return primitives;
}

//#endregion

//#region Array decoding + mesh building

function gxCompSize(compType: number): number {
    return compType >= 4 ? 4 : compType >= 2 ? 2 : 1;
}

// Position array layout:
//
//     GXSetArray(GX_VA_POS, hdr->ptr, hdr->compCount * compSize(hdr->quantizeInfo));
//     GXSetVtxAttrFmt(GX_VA_POS, GX_POS_XYZ, quantizeInfo >> 4, quantizeInfo & 0xf);
//
// stride = compCount * component size
interface PositionLayout {
    entrySize: number;
    compSize: number; // bytes per component: 1 (S8/U8), 2 (S16/U16), 4 (F32)
    float: boolean;
    scale: number;
}

function positionLayout(block: GplBlock): PositionLayout {
    const q = block.quantizeInfo !== null ? block.quantizeInfo : 0x30;
    const compType = q >> 4, frac = q & 0xF;
    const compCount = block.compCount !== null && block.compCount !== 0 ? block.compCount : 3;
    const compSize = gxCompSize(compType);
    const float = compType === 4;
    return { entrySize: compCount * compSize, compSize, float, scale: float ? 1.0 : 1.0 / (2 ** frac) };
}

// The block's normal array:
//
//     ptr == 0             -> engine's global table (Normals.ts)
//     compCount == 3 || 6  -> GXSetArray(GX_VA_NRM, ptr, compCount * compSize)
//     compCount == 2       -> GXSetArray(GX_VA_NBT, ptr, 3 * compSize)
//     else                 -> "DOVARender: Invalid component count"
interface NormalLayout {
    arrayOff: number;
    count: number;
    entrySize: number;
    compType: number;
    scale: number;
}

function normalLayout(block: GplBlock): NormalLayout | null {
    if (block.normalArrayOff === null || block.normalArrayOff === 0 || block.numNormals === null || block.normalQuantizeInfo === null)
        return null;
    const compCount = block.normalCompCount !== null ? block.normalCompCount : 3;
    if (compCount !== 3 && compCount !== 6)
        return null;
    const compType = block.normalQuantizeInfo >> 4;
    const compSize = gxCompSize(compType);
    const scale = compType === 4 ? 1.0 : compSize === 1 ? 1.0 / 64 : 1.0 / 16384;
    return { arrayOff: block.normalArrayOff, count: block.numNormals, entrySize: compCount * compSize, compType, scale };
}

function readComponent(view: DataView, off: number, compType: number): number {
    switch (compType) {
        case 0: return view.getUint8(off);
        case 1: return view.getInt8(off);
        case 2: return view.getUint16(off, false);
        case 3: return view.getInt16(off, false);
        default: return view.getFloat32(off, false);
    }
}

const UV_COMP_SIZE: { [k: number]: number } = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 4 };

function uvEntrySize(compFormat: number): number {
    return 2 * UV_COMP_SIZE[compFormat];
}

function decodeUvEntry(view: DataView, off: number, compFormat: number, frac: number): [number, number] {
    let u: number, v: number;
    switch (compFormat) {
        case 0: u = view.getUint8(off); v = view.getUint8(off + 1); break;
        case 1: u = view.getInt8(off); v = view.getInt8(off + 1); break;
        case 2: u = view.getUint16(off, false); v = view.getUint16(off + 2, false); break;
        case 3: u = view.getInt16(off, false); v = view.getInt16(off + 2, false); break;
        default: return [view.getFloat32(off, false), view.getFloat32(off + 4, false)];
    }
    const scale = 1 / (2 ** frac);
    return [u * scale, v * scale];
}

export interface DecodedMesh {
    positions: [number, number, number][];
    uvs: [number, number][];
    triangles: [GxVertex, GxVertex, GxVertex][];
    triangleOffsets: number[];
    parts?: DrawPart[];
    trianglePart?: number[];
    // Per-vertex normals when the block's DONormalHeader has its own array
    normals?: [number, number, number][];
    // Per-vertex COLOR0 (RGBA 0-255) when DOColorHeader's numColors > 1 (GX_SRC_VTX)
    colors?: [number, number, number, number][];
    matColor?: [number, number, number, number];
}

function triangulate(primitives: GxPrimitive[]): [[GxVertex, GxVertex, GxVertex], number][] {
    const out: [[GxVertex, GxVertex, GxVertex], number][] = [];
    for (const p of primitives) {
        const vs = p.vertices;
        if (p.kind === 'TRIANGLES') {
            for (let i = 0; i + 2 < vs.length; i += 3)
                out.push([[vs[i], vs[i + 1], vs[i + 2]], p.offset]);
        } else if (p.kind === 'TRISTRIP') {
            for (let i = 0; i < vs.length - 2; i++) {
                const tri: [GxVertex, GxVertex, GxVertex] = i % 2 === 0 ? [vs[i], vs[i + 1], vs[i + 2]] : [vs[i + 1], vs[i], vs[i + 2]];
                out.push([tri, p.offset]);
            }
        } else if (p.kind === 'TRIFAN') {
            for (let i = 1; i < vs.length - 1; i++)
                out.push([[vs[0], vs[i], vs[i + 1]], p.offset]);
        } else if (p.kind === 'QUADS') {
            for (let i = 0; i + 3 < vs.length; i += 4) {
                const a = vs[i], b = vs[i + 1], c = vs[i + 2], d = vs[i + 3];
                out.push([[a, b, c], p.offset]);
                out.push([[a, c, d], p.offset]);
            }
        }
    }
    return out;
}

export enum Color0Format { RGB565 = 0, RGB888 = 1, RGB888x = 2, RGBA4444 = 3, RGBA6666 = 4, RGBA8888 = 5 }

const COLOR0_ENTRY_SIZE: { [k: number]: number } = {
    [Color0Format.RGB565]: 2,
    [Color0Format.RGB888]: 3,
    [Color0Format.RGB888x]: 4,
    [Color0Format.RGBA4444]: 2,
    [Color0Format.RGBA6666]: 3,
    [Color0Format.RGBA8888]: 4,
};

function decodeColor0Entry(view: DataView, off: number, format: Color0Format): [number, number, number, number] {
    switch (format) {
        case Color0Format.RGB565: {
            const v = view.getUint16(off, false);
            return [
                Math.round(((v >>> 11) & 0x1F) * 255 / 31),
                Math.round(((v >>> 5) & 0x3F) * 255 / 63),
                Math.round((v & 0x1F) * 255 / 31),
                255,
            ];
        }
        case Color0Format.RGB888:
        case Color0Format.RGB888x:
            return [view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), 255];
        case Color0Format.RGBA4444: {
            const v = view.getUint16(off, false);
            return [
                ((v >>> 12) & 0xF) * 17, ((v >>> 8) & 0xF) * 17,
                ((v >>> 4) & 0xF) * 17, (v & 0xF) * 17,
            ];
        }
        case Color0Format.RGBA6666: {
            const v = (view.getUint8(off) << 16) | (view.getUint8(off + 1) << 8) | view.getUint8(off + 2);
            return [
                Math.round(((v >>> 18) & 0x3F) * 255 / 63), Math.round(((v >>> 12) & 0x3F) * 255 / 63),
                Math.round(((v >>> 6) & 0x3F) * 255 / 63), Math.round((v & 0x3F) * 255 / 63),
            ];
        }
        case Color0Format.RGBA8888:
            return [view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)];
    }
}

export function decodeBlock(view: DataView, block: GplBlock): DecodedMesh {
    if (block.field0 === null)
        throw new Error("block has no position array");
    const parts = drawParts(view, block);
    if (parts.length === 0)
        throw new Error("block has no draw records");

    const layout = positionLayout(block);
    const posArrayOff = r32(view, block.field0);
    const posCount = block.numPositions ?? 0;

    const positions: [number, number, number][] = [];
    for (let i = 0; i < posCount; i++) {
        const off = posArrayOff + i * layout.entrySize;
        if (layout.float) {
            positions.push([view.getFloat32(off, false), view.getFloat32(off + 4, false), view.getFloat32(off + 8, false)]);
        } else if (layout.compSize === 1) {
            positions.push([view.getInt8(off) * layout.scale, view.getInt8(off + 1) * layout.scale, view.getInt8(off + 2) * layout.scale]);
        } else {
            positions.push([view.getInt16(off, false) * layout.scale, view.getInt16(off + 2, false) * layout.scale, view.getInt16(off + 4, false) * layout.scale]);
        }
    }

    let normals: [number, number, number][] | undefined;
    const nrm = normalLayout(block);
    if (nrm !== null) {
        normals = [];
        const cs = gxCompSize(nrm.compType);
        for (let i = 0; i < nrm.count; i++) {
            const off = nrm.arrayOff + i * nrm.entrySize;
            normals.push([
                readComponent(view, off, nrm.compType) * nrm.scale,
                readComponent(view, off + cs, nrm.compType) * nrm.scale,
                readComponent(view, off + 2 * cs, nrm.compType) * nrm.scale,
            ]);
        }
    }

    let uvs: [number, number][] = [];
    if (block.field2Entries.length > 0 && block.field2Entries[0][1] !== 0 && block.numTexCoords) {
        const uvOff = block.field2Entries[0][1];
        const uvq = block.uvQuantizeInfo !== null ? block.uvQuantizeInfo : 0x40;
        const compFormat = uvq >> 4, frac = uvq & 0xF;
        const entry = uvEntrySize(compFormat);
        for (let i = 0; i < block.numTexCoords; i++)
            uvs.push(decodeUvEntry(view, uvOff + i * entry, compFormat, frac));
    }
    if (uvs.length === 0)
        uvs = [[0, 0]];
    const uvCount = uvs.length;

    let colors: [number, number, number, number][] | undefined;
    let matColor: [number, number, number, number] | undefined;
    if (block.field1 !== null && block.numColors && block.colorQuantizeInfo !== null) {
        const format = (block.colorQuantizeInfo >> 4) as Color0Format;
        const entrySize = COLOR0_ENTRY_SIZE[format];
        if (entrySize !== undefined) {
            const formatHasAlpha = format === Color0Format.RGBA4444 || format === Color0Format.RGBA6666 || format === Color0Format.RGBA8888;
            if (block.colorCompCount !== null && (block.colorCompCount !== 3) !== formatHasAlpha)
                console.warn(`gpl block ${block.index}: DOColorHeader compCount ${block.colorCompCount} disagrees with its color type ${format}`);
            const colorOff = r32(view, block.field1);
            if (block.numColors === 1) {
                matColor = decodeColor0Entry(view, colorOff, format);
            } else {
                colors = [];
                for (let i = 0; i < block.numColors; i++)
                    colors.push(decodeColor0Entry(view, colorOff + i * entrySize, format));
            }
        }
    }

    const triangles: [GxVertex, GxVertex, GxVertex][] = [];
    const triangleOffsets: number[] = [];
    const trianglePart: number[] = [];
    parts.forEach((part, partIdx) => {
        const fmt = vertexFormatFromVcd(part.vcd);
        const prims = findDisplayList(view, part.start, part.end, fmt);
        for (const [tri, offset] of triangulate(prims)) {
            if (!tri.every((v) => v.positionIndex < posCount))
                continue;
            const fixed = tri.map((v) => v.uvIndex < uvCount ? v : { ...v, uvIndex: v.uvIndex % uvCount }) as [GxVertex, GxVertex, GxVertex];
            triangles.push(fixed);
            triangleOffsets.push(offset);
            trianglePart.push(partIdx);
        }
    });

    return { positions, uvs, triangles, triangleOffsets, parts, trianglePart, normals, colors, matColor };
}

export function loadAllMeshes(data: ArrayBufferSlice): Map<number, DecodedMesh> {
    const { blocks, view } = walkBlockTable(data);
    const results = new Map<number, DecodedMesh>();
    for (const block of blocks) {
        if (block.field0 === null || block.field4 === null)
            continue;
        try {
            results.set(block.index, decodeBlock(view, block));
        } catch (e) {
            continue;
        }
    }
    return results;
}

export function transformMesh(mesh: DecodedMesh, m: ReadonlyMat4): DecodedMesh {
    const positions = mesh.positions.map((p): [number, number, number] => {
        const v = vec3.transformMat4(vec3.create(), p, m);
        return [v[0], v[1], v[2]];
    });
    const normalMat = mat3.normalFromMat4(mat3.create(), m);
    const source: [number, number, number][] = mesh.normals !== undefined ? mesh.normals : (() => {
        const out: [number, number, number][] = [];
        const n = [0, 0, 0];
        for (let i = 0; i < NORMAL_COUNT; i++) {
            getNormal(n, i);
            out.push([n[0], n[1], n[2]]);
        }
        return out;
    })();
    const normals = source.map((nrm): [number, number, number] => {
        const v = vec3.transformMat3(vec3.create(), nrm, normalMat);
        vec3.normalize(v, v);
        return [v[0], v[1], v[2]];
    });
    return { ...mesh, positions, normals };
}

//#endregion
