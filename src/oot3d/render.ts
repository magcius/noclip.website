
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZAR from './zar';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import Progressable from '../Progressable';
import { RenderState } from '../render';
import { SimpleProgram } from '../Program';
import RenderArena from '../RenderArena';
import { fetch, assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import AnimationController from '../AnimationController';
import { mat4 } from 'gl-matrix';

class OoT3D_Program extends SimpleProgram {
    public u_PosScale: WebGLUniformLocation;
    public u_TexCoordScale: WebGLUniformLocation;
    public u_AlphaTest: WebGLUniformLocation;
    public u_TexCoordMtx: WebGLUniformLocation;

    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_localMatrix;
uniform mat4 u_projection;
uniform float u_PosScale;
uniform float u_TexCoordScale;
uniform mat4 u_TexCoordMtx;
layout(location = ${OoT3D_Program.a_Position}) in vec3 a_Position;
layout(location = ${OoT3D_Program.a_Color}) in vec4 a_Color;
layout(location = ${OoT3D_Program.a_TexCoord}) in vec2 a_TexCoord;
varying vec4 v_Color;
varying vec2 v_TexCoord;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_Position, 1.0) * u_PosScale;
    v_Color = a_Color;
    vec2 t_TexCoord = a_TexCoord * u_TexCoordScale;
    v_TexCoord = (u_TexCoordMtx * vec4(t_TexCoord, 0.0, 1.0)).st;
    v_TexCoord.t = 1.0 - v_TexCoord.t;
}`;

    public frag = `
precision mediump float;
varying vec2 v_TexCoord;
varying vec4 v_Color;
uniform sampler2D u_Sampler;
uniform bool u_AlphaTest;

void main() {
    gl_FragColor = texture2D(u_Sampler, v_TexCoord);
    gl_FragColor *= v_Color;
    if (u_AlphaTest && gl_FragColor.a <= 0.8)
        discard;
}`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.u_PosScale = gl.getUniformLocation(prog, "u_PosScale");
        this.u_TexCoordScale = gl.getUniformLocation(prog, "u_TexCoordScale");
        this.u_AlphaTest = gl.getUniformLocation(prog, "u_AlphaTest");
        this.u_TexCoordMtx = gl.getUniformLocation(prog, "u_TexCoordMtx");
    }
}

function textureToCanvas(texture: CMB.Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < imgData.data.length; i++)
        imgData.data[i] = texture.pixels[i];

    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    return { name: texture.name, surfaces };
}

type RenderFunc = (renderState: RenderState) => void;

interface CmbContext {
    posBuffer: WebGLBuffer;
    colBuffer: WebGLBuffer;
    nrmBuffer: WebGLBuffer;
    txcBuffer: WebGLBuffer;
    idxBuffer: WebGLBuffer;
    textures: WebGLBuffer[];

    sepdFuncs: RenderFunc[];
    matFuncs: RenderFunc[];
}

export class CmbRenderer {
    public program = new OoT3D_Program();
    public arena = new RenderArena();
    public animationController = new AnimationController();
    public materialAnimators: CMAB.TextureAnimator[] = [];
    public model: RenderFunc;
    public visible: boolean = true;
    public textures: Viewer.Texture[] = [];

    constructor(gl: WebGL2RenderingContext, public cmb: CMB.CMB, public name: string = '') {
        this.program = new OoT3D_Program();
        this.arena = new RenderArena();
        this.model = this.translateCmb(gl, cmb);
        this.textures = cmb.textures.map((tex) => textureToCanvas(tex));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        this.animationController.updateTime(state.time);
        state.useProgram(this.program);
        state.bindModelView();
        this.model(state);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.arena.destroy(gl);
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        // TODO(jstpierre): Support better stuff here when we get a better renderer...
        for (const animEntry of cmab.animEntries) {
            if (animEntry.channelIndex === 0 && animEntry.animationType === CMAB.AnimationType.XY_SCROLL) {
                this.materialAnimators[animEntry.materialIndex] = new CMAB.TextureAnimator(this.animationController, cmab, animEntry);
            }
        }
    }

    private translateDataType(gl: WebGL2RenderingContext, dataType: CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return gl.BYTE;
            case CMB.DataType.UByte:  return gl.UNSIGNED_BYTE;
            case CMB.DataType.Short:  return gl.SHORT;
            case CMB.DataType.UShort: return gl.UNSIGNED_SHORT;
            case CMB.DataType.Int:    return gl.INT;
            case CMB.DataType.UInt:   return gl.UNSIGNED_INT;
            case CMB.DataType.Float:  return gl.FLOAT;
            default: throw new Error();
        }
    }

    private dataTypeSize(dataType: CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return 1;
            case CMB.DataType.UByte:  return 1;
            case CMB.DataType.Short:  return 2;
            case CMB.DataType.UShort: return 2;
            case CMB.DataType.Int:    return 4;
            case CMB.DataType.UInt:   return 4;
            case CMB.DataType.Float:  return 4;
            default: throw new Error();
        }
    }

    private translateSepd(gl: WebGL2RenderingContext, cmbContext: CmbContext, sepd: CMB.Sepd): RenderFunc {
        const vao = this.arena.createVertexArray(gl);
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cmbContext.idxBuffer);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_Position, 3, this.translateDataType(gl, sepd.posType), false, 0, sepd.posStart);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_Color, 4, this.translateDataType(gl, sepd.colType), true, 0, sepd.colStart);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_TexCoord, 2, this.translateDataType(gl, sepd.txcType), false, 0, sepd.txcStart);

        gl.enableVertexAttribArray(OoT3D_Program.a_Position);
        gl.enableVertexAttribArray(OoT3D_Program.a_Color);
        gl.enableVertexAttribArray(OoT3D_Program.a_TexCoord);

        gl.bindVertexArray(null);

        return (state: RenderState) => {
            gl.uniform1f(this.program.u_TexCoordScale, sepd.txcScale);
            gl.uniform1f(this.program.u_PosScale, sepd.posScale);

            gl.bindVertexArray(vao);

            for (const prm of sepd.prms)
                gl.drawElements(gl.TRIANGLES, prm.count, this.translateDataType(gl, prm.indexType), prm.offset * this.dataTypeSize(prm.indexType));

            gl.bindVertexArray(null);
        };
    }

    private translateTexture(gl: WebGL2RenderingContext, texture: CMB.Texture): WebGLTexture {
        const texId = this.arena.createTexture(gl);
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        return texId;
    }

    private translateMaterial(gl: WebGL2RenderingContext, cmbContext: CmbContext, material: CMB.Material): RenderFunc {
        function translateWrapMode(wrapMode: CMB.TextureWrapMode) {
            switch (wrapMode) {
            case CMB.TextureWrapMode.CLAMP: return gl.CLAMP_TO_EDGE;
            case CMB.TextureWrapMode.CLAMP_TO_EDGE: return gl.CLAMP_TO_EDGE;
            case CMB.TextureWrapMode.REPEAT: return gl.REPEAT;
            case CMB.TextureWrapMode.MIRRORED_REPEAT: return gl.MIRRORED_REPEAT;
            default: throw new Error();
            }
        }

        function translateTextureFilter(filter: CMB.TextureFilter) {
            switch (filter) {
            case CMB.TextureFilter.LINEAR: return gl.LINEAR;
            case CMB.TextureFilter.NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR: return gl.NEAREST;
            default: throw new Error();
            }
        }

        return (state: RenderState): void => {
            state.useFlags(material.renderFlags);

            gl.uniform1i(this.program.u_AlphaTest, material.alphaTestEnable ? 1 : 0);

            if (this.materialAnimators[material.index] !== undefined) {
                this.materialAnimators[material.index].calcTexMtx(scratchMatrix);
            } else {
                mat4.identity(scratchMatrix);
            }

            gl.uniformMatrix4fv(this.program.u_TexCoordMtx, false, scratchMatrix);

            for (let i = 0; i < 1; i++) {
                const binding = material.textureBindings[i];
                if (binding.textureIdx === -1)
                    continue;

                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, cmbContext.textures[binding.textureIdx]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, translateTextureFilter(binding.minFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, translateTextureFilter(binding.magFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrapMode(binding.wrapS));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrapMode(binding.wrapT));
            }
        };
    }

    private translateMesh(gl: WebGL2RenderingContext, cmbContext: CmbContext, mesh: CMB.Mesh): RenderFunc {
        const mat = cmbContext.matFuncs[mesh.matsIdx];
        const sepd = cmbContext.sepdFuncs[mesh.sepdIdx];

        return (state: RenderState): void => {
            mat(state);
            sepd(state);
        };
    }

    private translateCmb(gl: WebGL2RenderingContext, cmb: CMB.CMB): RenderFunc {
        const posBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.posBuffer.castToBuffer(), gl.STATIC_DRAW);

        const colBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.colBuffer.castToBuffer(), gl.STATIC_DRAW);

        const nrmBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.nrmBuffer.castToBuffer(), gl.STATIC_DRAW);

        const txcBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ARRAY_BUFFER, txcBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.txcBuffer.castToBuffer(), gl.STATIC_DRAW);

        const textures: WebGLTexture[] = cmb.textures.map((texture) => {
            return this.translateTexture(gl, texture);
        });

        const idxBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cmb.indexBuffer.castToBuffer(), gl.STATIC_DRAW);

        const cmbContext: CmbContext = {
            posBuffer,
            colBuffer,
            nrmBuffer,
            txcBuffer,
            idxBuffer,
            textures,
            sepdFuncs: [],
            matFuncs: [],
        };

        cmbContext.sepdFuncs = cmb.sepds.map((sepd) => this.translateSepd(gl, cmbContext, sepd));
        cmbContext.matFuncs = cmb.materials.map((material) => this.translateMaterial(gl, cmbContext, material));

        const meshFuncs = cmb.meshs.map((mesh) => this.translateMesh(gl, cmbContext, mesh));

        return (state: RenderState) => {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            for (const func of meshFuncs)
                func(state);
        };
    }
}

const scratchMatrix = mat4.create();
class RoomRenderer implements Viewer.Scene {
    public visible: boolean = true;
    public textures: Viewer.Texture[];
    public opaqueMesh: CmbRenderer | null;
    public transparentMesh: CmbRenderer | null;

    constructor(gl: WebGL2RenderingContext, public zsi: ZSI.ZSI, public name: string) {
        const mesh = zsi.mesh;

        this.opaqueMesh = mesh.opaque !== null ? new CmbRenderer(gl, mesh.opaque) : null;
        this.transparentMesh = mesh.transparent !== null ? new CmbRenderer(gl, mesh.transparent) : null;

        // TODO(jstpierre): TextureHolder.
        this.textures = [];
        if (this.opaqueMesh !== null)
            this.textures = this.textures.concat(this.opaqueMesh.textures);
        if (this.transparentMesh !== null)
            this.textures = this.textures.concat(this.transparentMesh.textures);
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.bindCMAB(cmab);
        if (this.transparentMesh !== null)
            this.transparentMesh.bindCMAB(cmab);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public render(state: RenderState) {
        if (!this.visible)
            return;

        if (this.opaqueMesh !== null)
            this.opaqueMesh.render(state);
        if (this.transparentMesh !== null)
            this.transparentMesh.render(state);
    }

    public destroy(gl: WebGL2RenderingContext) {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(gl);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(gl);
    }
}

class MultiScene implements Viewer.MainScene {
    public scenes: RoomRenderer[];
    public textures: Viewer.Texture[];

    constructor(scenes: RoomRenderer[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public createPanels(): UI.Panel[] {
        const layerPanel = new UI.LayerPanel();
        layerPanel.setLayers(this.scenes);
        return [layerPanel];
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public name: string;
    public id: string;

    constructor(name: string, id: string) {
        this.name = name;
        this.id = id;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        // Fetch the ZAR & info ZSI.
        const path_zar = `data/oot3d/${this.id}.zar`;
        const path_info_zsi = `data/oot3d/${this.id}_info.zsi`;
        return Progressable.all([fetch(path_zar), fetch(path_info_zsi)]).then(([zar, zsi]) => {
            return this._createSceneFromData(gl, zar, zsi);
        });
    }

    private _createSceneFromData(gl: WebGL2RenderingContext, zarBuffer: ArrayBufferSlice, zsiBuffer: ArrayBufferSlice): Progressable<Viewer.MainScene> {
        const zar = ZAR.parse(zarBuffer);

        const zsi = ZSI.parse(zsiBuffer);
        assert(zsi.rooms !== null);
        const roomFilenames = zsi.rooms.map((romPath) => {
            const filename = romPath.split('/').pop();
            return `data/oot3d/${filename}`;
        });

        return Progressable.all(roomFilenames.map((filename, i) => {
            return fetch(filename).then((roomResult) => {
                const zsi = ZSI.parse(roomResult);
                assert(zsi.mesh !== null);
                const roomRenderer = new RoomRenderer(gl, zsi, filename);
                const cmabFile = zar.files.find((file) => file.name.startsWith(`ROOM${i}`) && file.name.endsWith('.cmab'));
                if (cmabFile) {
                    const cmab = CMAB.parse(cmabFile.buffer);
                    roomRenderer.bindCMAB(cmab);
                }
                return new Progressable(Promise.resolve(roomRenderer));
            });
        })).then((scenes: RoomRenderer[]) => {
            return new MultiScene(scenes);
        });
    }
}
