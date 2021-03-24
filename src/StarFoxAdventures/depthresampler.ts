import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";
import { GfxBindingLayoutDescriptor, GfxDevice, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxProgram } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription, GfxrGraphBuilder } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";

/**
 * A program to transfer the depth buffer to a texture.
 * 
 * This performs the following functions beyond sampling the depth buffer directly:
 * - Reverses depth values
 * - Adjusts near and far planes to be faithful to those expected by the original game's shaders
 * - Outputs to a color texture to allow for bilinear filtering
 */
class DepthResamplerProgram extends DeviceProgram {
    public frag: string = `
uniform sampler2D u_DepthTexture;

in vec2 v_TexCoord;

// TODO: implement near-far scaling

void main() {
    float d = 1.0 - texture(SAMPLER_2D(u_DepthTexture), v_TexCoord).r;
    gl_FragColor = vec4(d);
}
`;
    public vert = GfxShaderLibrary.fullscreenVS;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 0, numSamplers: 1 }];

export class DepthResampler {
    private program: GfxProgram;
    private textureMapping = new TextureMapping();
    private targetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT); // FIXME: use R-only format intead?

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.program = cache.createProgram(device, new DepthResamplerProgram());
        this.textureMapping.gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        })
    }

    public render(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, depthInputTargetID: number): number {
        const inputTargetDesc = builder.getRenderTargetDescription(depthInputTargetID);

        this.targetDesc.setDimensions(inputTargetDesc.width, inputTargetDesc.height, 1);

        const depthOutputTargetID = builder.createRenderTargetID(this.targetDesc, 'Depth Resampler Output');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setGfxProgram(this.program);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Resample Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, depthOutputTargetID);

            const resolveTextureID = builder.resolveRenderTarget(depthInputTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.textureMapping.gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings([this.textureMapping]);
                renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return depthOutputTargetID;
    }
}