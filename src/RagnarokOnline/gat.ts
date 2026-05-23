
// Parser for Ragnarok Online's GAT attribute grid (magic "GRAT").
//
// The GAT is the map's per-cell attribute layer: a width x height grid, each
// cell holding four corner heights and a type/flag word. The grid is 2x the GND
// resolution (one GND cell = 2x2 GAT cells of 5 world units each). The flag
// classifies the cell:
// walkable ground, blocked, water, etc. We expose walkability + the dimensions
// the pathfinder and the wander controller need.
//
// All multi-byte values are little-endian.

import ArrayBufferSlice from "../ArrayBufferSlice.js";

// One GAT cell: four corner heights and the type flag.
export interface GatCell {
    // Corner heights, ordered as stored: [0]=h1, [1]=h2, [2]=h3, [3]=h4.
    height: [number, number, number, number];
    flag: number;
}

export interface GatMap {
    width: number;
    height: number;
    // Length width*height, row-major: cell(x, y) = cells[y * width + x].
    cells: GatCell[];
}

// True if a GAT cell type is walkable. The engine treats type 1 (no-walk block)
// and type 5 (no-walk snipeable cliff) as the only blocked-for-walking types
// (its "red cell" test); 0 ground, 2 water, 3, 4 and 6 are walkable.
export function isWalkableFlag(flag: number): boolean {
    return flag !== 1 && flag !== 5;
}

// Row-major cell index, or -1 if out of range.
export function gatCellIndex(g: GatMap, cx: number, cy: number): number {
    if (cx < 0 || cx >= g.width || cy < 0 || cy >= g.height)
        return -1;
    return cy * g.width + cx;
}

// Walkability of a GAT cell. Out-of-range cells are blocked (the engine's
// GetCell returns null there and the cell-flag query reads that as blocked).
export function isWalkable(g: GatMap, cx: number, cy: number): boolean {
    const idx = gatCellIndex(g, cx, cy);
    if (idx < 0)
        return false;
    return isWalkableFlag(g.cells[idx].flag);
}

// Parses a .gat buffer. Header: magic "GRAT", version major 1 / minor <= 2,
// then int32 width, int32 height, then width*height cells of (4 floats + int32).
export function parseGAT(buffer: ArrayBufferSlice): GatMap {
    const view = buffer.createDataView();
    let offs = 0;

    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "GRAT")
        throw new Error(`GAT: bad magic "${magic}"`);
    offs += 4;

    const verMajor = view.getUint8(offs++);
    const verMinor = view.getUint8(offs++);
    if (verMajor !== 1 || verMinor > 2)
        throw new Error(`GAT: unsupported version ${verMajor}.${verMinor}`);

    const width = view.getInt32(offs, true); offs += 4;
    const height = view.getInt32(offs, true); offs += 4;
    if (width <= 0 || height <= 0)
        throw new Error(`GAT: bad dimensions ${width}x${height}`);

    const count = width * height;
    const cells: GatCell[] = new Array(count);
    for (let i = 0; i < count; i++) {
        const h0 = view.getFloat32(offs, true); offs += 4;
        const h1 = view.getFloat32(offs, true); offs += 4;
        const h2 = view.getFloat32(offs, true); offs += 4;
        const h3 = view.getFloat32(offs, true); offs += 4;
        const flag = view.getInt32(offs, true); offs += 4;
        cells[i] = { height: [h0, h1, h2, h3], flag };
    }

    return { width, height, cells };
}
