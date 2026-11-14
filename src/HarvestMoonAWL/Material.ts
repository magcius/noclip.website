// Determines which atlas image a mesh draws with

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DecodedMesh, DrawPart, GplBlock, drawParts, walkBlockTable } from "./Gpl.js";

//#region Static materials

export const UNTEXTURED_IMAGE = -1;

export interface StaticMaterial {
    imageByBlock: Map<number, number>;
}

export function staticMaterialForMapobj(data: ArrayBufferSlice): StaticMaterial {
    const { blocks, view } = walkBlockTable(data);
    const imageByBlock = new Map<number, number>();
    for (const block of blocks) {
        const first = drawParts(view, block).find((p) => p.textureIndex !== null);
        if (first !== undefined)
            imageByBlock.set(block.index, first.textureIndex!);
    }
    return { imageByBlock };
}

export function staticMaterialForGroundTile(data: ArrayBufferSlice): { image: number } | null {
    let blocks, view;
    try {
        ({ blocks, view } = walkBlockTable(data));
    } catch (e) {
        return null;
    }
    if (blocks.length === 0)
        return null;
    const first = drawParts(view, blocks[0]).find((p) => p.textureIndex !== null);
    return first !== undefined ? { image: first.textureIndex! } : null;
}

//#endregion

//#region Per-triangle image lookup

function imageIndexByTriangleGeneric(mesh: DecodedMesh, fallback: number | null): (number | null)[] {
    const parts: DrawPart[] | undefined = mesh.parts;
    const trianglePart = mesh.trianglePart;
    if (parts === undefined || trianglePart === undefined)
        return mesh.triangleOffsets.map(() => fallback);
    return trianglePart.map((partIdx) => {
        const part = parts[partIdx];
        if (!part.textured)
            return UNTEXTURED_IMAGE;
        return part.textureIndex !== null ? part.textureIndex : fallback;
    });
}

export function imageIndexByTriangle(mesh: DecodedMesh, block: GplBlock, mat: StaticMaterial): (number | null)[] {
    return imageIndexByTriangleGeneric(mesh, mat.imageByBlock.get(block.index) ?? null);
}

export function imageIndexByTriangleForTile(mesh: DecodedMesh, tileMat: { image: number }): (number | null)[] {
    return imageIndexByTriangleGeneric(mesh, tileMat.image);
}

export function imageIndexByTriangleForRoom(mesh: DecodedMesh): (number | null)[] {
    return imageIndexByTriangleGeneric(mesh, null);
}

//#endregion
