import { DataStream } from "./util";

export const INTERP_DISCRETE = 1;
export const INTERP_LINEAR = 2;
export const INTERP_UNK = 3;

// special function for this because bitmap_id comes FIRST, not last, unlike other tracks.
function readTrackTexture(data: DataStream): Track<number> {
    return {
        interp: data.readUint16(),
        frames: data.readArrayDynamic(data.readUint32, (data) => {
            const value = data.readInt32();
            const framestart = data.readUint16();
            return {
                value,
                framestart,
            }
        })
    }
}

function readTrack<T>(data: DataStream, func: (data: DataStream) => T): Track<T> {
    const newfunc = func.bind(data, data);
    return {
        interp: data.readUint16(),
        frames: data.readArrayDynamic(data.readUint32, (data) => {
            // store an extra 'framestart' data to allow binary search of frames
            const framestart = data.readUint16();
            const junk = data.readJunk(2);
            return {
                framestart,
                value: newfunc(),
            }
        })
    }
}

export type Track<T> = {
    interp: number;
    frames: {
        framestart: number;
        value: T;
    }[];
}

/// Search for `value` within `idx`, returning its index. If `value` does not exist,
/// it will return the index of the value before it.
/// Returns undefined if ls is empty, or if `value` is less than all other values in the array.
export function binarySearch<T, U>(ls: T[], value: U, cmp: (a: T, b: U) => number): number | undefined {
    if (ls.length === 0) {
        return undefined;
    }
    let l = 0;
    let r = ls.length;
    while (l < r) {
        const m = Math.floor((l + r) / 2);
        if (cmp(ls[m], value) > 0) {
            r = m
        }
        else {
            l = m + 1;
        }
    }
    const ret = r - 1;
    if (ret < 0) {
        return undefined;
    }
    else {
        return ret;
    }
}

export function getTrackFrameIndex<T>(track: Track<T>, frame: number): number | undefined {
    return binarySearch(track.frames, frame, (a, b) => a.framestart - b);
}

export function interpTrack<T>(track: Track<T>, frame: number, interp: (a: T, b: T, t: number) => T): T | undefined {
    const index = getTrackFrameIndex(track, frame);
    if (index === undefined) {
        return undefined;
    }
    if (track.interp !== INTERP_LINEAR || track.frames[index].framestart === frame || index + 1 >= track.frames.length) {
        // if this is an exact frame match, or there are no frames after this to interpolate with,
        // just return the value.
        return track.frames[index].value;
    }
    // interpolate and return
    const a = track.frames[index];
    const b = track.frames[index + 1];
    const t = (frame - a.framestart) / (b.framestart - a.framestart);
    return interp(a.value, b.value, t);
}

export function interpTrackInPlace<T>(
    out: T,
    track: Track<T>,
    frame: number,
    interp: (out: T, a: T, b: T, t: number) => void,
    copy: (out: T, a: T) => void,
): boolean {
    const index = getTrackFrameIndex(track, frame);
    if (index === undefined) {
        return false;
    }
    if (track.interp !== INTERP_LINEAR || track.frames[index].framestart === frame || index + 1 >= track.frames.length) {
        // if this is an exact frame match, or there are no frames after this to interpolate with,
        // just return the value.
        copy(out, track.frames[index].value);
        return true;
    }
    // interpolate and return
    const a = track.frames[index];
    const b = track.frames[index + 1];
    const t = (frame - a.framestart) / (b.framestart - a.framestart);
    interp(out, a.value, b.value, t);
    return true;
}

export function readMaterialAnim(data: DataStream) {
    return {
        unk0: data.readUint8(),
        length: data.readFloat32(),
        texture: readTrackTexture(data),
        scroll: readTrack(data, data.readVec2),
        stretch: readTrack(data, data.readVec2),
        rotation: readTrack(data, data.readFloat32),
        color: readTrack(data, data.readRGB),
        emission: readTrack(data, data.readRGB),
        alpha: readTrack(data, data.readFloat32),
        unk1: readTrack(data, data.readUint32),
        unk2: readTrack(data, data.readUint32),
        unk3: readTrack(data, data.readUint32),
        material_id: data.readInt32(),
    }
}

export type MaterialAnim = ReturnType<typeof readMaterialAnim>;