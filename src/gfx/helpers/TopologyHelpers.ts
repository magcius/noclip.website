
import { assert } from "../platform/GfxPlatformUtil.js";

export enum GfxTopology {
    Triangles, TriStrips, TriFans, Quads,
};

export function convertToTriangles(dstBuffer: Uint16Array | Uint32Array, dstOffs: number, topology: GfxTopology, indexBuffer: Uint16Array | Uint32Array, baseVertex: number = 0): number {
    assert(dstOffs + getTriangleIndexCountForTopologyIndexCount(topology, indexBuffer.length) <= dstBuffer.length);

    let dst = dstOffs;
    if (topology === GfxTopology.Quads) {
        for (let i = 0; i < indexBuffer.length; i += 4) {
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 0];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 1];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 2];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 0];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 2];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 3];
        }
    } else if (topology === GfxTopology.TriStrips) {
        for (let i = 2; i < indexBuffer.length; i++) {
            dstBuffer[dst++] = baseVertex + indexBuffer[i - 2];
            dstBuffer[dst++] = baseVertex + indexBuffer[i - (~i & 1)];
            dstBuffer[dst++] = baseVertex + indexBuffer[i - (i & 1)];
        }
    } else if (topology === GfxTopology.TriFans) {
        for (let i = 0; i < indexBuffer.length - 2; i++) {
            dstBuffer[dst++] = baseVertex + indexBuffer[0];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 1];
            dstBuffer[dst++] = baseVertex + indexBuffer[i + 2];
        }
    } else if (topology === GfxTopology.Triangles) {
        dstBuffer.set(indexBuffer, dstOffs);
    }
    return dst - dstOffs;
}

export function convertToTrianglesRange(dstBuffer: Uint16Array | Uint32Array | number[], dstOffs: number, topology: GfxTopology, baseVertex: number, numVertices: number): number {
    assert(dstOffs + getTriangleIndexCountForTopologyIndexCount(topology, numVertices) <= dstBuffer.length);

    let dst = dstOffs;
    if (topology === GfxTopology.Quads) {
        for (let i = 0; i < numVertices; i += 4) {
            dstBuffer[dst++] = baseVertex + i + 0;
            dstBuffer[dst++] = baseVertex + i + 1;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 0;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 3;
        }
    } else if (topology === GfxTopology.TriStrips) {
        for (let i = 2; i < numVertices; i++) {
            dstBuffer[dst++] = baseVertex + i - 2;
            dstBuffer[dst++] = baseVertex + i - (~i & 1);
            dstBuffer[dst++] = baseVertex + i - (i & 1);
        }
    } else if (topology === GfxTopology.TriFans) {
        for (let i = 2; i < numVertices; i++) {
            dstBuffer[dst++] = baseVertex;
            dstBuffer[dst++] = baseVertex + i - 1;
            dstBuffer[dst++] = baseVertex + i;
        }
    } else if (topology === GfxTopology.Triangles) {
        for (let i = 0; i < numVertices; i++)
            dstBuffer[dst++] = baseVertex + i;
    }
    return dst - dstOffs;
}

export function convertToTriangleIndexBuffer(topology: GfxTopology, indexBuffer: Uint16Array): Uint16Array {
    if (topology === GfxTopology.Triangles)
        return indexBuffer;
    const newSize = getTriangleIndexCountForTopologyIndexCount(topology, indexBuffer.length);
    const newBuffer = new Uint16Array(newSize);
    convertToTriangles(newBuffer, 0, topology, indexBuffer);
    return newBuffer;
}

export function makeTriangleIndexBuffer(topology: GfxTopology, baseVertex: number, numVertices: number): Uint16Array {
    const newSize = getTriangleIndexCountForTopologyIndexCount(topology, numVertices);
    const newBuffer = new Uint16Array(newSize);
    convertToTrianglesRange(newBuffer, 0, topology, baseVertex, numVertices);
    return newBuffer;
}

export function getTriangleCountForTopologyIndexCount(topology: GfxTopology, indexCount: number): number {
    switch (topology) {
    case GfxTopology.Triangles:
        // One triangle per every three indexes.
        return indexCount / 3;
    case GfxTopology.TriStrips:
    case GfxTopology.TriFans:
        // One triangle per index, minus the first two.
        return (indexCount - 2);
    case GfxTopology.Quads:
        // Two triangles per four indices.
        return 2 * (indexCount / 4);
    }
}

export function getTriangleIndexCountForTopologyIndexCount(topology: GfxTopology, indexCount: number): number {
    // Three indexes per triangle.
    return 3 * getTriangleCountForTopologyIndexCount(topology, indexCount);
}

export function filterDegenerateTriangleIndexBuffer(indexData: Uint16Array): Uint16Array {
    assert(indexData.length % 3 === 0);
    const dst = new Uint16Array(indexData.length);
    let dstIdx = 0;

    for (let i = 0; i < indexData.length; i += 3) {
        const i0 = indexData[i + 0];
        const i1 = indexData[i + 1];
        const i2 = indexData[i + 2];

        const isDegenerate = (i0 === i1) || (i1 === i2) || (i2 === i0);
        if (!isDegenerate) {
            dst[dstIdx++] = i0;
            dst[dstIdx++] = i1;
            dst[dstIdx++] = i2;
        }
    }

    return dst.slice(0, dstIdx);
}
