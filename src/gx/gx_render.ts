
// Common helpers for GX rendering.

import { mat4, ReadonlyMat4 } from 'gl-matrix';

import * as GX from './gx_enum.js';
import * as GX_Material from './gx_material.js';
import * as GX_Texture from './gx_texture.js';
import * as Viewer from '../viewer.js';

import { assert, nArray, assertExists, setBitFlagEnabled } from '../util.js';
import { LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VertexAttributeInput } from './gx_displaylist.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { TextureMapping, TextureHolder, LoadedTexture } from '../TextureHolder.js';

import { GfxBufferCoalescerCombo, makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { fillColor, fillMatrix4x3, fillVec4, fillMatrix4x4, fillVec3v, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxFormat, GfxDevice, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxBuffer, GfxInputLayout, GfxMegaStateDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxChannelWriteMask, GfxCullMode, GfxBlendFactor, GfxCompareMode, GfxFrontFaceMode, GfxBlendMode } from '../gfx/platform/GfxPlatform.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, setSortKeyProgramKey } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { Color, TransparentBlack, colorNewCopy, colorFromRGBA } from '../Color.js';
import { AttachmentStateSimple, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { convertToCanvasData } from '../gfx/helpers/TextureConversionHelpers.js';

export enum ColorKind {
    MAT0, MAT1, AMB0, AMB1,
    K0, K1, K2, K3,
    CPREV, C0, C1, C2,
    COUNT,
}

export class SceneParams {
    public u_Projection: mat4 = mat4.create();
    // TODO(jstpierre): Remove this in favor of putting it on the texture itself.
    // u_Misc0[0]
    public u_SceneTextureLODBias: number = 0;
}

export class MaterialParams {
    public m_TextureMapping: TextureMapping[] = nArray(8, () => new TextureMapping());
    public u_Color: Color[] = nArray(ColorKind.COUNT, () => colorNewCopy(TransparentBlack));
    public u_TexMtx: mat4[] = nArray(10, () => mat4.create());     // mat4x3
    public u_PostTexMtx: mat4[] = nArray(20, () => mat4.create()); // mat4x3
    public u_IndTexMtx: mat4[] = nArray(3, () => mat4.create()); // mat4x2
    public u_Lights: GX_Material.Light[] = nArray(8, () => new GX_Material.Light());
    public u_FogBlock = new GX_Material.FogBlock();
    public u_DynamicAlphaRefA: number = 0;
    public u_DynamicAlphaRefB: number = 0;

    constructor() {
        colorFromRGBA(this.u_Color[ColorKind.MAT0], 1.0, 1.0, 1.0, 1.0);
        colorFromRGBA(this.u_Color[ColorKind.MAT1], 1.0, 1.0, 1.0, 1.0);
    }

    public clear(): void {
        for (let i = 0; i < 8; i++)
            this.m_TextureMapping[i].reset();
    }
}

export class DrawParams {
    public u_PosMtx: mat4[] = nArray(10, () => mat4.create());

    public clear(): void {
        for (let i = 0; i < 10; i++)
            mat4.identity(this.u_PosMtx[i]);
    }
}

export const ub_SceneParamsBufferSize = 4*4 + 4;

export function fillSceneParamsData(d: Float32Array, bOffs: number, sceneParams: SceneParams): void {
    let offs = bOffs;

    offs += fillMatrix4x4(d, offs, sceneParams.u_Projection);
    // u_Misc0
    offs += fillVec4(d, offs, sceneParams.u_SceneTextureLODBias);

    assert(offs === bOffs + ub_SceneParamsBufferSize);
    assert(d.length >= offs);
}

export function fillLightData(d: Float32Array, offs: number, light: Readonly<GX_Material.Light>): number {
    offs += fillColor(d, offs, light.Color);
    offs += fillVec3v(d, offs, light.Position);
    offs += fillVec3v(d, offs, light.Direction);
    offs += fillVec3v(d, offs, light.DistAtten);
    offs += fillVec3v(d, offs, light.CosAtten);
    return 4*5;
}

export function fillFogBlock(d: Float32Array, offs: number, fog: Readonly<GX_Material.FogBlock>): number {
    offs += fillVec4(d, offs, fog.A, fog.B, fog.C, fog.AdjCenter);
    offs += fillVec4(d, offs, fog.AdjTable[0], fog.AdjTable[1], fog.AdjTable[2], fog.AdjTable[3]);
    offs += fillVec4(d, offs, fog.AdjTable[4], fog.AdjTable[5], fog.AdjTable[6], fog.AdjTable[7]);
    offs += fillVec4(d, offs, fog.AdjTable[8], fog.AdjTable[9]);
    offs += fillColor(d, offs, fog.Color);
    return 4*5;
}

export function fillTextureSize(d: Float32Array, offs: number, m: TextureMapping): number {
    d[offs++] = m.width;
    d[offs++] = m.height * (m.flipY ? -1 : 1);
    return 2;
}

export function fillTextureBias(d: Float32Array, offs: number, m: TextureMapping): number {
    d[offs++] = m.lodBias;
    return 1;
}

function fillMaterialParamsDataWithOptimizations(material: GX_Material.GXMaterial, d: Float32Array, bOffs: number, materialParams: Readonly<MaterialParams>): void {
    let offs = bOffs;

    for (let i = 0; i < 12; i++)
        offs += fillColor(d, offs, materialParams.u_Color[i]);
    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_TexMtx[i]);
    for (let i = 0; i < 8; i++)
        offs += fillTextureSize(d, offs, materialParams.m_TextureMapping[i]);
    for (let i = 0; i < 8; i++)
        offs += fillTextureBias(d, offs, materialParams.m_TextureMapping[i]);
    for (let i = 0; i < 3; i++)
        offs += fillMatrix4x2(d, offs, materialParams.u_IndTexMtx[i]);
    if (GX_Material.materialHasPostTexMtxBlock(material))
        for (let i = 0; i < 20; i++)
            offs += fillMatrix4x3(d, offs, materialParams.u_PostTexMtx[i]);
    if (GX_Material.materialHasLightsBlock(material))
        for (let i = 0; i < 8; i++)
            offs += fillLightData(d, offs, materialParams.u_Lights[i]);
    if (GX_Material.materialHasFogBlock(material))
        offs += fillFogBlock(d, offs, materialParams.u_FogBlock);
    if (GX_Material.materialHasDynamicAlphaTest(material))
        offs += fillVec4(d, offs, materialParams.u_DynamicAlphaRefA, materialParams.u_DynamicAlphaRefB);

    assert(d.length >= offs);
}

function fillDrawParamsDataWithOptimizations(material: GX_Material.GXMaterial, d: Float32Array, bOffs: number, drawParams: DrawParams): void {
    let offs = bOffs;

    if (GX_Material.materialUsePnMtxIdx(material))
        for (let i = 0; i < 10; i++)
            offs += fillMatrix4x3(d, offs, drawParams.u_PosMtx[i]);
    else
        offs += fillMatrix4x3(d, offs, drawParams.u_PosMtx[0]);

    assert(d.length >= offs);
}

export function calcLODBias(viewportWidth: number, viewportHeight: number): number {
    // Mip levels in GX are assumed to be relative to the GameCube's embedded framebuffer (EFB) size,
    // which is hardcoded to be 640x528. We need to bias our mipmap LOD selection by this amount to
    // make sure textures are sampled correctly...
    const textureLODBias = Math.log2(Math.min(viewportWidth / GX_Material.EFB_WIDTH, viewportHeight / GX_Material.EFB_HEIGHT));
    return textureLODBias;
}

export function loadedDataCoalescerComboGfx(device: GfxDevice, loadedVertexDatas: LoadedVertexData[]): GfxBufferCoalescerCombo {
    return new GfxBufferCoalescerCombo(device,
        loadedVertexDatas.map((data) => data.vertexBuffers.map((buffer) => new ArrayBufferSlice(buffer))),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export class GXViewerTexture implements Viewer.Texture {
    public surfaces: HTMLCanvasElement[] = [];

    constructor(public mipChain: GX_Texture.MipChain, public extraInfo: Map<string, string> | null = null, public name: string = mipChain.name) {
    }

    public activate(): Promise<void> {
        assert(this.surfaces.length === 0);

        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.mipChain.mipLevels.length; i++) {
            const mipLevel = this.mipChain.mipLevels[i];

            const canvas = document.createElement('canvas');
            canvas.width = mipLevel.width;
            canvas.height = mipLevel.height;
            canvas.title = mipLevel.name;
            this.surfaces.push(canvas);

            promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
                convertToCanvasData(canvas, ArrayBufferSlice.fromView(rgbaTexture.pixels));
            }));
        }

        return Promise.all(promises) as any as Promise<void>;
    }
}

export function loadTextureFromMipChain(device: GfxDevice, mipChain: GX_Texture.MipChain): LoadedTexture {
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, firstMipLevel.width, firstMipLevel.height, mipChain.mipLevels.length));
    device.setResourceName(gfxTexture, mipChain.name);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < mipChain.mipLevels.length; i++) {
        const level = i;
        const mipLevel = mipChain.mipLevels[i];

        promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
            device.uploadTextureData(gfxTexture, level, [rgbaTexture.pixels]);
        }));
    }

    const viewerExtraInfo = new Map<string, string>();
    viewerExtraInfo.set("Format", GX_Texture.getFormatName(firstMipLevel.format, firstMipLevel.paletteFormat));

    const viewerTexture = new GXViewerTexture(mipChain, viewerExtraInfo);
    return { gfxTexture, viewerTexture };
}

export function translateWrapModeGfx(wrapMode: GX.WrapMode): GfxWrapMode {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return GfxWrapMode.Clamp;
    case GX.WrapMode.MIRROR:
        return GfxWrapMode.Mirror;
    case GX.WrapMode.REPEAT:
        return GfxWrapMode.Repeat;
    }
}

export function translateTexFilterGfx(texFilter: GX.TexFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (texFilter) {
    case GX.TexFilter.LINEAR:
        return [ GfxTexFilterMode.Bilinear, GfxMipFilterMode.NoMip ];
    case GX.TexFilter.NEAR:
        return [ GfxTexFilterMode.Point, GfxMipFilterMode.NoMip ];
    case GX.TexFilter.LIN_MIP_LIN:
        return [ GfxTexFilterMode.Bilinear, GfxMipFilterMode.Linear ];
    case GX.TexFilter.NEAR_MIP_LIN:
        return [ GfxTexFilterMode.Point, GfxMipFilterMode.Linear ];
    case GX.TexFilter.LIN_MIP_NEAR:
        return [ GfxTexFilterMode.Bilinear, GfxMipFilterMode.Nearest ];
    case GX.TexFilter.NEAR_MIP_NEAR:
        return [ GfxTexFilterMode.Point, GfxMipFilterMode.Nearest ];
    }
}

export function translateMaxAnisotropy(anisotropy: GX.Anisotropy): number {
    switch (anisotropy) {
    case GX.Anisotropy._1:
        return 1;
    case GX.Anisotropy._2:
        return 2;
    case GX.Anisotropy._4:
        return 4;
    default:
        throw "whoops";
    }
}

export class GXTextureHolder<TextureType extends GX_Texture.TextureInputGX = GX_Texture.TextureInputGX> extends TextureHolder<TextureType> {
    protected loadTexture(device: GfxDevice, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(device, mipChain);
    }
}

export function fillIndTexMtx(dst: mat4, src: Float32Array): void {
    const a = src[0], c = src[1], tx = src[2], scale = src[3];
    const b = src[4], d = src[5], ty = src[6];
    mat4.set(dst,
        a,     b,  0, 0,
        c,     d,  0, 0,
        tx,    ty, 0, 0,
        scale, 0,  0, 0
    );
}

function autoOptimizeMaterialHasPostTexMtxBlock(material: GX_Material.GXMaterial): boolean {
    for (let i = 0; i < material.texGens.length; i++)
        if (material.texGens[i].postMatrix !== GX.PostTexGenMatrix.PTIDENTITY)
            return true;

    return false;
}

function channelControlUsesLights(chan: GX_Material.ColorChannelControl): boolean {
    return chan.lightingEnabled && chan.litMask !== 0;
}

function autoOptimizeMaterialHasLightsBlock(material: GX_Material.GXMaterial): boolean {
    if (material.lightChannels[0] !== undefined) {
        if (channelControlUsesLights(material.lightChannels[0].colorChannel))
            return true;
        if (channelControlUsesLights(material.lightChannels[0].alphaChannel))
            return true;
    }

    if (material.lightChannels[1] !== undefined) {
        if (channelControlUsesLights(material.lightChannels[1].colorChannel))
            return true;
        if (channelControlUsesLights(material.lightChannels[1].alphaChannel))
            return true;
    }

    return false;
}

function autoOptimizeMaterialHasFogBlock(material: GX_Material.GXMaterial): boolean {
    return material.ropInfo.fogType !== GX.FogType.NONE;
}

export function autoOptimizeMaterial(material: GX_Material.GXMaterial): void {
    if (material.hasPostTexMtxBlock === undefined)
        material.hasPostTexMtxBlock = autoOptimizeMaterialHasPostTexMtxBlock(material);

    if (material.hasLightsBlock === undefined)
        material.hasLightsBlock = autoOptimizeMaterialHasLightsBlock(material);

    if (material.hasFogBlock === undefined)
        material.hasFogBlock = autoOptimizeMaterialHasFogBlock(material);
}

export function translateCullMode(cullMode: GX.CullMode): GfxCullMode {
    switch (cullMode) {
    case GX.CullMode.ALL:
        throw "whoops";
    case GX.CullMode.FRONT:
        return GfxCullMode.Front;
    case GX.CullMode.BACK:
        return GfxCullMode.Back;
    case GX.CullMode.NONE:
        return GfxCullMode.None;
    }
}

function translateBlendFactorCommon(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.ZERO:
        return GfxBlendFactor.Zero;
    case GX.BlendFactor.ONE:
        return GfxBlendFactor.One;
    case GX.BlendFactor.SRCALPHA:
        return GfxBlendFactor.SrcAlpha;
    case GX.BlendFactor.INVSRCALPHA:
        return GfxBlendFactor.OneMinusSrcAlpha;
    case GX.BlendFactor.DSTALPHA:
        return GfxBlendFactor.DstAlpha;
    case GX.BlendFactor.INVDSTALPHA:
        return GfxBlendFactor.OneMinusDstAlpha;
    default:
        throw new Error("whoops");
    }
}

function translateBlendSrcFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.Dst;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.OneMinusDst;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateBlendDstFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.Src;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.OneMinusSrc;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateCompareType(compareType: GX.CompareType): GfxCompareMode {
    switch (compareType) {
    case GX.CompareType.NEVER:
        return GfxCompareMode.Never;
    case GX.CompareType.LESS:
        return GfxCompareMode.Less;
    case GX.CompareType.EQUAL:
        return GfxCompareMode.Equal;
    case GX.CompareType.LEQUAL:
        return GfxCompareMode.LessEqual;
    case GX.CompareType.GREATER:
        return GfxCompareMode.Greater;
    case GX.CompareType.NEQUAL:
        return GfxCompareMode.NotEqual;
    case GX.CompareType.GEQUAL:
        return GfxCompareMode.GreaterEqual;
    case GX.CompareType.ALWAYS:
        return GfxCompareMode.Always;
    }
}

function translateGfxMegaState(material: GX_Material.GXMaterial) {
    const megaState: Partial<GfxMegaStateDescriptor> = {};
    megaState.cullMode = translateCullMode(material.cullMode);
    megaState.depthWrite = material.ropInfo.depthWrite;
    megaState.depthCompare = material.ropInfo.depthTest ? reverseDepthForCompareMode(translateCompareType(material.ropInfo.depthFunc)) : GfxCompareMode.Always;
    megaState.frontFace = GfxFrontFaceMode.CW;

    const attachmentStateSimple: Partial<AttachmentStateSimple> = {};

    if (material.ropInfo.blendMode === GX.BlendMode.NONE) {
        attachmentStateSimple.blendMode = GfxBlendMode.Add;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.One;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.Zero;
    } else if (material.ropInfo.blendMode === GX.BlendMode.BLEND) {
        attachmentStateSimple.blendMode = GfxBlendMode.Add;
        attachmentStateSimple.blendSrcFactor = translateBlendSrcFactor(material.ropInfo.blendSrcFactor);
        attachmentStateSimple.blendDstFactor = translateBlendDstFactor(material.ropInfo.blendDstFactor);
    } else if (material.ropInfo.blendMode === GX.BlendMode.SUBTRACT) {
        attachmentStateSimple.blendMode = GfxBlendMode.ReverseSubtract;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.One;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.One;
    } else if (material.ropInfo.blendMode === GX.BlendMode.LOGIC) {
        // Sonic Colors uses this? WTF?
        attachmentStateSimple.blendMode = GfxBlendMode.Add;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.One;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.Zero;
        console.warn(`Unimplemented LOGIC blend mode`);
    }

    attachmentStateSimple.channelWriteMask = GfxChannelWriteMask.None;

    if (material.ropInfo.colorUpdate)
        attachmentStateSimple.channelWriteMask |= GfxChannelWriteMask.RGB;
    if (material.ropInfo.alphaUpdate)
        attachmentStateSimple.channelWriteMask |= GfxChannelWriteMask.Alpha;

    setAttachmentStateSimple(megaState, attachmentStateSimple);
    return megaState;
}

export class GXMaterialHelperGfx {
    public programKey: number;
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public materialParamsBufferSize: number;
    public drawParamsBufferSize: number;
    private materialHacks: GX_Material.GXMaterialHacks = {};
    private program!: GX_Material.GX_Program;
    private gfxProgram: GfxProgram | null = null;
    public valid = true;

    constructor(public material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        if (materialHacks)
            Object.assign(this.materialHacks, materialHacks);

        this.materialInvalidated();
    }

    public autoOptimizeMaterial(): void {
        autoOptimizeMaterial(this.material);
        this.materialInvalidated();
    }

    private checkValid(): boolean {
        if (this.material.cullMode === GX.CullMode.ALL)
            return false;

        return true;
    }

    public materialInvalidated(): void {
        this.valid = this.checkValid();
        if (!this.valid)
            return;

        this.megaStateFlags = translateGfxMegaState(this.material);

        this.materialParamsBufferSize = GX_Material.getMaterialParamsBlockSize(this.material);
        this.drawParamsBufferSize = GX_Material.getDrawParamsBlockSize(this.material);
        this.createProgram();
    }

    public cacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(this.program);
            this.programKey = this.gfxProgram.ResourceUniqueId;
        }
    }

    public createProgram(): void {
        this.program = new GX_Material.GX_Program(this.material, this.materialHacks);
        this.gfxProgram = null;
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        Object.assign(this.materialHacks, materialHacks);
        this.createProgram();
    }

    public fillMaterialParamsData(renderInstManager: GfxRenderInstManager, offs: number, materialParams: MaterialParams): void {
        const uniformBuffer = renderInstManager.getCurrentTemplate().getUniformBuffer();
        const d = uniformBuffer.mapBufferF32();
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocateMaterialParamsBlock(renderInstManager: GfxRenderInstManager): number {
        const uniformBuffer = renderInstManager.getCurrentTemplate().getUniformBuffer();
        return uniformBuffer.allocateChunk(this.materialParamsBufferSize);
    }

    public allocateMaterialParamsDataOnInst(renderInst: GfxRenderInst, materialParams: MaterialParams): void {
        const offs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_MaterialParams, this.materialParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_MaterialParams);
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocateDrawParamsDataOnInst(renderInst: GfxRenderInst, drawParams: DrawParams): void {
        const offs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_DrawParams, this.drawParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_DrawParams);
        fillDrawParamsDataWithOptimizations(this.material, d, offs, drawParams);
    }

    public setOnRenderInst(cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        assert(this.valid);

        this.cacheProgram(cache);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setGfxProgram(this.gfxProgram!);
        setSortKeyProgramKey(renderInst.sortKey, this.programKey);
    }
}

export function setChanWriteEnabled(materialHelper: GXMaterialHelperGfx, bits: GfxChannelWriteMask, en: boolean): void {
    let channelWriteMask = materialHelper.megaStateFlags.attachmentsState![0].channelWriteMask;
    channelWriteMask = setBitFlagEnabled(channelWriteMask, bits, en);
    setAttachmentStateSimple(materialHelper.megaStateFlags, { channelWriteMask });
}

export function createInputLayout(cache: GfxRenderCache, loadedVertexLayout: LoadedVertexLayout): GfxInputLayout {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

    for (let attrInput: VertexAttributeInput = 0; attrInput < VertexAttributeInput.COUNT; attrInput++) {
        const attribLocation = GX_Material.getVertexInputLocation(attrInput);
        const attrib = loadedVertexLayout.singleVertexInputLayouts.find((attrib) => attrib.attrInput === attrInput);

        if (attrib !== undefined) {
            const bufferByteOffset = attrib.bufferOffset;
            const bufferIndex = attrib.bufferIndex;
            vertexAttributeDescriptors.push({ location: attribLocation, format: attrib.format, bufferIndex, bufferByteOffset });
        }
    }

    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    for (let i = 0; i < loadedVertexLayout.vertexBufferStrides.length; i++) {
        vertexBufferDescriptors.push({
            byteStride: loadedVertexLayout.vertexBufferStrides[i],
            frequency: GfxVertexBufferFrequency.PerVertex,
        });
    }

    const indexBufferFormat = loadedVertexLayout.indexFormat;
    return cache.createInputLayout({
        vertexAttributeDescriptors,
        vertexBufferDescriptors,
        indexBufferFormat,
    });
}

export class GXShapeHelperGfx {
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(device: GfxDevice, cache: GfxRenderCache, vertexBuffers: GfxVertexBufferDescriptor[], public indexBufferDescriptor: GfxIndexBufferDescriptor, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData | null = null) {
        this.vertexBufferDescriptors = vertexBuffers.slice();
        this.inputLayout = createInputLayout(cache, loadedVertexLayout);
    }

    public setOnRenderInst(renderInst: GfxRenderInst, draw: LoadedVertexDraw | null = null): void {
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        if (draw === null) {
            // Legacy API -- render a single draw.
            const loadedVertexData = assertExists(this.loadedVertexData);
            assert(loadedVertexData.draws.length === 1);
            draw = loadedVertexData.draws[0];
        }

        renderInst.setDrawCount(draw.indexCount, draw.indexOffset);
    }

    public destroy(device: GfxDevice): void {
    }
}

export const gxBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8, },
];

const sceneParams = new SceneParams();
export function fillSceneParamsDataOnTemplate(renderInst: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, customLODBias: number | null = null, sceneParamsScratch = sceneParams): void {
    mat4.copy(sceneParamsScratch.u_Projection, viewerInput.camera.projectionMatrix);
    sceneParams.u_SceneTextureLODBias = customLODBias !== null ? customLODBias : calcLODBias(viewerInput.backbufferWidth, viewerInput.backbufferHeight);
    let d = renderInst.allocateUniformBufferF32(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
    fillSceneParamsData(d, 0, sceneParamsScratch);
}

export class GXRenderHelperGfx extends GfxRenderHelper {
    public override pushTemplateRenderInst(): GfxRenderInst {
        const template = super.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        return template;
    }
}

export abstract class BasicGXRendererHelper implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public renderInstListMain = new GfxRenderInstList();
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected abstract prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void;

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderInstManager.gfxRenderCache;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}
