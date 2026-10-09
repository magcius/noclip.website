// The soil under a crop

//#region Soil state

export const enum SoilState {
    Untilled = 0,
    Tilled = 1,
    Planted = 2,
    TilledWet = 3,
}

export function blockForState(state: number, sub: number = 0): number {
    if (state === SoilState.Planted) {
        switch (sub) {
            case 1: return 6;
            case 2: return 5;
            case 3: return 4;
            default: return 2;
        }
    }
    if (state === SoilState.Tilled)
        return 1;
    if (state === SoilState.TilledWet)
        return 3;
    return 0;
}

// Blocks 4/5/6 are the block-2 soil tile plus a floating seed marker.
export function soilBlockForState(state: number, sub: number = 0): number {
    const block = blockForState(state, sub);
    return block === 4 || block === 5 || block === 6 ? 2 : block;
}

//#endregion

//#region Texture and tint

export const TEXTURE_INDEX: readonly (readonly number[])[] = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
];

export function imageForGridState(grid: number, state: number): number {
    return TEXTURE_INDEX[grid][state];
}

// watered soil is the same texture drawn darker.
export const TINT_RGBA: readonly (readonly [number, number, number, number])[] = [
    [0xFF, 0xFF, 0xFF, 0xFF], [0xC8, 0xC8, 0xC8, 0xFF], [0xBE, 0xBE, 0xBE, 0xFF], [0xAA, 0xAA, 0xAA, 0xFF],
];

//#endregion

//#region Tile edge bleed

// neighbouring tiles overlap slightly, prevent z fighting
export const EDGE_BLEED_INNER = 0.001;
export const EDGE_BLEED_OUTER = 0.05;

export const enum EdgeBit {
    MinX = 0x01,
    MaxX = 0x02,
    MinZ = 0x04,
    MaxZ = 0x08,
}

export function edgeMask(row: number, col: number, rows: number, cols: number): number {
    let mask = 0;
    if (row === 0)
        mask |= EdgeBit.MinX;
    if (row === rows - 1)
        mask |= EdgeBit.MaxX;
    if (col === 0)
        mask |= EdgeBit.MinZ;
    if (col === cols - 1)
        mask |= EdgeBit.MaxZ;
    return mask;
}

function bleed(mask: number, bit: EdgeBit): number {
    return (mask & bit) !== 0 ? EDGE_BLEED_OUTER : EDGE_BLEED_INNER;
}

// Split into the two halves the caller concatenates as T * S
export function tileScale(mask: number): [number, number, number] {
    return [
        1.0 + bleed(mask, EdgeBit.MinX) + bleed(mask, EdgeBit.MaxX),
        1.0,
        1.0 + bleed(mask, EdgeBit.MinZ) + bleed(mask, EdgeBit.MaxZ),
    ];
}

export function tileMinCorner(cornerX: number, y: number, cornerZ: number, mask: number): [number, number, number] {
    return [cornerX - bleed(mask, EdgeBit.MinX), y, cornerZ - bleed(mask, EdgeBit.MinZ)];
}

//#endregion

//#region NPC Fields

export const NPC_FIELD_GRID = 1;
export const NPC_FIELD_STATE = SoilState.Planted;
export const NPC_FIELD_SUB = 0;
export const NPC_FIELD_BLOCK = soilBlockForState(NPC_FIELD_STATE, NPC_FIELD_SUB);
export const NPC_FIELD_IMAGE = imageForGridState(NPC_FIELD_GRID, NPC_FIELD_STATE);

//#endregion
