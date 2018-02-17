
import * as F3DEX2 from 'f3dex2';
import * as Viewer from 'viewer';
import * as ZELVIEW0 from 'zelview0';

import { Progressable } from 'progress';
import { fetch } from 'util';

export type RenderFunc = (renderState: Viewer.RenderState) => void;

class BillboardBGProgram extends Viewer.Program {
    public positionLocation: number;
    public uvLocation: number;

    public vert = `
attribute vec3 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;

void main() {
    gl_Position = vec4(a_position, 1.0);
    v_uv = a_uv;
}
`;
    public frag = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;

void main() {
    gl_FragColor = texture2D(u_texture, v_uv);
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

export class F3DEX2Program extends Viewer.Program {
    public txsLocation: WebGLUniformLocation;
    public useVertexColorsLocation: WebGLUniformLocation;
    public alphaTestLocation: WebGLUniformLocation;
    public positionLocation: number;
    public uvLocation: number;
    public colorLocation: number;

    public vert = `
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

    public frag = `
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

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.txsLocation = gl.getUniformLocation(prog, "u_txs");
        this.useVertexColorsLocation = gl.getUniformLocation(prog, "u_useVertexColors");
        this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

class CollisionProgram extends Viewer.Program {
    public positionLocation: number;

    public vert = `
uniform mat4 u_modelView;
uniform mat4 u_projection;
attribute vec3 a_position;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
`;
    public frag = `
#extension GL_EXT_frag_depth : enable

void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 0.2);
    gl_FragDepthEXT = gl_FragCoord.z - 1e-6;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
    }
}

class WaterboxProgram extends Viewer.Program {
    public positionLocation: number;

    public vert = `
uniform mat4 u_modelView;
uniform mat4 u_projection;
attribute vec3 a_position;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}
`;
    public frag = `
void main() {
    gl_FragColor = vec4(0.2, 0.6, 1.0, 0.2);
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.positionLocation = gl.getAttribLocation(prog, "a_position");
    }
}

class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    public zelview0: ZELVIEW0.ZELVIEW0;
    public program_BG: BillboardBGProgram;
    public program_COLL: CollisionProgram;
    public program_DL: F3DEX2Program;
    public program_WATERS: WaterboxProgram;

    public render: RenderFunc;

    constructor(gl: WebGL2RenderingContext, zelview0: ZELVIEW0.ZELVIEW0) {
        this.zelview0 = zelview0;
        this.textures = [];
        this.program_BG = new BillboardBGProgram();
        this.program_COLL = new CollisionProgram();
        this.program_DL = new F3DEX2Program();
        this.program_WATERS = new WaterboxProgram();

        const mainScene = zelview0.loadMainScene(gl);
        mainScene.rooms.forEach((room) => {
            this.textures = this.textures.concat(room.mesh.textures);
        });

        const renderScene = this.translateScene(gl, mainScene);
        const renderCollision = this.translateCollision(gl, mainScene);
        const renderWaterBoxes = this.translateWaterBoxes(gl, mainScene);
        this.render = (state: Viewer.RenderState) => {
            renderScene(state);
            renderCollision(state);
            renderWaterBoxes(state);
        };
    }

    private translateScene(gl: WebGL2RenderingContext, scene: ZELVIEW0.Headers): (state: Viewer.RenderState) => void {
        return (state: Viewer.RenderState) => {
            const gl = state.gl;

            const renderDL = (dl: F3DEX2.DL) => {
                dl.cmds.forEach((cmd) => {
                    cmd(state);
                });
            };

            const renderMesh = (mesh: ZELVIEW0.Mesh) => {
                if (mesh.bg) {
                    state.useProgram(this.program_BG);
                    mesh.bg(state);
                }

                state.useProgram(this.program_DL);
                mesh.opaque.forEach(renderDL);
                mesh.transparent.forEach(renderDL);
            };

            const renderRoom = (room: ZELVIEW0.Headers) => {
                renderMesh(room.mesh);
            };

            state.useProgram(this.program_DL);
            scene.rooms.forEach((room) => renderRoom(room));
        };
    }

    private translateCollision(gl: WebGL2RenderingContext, scene: ZELVIEW0.Headers): (state: Viewer.RenderState) => void {
        const coll = scene.collision;

        function stitchLines(ibd) {
            const lines = new Uint16Array(ibd.length * 2);
            let o = 0;
            for (let i = 0; i < ibd.length; i += 3) {
                lines[o++] = ibd[i + 0];
                lines[o++] = ibd[i + 1];
                lines[o++] = ibd[i + 1];
                lines[o++] = ibd[i + 2];
                lines[o++] = ibd[i + 2];
                lines[o++] = ibd[i + 0];
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

        const renderFlags = new Viewer.RenderFlags();
        renderFlags.depthTest = true;
        renderFlags.blend = true;

        return (state: Viewer.RenderState) => {
            const prog = this.program_COLL;
            state.useProgram(prog);
            state.useFlags(renderFlags);
            gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.drawElements(gl.LINES, nLinePrim, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
        };
    }

    private translateWaterBoxes(gl: WebGL2RenderingContext, scene: ZELVIEW0.Headers): (state: Viewer.RenderState) => void {
        const coll = scene.collision;

        const wbVtx = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
        gl.bufferData(gl.ARRAY_BUFFER, coll.waters, gl.STATIC_DRAW);
        const wbIdxData = new Uint16Array(coll.waters.length / 3);
        for (let i = 0; i < wbIdxData.length; i++)
            wbIdxData[i] = i;
        const wbIdx = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wbIdxData, gl.STATIC_DRAW);

        const renderFlags = new Viewer.RenderFlags();
        renderFlags.blend = true;
        renderFlags.cullMode = Viewer.RenderCullMode.NONE;

        return (state: Viewer.RenderState) => {
            const prog = this.program_WATERS;
            state.useProgram(prog);
            state.useFlags(renderFlags);
            gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
            gl.enableVertexAttribArray(prog.positionLocation);
            for (let i = 0; i < wbIdxData.length; i += 4)
                gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, i * 2);
            gl.disableVertexAttribArray(prog.positionLocation);
        };
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const zelview0 = ZELVIEW0.readZELVIEW0(result);
            return new Scene(gl, zelview0);
        });
    }
}
