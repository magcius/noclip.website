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
#define u_HalfTexel (u_Misc[0].xy)
`;

class BlurDownProgram extends DeviceProgram {
    public vert = GfxShaderLibrary.fullscreenVS;

    public frag = `
${BindingsDefinition}

in vec2 v_TexCoord;

void main() {
    vec3 sum = texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb * 4.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord - u_HalfTexel).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + u_HalfTexel).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(u_HalfTexel.x, -u_HalfTexel.y)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x, u_HalfTexel.y)).rgb;
    sum /= 8.0;

    gl_FragColor = vec4(sum, 1.0);
}
`;

}

class BlurUpProgram extends DeviceProgram {
    public vert = GfxShaderLibrary.fullscreenVS;

    public frag = `
${BindingsDefinition}

in vec2 v_TexCoord;

void main() {
    vec3 sum = vec3(0.0);
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord - vec2(u_HalfTexel.x, u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x, u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(u_HalfTexel.x, -u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x, -u_HalfTexel.y)).rgb * 2.0;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(-u_HalfTexel.x * 2.0, 0.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(0.0, u_HalfTexel.y * 2.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(u_HalfTexel.x * 2.0, 0.0)).rgb;
    sum += texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(0.0, -u_HalfTexel.y * 2.0)).rgb;
    sum /= 12.0;

    gl_FragColor = vec4(sum, 1.0);
}
`;

}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 2 }];

export class BlurFilter {
    private blurDownProgram: GfxProgram;
    private blurUpProgram: GfxProgram;

    private targetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target2Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target4Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target8Desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache) {
        this.blurDownProgram = cache.createProgram(new BlurDownProgram());
        this.blurUpProgram = cache.createProgram(new BlurUpProgram());
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

    private allocateParameterBuffer(renderInst: GfxRenderInst, targetDesc: GfxrRenderTargetDescription) {
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillVec4(d, offs, 0.5 / targetDesc.width, 0.5 / targetDesc.height, 0.0, 0.0);
    }

    private renderBlurPass(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, name: string, program: GfxProgram, inputDesc: GfxrRenderTargetDescription, inputID: number, outputID: number, texture?: GfxTexture | null) {
        let renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst, inputDesc);
        renderInst.drawPrimitives(3);

        builder.pushPass((pass) => {
            pass.setDebugName(name);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, outputID);

            let resolveID: number;
            if (texture === undefined) {
                resolveID = builder.resolveRenderTarget(inputID);
                pass.attachResolveTexture(resolveID);
            }

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                if (texture === undefined)
                    this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveID);
                else
                    this.textureMapping[0].gfxTexture = texture;
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    public render(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, inputWidth: number, inputHeight: number, getTexture: () => GfxTexture | null): number {
        this.targetDesc.setDimensions(inputWidth, inputHeight, 1);
        this.target2Desc.setDimensions(inputWidth >>> 1, inputHeight >>> 1, 1);
        this.target4Desc.setDimensions(this.target2Desc.width >>> 1, this.target2Desc.height >>> 1, 1);
        this.target8Desc.setDimensions(this.target4Desc.width >>> 1, this.target4Desc.height >>> 1, 1);

        const blur2TargetID = builder.createRenderTargetID(this.target2Desc, 'Blur 1/2');
        const blur4TargetID = builder.createRenderTargetID(this.target4Desc, 'Blur 1/4');
        const blur8TargetID = builder.createRenderTargetID(this.target8Desc, 'Blur 1/8');
        const outputTargetID = builder.createRenderTargetID(this.targetDesc, 'Blur Output');

        this.renderBlurPass(builder, renderInstManager, 'Blur Down To 1/2', this.blurDownProgram, this.targetDesc, 0, blur2TargetID, getTexture());
        this.renderBlurPass(builder, renderInstManager, 'Blur Down To 1/4', this.blurDownProgram, this.target2Desc, blur2TargetID, blur4TargetID);
        this.renderBlurPass(builder, renderInstManager, 'Blur Down To 1/8', this.blurDownProgram, this.target4Desc, blur4TargetID, blur8TargetID);
        this.renderBlurPass(builder, renderInstManager, 'Blur Up To 1/4', this.blurUpProgram, this.target8Desc, blur8TargetID, blur4TargetID);
        this.renderBlurPass(builder, renderInstManager, 'Blur Up To 1/2', this.blurUpProgram, this.target4Desc, blur4TargetID, blur2TargetID);
        this.renderBlurPass(builder, renderInstManager, 'Blur Up To Output', this.blurUpProgram, this.targetDesc, blur2TargetID, outputTargetID);

        return outputTargetID;
    }
}