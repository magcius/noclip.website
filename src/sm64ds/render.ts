
import { mat3, mat4 } from 'gl-matrix';

import * as CRG0 from './crg0';
import * as LZ77 from './lz77';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { CullMode, RenderFlags, RenderState, Program, RenderArena, RenderPass, BlendMode } from '../render';
import Progressable from 'Progressable';
import { fetch } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

class NITRO_Program extends Program {
    public localMatrixLocation: WebGLUniformLocation;
    public texCoordMatLocation: WebGLUniformLocation;

    public static a_position = 0;
    public static a_uv = 1;
    public static a_color = 2;

    public vert = `
precision mediump float;
uniform mat4 u_modelView;
uniform mat4 u_localMatrix;
uniform mat4 u_projection;
uniform mat3 u_texCoordMat;
layout(location = ${NITRO_Program.a_position}) in vec3 a_position;
layout(location = ${NITRO_Program.a_uv}) in vec2 a_uv;
layout(location = ${NITRO_Program.a_color}) in vec4 a_color;
out vec4 v_color;
out vec2 v_uv;

void main() {
    gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);
    v_color = a_color;
    v_uv = (u_texCoordMat * vec3(a_uv, 1.0)).st;
}
`;
    public frag = `
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_texture;

void main() {
    gl_FragColor = texture2D(u_texture, v_uv);
    gl_FragColor *= v_color;
    if (gl_FragColor.a == 0.0)
        discard;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
        this.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
    }
}

// 3 pos + 4 color + 2 uv
const VERTEX_SIZE = 9;
const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

function textureToCanvas(bmdTex: NITRO_BMD.Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = `${bmdTex.name} (${bmdTex.format})`;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(bmdTex.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    return { name: bmdTex.name, surfaces };
}

type RenderFunc = (state: RenderState) => void;

class Scene implements Viewer.Scene {
    public textures: Viewer.Texture[];
    public modelFuncs: RenderFunc[];
    public program: NITRO_Program;
    public bmd: NITRO_BMD.BMD;
    public localScale: number;
    public crg0Level: CRG0.Level;
    public isSkybox: boolean;

    private arena: RenderArena;

    constructor(gl: WebGL2RenderingContext, bmd: NITRO_BMD.BMD, localScale: number, crg0Level: CRG0.Level) {
        this.program = new NITRO_Program();
        this.bmd = bmd;
        this.localScale = localScale;
        this.crg0Level = crg0Level;
        this.isSkybox = false;
        this.arena = new RenderArena();

        this.textures = bmd.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.modelFuncs = bmd.models.map((bmdm) => this.translateModel(gl, bmdm));
    }

    private translatePacket(gl: WebGL2RenderingContext, packet: NITRO_GX.Packet): RenderFunc {
        const vertBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);

        const idxBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);

        const vao = this.arena.createVertexArray(gl);
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);

        gl.vertexAttribPointer(NITRO_Program.a_position, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
        gl.vertexAttribPointer(NITRO_Program.a_color, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(NITRO_Program.a_uv, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(NITRO_Program.a_position);
        gl.enableVertexAttribArray(NITRO_Program.a_color);
        gl.enableVertexAttribArray(NITRO_Program.a_uv);

        gl.bindVertexArray(null);

        return (renderState: RenderState) => {
            gl.bindVertexArray(vao);
            gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
            gl.bindVertexArray(null);
        };
    }

    private translatePoly(gl: WebGL2RenderingContext, poly: NITRO_BMD.Poly): RenderFunc {
        const funcs = poly.packets.map((packet) => this.translatePacket(gl, packet));
        return (state: RenderState) => {
            funcs.forEach((f) => { f(state); });
        };
    }

    private translateCullMode(renderWhichFaces: number): CullMode {
        switch (renderWhichFaces) {
        case 0x00: // Render Nothing
            return CullMode.FRONT_AND_BACK;
        case 0x01: // Render Back
            return CullMode.FRONT;
        case 0x02: // Render Front
            return CullMode.BACK;
        case 0x03: // Render Front and Back
            return CullMode.NONE;
        default:
            throw new Error("Unknown renderWhichFaces");
        }
    }

    private translateMaterial(gl: WebGL2RenderingContext, material: NITRO_BMD.Material) {
        const texture = material.texture;
        let texId: WebGLTexture;

        function wrapMode(repeat: boolean, flip: boolean) {
            if (repeat)
                return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
            else
                return gl.CLAMP_TO_EDGE;
        }

        if (texture !== null) {
            texId = this.arena.createTexture(gl);
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            const repeatS = !!((material.texParams >> 16) & 0x01);
            const repeatT = !!((material.texParams >> 17) & 0x01);
            const flipS = !!((material.texParams >> 18) & 0x01);
            const flipT = !!((material.texParams >> 19) & 0x01);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));

            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        }

        // Find any possible material animations.
        const crg0mat = this.crg0Level.materials.find((c) => c.name === material.name);
        const texCoordMat = mat3.create();
        mat3.fromMat2d(texCoordMat, material.texCoordMat);

        const renderFlags = new RenderFlags();
        renderFlags.blendMode = BlendMode.ADD;
        renderFlags.depthTest = true;
        renderFlags.depthWrite = material.depthWrite;
        renderFlags.cullMode = this.translateCullMode(material.renderWhichFaces);

        return (state: RenderState) => {
            if (crg0mat !== undefined) {
                const texAnimMat = mat3.create();
                for (const anim of crg0mat.animations) {
                    const time = state.time / 30;
                    const value = anim.values[(time | 0) % anim.values.length];
                    if (anim.property === 'x')
                        mat3.translate(texAnimMat, texAnimMat, [0, value]);
                    else if (anim.property === 'y')
                        mat3.translate(texAnimMat, texAnimMat, [value, 0]);
                    else if (anim.property === 'scale')
                        mat3.scale(texAnimMat, texAnimMat, [value, value]);
                    else if (anim.property === 'rotation')
                        mat3.rotate(texAnimMat, texAnimMat, value / 180 * Math.PI);
                }
                mat3.fromMat2d(texCoordMat, material.texCoordMat);
                mat3.multiply(texCoordMat, texAnimMat, texCoordMat);
            }

            if (texture !== null) {
                gl.uniformMatrix3fv(this.program.texCoordMatLocation, false, texCoordMat);
                gl.bindTexture(gl.TEXTURE_2D, texId);
            }

            state.useFlags(renderFlags);
        };
    }

    private translateBatch(gl: WebGL2RenderingContext, batch: NITRO_BMD.Batch): RenderFunc {
        const batchPass = batch.material.isTranslucent ? RenderPass.TRANSPARENT : RenderPass.OPAQUE;

        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);
        return (state: RenderState) => {
            if (state.currentPass !== batchPass)
                return;
            applyMaterial(state);
            renderPoly(state);
        };
    }

    private translateModel(gl: WebGL2RenderingContext, bmdm: NITRO_BMD.Model): RenderFunc {
        const localMatrix = mat4.create();
        const bmd = this.bmd;

        const scaleFactor = bmd.scaleFactor * this.localScale;

        mat4.scale(localMatrix, localMatrix, [scaleFactor, scaleFactor, scaleFactor]);

        const batches = bmdm.batches.map((batch) => this.translateBatch(gl, batch));
        return (state: RenderState) => {
            gl.uniformMatrix4fv(this.program.localMatrixLocation, false, localMatrix);
            batches.forEach((f) => { f(state); });
        };
    }

    private renderModels(state: RenderState) {
        return this.modelFuncs.forEach((func) => {
            func(state);
        });
    }

    public render(state: RenderState) {
        const gl = state.gl;
        state.useProgram(this.program);
        state.bindModelView(this.isSkybox);
        this.renderModels(state);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.arena.destroy(gl);
    }
}

class MultiScene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
    public scenes: Viewer.Scene[];
    public textures: Viewer.Texture[];

    constructor(scenes: Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public render(renderState: RenderState) {
        const gl = renderState.gl;

        // Clear to black.
        if (renderState.currentPass === RenderPass.CLEAR) {
            gl.clearColor(0, 0, 0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public levelId: number;

    constructor(name: string, levelId: number) {
        this.name = name;
        this.levelId = levelId;
        this.id = '' + this.levelId;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        return fetch('data/sm64ds/sm64ds.crg0').then((result: ArrayBufferSlice) => {
            const crg0 = CRG0.parse(result);
            return this._createSceneFromCRG0(gl, crg0);
        });
    }

    private _createBmdScene(gl: WebGL2RenderingContext, filename: string, localScale: number, level: CRG0.Level, isSkybox: boolean): PromiseLike<Scene> {
        return fetch(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const scene = new Scene(gl, bmd, localScale, level);
            scene.isSkybox = isSkybox;
            return scene;
        });
    }

    private _createSceneFromCRG0(gl: WebGL2RenderingContext, crg0: CRG0.CRG0): PromiseLike<Viewer.MainScene> {
        const level = crg0.levels[this.levelId];
        const scenes = [this._createBmdScene(gl, level.attributes.get('bmd'), 100, level, false)];
        if (level.attributes.get('vrbox'))
            scenes.unshift(this._createBmdScene(gl, level.attributes.get('vrbox'), 0.8, level, true));
        return Promise.all(scenes).then((results: Viewer.Scene[]) => {
            return new MultiScene(results);
        });
    }
}
