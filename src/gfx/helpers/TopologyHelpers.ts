
export const enum GfxTopology {
    TRIANGLES, TRISTRIP, QUADS, QUADSTRIP,
};

export function convertToTriangleIndexBuffer(topology: GfxTopology, indexBuffer: Uint16Array): Uint16Array {
    if (topology === GfxTopology.TRIANGLES)
        return indexBuffer;

    const newSize = getTriangleIndexCountForTopologyIndexCount(topology, indexBuffer.length);
    const newBuffer = new Uint16Array(newSize);

    if (topology === GfxTopology.QUADS) {
        let dst = 0;
        for (let i = 0; i < indexBuffer.length; i += 4) {
            newBuffer[dst++] = indexBuffer[i + 0];
            newBuffer[dst++] = indexBuffer[i + 1];
            newBuffer[dst++] = indexBuffer[i + 2];
            newBuffer[dst++] = indexBuffer[i + 2];
            newBuffer[dst++] = indexBuffer[i + 3];
            newBuffer[dst++] = indexBuffer[i + 0];
        }
    } else if (topology === GfxTopology.TRISTRIP) {
        let dst = 0;
        for (let i = 0; i < indexBuffer.length - 2; i++) {
            if (i % 2 === 0) {
                newBuffer[dst++] = indexBuffer[i + 0];
                newBuffer[dst++] = indexBuffer[i + 1];
                newBuffer[dst++] = indexBuffer[i + 2];
            } else {
                newBuffer[dst++] = indexBuffer[i + 1];
                newBuffer[dst++] = indexBuffer[i + 0];
                newBuffer[dst++] = indexBuffer[i + 2];
            }
        }
    } else if (topology === GfxTopology.QUADSTRIP) {
        let dst = 0;
        for (let i = 0; i < indexBuffer.length - 2; i += 2) {
            newBuffer[dst++] = indexBuffer[i + 0];
            newBuffer[dst++] = indexBuffer[i + 1];
            newBuffer[dst++] = indexBuffer[i + 2];
            newBuffer[dst++] = indexBuffer[i + 2];
            newBuffer[dst++] = indexBuffer[i + 1];
            newBuffer[dst++] = indexBuffer[i + 3];
        }
    }

    return newBuffer;
}

function range(start: number, length: number): Uint16Array {
    const r = new Uint16Array(length);
    for (let i = 0; i < length; i++)
        r[i] = start + i;
    return r;
}

export function makeTriangleIndexBuffer(topology: GfxTopology, baseVertex: number, numVertices: number): Uint16Array {
    return convertToTriangleIndexBuffer(topology, range(baseVertex, numVertices));
}

export function getTriangleCountForTopologyIndexCount(topology: GfxTopology, indexCount: number): number {
    switch (topology) {
    case GfxTopology.TRIANGLES:
        // One triangle per every three indexes.
        return indexCount / 3;
    case GfxTopology.TRISTRIP:
        // One triangle per index, minus the first two.
        return (indexCount - 2);
    case GfxTopology.QUADS:
        // Two triangles per four indices.
        return 2 * (indexCount / 4);
    case GfxTopology.QUADSTRIP:
        // Two triangles per two indexes, minus the first two.
        return 2 * (indexCount - 2);
    }
}

export function getTriangleIndexCountForTopologyIndexCount(topology: GfxTopology, indexCount: number): number {
    // Three indexes per triangle.
    return 3 * getTriangleCountForTopologyIndexCount(topology, indexCount);
}
