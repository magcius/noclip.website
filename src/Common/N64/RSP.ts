
// Common utilities for the N64 Reality Signal Processor (RDP).

import { mat4 } from "gl-matrix";

export interface RSPVertex {
    x: number;
    y: number;
    z: number;
    // Texture coordinates.
    tx: number;
    ty: number;
    // Color or normals.
    c0: number;
    c1: number;
    c2: number;
    // Alpha.
    a: number;
}

export function loadVertexFromView(dst: RSPVertex, view: DataView, offs: number): void {
    dst.x = view.getInt16(offs + 0x00);
    dst.y = view.getInt16(offs + 0x02);
    dst.z = view.getInt16(offs + 0x04);
    // flag (unused)
    dst.tx = (view.getInt16(offs + 0x08) / 0x20); // Convert from S10.5 fixed-point
    dst.ty = (view.getInt16(offs + 0x0A) / 0x20);
    dst.c0 = view.getUint8(offs + 0x0C) / 0xFF;
    dst.c1 = view.getUint8(offs + 0x0D) / 0xFF;
    dst.c2 = view.getUint8(offs + 0x0E) / 0xFF;
    dst.a = view.getUint8(offs + 0x0F) / 0xFF;
}

export function calcTextureScaleForShift(shift: number): number {
    if (shift <= 10) {
        return 1 / (1 << shift);
    } else {
        return 1 << (16 - shift);
    }
}

export function calcTextureMatrixFromRSPState(dst: mat4, texScaleS: number, texScaleT: number, tileWidth: number, tileHeight: number, tileShiftS: number, tileShiftT: number): void {
    // TexCoord = (((inTexCoord * texScale) + 0.5) * tileScale) / tileSize

    const tileScaleS = calcTextureScaleForShift(tileShiftS) / tileWidth;
    const tileScaleT = calcTextureScaleForShift(tileShiftT) / tileHeight;

    dst[0] = (texScaleS * tileScaleS);
    dst[5] = (texScaleT * tileScaleT);

    // Offset for filtering.
    dst[12] = (0.5 * tileScaleS);
    dst[13] = (0.5 * tileScaleT);
}
