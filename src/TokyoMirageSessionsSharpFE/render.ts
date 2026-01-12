import { APAK, get_files_of_type } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers.js";
import { CameraController } from "../Camera.js";
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { FMDL } from "./bfres/fmdl.js";
import { recursive_bone_transform } from "./bfres/fskl.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingLayoutDescriptor,
         GfxCullMode, GfxBuffer, GfxSamplerBinding, GfxTexture} from "../gfx/platform/GfxPlatform.js";
import { mat4 } from "gl-matrix";
import { get_level_bfres_names } from "./levels.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { TMSFEProgram } from './shader.js';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";

export class TMSFEScene implements SceneGfx
{
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private fshp_renderers: fshp_renderer[] = [];

    constructor(device: GfxDevice, level_id: string, apak: APAK)
    {
        // get bfres files
        const fres_files: FRES[] = [];
        const level_file_names = get_level_bfres_names(level_id);
        for (let i = 0; i < level_file_names.length; i++)
        {
            const file_name = `${level_file_names[i]}.bfres`
            const file = apak.files.find((f) => f.name === file_name);
            if (file !== undefined)
            {
                fres_files.push(parseBFRES(file.data));
            }
            else
            {
                console.error(`file ${file_name} not found (level_id ${level_id})`);
                throw("whoops");
            }
        }
        // const bfres_buffers = get_files_of_type(apak, "bfres");
        // for (let i = 0; i < bfres_buffers.length; i++)
        // {
        //     fres_files.push(parseBFRES(bfres_buffers[i]));
        // }

        for(let i = 0; i < fres_files.length; i++)
        {
            const fres = fres_files[i];
            this.renderHelper = new GfxRenderHelper(device);

            //initialize textures
            const bntx = BNTX.parse(fres.embedded_files[0].buffer);
            const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

            // create all fshp_renderers
            const fmdl = fres.fmdl[0];
            const shapes = fmdl.fshp;
            for (let i = 0; i < shapes.length; i++)
            {
                const renderer = new fshp_renderer(device, this.renderHelper, fmdl, i, bntx, gfx_texture_array);
                this.fshp_renderers.push(renderer);
            }
        }
    }

    public adjustCameraController(c: CameraController)
    {
            c.setSceneMoveSpeedMult(2 / 60);
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
    private vertex_buffers: GfxBuffer[] = [];
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[] = [];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;
    private transform_matrix: mat4 = mat4.create();
    private program: TMSFEProgram;
    private sampler_bindings: GfxSamplerBinding[] = [];

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, fmdl: FMDL, shape_index: number, bntx: BNTX.BNTX, gfx_texture_array: GfxTexture[])
    {
        // create vertex buffers
        const fshp = fmdl.fshp[shape_index];
        const fvtx = fmdl.fvtx[fshp.fvtx_index];
        const mesh = fshp.mesh[0];

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const attribute_assign = new Map<string, string>();
        for (let i = 0; i < fvtx.vertexAttributes.length; i++)
        {
            vertexAttributeDescriptors.push
            ({
                location: i,
                format: fvtx.vertexAttributes[i].format,
                bufferIndex: fvtx.vertexAttributes[i].bufferIndex,
                bufferByteOffset: fvtx.vertexAttributes[i].bufferOffset
            });
        }

        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];

        for (let i = 0; i < fvtx.vertexBuffers.length; i++)
        {
            inputLayoutBufferDescriptors.push
            ({
                byteStride: fvtx.vertexBuffers[i].stride,
                frequency: GfxVertexBufferFrequency.PerVertex
            });

            const vertex_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[i].data);
            this.vertex_buffers.push(vertex_buffer);
            this.vertex_buffer_descriptors.push({ buffer: this.vertex_buffers[i] });
        }
        
        this.input_layout = renderHelper.renderCache.createInputLayout
        ({
            vertexAttributeDescriptors,
            vertexBufferDescriptors: inputLayoutBufferDescriptors,
            indexBufferFormat: mesh.index_buffer_format,
        });

        // create index buffer
        this.index_buffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.index_buffer_data);
        this.index_count = mesh.index_count;
        this.index_buffer_descriptor = { buffer: this.index_buffer };

        // setup transformation matrix
        const bone = fmdl.fskl.bones[fshp.bone_index];
        this.transform_matrix = recursive_bone_transform(fmdl.fskl.bones[fshp.bone_index], fmdl.fskl);
        
        // setup sampler
        const fmat = fmdl.fmat[fshp.fmat_index];
        // for (let i = 0; i < fmat.texture_names.length; i++)
        // TODO: sometimes a cubemap isn't being found?? whats up with that
        for (let i = 0; i < 1; i++)
        {
            const texture_name = fmat.texture_names[i];
            const texture = bntx.textures.find((f) => f.name === texture_name);
            if (texture !== undefined)
            {
                const texture_index = bntx.textures.indexOf(texture);
                const gfx_texture = gfx_texture_array[texture_index];
                const sampler_descriptor = fmat.sampler_descriptors[i];
                const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
                this.sampler_bindings.push({ gfxTexture: gfx_texture, gfxSampler: gfx_sampler, lateBinding: null })
            }
            else
            {
                console.error(`texture ${texture_name} not found (fmdl ${fmdl.name}`);
                throw("whoops");
            }
        }

        // initialize shader
        this.program = new TMSFEProgram(fvtx, fmat);
    }

    // produce a draw call for this mesh
    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList): void
    {
        // the template is necessary to use uniform buffers
        renderHelper.pushTemplateRenderInst();

        const renderInst = renderHelper.renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.input_layout, this.vertex_buffer_descriptors, this.index_buffer_descriptor);
        renderInst.setDrawCount(this.index_count);

        // set shader
        const program = renderHelper.renderCache.createProgram(this.program);
        renderInst.setGfxProgram(program);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: this.sampler_bindings.length }];
        
        // create uniform buffers for the shader
        renderInst.setBindingLayouts(bindingLayouts);
        let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 44);
        const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
        uniform_buffer_offset += fillMatrix4x4(mapped, uniform_buffer_offset, viewerInput.camera.projectionMatrix);
        uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, viewerInput.camera.viewMatrix);
        uniform_buffer_offset += fillMatrix4x4(mapped, uniform_buffer_offset, this.transform_matrix);

        // set sampler
        renderInst.setSamplerBindingsFromTextureMappings(this.sampler_bindings);

        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        
        // submit the draw call
        renderHelper.renderInstManager.setCurrentList(renderInstListMain);
        renderHelper.renderInstManager.submitRenderInst(renderInst);

        renderHelper.renderInstManager.popTemplate();
    }

    destroy(device: GfxDevice): void
    {
        for (let i = 0; i < this.vertex_buffers.length; i++)
        {
            device.destroyBuffer(this.vertex_buffers[i]);
        }
        device.destroyBuffer(this.index_buffer);
    }
}
