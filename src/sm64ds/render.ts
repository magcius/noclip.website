
import { mat3, mat4, vec3 } from 'gl-matrix';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as NITRO_BMD from './nitro_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { CullMode, RenderFlags, RenderState, BlendMode, depthClearFlags } from '../render';
import Program from '../Program';
import Progressable from '../Progressable';
import RenderArena from '../RenderArena';
import { fetch } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { computeModelMatrixYBillboard, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';

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

interface Animation {
    updateModelMatrix(state: RenderState, modelMatrix: mat4): void;
}

class YSpinAnimation {
    constructor(public speed: number, public phase: number) {}
    updateModelMatrix(state: RenderState, modelMatrix: mat4) {
        const theta = this.phase + (state.time / 30 * this.speed);
        mat4.rotateY(modelMatrix, modelMatrix, theta);
    }
}

const scratchModelMatrix = mat4.create();
const scratchViewMatrix = mat4.create();
class BMDRenderer {
    public textures: Viewer.Texture[];
    public bmd: NITRO_BMD.BMD;
    public crg1Level: CRG1Level;
    public isSkybox: boolean;
    public localMatrix: mat4;
    public animation: Animation = null;

    public opaqueCommands: RenderFunc[] = [];
    public transparentCommands: RenderFunc[] = [];

    private arena: RenderArena;
    private program: NITRO_Program = new NITRO_Program();

    constructor(gl: WebGL2RenderingContext, bmd: NITRO_BMD.BMD, crg1Level: CRG1Level) {
        this.bmd = bmd;
        this.crg1Level = crg1Level;
        this.isSkybox = false;
        this.arena = new RenderArena();

        this.textures = bmd.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.translateBMD(gl, this.bmd);

        const scaleFactor = this.bmd.scaleFactor;
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
        const crg1mat = this.crg1Level ? this.crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name) : undefined;
        const texCoordMat = mat3.create();
        mat3.fromMat2d(texCoordMat, material.texCoordMat);

        const renderFlags = new RenderFlags();
        renderFlags.blendMode = BlendMode.ADD;
        renderFlags.depthTest = true;
        renderFlags.depthWrite = material.depthWrite;
        renderFlags.cullMode = this.translateCullMode(material.renderWhichFaces);

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

    public bindModelView(state: RenderState, isBillboard: boolean) {
        const gl = state.gl;
        const prog = this.program;

        // Build model matrix
        const modelMatrix = scratchModelMatrix;
        if (isBillboard) {
            // Apply billboard model if necessary.
            computeModelMatrixYBillboard(modelMatrix, state.camera);
            mat4.mul(modelMatrix, this.localMatrix, modelMatrix);
        } else {
            mat4.copy(modelMatrix, this.localMatrix);
        }

        if (this.animation !== null)
            this.animation.updateModelMatrix(state, modelMatrix);

        // Build view matrix
        const viewMatrix = scratchViewMatrix;
        if (this.isSkybox) {
            computeViewMatrixSkybox(viewMatrix, state.camera);
        } else {
            computeViewMatrix(viewMatrix, state.camera);
        }

        mat4.mul(viewMatrix, viewMatrix, modelMatrix);

        gl.uniformMatrix4fv(prog.projectionLocation, false, state.camera.projectionMatrix);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, viewMatrix);
    }

    private translateBatch(gl: WebGL2RenderingContext, model: NITRO_BMD.Model, batch: NITRO_BMD.Batch): void {
        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);

        const func = (state: RenderState): void => {
            state.useProgram(this.program);
            applyMaterial(state);
            this.bindModelView(state, model.billboard);
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
                this.translateBatch(gl, model, batch);
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

    constructor(public mainBMD: BMDRenderer, public skyboxBMD: BMDRenderer, public extraBMDs: BMDRenderer[]) {
        this.textures = collectTextures([this.mainBMD, this.skyboxBMD, ...this.extraBMDs]);
    }

    private runCommands(state: RenderState, funcs: RenderFunc[]) {
        funcs.forEach((func) => {
            func(state);
        });
    }

    public render(renderState: RenderState) {
        const gl = renderState.gl;

        if (this.skyboxBMD) {
            this.runCommands(renderState, this.skyboxBMD.opaqueCommands);
            renderState.useFlags(depthClearFlags);
            gl.clear(gl.DEPTH_BUFFER_BIT);
        } else {
            // No skybox? Black.
            gl.clearColor(0, 0, 0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Opaque.
        this.runCommands(renderState, this.mainBMD.opaqueCommands);
        this.extraBMDs.forEach((bmd) => {
            this.runCommands(renderState, bmd.opaqueCommands);
        });

        // Transparent.
        this.runCommands(renderState, this.mainBMD.transparentCommands);
        this.extraBMDs.forEach((bmd) => {
            this.runCommands(renderState, bmd.transparentCommands);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.mainBMD.destroy(gl);
        if (this.skyboxBMD)
            this.skyboxBMD.destroy(gl);
        this.extraBMDs.forEach((renderer) => renderer.destroy(gl));
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

interface CRG1Object {
    Area: number;
    Setup: number;
    ObjectId: number;
    Position: { X: number, Y: number, Z: number };
    Rotation: { Y: number };
    Parameters: number[];
}

interface CRG1Level {
    MapBmdFile: string;
    VrboxBmdFile: string;
    TextureAnimations: CRG1TextureAnimation[];
    Objects: CRG1Object[];
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
            const crg1 = <Sm64DSCRG1> <any> BYML.parse(result, BYML.FileType.CRG1);
            return this._createSceneFromCRG1(gl, crg1);
        });
    }

    private _createBMDRenderer(gl: WebGL2RenderingContext, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): PromiseLike<BMDRenderer> {
        return fetch(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const renderer = new BMDRenderer(gl, bmd, level);
            mat4.scale(renderer.localMatrix, renderer.localMatrix, [scale, scale, scale]);
            renderer.isSkybox = isSkybox;
            return renderer;
        });
    }

    private _createBMDObjRenderer(gl: WebGL2RenderingContext, filename: string, translation: vec3, rotationY: number, scale: number = 1, spinSpeed: number = 0): PromiseLike<BMDRenderer> {
        return fetch(`data/sm64ds/${filename}`).then((result: ArrayBufferSlice) => {
            result = LZ77.maybeDecompress(result);
            const bmd = NITRO_BMD.parse(result);
            const renderer = new BMDRenderer(gl, bmd, null);
            vec3.scale(translation, translation, 16 / bmd.scaleFactor);
            mat4.translate(renderer.localMatrix, renderer.localMatrix, translation);
            mat4.rotateY(renderer.localMatrix, renderer.localMatrix, rotationY);
            mat4.scale(renderer.localMatrix, renderer.localMatrix, [scale, scale, scale]);

            if (spinSpeed > 0) {
                const spinPhase = Math.random() * Math.PI * 2;
                renderer.animation = new YSpinAnimation(spinSpeed, spinPhase);
            }

            return renderer;
        });
    }

    private _createBMDRendererForObject(gl: WebGL2RenderingContext, object: CRG1Object): PromiseLike<BMDRenderer> {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
        // WTF is with the Tau? And the object scales?
        vec3.scale(translation, translation, Math.PI * 2);

        const rotationY = object.Rotation.Y / 180 * Math.PI;

        switch (object.ObjectId) {
        case 7: // Up/down lift thingy
        case 9: // Pathlift?
        case 10: // Chain Chomp (copy/pasted)
        case 13: // LONELY ROLLING BALL
        case 15: // Goomba
        case 19: // Bob-omb
        case 20: // Friendly Bob-omb
        case 21: // Koopa
            return null;
        case 23: // Brick Block
            return this._createBMDObjRenderer(gl, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 0.8);
        case 24: // Brick Block Larger
            return this._createBMDObjRenderer(gl, `normal_obj/obj_block/broken_block_l.bmd`, translation, rotationY, 1.2);
        case 26: // Powerup inside block?
        case 29: // Cannon hatch
            return null;
        case 30: // Item Block
            return this._createBMDObjRenderer(gl, `normal_obj/obj_hatena_box/hatena_box.bmd`, translation, rotationY, 0.8);
        case 36: // Pole
            return this._createBMDObjRenderer(gl, `normal_obj/obj_pile/pile.bmd`, translation, rotationY, 0.8);
        case 37: // Coin
            return this._createBMDObjRenderer(gl, `normal_obj/coin/coin_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 38: // Red Coin
            return this._createBMDObjRenderer(gl, `normal_obj/coin/coin_red_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 39: // Blue Coin
            return this._createBMDObjRenderer(gl, `normal_obj/coin/coin_blue_poly32.bmd`, translation, rotationY, 0.8, 0.1);
        case 41: { // Tree
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            return this._createBMDObjRenderer(gl, filename, translation, rotationY);
        }
        case 42: { // Castle Painting
            const painting = (object.Parameters[0] >>> 8) & 0x1F;
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `picture/${filenames[painting]}.bmd`;
            const scale = ((object.Parameters[0] & 0xF) + 1);
            translation[1] += scale * 0.3;
            return this._createBMDObjRenderer(gl, filename, translation, rotationY, scale);
        }
        case 43: // Switch
        case 44: // Switch-powered Star
        case 45: // Switch-powered Trapdoor
        case 48: // Chain Chomp Unchained
        case 49: // 1-up
        case 50: // Cannon
        case 51: // Chain-chomp fence (BoB)
        case 52: // Water bombs (BoB)
        case 53: // Birds
        case 54: // Fish
        case 55: // Butterflies
        case 56: // Super Bob Fuckan Omb Bob-Omb In BoB (the summit)
        case 59: // Pirahna Plant
        case 60: // Star Camera Path
        case 61: // Star Target
            return null;
        case 62: // Silver Star
            return this._createBMDObjRenderer(gl, `normal_obj/star/obj_star_silver.bmd`, translation, rotationY, 0.8, 0.08);
        case 63: // Star
            return this._createBMDObjRenderer(gl, `normal_obj/star/obj_star.bmd`, translation, rotationY, 0.8, 0.08);
        case 64: // Whomp
        case 65: // Big Whomp
        case 66: // Thwomp
        case 67: // Boo
        case 74: // Minigame Cabinet Trigger (Invisible)
            return null;
        case 75: // Wall sign
            return this._createBMDObjRenderer(gl, `normal_obj/obj_kanban/obj_kanban.bmd`, translation, rotationY, 0.8);
        case 76: // Signpost
            return this._createBMDObjRenderer(gl, `normal_obj/obj_tatefuda/obj_tatefuda.bmd`, translation, rotationY, 0.8);
        case 79: // Heart
        case 80: // Toad
        case 167: // Peach's Castle Tippy TTC Hour Hand
        case 168: // Peach's Castle Tippy TTC Minute Hand
        case 169: // Peach's Castle Tippy TTC Pendulum
            return null;
        case 187: // Left Arrow Sign
            return this._createBMDObjRenderer(gl, `normal_obj/obj_yajirusi_l/yajirusi_l.bmd`, translation, rotationY, 0.8);
        case 188: // Right Arrow Sign
            return this._createBMDObjRenderer(gl, `normal_obj/obj_yajirusi_r/yajirusi_r.bmd`, translation, rotationY, 0.8);
        case 196: // WF
        case 197: // WF
        case 198: // WF
        case 199: // WF
        case 200: // WF
        case 201: // WF
        case 202: // WF
        case 203: // WF Tower
            return null;
        case 204: // WF Spinning Island
            return this._createBMDObjRenderer(gl, `special_obj/bk_ukisima/bk_ukisima.bmd`, translation, rotationY, 1, 0.1);
        case 205: // WF
        case 206: // WF
        case 207: // WF
        case 208: // WF
        case 209: // WF
        case 228: // Switch Pillar
        case 237: // MIPS
        case 239: // That Stupid Owl™
        case 243: // Invisible pole hitbox
        case 244: // Lakitu
        case 254: // Mario's Iconic Cap
        case 264: // Red Flame
        case 265: // Blue Flame
        case 269: // 1-Up Mushroom Inside Block
        case 270: // Some brick thing?
        case 273: // Peach's Castle First Floor Trapdoor
        case 274: // Peach's Castle First Floor Light Beam
        case 275: // Peach's Castle First Floor Peach/Bowser Fade Painting
        case 281: // Koopa the Quick
        case 282: // Koopa the Quick Finish Flag
            return null;
        case 284: // Wario Block
            return this._createBMDObjRenderer(gl, `normal_obj/obj_block/broken_block_ll.bmd`, translation, rotationY);
        case 293: // Water
            return this._createBMDObjRenderer(gl, `special_obj/mc_water/mc_water.bmd`, translation, rotationY, 0.8);
        case 295: // Metal net
            return this._createBMDObjRenderer(gl, `special_obj/mc_metalnet/mc_metalnet.bmd`, translation, rotationY, 0.8);
        case 298: // Flag
            return this._createBMDObjRenderer(gl, `special_obj/mc_flag/mc_flag.bmd`, translation, rotationY, 0.8);
        case 303: // Castle Basement Water
        case 304: // Secret number thingy
            return null;
        case 305: // Blue Coin Switch
            return this._createBMDObjRenderer(gl, `normal_obj/b_coin_switch/b_coin_switch.bmd`, translation, rotationY, 0.8);
        case 314: // Hidden Pirahna Plant
        case 315: // Enemy spawner trigger
        case 316: // Enemy spawner
        case 323: // Ambient sound effects
        case 324: // Music
        case 511: // Appears to be a bug in the level layout
            return null;
        default:
            console.warn(`Unknown object type ${object.ObjectId}`);
            return null;
        }
    }

    private _createSceneFromCRG1(gl: WebGL2RenderingContext, crg1: Sm64DSCRG1): PromiseLike<Viewer.MainScene> {
        const level = crg1.Levels[this.levelId];
        const renderers = [this._createBMDRenderer(gl, level.MapBmdFile, 100, level, false)];
        if (level.VrboxBmdFile)
            renderers.push(this._createBMDRenderer(gl, level.VrboxBmdFile, 0.8, level, true));
        else
            renderers.push(Promise.resolve(null));
        for (const object of level.Objects) {
            const objRenderer = this._createBMDRendererForObject(gl, object);
            if (objRenderer)
            renderers.push(objRenderer);
        }
        return Promise.all(renderers).then(([mainBMD, skyboxBMD, ...extraBMDs]) => {
            return new SM64DSRenderer(mainBMD, skyboxBMD, extraBMDs);
        });
    }
}
