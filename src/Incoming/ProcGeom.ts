
// Procedural mesh generation for Incoming `sphere` / `hemisphere` type geometry.
//
// Some object types define their mesh procedurally instead of via an `.ian` `objfile`: an energy
// sphere/shield (`sphere rad=R width=W height=H`) or a dome shield/canopy (`hemisphere rad=R
// width=W height=H repeat=U V`). The engine stores the parameters (OdlCmdSphere @0x405130,
// OdlCmdHemisphere @0x4051d0) and tessellates a surface of revolution at instancing time; this
// reproduces that mesh. `width` is the number of longitude segments, `height` the number of
// latitude segments (apex→rim for a hemisphere, pole→pole for a sphere). Output matches the
// engine model vertex layout consumed by {@link IncomingMeshData}: 8 float32 per vertex
// (position3, normal3, uv2), with a 32-bit triangle index list.

/** A generated mesh: interleaved vertices (pos3, norm3, uv2) and a triangle index list. */
export interface ProcMesh {
    /** Interleaved vertex data, 8 float32 per vertex (position3, normal3, uv2). */
    readonly vertices: Float32Array;
    /** Triangle indices (3 per triangle). */
    readonly indices: Uint32Array;
}

/**
 * Builds a surface of revolution about the +Y axis, sweeping latitude angle θ from 0 (apex, +Y)
 * to `thetaMax` and longitude φ over a full turn. Vertices carry outward normals and UVs scaled by
 * the texture-repeat factors. Shared by {@link buildSphereMesh} (θ∈[0,π]) and
 * {@link buildHemisphereMesh} (θ∈[0,π/2]).
 *
 * @param radius Surface radius.
 * @param width Longitude segments (≥3).
 * @param height Latitude segments (≥1).
 * @param thetaMax Maximum latitude angle (π for a full sphere, π/2 for a hemisphere dome).
 * @param repeatU Texture tiling around the longitude.
 * @param repeatV Texture tiling along the latitude.
 * @returns The generated mesh.
 */
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
 * Builds a full UV-sphere mesh (an energy sphere / planet), centered at the origin.
 *
 * @param radius Sphere radius (`rad=`).
 * @param width Longitude segments (`width=`).
 * @param height Latitude segments (`height=`).
 * @returns The generated sphere mesh.
 */
export function buildSphereMesh(radius: number, width: number, height: number): ProcMesh {
    return buildSurfaceOfRevolution(radius, Math.max(3, width | 0), Math.max(2, height | 0), Math.PI, 1, 1);
}

/**
 * Builds a hemisphere dome mesh (an energy shield / canopy), centered at the origin with its apex
 * at +Y (the same up convention as the `.ian` model meshes, so it renders upright when placed).
 *
 * @param radius Dome radius (`rad=`).
 * @param width Longitude segments (`width=`).
 * @param height Latitude segments (`height=`).
 * @param repeatU Texture tiling around the longitude (`repeat=` first value).
 * @param repeatV Texture tiling apex→rim (`repeat=` second value).
 * @returns The generated hemisphere mesh.
 */
export function buildHemisphereMesh(radius: number, width: number, height: number, repeatU: number, repeatV: number): ProcMesh {
    return buildSurfaceOfRevolution(radius, Math.max(3, width | 0), Math.max(1, height | 0), Math.PI / 2, repeatU || 1, repeatV || 1);
}
