
import { DeviceProgram } from "../../Program";
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer } from "../../gfx/render/GfxRenderer";
import { TextureMapping } from "../../TextureHolder";
import { GfxRenderBuffer } from "../../gfx/render/GfxRenderBuffer";
import { nArray } from "../../util";
import { GfxRenderPassDescriptor, GfxLoadDisposition, GfxDevice, GfxRenderPass, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBufferUsage, GfxBufferFrequencyHint, GfxBlendMode, GfxBlendFactor, GfxHostAccessPass } from "../../gfx/platform/GfxPlatform";
import { TransparentBlack } from "../../Color";
import { copyRenderPassDescriptor, DepthStencilAttachment, DEFAULT_NUM_SAMPLES, makeEmptyRenderPassDescriptor, ColorAttachment, ColorTexture, PostFXRenderTarget, BasicRenderTarget, noClearRenderPassDescriptor } from "../../gfx/helpers/RenderTargetHelpers";
import { fullscreenMegaState } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers";
import { ViewerRenderInput } from "../../viewer";

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

function makeFullscreenPassRenderInst(renderInstBuilder: GfxRenderInstBuilder, name: string, program: DeviceProgram): GfxRenderInst {
    const renderInst = renderInstBuilder.pushRenderInst();
    renderInst.drawTriangles(3);
    renderInst.name = name;
    renderInst.setDeviceProgram(program);
    renderInst.inputState = null;
    renderInst.setMegaStateFlags(fullscreenMegaState);
    return renderInst;
}

// TODO(jstpierre): Rewrite to not 
const enum SMGPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    BLOOM = 1 << 3,

    BLOOM_DOWNSAMPLE = 1 << 4,
    BLOOM_BLUR = 1 << 5,
    BLOOM_BOKEH = 1 << 6,
    BLOOM_COMBINE = 1 << 7,
}

export class BloomPostFXParameters {
    public blurStrength: number = 50/256;
    public bokehStrength: number = 25/256;
    public bokehCombineStrength: number = 25/256;
}

export class BloomPostFXRenderer {
    private bloomTemplateRenderInst: GfxRenderInst;
    private bloomParamsBuffer: GfxRenderBuffer;
    private bloomRenderInstDownsample: GfxRenderInst;
    private bloomRenderInstBlur: GfxRenderInst;
    private bloomRenderInstBokeh: GfxRenderInst;
    private bloomRenderInstCombine: GfxRenderInst;
    private bloomSampler: GfxSampler;
    private bloomTextureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());
    private bloomSceneColorTarget: WeirdFancyRenderTarget;
    private bloomSceneColorTexture = new ColorTexture();
    private bloomScratch1ColorTarget = new PostFXRenderTarget();
    private bloomScratch1ColorTexture = new ColorTexture();
    private bloomScratch2ColorTarget = new PostFXRenderTarget();
    private bloomScratch2ColorTexture = new ColorTexture();

    constructor(device: GfxDevice, mainRenderTarget: BasicRenderTarget, viewRenderer: GfxRenderInstViewRenderer) {
        this.bloomSampler = device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.bloomTextureMapping[0].gfxSampler = this.bloomSampler;

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];
        this.bloomParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_Params`);
        const renderInstBuilder = new GfxRenderInstBuilder(device, BloomPassBaseProgram.programReflection, bindingLayouts, [this.bloomParamsBuffer]);

        this.bloomTemplateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.bloomTemplateRenderInst, 0);
        this.bloomSceneColorTarget = new WeirdFancyRenderTarget(mainRenderTarget.depthStencilAttachment);
        this.bloomRenderInstDownsample = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom downsample', new BloomPassFullscreenCopyProgram());
        this.bloomRenderInstDownsample.passMask = SMGPass.BLOOM_DOWNSAMPLE;

        this.bloomRenderInstBlur = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom blur', new BloomPassBlurProgram());
        this.bloomRenderInstBlur.passMask = SMGPass.BLOOM_BLUR;

        this.bloomRenderInstBokeh = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom bokeh', new BloomPassBokehProgram());
        this.bloomRenderInstBokeh.passMask = SMGPass.BLOOM_BOKEH;

        this.bloomRenderInstCombine = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom combine', new BloomPassFullscreenCopyProgram());
        this.bloomRenderInstCombine.passMask = SMGPass.BLOOM_COMBINE;
        this.bloomRenderInstCombine.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        });

        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, bloomParameters: BloomPostFXParameters): void {
        let offs = this.bloomTemplateRenderInst.getUniformBufferOffset(0);
        const d = this.bloomParamsBuffer.mapBufferF32(offs, 4);
        fillVec4(d, offs, bloomParameters.blurStrength, bloomParameters.bokehStrength, bloomParameters.bokehCombineStrength);
        this.bloomParamsBuffer.prepareToRender(hostAccessPass);
    }

    public render(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer, mainRenderTarget: BasicRenderTarget, viewerInput: ViewerRenderInput): GfxRenderPass {
        const bloomColorTargetScene = this.bloomSceneColorTarget;
        const bloomColorTextureScene = this.bloomSceneColorTexture;
        bloomColorTargetScene.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        bloomColorTextureScene.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const bloomPassRenderer = bloomColorTargetScene.createRenderPass(device, bloomClearRenderPassDescriptor);
        viewRenderer.executeOnPass(device, bloomPassRenderer, SMGPass.BLOOM);
        bloomPassRenderer.endPass(bloomColorTextureScene.gfxTexture);
        device.submitPass(bloomPassRenderer);

        // Downsample.
        const bloomWidth = viewerInput.viewportWidth >> 2;
        const bloomHeight = viewerInput.viewportHeight >> 2;
        viewRenderer.setViewport(bloomWidth, bloomHeight);

        const bloomColorTargetDownsample = this.bloomScratch1ColorTarget;
        const bloomColorTextureDownsample = this.bloomScratch1ColorTexture;
        bloomColorTargetDownsample.setParameters(device, bloomWidth, bloomHeight, 1);
        bloomColorTextureDownsample.setParameters(device, bloomWidth, bloomHeight);
        this.bloomTextureMapping[0].gfxTexture = bloomColorTextureScene.gfxTexture!;
        this.bloomRenderInstDownsample.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
        const bloomDownsamplePassRenderer = bloomColorTargetDownsample.createRenderPass(device, noClearRenderPassDescriptor);
        viewRenderer.executeOnPass(device, bloomDownsamplePassRenderer, SMGPass.BLOOM_DOWNSAMPLE);
        bloomDownsamplePassRenderer.endPass(bloomColorTextureDownsample.gfxTexture);
        device.submitPass(bloomDownsamplePassRenderer);

        // Blur.
        const bloomColorTargetBlur = this.bloomScratch2ColorTarget;
        const bloomColorTextureBlur = this.bloomScratch2ColorTexture;
        bloomColorTargetBlur.setParameters(device, bloomWidth, bloomHeight, 1);
        bloomColorTextureBlur.setParameters(device, bloomWidth, bloomHeight);
        this.bloomTextureMapping[0].gfxTexture = bloomColorTextureDownsample.gfxTexture!;
        this.bloomRenderInstBlur.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
        const bloomBlurPassRenderer = bloomColorTargetBlur.createRenderPass(device, noClearRenderPassDescriptor);
        viewRenderer.executeOnPass(device, bloomBlurPassRenderer, SMGPass.BLOOM_BLUR);
        bloomBlurPassRenderer.endPass(bloomColorTextureBlur.gfxTexture);
        device.submitPass(bloomBlurPassRenderer);

        // TODO(jstpierre): Downsample blur / bokeh as well.

        // Bokeh-ify.
        // We can ditch the second render target now, so just reuse it.
        const bloomColorTargetBokeh = this.bloomScratch1ColorTarget;
        const bloomColorTextureBokeh = this.bloomScratch1ColorTexture;
        const bloomBokehPassRenderer = bloomColorTargetBokeh.createRenderPass(device, noClearRenderPassDescriptor);
        this.bloomTextureMapping[0].gfxTexture = bloomColorTextureBlur.gfxTexture!;
        this.bloomRenderInstBokeh.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
        viewRenderer.executeOnPass(device, bloomBokehPassRenderer, SMGPass.BLOOM_BOKEH);
        bloomBokehPassRenderer.endPass(bloomColorTextureBokeh.gfxTexture);
        device.submitPass(bloomBokehPassRenderer);

        // Combine.
        const bloomCombinePassRenderer = mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
        this.bloomTextureMapping[0].gfxTexture = bloomColorTextureBokeh.gfxTexture!;
        this.bloomRenderInstCombine.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
        viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        viewRenderer.executeOnPass(device, bloomCombinePassRenderer, SMGPass.BLOOM_COMBINE);
        return bloomCombinePassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.bloomParamsBuffer.destroy(device);
        device.destroyProgram(this.bloomRenderInstBlur.gfxProgram!);
        device.destroyProgram(this.bloomRenderInstBokeh.gfxProgram!);
        device.destroyProgram(this.bloomRenderInstCombine.gfxProgram!);
        device.destroyProgram(this.bloomRenderInstDownsample.gfxProgram!);

        device.destroySampler(this.bloomSampler);
        this.bloomSceneColorTarget.destroy(device);
        this.bloomSceneColorTexture.destroy(device);
        this.bloomScratch1ColorTarget.destroy(device);
        this.bloomScratch1ColorTexture.destroy(device);
        this.bloomScratch2ColorTarget.destroy(device);
        this.bloomScratch2ColorTexture.destroy(device);
    }
}
