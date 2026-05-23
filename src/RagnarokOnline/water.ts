
// The map's animated water plane.
//
// Ragnarok Online draws a single flat grid at the map's water level, spanning
// the whole ground extent. Two things animate it: the surface texture cycles
// through 32 frames, and every vertex bobs on a sine wave whose phase scrolls
// across the grid. Both advance once per game frame in the original (a capped
// ~60fps), so we reproduce that exact step on a fixed 1/60s tick driven by real
// elapsed time, leaving the look identical at any render rate.
//
// The water frames ship as JPEG, which the BMP decoder can't read, so they are
// decoded in-browser via createImageBitmap into top-down RGBA8 (the same shape
// DecodedImage uses for the BMP textures). Water is alpha-blended, so there is
// no magic-pink color key.

import { DecodedImage } from "./bmp.js";

// UV tiles the water texture once every 4 cells, matching the original's
// per-cell texture step (0.25 per cell, repeat-wrapped).
const WATER_TEX_UV = 0.25;

// One vertex of the water grid: world X/Z (already scaled by the GND zoom), the
// integer cell-corner sum (gx+gy) that feeds the wave phase, and the tiling UV.
// 5 floats = 20 bytes.
export const WATER_VERTEX_STRIDE_BYTES = 5 * 4;

export interface WaterMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
}

// Animation/placement parameters resolved from the RSW and GND.
export interface WaterParams {
    level: number;       // RSW water level (positive; world Y is its negation)
    animSpeed: number;   // texture-cycle divisor; frame = (cnt/animSpeed) % 32
    wavePitch: number;   // phase increment per grid step, degrees
    waveSpeed: number;   // phase advance per 1/60s tick, degrees
    waveHeight: number;  // sine amplitude, world units
}

// Builds the flat water grid in the terrain's world frame: one quad per GND
// cell, corner (gx,gy) -> world (gx*zoom, _, gy*zoom). The vertical position is
// filled per-vertex by the shader from the wave, so only X/Z/grid/UV are stored
// here. Winding matches the terrain quad (0,1,2, 2,1,3).
export function buildWaterMesh(gndWidth: number, gndHeight: number, zoom: number): WaterMesh {
    const vw = gndWidth + 1; // vertices per row
    const vh = gndHeight + 1;
    const vertexCount = vw * vh;

    const vertexData = new ArrayBuffer(vertexCount * WATER_VERTEX_STRIDE_BYTES);
    const f = new Float32Array(vertexData);
    let o = 0;
    for (let gy = 0; gy < vh; gy++) {
        for (let gx = 0; gx < vw; gx++) {
            f[o + 0] = gx * zoom;          // world X
            f[o + 1] = gy * zoom;          // world Z
            f[o + 2] = gx + gy;            // grid sum for the wave phase
            f[o + 3] = gx * WATER_TEX_UV;  // u
            f[o + 4] = gy * WATER_TEX_UV;  // v
            o += 5;
        }
    }

    const indices: number[] = [];
    for (let gy = 0; gy < gndHeight; gy++) {
        for (let gx = 0; gx < gndWidth; gx++) {
            const a = gy * vw + gx;        // (gx,   gy)
            const b = a + 1;              // (gx+1, gy)
            const c = (gy + 1) * vw + gx;  // (gx,   gy+1)
            const d = c + 1;              // (gx+1, gy+1)
            indices.push(a, b, c, c, b, d);
        }
    }

    return { vertexData, indexData: new Uint32Array(indices) };
}

// Decodes a JPEG (or any browser-decodable image) byte buffer into top-down
// RGBA8. The water frames are JPEG, which decodeBMP can't read; createImageBitmap
// handles them, and an OffscreenCanvas readback yields the same RGBA layout the
// rest of the pipeline uses.
export async function decodeImageBitmapRGBA(bytes: Uint8Array): Promise<DecodedImage> {
    const blob = new Blob([bytes as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx === null)
        throw new Error("water: failed to acquire 2D context for image decode");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    // ImageData is already top-down RGBA8.
    return { width, height, rgba: new Uint8Array(imageData.data.buffer.slice(0)) };
}

// Drives the faithful per-tick animation off real elapsed time. RO advances the
// water one step per ~60fps game frame; we accumulate dt (seconds) and drain it
// in fixed 1/60s steps so the speed is identical at any render rate. Exposes the
// current texture-frame index and wave phase (degrees) for the shader.
export class WaterAnimator {
    private static readonly STEP = 1 / 60;

    private accum = 0;
    private cnt = 0;          // texture-frame counter, wraps at 32*animSpeed
    private offsetDeg = 0;    // wave phase, wrapped to (-180, 180]

    constructor(private animSpeed: number, private waveSpeed: number) {
        if (this.animSpeed <= 0)
            this.animSpeed = 1;
    }

    // Advance by dt seconds. Clamp the accumulator after a long stall so we
    // never burst thousands of steps in one frame.
    public update(dtSeconds: number): void {
        this.accum += dtSeconds;
        if (this.accum > 1.0)
            this.accum = 1.0;
        while (this.accum >= WaterAnimator.STEP) {
            this.accum -= WaterAnimator.STEP;

            this.cnt++;
            if (this.cnt >= 32 * this.animSpeed)
                this.cnt = 0;

            this.offsetDeg += this.waveSpeed;
            if (this.offsetDeg > 180.0)
                this.offsetDeg -= 360.0;
        }
    }

    public get frameIndex(): number {
        return ((this.cnt / this.animSpeed) | 0) % 32;
    }

    public get waveOffsetDeg(): number {
        return this.offsetDeg;
    }
}
