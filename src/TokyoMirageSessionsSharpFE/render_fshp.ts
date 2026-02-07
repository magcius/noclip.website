// render_fshp.ts
// renders a single mesh from a model in a bfres file

import * as BNTX from '../fres_nx/bntx.js';
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { computeViewMatrixSkybox, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera.js';
import { FVTX } from "./bfres/fvtx.js";
import { FSHP } from "./bfres/fshp.js";
import { FMAT, BlendMode } from "./bfres/fmat.js";
import { AABB } from '../Geometry.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager.js';
import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingLayoutDescriptor,
         GfxBuffer, GfxSamplerBinding, GfxTexture, GfxMegaStateDescriptor, GfxBlendMode,
         GfxBlendFactor, GfxChannelWriteMask} from "../gfx/platform/GfxPlatform.js";
import { mat4 } from "gl-matrix";
import { TMSFEProgram } from './shader.js';
import { fillMatrix4x3, fillMatrix4x4, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers.js';
import { ViewerRenderInput } from "../viewer.js";

/**
 * renders a single mesh from a model
 */
export class fshp_renderer
{
    public fshp: FSHP;
    public fmat_index: number;
    public render_mesh: boolean = true;
    public stored_bounding_box: AABB | undefined = undefined;

    private vertex_buffers: GfxBuffer[] = [];
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[] = [];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;
    private program: TMSFEProgram;
    private sampler_bindings: GfxSamplerBinding[] = [];
    private blend_mode: BlendMode;
    private mega_state_flags: Partial<GfxMegaStateDescriptor>;

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
        // TODO: at this point just store the fshp itself
        this.fshp = fshp;
        this.fmat_index = fshp.fmat_index;
        this.blend_mode = fmat.blend_mode;

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
        for (let i = 0; i < fmat.sampler_names.length; i++)
        {
            const texture_name = fmat.texture_names[i];
            if (texture_name == undefined)
            {
                // TODO: not sure what to do if there's no texture
                console.log(`fmat ${fmat.name} has an undefined texture`);
                this.render_mesh = false;
                continue;
            }
            const texture = bntx.textures.find((f) => f.name === texture_name);
            if (texture !== undefined)
            {
                const gfx_texture_index = bntx.textures.indexOf(texture);
                const gfx_texture = gfx_texture_array[gfx_texture_index];
                const sampler_descriptor = fmat.sampler_descriptors[i];
                const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
                this.sampler_bindings.push({ gfxTexture: gfx_texture, gfxSampler: gfx_sampler, lateBinding: null });
            }
            else
            {
                console.error(`texture ${texture_name} not found (fshp ${fshp.name})`);
                throw("whoops");
            }
        }
        if (this.sampler_bindings.length == 0)
        {
            this.render_mesh = false;
        }

        // mega state flags
        this.mega_state_flags = { cullMode: fmat.cull_mode, depthWrite: false };
        switch(this.blend_mode)
        {
            case BlendMode.Opaque:
            case BlendMode.AlphaTest:
                // opaque
                this.mega_state_flags.depthWrite = true;
                break;

            case BlendMode.BlendMode3:
                setAttachmentStateSimple
                (
                    this.mega_state_flags,
                    {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    }
                );
                break;

            case BlendMode.BlendMode4:
                setAttachmentStateSimple
                (
                    this.mega_state_flags,
                    {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.One,
                    }
                );
                break;

            case BlendMode.BlendMode5:
                setAttachmentStateSimple
                (
                    this.mega_state_flags,
                    {
                        blendMode: GfxBlendMode.ReverseSubtract,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.One,
                    }
                );
                break;

            case BlendMode.BlendMode6:
                setAttachmentStateSimple
                (
                    this.mega_state_flags,
                    {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    }
                );
                break;

            case BlendMode.BlendMode7:
                setAttachmentStateSimple
                (
                    this.mega_state_flags,
                    {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.One,
                    }
                );
                break;

            default:
                console.error(`unknown blend mode ${this.blend_mode}`);
                throw("whoops");
        }

        // initialize shader
        this.program = new TMSFEProgram(fvtx, fmat, fshp, bone_matrix_array_length);

        let use_alpha_test = false;
        if(this.blend_mode == BlendMode.AlphaTest)
        {
            use_alpha_test = true;
        }
        this.program.setDefineBool('USE_ALPHA_TEST', use_alpha_test);
    }

    /**
     * produce a draw call for this mesh
     */
    render
    (
        renderHelper: GfxRenderHelper,
        viewerInput: ViewerRenderInput,
        renderInstListOpaque: GfxRenderInstList,
        renderInstListTranslucent: GfxRenderInstList,
        renderInstListSkybox: GfxRenderInstList,
        transform_matrix: mat4,
        bone_matrix_array: mat4[],
        albedo0_srt_matrix: mat4,
        special_skybox: boolean,
        bounding_box: AABB,
        replacement_sampler_binding?: GfxSamplerBinding,
    ): void
    {
        if (!this.render_mesh)
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
        // size 16 + 12 + 12 + 8 + (12 * bone count)
        let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 48 + (12 * bone_matrix_array.length));
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
        uniform_buffer_offset += fillMatrix4x2(mapped, uniform_buffer_offset, albedo0_srt_matrix);

        for (let i = 0; i < bone_matrix_array.length; i++)
        {
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, bone_matrix_array[i]);
        }

        // set sampler
        if (replacement_sampler_binding != undefined)
        {
            renderInst.setSamplerBindingsFromTextureMappings([replacement_sampler_binding]);
        }
        else
        {
            renderInst.setSamplerBindingsFromTextureMappings(this.sampler_bindings);
        }

        renderInst.setMegaStateFlags(this.mega_state_flags);
        
        // submit the draw call
        if (special_skybox)
        {
            renderHelper.renderInstManager.setCurrentList(renderInstListSkybox);
        }
        else if (this.blend_mode == BlendMode.Opaque || this.blend_mode == BlendMode.AlphaTest)
        {
            renderHelper.renderInstManager.setCurrentList(renderInstListOpaque);
        }
        else
        {
            // translucent material
            // sort
            const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bounding_box);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            renderHelper.renderInstManager.setCurrentList(renderInstListTranslucent);
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
