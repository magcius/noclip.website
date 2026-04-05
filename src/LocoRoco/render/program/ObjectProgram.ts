/*
 * AI written shader for regular objects. u_Extra allows drawing things in grayscale.
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

export class ObjectProgram extends DeviceProgram {
  public static ub_Params = 0;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x4 u_WorldMatrix;
    vec4 u_MaterialColor;
    vec4 u_UVOffset;
    vec4 u_Extra; // x = grayscale amount (0.0 = normal, 1.0 = fully grayscale)
};

uniform sampler2D u_Texture;
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec4 a_Color;

out vec2 v_TexCoord;
out vec4 v_Color;

void main() {
    gl_Position = UnpackMatrix(u_Projection) * UnpackMatrix(u_WorldMatrix) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord + u_UVOffset.xy;
    v_Color = a_Color;
}
`;

  public override frag = `
in vec2 v_TexCoord;
in vec4 v_Color;

void main() {
    vec4 tex = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec4 color = tex * v_Color * u_MaterialColor;
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(lum), u_Extra.x);
    gl_FragColor = color;
}
`;
}
