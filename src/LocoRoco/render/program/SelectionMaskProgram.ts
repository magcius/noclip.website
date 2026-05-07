/*
 * AI written SelectionMaskProgram. Renders the selected object's geometry into a
 * screen-space buffer as fully opaque white (or discards if texAlpha <= 0.05).
 * The result is a crisp binary mask: (1,1,1,1) inside, (0,0,0,0) outside.
 * The pass has no depth buffer so the full silhouette is captured regardless
 * of what occludes the object in the main scene.
 * 
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

/**
 * Renders the selected object as a binary white mask.
 * Discards pixels with texAlpha <= 0.05; all others become (1, 1, 1, 1).
 */
export class SelectionMaskProgram extends DeviceProgram {
  public static ub_Params = 0;

  // 36 floats: projection (16) + worldMatrix (16) + uvOffset (4)
  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x4 u_WorldMatrix;
    vec4 u_UVOffset;
};

uniform sampler2D u_Texture;
`;

  public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;

out vec2 v_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_Projection) * UnpackMatrix(u_WorldMatrix) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord + u_UVOffset.xy;
}
`;

  public override frag = `
in vec2 v_TexCoord;

void main() {
    float texAlpha = texture(SAMPLER_2D(u_Texture), v_TexCoord).a;
    if (texAlpha <= 0.05) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
}
`;
}
