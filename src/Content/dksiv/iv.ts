 
import { Color, colorNewFromRGBA } from "../../Color";
import { NamedArrayBufferSlice } from "../../DataFetcher";

// Parser for the .iv file used by the Dark Souls Model Viewer
// Presumably made by vlad001 from the Havok physics data shipped in the game.

export interface Chunk {
    indexData: Uint16Array;
    positionData: Float32Array;
}

export interface IV {
    name: string;
    color: Color;
    chunks: Chunk[];
}

export function parseIV(buffer: NamedArrayBufferSlice): IV {
    const view = buffer.createDataView();
    const name = buffer.name.split('/').pop()!;

    const numChunks = view.getUint32(0x00, true);
    const r = view.getFloat32(0x04, true);
    const g = view.getFloat32(0x08, true);
    const b = view.getFloat32(0x0C, true);
    const color = colorNewFromRGBA(r, g, b);

    const chunks: Chunk[] = [];
    let chunkTableIdx = 0x10;
    for (let i = 0; i < numChunks; i++) {
        const idxDataOffs = view.getUint32(chunkTableIdx + 0x00, true);
        const idxDataCount = view.getUint32(chunkTableIdx + 0x04, true);
        const posDataOffs = view.getUint32(chunkTableIdx + 0x08, true);
        const posDataCount = view.getUint32(chunkTableIdx + 0x0C, true);

        const indexData = buffer.createTypedArray(Uint16Array, idxDataOffs, idxDataCount);
        const positionData = buffer.createTypedArray(Float32Array, posDataOffs, posDataCount * 3);

        chunks.push({ indexData, positionData });
        chunkTableIdx += 0x10;
    }

    return { name, color, chunks };
}
