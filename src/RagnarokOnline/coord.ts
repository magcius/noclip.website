import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";

// GND cells are 10 world units wide; each contains a 2x2 grid of 5-unit GAT cells.
// World Y is the negated GND height. The X axis is mirrored about the map centre
// to match the terrain mesh's orientation (gnd.ts builds it the same way).

export const GND_CELL_SIZE = 10;
export const GAT_CELL_SIZE = 5;

export function gatCellToWorld(gatX: number, gatY: number, height: number, gndWidth: number): [number, number, number] {
    const worldWidth = gndWidth * GND_CELL_SIZE;
    return [worldWidth - (gatX + 0.5) * GAT_CELL_SIZE, -height, (gatY + 0.5) * GAT_CELL_SIZE];
}

// Bilinearly samples the GND cell's four corner heights at the GAT sub-cell
// position. A plain average would flatten stairs and slopes under any GAT cell
// that shares a GND parent. Corner order: [0]=(x,y) [1]=(x+1,y) [2]=(x,y+1) [3]=(x+1,y+1).
export function gatCellGroundHeight(gnd: GndMap, gatX: number, gatY: number): number {
    const gx = gatX >> 1, gy = gatY >> 1;
    if (gx < 0 || gy < 0 || gx >= gnd.width || gy >= gnd.height)
        return 0;
    const h = gnd.cells[gy * gnd.width + gx].height;
    const u = ((gatX & 1) + 0.5) * 0.5;
    const v = ((gatY & 1) + 0.5) * 0.5;
    return (1 - u) * (1 - v) * h[0] + u * (1 - v) * h[1] + (1 - u) * v * h[2] + u * v * h[3];
}

export function gatCellGroundedWorldPos(gnd: GndMap, gatX: number, gatY: number): [number, number, number] {
    return gatCellToWorld(gatX, gatY, gatCellGroundHeight(gnd, gatX, gatY), gnd.width);
}

// Walkable-surface height: averages the GAT cell's own corners, which follow
// what the player walks on (props like staircases lift their GAT corners above
// the GND below). Use this for cell-anchored decorations (warp portals etc.)
// that should sit on top of the geometry rather than the raw terrain.
export function gatCellSurfaceHeight(gat: GatMap, gatX: number, gatY: number): number {
    if (gatX < 0 || gatY < 0 || gatX >= gat.width || gatY >= gat.height)
        return 0;
    const h = gat.cells[gatY * gat.width + gatX].height;
    return (h[0] + h[1] + h[2] + h[3]) * 0.25;
}
