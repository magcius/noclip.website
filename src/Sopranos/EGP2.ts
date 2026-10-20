import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

const QUADWORD = 16;
const MESH_TABLE_AT = 0x64;
const MESH_COUNT_AT = 0x20;
const MATERIAL_TABLE_AT = 0x50;
const MATERIAL_COUNT_AT = 0x14;
const STRING_TABLE_AT = 0x54;
const MATERIAL_SIZE = 84;
const MATERIAL_TEXTURE_AT = 0x10;
const MATERIAL_MESHES_AT = 0x58;
// Pass count, and prefix sums partitioning the 0x58 records between passes: pass p owns the
// records [sums[p - 1], sums[p]).
const PASS_COUNT_AT = 0x30;
const PASS_TABLE_AT = 0x34;
// The engine blends source alpha over the destination for these passes and draws the rest
// opaque. A material cannot override its pass.
export const BLEND_PASSES = new Set([2, 6]);
const PASS_SIZE = 8;
const NLOOP_MASK = 0x7FFF;
const PREAMBLE_QUADWORDS = 3;
const BOX_W = 1.0;
const MIN_BOX_EXTENT = 0.001;

export const TRIANGLE_LIST = 3;
export const TRIANGLE_STRIP = 4;

export interface EGP2Material {
    name: string;
    textureOffset: number;
}

export interface EGP2Mesh {
    positions: Float32Array;
    texcoords: Float32Array;
    colors: Uint8Array;
    indices: Uint32Array;
    material: number;
    // Counted from 1. Levels fill passes 1 and 2, so pass 2 is the decal pass.
    pass: number;
}

/**
 * Read a geometry blob's material table.
 * @param data The whole `.EGP2` blob.
 * @returns One entry per material, in table order.
 */
export function readMaterials(data: ArrayBufferSlice): EGP2Material[] {
    const view = data.createDataView();
    const table = view.getUint32(MATERIAL_TABLE_AT, true);
    const count = view.getUint32(MATERIAL_COUNT_AT, true);
    const strings = view.getUint32(STRING_TABLE_AT, true);
    const materials: EGP2Material[] = [];
    for (let i = 0; i < count; i++) {
        const record = table + i * MATERIAL_SIZE;
        if (record + MATERIAL_SIZE > data.byteLength) {
            break;
        }
        const at = strings + view.getUint32(record, true);
        materials.push({
            name: at < data.byteLength ? readString(data, at) : `material_${i}`,
            textureOffset: view.getUint32(record + MATERIAL_TEXTURE_AT, true),
        });
    }
    return materials;
}

// The primitive comes from the GIFtag's PRIM field. Strips alternate winding, and the cooker
// stitches them together with degenerate triangles, which are dropped here.
function pushTriangles(indices: number[], positions: number[], base: number, count: number, primitive: number): void {
    const same = (a: number, b: number): boolean => {
        const ia = (base + a) * 3, ib = (base + b) * 3;
        return positions[ia] === positions[ib] && positions[ia + 1] === positions[ib + 1] && positions[ia + 2] === positions[ib + 2];
    };
    const emit = (a: number, b: number, c: number): void => {
        if (!same(a, b) && !same(b, c) && !same(a, c)) {
            indices.push(base + a, base + b, base + c);
        }
    };
    if (primitive === TRIANGLE_LIST) {
        for (let i = 0; i + 2 < count; i += 3) {
            emit(i, i + 1, i + 2);
        }
        return;
    }
    for (let i = 0; i + 2 < count; i++) {
        if (i % 2) {
            emit(i, i + 2, i + 1);
        } else {
            emit(i, i + 1, i + 2);
        }
    }
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0.0;
}

// A packet starts with two float4 rows for its bounding box (both with w = 1.0), then a
// GIFtag, then 80-byte groups of four vertices: four [u, v, x, y] rows then one row of four z.
function readMesh(view: DataView, byteLength: number, start: number, quadwords: number, material: number, pass: number): EGP2Mesh | null {
    const positions: number[] = [];
    const texcoords: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let i = 0;
    while (i + PREAMBLE_QUADWORDS < quadwords) {
        const at = start + i * QUADWORD;
        if (at + 3 * QUADWORD > byteLength) {
            break;
        }
        if (view.getFloat32(at + 12, true) !== BOX_W || view.getFloat32(at + QUADWORD + 12, true) !== BOX_W) {
            i++;
            continue;
        }
        let ordered = true, extent = false;
        for (let j = 0; j < 3; j++) {
            const lo = view.getFloat32(at + j * 4, true);
            const hi = view.getFloat32(at + QUADWORD + j * 4, true);
            if (!(lo <= hi)) {
                ordered = false;
            }
            if (hi - lo > MIN_BOX_EXTENT) {
                extent = true;
            }
        }
        if (!ordered || !extent) {
            i++;
            continue;
        }
        const count = view.getUint32(at + 2 * QUADWORD, true) & NLOOP_MASK;
        const primitive = (view.getUint32(at + 2 * QUADWORD + 4, true) >>> 15) & 7;
        const groups = (count + 3) >> 2;
        const body = i + PREAMBLE_QUADWORDS;
        if (count === 0 || body + groups * 5 > quadwords) {
            i++;
            continue;
        }
        const base = positions.length / 3;
        let written = 0;
        for (let g = 0; g < groups; g++) {
            const group = start + (body + g * 5) * QUADWORD;
            for (let k = 0; k < 4 && written < count; k++, written++) {
                const row = group + k * QUADWORD;
                const u = view.getFloat32(row + 0, true);
                const v = view.getFloat32(row + 4, true);
                const x = view.getFloat32(row + 8, true);
                const y = view.getFloat32(row + 12, true);
                const z = view.getFloat32(group + 4 * QUADWORD + k * 4, true);
                positions.push(finite(x), finite(z), -finite(y));
                texcoords.push(finite(u), 1.0 - finite(v));
                // The low byte of each float in the row carries one channel of the vertex colour,
                // on the PS2 0..128 scale.
                colors.push(Math.min(255, view.getUint8(row + 0) * 2), Math.min(255, view.getUint8(row + 4) * 2), Math.min(255, view.getUint8(row + 8) * 2), Math.min(255, view.getUint8(row + 12) * 2));
            }
        }
        pushTriangles(indices, positions, base, count, primitive);
        i = body + groups * 5;
    }
    if (indices.length === 0) {
        return null;
    }
    return {
        positions: new Float32Array(positions),
        texcoords: new Float32Array(texcoords),
        colors: new Uint8Array(colors),
        indices: new Uint32Array(indices),
        material,
        pass,
    };
}

// The record's first word is the material index; the table skips indices, so a record's position in
// it is not its material. A descriptor is a run of (count, start) pairs, one per render pass, read
// up to the next descriptor.
function materialByMesh(view: DataView, byteLength: number): Map<number, { material: number, pass: number }> {
    const table = view.getUint32(MATERIAL_MESHES_AT, true);
    const count = view.getUint32(MATERIAL_COUNT_AT, true);
    const meshes = view.getUint32(MESH_COUNT_AT, true);
    const passOf = new Array<number>(count).fill(1);
    const passes = view.getUint32(PASS_COUNT_AT, true);
    const sums = view.getUint32(PASS_TABLE_AT, true);
    if (sums !== 0 && sums + (passes + 1) * 4 <= byteLength) {
        for (let p = 1; p <= passes; p++) {
            const from = view.getUint32(sums + (p - 1) * 4, true);
            const to = view.getUint32(sums + p * 4, true);
            for (let i = from; i < Math.min(to, count); i++) {
                passOf[i] = p;
            }
        }
    }
    const entries: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
        const record = table + i * 16;
        if (record + 16 > byteLength) {
            break;
        }
        entries.push([view.getUint32(record, true), view.getUint32(record + 8, true), passOf[i]]);
    }
    const ordered = [...new Set(entries.filter(([, p]) => p !== 0).map(([, p]) => p))].sort((a, b) => a - b);
    const out = new Map<number, { material: number, pass: number }>();
    for (const [material, pointer, pass] of entries) {
        if (pointer === 0) {
            continue;
        }
        const after = ordered.findIndex((p) => p > pointer);
        const end = after >= 0 ? Math.min(ordered[after], byteLength) : Math.min(pointer + PASS_SIZE * 16, byteLength);
        for (let at = pointer; at <= end - 8; at += PASS_SIZE) {
            const owned = view.getUint32(at, true);
            const start = view.getUint32(at + 4, true);
            if (owned > meshes || start + owned * 8 > byteLength) {
                break;
            }
            for (let k = 0; k < owned; k++) {
                const block = view.getUint32(start + k * 8, true);
                if (!out.has(block)) {
                    out.set(block, { material, pass });
                }
            }
        }
    }
    return out;
}

/**
 * Read every mesh in a geometry blob. Meshes come from the materials' draw lists; the mesh table at
 * 0x64 holds only about half of them, though whatever it has that the lists miss is included too.
 * @param data The whole `.EGP2` blob.
 * @returns One entry per mesh that decoded, in address order.
 */
export function readMeshes(data: ArrayBufferSlice): EGP2Mesh[] {
    const view = data.createDataView();
    const table = view.getUint32(MESH_TABLE_AT, true);
    const count = view.getUint32(MESH_COUNT_AT, true);
    const byBlock = materialByMesh(view, data.byteLength);
    const blocks = new Set<number>(byBlock.keys());
    for (let i = 0; i < count; i++) {
        if (table + i * 4 + 4 > data.byteLength) {
            break;
        }
        const block = view.getUint32(table + i * 4, true);
        if (block !== 0) {
            blocks.add(block);
        }
    }
    const meshes: EGP2Mesh[] = [];
    for (const block of [...blocks].sort((a, b) => a - b)) {
        if (block + 12 > data.byteLength) {
            continue;
        }
        const start = view.getUint32(block + 4, true);
        const quadwords = view.getUint32(block + 8, true);
        if (start + quadwords * QUADWORD !== block) {
            continue;
        }
        const owner = byBlock.get(block);
        const mesh = readMesh(view, data.byteLength, start, quadwords, owner?.material ?? -1, owner?.pass ?? 1);
        if (mesh !== null) {
            meshes.push(mesh);
        }
    }
    return meshes;
}
