
import { mat4 } from "gl-matrix";

const scratchMatrix = mat4.create();
export function projectionMatrixOpenGLFromD3D(m: mat4): void {
    // Converts a projection matrix from D3D-style Z range [0, 1] to OpenGL-style Z range [-1, 1]
    mat4.set(scratchMatrix,
        1, 0,  0, 0,
        0, 1,  0, 0,
        0, 0,  2, 0,
        0, 0, -1, 1,
    );
    mat4.mul(m, m, scratchMatrix);
}

export function projectionMatrixD3DFromOpenGL(m: mat4): void {
    // Converts a projection matrix from OpenGL-style Z range [-1, 1] to D3D-style Z range [0, 1]
    mat4.set(scratchMatrix,
        1, 0,  0,   0,
        0, 1,  0,   0,
        0, 0,  0.5, 0,
        0, 0,  1,   1,
    );
    mat4.mul(m, m, scratchMatrix);
}
