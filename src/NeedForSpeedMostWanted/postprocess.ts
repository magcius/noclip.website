import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxSamplerBinding, GfxDevice, GfxSamplerDescriptor, GfxSampler } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { TextureMapping } from "../TextureHolder.js";
import { ViewerRenderInput } from "../viewer.js";
import { NfsMap } from "./map.js";
import { NfsTexture } from "./region.js";


export class NfsPostProcessing {
    public tintIntensity = 1.0;

    private blurXProgram: DeviceProgram;
    private blurYProgram: DeviceProgram;
    private luminanceDownsampleProgram: DeviceProgram;
    private visualTreatmentProgram: DeviceProgram;
    private downsampleBlurDesc: GfxrRenderTargetDescription;
    private textureMappings: TextureMapping[];

    constructor(map: NfsMap, renderHelper: GfxRenderHelper) {
        this.luminanceDownsampleProgram = new NfsLuminanceDownsampleProgram();
        this.blurXProgram = new NfsBlurProgram();
        this.blurYProgram = new NfsBlurProgram();
        this.blurXProgram.defines.set("X", "1");
        this.visualTreatmentProgram = new NfsVisualTreatmentProgram();
        const vignetteTex = map.textureCache[0x968775E8] ?? map.textureCache[0xCC087FE];
        const gfxSampler = renderHelper.renderInstManager.gfxRenderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp
        });
        this.textureMappings = [ new TextureMapping(), new TextureMapping(), vignetteTex ];
        this.textureMappings[0].gfxSampler = gfxSampler;
        this.textureMappings[1].gfxSampler = gfxSampler;
    }

    private blurPass(builder: GfxrGraphBuilder, renderInst: GfxRenderInst, renderInstManager: GfxRenderInstManager, prevPassTargetID: GfxrRenderTargetID, blurX: boolean) {
        const blurColorID = builder.createRenderTargetID(this.downsampleBlurDesc, 'Blur');

        builder.pushPass((pass) => {
            pass.setDebugName('Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, blurColorID);
            const resolvedTexId = builder.resolveRenderTarget(prevPassTargetID);
            pass.attachResolveTexture(resolvedTexId),
            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(blurX ? this.blurXProgram : this.blurYProgram));
                this.textureMappings[0].gfxTexture = scope.getResolveTextureForID(resolvedTexId);
                renderInst.setSamplerBindingsFromTextureMappings([ this.textureMappings[0] ]);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return blurColorID;
    }

    public render(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput, mainColorTargetID: GfxrRenderTargetID) {
        const renderInstManager = renderHelper.renderInstManager;

        this.downsampleBlurDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        this.downsampleBlurDesc.width /= 4;
        this.downsampleBlurDesc.height /= 4;
        const downsampleColorID = builder.createRenderTargetID(this.downsampleBlurDesc, 'Downsample Color');
        const visTreatDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const visTreatTargetID = builder.createRenderTargetID(visTreatDesc, 'Visual Treatment Color');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setVertexInput(null, null, null);
        renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
        renderInst.setDrawCount(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Downsample Luminance');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorID);
            const resolvedTexId = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(resolvedTexId),
            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(this.luminanceDownsampleProgram));
                this.textureMappings[0].gfxTexture = scope.getResolveTextureForID(resolvedTexId);
                renderInst.setSamplerBindingsFromTextureMappings([ this.textureMappings[0] ]);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        let blurColorID = this.blurPass(builder, renderInst, renderInstManager, downsampleColorID, true);
        blurColorID = this.blurPass(builder, renderInst, renderInstManager, blurColorID, false);
        blurColorID = this.blurPass(builder, renderInst, renderInstManager, blurColorID, true);
        blurColorID = this.blurPass(builder, renderInst, renderInstManager, blurColorID, false);

        builder.pushPass((pass) => {
            pass.setDebugName('Visual Treatment');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, visTreatTargetID);
            const mainColorTexId = builder.resolveRenderTarget(mainColorTargetID);
            const blurTexId = builder.resolveRenderTarget(blurColorID);
            pass.attachResolveTexture(mainColorTexId);
            pass.attachResolveTexture(blurTexId);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(this.visualTreatmentProgram));
                renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 3 }]);
                let offs = renderInst.allocateUniformBuffer(0, 4);
                const d = renderInst.mapUniformBufferF32(0);
                offs += fillVec4(d, offs, this.tintIntensity, 0, 0, 0);
                this.textureMappings[0].gfxTexture = scope.getResolveTextureForID(mainColorTexId);
                this.textureMappings[1].gfxTexture = scope.getResolveTextureForID(blurTexId);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
                renderHelper.prepareToRender();
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return visTreatTargetID;
    }
}


class NfsBlurProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;

    public override frag = `
uniform sampler2D u_Texture;

in vec2 v_TexCoord;

void main() {
    vec2 texSize = vec2(textureSize(TEXTURE(u_Texture), 0));
#ifdef X
    vec2 step = vec2(1.0, 0.0) / texSize;
#else
    vec2 step = vec2(0.0, 1.0) / texSize;
#endif
    vec4 color
        = texture(SAMPLER_2D(u_Texture), v_TexCoord + step * 1.5)
        + texture(SAMPLER_2D(u_Texture), v_TexCoord + step * 3.0) * 0.5
        + texture(SAMPLER_2D(u_Texture), v_TexCoord + step * -1.5)
        + texture(SAMPLER_2D(u_Texture), v_TexCoord + step * -3.0) * 0.5;
    gl_FragColor = color / 3.0;
}
    `;
}

class NfsVisualTreatmentProgram extends DeviceProgram {
    public override both = `
layout(std140) uniform ub_PostProcParams {
    float ub_TintIntensity;
};

uniform sampler2D u_MainColor;
uniform sampler2D u_BlurredLuminance;
uniform sampler2D u_Vignette;
`;

    public override vert = GfxShaderLibrary.fullscreenVS;

    public override frag = `
#define LuminanceVector vec3(0.6125, 0.5154, 0.0721)
#define Desaturation 0.5
#define BlackBloomIntensity vec2(0.9, 0.1)
#define ColourBloomTint vec3(0.88, 0.80, 0.44)
#define ColourBloomTintWhite vec3(0.8)
#define ColourBloomIntensity 1.75

in vec2 v_TexCoord;

float getSpline(float p0, float p1, float p2, float p3, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    float invT = 1.0 - t;
    float invT2 = invT * invT;
    float invT3 = invT2 * invT;
    return p0 * invT3 + 3.0 * p1 * invT2 * t + 3.0 * p2 * invT * t2 + p3 * t3;
}

void main() {
    vec3 mainCol = texture(SAMPLER_2D(u_MainColor), v_TexCoord).rgb;
    vec3 tintedColor = mainCol * mix(ColourBloomTintWhite, ColourBloomTint, ub_TintIntensity);

    float luminance = dot(mainCol, LuminanceVector);
    vec3 desatured = Desaturation * luminance + (1.0 - Desaturation) * mainCol;

    float blurredLuminance = texture(SAMPLER_2D(u_BlurredLuminance), v_TexCoord).r;
    float blackBloom = BlackBloomIntensity.y + BlackBloomIntensity.x * getSpline(0.0, 0.1724138, 1.12069, 1.0, blurredLuminance);
    float colorBloom = ColourBloomIntensity * getSpline(0.2, 0.5, 0.5862069, 0.4655172, blurredLuminance);

    vec3 finalColor = tintedColor * colorBloom + desatured * blackBloom;
    float vignette = texture(SAMPLER_2D(u_Vignette), vec2(v_TexCoord.x, 1.0 - v_TexCoord.y)).r;
    gl_FragColor.rgb = finalColor * vignette;
    gl_FragColor.a = 1.0;
}
    `;
}

class NfsLuminanceDownsampleProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;

    public override frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

#define LuminanceVector vec3(0.6125, 0.5154, 0.0721)

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = vec4(dot(LuminanceVector, gl_FragColor.rgb));
}
    `;
}
