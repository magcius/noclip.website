
import { DeviceProgram } from "../../Program";
import { TextureMapping } from "../../TextureHolder";
import { nArray } from "../../util";
import { GfxRenderPassDescriptor, GfxLoadDisposition, GfxDevice, GfxRenderPass, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBufferUsage, GfxBufferFrequencyHint, GfxBlendMode, GfxBlendFactor, GfxHostAccessPass, GfxProgram } from "../../gfx/platform/GfxPlatform";
import { TransparentBlack } from "../../Color";
import { copyRenderPassDescriptor, DepthStencilAttachment, DEFAULT_NUM_SAMPLES, makeEmptyRenderPassDescriptor, ColorAttachment, ColorTexture, PostFXRenderTarget, BasicRenderTarget, noClearRenderPassDescriptor } from "../../gfx/helpers/RenderTargetHelpers";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers";
import { ViewerRenderInput, Viewer } from "../../viewer";
import { GfxRenderInst, GfxRenderInstManager } from "../../gfx/render/GfxRenderer2";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache";
import { fullscreenMegaState } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers";

// Should I try to do this with GX? lol.
class BloomPassBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;

layout(std140) uniform ub_Params {
    vec4 u_Misc0;
};
#define u_BlurStrength         (u_Misc0.x)
#define u_BokehStrength        (u_Misc0.y)
#define u_BokehCombineStrength (u_Misc0.z)
`;

    public static programReflection = DeviceProgram.parseReflectionDefinitions(BloomPassBaseProgram.BindingsDefinition); 

    public vert: string = `
${BloomPassBaseProgram.BindingsDefinition}

out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
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

class BloomPassBlurProgram extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    // Nintendo does this in two separate draws. We combine into one here...
    vec3 c = vec3(0.0);
    // Pass 1.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00562, -1.0 *  0.00000)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 * -0.00866)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 * -0.00866)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00562, -1.0 *  0.00000)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 *  0.00866)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 *  0.00866)).rgb * u_BlurStrength);
    // Pass 2.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00977, -1.0 * -0.00993)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00004, -1.0 * -0.02000)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00972, -1.0 * -0.01006)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00976, -1.0 *  0.00993)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00004, -1.0 *  0.02000)).rgb * u_BlurStrength);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00972, -1.0 *  0.01006)).rgb * u_BlurStrength);
    gl_FragColor = vec4(c.rgb, 1.0);
}
`;
}

class BloomPassBokehProgram extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    vec3 f = vec3(0.0);
    vec3 c;

    // TODO(jstpierre): Double-check these passes. It seems weighted towards the top left. IS IT THE BLUR???

    // Pass 1.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02250, -1.0 *  0.00000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01949, -1.0 * -0.02000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 * -0.03464)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.04000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 * -0.03464)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01948, -1.0 * -0.02001)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02250, -1.0 *  0.00000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01949, -1.0 *  0.02000)).rgb) * u_BokehStrength;
    f += TevOverflow(c);
    // Pass 2.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 *  0.03464)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00000, -1.0 *  0.04000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 *  0.03464)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01948, -1.0 *  0.02001)).rgb) * u_BokehStrength;
    f += TevOverflow(c);
    // Pass 3.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03937, -1.0 *  0.00000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03410, -1.0 * -0.03499)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01970, -1.0 * -0.06061)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.07000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01968, -1.0 * -0.06063)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03409, -1.0 * -0.03502)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03937, -1.0 *  0.00000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03410, -1.0 *  0.03499)).rgb) * u_BokehStrength;
    f += TevOverflow(c);
    // Pass 4.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01970, -1.0 *  0.06061)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.07000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01968, -1.0 *  0.06063)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03409, -1.0 *  0.03502)).rgb) * u_BokehStrength;
    f += TevOverflow(c);
    // Pass 5.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.05063, -1.0 *  0.00000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04385, -1.0 * -0.04499)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02532, -1.0 * -0.07793)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.09000)).rgb) * u_BokehStrength;
    f += TevOverflow(c);
    // Pass 6.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02532, -1.0 *  0.07793)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.09000)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02531, -1.0 *  0.07795)).rgb) * u_BokehStrength;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04384, -1.0 *  0.04502)).rgb) * u_BokehStrength;
    f += TevOverflow(c);

    f = clamp(f, 0.0, 1.0);

    // Combine pass.
    vec3 g;
    g = (texture(u_Texture, v_TexCoord).rgb * u_BokehCombineStrength);
    g += f * u_BokehCombineStrength;

    gl_FragColor = vec4(g, 1.0);
}
`;
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

    public createRenderPass(device: GfxDevice, renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxColorAttachment;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxDepthStencilAttachment;
        return device.createRenderPass(this.renderPassDescriptor);
    }
}

const bloomClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    depthStencilAttachment: null,
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.CLEAR,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};

export class BloomPostFXParameters {
    public blurStrength: number = 50/256;
    public bokehStrength: number = 25/256;
    public bokehCombineStrength: number = 25/256;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

export class BloomPostFXRenderer {
    private fullscreenGfxProgram: GfxProgram;
    private blurGfxProgram: GfxProgram;
    private bokehGfxProgram: GfxProgram;

    private bloomSampler: GfxSampler;
    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());
    private bloomObjectsTexture = new ColorTexture();
    private bloomObjectsTarget: WeirdFancyRenderTarget;
    private scratch1ColorTarget = new PostFXRenderTarget();
    private scratch1ColorTexture = new ColorTexture();
    private scratch2ColorTarget = new PostFXRenderTarget();
    private scratch2ColorTexture = new ColorTexture();

    constructor(device: GfxDevice, cache: GfxRenderCache, mainRenderTarget: BasicRenderTarget) {
        this.bloomSampler = device.createSampler({
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

        this.fullscreenGfxProgram = cache.createProgram(device, new BloomPassFullscreenCopyProgram());
        this.blurGfxProgram = cache.createProgram(device, new BloomPassBlurProgram());
        this.bokehGfxProgram = cache.createProgram(device, new BloomPassBokehProgram());
    }

    public allocateParameterBuffer(renderInstManager: GfxRenderInstManager, bloomParameters: BloomPostFXParameters): number {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        const parameterBufferOffs = uniformBuffer.allocateChunk(4);
        const d = uniformBuffer.mapBufferF32(parameterBufferOffs, 4);
        
        let offs = parameterBufferOffs;
        offs += fillVec4(d, offs, bloomParameters.blurStrength, bloomParameters.bokehStrength, bloomParameters.bokehCombineStrength);

        return parameterBufferOffs;
    }

    public renderBeginObjects(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        this.bloomObjectsTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.bloomObjectsTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const rt = this.bloomObjectsTarget.createRenderPass(device, bloomClearRenderPassDescriptor);
        rt.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        return rt;
    }

    public renderEndObjects(device: GfxDevice, objectsPassRenderer: GfxRenderPass, renderInstManager: GfxRenderInstManager, mainRenderTarget: BasicRenderTarget, viewerInput: ViewerRenderInput, template: GfxRenderInst, parameterBufferOffs: number): GfxRenderPass {
        objectsPassRenderer.endPass(this.bloomObjectsTexture.gfxTexture);
        device.submitPass(objectsPassRenderer);

        // Downsample.
        const targetWidth = viewerInput.viewportWidth >> 2;
        const targetHeight = viewerInput.viewportHeight >> 2;

        const downsampleColorTarget = this.scratch1ColorTarget;
        const downsampleColorTexture = this.scratch1ColorTexture;
        downsampleColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        downsampleColorTexture.setParameters(device, targetWidth, targetHeight);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setFromTemplate(template);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setUniformBufferOffset(0, parameterBufferOffs, 4);
        renderInst.drawPrimitives(3);

        // Downsample.
        const downsamplePassRenderer = downsampleColorTarget.createRenderPass(device, noClearRenderPassDescriptor);
        downsamplePassRenderer.setViewport(targetWidth, targetHeight);
        renderInst.setGfxProgram(this.fullscreenGfxProgram);
        this.textureMapping[0].gfxTexture = this.bloomObjectsTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, downsamplePassRenderer);
        downsamplePassRenderer.endPass(downsampleColorTexture.gfxTexture);
        device.submitPass(downsamplePassRenderer);

        // Blur.
        const blurColorTarget = this.scratch2ColorTarget;
        const blurColorTexture = this.scratch2ColorTexture;
        blurColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        blurColorTexture.setParameters(device, targetWidth, targetHeight);
        const blurPassRenderer = blurColorTarget.createRenderPass(device, noClearRenderPassDescriptor);
        blurPassRenderer.setViewport(targetWidth, targetHeight);
        renderInst.setGfxProgram(this.blurGfxProgram);
        this.textureMapping[0].gfxTexture = downsampleColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, blurPassRenderer);
        blurPassRenderer.endPass(blurColorTexture.gfxTexture);
        device.submitPass(blurPassRenderer);

        // TODO(jstpierre): Downsample blur / bokeh as well.

        // Bokeh-ify.
        // We can ditch the second render target now, so just reuse it.
        const bokehColorTarget = this.scratch1ColorTarget;
        const bokehColorTexture = this.scratch1ColorTexture;
        const bokehPassRenderer = bokehColorTarget.createRenderPass(device, noClearRenderPassDescriptor);
        bokehPassRenderer.setViewport(targetWidth, targetHeight);
        renderInst.setGfxProgram(this.bokehGfxProgram);
        this.textureMapping[0].gfxTexture = blurColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, bokehPassRenderer);
        bokehPassRenderer.endPass(bokehColorTexture.gfxTexture);
        device.submitPass(bokehPassRenderer);

        // Combine.
        const combinePassRenderer = mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
        combinePassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInst.setGfxProgram(this.fullscreenGfxProgram);
        this.textureMapping[0].gfxTexture = bokehColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        });
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, combinePassRenderer);

        renderInstManager.returnRenderInst(renderInst);

        return combinePassRenderer;
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.fullscreenGfxProgram);
        device.destroyProgram(this.blurGfxProgram);
        device.destroyProgram(this.bokehGfxProgram);

        device.destroySampler(this.bloomSampler);
        this.bloomObjectsTexture.destroy(device);
        this.bloomObjectsTarget.destroy(device);
        this.scratch1ColorTarget.destroy(device);
        this.scratch1ColorTexture.destroy(device);
        this.scratch2ColorTarget.destroy(device);
        this.scratch2ColorTexture.destroy(device);
    }
}
