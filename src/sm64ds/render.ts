
import { mat3, mat4 } from 'gl-matrix';

import * as LZ77 from 'lz77';
import * as Viewer from 'viewer';
import * as CRG0 from './crg0';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import { fetch } from 'util';

const DL_VERT_SHADER_SOURCE = `
    precision mediump float;
    uniform mat4 u_modelView;
    uniform mat4 u_localMatrix;
    uniform mat4 u_projection;
    uniform mat3 u_texCoordMat;
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec4 a_color;
    varying vec4 v_color;
    varying vec2 v_uv;

    void main() {
        gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);
        v_color = a_color;
        v_uv = (u_texCoordMat * vec3(a_uv, 1.0)).st;
    }
`;

const DL_FRAG_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_color;
    uniform sampler2D u_texture;

    void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
        gl_FragColor *= v_color;
        if (gl_FragColor.a == 0.0)
            discard;
    }
`;

class NITRO_Program extends Viewer.Program {
    public localMatrixLocation: WebGLUniformLocation;
    public texCoordMatLocation: WebGLUniformLocation;
    public positionLocation: number;
    public colorLocation: number;
    public uvLocation: number;

    public vert = DL_VERT_SHADER_SOURCE;
    public frag = DL_FRAG_SHADER_SOURCE;

    public bind(gl: WebGLRenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
        this.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

// 3 pos + 4 color + 2 uv
const VERTEX_SIZE = 9;
const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

enum RenderPass {
    OPAQUE = 0x01,
    TRANSLUCENT = 0x02,
}

function textureToCanvas(bmdTex: NITRO_BMD.Texture) {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = bmdTex.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < imgData.data.length; i++)
        imgData.data[i] = bmdTex.pixels[i];

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    public modelFuncs: Array<(state: Viewer.RenderState, pass: RenderPass) => void>;
    public program: NITRO_Program;
    public bmd: NITRO_BMD.BMD;
    public localScale: number;
    public crg0Level: CRG0.Level;

    constructor(gl: WebGLRenderingContext, bmd: NITRO_BMD.BMD, localScale: number, crg0Level: CRG0.Level) {
        this.program = new NITRO_Program();
        this.bmd = bmd;
        this.localScale = localScale;
        this.crg0Level = crg0Level;

        this.textures = bmd.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.modelFuncs = bmd.models.map((bmdm) => this.translateModel(gl, bmdm));
    }

    public translatePacket(gl: WebGLRenderingContext, packet: NITRO_GX.Packet) {
        const vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);

        return () => {
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
            gl.vertexAttribPointer(this.program.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
            gl.vertexAttribPointer(this.program.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
            gl.enableVertexAttribArray(this.program.positionLocation);
            gl.enableVertexAttribArray(this.program.colorLocation);
            gl.enableVertexAttribArray(this.program.uvLocation);
            gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(this.program.positionLocation);
            gl.disableVertexAttribArray(this.program.colorLocation);
            gl.disableVertexAttribArray(this.program.uvLocation);
        };
    }

    public translatePoly(gl: WebGLRenderingContext, poly: NITRO_BMD.Poly) {
        const funcs = poly.packets.map((packet) => this.translatePacket(gl, packet));
        return (state: Viewer.RenderState) => {
            funcs.forEach((f) => { f(); });
        };
    }

    public translateMaterial(gl: WebGLRenderingContext, material: any) {
        const texture = material.texture;
        let texId;

        function wrapMode(repeat, flip) {
            if (repeat)
                return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
            else
                return gl.CLAMP_TO_EDGE;
        }

        if (texture !== null) {
            texId = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            const repeatS = (material.texParams >> 16) & 0x01;
            const repeatT = (material.texParams >> 17) & 0x01;
            const flipS = (material.texParams >> 18) & 0x01;
            const flipT = (material.texParams >> 19) & 0x01;

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));

            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        }

        // Find any possible material animations.
        const crg0mat = this.crg0Level.materials.find(crg0mat => crg0mat.name === material.name);
        const texCoordMat = mat3.create();
        mat3.fromMat2d(texCoordMat, material.texCoordMat);

        return (state: Viewer.RenderState) => {
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

            gl.depthMask(material.depthWrite);
        };
    }

    public translateBatch(gl: WebGLRenderingContext, batch: NITRO_BMD.Batch) {
        const batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;

        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);
        return (state: Viewer.RenderState, pass: RenderPass) => {
            if (pass !== batchPass)
                return;
            applyMaterial(state);
            renderPoly(state);
        };
    }

    public translateModel(gl: WebGLRenderingContext, bmdm: NITRO_BMD.Model) {
        const localMatrix = mat4.create();
        const bmd = this.bmd;

        const scaleFactor = bmd.scaleFactor * this.localScale;

        mat4.scale(localMatrix, localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        const batches = bmdm.batches.map((batch) => this.translateBatch(gl, batch));
        return (state: Viewer.RenderState, pass: RenderPass) => {
            gl.uniformMatrix4fv(this.program.localMatrixLocation, false, localMatrix);
            batches.forEach((f) => { f(state, pass); });
        };
    }

    public renderModels(state: Viewer.RenderState, pass: RenderPass) {
        return this.modelFuncs.forEach((func) => {
            func(state, pass);
        });
    }

    public render(state: Viewer.RenderState) {
        const gl = state.viewport.gl;

        state.useProgram(this.program);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // First pass, opaque.
        this.renderModels(state, RenderPass.OPAQUE);

        // Second pass, translucent.
        this.renderModels(state, RenderPass.TRANSLUCENT);
    }
}

class MultiScene implements Viewer.Scene {
    cameraController = Viewer.FPSCameraController;    
    scenes:Viewer.Scene[];
    textures:HTMLCanvasElement[];
    constructor(scenes:Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }
    render(renderState:Viewer.RenderState) {
        this.scenes.forEach((scene) => scene.render(renderState));
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public name: string;
    public levelId: number;

    constructor(name: string, levelId: number) {
        this.name = name;
        this.levelId = levelId;
    }

    private _createBmdScene(gl: WebGLRenderingContext, filename: string, localScale: number, level: CRG0.Level): PromiseLike<Viewer.Scene> {
        return fetch(`data/sm64ds/${filename}`).then((result: ArrayBuffer) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            return new Scene(gl, bmd, localScale, level);
        });
    }

    private _createSceneFromCRG0(gl: WebGLRenderingContext, crg0: CRG0.CRG0): PromiseLike<Viewer.Scene> {
        const level = crg0.levels[this.levelId];
        const scenes = [this._createBmdScene(gl, level.attributes.get('bmd'), 100, level)];
        if (level.attributes.get('vrbox'))
            scenes.unshift(this._createBmdScene(gl, level.attributes.get('vrbox'), 0.1, level));
        return Promise.all(scenes).then((results) => {
            return new MultiScene(results);
        });
    }

    public createScene(gl: WebGLRenderingContext): PromiseLike<Viewer.Scene> {
        return fetch('data/sm64ds/sm64ds.crg0').then((result: ArrayBuffer) => {
            const crg0 = CRG0.parse(result);
            return this._createSceneFromCRG0(gl, crg0);
        });
    }
}
