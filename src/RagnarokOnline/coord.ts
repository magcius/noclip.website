import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";

// Shared coordinate helpers for placing server-cell entities in the terrain's
// render frame.
//
// Server scripts (mob spawns, NPCs, warps) address the world in GAT cell
// coordinates: integer (x, y) on the attribute grid. The attribute grid is 2x
// the GND resolution (one GND cell = 2x2 GAT cells) and uses a fixed cell size
// of 5 world units; the GND ground uses a cell size (zoom) of 10. Both span the
// same world extent, so a GAT cell maps to world units at half the GND zoom.
//
// The original client centers the world on the origin: world_x = (gatX -
// gatWidth/2) * 5. Our terrain mesh instead uses a corner origin (world_x =
// gndCellX * zoom, with no centering), so an entity at GAT cell gatX lands at
// gatX * (zoom/2) in the same corner-origin frame the mesh is built in. The
// north/Y axis is NOT flipped relative to render Z (the client's GetClientCoor
// maps cz = (gatY - h/2) * zoom monotonically), so worldZ increases with gatY.
// World Y is the negated terrain height (the mesh uses world_y = -height).
//
// X is MIRRORED about the map centre. RO authors its world left-handed (Direct3D)
// while this renderer is right-handed (WebGL); copying X straight through would
// render the whole map as a horizontal mirror image (backwards ground text, props
// on the wrong side). The terrain mesh, model placements and the sun direction
// apply the same mirror, so everything stays consistent. The mirror is X' = W - X
// where W = gndWidth * gndZoom is the map's world width (all world X lie in [0, W]).

// World units per GAT cell, as a function of the GND zoom. The attribute grid is
// twice the GND resolution, so each GAT cell is half a GND cell wide.
export function gatCellSize(gndZoom: number): number {
    return gndZoom / 2;
}

// Maps a GAT cell (gatX, gatY) to the horizontal world position in the terrain's
// corner-origin render frame. `height` is the ground height at that location
// (look it up from the GND cell at gatX>>1, gatY>>1); it is negated to match the
// mesh's world_y = -height convention. `gndWidth` is the GND cell width, used to
// mirror X about the map centre (see the file header). Returns [worldX, worldY,
// worldZ].
export function gatCellToWorld(gatX: number, gatY: number, height: number, gndZoom: number, gndWidth: number): [number, number, number] {
    const cell = gatCellSize(gndZoom);
    const worldWidth = gndWidth * gndZoom;
    // +0.5 centers the entity in the cell rather than on its corner; X is mirrored
    // about the map centre to convert RO's left-handed frame to our right-handed one.
    return [worldWidth - (gatX + 0.5) * cell, -height, (gatY + 0.5) * cell];
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
    return gatCellToWorld(gatX, gatY, gatCellGroundHeight(gnd, gatX, gatY), gnd.zoom, gnd.width);
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
