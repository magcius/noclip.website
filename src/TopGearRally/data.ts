import ArrayBufferSlice from "../ArrayBufferSlice.js";

/**
 * TGR track binary format parser.
 *
 * TGR1 header (32 bytes, little-endian):
 *   +0x00  u32  magic 'TGR1' (0x31524754).
 *   +0x04  u32  version (1).
 *   +0x08  u32  pointerBase.
 *   +0x0C  u32  dataSize.
 *   +0x10  u32  instanceTableOffset.
 *   +0x14  u32  instanceCount.
 *   +0x18  u32  skyboxDLOffset.
 *   +0x1C  u32  dataOffset (32).
 *
 * TGR2 header (48 bytes, little-endian) extends TGR1:
 *   +0x00  u32  magic 'TGR2' (0x32524754).
 *   +0x04-0x1C  same as TGR1 (dataOffset = 0x30).
 *   +0x20  u32  winterPaletteOffset.
 *   +0x24  u32  winterPaletteCount.
 *   +0x28  u32  animTexOffset.
 *   +0x2C  u32  animTexCount.
 *
 * Winter palette override entry (variable size):
 *   +0x00  u32  destOffset (byte offset within track data).
 *   +0x04  u16  size (0x20 for CI4, 0x200 for CI8).
 *   +0x06  u16  padding.
 *   +0x08  data[size].
 *
 * Animated texture channel (variable size):
 *   +0x00  u32  destOffset.
 *   +0x04  u32  texSize.
 *   +0x08  u32  keyframeCount.
 *   Per keyframe: +0x00 u32 timeMs, then texSize bytes of data.
 */

/** Single track instance with transform matrix, DL pointer, and flags. */
export interface TGRTrackInstance {
    /** 4x4 float matrix (row-major, big-endian in source data). */
    matrix: Float32Array;
    /** DL offset within track data (rebased from absolute N64 pointer). */
    dlOffset: number;
    /** Instance flags (u16 at instance+0x4C). */
    flags: number;
    /** Original index in the instance table (before filtering). */
    rawIndex: number;
}

/** Animation table entry from track header+0x164. */
export interface TGRAnimEntry {
    /** Animation type (0-7). */
    type: number;
    /** Instance index (types 0-3,7) or pointer (types 4-5). */
    data: number;
    /** Speed as float bits (types 0-2), node count (type 4), etc. */
    params: number;
}

/** Dual-rail spline path for type 3 (spline follower) animations. */
export interface TGRSplineData {
    /** Instance that follows this spline path. */
    followerInstanceIndex: number;
    /** Left rail: interleaved x,y,z float triplets in N64 space. */
    leftRail: Float32Array;
    /** Right rail: interleaved x,y,z float triplets in N64 space. */
    rightRail: Float32Array;
    /** Number of nodes in each rail. */
    nodeCount: number;
}

/** Single keyframe within an animated texture channel. */
export interface TGRAnimTexKeyframe {
    /** Timestamp in milliseconds within the animation cycle. */
    time: number;
    /** Raw N64 texture data for this keyframe. */
    texData: Uint8Array;
}

/** Animated texture channel with multiple keyframes. */
export interface TGRAnimTexChannel {
    /** Byte offset within track data where texture is written. */
    destOffset: number;
    /** Size of each keyframe's texture data in bytes. */
    texSize: number;
    /** Keyframes sorted by time. */
    keyframes: TGRAnimTexKeyframe[];
}

/** Winter palette override entry (summer/winter texture variant). */
export interface WinterPaletteOverride {
    /** Byte offset within track data. */
    destOffset: number;
    /** Palette size in bytes (0x20 for CI4, 0x200 for CI8). */
    size: number;
    /** Raw winter palette bytes. */
    data: Uint8Array;
}

/** Parsed track data with all geometry, textures, and animation info. */
export interface TGRTrack {
    /** N64 DRAM base address (typically 0x80025c00). */
    pointerBase: number;
    /** Raw track data blob (DLs, vertices, textures with summer palettes). */
    dataBuffer: ArrayBufferSlice;
    /** Renderable instances with valid DL pointers. */
    instances: TGRTrackInstance[];
    /** Skybox display list offset within track data. */
    skyboxDLOffset: number;
    /** Winter palette overrides for weather switching. */
    winterOverrides: WinterPaletteOverride[];
    /** Animation table entries from track header+0x164. */
    animEntries: TGRAnimEntry[];
    /** Spline follower paths parsed from animation entries. */
    splines: TGRSplineData[];
    /** Animated texture channels with per-keyframe data. */
    animTexChannels: TGRAnimTexChannel[];
}

const TGR1_MAGIC = 0x31524754;
const TGR2_MAGIC = 0x32524754;

/**
 * Parse a TGR1/TGR2 track binary into structured data.
 * @param {ArrayBufferSlice} buffer Raw file contents.
 * @returns {TGRTrack} Parsed track data.
 */
export function parseTGRTrack(buffer: ArrayBufferSlice): TGRTrack {
    const view = buffer.createDataView();

    const magic = view.getUint32(0x00, true);
    if (magic !== TGR1_MAGIC && magic !== TGR2_MAGIC) {
        throw new Error(`Invalid TGR track magic: 0x${magic.toString(16)}`);
    }

    const isTGR2 = magic === TGR2_MAGIC;

    const pointerBase = view.getUint32(0x08, true);
    const dataSize = view.getUint32(0x0c, true);
    const instanceTableOffset = view.getUint32(0x10, true);
    const instanceCount = view.getUint32(0x14, true);
    let skyboxDLOffset = view.getUint32(0x18, true);
    const dataOffset = view.getUint32(0x1c, true);

    // Fallback: if header has no sky offset, read from track data +0x50.
    if (skyboxDLOffset === 0 && dataOffset + 0x54 <= view.byteLength) {
        // Big-endian in track data.
        const skyPtr = view.getUint32(dataOffset + 0x50, false);
        if (skyPtr >= pointerBase && skyPtr < pointerBase + dataSize) {
            skyboxDLOffset = skyPtr - pointerBase;
        }
    }

    // TGR2 extended header.
    let winterPaletteOffset = 0;
    let winterPaletteCount = 0;
    if (isTGR2) {
        winterPaletteOffset = view.getUint32(0x20, true);
        winterPaletteCount = view.getUint32(0x24, true);
    }

    // Slice out the raw track data.
    const dataBuffer = buffer.slice(dataOffset, dataOffset + dataSize);
    const dataView = dataBuffer.createDataView();

    // Parse instances.
    const instances: TGRTrackInstance[] = [];
    const INSTANCE_STRIDE = 0x54;

    for (let i = 0; i < instanceCount; i++) {
        const instOff = instanceTableOffset + i * INSTANCE_STRIDE;
        if (instOff + INSTANCE_STRIDE > dataSize) {
            break;
        }

        // Read 4x4 float matrix (big-endian in N64 data).
        const matrix = new Float32Array(16);
        for (let j = 0; j < 16; j++) {
            matrix[j] = dataView.getFloat32(instOff + j * 4, false);
        }

        // Skip zero-matrix instances (sentinels).
        if (matrix[0] === 0 && matrix[5] === 0 && matrix[10] === 0) {
            continue;
        }

        // Read DL pointer and rebase from absolute N64 address.
        const dlPtr = dataView.getUint32(instOff + 0x44, false);
        if (dlPtr < pointerBase || dlPtr >= pointerBase + dataSize) {
            continue;
        }
        const dlOffset = dlPtr - pointerBase;

        // Read flags.
        const flags = dataView.getUint16(instOff + 0x4c, false);

        instances.push({ matrix, dlOffset, flags, rawIndex: i });
    }

    // Parse winter palette overrides (TGR2 only).
    const winterOverrides: WinterPaletteOverride[] = [];
    if (isTGR2 && winterPaletteCount > 0 && winterPaletteOffset > 0) {
        let off = winterPaletteOffset;
        for (let i = 0; i < winterPaletteCount; i++) {
            if (off + 8 > view.byteLength) {
                break;
            }
            const destOffset = view.getUint32(off, true);
            const size = view.getUint16(off + 4, true);
            off += 8;
            if (off + size > view.byteLength) {
                break;
            }
            const data = buffer.createTypedArray(Uint8Array, off, size);
            winterOverrides.push({ destOffset, size, data });
            off += size;
        }
    }

    // Parse animation entries from track header.
    const animEntries: TGRAnimEntry[] = [];
    const ANIM_TABLE_OFFSET = 0x164;
    const ANIM_COUNT_OFFSET = 0x224;
    if (ANIM_COUNT_OFFSET + 4 <= dataSize) {
        const animCount = dataView.getUint32(
            ANIM_COUNT_OFFSET,
            false, // Big-endian.
        );
        for (let i = 0; i < animCount; i++) {
            const base = ANIM_TABLE_OFFSET + i * 12;
            if (base + 12 > dataSize) {
                break;
            }
            const data = dataView.getUint32(base, false);
            const params = dataView.getUint32(base + 4, false);
            const type = dataView.getUint8(base + 8);
            animEntries.push({ type, data, params });
        }
    }

    // Parse spline data from animation entries (types 3-5).
    const splines: TGRSplineData[] = [];
    {
        let followerIdx = -1;
        let leftRailPtr = 0;
        let rightRailPtr = 0;
        let nodeCount = 0;
        for (const anim of animEntries) {
            if (anim.type === 3) {
                followerIdx = anim.data;
            } else if (anim.type === 4) {
                leftRailPtr = anim.data;
                nodeCount = anim.params;
            } else if (anim.type === 5) {
                rightRailPtr = anim.data;
            }
        }
        if (
            followerIdx >= 0 &&
            leftRailPtr >= pointerBase &&
            rightRailPtr >= pointerBase &&
            nodeCount > 0
        ) {
            const leftOff = leftRailPtr - pointerBase;
            const rightOff = rightRailPtr - pointerBase;
            const floatCount = nodeCount * 3;
            if (leftOff + floatCount * 4 <= dataSize && rightOff + floatCount * 4 <= dataSize) {
                const leftRail = new Float32Array(floatCount);
                const rightRail = new Float32Array(floatCount);
                for (let i = 0; i < floatCount; i++) {
                    leftRail[i] = dataView.getFloat32(leftOff + i * 4, false);
                    rightRail[i] = dataView.getFloat32(rightOff + i * 4, false);
                }
                splines.push({
                    followerInstanceIndex: followerIdx,
                    leftRail,
                    rightRail,
                    nodeCount,
                });
            }
        }
    }

    // Parse animated texture channels (TGR2 only).
    const animTexChannels: TGRAnimTexChannel[] = [];
    if (isTGR2) {
        const animTexOffset = view.getUint32(0x28, true);
        const animTexCount = view.getUint32(0x2c, true);
        if (animTexOffset > 0 && animTexCount > 0 && animTexOffset < view.byteLength) {
            // Skip the count u32 (redundant with header).
            let aoff = animTexOffset + 4;
            for (let i = 0; i < animTexCount; i++) {
                if (aoff + 12 > view.byteLength) {
                    break;
                }
                const destOffset = view.getUint32(aoff, true);
                const texSize = view.getUint32(aoff + 4, true);
                const kfCount = view.getUint32(aoff + 8, true);
                aoff += 12;
                const keyframes: TGRAnimTexKeyframe[] = [];
                for (let k = 0; k < kfCount; k++) {
                    if (aoff + 4 + texSize > view.byteLength) {
                        break;
                    }
                    const time = view.getUint32(aoff, true);
                    aoff += 4;
                    const texData = buffer.createTypedArray(Uint8Array, aoff, texSize);
                    keyframes.push({ time, texData });
                    aoff += texSize;
                }
                if (keyframes.length >= 2) {
                    animTexChannels.push({ destOffset, texSize, keyframes });
                }
            }
        }
    }

    return {
        pointerBase,
        dataBuffer,
        instances,
        skyboxDLOffset,
        winterOverrides,
        animEntries,
        splines,
        animTexChannels,
    };
}
