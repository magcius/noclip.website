
// Parser for Ragnarok Online's ACT animation format (magic "AC").
//
// An .act drives an .spr: it is a flat list of actions, where (by RO
// convention) each logical state occupies 8 consecutive actions, one per facing
// direction. An action is an ordered list of motion frames; each motion is a
// set of sprite "clips" (one drawn .spr image with its own offset, tint, zoom,
// mirror and rotation). A trailing per-action delay table gives the playback
// cadence (roughly milliseconds-per-frame at the original ~60fps).
//
// Fields are promoted to the newest layout regardless of the file version that
// produced them; older versions fill the missing fields with the documented
// defaults. Reads are version-gated exactly as the original loader.
//
// All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// One sprite reference within a motion frame: which .spr image to draw, where,
// and how to tint/scale/mirror/rotate it. clip_type selects the frame set
// (0 = palette-indexed, otherwise the true-color RGBA frames).
export interface ActClip {
    x: number;
    y: number;
    sprIndex: number;     // -1 = unused slot
    mirror: boolean;      // horizontal flip
    r: number; g: number; b: number; a: number; // tint, 0..255
    zoomX: number;
    zoomY: number;
    angle: number;        // degrees
    clipType: number;
}

// One animation frame: the set of clips composited for that frame.
export interface ActMotion {
    clips: ActClip[];
}

// One action: an ordered list of motion frames.
export interface ActAction {
    motions: ActMotion[];
}

// A decoded .act: the actions, the per-action playback delay table (one entry
// per action, default 4.0), and the source file version.
export interface ActModel {
    version: number;
    actions: ActAction[];
    delay: number[];
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

// Highest ACT version we accept; matches the original loader and the modern
// corpus ceiling.
const MAX_VERSION = 0x0206;

// Recenters a clip whose stored origin is the sprite's top-left to one centered
// on the sprite, matching the original loader's ReCalcClipXY. The half-size
// flags double the source dimensions; from version 0x0205 they are forced off
// (the clip carries its own width/height). Applied in-place.
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
    // Magic 'AC' is stored as bytes 'A','C' => little-endian word 'C'<<8 | 'A'.
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
            // range1 / range2 (attack/body bounding rects): present but unused by
            // the render slice.
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
                        // A single uniform zoom, promoted to zoomX/zoomY.
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
                        // The clip carries its own source width/height and is
                        // recentered against THEM (half-flags forced off). Older
                        // versions defer recentering to the renderer, which uses
                        // the referenced .spr frame's dimensions instead.
                        const w = r.i32();
                        const h = r.i32();
                        if (clip.sprIndex !== -1)
                            recalcClipXY(clip, w, h, false, false);
                    }
                }

                clips.push(clip);
            }

            // event id (>= 0x0200; 0x0200 itself has no usable id)
            if (ver >= 0x0200)
                r.i32();

            // attach points (>= 0x0203): 16 bytes each, unused by the render slice.
            if (ver >= 0x0203) {
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

    // Event-name table (>= 0x0201): 40-byte fixed strings, skipped.
    if (ver >= 0x0201) {
        const eventCount = r.i32();
        if (eventCount < 0)
            throw new Error(`ACT: bad event count ${eventCount}`);
        r.skip(eventCount * 40);
    }

    // Per-action delay table (>= 0x0202); default 4.0 per action otherwise.
    const delay: number[] = new Array(actionCount).fill(4.0);
    if (ver >= 0x0202) {
        for (let i = 0; i < actionCount; i++)
            delay[i] = r.f32();
    }

    return { version: ver, actions, delay };
}
