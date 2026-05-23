
// Parser for Ragnarok Online's STR layered effect format (signature "STRM",
// version 0x0094).
//
// A .str describes a single screen-space effect as a stack of LAYERS played over
// a fixed frame span at a fixed fps. Each layer owns a list of texture frames
// (its animated flipbook) plus a list of KEYFRAMES; each keyframe carries a full
// transform/color/alpha/blend snapshot at a frame index. The original engine
// (RagEffect) plays the effect by, per render frame, walking each layer's
// keyframes and either snapping to (POS keyframes) or accumulating the deltas of
// (BASIC keyframes) the transform, then drawing the layer's current texture frame
// as a screen-space quad with the keyframed position, rotation, scale, tint and
// source/destination blend factors.
//
// We parse the file faithfully; the renderer (effect.ts) reinterprets the
// screen-space quad as a world-space billboard. All multi-byte values are
// little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// Signature 'STRM' as a little-endian DWORD ('M'<<24 | 'R'<<16 | 'T'<<8 | 'S').
const STR_SIGNATURE = 0x4D525453;
// Only version we accept, matching the original loader's KSTR_VERSION check.
const STR_VERSION = 0x0094;
// Fixed texture-name field width in the file (the loader grabs 128 raw bytes per
// name, NUL-padded).
const TEXNAME_BYTES = 128;

// Keyframe type: a POS keyframe replaces the running transform with its snapshot;
// any other type is a BASIC keyframe whose fields are added to the running
// transform each elapsed frame (see EZeffect / RagEffect ProcessEZ2STR).
export const enum StrKeyframeType {
    Basic = 0,
    Pos = 1,
}

// Texture-frame advance mode (XformData.anitype). Mirrors the engine's
// ANIT_* switch: how aniframe steps each elapsed frame. The integer values are
// the ones stored in the file and MUST match the engine's enum exactly.
export const enum StrAniType {
    Stop = 0,    // hold the current frame
    Intp = 1,    // advance aniframe by its keyed aniframe delta directly
    Once = 2,    // advance by anidelta, clamp at the last frame
    Loop = 3,    // advance by anidelta, wrap at cTex
    RLoop = 4,   // advance backwards, wrap at 0
    BiLoop = 5,  // ping-pong across the frame range
}

// One keyframe's full transform/appearance snapshot (KAC_XFORMDATA). For a POS
// keyframe these are absolute; for a BASIC keyframe they are per-frame deltas
// added into the running state. Field names follow the original struct.
export interface StrXformData {
    x: number;            // screen-space offset from the effect origin (px, pre-(/-320,-240) bias)
    y: number;
    u: number; v: number; // base UV
    us: number; vs: number; // UV span (width/height in texture space)
    u2: number; v2: number; // secondary UV (multitexture; unused by our renderer)
    us2: number; vs2: number;
    ax: number[];         // 4 quad-corner X positions (px), relative to the keyed pos
    ay: number[];         // 4 quad-corner Y positions (px)
    aniframe: number;     // current texture-frame index (float; floored at draw)
    anitype: number;      // StrAniType: how aniframe advances
    anidelta: number;     // per-frame texture-frame step
    rz: number;           // rotation about view axis (engine units; /2.844444 -> degrees)
    crR: number; crG: number; crB: number; crA: number; // tint/alpha, 0..255
    srcalpha: number;     // D3DBLEND source factor
    destalpha: number;    // D3DBLEND destination factor
    mtpreset: number;     // multitexture preset (unused by our renderer)
}

export interface StrKeyframe {
    frame: number;        // frame index this keyframe applies at
    type: number;         // StrKeyframeType
    xform: StrXformData;
}

// One effect layer: an animated set of texture frames plus its keyframe track.
export interface StrLayer {
    texNames: string[];   // per-frame texture file names (relative to texture/effect/)
    keyframes: StrKeyframe[];
}

// A decoded .str effect.
export interface StrEffect {
    fps: number;          // authoring metadata only (the engine plays at the fixed game tick, not this)
    frameCount: number;   // the file's cFrame field (NOT the keyframe span; see keyframeSpan)
    keyframeSpan: number; // the highest keyframe frame index across all layers; the true length of the animation
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

    // Reads a fixed-width, NUL-padded ASCII string field. RO effect texture names
    // are plain ASCII (no CP949 directory parts), so a byte->char map is enough.
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

    // The loader reads frameCount, fps, layerCount in this order, then skips a
    // 16-byte (4 DWORD) reserved/dummy block.
    const frameCount = r.i32();
    const fps = r.i32();
    const layerCount = r.i32();
    r.skip(4 * 4); // reserved

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

    // The file's cFrame field is authoring metadata and does NOT bound the
    // animation: keyframes routinely extend past it (the engine drives playback
    // by walking keyframes, gated by a per-effect duration, not by cFrame). The
    // true length of one play-through is the highest keyframe frame across all
    // layers, so a loop must run to there and not restart at cFrame.
    let keyframeSpan = 0;
    for (const layer of layers)
        for (const k of layer.keyframes)
            if (k.frame > keyframeSpan)
                keyframeSpan = k.frame;

    return { fps, frameCount, keyframeSpan, layers };
}
