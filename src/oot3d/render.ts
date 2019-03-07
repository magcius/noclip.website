
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { DeviceProgram, DeviceProgramReflection } from '../Program';
import AnimationController from '../AnimationController';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler, GfxDevice, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxHostAccessPass, GfxRenderPass, GfxTextureDimension, GfxInputState, GfxInputLayout } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { colorNew, colorFromRGBA } from '../Color';
import { getTextureFormatName } from './pica_texture';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { nArray, assert } from '../util';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderer';
import { makeFormat, FormatFlags, FormatTypeFlags, FormatCompFlags } from '../gfx/platform/GfxPlatformFormat';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { Camera } from '../Camera';

// @ts-ignore
// This feature is provided by Parcel.
import { readFileSync } from 'fs';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { getDebugOverlayCanvas2D, prepareFrameDebugOverlayCanvas2D, drawWorldSpaceLine } from '../DebugJunk';

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
    public loadTexture(device: GfxDevice, texture: CMB.Texture): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: texture.levels.length,
        });
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
    public static a_Color = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord1 = 5;
    public static a_TexCoord2 = 6;
    public static a_BoneIndices = 7;
    public static a_BoneWeights = 8;

    public static program = readFileSync('src/oot3d/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(OoT3D_Program.program);
    public both = OoT3D_Program.program;
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

class MaterialInstance {
    private textureMappings: TextureMapping[] = nArray(3, () => new TextureMapping());
    private gfxSamplers: GfxSampler[] = [];
    private colorAnimators: CMAB.ColorAnimator[] = [];
    private srtAnimators: CMAB.TextureAnimator[] = [];
    public templateRenderInst: GfxRenderInst;
    public visible: boolean = true;

    constructor(public cmb: CMB.CMB, public material: CMB.Material) {
    }

    public buildTemplateRenderInst(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: CtrTextureHolder): void {
        this.templateRenderInst = renderInstBuilder.newRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, OoT3D_Program.ub_MaterialParams);
        const layer = this.material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.templateRenderInst.sortKey = makeSortKey(layer);
        this.templateRenderInst.setMegaStateFlags(this.material.renderFlags);

        for (let i = 0; i < this.material.textureBindings.length; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = this.translateTextureFilter(binding.minFilter);
            const [magFilter] = this.translateTextureFilter(binding.magFilter);

            const texture = this.cmb.textures[binding.textureIdx];
            textureHolder.fillTextureMapping(this.textureMappings[i], texture.name);

            const gfxSampler = device.createSampler({
                wrapS: this.translateWrapMode(binding.wrapS),
                wrapT: this.translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            });
            this.gfxSamplers.push(gfxSampler);
            this.textureMappings[i].gfxSampler = gfxSampler;
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
    }

    public bindCMAB(cmab: CMAB.CMAB, animationController: AnimationController, channelIndex: number): void {
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.materialIndex !== this.material.index)
                continue;
            if (animEntry.channelIndex !== channelIndex)
                continue;

            if (animEntry.animationType === CMAB.AnimationType.TRANSLATION || animEntry.animationType === CMAB.AnimationType.ROTATION) {
                this.srtAnimators[animEntry.channelIndex] = new CMAB.TextureAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.COLOR) {
                this.colorAnimators[animEntry.channelIndex] = new CMAB.ColorAnimator(animationController, cmab, animEntry);
            }
        }
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, visible: boolean): void {
        this.templateRenderInst.visible = visible && this.visible;

        if (visible) {
            let offs = this.templateRenderInst.getUniformBufferOffset(OoT3D_Program.ub_MaterialParams);
            const mapped = materialParamsBuffer.mapBufferF32(offs, 20);
            if (this.colorAnimators[0]) {
                this.colorAnimators[0].calcMaterialColor(scratchColor);
            } else {
                colorFromRGBA(scratchColor, 1, 1, 1, 1);
            }
            offs += fillColor(mapped, offs, scratchColor);

            for (let i = 0; i < 3; i++) {
                if (this.srtAnimators[i]) {
                    this.srtAnimators[i].calcTexMtx(scratchMatrix);
                    mat4.mul(scratchMatrix, this.material.textureMatrices[i], scratchMatrix);
                } else {
                    mat4.copy(scratchMatrix, this.material.textureMatrices[i]);
                }
                offs += fillMatrix4x3(mapped, offs, scratchMatrix);
            }

            offs += fillVec4(mapped, offs, this.material.alphaTestReference);
        }
    }

    private translateWrapMode(wrapMode: CMB.TextureWrapMode): GfxWrapMode {
        switch (wrapMode) {
        case CMB.TextureWrapMode.CLAMP: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.CLAMP_TO_EDGE: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.REPEAT: return GfxWrapMode.REPEAT;
        case CMB.TextureWrapMode.MIRRORED_REPEAT: return GfxWrapMode.MIRROR;
        default: throw new Error();
        }
    }

    private translateTextureFilter(filter: CMB.TextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
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

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

function translateDataType(dataType: CMB.DataType, size: number, normalized: boolean): GfxFormat {
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

class SepdData {
    private perInstanceBuffer: GfxBuffer | null = null;
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;

    constructor(device: GfxDevice, cmbContext: CmbContext, public sepd: CMB.Sepd) {
        const vatr = cmbContext.vatrChunk;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        const perInstanceBufferData = new Float32Array(32);
        let perInstanceBufferWordOffset = 0;

        const bindVertexAttrib = (location: number, size: number, normalized: boolean, bufferOffs: number, vertexAttrib: CMB.SepdVertexAttrib) => {
            const format = translateDataType(vertexAttrib.dataType, size, normalized);
            if (vertexAttrib.mode === CMB.SepdVertexAttribMode.ARRAY && bufferOffs >= 0) {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 1 + location, bufferByteOffset: vertexAttrib.start, frequency: GfxVertexAttributeFrequency.PER_VERTEX });
            } else {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 0, bufferByteOffset: perInstanceBufferWordOffset * 0x04, frequency: GfxVertexAttributeFrequency.PER_INSTANCE });
                perInstanceBufferData.set(vertexAttrib.constant, perInstanceBufferWordOffset);
                perInstanceBufferWordOffset += 0x04;
            }
        };

        bindVertexAttrib(OoT3D_Program.a_Position,    3, false, vatr.positionByteOffset,  sepd.position);
        bindVertexAttrib(OoT3D_Program.a_Normal,      3, true,  vatr.normalByteOffset,    sepd.normal);
        // tangent

        // If we don't have any color, use opaque white. The constant in the sepd is not guaranteed to be correct.
        // XXX(jstpierre): Don't modify the input data if we can help it.
        if (vatr.colorByteOffset < 0)
            vec4.set(sepd.color.constant, 1, 1, 1, 1);

        bindVertexAttrib(OoT3D_Program.a_Color,       4, true,  vatr.colorByteOffset,     sepd.color);
        bindVertexAttrib(OoT3D_Program.a_TexCoord0,   2, false, vatr.texCoord0ByteOffset, sepd.texCoord0);
        bindVertexAttrib(OoT3D_Program.a_TexCoord1,   2, false, vatr.texCoord1ByteOffset, sepd.texCoord1);
        bindVertexAttrib(OoT3D_Program.a_TexCoord2,   2, false, vatr.texCoord2ByteOffset, sepd.texCoord2);

        const hasBoneIndices = sepd.prms[0].skinningMode !== CMB.SkinningMode.SINGLE_BONE && sepd.boneIndices.dataType === CMB.DataType.UByte;
        bindVertexAttrib(OoT3D_Program.a_BoneIndices, sepd.boneDimension, false, hasBoneIndices ? vatr.boneIndicesByteOffset : -1, sepd.boneIndices);
        const hasBoneWeights = sepd.prms[0].skinningMode === CMB.SkinningMode.SMOOTH_SKINNING;
        bindVertexAttrib(OoT3D_Program.a_BoneWeights, sepd.boneDimension, false, hasBoneWeights ? vatr.boneWeightsByteOffset : -1, sepd.boneWeights);

        let perInstanceBinding: GfxVertexBufferDescriptor | null = null;
        if (perInstanceBufferWordOffset !== 0) {
            this.perInstanceBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(perInstanceBufferData.buffer));
            perInstanceBinding = { buffer: this.perInstanceBuffer, byteOffset: 0, byteStride: 0 };
        }

        for (let i = 1; i < sepd.prms.length; i++)
            assert(sepd.prms[i].prm.indexType === sepd.prms[0].prm.indexType);

        const indexType = sepd.prms[0].prm.indexType;
        const indexBufferFormat = translateDataType(indexType, 1, false);
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            perInstanceBinding,
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.positionByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.normalByteOffset, byteStride: 0 },
            null, // tangent
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.colorByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord0ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord1ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord2ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.boneIndicesByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.boneWeightsByteOffset, byteStride: 0 },
        ], { buffer: cmbContext.indexBuffer, byteOffset: 0, byteStride: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.perInstanceBuffer !== null)
            device.destroyBuffer(this.perInstanceBuffer);
    }
}

class ShapeInstance {
    private renderInsts: GfxRenderInst[] = [];

    public visible: boolean = true;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, private sepdData: SepdData, private materialInstance: MaterialInstance) {
        // Create our template render inst.
        const templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        templateRenderInst.inputState = sepdData.inputState;
        templateRenderInst.setSamplerBindingsInherit();

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

        for (let i = 0; i < this.sepdData.sepd.prms.length; i++) {
            const prms = this.sepdData.sepd.prms[i];
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInstBuilder.newUniformBufferInstance(renderInst, OoT3D_Program.ub_PrmParams);
            const firstIndex = getFirstIndex(prms.prm);
            renderInst.drawIndexes(prms.prm.count, firstIndex);
            renderInst.setSamplerBindingsInherit();
            this.renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(prmParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, boneMatrices: mat4[], inverseBindPoseMatrices: mat4[]): void {
        const sepd = this.sepdData.sepd;

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];
            renderInst.visible = this.visible && this.materialInstance.templateRenderInst.visible;

            if (renderInst.visible) {
                const prms = sepd.prms[i];

                let offs = renderInst.getUniformBufferOffset(OoT3D_Program.ub_PrmParams);
                const prmParamsMapped = prmParamsBuffer.mapBufferF32(offs, 16);

                for (let i = 0; i < 16; i++) {
                    if (i < prms.boneTable.length) {
                        const boneId = prms.boneTable[i];
                        if (prms.skinningMode === CMB.SkinningMode.SMOOTH_SKINNING) {
                            mat4.mul(scratchMatrix, boneMatrices[boneId], inverseBindPoseMatrices[boneId]);
                            mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);
                        } else {
                            mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, boneMatrices[boneId]);
                        }
                    } else {
                        mat4.identity(scratchMatrix);
                    }

                    offs += fillMatrix4x3(prmParamsMapped, offs, scratchMatrix);
                }

                offs += fillVec4(prmParamsMapped, offs, sepd.position.scale, sepd.texCoord0.scale, sepd.texCoord1.scale, sepd.texCoord2.scale);
                offs += fillVec4(prmParamsMapped, offs, sepd.boneWeights.scale, sepd.boneDimension);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        //
    }
}

export class CmbData {
    public sepdData: SepdData[] = [];
    public inverseBindPoseMatrices: mat4[] = [];

    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public cmb: CMB.CMB) {
        this.vertexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, cmb.vatrChunk.dataBuffer);
        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.INDEX, cmb.indexBuffer);

        const vatrChunk = cmb.vatrChunk;
        const cmbContext: CmbContext = {
            vertexBuffer: this.vertexBuffer,
            indexBuffer: this.indexBuffer,
            vatrChunk,
        };

        for (let i = 0; i < this.cmb.sepds.length; i++)
            this.sepdData[i] = new SepdData(device, cmbContext, this.cmb.sepds[i]);

        const tempBones = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++) {
            const bone = cmb.bones[i];
            CSAB.calcBoneMatrix(tempBones[i], null, null, bone);
            if (bone.parentBoneId >= 0)
                mat4.mul(tempBones[i], tempBones[bone.parentBoneId], tempBones[i]);
        }

        this.inverseBindPoseMatrices = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++)
            mat4.invert(this.inverseBindPoseMatrices[i], tempBones[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.sepdData.length; i++)
            this.sepdData[i].destroy(device);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class CmbRenderer {
    public animationController = new AnimationController();
    public visible: boolean = true;
    public materialInstances: MaterialInstance[] = [];
    public shapeInstances: ShapeInstance[] = [];
    public whichTexture: number = 0;

    public csab: CSAB.CSAB | null = null;
    public debugBones: boolean = false;
    public boneMatrices: mat4[] = [];
    public modelMatrix = mat4.create();

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private prmParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PrmParams`);

    private templateRenderInst: GfxRenderInst;

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;
    private monochromeVertexColorsEnabled: boolean = false;

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public cmbData: CmbData, public name: string = '') {
        for (let i = 0; i < this.cmbData.cmb.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(this.cmbData.cmb, this.cmbData.cmb.materials[i]));

        this.boneMatrices = nArray(this.cmbData.cmb.bones.length, () => mat4.create());
        this.updateBoneMatrices();
    }

    private translateCmb(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder): void {
        const cmb = this.cmbData.cmb;

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].buildTemplateRenderInst(device, renderInstBuilder, this.textureHolder);

        for (let i = 0; i < cmb.meshs.length; i++) {
            const mesh = cmb.meshs[i];
            const materialInstance = this.materialInstances[mesh.matsIdx];
            renderInstBuilder.pushTemplateRenderInst(materialInstance.templateRenderInst);
            this.shapeInstances.push(new ShapeInstance(device, renderInstBuilder, this.cmbData.sepdData[mesh.sepdIdx], materialInstance));
            renderInstBuilder.popTemplateRenderInst();
        }
    }

    private createProgram(): void {
        const program = new OoT3D_Program();
        if (this.texturesEnabled)
            program.defines.set(`USE_TEXTURE_${this.whichTexture}`, '1');
        if (this.vertexColorsEnabled)
            program.defines.set('USE_VERTEX_COLOR', '1');
        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');
        this.templateRenderInst.setDeviceProgram(program);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        // Standard GX binding model of three bind groups.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 3, }, // Material
            { numUniformBuffers: 1, numSamplers: 0, }, // Packet
        ];

        const renderInstBuilder = new GfxRenderInstBuilder(device, OoT3D_Program.programReflection, bindingLayouts, [ this.sceneParamsBuffer, this.materialParamsBuffer, this.prmParamsBuffer ]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.createProgram();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, OoT3D_Program.ub_SceneParams);
        this.translateCmb(device, renderInstBuilder);
        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    private updateBoneMatrices(): void {
        for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
            const bone = this.cmbData.cmb.bones[i];

            CSAB.calcBoneMatrix(this.boneMatrices[bone.boneId], this.animationController, this.csab, bone);
            const parentBoneMatrix = bone.parentBoneId >= 0 ? this.boneMatrices[bone.parentBoneId] : this.modelMatrix;
            mat4.mul(this.boneMatrices[bone.boneId], parentBoneMatrix, this.boneMatrices[bone.boneId]);
        }
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.updateBoneMatrices();

        if (this.debugBones) {
            prepareFrameDebugOverlayCanvas2D();
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
                const bone = this.cmbData.cmb.bones[i];
                if (bone.parentBoneId < 0) continue;

                vec3.set(scratchVec3a, 0, 0, 0);
                vec3.transformMat4(scratchVec3a, scratchVec3a, this.boneMatrices[bone.parentBoneId]);
                vec3.set(scratchVec3b, 0, 0, 0);
                vec3.transformMat4(scratchVec3b, scratchVec3b, this.boneMatrices[bone.boneId]);

                drawWorldSpaceLine(ctx, viewerInput.camera, scratchVec3a, scratchVec3b);
            }
        }

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        let offs = this.templateRenderInst.getUniformBufferOffset(OoT3D_Program.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera);

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].prepareToRender(this.materialParamsBuffer, viewerInput, this.visible);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(this.prmParamsBuffer, viewerInput, this.boneMatrices, this.cmbData.inverseBindPoseMatrices);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.prmParamsBuffer.prepareToRender(hostAccessPass);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.prmParamsBuffer.destroy(device);
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }

    public bindCSAB(csab: CSAB.CSAB | null): void {
        this.csab = csab;
    }

    public bindCMAB(cmab: CMAB.CMAB, channelIndex: number = 0): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCMAB(cmab, this.animationController, channelIndex);
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

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const finalPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
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
    public opaqueData: CmbData | null = null;
    public opaqueMesh: CmbRenderer | null = null;
    public transparentData: CmbData | null = null;
    public transparentMesh: CmbRenderer | null = null;
    public wMesh: CmbRenderer | null = null;
    public objectRenderers: CmbRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public mesh: ZSI.Mesh, public name: string) {
        if (mesh.opaque !== null) {
            textureHolder.addTextures(device, mesh.opaque.textures);
            this.opaqueData = new CmbData(device, mesh.opaque);
            this.opaqueMesh = new CmbRenderer(device, textureHolder, this.opaqueData, `${name} Opaque`);
        }

        if (mesh.transparent !== null) {
            textureHolder.addTextures(device, mesh.transparent.textures);
            this.transparentData = new CmbData(device, mesh.transparent);
            this.transparentMesh = new CmbRenderer(device, textureHolder, this.transparentData, `${name} Transparent`);
        }
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.addToViewRenderer(device, viewRenderer);
        if (this.transparentMesh !== null)
            this.transparentMesh.addToViewRenderer(device, viewRenderer);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].addToViewRenderer(device, viewRenderer);
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
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVisible(visible);
    }

    public setVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexColorsEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setTexturesEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setTexturesEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setTexturesEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setMonochromeVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setMonochromeVertexColorsEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setMonochromeVertexColorsEnabled(v);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.transparentMesh !== null)
            this.transparentMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.wMesh !== null)
            this.wMesh.prepareToRender(hostAccessPass, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.opaqueData !== null)
            this.opaqueData.destroy(device);
        if (this.transparentData !== null)
            this.transparentData.destroy(device);
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(device);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(device);
        if (this.wMesh !== null)
            this.wMesh.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}
