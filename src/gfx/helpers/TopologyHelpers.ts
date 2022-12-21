
import { assert } from "../platform/GfxPlatformUtil";

export const enum GfxTopology {
    Triangles, TriStrips, TriFans, Quads, QuadStrips,
};

export function convertToTriangles(dstBuffer: Uint16Array | Uint32Array, dstOffs: number, topology: GfxTopology, indexBuffer: Uint16Array | Uint32Array): void {
    assert(dstOffs + getTriangleIndexCountForTopologyIndexCount(topology, indexBuffer.length) <= dstBuffer.length);

    let dst = dstOffs;
    if (topology === GfxTopology.Quads) {
        for (let i = 0; i < indexBuffer.length; i += 4) {
            dstBuffer[dst++] = indexBuffer[i + 0];
            dstBuffer[dst++] = indexBuffer[i + 1];
            dstBuffer[dst++] = indexBuffer[i + 2];
            dstBuffer[dst++] = indexBuffer[i + 0];
            dstBuffer[dst++] = indexBuffer[i + 2];
            dstBuffer[dst++] = indexBuffer[i + 3];
        }
    } else if (topology === GfxTopology.TriStrips) {
        for (let i = 0; i < indexBuffer.length - 2; i++) {
            if (i % 2 === 0) {
                dstBuffer[dst++] = indexBuffer[i + 0];
                dstBuffer[dst++] = indexBuffer[i + 1];
                dstBuffer[dst++] = indexBuffer[i + 2];
            } else {
                dstBuffer[dst++] = indexBuffer[i + 1];
                dstBuffer[dst++] = indexBuffer[i + 0];
                dstBuffer[dst++] = indexBuffer[i + 2];
            }
        }
    } else if (topology === GfxTopology.TriFans) {
        for (let i = 0; i < indexBuffer.length - 2; i++) {
            dstBuffer[dst++] = indexBuffer[0];
            dstBuffer[dst++] = indexBuffer[i + 1];
            dstBuffer[dst++] = indexBuffer[i + 2];
        }
    } else if (topology === GfxTopology.QuadStrips) {
        for (let i = 0; i < indexBuffer.length - 2; i += 2) {
            dstBuffer[dst++] = indexBuffer[i + 0];
            dstBuffer[dst++] = indexBuffer[i + 1];
            dstBuffer[dst++] = indexBuffer[i + 2];
            dstBuffer[dst++] = indexBuffer[i + 2];
            dstBuffer[dst++] = indexBuffer[i + 1];
            dstBuffer[dst++] = indexBuffer[i + 3];
        }
    } else if (topology === GfxTopology.Triangles) {
        dstBuffer.set(indexBuffer, dstOffs);
    }
}

export function convertToTrianglesRange(dstBuffer: Uint16Array | Uint32Array | number[], dstOffs: number, topology: GfxTopology, baseVertex: number, numVertices: number): void {
    assert(dstOffs + getTriangleIndexCountForTopologyIndexCount(topology, numVertices) <= dstBuffer.length);

    let dst = dstOffs;
    if (topology === GfxTopology.Quads) {
        for (let i = 0; i < numVertices; i += 4) {
            dstBuffer[dst++] = baseVertex + i + 0;
            dstBuffer[dst++] = baseVertex + i + 1;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 3;
            dstBuffer[dst++] = baseVertex + i + 0;
        }
    } else if (topology === GfxTopology.TriStrips) {
        for (let i = 0; i < numVertices - 2; i++) {
            if (i % 2 === 0) {
                dstBuffer[dst++] = baseVertex + i + 0;
                dstBuffer[dst++] = baseVertex + i + 1;
                dstBuffer[dst++] = baseVertex + i + 2;
            } else {
                dstBuffer[dst++] = baseVertex + i + 1;
                dstBuffer[dst++] = baseVertex + i + 0;
                dstBuffer[dst++] = baseVertex + i + 2;
            }
        }
    } else if (topology === GfxTopology.TriFans) {
        for (let i = 0; i < numVertices - 2; i++) {
            dstBuffer[dst++] = baseVertex + 0;
            dstBuffer[dst++] = baseVertex + i + 1;
            dstBuffer[dst++] = baseVertex + i + 2;
        }
    } else if (topology === GfxTopology.QuadStrips) {
        for (let i = 0; i < numVertices - 2; i += 2) {
            dstBuffer[dst++] = baseVertex + i + 0;
            dstBuffer[dst++] = baseVertex + i + 1;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 2;
            dstBuffer[dst++] = baseVertex + i + 1;
            dstBuffer[dst++] = baseVertex + i + 3;
        }
    } else if (topology === GfxTopology.Triangles) {
        for (let i = 0; i < numVertices; i++)
            dstBuffer[dst++] = baseVertex + i;
    }
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
    case GfxTopology.QuadStrips:
        // Two triangles per two indexes, minus the first two.
        return (indexCount - 2);
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
