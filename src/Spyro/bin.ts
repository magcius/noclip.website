interface GroundFace {
    indices: number[];
    uvIndices: number[] | null;
    colorIndices: number[] | null;
    isLOD: boolean;
    isWater?: boolean;
    isTransparent?: boolean;
}

interface SkyboxFace {
    indices: [number, number, number];
    colorIndices: [number, number, number];
}

interface Tile {
    x0: number; y0: number; p1: number; p2: number;
    xx: number; yy: number; ss: number; ff: number;
    px: number; py: number; m: 4 | 8 | 15; w: number;
    x1: number; x2: number; x3: number; x4: number;
    y1: number; y2: number; y3: number; y4: number;
    r: number; s: number; off: number; f: boolean;
    b: number;
}

interface TileAtlas {
    data: Uint8Array;
    width: number;
    height: number;
    uvs: {u0: number; v0: number; u1: number; v1: number}[];
    tiles?: Tile[];
}

export interface Level {
  vertices: number[][];
  colors: number[][];
  faces: GroundFace[];
  uvs: number[][];
  atlas: TileAtlas;
};

export interface Skybox {
    backgroundColor: [number, number, number];
    vertices: [number, number, number][];
    colors: [number, number, number][]; 
    faces: SkyboxFace[];
}

export interface Moby {
    x: number;
    y: number;
    z: number;
    yaw: number;
    classId: number;
}

class Header {
    static size = 2+2+2+2 + 1+1+1+1 + 1+1+1+1 + 4;
    y: number; x: number; i0: number; z: number;
    v1: number; c1: number; p1: number; i1: number;
    v2: number; c2: number; p2: number; w: number;
    f: number;
    constructor(view: DataView, offs: number) {
        this.y = view.getInt16(offs, true);
        this.x = view.getInt16(offs+2, true);
        this.i0 = view.getUint16(offs+4, true);
        this.z = view.getInt16(offs+6, true);
        this.v1 = view.getUint8(offs+8);
        this.c1 = view.getUint8(offs+9);
        this.p1 = view.getUint8(offs+10);
        this.i1 = view.getUint8(offs+11);
        this.v2 = view.getUint8(offs+12);
        this.c2 = view.getUint8(offs+13);
        this.p2 = view.getUint8(offs+14);
        this.w = view.getUint8(offs+15);
        this.f = view.getUint32(offs+16, true);
    }
}

class Vertex {
    b1: number; b2: number; b3: number; b4: number;
    constructor(view: DataView, offset: number) {
        this.b1 = view.getUint8(offset);
        this.b2 = view.getUint8(offset+1);
        this.b3 = view.getUint8(offset+2);
        this.b4 = view.getUint8(offset+3);
    }
}

class VertexColor {
    r: number; g: number; b: number;
    constructor(view: DataView, offset: number) {
        this.r = view.getUint8(offset);
        this.g = view.getUint8(offset+1);
        this.b = view.getUint8(offset+2);
        // this.n = view.getUint8(offs+3); not used?
    }
}

class LODPoly {
    n: number; v1: number; v2: number; v3: number;
    f: number; c1: number; c2: number; c3: number;

    constructor(view: DataView, offs: number) {
        this.n = view.getUint8(offs);
        this.v1 = view.getUint8(offs+1);
        this.v2 = view.getUint8(offs+2);
        this.v3 = view.getUint8(offs+3);
        this.f = view.getUint8(offs+4);
        this.c1 = view.getUint8(offs+5);
        this.c2 = view.getUint8(offs+6);
        this.c3 = view.getUint8(offs+7);
    }
}

class LODPoly2 {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;

    constructor(view: DataView, offs: number) {
        this.v1 = view.getUint8(offs);
        this.v2 = view.getUint8(offs+1);
        this.v3 = view.getUint8(offs+2);
        this.v4 = view.getUint8(offs+3);
        this.c1 = view.getUint8(offs+4);
        this.c2 = view.getUint8(offs+5);
        this.c3 = view.getUint8(offs+6);
        this.c4 = view.getUint8(offs+7);
    }
}

class Polygon {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;
    t: number; r: number; // S1 only
    s1: number; s2: number; s3: number; s4: number; // S2 only
    tt: number; ii: number; isWater: boolean; // S2 only
    constructor(view: DataView, offs: number, gameNumber: number) {
        this.v1 = view.getUint8(offs);
        this.v2 = view.getUint8(offs+1);
        this.v3 = view.getUint8(offs+2);
        this.v4 = view.getUint8(offs+3);
        this.c1 = view.getUint8(offs+4);
        this.c2 = view.getUint8(offs+5);
        this.c3 = view.getUint8(offs+6);
        this.c4 = view.getUint8(offs+7);
        if (gameNumber == 1) {
            this.t = view.getUint8(offs+8);
            this.r = view.getUint8(offs+9);
        } else {
            this.s1 = view.getUint8(offs+8);
            this.s2 = view.getUint8(offs+9);
            this.s3 = view.getUint8(offs+10);
            this.s4 = view.getUint8(offs+11);
            this.isWater = this.s1 === 0 && this.s2 === 0 && this.s3 === 0 && this.s4 === 0;
            this.tt = view.getUint8(offs+12) & 0x7F;
            this.ii = view.getUint8(offs+13);
        }
    }
}

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

    applyFontStripFix() {
        // S2 only fix
        const width = 512;
        const y = 255;
        for (let x = width; x <= 575; x++) {
            this.data[y * width + x] = this.data[(y - 1) * width + (x - width)];
        }
    }
}

function applyTileRotationRGBA(rgba: Uint8Array, tile: Tile, size: number = 32): Uint8Array {
    const rotation = tile.r & 7;
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

    switch (rotation) {
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
    const r5 = (word) & 0x1F;
    const g5 = (word >> 5) & 0x1F;
    const b5 = (word >> 10) & 0x1F;
    const stp = (word >> 15) & 0x01; // transparency
    const r = (r5 * 255 / 31) | 0;
    const g = (g5 * 255 / 31) | 0;
    const b = (b5 * 255 / 31) | 0;
    return [r, g, b, stp ? 0 : 255];
}

function readCLUT(vram: VRAM, px: number, py: number, n: number): [number, number, number, number][] {
    const palette: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
        palette.push(colorBitsToRGBA(vram.getWordByIndex((py * 512 + px) + i)));
    }
    return palette;
}

function decodeTileToRGBA(vram: VRAM, tile: Tile, width: number = tile.w, height: number = tile.w): Uint8Array {
    let x4 = tile.x4;
    const y4 = tile.y4;
    if (tile.m === 4) {
        x4 = x4 >> 2;
        const palette = readCLUT(vram, tile.px, tile.py, 16);
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 4; x++) {
                const word = vram.getWord(x4 + x, y4 + y);
                for (let nib = 0; nib < 4; nib++) {
                    const dst = (y * width + (x * 4 + nib)) * 4;
                    const [r, g, b, a] = palette[(word >> (nib * 4)) & 0x0F];
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
        const palette = readCLUT(vram, tile.px, tile.py, 256);
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 2; x++) {
                const word = vram.getWord(x4 + x, y4 + y);
                {
                    const dst = (y * width + (x * 2)) * 4;
                    const [r, g, b, a] = palette[word & 0xFF];
                    out[dst + 0] = r;
                    out[dst + 1] = g;
                    out[dst + 2] = b;
                    out[dst + 3] = a;
                }
                {
                    const dst = (y * width + (x * 2 + 1)) * 4;
                    const [r, g, b, a] = palette[(word >> 8) & 0xFF];
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

function buildFaces1(poly: Polygon, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], atlas: TileAtlas) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const tileIndex = poly.t & 0x7F;
    if (atlas && tileIndex >= 0 && tileIndex < atlas.uvs.length) {
        const rect = atlas.uvs[tileIndex];
        const uv1 = [rect.u0, rect.v1];
        const uv2 = [rect.u1, rect.v1];
        const uv3 = [rect.u1, rect.v0];
        const uv4 = [rect.u0, rect.v0];
        const ca = mdlColorStart + poly.c1;
        const cb = mdlColorStart + poly.c2;
        const cc = mdlColorStart + poly.c3;
        const cd = mdlColorStart + poly.c4;

        if (poly.v1 === poly.v2) {
            const tl: [number, number] = [rect.u0, rect.v0];
            const tr: [number, number] = [rect.u1, rect.v0];
            const br: [number, number] = [rect.u1, rect.v1];
            const bl: [number, number] = [rect.u0, rect.v1];
            const rr = poly.r & 3;
            const base = [bl, br, tr, tl];
            const permutations = [
                [0, 1, 2, 3], // r=0
                [3, 0, 1, 2], // r=1
                [2, 3, 0, 1], // r=2
                [1, 2, 3, 0], // r=3
            ];
            const permutation = permutations[rr];
            const tex1 = base[permutation[0]];
            const tex2 = base[permutation[1]];
            const tex3 = base[permutation[2]];
            const tex4 = base[permutation[3]];
            const uv0 = uvs.push(tex4) - 1; // v4
            const uv1 = uvs.push(tex3) - 1; // v3
            const uv2 = uvs.push(tex1) - 1; // v1
            faces.push({
                indices: [d, c, b],
                uvIndices: [uv0, uv1, uv2],
                colorIndices: [cd, cc, ca],
                isLOD: false
            });
        } else {
            // v1 -> tex1, v2 -> tex2, v3 -> tex3, v4 -> tex4
            const uvA = uvs.push(uv1) - 1; // v1
            const uvB = uvs.push(uv2) - 1; // v2
            const uvC = uvs.push(uv3) - 1; // v3
            const uvD = uvs.push(uv4) - 1; // v4
            faces.push({
                indices: [a, b, c],  // v1, v2, v3
                uvIndices: [uvA, uvB, uvC],
                colorIndices:[ca, cb, cc],
                isLOD: false
            });
            faces.push({
                indices: [a, c, d],  // v1, v3, v4
                uvIndices: [uvA, uvC, uvD],
                colorIndices:[ca, cc, cd],
                isLOD: false
            });
        }
    } else {
        faces.push({
            indices: [a, b, c],
            uvIndices: null,
            colorIndices: null,
            isLOD: false
        });
    }
}

function buildFaces2(poly: Polygon, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], atlas: TileAtlas) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const colorA = mdlColorStart + poly.c1;
    const colorB = mdlColorStart + poly.c2;
    const colorC = mdlColorStart + poly.c3;
    const colorD = mdlColorStart + poly.c4;
    const tileIndex = poly.tt & 0x7f;
    const rect = atlas.uvs[tileIndex];
    let A = [rect.u0, rect.v1];
    let B = [rect.u1, rect.v1];
    let C = [rect.u1, rect.v0];
    let D = [rect.u0, rect.v0];

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

    const tile = atlas.tiles![tileIndex];
    const isTransparent = tile.b > 0;
    const isTri = (poly.v1 === poly.v2);
    let polyRotation = 0;
    if (isTri) {
        const rr = (poly.ii >> 4) & 3;
        polyRotation = ((tile.r & 7) - rr) & 3;
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
    const iByte = poly.ii;
    // const bothSides = !!(iByte & 0x08);
    const isWater = poly.s1 === 0 && poly.s2 === 0 && poly.s3 === 0 && poly.s4 === 0;
    const inverse = !!(iByte & 0x04);

    if (isTri) {
        if (!inverse) {
            faces.push({
                indices: [b, c, d],
                uvIndices: [uvIndexA, uvIndexC, uvIndexD],
                colorIndices: [colorB, colorC, colorD],
                isWater,
                isTransparent,
                isLOD: false
            });
        } else {
            faces.push({
                indices: [d, c, b],
                uvIndices: [uvIndexD, uvIndexC, uvIndexA],
                colorIndices: [colorD, colorC, colorB],
                isWater,
                isTransparent,
                isLOD: false
            });
        }
    } else {
        faces.push({
            indices: [a, b, c],
            uvIndices: [uvIndexA, uvIndexB, uvIndexC],
            colorIndices: [colorA, colorB, colorC],
            isWater,
            isTransparent,
            isLOD: false
        });
        faces.push({
            indices: [a, c, d],
            uvIndices: [uvIndexA, uvIndexC, uvIndexD],
            colorIndices: [colorA, colorC, colorD],
            isWater,
            isTransparent,
            isLOD: false
        });
    }
}

export function buildSkybox(view: DataView, gameNumber: number): Skybox {
    const size = view.byteLength;
    let pointer = 0;
    const backgroundColor: [number, number, number] = [
        view.getUint8(pointer),
        view.getUint8(pointer + 1),
        view.getUint8(pointer + 2)
    ];
    pointer += 4;
    const partOffsets: number[] = [];
    while (pointer + 4 <= size) {
        const partOffset = view.getUint32(pointer, true);
        pointer += 4;
        if (partOffset === 0 || partOffset >= size)
            break;
        partOffsets.push(partOffset);
    }
    const uniqueOffsets = Array.from(new Set(partOffsets)).sort((a, b) => a - b);
    const vertices: [number, number, number][] = [];
    const colors: [number, number, number][] = [];
    const faces: SkyboxFace[] = [];
    for (const partOffset of uniqueOffsets) {
        if (gameNumber == 1) {
            parseSkyboxPart(view, size, partOffset, vertices, colors, faces);
        } else {
            parseSkyboxPart2(view, size, partOffset, vertices, colors, faces);
        }
    }
    return { backgroundColor, vertices, colors, faces };
}

export function buildLevel(view: DataView, atlas: TileAtlas, gameNumber: number): Level {
    const vertices: number[][] = [];
    const colors: number[][] = [];
    const faces: GroundFace[] = [];
    const uvs: number[][] = [];
    let offset = 0;
    let partCount = view.getUint32(offset, true);
    offset += 4;
    const start = 8;
    const partOffsets: number[] = [];

    if (gameNumber > 1) {
        offset = 0;
        let partTablePos = view.getUint32(offset, true);
        offset += 4;
        partCount = view.getUint32(partTablePos, true);
        partTablePos += 4;
        for (let i = 0; i < partCount; i++) {
            partOffsets.push(view.getUint32(partTablePos, true));
            partTablePos += 4;
        }
    }

    for (let part = 0; part < partCount; part++) {
        let pointer = 0;
        if (gameNumber == 1) {
            const o = view.getUint32(offset, true);
            offset += 4;
            pointer = o + start;
        } else {
            pointer = partOffsets[part] + 8;
        }
        const header = new Header(view, pointer);
        pointer += Header.size;

        // LOD vertices
        const lodVertStart = vertices.length;
        for (let i = 0; i < header.v1; i++) {
            const v = new Vertex(view, pointer);
            pointer += 4;
            const zraw = (v.b1 | ((v.b2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                z = (zraw << 1) + header.z; // lazy z-scaling to correct for S2/S3, see proper z-scaling further below
            }
            const y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y;
            const x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // LOD colors
        const lodColorStart = colors.length;
        for (let i = 0; i < header.c1; i++) {
            const c = new VertexColor(view, pointer);
            pointer += 4;
            colors.push([c.r, c.g, c.b]);
        }

        // LOD polys
        for (let i = 0; i < header.p1; i++) {
            const poly = gameNumber > 1 ? new LODPoly2(view, pointer) : new LODPoly(view, pointer);
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
                faces.push({ indices: [b, c, d], uvIndices: null, colorIndices: [cB, cC, cD], isLOD: true });
            else if (v2 === v3)
                faces.push({ indices: [a, c, d], uvIndices: null, colorIndices: [cA, cC, cD], isLOD: true });
            else if (v3 === v4)
                faces.push({ indices: [a, b, d], uvIndices: null, colorIndices: [cA, cB, cD], isLOD: true });
            else if (v4 === v1)
                faces.push({ indices: [a, b, c], uvIndices: null, colorIndices: [cA, cB, cC], isLOD: true });
            else {
                faces.push({ indices: [b, a, c], uvIndices: null, colorIndices: [cB, cA, cC], isLOD: true });
                faces.push({ indices: [b, c, d], uvIndices: null, colorIndices: [cB, cC, cD], isLOD: true });
            }
        }

        // MDL/FAR/TEX vertices
        let isWaterNonGround = false;
        if (gameNumber > 1) {
            let polyPos = pointer + header.v2 * 4 + header.c2 * 4 + header.c2 * 4;
            for (let i = 0; i < header.p2; i++) {
                const s1 = view.getUint8(polyPos + 8);
                const s2 = view.getUint8(polyPos + 9);
                const s3 = view.getUint8(polyPos + 10);
                const s4 = view.getUint8(polyPos + 11);
                if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) {
                    isWaterNonGround = true;
                    break;
                }
                polyPos += 16;
            }
        }
        const mdlVertStart = vertices.length;
        for (let i = 0; i < header.v2; i++) {
            const vertex = new Vertex(view, pointer);
            pointer += 4;
            const zraw = (vertex.b1 | ((vertex.b2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                // z-scaling
                // non-ground water is usually flat water, while "ground" water is usually sloped (different signatures)
                const far = header.v1 === 0 && header.f === 0xFFFFFFFF;
                if ((far && !isWaterNonGround) || (far && isWaterNonGround && header.w > 0) || (!far && header.w > 0)) {
                    z = (zraw << 1) + header.z;
                } else if ((far && isWaterNonGround && header.w <= 0) || (!far && header.w <= 0)) {
                    z = (zraw >> 2) + header.z;
                }
            }
            const y = ((vertex.b2 >> 2) | ((vertex.b3 & 31) << 6)) + header.y;
            const x = ((vertex.b3 >> 5) | (vertex.b4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // MDL colors
        const mdlColorStart = colors.length;
        for (let i = 0; i < header.c2; i++) {
            const color = new VertexColor(view, pointer);
            pointer += 4;
            colors.push([color.r, color.g, color.b]);
        }

        // FAR colors (ignored)
        pointer += header.c2 * 4;

        // Textured polys
        for (let i = 0; i < header.p2; i++) {
            const poly = new Polygon(view, pointer, gameNumber);
            pointer += 16;
            if (gameNumber == 1) {
                buildFaces1(poly, mdlVertStart, mdlColorStart, faces, uvs, atlas)
            } else {
                buildFaces2(poly, mdlVertStart, mdlColorStart, faces, uvs, atlas)
            }
        }
    }

    return { vertices, colors, faces, uvs, atlas };
}

export function buildTileAtlas(vram: VRAM, view: DataView, gameNumber: number): TileAtlas {
    const tiles = parseTiles(view, gameNumber);
    const tilesPerRow = 8;
    const slotSize = 32;
    const tileCount = tiles.length;
    const width = tilesPerRow * slotSize;
    const height = Math.ceil(tileCount / tilesPerRow) * slotSize;
    const data = new Uint8Array(width * height * 4);
    const uvs: { u0: number; v0: number; u1: number; v1: number }[] = [];
    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        const w = tile.w;
        const h = tile.w;
        let rgba = decodeTileToRGBA(vram, tile, w, h);
        if (gameNumber == 1) {
            rgba = applyTileRotationRGBA(rgba, tile, w);
        }
        const atlasX = (i % tilesPerRow) * slotSize;
        const atlasY = Math.floor(i / tilesPerRow) * slotSize;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const src = (y * w + x) * 4;
                const dst = ((atlasY + y) * width + (atlasX + x)) * 4;
                data[dst + 0] = rgba[src + 0];
                data[dst + 1] = rgba[src + 1];
                data[dst + 2] = rgba[src + 2];
                data[dst + 3] = rgba[src + 3];
            }
        }
        uvs.push({
            u0: atlasX / width,
            v0: atlasY / height,
            u1: (atlasX + slotSize) / width,
            v1: (atlasY + slotSize) / height,
        });
    }
    if (gameNumber == 1) {
        return { data, width, height, uvs };
    }
    return { data, width, height, uvs, tiles };
}

export function parseMobys(view: DataView): Moby[] {
    let cursor = 16;
    let index = 0;
    while (cursor < view.byteLength - 8 && index < 12) {
        const sectionSize = view.getUint32(cursor, true);
        cursor += sectionSize;
        index += 1;
    }

    const mobys: Moby[] = [];
    for (let i = 0; i < view.getUint32(cursor + 4, true); i++) {
        const pos = cursor + 8 + (i * 88);
        if (pos + 88 > view.byteLength)
            break;
        const x = view.getInt32(pos + 12, true);
        const y = view.getInt32(pos + 16, true);
        const z = view.getInt32(pos + 20, true);
        if (x === 0 && y === 0 && z === 0)
            continue;
        mobys.push({
            x, y, z, yaw: 0,
            classId: view.getUint8(pos + 0x36)
        });
    }
    return mobys;
}

function parseTiles(view: DataView, gameNumber: number): Tile[] {
    const tiles: Tile[] = [];
    let offset = 4;
    let count = view.getUint32(offset, true);
    offset += 4;
    for (let i = 0; i < count; i++) {
        offset += 8;
        const tile: Tile = {
            x0: view.getUint8(offset + 0), y0: view.getUint8(offset + 1),
            p1: view.getUint8(offset + 2), p2: view.getUint8(offset + 3),
            xx: view.getUint8(offset + 4), yy: view.getUint8(offset + 5),
            ss: view.getUint8(offset + 6), ff: view.getUint8(offset + 7),
            px: 0, py: 0, m: 4, w: 32,
            x1: 0, x2: 0, x3: 0, x4: 0,
            y1: 0, y2: 0, y3: 0, y4: 0,
            r: 0, s: 0, off: offset, f: false, b: 0
        };
        offset += 8;
        textureCompute(tile, offset - 8, gameNumber);
        tiles.push(tile);
        if (gameNumber > 1) {
            offset += 32; // skip unused groups
        }
    }
    return tiles;
}

function parseSkyboxPart(view: DataView, size: number, partOffset: number, vertices: [number, number, number][], colors: [number, number, number][], faces: SkyboxFace[]): void {
    let pointer = partOffset;
    if (pointer + 24 > size)
        return;

    // header_sky1_ (24 bytes)
    pointer += 8;
    const globalY = view.getInt16(pointer + 0, true);
    const globalZ = view.getInt16(pointer + 2, true);
    const vCount = view.getUint16(pointer + 4, true);
    const globalX = view.getInt16(pointer + 6, true);
    const pCount = view.getUint16(pointer + 8, true);
    const cCount = view.getUint16(pointer + 10, true);
    pointer += 16;
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // Vertices block: vCount * 4 bytes
    for (let i = 0; i < vCount; i++) {
        if (pointer + 4 > size)
            break;
        const b1 = view.getUint8(pointer + 0);
        const b2 = view.getUint8(pointer + 1);
        const b3 = view.getUint8(pointer + 2);
        const b4 = view.getUint8(pointer + 3);
        pointer += 4;
        const packedZ = (b1 | ((b2 & 0x03) << 8));
        const packedY = ((b2 >> 2) | ((b3 & 0x1F) << 6));
        const packedX = ((b3 >> 5) | (b4 << 3));
        const z = packedZ - globalZ;
        const y = packedY - globalY;
        const x = packedX + globalX;
        vertices.push([x, y, z]);
    }

    // Colors block: cCount * 4 bytes
    for (let i = 0; i < cCount; i++) {
        if (pointer + 4 > size)
            break;
        const r = view.getUint8(pointer + 0);
        const g = view.getUint8(pointer + 1);
        const b = view.getUint8(pointer + 2);
        // const n = view.getUint8(p + 3);
        pointer += 4;
        colors.push([r, g, b]);
    }

    // Polys block: pCount * 8 bytes
    for (let i = 0; i < pCount; i++) {
        if (pointer + 8 > size)
            break;
        const v1_packed1 = view.getUint8(pointer + 0);
        const v1_packed2 = view.getUint8(pointer + 1);
        const v1_packed3 = view.getUint8(pointer + 2);
        const v1_packed4 = view.getUint8(pointer + 3);
        const c1_packed1 = view.getUint8(pointer + 4);
        const c1_packed2 = view.getUint8(pointer + 5);
        const c1_packed3 = view.getUint8(pointer + 6);
        const c1_packed4 = view.getUint8(pointer + 7);
        pointer += 8;
        const [vi1, vi2, vi3] = unpackSkyIndex(v1_packed1, v1_packed2, v1_packed3, v1_packed4);
        const [ci1, ci2, ci3] = unpackSkyIndex(c1_packed1, c1_packed2, c1_packed3, c1_packed4);
        if (vi1 < vCount && vi2 < vCount && vi3 < vCount && ci1 < cCount && ci2 < cCount && ci3 < cCount) {
            faces.push({
                indices: [baseVertexIndex + vi1, baseVertexIndex + vi2, baseVertexIndex + vi3],
                colorIndices: [baseColorIndex + ci1, baseColorIndex + ci2, baseColorIndex + ci3,]
            });
        }
    }
}

function parseSkyboxPart2(view: DataView, size: number, partOffset: number, vertices: [number, number, number][], colors: [number, number, number][], faces: SkyboxFace[]): void {
    let pointer = partOffset;
    if (pointer + 20 > size)
        return;

    // Header
    pointer += 8;
    const globalY = view.getInt16(pointer + 0, true);
    const globalZ = view.getInt16(pointer + 2, true);
    const vCount = view.getUint8(pointer + 4);
    const cCount = view.getUint8(pointer + 5);
    const globalX = view.getInt16(pointer + 6, true);
    const miscSize = view.getUint16(pointer + 8, true);
    const poly1Size = view.getUint16(pointer + 10, true);
    pointer += 12; // total header = 20 bytes

    const baseVertexIndex = vertices.length;
    const baseColorIndex  = colors.length;

    // Vertices
    for (let i = 0; i < vCount; i++) {
        if (pointer + 4 > size)
            return;

        const b1 = view.getUint8(pointer + 0);
        const b2 = view.getUint8(pointer + 1);
        const b3 = view.getUint8(pointer + 2);
        const b4 = view.getUint8(pointer + 3);
        pointer += 4;

        const packedZ = (b1 | ((b2 & 0x03) << 8));
        const packedY = ((b2 >> 2) | ((b3 & 0x1F) << 6));
        const packedX = ((b3 >> 5) | (b4 << 3));

        const z = packedZ - globalZ;
        const y = packedY - globalY;
        const x = packedX + globalX;

        vertices.push([x, y, z]);
    }

    // Colors
    for (let i = 0; i < cCount; i++) {
        if (pointer + 4 > size) return;
        const r = view.getUint8(pointer + 0);
        const g = view.getUint8(pointer + 1);
        const b = view.getUint8(pointer + 2);
        pointer += 4;
        colors.push([r, g, b]);
    }

    // Main polys
    const poly1Start = pointer;
    const poly1End = poly1Start + poly1Size;
    if (poly1End > size) return;

    let seeker = poly1End;
    let remaining = poly1Size;

    while (remaining > 3) {
        if (pointer + 4 > size)
            return;
        remaining -= 4;

        const b1 = view.getUint8(pointer++);
        const b2 = view.getUint8(pointer++);
        const b3 = view.getUint8(pointer++);
        let v0 = view.getUint8(pointer++);
        let c0 = (b1 >> 3) | ((b2 & 0x03) << 5);
        let c1 = (b2 >> 2) | ((b3 & 0x01) << 6);
        const c2 = (b3 >> 1);
        let pp = (b1 & 0x07);

        if (seeker + 2 > size)
            return;
        let v1 = view.getUint8(seeker++);
        let v2 = view.getUint8(seeker++);

        if (v0 >= vCount || v1 >= vCount || v2 >= vCount) {
            // pass
        } else if (c0 < cCount && c1 < cCount && c2 < cCount) {
            faces.push({
                indices: [
                    baseVertexIndex + v0,
                    baseVertexIndex + v1,
                    baseVertexIndex + v2,
                ],
                colorIndices: [
                    baseColorIndex + c0,
                    baseColorIndex + c1,
                    baseColorIndex + c2,
                ],
            });
        }

        let v3 = v0;
        let c3 = c0;
        while (pp > 0) {
            pp--;
            if (seeker + 2 > size)
                return;
            const vN = view.getUint8(seeker++);
            const cm = view.getUint8(seeker++);
            const c2n = cm & 0x7F;
            if (v0 < vCount && v1 < vCount && vN < vCount && c0 < cCount && c1 < cCount && c2n < cCount) {
                faces.push({
                    indices: [
                        baseVertexIndex + v0,
                        baseVertexIndex + v1,
                        baseVertexIndex + vN,
                    ],
                    colorIndices: [
                        baseColorIndex + c0,
                        baseColorIndex + c1,
                        baseColorIndex + c2n,
                    ],
                });
            }
            if ((cm & 0x80) !== 0) {
                v1 = v3;
                c1 = c3;
            }
            v3 = vN;
            c3 = c2n;
            v0 = vN;
            c0 = c2n;
        }
    }
}

function unpackSkyIndex(b1: number, b2: number, b3: number, b4: number): [number, number, number] {
    const i1 = (b1 >> 2) | ((b2 & 0x0F) << 6);
    const i2 = (b2 >> 4) | ((b3 & 0x3F) << 4);
    const i3 = (b3 >> 6) | (b4 << 2);
    return [i1, i2, i3];
}

function textureCompute(tex: Tile, offset: number, gameNumber: number): void {
    // SWV equivalent of texture_compute
    tex.f = false;
    tex.off = offset;

    if ((tex.ff & 0x0E) > 0 || (tex.ss & 0x08) === 0)
        tex.f = true;

    if (gameNumber > 1) {
        tex.w = 32;
        tex.b = (tex.ss >> 5) & 0x03;
    } else {
        if ((tex.ff & 0x80) > 0)
            tex.w = 32;
        else
            tex.w = 16;

        if (tex.ff & 0x80)
            tex.b = 1 + ((tex.ss & 0x7f) >> 5);
        else
            tex.b = 0;
    }

    if ((tex.x0 + tex.w - 1) !== tex.xx || tex.x0 > (256 - tex.w) || tex.y0 > (256 - tex.w))
        tex.f = true;

    if ((tex.ff & 0x01) > 0) {
        tex.m = 15;
    } else {
        if ((tex.ss & 0x80) > 0)
            tex.m = 8;
        else
            tex.m = 4;
    }

    tex.s = tex.ss & 0x07;
    if (tex.m === 4)
        tex.s = 256 * tex.s;
    if (tex.m === 8)
        tex.s = 128 * tex.s;
    if (tex.m === 15)
        tex.s = 64 * tex.s;

    tex.x4 = tex.x0 + tex.s;
    tex.x3 = tex.xx + tex.s;
    tex.x1 = tex.x4;
    tex.x2 = tex.x4 + tex.w;

    tex.y4 = tex.y0;
    if ((tex.ss & 0x10) > 0)
        tex.y4 += 256;
    tex.y3 = tex.y4;
    tex.y1 = tex.y4 + tex.w;
    tex.y2 = tex.y4 + tex.w;

    tex.px = (tex.p1 & 31) * 16;
    tex.py = (tex.p1 >> 6) | (tex.p2 << 2);

    tex.r = (tex.ff & 127) >> 4;

    tex.off = offset - 8;
}
