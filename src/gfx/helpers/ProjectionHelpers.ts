
import { mat4 } from "gl-matrix";
import { GfxClipSpaceNearZ } from "../platform/GfxPlatform";

const mtxOpenGLFromD3D = mat4.fromValues(
    1, 0,  0, 0,
    0, 1,  0, 0,
    0, 0,  2, 0,
    0, 0, -1, 1,
);

// Converts a projection matrix from D3D-style Z range [0, 1] to OpenGL-style Z range [-1, 1]
export function projectionMatrixOpenGLFromD3D(m: mat4): void {
    mat4.mul(m, mtxOpenGLFromD3D, m);
}

const mtxD3DFromOpenGL = mat4.fromValues(
    1, 0,   0, 0,
    0, 1,   0, 0,
    0, 0, 0.5, 0,
    0, 0, 0.5, 1,
);

// Converts a projection matrix from OpenGL-style Z range [-1, 1] to D3D-style Z range [0, 1]
export function projectionMatrixD3DFromOpenGL(m: mat4): void {
    mat4.mul(m, mtxD3DFromOpenGL, m);
}

export function projectionMatrixConvertClipSpaceNearZ(m: mat4, dst: GfxClipSpaceNearZ, src: GfxClipSpaceNearZ): void {
    if (dst === src)
        return;

    if (dst === GfxClipSpaceNearZ.NegativeOne)
        projectionMatrixOpenGLFromD3D(m);
    else if (dst === GfxClipSpaceNearZ.Zero)
        projectionMatrixD3DFromOpenGL(m);
}
