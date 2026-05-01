import { vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";

// Credit to "Spyro World Viewer" by Kly_Men_COmpany for a majority of the data structures, reverse-engineering and parsing logic

interface SkyFace {
    indices: number[];
    colors: number[];
}

interface LevelStream {
    vertices: number[];
    colors: number[];
    uvs: number[];
    indicesGround: number[][];
    indicesTransparent: number[][];
    indicesLOD: number[][];
}

interface TextureHeader {
    mid: TileDefinition,
    cor: TileDefinition[]
}

export interface SpyroTextureStore {
    colors: Uint8Array[][];
    headers: TextureHeader[];
}

export interface SpyroDrawCall {
    tileIndex: number;
    indexOffset: number;
    indexCount: number;
    isWater: boolean;
}

export interface SpyroLevel {
    textures: SpyroTextureStore;
    game: number;
    id: number;
    vertices?: Float32Array;
    colors?: Float32Array;
    uvs?: Float32Array;
    indicesGround?: Uint32Array;
    indicesTransparent?: Uint32Array;
    indicesLOD?: Uint32Array;
    batchesGround: SpyroDrawCall[];
    batchesTransparent: SpyroDrawCall[];
    batchesLOD: SpyroDrawCall[];
};

export interface SpyroLevelData {
    vram: VRAM;
    textureList: ArrayBufferSlice;
    ground: ArrayBufferSlice;
    grounds?: ArrayBufferSlice[];
    sky: ArrayBufferSlice;
    subfile4?: ArrayBufferSlice;
}

export interface SpyroSkybox {
    backgroundColor: number[];
    vertices: number[][];
    colors: number[][];
    faces: SkyFace[];
}

export interface SpyroMobyInstance {
    x: number;
    y: number;
    z: number;
    yaw: number;
    classId: number;
}

class TileDefinition {
    mainX: number;
    mainY: number;
    p: vec2;
    xx: number;
    yy: number;
    ss: number;
    ff: number;
    px: number = 0;
    py: number = 0;
    m: 4 | 8 | 15 = 4;
    size: number = 32;
    x: vec4 = vec4.create();
    y: vec4 = vec4.create();
    rotation: number = 0;
    s: number = 0;
    f: boolean = false;
    transparent: number = 0;

    constructor(data: DataView, offset: number) {
        this.mainX = data.getUint8(offset);
        this.mainY = data.getUint8(offset + 1);
        this.p = vec2.fromValues(data.getUint8(offset + 2), data.getUint8(offset + 3));
        this.xx = data.getUint8(offset + 4);
        this.yy = data.getUint8(offset + 5);
        this.ss = data.getUint8(offset + 6);
        this.ff = data.getUint8(offset + 7);
    }
}

class PartHeader {
    y: number;
    x: number;
    i0: number;
    z: number;
    flag: number;
    lodVertexCount: number;
    lodColorCount: number;
    lodPolyCount: number;
    i1: number;
    mdlVertexCount: number;
    mdlColorCount: number;
    mdlPolyCount: number;
    water: number;

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

class LODPoly {
    n: number;
    v: vec3;
    f: number;
    c: vec3;

    constructor(view: DataView, offset: number) {
        this.n = view.getUint8(offset);
        this.v = vec3.fromValues(view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.f = view.getUint8(offset + 4);
        this.c = vec3.fromValues(view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    }
}

class LODPoly2 {
    v: vec4;
    c: vec4;

    constructor(view: DataView, offset: number) {
        this.v = vec4.fromValues(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.c = vec4.fromValues(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    }
}

class Polygon {
    v: vec4;
    c: vec4;
    t: number = 0; // S1 only
    r: number = 0; // S1 only
    s: vec4 = vec4.create(); // S2 only
    tt: number = 0; // S2 only
    ii: number = 0; // S2 only

    constructor(view: DataView, offset: number, gameNumber: number) {
        this.v = vec4.fromValues(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.c = vec4.fromValues(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
        if (gameNumber == 1) {
            this.t = view.getUint8(offset + 8);
            this.r = view.getUint8(offset + 9);
        } else {
            this.s = vec4.fromValues(view.getUint8(offset + 8), view.getUint8(offset + 9), view.getUint8(offset + 10), view.getUint8(offset + 11));
            this.tt = view.getUint8(offset + 12) & 127;
            this.ii = view.getUint8(offset + 13);
        }
    }
}

const VRAM_SIZE = 524288; // 512 KB and some change
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

export const SPYRO_TILE_SCROLL_MAP: Record<number, Record<number, number[]>> = {
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

export function buildSpyroSkybox(data: DataView, gameNumber: number): SpyroSkybox {
    const backgroundColor = [data.getUint8(0), data.getUint8(1), data.getUint8(2)];
    let pointer = 4;
    const partOffsets: number[] = [];
    while (pointer + 4 <= data.byteLength) {
        const offset = data.getUint32(pointer, true);
        pointer += 4;
        if (offset === 0 || offset >= data.byteLength) {
            break;
        }
        partOffsets.push(offset);
    }
    const vertices: number[][] = [];
    const colors: number[][] = [];
    const faces: SkyFace[] = [];
    for (const offset of Array.from(new Set(partOffsets)).sort((a, b) => a - b)) {
        if (gameNumber == 1) {
            parseSkyboxPart(data, data.byteLength, offset, vertices, colors, faces);
        } else {
            parseSkyboxPart2(data, data.byteLength, offset, vertices, colors, faces);
        }
    }
    return { backgroundColor, vertices, colors, faces };
}

export function buildSpyroLevel(ground: DataView, textures: SpyroTextureStore, gameNumber: number, id: number): SpyroLevel {
    const vertices: number[] = [];
    const colors: number[] = [];
    const stream: LevelStream = {
        vertices: [], colors: [], uvs: [],
        indicesGround: [], indicesTransparent: [], indicesLOD: []
    };
    const tileCount = textures.headers.length;
    const invalidTile: boolean[] = [];
    const waterIndices: number[] = [];
    const UV = { TL: [0, 1], TR: [1, 1], BR: [1, 0], BL: [0, 0], ZERO: [0, 0] };
    let runningIndex = 0;

    for (let i = 0; i < tileCount; i++) {
        stream.indicesGround[i] = [];
        stream.indicesTransparent[i] = [];
        stream.indicesLOD[i] = [];
    }
    for (let i = 0; i < textures.headers.length; i++) {
        let b = true;
        const rgba = textures.colors[i];
        for (let i = 0; i < rgba[0].length; i += 4) {
            if (rgba[0][i] !== 0 || rgba[0][i + 1] !== 0 || rgba[0][i + 2] !== 0) {
                b = false;
                break;
            }
        }
        invalidTile[i] = b;
    }

    let partCount = ground.getUint32(0, true);
    let offset = 4;
    const partOffsets: number[] = [];

    if (gameNumber > 1) {
        offset = 0;
        let table = ground.getUint32(offset, true);
        offset += 4;
        partCount = ground.getUint32(table, true);
        table += 4;
        for (let i = 0; i < partCount; i++) {
            partOffsets.push(ground.getUint32(table, true));
            table += 4;
        }
    }

    function decodeLODPoly(poly: LODPoly | LODPoly2) {
        if (gameNumber === 1) {
            return {
                v1: (poly.v[0] & 63),
                v2: (poly.v[0] >> 6) | ((poly.v[1] & 15) << 2),
                v3: (poly.v[1] >> 4) | ((poly.v[2] & 3) << 4),
                v4: (poly.v[2] >> 2),
                c1: (poly.c[0] & 63),
                c2: (poly.c[0] >> 6) | ((poly.c[1] & 15) << 2),
                c3: (poly.c[1] >> 4) | ((poly.c[2] & 3) << 4),
                c4: (poly.c[2] >> 2),
            };
        } else {
            assert(poly instanceof LODPoly2);
            return {
                v1: (poly.v[0] >> 3) | ((poly.v[1] & 3) << 5),
                v2: (poly.v[1] >> 2) | ((poly.v[2] & 1) << 6),
                v3: (poly.v[2] >> 1),
                v4: (poly.v[3] & 127),
                c1: (poly.c[0] >> 4) | ((poly.c[1] & 7) << 4),
                c2: (poly.c[1] >> 3) | ((poly.c[2] & 3) << 5),
                c3: (poly.c[2] >> 2) | ((poly.c[3] & 1) << 6),
                c4: (poly.c[3] >> 1),
            };
        }
    }

    function pushTri(v1: number, v2: number, v3: number, c1: number, c2: number, c3: number, uv1: number[], uv2: number[], uv3: number[], tileIndex: number, opts: { isLOD: boolean; isTransparent?: boolean; isWater?: boolean }) {
        if (!opts.isLOD && invalidTile[tileIndex]) {
            return;
        }
        const group = opts.isLOD ? stream.indicesLOD : (opts.isTransparent || opts.isWater ? stream.indicesTransparent : stream.indicesGround);
        const v = [v1, v2, v3];
        const color = [c1, c2, c3];
        const uvs = [uv1, uv2, uv3];
        for (let i = 0; i < 3; i++) {
            const vi = v[i] * 3;
            const ci = color[i] * 4;
            const uv = uvs[i];
            const r = colors[ci];
            const g = colors[ci + 1];
            const b = colors[ci + 2];
            const a = colors[ci + 3];
            stream.vertices.push(vertices[vi], vertices[vi + 1], vertices[vi + 2]);
            stream.colors.push(r / 255, g / 255, b / 255, a / 255);
            stream.uvs.push(uv[0], uv[1]);
            group[tileIndex].push(runningIndex++);
        }
    }

    function pushPoly(poly: Polygon, vertexOffset: number, colorOffset: number, waterFlag: number) {
        const tileIndex = (gameNumber === 1) ? (poly.t & 127) : (poly.tt & 127);
        if (tileIndex < 0 || tileIndex >= tileCount) {
            return;
        }
        const tile = textures.headers[tileIndex].mid;
        const isTransparent = tile.transparent > 0;
        const isWater = (gameNumber > 1) ? (waterFlag === 0 && poly.s[0] === 0 && poly.s[1] === 0 && poly.s[2] === 0 && poly.s[3] === 0) : false;
        const isLOD = false;
        const opts = { isLOD, isTransparent, isWater };
        const v1 = vertexOffset + poly.v[0];
        const v2 = vertexOffset + poly.v[1];
        const v3 = vertexOffset + poly.v[2];
        const v4 = vertexOffset + poly.v[3];
        const c1 = colorOffset + poly.c[0];
        const c2 = colorOffset + poly.c[1];
        const c3 = colorOffset + poly.c[2];
        const c4 = colorOffset + poly.c[3];
        let A = UV.TL, B = UV.TR, C = UV.BR, D = UV.BL;

        const isTri = poly.v[0] === poly.v[1];
        if (gameNumber > 1) {
            if (isTri) {
                const rr = (poly.ii >> 4) & 3;
                const rot = (tile.rotation - rr) & 3;
                const seq = [A, B, C, D];
                const rotated = [seq[(0 + rot) & 3], seq[(1 + rot) & 3], seq[(2 + rot) & 3], seq[(3 + rot) & 3]];
                [A, B, C, D] = rotated;
            }
        } else {
            if (poly.v[0] === poly.v[1]) {
                const base = [UV.TL, UV.TR, UV.BR, UV.BL];
                const perms = [[0, 1, 2, 3], [3, 0, 1, 2], [2, 3, 0, 1], [1, 2, 3, 0]];
                const p = perms[poly.r & 3];
                A = base[p[0]];
                B = base[p[1]];
                C = base[p[2]];
                D = base[p[3]];
            }
        }

        if (isTri) {
            const inverse = (gameNumber > 1) ? !!(poly.ii & 4) : false;
            if (!inverse) {
                pushTri(v2, v3, v4, c2, c3, c4, A, C, D, tileIndex, opts);
            } else {
                pushTri(v4, v3, v2, c4, c3, c2, D, C, A, tileIndex, opts);
            }
        } else {
            pushTri(v1, v2, v3, c1, c2, c3, A, B, C, tileIndex, opts);
            pushTri(v1, v3, v4, c1, c3, c4, A, C, D, tileIndex, opts);
        }

        if (isWater && !waterIndices.includes(tileIndex)) {
            waterIndices.push(tileIndex);
        }
    }

    for (let partIndex = 0; partIndex < partCount; partIndex++) {
        let pointer = 0;
        if (gameNumber === 1) {
            const o = ground.getUint32(offset, true);
            offset += 4;
            pointer = o + 8;
        } else {
            pointer = partOffsets[partIndex] + 8;
        }

        const header = new PartHeader(ground, pointer);
        pointer += 20;

        const lodVertexOffset = vertices.length / 3;
        for (let i = 0; i < header.lodVertexCount; i++) {
            const byte1 = ground.getUint8(pointer);
            const byte2 = ground.getUint8(pointer + 1);
            const byte3 = ground.getUint8(pointer + 2);
            const byte4 = ground.getUint8(pointer + 3);
            pointer += 4;
            const zraw = (byte1 | ((byte2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                z = (zraw << 1) + header.z;
            }
            const y = ((byte2 >> 2) | ((byte3 & 31) << 6)) + header.y;
            const x = ((byte3 >> 5) | (byte4 << 3)) + header.x;
            vertices.push(x, y, z);
        }

        const lodColorOffset = colors.length / 4;
        for (let i = 0; i < header.lodColorCount; i++) {
            const r = ground.getUint8(pointer);
            const g = ground.getUint8(pointer + 1);
            const b = ground.getUint8(pointer + 2);
            const a = ground.getUint8(pointer + 3);
            pointer += 4;
            colors.push(r, g, b, a);
        }

        for (let i = 0; i < header.lodPolyCount; i++) {
            const p = (gameNumber > 1) ? new LODPoly2(ground, pointer) : new LODPoly(ground, pointer);
            pointer += 8;
            const poly = decodeLODPoly(p);
            const v1 = lodVertexOffset + poly.v1;
            const v2 = lodVertexOffset + poly.v2;
            const v3 = lodVertexOffset + poly.v3;
            const v4 = lodVertexOffset + poly.v4;
            const c1 = lodColorOffset + poly.c1;
            const c2 = lodColorOffset + poly.c2;
            const c3 = lodColorOffset + poly.c3;
            const c4 = lodColorOffset + poly.c4;
            if (poly.v1 === poly.v2) {
                pushTri(v2, v3, v4, c2, c3, c4, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
            } else if (poly.v2 === poly.v3) {
                pushTri(v1, v3, v4, c1, c3, c4, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
            } else if (poly.v3 === poly.v4) {
                pushTri(v1, v2, v4, c1, c2, c4, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
            } else if (poly.v4 === poly.v1) {
                pushTri(v1, v2, v3, c1, c2, c3, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
            } else {
                pushTri(v2, v1, v3, c2, c1, c3, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
                pushTri(v2, v3, v4, c2, c3, c4, UV.ZERO, UV.ZERO, UV.ZERO, 0, { isLOD: true });
            }
        }

        let isWaterNonGround = false;
        if (gameNumber > 1) {
            let pos = pointer + header.mdlVertexCount * 4 + header.mdlColorCount * 4 + header.mdlColorCount * 4;
            for (let i = 0; i < header.mdlPolyCount; i++) {
                const s1 = ground.getUint8(pos + 8);
                const s2 = ground.getUint8(pos + 9);
                const s3 = ground.getUint8(pos + 10);
                const s4 = ground.getUint8(pos + 11);
                if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) {
                    isWaterNonGround = true;
                    break;
                }
                pos += 16;
            }
        }

        const mdlVertexOffset = vertices.length / 3;
        for (let i = 0; i < header.mdlVertexCount; i++) {
            const byte1 = ground.getUint8(pointer);
            const byte2 = ground.getUint8(pointer + 1);
            const byte3 = ground.getUint8(pointer + 2);
            const byte4 = ground.getUint8(pointer + 3);
            pointer += 4;
            const zraw = (byte1 | ((byte2 & 3) << 8));
            let z = zraw + header.z;
            if (gameNumber > 1) {
                const far = header.lodVertexCount === 0 && header.flag === 0xFFFFFFFF;
                if ((far && !isWaterNonGround) || (far && isWaterNonGround && header.water > 0) || (!far && header.water > 0)) {
                    z = (zraw << 1) + header.z;
                } else {
                    z = (zraw >> 2) + header.z;
                }
            }
            const y = ((byte2 >> 2) | ((byte3 & 31) << 6)) + header.y;
            const x = ((byte3 >> 5) | (byte4 << 3)) + header.x;
            vertices.push(x, y, z);
        }

        const mdlColorOffset = colors.length / 4;
        for (let i = 0; i < header.mdlColorCount; i++) {
            const r = ground.getUint8(pointer);
            const g = ground.getUint8(pointer + 1);
            const b = ground.getUint8(pointer + 2);
            const a = ground.getUint8(pointer + 3);
            pointer += 4;
            colors.push(r, g, b, a);
        }

        pointer += header.mdlColorCount * 4;

        for (let i = 0; i < header.mdlPolyCount; i++) {
            const poly = new Polygon(ground, pointer, gameNumber);
            pointer += 16;
            pushPoly(poly, mdlVertexOffset, mdlColorOffset, header.water);
        }
    }

    const groundIB = buildBatches(stream.indicesGround);
    const transparentIB = buildBatches(stream.indicesTransparent, waterIndices);
    const lodIB = buildBatches(stream.indicesLOD);

    return {
        textures, game: gameNumber, id,
        vertices: new Float32Array(stream.vertices),
        colors: new Float32Array(stream.colors),
        uvs: new Float32Array(stream.uvs),
        indicesGround: groundIB.indices, indicesTransparent: transparentIB.indices, indicesLOD: lodIB.indices,
        batchesGround: groundIB.batches, batchesTransparent: transparentIB.batches, batchesLOD: lodIB.batches
    };
}

export function parseSpyroTextures(vram: VRAM, textureList: DataView, gameNumber: number): SpyroTextureStore {
    const headers = parseTextureHeaders(textureList, gameNumber);
    const colors: Uint8Array[][] = Array(headers.length);
    const tiles: TileDefinition[] = Array(headers.length);
    for (let i = 0; i < headers.length; i++) {
        const corners: Uint8Array[] = Array(4);
        for (let j = 0; j < 4; j++) {
            corners[j] = applyTileRotationRGBA(
                decodeTileToRGBA(vram, headers[i].cor[j]), headers[i].cor[j], headers[i].cor[j].size, gameNumber
            );
        }
        colors[i] = [];
        colors[i].push(combineCorners(corners[0], corners[1], corners[2], corners[3], 32));
        colors[i].push(applyTileRotationRGBA(
            decodeTileToRGBA(vram, headers[i].mid), headers[i].mid, headers[i].mid.size, gameNumber)
        );
        const tile = headers[i].cor[0];
        tile.size = 64;
        tiles[i] = tile;
    }
    return { colors, headers };
}

export function parseMobyInstances(subfile4: DataView, gameNumber: number = 3): SpyroMobyInstance[] {
    const size = subfile4.byteLength;
    const mobyInstancesIndex = [7, 8, 12][gameNumber - 1];
    let pointer = [136, 44, 48][gameNumber - 1];
    let index = 0;
    // jump sections until reaching the right one
    while (pointer < size - 8 && index < mobyInstancesIndex) {
        const sectionSize = subfile4.getUint32(pointer, true);
        pointer += sectionSize;
        index += 1;
    }
    pointer += 4; // skip the instances section's size/next pointer

    if (pointer + 88 > size) {
        // temp fix for S2 title screen, other cutscenes in S2 don't have this problem (???)
        return [];
    }

    // Moby instances (88)
    const mobys: SpyroMobyInstance[] = [];
    for (let i = 0; i < subfile4.getUint32(pointer, true); i++) {
        const pos = pointer + 4 + (i * 88);
        if (pos + 88 > size) {
            break;
        }
        // offset: name (size)
        //      0: mystery incrementing value (4)
        //   4-11: ???
        //     12: x (4)
        //     16: y (4)
        //     20: z (4)
        //  24-30: ???
        //     31: mystery 0 or 128 value (1)
        //  32-53: ???
        //     54: class ID (1)
        //  55-69: ???
        //     70: yaw (1)
        //  71-88: ???
        const x = subfile4.getInt32(pos + 12, true);
        const y = subfile4.getInt32(pos + 16, true);
        const z = subfile4.getInt32(pos + 20, true);
        const yaw = subfile4.getInt8(pos + 70);
        const classId = subfile4.getUint8(pos + 54);
        // unlikely to have a moby at origin and there's lots of "empty" ones
        if (x === 0 && y === 0 && z === 0) {
            continue;
        }
        mobys.push({ x, y, z, yaw, classId });
    }

    return mobys;
}

export function parseSpyroLevelData(data: ArrayBufferSlice): SpyroLevelData {
    let pointer = 0;
    function getUint32() {
        return new Uint32Array(data.arrayBuffer, pointer, 4)[0];
    }

    // VRAM
    const subFile1Offset = getUint32();
    const vram = data.subarray(subFile1Offset, VRAM_SIZE < data.byteLength ? VRAM_SIZE : 512000); // temp fix for tiny flyover levels

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

    let subfile4;
    pointer = 24;
    const subfile4Offset = getUint32();
    pointer += 4;
    let subfile4Size = getUint32();
    pointer = subfile4Offset;
    if (pointer + subfile4Size < data.byteLength) {
        subfile4 = data.subarray(pointer, subfile4Size);
    }

    return { vram: new VRAM(vram.copyToBuffer()), textureList, ground, sky, subfile4 };
}

export function parseSpyroLevelData2(data: ArrayBufferSlice, gameNumber: number = 2): SpyroLevelData {
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

    // fourth subfile
    let subfile4;
    pointer = 24;
    const subfile4Offset = getUint32();
    let subfile4Size = getUint32();
    if (gameNumber === 2) {
        subfile4Size -= 32;
    }
    pointer += subfile4Offset - 32;
    if (pointer + subfile4Size <= data.byteLength) {
        subfile4 = data.subarray(pointer, subfile4Size);
    }

    return { vram: new VRAM(vram.copyToBuffer()), textureList, ground, grounds, sky, subfile4 };
}

function turn(src: Uint8Array, size: number): Uint8Array {
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

function mirror(src: Uint8Array, size: number): Uint8Array {
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

function flip(src: Uint8Array, size: number): Uint8Array {
    const dest = new Uint8Array(src.length);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const s = (y * size + x) * 4;
            const d = ((size - 1 - y) * size + x) * 4;
            dest[d + 0] = src[s + 0];
            dest[d + 1] = src[s + 1];
            dest[d + 2] = src[s + 2];
            dest[d + 3] = src[s + 3];
        }
    }
    return dest;
}

function applyTileRotationRGBA(rgba: Uint8Array, tile: TileDefinition, size: number, gameNumber: number): Uint8Array {
    let rotatedRGBA = rgba;

    switch (tile.rotation) {
        case 1:
            rotatedRGBA = mirror(flip(turn(rotatedRGBA, size), size), size);
            break;
        case 2:
            if (gameNumber === 1) {
                rotatedRGBA = turn(turn(rotatedRGBA, size), size);
            } else {
                rotatedRGBA = mirror(flip(rotatedRGBA, size), size);
            }
            break;
        case 3:
            if (gameNumber === 1) {
                rotatedRGBA = mirror(flip(rotatedRGBA, size), size);
            } else {
                rotatedRGBA = turn(turn(rotatedRGBA, size), size);
            }
            break;
        case 4:
            rotatedRGBA = mirror(turn(rotatedRGBA, size), size);
            break;
        case 5:
            rotatedRGBA = mirror(rotatedRGBA, size);
            break;
        case 6:
            rotatedRGBA = flip(turn(rotatedRGBA, size), size);
            break;
        case 7:
            rotatedRGBA = flip(rotatedRGBA, size);
            break;
        default:
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

function decodeTileToRGBA(vram: VRAM, tile: TileDefinition, width: number = tile.size, height: number = tile.size): Uint8Array {
    let x4 = tile.x[3];
    const y4 = tile.y[3];
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
                const word = vram.getWord(tile.x[3] + x, y4 + y);
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

function buildBatches(tileGroups: number[][], waterIndices?: number[]): { batches: SpyroDrawCall[], indices: Uint32Array } {
    const batches: SpyroDrawCall[] = [];
    const indices: number[] = [];
    for (let i = 0; i < tileGroups.length; i++) {
        const group = tileGroups[i];
        if (group.length === 0) {
            continue;
        }
        const isWater = waterIndices !== undefined && waterIndices.includes(i);
        batches.push({ tileIndex: i, indexOffset: indices.length, indexCount: group.length, isWater });
        indices.push(...group);
    }
    return { batches, indices: new Uint32Array(indices) };
}

function combineCorners(topLeft: Uint8Array, topRight: Uint8Array, bottomLeft: Uint8Array, bottomRight: Uint8Array, size: number): Uint8Array {
    const combined: number[] = [];
    const rowWidth = size * 4;
    for (let i = 0; i < size; i++) {
        const start = i * rowWidth;
        const end = start + rowWidth;
        combined.push(...topLeft.slice(start, end));
        combined.push(...topRight.slice(start, end));
    }
    for (let i = 0; i < size; i++) {
        const start = i * rowWidth;
        const end = start + rowWidth;
        combined.push(...bottomLeft.slice(start, end));
        combined.push(...bottomRight.slice(start, end));
    }
    return new Uint8Array(combined);
}

function parseTextureHeaders(data: DataView, gameNumber: number): TextureHeader[] {
    const count = data.getUint32(4, true);
    const headers = new Array(count);
    let offset = 8;
    if (gameNumber === 1) {
        // starts with lod-mid header pairs
        for (let i = 0; i < count; i++) {
            offset += 8; // skip lod header (it's always the same???)
            const mid = parseTile(data, offset, gameNumber);
            offset += 8;
            headers[i] = { mid, cor: [] };
        }
        // jump to high-res groups
        offset = 8 + (16 * count);
        for (let i = 0; i < count; i++) {
            offset += 8; // skip "spr" header
            const cor: TileDefinition[] = Array(4);
            for (let j = 0; j < 4; j++) {
                cor[j] = parseTile(data, offset, gameNumber);
                offset += 8;
            }
            offset += 8 * 16; // skip "sm" headers, same as cor?
            headers[i].cor = cor;
        }
    } else {
        // sequential headers of lod-mid-cor
        for (let i = 0; i < count; i++) {
            offset += 8; // skip lod
            const mid = parseTile(data, offset, gameNumber);
            offset += 8;
            const cor: TileDefinition[] = Array(4);
            for (let j = 0; j < 4; j++) {
                cor[j] = parseTile(data, offset, gameNumber);
                offset += 8;
            }
            headers[i] = { mid, cor };
        }
    }
    return headers;
}

function parseSkyboxPart(view: DataView, size: number, partOffset: number, vertices: number[][], colors: number[][], faces: SkyFace[]): void {
    let pointer = partOffset;
    if (pointer + 24 > size) {
        return;
    }
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // Header (24)
    pointer += 8;
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

function parseTile(data: DataView, offset: number, gameNumber: number): TileDefinition {
    const tile = new TileDefinition(data, offset);
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
    tile.x[3] = tile.mainX + tile.s;
    tile.x[2] = tile.xx + tile.s;
    tile.x[0] = tile.x[3];
    tile.x[1] = tile.x[3] + tile.size;
    tile.y[3] = tile.mainY;
    if ((tile.ss & 16) > 0) {
        tile.y[3] += 256;
    }
    tile.y[2] = tile.y[3];
    tile.y[0] = tile.y[3] + tile.size;
    tile.y[1] = tile.y[3] + tile.size;
    tile.px = (tile.p[0] & 31) * 16;
    tile.py = (tile.p[0] >> 6) | (tile.p[1] << 2);
    tile.rotation = ((tile.ff & 127) >> 4) & 7;
    if (gameNumber > 1) {
        if ((tile.ff & 128) > 0) {
            tile.transparent = 1 + ((tile.ss & 127) >> 5);
        } else {
            tile.transparent = 0;
        }
    }
    return tile;
}
