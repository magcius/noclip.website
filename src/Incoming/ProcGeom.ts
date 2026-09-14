
// Some object types tessellate their mesh instead of loading an `.ian`: `sphere rad=R width=W
// height=H` and `hemisphere rad=R width=W height=H repeat=U V`. Despite the names, `width` and
// `height` are longitude and latitude segment counts, not dimensions.

/** A tessellated mesh in the same vertex layout as the `.ian` models. */
export interface ProcMesh {
    /** Interleaved, 8 float32 per vertex: position3, normal3, uv2. */
    readonly vertices: Float32Array;
    /** Triangle list, 3 indices each. */
    readonly indices: Uint32Array;
}

function buildSurfaceOfRevolution(radius: number, width: number, height: number, thetaMax: number, repeatU: number, repeatV: number): ProcMesh {
    const cols = width + 1;
    const rows = height + 1;
    const vertices = new Float32Array(rows * cols * 8);
    let o = 0;
    for (let i = 0; i < rows; i++) {
        const theta = thetaMax * (i / height);
        const sinT = Math.sin(theta), cosT = Math.cos(theta);
        for (let j = 0; j < cols; j++) {
            const phi = 2 * Math.PI * (j / width);
            const nx = sinT * Math.cos(phi), ny = cosT, nz = sinT * Math.sin(phi);
            vertices[o++] = radius * nx; vertices[o++] = radius * ny; vertices[o++] = radius * nz;
            vertices[o++] = nx; vertices[o++] = ny; vertices[o++] = nz;
            vertices[o++] = (j / width) * repeatU; vertices[o++] = (i / height) * repeatV;
        }
    }

    const indices = new Uint32Array(width * height * 6);
    let k = 0;
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            indices[k++] = a; indices[k++] = c; indices[k++] = b;
            indices[k++] = b; indices[k++] = c; indices[k++] = d;
        }
    }
    return { vertices, indices };
}

/**
 * Full UV sphere centered on the origin.
 *
 * @param radius `rad=`.
 * @param width Longitude segments, `width=`.
 * @param height Latitude segments, `height=`.
 * @returns The tessellated sphere.
 */
export function buildSphereMesh(radius: number, width: number, height: number): ProcMesh {
    return buildSurfaceOfRevolution(radius, Math.max(3, width | 0), Math.max(2, height | 0), Math.PI, 1, 1);
}

/**
 * Dome centered on the origin. Its apex points at +Y, matching the `.ian` up convention, so it
 * stands upright when placed.
 *
 * @param radius `rad=`.
 * @param width Longitude segments, `width=`.
 * @param height Latitude segments, `height=`.
 * @param repeatU Texture tiling around the longitude, first value of `repeat=`.
 * @param repeatV Texture tiling apex to rim, second value of `repeat=`.
 * @returns The tessellated dome.
 */
export function buildHemisphereMesh(radius: number, width: number, height: number, repeatU: number, repeatV: number): ProcMesh {
    return buildSurfaceOfRevolution(radius, Math.max(3, width | 0), Math.max(1, height | 0), Math.PI / 2, repeatU || 1, repeatV || 1);
}
