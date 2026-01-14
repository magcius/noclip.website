// render_fshp.ts
// renders a single mesh from a model in a bfres file

import * as BNTX from '../fres_nx/bntx.js';
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { FMDL } from "./bfres/fmdl.js";
import { recursive_bone_transform } from "./bfres/fskl.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingLayoutDescriptor,
         GfxCullMode, GfxBuffer, GfxSamplerBinding, GfxTexture} from "../gfx/platform/GfxPlatform.js";
import { vec3, mat4 } from "gl-matrix";
import { computeModelMatrixSRT } from '../MathHelpers.js';
import { TMSFEProgram } from './shader.js';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { assert } from "../util.js";
import { ViewerRenderInput } from "../viewer.js";

export class fshp_renderer
{
    private vertex_buffers: GfxBuffer[] = [];
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[] = [];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;
    private transform_matrix: mat4 = mat4.create();
    private bone_matrix_array: mat4[] = [];
    private program: TMSFEProgram;
    private sampler_bindings: GfxSamplerBinding[] = [];
    private do_not_render: boolean = false;

    constructor
    (
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
        fmdl: FMDL,
        shape_index:number,
        bntx: BNTX.BNTX,
        gfx_texture_array: GfxTexture[],
        position: vec3,
        rotation: vec3,
        scale: vec3,
    )
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
        computeModelMatrixSRT
        (
            this.transform_matrix,
            scale[0], scale[1], scale[2],
            rotation[0], rotation[1], rotation[2],
            position[0], position[1], position[2],
        );

        // setup bone transformation matrices
        const fskl = fmdl.fskl;
        if (fshp.skin_bone_count == 0)
        {
            // mesh uses it's bone's transformation matrix
            const transformation_matrix = recursive_bone_transform(fshp.bone_index, fskl);
            this.bone_matrix_array.push(transformation_matrix);
        }
        if (fshp.skin_bone_count == 1)
        {
            assert(fskl.smooth_rigid_indices.length < BONE_MATRIX_MAX_LENGTH);

            this.bone_matrix_array = [];
            for (let i = 0; i < fskl.smooth_rigid_indices.length; i++)
            {
                const transformation_matrix = recursive_bone_transform(fskl.smooth_rigid_indices[i], fskl)
                this.bone_matrix_array.push(transformation_matrix);
            }
        }
        if (fshp.skin_bone_count > 1)
        {
            // mesh uses it's bone's parent bone transformation matrix?? this seems incorrect but it works
            const bone = fskl.bones[fshp.bone_index]
            const transformation_matrix = recursive_bone_transform(bone.parent_index, fskl);
            this.bone_matrix_array.push(transformation_matrix);
        }

        // setup sampler
        const fmat = fmdl.fmat[fshp.fmat_index];
        // for (let i = 0; i < fmat.texture_names.length; i++)
        // TODO: sometimes a cubemap isn't being found?? whats up with that
        for (let i = 0; i < 1; i++)
        {
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
                const texture_index = bntx.textures.indexOf(texture);
                const gfx_texture = gfx_texture_array[texture_index];
                const sampler_descriptor = fmat.sampler_descriptors[i];
                const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
                this.sampler_bindings.push({ gfxTexture: gfx_texture, gfxSampler: gfx_sampler, lateBinding: null })
            }
            else
            {
                console.error(`texture ${texture_name} not found (fmdl ${fmdl.name} fshp ${fshp.name})`);
                throw("whoops");
            }
        }

        // initialize shader
        this.program = new TMSFEProgram(fvtx, fmat, fshp, this.bone_matrix_array.length);
    }

    // produce a draw call for this mesh
    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList): void
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
        let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 40 + (12 * this.bone_matrix_array.length));
        const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
        uniform_buffer_offset += fillMatrix4x4(mapped, uniform_buffer_offset, viewerInput.camera.projectionMatrix);
        uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, viewerInput.camera.viewMatrix);
        uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, this.transform_matrix);

        for (let i = 0; i < this.bone_matrix_array.length; i++)
        {
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, this.bone_matrix_array[i]);
        }

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

const BONE_MATRIX_MAX_LENGTH = 209;
