import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { SRT0, parseResDict, parseResDictGeneric } from '../nns_g3d/NNS_G3D.js';
import { assert, readString } from '../util.js';

export function parseTextureAnimation(buffer: ArrayBufferSlice): { srt0: SRT0 } {
    const file = buffer.createDataView(), block = file.getUint32(16, true);
    assert(readString(buffer, 0, 4) === 'BTA0' && file.getUint32(8, true) === buffer.byteLength);
    assert(readString(buffer, block, 4) === 'SRT0');
    const entries = parseResDict(buffer, block + 8);
    assert(entries.length === 1);
    const data = buffer.slice(block + entries[0].value), v = data.createDataView(), duration = v.getUint16(4, true);
    assert(duration > 0 && readString(data, 0, 4, false) === 'M\x00AT');
    const tracks = parseResDictGeneric(data, 8, (_, p) => {
        const channel = (c: number) => {
            const flags = v.getUint32(p + c * 8, true), parameter = v.getUint32(p + c * 8 + 4, true);
            const step = 1 << (flags >>> 30), constant = !!(flags & 0x20000000), small = !!(flags & 0x10000000);
            const n = constant ? 1 : Math.ceil(duration / step);
            const frames = Array.from({ length: n }, (_, i) => {
                let value: number;
                if (c === 2) {
                    assert(!small);
                    const packed = constant ? parameter : v.getUint32(parameter + i * 4, true);
                    value = Math.atan2((packed << 16) >> 16, packed >> 16);
                } else if (constant) value = (small ? (parameter << 16) >> 16 : parameter | 0) / 4096;
                else value = (small ? v.getInt16(parameter + i * 2, true) : v.getInt32(parameter + i * 4, true)) / 4096;
                return { frame: i * step, value };
            });
            if ((v.getUint8(6) & 2) && frames.length > 1) frames.push({ frame: duration, value: frames[0].value });
            return { frames };
        };
        return { scaleS: channel(0), scaleT: channel(1), rot: channel(2), transS: channel(3), transT: channel(4) };
    });
    return { srt0: { duration, entries: tracks.map((t) => ({ name: t.name, ...t.value })) } };
}

export function sampleTextureTrack(track: SRT0['entries'][number]['scaleS'], frame: number, angle = false): number {
    const frames = track.frames;
    if (frame <= frames[0].frame) return frames[0].value;
    let i = 1;
    while (i < frames.length && frame >= frames[i].frame) i++;
    if (i === frames.length) return frames[i - 1].value;
    const a = frames[i - 1], b = frames[i];
    let delta = b.value - a.value;
    if (angle) delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    return a.value + delta * (frame - a.frame) / (b.frame - a.frame);
}
