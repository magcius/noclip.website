import ArrayBufferSlice from "../ArrayBufferSlice.js";

const PDB1_MAGIC = 0x31424450;
export const PDB1_VERSION = 1;

export const PDB1_HEADER_SIZE = 0x20;
export const PDB1_VERTEX_STRIDE = 0x18;
export const PDB1_BATCH_STRIDE = 0x10;

export const enum PerfectDarkBatchFlags {
    Translucent = 1 << 0,
    SecondaryTexture = 1 << 15,
}

export interface PerfectDarkBatch {
    firstIndex: number;
    indexCount: number;
    textureId: number;
    secondaryTextureId: number;
    flags: number;
}

export interface PerfectDarkLevel {
    vertexCount: number;
    indexCount: number;
    boundsMin: [number, number, number];
    boundsMax: [number, number, number];
    vertexData: ArrayBufferSlice;
    indexData: ArrayBufferSlice;
    batches: PerfectDarkBatch[];
}

export function parsePerfectDarkLevel(buffer: ArrayBufferSlice): PerfectDarkLevel {
    const view = buffer.createDataView();

    if (view.byteLength < PDB1_HEADER_SIZE)
        throw new Error("Perfect Dark level is smaller than the PDB1 header");
    if (view.getUint32(0x00, true) !== PDB1_MAGIC)
        throw new Error("Invalid Perfect Dark level magic");
    if (view.getUint32(0x04, true) !== PDB1_VERSION)
        throw new Error(`Unsupported Perfect Dark level version ${view.getUint32(0x04, true)}`);

    const vertexCount = view.getUint32(0x08, true);
    const indexCount = view.getUint32(0x0c, true);
    const batchCount = view.getUint32(0x10, true);
    const vertexOffset = view.getUint32(0x14, true);
    const indexOffset = view.getUint32(0x18, true);
    const batchOffset = view.getUint32(0x1c, true);
    if (vertexCount === 0)
        throw new Error("Perfect Dark level contains no vertices");

    const vertexEnd = vertexOffset + vertexCount * PDB1_VERTEX_STRIDE;
    const indexEnd = indexOffset + indexCount * 4;
    const batchEnd = batchOffset + batchCount * PDB1_BATCH_STRIDE;
    if (vertexOffset < PDB1_HEADER_SIZE || vertexEnd > view.byteLength || indexEnd > view.byteLength || batchEnd > view.byteLength)
        throw new Error("Perfect Dark level contains an out-of-range table");
    if (indexCount % 3 !== 0)
        throw new Error("Perfect Dark level index count is not a triangle list");

    const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
        const offs = vertexOffset + i * PDB1_VERTEX_STRIDE;
        for (let axis = 0; axis < 3; axis++) {
            const value = view.getFloat32(offs + axis * 4, true);
            if (!Number.isFinite(value))
                throw new Error(`Perfect Dark vertex ${i} contains a non-finite position`);
            boundsMin[axis] = Math.min(boundsMin[axis], value);
            boundsMax[axis] = Math.max(boundsMax[axis], value);
        }
    }

    for (let i = 0; i < indexCount; i++) {
        if (view.getUint32(indexOffset + i * 4, true) >= vertexCount)
            throw new Error(`Perfect Dark index ${i} references a vertex outside the vertex buffer`);
    }

    const batches: PerfectDarkBatch[] = [];
    for (let i = 0; i < batchCount; i++) {
        const offs = batchOffset + i * PDB1_BATCH_STRIDE;
        const firstIndex = view.getUint32(offs + 0x00, true);
        const batchIndexCount = view.getUint32(offs + 0x04, true);
        if (firstIndex + batchIndexCount > indexCount)
            throw new Error(`Perfect Dark batch ${i} references indices outside the index buffer`);
        if (firstIndex % 3 !== 0 || batchIndexCount % 3 !== 0)
            throw new Error(`Perfect Dark batch ${i} is not aligned to triangle boundaries`);

        const flags = view.getUint16(offs + 0x0a, true);
        batches.push({
            firstIndex,
            indexCount: batchIndexCount,
            textureId: view.getUint16(offs + 0x08, true),
            secondaryTextureId: flags & PerfectDarkBatchFlags.SecondaryTexture ? view.getUint16(offs + 0x0c, true) : 0xffff,
            flags,
        });
    }

    return {
        vertexCount,
        indexCount,
        boundsMin,
        boundsMax,
        vertexData: buffer.slice(vertexOffset, vertexEnd),
        indexData: buffer.slice(indexOffset, indexEnd),
        batches,
    };
}

export function combinePerfectDarkLevels(levels: PerfectDarkLevel[]): PerfectDarkLevel {
    if (levels.length === 0)
        throw new Error("Cannot combine an empty Perfect Dark level list");
    if (levels.length === 1)
        return levels[0];

    const vertexCount = levels.reduce((sum, level) => sum + level.vertexCount, 0);
    const indexCount = levels.reduce((sum, level) => sum + level.indexCount, 0);
    const vertexBytes = new Uint8Array(vertexCount * PDB1_VERTEX_STRIDE);
    const indices = new Uint32Array(indexCount);
    const batches: PerfectDarkBatch[] = [];
    const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let vertexBase = 0;
    let indexBase = 0;

    for (const level of levels) {
        vertexBytes.set(level.vertexData.createTypedArray(Uint8Array), vertexBase * PDB1_VERTEX_STRIDE);
        const sourceIndices = level.indexData.createTypedArray(Uint32Array);
        for (let i = 0; i < sourceIndices.length; i++)
            indices[indexBase + i] = sourceIndices[i] + vertexBase;
        for (const batch of level.batches)
            batches.push({ ...batch, firstIndex: batch.firstIndex + indexBase });
        for (let axis = 0; axis < 3; axis++) {
            boundsMin[axis] = Math.min(boundsMin[axis], level.boundsMin[axis]);
            boundsMax[axis] = Math.max(boundsMax[axis], level.boundsMax[axis]);
        }
        vertexBase += level.vertexCount;
        indexBase += level.indexCount;
    }

    return {
        vertexCount,
        indexCount,
        boundsMin,
        boundsMax,
        vertexData: ArrayBufferSlice.fromView(vertexBytes),
        indexData: ArrayBufferSlice.fromView(indices),
        batches,
    };
}
