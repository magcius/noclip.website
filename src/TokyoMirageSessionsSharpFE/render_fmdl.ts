// render_fmdl.ts
// handles all the common tasks shared between the separate meshes of a model, such as animating the skeleton

import { Curve } from './bfres/animation_common.js';
import * as BNTX from '../fres_nx/bntx.js';
import { colorNewFromRGBA } from '../Color.js';
import { drawWorldSpaceAABB, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { FMAA, ShaderParamAnimation } from './bfres/fmaa.js';
import { FMDL } from "./bfres/fmdl";
import { FSKA } from './bfres/fska.js';
import { FSKL, FSKL_Bone, recursive_bone_transform } from './bfres/fskl.js';
import { AABB } from '../Geometry.js';
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

    protected fskl: FSKL;
    protected fska: FSKA | undefined;
    protected fmaa: FMAA | undefined;
    protected bone_to_bone_animation_indices: number[] = [];
    protected current_bones: FSKL_Bone[];
    protected smooth_rigid_matrix_array: mat4[] = [];
    protected material_to_material_animation_indices: number[] = [];
    protected texture_srt_matrices: mat4[] = [];
    protected transform_matrix: mat4 = mat4.create();
    protected fshp_renderers: fshp_renderer[] = [];
    protected special_skybox: boolean;
    protected current_animation_frame: number = 0.0;
    protected current_material_animation_frame: number = 0.0; // TODO: do I need separate ones? not sure if theres a model with both material and skeletal animations
    protected override_bounding_box: AABB | undefined;

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
        override_bounding_box?: AABB,
    )
    {
        this.special_skybox = special_skybox;
        this.override_bounding_box = override_bounding_box;

        // setup skeleton
        this.fskl = fmdl.fskl;
        this.fska = fska;
        assert(this.fskl.smooth_rigid_indices.length < BONE_MATRIX_MAX_LENGTH);

        // for each bone, which element of the fska bone_animations array applies to it
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

        this.fmaa = fmaa;

        // for each material, which element of the material_animations array applies to it
        if (this.fmaa != undefined)
        {
            for (let i = 0; i < fmdl.fmat.length; i++)
            {
                let material_animation_index = -1;
                const material_animation = this.fmaa.material_animations.find((f) => f.target_material === fmdl.fmat[i].name);
                if (material_animation != undefined)
                {
                    material_animation_index = this.fmaa.material_animations.indexOf(material_animation);
                }
                this.material_to_material_animation_indices.push(material_animation_index);
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
            const render_mesh_enable = bone_user_data.get("render_mesh_enable");
            if (render_mesh_enable != undefined && render_mesh_enable[0] === 0)
            {
                renderer.render_mesh = false;
            }

            this.fshp_renderers.push(renderer);
        }

    }

    render(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, renderInstListOpaque: GfxRenderInstList, renderInstListTranslucent: GfxRenderInstList, renderInstListSkybox: GfxRenderInstList): void
    {
        this.animate(viewerInput);

        // render all fshp renderers
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            let bone_matrix_array = this.get_fshp_bone_matrix(i);
            let texture_srt_matrix = this.get_fshp_texture_srt_matrix(i);
            let bounding_box = this.get_fshp_bounding_box(i, bone_matrix_array);

            // frustrum culling
            if (viewerInput.camera.frustum.contains(bounding_box) || this.special_skybox)
            {
                // drawWorldSpaceAABB(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, bounding_box, null, colorNewFromRGBA(0.0, 0.0, 1.0, 1.0));
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
                    undefined,
                );
            }
        }
    }

    public destroy(device: GfxDevice): void
    {
        for (let i = 0; i < this.fshp_renderers.length; i++)
        {
            this.fshp_renderers[i].destroy(device);
        }
    }

    animate(viewerInput: ViewerRenderInput)
    {
        let current_bones: FSKL_Bone[] = [];
        if (this.fska != undefined)
        {
            // this model has an animated skeleton
            if (this.animation_play)
            {
                this.current_animation_frame += viewerInput.deltaTime * FPS_RATE;
                this.current_animation_frame = this.current_animation_frame % this.fska.frame_count;
            }
            this.current_bones = this.animate_skeleton(this.current_animation_frame);
        }
        else
        {
            // this model doesn't have an animated skeleton
            this.current_bones = this.fskl.bones;
        }

        // remake smooth rigid matrix
        this.smooth_rigid_matrix_array = [];
        for (let i = 0; i < this.fskl.smooth_rigid_indices.length; i++)
        {
            const transformation_matrix = recursive_bone_transform(this.fskl.smooth_rigid_indices[i], this.current_bones)

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

        // animate material
        if (this.fmaa != undefined)
        {
            this.current_material_animation_frame += viewerInput.deltaTime * FPS_RATE;
            this.current_material_animation_frame = this.current_material_animation_frame % this.fmaa.frame_count;
            this.texture_srt_matrices = this.animate_materials(this.current_material_animation_frame);
        }
    }

    /**
     * returns a bone array of all the bones at a specified frame of the animation
     * @param current_frame the frame to animate the skeleton at
     */
    animate_skeleton(current_frame: number): FSKL_Bone[]
    {
        if (this.fska == undefined)
        {
            console.error("trying to animate the skeleton of a fmdl with no fska");
            throw("whoops");
        }

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
            
            const bone_animation = this.fska.bone_animations[bone_animation_index]

            let transformation_flags = bone_animation.flags >> 6;
            let transformation_values: number[] = [];
            let curve_index = 0;

            // which curve goes to which transformation is stored in the flags, iterate over each bit
            for (let i = 0; i < 10; i++)
            {
                if (transformation_flags & 0x1)
                {
                    // this transformation has an animation curve
                    const curve = bone_animation.curves[curve_index];
                    curve_index += 1;

                    // look through the keyframes in the animation
                    const value = get_keyframe_value(curve, current_frame);
                    transformation_values.push(value);
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

    /**
     * returns an array of transformation matrices for every material
     * @param current_frame the frame to animate each material
     */
    animate_materials(current_frame: number): mat4[]
    {
        if (this.fmaa == undefined)
        {
            console.error("trying to animate materials of a fmdl with no fmaa");
            throw("whoops");
        }

        let texture_srt_matrices: mat4[] = [];
            
        for (let i = 0; i < this.material_to_material_animation_indices.length; i++)
        {
            let texture_srt_matrix = mat4.create();
            mat4.identity(texture_srt_matrix);

            const material_animation_index = this.material_to_material_animation_indices[i];

            if (material_animation_index === -1)
            {
                texture_srt_matrices.push(texture_srt_matrix);
            }
            else
            {
                // TODO: can i avoid rounding the frame number? without it some animations display incorrectly
                const frame_integer = Math.floor(current_frame);
                const material_animation = this.fmaa.material_animations[material_animation_index];
                const shader_param_animation = material_animation.shader_param_animations[0];

                let scale_x = get_shader_param_animation_value(1.0, material_animation.curve_index_map, "albedo0_scale_x", shader_param_animation, frame_integer);
                let scale_y = get_shader_param_animation_value(1.0, material_animation.curve_index_map, "albedo0_scale_y", shader_param_animation, frame_integer);
                let rotation = get_shader_param_animation_value(0.0, material_animation.curve_index_map, "albedo0_rotate", shader_param_animation, frame_integer);
                let translate_x = get_shader_param_animation_value(0.0, material_animation.curve_index_map, "albedo0_translate_x", shader_param_animation, frame_integer);
                let translate_y = get_shader_param_animation_value(0.0, material_animation.curve_index_map, "albedo0_translate_y", shader_param_animation, frame_integer);

                // maya style matrix
                const theta = rotation;
                const sinR = Math.sin(theta);
                const cosR = Math.cos(theta);
                texture_srt_matrix[0]  = scale_x *  cosR;
                texture_srt_matrix[4]  = scale_x *  sinR;
                texture_srt_matrix[12] = scale_x * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - translate_x);
                texture_srt_matrix[1]  = scale_y * -sinR;
                texture_srt_matrix[5]  = scale_y *  cosR;
                texture_srt_matrix[13] = scale_y * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + translate_y) + 1.0;

                texture_srt_matrices.push(texture_srt_matrix);
            }
        }

        return texture_srt_matrices;
    }

    get_fshp_bone_matrix(fshp_index: number): mat4[]
    {
        let bone_matrix_array: mat4[] = [];
        if (this.fshp_renderers[fshp_index].fshp.skin_bone_count == 0)
        {
            let transformation_matrix = recursive_bone_transform(this.fshp_renderers[fshp_index].fshp.bone_index, this.current_bones);
            bone_matrix_array.push(transformation_matrix);
        }
        else
        {
            bone_matrix_array = this.smooth_rigid_matrix_array;
        }
        return bone_matrix_array;
    }

    get_fshp_texture_srt_matrix(fshp_index: number): mat4
    {
        let texture_srt_matrix: mat4;
        if (this.fmaa === undefined)
        {
            texture_srt_matrix = mat4.create();
            mat4.identity(texture_srt_matrix);
        }
        else
        {
            texture_srt_matrix = this.texture_srt_matrices[this.fshp_renderers[fshp_index].fmat_index];
        }
        return texture_srt_matrix;
    }

    get_fshp_bounding_box(fshp_index: number, bone_matrix_array: mat4[]): AABB
    {
        if(this.override_bounding_box != undefined)
        {
            // override bounding box doesn't need any transformations
            return this.override_bounding_box;
        }

        // last bounding box in the array is the one that covers the entire mesh
        const last_bounding_box_index = this.fshp_renderers[fshp_index].fshp.bounding_boxes.length - 1;
        const original_bounding_box = this.fshp_renderers[fshp_index].fshp.bounding_boxes[last_bounding_box_index];
        let new_bounding_box = new AABB();

        if (this.fshp_renderers[fshp_index].fshp.skin_bone_count == 0)
        {
            // non skinned mesh
            // if this model has a skeletal animation, update it every frame
            // otherwise only make it once
            if (this.fska != undefined || this.fshp_renderers[fshp_index].stored_bounding_box == undefined)
            {
                let world_matrix = mat4.create();
                mat4.multiply(world_matrix, this.transform_matrix, bone_matrix_array[0]);
                new_bounding_box.transform(original_bounding_box, world_matrix);
                this.fshp_renderers[fshp_index].stored_bounding_box = new_bounding_box;
            }
            else
            {
                return this.fshp_renderers[fshp_index].stored_bounding_box;
            }
        }
        else
        {
            // skinned mesh
            // transform the bounding box to each bone that contributes to this mesh
            // then union them all together
            for (let i = 0; i < this.fshp_renderers[fshp_index].fshp.skin_bone_indices.length; i++)
            {
                const bone_index = this.fshp_renderers[fshp_index].fshp.skin_bone_indices[i];
                const bone_matrix = recursive_bone_transform(bone_index, this.current_bones);
                let world_matrix = mat4.create();
                mat4.multiply(world_matrix, this.transform_matrix, bone_matrix);
                const per_bone_bounding_box = new AABB();
                per_bone_bounding_box.transform(original_bounding_box, world_matrix);
                new_bounding_box.union(new_bounding_box, per_bone_bounding_box);
            }
        }

        return new_bounding_box;
    }
}

/**
 * returns the value of an animatino curve at the specified frame
 * @param curve the curve to read from
 * @param current_frame which frame of the animation to read the curve at
 */
function get_keyframe_value(curve: Curve, current_frame: number): number
{
    for (let frame_index = 0; frame_index < curve.frames.length; frame_index++)
    {
        if (current_frame == curve.frames[frame_index])
        {
            // interpolation is unnecessary, just return the constant
            const value = curve.keys[frame_index][3];
            return value;
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
            return value;
        }
    }
    
    console.error("keyframe value not found");
    throw("whoops");
}

/**
 * returns the value of a shader param animation at the specified frame
 * @param default_value if the curve index isn't specified or is "-1", an animation curve is not used. return this number instead
 * @param curve_index_map the material animation's curve index lookup map to search
 * @param key which key to look for in curve_index_map
 * @param shader_param_animation the shader param animation to read a value from
 * @param current_frame which frame of the animation to read the curve at
 */
function get_shader_param_animation_value(default_value: number, curve_index_map: Map<string, string>, key: string, shader_param_animation: ShaderParamAnimation, current_frame: number)
{
    const curve_index = curve_index_map.get(key);
    if (curve_index === undefined || curve_index === "-1")
    {
        return default_value;
    }
    else
    {
        const curve = shader_param_animation.curves[Number(curve_index)];
        return get_keyframe_value(curve, current_frame);
    }
}

const FPS = 30;
const FPS_RATE = FPS/1000;
const BONE_MATRIX_MAX_LENGTH = 209; // shibuya lumps all the animated trees and street lamps into one model
