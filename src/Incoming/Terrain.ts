
// Terrain for Incoming (1998, Rage Software). `tland1.bin` holds a 513x513 grid of int16 heights
// over a 512x512 cell field at 700 world units per cell, the height being the raw int16.
// `city2tc.bin` holds a 128x128 map of int16 tile words, one per 4x4-cell tile.

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { IAN_VERTEX_FLOATS } from "./IAN.js";

/** Heightfield vertices per row and column. */
export const TERRAIN_GRID_VERTS = 513;
/** Cells per row and column, one fewer than the vertex count. */
export const TERRAIN_GRID_CELLS = 512;
/** World units between adjacent heightfield vertices, on both X and Z. */
export const TERRAIN_CELL_SPACING = 700;
/** Texture-map tiles per row and column. */
export const TERRAIN_TILE_GRID = 128;
/** Heightfield cells spanned by one texture tile, per axis. */
export const TERRAIN_CELLS_PER_TILE = 4;
/** World extent of the terrain on each axis. */
export const TERRAIN_WORLD_EXTENT = TERRAIN_GRID_CELLS * TERRAIN_CELL_SPACING;
/** Distinct land textures the tile map can reference. */
export const TERRAIN_MAX_TEXTURES = 8;

const TILE_TEXTURE_MASK = 0x000f;
const TILE_FLAG_FLIP_U = 0x0100;
const TILE_FLAG_FLIP_V = 0x0200;
const TILE_QUARTER_TURN_SHIFT = 10;
const TILE_QUARTER_TURN_MASK = 0x3;
const TILE_FLAG_CULL = 0x1000;
const TILE_FLAG_WATER = 0x2000;

const VERTS_PER_TILE_EDGE = TERRAIN_CELLS_PER_TILE + 1;
const INCOMING_UP_Y = -1;

/** Terrain geometry for a single land texture. */
export interface TerrainMesh {
    /** Which of the {@link TERRAIN_MAX_TEXTURES} land textures this mesh draws with. */
    readonly textureIndex: number;
    /** Interleaved, {@link IAN_VERTEX_FLOATS} float32 per vertex: position3, normal3, uv2. */
    readonly vertices: Float32Array;
    /** Triangle list, 3 indices each. */
    readonly indices: Uint32Array;
}

/** The decoded heightfield. */
export interface Heightfield {
    /** Raw int16 heights, row-major with X major and a stride of {@link TERRAIN_GRID_VERTS}. */
    readonly heights: Int16Array;
}

/**
 * Wraps a raw `tland1.bin` buffer.
 *
 * @param buffer 513*513 little-endian int16 heights.
 * @returns The heightfield.
 */
export function parseHeightfield(buffer: ArrayBufferSlice): Heightfield {
    const heights = buffer.createTypedArray(Int16Array, 0, TERRAIN_GRID_VERTS * TERRAIN_GRID_VERTS);
    return { heights };
}

function heightAt(hf: Heightfield, ix: number, iz: number): number {
    const clampedX = ix < 0 ? 0 : ix > TERRAIN_GRID_VERTS - 1 ? TERRAIN_GRID_VERTS - 1 : ix;
    const clampedZ = iz < 0 ? 0 : iz > TERRAIN_GRID_VERTS - 1 ? TERRAIN_GRID_VERTS - 1 : iz;
    return hf.heights[clampedX * TERRAIN_GRID_VERTS + clampedZ];
}

/**
 * Samples the terrain height at arbitrary world coordinates, for placing objects declared
 * `on ground`.
 *
 * @param hf The heightfield.
 * @param worldX World X.
 * @param worldZ World Z.
 * @returns The interpolated ground height, clamped to the grid at the edges.
 */
export function sampleGroundHeight(hf: Heightfield, worldX: number, worldZ: number): number {
    const cellX = worldX / TERRAIN_CELL_SPACING;
    const cellZ = worldZ / TERRAIN_CELL_SPACING;
    let ix = Math.floor(cellX), iz = Math.floor(cellZ);
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
    const tx = cellX - ix, tz = cellZ - iz;
    const heightAtOrigin = heightAt(hf, ix, iz);
    const heightAtPosX = heightAt(hf, ix + 1, iz);
    const heightAtPosZ = heightAt(hf, ix, iz + 1);
    const heightAtFar = heightAt(hf, ix + 1, iz + 1);
    // The cell's two triangles meet along the posX-to-posZ edge, which both interpolations share.
    const inOriginTriangle = tx + tz <= 1.0;
    if (inOriginTriangle) {
        return heightAtOrigin + (heightAtPosX - heightAtOrigin) * tx + (heightAtPosZ - heightAtOrigin) * tz;
    } else {
        return heightAtFar + (heightAtPosX - heightAtFar) * (1 - tz) + (heightAtPosZ - heightAtFar) * (1 - tx);
    }
}

function computeNormal(hf: Heightfield, ix: number, iz: number, out: Float32Array): void {
    const heightNegX = heightAt(hf, ix - 1, iz);
    const heightPosX = heightAt(hf, ix + 1, iz);
    const heightNegZ = heightAt(hf, ix, iz - 1);
    const heightPosZ = heightAt(hf, ix, iz + 1);
    const nx = heightPosX - heightNegX;
    const ny = INCOMING_UP_Y * 2 * TERRAIN_CELL_SPACING;
    const nz = heightPosZ - heightNegZ;
    const length = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / length;
    out[1] = ny / length;
    out[2] = nz / length;
}

function orientUV(u: number, v: number, quarterTurns: number, flipU: boolean, flipV: boolean, out: Float32Array): void {
    let orientedU = u;
    let orientedV = v;
    for (let turn = 0; turn < quarterTurns; turn++) {
        const previousU = orientedU;
        orientedU = orientedV;
        orientedV = 1 - previousU;
    }
    if (flipU) {
        orientedU = 1 - orientedU;
    }
    if (flipV) {
        orientedV = 1 - orientedV;
    }
    out[0] = orientedU;
    out[1] = orientedV;
}

/**
 * Builds the terrain geometry. Every tile that is not culled contributes a 4x4-cell patch, its
 * texture stretched across `[0,1]` and oriented per the tile word.
 *
 * @param hf The parsed heightfield.
 * @param cellFlags Raw `city2tc.bin`, 128*128 little-endian int16.
 * @returns One mesh per land-texture index that has at least one tile, so fewer than
 * {@link TERRAIN_MAX_TEXTURES} of them.
 */
export function buildTerrainMeshes(hf: Heightfield, cellFlags: ArrayBufferSlice): TerrainMesh[] {
    const tiles = cellFlags.createTypedArray(Int16Array, 0, TERRAIN_TILE_GRID * TERRAIN_TILE_GRID);
    const normalScratch = new Float32Array(3);
    const uvScratch = new Float32Array(2);
    const verticesByTexture: number[][] = [];
    const indicesByTexture: number[][] = [];
    for (let t = 0; t < TERRAIN_MAX_TEXTURES; t++) {
        verticesByTexture.push([]);
        indicesByTexture.push([]);
    }

    for (let tileX = 0; tileX < TERRAIN_TILE_GRID; tileX++) {
        for (let tileZ = 0; tileZ < TERRAIN_TILE_GRID; tileZ++) {
            const tileWord = tiles[tileX * TERRAIN_TILE_GRID + tileZ] & 0xffff;
            if (tileWord & TILE_FLAG_CULL) {
                continue;
            }
            const textureIndex = tileWord & TILE_TEXTURE_MASK;
            const quarterTurns = (tileWord >> TILE_QUARTER_TURN_SHIFT) & TILE_QUARTER_TURN_MASK;
            const flipU = (tileWord & TILE_FLAG_FLIP_U) !== 0;
            const flipV = (tileWord & TILE_FLAG_FLIP_V) !== 0;
            const vertices = verticesByTexture[textureIndex];
            const indices = indicesByTexture[textureIndex];

            const firstVertex = vertices.length / IAN_VERTEX_FLOATS;
            for (let localX = 0; localX < VERTS_PER_TILE_EDGE; localX++) {
                for (let localZ = 0; localZ < VERTS_PER_TILE_EDGE; localZ++) {
                    const ix = tileX * TERRAIN_CELLS_PER_TILE + localX;
                    const iz = tileZ * TERRAIN_CELLS_PER_TILE + localZ;
                    const height = heightAt(hf, ix, iz);
                    computeNormal(hf, ix, iz, normalScratch);
                    orientUV(localX / TERRAIN_CELLS_PER_TILE, localZ / TERRAIN_CELLS_PER_TILE, quarterTurns, flipU, flipV, uvScratch);
                    vertices.push(
                        ix * TERRAIN_CELL_SPACING, height, iz * TERRAIN_CELL_SPACING,
                        normalScratch[0], normalScratch[1], normalScratch[2],
                        uvScratch[0], uvScratch[1],
                    );
                }
            }
            for (let localX = 0; localX < TERRAIN_CELLS_PER_TILE; localX++) {
                for (let localZ = 0; localZ < TERRAIN_CELLS_PER_TILE; localZ++) {
                    const v00 = firstVertex + localX * VERTS_PER_TILE_EDGE + localZ;
                    const v10 = firstVertex + (localX + 1) * VERTS_PER_TILE_EDGE + localZ;
                    const v01 = firstVertex + localX * VERTS_PER_TILE_EDGE + (localZ + 1);
                    const v11 = firstVertex + (localX + 1) * VERTS_PER_TILE_EDGE + (localZ + 1);
                    // Reversed from the natural v00, v10, v11 to match the CW front-face convention
                    // the `.ian` meshes use, so culling drops the underside rather than the top.
                    indices.push(v00, v11, v10, v00, v01, v11);
                }
            }
        }
    }

    const meshes: TerrainMesh[] = [];
    for (let t = 0; t < TERRAIN_MAX_TEXTURES; t++) {
        if (indicesByTexture[t].length === 0) {
            continue;
        }
        meshes.push({
            textureIndex: t,
            vertices: new Float32Array(verticesByTexture[t]),
            indices: new Uint32Array(indicesByTexture[t]),
        });
    }
    return meshes;
}

/**
 * Builds a flat plane over every tile flagged as water, one quad per tile, with the texture tiled
 * once per heightfield cell.
 *
 * @param cellFlags Raw `city2tc.bin`, 128*128 little-endian int16.
 * @param waterLevel World Y of the surface, from the ODL `water` directive.
 * @returns The water mesh, or `undefined` when the level has no water tiles.
 */
export function buildWaterMesh(cellFlags: ArrayBufferSlice, waterLevel: number): TerrainMesh | undefined {
    const tiles = cellFlags.createTypedArray(Int16Array, 0, TERRAIN_TILE_GRID * TERRAIN_TILE_GRID);
    const vertices: number[] = [];
    const indices: number[] = [];
    const tileWorldSize = TERRAIN_CELLS_PER_TILE * TERRAIN_CELL_SPACING;

    for (let tileX = 0; tileX < TERRAIN_TILE_GRID; tileX++) {
        for (let tileZ = 0; tileZ < TERRAIN_TILE_GRID; tileZ++) {
            if ((tiles[tileX * TERRAIN_TILE_GRID + tileZ] & TILE_FLAG_WATER) === 0) {
                continue;
            }
            const x0 = tileX * tileWorldSize, x1 = x0 + tileWorldSize;
            const z0 = tileZ * tileWorldSize, z1 = z0 + tileWorldSize;
            const u0 = x0 / TERRAIN_CELL_SPACING, u1 = x1 / TERRAIN_CELL_SPACING;
            const v0 = z0 / TERRAIN_CELL_SPACING, v1 = z1 / TERRAIN_CELL_SPACING;
            const firstVertex = vertices.length / IAN_VERTEX_FLOATS;
            vertices.push(
                x0, waterLevel, z0, 0, INCOMING_UP_Y, 0, u0, v0,
                x1, waterLevel, z0, 0, INCOMING_UP_Y, 0, u1, v0,
                x1, waterLevel, z1, 0, INCOMING_UP_Y, 0, u1, v1,
                x0, waterLevel, z1, 0, INCOMING_UP_Y, 0, u0, v1,
            );
            indices.push(firstVertex, firstVertex + 1, firstVertex + 2, firstVertex, firstVertex + 2, firstVertex + 3);
        }
    }
    if (indices.length === 0) {
        return undefined;
    }
    return { textureIndex: 0, vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
