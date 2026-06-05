import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, readString } from "../util.js";

export interface ActClip {
    x: number;
    y: number;
    sprIndex: number;
    mirror: boolean;
    r: number; g: number; b: number; a: number;
    zoomX: number;
    zoomY: number;
    angle: number;
    clipType: number;
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

const MAX_VERSION = 0x0206;

export function recalcClipXY(clip: ActClip, w: number, h: number): void {
    clip.x = ((clip.x - (((w / 2) | 0) + (w % 2)) * clip.zoomX) / clip.zoomX) | 0;
    clip.y = ((clip.y - (((h / 2) | 0) + (h % 2)) * clip.zoomY) / clip.zoomY) | 0;
}

export function parseACT(buffer: ArrayBufferSlice): ActModel {
    const magic = readString(buffer, 0, 2, false);
    assert(magic === "AC");

    const r = new Reader(buffer);
    r.skip(2);
    const ver = r.u16();
    const actionCount = r.u16();
    r.skip(10);
    if (ver > MAX_VERSION)
        throw new Error(`ACT: unsupported version 0x${ver.toString(16)}`);

    const actions: ActAction[] = [];
    for (let i = 0; i < actionCount; i++) {
        const motionCount = r.i32();
        if (motionCount < 0)
            throw new Error(`ACT: bad motion count ${motionCount}`);
        const motions: ActMotion[] = [];

        for (let j = 0; j < motionCount; j++) {

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

                        const w = r.i32();
                        const h = r.i32();
                        if (clip.sprIndex !== -1)
                            recalcClipXY(clip, w, h);
                    }
                }

                clips.push(clip);
            }

            if (ver >= 0x0200)
                r.i32();

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

    if (ver >= 0x0201) {

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
