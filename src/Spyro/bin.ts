interface GroundFace {
    indices: number[];
    uvIndices: number[] | null;
    colorIndices: number[] | null;
    texture: number | null;
    rotation: number | null;
    bothSides?: boolean;
    inverse?: boolean;
    isWater?: boolean;
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

interface TileGroups {
    lod: Tile[];
}

interface TileAtlas {
    data: Uint8Array;
    width: number;
    height: number;
    uvs: {u0: number; v0: number; u1: number; v1: number}[];
    tiles?: Tile[];
}

export type Level = {
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
    constructor(view: DataView, offs: number) {
        this.b1 = view.getUint8(offs);
        this.b2 = view.getUint8(offs+1);
        this.b3 = view.getUint8(offs+2);
        this.b4 = view.getUint8(offs+3);
    }
}

class Color {
    r: number; g: number; b: number; n: number;
    constructor(view: DataView, offs: number) {
        this.r = view.getUint8(offs);
        this.g = view.getUint8(offs+1);
        this.b = view.getUint8(offs+2);
        this.n = view.getUint8(offs+3);
    }
}

class Poly {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;
    t: number; r: number; // S1 only
    s1: number; s2: number; s3: number; s4: number; // S2 only
    tt: number; ii: number; // S2 only
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
        } else if (gameNumber == 2) {
            this.s1 = view.getUint8(offs+8);
            this.s2 = view.getUint8(offs+9);
            this.s3 = view.getUint8(offs+10);
            this.s4 = view.getUint8(offs+11);
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
        const index = wordY * 512 + wordX;
        return this.data[index];
    }

    getWordByIndex(wordIndex: number): number {
        if (wordIndex < 0 || wordIndex >= this.data.length) {
            return 0;
        }
        return this.data[wordIndex];
    }

    applyFontStripFix() {
        const width = 512;
        const y = 255;
        for (let x = 512; x <= 575; x++) {
            const dstIndex = y * width + x;
            const srcIndex = (y - 1) * width + (x - 512);
            this.data[dstIndex] = this.data[srcIndex];
        }
    }
}

function applyTileRotationRGBA(rgba: Uint8Array, tex: Tile, size: number = 32): Uint8Array {
    const r = tex.r & 7;
    let out = rgba;

    function rotate90(src: Uint8Array): Uint8Array {
        const dst = new Uint8Array(src.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const s = (y * size + x) * 4;
                const d = (x * size + (size - 1 - y)) * 4;
                dst[d + 0] = src[s + 0];
                dst[d + 1] = src[s + 1];
                dst[d + 2] = src[s + 2];
                dst[d + 3] = src[s + 3];
            }
        }
        return dst;
    }

    function mirrorX(src: Uint8Array): Uint8Array {
        const dst = new Uint8Array(src.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const s = (y * size + x) * 4;
                const d = (y * size + (size - 1 - x)) * 4;
                dst[d + 0] = src[s + 0];
                dst[d + 1] = src[s + 1];
                dst[d + 2] = src[s + 2];
                dst[d + 3] = src[s + 3];
            }
        }
        return dst;
    }

    switch (r) {
        case 0: // normal
            break;
        case 1: // rotate 90 left
            out = rotate90(out);
            break;
        case 2: // rotate 90 right
            out = rotate90(rotate90(rotate90(out)));
            break;
        case 3: // rotate 180
            out = rotate90(rotate90(out));
            break;
        case 5: // mirror
            out = mirrorX(out);
            break;
        case 4: // mirror + 90 left
            out = rotate90(mirrorX(out));
            break;
        case 6: // mirror + 90 right
            out = rotate90(rotate90(rotate90(mirrorX(out))));
            break;
        case 7: // mirror + 180
            out = rotate90(rotate90(mirrorX(out)));
            break;
    }

    return out;
}

function colorBitsToRGBA(word: number): [number, number, number, number] {
    const r5 = (word) & 0x1F;
    const g5 = (word >> 5) & 0x1F;
    const b5 = (word >> 10) & 0x1F;
    const stp = (word >> 15) & 0x01; // transparency bit
    const r = (r5 * 255 / 31) | 0;
    const g = (g5 * 255 / 31) | 0;
    const b = (b5 * 255 / 31) | 0;
    const a = stp ? 0 : 255; // treat stp=1 as transparent
    return [r, g, b, a];
}

function readClut4bpp(vram: VRAM, px: number, py: number): [number, number, number, number][] {
    const palette: [number, number, number, number][] = [];
    const baseWordIndex = py * 512 + px;
    for (let i = 0; i < 16; i++) {
        const wordIndex = baseWordIndex + i;
        const word = vram.getWordByIndex(wordIndex);
        const [r, g, b, a] = colorBitsToRGBA(word);
        palette.push([r, g, b, a]);
    }
    return palette;
}

function readClut8bpp(vram: VRAM, px: number, py: number): [number, number, number, number][] {
    const palette: [number, number, number, number][] = [];
    const baseWordIndex = py * 512 + px;
    for (let i = 0; i < 256; i++) {
        const wordIndex = baseWordIndex + i;
        const word = vram.getWordByIndex(wordIndex);
        const [r, g, b, a] = colorBitsToRGBA(word);
        palette.push([r, g, b, a]);
    }
    return palette;
}

function decode4bppTile(vram: VRAM, tileX: number, tileY: number, width: number, height: number, palette: [number, number, number, number][]): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let xWord = 0; xWord < width / 4; xWord++) {
            const vramX = tileX + xWord;
            const vramY = tileY + y;
            const word = vram.getWord(vramX, vramY);
            for (let nib = 0; nib < 4; nib++) {
                const texX = xWord * 4 + nib;
                const texY = y;
                const dst = (texY * width + texX) * 4;
                const index = (word >> (nib * 4)) & 0x0F;
                const [r, g, b, a] = palette[index];
                out[dst + 0] = r;
                out[dst + 1] = g;
                out[dst + 2] = b;
                out[dst + 3] = a;
            }
        }
    }
    return out;
}

function decode8bppTile(vram: VRAM, tileX: number, tileY: number, width: number, height: number, palette: [number, number, number, number][]): Uint8Array {
    const out = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let xWord = 0; xWord < width / 2; xWord++) {
            const vramX = tileX + xWord;
            const vramY = tileY + y;
            const word = vram.getWord(vramX, vramY);
            const index0 = word & 0xFF;
            const index1 = (word >> 8) & 0xFF;

            // texel 0
            {
                const texX = xWord * 2 + 0;
                const texY = y;
                const dst = (texY * width + texX) * 4;
                const [r, g, b, a] = palette[index0];
                out[dst + 0] = r;
                out[dst + 1] = g;
                out[dst + 2] = b;
                out[dst + 3] = a;
            }

            // texel 1
            {
                const texX = xWord * 2 + 1;
                const texY = y;
                const dst = (texY * width + texX) * 4;
                const [r, g, b, a] = palette[index1];
                out[dst + 0] = r;
                out[dst + 1] = g;
                out[dst + 2] = b;
                out[dst + 3] = a;
            }
        }
    }

    return out;
}

function decodeTileToRGBA(vram: VRAM, tex: Tile, width: number = tex.w, height: number = tex.w): Uint8Array {
    let x4 = tex.x4;
    const y4 = tex.y4;
    if (tex.m === 4) {
        x4 = x4 >> 2;
        const palette = readClut4bpp(vram, tex.px, tex.py);
        return decode4bppTile(vram, x4, y4, width, height, palette);
    } else if (tex.m === 8) {
        x4 = x4 >> 1;
        const palette = readClut8bpp(vram, tex.px, tex.py);
        return decode8bppTile(vram, x4, y4, width, height, palette);
    } else {
        const out = new Uint8Array(width * height * 4);
        const wordX = tex.x4;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const word = vram.getWord(wordX + x, y4 + y);
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

function buildFaces1(poly: Poly, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], atlas: TileAtlas) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const tileIndex = poly.t & 0x7F;
    if (atlas && tileIndex >= 0 && tileIndex < atlas.uvs.length) {
        const rect = atlas.uvs[tileIndex];

        const uvBL: [number, number] = [rect.u0, rect.v1];
        const uvBR: [number, number] = [rect.u1, rect.v1];
        const uvTR: [number, number] = [rect.u1, rect.v0];
        const uvTL: [number, number] = [rect.u0, rect.v0];

        const uv1 = uvBL; // tex1
        const uv2 = uvBR; // tex2
        const uv3 = uvTR; // tex3
        const uv4 = uvTL; // tex4
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
            const base = [bl, br, tr, tl]; // tex1, tex2, tex3, tex4
            const perms = [
                [0, 1, 2, 3], // r=0
                [3, 0, 1, 2], // r=1
                [2, 3, 0, 1], // r=2
                [1, 2, 3, 0], // r=3
            ];
            const p = perms[rr];
            const tex1 = base[p[0]];
            const tex2 = base[p[1]];
            const tex3 = base[p[2]];
            const tex4 = base[p[3]];
            const uv0 = uvs.push(tex4) - 1; // v4
            const uv1 = uvs.push(tex3) - 1; // v3
            const uv2 = uvs.push(tex1) - 1; // v2
            faces.push({
                indices: [d, c, b],
                uvIndices: [uv0, uv1, uv2],
                colorIndices: [cd, cc, ca],
                texture: tileIndex,
                rotation: rr
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
                texture: tileIndex,
                rotation: 0
            });
            faces.push({
                indices: [a, c, d],  // v1, v3, v4
                uvIndices: [uvA, uvC, uvD],
                colorIndices:[ca, cc, cd],
                texture: tileIndex,
                rotation: 0
            });
        }
    } else {
        faces.push({
            indices: [a, b, c],
            uvIndices: null,
            colorIndices: null,
            texture: poly.t,
            rotation: poly.r,
        });
    }
}

function buildFaces2(poly: Poly, mdlVertStart: number, mdlColorStart: number, faces: GroundFace[], uvs: number[][], atlas: TileAtlas) {
    const a = mdlVertStart + poly.v1;
    const b = mdlVertStart + poly.v2;
    const c = mdlVertStart + poly.v3;
    const d = mdlVertStart + poly.v4;
    const ca = mdlColorStart + poly.c1;
    const cb = mdlColorStart + poly.c2;
    const cc = mdlColorStart + poly.c3;
    const cd = mdlColorStart + poly.c4;
    const texIndex = poly.tt;
    const tileIndex = texIndex & 0x7f;
    const rect = atlas.uvs[tileIndex];
    let A = [rect.u0, rect.v1];
    let B = [rect.u1, rect.v1];
    let C = [rect.u1, rect.v0];
    let D = [rect.u0, rect.v0];

    function rotateUVCorners(rot: number, A: number[], B: number[], C: number[], D: number[]) {
        switch (rot & 3) {
            case 0: return [A, B, C, D];
            case 1: return [B, C, D, A];
            case 2: return [C, D, A, B];
            case 3: return [D, A, B, C];
            default: return [A, B, C, D];
        }
    }

    const tex = atlas.tiles![tileIndex];
    const tileIsWater = tex.b > 0;
    const polyIsWater = (poly.s1 === 0 && poly.s2 === 0 && poly.s3 === 0 && poly.s4 === 0);
    const isWater = tileIsWater || polyIsWater;
    let texRot = tex.r & 7;
    const isTri = (poly.v1 === poly.v2);
    let polyRot = 0;
    if (isTri) {
        const rr = (poly.ii >> 4) & 3;
        polyRot = (texRot - rr) & 3;
        [A, B, C, D] = rotateUVCorners(polyRot, A, B, C, D);
    }
    const uvIndexA = uvs.length; uvs.push(A);
    const uvIndexB = uvs.length; uvs.push(B);
    const uvIndexC = uvs.length; uvs.push(C);
    const uvIndexD = uvs.length; uvs.push(D);
    const iByte = poly.ii;
    const bothSides = !!(iByte & 0x08);
    const inverse = !!(iByte & 0x04);
    if (isTri) {
        if (!inverse) {
            faces.push({
                indices: [b, c, d],
                uvIndices: [uvIndexA, uvIndexC, uvIndexD],
                colorIndices: [cb, cc, cd],
                texture: texIndex,
                rotation: polyRot,
                bothSides,
                inverse,
                isWater
            });
        } else {
            faces.push({
                indices: [d, c, b],
                uvIndices: [uvIndexD, uvIndexC, uvIndexA],
                colorIndices: [cd, cc, cb],
                texture: texIndex,
                rotation: polyRot,
                bothSides,
                inverse,
                isWater
            });
        }
    } else {
        faces.push({
            indices: [a, b, c],
            uvIndices: [uvIndexA, uvIndexB, uvIndexC],
            colorIndices: [ca, cb, cc],
            texture: texIndex,
            rotation: 0,
            bothSides,
            inverse,
            isWater
        });
        faces.push({
            indices: [a, c, d],
            uvIndices: [uvIndexA, uvIndexC, uvIndexD],
            colorIndices: [ca, cc, cd],
            texture: texIndex,
            rotation: 0,
            bothSides,
            inverse,
            isWater
        });
    }
}

function computeZScale(view: DataView, polyStart: number, polyCount: number, header: Header): number {
    if (header.w !== 0)
        return 2.0;
    let p = polyStart;
    for (let i = 0; i < polyCount; i++) {
        const d1 = view.getUint8(p + 8);
        const d2 = view.getUint8(p + 9);
        const d3 = view.getUint8(p + 10);
        const d4 = view.getUint8(p + 11);
        if (d1 + d2 + d3 + d4 !== 0)
            return 2.0;
        p += 16;
    }
    return 0.25;
}

export function buildSkybox(view: DataView, gameNumber: number): Skybox {
    const size = view.byteLength;
    let p = 0;
    const bgR = view.getUint8(p + 0);
    const bgG = view.getUint8(p + 1);
    const bgB = view.getUint8(p + 2);
    p += 4;
    const backgroundColor: [number, number, number] = [bgR, bgG, bgB];
    const partOffsets: number[] = [];
    while (p + 4 <= size) {
        const ptr = view.getUint32(p, true);
        p += 4;
        if (ptr === 0) break;
        if (ptr >= size) break;
        partOffsets.push(ptr);
    }
    const uniqueOffsets = Array.from(new Set(partOffsets)).sort((a, b) => a - b);
    const vertices: [number, number, number][] = [];
    const colors: [number, number, number][] = [];
    const faces: SkyboxFace[] = [];
    for (const partOffset of uniqueOffsets) {
        if (gameNumber == 1) {
            parseSkyboxPart(view, size, partOffset, vertices, colors, faces);
        } else if (gameNumber == 2) {
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
    let offs = 0;
    let partCount = view.getUint32(offs, true);
    offs += 4;
    const start = 8;
    const partOffsets: number[] = [];
    if (gameNumber == 2) {
        offs = 0;
        let partTableOffset = view.getUint32(offs, true);
        offs += 4;
        let partTablePos = partTableOffset;
        partCount = view.getUint32(partTablePos, true);
        partTablePos += 4;
        for (let i = 0; i < partCount; i++) {
            const off = view.getUint32(partTablePos, true);
            partTablePos += 4;
            partOffsets.push(off);
        }
    }
    for (let part = 0; part < partCount; part++) {
        let abs = 0;
        let p = 0;
        if (gameNumber == 1) {
            const offset = view.getUint32(offs, true);
            offs += 4;
            abs = offset + start;
            p = abs;
        } else if (gameNumber == 2) {
            abs = partOffsets[part] + 8;
            p = abs;
        }
        const header = new Header(view, p);
        p += Header.size;
        let zScale = 1.0;
        if (gameNumber == 2) {
            let mdlPolyStart = abs + Header.size + header.v1 * 4
                + header.c1 * 4 + header.p1 * 8 + header.v2 * 4
                + header.c2 * 4 + header.c2 * 4;
            zScale = computeZScale(view, mdlPolyStart, header.p2, header);
        }

        // LOD vertices
        for (let i = 0; i < header.v1; i++) {
            const v = new Vertex(view, p);
            p += 4;
            const z = (v.b1 | ((v.b2 & 3) << 8)) + header.z;
            const y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y;
            const x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // LOD colors
        for (let i = 0; i < header.c1; i++) {
            const c = new Color(view, p);
            p += 4;
            colors.push([c.r, c.g, c.b]);
        }

        // LOD polys
        for (let i = 0; i < header.p1; i++) {
            p += 8;
        }

        // MDL/FAR/TEX vertices
        const mdlVertStart = vertices.length;
        for (let i = 0; i < header.v2; i++) {
            const v = new Vertex(view, p);
            p += 4;
            let z = (v.b1 | ((v.b2 & 3) << 8)) + header.z;
            if (gameNumber == 2) {
                let zraw = (v.b1 | ((v.b2 & 3) << 8));
                if (header.w > 0) {
                    z = (zraw << 1) + header.z;
                } else {
                    z = (zraw >> 2) + header.z;
                }
                // z *= zScale;
            }
            const y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y;
            const x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        // MDL colors
        const mdlColorStart = colors.length;
        for (let i = 0; i < header.c2; i++) {
            const c = new Color(view, p);
            p += 4;
            colors.push([c.r, c.g, c.b]);
        }

        // FAR colors (ignored)
        p += header.c2 * 4;

        // Textured polys
        for (let i = 0; i < header.p2; i++) {
            const poly = new Poly(view, p, gameNumber);
            p += 16;
            if (gameNumber == 1) {
                buildFaces1(poly, mdlVertStart, mdlColorStart, faces, uvs, atlas)
            } else if (gameNumber == 2) {
                buildFaces2(poly, mdlVertStart, mdlColorStart, faces, uvs, atlas)
            }
        }
    }
    return { vertices, colors, faces, uvs, atlas };
}

export function buildTileAtlas(vram: VRAM, groups: TileGroups, gameNumber: number): TileAtlas {
    const tilesPerRow = 8;
    const slotSize = 32;
    const tileCount = groups.lod.length;
    const width = tilesPerRow * slotSize;
    const height = Math.ceil(tileCount / tilesPerRow) * slotSize;
    const data = new Uint8Array(width * height * 4);
    const uvs: { u0: number; v0: number; u1: number; v1: number }[] = [];
    for (let i = 0; i < tileCount; i++) {
        const tex = groups.lod[i];
        const w = tex.w;
        const h = tex.w;
        let rgba = decodeTileToRGBA(vram, tex, w, h);
        if (gameNumber == 1) {
            rgba = applyTileRotationRGBA(rgba, tex, w);
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
    return { data, width, height, uvs, tiles: groups.lod };
}

export function parseTileGroups(view: DataView, gameNumber: number): TileGroups {
    let offs = 4;
    const lod: Tile[] = [];
    let count = view.getUint32(offs, true);
    offs += 4;

    for (let i = 0; i < count; i++) {
        offs += 8;
        const tex = readTile(view, offs);
        offs += 8;
        textureCompute(tex, offs - 8, gameNumber);
        lod.push(tex);
        if (gameNumber == 2) {
            offs += 32; // skip unused groups
        }
    }

    return { lod };
}

function readTile(view: DataView, offs: number): Tile {
    return {
        x0: view.getUint8(offs + 0),
        y0: view.getUint8(offs + 1),
        p1: view.getUint8(offs + 2),
        p2: view.getUint8(offs + 3),
        xx: view.getUint8(offs + 4),
        yy: view.getUint8(offs + 5),
        ss: view.getUint8(offs + 6),
        ff: view.getUint8(offs + 7),
        px:0,py:0,m:4,w:32,
        x1:0,x2:0,x3:0,x4:0,
        y1:0,y2:0,y3:0,y4:0,
        r:0,s:0,off:offs,f:false,b:0
    };
}

function parseSkyboxPart(view: DataView, size: number, partOffset: number, vertices: [number, number, number][], colors: [number, number, number][], faces: SkyboxFace[]): void {
    let p = partOffset;
    if (p + 24 > size) return;
    // header_sky1_ (24 bytes)
    p += 8;
    const globalY = view.getInt16(p + 0, true);
    const globalZ = view.getInt16(p + 2, true);
    const vCount = view.getUint16(p + 4, true);
    const globalX = view.getInt16(p + 6, true);
    const pCount = view.getUint16(p + 8, true);
    const cCount = view.getUint16(p + 10, true);
    p += 16;
    const baseVertexIndex = vertices.length;
    const baseColorIndex  = colors.length;

    // Vertices block: vCount * 4 bytes
    for (let i = 0; i < vCount; i++) {
        if (p + 4 > size) break;
        const b1 = view.getUint8(p + 0);
        const b2 = view.getUint8(p + 1);
        const b3 = view.getUint8(p + 2);
        const b4 = view.getUint8(p + 3);
        p += 4;
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
        if (p + 4 > size) break;
        const r = view.getUint8(p + 0);
        const g = view.getUint8(p + 1);
        const b = view.getUint8(p + 2);
        // const n = view.getUint8(p + 3);
        p += 4;
        colors.push([r, g, b]);
    }

    // Polys block: pCount * 8 bytes
    for (let i = 0; i < pCount; i++) {
        if (p + 8 > size) break;
        const v1_packed1 = view.getUint8(p + 0);
        const v1_packed2 = view.getUint8(p + 1);
        const v1_packed3 = view.getUint8(p + 2);
        const v1_packed4 = view.getUint8(p + 3);
        const c1_packed1 = view.getUint8(p + 4);
        const c1_packed2 = view.getUint8(p + 5);
        const c1_packed3 = view.getUint8(p + 6);
        const c1_packed4 = view.getUint8(p + 7);
        p += 8;
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
    let p = partOffset;
    if (p + 20 > size) return;

    // Header
    p += 8;
    const globalY = view.getInt16(p + 0, true);
    const globalZ = view.getInt16(p + 2, true);
    const vCount = view.getUint8(p + 4);
    const cCount = view.getUint8(p + 5);
    const globalX = view.getInt16(p + 6, true);
    const miscSize = view.getUint16(p + 8, true);
    const poly1Size = view.getUint16(p + 10, true); // p1 = size in bytes of main polys
    p += 12; // total header = 20 bytes

    const baseVertexIndex = vertices.length;
    const baseColorIndex  = colors.length;

    // Vertices
    for (let i = 0; i < vCount; i++) {
        if (p + 4 > size) return;

        const b1 = view.getUint8(p + 0);
        const b2 = view.getUint8(p + 1);
        const b3 = view.getUint8(p + 2);
        const b4 = view.getUint8(p + 3);
        p += 4;

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
        if (p + 4 > size) return;
        const r = view.getUint8(p + 0);
        const g = view.getUint8(p + 1);
        const b = view.getUint8(p + 2);
        p += 4;
        colors.push([r, g, b]);
    }

    // Main polys
    const poly1Start = p;
    const poly1End = poly1Start + poly1Size;
    if (poly1End > size) return;

    let seeker = poly1End;
    let remaining = poly1Size;

    while (remaining > 3) {
        if (p + 4 > size) return;
        remaining -= 4;

        const b1 = view.getUint8(p++);
        const b2 = view.getUint8(p++);
        const b3 = view.getUint8(p++);
        let v0 = view.getUint8(p++);
        let c0 = (b1 >> 3) | ((b2 & 0x03) << 5);
        let c1 = (b2 >> 2) | ((b3 & 0x01) << 6);
        const c2 = (b3 >> 1);
        let pp = (b1 & 0x07);

        if (seeker + 2 > size) return;
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
            if (seeker + 2 > size) return;
            const vN = view.getUint8(seeker++);
            const cm = view.getUint8(seeker++);
            const c2n = cm & 0x7F;
            if (v0 < vCount && v1 < vCount && vN < vCount &&
                c0 < cCount && c1 < cCount && c2n < cCount) {
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

function textureCompute(tex: Tile, filePos: number, gameNumber: number): void {
    tex.f = false;
    tex.off = filePos;

    if ((tex.ff & 0x0E) > 0) tex.f = true;
    if ((tex.ss & 0x08) === 0) tex.f = true;

    if (gameNumber == 2) {
        tex.w = 32;
        tex.b = (tex.ss >> 5) & 0x03;
    } else {
        if ((tex.ff & 0x80) > 0) tex.w = 32;
        else tex.w = 16;
        if (tex.ff & 0x80) {
            tex.b = 1 + ((tex.ss & 0x7f) >> 5);
        } else {
            tex.b = 0;
        }
    }

    if ((tex.x0 + tex.w - 1) !== tex.xx) tex.f = true;
    if (tex.x0 > (256 - tex.w)) tex.f = true;
    if (tex.y0 > (256 - tex.w)) tex.f = true;

    if ((tex.ff & 0x01) > 0) tex.m = 15;
    else {
        if ((tex.ss & 0x80) > 0) tex.m = 8;
        else tex.m = 4;
    }

    tex.s = tex.ss & 0x07;
    if (tex.m === 4) tex.s = 256 * tex.s;
    if (tex.m === 8) tex.s = 128 * tex.s;
    if (tex.m === 15) tex.s = 64 * tex.s;

    tex.x4 = tex.x0 + tex.s;
    tex.x3 = tex.xx + tex.s;
    tex.x1 = tex.x4;
    tex.x2 = tex.x4 + tex.w;

    tex.y4 = tex.y0;
    if ((tex.ss & 0x10) > 0) tex.y4 += 256;
    tex.y3 = tex.y4;
    tex.y1 = tex.y4 + tex.w;
    tex.y2 = tex.y4 + tex.w;

    tex.px = (tex.p1 & 31) * 16;
    tex.py = (tex.p1 >> 6) | (tex.p2 << 2);

    tex.r = (tex.ff & 127) >> 4;

    tex.off = filePos - 8;
}
