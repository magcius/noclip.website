
import { DeviceProgram } from "../../Program";
import { TextureMapping } from "../../TextureHolder";
import { assert, nArray } from "../../util";
import { ViewerRenderInput } from "../../viewer";
import { fullscreenMegaState } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../helpers/ShaderHelpers";
import { fillVec4 } from "../helpers/UniformBufferHelpers";
import { GfxDevice } from "../platform/GfxPlatform";
import { GfxRenderInstManager } from "../render/GfxRenderer";
import { GfxrAttachmentSlot, GfxrGraphBuilder } from "../render/GfxRenderGraph";

class FXAAProgram extends DeviceProgram {
    public both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_InvResolution (u_Misc[0].xy)
`;

    public vert = GfxShaderLibrary.fullscreenVS;

    public frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

float Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return dot(t_Color.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    // FXAA v2, based on implementations:
    // http://www.geeks3d.com/20110405/fxaa-fast-approximate-anti-aliasing-demo-glsl-opengl-test-radeon-geforce/
    // https://github.com/mitsuhiko/webgl-meincraft

    vec2 t_PixelCenter = v_TexCoord.xy;
    float lumaMM = Monochrome(texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy).rgb);

#if 1
    vec2 t_PixelTopLeft = v_TexCoord.xy - u_InvResolution.xy * 0.5;
    float lumaNW = Monochrome(texture      (SAMPLER_2D(u_Texture), t_PixelTopLeft.xy)             .rgb);
    float lumaNE = Monochrome(textureOffset(SAMPLER_2D(u_Texture), t_PixelTopLeft.xy, ivec2(1, 0)).rgb);
    float lumaSW = Monochrome(textureOffset(SAMPLER_2D(u_Texture), t_PixelTopLeft.xy, ivec2(0, 1)).rgb);
    float lumaSE = Monochrome(textureOffset(SAMPLER_2D(u_Texture), t_PixelTopLeft.xy, ivec2(1, 1)).rgb);
#else
    // We're at the pixel center -- pixel edges are 0.5 units away.
    // NOTE(jstpierre): mitsuhiko's port seems to get this wrong?
    vec2 t_PixelSize = u_InvResolution.xy * 0.5;

    float lumaNW = Monochrome(texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + t_PixelSize * vec2(-1.0, -1.0)).rgb);
    float lumaNE = Monochrome(texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + t_PixelSize * vec2( 1.0, -1.0)).rgb);
    float lumaSW = Monochrome(texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + t_PixelSize * vec2(-1.0,  1.0)).rgb);
    float lumaSE = Monochrome(texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + t_PixelSize * vec2( 1.0,  1.0)).rgb);
#endif

    vec2 dir; 
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    const float FXAA_REDUCE_MIN = 1.0/128.0;
    const float FXAA_REDUCE_MUL = 1.0/8.0;
    const float FXAA_SPAN_MAX = 8.0;

    float dirReduce = max(
        (lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL),
        FXAA_REDUCE_MIN);

    float rcpDirMin = 1.0/(min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2( FXAA_SPAN_MAX,  FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * u_InvResolution.xy;

    float lumaMin = min(lumaMM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaMM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    vec4 rgbA = (1.0/2.0) * (
        texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + dir * (1.0/3.0 - 0.5)) +
        texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + dir * (2.0/3.0 - 0.5)));
    vec4 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * (
        texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + dir * (0.0/3.0 - 0.5)) +
        texture(SAMPLER_2D(u_Texture), t_PixelCenter.xy + dir * (3.0/3.0 - 0.5)));
    float lumaB = Monochrome(rgbB.rgb);

    vec4 rgbOutput = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;
    gl_FragColor.rgba = rgbOutput;
}
`;
}

const textureMapping = nArray(1, () => new TextureMapping());
export function pushFXAAPass(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, viewerInput: ViewerRenderInput): void {
    assert(viewerInput.sampleCount === 1);

    builder.pushPass((pass) => {
        pass.setDebugName('FXAA');
        pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
        pass.attachResolveTexture(mainColorResolveTextureID);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);

        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);
        fillVec4(d, offs, 1.0 / viewerInput.backbufferWidth, 1.0 / viewerInput.backbufferHeight);

        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 2 }]);
        renderInst.drawPrimitives(3);

        const fxaaProgram = new FXAAProgram();
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, fxaaProgram);

        renderInst.setGfxProgram(gfxProgram);

        pass.exec((passRenderer, scope) => {
            textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
            renderInst.setSamplerBindingsFromTextureMappings(textureMapping);
            renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, passRenderer);
        });
    });
}
