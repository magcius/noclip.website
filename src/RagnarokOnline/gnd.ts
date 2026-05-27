import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

export function textureNameToUrl(name: string): string {
    return name.toLowerCase().split("\\").map(encodeURIComponent).join("/");
}

export interface GndSurface {
    u: [number, number, number, number];
    v: [number, number, number, number];
    textureId: number;
    lightmapId: number;
    color: number;
}

export interface GndCell {

    height: [number, number, number, number];
    topSurface: number;
    frontSurface: number;
    rightSurface: number;
}

export interface GndLightmap {
    intensity: Uint8Array;
    color: Uint8Array;
}

export interface GndWaterParams {
    level: number;
    type: number;
    waveHeight: number;
    waveSpeed: number;
    wavePitch: number;
    animSpeed: number;
}

export interface GndMap {
    width: number;
    height: number;
    textureNames: string[];
    lightmaps: GndLightmap[];
    surfaces: GndSurface[];

    cells: GndCell[];

    water: GndWaterParams | null;
}

class Reader {
    private view: DataView;
    public offs = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public assertCanRead(n: number): void {
        if (this.offs + n > this.view.byteLength)
            throw new Error(`GND: unexpected end of file (need ${n} bytes at ${this.offs})`);
    }

    public u8(): number { this.assertCanRead(1); const v = this.view.getUint8(this.offs); this.offs += 1; return v; }
    public i16(): number { this.assertCanRead(2); const v = this.view.getInt16(this.offs, true); this.offs += 2; return v; }
    public u16(): number { this.assertCanRead(2); const v = this.view.getUint16(this.offs, true); this.offs += 2; return v; }
    public i32(): number { this.assertCanRead(4); const v = this.view.getInt32(this.offs, true); this.offs += 4; return v; }
    public u32(): number { this.assertCanRead(4); const v = this.view.getUint32(this.offs, true); this.offs += 4; return v; }
    public f32(): number { this.assertCanRead(4); const v = this.view.getFloat32(this.offs, true); this.offs += 4; return v; }

    public remaining(): number { return this.view.byteLength - this.offs; }

    public bytes(n: number): Uint8Array {
        this.assertCanRead(n);
        const v = this.buffer.createTypedArray(Uint8Array, this.offs, n);
        this.offs += n;
        return v;
    }

    public fixedBytes(width: number): Uint8Array {
        this.assertCanRead(width);
        const v = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        return v;
    }

    public magic(width: number): string {
        const bytes = this.fixedBytes(width);
        let end = bytes.indexOf(0);
        if (end < 0)
            end = width;
        return String.fromCharCode(...bytes.subarray(0, end));
    }
}

function readWaterParams(r: Reader): GndWaterParams {
    const level = r.f32();
    const type = r.i32();
    const waveHeight = r.f32();
    const waveSpeed = r.f32();
    const wavePitch = r.f32();
    const animSpeed = r.i32();
    return { level, type, waveHeight, waveSpeed, wavePitch, animSpeed };
}

export function parseGND(buffer: ArrayBufferSlice): GndMap {
    const r = new Reader(buffer);

    const magic = r.magic(4);
    if (magic !== "GRGN")
        throw new Error(`GND: bad magic "${magic}"`);

    const major = r.u8();
    const minor = r.u8();
    if (major !== 1 || minor < 7)
        throw new Error(`GND: unsupported version ${major}.${minor}`);

    const width = r.i32();
    const height = r.i32();
    const zoom = r.f32();
    if (width <= 0 || height <= 0)
        throw new Error(`GND: bad dimensions ${width}x${height}`);
    if (zoom !== 10)
        console.warn(`GND: unexpected cell size ${zoom} (expected 10); world placements will be wrong`);

    const textureCount = r.i32();
    const textureNameLength = r.i32();
    if (textureCount < 0 || textureNameLength <= 0)
        throw new Error(`GND: bad texture table (${textureCount} names, ${textureNameLength} bytes each)`);
    const textureNames: string[] = [];
    for (let i = 0; i < textureCount; i++) {
        textureNames.push(readString(buffer, r.offs, textureNameLength, true, "euc-kr"));
        r.offs += textureNameLength;
    }

    const lightmapCount = r.i32();
    const lightmapWidth = r.i32();
    const lightmapHeight = r.i32();
    r.i32();
    if (lightmapCount < 0 || lightmapWidth !== 8 || lightmapHeight !== 8)
        throw new Error(`GND: unexpected lightmap layout (${lightmapCount} of ${lightmapWidth}x${lightmapHeight})`);
    const lightmaps: GndLightmap[] = [];
    for (let i = 0; i < lightmapCount; i++) {
        const intensity = r.bytes(64).slice();
        const color = r.bytes(192).slice();
        lightmaps.push({ intensity, color });
    }

    const surfaceCount = r.i32();
    if (surfaceCount < 0)
        throw new Error(`GND: bad surface count ${surfaceCount}`);
    const surfaces: GndSurface[] = [];
    for (let i = 0; i < surfaceCount; i++) {
        const u: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
        const v: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
        const textureId = r.i16();
        const lightmapId = r.u16();
        const color = r.u32();
        surfaces.push({ u, v, textureId, lightmapId, color });
    }

    const cellCount = width * height;
    const cells: GndCell[] = [];
    for (let i = 0; i < cellCount; i++) {
        const heightArr: [number, number, number, number] = [r.f32(), r.f32(), r.f32(), r.f32()];
        const topSurface = r.i32();
        const frontSurface = r.i32();
        const rightSurface = r.i32();
        cells.push({ height: heightArr, topSurface, frontSurface, rightSurface });
    }

    let water: GndWaterParams | null = null;
    if (minor >= 8 && r.remaining() >= 24) {
        water = readWaterParams(r);

        if (r.remaining() >= 8) {
            const numWaterPlanesU = r.i32();
            const numWaterPlanesV = r.i32();
            const numWaterPlanes = numWaterPlanesU > 0 && numWaterPlanesV > 0 ? numWaterPlanesU * numWaterPlanesV : 0;
            if (minor >= 9) {
                for (let i = 0; i < numWaterPlanes && r.remaining() >= 24; i++) {
                    const plane = readWaterParams(r);
                    if (i === 0)
                        water = plane;
                }
            } else {
                for (let i = 0; i < numWaterPlanes && r.remaining() >= 4; i++) {
                    const level = r.f32();
                    if (i === 0)
                        water = { ...water, level };
                }
            }
        }
    }

    return { width, height, textureNames, lightmaps, surfaces, cells, water };
}
