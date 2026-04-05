/*
 * AI written dual-filter blur programs for the focus collectibles mode.
 *
 * BlurDownProgram: 5-tap tent filter downsample.
 *   Reads the center pixel (weight 4) plus four diagonal neighbours (weight 1 each),
 *   divided by 8.  Produces a quarter-resolution mip at each pass.
 *
 * BlurUpProgram: 8-tap tent filter upsample.
 *   Reads eight diagonal/cardinal neighbours at offsets ±halfTexel and ±2·halfTexel,
 *   divided by 12.  Blends the up-sampled result back toward full resolution.
 *
 * BlurBlitProgram: plain fullscreen blit used to composite the blurred result.
 *
 * Uniform layout (BlurDownProgram and BlurUpProgram):
 *   ub_Params[0].xy = half-texel size of the *input* texture (0.5 / width, 0.5 / height)
 *   Binding 0 = u_Texture (input render target resolve)
 * 
 * petton-svn, 2026.
 */

import { GfxShaderLibrary } from "../../../gfx/helpers/GfxShaderLibrary.js";
import { DeviceProgram } from "../../../Program.js";

const blurBindings = `
uniform sampler2D u_Texture;
layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_HalfTexel (u_Misc[0].xy)
`;

export class BlurDownProgram extends DeviceProgram {
  public override both = blurBindings;
  public override vert = GfxShaderLibrary.fullscreenVS;
  public override frag = `
in vec2 v_TexCoord;
void main() {
    vec3 sum = texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb * 4.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord - u_HalfTexel).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + u_HalfTexel).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(u_HalfTexel.x, -u_HalfTexel.y)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x, u_HalfTexel.y)).rgb;
    sum /= 8.0;
    gl_FragColor = vec4(sum, 1.0);
}
`;
}

export class BlurUpProgram extends DeviceProgram {
  public override both = blurBindings;
  public override vert = GfxShaderLibrary.fullscreenVS;
  public override frag = `
in vec2 v_TexCoord;
void main() {
    vec3 sum = vec3(0.0);
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x, -u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x,  u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2( u_HalfTexel.x, -u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2( u_HalfTexel.x,  u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x * 2.0, 0.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2( 0.0,  u_HalfTexel.y * 2.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2( u_HalfTexel.x * 2.0, 0.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2( 0.0, -u_HalfTexel.y * 2.0)).rgb;
    sum /= 12.0;
    gl_FragColor = vec4(sum, 1.0);
}
`;
}

export class BlurBlitProgram extends DeviceProgram {
  public override vert = GfxShaderLibrary.fullscreenVS;
  public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}
