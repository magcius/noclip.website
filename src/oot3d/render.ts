
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { SimpleProgram } from '../Program';
import RenderArena from '../RenderArena';
import AnimationController from '../AnimationController';
import { mat4 } from 'gl-matrix';

class OoT3D_Program extends SimpleProgram {
    public u_PosScale: WebGLUniformLocation;
    public u_TexCoordScale: WebGLUniformLocation;
    public u_AlphaTest: WebGLUniformLocation;
    public u_TexCoordMtx: WebGLUniformLocation;
    public u_LocalMatrix: WebGLUniformLocation;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public vert = `
precision mediump float;

uniform mat4 u_modelView;
uniform mat4 u_projection;

uniform mat4 u_LocalMatrix;
uniform float u_PosScale;
uniform float u_TexCoordScale;
uniform mat4 u_TexCoordMtx;
layout(location = ${OoT3D_Program.a_Position}) in vec3 a_Position;
layout(location = ${OoT3D_Program.a_Normal}) in vec3 a_Normal;
layout(location = ${OoT3D_Program.a_Color}) in vec4 a_Color;
layout(location = ${OoT3D_Program.a_TexCoord}) in vec2 a_TexCoord;
varying vec4 v_Color;
varying vec2 v_TexCoord;
varying float v_LightIntensity;

void main() {
    gl_Position = u_projection * u_modelView * u_LocalMatrix * vec4(a_Position, 1.0) * u_PosScale;
    v_Color = a_Color;
    vec2 t_TexCoord = a_TexCoord * u_TexCoordScale;
    v_TexCoord = (u_TexCoordMtx * vec4(t_TexCoord, 0.0, 1.0)).st;
    v_TexCoord.t = 1.0 - v_TexCoord.t;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_LightIntensity = dot(-a_Normal, t_LightDirection);

    // Hacky Ambient.
    v_LightIntensity = clamp(v_LightIntensity + 0.6, 0.0, 1.0);
}`;

    public frag = `
precision mediump float;
uniform sampler2D u_Sampler;
uniform bool u_AlphaTest;

varying vec2 v_TexCoord;
varying vec4 v_Color;
varying float v_LightIntensity;

void main() {
    vec4 t_Color = texture2D(u_Sampler, v_TexCoord) * v_Color;
    t_Color.rgb *= v_LightIntensity;
    if (u_AlphaTest && t_Color.a <= 0.8)
        discard;
    gl_FragColor = t_Color;
}`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        this.u_PosScale = gl.getUniformLocation(prog, "u_PosScale");
        this.u_TexCoordScale = gl.getUniformLocation(prog, "u_TexCoordScale");
        this.u_AlphaTest = gl.getUniformLocation(prog, "u_AlphaTest");
        this.u_TexCoordMtx = gl.getUniformLocation(prog, "u_TexCoordMtx");
        this.u_LocalMatrix = gl.getUniformLocation(prog, "u_LocalMatrix");
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

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', CMB.getTextureFormatName(texture.format));

    return { name: texture.name, surfaces, extraInfo };
}

type RenderFunc = (renderState: RenderState) => void;

interface CmbContext {
    posBuffer: WebGLBuffer;
    colBuffer: WebGLBuffer | null;
    nrmBuffer: WebGLBuffer | null;
    txcBuffer: WebGLBuffer | null;
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
    public boneMatrices: mat4[] = [];

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
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.channelIndex === 0 && animEntry.animationType === CMAB.AnimationType.XY_SCROLL)
                this.materialAnimators[animEntry.materialIndex] = new CMAB.TextureAnimator(this.animationController, cmab, animEntry);
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

    private translateSepd(gl: WebGL2RenderingContext, cmbContext: CmbContext, sepd: CMB.Sepd): RenderFunc {
        const vao = this.arena.createVertexArray(gl);
        gl.bindVertexArray(vao);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cmbContext.idxBuffer);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_Position, 3, this.translateDataType(gl, sepd.posType), false, 0, sepd.posStart);
        gl.enableVertexAttribArray(OoT3D_Program.a_Position);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.nrmBuffer);
        gl.vertexAttribPointer(OoT3D_Program.a_Normal, 3, this.translateDataType(gl, sepd.nrmType), true, 0, sepd.nrmStart);
        gl.enableVertexAttribArray(OoT3D_Program.a_Normal);

        if (cmbContext.colBuffer !== null) {
            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
            gl.vertexAttribPointer(OoT3D_Program.a_Color, 4, this.translateDataType(gl, sepd.colType), true, 0, sepd.colStart);
            gl.enableVertexAttribArray(OoT3D_Program.a_Color);
        } else {
            gl.vertexAttrib4f(OoT3D_Program.a_Color, 1.0, 1.0, 1.0, 1.0);
        }

        if (cmbContext.txcBuffer !== null) {
            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
            gl.vertexAttribPointer(OoT3D_Program.a_TexCoord, 2, this.translateDataType(gl, sepd.txcType), false, 0, sepd.txcStart);
            gl.enableVertexAttribArray(OoT3D_Program.a_TexCoord);
        }

        gl.bindVertexArray(null);

        return (state: RenderState) => {
            gl.uniform1f(this.program.u_TexCoordScale, sepd.txcScale);
            gl.uniform1f(this.program.u_PosScale, sepd.posScale);

            gl.bindVertexArray(vao);

            for (let i = 0; i < sepd.prms.length; i++) {
                const prms = sepd.prms[i];
                const prm = prms.prm;

                const localMatrixId = prms.boneTable[0];
                const boneMatrix = this.boneMatrices[localMatrixId];
                gl.uniformMatrix4fv(this.program.u_LocalMatrix, false, boneMatrix);

                gl.drawElements(gl.TRIANGLES, prm.count, this.translateDataType(gl, prm.indexType), prm.offset);
            }

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

        let colBuffer: WebGLBuffer | null = null;
        if (cmb.vertexBufferSlices.colBuffer.byteLength > 0) {
            colBuffer = this.arena.createBuffer(gl);
            gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.colBuffer.castToBuffer(), gl.STATIC_DRAW);
        }

        let nrmBuffer: WebGLBuffer | null = null;
        if (cmb.vertexBufferSlices.nrmBuffer.byteLength > 0) {
            nrmBuffer = this.arena.createBuffer(gl);
            gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.nrmBuffer.castToBuffer(), gl.STATIC_DRAW);
        }

        let txcBuffer: WebGLBuffer | null = null;
        if (cmb.vertexBufferSlices.txcBuffer.byteLength > 0) {
            txcBuffer = this.arena.createBuffer(gl);
            gl.bindBuffer(gl.ARRAY_BUFFER, txcBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.txcBuffer.castToBuffer(), gl.STATIC_DRAW);
        }

        const textures: WebGLTexture[] = cmb.textures.map((texture) => {
            return this.translateTexture(gl, texture);
        });

        const idxBuffer = this.arena.createBuffer(gl);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cmb.indexBuffer.castToBuffer(), gl.STATIC_DRAW);

        for (let i = 0; i < cmb.bones.length; i++) {
            const bone = cmb.bones[i];
            this.boneMatrices[bone.boneId] = mat4.create();
            if (bone.parentBoneId >= 0) {
                mat4.mul(this.boneMatrices[bone.boneId], this.boneMatrices[bone.parentBoneId], bone.modelMatrix);
            } else {
                mat4.copy(this.boneMatrices[bone.boneId], bone.modelMatrix);
            }
        }

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
            for (let i = 0; i < meshFuncs.length; i++)
                meshFuncs[i](state);
        };
    }
}

const scratchMatrix = mat4.create();
export class RoomRenderer implements Viewer.Scene {
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
