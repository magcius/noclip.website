// Credit to "Spyro World Viewer" by Kly_Men_COmpany for a majority of the data structures, reverse-engineering and parsing logic

import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxTexture } from "../gfx/platform/GfxPlatformImpl";

interface GroundFace {
    indices: number[];
    uvs: number[];
    colors: number[];
    tileIndex: number;
    isLOD: boolean;
    isWater?: boolean;
    isTransparent?: boolean;
    isScrolling?: boolean;
}

interface SkyFace {
    indices: number[];
    colors: number[];
}

export interface TextureStore {
    textures: GfxTexture[];
    colors: Uint8Array[];
    tiles: Tile[];
}

export interface Level {
    vertices: number[][];
    colors: number[][];
    faces: GroundFace[];
    uvs: number[][];
    textures: TextureStore;
    game: number;
    id: number;
};

export interface LevelData {
    vram: VRAM;
    textureList: ArrayBufferSlice;
    ground: ArrayBufferSlice;
    grounds?: ArrayBufferSlice[];
    sky: ArrayBufferSlice;
    subfile4?: ArrayBufferSlice;
}

export interface Skybox {
    backgroundColor: number[];
    vertices: number[][];
    colors: number[][]; 
    faces: SkyFace[];
}

export interface MobyInstance {
    x: number;
    y: number;
    z: number;
    yaw: number;
    classId: number;
}

class Tile {
    mainX: number; mainY: number; p1: number; p2: number;
    xx: number; yy: number; ss: number; ff: number;
    px: number = 0; py: number = 0;
    m: 4 | 8 | 15 = 4; size: number = 32;
    x1: number = 0; x2: number = 0; x3: number = 0; x4: number = 0;
    y1: number = 0; y2: number = 0; y3: number = 0; y4: number = 0;
    rotation: number = 0; s: number = 0; offset: number = 0;
    f: boolean = false; transparent: number = 0;
    constructor(data: DataView, offset: number) {
        this.mainX = data.getUint8(offset);
        this.mainY = data.getUint8(offset + 1);
        this.p1 = data.getUint8(offset + 2);
        this.p2 = data.getUint8(offset + 3);
        this.xx = data.getUint8(offset + 4);
        this.yy = data.getUint8(offset + 5);
        this.ss = data.getUint8(offset + 6);
        this.ff = data.getUint8(offset + 7);
    }
}

class PartHeader {
    y: number; x: number; i0: number; z: number; flag: number;
    lodVertexCount: number; lodColorCount: number; lodPolyCount: number; i1: number;
    mdlVertexCount: number; mdlColorCount: number; mdlPolyCount: number; water: number;
    constructor(data: DataView, offs: number) {
        this.y = data.getInt16(offs, true);
        this.x = data.getInt16(offs + 2, true);
        this.i0 = data.getUint16(offs + 4, true);
        this.z = data.getInt16(offs + 6, true);
        this.lodVertexCount = data.getUint8(offs + 8);
        this.lodColorCount = data.getUint8(offs + 9);
        this.lodPolyCount = data.getUint8(offs + 10);
        this.i1 = data.getUint8(offs + 11);
        this.mdlVertexCount = data.getUint8(offs + 12);
        this.mdlColorCount = data.getUint8(offs + 13);
        this.mdlPolyCount = data.getUint8(offs + 14);
        this.water = data.getUint8(offs + 15);
        this.flag = data.getUint32(offs + 16, true);
    }
}

class Vertex {
    byte1: number; byte2: number; byte3: number; byte4: number;
    constructor(data: DataView, offset: number) {
        this.byte1 = data.getUint8(offset);
        this.byte2 = data.getUint8(offset + 1);
        this.byte3 = data.getUint8(offset + 2);
        this.byte4 = data.getUint8(offset + 3);
    }
}

class VertexColor {
    r: number; g: number; b: number;
    constructor(view: DataView, offset: number) {
        this.r = view.getUint8(offset);
        this.g = view.getUint8(offset + 1);
        this.b = view.getUint8(offset + 2);
    }
}

class LODPoly {
    n: number; v1: number; v2: number; v3: number;
    f: number; c1: number; c2: number; c3: number;
    constructor(view: DataView, offs: number) {
        this.n = view.getUint8(offs);
        this.v1 = view.getUint8(offs + 1);
        this.v2 = view.getUint8(offs + 2);
        this.v3 = view.getUint8(offs + 3);
        this.f = view.getUint8(offs + 4);
        this.c1 = view.getUint8(offs + 5);
        this.c2 = view.getUint8(offs + 6);
        this.c3 = view.getUint8(offs + 7);
    }
}

class LODPoly2 {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;
    constructor(view: DataView, offs: number) {
        this.v1 = view.getUint8(offs);
        this.v2 = view.getUint8(offs + 1);
        this.v3 = view.getUint8(offs + 2);
        this.v4 = view.getUint8(offs + 3);
        this.c1 = view.getUint8(offs + 4);
        this.c2 = view.getUint8(offs + 5);
        this.c3 = view.getUint8(offs + 6);
        this.c4 = view.getUint8(offs + 7);
    }
}

class Polygon {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;
    t: number; r: number; // S1 only
    s1: number; s2: number; s3: number; s4: number; tt: number; ii: number; // S2 only
    constructor(view: DataView, offs: number, gameNumber: number) {
        this.v1 = view.getUint8(offs);
        this.v2 = view.getUint8(offs + 1);
        this.v3 = view.getUint8(offs + 2);
        this.v4 = view.getUint8(offs + 3);
        this.c1 = view.getUint8(offs + 4);
        this.c2 = view.getUint8(offs + 5);
        this.c3 = view.getUint8(offs + 6);
        this.c4 = view.getUint8(offs + 7);
        if (gameNumber == 1) {
            this.t = view.getUint8(offs + 8);
            this.r = view.getUint8(offs + 9);
        } else {
            this.s1 = view.getUint8(offs + 8);
            this.s2 = view.getUint8(offs + 9);
            this.s3 = view.getUint8(offs + 10);
            this.s4 = view.getUint8(offs + 11);
            this.tt = view.getUint8(offs + 12) & 127;
            this.ii = view.getUint8(offs + 13);
        }
    }
}

const VRAM_SIZE = 524288
export class VRAM {
    private data: Uint16Array;

    constructor(buffer: ArrayBuffer) {
        this.data = new Uint16Array(buffer);
    }

    getWord(wordX: number, wordY: number): number {
        if (wordX < 0 || wordX >= 512 || wordY < 0 || wordY >= 512) {
            return 0;
        }
        return this.data[wordY * 512 + wordX];
    }

    getWordByIndex(index: number): number {
        if (index < 0 || index >= this.data.length) {
            return 0;
        }
        return this.data[index];
    }

    applyFontStripFix() { // S2 only fix
        const width = 512;
        const y = 255;
        for (let x = width; x <= 575; x++) {
            this.data[y * width + x] = this.data[(y - 1) * width + (x - width)];
        }
    }
}

export const TILE_SCROLL_MAP: Record<number, Record<number, number[]>> = {
    1: {
        11: [23], 13: [31], 17: [1], 27: [31], 35: [51], 37: [35],
        49: [54], 55: [66], 59: [12], 63: [77], 67: [55], 69: [29],
        75: [5], 79: [24]
    },
    2: {
        16: [72], 20: [44], 36: [44], 38: [48], 44: [35], 48: [0],
        50: [2], 58: [0, 1, 2], 72: [12, 13]
    },
    3: {
        98: [93], 100: [97], 110: [2], 112: [6], 116: [80], 120: [1],
        124: [77], 138: [72], 152: [27], 156: [7], 158: [80], 170: [29]
    }
};

function applyTileRotationRGBA(rgba: Uint8Array, tile: Tile, size: number = 32): Uint8Array {
    let rotatedRGBA = rgba;

    function rotate90(src: Uint8Array): Uint8Array {
        const dest = new Uint8Array(src.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const s = (y * size + x) * 4;
                const d = (x * size + (size - 1 - y)) * 4;
                dest[d + 0] = src[s + 0];
                dest[d + 1] = src[s + 1];
                dest[d + 2] = src[s + 2];
                dest[d + 3] = src[s + 3];
            }
        }
        return dest;
    }

    function mirrorX(src: Uint8Array): Uint8Array {
        const dest = new Uint8Array(src.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const s = (y * size + x) * 4;
                const d = (y * size + (size - 1 - x)) * 4;
                dest[d + 0] = src[s + 0];
                dest[d + 1] = src[s + 1];
                dest[d + 2] = src[s + 2];
                dest[d + 3] = src[s + 3];
            }
        }
        return dest;
    }

    switch (tile.rotation) {
        case 0: // normal
            break;
        case 1: // rotate 90 left
            rotatedRGBA = rotate90(rotatedRGBA);
            break;
        case 2: // rotate 90 right
            rotatedRGBA = rotate90(rotate90(rotate90(rotatedRGBA)));
            break;
        case 3: // rotate 180
            rotatedRGBA = rotate90(rotate90(rotatedRGBA));
            break;
        case 5: // mirror
            rotatedRGBA = mirrorX(rotatedRGBA);
            break;
        case 4: // mirror + 90 left
            rotatedRGBA = rotate90(mirrorX(rotatedRGBA));
            break;
        case 6: // mirror + 90 right
            rotatedRGBA = rotate90(rotate90(rotate90(mirrorX(rotatedRGBA))));
            break;
        case 7: // mirror + 180
            rotatedRGBA = rotate90(rotate90(mirrorX(rotatedRGBA)));
            break;
    }

    return rotatedRGBA;
}

function colorBitsToRGBA(word: number): [number, number, number, number] {
    return [
        (((word) & 31) * 255 / 31) | 0,
        (((word >> 5) & 31) * 255 / 31) | 0,
        (((word >> 10) & 31) * 255 / 31) | 0,
        ((word >> 15) & 1) ? 0 : 255
    ];
}

function readColorLookupTable(vram: VRAM, px: number, py: number, n: number): [number, number, number, number][] {
    const clut: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
        clut.push(colorBitsToRGBA(vram.getWordByIndex((py * 512 + px) + i)));
    }
    return clut;
}

function decodeTileToRGBA(vram: VRAM, tile: Tile, width: number = tile.size, height: number = tile.size): Uint8Array {
    let x4 = tile.x4;
    const y4 = tile.y4;
    if (tile.m === 4) {
        x4 = x4 >> 2;
        const palette = readColorLookupTable(vram, tile.px, tile.py, 16);
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 4; x++) {
                const word = vram.getWord(x4 + x, y4 + y);
                for (let nib = 0; nib < 4; nib++) {
                    const dst = (y * width + (x * 4 + nib)) * 4;
                    const [r, g, b, a] = palette[(word >> (nib * 4)) & 15];
                    out[dst + 0] = r;
                    out[dst + 1] = g;
                    out[dst + 2] = b;
                    out[dst + 3] = a;
                }
            }
        }
        return out;
    } else if (tile.m === 8) {
        x4 = x4 >> 1;
        const palette = readColorLookupTable(vram, tile.px, tile.py, 256);
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 2; x++) {
                const word = vram.getWord(x4 + x, y4 + y);
                {
                    const dst = (y * width + (x * 2)) * 4;
                    const [r, g, b, a] = palette[word & 255];
                    out[dst + 0] = r;
                    out[dst + 1] = g;
                    out[dst + 2] = b;
                    out[dst + 3] = a;
                }
                {
                    const dst = (y * width + (x * 2 + 1)) * 4;
                    const [r, g, b, a] = palette[(word >> 8) & 255];
                    out[dst + 0] = r;
                    out[dst + 1] = g;
                    out[dst + 2] = b;
                    out[dst + 3] = a;
                }
            }
        }
        return out;
    } else {
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const word = vram.getWord(tile.x4 + x, y4 + y);
                const [r, g, b, a] = colorBitsToRGBA(word);
                const dst = (y * width + x) * 4;
                out[dst + 0] = r;
                out[dst + 1] = g;
                out[dst + 2] = b;
                out[dst + 3] = a;
            }
        }
        return out;
    }
}

function buildFaces1(poly: Polygon, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], tileCount: number) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const tileIndex = poly.t & 127;
    if (tileIndex >= 0 && tileIndex < tileCount) {
        const uv1 = [0, 1];
        const uv2 = [1, 1];
        const uv3 = [1, 0];
        const uv4 = [0, 0];
        const ca = mdlColorStart + poly.c1;
        const cb = mdlColorStart + poly.c2;
        const cc = mdlColorStart + poly.c3;
        const cd = mdlColorStart + poly.c4;
        if (poly.v1 === poly.v2) {
            const base = [[0,1], [1,1], [1,0], [0,0]];
            const permutations = [[0, 1, 2, 3], [3, 0, 1, 2], [2, 3, 0, 1], [1, 2, 3, 0]];
            const permutation = permutations[poly.r & 3];
            const tex1 = base[permutation[0]];
            const tex2 = base[permutation[1]];
            const tex3 = base[permutation[2]];
            const tex4 = base[permutation[3]];
            const uv0 = uvs.push(tex4) - 1;
            const uv1 = uvs.push(tex3) - 1;
            const uv2 = uvs.push(tex1) - 1;
            faces.push({
                indices: [d, c, b],
                uvs: [uv0, uv1, uv2],
                colors: [cd, cc, ca],
                isLOD: false,
                tileIndex
            });
        } else {
            const uvA = uvs.push(uv1) - 1;
            const uvB = uvs.push(uv2) - 1;
            const uvC = uvs.push(uv3) - 1;
            const uvD = uvs.push(uv4) - 1;
            faces.push({
                indices: [a, b, c],
                uvs: [uvA, uvB, uvC],
                colors:[ca, cb, cc],
                isLOD: false,
                tileIndex
            });
            faces.push({
                indices: [a, c, d],
                uvs: [uvA, uvC, uvD],
                colors:[ca, cc, cd],
                isLOD: false,
                tileIndex
            });
        }
    }
}

function buildFaces2(poly: Polygon, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], textures: TextureStore, headerWaterFlag: number) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const colorA = mdlColorStart + poly.c1;
    const colorB = mdlColorStart + poly.c2;
    const colorC = mdlColorStart + poly.c3;
    const colorD = mdlColorStart + poly.c4;
    const tileIndex = poly.tt & 127;
    let A = [0, 1];
    let B = [1, 1];
    let C = [1, 0];
    let D = [0, 0];

    function rotateUVCorners(rot: number, A: number[], B: number[], C: number[], D: number[]) {
        switch (rot & 3) {
            case 1:
                return [B, C, D, A];
            case 2:
                return [C, D, A, B];
            case 3:
                return [D, A, B, C];
            case 0:
            default:
                return [A, B, C, D];
        }
    }

    const tile = textures.tiles[tileIndex];
    const isTransparent = tile.transparent > 0;
    const isTri = poly.v1 === poly.v2;
    let polyRotation = 0;
    if (isTri) {
        const rr = (poly.ii >> 4) & 3;
        polyRotation = (tile.rotation - rr) & 3;
        [A, B, C, D] = rotateUVCorners(polyRotation, A, B, C, D);
    }

    const uvIndexA = uvs.length;
    uvs.push(A);
    const uvIndexB = uvs.length;
    uvs.push(B);
    const uvIndexC = uvs.length;
    uvs.push(C);
    const uvIndexD = uvs.length;
    uvs.push(D);
    const isWater = headerWaterFlag == 0 && poly.s1 === 0 && poly.s2 === 0 && poly.s3 === 0 && poly.s4 === 0;
    const inverse = !!(poly.ii & 4);

    if (isTri) {
        if (!inverse) {
            faces.push({
                indices: [b, c, d],
                uvs: [uvIndexA, uvIndexC, uvIndexD],
                colors: [colorB, colorC, colorD],
                isWater,
                isTransparent,
                isLOD: false,
                tileIndex
            });
        } else {
            faces.push({
                indices: [d, c, b],
                uvs: [uvIndexD, uvIndexC, uvIndexA],
                colors: [colorD, colorC, colorB],
                isWater,
                isTransparent,
                isLOD: false,
                tileIndex
            });
        }
    } else {
        faces.push({
            indices: [a, b, c],
            uvs: [uvIndexA, uvIndexB, uvIndexC],
            colors: [colorA, colorB, colorC],
            isWater,
            isTransparent,
            isLOD: false,
            tileIndex
        });
        faces.push({
            indices: [a, c, d],
            uvs: [uvIndexA, uvIndexC, uvIndexD],
            colors: [colorA, colorC, colorD],
            isWater,
            isTransparent,
            isLOD: false,
            tileIndex
        });
    }
}

export function buildSkybox(data: DataView, gameNumber: number): Skybox {
    const size = data.byteLength;
    // Background color (4)
    const backgroundColor = [data.getUint8(0), data.getUint8(1), data.getUint8(2)];
    let pointer = 4;
    const partOffsets: number[] = [];
    while (pointer + 4 <= size) {
        const offset = data.getUint32(pointer, true);
        pointer += 4;
        if (offset === 0 || offset >= size) {
            break;
        }
        partOffsets.push(offset);
    }
    const vertices: number[][] = [];
    const colors: number[][] = [];
    const faces: SkyFace[] = [];
    for (const offset of Array.from(new Set(partOffsets)).sort((a, b) => a - b)) {
        if (gameNumber == 1) {
            parseSkyboxPart(data, size, offset, vertices, colors, faces);
        } else {
            parseSkyboxPart2(data, size, offset, vertices, colors, faces);
        }
    }
    return { backgroundColor, vertices, colors, faces };
}

export function buildLevel(data: DataView, textures: TextureStore, gameNumber: number, levelNumber: number): Level {
    const vertices: number[][] = [];
    const colors: number[][] = [];
    const faces: GroundFace[] = [];
    const uvs: number[][] = [];
    let partCount = data.getUint32(0, true);
    let offset = 4;
    const partOffsets: number[] = [];

    if (gameNumber > 1) {
        offset = 0;
        let partTablePos = data.getUint32(offset, true);
        offset += 4;
        partCount = data.getUint32(partTablePos, true);
        partTablePos += 4;
        for (let i = 0; i < partCount; i++) {
            partOffsets.push(data.getUint32(partTablePos, true));
            partTablePos += 4;
        }
    }

    for (let part = 0; part < partCount; part++) {
        let pointer = 0;
        if (gameNumber == 1) {
            const o = data.getUint32(offset, true);
            offset += 4;
            pointer = o + 8;
        } else {
            pointer = partOffsets[part] + 8;
        }
        const header = new PartHeader(data, pointer);
        pointer += 20;

        // LOD vertices
        const lodVertStart = vertices.length;
        for (let i = 0; i < header.lodVertexCount; i++) {
            const v = new Vertex(data, pointer);
            pointer += 4;
            const zraw = (v.byte1 | ((v.byte2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                z = (zraw << 1) + header.z; // lazy z-scaling to correct for S2/S3, see proper z-scaling further below
            }
            const y = ((v.byte2 >> 2) | ((v.byte3 & 31) << 6)) + header.y;
            const x = ((v.byte3 >> 5) | (v.byte4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // LOD colors
        const lodColorStart = colors.length;
        for (let i = 0; i < header.lodColorCount; i++) {
            const c = new VertexColor(data, pointer);
            pointer += 4;
            colors.push([c.r, c.g, c.b]);
        }

        // LOD polys
        for (let i = 0; i < header.lodPolyCount; i++) {
            const poly = gameNumber > 1 ? new LODPoly2(data, pointer) : new LODPoly(data, pointer);
            pointer += 8;

            let v1 = (poly.v1 & 63);
            let v2 = (poly.v1 >> 6) | ((poly.v2 & 15) << 2);
            let v3 = (poly.v2 >> 4) | ((poly.v3 & 3) << 4);
            let v4 = (poly.v3 >> 2);
            let c1 = (poly.c1 & 63);
            let c2 = (poly.c1 >> 6) | ((poly.c2 & 15) << 2);
            let c3 = (poly.c2 >> 4) | ((poly.c3 & 3) << 4);
            let c4 = (poly.c3 >> 2);
            if (gameNumber > 1 && poly instanceof LODPoly2) {
                v1 = (poly.v1 >> 3) | ((poly.v2 & 3) << 5);
                v2 = (poly.v2 >> 2) | ((poly.v3 & 1) << 6);
                v3 = (poly.v3 >> 1);
                v4 = (poly.v4 & 127);
                c1 = (poly.c1 >> 4) | ((poly.c2 & 7) << 4);
                c2 = (poly.c2 >> 3) | ((poly.c3 & 3) << 5);
                c3 = (poly.c3 >> 2) | ((poly.c4 & 1) << 6);
                c4 = (poly.c4 >> 1);
            }
            const a = lodVertStart + v1;
            const b = lodVertStart + v2;
            const c = lodVertStart + v3;
            const d = lodVertStart + v4;
            const cA = lodColorStart + c1;
            const cB = lodColorStart + c2;
            const cC = lodColorStart + c3;
            const cD = lodColorStart + c4;

            if (v1 === v2)
                faces.push({ indices: [b, c, d], uvs: [0, 0, 0], colors: [cB, cC, cD], tileIndex: 0, isLOD: true });
            else if (v2 === v3)
                faces.push({ indices: [a, c, d], uvs: [0, 0, 0], colors: [cA, cC, cD], tileIndex: 0, isLOD: true });
            else if (v3 === v4)
                faces.push({ indices: [a, b, d], uvs: [0, 0, 0], colors: [cA, cB, cD], tileIndex: 0, isLOD: true });
            else if (v4 === v1)
                faces.push({ indices: [a, b, c], uvs: [0, 0, 0], colors: [cA, cB, cC], tileIndex: 0, isLOD: true });
            else {
                faces.push({ indices: [b, a, c], uvs: [0, 0, 0], colors: [cB, cA, cC], tileIndex: 0, isLOD: true });
                faces.push({ indices: [b, c, d], uvs: [0, 0, 0], colors: [cB, cC, cD], tileIndex: 0, isLOD: true });
            }
        }

        // MDL vertices
        let isWaterNonGround = false;
        if (gameNumber > 1) {
            let polyPos = pointer + header.mdlVertexCount * 4 + header.mdlColorCount * 4 + header.mdlColorCount * 4;
            for (let i = 0; i < header.mdlPolyCount; i++) {
                const s1 = data.getUint8(polyPos + 8);
                const s2 = data.getUint8(polyPos + 9);
                const s3 = data.getUint8(polyPos + 10);
                const s4 = data.getUint8(polyPos + 11);
                if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) {
                    isWaterNonGround = true;
                    break;
                }
                polyPos += 16;
            }
        }
        const mdlVertStart = vertices.length;
        for (let i = 0; i < header.mdlVertexCount; i++) {
            const vertex = new Vertex(data, pointer);
            pointer += 4;
            const zraw = (vertex.byte1 | ((vertex.byte2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                // z-scaling
                // non-ground water is usually flat water, while "ground" water is usually sloped (different signatures)
                const far = header.lodVertexCount === 0 && header.flag === 0xFFFFFFFF;
                if ((far && !isWaterNonGround) || (far && isWaterNonGround && header.water > 0) || (!far && header.water > 0)) {
                    z = (zraw << 1) + header.z;
                } else if ((far && isWaterNonGround && header.water <= 0) || (!far && header.water <= 0)) {
                    z = (zraw >> 2) + header.z;
                }
            }
            const y = ((vertex.byte2 >> 2) | ((vertex.byte3 & 31) << 6)) + header.y;
            const x = ((vertex.byte3 >> 5) | (vertex.byte4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // MDL colors
        const mdlColorStart = colors.length;
        for (let i = 0; i < header.mdlColorCount; i++) {
            const color = new VertexColor(data, pointer);
            pointer += 4;
            colors.push([color.r, color.g, color.b]);
        }

        // FAR colors (ignored)
        pointer += header.mdlColorCount * 4;

        // MDL polys
        for (let i = 0; i < header.mdlPolyCount; i++) {
            const poly = new Polygon(data, pointer, gameNumber);
            pointer += 16;
            if (gameNumber == 1) {
                buildFaces1(poly, mdlVertStart, mdlColorStart, faces, uvs, textures.tiles.length)
            } else {
                buildFaces2(poly, mdlVertStart, mdlColorStart, faces, uvs, textures, header.water)
            }
        }
    }

    return { vertices, colors, faces, uvs, textures, game: gameNumber, id: levelNumber };
}

export function parseTextures(vram: VRAM, textureList: DataView, gameNumber: number): TextureStore {
    const tiles = parseTiles(textureList, gameNumber);
    const tileCount = tiles.length;
    const colors: Uint8Array[] = [];
    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        let rgba = decodeTileToRGBA(vram, tile, tile.size, tile.size);
        if (gameNumber == 1) {
            rgba = applyTileRotationRGBA(rgba, tile, tile.size);
        }
        colors.push(rgba);
    }
    return { textures: [], colors, tiles };
}

export function parseMobyInstances(subfile4: DataView): MobyInstance[] {
    const size = subfile4.byteLength;
    let pointer = 16;
    let index = 0;
    // jump sections until reaching the 13th one
    while (pointer < size - 8 && index < 12) {
        const sectionSize = subfile4.getUint32(pointer, true);
        pointer += sectionSize;
        index += 1;
    }
    pointer += 4;

    // Moby instances (88)
    const mobys: MobyInstance[] = [];
    for (let i = 0; i < subfile4.getUint32(pointer, true); i++) {
        const pos = pointer + 4 + (i * 88);
        if (pos + 88 > size) {
            break;
        }
        // ??? (12), x (4), y (4), z (4), ??? (30), classId (1)
        const x = subfile4.getInt32(pos + 12, true);
        const y = subfile4.getInt32(pos + 16, true);
        const z = subfile4.getInt32(pos + 20, true);
        const classId = subfile4.getUint8(pos + 54);
        // unlikely to have a moby at origin and there's lots of "empty" moby instances (these are filled at runtime if at all?)
        if (x === 0 && y === 0 && z === 0) {
            continue;
        }
        // unsure which byte is the rotation/yaw so hardcode to 0 for now
        mobys.push({ x, y, z, yaw: 0, classId });
    }
    return mobys;
}

export function parseLevelData(data: ArrayBufferSlice): LevelData {
    let pointer = 0;
    function getUint32() {
        return new Uint32Array(data.arrayBuffer, pointer, 4)[0];
    }

    // VRAM
    const subFile1Offset = getUint32();
    const vram = data.subarray(subFile1Offset, VRAM_SIZE);

    // Texture list
    pointer = 8;
    const subFile2Offset = getUint32();
    pointer = subFile2Offset;
    const textureListSize = getUint32();
    const textureList = data.subarray(pointer, textureListSize + 16);

    // Ground
    pointer = subFile2Offset;
    pointer += textureListSize;
    const groundSize = getUint32() - 4;
    pointer += 4;
    const ground = data.subarray(pointer, groundSize);

    // Sky
    pointer += groundSize;
    let skyVar = getUint32();
    pointer += 4;
    const pos = pointer;
    const skyCount = skyVar;
    pointer += skyVar - 4;
    skyVar = getUint32();
    if (skyVar > 3) {
        pointer += skyVar;
        skyVar = getUint32();
        pointer += skyVar;
        skyVar = getUint32();
        pointer += 4;
    } else {
        pointer = pos;
        skyVar = skyCount;
    }
    const sky = data.subarray(pointer, skyVar);

    return { vram: new VRAM(vram.copyToBuffer()), textureList, ground, sky };
}

export function parseLevelData2(data: ArrayBufferSlice, gameNumber: number = 2): LevelData {
    let pointer = 0;
    function getUint32() {
        pointer += 4;
        return new Uint32Array(data.arrayBuffer, pointer - 4, 4)[0];
    }

    const levelFileSize = data.byteLength;
    const subSize = levelFileSize;

    // VRAM
    pointer += getUint32();
    let vramSize = VRAM_SIZE;
    const remainingVram = subSize - (pointer);
    if (remainingVram < vramSize) {
        vramSize = remainingVram;
    }
    const vram = data.subarray(pointer, vramSize);

    // Texture list
    pointer = 8;
    const subfile2Offset = getUint32();
    pointer = subfile2Offset;
    const listSize = getUint32();
    pointer -= 4;
    const textureList = data.subarray(pointer, listSize + 16);

    // Sky
    pointer = subfile2Offset;
    let offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    pointer += offset - 4;
    const skyStart = pointer;
    const pattern = new Uint8Array(data.arrayBuffer, pointer, 12);
    pointer += 12;

    function isValidPattern(p: Uint8Array) {
        return !(((p[0] & 15) === 0) && ((p[1] >> 4) === 0) && (p[2] === 0) &&
            (p[3] === 0) && ((p[4] & 15) === 0) && ((p[5] >> 4) === 0) &&
            (p[6] === 0) && (p[7] === 0) && ((p[8] & 15) === 0) &&
            ((p[9] >> 4) === 0) && (p[10] === 0) && (p[11] === 0))
    }

    if (isValidPattern(pattern)) {
        pointer = skyStart;
        offset = getUint32();
        pointer += offset - 4;
        offset = getUint32();
        if (offset === 0) {
            pointer = skyStart + 4;
        } else {
            pointer += offset - 4;
            offset = getUint32();
            if (offset === 0) {
                pointer = skyStart + 4;
            } else {
                pointer += 8;
            }
        }
    }
    offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    const sky = data.subarray(pointer, offset - 4);

    // Ground
    pointer = subfile2Offset;
    offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    const ground = data.subarray(pointer, offset - 4);
    pointer += offset - 4;

    // Sublevels' ground
    const grounds: ArrayBufferSlice[] = [];
    if (gameNumber === 3) {
        let i = 1;
        while (true) {
            i += 1;
            pointer = 16 * i;
            offset = getUint32();
            const size3 = getUint32();
            const start = offset;
            if (start + size3 > data.byteLength) {
                break;
            }
            pointer = start;
            offset = getUint32();
            if ((pointer - start + offset - 8) > size3 || offset < 4) {
                break;
            }
            pointer += offset - 4;
            while (true) {
                offset = getUint32();
                if (offset !== 0) {
                    break
                }
            }
            while (true) {
                offset = getUint32();
                if (offset === 0) {
                    break
                }
            }
            while (true) {
                offset = getUint32();
                if (offset !== 0) {
                    break
                }
            }
            while (true) {
                offset = getUint32();
                if (offset === 0) {
                    break
                }
            }
            while (true) {
                offset = getUint32();
                if (offset !== 0) {
                    break
                }
            }
            if ((pointer - start + offset - 8) > size3 || offset < 4) {
                break;
            }
            grounds.push(data.subarray(pointer, offset - 4));
        }
    }

    // Moby instances
    let subfile4;
    if (gameNumber === 3) {
        pointer = 24;
        const subfile4Offset = getUint32();
        const subfile4Size = getUint32();
        pointer += subfile4Offset;
        if (pointer + subfile4Size < data.byteLength) {
            subfile4 = data.subarray(pointer, subfile4Size);
        }
    }

    return { vram: new VRAM(vram.copyToBuffer()), textureList, ground, grounds, sky, subfile4 };
}

function parseTiles(data: DataView, gameNumber: number): Tile[] {
    const tiles: Tile[] = [];
    const count = data.getUint32(4, true);
    let offset = 8;
    for (let i = 0; i < count; i++) {
        offset += 8;
        const tile = buildTile(data, offset, gameNumber);
        offset += 8;
        tiles.push(tile);
        if (gameNumber > 1) {
            offset += 32; // skip unused groups
        }
    }
    return tiles;
}

function parseSkyboxPart(view: DataView, size: number, partOffset: number, vertices: number[][], colors: number[][], faces: SkyFace[]): void {
    let pointer = partOffset;
    if (pointer + 24 > size) {
        return;
    }
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // Header (24)
    pointer += 8; // skip first 8 bytes
    const globalY = view.getInt16(pointer, true);
    const globalZ = view.getInt16(pointer + 2, true);
    const vertexCount = view.getUint16(pointer + 4, true);
    const globalX = view.getInt16(pointer + 6, true);
    const polyCount = view.getUint16(pointer + 8, true);
    const colorCount = view.getUint16(pointer + 10, true);
    pointer += 16;

    // Vertices (4)
    for (let i = 0; i < vertexCount; i++) {
        if (pointer + 4 > size) {
            break;
        }
        const b1 = view.getUint8(pointer);
        const b2 = view.getUint8(pointer + 1);
        const b3 = view.getUint8(pointer + 2);
        const b4 = view.getUint8(pointer + 3);
        vertices.push([
            ((b3 >> 5) | (b4 << 3)) + globalX,
            ((b2 >> 2) | ((b3 & 31) << 6)) - globalY,
            (b1 | ((b2 & 3) << 8)) - globalZ
        ]);
        pointer += 4;
    }

    // Colors (4)
    for (let i = 0; i < colorCount; i++) {
        if (pointer + 4 > size) {
            break;
        }
        colors.push([view.getUint8(pointer), view.getUint8(pointer + 1), view.getUint8(pointer + 2)]);
        pointer += 4;
    }

    function unpackSkyIndex(b1: number, b2: number, b3: number, b4: number): [number, number, number] {
        return [(b1 >> 2) | ((b2 & 15) << 6), (b2 >> 4) | ((b3 & 63) << 4), (b3 >> 6) | (b4 << 2)];
    }

    // Polygons (8)
    for (let i = 0; i < polyCount; i++) {
        if (pointer + 8 > size) {
            break;
        }
        const [vi1, vi2, vi3] = unpackSkyIndex(view.getUint8(pointer), view.getUint8(pointer + 1), view.getUint8(pointer + 2), view.getUint8(pointer + 3));
        const [ci1, ci2, ci3] = unpackSkyIndex(view.getUint8(pointer + 4), view.getUint8(pointer + 5), view.getUint8(pointer + 6), view.getUint8(pointer + 7));
        if (vi1 < vertexCount && vi2 < vertexCount && vi3 < vertexCount && ci1 < colorCount && ci2 < colorCount && ci3 < colorCount) {
            faces.push({
                indices: [baseVertexIndex + vi1, baseVertexIndex + vi2, baseVertexIndex + vi3],
                colors: [baseColorIndex + ci1, baseColorIndex + ci2, baseColorIndex + ci3,]
            });
        }
        pointer += 8;
    }
}

function parseSkyboxPart2(data: DataView, partSize: number, partOffset: number, vertices: number[][], colors: number[][], faces: SkyFace[]): void {
    let pointer = partOffset;
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // Header (20)
    if (pointer + 20 > partSize) {
        return;
    }
    pointer += 8;
    const globalX = data.getInt16(pointer + 6, true);
    const globalY = data.getInt16(pointer, true);
    const globalZ = data.getInt16(pointer + 2, true);
    const vertexCount = data.getUint8(pointer + 4);
    const colorCount = data.getUint8(pointer + 5);
    const polyCount = data.getUint16(pointer + 10, true);
    pointer += 12;

    // Vertices (4)
    for (let i = 0; i < vertexCount; i++) {
        const b1 = data.getUint8(pointer);
        const b2 = data.getUint8(pointer + 1);
        const b3 = data.getUint8(pointer + 2);
        const b4 = data.getUint8(pointer + 3);
        vertices.push([
            ((b3 >> 5) | (b4 << 3)) + globalX,
            ((b2 >> 2) | ((b3 & 31) << 6)) - globalY,
            (b1 | ((b2 & 3) << 8)) - globalZ
        ]);
        pointer += 4;
    }

    // Colors (4)
    for (let i = 0; i < colorCount; i++) {
        colors.push([data.getUint8(pointer), data.getUint8(pointer + 1), data.getUint8(pointer + 2)]);
        pointer += 4;
    }

    function isSkyFaceInBounds(v: [number, number, number], c: [number, number, number], vc: number, cc: number) {
        // this check wouldn't be needed if the parsing was 100% correct
        // without it, over x2 amount of faces get pushed for skys that look wrong
        return v[0] < vc && v[1] < vc && v[2] < vc && c[0] < cc && c[1] < cc && c[2] < cc;
    }

    // Polys
    let seeker = pointer + polyCount;
    for (let i = polyCount; i > 3; i -= 4) {
        if (pointer + 4 > partSize) {
            return;
        }
        const b1 = data.getUint8(pointer);
        const b2 = data.getUint8(pointer + 1);
        const b3 = data.getUint8(pointer + 2);
        let c0 = (b1 >> 3) | ((b2 & 3) << 5);
        let c1 = (b2 >> 2) | ((b3 & 1) << 6);
        let c2 = b3 >> 1;
        let v0 = data.getUint8(pointer + 3);
        pointer += 4;

        if (seeker + 2 > partSize) {
            return;
        }
        let v1 = data.getUint8(seeker);
        const v2 = data.getUint8(seeker + 1);
        seeker += 2;

        let v3Base = v0;
        let c3Base = c0;

        if (isSkyFaceInBounds([v0, v1, v2], [c0, c1, c2], vertexCount, colorCount)) {
            faces.push({
                indices: [baseVertexIndex + v0, baseVertexIndex + v1, baseVertexIndex + v2],
                colors: [baseColorIndex + c0, baseColorIndex + c1, baseColorIndex + c2]
            });
        }

        for (let i = 0; i < (b1 & 7); i++) {
            if (seeker + 2 > partSize) {
                return;
            }
            const v2New = data.getUint8(seeker);
            const cm = data.getUint8(seeker + 1);
            const c2New = cm & 127;
            if (isSkyFaceInBounds([v0, v1, v2New], [c0, c1, c2New], vertexCount, colorCount)) {
                faces.push({
                    indices: [baseVertexIndex + v0, baseVertexIndex + v1, baseVertexIndex + v2New],
                    colors: [baseColorIndex + c0, baseColorIndex + c1, baseColorIndex + c2New]
                });
            }
            if ((cm & 128) > 0) {
                v1 = v3Base;
                c1 = c3Base;
            }
            v3Base = v2New;
            c3Base = c2New;
            v0 = v2New;
            c0 = c2New;
            seeker += 2;
        }
    }
}

function buildTile(data: DataView, offset: number, gameNumber: number): Tile {
    const tile = new Tile(data, offset);
    if ((tile.ff & 14) > 0 || (tile.ss & 8) === 0) {
        tile.f = true;
    }
    if (gameNumber === 1) {
        if ((tile.ss & 96) > 0 || tile.mainY !== tile.yy) {
            tile.f = true;
        }
        if ((tile.ff & 128) > 0) {
            tile.size = 32;
        } else {
            tile.size = 16;
        }
    } else if ((tile.mainY + tile.size - 1) !== tile.yy) {
        tile.f = true;
    }
    if ((tile.mainX + tile.size - 1) !== tile.xx
        || tile.mainX > (256 - tile.size)
        || tile.mainY > (256 - tile.size)) {
        tile.f = true;
    }
    if ((tile.ff & 1) > 0) {
        tile.m = 15;
    } else if ((tile.ss & 128) > 0) {
        tile.m = 8;
    } else {
        tile.m = 4;
    }
    tile.s = tile.ss & 7;
    switch (tile.m) {
        case 4:
            tile.s *= 256;
            break;
        case 8:
            tile.s *= 128;
            break;
        case 15:
            tile.s *= 64;
            break;
    }
    tile.x4 = tile.mainX + tile.s;
    tile.x3 = tile.xx + tile.s;
    tile.x1 = tile.x4;
    tile.x2 = tile.x4 + tile.size;
    tile.y4 = tile.mainY;
    if ((tile.ss & 16) > 0) {
        tile.y4 += 256;
    }
    tile.y3 = tile.y4;
    tile.y1 = tile.y4 + tile.size;
    tile.y2 = tile.y4 + tile.size;
    tile.px = (tile.p1 & 31) * 16;
    tile.py = (tile.p1 >> 6) | (tile.p2 << 2);
    tile.rotation = ((tile.ff & 127) >> 4) & 7;
    tile.offset = offset - 8;
    if (gameNumber > 1) {
        if ((tile.ff & 128) > 0) {
            tile.transparent = 1 + ((tile.ss & 127) >> 5);
        } else {
            tile.transparent = 0;
        }
    }
    return tile;
}
