
import { vec3 } from 'gl-matrix';

import * as IV from './iv';
import { RenderFlags, RenderState, Program, CullMode } from '../render';
import * as Viewer from '../viewer';

class IVProgram extends Program {
    static a_Position = 0;
    static a_Normal = 1;

    public u_Color: WebGLUniformLocation;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_projection;

layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;

out vec3 v_Normal;

void main() {
    const float t_ModelScale = 20.0;
    gl_Position = u_projection * u_modelView * vec4(a_Position * t_ModelScale, 1.0);
    v_Normal = a_Normal;
}
`;

    public frag = `
precision mediump float;

uniform vec3 u_Color;

in vec3 v_Normal;

void main() {
    vec3 u_LightDirection = normalize(vec3(.2, -1, .5));
    float t_LightIntensity = dot(-v_Normal, u_LightDirection);
    vec3 t_LightColor = t_LightIntensity * vec3(0.3);
    gl_FragColor = vec4(u_Color + t_LightColor, 1.0);
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.u_Color = gl.getUniformLocation(prog, 'u_Color');
    }
}

class Chunk {
    public numVertices: number;
    public posBuffer: WebGLBuffer;
    public nrmBuffer: WebGLBuffer;
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, public chunk: IV.Chunk) {
        this.createTopology(gl, chunk);
    }

    public createTopology(gl: WebGL2RenderingContext, chunk: IV.Chunk) {
        // Run through our data, calculate normals and such.
        const t = vec3.create();

        const posData = new Float32Array(chunk.indexData.length * 3);
        const nrmData = new Float32Array(chunk.indexData.length * 3);

        for (let i = 0; i < chunk.indexData.length; i += 3) {
            const i0 = chunk.indexData[i + 0];
            const i1 = chunk.indexData[i + 1];
            const i2 = chunk.indexData[i + 2];

            const t0x = chunk.positionData[i0 * 3 + 0];
            const t0y = chunk.positionData[i0 * 3 + 1];
            const t0z = chunk.positionData[i0 * 3 + 2];
            const t1x = chunk.positionData[i1 * 3 + 0];
            const t1y = chunk.positionData[i1 * 3 + 1];
            const t1z = chunk.positionData[i1 * 3 + 2];
            const t2x = chunk.positionData[i2 * 3 + 0];
            const t2y = chunk.positionData[i2 * 3 + 1];
            const t2z = chunk.positionData[i2 * 3 + 2];

            vec3.cross(t, [t0x - t1x, t0y - t1y, t0z - t1z], [t0x - t2x, t0y - t2y, t0z - t2z]);
            vec3.normalize(t, t);

            posData[(i + 0) * 3 + 0] = t0x;
            posData[(i + 0) * 3 + 1] = t0y;
            posData[(i + 0) * 3 + 2] = t0z;
            posData[(i + 1) * 3 + 0] = t1x;
            posData[(i + 1) * 3 + 1] = t1y;
            posData[(i + 1) * 3 + 2] = t1z;
            posData[(i + 2) * 3 + 0] = t2x;
            posData[(i + 2) * 3 + 1] = t2y;
            posData[(i + 2) * 3 + 2] = t2z;

            nrmData[(i + 0) * 3 + 0] = t[0];
            nrmData[(i + 0) * 3 + 1] = t[1];
            nrmData[(i + 0) * 3 + 2] = t[2];
            nrmData[(i + 1) * 3 + 0] = t[0];
            nrmData[(i + 1) * 3 + 1] = t[1];
            nrmData[(i + 1) * 3 + 2] = t[2];
            nrmData[(i + 2) * 3 + 0] = t[0];
            nrmData[(i + 2) * 3 + 1] = t[1];
            nrmData[(i + 2) * 3 + 2] = t[2];
        }

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);

        gl.vertexAttribPointer(IVProgram.a_Position, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(IVProgram.a_Position);

        this.nrmBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, nrmData, gl.STATIC_DRAW);

        gl.vertexAttribPointer(IVProgram.a_Normal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(IVProgram.a_Normal);

        this.numVertices = chunk.indexData.length;
    }

    public render(state: RenderState) {
        const gl = state.gl;
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.numVertices);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.posBuffer);
        gl.deleteBuffer(this.nrmBuffer);
    }
}

export class Scene implements Viewer.Scene {
    public textures: Viewer.Texture[] = [];

    public visible: boolean = true;

    private program: IVProgram;
    private chunks: Chunk[];
    private renderFlags: RenderFlags;

    constructor(gl: WebGL2RenderingContext, public label: string, public iv: IV.IV) {
        this.chunks = this.iv.chunks.map((chunk) => new Chunk(gl, chunk));

        this.program = new IVProgram();

        this.renderFlags = new RenderFlags();
        this.renderFlags.cullMode = CullMode.BACK;
        this.renderFlags.depthTest = true;
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public render(state: RenderState) {
        if (!this.visible)
            return;

        const gl = state.gl;

        state.setClipPlanes(10, 500000);

        state.useProgram(this.program);
        state.bindModelView();
        state.useFlags(this.renderFlags);

        gl.uniform3fv(this.program.u_Color, this.iv.color);

        this.chunks.forEach((chunk) => {
            chunk.render(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.chunks.forEach((chunk) => {
            chunk.destroy(gl);
        });
        this.program.destroy(gl);
    }
}
