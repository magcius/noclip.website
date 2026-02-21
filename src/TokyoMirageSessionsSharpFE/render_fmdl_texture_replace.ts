// render_fmdl_texture_replace
// a fmdl renderer with the ability to swap out textures dynamically
// this is used to replace tv screens, posters, advertisements, and the panels in LCD Panels

import * as BFRES from "../fres_nx/bfres.js";
import * as bfres_helpers from "./bfres_helpers.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from './bntx_helpers.js';
import { DataFetcher } from '../DataFetcher.js';
import { AABB } from '../Geometry.js';
import * as GfxPlatform from "../gfx/platform/GfxPlatform";
import { vec3 } from "gl-matrix";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { LightmapTexture } from './lightmap.js';
import { fmdl_renderer } from "./render_fmdl";
import { ViewerRenderInput } from '../viewer.js';
import { assert } from '../util.js';

export class fmdl_renderer_texture_replace extends fmdl_renderer
{
    private replacement_textures: replacement_texture[];
    private replacement_texture_fmat_indices: number[] = [];

    constructor
    (
        fmdl: BFRES.FMDL,
        bntx: BNTX.BNTX,
        gfx_texture_array: GfxPlatform.GfxTexture[],
        fska: BFRES.FSKA | undefined,
        fmaa: BFRES.FMAA | undefined,
        lightmaps: LightmapTexture[] | undefined,
        position: vec3,
        rotation: vec3,
        scale: vec3,
        special_skybox: boolean,
        device: GfxPlatform.GfxDevice,
        renderHelper: GfxRenderHelper,
        replacement_textures: replacement_texture[],
        override_bounding_box?: AABB,
        
    )
    {
        super(fmdl, bntx, gfx_texture_array, fska, fmaa, lightmaps, position, rotation, scale, special_skybox, device, renderHelper, override_bounding_box);
        this.replacement_textures = replacement_textures;

        for (let i = 0; i < replacement_textures.length; i++)
        {
            const replacement_texture = replacement_textures[i];

            const fmat = fmdl.fmat.find((f) => f.name === replacement_texture.material_name);
            if (fmat !== undefined)
            {
                const fmat_index = fmdl.fmat.indexOf(fmat);
                this.replacement_texture_fmat_indices.push(fmat_index);
                const sampler_descriptor = bfres_helpers.make_sampler_descriptor(fmat.samplerInfo[S_DIFFUSE_INDEX]);
                const gfx_sampler = renderHelper.renderCache.createSampler(sampler_descriptor);
                replacement_texture.sampler_binding = { gfxTexture: replacement_texture.gfx_texture, gfxSampler: gfx_sampler, lateBinding: null };
            }
        }
    }

    override render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListOpaque: GfxRenderInstList, renderInstListTranslucent: GfxRenderInstList, renderInstListSkybox: GfxRenderInstList): void
    {
        this.animate(viewerInput);

        // render all fshp renderers
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            if (this.fshp_renderers[i].render_mesh === false)
            {
                continue;
            }
            let sampler_bindings = this.get_fshp_sampler_bindings(i);
            if (sampler_bindings === undefined)
            {
                continue;
            }
            const bone_matrix_array = this.get_fshp_bone_matrix(i);
            const texture_srt_matrix = this.get_fshp_texture_srt_matrix(i);
            const bounding_box = this.get_fshp_bounding_box(i, bone_matrix_array);

            let replacement_sampler_binding: GfxPlatform.GfxSamplerBinding | undefined = undefined;
            for (let replacement_texture_index = 0; replacement_texture_index < this.replacement_textures.length; replacement_texture_index++)
            {
                if (this.replacement_texture_fmat_indices[replacement_texture_index] === this.fshp_renderers[i].fshp.materialIndex)
                {
                    replacement_sampler_binding = this.replacement_textures[replacement_texture_index].sampler_binding;
                    assert(replacement_sampler_binding !== undefined);
                    sampler_bindings[S_DIFFUSE_INDEX] = replacement_sampler_binding;
                }
            }

            // frustrum culling
            if (viewerInput.camera.frustum.contains(bounding_box) || this.special_skybox)
            {
                this.fshp_renderers[i].render
                (
                    renderHelper,
                    viewerInput,
                    renderInstListOpaque,
                    renderInstListTranslucent,
                    renderInstListSkybox,
                    this.transform_matrix,
                    bone_matrix_array,
                    texture_srt_matrix,
                    this.special_skybox,
                    bounding_box,
                    sampler_bindings,
                );
            }
        }
    }
}

export interface replacement_texture_group
{
    model_name: string;
    replacement_textures: replacement_texture[];
}

export interface replacement_texture
{
    material_name: string;
    gfx_texture: GfxPlatform.GfxTexture;
    sampler_binding: GfxPlatform.GfxSamplerBinding | undefined;
}

export async function create_replacement_texture(texture_path: string, material_name: string, data_fetcher: DataFetcher, device: GfxPlatform.GfxDevice): Promise<replacement_texture>
{    
    const bntx_buffer = await data_fetcher.fetchData(texture_path);
    const bntx = BNTX.parse(bntx_buffer);
    const gfx_texture = deswizzle_and_upload_bntx_textures(bntx, device)[0];
    return { material_name, gfx_texture, sampler_binding: undefined };
}

const S_DIFFUSE_INDEX = 0;
