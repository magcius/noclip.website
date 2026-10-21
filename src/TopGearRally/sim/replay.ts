import { s8, u8 } from "./f32.js";
import { INPUT_RECORDERS, MAX_PLAYERS } from "./types.js";

const RLE_MIN_RUN = 3;
const RLE_MAX_RUN = 132;
const RLE_MAX_LITERAL = 128;
const RLE_BLOCK_HEADER = 4;

export const RECORDING_HEADER_SIZE = 8;
export const RECORDING_CAPACITY = 0xde5c;
export const LAST_LAP_RECORDING_SIZE = 0x3840;
export const LAST_LAP_FIRST_SLOT = 3;
export const PAUSED_CLOCK_STATE_SIZE = 0x40;
export const INPUT_RECORDING_STRIDE = 0xf000;

export const g_abGhostRecording = new Uint8Array(RECORDING_CAPACITY);
export const g_abPlaybackRecording = new Uint8Array(RECORDING_CAPACITY);
export const g_aabInputRecordings: Uint8Array[] = Array.from({ length: INPUT_RECORDERS }, () => new Uint8Array(INPUT_RECORDING_STRIDE));
export const g_apReplayGhostPtrs: (Uint8Array | null)[] = new Array<Uint8Array | null>(MAX_PLAYERS).fill(null);
export const g_adwReplayGhostSizes: number[] = new Array<number>(MAX_PLAYERS).fill(0);
export const g_abPausedClockState = new Uint8Array(PAUSED_CLOCK_STATE_SIZE);

export const replayGlobals = {
    g_dwGhostRecordingSize: 0,
    g_dwBestReplayLength: 0,
    g_dwBestReplayPlayer: 0,
};

export function CompressRleChannels(dst: Uint8Array, dstSize: number, src: Uint8Array, srcSize: number, channels: number): number {
    let out = 0;
    let channel = 0;
    let base = 0;
    let current = 0;
    let previous = 0;

    do {
        const header = out;
        if (dstSize >>> 0 < (out + RLE_BLOCK_HEADER) >>> 0) {
            return -1;
        }
        out += RLE_BLOCK_HEADER;
        let i = 0;
        let literal = 0;
        let run = 0;
        for (;;) {
            previous = current;
            i += channels;
            current = s8(src[base + i] ?? 0);
            if (current === previous && i - run <= channels * RLE_MAX_RUN && i - literal <= channels * RLE_MAX_LITERAL && i < srcSize) {
                continue;
            }
            let flushRunOnly = false;
            if (i - run < channels * RLE_MIN_RUN) {
                run = i;
                if (i < srcSize) {
                    continue;
                }
            } else if (literal === run) {
                flushRunOnly = true;
            }
            if (!flushRunOnly) {
                if (out + Math.trunc((run - literal) / channels) >= dstSize) {
                    return -1;
                }
                dst[out++] = u8(Math.trunc(-(run - literal) / channels));
                for (; literal < run; literal += channels) {
                    dst[out++] = src[base + literal];
                }
            }
            literal = i;
            if (run !== i) {
                if (dstSize < out + 2) {
                    return -1;
                }
                dst[out++] = u8(Math.trunc((i - run - channels * RLE_MIN_RUN) / channels));
                dst[out++] = u8(previous);
            }
            run = i;
            if (i >= srcSize) {
                break;
            }
        }
        const blockLength = out - header - RLE_BLOCK_HEADER;
        new DataView(dst.buffer, dst.byteOffset, dst.byteLength).setInt32(header, blockLength, false);
        base++;
        channel++;
    } while (channel < channels);
    return out;
}

export function DecompressInterleavedRle(dst: Uint8Array, dstSize: number, packed: Uint8Array, channels: number): number {
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let out = 0;
    let used = 0;
    let src = 0;

    for (let channel = 0; channel < channels; channel++) {
        out = 0;
        const length = view.getInt32(src, false);
        used += RLE_BLOCK_HEADER;
        const end = used + length;
        src += RLE_BLOCK_HEADER;
        while (used < end) {
            let code = s8(packed[src++]);
            used++;
            if (code < 0) {
                for (let count = -code; count !== 0; count--) {
                    dst[channel + out] = packed[src++];
                    out += channels;
                    used++;
                }
            } else {
                let count = code + RLE_MIN_RUN;
                code = packed[src++];
                used++;
                for (; count !== 0; count--) {
                    dst[channel + out] = code;
                    out += channels;
                }
            }
        }
    }
    return out;
}
