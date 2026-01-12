import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../Program.js";
import type { CachedGeometryData, MaterialData } from "./geom.js";
import { ColorType, PandaCompareFunc } from "./nodes/index.js";

export type ToontownProgramProps = {
  hasTexture: boolean;
  hasNormals: boolean;
  hasColors: boolean;
  useVertexColors: boolean;
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
    a.alphaTestMode === b.alphaTestMode &&
    a.alphaTestThreshold === b.alphaTestThreshold
  );
}

export class ToontownProgram extends DeviceProgram {
  public static ub_SceneParams = 0;
  public static ub_DrawParams = 1;

  constructor(props: ToontownProgramProps) {
    super();
    this.setDefineBool("HAS_TEXTURE", props.hasTexture);
    this.setDefineBool("HAS_NORMAL", props.hasNormals);
    this.setDefineBool("HAS_COLOR", props.hasColors);
    this.setDefineBool("USE_VERTEX_COLORS", props.useVertexColors);
    this.setDefineBool("HAS_ALPHA_TEST", props.alphaTestThreshold !== null);
    this.setDefineString(
      "ALPHA_THRESHOLD",
      (props.alphaTestThreshold ?? 0).toPrecision(3),
    );
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
};

#ifdef HAS_TEXTURE
uniform sampler2D u_Texture;
#endif
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
#ifdef HAS_NORMAL
layout(location = 1) in vec3 a_Normal;
#endif
#ifdef HAS_COLOR
layout(location = 2) in vec4 a_Color;
#endif
#ifdef HAS_TEXTURE
layout(location = 3) in vec2 a_TexCoord;
#endif

#ifdef USE_VERTEX_COLORS
out vec4 v_Color;
#endif
#ifdef HAS_TEXTURE
out vec2 v_TexCoord;
#endif

void main() {
    mat4 t_ModelMatrix = UnpackMatrix(u_ModelMatrix);
    mat4 t_ViewMatrix = UnpackMatrix(u_ViewMatrix);
    mat4 t_Projection = UnpackMatrix(u_Projection);

    vec4 t_WorldPos = t_ModelMatrix * vec4(a_Position, 1.0);
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
