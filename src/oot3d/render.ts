
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { DeviceProgram } from '../Program';
import RenderArena from '../RenderArena';
import AnimationController from '../AnimationController';
import { mat4 } from 'gl-matrix';
import { getTransitionDeviceForWebGL2, getPlatformBuffer } from '../gfx/platform/GfxPlatformWebGL2';
import { GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3 } from '../gfx/helpers/BufferHelpers';
import { colorNew, colorFromRGBA } from '../Color';

class OoT3D_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public both = `
precision mediump float;
    
// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_MaterialColor;
    mat4x3 u_TexMtx[1];
    vec4 u_MaterialMisc;
};

#define u_AlphaReference (u_MaterialMisc[0])

layout(row_major, std140) uniform ub_PrmParams {
    mat4x3 u_BoneMatrix[1];
    vec4 u_PrmMisc[1];
};

uniform sampler2D u_Texture[1];

#define u_PosScale (u_PrmMisc[0][0])
#define u_TexCoordScale (u_PrmMisc[0][1])

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying float v_LightIntensity;
`;

    public vert = `
layout(location = ${OoT3D_Program.a_Position}) in vec3 a_Position;
layout(location = ${OoT3D_Program.a_Normal}) in vec3 a_Normal;
layout(location = ${OoT3D_Program.a_Color}) in vec4 a_Color;
layout(location = ${OoT3D_Program.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    vec4 t_Position = vec4(a_Position * u_PosScale, 1.0);
    gl_Position = u_Projection * mat4(u_BoneMatrix[0]) * t_Position;

    v_Color = a_Color;

    vec2 t_TexCoord = a_TexCoord * u_TexCoordScale;
    v_TexCoord = (u_TexMtx[0] * vec4(t_TexCoord, 0.0, 1.0)).st;
    v_TexCoord.t = 1.0 - v_TexCoord.t;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    // Disable normals for now until I can solve them.
    v_LightIntensity = 1.0;
    // v_LightIntensity = dot(-a_Normal, t_LightDirection);

    // Hacky Ambient.
    v_Color.rgb = clamp(v_Color.rgb + 0.3, vec3(0), vec3(1));
    v_LightIntensity = clamp(v_LightIntensity + 0.6, 0.0, 1.0);
}`;

    public frag = `
void main() {
    vec4 t_Color = texture2D(u_Texture[0], v_TexCoord) * v_Color;

    t_Color.rgb *= v_LightIntensity;
    t_Color *= u_MaterialColor;

    if (t_Color.a <= u_AlphaReference)
        discard;

    gl_FragColor = t_Color;
}`;
}

function fillSceneParamsData(d: Float32Array, state: RenderState, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, state.camera.projectionMatrix);
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

const scratchMatrix = mat4.create();
const scratchColor = colorNew(0, 0, 0, 1);

export class CmbRenderer {
    public program = new OoT3D_Program();
    public arena = new RenderArena();
    public animationController = new AnimationController();
    public srtAnimators: CMAB.TextureAnimator[] = [];
    public colorAnimators: CMAB.ColorAnimator[] = [];
    public model: RenderFunc;
    public visible: boolean = true;
    public textures: Viewer.Texture[] = [];
    public boneMatrices: mat4[] = [];

    private sceneParamsBuffer: GfxBuffer;
    private materialParamsBuffer: GfxBuffer;
    private prmParamsBuffer: GfxBuffer;
    private scratchParams = new Float32Array(64);

    constructor(gl: WebGL2RenderingContext, public cmb: CMB.CMB, public name: string = '') {
        const device = getTransitionDeviceForWebGL2(gl);

        this.arena = new RenderArena();
        this.model = this.translateCmb(gl, cmb);
        this.textures = cmb.textures.map((tex) => textureToCanvas(tex));

        const prog = device.createProgram(this.program);
        const uniformBuffers = device.queryProgram(prog).uniformBuffers;
        this.sceneParamsBuffer = device.createBuffer(uniformBuffers[0].totalWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.materialParamsBuffer = device.createBuffer(uniformBuffers[1].totalWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.prmParamsBuffer = device.createBuffer(uniformBuffers[2].totalWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
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
        const device = getTransitionDeviceForWebGL2(gl);
        this.arena.destroy(gl);
        device.destroyBuffer(this.sceneParamsBuffer);
        device.destroyBuffer(this.materialParamsBuffer);
        device.destroyBuffer(this.prmParamsBuffer);
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        // TODO(jstpierre): Support better stuff here when we get a better renderer...
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.channelIndex === 0) {
                if (animEntry.animationType === CMAB.AnimationType.TRANSLATION || animEntry.animationType === CMAB.AnimationType.ROTATION) {
                    this.srtAnimators[animEntry.materialIndex] = new CMAB.TextureAnimator(this.animationController, cmab, animEntry);
                } else if (animEntry.animationType === CMAB.AnimationType.UNK_04) {
                    this.colorAnimators[animEntry.materialIndex] = new CMAB.ColorAnimator(this.animationController, cmab, animEntry);
                }
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
            gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.prmParamsBuffer));

            gl.bindVertexArray(vao);

            for (let i = 0; i < sepd.prms.length; i++) {
                const prms = sepd.prms[i];
                const prm = prms.prm;

                const localMatrixId = prms.boneTable[0];
                const boneMatrix = this.boneMatrices[localMatrixId];
                mat4.mul(scratchMatrix, state.view, boneMatrix);

                let offs = 0;
                offs += fillMatrix4x3(this.scratchParams, offs, scratchMatrix);
                offs += fillVec4(this.scratchParams, offs, sepd.posScale, sepd.txcScale);

                gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.prmParamsBuffer));
                gl.bufferData(gl.UNIFORM_BUFFER, this.scratchParams, gl.DYNAMIC_DRAW);
    
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

            let offs = 0;
            if (this.colorAnimators[material.index]) {
                this.colorAnimators[material.index].calcMaterialColor(scratchColor);
            } else {
                colorFromRGBA(scratchColor, 1, 1, 1, 1);
            }
            offs += fillColor(this.scratchParams, offs, scratchColor);

            if (this.srtAnimators[material.index]) {
                this.srtAnimators[material.index].calcTexMtx(scratchMatrix);
            } else {
                mat4.identity(scratchMatrix);
            }
            offs += fillMatrix4x3(this.scratchParams, offs, scratchMatrix);

            const alphaReference = material.alphaTestEnable ? 1 : 0;
            offs += fillVec4(this.scratchParams, offs, alphaReference);

            gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.materialParamsBuffer));
            gl.bufferData(gl.UNIFORM_BUFFER, this.scratchParams, gl.DYNAMIC_DRAW);

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
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, getPlatformBuffer(this.sceneParamsBuffer));
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, getPlatformBuffer(this.materialParamsBuffer));
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 2, getPlatformBuffer(this.prmParamsBuffer));
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);

            gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.sceneParamsBuffer));
            fillSceneParamsData(this.scratchParams, state);
            gl.bufferData(gl.UNIFORM_BUFFER, this.scratchParams, gl.DYNAMIC_DRAW);

            for (let i = 0; i < meshFuncs.length; i++)
                meshFuncs[i](state);
        };
    }
}

export class RoomRenderer implements Viewer.Scene {
    public visible: boolean = true;
    public textures: Viewer.Texture[];
    public opaqueMesh: CmbRenderer | null;
    public transparentMesh: CmbRenderer | null;
    public wMesh: CmbRenderer | null;

    constructor(gl: WebGL2RenderingContext, public zsi: ZSI.ZSI, public name: string, public wCmb: CMB.CMB) {
        const mesh = zsi.mesh;

        this.opaqueMesh = mesh.opaque !== null ? new CmbRenderer(gl, mesh.opaque) : null;
        this.transparentMesh = mesh.transparent !== null ? new CmbRenderer(gl, mesh.transparent) : null;
        this.wMesh = wCmb !== null ? new CmbRenderer(gl, wCmb) : null;

        // TODO(jstpierre): TextureHolder.
        this.textures = [];
        if (this.opaqueMesh !== null)
            this.textures = this.textures.concat(this.opaqueMesh.textures);
        if (this.transparentMesh !== null)
            this.textures = this.textures.concat(this.transparentMesh.textures);
        if (this.wMesh !== null)
            this.textures = this.textures.concat(this.wMesh.textures);
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.bindCMAB(cmab);
        if (this.transparentMesh !== null)
            this.transparentMesh.bindCMAB(cmab);
    }

    public bindWCMAB(cmab: CMAB.CMAB): void {
        if (this.wMesh !== null)
            this.wMesh.bindCMAB(cmab);
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
        if (this.wMesh !== null)
            this.wMesh.render(state);
    }

    public destroy(gl: WebGL2RenderingContext) {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(gl);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(gl);
        if (this.wMesh !== null)
            this.wMesh.destroy(gl);
    }
}
