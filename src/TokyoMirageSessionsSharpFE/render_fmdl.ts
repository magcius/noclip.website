// render_fmdl.ts
// handles all the common tasks shared between the separate meshes of a model, such as animating the skeleton

import * as BNTX from '../fres_nx/bntx.js';
import { FMDL } from "./bfres/fmdl";
import { FSKA } from './bfres/fska.js';
import { FSKL, recursive_bone_transform, recursive_bone_transform_with_animation } from './bfres/fskl.js';
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { vec3, mat4 } from "gl-matrix";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { computeModelMatrixSRT } from '../MathHelpers.js';
import { fshp_renderer } from "./render_fshp";
import { assert } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';

export class fmdl_renderer
{
    private fskl: FSKL;
    private fska: FSKA | null;
    private smooth_rigid_matrix_array: mat4[] = [];
    private transform_matrix: mat4 = mat4.create();
    private fshp_renderers: fshp_renderer[] = [];
    private special_skybox: boolean;
    private current_animation_frame: number = 0.0;

    constructor
    (
        fmdl: FMDL,
        bntx: BNTX.BNTX,
        gfx_texture_array: GfxTexture[],
        fska: FSKA | null,
        position: vec3,
        rotation: vec3,
        scale: vec3,
        special_skybox: boolean,
        device: GfxDevice,
        renderHelper: GfxRenderHelper,
    )
    {
        this.special_skybox = special_skybox;

        // setup skeleton
        this.fskl = fmdl.fskl;
        this.fska = fska;
        assert(this.fskl.smooth_rigid_indices.length < BONE_MATRIX_MAX_LENGTH);
        for (let i = 0; i < this.fskl.smooth_rigid_indices.length; i++)
        {
            const transformation_matrix = recursive_bone_transform(this.fskl.smooth_rigid_indices[i], this.fskl)
            this.smooth_rigid_matrix_array.push(transformation_matrix);
        }

        // setup transformation matrix
        computeModelMatrixSRT
        (
            this.transform_matrix,
            scale[0], scale[1], scale[2],
            rotation[0], rotation[1], rotation[2],
            position[0], position[1], position[2],
        );

        // make all the fshp renderers
        for (let shape_index = 0; shape_index < fmdl.fshp.length; shape_index++)
        {
            const fshp = fmdl.fshp[shape_index];
            const fvtx = fmdl.fvtx[fshp.fvtx_index];
            const fmat = fmdl.fmat[fshp.fmat_index];
            let bone_matrix_length: number;
            if (fshp.skin_bone_count == 0)
            {
                bone_matrix_length = 1;
            }
            else
            {
                bone_matrix_length = this.smooth_rigid_matrix_array.length;
            }
            const renderer = new fshp_renderer(fvtx, fshp, fmat, bntx, gfx_texture_array, bone_matrix_length, device, renderHelper);
            this.fshp_renderers.push(renderer);
        }

    }

    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList, renderInstListSkybox: GfxRenderInstList): void
    {
        // update bone matrix
        // viewerInput.deltaTime;
        // const FPS = 30;
        // const FPS_RATE = FPS/1000;
        // this.current_animation_frame += viewerInput.deltaTime * FPS_RATE;
        // console.log(this.current_animation_frame);

        // render all fshp renderers
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            let bone_matrix_array: mat4[] = [];
            if (this.fshp_renderers[i].skin_bone_count == 0)
            {
                let transformation_matrix = recursive_bone_transform(this.fshp_renderers[i].bone_index, this.fskl);
                bone_matrix_array.push(transformation_matrix);
            }
            else
            {
                bone_matrix_array = this.smooth_rigid_matrix_array;
            }

            this.fshp_renderers[i].render
            (
                renderHelper,
                viewerInput,
                renderInstListMain,
                renderInstListSkybox,
                this.transform_matrix,
                bone_matrix_array,
                this.special_skybox,
            );
        }
    }

    public destroy(device: GfxDevice): void
    {
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].destroy(device);
        }
    }
}

const BONE_MATRIX_MAX_LENGTH = 209;
