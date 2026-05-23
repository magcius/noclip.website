import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";

// GND cells are 10 world units wide and contain 2x2 GAT cells of 5 world units each.
// Server scripts (mob spawns, NPCs, warps) address the world in GAT cell coordinates;
// the helpers below convert those to the renderer's corner-origin world frame and
// mirror X about the map centre to flip RO's left-handed authoring frame into our
// right-handed render frame. World Y is the negated GND height (mesh uses world_y = -height).

export const GND_CELL_SIZE = 10;
export const GAT_CELL_SIZE = 5;

// Maps a GAT cell (gatX, gatY) to its world position. `height` is the ground height at
// that location (negated to match world_y = -height). Returns [worldX, worldY, worldZ].
export function gatCellToWorld(gatX: number, gatY: number, height: number, gndWidth: number): [number, number, number] {
    const worldWidth = gndWidth * GND_CELL_SIZE;
    // +0.5 centers in the cell; X is mirrored about the map centre.
    return [worldWidth - (gatX + 0.5) * GAT_CELL_SIZE, -height, (gatY + 0.5) * GAT_CELL_SIZE];
}

// Ground height at a GAT cell, sampled from the parent GND cell's four corner
// heights. The GAT grid is 2x the GND resolution so each GND cell contains 4
// GAT cells in a 2x2 layout; the GAT cell's centre sits at (0.25, 0.25),
// (0.75, 0.25), (0.25, 0.75) or (0.75, 0.75) within the GND cell's [0,1]^2.
// Bilinearly sample at that sub-position rather than averaging all 4 corners
// (which would return the GND cell centre's height for every GAT cell — flat
// ground is fine, but on stairs/slopes a sprite half-buries or floats).
// Corner ordering: [0]=(x,y) [1]=(x+1,y) [2]=(x,y+1) [3]=(x+1,y+1).
// Out-of-range cells return 0.
export function gatCellGroundHeight(gnd: GndMap, gatX: number, gatY: number): number {
    const gx = gatX >> 1, gy = gatY >> 1;
    if (gx < 0 || gy < 0 || gx >= gnd.width || gy >= gnd.height)
        return 0;
    const h = gnd.cells[gy * gnd.width + gx].height;
    // Sub-position 0 -> 0.25, sub-position 1 -> 0.75 in non-mirrored GND-cell
    // coords (the X mirror is applied later in gatCellToWorld and does not
    // change the corner layout, which is stored unmirrored).
    const u = ((gatX & 1) + 0.5) * 0.5;
    const v = ((gatY & 1) + 0.5) * 0.5;
    return (1 - u) * (1 - v) * h[0] + u * (1 - v) * h[1] + (1 - u) * v * h[2] + u * v * h[3];
}

// Combined helper: ground-grounded world position for a GAT cell.
export function gatCellGroundedWorldPos(gnd: GndMap, gatX: number, gatY: number): [number, number, number] {
    return gatCellToWorld(gatX, gatY, gatCellGroundHeight(gnd, gatX, gatY), gnd.width);
}

// Walkable-surface height at a GAT cell, averaged from that cell's own four
// corner heights. The GAT layer is authored to follow what the player walks on
// — when a staircase or platform RSM prop is dropped on top of flat GND, the
// GAT cells under the prop have their corners lifted to the prop's surface so
// the pathfinder routes a character up the stairs. Sampling these instead of
// the GND under the prop puts cell-anchored decorations (warp portals, etc.)
// on top of the geometry the player is meant to stand on. Out-of-range cells
// return 0. The cell centre samples to exactly the mean of the four corners.
export function gatCellSurfaceHeight(gat: GatMap, gatX: number, gatY: number): number {
    if (gatX < 0 || gatY < 0 || gatX >= gat.width || gatY >= gat.height)
        return 0;
    const h = gat.cells[gatY * gat.width + gatX].height;
    return (h[0] + h[1] + h[2] + h[3]) * 0.25;
}
