import { DecodedImage } from "./bmp.js";

const WATER_TEX_UV = 0.25;

export const WATER_VERTEX_STRIDE_BYTES = 5 * 4;

export interface WaterMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
}

export interface WaterParams {
    level: number;
    animSpeed: number;
    wavePitch: number;
    waveSpeed: number;
    waveHeight: number;
}

export function buildWaterMesh(gndWidth: number, gndHeight: number, zoom: number): WaterMesh {
    const vw = gndWidth + 1;
    const vh = gndHeight + 1;
    const vertexCount = vw * vh;

    const vertexData = new ArrayBuffer(vertexCount * WATER_VERTEX_STRIDE_BYTES);
    const f = new Float32Array(vertexData);
    let o = 0;
    for (let gy = 0; gy < vh; gy++) {
        for (let gx = 0; gx < vw; gx++) {
            f[o + 0] = gx * zoom;
            f[o + 1] = gy * zoom;
            f[o + 2] = gx + gy;
            f[o + 3] = gx * WATER_TEX_UV;
            f[o + 4] = gy * WATER_TEX_UV;
            o += 5;
        }
    }

    const indices: number[] = [];
    for (let gy = 0; gy < gndHeight; gy++) {
        for (let gx = 0; gx < gndWidth; gx++) {
            const a = gy * vw + gx;
            const b = a + 1;
            const c = (gy + 1) * vw + gx;
            const d = c + 1;
            indices.push(a, b, c, c, b, d);
        }
    }

    return { vertexData, indexData: new Uint32Array(indices) };
}

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
    return { width, height, rgba: new Uint8Array(imageData.data.buffer.slice(0)) };
}

export class WaterAnimator {
    private static readonly STEP = 1 / 60;

    private accum = 0;
    private cnt = 0;
    private offsetDeg = 0;

    constructor(private animSpeed: number, private waveSpeed: number) {
        if (this.animSpeed <= 0)
            this.animSpeed = 1;
    }

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
