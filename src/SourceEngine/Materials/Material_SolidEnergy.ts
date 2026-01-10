
import { TextureMapping } from "../../TextureHolder.js";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxMegaStateDescriptor, GfxProgram } from "../../gfx/platform/GfxPlatform.js";
import { GfxRendererLayer, GfxRenderInst, makeSortKey, setSortKeyProgramKey } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import type { SourceRenderContext } from "../Main.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { BaseMaterial, MaterialShaderTemplateBase, MaterialUtil } from "./MaterialBase.js";
import type { MaterialCache } from "./MaterialCache.js";
import * as P from "./MaterialParameters.js";
import { SampleFlowMap } from "./Material_Water.js";

//#region SolidEnergy
export class ShaderTemplate_SolidEnergy extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision highp float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    Mat2x4 u_BaseTextureTransform;
#if defined USE_DETAIL
    Mat2x4 u_Detail1TextureTransform;
    Mat2x4 u_Detail2TextureTransform;
#endif
#if defined USE_FLOWMAP
    vec4 u_Misc[3];
#endif
};

#define u_FlowWorldTexCoordScale           (u_Misc[0].x)
#define u_FlowNormalTexCoordScale          (u_Misc[0].y)
#define u_FlowNoiseTexCoordScale           (u_Misc[0].z)
#define u_FlowOutputIntensity              (u_Misc[0].w)

#define u_FlowColor                        (u_Misc[1].xyz)
#define u_FlowIntensity                    (u_Misc[1].w)

#define u_FlowTimeInInvervals              (u_Misc[2].x)
#define u_FlowNormalTexCoordScrollDistance (u_Misc[2].y)
#define u_FlowLerpExp                      (u_Misc[2].z)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec4 v_PositionWorld;

layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureDetail1;
layout(binding = 2) uniform sampler2D u_TextureDetail2;
layout(binding = 3) uniform sampler2D u_TextureFlowmap;
layout(binding = 4) uniform sampler2D u_TextureFlowNoise;
layout(binding = 5) uniform sampler2D u_TextureFlowBounds;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);
    v_PositionWorld.w = -gl_Position.z;
#if !GFX_CLIPSPACE_NEAR_ZERO()
    v_PositionWorld.w = v_PositionWorld.w * 0.5 + 0.5;
#endif

    vec3 t_NormalWorld = normalize(t_WorldFromLocalMatrix * vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = normalize(t_WorldFromLocalMatrix * vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TexCoord0.xy = UnpackMatrix(u_BaseTextureTransform) * vec4(a_TexCoord01.xy, 1.0, 1.0);
    v_TexCoord0.zw = vec2(0.0);

    v_TexCoord1.xyzw = vec4(0.0);

#if defined USE_DETAIL
    v_TexCoord1.xy = UnpackMatrix(u_Detail1TextureTransform) * vec4(a_TexCoord01.xy, 1.0, 1.0);
    v_TexCoord1.zw = UnpackMatrix(u_Detail2TextureTransform) * vec4(a_TexCoord01.xy, 1.0, 1.0);
#endif

#if defined USE_FLOWMAP
    vec2 t_FlowUV = vec2(0.0);

#if defined MODEL
    t_FlowUV.xy = a_TexCoord01.xy;
#else
    t_FlowUV.x = dot(t_TangentSWorld.xyz, v_PositionWorld.xyz);
    t_FlowUV.y = dot(t_TangentTWorld.xyz, v_PositionWorld.xyz);
#endif

    v_TexCoord0.zw = t_FlowUV.xy;
#endif
}
#endif

${SampleFlowMap}

float CalcCameraFade(in float t_PosProjZ) {
    return smoothstep(0.0, 1.0, saturate(t_PosProjZ * 0.025));
}

#if defined FRAG
void mainPS() {
    vec4 t_BaseTexture = vec4(0.0, 0.0, 0.0, 1.0);
    bool t_UseBaseAlpha = true;

#if defined USE_FLOWMAP
    vec4 t_FlowBoundsSample = texture(SAMPLER_2D(u_TextureFlowBounds), v_TexCoord0.xy);
    vec4 t_FlowSample = texture(SAMPLER_2D(u_TextureFlowmap), v_TexCoord0.zw * u_FlowWorldTexCoordScale);
    vec2 t_FlowVectorTangent = UnpackUnsignedNormalMap(t_FlowSample).rg;
    t_FlowVectorTangent.xy *= t_FlowBoundsSample.r;

    // No vortex.

    vec2 t_FlowNoiseTexCoord = v_TexCoord0.zw * u_FlowNoiseTexCoordScale;
    vec4 t_FlowNoiseSample = texture(SAMPLER_2D(u_TextureFlowNoise), t_FlowNoiseTexCoord.xy);
    vec2 t_FlowTexCoordBase = v_TexCoord0.zw * u_FlowNormalTexCoordScale;
    float t_FlowTimeInIntervals = u_FlowTimeInInvervals + t_FlowNoiseSample.g;
    vec4 t_FlowColorSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureBase), t_FlowTexCoordBase, t_FlowTimeInIntervals, u_FlowNormalTexCoordScrollDistance, t_FlowVectorTangent.xy, u_FlowLerpExp);

    float t_Alpha = t_FlowColorSample.a;

    // TODO(jstpierre): Power-up?
    t_Alpha += t_FlowBoundsSample.g;

    t_BaseTexture.rgb = u_FlowColor.rgb * t_Alpha;
    t_BaseTexture.rgb *= t_FlowBoundsSample.b * u_FlowIntensity;

    t_UseBaseAlpha = false;
#else
    t_BaseTexture.rgba = texture(SAMPLER_2D(u_TextureBase), v_TexCoord0.xy).rgba;
#endif

    vec4 t_FinalColor = t_BaseTexture;
    t_FinalColor.a = 1.0;

#if defined USE_DETAIL1
    vec4 t_Detail1 = texture(SAMPLER_2D(u_TextureDetail1), v_TexCoord1.xy);
    int t_Detail1BlendMode = DETAIL1_BLENDMODE;

    if (t_Detail1BlendMode == 0) {
        t_FinalColor.rgb *= t_Detail1.rgb * 2.0;
    } else {
        t_FinalColor.rgb = mix(t_FinalColor.rgb * t_Detail1.rgb, t_FinalColor.rgb, t_BaseTexture.a);
    }

    if (t_Detail1BlendMode == 1)
        t_UseBaseAlpha = false;
#endif

#if defined USE_DETAIL2
    vec4 t_Detail2 = texture(SAMPLER_2D(u_TextureDetail2), v_TexCoord1.zw);
    int t_Detail2BlendMode = DETAIL2_BLENDMODE;

    if (t_Detail2BlendMode == 0) {
#if defined USE_DETAIL1
        t_Detail2.rgb *= t_Detail1.rgb;
#endif
        t_FinalColor.rgb += t_Detail2.rgb;
    } else {
        t_FinalColor.rgb *= t_Detail2.rgb;
    }
#endif

    if (t_UseBaseAlpha)
        t_FinalColor.a *= t_BaseTexture.a;

#if defined ADDITIVE
    t_FinalColor.rgb *= (1.0 + t_FinalColor.a);
    t_FinalColor.a = 1.0;
#endif

    t_FinalColor.a *= CalcCameraFade(v_PositionWorld.w);

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

export class Material_SolidEnergy extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    private wantsDetail = false;
    private wantsFlowmap = false;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$detail1']                     = new P.ParameterTexture(true);
        p['$detail1scale']                = new P.ParameterNumber(1.0);
        p['$detail1frame']                = new P.ParameterNumber(0);
        p['$detail1blendmode']            = new P.ParameterNumber(0, false);
        p['$detail1texturetransform']     = new P.ParameterMatrix();

        p['$detail2']                     = new P.ParameterTexture(true);
        p['$detail2scale']                = new P.ParameterNumber(1.0);
        p['$detail2frame']                = new P.ParameterNumber(0);
        p['$detail2blendmode']            = new P.ParameterNumber(0, false);
        p['$detail2texturetransform']     = new P.ParameterMatrix();

        p['$flowmap']                     = new P.ParameterTexture(false);
        p['$flowmapframe']                = new P.ParameterNumber(0);
        p['$flowmapscrollrate']           = new P.ParameterVector(2);
        p['$flowbounds']                  = new P.ParameterTexture(false);
        p['$flow_noise_texture']          = new P.ParameterTexture(false);
        p['$flow_noise_scale']            = new P.ParameterNumber(1.0);
        p['$flow_lerpexp']                = new P.ParameterNumber(1.0);
        p['$flow_timeintervalinseconds']  = new P.ParameterNumber(0.4);
        p['$flow_worlduvscale']           = new P.ParameterNumber(1.0);
        p['$flow_normaluvscale']          = new P.ParameterNumber(1.0);
        p['$flow_uvscrolldistance']       = new P.ParameterNumber(0.2);
        p['$flow_color']                  = new P.ParameterColor(0);
        p['$flow_color_intensity']        = new P.ParameterNumber(1.0);

        p['$outputintensity']             = new P.ParameterNumber(1.0);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SolidEnergy);

        const isTranslucent = this.paramGetBoolean('$translucent');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        if (this.paramGetVTF('$detail1') !== null) {
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            this.shaderInstance.setDefineBool('USE_DETAIL1', true);
            this.shaderInstance.setDefineString('DETAIL1_BLENDMODE', '' + this.paramGetNumber('$detail1blendmode'));
            this.wantsDetail = true;
        }

        if (this.paramGetVTF('$detail2') !== null) {
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            this.shaderInstance.setDefineBool('USE_DETAIL2', true);
            this.shaderInstance.setDefineString('DETAIL2_BLENDMODE', '' + this.paramGetNumber('$detail2blendmode'));
            this.wantsDetail = true;
        }

        if (this.paramGetVTF('$flowmap') !== null) {
            this.shaderInstance.setDefineBool('USE_FLOWMAP', true);
            this.wantsFlowmap = true;
        }

        this.shaderInstance.setDefineBool('ADDITIVE', this.isAdditive);
        this.shaderInstance.setDefineBool('MODEL', this.paramGetBoolean('$model'));

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        MaterialUtil.resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));

        if (this.wantsDetail) {
            this.paramGetTexture('$detail1').fillTextureMapping(dst[1], this.paramGetInt('$detail1frame'));
            this.paramGetTexture('$detail2').fillTextureMapping(dst[2], this.paramGetInt('$detail2frame'));
        }

        if (this.wantsFlowmap) {
            this.paramGetTexture('$flowmap').fillTextureMapping(dst[3], this.paramGetInt('$flowmapframe'));
            this.paramGetTexture('$flow_noise_texture').fillTextureMapping(dst[4], 0);
            this.paramGetTexture('$flowbounds').fillTextureMapping(dst[5], 0);
        }
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SolidEnergy.ub_ObjectParams, 24);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_SolidEnergy.ub_ObjectParams);
        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        if (this.wantsDetail) {
            offs += this.paramFillTextureMatrix(d, offs, '$detail1texturetransform', false, this.paramGetNumber('$detail1scale'));
            offs += this.paramFillTextureMatrix(d, offs, '$detail2texturetransform', false, this.paramGetNumber('$detail2scale'));
        }

        if (this.wantsFlowmap) {
            offs += fillVec4(d, offs,
                this.paramGetNumber('$flow_worlduvscale'),
                this.paramGetNumber('$flow_normaluvscale'),
                this.paramGetNumber('$flow_noise_scale'),
                this.paramGetNumber('$outputintensity'));

            offs += this.paramFillColor(d, offs, '$flow_color', this.paramGetNumber('$flow_color_intensity'));

            // Compute local time.
            const timeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$flow_timeintervalinseconds') * 2.0);
            offs += fillVec4(d, offs,
                timeInIntervals,
                this.paramGetNumber('$flow_uvscrolldistance'),
                this.paramGetNumber('$flow_lerpexp'));
        }

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
