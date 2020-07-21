import { assert } from "../../util";
import { mat4 } from "gl-matrix";

export function parseVertices(view: DataView, curPos: number, vertCount: number) {
    // (copied w/ modifications from PW64)
    const vertexData = new Float32Array(9 * vertCount);
    for (let j = 0; j < vertexData.length;) {
        // X, Y, Z
        vertexData[j++] = view.getInt16(curPos + 0x00);
        vertexData[j++] = view.getInt16(curPos + 0x02);
        vertexData[j++] = view.getInt16(curPos + 0x04);

        /* skip the next short, it seems to be an index/uid of some sort? */
        // texture coords (S and T) TODO: check format
        vertexData[j++] = (view.getInt16(curPos + 0x08) / 0x20);
        vertexData[j++] = (view.getInt16(curPos + 0x0A) / 0x20);

        // RGBA
        vertexData[j++] = view.getUint8(curPos + 0x0C) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0D) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0E) / 0xFF;
        vertexData[j++] = view.getUint8(curPos + 0x0F) / 0xFF;
        curPos += 0x10;
    }
    return { vertexData, curPos };
}

export function parseTriangles(view: DataView, curPos: number, shortCount: number, triangleCount: number) {
    // BAR stores triangles as a series of shorts (as in 2-byte units)
    // which it transforms into display list commands.
    // These commands either draw triangles or load vertices into
    // vertex memory
    // Turning them into commands and then interpreting those commands
    // would be a waste, so we just directly interpret the shorts.

    // each "vertex" is really an index into the vertex data above
    let fakeVertexMemory = new Array<number>(32);
    const indexData = new Uint16Array(3 * triangleCount);
    let indexDataIndex = 0;
    for (let j = 0; j < shortCount; j++) {
        const nextShort = view.getUint16(curPos);

        // If the highest bit is not set, we read another byte
        // and use that + the short to load new verts
        if ((nextShort & 0x8000) === 0) {
            const extraByte = view.getUint8(curPos + 2);

            // Unpack parameters
            const numVerts = 1 + (((nextShort & 0x6000) >> 10) | ((extraByte & 0xE0) >> 5));
            const destIndex = extraByte & 0x1F;
            const srcIndex = nextShort & 0x1FFF;

            // Fake copy vertices, i.e. copy indices
            for (let v = 0; v < numVerts; v++) {
                fakeVertexMemory[destIndex + v] = srcIndex + v;
            }

            curPos += 3;
        }
        else { // This is just a triangle
            // The indices here are indices into vertex memory, not into
            // the vertex data loaded above.
            let a = (nextShort & 0x7c00) >> 10;
            let b = (nextShort & 0x03e0) >> 5;
            let c = (nextShort & 0x001f) >> 0;

            indexData[indexDataIndex++] = fakeVertexMemory[a];
            indexData[indexDataIndex++] = fakeVertexMemory[b];
            indexData[indexDataIndex++] = fakeVertexMemory[c];

            curPos += 2;
        }
    }

    assert(indexData.length === triangleCount * 3);
    return { indexData, curPos };
}

export function parseMatrix(view: DataView, curPos: number) {
    const m00 = view.getFloat32(curPos + 0x00);
    const m01 = view.getFloat32(curPos + 0x04);
    const m02 = view.getFloat32(curPos + 0x08);
    const m03 = view.getFloat32(curPos + 0x0C);
    const m10 = view.getFloat32(curPos + 0x10);
    const m11 = view.getFloat32(curPos + 0x14);
    const m12 = view.getFloat32(curPos + 0x18);
    const m13 = view.getFloat32(curPos + 0x1C);
    const m20 = view.getFloat32(curPos + 0x20);
    const m21 = view.getFloat32(curPos + 0x24);
    const m22 = view.getFloat32(curPos + 0x28);
    const m23 = view.getFloat32(curPos + 0x2C);
    const m30 = view.getFloat32(curPos + 0x30);
    const m31 = view.getFloat32(curPos + 0x34);
    const m32 = view.getFloat32(curPos + 0x38);
    const m33 = view.getFloat32(curPos + 0x3C);

    const mat = mat4.fromValues(
        m00, m01, m02, m03,
        m10, m11, m12, m13,
        m20, m21, m22, m23,
        m30, m31, m32, m33
    );
    curPos += 64;
    return { mat, curPos };
}
