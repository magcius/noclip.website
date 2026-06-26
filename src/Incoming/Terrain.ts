
// Terrain handling for Incoming (1998, Rage Software).
//
// The terrain is a 513x513 grid of int16 heights (`tland1.bin`) over a 512x512 cell field,
// textured by a 128x128 tile map (`city2tc.bin`) that selects, per 4x4-cell tile, one of
// up to 8 land textures plus a UV orientation. World units: 700 per cell, height = the raw
// int16 value.

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { IAN_VERTEX_FLOATS } from "./IAN.js";

/** Number of heightfield vertices per row/column. */
export const TERRAIN_GRID_VERTS = 513;
/** Number of cells per row/column (one fewer than the vertex count). */
export const TERRAIN_GRID_CELLS = 512;
/** World units between adjacent heightfield vertices, on both X and Z. */
export const TERRAIN_CELL_SPACING = 700;
/** Number of texture-map tiles per row/column. */
export const TERRAIN_TILE_GRID = 128;
/** Number of heightfield cells spanned by one texture tile, per axis. */
export const TERRAIN_CELLS_PER_TILE = 4;
/** Total world extent of the terrain on each axis (512 cells * 700). */
export const TERRAIN_WORLD_EXTENT = TERRAIN_GRID_CELLS * TERRAIN_CELL_SPACING;
/** Maximum number of distinct land textures referenced by the tile map. */
export const TERRAIN_MAX_TEXTURES = 8;
const TILE_FLAG_CULL = 0x1000;
const TILE_FLAG_WATER = 0x2000;
/**
 * A renderable terrain mesh for a single land texture: interleaved pos3/norm3/uv2 vertices
 * and a 32-bit triangle index list. The vertex layout matches {@link IAN_VERTEX_FLOATS}.
 */
export interface TerrainMesh {
    /** Index (0..7) of the land texture this mesh uses. */
    readonly textureIndex: number;
    /** Interleaved vertex data, 8 float32 per vertex: posX,posY,posZ, nX,nY,nZ, u,v. */
    readonly vertices: Float32Array;
    /** Triangle index list (3 indices per triangle). */
    readonly indices: Uint32Array;
}
/** The decoded heightfield, exposing height lookups in world space. */
export interface Heightfield {
    /** Raw int16 heights, row-major with X as the major axis (stride {@link TERRAIN_GRID_VERTS}). */
    readonly heights: Int16Array;
}

/**
 * Wraps a raw `tland1.bin` buffer as a {@link Heightfield}.
 * @param buffer The raw heightfield bytes (513*513 int16, little-endian).
 * @returns The heightfield.
 */
export function parseHeightfield(buffer: ArrayBufferSlice): Heightfield {
    const heights = buffer.createTypedArray(Int16Array, 0, TERRAIN_GRID_VERTS * TERRAIN_GRID_VERTS);
    return { heights };
}

function heightAt(hf: Heightfield, ix: number, iz: number): number {
    const cx = ix < 0 ? 0 : ix > TERRAIN_GRID_VERTS - 1 ? TERRAIN_GRID_VERTS - 1 : ix;
    const cz = iz < 0 ? 0 : iz > TERRAIN_GRID_VERTS - 1 ? TERRAIN_GRID_VERTS - 1 : iz;
    return hf.heights[cx * TERRAIN_GRID_VERTS + cz];
}

/**
 * Bilinearly samples the terrain height at arbitrary world (x, z), for placing objects
 * declared `on ground`.
 * @param hf The heightfield.
 * @param worldX World X coordinate.
 * @param worldZ World Z coordinate.
 * @returns The interpolated world-space ground height.
 */
export function sampleGroundHeight(hf: Heightfield, worldX: number, worldZ: number): number {
    const fx = worldX / TERRAIN_CELL_SPACING;
    const fz = worldZ / TERRAIN_CELL_SPACING;
    let ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0) {
        ix = 0;
    } else if (ix > TERRAIN_GRID_CELLS - 1) {
        ix = TERRAIN_GRID_CELLS - 1;
    }
    if (iz < 0) {
        iz = 0;
    } else if (iz > TERRAIN_GRID_CELLS - 1) {
        iz = TERRAIN_GRID_CELLS - 1;
    }
    const tx = fx - ix, tz = fz - iz;
    const h00 = heightAt(hf, ix, iz);
    const h10 = heightAt(hf, ix + 1, iz);
    const h01 = heightAt(hf, ix, iz + 1);
    const h11 = heightAt(hf, ix + 1, iz + 1);
    // Split each cell on the (0,0)->(1,1) diagonal.
    if (tx + tz <= 1.0) {
        return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    } else {
        return h11 + (h10 - h11) * (1 - tz) + (h01 - h11) * (1 - tx);
    }
}

function computeNormal(hf: Heightfield, ix: number, iz: number, out: Float32Array): void {
    const hL = heightAt(hf, ix - 1, iz);
    const hR = heightAt(hf, ix + 1, iz);
    const hD = heightAt(hf, ix, iz - 1);
    const hU = heightAt(hf, ix, iz + 1);
    const nx = hR - hL;
    const ny = -2 * TERRAIN_CELL_SPACING; // Incoming up is -Y, so negate to get the +Y-up normal.
    const nz = hU - hD;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
}

function orientUV(u: number, v: number, orient: number, out: Float32Array): void {
    let ou = u;
    let ov = v;
    const rot = (orient >> 2) & 0x3;
    for (let r = 0; r < rot; r++) {
        const t = ou;
        ou = ov;
        ov = 1 - t;
    }
    if (orient & 0x1) {
        ou = 1 - ou;
    }
    if (orient & 0x2) {
        ov = 1 - ov;
    }
    out[0] = ou;
    out[1] = ov;
}
/**
 * Builds the full terrain geometry, grouped into one {@link TerrainMesh} per land texture.
 * Every non-culled tile contributes a 4x4-cell patch (textured with its land texture across
 * `[0,1]`, oriented per the tile word).
 * @param hf The parsed heightfield.
 * @param cellFlags The raw `city2tc.bin` buffer (128*128 int16, little-endian).
 * @returns One mesh per land-texture index that has at least one tile (sparse; may be < 8).
 */
export function buildTerrainMeshes(hf: Heightfield, cellFlags: ArrayBufferSlice): TerrainMesh[] {
    const tiles = cellFlags.createTypedArray(Int16Array, 0, TERRAIN_TILE_GRID * TERRAIN_TILE_GRID);
    // Precompute per-vertex normals once for the whole grid (shared across tiles).
    const normalScratch = new Float32Array(3);
    const uvScratch = new Float32Array(2);
    // Accumulate vertices/indices per texture index.
    const verts: number[][] = [];
    const inds: number[][] = [];
    for (let t = 0; t < TERRAIN_MAX_TEXTURES; t++) {
        verts.push([]);
        inds.push([]);
    }

    for (let tr = 0; tr < TERRAIN_TILE_GRID; tr++) {
        for (let tc = 0; tc < TERRAIN_TILE_GRID; tc++) {
            const word = tiles[tr * TERRAIN_TILE_GRID + tc] & 0xffff;
            if (word & TILE_FLAG_CULL) {
                continue;
            }
            const texIndex = word & 0xf;
            const orient = (word >> 8) & 0xf;
            const v = verts[texIndex];
            const ind = inds[texIndex];

            const base = v.length / IAN_VERTEX_FLOATS;
            const PATCH = TERRAIN_CELLS_PER_TILE; // 4 cells -> 5 verts per axis
            for (let li = 0; li <= PATCH; li++) {
                for (let lj = 0; lj <= PATCH; lj++) {
                    const ix = tr * PATCH + li;
                    const iz = tc * PATCH + lj;
                    const h = heightAt(hf, ix, iz);
                    computeNormal(hf, ix, iz, normalScratch);
                    orientUV(li / PATCH, lj / PATCH, orient, uvScratch);
                    v.push(
                        ix * TERRAIN_CELL_SPACING, h, iz * TERRAIN_CELL_SPACING,
                        normalScratch[0], normalScratch[1], normalScratch[2],
                        uvScratch[0], uvScratch[1],
                    );
                }
            }
            const row = PATCH + 1;
            for (let li = 0; li < PATCH; li++) {
                for (let lj = 0; lj < PATCH; lj++) {
                    const v00 = base + li * row + lj;
                    const v10 = base + (li + 1) * row + lj;
                    const v01 = base + li * row + (lj + 1);
                    const v11 = base + (li + 1) * row + (lj + 1);
                    // Winding: top (up, Incoming −Y) faces are the FRONT so back-face culling drop
                    // the underside. The reversed order (vs the natural v00,v10,v11) matches the
                    // renderer's CW front-face convention shared with the `.ian` object meshes.
                    ind.push(v00, v11, v10, v00, v01, v11);
                }
            }
        }
    }

    const meshes: TerrainMesh[] = [];
    for (let t = 0; t < TERRAIN_MAX_TEXTURES; t++) {
        if (inds[t].length === 0) {
            continue;
        }
        meshes.push({
            textureIndex: t,
            vertices: new Float32Array(verts[t]),
            indices: new Uint32Array(inds[t]),
        });
    }
    return meshes;
}
/**
 * Builds a flat water plane covering every terrain tile flagged as water (`city2tc` bit 0x2000),
 * at the world-space height `waterLevel` (the ODL `water` directive). One quad per 4x4-cell tile,
 * with an upward normal and the water texture tiled per heightfield cell.
 * @param cellFlags The raw `city2tc.bin` buffer (128*128 int16, little-endian).
 * @param waterLevel The water-surface world Y.
 * @returns A single mesh (texture index 0) of all water tiles, or undefined if there are none.
 */
export function buildWaterMesh(cellFlags: ArrayBufferSlice, waterLevel: number): TerrainMesh | undefined {
    const tiles = cellFlags.createTypedArray(Int16Array, 0, TERRAIN_TILE_GRID * TERRAIN_TILE_GRID);
    const verts: number[] = [];
    const inds: number[] = [];
    const span = TERRAIN_CELLS_PER_TILE * TERRAIN_CELL_SPACING; // world size of one tile

    for (let tr = 0; tr < TERRAIN_TILE_GRID; tr++) {
        for (let tc = 0; tc < TERRAIN_TILE_GRID; tc++) {
            if ((tiles[tr * TERRAIN_TILE_GRID + tc] & TILE_FLAG_WATER) === 0) {
                continue;
            }
            const x0 = tr * span, x1 = x0 + span;
            const z0 = tc * span, z1 = z0 + span;
            // UV tiled per heightfield cell (one repeat every TERRAIN_CELL_SPACING units).
            const u0 = x0 / TERRAIN_CELL_SPACING, u1 = x1 / TERRAIN_CELL_SPACING;
            const v0 = z0 / TERRAIN_CELL_SPACING, v1 = z1 / TERRAIN_CELL_SPACING;
            const base = verts.length / IAN_VERTEX_FLOATS;
            // Normal points along Incoming up (−Y) so the up-sun lights the surface.
            verts.push(
                x0, waterLevel, z0, 0, -1, 0, u0, v0,
                x1, waterLevel, z0, 0, -1, 0, u1, v0,
                x1, waterLevel, z1, 0, -1, 0, u1, v1,
                x0, waterLevel, z1, 0, -1, 0, u0, v1,
            );
            inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    if (inds.length === 0) {
        return undefined;
    }
    return { textureIndex: 0, vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}
