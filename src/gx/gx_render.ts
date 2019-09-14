
// Common helpers for GX rendering.

import { mat4 } from 'gl-matrix';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from '../viewer';

import { assert, nArray } from '../util';
import { LoadedVertexData, LoadedVertexPacket, LoadedVertexLayout } from './gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { TextureMapping, TextureHolder, LoadedTexture } from '../TextureHolder';

import { GfxBufferCoalescerCombo, makeStaticDataBuffer, GfxCoalescedBuffersCombo } from '../gfx/helpers/BufferHelpers';
import { fillColor, fillMatrix4x3, fillVec4, fillMatrix4x4, fillVec3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxFormat, GfxDevice, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxTextureDimension, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxVertexAttributeFrequency, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { Camera } from '../Camera';
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyProgramKey } from '../gfx/render/GfxRenderer';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { Color, TransparentBlack, colorNewCopy } from '../Color';

export enum ColorKind {
    MAT0, MAT1, AMB0, AMB1,
    K0, K1, K2, K3,
    CPREV, C0, C1, C2,
    COUNT,
}

export class SceneParams {
    public u_Projection: mat4 = mat4.create();
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
}

export class PacketParams {
    public u_PosMtx: mat4[] = nArray(10, () => mat4.create());

    public clear(): void {
        for (let i = 0; i < 10; i++)
            mat4.identity(this.u_PosMtx[i]);
    }
}

export const ub_SceneParams = 0;
export const ub_MaterialParams = 1;
export const ub_PacketParams = 2;

export const u_SceneParamsBufferSize = 4*4 + 4;
export const u_MaterialParamsBufferSize = 4*2 + 4*2 + 4*4 + 4*4 + 4*3*10 + 4*8 + 4*2*3 + 4*3*20 + 4*5*8;
export const u_PacketParamsBufferSize = 4*3*10;

export function fillSceneParamsData(d: Float32Array, bOffs: number, sceneParams: SceneParams): void {
    let offs = bOffs;

    offs += fillMatrix4x4(d, offs, sceneParams.u_Projection);
    // u_Misc0
    offs += fillVec4(d, offs, sceneParams.u_SceneTextureLODBias);

    assert(offs === bOffs + u_SceneParamsBufferSize);
    assert(d.length >= offs);
}

export function fillLightData(d: Float32Array, offs: number, light: GX_Material.Light): number {
    offs += fillColor(d, offs, light.Color);
    offs += fillVec3(d, offs, light.Position);
    offs += fillVec3(d, offs, light.Direction);
    offs += fillVec3(d, offs, light.DistAtten);
    offs += fillVec3(d, offs, light.CosAtten);
    return 4*5;
}

export function fillTextureMappingInfo(d: Float32Array, offs: number, textureMapping: TextureMapping): number {
    return fillVec4(d, offs, 1 / textureMapping.width, (textureMapping.flipY ? -1 : 1) / textureMapping.height, 0, textureMapping.lodBias);
}

function fillMaterialParamsDataWithOptimizations(material: GX_Material.GXMaterial, d: Float32Array, bOffs: number, materialParams: MaterialParams): void {
    let offs = bOffs;

    for (let i = 0; i < 12; i++)
        offs += fillColor(d, offs, materialParams.u_Color[i]);
    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_TexMtx[i]);
    for (let i = 0; i < 8; i++)
        offs += fillTextureMappingInfo(d, offs, materialParams.m_TextureMapping[i]);
    for (let i = 0; i < 3; i++)
        offs += fillMatrix4x2(d, offs, materialParams.u_IndTexMtx[i]);
    if (GX_Material.materialHasPostTexMtxBlock(material))
        for (let i = 0; i < 20; i++)
            offs += fillMatrix4x3(d, offs, materialParams.u_PostTexMtx[i]);
    if (GX_Material.materialHasLightsBlock(material))
        for (let i = 0; i < 8; i++)
            offs += fillLightData(d, offs, materialParams.u_Lights[i]);

    assert(d.length >= offs);
}

export function fillPacketParamsData(d: Float32Array, bOffs: number, packetParams: PacketParams): void {
    let offs = bOffs;

    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, packetParams.u_PosMtx[i]);

    assert(offs === bOffs + u_PacketParamsBufferSize);
    assert(d.length >= offs);
}

export function fillSceneParams(sceneParams: SceneParams, camera: Camera, viewportWidth: number, viewportHeight: number): void {
    mat4.copy(sceneParams.u_Projection, camera.projectionMatrix);
    // Mip levels in GX are assumed to be relative to the GameCube's embedded framebuffer (EFB) size,
    // which is hardcoded to be 640x528. We need to bias our mipmap LOD selection by this amount to
    // make sure textures are sampled correctly...
    const textureLODBias = Math.log2(Math.min(viewportWidth / GX_Material.EFB_WIDTH, viewportHeight / GX_Material.EFB_HEIGHT));
    sceneParams.u_SceneTextureLODBias = textureLODBias;
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

    public activate(): Promise<void> | null {
        if (this.surfaces.length !== 0)
            return null;

        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.mipChain.mipLevels.length; i++) {
            const mipLevel = this.mipChain.mipLevels[i];

            const canvas = document.createElement('canvas');
            canvas.width = mipLevel.width;
            canvas.height = mipLevel.height;
            canvas.title = mipLevel.name;
            this.surfaces.push(canvas);

            promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
                const ctx = canvas.getContext('2d')!;
                const imgData = new ImageData(mipLevel.width, mipLevel.height);
                imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
                ctx.putImageData(imgData, 0, 0);
            }));
        }

        return Promise.all(promises) as any as Promise<void>;
    }
}

export function loadTextureFromMipChain(device: GfxDevice, mipChain: GX_Texture.MipChain): LoadedTexture {
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA, width: firstMipLevel.width, height: firstMipLevel.height, numLevels: mipChain.mipLevels.length,
        depth: 1, dimension: GfxTextureDimension.n2D,
    });
    device.setResourceName(gfxTexture, mipChain.name);

    const hostAccessPass = device.createHostAccessPass();
    const surfaces: HTMLCanvasElement[] = [];
    const promises: Promise<void>[] = [];
    for (let i = 0; i < mipChain.mipLevels.length; i++) {
        const level = i;
        const mipLevel = mipChain.mipLevels[i];

        promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
            hostAccessPass.uploadTextureData(gfxTexture, level, [rgbaTexture.pixels]);
        }));
    }

    Promise.all(promises).then(() => {
        device.submitPass(hostAccessPass);
    });

    const viewerExtraInfo = new Map<string, string>();
    viewerExtraInfo.set("Format", GX_Texture.getFormatName(firstMipLevel.format, firstMipLevel.paletteFormat));

    const viewerTexture = new GXViewerTexture(mipChain, viewerExtraInfo);
    return { gfxTexture, viewerTexture };
}

export function translateWrapModeGfx(wrapMode: GX.WrapMode): GfxWrapMode {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return GfxWrapMode.CLAMP;
    case GX.WrapMode.MIRROR:
        return GfxWrapMode.MIRROR;
    case GX.WrapMode.REPEAT:
        return GfxWrapMode.REPEAT;
    }
}

export function translateTexFilterGfx(texFilter: GX.TexFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (texFilter) {
    case GX.TexFilter.LINEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.LIN_MIP_LIN:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.NEAR_MIP_LIN:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.LIN_MIP_NEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST ];
    case GX.TexFilter.NEAR_MIP_NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST ];
    }
}

export class GXTextureHolder<TextureType extends GX_Texture.Texture = GX_Texture.Texture> extends TextureHolder<TextureType> {
    protected loadTexture(device: GfxDevice, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(device, mipChain);
    }
}

export function setTevOrder(texCoordId: GX.TexCoordID, texMap: GX.TexMapID, channelId: GX.RasColorChannelID) {
    return { texCoordId, texMap, channelId };
}

export function setTevColorIn(colorInA: GX.CombineColorInput, colorInB: GX.CombineColorInput, colorInC: GX.CombineColorInput, colorInD: GX.CombineColorInput) {
    return { colorInA, colorInB, colorInC, colorInD };
}

export function setTevAlphaIn(alphaInA: GX.CombineAlphaInput, alphaInB: GX.CombineAlphaInput, alphaInC: GX.CombineAlphaInput, alphaInD: GX.CombineAlphaInput) {
    return { alphaInA, alphaInB, alphaInC, alphaInD };
}

export function setTevColorOp(colorOp: GX.TevOp, colorBias: GX.TevBias, colorScale: GX.TevScale, colorClamp: boolean, colorRegId: GX.Register) {
    return { colorOp, colorBias, colorScale, colorClamp, colorRegId };
}

export function setTevAlphaOp(alphaOp: GX.TevOp, alphaBias: GX.TevBias, alphaScale: GX.TevScale, alphaClamp: boolean, alphaRegId: GX.Register) {
    return { alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId };
}

export function setTevIndirect(indTexStageID: GX.IndTexStageID, format: GX.IndTexFormat, biasSel: GX.IndTexBiasSel, matrixSel: GX.IndTexMtxID, wrapS: GX.IndTexWrap, wrapT: GX.IndTexWrap, addPrev: boolean, utcLod: boolean, alphaSel: GX.IndTexAlphaSel) {
    return {
        indTexStage: indTexStageID,
        indTexFormat: format,
        indTexBiasSel: biasSel,
        indTexMatrix: matrixSel,
        indTexWrapS: wrapS,
        indTexWrapT: wrapT,
        indTexAddPrev: addPrev,
        indTexUseOrigLOD: utcLod,
    }
}

export function setTevIndWarp(indTexStageID: GX.IndTexStageID, signedOffsets: boolean, replaceMode: boolean, matrixSel: GX.IndTexMtxID) {
    const wrap = replaceMode ? GX.IndTexWrap._0 : GX.IndTexWrap.OFF;
    return {
        indTexStage: indTexStageID,
        indTexFormat: GX.IndTexFormat._8,
        indTexBiasSel: signedOffsets ? GX.IndTexBiasSel.STU : GX.IndTexBiasSel.NONE,
        indTexMatrix: matrixSel,
        indTexWrapS: wrap,
        indTexWrapT: wrap,
        indTexAddPrev: false,
        indTexUseOrigLOD: false,
    };
}

export function setIndTexOrder(texCoordId: GX.TexCoordID, texture: GX.TexMapID) {
    return { texCoordId, texture };
}

export function setIndTexCoordScale(scaleS: GX.IndTexScale, scaleT: GX.IndTexScale) {
    return { scaleS, scaleT };
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

export function fillIndTexMtxData(d_: Float32Array, offs: number, src: Float32Array): number {
    const a = src[0], c = src[1], tx = src[2], scale = src[3];
    const b = src[4], d = src[5], ty = src[6];
    d_[offs + 0] = a;
    d_[offs + 1] = c;
    d_[offs + 2] = tx;
    d_[offs + 3] = scale;
    d_[offs + 4] = b;
    d_[offs + 5] = d;
    d_[offs + 6] = ty;
    d_[offs + 7] = 0;
    return 4*2;
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

export function autoOptimizeMaterial(material: GX_Material.GXMaterial): void {
    if (material.hasPostTexMtxBlock === undefined)
        material.hasPostTexMtxBlock = autoOptimizeMaterialHasPostTexMtxBlock(material);

    if (material.hasLightsBlock === undefined)
        material.hasLightsBlock = autoOptimizeMaterialHasLightsBlock(material);
}

export class GXMaterialHelperGfx {
    public programKey: number;
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public materialParamsBufferSize: number;
    private materialHacks: GX_Material.GXMaterialHacks = {};
    private program!: GX_Material.GX_Program;
    private gfxProgram: GfxProgram | null = null;

    constructor(public material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        if (materialHacks)
            Object.assign(this.materialHacks, materialHacks);

        this.calcMaterialParamsBufferSize();
        this.createProgram();

        this.megaStateFlags = {};
        GX_Material.translateGfxMegaState(this.megaStateFlags, this.material);
    }

    public calcMaterialParamsBufferSize(): void {
        this.materialParamsBufferSize = GX_Material.getMaterialParamsBlockSize(this.material);
    }

    public cacheProgram(device: GfxDevice, cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(device, this.program);
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

    public fillMaterialParamsDataOnInst(renderInst: GfxRenderInst, offs: number, materialParams: MaterialParams): void {
        const d = renderInst.mapUniformBufferF32(ub_MaterialParams);
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public fillMaterialParamsData(renderInstManager: GfxRenderInstManager, offs: number, materialParams: MaterialParams): void {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        const d = uniformBuffer.mapBufferF32(offs, this.materialParamsBufferSize);
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocateMaterialParams(renderInst: GfxRenderInst): number {
        return renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialParamsBufferSize);
    }

    public allocateMaterialParamsBlock(renderInstManager: GfxRenderInstManager): number {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        return uniformBuffer.allocateChunk(this.materialParamsBufferSize);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.cacheProgram(device, cache);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setGfxProgram(this.gfxProgram);
        setSortKeyProgramKey(renderInst.sortKey, this.programKey);
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxProgram !== null)
            device.destroyProgram(this.gfxProgram);
    }
}

export class GXShapeHelperGfx {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    private zeroBuffer: GfxBuffer | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, coalescedBuffers: GfxCoalescedBuffersCombo, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        // First, build the inputLayout
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        let usesZeroBuffer = false;
        const zeroBufferIndex = loadedVertexData.vertexBuffers.length;
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib <= GX.VertexAttribute.MAX; vtxAttrib++) {
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);

            if (attribLocation === -1)
                continue;

            const attribGenDef = GX_Material.getVertexAttribGenDef(vtxAttrib);
            const attrib = this.loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === vtxAttrib);
            const usesIntInShader = getFormatTypeFlags(attribGenDef.format) !== FormatTypeFlags.F32;

            if (attrib !== undefined) {
                const bufferByteOffset = attrib.bufferOffset;
                const bufferIndex = attrib.bufferIndex;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attrib.format, bufferIndex, bufferByteOffset, frequency: GfxVertexAttributeFrequency.PER_VERTEX, usesIntInShader });
            } else {
                usesZeroBuffer = true;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attribGenDef.format, bufferIndex: zeroBufferIndex, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, usesIntInShader });
            }
        }

        const indexBufferFormat = this.loadedVertexData.indexFormat;
        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors,
            indexBufferFormat,
        });

        const buffers: GfxVertexBufferDescriptor[] = [];
        for (let i = 0; i < loadedVertexData.vertexBuffers.length; i++) {
            buffers.push({
                buffer: coalescedBuffers.vertexBuffers[i].buffer,
                byteOffset: coalescedBuffers.vertexBuffers[i].wordOffset * 4,
                byteStride: loadedVertexData.vertexBufferStrides[i],
            });
        }

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
            buffers.push({ buffer: this.zeroBuffer, byteOffset: 0, byteStride: 0 });
        }

        const indexBuffer: GfxVertexBufferDescriptor = {
            buffer: coalescedBuffers.indexBuffer.buffer,
            byteOffset: coalescedBuffers.indexBuffer.wordOffset * 4,
            byteStride: 0,
        }
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public pushRenderInst(renderInstManager: GfxRenderInstManager, packet: LoadedVertexPacket | null = null): GfxRenderInst {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        if (packet !== null)
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
        return renderInst;
    }

    public fillPacketParams(packetParams: PacketParams, renderInst: GfxRenderInst): void {
        let offs = renderInst.getUniformBufferOffset(ub_PacketParams);
        const d = renderInst.mapUniformBufferF32(ub_PacketParams);
        fillPacketParamsData(d, offs, packetParams);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

export const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8, },
];

const sceneParams = new SceneParams();
export function fillSceneParamsDataOnTemplate(renderInst: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, sceneParamsScratch = sceneParams): void {
    fillSceneParams(sceneParamsScratch, viewerInput.camera, viewerInput.viewportWidth, viewerInput.viewportHeight);

    let offs = renderInst.getUniformBufferOffset(ub_SceneParams);
    const d = renderInst.mapUniformBufferF32(ub_SceneParams);
    fillSceneParamsData(d, offs, sceneParamsScratch);
}

export class GXRenderHelperGfx extends GfxRenderHelper {
    public pushTemplateRenderInst(): GfxRenderInst {
        const template = super.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
        return template;
    }
}

export abstract class BasicGXRendererHelper implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GXRenderHelperGfx;
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected abstract prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void;

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderInstManager.gfxRenderCache;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, this.clearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
    }
}
