import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";

export default class Plus4XPSandProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

    public static ub_SandParams = 0;
    public static a_Position = 0;
    public static a_Order = 1;

    public both = `
    ${GfxShaderLibrary.MatrixLibrary}

    layout(std140, row_major) uniform ub_SandParams {
      vec2 u_LastPendulumPos;
      vec2 u_PendulumPos;
      float u_Fade;
      float u_NumParticles;
    };

    uniform sampler2D sandTexture;

    #define PI 3.14159265359
    #define TWO_PI 6.28318530718

    float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    `;

    public vert: string = `

    layout(location = ${Plus4XPSandProgram.a_Position}) in vec2 a_Position;
    layout(location = ${Plus4XPSandProgram.a_Order}) in float a_Order;

    out vec2 v_TexCoord;
    out vec2 v_Pos;

    vec2 flipTexY(vec2 uv) {
      return vec2(uv.x, 1.0 - uv.y);
    }

    void main() {
      v_TexCoord = a_Position;
      v_Pos = (a_Position * 2.0 - 1.0);

      if (u_Fade <= 0.0) {
        vec2 pendulumPos = mix(u_LastPendulumPos, u_PendulumPos, a_Order / u_NumParticles);
        gl_Position = vec4(v_Pos * 0.04 + pendulumPos, 0.0, 1.0);
        // gl_Position = vec4(v_Pos, 0.0, 1.0); // for debugging
      } else {
        gl_Position = vec4(v_Pos, 0.0, 1.0);
      }
    }
    `;

    public frag: string = `
    in vec2 v_TexCoord;
    in vec2 v_Pos;

    void main() {

      vec3 color = texture(SAMPLER_2D(sandTexture), v_TexCoord).rgb;
      
      if (u_Fade <= 0.0) {
        if (length(v_Pos) > 1.0) {
          discard;
        } else {
          gl_FragColor = vec4(color * mix(0.7, 1.4, sin(atan(v_Pos.y, v_Pos.x)) * 0.5 + 0.75 * rand(v_Pos)), 1.0 - length(v_Pos));
        }
      } else {
        if (rand(v_Pos) > u_Fade) {
          discard;
        } else {
          gl_FragColor = vec4(color, 1.0);
        }
      }
    }
  `;
}
