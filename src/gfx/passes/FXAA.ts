
import { DeviceProgram } from "../../Program.js";
import { TextureMapping } from "../../TextureHolder.js";
import { nArray } from "../../util.js";
import { fullscreenMegaState } from "../helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../helpers/GfxShaderLibrary.js";
import { GfxDevice } from "../platform/GfxPlatform.js";
import { GfxProgram } from "../platform/GfxPlatformImpl.js";
import { GfxRenderCache } from "../render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../render/GfxRenderHelper.js";

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

export class FXAA {
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(renderCache: GfxRenderCache) {
        const fxaaProgram = new FXAAProgram();
        this.gfxProgram = renderCache.createProgram(fxaaProgram);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, mainColorTargetID: GfxrRenderTargetID): void {
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
            renderInst.setDrawCount(3);
    
            renderInst.setGfxProgram(this.gfxProgram);
    
            pass.exec((passRenderer, scope) => {
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderHelper.renderCache, passRenderer);
            });
        });
    }
}
