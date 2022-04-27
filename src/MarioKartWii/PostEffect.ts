
// EGG PostEffects

import { mat4, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Camera } from "../Camera";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA8, colorScale, OpaqueBlack } from "../Color";
import { copyMegaState, fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/GfxShaderLibrary";
import { fillColor, fillMatrix4x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxDevice, GfxFormat, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GXShaderLibrary } from "../gx/gx_material";
import { DeviceProgram } from "../Program";
import { generateBlurFunction } from "../SuperMarioGalaxy/ImageEffect";
import { TextureMapping } from "../TextureHolder";
import { assert, assertExists, nArray, readString } from "../util";

//#region Bloom

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
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
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

    public override vert = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;
}

class EggBloomThresholdProgram extends EggBloomBaseProgram {
    public override frag: string = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${GXShaderLibrary.GXIntensity}
${GXShaderLibrary.TevOverflow}

in vec2 v_TexCoord;

void main() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor.rgb = c.rgb * (2.0 * (saturate(vec3(GXIntensity(c.rgb)) - u_ThresholdColor.rgb)));
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
    vec2 t_Size = vec2(textureSize(SAMPLER_2D(u_Texture), 0));
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
    c += saturate(texture(SAMPLER_2D(${passTextureName[i]}), v_TexCoord).rgb) * u_CompositeColor.rgb * u_CompositeColorScale[${i}];`;
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

export class EggDrawPathBloom {
    private thresholdColor = colorNewCopy(OpaqueBlack);
    private blitProgram: GfxProgram;
    private thresholdProgram: GfxProgram;
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
        const thresholdColorScale = ((pblm.thresholdAmount * 219.0 + 16.0) | 0) / 255.0;
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

        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;
        this.textureMapping[1].gfxSampler = linearSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
        this.thresholdProgram = cache.createProgram(new EggBloomThresholdProgram());
        this.blur0Program = cache.createProgram(blur0Program);
        this.blur1Program = cache.createProgram(blur1Program);
        this.compositeProgram = cache.createProgram(combineProgram);

        const blendModeTable = [
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.OneMinusDst, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.Dst, blendDstFactor: GfxBlendFactor.One },
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

    public pushPassesBloom(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        this.target2ColorDesc.setDimensions(mainColorTargetDesc.width >>> 1, mainColorTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);
        this.target8ColorDesc.setDimensions(this.target4ColorDesc.width >>> 1, this.target4ColorDesc.height >>> 1, 1);

        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Bloom 1/2 Buffer');
        const downsample4ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Bloom 1/4 Buffer');
        const downsample8ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Bloom 1/8 Buffer');

        const cache = renderInstManager.gfxRenderCache;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        this.textureMapping[0].gfxTexture = null;
        this.textureMapping[1].gfxTexture = null;

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Threshold & Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.attachResolveTexture(mainResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
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
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 0');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur0Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
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
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 1');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
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
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
    }
}

//#endregion

//#region DOF

interface BDOF {
    flags: number;
    blurAlpha: readonly [number, number];
    drawMode: number;
    blurDrawAmount: number;
    depthCurveType: number;
    focusCenter: number;
    focusRange: number;
    blurRadius: number;
    indTexTransSScroll: number;
    indTexTransTScroll: number;
    indTexIndScaleS: number;
    indTexIndScaleT: number;
    indTexScaleS: number;
    indTexScaleT: number;
}

export function parseBDOF(buffer: ArrayBufferSlice): BDOF {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PDOF');
    const fileSize = view.getUint32(0x04);
    const version = view.getUint8(0x08);
    assert(version === 0);

    const flags = view.getUint16(0x10);
    const blurAlpha0 = view.getUint8(0x12);
    const blurAlpha1 = view.getUint8(0x13);
    const blurAlpha = [blurAlpha0, blurAlpha1] as const;
    const drawMode = view.getUint8(0x14);
    const blurDrawAmount = view.getUint8(0x15);
    const depthCurveType = view.getUint8(0x16);
    const focusCenter = view.getFloat32(0x18);
    const focusRange = view.getFloat32(0x1C);
    const blurRadius = view.getFloat32(0x24);
    const indTexTransSScroll = view.getFloat32(0x28);
    const indTexTransTScroll = view.getFloat32(0x2C);
    const indTexIndScaleS = view.getFloat32(0x30);
    const indTexIndScaleT = view.getFloat32(0x34);
    const indTexScaleS = view.getFloat32(0x38);
    const indTexScaleT = view.getFloat32(0x3C);

    return {
        flags, blurAlpha, drawMode, blurDrawAmount, depthCurveType, focusCenter, focusRange, blurRadius,
        indTexTransSScroll, indTexTransTScroll, indTexIndScaleS, indTexIndScaleT, indTexScaleS, indTexScaleT,
     };
}

class EggDOFBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    Mat4x2 u_IndTexMat;
    vec4 u_Misc0;
};

#define u_FocusZClipSpace (u_Misc0.x)
#define u_IndTexIndScale  (u_Misc0.yz)
`;

    public override vert = `
${EggDOFBaseProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;
}

class EggDOFMode2BlurProgram extends EggDOFBaseProgram {
    constructor(tapCount: number, radius: number)  {
        super();

        const intensityPerTap = 1.0 / tapCount;

        this.frag = `
${EggDOFBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${generateBlurFunction(`BlurPass0`, tapCount, glslGenerateFloat(radius), glslGenerateFloat(intensityPerTap))}

in vec2 v_TexCoord;

void main() {
    vec2 t_Size = vec2(textureSize(SAMPLER_2D(u_Texture), 0));
    vec2 t_Aspect = vec2(1.0) / t_Size;

    gl_FragColor.rgb = saturate(BlurPass0(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect));
    gl_FragColor.a = 1.0;
}
`;
    }
}

class EggDOFDrawMode2CombineProgram extends EggDOFBaseProgram {
    constructor(useIndWarpTex: boolean) {
        super();
        this.setDefineBool('USE_IND_WARP_TEX', useIndWarpTex);

        this.vert = `
${EggDOFBaseProgram.BindingsDefinition}

out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(u_FocusZClipSpace, 1);
}
`;

        this.frag = `
${EggDOFBaseProgram.BindingsDefinition}
    
in vec2 v_TexCoord;

void main() {
    vec2 t_TexCoord = v_TexCoord;

#ifdef USE_IND_WARP_TEX
    // Handcoded indtex pipeline...
    vec2 t_WarpTexCoord = Mul(u_IndTexMat, vec4(v_TexCoord, 0.0, 1.0));
    vec2 t_IndTexOffs = ((255.0 * texture(SAMPLER_2D(u_Texture2), t_WarpTexCoord).ba) - 128.0) * u_IndTexIndScale;
    t_TexCoord += t_IndTexOffs;
#endif

    gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture), t_TexCoord).rgb;
    gl_FragColor.a = 1.0;
}
`;
    }
}
    
const enum DOFDrawMode {
    DrawMode0,
    DrawMode1,
    DrawMode2,
}

const scratchVec3 = vec3.create();
export class EggDrawPathDOF {
    private drawMode: DOFDrawMode;
    private focusCenter: number;
    private focusRange: number;
    private indTexMat = mat4.create();
    private indTexIndScale = vec2.create();
    private indTexScrollSpeed = vec2.create();
    private blitProgram: GfxProgram;
    private drawMode2BlurProgram: GfxProgram;
    private drawMode2CombineProgram: GfxProgram;
    private textureMapping = nArray(2, () => new TextureMapping());

    constructor(device: GfxDevice, cache: GfxRenderCache, private pdof: BDOF) {
        this.drawMode = pdof.drawMode;
        this.focusCenter = pdof.focusCenter;
        this.focusRange = pdof.focusRange;

        this.indTexMat[0] = pdof.indTexScaleS;
        this.indTexMat[5] = pdof.indTexScaleT * -1; // Y flip for good measure...
        vec2.set(this.indTexScrollSpeed, pdof.indTexTransSScroll, pdof.indTexTransTScroll);
        vec2.set(this.indTexIndScale, pdof.indTexIndScaleS, pdof.indTexIndScaleT);

        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());

        const blurTapCountTable = [4, 2];
        const blurTapCount = assertExists(blurTapCountTable[pdof.blurDrawAmount]);
        const blurProgram = new EggDOFMode2BlurProgram(blurTapCount, pdof.blurRadius);
        this.drawMode2BlurProgram = cache.createProgram(blurProgram);

        const useIndWarpTex = !!(pdof.flags & 0x02);
        this.drawMode2CombineProgram = cache.createProgram(new EggDOFDrawMode2CombineProgram(useIndWarpTex));
    }

    public updateScroll(t: number): void {
        this.indTexMat[12] = this.indTexScrollSpeed[0] * t;
        this.indTexMat[13] = this.indTexScrollSpeed[1] * t * -1;
    }

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    private pushPassesDOF_DrawMode2(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, camera: Camera, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        this.target2ColorDesc.setDimensions(mainColorTargetDesc.width >>> 1, mainColorTargetDesc.height >>> 1, 1);
        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, `DOF 1/2 Buffer`);
        const blurColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, `DOF 1/2 Blur Buffer`);

        const cache = renderInstManager.gfxRenderCache;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);

        // Allocate parameter buffer.
        {
            let offs = renderInst.allocateUniformBuffer(0, 12);
            const d = renderInst.mapUniformBufferF32(0);

            // For dumb reasons, noclip scales everything by 0.1, blergh
            // TODO(jstpierre): Fix this
            const focusZ = (this.focusCenter + this.focusRange * 0.5) * 0.1;

            // Compute the clip-space target Z
            vec3.set(scratchVec3, 0, 0, -focusZ);
            vec3.transformMat4(scratchVec3, scratchVec3, camera.projectionMatrix);
            const focusZClipSpace = scratchVec3[2];

            offs += fillMatrix4x2(d, offs, this.indTexMat);

            // Game hardcodes a shift of -6, and also scales relative to the screen size.
            // TODO(jstpierre): Figure out where this extra factor of 2 comes from. I can't find it...
            const indTexShift = 1/64 * (1/2);
            const indTexIndScaleS = (this.indTexIndScale[0] / 832.0) * indTexShift;
            const indTexIndScaleT = (this.indTexIndScale[1] / 456.0) * indTexShift * -1;
            offs += fillVec4(d, offs, focusZClipSpace, indTexIndScaleS, indTexIndScaleT);
        }

        renderInst.drawPrimitives(3);

        this.textureMapping[0].gfxTexture = null;

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.attachResolveTexture(mainResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, blurColorTargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            const resolveTextureID = builder.resolveRenderTarget(downsample2ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.drawMode2BlurProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const resolveTextureID = builder.resolveRenderTarget(blurColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.drawMode2CombineProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                renderInst.setMegaStateFlags({ depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) });
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
    }

    public pushPassesDOF(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, camera: Camera, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        if (this.drawMode === DOFDrawMode.DrawMode2)
            this.pushPassesDOF_DrawMode2(builder, renderInstManager, camera, mainColorTargetID, mainDepthTargetID, mainResolveTextureID);
    }

    public getIndTextureMapping(): TextureMapping {
        return this.textureMapping[1];
    }
}

//#endregion
