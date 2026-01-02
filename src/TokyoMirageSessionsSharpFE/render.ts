import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxFormat, GfxProgram, GfxBufferFrequencyHint,
         GfxBufferUsage, GfxBindingLayoutDescriptor, GfxCullMode, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import * as BFRES from "./bfres/bfres_switch.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { TMSFEProgram } from './shader.js';

export class TMSFEScene implements SceneGfx
{
    private fres: BFRES.FRES;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, fres: BFRES.FRES)
    {
        this.fres = fres;
        this.renderHelper = new GfxRenderHelper(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        // create a draw call for every mesh in the fmdl
        const fmdl = this.fres.fmdl[0];
        const shapes = fmdl.fshp;
        for (let i = 0; i < 5; i++)
        {
            // the template is apparently required to use uniform buffers
            this.renderHelper.pushTemplateRenderInst();

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();

            // create vertex buffers
            const fvtx = fmdl.fvtx[shapes[i].fvtx_index];
            
            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
            [
                { location: 0, format: fvtx.vertexAttributes[0].format, bufferIndex: fvtx.vertexAttributes[0].bufferIndex, bufferByteOffset: fvtx.vertexAttributes[0].bufferOffset},
            ];
            
            const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
            [
                { byteStride: fvtx.vertexBuffers[0].stride, frequency: GfxVertexBufferFrequency.PerVertex },
            ];
            
            const indexBufferFormat = shapes[i].mesh[0].index_buffer_format;
            const cache = this.renderHelper.renderCache;
            const inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });
            
            
            const gfx_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[0].data);
            const vertexBufferDescriptors =
            [
                { buffer: gfx_buffer },
            ];

            const index_buffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shapes[i].mesh[0].index_buffer_data);
            const indexBufferDescriptor = { buffer: index_buffer };

            renderInst.setVertexInput(inputLayout, vertexBufferDescriptors, indexBufferDescriptor);
            renderInst.setDrawCount(shapes[i].mesh[0].index_count);

            // set shader
            const program = this.renderHelper.renderCache.createProgram(new TMSFEProgram());
            renderInst.setGfxProgram(program);
            
            // create uniform buffers for the shader
            const bindingLayouts: GfxBindingLayoutDescriptor[] =
            [
                { numUniformBuffers: 1, numSamplers: 0 },
            ];
            renderInst.setBindingLayouts(bindingLayouts);
            let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 32);
            const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
            uniform_buffer_offset += fillMatrix4x4(mapped, uniform_buffer_offset, viewerInput.camera.projectionMatrix);
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, viewerInput.camera.viewMatrix);

            renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
            
            // submit the draw call
            this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
            this.renderHelper.renderInstManager.submitRenderInst(renderInst);

            this.renderHelper.renderInstManager.popTemplate();
        }

        this.renderHelper.prepareToRender();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass
        (
            (pass) =>
            {
                pass.setDebugName('Main');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                pass.exec
                (
                    (passRenderer) =>
                    {
                        this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                    }
                );
            }
        );
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void
    {
        this.renderHelper.destroy();
        // TODO: destroy vertex buffer, index buffer, etc
    }
}
