
import { fullscreenMegaState } from "../helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../helpers/GfxShaderLibrary.js";
import type { GfxProgram, GfxSampler } from "../platform/GfxPlatform.js";
import { GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../platform/GfxPlatform.js";
import { GfxRenderCache } from "../render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../render/GfxRenderGraph.js";
import type { GfxRenderHelper } from "../render/GfxRenderHelper.js";
import { preprocessProgram_GLSL } from "../shaderc/GfxShaderCompiler.js";

function createProgram(cache: GfxRenderCache): GfxProgram {
    const vert = GfxShaderLibrary.fullscreenVS;

    const frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

${GfxShaderLibrary.MonochromeNTSC}

vec4 FXAA(PD_SAMPLER_2D(t_Texture), in vec2 t_PixelCenter, in vec2 t_InvResolution) {
    // FXAA v2, based on implementations:
    // http://www.geeks3d.com/20110405/fxaa-fast-approximate-anti-aliasing-demo-glsl-opengl-test-radeon-geforce/
    // https://github.com/mitsuhiko/webgl-meincraft

    float lumaMM = MonochromeNTSC(texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy).rgb);

#if 1
    vec2 t_PixelTopLeft = t_PixelCenter.xy - t_InvResolution.xy * 0.5;
    float lumaNW = MonochromeNTSC(texture      (PU_SAMPLER_2D(t_Texture), t_PixelTopLeft.xy)             .rgb);
    float lumaNE = MonochromeNTSC(textureOffset(PU_SAMPLER_2D(t_Texture), t_PixelTopLeft.xy, ivec2(1, 0)).rgb);
    float lumaSW = MonochromeNTSC(textureOffset(PU_SAMPLER_2D(t_Texture), t_PixelTopLeft.xy, ivec2(0, 1)).rgb);
    float lumaSE = MonochromeNTSC(textureOffset(PU_SAMPLER_2D(t_Texture), t_PixelTopLeft.xy, ivec2(1, 1)).rgb);
#else
    // We're at the pixel center -- pixel edges are 0.5 units away.
    // NOTE(jstpierre): mitsuhiko's port seems to get this wrong?
    vec2 t_PixelSize = t_InvResolution.xy * 0.5;

    float lumaNW = MonochromeNTSC(texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + t_PixelSize * vec2(-1.0, -1.0)).rgb);
    float lumaNE = MonochromeNTSC(texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + t_PixelSize * vec2( 1.0, -1.0)).rgb);
    float lumaSW = MonochromeNTSC(texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + t_PixelSize * vec2(-1.0,  1.0)).rgb);
    float lumaSE = MonochromeNTSC(texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + t_PixelSize * vec2( 1.0,  1.0)).rgb);
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
    dir = min(vec2( FXAA_SPAN_MAX,  FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * t_InvResolution.xy;

    float lumaMin = min(lumaMM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaMM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    vec4 rgbA = (1.0/2.0) * (
        texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + dir * (1.0/3.0 - 0.5)) +
        texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + dir * (2.0/3.0 - 0.5)));
    vec4 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * (
        texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + dir * (0.0/3.0 - 0.5)) +
        texture(PU_SAMPLER_2D(t_Texture), t_PixelCenter.xy + dir * (3.0/3.0 - 0.5)));
    float lumaB = MonochromeNTSC(rgbB.rgb);

    vec4 rgbOutput = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;
    return rgbOutput;
}

void main() {
    vec2 t_InvResolution = 1.0 / vec2(textureSize(TEXTURE(u_Texture), 0));
    gl_FragColor.rgba = FXAA(PP_SAMPLER_2D(u_Texture), v_TexCoord.xy, t_InvResolution);
}
`;

    const program = preprocessProgram_GLSL(cache.device.queryVendorInfo(), vert, frag);
    return cache.createProgramSimple(program);
}

export class FXAA {
    private gfxProgram: GfxProgram;
    private gfxSampler: GfxSampler;

    constructor(renderCache: GfxRenderCache) {
        this.gfxProgram = createProgram(renderCache);
        this.gfxSampler = renderCache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
        })
    }

    public pushPasses(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, mainColorTargetID: GfxrRenderTargetID): void {
        builder.pushPass((pass) => {
            pass.setDebugName('FXAA');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            const renderInst = renderHelper.renderInstManager.newRenderInst();
            renderInst.setUniformBuffer(renderHelper.uniformBuffer);
            renderInst.setAllowSkippingIfPipelineNotReady(false);

            renderInst.setMegaStateFlags(fullscreenMegaState);
            renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
            renderInst.setDrawCount(3);

            renderInst.setGfxProgram(this.gfxProgram);

            pass.exec((passRenderer, scope) => {
                renderInst.setSamplerBindingsFromTextureMappings([
                    { gfxTexture: scope.getResolveTextureForID(mainColorResolveTextureID), gfxSampler: this.gfxSampler, lateBinding: null },
                ]);
                renderInst.drawOnPass(renderHelper.renderCache, passRenderer);
            });
        });
    }
}
