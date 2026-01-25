// render_fmdl.ts
// handles all the common tasks shared between the separate meshes of a model, such as animating the skeleton

import * as BNTX from '../fres_nx/bntx.js';
import { FMDL } from "./bfres/fmdl";
import { FSKA } from './bfres/fska.js';
import { FSKL, FSKL_Bone, recursive_bone_transform } from './bfres/fskl.js';
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { vec3, mat4 } from "gl-matrix";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { computeModelMatrixSRT } from '../MathHelpers.js';
import { fshp_renderer } from "./render_fshp";
import { getPointCubic } from '../Spline.js';
import { assert } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';

export class fmdl_renderer
{
    public animation_play: boolean = true;

    private fskl: FSKL;
    private fska: FSKA | undefined;
    private bone_to_bone_animation_indices: number[] = [];
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
        fska: FSKA | undefined,
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

        // for each bone, which element of the fska bone_animations array applies to this bone
        if (this.fska != undefined)
        {
            for (let i = 0; i < this.fskl.bones.length; i++)
            {
                let bone_animation_index = -1;
                const bone_animation = this.fska.bone_animations.find((f) => f.name === this.fskl.bones[i].name);
                if (bone_animation != undefined)
                {
                    bone_animation_index = this.fska.bone_animations.indexOf(bone_animation);
                }
                this.bone_to_bone_animation_indices.push(bone_animation_index);
            }
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
            let bone_matrix_array_length = 1;
            if (fshp.skin_bone_count > 0)
            {
                bone_matrix_array_length = this.fskl.smooth_rigid_indices.length;
            }
            const renderer = new fshp_renderer
            (
                fvtx,
                fshp,
                fmat,
                bntx,
                gfx_texture_array,
                bone_matrix_array_length,
                device,
                renderHelper
            );

            // disable meshes that are set to not render
            const bone_user_data = fmdl.fskl.bones[fshp.bone_index].user_data;
            const render_mesh_enable = bone_user_data.find((f) => f.key === "render_mesh_enable");
            if (render_mesh_enable != undefined)
            {
                if (render_mesh_enable.values[0] == 0)
                {
                    renderer.do_not_render = true;
                }
            }

            this.fshp_renderers.push(renderer);
        }

    }

    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListMain: GfxRenderInstList, renderInstListSkybox: GfxRenderInstList): void
    {
        let current_bones: FSKL_Bone[] = [];
        if (this.fska == undefined)
        {
            // this model doesn't have an animated skeleton
            current_bones = this.fskl.bones;
        }
        else
        {
            // this model has an animated skeleton
            // advance time
            if (this.animation_play)
            {
                this.current_animation_frame += viewerInput.deltaTime * FPS_RATE;
                this.current_animation_frame = this.current_animation_frame % this.fska.frame_count;
            }
            // update each bone's transformations to the current frame
            current_bones = this.animate_skeleton(this.current_animation_frame);
        }

        // remake smooth rigid matrix
        this.smooth_rigid_matrix_array = [];
        for (let i = 0; i < this.fskl.smooth_rigid_indices.length; i++)
        {
            const transformation_matrix = recursive_bone_transform(this.fskl.smooth_rigid_indices[i], current_bones)

            if (i < this.fskl.bone_local_from_bind_pose_matrices.length)
            {
                // smooth skinned vertices are stored in bind pose space, and need to be converted to bone local space
                const new_matrix: mat4 = mat4.create();
                mat4.multiply(new_matrix, transformation_matrix, this.fskl.bone_local_from_bind_pose_matrices[i])
                this.smooth_rigid_matrix_array.push(new_matrix);
            }
            else
            {
                // rigid skinned vertices are stored in bone local space, so they are fine as is
                this.smooth_rigid_matrix_array.push(transformation_matrix);
            }
        }

        // render all fshp renderers
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            let bone_matrix_array: mat4[] = [];
            if (this.fshp_renderers[i].skin_bone_count == 0)
            {
                let transformation_matrix = recursive_bone_transform(this.fshp_renderers[i].bone_index, current_bones);
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

    /**
     * returns a bone array of all the bones at a specified frame of the animation
     * @param current_frame the frame to animate the skeleton at
     */
    animate_skeleton(current_frame: number): FSKL_Bone[]
    {
        let bones: FSKL_Bone[] = [];
        for (let bone_index = 0; bone_index < this.fskl.bones.length; bone_index++)
        {
            let bone = this.fskl.bones[bone_index];
            const bone_animation_index = this.bone_to_bone_animation_indices[bone_index];

            if (bone_animation_index == -1)
            {
                // no bone_animation, copy the bone and skip to the next one
                bones.push(bone);
                continue;
            }
            
            if (this.fska == undefined)
            {
                console.error("trying to animate the skeleton of a fmdl with no fska");
                throw("whoops");
            }
            const bone_animation = this.fska.bone_animations[bone_animation_index]

            let transformation_flags = bone_animation.flags >> 6;
            let transformation_values: number[] = [];
            let curve_index = 0;

            // which curve goes to which transformation is stored in the flags, iterate over each bit
            // TODO: are 10 bits of the flags really used? documentation says 9 but translation didn't line up
            for (let i = 0; i < 10; i++)
            {
                if (transformation_flags & 0x1)
                {
                    // this transformation has an animation curve
                    const curve = bone_animation.curves[curve_index];
                    curve_index += 1;

                    // look through the keyframes in the animation
                    for (let frame_index = 0; frame_index < curve.frames.length; frame_index++)
                    {
                        if (current_frame == curve.frames[frame_index])
                        {
                            // interpolation is unnecessary, just return the constant
                            const value = curve.keys[frame_index][3];
                            transformation_values.push(value);
                            break;
                        }
                        else if (current_frame < curve.frames[frame_index])
                        {
                            // interpolate the value
                            const before_frame = curve.frames[frame_index - 1];
                            const after_frame = curve.frames[frame_index];
                            const frame_delta = after_frame - before_frame;
                            const t = (current_frame - before_frame) / frame_delta;
                            const key_frame = curve.keys[frame_index - 1];
                            const value = getPointCubic(key_frame, t);
                            transformation_values.push(value);
                            break;
                        }
                    }
                }
                else
                {
                    // this transformation doesn't have an animation curve
                    // use the initial value
                    transformation_values.push(bone_animation.initial_values[i]);
                }

                transformation_flags >>= 1;
            }

            bone =
            {
                name: bone.name,
                parent_index: bone.parent_index,
                scale: vec3.fromValues(transformation_values[0], transformation_values[1], transformation_values[2]),
                rotation: vec3.fromValues(transformation_values[3], transformation_values[4], transformation_values[5]),
                translation: vec3.fromValues(transformation_values[7], transformation_values[8], transformation_values[9]),
                user_data: bone.user_data,
            };
        
            bones.push(bone);
        }

        return bones;
    }
}

const FPS = 30;
const FPS_RATE = FPS/1000;
const BONE_MATRIX_MAX_LENGTH = 209; // shibuya lumps all the animated trees and street lamps into one model
