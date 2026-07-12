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
    cor?: TileDefinition[]
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
    vertices: Float32Array;
    colors: Float32Array;
    uvs: Float32Array;
    indicesGround: number[][];
    indicesTransparent: number[][];
    indicesLOD: number[][];
    waterIndices: number[];
};

export interface SpyroLevelData {
    vram: SpyroVRAM;
    textureList: ArrayBufferSlice;
    ground: ArrayBufferSlice;
    grounds?: ArrayBufferSlice[];
    sky: ArrayBufferSlice;
    skys?: ArrayBufferSlice[];
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
    baseX: number;
    baseY: number;
    packedPageCoords: vec2;
    xx: number;
    yy: number;
    flags1: number;
    flags2: number;
    pageX: number = 0;
    pageY: number = 0;
    bitDepth: 4 | 8 | 15 = 4;
    size: number = 32;
    rotation: number = 0;
    shift: number = 0;
    transparent: number = 0;
    x: vec4 = vec4.create();
    y: vec4 = vec4.create();

    constructor(data: DataView, offset: number) {
        this.baseX = data.getUint8(offset);
        this.baseY = data.getUint8(offset + 1);
        this.packedPageCoords = vec2.fromValues(data.getUint8(offset + 2), data.getUint8(offset + 3));
        this.xx = data.getUint8(offset + 4);
        this.yy = data.getUint8(offset + 5);
        this.flags1 = data.getUint8(offset + 6);
        this.flags2 = data.getUint8(offset + 7);
    }
}

class PartHeader {
    x: number;
    y: number;
    z: number;
    flags: number; // presumably flags, usually is just the max u32 value
    lodVertexCount: number;
    lodColorCount: number;
    lodPolyCount: number;
    mdlVertexCount: number;
    mdlColorCount: number;
    mdlPolyCount: number;
    water: number;

    constructor(data: DataView, offs: number) {
        this.y = data.getInt16(offs, true);
        this.x = data.getInt16(offs + 2, true);
        this.z = data.getInt16(offs + 6, true);
        this.lodVertexCount = data.getUint8(offs + 8);
        this.lodColorCount = data.getUint8(offs + 9);
        this.lodPolyCount = data.getUint8(offs + 10);
        this.mdlVertexCount = data.getUint8(offs + 12);
        this.mdlColorCount = data.getUint8(offs + 13);
        this.mdlPolyCount = data.getUint8(offs + 14);
        this.water = data.getUint8(offs + 15);
        this.flags = data.getUint32(offs + 16, true);
    }
}

class LODPoly {
    vertexIndices: vec3;
    colorIndices: vec3;

    constructor(view: DataView, offset: number) {
        this.vertexIndices = vec3.fromValues(view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.colorIndices = vec3.fromValues(view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    }
}

class LODPoly2 {
    vertexIndices: vec4;
    colorIndices: vec4;

    constructor(view: DataView, offset: number) {
        this.vertexIndices = vec4.fromValues(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.colorIndices = vec4.fromValues(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    }
}

class Polygon {
    vertexIndices: vec4;
    colorIndices: vec4;
    packedTileIndex: number = 0;
    uvPermuatation: number = 0; // S1 only
    s: vec4 = vec4.create(); // S2/3 only
    ii: number = 0; // S2/3 only

    constructor(view: DataView, offset: number, gameNumber: number) {
        this.vertexIndices = vec4.fromValues(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        this.colorIndices = vec4.fromValues(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
        if (gameNumber == 1) {
            this.packedTileIndex = view.getUint8(offset + 8);
            this.uvPermuatation = view.getUint8(offset + 9);
        } else {
            this.s = vec4.fromValues(view.getUint8(offset + 8), view.getUint8(offset + 9), view.getUint8(offset + 10), view.getUint8(offset + 11));
            this.packedTileIndex = view.getUint8(offset + 12) & 127;
            this.ii = view.getUint8(offset + 13);
        }
    }
}

// 512 KB and some change
const VRAM_SIZE = 524288;
const MOBY_INSTANCE_SIZE = 88;
// temp manual workaround for cor tiles in s3 sublevels with "missing" vram data
const S3_SUBLEVEL_INVALID_COR_TILES: Map<number, number[]> = new Map([
    [122, [3, 4, 5, 6, 77, 78]],
    [124, [10, 15, 16, 67]],
    [140, [60, 71, 78]],
    [156, [0]],
    [170, [1, 21, 22, 65]]
]);

export class SpyroVRAM {
    private data: Uint16Array;

    constructor(buffer: ArrayBuffer) {
        this.data = new Uint16Array(buffer);
    }

    public getWord(wordX: number, wordY: number): number {
        if (wordX < 0 || wordX >= 512 || wordY < 0 || wordY >= 512) {
            return 0;
        }
        return this.data[wordY * 512 + wordX];
    }

    public getWordByIndex(index: number): number {
        if (index < 0 || index >= this.data.length) {
            return 0;
        }
        return this.data[index];
    }

    public applyFontStripFix() {
        for (let x = 512; x <= 575; x++) {
            this.data[130560 + x] = this.data[130048 + x - 512];
        }
    }
}

export function buildSpyroSkybox(data: DataView, gameNumber: number): SpyroSkybox {
    const backgroundColor = [data.getUint8(0), data.getUint8(1), data.getUint8(2)];
    const partCount = data.getUint32(4, true);
    let pointer = 8;
    const partOffsets: number[] = [];
    for (let i = 0; i < partCount; i++) {
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
    for (const offset of partOffsets) {
        if (gameNumber == 1) {
            parseSkyboxPart(data, offset, vertices, colors, faces);
        } else {
            parseSkyboxPart2(data, offset, vertices, colors, faces);
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
    // band-aid solution to hide polygons that shouldn't (???) be visible if the entire texture is black
    // comment this out and then see tile 43 in the waterfall in idol springs for an example
    // these polygons are probably supposed to be invisible (e.g. zero alpha)
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
                v1: (poly.vertexIndices[0] & 63),
                v2: (poly.vertexIndices[0] >> 6) | ((poly.vertexIndices[1] & 15) << 2),
                v3: (poly.vertexIndices[1] >> 4) | ((poly.vertexIndices[2] & 3) << 4),
                v4: (poly.vertexIndices[2] >> 2),
                c1: (poly.colorIndices[0] & 63),
                c2: (poly.colorIndices[0] >> 6) | ((poly.colorIndices[1] & 15) << 2),
                c3: (poly.colorIndices[1] >> 4) | ((poly.colorIndices[2] & 3) << 4),
                c4: (poly.colorIndices[2] >> 2),
            };
        } else {
            assert(poly instanceof LODPoly2);
            return {
                v1: (poly.vertexIndices[0] >> 3) | ((poly.vertexIndices[1] & 3) << 5),
                v2: (poly.vertexIndices[1] >> 2) | ((poly.vertexIndices[2] & 1) << 6),
                v3: (poly.vertexIndices[2] >> 1),
                v4: (poly.vertexIndices[3] & 127),
                c1: (poly.colorIndices[0] >> 4) | ((poly.colorIndices[1] & 7) << 4),
                c2: (poly.colorIndices[1] >> 3) | ((poly.colorIndices[2] & 3) << 5),
                c3: (poly.colorIndices[2] >> 2) | ((poly.colorIndices[3] & 1) << 6),
                c4: (poly.colorIndices[3] >> 1),
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
            const ci = color[i] * 3;
            const uv = uvs[i];
            const r = colors[ci];
            const g = colors[ci + 1];
            const b = colors[ci + 2];
            stream.vertices.push(vertices[vi], vertices[vi + 1], vertices[vi + 2]);
            stream.colors.push(r / 255, g / 255, b / 255);
            stream.uvs.push(uv[0], uv[1]);
            group[tileIndex].push(runningIndex++);
        }
    }

    function pushPoly(poly: Polygon, vertexOffset: number, colorOffset: number, waterFlag: number) {
        const tileIndex = poly.packedTileIndex & 127;
        if (tileIndex < 0 || tileIndex >= tileCount) {
            // console.warn("Out of bounds tile index for", poly, waterFlag);
            return;
        }
        const tile = textures.headers[tileIndex].mid;
        const isTransparent = tile.transparent > 0;
        const isWater = (gameNumber > 1) ? (waterFlag === 0 && poly.s[0] === 0 && poly.s[1] === 0 && poly.s[2] === 0 && poly.s[3] === 0) : false;
        const isLOD = false;
        const opts = { isLOD, isTransparent, isWater };
        const v1 = vertexOffset + poly.vertexIndices[0];
        const v2 = vertexOffset + poly.vertexIndices[1];
        const v3 = vertexOffset + poly.vertexIndices[2];
        const v4 = vertexOffset + poly.vertexIndices[3];
        const c1 = colorOffset + poly.colorIndices[0];
        const c2 = colorOffset + poly.colorIndices[1];
        const c3 = colorOffset + poly.colorIndices[2];
        const c4 = colorOffset + poly.colorIndices[3];
        let A = UV.TL, B = UV.TR, C = UV.BR, D = UV.BL;

        const isTri = poly.vertexIndices[0] === poly.vertexIndices[1];
        if (gameNumber > 1) {
            if (isTri) {
                const rr = (poly.ii >> 4) & 3;
                const rot = (tile.rotation - rr) & 3;
                const seq = [A, B, C, D];
                const rotated = [seq[(0 + rot) & 3], seq[(1 + rot) & 3], seq[(2 + rot) & 3], seq[(3 + rot) & 3]];
                [A, B, C, D] = rotated;
            }
        } else {
            if (poly.vertexIndices[0] === poly.vertexIndices[1]) {
                const base = [UV.TL, UV.TR, UV.BR, UV.BL];
                const perms = [[0, 1, 2, 3], [3, 0, 1, 2], [2, 3, 0, 1], [1, 2, 3, 0]];
                const p = perms[poly.uvPermuatation & 3];
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

        const lodColorOffset = colors.length / 3;
        for (let i = 0; i < header.lodColorCount; i++) {
            const r = ground.getUint8(pointer);
            const g = ground.getUint8(pointer + 1);
            const b = ground.getUint8(pointer + 2);
            pointer += 4;
            colors.push(r, g, b);
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
                const far = header.lodVertexCount === 0 && header.flags === 0xFFFFFFFF;
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

        const mdlColorOffset = colors.length / 3;
        for (let i = 0; i < header.mdlColorCount; i++) {
            const r = ground.getUint8(pointer);
            const g = ground.getUint8(pointer + 1);
            const b = ground.getUint8(pointer + 2);
            pointer += 4;
            colors.push(r, g, b);
        }

        // these are valid colors, but appear out of order when used in place of the above colors
        // they could be colors used in place of textures for mdl parts that are a certain distance from the camera maybe?
        // (too close for lod but not close enough for textures to show)
        pointer += header.mdlColorCount * 4;

        for (let i = 0; i < header.mdlPolyCount; i++) {
            const poly = new Polygon(ground, pointer, gameNumber);
            pointer += 16;
            pushPoly(poly, mdlVertexOffset, mdlColorOffset, header.water);
        }
    }

    return {
        textures, game: gameNumber, id,
        vertices: new Float32Array(stream.vertices),
        colors: new Float32Array(stream.colors),
        uvs: new Float32Array(stream.uvs),
        indicesGround: stream.indicesGround,
        indicesTransparent: stream.indicesTransparent,
        indicesLOD: stream.indicesLOD, waterIndices
    };
}

export function parseSpyroTextures(vram: SpyroVRAM, textureList: DataView, gameNumber: number, levelId: number = -1): SpyroTextureStore {
    const headers = parseTextureHeaders(textureList, gameNumber);
    const colors: Uint8Array[][] = Array(headers.length);
    for (let i = 0; i < headers.length; i++) {
        let doCOR = true;
        if (gameNumber === 3 && S3_SUBLEVEL_INVALID_COR_TILES.has(levelId)) {
            // temp manual workaround for cor tiles with "missing" vram data
            doCOR = !S3_SUBLEVEL_INVALID_COR_TILES.get(levelId)!.includes(i);
        }
        colors[i] = [];
        if (doCOR) {
            const corners: Uint8Array[] = Array(4);
            for (let j = 0; j < 4; j++) {
                corners[j] = applyTileRotationRGBA(
                    decodeTileToRGBA(vram, headers[i].cor![j]), headers[i].cor![j], headers[i].cor![j].size, gameNumber
                );
            }
            colors[i].push(combineCorners(corners[0], corners[1], corners[2], corners[3], 32));
        } else {
            headers[i].cor = undefined;
        }
        colors[i].push(applyTileRotationRGBA(
            decodeTileToRGBA(vram, headers[i].mid), headers[i].mid, headers[i].mid.size, gameNumber)
        );
    }
    return { colors, headers };
}

export function parseSpyroMobyInstances(subfile4: DataView, gameNumber: number): SpyroMobyInstance[] {
    const size = subfile4.byteLength;
    const sectionIndex = [7, 8, 12][gameNumber - 1];
    let pointer = [136, 44, 48][gameNumber - 1];
    let index = 0;
    // jump sections until reaching the right one
    while (pointer < size - 8 && index < sectionIndex) {
        const sectionSize = subfile4.getUint32(pointer, true);
        pointer += sectionSize;
        index += 1;
    }
    pointer += 4; // skip the instances section's size/next pointer

    if (pointer + MOBY_INSTANCE_SIZE > size) {
        // section is empty, therefore no mobys
        return [];
    }

    // moby instances (88)
    const mobys: SpyroMobyInstance[] = [];
    for (let i = 0; i < subfile4.getUint32(pointer, true); i++) {
        const pos = pointer + 4 + (i * MOBY_INSTANCE_SIZE);
        if (pos + MOBY_INSTANCE_SIZE > size) {
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

    // vram (subfile 1 also includes sound data after the vram but that's ignored)
    const subFile1Offset = getUint32();
    const vram = data.subarray(subFile1Offset, VRAM_SIZE < data.byteLength ? VRAM_SIZE : 512000); // temp fix for tiny flyover levels

    // texture list
    pointer = 8;
    const subFile2Offset = getUint32();
    pointer = subFile2Offset;
    const textureListSize = getUint32();
    const textureList = data.subarray(pointer, textureListSize + 16);

    // ground
    pointer = subFile2Offset;
    pointer += textureListSize;
    const groundSize = getUint32() - 4;
    pointer += 4;
    const ground = data.subarray(pointer, groundSize);

    // sky
    pointer += groundSize;
    let skySize = getUint32();
    pointer += 4;
    const ret = pointer;
    const firstSkyCount = skySize;
    pointer += skySize - 4;
    skySize = getUint32();
    if (skySize > 3) {
        pointer += skySize;
        skySize = getUint32();
        pointer += skySize;
        skySize = getUint32();
        pointer += 4;
    } else {
        // cutscenes & flyover levels get here
        pointer = ret;
        skySize = firstSkyCount;
    }
    const sky = data.subarray(pointer, skySize);

    let subfile4;
    pointer = 24;
    const subfile4Offset = getUint32();
    pointer += 4;
    let subfile4Size = getUint32();
    pointer = subfile4Offset;
    if (pointer + subfile4Size < data.byteLength) {
        subfile4 = data.subarray(pointer, subfile4Size);
    }

    return { vram: new SpyroVRAM(vram.copyToBuffer()), textureList, ground, sky, subfile4 };
}

export function parseSpyroLevelData2(data: ArrayBufferSlice, gameNumber: number, isFlyover: boolean = false): SpyroLevelData {
    let pointer = 0;
    function getUint32() {
        pointer += 4;
        return new Uint32Array(data.arrayBuffer, pointer - 4, 4)[0];
    }

    // vram (subfile 1 also includes sound data after the vram but that's ignored)
    pointer += getUint32();
    let vramSize = VRAM_SIZE;
    const remainingVram = data.byteLength - pointer;
    if (remainingVram < vramSize) {
        vramSize = remainingVram;
    }
    const vram = data.subarray(pointer, vramSize);

    // texture list
    pointer = 8;
    const subfile2Offset = getUint32();
    pointer = subfile2Offset;
    const listSize = getUint32();
    pointer -= 4;
    const textureList = data.subarray(pointer, listSize + 16);

    // sky
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
    if (!isFlyover) {
        const p = new Uint8Array(data.arrayBuffer, pointer, 12);
        pointer += 12;

        const isValidPattern =
            ((p[0] & 15) === 0) &&
            ((p[1] >> 4) === 0) &&
            (p[2] === 0) &&
            (p[3] === 0) &&
            ((p[4] & 15) === 0) &&
            ((p[5] >> 4) === 0) &&
            (p[6] === 0) &&
            (p[7] === 0) &&
            ((p[8] & 15) === 0) &&
            ((p[9] >> 4) === 0) &&
            (p[10] === 0) &&
            (p[11] === 0);

        if (!isValidPattern) {
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
    }
    offset = getUint32();
    const sky = data.subarray(pointer, offset - 4);

    // sublevels' sky
    const skys: ArrayBufferSlice[] = [];
    if (gameNumber === 3) {
        pointer = 0x28;
        const subfile6Offset = getUint32();
        pointer += 12;
        const subfile8Offset = getUint32();
        pointer += 12;
        const subfile10Offset = getUint32();

        for (const p of [subfile6Offset, subfile8Offset, subfile10Offset]) {
            if (p !== 0) {
                pointer = p + 48;
                const size = getUint32();
                // section is "empty" if the size is 4 (it's just the size itself as the entire section)
                if (size > 4) {
                    skys.push(data.subarray(pointer, size - 4));
                }
            }
        }
    }

    // ground
    pointer = subfile2Offset;
    offset = getUint32();
    pointer += offset - 4;
    offset = getUint32();
    const ground = data.subarray(pointer, offset - 4);
    pointer += offset - 4;

    // sublevels' ground
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

    return { vram: new SpyroVRAM(vram.copyToBuffer()), textureList, ground, grounds, sky, skys, subfile4 };
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

function getCLUT(vram: SpyroVRAM, px: number, py: number, n: number): [number, number, number, number][] {
    const clut: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
        clut.push(colorBitsToRGBA(vram.getWordByIndex((py * 512 + px) + i)));
    }
    return clut;
}

function decodeTileToRGBA(vram: SpyroVRAM, tile: TileDefinition, width: number = tile.size, height: number = tile.size): Uint8Array {
    let startX = tile.x[3];
    const startY = tile.y[3];
    if (tile.bitDepth === 4) {
        startX = startX >> 2;
        const clut = getCLUT(vram, tile.pageX, tile.pageY, 16);
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 4; x++) {
                const word = vram.getWord(startX + x, startY + y);
                for (let nib = 0; nib < 4; nib++) {
                    const dst = (y * width + (x * 4 + nib)) * 4;
                    const [r, g, b, a] = clut[(word >> (nib * 4)) & 15];
                    rgba[dst + 0] = r;
                    rgba[dst + 1] = g;
                    rgba[dst + 2] = b;
                    rgba[dst + 3] = a;
                }
            }
        }
        return rgba;
    } else if (tile.bitDepth === 8) {
        startX = startX >> 1;
        const clut = getCLUT(vram, tile.pageX, tile.pageY, 256);
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width / 2; x++) {
                const word = vram.getWord(startX + x, startY + y);
                {
                    const dst = (y * width + (x * 2)) * 4;
                    const [r, g, b, a] = clut[word & 255];
                    rgba[dst + 0] = r;
                    rgba[dst + 1] = g;
                    rgba[dst + 2] = b;
                    rgba[dst + 3] = a;
                }
                {
                    const dst = (y * width + (x * 2 + 1)) * 4;
                    const [r, g, b, a] = clut[(word >> 8) & 255];
                    rgba[dst + 0] = r;
                    rgba[dst + 1] = g;
                    rgba[dst + 2] = b;
                    rgba[dst + 3] = a;
                }
            }
        }
        return rgba;
    } else {
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const word = vram.getWord(tile.x[3] + x, startY + y);
                const [r, g, b, a] = colorBitsToRGBA(word);
                const dst = (y * width + x) * 4;
                rgba[dst + 0] = r;
                rgba[dst + 1] = g;
                rgba[dst + 2] = b;
                rgba[dst + 3] = a;
            }
        }
        return rgba;
    }
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

function parseSkyboxPart(data: DataView, partOffset: number, vertices: number[][], colors: number[][], faces: SkyFace[]): void {
    let pointer = partOffset;
    if (pointer + 24 > data.byteLength) {
        return;
    }
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // header (24)
    pointer += 8;
    const globalY = data.getInt16(pointer, true);
    const globalZ = data.getInt16(pointer + 2, true);
    const vertexCount = data.getUint16(pointer + 4, true);
    const globalX = data.getInt16(pointer + 6, true);
    const polyCount = data.getUint16(pointer + 8, true);
    const colorCount = data.getUint16(pointer + 10, true);
    pointer += 16;

    // vertices (4)
    for (let i = 0; i < vertexCount; i++) {
        if (pointer + 4 > data.byteLength) {
            break;
        }
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

    // colors (4)
    for (let i = 0; i < colorCount; i++) {
        if (pointer + 4 > data.byteLength) {
            break;
        }
        colors.push([data.getUint8(pointer), data.getUint8(pointer + 1), data.getUint8(pointer + 2)]);
        pointer += 4;
    }

    function unpackSkyIndex(b1: number, b2: number, b3: number, b4: number): [number, number, number] {
        return [(b1 >> 2) | ((b2 & 15) << 6), (b2 >> 4) | ((b3 & 63) << 4), (b3 >> 6) | (b4 << 2)];
    }

    // polygons (8)
    for (let i = 0; i < polyCount; i++) {
        if (pointer + 8 > data.byteLength) {
            break;
        }
        const [vi1, vi2, vi3] = unpackSkyIndex(data.getUint8(pointer), data.getUint8(pointer + 1), data.getUint8(pointer + 2), data.getUint8(pointer + 3));
        const [ci1, ci2, ci3] = unpackSkyIndex(data.getUint8(pointer + 4), data.getUint8(pointer + 5), data.getUint8(pointer + 6), data.getUint8(pointer + 7));
        if (vi1 < vertexCount && vi2 < vertexCount && vi3 < vertexCount && ci1 < colorCount && ci2 < colorCount && ci3 < colorCount) {
            faces.push({
                indices: [baseVertexIndex + vi1, baseVertexIndex + vi2, baseVertexIndex + vi3],
                colors: [baseColorIndex + ci1, baseColorIndex + ci2, baseColorIndex + ci3,]
            });
        }
        pointer += 8;
    }
}

function parseSkyboxPart2(data: DataView, partOffset: number, vertices: number[][], colors: number[][], faces: SkyFace[]): void {
    let pointer = partOffset;
    const baseVertexIndex = vertices.length;
    const baseColorIndex = colors.length;

    // header (20)
    if (pointer + 20 > data.byteLength) {
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

    // vertices (4)
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

    // colors (4)
    for (let i = 0; i < colorCount; i++) {
        colors.push([data.getUint8(pointer), data.getUint8(pointer + 1), data.getUint8(pointer + 2)]);
        pointer += 4;
    }

    // polys
    let seeker = pointer + polyCount;
    for (let i = polyCount; i > 3; i -= 4) {
        if (pointer + 4 > data.byteLength) {
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

        if (seeker + 2 > data.byteLength) {
            return;
        }
        let v1 = data.getUint8(seeker);
        const v2 = data.getUint8(seeker + 1);
        seeker += 2;

        let v3Base = v0;
        let c3Base = c0;

        faces.push({
            indices: [baseVertexIndex + v0, baseVertexIndex + v1, baseVertexIndex + v2],
            colors: [baseColorIndex + c0, baseColorIndex + c1, baseColorIndex + c2]
        });

        for (let i = 0; i < (b1 & 7); i++) {
            if (seeker + 2 > data.byteLength) {
                return;
            }
            const v2New = data.getUint8(seeker);
            const cm = data.getUint8(seeker + 1);
            const c2New = cm & 127;
            faces.push({
                indices: [baseVertexIndex + v0, baseVertexIndex + v1, baseVertexIndex + v2New],
                colors: [baseColorIndex + c0, baseColorIndex + c1, baseColorIndex + c2New]
            });
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
    if (gameNumber === 1) {
        if ((tile.flags2 & 128) > 0) {
            tile.size = 32;
        } else {
            tile.size = 16;
        }
    }
    if ((tile.flags2 & 1) > 0) {
        tile.bitDepth = 15;
    } else if ((tile.flags1 & 128) > 0) {
        tile.bitDepth = 8;
    } else {
        tile.bitDepth = 4;
    }
    tile.shift = tile.flags1 & 7;
    switch (tile.bitDepth) {
        case 4:
            tile.shift *= 256;
            break;
        case 8:
            tile.shift *= 128;
            break;
        case 15:
            tile.shift *= 64;
            break;
    }
    tile.x[3] = tile.baseX + tile.shift;
    tile.x[2] = tile.xx + tile.shift;
    tile.x[0] = tile.x[3];
    tile.x[1] = tile.x[3] + tile.size;
    tile.y[3] = tile.baseY;
    if ((tile.flags1 & 16) > 0) {
        tile.y[3] += 256;
    }
    tile.y[2] = tile.y[3];
    tile.y[0] = tile.y[3] + tile.size;
    tile.y[1] = tile.y[3] + tile.size;
    tile.pageX = (tile.packedPageCoords[0] & 31) * 16;
    tile.pageY = (tile.packedPageCoords[0] >> 6) | (tile.packedPageCoords[1] << 2);
    tile.rotation = ((tile.flags2 & 127) >> 4) & 7;
    if (gameNumber > 1) {
        if ((tile.flags2 & 128) > 0) {
            tile.transparent = 1 + ((tile.flags1 & 127) >> 5);
        } else {
            tile.transparent = 0;
        }
    }
    return tile;
}
