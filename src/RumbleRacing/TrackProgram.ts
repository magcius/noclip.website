import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class TrackProgram extends DeviceProgram {
  public static a_Position = 0;
  public static a_TexCoord = 1;
  public static a_Normal = 2;
  public static a_Color = 3;

  public static ub_SceneParams = 0;
  public static ub_MeshParams = 1;

  constructor(
    hasVertexColors: boolean,
    alphaTest: boolean,
    ignoreVertexColors: boolean = false,
    ignoreTextures: boolean = false,
  ) {
    super();
    this.setDefineBool(
      "USE_VERTEX_COLOR",
      hasVertexColors && !ignoreVertexColors,
    );
    this.setDefineBool("UNLIT", hasVertexColors && ignoreVertexColors);
    this.setDefineBool("NO_TEXTURE", ignoreTextures);
    this.setDefineBool("USE_ALPHA_TEST", alphaTest);
  }

  public override vert = `
${TrackProgram.Common}

layout(location = ${TrackProgram.a_Position}) in vec3 a_Position;
layout(location = ${TrackProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${TrackProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TrackProgram.a_Color}) in vec4 a_Color;

out vec2 v_TexCoord;
out vec3 v_Normal;
out vec4 v_Color;

void main() {
    vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);
    v_TexCoord = a_TexCoord.xy;
    v_Normal = a_Normal;
    v_Color = a_Color;
}
`;

  public override frag = `
${TrackProgram.Common}

in vec2 v_TexCoord;
in vec3 v_Normal;
in vec4 v_Color;

void main() {
#if defined(NO_TEXTURE)
    vec4 color = vec4(1.0);
#else
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
#endif

#if defined(USE_VERTEX_COLOR)
    color *= v_Color;
#endif

#if defined(USE_ALPHA_TEST)
    if (color.a < u_AlphaTestRef)
        discard;
#endif

#if defined(USE_VERTEX_COLOR) || defined(UNLIT)
    gl_FragColor = color;
#else
    vec3 lightDir = normalize(vec3(0.4, 1.0, 0.2));

    float lighting = 1.0;
    if (dot(v_Normal, v_Normal) > 0.0) {
        float NdotL = max(dot(normalize(v_Normal), lightDir), 0.0);
        lighting = 0.25 + NdotL * 0.75;
    }

    gl_FragColor = vec4(color.rgb * lighting, color.a);
#endif
}
`;

  public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_MeshParams {
    Mat3x4 u_WorldFromLocal;
    vec4 u_MeshMisc;
};

#define u_AlphaTestRef (u_MeshMisc.x)

layout(location = 0) uniform sampler2D u_Texture;
`;
}
