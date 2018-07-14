
import Program from "./Program";
import { AABB } from "./Camera";
import { vec4, mat4 } from "gl-matrix";
import { RenderState } from "./render";

class LinesProgram extends Program {
    public vert = `
uniform mat4 u_modelView;
uniform mat4 u_projection;
layout(location = 13) attribute vec3 a_Position;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_Position, 1.0);
}
`;
    public frag = `
uniform vec4 u_LineColor;

void main() {
    gl_FragColor = u_LineColor;
    gl_FragDepth = gl_FragCoord.z - 1e-6;
}
`;

    public u_LineColor: WebGLUniformLocation;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
        super.bind(gl, prog);
        this.u_LineColor = gl.getUniformLocation(prog, 'u_LineColor');
    }
}

let vertexBuffer: WebGLBuffer, indexBuffer: WebGLBuffer, vao: WebGLVertexArrayObject;
const indexData = new Uint8Array([
    // Top.
    0, 1,
    1, 2,
    2, 3,
    3, 0,
    // Bottom.
    4, 5,
    5, 6,
    6, 7,
    7, 4,
    // Sides.
    0, 4,
    1, 5,
    2, 6,
    3, 7,
]);

const defaultLineColor = vec4.fromValues(1, 0, 1, 1);
export function renderWireframeAABB(state: RenderState, aabb: AABB, modelMatrix: mat4 = null, color: vec4 = null): void {
    const gl = state.gl;

    if (!indexBuffer) {
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
    }

    gl.bindVertexArray(vao);

    const prog = new LinesProgram();
    state.useProgram(prog);
    state.bindModelView(false, modelMatrix);

    const vertexData = new Float32Array(3 * 8);
    vertexData[0*3+0] = aabb.minX;
    vertexData[0*3+1] = aabb.minY;
    vertexData[0*3+2] = aabb.minZ;

    vertexData[1*3+0] = aabb.maxX;
    vertexData[1*3+1] = aabb.minY;
    vertexData[1*3+2] = aabb.minZ;

    vertexData[2*3+0] = aabb.maxX;
    vertexData[2*3+1] = aabb.minY;
    vertexData[2*3+2] = aabb.maxZ;

    vertexData[3*3+0] = aabb.minX;
    vertexData[3*3+1] = aabb.minY;
    vertexData[3*3+2] = aabb.maxZ;

    vertexData[4*3+0] = aabb.minX;
    vertexData[4*3+1] = aabb.maxY;
    vertexData[4*3+2] = aabb.minZ;

    vertexData[5*3+0] = aabb.maxX;
    vertexData[5*3+1] = aabb.maxY;
    vertexData[5*3+2] = aabb.minZ;

    vertexData[6*3+0] = aabb.maxX;
    vertexData[6*3+1] = aabb.maxY;
    vertexData[6*3+2] = aabb.maxZ;

    vertexData[7*3+0] = aabb.minX;
    vertexData[7*3+1] = aabb.maxY;
    vertexData[7*3+2] = aabb.maxZ;
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);

    if (!color)
        color = defaultLineColor;
    gl.uniform4fv(prog.u_LineColor, color);

    gl.vertexAttribPointer(13, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(13);
    gl.drawElements(gl.LINES, 12*2, gl.UNSIGNED_BYTE, 0);
    gl.bindVertexArray(null);
}
