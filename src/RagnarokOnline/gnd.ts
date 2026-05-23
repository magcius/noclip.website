
// Parser for Ragnarok Online's GND ground format (magic "GRGN").
//
// A GND describes a map's terrain as a width x height grid of cells. Each cell
// stores four corner heights and references up to three surfaces (a top quad
// plus a front and right wall to the neighbouring cells). Surfaces carry the
// texture/lightmap/colour used to skin the geometry; for untextured geometry we
// only need the cell heights and the grid dimensions, but the full per-cell and
// surface data is small so we parse it in one pass.
//
// All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// RO stores texture paths as CP949 (EUC-KR) Korean bytes. The WHATWG 'euc-kr'
// label decodes the full CP949 set and is available in both Node 18+ and
// browsers, so no external table is needed. The SAME decode is used by the
// extraction tool, so disk paths and fetch paths always agree.
const eucKrDecoder = new TextDecoder("euc-kr");

function decodeCp949(bytes: Uint8Array): string {
    let end = bytes.indexOf(0);
    if (end < 0)
        end = bytes.length;
    return eucKrDecoder.decode(bytes.subarray(0, end));
}

// Normalizes a GND texture path to a URL relative to the textures root:
// backslashes become forward slashes, and each segment is percent-encoded so
// Korean names survive the fetch. Mirrors the layout the extractor writes.
export function textureNameToUrl(name: string): string {
    return name.split("\\").map(encodeURIComponent).join("/");
}

export interface GndSurface {
    // Texture UVs, one per cell corner.
    u: [number, number, number, number];
    v: [number, number, number, number];
    textureId: number;
    lightmapId: number;
    color: number; // packed ARGB
}

export interface GndCell {
    // Corner heights, ordered [0]=(x,y) [1]=(x+1,y) [2]=(x,y+1) [3]=(x+1,y+1).
    height: [number, number, number, number];
    topSurface: number;
    frontSurface: number;
    rightSurface: number;
}

export interface GndLightmap {
    intensity: Uint8Array; // 8x8 grayscale (64 bytes)
    color: Uint8Array;     // 8x8 RGB (192 bytes)
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
    // Length width*height, stored row-major: cell(x, y) = cells[y * width + x].
    cells: GndCell[];
    // GND 1.8+ stores the water setup that RSW 2.6 removed from the world file.
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

    // Reads a fixed-width field of raw bytes, advancing by exactly `width`.
    public fixedBytes(width: number): Uint8Array {
        this.assertCanRead(width);
        const v = this.buffer.createTypedArray(Uint8Array, this.offs, width);
        this.offs += width;
        return v;
    }

    // Reads a fixed-width ASCII magic and always advances by `width` bytes.
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
    for (let i = 0; i < textureCount; i++)
        textureNames.push(decodeCp949(r.fixedBytes(textureNameLength)));

    const lightmapCount = r.i32();
    const lightmapWidth = r.i32();
    const lightmapHeight = r.i32();
    r.i32(); // pixel format, unused
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

        // 1.8 appends a U/V grid and one float level per water plane. 1.9
        // appends the U/V grid and a full water config per plane. The current
        // renderer draws a single map-wide plane, so prefer the first explicit
        // plane when present and otherwise keep the base config.
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
