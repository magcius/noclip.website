
import { mat3, mat4 } from 'gl-matrix';

import * as CRG1 from './crg1';
import * as LZ77 from './lz77';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { CullMode, RenderFlags, RenderState, Program, RenderArena, BlendMode } from '../render';
import Progressable from 'Progressable';
import { fetch } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';

class NITRO_Program extends Program {
    public texCoordMatLocation: WebGLUniformLocation;

    public static a_position = 0;
    public static a_uv = 1;
    public static a_color = 2;

    public vert = `
precision mediump float;
uniform mat4 u_modelView;
uniform mat4 u_projection;
uniform mat3 u_texCoordMat;
layout(location = ${NITRO_Program.a_position}) in vec3 a_position;
layout(location = ${NITRO_Program.a_uv}) in vec2 a_uv;
layout(location = ${NITRO_Program.a_color}) in vec4 a_color;
out vec4 v_color;
out vec2 v_uv;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
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

class BMDRenderer {
    public textures: Viewer.Texture[];
    public bmd: NITRO_BMD.BMD;
    public localScale: number;
    public crg1Level: CRG1Level;
    public isSkybox: boolean;
    public localMatrix: mat4;

    public opaqueCommands: RenderFunc[] = [];
    public transparentCommands: RenderFunc[] = [];

    private arena: RenderArena;

    constructor(gl: WebGL2RenderingContext, bmd: NITRO_BMD.BMD, localScale: number, crg1Level: CRG1Level) {
        this.bmd = bmd;
        this.localScale = localScale;
        this.crg1Level = crg1Level;
        this.isSkybox = false;
        this.arena = new RenderArena();

        this.textures = bmd.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.translateBMD(gl, this.bmd);

        const scaleFactor = this.bmd.scaleFactor * this.localScale;
        this.localMatrix = mat4.create();
        mat4.fromScaling(this.localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
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
        const crg1mat = this.crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name);
        const texCoordMat = mat3.create();
        mat3.fromMat2d(texCoordMat, material.texCoordMat);

        const renderFlags = new RenderFlags();
        renderFlags.blendMode = BlendMode.ADD;
        renderFlags.depthTest = true;
        renderFlags.depthWrite = material.depthWrite;
        renderFlags.cullMode = this.translateCullMode(material.renderWhichFaces);

        console.log(crg1mat);
        const texAnimMat = mat3.create();

        return (state: RenderState) => {
            function selectArray(arr: Float32Array, time: number): number {
                return arr[(time | 0) % arr.length];
            }

            if (crg1mat !== undefined) {
                const time = state.time / 30;
                const scale = selectArray(crg1mat.Scale, time);
                const rotation = selectArray(crg1mat.Rotation, time);
                const x = selectArray(crg1mat.X, time);
                const y = selectArray(crg1mat.Y, time);
                mat3.identity(texAnimMat);
                mat3.scale(texAnimMat, texAnimMat, [scale, scale]);
                mat3.rotate(texAnimMat, texAnimMat, rotation / 180 * Math.PI);
                mat3.translate(texAnimMat, texAnimMat, [-x, y]);
                mat3.fromMat2d(texCoordMat, material.texCoordMat);
                mat3.multiply(texCoordMat, texAnimMat, texCoordMat);
            }

            if (texture !== null) {
                const prog = (<NITRO_Program> state.currentProgram);
                gl.uniformMatrix3fv(prog.texCoordMatLocation, false, texCoordMat);
                gl.bindTexture(gl.TEXTURE_2D, texId);
            }

            state.useFlags(renderFlags);
        };
    }

    private translateBatch(gl: WebGL2RenderingContext, batch: NITRO_BMD.Batch): void {
        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);
        const func = (state: RenderState): void => {
            applyMaterial(state);
            renderPoly(state);
        };

        if (batch.material.isTranslucent)
            this.transparentCommands.push(func);
        else
            this.opaqueCommands.push(func);
    }

    private translateBMD(gl: WebGL2RenderingContext, bmd: NITRO_BMD.BMD) {
        for (const model of bmd.models)
            for (const batch of model.batches)
                this.translateBatch(gl, batch);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.arena.destroy(gl);
    }
}

function collectTextures(scenes: BMDRenderer[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class SM64DSRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    private program: NITRO_Program;

    constructor(public mainBMD: BMDRenderer, public skyboxBMD: BMDRenderer) {
        this.textures = collectTextures([this.mainBMD, this.skyboxBMD]);
        this.program = new NITRO_Program();
    }

    private runCommands(state: RenderState, funcs: RenderFunc[]) {
        funcs.forEach((func) => {
            func(state);
        });
    }

    public render(renderState: RenderState) {
        const gl = renderState.gl;

        renderState.useProgram(this.program);

        if (this.skyboxBMD) {
            renderState.bindModelView(true, this.skyboxBMD.localMatrix);
            this.runCommands(renderState, this.skyboxBMD.opaqueCommands);
            gl.clear(gl.DEPTH_BUFFER_BIT);
        } else {
            // No skybox? Black.
            gl.clearColor(0, 0, 0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        renderState.bindModelView(false, this.mainBMD.localMatrix);
        this.runCommands(renderState, this.mainBMD.opaqueCommands);
        this.runCommands(renderState, this.mainBMD.transparentCommands);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.mainBMD.destroy(gl);
        if (this.skyboxBMD)
            this.skyboxBMD.destroy(gl);
    }
}

interface CRG1TextureAnimation {
    MaterialName: string;
    Duration: number;
    Scale: Float32Array;
    Rotation: Float32Array;
    X: Float32Array;
    Y: Float32Array;
}

interface CRG1Level {
    MapBmdFile: string;
    VrboxBmdFile: string;
    TextureAnimations: CRG1TextureAnimation[];
}

interface Sm64DSCRG1 {
    Levels: CRG1Level[];
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
        return fetch('data/sm64ds/sm64ds.crg1').then((result: ArrayBufferSlice) => {
            const crg1 = <Sm64DSCRG1> <any> CRG1.parse(result);
            return this._createSceneFromCRG1(gl, crg1);
        });
    }

    private _createBMDRenderer(gl: WebGL2RenderingContext, filename: string, localScale: number, level: CRG1Level, isSkybox: boolean): PromiseLike<BMDRenderer> {
        return fetch(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const renderer = new BMDRenderer(gl, bmd, localScale, level);
            renderer.isSkybox = isSkybox;
            return renderer;
        });
    }

    private _createSceneFromCRG1(gl: WebGL2RenderingContext, crg1: Sm64DSCRG1): PromiseLike<Viewer.MainScene> {
        const level = crg1.Levels[this.levelId];
        const renderers = [this._createBMDRenderer(gl, level.MapBmdFile, 100, level, false)];
        if (level.VrboxBmdFile)
            renderers.push(this._createBMDRenderer(gl, level.VrboxBmdFile, 0.8, level, true));
        return Promise.all(renderers).then(([mainBMD, skyboxBMD]) => {
            return new SM64DSRenderer(mainBMD, skyboxBMD);
        });
    }
}
