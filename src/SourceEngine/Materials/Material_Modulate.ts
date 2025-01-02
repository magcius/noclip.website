
import { TextureMapping } from "../../TextureHolder.js";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor } from "../../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../../gfx/platform/GfxPlatformImpl.js";
import { GfxRendererLayer, makeSortKey, setSortKeyProgramKey, GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import { SourceRenderContext } from "../Main.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { MaterialShaderTemplateBase, BaseMaterial, AlphaBlendMode, MaterialUtil } from "./MaterialBase.js";
import { MaterialCache } from "./MaterialCache.js";
import * as P from "./MaterialParameters.js";

export class ShaderTemplate_Modulate extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140, row_major) uniform ub_ObjectParams {
    mat4x2 u_BaseTextureTransform;
};

varying vec3 v_PositionWorld;
// BaseTexture
varying vec2 v_TexCoord0;

// BaseTexture
uniform sampler2D u_BaseTexture;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);

    v_TexCoord0.xy = u_BaseTextureTransform * vec4(a_TexCoord01.xy, 1.0, 1.0);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_BaseTextureSample = texture(SAMPLER_2D(u_BaseTexture), v_TexCoord0.xy);
    vec4 t_FinalColor = t_BaseTextureSample;
    t_FinalColor.rgb = mix(vec3(0.5), t_FinalColor.rgb, t_FinalColor.a);

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

export class Material_Modulate extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$mod2x']                        = new P.ParameterBoolean(false, false);
        p['$writez']                       = new P.ParameterBoolean(false, false);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Modulate);

        const isTranslucent = this.paramGetBoolean('$translucent') || this.textureIsTranslucent('$basetexture');
        const blendMode = this.getAlphaBlendMode(isTranslucent);

        const opaque = this.paramGetBoolean('$writez') && !(blendMode === AlphaBlendMode.Blend || blendMode === AlphaBlendMode.Glow);

        this.megaStateFlags.depthWrite = opaque;
        this.isTranslucent = !opaque;

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.Dst,
            blendDstFactor: this.paramGetBoolean('$mod2x') ? GfxBlendFactor.Src : GfxBlendFactor.Zero,
        });

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        MaterialUtil.resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Modulate.ub_ObjectParams, 8);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Modulate.ub_ObjectParams);

        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
