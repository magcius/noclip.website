import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class DreamDropShader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static a_Weight = 3;
    public static a_Joint = 4;
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_ShapeParams = 2;

    constructor(attributeCount: number, skinWeightCount: number, boneSRTCount: number,) {
        super();
        this.both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    float u_Time;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_View;
    ${boneSRTCount > 0 ? `Mat3x4 u_BoneSRT[${boneSRTCount}];` : ''}
};

layout(std140) uniform ub_ShapeParams {
    vec2 u_Scroll;
    float u_HasTexture;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = ${DreamDropShader.a_Position}) in vec3 a_Position;
layout(location = ${DreamDropShader.a_Color}) in vec4 a_Color;
layout(location = ${DreamDropShader.a_UV}) in vec2 a_UV;
${attributeCount >= 4 ? `layout(location = ${DreamDropShader.a_Weight}) in vec4 a_Weight;` : ''}
${attributeCount >= 5 ? `layout(location = ${DreamDropShader.a_Joint}) in uvec4 a_Joint;` : ''}

void main() {
    v_Color = a_Color;
    v_UV = a_UV + (u_Time * u_Scroll);
    ${boneSRTCount > 0 ?
        `mat4x3 t_BoneMatrix = mat4x3(0.0);
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.x]) * a_Weight.x;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.y]) * a_Weight.y;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.z]) * a_Weight.z;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.w]) * a_Weight.w;
    vec3 t_ViewPosition = UnpackMatrix(u_View) * vec4(t_BoneMatrix * vec4(a_Position, 1.0), 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_ViewPosition, 1.0);`
    : 'gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_View) * vec4(a_Position, 1.0), 1.0);'}
}
#endif

#ifdef FRAG
void main() {
    if (u_HasTexture > 0.1) {
        vec4 texColor = texture(SAMPLER_2D(u_Texture), v_UV);
        if (texColor.a < 0.1) {
            discard;
        }
        gl_FragColor = texColor * v_Color;
    } else {
        gl_FragColor = v_Color;
    }
}
#endif
    `;
    }
}
