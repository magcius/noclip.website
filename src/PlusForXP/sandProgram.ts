import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform.js";

export default class Plus4XPSandProgram {
  public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 1, },
  ];

  public static ub_SandParams = 0;
  public static a_Position = 0;
  
  public both = `
    ${GfxShaderLibrary.MatrixLibrary}

    layout(std140, row_major) uniform ub_SandParams {
      vec2 u_PendulumPos;
    };

    uniform sampler2D sandTexture;
    `;

  public vert: string = `

    layout(location = ${Plus4XPSandProgram.a_Position}) in vec2 a_Position;

    out vec2 v_TexCoord;
    out vec2 v_Pos;

    void main() {
      v_TexCoord = a_Position;
      v_Pos = (a_Position * 2.0 - 1.0);
      gl_Position = vec4(v_Pos * 0.04 + u_PendulumPos, 0.0, 1.0);
    }
    `;

  public frag: string = `
    in vec2 v_TexCoord;
    in vec2 v_Pos;

    void main() {
      if (length(v_Pos) > 1.0) {
        discard;
      }
      vec3 color = texture(SAMPLER_2D(sandTexture), v_TexCoord).rgb;
      gl_FragColor = vec4(color * mix(0.5, 1.0, atan(v_TexCoord.x, v_TexCoord.y)), 1.0 - length(v_Pos));
    }
  `;
}

