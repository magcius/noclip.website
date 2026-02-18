// render_fshp.ts
// renders a single mesh from a model in a bfres file

import * as BFRES from "../fres_nx/bfres.js";
import * as bfres_helpers from "./bfres_helpers.js";
import { createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { computeViewMatrixSkybox, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera.js';
import { AABB } from '../Geometry.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager.js';
import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingLayoutDescriptor,
         GfxBuffer, GfxSamplerBinding, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxFormat, GfxCullMode } from "../gfx/platform/GfxPlatform.js";
import { mat4 } from "gl-matrix";
import * as nngfx_enum from "../fres_nx/nngfx_enum";
import { TMSFEProgram } from './shader.js';
import { fillMatrix4x3, fillMatrix4x4, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers.js';
import { ViewerRenderInput } from "../viewer.js";

/**
 * renders a single mesh from a model
 */
export class fshp_renderer
{
    public fshp: BFRES.FSHP;
    public render_mesh: boolean = true;
    public stored_bounding_box: AABB | undefined = undefined;

    private vertex_buffers: GfxBuffer[] = [];
    private vertex_buffer_descriptors: GfxVertexBufferDescriptor[] = [];
    private index_buffer: GfxBuffer;
    private index_buffer_descriptor: GfxVertexBufferDescriptor;
    private index_count: number;
    private input_layout: GfxInputLayout;
    private program: TMSFEProgram;
    private blend_mode: BlendMode;
    private mega_state_flags: Partial<GfxMegaStateDescriptor>;
    private lightmap_srt_matrix: mat4;

    constructor
    (
        fvtx: BFRES.FVTX,
        fshp: BFRES.FSHP,
        fmat: BFRES.FMAT,
        bone_matrix_array_length: number,
        render_mesh: boolean,
        use_lightmaps: boolean,
        lightmap_srt_matrix: mat4,
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
    )
    {
        this.fshp = fshp;
        this.render_mesh = render_mesh;
        this.lightmap_srt_matrix = lightmap_srt_matrix;

        // create vertex buffers

        // convert vertex attribute format numbers
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        for (let i = 0; i < fvtx.vertexAttributes.length; i++)
        {
            const vertex_attribute = fvtx.vertexAttributes[i];
            const format = bfres_helpers.convert_attribute_format(vertex_attribute.format);

            vertexAttributeDescriptors.push
            ({
                location: i,
                format,
                bufferIndex: vertex_attribute.bufferIndex,
                bufferByteOffset: vertex_attribute.offset
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
        const index_buffer_format = bfres_helpers.convert_index_format(mesh.indexFormat);
        this.input_layout = renderHelper.renderCache.createInputLayout
        ({
            vertexAttributeDescriptors,
            vertexBufferDescriptors: inputLayoutBufferDescriptors,
            indexBufferFormat: index_buffer_format,
        });

        // create index buffer
        this.index_buffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexBufferData);
        this.index_count = mesh.count;
        this.index_buffer_descriptor = { buffer: this.index_buffer };

        // set mega state flags
        let cull_mode = GfxCullMode.Back;
        const original_cull_mode = fmat.userData.get("cull_mode");
        if (original_cull_mode !== undefined)
        {
            cull_mode = bfres_helpers.convert_cull_mode(original_cull_mode[0] as number);
        }
        
        const original_blend_mode = fmat.userData.get("blend_mode");
        this.blend_mode = BlendMode.Opaque;
        if (original_blend_mode != undefined)
        {
            this.blend_mode = original_blend_mode[0] as number;
        }

        this.mega_state_flags = { cullMode: cull_mode, depthWrite: false };
        switch(this.blend_mode)
        {
            case BlendMode.Opaque:
            case BlendMode.AlphaTest:
                // opaque
                this.mega_state_flags.depthWrite = true;
                break;

            case BlendMode.BlendMode3:
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

            case BlendMode.BlendMode4:
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

            default:
                console.error(`unknown blend mode ${this.blend_mode}`);
                throw("whoops");
        }

        // initialize shader
        this.program = new TMSFEProgram(fvtx.vertexAttributes, fmat.samplerInfo, fshp.vertexSkinWeightCount, bone_matrix_array_length);

        let use_alpha_test = false;
        if(this.blend_mode == BlendMode.AlphaTest)
        {
            use_alpha_test = true;
        }
        this.program.setDefineBool('USE_ALPHA_TEST', use_alpha_test);
        // this.program.setDefineBool('USE_LIGHTMAPS', use_lightmaps);
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
        sampler_bindings: GfxSamplerBinding[],
    ): void
    {
        // the template is necessary to use uniform buffers
        renderHelper.pushTemplateRenderInst();

        const renderInst = renderHelper.renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.input_layout, this.vertex_buffer_descriptors, this.index_buffer_descriptor);
        renderInst.setDrawCount(this.index_count);

        // set shader
        const program = renderHelper.renderCache.createProgram(this.program);
        renderInst.setGfxProgram(program);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: sampler_bindings.length }];
        
        // create uniform buffers for the shader
        renderInst.setBindingLayouts(bindingLayouts);
        // size 16 + 12 + 12 + 8 + 8 + (12 * bone count)
        let uniform_buffer_offset = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 56 + (12 * bone_matrix_array.length));
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
        uniform_buffer_offset += fillMatrix4x2(mapped, uniform_buffer_offset, this.lightmap_srt_matrix);

        for (let i = 0; i < bone_matrix_array.length; i++)
        {
            uniform_buffer_offset += fillMatrix4x3(mapped, uniform_buffer_offset, bone_matrix_array[i]);
        }

        renderInst.setSamplerBindingsFromTextureMappings(sampler_bindings);
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

enum BlendMode
{
    Opaque = 1,
    AlphaTest = 2,
    BlendMode3 = 3,
    BlendMode4 = 4,
    BlendMode5 = 5,
    BlendMode6 = 6,
    BlendMode7 = 7,
}
