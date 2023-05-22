
import { SceneObjHolder, SceneObj } from "./Main";
import { NameObj, CalcAnimType, MovementType } from "./NameObj";
import { getMatrixTranslation } from "../MathHelpers";
import { vec3 } from "gl-matrix";
import { AreaObj, AreaObjMgr, AreaFormType } from "./AreaObj";
import { JMapInfoIter, getJMapInfoArg7, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3 } from "./JMapInfo";
import { ZoneAndLayer } from "./LiveActor";
import { fallback } from "../util";
import { ViewerRenderInput } from "../viewer";
import { connectToScene, getAreaObj } from "./ActorUtil";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxWrapMode, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBlendMode, GfxBlendFactor, GfxMegaStateDescriptor, GfxFormat, GfxProgram, GfxTextureDimension, GfxSamplerFormatKind } from "../gfx/platform/GfxPlatform";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { MathConstants } from "../MathHelpers";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription, GfxrGraphBuilder, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/GfxShaderLibrary";
import { IS_DEPTH_REVERSED } from "../gfx/helpers/ReversedDepthHelpers";
import { GXShaderLibrary } from "../gx/gx_material";

const scratchVec3 = vec3.create();

const ImageEffectShaderLib = `
${GfxShaderLibrary.saturate}
${GXShaderLibrary.GXIntensity}
${GXShaderLibrary.TevOverflow}

vec2 BlurAspect(PD_SAMPLER_2D(t_Texture)) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Aspect = vec2((t_Size.y / t_Size.x) / (3.0/4.0), 1.0);
    return t_Aspect;
}
`;

export function generateBlurFunction(functionName: string, tapCount: number, radiusStr: string, intensityPerTapStr: string, angleOffset: number = 0.0): string {
    let S = `
vec3 ${functionName}(PD_SAMPLER_2D(t_Texture), in vec2 t_TexCoord, in vec2 t_Aspect) {
    vec3 c = vec3(0.0);
`;

    for (let i = 0; i < tapCount; i++) {
        const theta = angleOffset + (MathConstants.TAU * (i / tapCount));
        const x = Math.cos(theta), y = -Math.sin(theta);

        S += `
    c += (texture(PU_SAMPLER_2D(t_Texture), t_TexCoord + t_Aspect * vec2(${glslGenerateFloat(x)} * ${radiusStr}, ${glslGenerateFloat(y)} * ${radiusStr})).rgb * ${intensityPerTapStr});`;
    }

    S += `
    return c;
}
`;
    return S;
}

abstract class ImageEffectBase extends NameObj {
    public visibleScenario = true;
    public active = false;
    public visible = false;
    public strength = 0.0;

    public isOn(): boolean {
        return this.visibleScenario && (this.visible || this.active);
    }

    public override calcAnim(sceneObjHolder: SceneObjHolder): void {
        const strengthAdj = sceneObjHolder.deltaTimeFrames / 30.0;

        if (this.active) {
            this.visible = true;
            this.strength += strengthAdj;
            if (this.strength > 1.0)
                this.strength = 1.0;
        } else if (this.visible) {
            this.strength -= strengthAdj;
            if (this.strength <= 0.0) {
                this.strength = 0.0;
                this.visible = false;
            }
        }

        this.calcAnimSub(sceneObjHolder);
    }

    public calcAnimSub(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyTurnOn(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyTurnOff(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyForceOn(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyForceOff(sceneObjHolder: SceneObjHolder): void {
    }

    public pushPasses(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, mainDepthTargetID: number, resultBlendTargetID: number): void {
    }
}

function connectToSceneNormalBloom(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    connectToScene(sceneObjHolder, nameObj, -1, CalcAnimType.Environment, -1, -1);
}

function connectToSceneImageEffect(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    // Original game attaches a DrawType here, but we don't want that -- we use pushPass() instead.
    connectToScene(sceneObjHolder, nameObj, MovementType.ImageEffect, CalcAnimType.Environment, -1, -1);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 2, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Depth, },
    ] },
];

// Should I try to do this with GX? lol.

class BloomPassBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_BloomIntensity (u_Misc[0].x)
#define u_Threshold      (u_Misc[0].y)
#define u_Intensity1     (u_Misc[0].z)
#define u_Intensity2     (u_Misc[0].w)
`;

    public override vert = GfxShaderLibrary.fullscreenVS;
}

class FullscreenBlitProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

class BloomPassThresholdProgram extends BloomPassBaseProgram {
    public override frag: string = `
${BloomPassBaseProgram.BindingsDefinition}
${ImageEffectShaderLib}

in vec2 v_TexCoord;

void main() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = (GXIntensity(c.rgb) > u_Threshold) ? c : vec4(0.0);
}
`;
}

abstract class BloomPassBlurProgram extends BloomPassBaseProgram {
    constructor(radiusL: number[], ofsL: number[], tapCount: number, intensityVar: string) {
        super();

        assert(radiusL.length === ofsL.length);

        let funcs = ``;
        let main = ``;

        for (let i = 0; i < radiusL.length; i++) {
            const funcName = `BlurPass${i}`;
            const radius = -radiusL[i];
            const radiusStr = radius.toFixed(5);
            const angleOffset = ofsL[i];
            funcs += generateBlurFunction(funcName, tapCount, radiusStr, intensityVar, angleOffset);
            main += `
    f += TevOverflow(${funcName}(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect));`;
        }

        this.frag = `
${BloomPassBaseProgram.BindingsDefinition}
${ImageEffectShaderLib}

in vec2 v_TexCoord;

${funcs}

void main() {
    vec3 f = vec3(0.0);
    vec2 t_Aspect = BlurAspect(PP_SAMPLER_2D(u_Texture));

${main}
`;
    }
}

class BloomPassBlur1Program extends BloomPassBlurProgram {
    constructor() {
        super([0.01, 0.02], [0.00, 0.52], 6, 'u_Intensity1');
        this.frag += `
    f = saturate(f);
    gl_FragColor = vec4(f.rgb, 1.0);
}
`;
    }
}

class BloomPassBlur2Program extends BloomPassBlurProgram {
    constructor() {
        super([0.04, 0.07, 0.09], [0.00, 0.00, 0.00], 12, 'u_Intensity2');
        this.frag += `
    f = saturate(f);
    // Combine pass.
    f += texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb;
    f *= u_BloomIntensity;
    gl_FragColor = vec4(f, 1.0);
}
`;
    }
}

export class BloomEffect extends ImageEffectBase {
    public bloomIntensity: number = 0;
    public threshold: number = 0;
    public intensity1: number = 0;
    public intensity2: number = 0;

    private thresholdProgram: GfxProgram;
    private blur1Program: GfxProgram;
    private blur2Program: GfxProgram;
    private blitProgram: GfxProgram;

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.One,
    }), fullscreenMegaState);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target8ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'BloomEffect');

        connectToSceneNormalBloom(sceneObjHolder, this);
        sceneObjHolder.create(SceneObj.ImageEffectSystemHolder);

        const cache = sceneObjHolder.modelCache.cache;
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.thresholdProgram = cache.createProgram(new BloomPassThresholdProgram());
        this.blur1Program = cache.createProgram(new BloomPassBlur1Program());
        this.blur2Program = cache.createProgram(new BloomPassBlur2Program());
        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        const bloomIntensity = (this.bloomIntensity * this.strength) / 0xFF;
        const threshold = this.threshold / 0xFF;
        const intensity1 = this.intensity1 / 0xFF;
        const intensity2 = this.intensity2 / 0xFF;

        offs += fillVec4(d, offs, bloomIntensity, threshold, intensity1, intensity2);
    }

    public pushPassesBloom(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, bloomObjectsTargetID: GfxrRenderTargetID, resultBlendTargetID: GfxrRenderTargetID): void {
        if (!this.isOn())
            return;

        const bloomObjectsTargetDesc = builder.getRenderTargetDescription(bloomObjectsTargetID);

        this.target2ColorDesc.setDimensions(bloomObjectsTargetDesc.width >>> 1, bloomObjectsTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);
        this.target8ColorDesc.setDimensions(this.target4ColorDesc.width >>> 1, this.target4ColorDesc.height >>> 1, 1);

        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Bloom Downsample 1/2');
        const downsample4ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Bloom Downsample 1/4');
        const blurL1ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Bloom Blur L1');
        const downsample8ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Bloom Blur Downsample 1/8');
        const blurL2ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Bloom Blur L2 (Bokeh)');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        // Downsample and threshold.
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(bloomObjectsTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample2ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        // Blur L1.
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur L1');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, blurL1ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur Downsample 1/8');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(blurL1ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur L2 (Bokeh)');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, blurL2ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur2Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, resultBlendTargetID);

            const bloomBlurL2ResolveTextureID = builder.resolveRenderTarget(blurL2ColorTargetID);
            pass.attachResolveTexture(bloomBlurL2ResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(bloomBlurL2ResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

const BloomSimplePSCommon = `
${ImageEffectShaderLib}

uniform sampler2D u_Texture;
in vec2 v_TexCoord;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_MaskFilter   (u_Misc[0].x)
#define u_Threshold    (u_Misc[0].y)
#define u_Intensity    (u_Misc[0].z)
`;

class BloomSimpleThresholdProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
${BloomSimplePSCommon}

float ApplyMaskFilter(vec3 t_TexSample) {
    if (u_MaskFilter == 1.0)
        return t_TexSample.r;
    else if (u_MaskFilter == 2.0)
        return t_TexSample.g;
    else if (u_MaskFilter == 3.0)
        return t_TexSample.b;
    else
        return GXIntensity(t_TexSample.rgb);
}

float ApplyThreshold(float t_Value) {
    return t_Value >= u_Threshold ? 1.0 : 0.0;
}

void main() {
    vec3 t_TexSample = texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb;
    float t_MaskedValue = ApplyMaskFilter(t_TexSample);
    vec3 t_Color = t_MaskedValue >= u_Threshold ? t_TexSample : vec3(0.0);
    gl_FragColor = vec4(t_Color, 0.0);
}
`;
}

class BloomSimpleBlurProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;

    constructor(tapCount: number, radius: number, intensity: number) {
        super();
        const intensityPerTap = intensity / tapCount;
        this.frag = `
${BloomSimplePSCommon}

${generateBlurFunction(`Blur`, tapCount, glslGenerateFloat(radius), glslGenerateFloat(intensityPerTap))}

void main() {
    vec2 t_Aspect = BlurAspect(PP_SAMPLER_2D(u_Texture));
    float t_BlurredValue = saturate(Blur(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect).r);
    float t_Value = t_BlurredValue * u_Intensity;
    gl_FragColor = vec4(t_Value, t_Value, t_Value, 0.0);
}
`;
    }
}

export class BloomEffectSimple extends ImageEffectBase {
    public maskFilter: number = 0;
    public threshold: number = 0xCD;
    public intensity: number = 0.3;

    private thresholdProgram: GfxProgram;
    private blurProgram: GfxProgram;

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.One,
        blendDstFactor: GfxBlendFactor.One,
    }), fullscreenMegaState);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    private targetColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'BloomEffectSimple');

        connectToSceneImageEffect(sceneObjHolder, this);
        sceneObjHolder.create(SceneObj.ImageEffectSystemHolder);

        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.thresholdProgram = cache.createProgram(new BloomSimpleThresholdProgram());
        this.blurProgram = cache.createProgram(new BloomSimpleBlurProgram(8, 0.009, 1.0));
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        const maskFilter = this.maskFilter;
        const threshold = this.threshold / 0xFF;
        const intensity = (this.intensity * this.strength);

        offs += fillVec4(d, offs, maskFilter, threshold, intensity);
    }

    public override pushPasses(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, resultBlendTargetID: GfxrRenderTargetID): void {
        if (!this.isOn())
            return;

        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);
        const targetWidth = mainColorTargetDesc.width >> 2;
        const targetHeight = mainColorTargetDesc.height >> 2;
        this.targetColorDesc.setDimensions(targetWidth, targetHeight, 1);

        const downsampleColorTargetID = builder.createRenderTargetID(this.targetColorDesc, 'Bloom Simple Downsample');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        // Downsample and threshold.
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Simple Downsample');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        // Blur and combine.
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Simple Blur and Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, resultBlendTargetID);

            const downsampleResolveTextureID = builder.resolveRenderTarget(downsampleColorTargetID);
            pass.attachResolveTexture(downsampleResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blurProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsampleResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

class DepthOfFieldProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureColor;
uniform sampler2D u_TextureDepth;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_Intensity         (u_Misc[0].x)
#define u_BlurMaxDist       (u_Misc[0].y)
#define u_BlurMinDist       (u_Misc[0].z)
#define u_IsDepthReversed   (u_Misc[0].w)
`;

    public override vert = `
${DepthOfFieldProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${DepthOfFieldProgram.Common}
${ImageEffectShaderLib}
${GfxShaderLibrary.invlerp}

in vec2 v_TexCoord;

${generateBlurFunction(`Blur`, 4, `u_Intensity * 0.005`, glslGenerateFloat(1/4))}

void main() {
    float t_DepthSample = texture(SAMPLER_2D(u_TextureDepth), v_TexCoord).r;
    if (u_IsDepthReversed != 0.0)
        t_DepthSample = 1.0 - t_DepthSample;

    // Clamp to 8-bit
    t_DepthSample = saturate(t_DepthSample * (256.0/255.0));

    // Game processes indirect depth texture with -128 bias, meaning that 255 (1.0) maps to 127. Emulate this.
    float t_TexCoord128 = (t_DepthSample * 255.0) - 128.0;

    // We now have a value between 0 and 127. Index into our 128-sized texture. The + 0.5 is to emulate sampling at
    // the "pixel center" within our lerp.
    float t_TexCoord = saturate((t_TexCoord128 + 0.5) / 128.0);

    // Do the "indirect texture lookup"
    float t_BlurAmount = saturate(invlerp(u_BlurMinDist, u_BlurMaxDist, t_TexCoord));

    vec2 t_Aspect = BlurAspect(PP_SAMPLER_2D(u_TextureColor));
    vec3 t_BlurredSample = Blur(PP_SAMPLER_2D(u_TextureColor), v_TexCoord, t_Aspect);
    gl_FragColor = vec4(t_BlurredSample, t_BlurAmount * u_Intensity);
}
`;
}

export class DepthOfFieldBlur extends ImageEffectBase {
    public intensity: number = 1.0;
    public blurMaxDist: number | null = null;
    public blurMinDist: number | null = null;

    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    }), fullscreenMegaState);

    private targetColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    private blitProgram: GfxProgram;
    private depthOfFieldProgram: GfxProgram;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'DepthOfFieldBlur');

        connectToSceneImageEffect(sceneObjHolder, this);
        sceneObjHolder.create(SceneObj.ImageEffectSystemHolder);

        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        const nearestSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[1].gfxSampler = nearestSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
        this.depthOfFieldProgram = cache.createProgram(new DepthOfFieldProgram());
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        const intensity = this.intensity * this.strength;
        const blurMaxDist = fallback(this.blurMaxDist, 0xF8) / 0xFF;
        const blurMinDist = fallback(this.blurMinDist, 0xF2) / 0xFF;
        offs += fillVec4(d, offs, intensity, blurMaxDist, blurMinDist, IS_DEPTH_REVERSED ? 1.0 : 0.0);
    }

    public override pushPasses(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, resultBlendTargetID: GfxrRenderTargetID): void {
        if (!this.isOn())
            return;

        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);
        const targetWidth = mainColorTargetDesc.width >> 2;
        const targetHeight = mainColorTargetDesc.height >> 2;
        this.targetColorDesc.setDimensions(targetWidth, targetHeight, 1);

        const downsampleColorTargetID = builder.createRenderTargetID(this.targetColorDesc, 'Depth of Field Simple Downsample');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        // Downsample.
        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Downsample');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsampleColorTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.textureMapping[1].gfxTexture = null;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        // Combine.
        builder.pushPass((pass) => {
            pass.setDebugName('Depth of Field Combine');
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, resultBlendTargetID);

            const downsampleResolveTextureID = builder.resolveRenderTarget(downsampleColorTargetID);
            pass.attachResolveTexture(downsampleResolveTextureID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            pass.attachResolveTexture(mainDepthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.depthOfFieldProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsampleResolveTextureID);
                this.textureMapping[1].gfxTexture = scope.getResolveTextureForID(mainDepthResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

function getImageEffectDirector(sceneObjHolder: SceneObjHolder): ImageEffectDirector {
    return sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
}

abstract class ImageEffectState {
    public onChange(sceneObjHolder: SceneObjHolder): void {
    }

    public getEffect(sceneObjHolder: SceneObjHolder): ImageEffectBase | null {
        return null;
    }

    public update(sceneObjHolder: SceneObjHolder): void {
        const imageDirector = getImageEffectDirector(sceneObjHolder);
        const effect = this.getEffect(sceneObjHolder);

        if (imageDirector.currentEffect === effect) {
            // We are the current effect.
            if (effect === null)
                return;

            if (effect.active)
                return;

            effect.active = true;
            effect.notifyTurnOn(sceneObjHolder);
        } else {
            if (imageDirector.currentEffect !== null) {
                if (imageDirector.currentEffect.active) {
                    imageDirector.currentEffect.active = false;
                    imageDirector.currentEffect.notifyTurnOff(sceneObjHolder);
                }

                if (imageDirector.currentEffect.visible)
                    return;
            }

            if (effect !== null) {
                effect.active = true;
                effect.notifyTurnOn(sceneObjHolder);
            }

            imageDirector.setCurrentEffect(effect);
        }
    }
}

class ImageEffectStateNull extends ImageEffectState {
}

class ImageEffectStateBloomNormal extends ImageEffectState {
    private reset = true;

    private bloomIntensity = 0;
    private threshold = 0;
    private intensity1 = 0;
    private intensity2 = 0;

    private bloomIntensityTarget = 0;
    private thresholdTarget = 0;
    private intensity1Target = 0;
    private intensity2Target = 0;

    public override onChange(sceneObjHolder: SceneObjHolder): void {
        this.reset = true;
    }

    public override getEffect(sceneObjHolder: SceneObjHolder): BloomEffect | null {
        return sceneObjHolder.bloomEffect;
    }

    public override update(sceneObjHolder: SceneObjHolder): void {
        if (this.reset) {
            this.bloomIntensity = this.bloomIntensityTarget;
            this.threshold = this.thresholdTarget;
            this.intensity1 = this.intensity1Target;
            this.intensity2 = this.intensity2Target;
            this.reset = false;
        } else {
            this.bloomIntensity += Math.min(0.1 * (this.bloomIntensityTarget - this.bloomIntensity), 255.0);
            this.threshold      += Math.min(0.1 * (this.thresholdTarget - this.threshold), 255.0);
            this.intensity1     += Math.min(0.1 * (this.intensity1Target - this.intensity1), 255.0);
            this.intensity2     += Math.min(0.1 * (this.intensity2Target - this.intensity2), 255.0);
        }

        const bloomEffect = this.getEffect(sceneObjHolder)!;
        bloomEffect.bloomIntensity = this.bloomIntensity;
        bloomEffect.threshold = this.threshold;
        bloomEffect.intensity1 = this.intensity1;
        bloomEffect.intensity2 = this.intensity2;

        super.update(sceneObjHolder);
    }

    public setBloomIntensity(v: number): void {
        this.bloomIntensityTarget = v;
    }

    public setThreshold(v: number): void {
        this.thresholdTarget = v;
    }

    public setIntensity1(v: number): void {
        this.intensity1Target = v;
    }

    public setIntensity2(v: number): void {
        this.intensity2Target = v;
    }

    public setIntensity1Default(): void {
        this.intensity1Target = 42;
    }

    public setIntensity2Default(): void {
        this.intensity2Target = 21;
    }
}

class ImageEffectStateBloomSimple extends ImageEffectState {
    public override getEffect(sceneObjHolder: SceneObjHolder): BloomEffectSimple | null {
        return sceneObjHolder.bloomEffectSimple;
    }

    public setMaskFilter(sceneObjHolder: SceneObjHolder, v: number): void {
        this.getEffect(sceneObjHolder)!.maskFilter = v;
    }

    public setThreshold(sceneObjHolder: SceneObjHolder, v: number): void {
        this.getEffect(sceneObjHolder)!.threshold = v;
    }

    public setIntensity(sceneObjHolder: SceneObjHolder, v: number): void {
        this.getEffect(sceneObjHolder)!.intensity = v;
    }
}

class ImageEffectStateDepthOfField extends ImageEffectState {
    public override getEffect(sceneObjHolder: SceneObjHolder): DepthOfFieldBlur | null {
        return sceneObjHolder.depthOfFieldBlur;
    }

    public setIntensity(sceneObjHolder: SceneObjHolder, v: number): void {
        this.getEffect(sceneObjHolder)!.intensity = v;
    }

    public setBlurMaxDist(sceneObjHolder: SceneObjHolder, v: number | null): void {
        this.getEffect(sceneObjHolder)!.blurMaxDist = v;
    }

    public setBlurMinDist(sceneObjHolder: SceneObjHolder, v: number | null): void {
        this.getEffect(sceneObjHolder)!.blurMinDist = v;
    }
}

function connectToSceneImageEffectMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    connectToScene(sceneObjHolder, nameObj, MovementType.ImageEffect, -1, -1, -1);
}

class ImageEffectDirector extends NameObj {
    public currentEffect: ImageEffectBase | null = null;
    private auto = true;
    private currentState: ImageEffectState;
    private stateBloomNormal = new ImageEffectStateBloomNormal();
    private stateBloomSimple = new ImageEffectStateBloomSimple();
    private stateDepthOfField = new ImageEffectStateDepthOfField();
    private stateNull = new ImageEffectStateNull();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ImageEffectDirector');

        this.currentState = this.stateNull;

        connectToSceneImageEffectMovement(sceneObjHolder, this);
    }

    public isNormalBloomOn(sceneObjHolder: SceneObjHolder): boolean {
        return sceneObjHolder.bloomEffect !== null && sceneObjHolder.bloomEffect.isOn();
    }

    public turnOnNormal(sceneObjHolder: SceneObjHolder): void {
        this.auto = false;
        this.setState(sceneObjHolder, this.stateBloomNormal);
    }

    public setAuto(sceneObjHolder: SceneObjHolder): void {
        this.auto = true;
    }

    private setState(sceneObjHolder: SceneObjHolder, state: ImageEffectState): void {
        if (state === this.currentState)
            return;
        this.currentState = state;
        this.currentState.onChange(sceneObjHolder);
    }

    private setBloomNormalParams(area: BloomArea) {
        this.stateBloomNormal.setBloomIntensity(area.bloomIntensity);
        this.stateBloomNormal.setThreshold(area.threshold);

        if (area.intensity1 >= 0)
            this.stateBloomNormal.setIntensity1(area.intensity1);
        else
            this.stateBloomNormal.setIntensity1Default();

        if (area.intensity2 >= 0)
            this.stateBloomNormal.setIntensity2(area.intensity2);
        else
            this.stateBloomNormal.setIntensity2Default();
    }

    public setNormalBloomIntensity(v: number) {
        this.stateBloomNormal.setBloomIntensity(v);
    }

    public setNormalBloomThreshold(v: number) {
        this.stateBloomNormal.setThreshold(v);
    }

    public setNormalBloomBlurIntensity1(v: number) {
        this.stateBloomNormal.setIntensity1(v);
    }

    public setNormalBloomBlurIntensity2(v: number) {
        this.stateBloomNormal.setIntensity2(v);
    }

    private setBloomSimpleParams(sceneObjHolder: SceneObjHolder, area: SimpleBloomArea): void {
        this.stateBloomSimple.setMaskFilter(sceneObjHolder, area.maskFilter);
        this.stateBloomSimple.setThreshold(sceneObjHolder, area.threshold);
        this.stateBloomSimple.setIntensity(sceneObjHolder, area.intensity / 0xFF);
    }

    private setDepthOfFieldParams(sceneObjHolder: SceneObjHolder, area: DepthOfFieldArea): void {
        // TODO(jstpierre): mPlayerSyncIntensity
        this.stateDepthOfField.setIntensity(sceneObjHolder, area.intensity);
        this.stateDepthOfField.setBlurMaxDist(sceneObjHolder, area.blurMaxDist);
        this.stateDepthOfField.setBlurMinDist(sceneObjHolder, area.blurMinDist);
    }

    public setCurrentEffect(effect: ImageEffectBase | null): void {
        if (this.currentEffect === effect)
            return;
        this.currentEffect = effect;
    }

    private updateAuto(sceneObjHolder: SceneObjHolder): void {
        // getPlayerPos
        getMatrixTranslation(scratchVec3, sceneObjHolder.viewerInput.camera.worldMatrix);

        const areaObj = getAreaObj<ImageEffectArea>(sceneObjHolder, 'ImageEffectArea', scratchVec3);
        if (areaObj === null) {
            this.setState(sceneObjHolder, this.stateNull);
        } else if (areaObj.effectType === ImageEffectType.BloomNormal) {
            this.setBloomNormalParams(areaObj as BloomArea);
            this.setState(sceneObjHolder, this.stateBloomNormal);
        } else if (areaObj.effectType === ImageEffectType.BloomSimple) {
            this.setBloomSimpleParams(sceneObjHolder, areaObj as SimpleBloomArea);
            this.setState(sceneObjHolder, this.stateBloomSimple);
        } else if (areaObj.effectType === ImageEffectType.DepthOfField) {
            this.setDepthOfFieldParams(sceneObjHolder, areaObj as DepthOfFieldArea);
            this.setState(sceneObjHolder, this.stateDepthOfField);
        }
    }

    private updateManual(sceneObjHolder: SceneObjHolder): void {
        // ...
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        super.movement(sceneObjHolder);

        if (this.auto)
            this.updateAuto(sceneObjHolder);
        else
            this.updateManual(sceneObjHolder);

        this.currentState.update(sceneObjHolder);
    }
}

export class ImageEffectSystemHolder extends NameObj {
    public imageEffectDirector: ImageEffectDirector;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ImageEffectSystemHolder');

        this.imageEffectDirector = new ImageEffectDirector(sceneObjHolder);
    }
}

const enum ImageEffectType {
    BloomNormal,
    BloomSimple,
    ScreenBlur,
    DepthOfField,
}

class ImageEffectArea extends AreaObj {
    public priority: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, public effectType: ImageEffectType, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, infoIter, formType);
        this.priority = fallback(getJMapInfoArg7(infoIter), -1);
    }

    public override getManagerName(): string {
        return "ImageEffectArea";
    }
}

export class BloomArea extends ImageEffectArea {
    public bloomIntensity: number;
    public threshold: number;
    public intensity1: number;
    public intensity2: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, ImageEffectType.BloomNormal, infoIter, formType);

        createNormalBloom(sceneObjHolder);

        this.bloomIntensity = fallback(getJMapInfoArg0(infoIter), 0x80);
        this.threshold = fallback(getJMapInfoArg1(infoIter), 0xFF);
        this.intensity1 = fallback(getJMapInfoArg2(infoIter), -1);
        this.intensity2 = fallback(getJMapInfoArg3(infoIter), -1);
    }
}

export class SimpleBloomArea extends ImageEffectArea {
    public maskFilter: number;
    public intensity: number;
    public threshold: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, ImageEffectType.BloomSimple, infoIter, formType);

        createSimpleBloom(sceneObjHolder);

        this.maskFilter = fallback(getJMapInfoArg0(infoIter), 0);
        this.threshold = fallback(getJMapInfoArg1(infoIter), 0x80);
        this.intensity = fallback(getJMapInfoArg2(infoIter), 0x4C);
    }
}

export class DepthOfFieldArea extends ImageEffectArea {
    public intensity: number;
    public blurMaxDist: number | null;
    public blurMinDist: number | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, ImageEffectType.DepthOfField, infoIter, formType);

        createDepthOfFieldBlur(sceneObjHolder);

        this.intensity = fallback(getJMapInfoArg1(infoIter), 0xFF) / 0xFF;
        this.blurMaxDist = getJMapInfoArg2(infoIter);
        this.blurMinDist = getJMapInfoArg3(infoIter);
    }
}

export class ImageEffectAreaMgr extends AreaObjMgr<ImageEffectArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "ImageEffectArea");
    }

    public override initAfterPlacement(): void {
        this.sort();
    }

    private sort(): void {
        // Sort by highest priority.
        this.areaObj.sort((a, b) => {
            return a.priority - b.priority;
        });
    }
}

export function createBloomCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CenterOriginCube);
}

export function createBloomSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

export function createBloomCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.BaseOriginCylinder);
}

export function createSimpleBloomCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new SimpleBloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CenterOriginCube);
}

export function createDepthOfFieldCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new DepthOfFieldArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CenterOriginCube);
}

export function createNormalBloom(sceneObjHolder: SceneObjHolder): void {
    sceneObjHolder.create(SceneObj.BloomEffect);
}

function createSimpleBloom(sceneObjHolder: SceneObjHolder): void {
    sceneObjHolder.create(SceneObj.BloomEffectSimple);
}

function createDepthOfFieldBlur(sceneObjHolder: SceneObjHolder): void {
    sceneObjHolder.create(SceneObj.DepthOfFieldBlur);
}
