/**
 * AI written fullscreen selection composite program. Draws the glowing outline 
 * over all selected objects.
 *
 * Sampler layout (binding order matches setSamplerBindingsFromTextureMappings):
 *   0 = u_MainTex  — main scene colour
 *   1 = u_SelTex   — selection mask (white inside silhouette, transparent outside)
 *
 * Uniform buffer ub_Params (4 floats, vec4 u_Misc[1]):
 *   u_Misc[0].x = time in seconds
 *   u_Misc[0].y = 1 / screenWidth   (texel width in UV space)
 *   u_Misc[0].z = 1 / screenHeight  (texel height in UV space)
 *   u_Misc[0].w = showMask flag (1.0 = show raw greyscale mask, 0.0 = composite)
 *
 * Effect (normal mode):
 *   1. 8-tap max-pool dilation of selTex.a with radius pulsing 3–9 screen pixels.
 *   2. Interior (inside silhouette): 50% yellow blend over main scene.
 *   3. Outline ring (dilated but outside silhouette): solid yellow.
 *
 * Effect (showMask mode):
 *   Outputs greyscale: white inside silhouette, black outside, fully opaque.
 *
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

export class SelectionCompositeProgram extends DeviceProgram {
  public static ub_Params = 0;

  // Sampler and UBO declarations go in `both` so they appear in preprocessedVert.
  // The WebGL2 backend only reads preprocessedVert for "// BINDING=N" comments
  // to call gl.uniform1i — without this, all samplers default to unit 0.
  public override both = `
uniform sampler2D u_MainTex;
uniform sampler2D u_SelTex;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};

#define u_Time     (u_Misc[0].x)
#define u_TexelW   (u_Misc[0].y)
#define u_TexelH   (u_Misc[0].z)
#define u_ShowMask (u_Misc[0].w)
`;

  public override vert = GfxShaderLibrary.fullscreenVS;

  public override frag = `
in vec2 v_TexCoord;

void main() {
    float selAlpha = texture(SAMPLER_2D(u_SelTex), v_TexCoord).a;
    float inSil    = step(0.5, selAlpha);   // 1 inside silhouette, 0 outside

    // Debug: show raw greyscale mask.
    if (u_ShowMask > 0.5) {
        gl_FragColor = vec4(inSil, inSil, inSil, 1.0);
        return;
    }

    vec4 mainColor = texture(SAMPLER_2D(u_MainTex), v_TexCoord);

    // 8-direction max-pool dilation sampled at 1/3, 2/3, and full radius.
    // Sampling at sub-radii prevents gaps when an object is thinner than
    // the full dilation radius (common when zoomed far out).
    float pulse  = 0.5 + 0.5 * sin(u_Time * 3.0);
    float radius = mix(3.0, 9.0, pulse);
    vec2 ts1 = vec2(u_TexelW, u_TexelH) * (radius / 3.0);
    vec2 ts2 = vec2(u_TexelW, u_TexelH) * (radius * 2.0 / 3.0);
    vec2 ts3 = vec2(u_TexelW, u_TexelH) *  radius;

    float d0 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2( 1.000,  0.000)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2( 1.000,  0.000)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2( 1.000,  0.000)).a));
    float d1 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2(-1.000,  0.000)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2(-1.000,  0.000)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2(-1.000,  0.000)).a));
    float d2 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2( 0.000,  1.000)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2( 0.000,  1.000)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2( 0.000,  1.000)).a));
    float d3 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2( 0.000, -1.000)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2( 0.000, -1.000)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2( 0.000, -1.000)).a));
    float d4 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2( 0.707,  0.707)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2( 0.707,  0.707)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2( 0.707,  0.707)).a));
    float d5 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2(-0.707,  0.707)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2(-0.707,  0.707)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2(-0.707,  0.707)).a));
    float d6 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2( 0.707, -0.707)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2( 0.707, -0.707)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2( 0.707, -0.707)).a));
    float d7 = max(max(step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts1 * vec2(-0.707, -0.707)).a),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts2 * vec2(-0.707, -0.707)).a)),
                       step(0.5, texture(SAMPLER_2D(u_SelTex), v_TexCoord + ts3 * vec2(-0.707, -0.707)).a));
    float dilated = max(max(max(d0, d1), max(d2, d3)), max(max(d4, d5), max(d6, d7)));

    float outline = dilated * (1.0 - inSil);   // ring outside the silhouette

    // Interior: 50% yellow blend.
    vec3 result = mix(mainColor.rgb, vec3(1.0, 1.0, 0.0), inSil * 0.5);

    // Outline: solid yellow ring.
    result = mix(result, vec3(1.0, 1.0, 0.0), outline);

    gl_FragColor = vec4(result, mainColor.a);
}
`;
}
