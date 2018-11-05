
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import AnimationController from '../AnimationController';
import { mat4 } from 'gl-matrix';
import { GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler, GfxDevice, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxProgram, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { colorNew, colorFromRGBA } from '../Color';
import { getTextureFormatName } from './pica_texture';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { nArray, wordCountFromByteCount, assert } from '../util';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { makeFormat, FormatFlags, FormatTypeFlags, FormatCompFlags } from '../gfx/platform/GfxPlatformFormat';
import { ub_MaterialParams } from '../gx/gx_render';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';

// @ts-ignore
// This feature is provided by Parcel.
import { readFileSync } from 'fs';
import { Camera } from '../Camera';
import GfxArena from '../gfx/helpers/GfxArena';

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
    public addTextureGfx(device: GfxDevice, texture: CMB.Texture): LoadedTexture {
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
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PrmParams = 2;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public both = readFileSync('src/oot3d/program.glsl', { encoding: 'utf8' });
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

interface CmbContext {
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    vatrChunk: CMB.VatrChunk;
}

const scratchMatrix = mat4.create();
const scratchColor = colorNew(0, 0, 0, 1);

export class CmbRenderer {
    private gfxProgram: GfxProgram;

    public animationController = new AnimationController();
    public srtAnimators: CMAB.TextureAnimator[] = [];
    public colorAnimators: CMAB.ColorAnimator[] = [];
    public visible: boolean = true;
    public boneMatrices: mat4[] = [];
    public prepareToRenderFuncs: ((viewerInput: Viewer.ViewerRenderInput) => void)[] = [];

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private prmParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PrmParams`);

    private textureMapping = nArray(1, () => new TextureMapping());
    private templateRenderInst: GfxRenderInst;
    private arena = new GfxArena();

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public cmb: CMB.CMB, public name: string = '') {
        this.textureHolder.addTexturesGfx(device, cmb.textures.filter((texture) => texture.levels.length > 0));

        this.gfxProgram = device.createProgram(new OoT3D_Program());
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        const programReflection = device.queryProgram(this.gfxProgram);

        // Standard GX binding model of three bind groups.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 1, }, // Material
            { numUniformBuffers: 1, numSamplers: 0, }, // Packet
        ];

        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [ this.sceneParamsBuffer, this.materialParamsBuffer, this.prmParamsBuffer ]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, OoT3D_Program.ub_SceneParams);
        this.translateCmb(device, renderInstBuilder, this.cmb);
        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.updateTime(viewerInput.time);

        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[OoT3D_Program.ub_SceneParams], 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, this.templateRenderInst.uniformBufferOffsets[OoT3D_Program.ub_SceneParams]);

        this.prepareToRenderFuncs.forEach((updateFunc) => {
            updateFunc(viewerInput);
        });

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.prmParamsBuffer.prepareToRender(hostAccessPass);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.prmParamsBuffer.destroy(device);
    }

    public bindCMAB(cmab: CMAB.CMAB, channelIndex: number = 0): void {
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

    private translateDataType(dataType: CMB.DataType, size: number, normalized: boolean): GfxFormat {
        function translateDataTypeFlags(dataType: CMB.DataType) {
            switch (dataType) {
            case CMB.DataType.UByte: return FormatTypeFlags.U8;
            case CMB.DataType.UShort: return FormatTypeFlags.U16;
            case CMB.DataType.UInt: return FormatTypeFlags.U32;
            case CMB.DataType.Byte: return FormatTypeFlags.S8;
            case CMB.DataType.Short: return FormatTypeFlags.S16;
            case CMB.DataType.Int: return FormatTypeFlags.S32;
            case CMB.DataType.Float: return FormatTypeFlags.F32;
            }
        }

        const formatTypeFlags = translateDataTypeFlags(dataType);
        const formatCompFlags = size as FormatCompFlags;
        const formatFlags = normalized ? FormatFlags.NORMALIZED : FormatFlags.NONE;
        return makeFormat(formatTypeFlags, formatCompFlags, formatFlags);
    }

    private translateSepd(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, cmbContext: CmbContext, sepd: CMB.Sepd) {
        const hostAccessPass = device.createHostAccessPass();

        const vertexAttributes: GfxVertexAttributeDescriptor[] = [];

        const perInstanceBufferData = new Float32Array(16);
        let perInstanceBufferWordOffset = 0;
        const bindVertexAttrib = (location: number, size: number, normalized: boolean, vertexAttrib: CMB.SepdVertexAttrib) => {
            const format = this.translateDataType(vertexAttrib.dataType, size, normalized);
            if (vertexAttrib.mode === CMB.SepdVertexAttribMode.ARRAY) {
                vertexAttributes.push({ location, format, bufferIndex: 1 + location, bufferByteOffset: vertexAttrib.start, frequency: GfxVertexAttributeFrequency.PER_VERTEX });
            } else {
                vertexAttributes.push({ location, format, bufferIndex: 0, bufferByteOffset: perInstanceBufferWordOffset, frequency: GfxVertexAttributeFrequency.PER_INSTANCE });
                perInstanceBufferData.set(vertexAttrib.constant, perInstanceBufferWordOffset);
                perInstanceBufferWordOffset += 0x04;
            }
        };

        bindVertexAttrib(OoT3D_Program.a_Position, 3, false, sepd.position);
        bindVertexAttrib(OoT3D_Program.a_Normal, 3, true, sepd.normal);
        bindVertexAttrib(OoT3D_Program.a_Color, 4, true, sepd.color);
        bindVertexAttrib(OoT3D_Program.a_TexCoord, 2, false, sepd.textureCoord);

        let perInstanceBufferBinding: GfxVertexBufferDescriptor | null = null;
        if (perInstanceBufferWordOffset !== 0) {
            const perInstanceBuffer = device.createBuffer(perInstanceBufferWordOffset, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);
            perInstanceBufferBinding = { buffer: perInstanceBuffer, byteOffset: 0, byteStride: 0 };
            hostAccessPass.uploadBufferData(perInstanceBuffer, 0, new Uint8Array(perInstanceBufferData.buffer));
        }

        const indexType = sepd.prms[0].prm.indexType;
        const indexFormat = this.translateDataType(indexType, 1, false);
        const inputLayout = device.createInputLayout(vertexAttributes, indexFormat);
        const inputState = device.createInputState(inputLayout, [
            perInstanceBufferBinding,
            { buffer: cmbContext.vertexBuffer, byteOffset: cmbContext.vatrChunk.positionByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: cmbContext.vatrChunk.normalByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: cmbContext.vatrChunk.colorByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: cmbContext.vatrChunk.textureCoordByteOffset, byteStride: 0 },
        ], { buffer: cmbContext.indexBuffer, byteOffset: 0, byteStride: 0 });

        // Create our template render inst.
        const templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        templateRenderInst.inputState = inputState;

        function getFirstIndex(prm: CMB.Prm): number {
            if (prm.indexType === CMB.DataType.UByte) {
                return prm.offset;
            } else if (prm.indexType === CMB.DataType.UShort) {
                assert((prm.offset & 0x01) === 0);
                return prm.offset >>> 1;
            } else if (prm.indexType === CMB.DataType.UInt) {
                assert((prm.offset & 0x03) === 0);
                return prm.offset >>> 2;
            }
            throw new Error();
        }

        const renderInsts: GfxRenderInst[] = [];
        for (let i = 0; i < sepd.prms.length; i++) {
            const prms = sepd.prms[i];
            assert(prms.prm.indexType === indexType);
            const renderInst = renderInstBuilder.pushRenderInst();
            if (renderInst.samplerBindings.length === 0)
                throw new Error();
            renderInstBuilder.newUniformBufferInstance(renderInst, OoT3D_Program.ub_PrmParams);
            const firstIndex = getFirstIndex(prms.prm);
            renderInst.drawIndexes(prms.prm.count, firstIndex);
            renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();

        return (viewerInput: Viewer.ViewerRenderInput) => {
            for (let i = 0; i < sepd.prms.length; i++) {
                const renderInst = renderInsts[i];
                renderInst.visible = this.visible;

                if (this.visible) {
                    const prms = sepd.prms[i];

                    const localMatrixId = prms.boneTable[0];
                    const boneMatrix = this.boneMatrices[localMatrixId];
                    mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, boneMatrix);

                    let offs = renderInst.uniformBufferOffsets[OoT3D_Program.ub_PrmParams];
                    const prmParamsMapped = this.prmParamsBuffer.mapBufferF32(offs, 16);
                    offs += fillMatrix4x3(prmParamsMapped, offs, scratchMatrix);
                    offs += fillVec4(prmParamsMapped, offs, sepd.position.scale, sepd.textureCoord.scale);
                }
            }
        };
    }

    private translateMaterial(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, material: CMB.Material) {
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

        const templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(templateRenderInst, OoT3D_Program.ub_MaterialParams);
        const layer = material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        const programKey = device.queryProgram(templateRenderInst.gfxProgram).uniqueKey;
        templateRenderInst.sortKey = makeSortKey(layer, 0, programKey);
        templateRenderInst.renderFlags.set(material.renderFlags);

        this.textureMapping[0].reset();

        const gfxSamplers: GfxSampler[] = [];
        for (let i = 0; i < material.textureBindings.length; i++) {
            if (i >= 1) break;
            const binding = material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = translateTextureFilter(binding.minFilter);
            const [magFilter] = translateTextureFilter(binding.magFilter);

            const texture = this.cmb.textures[binding.textureIdx];
            this.textureHolder.fillTextureMapping(this.textureMapping[0], texture.name);

            const gfxSampler = this.arena.trackSampler(device.createSampler({
                wrapS: translateWrapMode(binding.wrapS),
                wrapT: translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            }));
            gfxSamplers.push(gfxSampler);
            this.textureMapping[0].gfxSampler = gfxSampler;
        }

        templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        return (viewerInput: Viewer.ViewerRenderInput): void => {
            let offs = templateRenderInst.uniformBufferOffsets[ub_MaterialParams];
            const mapped = this.materialParamsBuffer.mapBufferF32(offs, 20);
            if (this.colorAnimators[material.index]) {
                this.colorAnimators[material.index].calcMaterialColor(scratchColor);
            } else {
                colorFromRGBA(scratchColor, 1, 1, 1, 1);
            }
            offs += fillColor(mapped, offs, scratchColor);

            if (this.srtAnimators[material.index]) {
                this.srtAnimators[material.index].calcTexMtx(scratchMatrix);
            } else {
                mat4.identity(scratchMatrix);
            }
            offs += fillMatrix4x3(mapped, offs, scratchMatrix);
            offs += fillVec4(mapped, offs, material.alphaTestReference);
        };
    }

    private translateCmb(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, cmb: CMB.CMB): void {
        const hostAccessPass = device.createHostAccessPass();

        const vertexBuffer = device.createBuffer(wordCountFromByteCount(cmb.vatrChunk.dataBuffer.byteLength), GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);
        hostAccessPass.uploadBufferData(vertexBuffer, 0, cmb.vatrChunk.dataBuffer.createTypedArray(Uint8Array));
        const indexBuffer = device.createBuffer(wordCountFromByteCount(cmb.indexBuffer.byteLength), GfxBufferUsage.INDEX, GfxBufferFrequencyHint.STATIC);
        hostAccessPass.uploadBufferData(indexBuffer, 0, cmb.indexBuffer.createTypedArray(Uint8Array));

        device.submitPass(hostAccessPass);

        for (let i = 0; i < cmb.bones.length; i++) {
            const bone = cmb.bones[i];
            this.boneMatrices[bone.boneId] = mat4.create();
            if (bone.parentBoneId >= 0) {
                mat4.mul(this.boneMatrices[bone.boneId], this.boneMatrices[bone.parentBoneId], bone.modelMatrix);
            } else {
                mat4.copy(this.boneMatrices[bone.boneId], bone.modelMatrix);
            }
        }

        const vatrChunk = cmb.vatrChunk;
        const cmbContext: CmbContext = {
            vertexBuffer,
            indexBuffer,
            vatrChunk,
        };

        for (let i = 0; i < cmb.meshs.length; i++) {
            const mesh = cmb.meshs[i];

            // Pushes a template render inst.
            const materialPrepareToRenderFunc = this.translateMaterial(device, renderInstBuilder, cmb.materials[mesh.matsIdx]);
            const sepdPrepareToRenderFunc = this.translateSepd(device, renderInstBuilder, cmbContext, cmb.sepds[mesh.sepdIdx]);
            this.prepareToRenderFuncs.push(materialPrepareToRenderFunc);
            this.prepareToRenderFuncs.push(sepdPrepareToRenderFunc);
            renderInstBuilder.popTemplateRenderInst();
        }
    }
}

export abstract class BasicRendererHelper {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    protected abstract prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void;

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const finalPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, finalPassRenderer);
        return finalPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
    }
}

export class RoomRenderer {
    public visible: boolean = true;
    public opaqueMesh: CmbRenderer | null = null;
    public transparentMesh: CmbRenderer | null = null;
    public wMesh: CmbRenderer | null = null;

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public zsi: ZSI.ZSI, public name: string, public wCmb: CMB.CMB) {
        const mesh = zsi.mesh;

        if (mesh.opaque !== null)
            this.opaqueMesh = new CmbRenderer(device, textureHolder, mesh.opaque, `${name} Opaque`);
        if (mesh.transparent !== null)
            this.transparentMesh = new CmbRenderer(device, textureHolder, mesh.transparent, `${name} Transparent`);
        if (wCmb !== null)
            this.wMesh = new CmbRenderer(device, textureHolder, wCmb, `${name} W`);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.addToViewRenderer(device, viewRenderer);
        if (this.transparentMesh !== null)
            this.transparentMesh.addToViewRenderer(device, viewRenderer);
        if (this.wCmb !== null)
            this.wMesh.addToViewRenderer(device, viewRenderer);
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
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVisible(visible);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVisible(visible);
        if (this.wMesh !== null)
            this.wMesh.setVisible(visible);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.transparentMesh !== null)
            this.transparentMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.wMesh !== null)
            this.wMesh.prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(device);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(device);
        if (this.wMesh !== null)
            this.wMesh.destroy(device);
    }
}
