import ArrayBufferSlice from "../ArrayBufferSlice.js";

const STR_SIGNATURE = 0x4D525453;
const STR_VERSION = 0x0094;

const TEXNAME_BYTES = 128;

export const enum StrKeyframeType {
    Basic = 0,
    Pos = 1,
}

export const enum StrAniType {
    Stop = 0,
    Intp = 1,
    Once = 2,
    Loop = 3,
    RLoop = 4,
    BiLoop = 5,
}

export interface StrXformData {
    x: number;
    y: number;
    u: number; v: number;
    us: number; vs: number;
    u2: number; v2: number;
    us2: number; vs2: number;
    ax: number[];
    ay: number[];
    aniframe: number;
    anitype: number;
    anidelta: number;
    rz: number;
    crR: number; crG: number; crB: number; crA: number;
    srcalpha: number;
    destalpha: number;
    mtpreset: number;
}

export interface StrKeyframe {
    frame: number;
    type: number;
    xform: StrXformData;
}

export interface StrLayer {
    texNames: string[];
    keyframes: StrKeyframe[];
}

export interface StrEffect {
    fps: number;
    frameCount: number;
    keyframeSpan: number;
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

    let keyframeSpan = 0;
    for (const layer of layers)
        for (const k of layer.keyframes)
            if (k.frame > keyframeSpan)
                keyframeSpan = k.frame;

    return { fps, frameCount, keyframeSpan, layers };
}
