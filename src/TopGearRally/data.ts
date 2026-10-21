import ArrayBufferSlice from "../ArrayBufferSlice.js";

export const TRACK_INSTANCE_LIGHT_RAMP = 0x0003;
export const TRACK_INSTANCE_TWO_SIDED = 0x0004;
export const TRACK_INSTANCE_TRANSLUCENT = 0x0008;
export const TRACK_INSTANCE_SHELTER = 0x0010;
export const TRACK_INSTANCE_CLEAR_SKY = 0x0020;
export const TRACK_INSTANCE_FLAT = 0x0080;
export const TRACK_INSTANCE_NIGHT_LIT = 0x0100;
export const TRACK_INSTANCE_RAMPED = 0x0400;
export const TRACK_INSTANCE_DARK_OR_WET = 0x0800;
export const TRACK_INSTANCE_UNROTATED = 0x2000;
export const TRACK_INSTANCE_ARCADE = 0x4000;

export enum TrackSpecialType {
    SpinZ = 0,
    SpinX = 1,
    SpinY = 2,
    Airplane = 3,
    AirplanePathLeft = 4,
    AirplanePathRight = 5,
    AirplaneTrigger = 6,
    Waterfall = 7,
}

export const TEXTURE_FORMAT_CI4 = 1;
export const TEXTURE_FORMAT_SNOW_STILL = 0xb;
export const TEXTURE_ROM_NONE = 0xffffffff;

export interface TGRInstance {
    matrix: Float32Array;
    displayList: number;
    groups: number;
    hidesGroups: number;
    flags: number;
}

export interface TGRAnimationFrame {
    time: number;
    imageRom: number;
    paletteRom: number;
}

export interface TGRTexture {
    image: number;
    palette: number;
    paletteRomIndex: number;
    format: number;
    size: number;
    frames: TGRAnimationFrame[] | null;
}

export interface TGRSpecial {
    target: number;
    param: number;
    type: TrackSpecialType;
}

export interface TGRTrack {
    pointerBase: number;
    data: ArrayBufferSlice;
    stream: ArrayBufferSlice;
    startPosition: [number, number, number];
    startHeading: number;
    minZ: number;
    maxZ: number;
    skyDisplayList: number;
    fogColor: [number, number, number];
    instances: TGRInstance[];
    gridInstances: Set<number>;
    surfaces: Uint16Array;
    vertices: Float32Array;
    gridTriangles: Uint16Array;
    gridTriangleStarts: Uint16Array;
    textures: TGRTexture[];
    specials: TGRSpecial[];
}

const TGR3_MAGIC = 0x33524754;
const HEADER_SIZE = 0x10;
const GRID_CELLS = 64 * 64;

const RAY_HEADROOM = 1.5;
const RAY_CEILING_DEPTH = -1.0;
const GRID_SIZE = 2048;

function pointInTriangle(p: number[], a: number[], b: number[], c: number[], n: number[]): boolean {
    const side = (e0: number[], e1: number[], q: number[]): number => {
        const ex = e1[0] - e0[0];
        const ey = e1[1] - e0[1];
        const ez = e1[2] - e0[2];
        const tx = p[0] - q[0];
        const ty = p[1] - q[1];
        const tz = p[2] - q[2];
        return (ey * tz - ez * ty) * n[0] + (ez * tx - ex * tz) * n[1] + (ex * ty - ey * tx) * n[2];
    };
    return side(a, b, b) >= 0 && side(b, c, b) >= 0 && side(c, a, a) >= 0;
}

export function castCameraRay(track: TGRTrack, x: number, y: number, z: number): number {
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
        return 0;
    }
    const cell = (x >>> 5) + ((y >>> 5) << 6);
    const first = track.gridTriangleStarts[cell];
    const last = track.gridTriangleStarts[cell + 1];
    let nearest = (track.maxZ - track.minZ) * (track.maxZ - track.minZ) + 1;
    let nearestCeiling = nearest;
    let ground = 0;
    let ceiling = 0;
    let groundHits = 0;
    const vertex = (i: number): number[] => [track.vertices[i * 3], track.vertices[i * 3 + 1], track.vertices[i * 3 + 2]];
    for (let k = first; k < last; k++) {
        const index = track.gridTriangles[k];
        if (index === 0) {
            break;
        }
        const s = track.surfaces;
        const vertexCount = track.vertices.length / 3;
        if (index * 4 + 3 >= s.length || s[index * 4] >= vertexCount || s[index * 4 + 1] >= vertexCount || s[index * 4 + 2] >= vertexCount) {
            continue;
        }
        const a = vertex(s[index * 4]);
        const b = vertex(s[index * 4 + 1]);
        const c = vertex(s[index * 4 + 2]);
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [e1[1] * e2[2] - e2[1] * e1[2], e1[2] * e2[0] - e2[2] * e1[0], e1[0] * e2[1] - e2[0] * e1[1]];
        const length = Math.hypot(n[0], n[1], n[2]);
        if (length === 0 || n[2] < 0) {
            continue;
        }
        n[0] /= length;
        n[1] /= length;
        n[2] /= length;
        if (n[2] === 0) {
            continue;
        }
        const t = ((a[0] - x) * n[0] + (a[1] - y) * n[1] + (a[2] - 1) * n[2]) / n[2];
        const hit = [x, y, 1 + t];
        if (!pointInTriangle(hit, a, b, c, n)) {
            continue;
        }
        let below = z + RAY_HEADROOM - hit[2];
        if (below >= 0) {
            groundHits++;
            if (below < nearest) {
                nearest = below;
                ground = s[index * 4 + 3] + 1;
            }
        }
        below -= RAY_HEADROOM;
        if (below <= 0 && below < nearestCeiling) {
            ceiling = s[index * 4 + 3] + 1;
            if (RAY_CEILING_DEPTH < below) {
                nearestCeiling = below;
            }
        }
    }
    return groundHits !== 0 ? ground : ceiling;
}

export function parseTGRTrack(buffer: ArrayBufferSlice): TGRTrack {
    const header = buffer.createDataView();
    const magic = header.getUint32(0x00, true);
    if (magic !== TGR3_MAGIC) {
        throw new Error(`Invalid TGR track magic: 0x${magic.toString(16)}`);
    }
    const pointerBase = header.getUint32(0x04, true);
    const dataSize = header.getUint32(0x08, true);
    const streamSize = header.getUint32(0x0c, true);
    const data = buffer.subarray(HEADER_SIZE, dataSize);
    const stream = buffer.subarray(HEADER_SIZE + dataSize, streamSize);
    const view = data.createDataView();
    const offs = (pointer: number): number => pointer - pointerBase;

    const instances: TGRInstance[] = [];
    const instanceTable = offs(view.getUint32(0x60));
    const instanceCount = view.getUint32(0x64);
    for (let i = 0; i < instanceCount; i++) {
        const o = instanceTable + i * 0x54;
        const matrix = new Float32Array(16);
        for (let j = 0; j < 16; j++) {
            matrix[j] = view.getFloat32(o + j * 4);
        }
        instances.push({
            matrix,
            displayList: view.getUint32(o + 0x44),
            groups: view.getUint16(o + 0x48),
            hidesGroups: view.getUint16(o + 0x4a),
            flags: view.getUint16(o + 0x4c),
        });
    }

    const gridInstances = new Set<number>();
    const gridList = offs(view.getUint32(0x68));
    const gridStarts = offs(view.getUint32(0x6c));
    const first = view.getUint16(gridStarts);
    const last = view.getUint16(gridStarts + GRID_CELLS * 2);
    for (let i = first; i < last; i++) {
        gridInstances.add(view.getUint16(gridList + i * 2));
    }

    const readU16 = (start: number, count: number): Uint16Array => {
        const out = new Uint16Array(count);
        for (let i = 0; i < count; i++) {
            out[i] = view.getUint16(start + i * 2);
        }
        return out;
    };
    const gridTriangleStarts = readU16(offs(view.getUint32(0x24)), GRID_CELLS + 1);
    const gridTriangles = readU16(offs(view.getUint32(0x20)), gridTriangleStarts[GRID_CELLS]);
    let triangleCount = view.getUint32(0x10);
    for (const index of gridTriangles) {
        if (index !== 0xffff && index >= triangleCount) {
            triangleCount = index + 1;
        }
    }
    const surfaces = readU16(offs(view.getUint32(0x0c)), triangleCount * 4);
    let vertexCount = 0;
    for (let i = 0; i < triangleCount; i++) {
        vertexCount = Math.max(vertexCount, surfaces[i * 4] + 1, surfaces[i * 4 + 1] + 1, surfaces[i * 4 + 2] + 1);
    }
    const vertexTable = offs(view.getUint32(0x14));
    vertexCount = Math.min(vertexCount, Math.floor((data.byteLength - vertexTable) / 12));
    const vertices = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertices.length; i++) {
        vertices[i] = view.getFloat32(vertexTable + i * 4);
    }

    const textures: TGRTexture[] = [];
    const textureTable = offs(view.getUint32(0x1c));
    const textureCount = view.getUint32(0x18);
    for (let i = 0; i < textureCount; i++) {
        const o = textureTable + i * 0x24;
        const source = view.getUint32(o + 0x08);
        const bits = view.getUint32(o + 0x20);
        let frames: TGRAnimationFrame[] | null = null;
        if (bits & (1 << 20)) {
            const animation = offs(source);
            frames = [];
            const frameCount = view.getUint16(animation + 0x02);
            for (let k = 0; k < frameCount; k++) {
                const f = animation + 0x08 + k * 0x0c;
                frames.push({
                    time: view.getUint32(f),
                    imageRom: view.getUint32(f + 0x04),
                    paletteRom: view.getUint32(f + 0x08),
                });
            }
        }
        textures.push({
            image: view.getUint32(o),
            palette: view.getUint32(o + 0x04),
            paletteRomIndex: source & 0xfff,
            format: (bits >>> 24) & 0x0f,
            size: bits & 0x3ffff,
            frames,
        });
    }

    const specials: TGRSpecial[] = [];
    const specialCount = view.getUint32(0x224);
    for (let i = 0; i < specialCount; i++) {
        const o = 0x164 + i * 0x0c;
        specials.push({
            target: view.getUint32(o),
            param: view.getUint32(o + 0x04),
            type: view.getUint8(o + 0x08),
        });
    }

    return {
        pointerBase,
        data,
        stream,
        minZ: view.getFloat32(0x38),
        maxZ: view.getFloat32(0x3c),
        skyDisplayList: view.getUint32(0x50),
        startPosition: [view.getFloat32(0x40), view.getFloat32(0x44), view.getFloat32(0x48)],
        startHeading: view.getFloat32(0x4c),
        fogColor: [view.getUint8(0x80), view.getUint8(0x81), view.getUint8(0x82)],
        instances,
        gridInstances,
        surfaces,
        vertices,
        gridTriangles,
        gridTriangleStarts,
        textures,
        specials,
    };
}
