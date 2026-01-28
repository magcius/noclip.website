// render_fmdl_texture_replace
// a fmdl renderer with the ability to swap out textures dynamically
// this is used to replace tv screens, posters, advertisements, and the panels in LCD Panels

import * as BNTX from '../fres_nx/bntx.js';
import { FMAA } from './bfres/fmaa.js';
import { FMDL } from "./bfres/fmdl";
import { FSKA } from './bfres/fska.js';
import { GfxDevice, GfxSamplerBinding, GfxTexture } from "../gfx/platform/GfxPlatform";
import { vec3, mat4 } from "gl-matrix";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { fmdl_renderer } from "./render_fmdl";
import { ViewerRenderInput } from '../viewer.js';

export class fmdl_renderer_texture_replace extends fmdl_renderer
{
    private notice_sampler_binding: GfxSamplerBinding;
    private notice_fmat_index: number;

    constructor
    (
        fmdl: FMDL,
        bntx: BNTX.BNTX,
        gfx_texture_array: GfxTexture[],
        fska: FSKA | undefined,
        fmaa: FMAA | undefined,
        position: vec3,
        rotation: vec3,
        scale: vec3,
        special_skybox: boolean,
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
        notice_gfx_texture: GfxTexture,
    )
    {
        super(fmdl, bntx, gfx_texture_array, fska, fmaa, position, rotation, scale, special_skybox, device, renderHelper);

        // find notice material (the posters in fortuna)
        const notice_material = fmdl.fmat.find((f) => f.name === "notice15");
        if (notice_material != undefined && notice_gfx_texture != undefined)
        {
            this.notice_fmat_index = fmdl.fmat.indexOf(notice_material);
            const sampler_descriptor = notice_material.sampler_descriptors[0]; // s_diffuse
            const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
            this.notice_sampler_binding = { gfxTexture: notice_gfx_texture, gfxSampler: gfx_sampler, lateBinding: null };
        }
    }

    override render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList, renderInstListSkybox: GfxRenderInstList): void
    {
        this.animate(viewerInput);

        // render all fshp renderers
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            let bone_matrix_array = this.get_fshp_bone_matrix(i);
            let texture_srt_matrix = this.get_fshp_texture_srt_matrix(i);

            let notice_sampler_binding: GfxSamplerBinding | undefined = undefined;
            if (this.notice_sampler_binding != undefined && this.notice_fmat_index == this.fshp_renderers[i].fmat_index)
            {
                notice_sampler_binding = this.notice_sampler_binding;
            }

            this.fshp_renderers[i].render
            (
                renderHelper,
                viewerInput,
                renderInstListMain,
                renderInstListSkybox,
                this.transform_matrix,
                bone_matrix_array,
                texture_srt_matrix,
                this.special_skybox,
                notice_sampler_binding,
            );
        }
    }
}
