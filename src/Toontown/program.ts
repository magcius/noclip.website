import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";

/**
 * Basic shader program for rendering Panda3D geometry.
 * Supports position, normal, color, and texture coordinates.
 */
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
    vec4 u_Misc;           // x: hasTexture, y: hasVertexColor, z: hasNormal, w: unused
};

#define u_HasTexture    (u_Misc.x > 0.5)
#define u_HasVertexColor (u_Misc.y > 0.5)
#define u_HasNormal     (u_Misc.z > 0.5)

uniform sampler2D u_Texture;
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec4 a_Color;
layout(location = 3) in vec2 a_TexCoord;

out vec3 v_Normal;
out vec4 v_Color;
out vec2 v_TexCoord;

void main() {
    mat4 t_ModelMatrix = UnpackMatrix(u_ModelMatrix);
    mat4 t_ViewMatrix = UnpackMatrix(u_ViewMatrix);
    mat4 t_Projection = UnpackMatrix(u_Projection);

    vec4 t_WorldPos = t_ModelMatrix * vec4(a_Position, 1.0);
    vec4 t_ViewPos = t_ViewMatrix * t_WorldPos;
    gl_Position = t_Projection * t_ViewPos;

    // Transform normal to view space (simplified, assumes uniform scale)
    mat3 t_NormalMatrix = mat3(t_ViewMatrix * t_ModelMatrix);
    v_Normal = normalize(t_NormalMatrix * a_Normal);

    v_Color = a_Color;
    v_TexCoord = vec2(a_TexCoord.x, 1.0 - a_TexCoord.y);
}
`;

  public override frag = `
in vec3 v_Normal;
in vec4 v_Color;
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = u_Color;

    // Apply vertex color if present
    if (u_HasVertexColor) {
        t_Color *= v_Color;
    }

    // Apply texture if present
    if (u_HasTexture) {
        vec4 t_TexColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
        t_Color *= t_TexColor;
    }

    // Simple directional lighting if normals present
    if (u_HasNormal) {
        vec3 t_LightDir = normalize(vec3(0.5, 1.0, 0.3));
        float t_NdotL = max(dot(normalize(v_Normal), t_LightDir), 0.0);
        float t_Lighting = 0.4 + 0.6 * t_NdotL; // Ambient + diffuse
        t_Color.rgb *= t_Lighting;
    }

    gl_FragColor = t_Color;
}
`;
}
