
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxRenderPassDescriptor, GfxLoadDisposition, GfxDevice, GfxRenderPass, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBlendMode, GfxBlendFactor, GfxPrimitiveTopology, GfxRenderPipeline, GfxMegaStateDescriptor, GfxTexture } from "../gfx/platform/GfxPlatform";
import { TransparentBlack } from "../Color";
import { copyRenderPassDescriptor, DepthStencilAttachment, DEFAULT_NUM_SAMPLES, makeEmptyRenderPassDescriptor, ColorAttachment, ColorTexture, PostFXRenderTarget, BasicRenderTarget, noClearRenderPassDescriptor, NormalizedViewportCoords, setViewportOnRenderPass, IdentityViewportCoords, setScissorOnRenderPass } from "../gfx/helpers/RenderTargetHelpers";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { MathConstants } from "../MathHelpers";

// Should I try to do this with GX? lol.
class BloomPassBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;

layout(std140) uniform ub_Params {
    vec4 u_Misc0;
};
#define u_Threshold      (u_Misc0.x)
#define u_Intensity1     (u_Misc0.y)
#define u_Intensity2     (u_Misc0.z)
#define u_BloomIntensity (u_Misc0.w)
`;

    public vert: string = `
${BloomPassBaseProgram.BindingsDefinition}

out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(-1, 1);
    v_TexCoord = p;
}
`;
}

class BloomPassFullscreenCopyProgram extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

void main() {
    gl_FragColor = texture(u_Texture, v_TexCoord);
}
`;
}

class BloomPassThresholdPipeline extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

float Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return dot(t_Color.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 c = texture(u_Texture, v_TexCoord);
    gl_FragColor = (Monochrome(c.rgb) > u_Threshold) ? c : vec4(0.0);
}
`;
}

abstract class BloomPassBlurProgram extends BloomPassBaseProgram {
    constructor(radiusL: number[], ofsL: number[], count: number, intensityVar: string) {
        super();

        assert(radiusL.length === ofsL.length);

        this.frag = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

float TevOverflow(float a) { return float(int(a * 255.0) & 255) / 255.0; }
vec3 TevOverflow(vec3 a) { return vec3(TevOverflow(a.r), TevOverflow(a.g), TevOverflow(a.b)); }
void main() {
    vec3 c;
    vec3 f = vec3(0.0);
`;

        const aspect = 16/9;
        const invAspect = 1/aspect;
        for (let i = 0; i < radiusL.length; i++) {
            const radius = radiusL[i], ofs = ofsL[i];
            this.frag += `
    // Pass ${i + 1}
    c = vec3(0.0);`;
            for (let j = 0; j < count; j++) {
                const theta = ofs + (MathConstants.TAU * (j / count));
                const x = invAspect * radius * Math.cos(theta), y = radius * Math.sin(theta);
                this.frag += `
    c += (texture(u_Texture, v_TexCoord + vec2(${x.toFixed(5)}, -1.0 * ${y.toFixed(5)})).rgb * ${intensityVar});`;
            }
            this.frag += `
    f += TevOverflow(c);`;
        }
    }
}

class BloomPassBlur1Program extends BloomPassBlurProgram {
    constructor() {
        super([0.01, 0.02], [0.00, 0.52], 6, 'u_Intensity1');
        this.frag += `
    f = clamp(f, 0.0, 1.0);
    gl_FragColor = vec4(f.rgb, 1.0);
}
`;
    }
}

class BloomPassBlur2Program extends BloomPassBlurProgram {
    constructor() {
        super([0.04, 0.07, 0.09], [0.00, 0.00, 0.00], 12, 'u_Intensity2');
        this.frag += `
    f = clamp(f, 0.0, 1.0);
    // Combine pass.
    f += texture(u_Texture, v_TexCoord).rgb;
    f *= u_BloomIntensity;
    gl_FragColor = vec4(f, 1.0);
}
`;
    }
}

export class WeirdFancyRenderTarget {
    public colorAttachment = new ColorAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(public depthStencilAttachment: DepthStencilAttachment) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }

    public createRenderPass(device: GfxDevice, viewport: NormalizedViewportCoords, renderPassDescriptor: GfxRenderPassDescriptor, colorResolveTo: GfxTexture | null = null): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = colorResolveTo;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxAttachment;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }
}

const bloomClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    colorResolveTo: null,
    depthStencilAttachment: null,
    colorClearColor: TransparentBlack,
    depthStencilResolveTo: null,
    colorLoadDisposition: GfxLoadDisposition.CLEAR,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};

export class BloomPostFXParameters {
    public threshold: number = 0/256;
    public intensity1: number = 50/256;
    public intensity2: number = 25/256;
    public bloomIntensity: number = 25/256;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

function makeFullscreenPipeline(device: GfxDevice, cache: GfxRenderCache, program: DeviceProgram, megaStateDescriptor: GfxMegaStateDescriptor = fullscreenMegaState, sampleCount: number = DEFAULT_NUM_SAMPLES): GfxRenderPipeline {
    const gfxProgram = cache.createProgram(device, program);
    return cache.createRenderPipeline(device, {
        bindingLayouts,
        inputLayout: null,
        megaStateDescriptor,
        topology: GfxPrimitiveTopology.TRIANGLES,
        program: gfxProgram,
        sampleCount,
    });
}

export class BloomPostFXRenderer {
    private thresholdPipeline: GfxRenderPipeline;
    private blur1Pipeline: GfxRenderPipeline;
    private blur2Pipeline: GfxRenderPipeline;
    private combinePipeline: GfxRenderPipeline;

    private bloomSampler: GfxSampler;
    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());
    private bloomObjectsTexture = new ColorTexture();
    private bloomObjectsTarget: WeirdFancyRenderTarget;
    private scratch1ColorTarget = new PostFXRenderTarget();
    private scratch1ColorTexture = new ColorTexture();
    private scratch2ColorTarget = new PostFXRenderTarget();
    private scratch2ColorTexture = new ColorTexture();

    constructor(device: GfxDevice, cache: GfxRenderCache, mainRenderTarget: BasicRenderTarget) {
        this.bloomSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = this.bloomSampler;

        this.bloomObjectsTarget = new WeirdFancyRenderTarget(mainRenderTarget.depthStencilAttachment);

        this.thresholdPipeline = makeFullscreenPipeline(device, cache, new BloomPassThresholdPipeline());
        this.blur1Pipeline = makeFullscreenPipeline(device, cache, new BloomPassBlur1Program());
        this.blur2Pipeline = makeFullscreenPipeline(device, cache, new BloomPassBlur2Program());
        this.combinePipeline = makeFullscreenPipeline(device, cache, new BloomPassFullscreenCopyProgram(), makeMegaState(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        }), fullscreenMegaState));
    }

    public allocateParameterBuffer(renderInstManager: GfxRenderInstManager, bloomParameters: BloomPostFXParameters): number {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        const parameterBufferOffs = uniformBuffer.allocateChunk(4);
        const d = uniformBuffer.mapBufferF32(parameterBufferOffs, 4);
        
        let offs = parameterBufferOffs;
        offs += fillVec4(d, offs, bloomParameters.threshold, bloomParameters.intensity1, bloomParameters.intensity2, bloomParameters.bloomIntensity);

        return parameterBufferOffs;
    }

    public pipelinesReady(device: GfxDevice): boolean {
        if (!device.queryPipelineReady(this.thresholdPipeline))
            return false;
        if (!device.queryPipelineReady(this.blur1Pipeline))
            return false;
        if (!device.queryPipelineReady(this.blur2Pipeline))
            return false;
        if (!device.queryPipelineReady(this.combinePipeline))
            return false;
        return true;
    }

    public renderBeginObjects(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        assert(this.pipelinesReady(device));

        this.bloomObjectsTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.bloomObjectsTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        return this.bloomObjectsTarget.createRenderPass(device, viewerInput.viewport, bloomClearRenderPassDescriptor, this.bloomObjectsTexture.gfxTexture);
    }

    public renderEndObjects(device: GfxDevice, objectsPassRenderer: GfxRenderPass, renderInstManager: GfxRenderInstManager, mainRenderTarget: BasicRenderTarget, viewerInput: ViewerRenderInput, template: GfxRenderInst, parameterBufferOffs: number): GfxRenderPass {
        device.submitPass(objectsPassRenderer);

        // Downsample.
        const targetWidth = viewerInput.backbufferWidth >> 2;
        const targetHeight = viewerInput.backbufferHeight >> 2;

        const downsampleColorTarget = this.scratch1ColorTarget;
        const downsampleColorTexture = this.scratch1ColorTexture;
        downsampleColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        downsampleColorTexture.setParameters(device, targetWidth, targetHeight);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setFromTemplate(template);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setUniformBufferOffset(0, parameterBufferOffs, 4);
        renderInst.drawPrimitives(3);

        // Downsample and threshold.
        const downsamplePassRenderer = downsampleColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, downsampleColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.thresholdPipeline);
        this.textureMapping[0].gfxTexture = this.bloomObjectsTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, downsamplePassRenderer);
        device.submitPass(downsamplePassRenderer);

        // Blur L1.
        const blur1ColorTarget = this.scratch2ColorTarget;
        const blur1ColorTexture = this.scratch2ColorTexture;
        blur1ColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        blur1ColorTexture.setParameters(device, targetWidth, targetHeight);
        const blur1PassRenderer = blur1ColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, blur1ColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.blur1Pipeline);
        this.textureMapping[0].gfxTexture = downsampleColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, blur1PassRenderer);
        device.submitPass(blur1PassRenderer);

        // TODO(jstpierre): Downsample blur / bokeh as well.

        // Blur L2.
        // We can ditch the second render target now, so just reuse it.
        const blur2ColorTarget = this.scratch1ColorTarget;
        const blur2ColorTexture = this.scratch1ColorTexture;
        const blur2PassRenderer = blur2ColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, blur2ColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.blur2Pipeline);
        this.textureMapping[0].gfxTexture = blur1ColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, blur2PassRenderer);
        device.submitPass(blur2PassRenderer);

        // Combine.
        const combinePassRenderer = mainRenderTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor);
        setScissorOnRenderPass(combinePassRenderer, viewerInput.viewport, mainRenderTarget.colorAttachment);
        renderInst.setGfxRenderPipeline(this.combinePipeline);
        this.textureMapping[0].gfxTexture = blur2ColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, combinePassRenderer);

        renderInstManager.returnRenderInst(renderInst);

        return combinePassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.bloomObjectsTexture.destroy(device);
        this.bloomObjectsTarget.destroy(device);
        this.scratch1ColorTarget.destroy(device);
        this.scratch1ColorTexture.destroy(device);
        this.scratch2ColorTarget.destroy(device);
        this.scratch2ColorTexture.destroy(device);
    }
}
