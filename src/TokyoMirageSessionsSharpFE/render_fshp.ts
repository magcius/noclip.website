// render_fshp.ts
// renders a single mesh from a model in a bfres file

import * as BNTX from '../fres_nx/bntx.js';
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { computeViewMatrixSkybox } from '../Camera.js';
import { FVTX } from "./bfres/fvtx.js";
import { FSHP } from "./bfres/fshp.js";
import { FMAT } from "./bfres/fmat.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingLayoutDescriptor,
         GfxCullMode, GfxBuffer, GfxSamplerBinding, GfxTexture} from "../gfx/platform/GfxPlatform.js";
import { mat4 } from "gl-matrix";
import { TMSFEProgram } from './shader.js';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { ViewerRenderInput } from "../viewer.js";

/**
 * renders a single mesh from a model
 */
export class fshp_renderer
{
    public bone_index: number;
    public skin_bone_count: number;
    public fmat_index: number;
    public do_not_render: boolean = false;

    private vertex_buffers: GfxBuffer[] = [];
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[] = [];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;
    private program: TMSFEProgram;
    private sampler_bindings: GfxSamplerBinding[] = [];

    constructor
    (
        fvtx: FVTX,
        fshp: FSHP,
        fmat: FMAT,
        bntx: BNTX.BNTX,
        gfx_texture_array: GfxTexture[],
        bone_matrix_array_length: number,
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
    )
    {
        this.bone_index = fshp.bone_index;
        this.skin_bone_count = fshp.skin_bone_count;
        this.fmat_index = fshp.fmat_index;

        // create vertex buffers
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
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
        
        const mesh = fshp.mesh[0];

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

        // setup sampler
        // TODO: sometimes a cubemap isn't being found?? whats up with that
        for (let i = 0; i < fmat.sampler_names.length; i++)
        {
            // TODO: for now just grabbing s_diffuse
            if (fmat.sampler_names[i] != "s_diffuse")
            {
                continue;
            }
            const texture_name = fmat.texture_names[i];
            if (texture_name == undefined)
            {
                // TODO: not sure what to do if there's no texture
                console.log(`fmat ${fmat.name} has an undefined texture`);
                this.do_not_render = true;
                continue;
            }
            const texture = bntx.textures.find((f) => f.name === texture_name);
            if (texture !== undefined)
            {
                const gfx_texture_index = bntx.textures.indexOf(texture);
                const gfx_texture = gfx_texture_array[gfx_texture_index];
                const sampler_descriptor = fmat.sampler_descriptors[i];
                const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
                this.sampler_bindings.push({ gfxTexture: gfx_texture, gfxSampler: gfx_sampler, lateBinding: null })
            }
            else
            {
                console.error(`texture ${texture_name} not found (fshp ${fshp.name})`);
                throw("whoops");
            }
        }
        if (this.sampler_bindings.length == 0)
        {
            this.do_not_render = true;
        }

        // initialize shader
        this.program = new TMSFEProgram(fvtx, fmat, fshp, bone_matrix_array_length);
    }

    /**
     * produce a draw call for this mesh
     * @param renderHelper 
     * @param viewerInput 
     * @param renderInstListMain 
     * @returns 
     */
    render
    (
        renderHelper: GfxRenderHelper,
        viewerInput: ViewerRenderInput,
        renderInstListMain: GfxRenderInstList,
        renderInstListSkybox: GfxRenderInstList,
        transform_matrix: mat4,
        bone_matrix_array: mat4[],
        special_skybox: boolean,
    ): void
    {
        if (this.do_not_render)
        {
            return;
        }
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
        // size 16 + 12 + 12 + (12 * bone count)
        let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 40 + (12 * bone_matrix_array.length));
        const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
        uniform_buffer_offset += fillMatrix4x4(mapped, uniform_buffer_offset, viewerInput.camera.projectionMatrix);

        if (special_skybox)
        {
            // a matrix without the camera's position, results in the skybox mesh following the camera
            let skybox_view_matrix: mat4 = mat4.create();
            computeViewMatrixSkybox(skybox_view_matrix, viewerInput.camera);
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, skybox_view_matrix);
        }
        else
        {
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, viewerInput.camera.viewMatrix);
        }
        
        uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, transform_matrix);

        for (let i = 0; i < bone_matrix_array.length; i++)
        {
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, bone_matrix_array[i]);
        }

        // set sampler
        renderInst.setSamplerBindingsFromTextureMappings(this.sampler_bindings);

        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        
        // submit the draw call
        if (special_skybox)
        {
            renderHelper.renderInstManager.setCurrentList(renderInstListSkybox);
        }
        else
        {
            renderHelper.renderInstManager.setCurrentList(renderInstListMain);
        }
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
