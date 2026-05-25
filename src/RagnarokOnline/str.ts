
// Parser for Ragnarok Online's STR layered effect format (signature "STRM",
// version 0x0094).
//
// A .str is a stack of layers played over a fixed frame span. Each layer owns
// a list of texture frames (animated flipbook) plus a list of keyframes;
// each keyframe carries a full transform/color/alpha/blend snapshot. POS
// keyframes snap to their values; BASIC keyframes are per-frame deltas
// accumulated into the running transform (see RagEffect ProcessEZ2STR).
// All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// 'STRM' as a little-endian DWORD.
const STR_SIGNATURE = 0x4D525453;
const STR_VERSION = 0x0094;
// Fixed texture-name field width; NUL-padded.
const TEXNAME_BYTES = 128;

export const enum StrKeyframeType {
    Basic = 0,
    Pos = 1,
}

// Texture-frame advance mode (XformData.anitype). The integer values are the
// ones stored in the file and MUST match the engine's enum.
export const enum StrAniType {
    Stop = 0,
    Intp = 1,
    Once = 2,
    Loop = 3,
    RLoop = 4,
    BiLoop = 5,
}

// KAC_XFORMDATA. Field names follow the original struct.
export interface StrXformData {
    x: number;            // screen-space offset from effect origin (px, pre-(/-320,-240) bias)
    y: number;
    u: number; v: number; // base UV
    us: number; vs: number; // UV span
    u2: number; v2: number; // secondary UV (multitexture; unused here)
    us2: number; vs2: number;
    ax: number[];         // 4 quad-corner X positions (px), relative to keyed pos
    ay: number[];
    aniframe: number;     // current texture-frame index (float; floored at draw)
    anitype: number;      // StrAniType
    anidelta: number;     // per-frame texture-frame step
    rz: number;           // rotation about view axis (engine units; /2.844444 -> degrees)
    crR: number; crG: number; crB: number; crA: number; // tint/alpha, 0..255
    srcalpha: number;     // D3DBLEND source factor
    destalpha: number;    // D3DBLEND destination factor
    mtpreset: number;     // multitexture preset (unused here)
}

export interface StrKeyframe {
    frame: number;
    type: number;         // StrKeyframeType
    xform: StrXformData;
}

export interface StrLayer {
    texNames: string[];   // per-frame texture names (relative to texture/effect/)
    keyframes: StrKeyframe[];
}

export interface StrEffect {
    fps: number;
    frameCount: number;   // file's cFrame field (authoring metadata, see keyframeSpan)
    keyframeSpan: number; // highest keyframe frame across all layers; the true length
    layers: StrLayer[];
}

class Reader {
    private view: DataView;
    private bytes: Uint8Array;
    public offs = 0;

    constructor(buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
        this.bytes = buffer.createTypedArray(Uint8Array);
    }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`STR: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u32(): number { this.assertCanRead(4); const v = this.view.getUint32(this.offs, true); this.offs += 4; return v; }
    public i32(): number { this.assertCanRead(4); const v = this.view.getInt32(this.offs, true); this.offs += 4; return v; }
    public f32(): number { this.assertCanRead(4); const v = this.view.getFloat32(this.offs, true); this.offs += 4; return v; }
    public skip(n: number): void { this.assertCanRead(n); this.offs += n; }

    public fixedString(n: number): string {
        this.assertCanRead(n);
        let s = "";
        for (let i = 0; i < n; i++) {
            const c = this.bytes[this.offs + i];
            if (c === 0)
                break;
            s += String.fromCharCode(c);
        }
        this.offs += n;
        return s;
    }
}

function parseXformData(r: Reader): StrXformData {
    const x = r.f32();
    const y = r.f32();
    const u = r.f32();
    const v = r.f32();
    const us = r.f32();
    const vs = r.f32();
    const u2 = r.f32();
    const v2 = r.f32();
    const us2 = r.f32();
    const vs2 = r.f32();
    const ax = [r.f32(), r.f32(), r.f32(), r.f32()];
    const ay = [r.f32(), r.f32(), r.f32(), r.f32()];
    const aniframe = r.f32();
    const anitype = r.u32();
    const anidelta = r.f32();
    const rz = r.f32();
    const crR = r.f32();
    const crG = r.f32();
    const crB = r.f32();
    const crA = r.f32();
    const srcalpha = r.u32();
    const destalpha = r.u32();
    const mtpreset = r.u32();
    return { x, y, u, v, us, vs, u2, v2, us2, vs2, ax, ay, aniframe, anitype, anidelta, rz, crR, crG, crB, crA, srcalpha, destalpha, mtpreset };
}

export function parseSTR(buffer: ArrayBufferSlice): StrEffect {
    const r = new Reader(buffer);

    const sig = r.u32();
    if (sig !== STR_SIGNATURE)
        throw new Error(`STR: bad signature 0x${sig.toString(16)}`);
    const ver = r.u32();
    if (ver !== STR_VERSION)
        throw new Error(`STR: unsupported version 0x${ver.toString(16)}`);

    // Header: frameCount, fps, layerCount, then 16-byte reserved block.
    const frameCount = r.i32();
    const fps = r.i32();
    const layerCount = r.i32();
    r.skip(4 * 4);

    const layers: StrLayer[] = [];
    for (let i = 0; i < layerCount; i++) {
        const texCount = r.i32();
        if (texCount < 0)
            throw new Error(`STR: bad texture count ${texCount}`);
        const texNames: string[] = [];
        for (let t = 0; t < texCount; t++)
            texNames.push(r.fixedString(TEXNAME_BYTES));

        const keyCount = r.i32();
        if (keyCount < 0)
            throw new Error(`STR: bad keyframe count ${keyCount}`);
        const keyframes: StrKeyframe[] = [];
        for (let k = 0; k < keyCount; k++) {
            const frame = r.i32();
            const type = r.u32();
            const xform = parseXformData(r);
            keyframes.push({ frame, type, xform });
        }

        layers.push({ texNames, keyframes });
    }

    // cFrame is authoring metadata only; keyframes routinely extend past it.
    // True playback length is the highest keyframe frame across all layers.
    let keyframeSpan = 0;
    for (const layer of layers)
        for (const k of layer.keyframes)
            if (k.frame > keyframeSpan)
                keyframeSpan = k.frame;

    return { fps, frameCount, keyframeSpan, layers };
}
