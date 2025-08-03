
import { TextureMapping } from "../../TextureHolder.js";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxMegaStateDescriptor, GfxProgram } from "../../gfx/platform/GfxPlatform.js";
import { GfxRendererLayer, GfxRenderInst, makeSortKey, setSortKeyProgramKey } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import type { SourceRenderContext } from "../Main.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { AlphaBlendMode, BaseMaterial, MaterialShaderTemplateBase, MaterialUtil } from "./MaterialBase.js";
import type { MaterialCache } from "./MaterialCache.js";
import * as P from "./MaterialParameters.js";

//#region SpriteCard
export class ShaderTemplate_SpriteCard extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;

${MaterialShaderTemplateBase.Common}

// In the future, we should use vertex data for some of this...
layout(std140) uniform ub_ObjectParams {
    vec4 u_BaseTextureScaleBias[5]; // Two animation frames, dual
    vec4 u_Color;
    vec4 u_Misc[1];
};
#define u_BlendFactor0          (u_Misc[0].x)
#define u_BlendFactor1          (u_Misc[0].y)
#define u_AddBaseTexture2Factor (u_Misc[0].z)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec4 v_TexCoord2;
varying vec4 v_Color;
varying vec4 v_Misc;

layout(binding = 0) uniform sampler2D u_Texture;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0));
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0));
    v_TexCoord0.xy = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[0]);
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[1]);
    v_TexCoord1.xy = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[2]);
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[3]);
    v_TexCoord2.xy = CalcScaleBias(a_TexCoord01.xy, u_BaseTextureScaleBias[4]);
    v_Color = u_Color;
    v_Misc.x = u_BlendFactor0;
    v_Misc.y = u_BlendFactor1;
}
#endif

#if defined FRAG
float Lum(in vec3 t_Sample) {
    return dot(vec3(0.3, 0.59, 0.11), t_Sample.rgb);
}

vec4 MaxLumFrameBlend(in vec4 t_Sample0, in vec4 t_Sample1, in float t_BlendFactor) {
    float t_Lum0 = Lum(t_Sample0.rgb * t_BlendFactor);
    float t_Lum1 = Lum(t_Sample1.rgb * (1.0 - t_BlendFactor));
    return t_Lum0 > t_Lum1 ? t_Sample0 : t_Sample1;
}

void mainPS() {
    vec4 t_Base00 = texture(SAMPLER_2D(u_Texture), v_TexCoord0.xy);
    vec4 t_Base01 = texture(SAMPLER_2D(u_Texture), v_TexCoord0.zw);
    float t_BlendFactor0 = v_Misc.x;

    bool t_BlendFrames = ${MaterialUtil.getDefineBool(m, `BLEND_FRAMES`)};
    bool t_MaxLumFrameBlend1 = ${MaterialUtil.getDefineBool(m, `MAX_LUM_FRAMEBLEND_1`)};
    vec4 t_Base0, t_Base;

    if (t_MaxLumFrameBlend1) {
        t_Base0 = MaxLumFrameBlend(t_Base00, t_Base01, t_BlendFactor0);
    } else if (t_BlendFrames) {
        t_Base0 = mix(t_Base00, t_Base01, t_BlendFactor0);
    } else {
        t_Base0 = t_Base00;
    }
    t_Base = t_Base0;

    bool t_DualSequence = ${MaterialUtil.getDefineBool(m, `DUAL_SEQUENCE`)};
    if (t_DualSequence) {
        vec4 t_Base10 = texture(SAMPLER_2D(u_Texture), v_TexCoord1.xy);
        vec4 t_Base11 = texture(SAMPLER_2D(u_Texture), v_TexCoord1.zw);
        bool t_MaxLumFrameBlend2 = ${MaterialUtil.getDefineBool(m, `MAX_LUM_FRAMEBLEND_2`)};
        float t_BlendFactor1 = v_Misc.y;

        vec4 t_Base1;
        if (t_MaxLumFrameBlend2) {
            t_Base1 = MaxLumFrameBlend(t_Base10, t_Base11, t_BlendFactor1);
        } else {
            t_Base1 = mix(t_Base10, t_Base11, t_BlendFactor1);
        }

        int t_BlendMode = ${MaterialUtil.getDefineString(m, `DUAL_BLEND_MODE`)};
        if (t_BlendMode == 0) { // DETAIL_BLEND_MODE_AVERAGE
            t_Base = (t_Base0 + t_Base1) * 0.5;
        } else if (t_BlendMode == 1) { // DETAIL_BLEND_MODE_USE_FIRST_AS_ALPHA_MASK_ON_SECOND
            t_Base.rgb = t_Base1.rgb;
        } else if (t_BlendMode == 2) { // DETAIL_BLEND_MODE_USE_FIRST_OVER_SECOND
            t_Base.rgb = mix(t_Base0.rgb, t_Base1.rgb, t_Base1.a);
        }
    }

    vec4 t_FinalColor = t_Base;
    // TODO(jstpierre): MOD2X

    bool t_AddBaseTexture2 = ${MaterialUtil.getDefineBool(m, 'ADD_BASE_TEXTURE2')};
    bool t_AddSelf = ${MaterialUtil.getDefineBool(m, 'ADDSELF')};
    bool t_ExtractGreenAlpha = ${MaterialUtil.getDefineBool(m, 'EXTRACT_GREEN_ALPHA')};
    bool t_Additive = ${MaterialUtil.getDefineBool(m, `ADDITIVE`)};

    if (t_AddBaseTexture2) {
        t_FinalColor.a *= v_Color.a;
        t_FinalColor.rgb *= t_FinalColor.aaa;
        if (t_ExtractGreenAlpha) {
            t_FinalColor.rgb += u_AddBaseTexture2Factor * v_Color.a * t_FinalColor.rgb;
        } else {
            vec4 t_Tex2 = texture(SAMPLER_2D(u_Texture), v_TexCoord2.xy);
            t_FinalColor.rgb += u_AddBaseTexture2Factor * v_Color.a * t_Tex2.rgb;
        }
        t_FinalColor.rgb *= v_Color.rgb;
    } else if (t_AddSelf) {
        // TODO(jstpierre): ADDSELF
        t_FinalColor.a *= v_Color.a;
		t_FinalColor.rgb *= t_FinalColor.aaa;
		t_FinalColor.rgb += u_AddBaseTexture2Factor * v_Color.a * t_FinalColor.rgb;
		t_FinalColor.rgb *= v_Color.rgb;
    } else if (t_Additive) {
        t_FinalColor.rgba *= v_Color.rgba;
        t_FinalColor.rgb *= t_FinalColor.aaa;
    } else {
        t_FinalColor.rgba *= v_Color.rgba;
    }

    bool t_UseAlphaTest = ${MaterialUtil.getDefineBool(m, `ALPHA_TEST`)};
    if (t_UseAlphaTest) {
        if (t_FinalColor.a < (1.0/255.0))
            discard;
    }

    OutputLinearColor(t_FinalColor.rgba);
}
#endif
`;
    }
}

export class Material_SpriteCard extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    public isSpriteCard = true;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$blendframes']           = new P.ParameterBoolean(true);
        p['$maxlumframeblend1']     = new P.ParameterBoolean(false);
        p['$maxlumframeblend2']     = new P.ParameterBoolean(false);
        p['$dualsequence']          = new P.ParameterBoolean(false);
        p['$sequence_blend_mode']   = new P.ParameterNumber(0);
        p['$addbasetexture2']       = new P.ParameterNumber(0.0);
        p['$addself']               = new P.ParameterBoolean(false);
        p['$extractgreenalpha']     = new P.ParameterBoolean(false);
        p['$addoverblend']          = new P.ParameterBoolean(false);
        p['$zoomanimateseq2']       = new P.ParameterNumber(1.0);

        // Stuff hacked in by the particle system.
        p['_b00'] = new P.ParameterVector(4);
        p['_b01'] = new P.ParameterVector(4);
        p['_blend0'] = new P.ParameterNumber(0);
        p['_b10'] = new P.ParameterVector(4);
        p['_b11'] = new P.ParameterVector(4);
        p['_blend1'] = new P.ParameterNumber(0);
        p['_b2'] = new P.ParameterVector(4);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SpriteCard);
        this.shaderInstance.setDefineBool(`BLEND_FRAMES`, this.paramGetBoolean(`$blendframes`));
        this.shaderInstance.setDefineBool(`MAX_LUM_FRAMEBLEND_1`, this.paramGetBoolean(`$maxlumframeblend1`));
        this.shaderInstance.setDefineBool(`MAX_LUM_FRAMEBLEND_2`, this.paramGetBoolean(`$maxlumframeblend2`));
        this.shaderInstance.setDefineBool(`DUAL_SEQUENCE`, this.paramGetBoolean(`$dualsequence`));
        this.shaderInstance.setDefineString(`DUAL_BLEND_MODE`, '' + this.paramGetInt(`$sequence_blend_mode`));
        const addBaseTexture2 = this.paramGetNumber(`$addbasetexture2`) > 0.0;
        this.shaderInstance.setDefineBool(`ADD_BASE_TEXTURE2`, addBaseTexture2);
        this.shaderInstance.setDefineBool(`ADDSELF`, this.paramGetBoolean(`$addself`));
        this.shaderInstance.setDefineBool(`EXTRACT_GREEN_ALPHA`, this.paramGetBoolean(`$extractgreenalpha`));
        this.shaderInstance.setDefineBool(`ADDITIVE`, this.paramGetBoolean(`$additive`));
        this.shaderInstance.setDefineBool(`ALPHA_TEST`, addBaseTexture2 || this.paramGetBoolean(`$addself`));

        let isAdditive = this.paramGetBoolean('$additive');
        if (addBaseTexture2 || this.paramGetBoolean('$addoverblend') || this.paramGetBoolean('$addself'))
            isAdditive = true;

        this.setAlphaBlendMode(this.megaStateFlags, isAdditive ? AlphaBlendMode.Add : AlphaBlendMode.Blend);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

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

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SpriteCard.ub_ObjectParams, 28);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_SpriteCard.ub_ObjectParams);

        offs += this.paramFillVector4(d, offs, '_b00');
        offs += this.paramFillVector4(d, offs, '_b01');
        offs += this.paramFillVector4(d, offs, '_b10');
        offs += this.paramFillVector4(d, offs, '_b11');
        offs += this.paramFillVector4(d, offs, '_b2');
        offs += this.paramFillModulationColor(d, offs);
        offs += fillVec4(d, offs, this.paramGetNumber('_blend0'), this.paramGetNumber('_blend1'), this.paramGetNumber(`$addbasetexture2`));

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
