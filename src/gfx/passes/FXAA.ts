
import { DeviceProgram } from "../../Program";
import { TextureMapping } from "../../TextureHolder";
import { nArray } from "../../util";
import { fullscreenMegaState } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../helpers/GfxShaderLibrary";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../render/GfxRenderGraph";
import { GfxRenderHelper } from "../render/GfxRenderHelper";

class FXAAProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;

    public override frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

${GfxShaderLibrary.MonochromeNTSC}
${GfxShaderLibrary.FXAA}

void main() {
    vec2 t_InvResolution = 1.0 / vec2(textureSize(TEXTURE(u_Texture), 0));
    gl_FragColor.rgba = FXAA(PP_SAMPLER_2D(u_Texture), v_TexCoord.xy, t_InvResolution);
}
`;
}

interface RenderInput {
}

const textureMapping = nArray(1, () => new TextureMapping());
export function pushFXAAPass(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, renderInput: RenderInput, mainColorTargetID: GfxrRenderTargetID): void {
    builder.pushPass((pass) => {
        pass.setDebugName('FXAA');
        pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
        pass.attachResolveTexture(mainColorResolveTextureID);

        const renderInst = renderHelper.renderInstManager.newRenderInst();
        renderInst.setUniformBuffer(renderHelper.uniformBuffer);
        renderInst.setAllowSkippingIfPipelineNotReady(false);

        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
        renderInst.drawPrimitives(3);

        const fxaaProgram = new FXAAProgram();
        const gfxProgram = renderHelper.renderCache.createProgram(fxaaProgram);

        renderInst.setGfxProgram(gfxProgram);

        pass.exec((passRenderer, scope) => {
            textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
            renderInst.setSamplerBindingsFromTextureMappings(textureMapping);
            renderInst.drawOnPass(renderHelper.renderCache, passRenderer);
        });
    });
}
