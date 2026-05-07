/*
 * AI written shader for fixed-size colored glow markers behind focused collectibles.
 * Uses gl_VertexID to procedurally generate a quad — no vertex buffer needed.
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

export class GlowProgram extends DeviceProgram {
  public static ub_Params = 0;

  public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    vec4 u_WorldCenter;   // xyz = world position
    vec4 u_GlowParams;    // x = radius in pixels, y = viewport width, z = viewport height
    vec4 u_Color;          // rgba glow color
};
`;

  public override vert = `
out vec2 v_QuadPos;

void main() {
    // Generate a quad from 6 vertices (2 triangles) via gl_VertexID
    //  0: (-1,-1)  1: (1,-1)  2: (-1,1)
    //  3: (-1,1)   4: (1,-1)  5: (1,1)
    vec2 corners[6];
    corners[0] = vec2(-1.0, -1.0);
    corners[1] = vec2( 1.0, -1.0);
    corners[2] = vec2(-1.0,  1.0);
    corners[3] = vec2(-1.0,  1.0);
    corners[4] = vec2( 1.0, -1.0);
    corners[5] = vec2( 1.0,  1.0);

    v_QuadPos = corners[gl_VertexID];

    // Project world center to clip space
    vec4 centerClip = UnpackMatrix(u_Projection) * vec4(u_WorldCenter.xyz, 1.0);

    // Convert pixel radius to clip-space offset
    float radiusPx = u_GlowParams.x;
    vec2 pixelToClip = vec2(2.0 / u_GlowParams.y, 2.0 / u_GlowParams.z);

    // Offset the quad corners by the fixed pixel radius
    gl_Position = centerClip + vec4(v_QuadPos * radiusPx * pixelToClip * centerClip.w, 0.0, 0.0);
}
`;

  public override frag = `
in vec2 v_QuadPos;

void main() {
    float dist = length(v_QuadPos);
    if (dist > 1.0) discard;
    float alpha = smoothstep(1.0, 0.0, dist);
    gl_FragColor = vec4(u_Color.rgb, u_Color.a * alpha);
}
`;
}
