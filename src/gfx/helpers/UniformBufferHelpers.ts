
// Helpers to fill vertex buffers.

import { mat4, mat2d, vec4, ReadonlyVec3 } from "gl-matrix";
import { GfxColor } from "../platform/GfxPlatform";

export function fillVec3v(d: Float32Array, offs: number, v: ReadonlyVec3, v3: number = 0): number {
    d[offs + 0] = v[0];
    d[offs + 1] = v[1];
    d[offs + 2] = v[2];
    d[offs + 3] = v3;
    return 4;
}

export function fillVec4(d: Float32Array, offs: number, v0: number, v1: number = 0, v2: number = 0, v3: number = 0): number {
    d[offs + 0] = v0;
    d[offs + 1] = v1;
    d[offs + 2] = v2;
    d[offs + 3] = v3;
    return 4;
}

export function fillVec4v(d: Float32Array, offs: number, v: vec4): number {
    d[offs + 0] = v[0];
    d[offs + 1] = v[1];
    d[offs + 2] = v[2];
    d[offs + 3] = v[3];
    return 4;
}

export function fillColor(d: Float32Array, offs: number, c: GfxColor): number {
    d[offs + 0] = c.r;
    d[offs + 1] = c.g;
    d[offs + 2] = c.b;
    d[offs + 3] = c.a;
    return 4;
}

// All of our matrices are row-major.
export function fillMatrix4x4(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    d[offs + 12] = m[3];
    d[offs + 13] = m[7];
    d[offs + 14] = m[11];
    d[offs + 15] = m[15];
    return 4*4;
}

export function fillMatrix4x3(d: Float32Array, offs: number, m: mat4): number {
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    d[offs +  8] = m[2];
    d[offs +  9] = m[6];
    d[offs + 10] = m[10];
    d[offs + 11] = m[14];
    return 4*3;
}

export function fillMatrix3x2(d: Float32Array, offs: number, m: mat2d): number {
    // 3x2 matrices are actually sent across as 4x2.
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    d[offs + 0] = ma;
    d[offs + 1] = mc;
    d[offs + 2] = mx;
    d[offs + 3] = 0;
    d[offs + 4] = mb;
    d[offs + 5] = md;
    d[offs + 6] = my;
    d[offs + 7] = 0;
    return 4*2;
}

export function fillMatrix4x2(d: Float32Array, offs: number, m: mat4): number {
    // The bottom two rows are basically just ignored in a 4x2.
    d[offs +  0] = m[0];
    d[offs +  1] = m[4];
    d[offs +  2] = m[8];
    d[offs +  3] = m[12];
    d[offs +  4] = m[1];
    d[offs +  5] = m[5];
    d[offs +  6] = m[9];
    d[offs +  7] = m[13];
    return 4*2;
}
