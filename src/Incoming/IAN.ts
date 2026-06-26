// Parser for Incoming (1998, Rage Software) ".ian" model files.
//
// File structure (all little-endian):
//   RawModelGeometry header (100 bytes):
//     +0x00 u32           reserved
//     +0x04 u32           reserved
//     +0x08 u32           reserved
//     +0x0C float         flBoundRadius (ignored)
//     +0x10 u32           faceFlags (bits 1/2/3 = mirror X/Y/Z)
//     +0x14 ModelLodEntry aLods[4]  (20 bytes each)
//
//   ModelLodEntry (20 bytes):
//     +0x00 u32  faceCount    (triangle count, low 16 bits)
//     +0x04 u16  vertexCount
//     +0x06 u16  textureId     (stamped at load from the ODL color-key)
//     +0x08 u32  pVertices     (file-relative offset to MeshVertex[])
//     +0x0C u32  pFaceData     (file-relative offset to MeshFaceRecord[])
//     +0x10 u32  reserved
//
//   MeshVertex (32 bytes): 8 float32 = posX,posY,posZ, normX,normY,normZ, u, v
//
//   MeshFaceRecord (28 bytes): u16 tag, u16 flags (bit 0x4 = two-sided),
//     then 3 face-vertex slots of 8 bytes each = { u16 vertexIndex; u8[6] aux }.
import ArrayBufferSlice from "../ArrayBufferSlice.js";

/**The size in bytes of the {@link IANModel} header (`RawModelGeometry`). */
const IAN_HEADER_SIZE = 0x14;
/** The stride in bytes of a single `MeshVertex` record inside an `.ian` file. */
const IAN_VERTEX_STRIDE = 0x20;
/** The stride in bytes of a single `MeshFaceRecord` (one triangle) inside an `.ian` file. */
const IAN_FACE_STRIDE = 0x1c;
/** Face flag bit indicating a triangle is two-sided. */
export const IAN_FACE_FLAG_TWO_SIDED = 0x4;
/**
 * A fully decoded Incoming `.ian` model: a single mesh node of position/normal/uv vertices plus a
 * triangle list, ready to be uploaded to the GPU. Note that positions are in object space and have
 * not yet been multiplied by the object's scale.
 */
export interface IANModel {
    /** Human-readable node name embedded in the file (e.g. `"Line01"`), for debugging. */
    readonly name: string;
    /** Interleaved vertex data, 8 float32 per vertex: posX, posY, posZ, normX, normY, normZ, u, v. */
    readonly vertices: Float32Array;
    /** Number of vertices in {@link vertices}. */
    readonly vertexCount: number;
    /** Triangle index list (3 indices per triangle) referencing {@link vertices}. */
    readonly indices: Uint32Array;
    /** Per-triangle flags (one entry per triangle); bit {@link IAN_FACE_FLAG_TWO_SIDED} = two-sided. */
    readonly faceFlags: Uint16Array;
    /** Number of triangles. */
    readonly triangleCount: number;
}
/**
 * The number of float32 components per interleaved vertex emitted by {@link parseIAN}
 * (posX, posY, posZ, normX, normY, normZ, u, v).
 */
export const IAN_VERTEX_FLOATS = 8;
/**
 * Parses an Incoming `.ian` model file into an {@link IANModel}. Only the highest-detail geometry
 * (`aLods[0]`) is read.
 * @param buffer The raw bytes of the `.ian` file.
 * @returns The decoded model.
 */
export function parseIAN(buffer: ArrayBufferSlice): IANModel {
    const view = buffer.createDataView();
    // RawModelGeometry header: aLods[0] begins at 0x14.
    const lodFaceCount = view.getUint32(IAN_HEADER_SIZE + 0x00, true) & 0xffff;
    const vertexCount = view.getUint16(IAN_HEADER_SIZE + 0x04, true);
    const pVertices = view.getUint32(IAN_HEADER_SIZE + 0x08, true);
    const pFaceData = view.getUint32(IAN_HEADER_SIZE + 0x0c, true);
    // The node name is the NUL-terminated string sitting just before the face data.
    const name = readNodeName(view, pFaceData);
    // Vertices: 8 float32 each, copied verbatim (object-space pos, normal, uv).
    const vertices = new Float32Array(vertexCount * IAN_VERTEX_FLOATS);
    for (let i = 0; i < vertexCount; i++) {
        const src = pVertices + i * IAN_VERTEX_STRIDE;
        const dst = i * IAN_VERTEX_FLOATS;
        for (let c = 0; c < IAN_VERTEX_FLOATS; c++) {
            vertices[dst + c] = view.getFloat32(src + c * 0x04, true);
        }
    }
    // Faces: each record is one triangle; the three vertex indices live at +0x04/+0x0C/+0x14.
    const indices = new Uint32Array(lodFaceCount * 3);
    const faceFlags = new Uint16Array(lodFaceCount);
    for (let i = 0; i < lodFaceCount; i++) {
        const src = pFaceData + i * IAN_FACE_STRIDE;
        faceFlags[i] = view.getUint16(src + 0x02, true);
        indices[i * 3 + 0] = view.getUint16(src + 0x04, true);
        indices[i * 3 + 1] = view.getUint16(src + 0x0c, true);
        indices[i * 3 + 2] = view.getUint16(src + 0x14, true);
    }
    return { name, vertices, vertexCount, indices, faceFlags, triangleCount: lodFaceCount };
}

function readNodeName(view: DataView, faceDataOffset: number): string {
    // Iterate from end to find the start of the string.
    let end = faceDataOffset;
    while (end > 0 && view.getUint8(end - 1) === 0) {
        end--;
    }
    let start = end;
    while (start > 0) {
        const b = view.getUint8(start - 1);
        // Only ASCII is accepted.
        if (b < 0x20 || b > 0x7e) {
            break;
        }
        start--;
    }
    let s = "";
    for (let i = start; i < end; i++) {
        s += String.fromCharCode(view.getUint8(i));
    }
    return s;
}
