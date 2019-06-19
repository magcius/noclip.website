
// Common helpers for GX rendering.

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as Viewer from '../viewer';

import { LoadedVertexData, LoadedVertexLayout, LoadedVertexPacket } from './gx_displaylist';

import { makeStaticDataBuffer, GfxCoalescedBuffersCombo } from '../gfx/helpers/BufferHelpers';
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxProgram, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxVertexAttributeFrequency, GfxMegaStateDescriptor, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderer2';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { MaterialParams, ub_PacketParams, u_PacketParamsBufferSize, PacketParams, fillPacketParamsData, SceneParams, u_SceneParamsBufferSize, fillSceneParams, fillSceneParamsData, ub_SceneParams, fillMaterialParamsDataWithOptimizations } from './gx_render';
import { setSortKeyProgramKey } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';

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

        this.createProgram();

        this.materialParamsBufferSize = GX_Material.getMaterialParamsBlockSize(this.material);

        this.megaStateFlags = {};
        GX_Material.translateGfxMegaState(this.megaStateFlags, this.material);
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

    public setVertexColorsEnabled(v: boolean): void {
        this.materialHacks.disableVertexColors = !v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.materialHacks.disableTextures = !v;
        this.createProgram();
    }

    public setLightingEnabled(v: boolean): void {
        this.materialHacks.disableLighting = !v;
        this.createProgram();
    }

    public setUseTextureCoords(v: boolean): void {
        this.materialHacks.useTextureCoords = v;
        this.createProgram();
    }

    public fillMaterialParamsData(renderHelper: GXRenderHelperGfx, offs: number, materialParams: MaterialParams): void {
        const d = renderHelper.uniformBuffer.mapBufferF32(offs, this.materialParamsBufferSize);
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocateMaterialParamsBlock(renderHelper: GXRenderHelperGfx): number {
        return renderHelper.uniformBuffer.allocateChunk(this.materialParamsBufferSize);
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
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8, },
];

export class GXRenderHelperGfx {
    private sceneParams = new SceneParams();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    constructor(device: GfxDevice) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public fillSceneParams(viewerInput: Viewer.ViewerRenderInput, renderInst: GfxRenderInst): void {
        fillSceneParams(this.sceneParams, viewerInput.camera, viewerInput.viewportWidth, viewerInput.viewportHeight);

        let offs = renderInst.getUniformBufferOffset(ub_SceneParams);
        const d = renderInst.mapUniformBufferF32(ub_SceneParams);
        fillSceneParamsData(d, offs, this.sceneParams);
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        template.setBindingLayouts(bindingLayouts);
        template.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
        return template;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass): void {
        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.uniformBuffer.destroy(device);
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
