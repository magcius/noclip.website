// Parser for Incoming (1998, Rage Software) ".ian" model files. Little-endian throughout: a
// header, four LOD entries, then the vertex and face data each LOD entry points at.
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";

const FIRST_LOD_OFFSET = 0x14;
const LOD_FACE_COUNT_OFFSET = FIRST_LOD_OFFSET + 0x00;
const LOD_VERTEX_COUNT_OFFSET = FIRST_LOD_OFFSET + 0x04;
const LOD_VERTEX_DATA_OFFSET = FIRST_LOD_OFFSET + 0x08;
const LOD_FACE_DATA_OFFSET = FIRST_LOD_OFFSET + 0x0c;
const FACE_COUNT_MASK = 0xffff;

const VERTEX_RECORD_STRIDE = 0x20;
const FLOAT32_SIZE = 0x04;

const FACE_RECORD_STRIDE = 0x1c;
const FACE_VERTEX_SLOT_OFFSET = 0x04;
const FACE_VERTEX_SLOT_STRIDE = 0x08;
const VERTICES_PER_FACE = 3;

const ASCII_PRINTABLE_MIN = 0x20;
const ASCII_PRINTABLE_MAX = 0x7e;

/** Float32 components per interleaved vertex: posX, posY, posZ, normX, normY, normZ, u, v. */
export const IAN_VERTEX_FLOATS = 8;

/** A decoded `.ian` model. Positions are object space and not yet scaled by the object's scale. */
export interface IANModel {
    /** Node name embedded in the file, such as `"Line01"`. */
    readonly name: string;
    /** Interleaved vertex data, {@link IAN_VERTEX_FLOATS} float32 per vertex. */
    readonly vertices: Float32Array;
    /** Triangle list, 3 indices each, into {@link vertices}. */
    readonly indices: Uint32Array;
}

/**
 * Parses an `.ian` file. Only the first LOD, the highest-detail geometry, is read.
 *
 * @param buffer Raw bytes of the file.
 * @returns The decoded model.
 */
export function parseIAN(buffer: ArrayBufferSlice): IANModel {
    const view = buffer.createDataView();
    const triangleCount = view.getUint32(LOD_FACE_COUNT_OFFSET, true) & FACE_COUNT_MASK;
    const vertexCount = view.getUint16(LOD_VERTEX_COUNT_OFFSET, true);
    const vertexDataOffset = view.getUint32(LOD_VERTEX_DATA_OFFSET, true);
    const faceDataOffset = view.getUint32(LOD_FACE_DATA_OFFSET, true);
    const name = readNodeName(buffer, faceDataOffset);

    const vertices = new Float32Array(vertexCount * IAN_VERTEX_FLOATS);
    for (let i = 0; i < vertexCount; i++) {
        const record = vertexDataOffset + i * VERTEX_RECORD_STRIDE;
        const writeAt = i * IAN_VERTEX_FLOATS;
        for (let c = 0; c < IAN_VERTEX_FLOATS; c++) {
            vertices[writeAt + c] = view.getFloat32(record + c * FLOAT32_SIZE, true);
        }
    }

    const indices = new Uint32Array(triangleCount * VERTICES_PER_FACE);
    for (let i = 0; i < triangleCount; i++) {
        const record = faceDataOffset + i * FACE_RECORD_STRIDE;
        for (let v = 0; v < VERTICES_PER_FACE; v++) {
            const slot = record + FACE_VERTEX_SLOT_OFFSET + v * FACE_VERTEX_SLOT_STRIDE;
            indices[i * VERTICES_PER_FACE + v] = view.getUint16(slot, true);
        }
    }
    return { name, vertices, indices };
}

// The name is the NUL-terminated ASCII string sitting immediately before the face data.
function readNodeName(buffer: ArrayBufferSlice, faceDataOffset: number): string {
    const bytes = buffer.createTypedArray(Uint8Array);
    let end = faceDataOffset;
    while (end > 0 && bytes[end - 1] === 0) {
        end--;
    }
    let start = end;
    while (start > 0) {
        const ch = bytes[start - 1];
        if (ch < ASCII_PRINTABLE_MIN || ch > ASCII_PRINTABLE_MAX) {
            break;
        }
        start--;
    }
    return readString(buffer, start, end - start, false);
}
