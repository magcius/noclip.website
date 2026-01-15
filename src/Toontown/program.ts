import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../Program.js";
import type { CachedGeometryData, MaterialData } from "./geom.js";
import { ColorType, PandaCompareFunc } from "./nodes/index.js";

/**
 * Attribute locations for vertex shader inputs.
 */
export const AttributeLocation = {
  Position: 0,
  Normal: 1,
  Color: 2,
  TexCoord: 3,
  BoneWeights: 4,
  BoneIndices: 5,
} as const;

/**
 * Maximum number of bone matrices per draw call.
 * Arbitrary value, can be increased if needed.
 */
export const MAX_BONES = 46;

export type ToontownProgramProps = {
  hasTexture: boolean;
  hasNormals: boolean;
  hasColors: boolean;
  useVertexColors: boolean;
  hasSkinning: boolean;
  alphaTestMode: PandaCompareFunc;
  alphaTestThreshold: number;
};

export function createProgramProps(
  geomData: CachedGeometryData,
  material: MaterialData,
): ToontownProgramProps {
  return {
    hasTexture: material.texture !== null && geomData.hasTexCoords,
    hasNormals: geomData.hasNormals,
    hasColors: geomData.hasColors,
    useVertexColors:
      geomData.hasColors && material.colorType === ColorType.Vertex,
    hasSkinning: geomData.skinningBuffer !== null,
    alphaTestMode: material.alphaTestMode,
    alphaTestThreshold: material.alphaTestThreshold,
  };
}

export function programPropsEqual(
  a: ToontownProgramProps,
  b: ToontownProgramProps,
): boolean {
  return (
    a.hasTexture === b.hasTexture &&
    a.hasNormals === b.hasNormals &&
    a.hasColors === b.hasColors &&
    a.useVertexColors === b.useVertexColors &&
    a.hasSkinning === b.hasSkinning &&
    a.alphaTestMode === b.alphaTestMode &&
    a.alphaTestThreshold === b.alphaTestThreshold
  );
}

export class ToontownProgram extends DeviceProgram {
  public static ub_SceneParams = 0;
  public static ub_DrawParams = 1;
  public static ub_SkinningParams = 2;

  constructor(props: ToontownProgramProps) {
    super();
    this.setDefineBool("HAS_TEXTURE", props.hasTexture);
    this.setDefineBool("HAS_NORMAL", props.hasNormals);
    this.setDefineBool("HAS_COLOR", props.hasColors);
    this.setDefineBool("USE_VERTEX_COLORS", props.useVertexColors);
    this.setDefineBool("HAS_SKINNING", props.hasSkinning);
    this.setDefineBool("HAS_ALPHA_TEST", props.alphaTestThreshold !== null);
    this.setDefineString(
      "ALPHA_THRESHOLD",
      (props.alphaTestThreshold ?? 0).toPrecision(3),
    );
    this.setDefineString("MAX_BONES", MAX_BONES.toString());
    switch (props.alphaTestMode) {
      case PandaCompareFunc.None:
      case PandaCompareFunc.Always:
        this.setDefineString("ALPHA_COMPARE", "true");
        break;
      case PandaCompareFunc.Never:
        this.setDefineString("ALPHA_COMPARE", "false");
        break;
      case PandaCompareFunc.Less:
        this.setDefineString("ALPHA_COMPARE", "a < t");
        break;
      case PandaCompareFunc.Equal:
        this.setDefineString("ALPHA_COMPARE", "a == t");
        break;
      case PandaCompareFunc.LessEqual:
        this.setDefineString("ALPHA_COMPARE", "a <= t");
        break;
      case PandaCompareFunc.Greater:
        this.setDefineString("ALPHA_COMPARE", "a > t");
        break;
      case PandaCompareFunc.NotEqual:
        this.setDefineString("ALPHA_COMPARE", "a != t");
        break;
      case PandaCompareFunc.GreaterEqual:
        this.setDefineString("ALPHA_COMPARE", "a >= t");
        break;
    }
  }

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

// Scene-wide parameters (camera matrices)
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
};

// Per-draw parameters
layout(std140) uniform ub_DrawParams {
    Mat4x4 u_ModelMatrix;
    vec4 u_Color;
    vec4 u_ColorScale;
};

#ifdef HAS_SKINNING
layout(std140) uniform ub_SkinningParams {
    Mat3x4 u_BoneMatrix[MAX_BONES];
};
#endif

#ifdef HAS_TEXTURE
uniform sampler2D u_Texture;
#endif
`;

  public override vert = `
layout(location = ${AttributeLocation.Position}) in vec3 a_Position;
#ifdef HAS_NORMAL
layout(location = ${AttributeLocation.Normal}) in vec3 a_Normal;
#endif
#ifdef HAS_COLOR
layout(location = ${AttributeLocation.Color}) in vec4 a_Color;
#endif
#ifdef HAS_TEXTURE
layout(location = ${AttributeLocation.TexCoord}) in vec2 a_TexCoord;
#endif
#ifdef HAS_SKINNING
layout(location = ${AttributeLocation.BoneWeights}) in vec4 a_BoneWeights;
layout(location = ${AttributeLocation.BoneIndices}) in uvec4 a_BoneIndices;
#endif

#ifdef USE_VERTEX_COLORS
out vec4 v_Color;
#endif
#ifdef HAS_TEXTURE
out vec2 v_TexCoord;
#endif

#ifdef HAS_SKINNING
mat4x3 GetSkinMatrix() {
    mat4x3 result = UnpackMatrix(u_BoneMatrix[a_BoneIndices.x]) * a_BoneWeights.x;
    result += UnpackMatrix(u_BoneMatrix[a_BoneIndices.y]) * a_BoneWeights.y;
    result += UnpackMatrix(u_BoneMatrix[a_BoneIndices.z]) * a_BoneWeights.z;
    result += UnpackMatrix(u_BoneMatrix[a_BoneIndices.w]) * a_BoneWeights.w;
    return result;
}
#endif

void main() {
    mat4 t_ModelMatrix = UnpackMatrix(u_ModelMatrix);
    mat4 t_ViewMatrix = UnpackMatrix(u_ViewMatrix);
    mat4 t_Projection = UnpackMatrix(u_Projection);

    vec3 t_LocalPos = a_Position;
#ifdef HAS_NORMAL
    vec3 t_LocalNormal = a_Normal;
#endif

#ifdef HAS_SKINNING
    // Apply skinning transformation in local space
    mat4x3 t_SkinMatrix = GetSkinMatrix();
    t_LocalPos = t_SkinMatrix * vec4(a_Position, 1.0);
#ifdef HAS_NORMAL
    // Transform normal (no translation, just rotation/scale)
    t_LocalNormal = t_SkinMatrix * vec4(a_Normal, 0.0);
#endif
#endif

    vec4 t_WorldPos = t_ModelMatrix * vec4(t_LocalPos, 1.0);
    vec4 t_ViewPos = t_ViewMatrix * t_WorldPos;
    gl_Position = t_Projection * t_ViewPos;

#ifdef USE_VERTEX_COLORS
    v_Color = a_Color;
#endif
#ifdef HAS_TEXTURE
    v_TexCoord = vec2(a_TexCoord.x, 1.0 - a_TexCoord.y);
#endif
}
`;

  public override frag = `
#ifdef USE_VERTEX_COLORS
in vec4 v_Color;
#endif
#ifdef HAS_TEXTURE
in vec2 v_TexCoord;
#endif

void main() {
    vec4 t_Color = u_Color;

#ifdef USE_VERTEX_COLORS
    t_Color *= v_Color;
#endif

#ifdef HAS_TEXTURE
    vec4 t_TexColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    t_Color *= t_TexColor;
#endif

    t_Color *= u_ColorScale;

#ifdef HAS_ALPHA_TEST
    float a = t_Color.a;
    float t = ALPHA_THRESHOLD;
    if (!(ALPHA_COMPARE)) {
      discard;
    }
#endif

    gl_FragColor = t_Color;
}
`;
}
