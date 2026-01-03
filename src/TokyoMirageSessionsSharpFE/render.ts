import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxFormat, GfxProgram, GfxBufferFrequencyHint,
         GfxBufferUsage, GfxBindingLayoutDescriptor, GfxCullMode, GfxIndexBufferDescriptor, 
         GfxBuffer} from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import * as BFRES from "./bfres/bfres_switch.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { TMSFEProgram } from './shader.js';
import { FSHP } from "./bfres/fshp.js";
import { NumberHolder } from "../MetroidPrime/particles/base_generator.js";

export class TMSFEScene implements SceneGfx
{
    private fres: BFRES.FRES;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private fshp_renderers: fshp_renderer[] = [];

    constructor(device: GfxDevice, fres: BFRES.FRES)
    {
        this.fres = fres;
        this.renderHelper = new GfxRenderHelper(device);
        console.log(this.fres.fmdl[0]);

        // create all fshp_renderers
        const fmdl = this.fres.fmdl[0];
        const shapes = fmdl.fshp;
        for (let i = 0; i < shapes.length; i++)
        {
            const renderer = new fshp_renderer(device, this.renderHelper, fmdl, i);
            this.fshp_renderers.push(renderer);
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].render(this.renderHelper, viewerInput, this.renderInstListMain);
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
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].destroy(device);
        }
    }
}

class fshp_renderer
{
    private vertex_buffer: GfxBuffer;
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, fmdl: BFRES.FMDL, shape_index: number)
    {

        // create vertex buffers
        const fshp = fmdl.fshp[shape_index];
        const fvtx = fmdl.fvtx[fshp.fvtx_index];
        const mesh = fshp.mesh[0];
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
        [
            { location: 0, format: fvtx.vertexAttributes[0].format, bufferIndex: fvtx.vertexAttributes[0].bufferIndex, bufferByteOffset: fvtx.vertexAttributes[0].bufferOffset},
        ];
            
        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
        [
            { byteStride: fvtx.vertexBuffers[0].stride, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const indexBufferFormat = mesh.index_buffer_format;
        const cache = renderHelper.renderCache;
        this.input_layout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });
        this.vertex_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[0].data);
        this.vertex_buffer_descriptors =
        [
            { buffer: this.vertex_buffer },
        ];
        this.index_buffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.index_buffer_data);
        this.index_count = mesh.index_count;
        this.index_buffer_descriptor = { buffer: this.index_buffer };
    }

    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList): void
    {
        // the template is apparently necessary to use uniform buffers
        renderHelper.pushTemplateRenderInst();
        
        const renderInst = renderHelper.renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.input_layout, this.vertex_buffer_descriptors, this.index_buffer_descriptor);
        renderInst.setDrawCount(this.index_count);

        // set shader
        const program = renderHelper.renderCache.createProgram(new TMSFEProgram());
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
        renderHelper.renderInstManager.setCurrentList(renderInstListMain);
        renderHelper.renderInstManager.submitRenderInst(renderInst);

        renderHelper.renderInstManager.popTemplate();
    }

    destroy(device: GfxDevice): void
    {
        device.destroyBuffer(this.vertex_buffer);
        device.destroyBuffer(this.index_buffer);
    }
}
