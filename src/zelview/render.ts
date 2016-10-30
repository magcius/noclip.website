
/// <reference path="../decl.d.ts" />

import * as ZELVIEW0 from 'zelview0';
import * as Viewer from 'viewer';
import { fetch } from 'util'; 

var BG_VERT_SHADER_SOURCE = ` 
    attribute vec3 a_position;
    attribute vec2 a_uv;
    varying vec2 v_uv;

    void main() {
        gl_Position = vec4(a_position, 1.0);
        v_uv = a_uv;
    }
`;

var BG_FRAG_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;

    void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
    }
`;

class BG_Program extends Viewer.Program {
    positionLocation:number;
    uvLocation:number;

    vert = BG_VERT_SHADER_SOURCE;
    frag = BG_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

const DL_VERT_SHADER_SOURCE = `
    uniform mat4 u_modelView;
    uniform mat4 u_projection;
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec4 a_color;
    varying vec4 v_color;
    varying vec2 v_uv;
    uniform vec2 u_txs;
    
    void main() {
        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
        v_color = a_color;
        v_uv = a_uv * u_txs;
    }
`;

const DL_FRAG_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_color;
    uniform sampler2D u_texture;
    uniform bool u_useVertexColors;
    uniform int u_alphaTest;

    void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
        if (u_useVertexColors)
            gl_FragColor *= v_color;
        if (u_alphaTest > 0 && gl_FragColor.a < 0.0125)
            discard;
    }
`;

class DL_Program extends Viewer.Program {
    txsLocation:WebGLUniformLocation;
    useVertexColorsLocation:WebGLUniformLocation;
    alphaTestLocation:WebGLUniformLocation;
    positionLocation:number;
    uvLocation:number;
    colorLocation:number;

    vert = DL_VERT_SHADER_SOURCE;
    frag = DL_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.txsLocation = gl.getUniformLocation(prog, "u_txs");
        this.useVertexColorsLocation = gl.getUniformLocation(prog, "u_useVertexColors");
        this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

const COLL_VERT_SHADER_SOURCE = `
    uniform mat4 u_modelView;
    uniform mat4 u_projection;
    attribute vec3 a_position;

    void main() {
        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
    }
`;

const COLL_FRAG_SHADER_SOURCE = `
    void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 0.2);
    #ifdef GL_EXT_frag_depth
    #extension GL_EXT_frag_depth : enable
        gl_FragDepthEXT = gl_FragCoord.z - 1e-6;
    #endif
    }
`;

class COLL_Program extends Viewer.Program {
    positionLocation:number;

    vert = COLL_VERT_SHADER_SOURCE;
    frag = COLL_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
    }
}

const WATERS_VERT_SHADER_SOURCE = `
    uniform mat4 u_modelView;
    uniform mat4 u_projection;
    attribute vec3 a_position;
    
    void main() {
        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
    }
`;

const WATERS_FRAG_SHADER_SOURCE = `
    void main() {
        gl_FragColor = vec4(0.2, 0.6, 1.0, 0.2);
    }
`;

class WATERS_Program extends Viewer.Program {
    positionLocation:number;

    vert = WATERS_VERT_SHADER_SOURCE;
    frag = WATERS_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
    }
}

class Scene implements Viewer.Scene {
    textures:HTMLCanvasElement[];
    zelview0:ZELVIEW0.ZELVIEW0;
    program_BG:BG_Program;
    program_COLL:COLL_Program;
    program_DL:DL_Program;
    program_WATERS:WATERS_Program;

    render:(state:Viewer.RenderState) => void;

    constructor(gl:WebGLRenderingContext, zelview0:ZELVIEW0.ZELVIEW0) {
        this.zelview0 = zelview0;
        this.textures = [];
        this.program_BG = new BG_Program();
        this.program_COLL = new COLL_Program();
        this.program_DL = new DL_Program();
        this.program_WATERS = new WATERS_Program();

        const mainScene = zelview0.loadMainScene(gl);
        mainScene.rooms.forEach((room) => {
            this.textures = this.textures.concat(room.mesh.textures);
        });

        const renderScene = this.translateScene(gl, mainScene);
        const renderCollision = this.translateCollision(gl, mainScene);
        const renderWaterBoxes = this.translateWaterBoxes(gl, mainScene);
        this.render = (state:Viewer.RenderState) => {
            renderScene(state);
            renderCollision(state);
            renderWaterBoxes(state);
        };
    }

    translateScene(gl:WebGLRenderingContext, scene:ZELVIEW0.Headers):Function {
        return (state:Viewer.RenderState) => {
            const gl = state.gl;

            const renderDL = (dl) => {
                dl.cmds.forEach((cmd) => {
                    cmd(state);
                });
            };

            const renderMesh = (mesh) => {
                if (mesh.bg) {
                    state.useProgram(this.program_BG);
                    mesh.bg(gl);
                }

                state.useProgram(this.program_DL);
                mesh.opaque.forEach(renderDL);
                mesh.transparent.forEach(renderDL);
            };

            const renderRoom = (room) => {
                renderMesh(room.mesh);
            };

            state.useProgram(this.program_DL);
            scene.rooms.forEach((room) => renderRoom(room));
        };
    }

    translateCollision(gl:WebGLRenderingContext, scene:ZELVIEW0.Headers):Function {
        const coll = scene.collision;

        function stitchLines(ibd) {
            const lines = new Uint16Array(ibd.length * 2);
            let o = 0;
            for (let i = 0; i < ibd.length; i += 3) {
                lines[o++] = ibd[i+0];
                lines[o++] = ibd[i+1];
                lines[o++] = ibd[i+1];
                lines[o++] = ibd[i+2];
                lines[o++] = ibd[i+2];
                lines[o++] = ibd[i+0];
            }
            return lines;
        }
        const collIdxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
        const lineData = stitchLines(coll.polys);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
        const nLinePrim = lineData.length;

        const collVertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, coll.verts, gl.STATIC_DRAW);

        return (state:Viewer.RenderState) => {
            const prog = this.program_COLL;
            state.useProgram(prog);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.drawElements(gl.LINES, nLinePrim, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
        };
    }

    translateWaterBoxes(gl:WebGLRenderingContext, scene:ZELVIEW0.Headers) {
        const coll = scene.collision;

        const wbVtx = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
        gl.bufferData(gl.ARRAY_BUFFER, coll.waters, gl.STATIC_DRAW);
        const wbIdxData = new Uint16Array(coll.waters.length / 3);
        for (var i = 0; i < wbIdxData.length; i++)
            wbIdxData[i] = i;
        const wbIdx = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wbIdxData, gl.STATIC_DRAW);

        return (state:Viewer.RenderState) => {
            const prog = this.program_WATERS;
            state.useProgram(prog);
            gl.disable(gl.CULL_FACE);
            gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
            gl.enableVertexAttribArray(prog.positionLocation);
            for (var i = 0; i < wbIdxData.length; i += 4)
                gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, i*2);
            gl.disableVertexAttribArray(prog.positionLocation);
            gl.disable(gl.BLEND);
        };
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
            const zelview0 = ZELVIEW0.readZELVIEW0(result);
            return new Scene(gl, zelview0);
        });
    }
}
