// shader.ts
// the vertex and fragment shader for rendering maps from Tokyo Mirage Sessions ♯FE

import { DeviceProgram } from '../Program.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { FVTX } from "./bfres/fvtx.js";
import { FMAT } from "./bfres/fmat.js";
import { FSHP } from './bfres/fshp.js';

export class TMSFEProgram extends DeviceProgram
{
    public static vertex_attribute_codes = [ '_p0', '_c0', '_c1', '_u0', '_u1', '_u2', '_u3', '_u4', '_n0', '_t0', '_i0', '_w0' ];
    public static vertex_attribute_names = [ 'a_Position', 'a_Color0', 'a_Color1', 'a_TexCoord0', 'a_TexCoord1', 'a_TexCoord2', 'a_TexCoord3', 'a_TexCoord4', 'a_Normal', 'a_Tangent', 'a_BlendIndex0', 'a_BlendWeight0' ];
    public static vertex_attribute_types = [ 'vec3', 'vec4', 'float', 'vec2', 'vec2', 'vec2', 'vec2', 'vec2', 'vec4', 'vec4', 'placeholder', 'placeholder' ];

    public static ub_SceneParams = 0;

    constructor(public fvtx: FVTX, public fmat: FMAT, public fshp: FSHP, public bone_matrix_array_length: number)
    {
        super();
        this.name = this.fmat.name;
    }

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams
{
    Mat4x4 u_ClipFromViewMatrix;
    Mat3x4 u_ViewFromWorldMatrix;
    Mat3x4 u_TransformationMatrix;
    Mat2x4 u_Albedo0SRTMatrix;
    Mat3x4 u_BoneMatrices[${this.bone_matrix_array_length}];
};

uniform sampler2D s_diffuse;

varying vec2 v_TexCoord0;

#ifdef VERT
${this.define_inputs()}


void mainVS()
{
    #if ${this.fshp.skin_bone_count} == 0
    vec3 WorldPosition = UnpackMatrix(u_BoneMatrices[0]) * vec4(a_Position, 1.0);

    #elif ${this.fshp.skin_bone_count} == 1
    vec3 WorldPosition = UnpackMatrix(u_BoneMatrices[a_BlendIndex0]) * vec4(a_Position, 1.0);

    #elif ${this.fshp.skin_bone_count} == 2
    mat4x3 t_WorldFromLocalMatrix = mat4x3(0.0);
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.x]) * a_BlendWeight0.x;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.y]) * a_BlendWeight0.y;
    vec3 WorldPosition = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);

    #elif ${this.fshp.skin_bone_count} == 3
    mat4x3 t_WorldFromLocalMatrix = mat4x3(0.0);
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.x]) * a_BlendWeight0.x;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.y]) * a_BlendWeight0.y;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.z]) * a_BlendWeight0.z;
    vec3 WorldPosition = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);

    #elif ${this.fshp.skin_bone_count} == 4
    mat4x3 t_WorldFromLocalMatrix = mat4x3(0.0);
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.x]) * a_BlendWeight0.x;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.y]) * a_BlendWeight0.y;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.z]) * a_BlendWeight0.z;
    t_WorldFromLocalMatrix += UnpackMatrix(u_BoneMatrices[a_BlendIndex0.w]) * a_BlendWeight0.w;
    vec3 WorldPosition = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);

    #endif
    
    WorldPosition = UnpackMatrix(u_TransformationMatrix) * vec4(WorldPosition, 1.0);
    vec3 ViewPosition = UnpackMatrix(u_ViewFromWorldMatrix) * vec4(WorldPosition, 1.0);
    gl_Position = UnpackMatrix(u_ClipFromViewMatrix) * vec4(ViewPosition, 1.0);
    
    v_TexCoord0 = a_TexCoord0.xy;
}
#endif

#ifdef FRAG

void mainPS()
{
    vec2 Albedo0TexCoord =  UnpackMatrix(u_Albedo0SRTMatrix) * vec4(v_TexCoord0.xy, 1.0, 1.0);
    vec4 Albedo0Color = texture(SAMPLER_2D(s_diffuse), Albedo0TexCoord);
    gl_FragColor = Albedo0Color;

    #ifdef USE_ALPHA_TEST
    if (gl_FragColor.a < 0.5)
    {
        discard;
    }
    #endif
}
#endif
`;
    // Meshes can have an arbitrary amount of vertex attributes, so it's necessary to define them in a dynamic way
    // returns a string with the attribute definitions
    private define_inputs(): string
    {
        let lines = '';

        for (let i = 0; i < this.fvtx.vertexAttributes.length; i++)
        {
            let attribute_code = this.fvtx.vertexAttributes[i].name;
            let attribute_index = TMSFEProgram.vertex_attribute_codes.indexOf(attribute_code);
            let attribute_name = TMSFEProgram.vertex_attribute_names[attribute_index]
            let type = TMSFEProgram.vertex_attribute_types[attribute_index];
            if (attribute_code == '_i0')
            {
                switch(this.fshp.skin_bone_count)
                {
                    case 1:
                        type = 'uint';
                        break;
                    
                    case 2:
                        type = 'uvec2';
                        break;
                    
                    case 3:
                        type = 'uvec3';
                        break;
                    
                    case 4:
                        type = 'uvec4';
                        break;
                    
                    default:
                        console.error(`fshp ${this.fshp.name} _i0 defintion has ${this.fshp.skin_bone_count} skin bones`);
                        throw("whoops");
                }
            }
            if (attribute_code == '_w0')
            {
                switch(this.fshp.skin_bone_count)
                {
                    case 2:
                        type = 'vec2';
                        break;
                    
                    case 3:
                        type = 'vec3';
                        break;
                    
                    case 4:
                        type = 'vec4';
                        break;

                    default:
                        console.error(`fshp ${this.fshp.name} _w0 defintion has ${this.fshp.skin_bone_count} skin weights`);
                        throw("whoops");
                }
            }
            lines += `layout(location = ${i}) in ${type} ${attribute_name};\n`;
        }

        return lines;
    }
}
