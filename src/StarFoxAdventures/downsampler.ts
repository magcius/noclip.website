import { DeviceProgram } from "../Program";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/ShaderHelpers";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription, GfxrGraphBuilder } from "../gfx/render/GfxRenderGraph";
import { GfxWrapMode, GfxTexture, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBlendMode, GfxBlendFactor, GfxMegaStateDescriptor, GfxFormat, GfxProgram } from "../gfx/platform/GfxPlatform";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { TextureMapping } from "../TextureHolder";
import { MathConstants } from "../MathHelpers";
import { assert, nArray } from "../util";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GXShaderLibrary } from "../gx/gx_material";

// A downsampler to create blurred images for water and reflection effects.
//
// In the original game, this effect is achieved by downsampling the framebuffer to 1/8 size.
// We improve on this effect by implementing a blur filter.
//
// This code borrows heavily from Super Mario Galaxy's bloom effect.

const BindingsDefinition = `
uniform sampler2D u_Texture;

layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_Axis (u_Misc[0].xy)
`;

class Blur1DProgram extends DeviceProgram {
    public vert = GfxShaderLibrary.fullscreenVS;

    public frag = `
${BindingsDefinition}

in vec2 v_TexCoord;

void main() {
    vec3 f = vec3(0.0);

    f += 0.054 * texture(SAMPLER_2D(u_Texture), v_TexCoord - u_Axis * 2.0).rgb;
    f += 0.242 * texture(SAMPLER_2D(u_Texture), v_TexCoord - u_Axis).rgb;
    f += 0.399 * texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb;
    f += 0.242 * texture(SAMPLER_2D(u_Texture), v_TexCoord + u_Axis).rgb;
    f += 0.054 * texture(SAMPLER_2D(u_Texture), v_TexCoord + u_Axis * 2.0).rgb;

    gl_FragColor = vec4(f, 1.0);
}
`;

}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 2 }];

export class Downsampler {
    private program: GfxProgram;

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target8ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache) {
        this.program = cache.createProgram(new Blur1DProgram());
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
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst, x: number, y: number) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillVec4(d, offs, x, y, 0.0, 0.0);
    }

    public render(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, inputWidth: number, inputHeight: number, getTexture: () => GfxTexture | null): number {
        this.target2ColorDesc.setDimensions(inputWidth >>> 1, inputHeight >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);
        this.target8ColorDesc.setDimensions(this.target4ColorDesc.width >>> 1, this.target4ColorDesc.height >>> 1, 1);

        const intermediateTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Downsampler Intermediate');
        const outputTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Downsampler Output');

        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Downsample 1/2');
        const downsample4ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Downsample 1/4');
        const downsample8ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Downsample 1/8');

        let renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst, 1/128, 0);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName('Blur Horizontal');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, intermediateTargetID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = getTexture();
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst, 0, 1/128);
        renderInst.drawPrimitives(3);
        
        builder.pushPass((pass) => {
            pass.setDebugName('Blur Vertical');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, outputTargetID);

            const intermediateResolveID = builder.resolveRenderTarget(intermediateTargetID);
            pass.attachResolveTexture(intermediateResolveID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(intermediateResolveID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return outputTargetID;
    }
}