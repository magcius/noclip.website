
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { RenderState } from '../render';
import { DeviceProgram } from '../Program';
import RenderArena from '../RenderArena';
import AnimationController from '../AnimationController';
import { mat4 } from 'gl-matrix';
import { getTransitionDeviceForWebGL2, getPlatformBuffer, getPlatformSampler } from '../gfx/platform/GfxPlatformWebGL2';
import { GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3 } from '../gfx/helpers/BufferHelpers';
import { colorNew, colorFromRGBA } from '../Color';
import { getTextureFormatName } from './pica_texture';
import { TextureHolder, LoadedTexture, TextureMapping, bindGLTextureMappings } from '../TextureHolder';
import { nArray } from '../util';

// @ts-ignore
// This feature is provided by Parcel.
import { readFileSync } from 'fs';

function surfaceToCanvas(textureLevel: CMB.TextureLevel): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = textureLevel.width;
    canvas.height = textureLevel.height;
    canvas.title = textureLevel.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    imgData.data.set(textureLevel.pixels, 0);

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

function textureToCanvas(texture: CMB.Texture): Viewer.Texture {
    const surfaces = texture.levels.map((textureLevel) => surfaceToCanvas(textureLevel));

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getTextureFormatName(texture.format));

    return { name: texture.name, surfaces, extraInfo };
}

export class CtrTextureHolder extends TextureHolder<CMB.Texture> {
    public addTexture(gl: WebGL2RenderingContext, texture: CMB.Texture): LoadedTexture {
        const device = getTransitionDeviceForWebGL2(gl);

        const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, texture.width, texture.height, texture.levels.length);
        device.setResourceName(gfxTexture, texture.name);

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, texture.levels.map((level) => level.pixels));

        device.submitPass(hostAccessPass);
        const viewerTexture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

class OoT3D_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public both = readFileSync('src/oot3d/program.glsl', { encoding: 'utf8' });
}

function fillSceneParamsData(d: Float32Array, state: RenderState, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, state.camera.projectionMatrix);
}

type RenderFunc = (renderState: RenderState) => void;

interface CmbContext {
    posBuffer: WebGLBuffer;
    colBuffer: WebGLBuffer | null;
    nrmBuffer: WebGLBuffer | null;
    txcBuffer: WebGLBuffer | null;
    idxBuffer: WebGLBuffer;

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
    public boneMatrices: mat4[] = [];

    private sceneParamsBuffer: GfxBuffer;
    private materialParamsBuffer: GfxBuffer;
    private prmParamsBuffer: GfxBuffer;
    private scratchParams = new Float32Array(64);
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(gl: WebGL2RenderingContext, public textureHolder: CtrTextureHolder, public cmb: CMB.CMB, public name: string = '') {
        const device = getTransitionDeviceForWebGL2(gl);

        this.arena = new RenderArena();
        this.textureHolder.addTextures(gl, cmb.textures.filter((texture) => texture.levels.length > 0));
        this.model = this.translateCmb(gl, cmb);

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
        this.model(state);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        const device = getTransitionDeviceForWebGL2(gl);
        this.arena.destroy(gl);
        device.destroyBuffer(this.sceneParamsBuffer);
        device.destroyBuffer(this.materialParamsBuffer);
        device.destroyBuffer(this.prmParamsBuffer);
    }

    public bindCMAB(cmab: CMAB.CMAB, channelIndex: number = 0): void {
        // TODO(jstpierre): Support better stuff here when we get a better renderer...
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.channelIndex === channelIndex) {
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

        const bindVertexAttrib = (attribLocation: number, size: number, normalized: boolean, vertexAttrib: CMB.SepdVertexAttrib) => {
            if (vertexAttrib.mode === CMB.SepdVertexAttribMode.ARRAY) {
                gl.vertexAttribPointer(attribLocation, size, this.translateDataType(gl, vertexAttrib.dataType), normalized, 0, vertexAttrib.start);
                gl.enableVertexAttribArray(attribLocation);
            } else if (size === 4) {
                gl.vertexAttrib4fv(attribLocation, vertexAttrib.constant);
            } else if (size === 3) {
                gl.vertexAttrib3fv(attribLocation, vertexAttrib.constant.slice(0, 3));
            }
        };

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
        bindVertexAttrib(OoT3D_Program.a_Position, 3, false, sepd.position);

        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.nrmBuffer);
        bindVertexAttrib(OoT3D_Program.a_Normal, 3, true, sepd.normal);

        if (cmbContext.colBuffer !== null)
            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
        bindVertexAttrib(OoT3D_Program.a_Color, 4, true, sepd.color);

        if (cmbContext.txcBuffer !== null)
            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
        bindVertexAttrib(OoT3D_Program.a_TexCoord, 2, false, sepd.textureCoord);

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
                offs += fillVec4(this.scratchParams, offs, sepd.position.scale, sepd.textureCoord.scale);

                gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.prmParamsBuffer));
                gl.bufferData(gl.UNIFORM_BUFFER, this.scratchParams, gl.DYNAMIC_DRAW);

                gl.drawElements(gl.TRIANGLES, prm.count, this.translateDataType(gl, prm.indexType), prm.offset);
            }

            gl.bindVertexArray(null);
        };
    }

    private translateMaterial(gl: WebGL2RenderingContext, material: CMB.Material): RenderFunc {
        function translateWrapMode(wrapMode: CMB.TextureWrapMode): GfxWrapMode {
            switch (wrapMode) {
            case CMB.TextureWrapMode.CLAMP: return GfxWrapMode.CLAMP;
            case CMB.TextureWrapMode.CLAMP_TO_EDGE: return GfxWrapMode.CLAMP;
            case CMB.TextureWrapMode.REPEAT: return GfxWrapMode.REPEAT;
            case CMB.TextureWrapMode.MIRRORED_REPEAT: return GfxWrapMode.MIRROR;
            default: throw new Error();
            }
        }

        function translateTextureFilter(filter: CMB.TextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
            switch (filter) {
            case CMB.TextureFilter.LINEAR:
                return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
            case CMB.TextureFilter.NEAREST:
                return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
            case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR:
                return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
            case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST:
                return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
            case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR:
                return [GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR];
            case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST:
                return [GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST];
            default: throw new Error();
            }
        }

        const device = getTransitionDeviceForWebGL2(gl);
        const gfxSamplers: GfxSampler[] = [];
        for (let i = 0; i < material.textureBindings.length; i++) {
            if (i >= 1) break;
            const binding = material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = translateTextureFilter(binding.minFilter);
            const [magFilter] = translateTextureFilter(binding.magFilter);

            const gfxSampler = device.createSampler({
                wrapS: translateWrapMode(binding.wrapS),
                wrapT: translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            });
            gfxSamplers.push(gfxSampler);
            this.arena.samplers.push(getPlatformSampler(gfxSampler));
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

            offs += fillVec4(this.scratchParams, offs, material.alphaTestReference);

            gl.bindBuffer(gl.UNIFORM_BUFFER, getPlatformBuffer(this.materialParamsBuffer));
            gl.bufferData(gl.UNIFORM_BUFFER, this.scratchParams, gl.DYNAMIC_DRAW);

            for (let i = 0; i < 1; i++) {
                const binding = material.textureBindings[i];
                if (binding.textureIdx === -1)
                    continue;

                const texture = this.cmb.textures[binding.textureIdx];
                this.textureHolder.fillTextureMapping(this.textureMapping[0], texture.name);
                this.textureMapping[0].gfxSampler = gfxSamplers[i];
            }

            bindGLTextureMappings(state, this.textureMapping);
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
            sepdFuncs: [],
            matFuncs: [],
        };

        cmbContext.sepdFuncs = cmb.sepds.map((sepd) => this.translateSepd(gl, cmbContext, sepd));
        cmbContext.matFuncs = cmb.materials.map((material) => this.translateMaterial(gl, material));

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

export class RoomRenderer {
    public visible: boolean = true;
    public opaqueMesh: CmbRenderer | null;
    public transparentMesh: CmbRenderer | null;
    public wMesh: CmbRenderer | null;

    constructor(gl: WebGL2RenderingContext, textureHolder: CtrTextureHolder, public zsi: ZSI.ZSI, public name: string, public wCmb: CMB.CMB) {
        const mesh = zsi.mesh;

        this.opaqueMesh = mesh.opaque !== null ? new CmbRenderer(gl, textureHolder, mesh.opaque) : null;
        this.transparentMesh = mesh.transparent !== null ? new CmbRenderer(gl, textureHolder, mesh.transparent) : null;
        this.wMesh = wCmb !== null ? new CmbRenderer(gl, textureHolder, wCmb) : null;
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
