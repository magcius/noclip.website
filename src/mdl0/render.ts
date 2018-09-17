
import * as MDL0 from './mdl0';

import * as Viewer from '../viewer';

import { RenderFlags, RenderState, BlendMode } from '../render';
import { SimpleProgram } from '../Program';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { OrbitCameraController } from '../Camera';

class FancyGrid_Program extends SimpleProgram {
    public positionLocation: number;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_projection;

attribute vec3 a_position;
varying float v_eyeFade;
varying vec2 v_surfCoord;

void main() {
    v_surfCoord = a_position.xz;

    float scale = 200.0;
    gl_Position = u_projection * u_modelView * vec4(a_position * scale, 1.0);

    vec3 V = (vec4(0.0, 0.0, 1.0, 0.0) * u_modelView).xyz;
    vec3 N = vec3(0.0, 1.0, 0.0);
    v_eyeFade = dot(V, N);
}
`;

    public frag = `
#extension GL_EXT_frag_depth : enable
#extension GL_OES_standard_derivatives : enable

precision highp float;
varying float v_eyeFade;
varying vec2 v_surfCoord;

void main() {
    float distFromCenter = distance(v_surfCoord, vec2(0.0));
    vec2 uv = (v_surfCoord + 1.0) * 0.5;

    vec4 color;
    color.a = 1.0;

    // Base Grid color.
    color.rgb = mix(vec3(0.8, 0.0, 0.8), vec3(0.4, 0.2, 0.8), clamp(distFromCenter * 1.5, 0.0, 1.0));
    color.a *= clamp(mix(2.0, 0.0, distFromCenter), 0.0, 1.0);

    // Grid lines mask.
    uv *= 80.0;
    float sharpDx = clamp(1.0 / min(abs(dFdx(uv.x)), abs(dFdy(uv.y))), 2.0, 20.0);
    float sharpMult = sharpDx * 10.0;
    float sharpOffs = sharpDx * 4.40;
    vec2 gridM = (abs(fract(uv) - 0.5)) * sharpMult - sharpOffs;
    float gridMask = max(gridM.x, gridM.y);
    color.a *= clamp(gridMask, 0.0, 1.0);

    color.a += (1.0 - clamp(distFromCenter * 1.2, 0.0, 1.0)) * 0.5 * v_eyeFade;

    // Eye fade.
    color.a *= clamp(v_eyeFade, 0.3, 1.0);
    gl_FragColor = color;

    gl_FragDepth = gl_FragCoord.z + 1e-6;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
    }
}

class FancyGrid {
    public program: FancyGrid_Program;

    private vtxBuffer: WebGLBuffer;
    private renderFlags: RenderFlags;

    constructor(gl: WebGL2RenderingContext) {
        this.program = new FancyGrid_Program();
        this._createBuffers(gl);

        this.renderFlags = new RenderFlags();
        this.renderFlags.blendMode = BlendMode.ADD;
    }

    public render(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.bindModelView();
        state.useFlags(this.renderFlags);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
        gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.program.positionLocation);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disableVertexAttribArray(this.program.positionLocation);
    }

    private _createBuffers(gl: WebGL2RenderingContext) {
        this.vtxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);

        const vtx = new Float32Array(4 * 3);

        vtx[0]  = -1;
        vtx[1]  = 0;
        vtx[2]  = -1;
        vtx[3]  = 1;
        vtx[4]  = 0;
        vtx[5]  = -1;
        vtx[6]  = -1;
        vtx[7]  = 0;
        vtx[8]  = 1;
        vtx[9]  = 1;
        vtx[10] = 0;
        vtx[11] = 1;

        gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.STATIC_DRAW);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        gl.deleteBuffer(this.vtxBuffer);
    }
}

class MDL0_Program extends SimpleProgram {
    public positionLocation: number;
    public colorLocation: number;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_projection;

attribute vec3 a_position;
attribute vec4 a_color;
varying vec4 v_color;

void main() {
    v_color = a_color.bgra;
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
`;

    public frag = `
precision mediump float;

varying vec4 v_color;

void main() {
    gl_FragColor = v_color;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
    }
}

class Scene implements Viewer.MainScene {
    public program: MDL0_Program;
    public mdl0: MDL0.MDL0;
    public fancyGrid: FancyGrid;

    private clrBuffer: WebGLBuffer;
    private vtxBuffer: WebGLBuffer;
    private idxBuffer: WebGLBuffer;
    private renderFlags: RenderFlags;

    constructor(gl: WebGL2RenderingContext, mdl0: MDL0.MDL0) {
        this.fancyGrid = new FancyGrid(gl);
        this.program = new MDL0_Program();
        this.mdl0 = mdl0;
        this._createBuffers(gl);

        this.renderFlags = new RenderFlags();
        this.renderFlags.depthTest = true;
    }

    public render(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.bindModelView();
        state.useFlags(this.renderFlags);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.clrBuffer);
        gl.vertexAttribPointer(this.program.colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.enableVertexAttribArray(this.program.colorLocation);

        const frameNumber = ((state.time / 16) % this.mdl0.animCount) | 0;
        const vtxOffset = frameNumber * this.mdl0.animSize;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
        gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, this.mdl0.vertSize, vtxOffset);
        gl.enableVertexAttribArray(this.program.positionLocation);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);
        gl.drawElements(gl.TRIANGLES, this.mdl0.idxData.length, gl.UNSIGNED_SHORT, 0);

        gl.disableVertexAttribArray(this.program.colorLocation);
        gl.disableVertexAttribArray(this.program.positionLocation);

        this.fancyGrid.render(state);
    }

    private _createBuffers(gl: WebGL2RenderingContext) {
        this.clrBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.clrBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.clrData, gl.STATIC_DRAW);

        this.idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mdl0.idxData, gl.STATIC_DRAW);

        this.vtxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.vtxData, gl.STATIC_DRAW);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteBuffer(this.clrBuffer);
        gl.deleteBuffer(this.vtxBuffer);
        gl.deleteBuffer(this.idxBuffer);
        this.program.destroy(gl);
        this.fancyGrid.destroy(gl);
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public defaultCameraController = OrbitCameraController;
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return fetchData(this.path).then((result: ArrayBufferSlice) => {
            const mdl0 = MDL0.parse(result);
            return new Scene(gl, mdl0);
        });
    }
}
