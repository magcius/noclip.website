// shader.ts
// the vertex and fragment shader for rendering maps from Tokyo Mirage Sessions ♯FE

import { DeviceProgram } from '../Program.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { FVTX } from "./bfres/fvtx.js";
import { FMAT } from "./bfres/fmat.js";

export class TMSFEProgram extends DeviceProgram
{
    public static vertex_attribute_codes = [ '_p0', '_c0', '_u0', '_u1', '_u2', '_u3', '_n0', '_t0' ];
    public static vertex_attribute_names = [ 'a_Position', 'a_Color', 'a_TexCoord0', 'a_TexCoord1', 'a_TexCoord2', 'a_TexCoord3', 'a_Normal', 'a_Tangent' ];
    public static vertex_attribute_types = [ 'vec3', 'vec4', 'vec2', 'vec2', 'vec2', 'vec2', 'vec4', 'vec4' ];

    public static ub_SceneParams = 0;

    constructor(public fvtx: FVTX, public fmat: FMAT)
    {
        super();
        this.name = this.fmat.name;
    }

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams
{
    Mat4x4 u_ClipFromViewMatrix;
    Mat3x4 u_ViewFromWorldMatrix;
    Mat4x4 u_BoneTransformMatrix;
};

#ifdef VERT
${this.define_inputs()}

out vec2 v_TexCoord0;

void mainVS()
{
    vec4 WorldPosition = UnpackMatrix(u_BoneTransformMatrix) * vec4(a_Position, 1.0);
    vec3 ViewPosition = UnpackMatrix(u_ViewFromWorldMatrix) * WorldPosition;
    gl_Position = UnpackMatrix(u_ClipFromViewMatrix) * vec4(ViewPosition, 1.0);

    v_TexCoord0 = a_TexCoord0.xy;
}
#endif

#ifdef FRAG
in vec2 v_TexCoord0;

void mainPS()
{
    vec2 f = v_TexCoord0 - floor(v_TexCoord0);
    gl_FragColor = ( (f.x < 0.5) ^^ (f.y < 0.5) ) ? vec4(1.0, 1.0, 1.0, 0.0) : vec4(0.0, 0.0, 0.0, 0.0);
    // gl_FragColor = vec4(0.0, 0.0, 1.0, 0.0);
}
#endif
`;

    private define_inputs(): string
    {
        let lines = '';

        for (let i = 0; i < this.fvtx.vertexAttributes.length; i++)
        {
            let attribute_code = this.fvtx.vertexAttributes[i].name;
            let attribute_index = TMSFEProgram.vertex_attribute_codes.indexOf(attribute_code);
            let attribute_name = TMSFEProgram.vertex_attribute_names[attribute_index]
            let type = TMSFEProgram.vertex_attribute_types[attribute_index];
            lines += `layout(location = ${i}) in ${type} ${attribute_name};\n`;
        }

        return lines;
    }

}
