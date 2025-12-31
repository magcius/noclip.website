export interface Spyro1GroundFace {
    indices: number[];
    uvIndices: number[] | null;
    texture: number | null;
    rotation: number | null;
}

function textureCompute(tex: SpyroTile, filePos: number): void {
    tex.f = false;
    tex.off = filePos;

    // Wrong markers
    if ((tex.ff & 0x0E) > 0) tex.f = true;
    if ((tex.ss & 0x08) === 0) tex.f = true;
    if ((tex.ss & 0x60) > 0) tex.f = true;
    if (tex.y0 !== tex.yy) tex.f = true;

    // Width: bit 7 of FF
    if ((tex.ff & 0x80) > 0) tex.w = 32;
    else tex.w = 16;

    if ((tex.x0 + tex.w - 1) !== tex.xx) tex.f = true;
    if (tex.x0 > (256 - tex.w)) tex.f = true;
    if (tex.y0 > (256 - tex.w)) tex.f = true;

    // Mode: t bit in FF, c bit in SS
    if ((tex.ff & 0x01) > 0) tex.m = 15;
    else {
        if ((tex.ss & 0x80) > 0) tex.m = 8;
        else tex.m = 4;
    }

    // Sector X offset (in pixels) based on m
    tex.s = tex.ss & 0x07;
    if (tex.m === 4) tex.s = 256 * tex.s;
    if (tex.m === 8) tex.s = 128 * tex.s;
    if (tex.m === 15) tex.s = 64 * tex.s;

    // Corner coords in VRAM (pixels)
    tex.x4 = tex.x0 + tex.s;
    tex.x3 = tex.xx + tex.s;
    tex.x1 = tex.x4;
    tex.x2 = tex.x4 + tex.w;

    tex.y4 = tex.y0;
    if ((tex.ss & 0x10) > 0) tex.y4 += 256;
    tex.y3 = tex.y4;
    tex.y1 = tex.y4 + tex.w;
    tex.y2 = tex.y4 + tex.w;

    // Palette position
    tex.px = (tex.p1 & 31) * 16;
    tex.py = (tex.p1 >> 6) | (tex.p2 << 2);

    // Rotation index
    tex.r = (tex.ff & 127) >> 4;

    // File offset of this 8‑byte tex record
    tex.off = filePos - 8;
}

export interface SpyroTileTable {
    j1: number;
    tileCount: number;
    tiles: SpyroTile[];
}

export interface TileCorners {
    x1: number; y1: number;
    x2: number; y2: number;
    x3: number; y3: number;
    x4: number; y4: number;
}

export interface TileUVs {
    u1: number; v1: number;
    u2: number; v2: number;
    u3: number; v3: number;
    u4: number; v4: number;
}

export type Spyro1LevelData = {
  vertices: number[][];
  colors: number[][];
  faces: Spyro1GroundFace[];
  uvs: number[][];
  atlas: CombinedAtlas;
};

class HeaderGround {
    static size = 2+2+2+2 + 1+1+1+1 + 1+1+1+1 + 4; // or just 20

    y: number; x: number; i0: number; z: number;
    v1: number; c1: number; p1: number; i1: number;
    v2: number; c2: number; p2: number; i2: number;
    f: number;

    constructor(view: DataView, offs: number) {
        this.y  = view.getInt16(offs, true);
        this.x  = view.getInt16(offs+2, true);
        this.i0 = view.getUint16(offs+4, true);
        this.z  = view.getInt16(offs+6, true);

        this.v1 = view.getUint8(offs+8);
        this.c1 = view.getUint8(offs+9);
        this.p1 = view.getUint8(offs+10);
        this.i1 = view.getUint8(offs+11);

        this.v2 = view.getUint8(offs+12);
        this.c2 = view.getUint8(offs+13);
        this.p2 = view.getUint8(offs+14);
        this.i2 = view.getUint8(offs+15);

        this.f  = view.getUint32(offs+16, true);
    }
}

class VertexGround {
    b1: number; b2: number; b3: number; b4: number;

    constructor(view: DataView, offs: number) {
        this.b1 = view.getUint8(offs);
        this.b2 = view.getUint8(offs+1);
        this.b3 = view.getUint8(offs+2);
        this.b4 = view.getUint8(offs+3);
    }
}

class ColorGround {
    r: number; g: number; b: number; n: number;

    constructor(view: DataView, offs: number) {
        this.r = view.getUint8(offs);
        this.g = view.getUint8(offs+1);
        this.b = view.getUint8(offs+2);
        this.n = view.getUint8(offs+3);
    }
}

class Poly1Ground {
    n: number; v1: number; v2: number; v3: number;
    f: number; c1: number; c2: number; c3: number;

    constructor(view: DataView, offs: number) {
        this.n  = view.getUint8(offs);
        this.v1 = view.getUint8(offs+1);
        this.v2 = view.getUint8(offs+2);
        this.v3 = view.getUint8(offs+3);
        this.f  = view.getUint8(offs+4);
        this.c1 = view.getUint8(offs+5);
        this.c2 = view.getUint8(offs+6);
        this.c3 = view.getUint8(offs+7);
    }
}

class Poly2Ground {
    v1: number; v2: number; v3: number; v4: number;
    c1: number; c2: number; c3: number; c4: number;
    t: number; r: number;
    s1: number; s2: number; s3: number; s4: number; s5: number;

    constructor(view: DataView, offs: number) {
        this.v1 = view.getUint8(offs);
        this.v2 = view.getUint8(offs+1);
        this.v3 = view.getUint8(offs+2);
        this.v4 = view.getUint8(offs+3);

        this.c1 = view.getUint8(offs+4);
        this.c2 = view.getUint8(offs+5);
        this.c3 = view.getUint8(offs+6);
        this.c4 = view.getUint8(offs+7);

        this.t  = view.getUint8(offs+8);
        this.r  = view.getUint8(offs+9);

        this.s1 = view.getUint8(offs+10);
        this.s2 = view.getUint8(offs+11);
        this.s3 = view.getUint8(offs+12);
        this.s4 = view.getUint8(offs+13);
        this.s5 = view.getUint8(offs+14);
    }
}

export function buildLevelData(view: DataView, atlas: CombinedAtlas): Spyro1LevelData {
    const vertices: number[][] = [];
    const colors: number[][] = [];
    const faces: Spyro1GroundFace[] = [];
    const uvs: number[][] = [];
    let offs = 0;
    const partcnt = view.getUint32(offs, true);
    offs += 4;
    const start = 8;
    let vertBase = 0;
    for (let part = 0; part < partcnt; part++) {
        const offset = view.getUint32(offs, true);
        offs += 4;
        const abs = offset + start;
        let p = abs;
        const header = new HeaderGround(view, p);
        p += HeaderGround.size;

        //
        // --- LOD vertices ---
        //
        for (let i = 0; i < header.v1; i++) {
            const v = new VertexGround(view, p);
            p += 4;
            const z = (v.b1 | ((v.b2 & 3) << 8)) + header.z;
            const y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y;
            const x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x;
            vertices.push([x, y, z]);
        }

        //
        // --- LOD colors ---
        //
        for (let i = 0; i < header.c1; i++) {
            const c = new ColorGround(view, p);
            p += 4;
            colors.push([c.r, c.g, c.b]);
        }

        //
        // --- LOD polys (untextured) ---
        //
        for (let i = 0; i < header.p1; i++) {
            // const poly = new Poly1Ground(view, p);
            p += 8;

            // const v1 = (poly.v1 & 63);
            // const v2 = (poly.v1 >> 6) | ((poly.v2 & 15) << 2);
            // const v3 = (poly.v2 >> 4) | ((poly.v3 & 3) << 4);
            // const v4 = (poly.v3 >> 2);

            // const a = vertBase + v1;
            // const b = vertBase + v2;
            // const cIdx = vertBase + v3;
            // const d = vertBase + v4;

            // if (v1 === v2)
            //     faces.push({ indices: [b, cIdx, d], uvIndices: null, texture: null, rotation: null });
            // else if (v2 === v3)
            //     faces.push({ indices: [a, cIdx, d], uvIndices: null, texture: null, rotation: null });
            // else if (v3 === v4)
            //     faces.push({ indices: [a, b, d], uvIndices: null, texture: null, rotation: null });
            // else if (v4 === v1)
            //     faces.push({ indices: [a, b, cIdx], uvIndices: null, texture: null, rotation: null });
            // else {
            //     faces.push({ indices: [b, a, cIdx], uvIndices: null, texture: null, rotation: null });
            //     faces.push({ indices: [cIdx, a, d], uvIndices: null, texture: null, rotation: null });
            // }
        }

        //
        // --- MDL/FAR/TEX vertices ---
        //
        const mdlVertStart = vertices.length;

        for (let i = 0; i < header.v2; i++) {
            const v = new VertexGround(view, p);
            p += 4;

            const z = (v.b1 | ((v.b2 & 3) << 8)) + header.z;
            const y = ((v.b2 >> 2) | ((v.b3 & 31) << 6)) + header.y;
            const x = ((v.b3 >> 5) | (v.b4 << 3)) + header.x;

            vertices.push([x, y, z]);
        }

        //
        // --- MDL colors ---
        //
        for (let i = 0; i < header.c2; i++) {
            const c = new ColorGround(view, p);
            p += 4;
            colors.push([c.r, c.g, c.b]);
        }

        //
        // --- FAR colors (ignored) ---
        //
        p += header.c2 * 4;

        //
        // --- Textured polys ---
        //
        for (let i = 0; i < header.p2; i++) {
            const poly = new Poly2Ground(view, p);
            p += 16;
            const a = mdlVertStart + poly.v1;
            const b = mdlVertStart + poly.v2;
            const cIdx = mdlVertStart + poly.v3;
            const d = mdlVertStart + poly.v4;
            const tileIndex = poly.t & 0x7F;
            if (atlas && tileIndex >= 0 && tileIndex < atlas.lodUVs.length) {
                const rect = atlas.lodUVs[tileIndex];

                const uvBL: [number, number] = [rect.u0, rect.v1];
                const uvBR: [number, number] = [rect.u1, rect.v1];
                const uvTR: [number, number] = [rect.u1, rect.v0];
                const uvTL: [number, number] = [rect.u0, rect.v0];

                const uv1 = uvBL; // tex1
                const uv2 = uvBR; // tex2
                const uv3 = uvTR; // tex3
                const uv4 = uvTL; // tex4

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
                        indices:   [d, cIdx, b],
                        uvIndices: [uv0, uv1, uv2],
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
                        indices: [a, b, cIdx],  // v1, v2, v3
                        uvIndices: [uvA, uvB, uvC],
                        texture: tileIndex,
                        rotation: 0
                    });
                    faces.push({
                        indices: [a, cIdx, d],  // v1, v3, v4
                        uvIndices: [uvA, uvC, uvD],
                        texture: tileIndex,
                        rotation: 0
                    });
                }
            } else {
                faces.push({
                    indices: [a, b, cIdx],
                    uvIndices: null,
                    texture: poly.t,
                    rotation: poly.r,
                });
            }
        }

        vertBase = vertices.length;
    }
    return { vertices, colors, faces, uvs, atlas };
}

export function applyTileRotationRGBA(rgba: Uint8Array, tex: SpyroTile, size: number = 32): Uint8Array {
    const r = tex.r & 3; // only lowest 2 bits matter
    let out = rgba;

    function rotate90(src: Uint8Array): Uint8Array {
        const dst = new Uint8Array(src.length);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const s = (y * size + x) * 4;
                const d = (x * size + (size - 1 - y)) * 4;
                dst[d]     = src[s];
                dst[d + 1] = src[s + 1];
                dst[d + 2] = src[s + 2];
                dst[d + 3] = src[s + 3];
            }
        }
        return dst;
    }

    if (r === 1) {
        out = rotate90(out);
    } else if (r === 2) {
        out = rotate90(rotate90(out));
    } else if (r === 3) {
        out = rotate90(rotate90(rotate90(out)));
    }

    return out;
}

export class PsxVram {
    private vram16: Uint16Array;

    constructor(buffer: ArrayBuffer) {
        this.vram16 = new Uint16Array(buffer);
    }

    getWord(wordX: number, wordY: number): number {
        if (wordX < 0 || wordX >= 512 || wordY < 0 || wordY >= 512) {
            console.warn('VRAM OOB', { x: wordX, y: wordY });
            return 0;
        }
        const index = wordY * 512 + wordX;
        return this.vram16[index];
    }

    getWordByIndex(wordIndex: number): number {
        if (wordIndex < 0 || wordIndex >= this.vram16.length) {
            console.warn('VRAM OOB (index)', { index: wordIndex });
            return 0;
        }
        return this.vram16[wordIndex];
    }
}

export function ps1ColorToRGBA(word: number): [number, number, number, number] {
    const r5 = (word) & 0x1F;
    const g5 = (word >> 5) & 0x1F;
    const b5 = (word >> 10) & 0x1F;
    const stp = (word >> 15) & 0x01; // transparency bit
    const r = (r5 * 255 / 31) | 0;
    const g = (g5 * 255 / 31) | 0;
    const b = (b5 * 255 / 31) | 0;
    const a = stp ? 0 : 255; // many engines treat stp=1 as transparent
    return [r, g, b, a];
}

export function readClut4bpp(vram: PsxVram, px: number, py: number): [number, number, number, number][] {
    const palette: [number, number, number, number][] = [];
    const baseWordIndex = py * 512 + px;
    for (let i = 0; i < 16; i++) {
        const wordIndex = baseWordIndex + i;
        const word = vram.getWordByIndex(wordIndex);
        const [r, g, b, a] = ps1ColorToRGBA(word);
        palette.push([r, g, b, a]);
    }
    return palette;
}

export function readClut8bpp(vram: PsxVram, px: number, py: number): [number, number, number, number][] {
    const palette: [number, number, number, number][] = [];
    const baseWordIndex = py * 512 + px;
    for (let i = 0; i < 256; i++) {
        const wordIndex = baseWordIndex + i;
        const word = vram.getWordByIndex(wordIndex);
        const [r, g, b, a] = ps1ColorToRGBA(word);
        palette.push([r, g, b, a]);
    }
    return palette;
}

export function decode4bppTile(vram: PsxVram, tileX: number, tileY: number, width: number, height: number, palette: [number, number, number, number][]): Uint8Array {
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

export function decode8bppTile(vram: PsxVram, tileX: number, tileY: number, width: number, height: number, palette: [number, number, number, number][]): Uint8Array {
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

export function decodeTileToRGBA(vram: PsxVram, tex: SpyroTile, width: number = tex.w, height: number = tex.w): Uint8Array {
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
                const [r, g, b, a] = ps1ColorToRGBA(word);
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

export interface TileAtlas {
    atlasData: Uint8Array;
    atlasWidth: number;
    atlasHeight: number;
    tileUV: { u0: number, v0: number, u1: number, v1: number }[];
}

export interface SpyroTile {
    x0: number; y0: number; p1: number; p2: number;
    xx: number; yy: number; ss: number; ff: number;
    px: number; py: number; m: 4 | 8 | 15; w: number;
    x1: number; x2: number; x3: number; x4: number;
    y1: number; y2: number; y3: number; y4: number;
    r: number; s: number; off: number; f: boolean;
}

export interface SpyroTileGroups {
    lod: SpyroTile[];
    cor1: SpyroTile[];
    cor2: SpyroTile[];
    cor3: SpyroTile[];
    cor4: SpyroTile[];
}

export interface CombinedAtlas {
    atlasData: Uint8Array;
    atlasWidth: number;
    atlasHeight: number;

    lodUVs:  { u0: number; v0: number; u1: number; v1: number }[];
    cor1UVs: { u0: number; v0: number; u1: number; v1: number }[];
    cor2UVs: { u0: number; v0: number; u1: number; v1: number }[];
    cor3UVs: { u0: number; v0: number; u1: number; v1: number }[];
    cor4UVs: { u0: number; v0: number; u1: number; v1: number }[];
}

export function buildCombinedAtlas(vram: PsxVram, groups: SpyroTileGroups, tilesPerRow: number = 8, slotSize: number = 32): CombinedAtlas {
    const tileCount = groups.lod.length;

    const rowsPerGroup = Math.ceil(tileCount / tilesPerRow);
    const atlasWidth = tilesPerRow * slotSize;
    const atlasHeight = rowsPerGroup * slotSize * 5;

    const atlasData = new Uint8Array(atlasWidth * atlasHeight * 4);

    const lodUVs:  { u0: number; v0: number; u1: number; v1: number }[] = [];
    const cor1UVs: { u0: number; v0: number; u1: number; v1: number }[] = [];
    const cor2UVs: { u0: number; v0: number; u1: number; v1: number }[] = [];
    const cor3UVs: { u0: number; v0: number; u1: number; v1: number }[] = [];
    const cor4UVs: { u0: number; v0: number; u1: number; v1: number }[] = [];

    function blitGroup(tiles: SpyroTile[], groupIndex: number, outUVs: { u0: number; v0: number; u1: number; v1: number }[]) {
        const groupYOffset = groupIndex * rowsPerGroup * slotSize;

        for (let i = 0; i < tileCount; i++) {
            const tex = tiles[i];

            // Use tex.w for decode size but paste into a 32×32 slot
            const w = tex.w;
            const h = tex.w;
            let rgba = decodeTileToRGBA(vram, tex, w, h);
            rgba = applyTileRotationRGBA(rgba, tex, w);

            const atlasX = (i % tilesPerRow) * slotSize;
            const atlasY = Math.floor(i / tilesPerRow) * slotSize + groupYOffset;

            // Blit w×h into top-left of the slot
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const src = (y * w + x) * 4;
                    const dst = ((atlasY + y) * atlasWidth + (atlasX + x)) * 4;
                    atlasData[dst + 0] = rgba[src + 0];
                    atlasData[dst + 1] = rgba[src + 1];
                    atlasData[dst + 2] = rgba[src + 2];
                    atlasData[dst + 3] = rgba[src + 3];
                }
            }

            outUVs.push({
                u0: atlasX / atlasWidth,
                v0: atlasY / atlasHeight,
                u1: (atlasX + slotSize) / atlasWidth,
                v1: (atlasY + slotSize) / atlasHeight,
            });
        }
    }

    blitGroup(groups.lod,  0, lodUVs);
    blitGroup(groups.cor1, 1, cor1UVs);
    blitGroup(groups.cor2, 2, cor2UVs);
    blitGroup(groups.cor3, 3, cor3UVs);
    blitGroup(groups.cor4, 4, cor4UVs);

    return {
        atlasData,
        atlasWidth,
        atlasHeight,
        lodUVs,
        cor1UVs,
        cor2UVs,
        cor3UVs,
        cor4UVs,
    };
}

export function parseTileGroups(view: DataView): SpyroTileGroups {
    let offs = 0;

    const offset = view.getUint32(offs, true); offs += 4;
    const count = view.getUint32(offs, true); offs += 4;

    const lod: SpyroTile[] = [];
    const cor1: SpyroTile[] = [];
    const cor2: SpyroTile[] = [];
    const cor3: SpyroTile[] = [];
    const cor4: SpyroTile[] = [];

    // --- LOD tiles ---
    for (let i = 0; i < count; i++) {
        offs += 8; // skip buf
        const tex = readTile(view, offs);
        offs += 8;
        textureCompute(tex, offs - 8);
        lod.push(tex);
    }

    // --- CORNER tiles ---
    for (let i = 0; i < count; i++) {
        offs += 8; // skip buf

        let tex;

        tex = readTile(view, offs); offs += 8;
        textureCompute(tex, offs - 8);
        cor1.push(tex);

        tex = readTile(view, offs); offs += 8;
        textureCompute(tex, offs - 8);
        cor2.push(tex);

        tex = readTile(view, offs); offs += 8;
        textureCompute(tex, offs - 8);
        cor3.push(tex);

        tex = readTile(view, offs); offs += 8;
        textureCompute(tex, offs - 8);
        cor4.push(tex);

        offs += 128; // skip padding
    }

    return { lod, cor1, cor2, cor3, cor4 };
}

function readTile(view: DataView, offs: number): SpyroTile {
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
        r:0,s:0,off:offs,f:false
    };
}
