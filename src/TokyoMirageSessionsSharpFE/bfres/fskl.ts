// fskl.ts
// Handles FSKL (caFe SKeLeton) data, which is a skeleton for transforming meshes

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";
import { read_bfres_string } from "./bfres_switch.js";
import { FSKA } from "./fska.js";
import { vec3 } from "gl-matrix";
import { user_data, parse_user_data } from "./user_data.js";
import { mat4 } from "gl-matrix";
import { computeModelMatrixSRT } from "../../MathHelpers.js";

/**
 * reads from a bfres file and returns a FSKL object
 * @param buffer the bfres file
 * @param offset start of the fskl data
 */
export function parseFSKL(buffer: ArrayBufferSlice, offset: number): FSKL
{
    const view = buffer.createDataView();
    assert(readString(buffer, offset, 0x04) === 'FSKL');

    const flags = view.getUint32(offset + 0x4, true);
    const scaling_mode = (flags >> 8) & 0xF;

    const bone_array_offset = view.getUint32(offset + 0x10, true);
    const bone_count = view.getUint16(offset + 0x38, true);
    const bone_array: FSKL_Bone[] = [];
    let bone_entry_offset = bone_array_offset;
    for (let i = 0; i < bone_count; i++)
    {
        const name_offset = view.getUint32(bone_entry_offset, true);
        const name = read_bfres_string(buffer, name_offset, true);
        
        const user_data_array_offset = view.getUint32(bone_entry_offset + 0x8, true);
        const user_data_count = view.getUint16(bone_entry_offset + 0x32, true);
        const user_data_array: user_data[] = parse_user_data(buffer, user_data_array_offset, user_data_count);

        const parent_index = view.getInt16(bone_entry_offset + 0x2A, true);

        const scale_x = view.getFloat32(bone_entry_offset + 0x38, true);
        const scale_y = view.getFloat32(bone_entry_offset + 0x3C, true);
        const scale_z = view.getFloat32(bone_entry_offset + 0x40, true);
        const scale = vec3.fromValues(scale_x, scale_y, scale_z);

        const rotation_x = view.getFloat32(bone_entry_offset + 0x44, true);
        const rotation_y = view.getFloat32(bone_entry_offset + 0x48, true);
        const rotation_z = view.getFloat32(bone_entry_offset + 0x4C, true);
        const rotation = vec3.fromValues(rotation_x, rotation_y, rotation_z);

        const translation_x = view.getFloat32(bone_entry_offset + 0x54, true);
        const translation_y = view.getFloat32(bone_entry_offset + 0x58, true);
        const translation_z = view.getFloat32(bone_entry_offset + 0x5C, true);
        const translation = vec3.fromValues(translation_x, translation_y, translation_z);

        bone_array.push({ name, parent_index, scale, rotation, translation, user_data: user_data_array });
        bone_entry_offset += BONE_ENTRY_SIZE;
    }

    const smooth_rigid_index_array_offset = view.getUint32(offset + 0x18, true);
    const smooth_count = view.getUint16(offset + 0x3A, true);
    const rigid_count = view.getUint16(offset + 0x3C, true);
    let smooth_rigid_array: number[] = [];
    let smooth_rigid_index_entry_offset = smooth_rigid_index_array_offset;
    for (let i = 0; i < smooth_count + rigid_count; i++)
    {
        const bone_index = view.getUint16(smooth_rigid_index_entry_offset, true);

        smooth_rigid_array.push(bone_index);
        smooth_rigid_index_entry_offset += SMOOTH_RIGID_INDEX_ENTRY_SIZE;
    }

    const bone_local_from_bind_pose_matrix_array_offset = view.getUint32(offset + 0x20, true);
    let bone_local_from_bind_pose_matrices: mat4[] = [];
    let bone_local_from_bind_pose_matrix_entry_offset = bone_local_from_bind_pose_matrix_array_offset;
    for (let i = 0; i < smooth_count; i++)
    {
        const m00 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x00, true);
        const m10 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x04, true);
        const m20 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x08, true);
        const m30 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x0C, true);
        const m01 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x10, true);
        const m11 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x14, true);
        const m21 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x18, true);
        const m31 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x1C, true);
        const m02 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x20, true);
        const m12 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x24, true);
        const m22 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x28, true);
        const m32 = view.getFloat32(bone_local_from_bind_pose_matrix_entry_offset + 0x2C, true);
        const matrix = mat4.fromValues(m00, m01, m02, 0.0, m10, m11, m12, 0.0, m20, m21, m22, 0.0, m30, m31, m32, 1.0);
        bone_local_from_bind_pose_matrices.push(matrix);
        
        bone_local_from_bind_pose_matrix_entry_offset += MATRIX_ENTRY_SIZE;
    }

    return { bones: bone_array, smooth_rigid_indices: smooth_rigid_array, bone_local_from_bind_pose_matrices, scaling_mode };
}

const BONE_ENTRY_SIZE = 0x60;
const SMOOTH_RIGID_INDEX_ENTRY_SIZE = 0x2;
const MATRIX_ENTRY_SIZE = 0X30;

/**
 * multiply a bone's transformation with all it's parent's transformations to get the real transformation matrix
 */
export function recursive_bone_transform(bone_index: number, bones: FSKL_Bone[]): mat4
{
    const bone = bones[bone_index];
    let transform_matrix: mat4 = mat4.create();
    computeModelMatrixSRT
    (
        transform_matrix,
        bone.scale[0], bone.scale[1], bone.scale[2],
        bone.rotation[0], bone.rotation[1], bone.rotation[2],
        bone.translation[0], bone.translation[1], bone.translation[2],
    );
    if (bone.parent_index == -1)
    {
        return transform_matrix;
    }
    else
    {
        const new_matrix: mat4 = mat4.create();
        mat4.multiply(new_matrix, recursive_bone_transform(bone.parent_index, bones), transform_matrix)
        return new_matrix;
    }
}

export interface FSKL
{
    bones: FSKL_Bone[];
    smooth_rigid_indices: number[];
    bone_local_from_bind_pose_matrices: mat4[];
    scaling_mode: FSKL_Scaling_Mode
}

export interface FSKL_Bone
{
    name: string;
    parent_index: number;
    scale: vec3;
    rotation: vec3;
    translation: vec3;
    user_data: user_data[];
}

enum FSKL_Scaling_Mode
{
    Standard = 0x1,
    Maya     = 0x2,
}
