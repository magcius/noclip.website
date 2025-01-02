
import { TextureMapping } from "../../TextureHolder.js";
import { GfxMegaStateDescriptor } from "../../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../../gfx/platform/GfxPlatformImpl.js";
import { GfxRendererLayer, makeSortKey, setSortKeyProgramKey, GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import { SourceRenderContext } from "../Main.js";
import { MaterialCache } from "./MaterialCache.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { MaterialShaderTemplateBase, BaseMaterial, MaterialUtil } from "./MaterialBase.js";
import * as P from "./MaterialParameters.js";

// UnlitTwoTexture
export class ShaderTemplate_UnlitTwoTexture extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140, row_major) uniform ub_ObjectParams {
    mat4x2 u_Texture1Transform;
    mat4x2 u_Texture2Transform;
    vec4 u_ModulationColor;
};

varying vec3 v_PositionWorld;
// Texture1, Texture2
varying vec4 v_TexCoord0;

// Texture1, Texture2
uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);

    v_TexCoord0.xy = u_Texture1Transform * vec4(a_TexCoord01.xy, 1.0, 1.0);
    v_TexCoord0.zw = u_Texture2Transform * vec4(a_TexCoord01.xy, 1.0, 1.0);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_Texture1 = texture(SAMPLER_2D(u_Texture1), v_TexCoord0.xy);
    vec4 t_Texture2 = texture(SAMPLER_2D(u_Texture2), v_TexCoord0.zw);
    vec4 t_FinalColor = t_Texture1 * t_Texture2 * u_ModulationColor;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

export class Material_UnlitTwoTexture extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$texture2']                     = new P.ParameterTexture(true);
        p['$texture2transform']            = new P.ParameterMatrix();
        p['$frame2']                       = new P.ParameterNumber(0.0);

        // TODO(jstpierre): MonitorScreen tint/constrast/saturation.
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.UnlitTwoTexture);

        const isTranslucent = this.paramGetBoolean('$translucent') || this.textureIsTranslucent('$basetexture') || this.textureIsTranslucent('$texture2');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
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
        this.paramGetTexture('$texture2').fillTextureMapping(dst[1], this.paramGetInt('$frame2'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_UnlitTwoTexture.ub_ObjectParams, 20);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_UnlitTwoTexture.ub_ObjectParams);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));
        offs += this.paramFillTextureMatrix(d, offs, '$texture2transform');
        offs += this.paramFillModulationColor(d, offs);

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
