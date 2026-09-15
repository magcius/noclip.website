import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class GlowProgram extends DeviceProgram {
  public static a_Direction = 0;
  public static a_Class = 1;
  public static a_CenterRadiusA = 2;
  public static a_Misc = 3;
  public static a_ColorA = 4;
  public static a_ColorB = 5;

  public static elementsPerInstance = 16;

  public static ub_SceneParams = 0;

  public override vert = `
${GlowProgram.Common}

layout(location = ${GlowProgram.a_Direction}) in vec2 a_Direction;
layout(location = ${GlowProgram.a_Class}) in float a_Class;
layout(location = ${GlowProgram.a_CenterRadiusA}) in vec4 a_CenterRadiusA;
layout(location = ${GlowProgram.a_Misc}) in vec4 a_Misc;
layout(location = ${GlowProgram.a_ColorA}) in vec4 a_ColorA;
layout(location = ${GlowProgram.a_ColorB}) in vec4 a_ColorB;

out vec4 v_Color;

#define t_RadiusA (a_CenterRadiusA.w)
#define t_RadiusB (a_Misc.x)
#define t_Cos     (a_Misc.y)
#define t_Sin     (a_Misc.z)

void main() {
    vec3 t_CenterView = (UnpackMatrix(u_ViewFromWorld) * vec4(a_CenterRadiusA.xyz, 1.0f)).xyz;

    float t_Radius = mix(t_RadiusB, t_RadiusA, a_Class);
    v_Color = mix(a_ColorB, a_ColorA, a_Class);

    vec2 t_Direction = vec2(
        a_Direction.x * t_Cos - a_Direction.y * t_Sin,
        a_Direction.x * t_Sin + a_Direction.y * t_Cos);

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
`;
}
