
// Common helpers for GX rendering.

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as Viewer from '../viewer';

import { assert } from '../util';
import { LoadedVertexData, LoadedVertexLayout, LoadedVertexPacket } from './gx_displaylist';

import { GfxCoalescedBuffers, makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxInputState, GfxVertexAttributeDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxProgram, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxVertexAttributeFrequency } from '../gfx/platform/GfxPlatform';
import { getFormatTypeFlags, FormatTypeFlags } from '../gfx/platform/GfxPlatformFormat';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderer2';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { MaterialParams, u_MaterialParamsBufferSize, ub_PacketParams, u_PacketParamsBufferSize, PacketParams, fillPacketParamsData, SceneParams, u_SceneParamsBufferSize, fillSceneParams, fillSceneParamsData, ub_SceneParams, fillMaterialParamsData } from './gx_render';

export class GXMaterialHelperGfx {
    public programKey: number;
    private materialHacks: GX_Material.GXMaterialHacks = {};
    private program!: GX_Material.GX_Program;
    private gfxProgram: GfxProgram | null = null;

    constructor(private material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        if (materialHacks)
            Object.assign(this.materialHacks, materialHacks);

        this.createProgram();
    }

    public cacheProgram(device: GfxDevice, cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(device, this.program);
            this.programKey = this.gfxProgram.ResourceUniqueId;
        }
    }

    private createProgram(): void {
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

    public setUseTextureCoords(v: boolean): void {
        this.materialHacks.useTextureCoords = v;
        this.createProgram();
    }

    public fillMaterialParamsData(renderHelper: GXRenderHelperGfx, offs: number, materialParams: MaterialParams): void {
        const d = renderHelper.uniformBuffer.mapBufferF32(offs, u_MaterialParamsBufferSize);
        fillMaterialParamsData(d, offs, materialParams);
    }

    public allocateMaterialParamsBlock(renderHelper: GXRenderHelperGfx): number {
        return renderHelper.uniformBuffer.allocateChunk(u_MaterialParamsBufferSize);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.cacheProgram(device, cache);
        GX_Material.translateGfxMegaState(renderInst.getMegaStateFlags(), this.material);
        renderInst.setGfxProgram(this.gfxProgram);
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

    constructor(device: GfxDevice, cache: GfxRenderCache, public coalescedBuffers: GfxCoalescedBuffers, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData) {
        // First, build the inputLayout
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        let usesZeroBuffer = false;
        for (let vtxAttrib: GX.VertexAttribute = 0; vtxAttrib <= GX.VertexAttribute.MAX; vtxAttrib++) {
            const attribLocation = GX_Material.getVertexAttribLocation(vtxAttrib);

            // TODO(jstpierre): Handle TEXMTXIDX attributes.
            if (attribLocation === -1)
                continue;

            const attribGenDef = GX_Material.getVertexAttribGenDef(vtxAttrib);
            const attrib = this.loadedVertexLayout.dstVertexAttributeLayouts.find((attrib) => attrib.vtxAttrib === vtxAttrib);
            const usesIntInShader = getFormatTypeFlags(attribGenDef.format) !== FormatTypeFlags.F32;

            if (attrib !== undefined) {
                const bufferByteOffset = attrib.offset;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attrib.format, bufferIndex: 0, bufferByteOffset, frequency: GfxVertexAttributeFrequency.PER_VERTEX, usesIntInShader });
            } else {
                usesZeroBuffer = true;
                vertexAttributeDescriptors.push({ location: attribLocation, format: attribGenDef.format, bufferIndex: 1, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, usesIntInShader });
            }
        }

        const indexBufferFormat = this.loadedVertexData.indexFormat;
        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors,
            indexBufferFormat,
        });
        const buffers: GfxVertexBufferDescriptor[] = [{
            buffer: coalescedBuffers.vertexBuffer.buffer,
            byteOffset: coalescedBuffers.vertexBuffer.wordOffset * 4,
            byteStride: loadedVertexLayout.dstVertexSize,
        }];

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
        if (packet !== null) {
            if (packet.indexCount === 624)
                debugger;
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        } else
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
        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[0].totalWordSize === u_SceneParamsBufferSize);
        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[1].totalWordSize === u_MaterialParamsBufferSize);
        assert(GX_Material.GX_Program.programReflection.uniformBufferLayouts[2].totalWordSize === u_PacketParamsBufferSize);

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
