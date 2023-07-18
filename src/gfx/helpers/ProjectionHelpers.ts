
import { mat4 } from "gl-matrix";
import { GfxClipSpaceNearZ } from "../platform/GfxPlatform.js";

const mtxOpenGLFromD3D = mat4.fromValues(
    1, 0,  0, 0,
    0, 1,  0, 0,
    0, 0,  2, 0,
    0, 0, -1, 1,
);

// Converts a projection matrix from D3D-style Z range [0, 1] to OpenGL-style Z range [-1, 1]
function projectionMatrixOpenGLFromD3D(m: mat4): void {
    mat4.mul(m, mtxOpenGLFromD3D, m);
}

const mtxD3DFromOpenGL = mat4.fromValues(
    1, 0,   0, 0,
    0, 1,   0, 0,
    0, 0, 0.5, 0,
    0, 0, 0.5, 1,
);

// Converts a projection matrix from OpenGL-style Z range [-1, 1] to D3D-style Z range [0, 1]
function projectionMatrixD3DFromOpenGL(m: mat4): void {
    mat4.mul(m, mtxD3DFromOpenGL, m);
}

/**
 * Convert a projection matrix {@param m} between differing clip spaces.
 *
 * There are two kinds of clip-space conventions in active use in graphics APIs, differing in the
 * range of the Z axis: OpenGL (and thus GL ES and WebGL) use a Z range of [-1, 1] which matches
 * the X and Y axis ranges. Direct3D, Vulkan, Metal, and WebGPU all use a Z range of [0, 1], which
 * differs from the X and Y axis ranges, but makes sense from the perspective of a camera: a camera
 * can see to the left and right of it, above and below it, but only in front and not behind it.
 *
 * The [0, 1] convention for Z range also has better characteristics for "reversed depth". Since
 * floating point numbers have higher precision around 0 than around 1. We then get to choose where
 * to put the extra precise bits: close to the near plane, or close to the far plane.
 *
 * With OpenGL's [-1, 1] convention, both -1 and 1 have similar amounts of precision, so we don't
 * get to make the same choice, and our higher precision around 0 is stuck in the middle of the
 * scene, which doesn't particularly help.
 *
 * The gl-matrix library has two different kinds of entry points: {@method mat4.perpsective} will
 * generate a matrix with a [-1, 1] clip space, corresponding to {@see GfxClipSpaceNearZ.NegativeOne},
 * but {@method mat4.perspectiveZO} will generate a matrix with a [0, 1] clip space, corresponding
 * to {@see GfxClipSpaceNearZ.Zero}.
 *
 * This function does nothing if {@param dst} and {@param src} are the same.
 */
export function projectionMatrixConvertClipSpaceNearZ(m: mat4, dst: GfxClipSpaceNearZ, src: GfxClipSpaceNearZ): void {
    if (dst === src)
        return;

    if (dst === GfxClipSpaceNearZ.NegativeOne)
        projectionMatrixOpenGLFromD3D(m);
    else if (dst === GfxClipSpaceNearZ.Zero)
        projectionMatrixD3DFromOpenGL(m);
}
