import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class GlowProgram extends DeviceProgram {
  public static a_Direction = 0;
  public static a_Class = 1;

  public static ub_SceneParams = 0;
  public static ub_GlowParams = 1;

  public override vert = `
${GlowProgram.Common}

layout(location = ${GlowProgram.a_Direction}) in vec2 a_Direction;
layout(location = ${GlowProgram.a_Class}) in float a_Class;

out vec4 v_Color;

void main() {
    vec3 t_CenterView = (UnpackMatrix(u_ViewFromWorld) * vec4(u_Center.xyz, 1.0f)).xyz;

    float t_Radius = mix(u_RadiusB, u_RadiusA, a_Class);
    v_Color = mix(u_ColorB, u_ColorA, a_Class);

    vec2 t_Direction = vec2(
        a_Direction.x * u_Cos - a_Direction.y * u_Sin,
        a_Direction.x * u_Sin + a_Direction.y * u_Cos);

    vec3 t_PositionView = t_CenterView + vec3(t_Direction * t_Radius, 0.0f);
    gl_Position = UnpackMatrix(u_ClipFromView) * vec4(t_PositionView, 1.0f);
}
`;

  public override frag = `
${GlowProgram.Common}

in vec4 v_Color;

void main() {
    gl_FragColor = v_Color;
}
`;

  public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromView;
    Mat3x4 u_ViewFromWorld;
};

layout(std140) uniform ub_GlowParams {
    vec4 u_Center;
    vec4 u_GlowMisc;
    vec4 u_ColorA;
    vec4 u_ColorB;
};

#define u_RadiusA (u_GlowMisc.x)
#define u_RadiusB (u_GlowMisc.y)
#define u_Cos     (u_GlowMisc.z)
#define u_Sin     (u_GlowMisc.w)
`;
}
