
// Parser for Ragnarok Online's ACT animation format (magic "AC"). Drives a
// matching .spr: each logical state occupies 8 consecutive actions (one per
// facing). Reads are version-gated; older versions fill missing fields with
// the documented defaults. All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

export interface ActClip {
    x: number;
    y: number;
    sprIndex: number;     // -1 = unused slot
    mirror: boolean;
    r: number; g: number; b: number; a: number; // tint, 0..255
    zoomX: number;
    zoomY: number;
    angle: number;        // degrees
    clipType: number;     // 0 = palette-indexed frame set, else rgba
}

export interface ActMotion {
    clips: ActClip[];
}

export interface ActAction {
    motions: ActMotion[];
}

export interface ActModel {
    version: number;
    actions: ActAction[];
    delay: number[];      // per-action playback delay, default 4.0
}

class Reader {
    private view: DataView;
    public offs = 0;

    constructor(buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`ACT: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u8(): number { this.assertCanRead(1); const v = this.view.getUint8(this.offs); this.offs += 1; return v; }
    public u16(): number { this.assertCanRead(2); const v = this.view.getUint16(this.offs, true); this.offs += 2; return v; }
    public i32(): number { this.assertCanRead(4); const v = this.view.getInt32(this.offs, true); this.offs += 4; return v; }
    public f32(): number { this.assertCanRead(4); const v = this.view.getFloat32(this.offs, true); this.offs += 4; return v; }
    public skip(n: number): void { this.assertCanRead(n); this.offs += n; }
}

const MAX_VERSION = 0x0206;

// Recenters a clip whose stored origin is the sprite's top-left to one centered
// on the sprite, matching the original loader's ReCalcClipXY. From version
// 0x0205 the half-size flags are forced off (the clip carries its own w/h).
export function recalcClipXY(clip: ActClip, w: number, h: number, halfW: boolean, halfH: boolean): void {
    let cx = w;
    let cy = h;
    if (halfW) cx *= 2;
    if (halfH) cy *= 2;
    clip.x = ((clip.x - (((cx / 2) | 0) + (cx % 2)) * clip.zoomX) / clip.zoomX) | 0;
    clip.y = ((clip.y - (((cy / 2) | 0) + (cy % 2)) * clip.zoomY) / clip.zoomY) | 0;
}

export function parseACT(buffer: ArrayBufferSlice): ActModel {
    const r = new Reader(buffer);

    const id = r.u16();
    const ver = r.u16();
    const actionCount = r.u16();
    r.skip(10); // reserved
    // Magic 'AC' stored as bytes 'A','C' => little-endian word 'C'<<8 | 'A'.
    if (id !== (("C".charCodeAt(0) << 8) | "A".charCodeAt(0)))
        throw new Error(`ACT: bad magic 0x${id.toString(16)}`);
    if (ver > MAX_VERSION)
        throw new Error(`ACT: unsupported version 0x${ver.toString(16)}`);

    const actions: ActAction[] = [];
    for (let i = 0; i < actionCount; i++) {
        const motionCount = r.i32();
        if (motionCount < 0)
            throw new Error(`ACT: bad motion count ${motionCount}`);
        const motions: ActMotion[] = [];

        for (let j = 0; j < motionCount; j++) {
            // range1 / range2 (attack/body bounding rects): unused.
            r.skip(16);
            r.skip(16);
            const clipCount = r.i32();
            if (clipCount < 0)
                throw new Error(`ACT: bad clip count ${clipCount}`);
            const clips: ActClip[] = [];

            for (let k = 0; k < clipCount; k++) {
                const clip: ActClip = {
                    x: 0, y: 0, sprIndex: -1, mirror: false,
                    r: 255, g: 255, b: 255, a: 255,
                    zoomX: 1.0, zoomY: 1.0, angle: 0, clipType: 0,
                };

                clip.x = r.i32();
                clip.y = r.i32();
                clip.sprIndex = r.i32();
                clip.mirror = r.i32() !== 0;

                if (ver >= 0x0200) {
                    clip.r = r.u8();
                    clip.g = r.u8();
                    clip.b = r.u8();
                    clip.a = r.u8();
                    if (ver < 0x0204) {
                        const zoom = r.f32();
                        clip.zoomX = zoom;
                        clip.zoomY = zoom;
                    } else {
                        clip.zoomX = r.f32();
                        clip.zoomY = r.f32();
                    }
                    clip.angle = r.i32();
                    clip.clipType = r.i32();

                    if (ver >= 0x0205) {
                        // Clip carries its own width/height and is recentered
                        // against THEM; older versions defer recentering to the
                        // renderer using the referenced .spr frame's dims.
                        const w = r.i32();
                        const h = r.i32();
                        if (clip.sprIndex !== -1)
                            recalcClipXY(clip, w, h, false, false);
                    }
                }

                clips.push(clip);
            }

            if (ver >= 0x0200)
                r.i32(); // event id

            if (ver >= 0x0203) {
                // attach points: 16 bytes each, unused.
                const attachCount = r.i32();
                if (attachCount < 0)
                    throw new Error(`ACT: bad attach count ${attachCount}`);
                for (let a = 0; a < attachCount; a++)
                    r.skip(16);
            }

            motions.push({ clips });
        }

        actions.push({ motions });
    }

    if (ver >= 0x0201) {
        // Event-name table: 40-byte fixed strings, skipped.
        const eventCount = r.i32();
        if (eventCount < 0)
            throw new Error(`ACT: bad event count ${eventCount}`);
        r.skip(eventCount * 40);
    }

    const delay: number[] = new Array(actionCount).fill(4.0);
    if (ver >= 0x0202) {
        for (let i = 0; i < actionCount; i++)
            delay[i] = r.f32();
    }

    return { version: ver, actions, delay };
}
