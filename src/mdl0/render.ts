
import * as MDL0 from 'mdl0';
import * as Viewer from '../viewer';
import { fetch } from 'util'; 

const MDL0_VERT_SHADER_SOURCE = `
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

const MDL0_FRAG_SHADER_SOURCE = `
precision mediump float;

varying vec4 v_color;

void main() {
    gl_FragColor = v_color;
}
`;

class MDL0_Program extends Viewer.Program {
    positionLocation:number;
    colorLocation:number;

    vert = MDL0_VERT_SHADER_SOURCE;
    frag = MDL0_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
    }
}

class Scene implements Viewer.Scene {
    cameraController = Viewer.OrbitCameraController;
    textures:HTMLCanvasElement[] = [];
    program:MDL0_Program;
    mdl0:MDL0.MDL0;

    _clrBuffer:WebGLBuffer;
    _vtxBuffer:WebGLBuffer;
    _idxBuffer:WebGLBuffer;

    constructor(gl:WebGLRenderingContext, mdl0:MDL0.MDL0) {
        this.program = new MDL0_Program();
        this.mdl0 = mdl0;
        this._createBuffers(gl);
    }

    _createBuffers(gl:WebGLRenderingContext) {
        this._clrBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._clrBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.clrData, gl.STATIC_DRAW);

        this._idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mdl0.idxData, gl.STATIC_DRAW);

        this._vtxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vtxBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.vtxData, gl.STATIC_DRAW);
    }

    render(state:Viewer.RenderState) {
        const gl = state.viewport.gl;

        state.useProgram(this.program);
        gl.enable(gl.DEPTH_TEST);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._clrBuffer);
        gl.vertexAttribPointer(this.program.colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.enableVertexAttribArray(this.program.colorLocation);

        const frameNumber = ((state.time / 16) % this.mdl0.animCount) | 0;
        const vtxOffset = frameNumber * this.mdl0.animSize;

        gl.bindBuffer(gl.ARRAY_BUFFER, this._vtxBuffer);
        gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, this.mdl0.vertSize, vtxOffset);
        gl.enableVertexAttribArray(this.program.positionLocation);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuffer);
        gl.drawElements(gl.TRIANGLES, this.mdl0.idxData.length, gl.UNSIGNED_SHORT, 0);
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    name:string;
    path:string;

    constructor(name:string, path:string) {
        this.name = name;
        this.path = path;
    }

    createScene(gl:WebGLRenderingContext):PromiseLike<Scene> {
        return fetch(this.path).then((result:ArrayBuffer) => {
            const mdl0 = MDL0.parse(result);
            return new Scene(gl, mdl0);
        });
    }
}
