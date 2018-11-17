
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode, GX2Dimension } from './gx2_enum';
import ArrayBufferSlice from '../ArrayBufferSlice';

export interface GX2Surface {
    dimension: GX2Dimension;
    format: GX2SurfaceFormat;
    tileMode: GX2TileMode;
    aaMode: GX2AAMode;
    swizzle: number;
    width: number;
    height: number;
    depth: number;
    pitch: number;
    numMips: number;

    texDataSize: number;
    mipDataSize: number;
    mipDataOffsets: number[];
}

export function parseGX2Surface(buffer: ArrayBufferSlice, gx2SurfaceOffs: number): GX2Surface {
    const view = buffer.slice(gx2SurfaceOffs, gx2SurfaceOffs + 0x9C).createDataView();

    const dimension: GX2Dimension = view.getUint32(0x00, false);
    const width = view.getUint32(0x04, false);
    const height = view.getUint32(0x08, false);
    const depth = view.getUint32(0x0C, false);
    const numMips = view.getUint32(0x10, false);
    const format = view.getUint32(0x14, false);
    const aaMode = view.getUint32(0x18, false);

    const texDataSize = view.getUint32(0x20, false);
    const mipDataSize = view.getUint32(0x28, false);
    const tileMode = view.getUint32(0x30, false);
    const swizzle = view.getUint32(0x34, false);
    const align = view.getUint32(0x38, false);
    const pitch = view.getUint32(0x3C, false);

    let mipDataOffsetTableIdx = 0x40;
    const mipDataOffsets = [];
    for (let i = 0; i < 13; i++) {
        mipDataOffsets.push(view.getUint32(mipDataOffsetTableIdx, false));
        mipDataOffsetTableIdx += 0x04;
    }

    const surface = { dimension, format, tileMode, swizzle, width, height, depth, pitch, numMips, aaMode, texDataSize, mipDataSize, mipDataOffsets };
    return surface;
}

export interface DeswizzledSurface {
    width: number;
    height: number;
    depth: number;
    pixels: Uint8Array;
}
