
// EGG PostEffects

import ArrayBufferSlice from "../ArrayBufferSlice";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA8, colorScale, OpaqueBlack } from "../Color";
import { copyMegaState, fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/ShaderHelpers";
import { fillColor, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxDevice, GfxFormat, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GXShaderLibrary } from "../gx/gx_material";
import { DeviceProgram } from "../Program";
import { generateBlurFunction } from "../SuperMarioGalaxy/ImageEffect";
import { TextureMapping } from "../TextureHolder";
import { assert, nArray, readString } from "../util";

interface BBLM {
    thresholdAmount: number;
    thresholdColor: Color;
    compositeColor: Color;
    blurFlags: number;
    blur0Radius: number;
    blur0Intensity: number;
    blur1Radius: number;
    blur1Intensity: number;
    compositeBlendMode: number;
    blur1NumPasses: number;
    bokehColorScale0: number;
    bokehColorScale1: number;
}

export function parseBBLM(buffer: ArrayBufferSlice): BBLM {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PBLM');
    const fileSize = view.getUint32(0x04);
    const version = view.getUint8(0x08);
    assert(version === 1);

    const thresholdAmount = view.getFloat32(0x10);
    const thresholdColor = colorNewFromRGBA8(view.getUint32(0x14));
    const compositeColor = colorNewFromRGBA8(view.getUint32(0x18));
    const blurFlags = view.getUint16(0x1C);
    const blur0Radius = view.getFloat32(0x20);
    const blur0Intensity = view.getFloat32(0x24);
    const blur1Radius = view.getFloat32(0x40);
    const blur1Intensity = view.getFloat32(0x44);
    const compositeBlendMode = view.getUint8(0x80);
    const blur1NumPasses = view.getUint8(0x81);
    const bokehColorScale0 = view.getFloat32(0x9C);
    const bokehColorScale1 = view.getFloat32(0xA0);

    return {
        thresholdAmount, thresholdColor, compositeColor, blurFlags,
        blur0Radius, blur0Intensity, blur1Radius, blur1Intensity,
        compositeBlendMode, blur1NumPasses, bokehColorScale0, bokehColorScale1,
    };
}

class FullscreenBlitProgram extends DeviceProgram {
    public vert = GfxShaderLibrary.fullscreenVS;
    public frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

class EggBloomBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    vec4 u_ThresholdColor;
    vec4 u_CompositeColor;
    vec4 u_CompositeColorScale;
};
`;

    public vert = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;
}

class EggBloomThresholdProgram extends EggBloomBaseProgram {
    public frag: string = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${GfxShaderLibrary.monochromeNTSC}
${GXShaderLibrary.TevOverflow}

in vec2 v_TexCoord;

void main() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor.rgb = c.rgb * (saturate(MonochromeNTSC(c.rgb) - u_ThresholdColor.rgb));
    gl_FragColor.a = 1.0;
}
`;
}

class EggBloomBlurProgram extends EggBloomBaseProgram {
    constructor(tapCount: number, numPasses: number, intensity: number, radius: number)  {
        super();

        const intensityPerTap = intensity / tapCount * 8;

        let funcs = '';
        let code = '';
        for (let i = 0; i < numPasses; i++) {
            const passTapCount = (i + 1) * tapCount;
            const funcName = `BlurPass${i}`;
            funcs += generateBlurFunction(funcName, passTapCount, glslGenerateFloat(radius), glslGenerateFloat(intensityPerTap));
            code += `
    c += saturate(${funcName}(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect));`;
        }

        this.frag = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${funcs}

in vec2 v_TexCoord;

void main() {
    vec2 t_Size = vec2(textureSize(u_Texture, 0));
    vec2 t_Aspect = vec2(1.0) / t_Size;

    vec3 c = vec3(0.0);
${code}
    gl_FragColor.rgb = saturate(c);
    gl_FragColor.a = 1.0;
}
`;
    }
}

class EggBloomCombineProgram extends EggBloomBaseProgram {
    constructor(numPasses: number)  {
        super();

        const passTextureName = ['u_Texture', 'u_Texture2'];
        let code = ``;
        for (let i = 0; i < numPasses; i++) {
            code += `
    c += saturate(texture(PP_SAMPLER_2D(${passTextureName[i]}), v_TexCoord).rgb) * u_CompositeColor.rgb * u_CompositeColorScale[${i}];`;
        }

        this.frag = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}

in vec2 v_TexCoord;

void main() {
    vec3 c = vec3(0.0);
    ${code}
    gl_FragColor.rgb = saturate(c);
    gl_FragColor.a = 1.0;
}
`;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 2 }];

export class EggBloom {
    private thresholdColor = colorNewCopy(OpaqueBlack);
    private thresholdProgram: GfxProgram;
    private blitProgram: GfxProgram;
    private blur0Program: GfxProgram;
    private blur1Program: GfxProgram;
    private compositeColor = colorNewCopy(OpaqueBlack);
    private compositeColorScale0: number;
    private compositeColorScale1: number;
    private compositeProgram: GfxProgram;
    private compositeMegaState = copyMegaState(fullscreenMegaState);

    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    constructor(device: GfxDevice, cache: GfxRenderCache, private pblm: BBLM) {
        // Threshold settings.
        const thresholdColorScale = (pblm.thresholdAmount * 219.0 + 16.0) / 255.0;
        colorScale(this.thresholdColor, pblm.thresholdColor, thresholdColorScale);
        if (!!(pblm.blurFlags & 0x10))
            this.thresholdColor.a = 0.0;

        colorCopy(this.compositeColor, pblm.compositeColor);
        this.compositeColorScale0 = pblm.bokehColorScale0;
        this.compositeColorScale1 = pblm.bokehColorScale1;

        const blurNumSamples = 8;
        const blur0Program = new EggBloomBlurProgram(blurNumSamples, 1, pblm.blur0Intensity, pblm.blur0Radius);
        const blur1Program = new EggBloomBlurProgram(blurNumSamples, pblm.blur1NumPasses, pblm.blur1Intensity, pblm.blur1Radius);

        const numPasses = (pblm.blurFlags & 1) ? 2 : 1;
        const combineProgram = new EggBloomCombineProgram(numPasses);

        const linearSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.thresholdProgram = cache.createProgram(device, new EggBloomThresholdProgram());
        this.blitProgram = cache.createProgram(device, new FullscreenBlitProgram());
        this.blur0Program = cache.createProgram(device, blur0Program);
        this.blur1Program = cache.createProgram(device, blur1Program);
        this.compositeProgram = cache.createProgram(device, combineProgram);

        const blendModeTable = [
            { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.ONE, blendDstFactor: GfxBlendFactor.ONE },
            { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.ONE_MINUS_DST_COLOR, blendDstFactor: GfxBlendFactor.ONE },
            { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.SRC_ALPHA, blendDstFactor: GfxBlendFactor.ONE },
            { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.SRC_ALPHA, blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA },
            { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.DST_COLOR, blendDstFactor: GfxBlendFactor.ONE },
        ];
        setAttachmentStateSimple(this.compositeMegaState, blendModeTable[pblm.compositeBlendMode]);
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 12);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillColor(d, offs, this.thresholdColor);
        offs += fillColor(d, offs, this.compositeColor);
        offs += fillVec4(d, offs, this.compositeColorScale0, this.compositeColorScale1);
    }

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target8ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    public pushPassesBloom(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number): void {
        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        this.target2ColorDesc.setDimensions(mainColorTargetDesc.width >>> 1, mainColorTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);
        this.target8ColorDesc.setDimensions(this.target4ColorDesc.width >>> 1, this.target4ColorDesc.height >>> 1, 1);

        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Bloom 1/2 Buffer');
        const downsample4ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Bloom 1/4 Buffer');
        const downsample8ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Bloom 1/8 Buffer');

        const device = renderInstManager.device;
        const cache = renderInstManager.gfxRenderCache;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Threshold & Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample2ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 0');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur0Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        const downsample4ColorResolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/8');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);

            pass.attachResolveTexture(downsample4ColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4ColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 1');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Composite');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const downsample8ColorResolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(downsample4ColorResolveTextureID);
            pass.attachResolveTexture(downsample8ColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.compositeProgram);
                renderInst.setMegaStateFlags(this.compositeMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4ColorResolveTextureID);
                this.textureMapping[1].gfxTexture = scope.getResolveTextureForID(downsample8ColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(device, cache, passRenderer);
            });
        });
    }
}
