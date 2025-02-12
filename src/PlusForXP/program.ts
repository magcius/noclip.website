import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform.js";

export default class Plus4XPProgram {
  public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
  ];

  public static ub_CameraParams = 0;
  public static ub_ObjectParams = 1;

  public static a_Position = 0;
  public static a_Normal = 1;
  public static a_DiffuseColor = 2;
  public static a_TexCoord = 3;

  public both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140, row_major) uniform ub_CameraParams {
  mat4 u_Projection;
  mat4 u_ViewMatrix;
  mat4 u_ViewInverseMatrix;
};

layout(std140, row_major) uniform ub_ObjectParams {
  mat4 u_ModelMatrix;
  mat4 u_ModelInverseTransposeMatrix;
  mat4 u_EnvMapMatrix;
  float u_reflective;
};

uniform sampler2D diffuseTexture;
uniform sampler2D envTexture;
`;

  public vert: string = `

layout(location = ${Plus4XPProgram.a_Position}) in vec3 a_Position;
layout(location = ${Plus4XPProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${Plus4XPProgram.a_DiffuseColor}) in vec4 a_DiffuseColor;
layout(location = ${Plus4XPProgram.a_TexCoord}) in vec2 a_TexCoord;

out vec4 v_DiffuseColor;
out vec2 v_DiffuseTexCoord;
out vec2 v_EnvTexCoord;

void main() {
  
  vec4 position = vec4(a_Position, 1.0);
  vec4 normal = vec4(a_Normal, 1.0);
  
  vec4 worldPosition = u_ModelMatrix * position;
  vec4 viewPosition = u_ViewMatrix * worldPosition;
  vec4 clipPosition = u_Projection * viewPosition;
  gl_Position = clipPosition;

  v_DiffuseColor = min(a_DiffuseColor, 1.0);
  v_DiffuseTexCoord = a_TexCoord;

  
  vec3 e = normalize(worldPosition.xyz - u_ViewInverseMatrix[3].xyz);
  vec3 n = normalize((u_ModelInverseTransposeMatrix * normal).xyz);
  
  vec3 r = reflect(e, n);
  r = (u_EnvMapMatrix * vec4(r, 1.0)).xyz;
  v_EnvTexCoord = r.xy / (2.0 * length(r)) + 0.5;
}
`;

  public frag: string = `
in vec4 v_DiffuseColor;
in vec2 v_DiffuseTexCoord;
in vec2 v_EnvTexCoord;

void main() {
  vec3 color = v_DiffuseColor.rgb;
  if (u_reflective == 1.0) {
    vec2 t_TexCoordEnv = vec2(v_EnvTexCoord.x, 1.0 - v_EnvTexCoord.y);
    vec3 t_EnvSample = texture(SAMPLER_2D(envTexture), t_TexCoordEnv).rgb;
    color = t_EnvSample;
  } else {
    vec2 t_TexCoordDiffuse = vec2(v_DiffuseTexCoord.x, 1.0 - v_DiffuseTexCoord.y);
    vec3 t_DiffuseSample = texture(SAMPLER_2D(diffuseTexture), t_TexCoordDiffuse).rgb;
    color *= t_DiffuseSample;
  }
  gl_FragColor = vec4(color, v_DiffuseColor.a);
}
`;
}

