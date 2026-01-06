// shader.ts
// the vertex and fragment shader for rendering maps from Tokyo Mirage Sessions ♯FE

import { DeviceProgram } from '../Program.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';

export class TMSFEProgram extends DeviceProgram
{
    public static a_Position = 0;
    public static two = 1;
    public static three = 2;
    public static four = 3;
    public static five = 4;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams
{
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

#ifdef VERT
layout(location = ${TMSFEProgram.a_Position}) attribute vec3 a_Position;

void mainVS()
{
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
}
#endif

#ifdef FRAG
void mainPS()
{
    gl_FragColor = vec4(0.0, 0.0, 1.0, 0.0);
}
#endif
`;

}
