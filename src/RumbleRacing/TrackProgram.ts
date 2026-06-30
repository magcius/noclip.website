import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class TrackProgram extends DeviceProgram {
  public static a_Position = 0;
  public static a_TexCoord = 1;
  public static a_Normal = 2;

  public static ub_SceneParams = 0;
  public static ub_MeshParams = 1;

  public override vert = `
${TrackProgram.Common}

layout(location = ${TrackProgram.a_Position}) in vec3 a_Position;
layout(location = ${TrackProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${TrackProgram.a_Normal}) in vec3 a_Normal;

out vec2 v_TexCoord;
out vec3 v_Normal;

void main() {
    vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);
    v_TexCoord = a_TexCoord.xy;
    v_Normal = a_Normal;
}
`;

  public override frag = `
${TrackProgram.Common}

in vec2 v_TexCoord;
in vec3 v_Normal;

void main() {
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);

    if (color.a < 0.99)
        discard;

    vec3 lightDir = normalize(vec3(0.4, 1.0, 0.2));
    float NdotL = max(dot(normalize(v_Normal), lightDir), 0.0);

    float lighting = 0.25 + NdotL * 0.75;

    gl_FragColor = vec4(color.rgb * lighting, color.a);
}
`;

  public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_MeshParams {
    Mat3x4 u_WorldFromLocal;
};

layout(location = 0) uniform sampler2D u_Texture;
`;
}
