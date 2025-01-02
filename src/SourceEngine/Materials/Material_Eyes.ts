
import { TextureMapping } from "../../TextureHolder.js";
import { GfxMegaStateDescriptor } from "../../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../../gfx/platform/GfxPlatformImpl.js";
import { GfxRendererLayer, makeSortKey, setSortKeyProgramKey, GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import { SourceRenderContext } from "../Main.js";
import { MaterialCache } from "./MaterialCache.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { MaterialShaderTemplateBase, BaseMaterial, MaterialUtil, AlphaBlendMode } from "./MaterialBase.js";
import * as P from "./MaterialParameters.js";

// UnlitTwoTexture
export class ShaderTemplate_Eyes extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140, row_major) uniform ub_ObjectParams {
    mat4x2 u_BaseTransform;
    mat4x2 u_IrisTransform;
};

varying vec3 v_PositionWorld;
// TextureBase, TextureIris
varying vec4 v_TexCoord0;
varying vec3 v_Lighting;

uniform sampler2D u_TextureBase;
uniform sampler2D u_TextureIris;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);

    v_TexCoord0.xy = u_BaseTransform * vec4(a_TexCoord01.xy, 1.0, 1.0);
    v_TexCoord0.zw = u_IrisTransform * vec4(t_PositionWorld, 1.0);

    // XXX(jstpierre): Move lighting into common helpers
    v_Lighting.rgb = vec3(1.0);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_TextureBase = texture(SAMPLER_2D(u_TextureBase), v_TexCoord0.xy);
    vec4 t_TextureIris = texture(SAMPLER_2D(u_TextureIris), v_TexCoord0.zw);

    vec3 t_Glint = vec3(0.0);

    // Composite iris onto base
    vec4 t_FinalColor = vec4(0.0);
    t_FinalColor.rgb = mix(t_TextureBase.rgb, t_TextureIris.rgb, t_TextureIris.a) * v_Lighting.rgb + t_Glint;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);

    // o_Color0.rgb = vec3(v_TexCoord0.zw, 1.0);
}
#endif
`;
}

export class Material_Eyes extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$iris']                         = new P.ParameterTexture(true);
        p['$irisframe']                    = new P.ParameterNumber(0.0);
        p['$iristransform']                = new P.ParameterMatrix();
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Eyes);

        this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.None);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        MaterialUtil.resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$iris').fillTextureMapping(dst[1], this.paramGetInt('$irisframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Eyes.ub_ObjectParams, 20);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Eyes.ub_ObjectParams);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));
        offs += this.paramFillTextureMatrix(d, offs, '$iristransform');

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
