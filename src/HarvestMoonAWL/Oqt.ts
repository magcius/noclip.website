// .oqt files handle world placement data

import { mat4 } from "gl-matrix";

import ArrayBufferSlice from "../ArrayBufferSlice.js";

//#region Matrices

export const MAGIC = 0xEDEFF1F4;
const NODE_SIZE = 44;
const RECORD_SIZE = 52;
const RECORD_SIZE_POINT = 16; // Used for star placement only

export interface OqtInstance {
    idRaw: number; // upper 16 bits are the id, lower 16 always 0
    pos: [number, number, number];
    matrix: number[] | null;
}

export function oqtTypeId(inst: OqtInstance): number {
    return inst.idRaw >>> 16;
}

export function oqtRecordMatrix(dst: mat4, inst: OqtInstance): mat4 {
    const m = inst.matrix;
    if (m === null) // Stars have no matrix
        return mat4.fromTranslation(dst, inst.pos);
    return mat4.set(dst,
        m[0], m[4], m[8], 0,
        m[1], m[5], m[9], 0,
        m[2], m[6], m[10], 0,
        m[3], m[7], m[11], 1,
    );
}

//#endregion

//#region Leaf records

function readLeafInstances(view: DataView, version: number, recordsBase: number, recordCount: number): OqtInstance[] {
    const out: OqtInstance[] = [];
    if (version === 2) {
        for (let i = 0; i < recordCount; i++) {
            const off = recordsBase + i * RECORD_SIZE_POINT;
            const idRaw = view.getUint32(off, false);
            const x = view.getFloat32(off + 4, false);
            const y = view.getFloat32(off + 8, false);
            const z = view.getFloat32(off + 12, false);
            out.push({ idRaw, pos: [x, y, z], matrix: null });
        }
        return out;
    }
    for (let i = 0; i < recordCount; i++) {
        const off = recordsBase + i * RECORD_SIZE;
        const idRaw = view.getUint32(off, false);
        const matrix: number[] = [];
        for (let k = 0; k < 12; k++)
            matrix.push(view.getFloat32(off + 4 + k * 4, false));
        out.push({ idRaw, pos: [matrix[3], matrix[7], matrix[11]], matrix });
    }
    return out;
}

//#endregion

//#region Tree

type ChildOffsets = [number, number, number, number];

export interface OqtLeafGroup {
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
    start: number;
    count: number;
}

export interface OqtFile {
    instances: OqtInstance[];
    groups: OqtLeafGroup[];
}

export function parse(data: ArrayBufferSlice): OqtFile {
    const view = data.createDataView();

    const magic = view.getUint32(0, false);
    if (magic !== MAGIC)
        throw new Error(`unexpected .oqt magic 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`);
    const flags = view.getUint32(4, false);
    if (flags !== 1 && flags !== 2)
        throw new Error(`unsupported .oqt version/flags word 0x${flags.toString(16)} (only 0x1/0x2 implemented)`);

    const instances: OqtInstance[] = [];
    const groups: OqtLeafGroup[] = [];

    function bboxAt(off: number): [[number, number, number], [number, number, number]] {
        return [
            [view.getFloat32(off + 0, false), view.getFloat32(off + 4, false), view.getFloat32(off + 8, false)],
            [view.getFloat32(off + 12, false), view.getFloat32(off + 16, false), view.getFloat32(off + 20, false)],
        ];
    }

    function visit(childOffs: ChildOffsets, count: number, recordsBase: number, bboxOff: number): void {
        const isLeaf = childOffs.every((c) => c === 0);
        if (isLeaf) {
            const [bboxMin, bboxMax] = bboxAt(bboxOff);
            groups.push({ bboxMin, bboxMax, start: instances.length, count });
            instances.push(...readLeafInstances(view, flags, recordsBase, count));
            return;
        }
        for (const c of childOffs) {
            if (c === 0)
                continue;
            const childChildren: ChildOffsets = [
                view.getUint32(c + 0x18, false), view.getUint32(c + 0x1C, false),
                view.getUint32(c + 0x20, false), view.getUint32(c + 0x24, false),
            ];
            const childCount = view.getUint32(c + 0x28, false);
            visit(childChildren, childCount, c + NODE_SIZE, c);
        }
    }

    const rootChildren: ChildOffsets = [
        view.getUint32(0x20, false), view.getUint32(0x24, false),
        view.getUint32(0x28, false), view.getUint32(0x2C, false),
    ];
    const rootCount = view.getUint32(0x30, false);
    visit(rootChildren, rootCount, 0x34, 0x08);

    return { instances, groups };
}

export function allInstances(data: ArrayBufferSlice): OqtInstance[] {
    return parse(data).instances;
}

//#endregion
