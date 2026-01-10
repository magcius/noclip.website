import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../Program.js";

export class ToontownProgram extends DeviceProgram {
  public static ub_SceneParams = 0;
  public static ub_DrawParams = 1;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}
${GfxShaderLibrary.saturate}

// Scene-wide parameters (camera matrices)
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
};

// Per-draw parameters
layout(std140) uniform ub_DrawParams {
    Mat4x4 u_ModelMatrix;
    vec4 u_Color;          // Base color multiplier
    vec4 u_Misc;           // x: hasTexture, y: hasVertexColor, z: hasNormal, w: alphaThreshold
};

#define u_HasTexture    (u_Misc.x > 0.5)
#define u_HasVertexColor (u_Misc.y > 0.5)
#define u_HasNormal     (u_Misc.z > 0.5)
#define u_AlphaThreshold u_Misc.w

uniform sampler2D u_Texture;
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec4 a_Color;
layout(location = 3) in vec2 a_TexCoord;

out vec4 v_Color;
out vec2 v_TexCoord;

void main() {
    mat4 t_ModelMatrix = UnpackMatrix(u_ModelMatrix);
    mat4 t_ViewMatrix = UnpackMatrix(u_ViewMatrix);
    mat4 t_Projection = UnpackMatrix(u_Projection);

    vec4 t_WorldPos = t_ModelMatrix * vec4(a_Position, 1.0);
    vec4 t_ViewPos = t_ViewMatrix * t_WorldPos;
    gl_Position = t_Projection * t_ViewPos;

    v_Color = a_Color;
    v_TexCoord = vec2(a_TexCoord.x, 1.0 - a_TexCoord.y);
}
`;

  public override frag = `
in vec4 v_Color;
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = u_Color;

    if (u_HasVertexColor) {
        t_Color *= v_Color;
    }

    if (u_HasTexture) {
        vec4 t_TexColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
        t_Color *= t_TexColor;
    }

    // Alpha test: discard pixels below threshold (for M_dual and M_binary modes)
    if (u_AlphaThreshold > 0.0 && t_Color.a < u_AlphaThreshold) {
        discard;
    }

    gl_FragColor = t_Color;
}
`;
}
