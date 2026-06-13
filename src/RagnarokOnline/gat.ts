import ArrayBufferSlice from "../ArrayBufferSlice.js";

export interface GatCell {
    height: [number, number, number, number];
    flag: number;
}

export interface GatMap {
    width: number;
    height: number;

    cells: GatCell[];
}

export function isWalkableFlag(flag: number): boolean {
    return flag !== 1 && flag !== 5;
}

export function gatCellIndex(g: GatMap, cx: number, cy: number): number {
    if (cx < 0 || cx >= g.width || cy < 0 || cy >= g.height)
        return -1;
    return cy * g.width + cx;
}

export function isWalkable(g: GatMap, cx: number, cy: number): boolean {
    const idx = gatCellIndex(g, cx, cy);
    if (idx < 0)
        return false;
    return isWalkableFlag(g.cells[idx].flag);
}

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
