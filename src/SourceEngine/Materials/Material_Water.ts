
import { mat4 } from "gl-matrix";
import { IsDepthReversed } from "../../gfx/helpers/ReversedDepthHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxMegaStateDescriptor } from "../../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../../gfx/platform/GfxPlatformImpl.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { setSortKeyProgramKey, GfxRendererLayer, makeSortKey, GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import { SourceRenderContext, SourceEngineViewType } from "../Main.js";
import { MaterialCache } from "./MaterialCache.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { MaterialShaderTemplateBase, MaterialUtil, BaseMaterial, fillScaleBias, fillGammaColor } from "./MaterialBase.js";
import * as P from "./MaterialParameters.js";

//#region Water
export const SampleFlowMap = `
vec4 SampleFlowMap(PD_SAMPLER_2D(t_FlowMapTexture), vec2 t_TexCoordBase, float t_FlowTimeInIntervals, float t_TexCoordScrollDistance, vec2 t_FlowVectorTangent, float t_LerpExp) {
    float t_ScrollTime1 = fract(t_FlowTimeInIntervals + 0.0);
    float t_ScrollTime2 = fract(t_FlowTimeInIntervals + 0.5);
    float t_ScrollPhase1 = floor(t_FlowTimeInIntervals) * 0.311;
    float t_ScrollPhase2 = floor(t_FlowTimeInIntervals + 0.5) * 0.311 + 0.5;

    vec2 t_FlowMapTexCoordDisp = t_TexCoordScrollDistance * t_FlowVectorTangent.xy;
    vec2 t_FlowMapTexCoord1 = t_TexCoordBase + t_ScrollPhase1 + (t_ScrollTime1 * t_FlowMapTexCoordDisp.xy);
    vec2 t_FlowMapTexCoord2 = t_TexCoordBase + t_ScrollPhase2 + (t_ScrollTime2 * t_FlowMapTexCoordDisp.xy);

    vec4 t_FlowMapSample1 = texture(PU_SAMPLER_2D(t_FlowMapTexture), t_FlowMapTexCoord1.xy);
    vec4 t_FlowMapSample2 = texture(PU_SAMPLER_2D(t_FlowMapTexture), t_FlowMapTexCoord2.xy);
    float t_FlowMapWeight1 = pow(abs(t_ScrollTime2 * 2.0 - 1.0), t_LerpExp);
    float t_FlowMapWeight2 = pow(abs(t_ScrollTime1 * 2.0 - 1.0), t_LerpExp);
    vec4 t_FlowMapSample = vec4(0.0);
    t_FlowMapSample.rgba += t_FlowMapSample1.rgba * t_FlowMapWeight1;
    t_FlowMapSample.rgba += t_FlowMapSample2.rgba * t_FlowMapWeight2;

    return t_FlowMapSample;
}
`;

export class ShaderTemplate_Water extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;
precision mediump sampler2DArray;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    vec4 u_BumpScaleBias;
#if defined USE_TEXSCROLL
    vec4 u_TexScroll0ScaleBias;
    vec4 u_TexScroll1ScaleBias;
#endif
    vec4 u_RefractTint;
    vec4 u_ReflectTint;
    vec4 u_WaterFogColor;
    Mat4x4 u_ProjectedDepthToWorld;

#if defined USE_FLOWMAP
    vec4 u_BaseTextureScaleBias;
    vec4 u_Misc[3];
#else
    vec4 u_Misc[1];
#endif
};

#define u_RefractAmount (u_RefractTint.a)
#define u_ReflectAmount (u_ReflectTint.a)
#define u_WaterFogRange (u_WaterFogColor.a)

#if defined USE_FLOWMAP

#define u_FlowTexCoordScale                (u_Misc[0].x)
#define u_FlowNormalTexCoordScale          (u_Misc[0].y)
#define u_FlowNoiseTexCoordScale           (u_Misc[0].z)
#define u_FlowColorTexCoordScale           (u_Misc[0].w)

#define u_FlowTimeInIntervals              (u_Misc[1].x)
#define u_FlowColorTimeInIntervals         (u_Misc[1].y)
#define u_FlowNormalTexCoordScrollDistance (u_Misc[1].z)
#define u_FlowColorTexCoordScrollDistance  (u_Misc[1].w)

#define u_FlowBumpStrength                 (u_Misc[2].x)
#define u_FlowColorDisplacementStrength    (u_Misc[2].y)
#define u_FlowColorLerpExp                 (u_Misc[2].z)
#define u_WaterBlendFactor                 (u_Misc[2].w)

#define u_FrameBlend                       (0.0)

#else

#define u_FrameBlend                       (u_Misc[0].x)

#endif

// Refract Coordinates
varying vec3 v_TexCoord0;
// Normal Map / Base Texture, Lightmap
varying vec4 v_TexCoord1;
varying vec3 v_PositionWorld;

layout(binding = 0) uniform sampler2D u_TextureRefract;
layout(binding = 1) uniform sampler2D u_TextureNormalmap;
layout(binding = 2) uniform sampler2D u_TextureReflect;
layout(binding = 3) uniform sampler2D u_TextureBase;
layout(binding = 4) uniform sampler2D u_TextureFlowmap;
layout(binding = 5) uniform sampler2D u_TextureFlowNoise;

layout(binding = 10) uniform sampler2DArray u_TextureLightmap;
layout(binding = 11) uniform samplerCube u_TextureEnvmap;
layout(binding = 14) uniform sampler2D u_TextureFramebufferDepth;

#if defined VERT
void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    // Convert from projected position to texture space.
    // TODO(jstpierre): This could probably be done easier with gl_FragCoord
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xyzw = a_TexCoord01.xyzw;
}
#endif

#if defined FRAG
vec2 SampleFramebufferCoord(vec2 t_TexCoord) {
#if GFX_VIEWPORT_ORIGIN_TL()
    t_TexCoord.y = 1.0 - t_TexCoord.y;
#endif
    return t_TexCoord;
}

float SampleFramebufferDepth(vec2 t_ProjTexCoord) {
    return texture(SAMPLER_2D(u_TextureFramebufferDepth), t_ProjTexCoord).r;
}

bool IsSomethingInFront(float t_DepthSample) {
    if (t_DepthSample ${IsDepthReversed ? `>` : `<`} gl_FragCoord.z)
        return true;

    return false;
}

vec4 CalcPosClipFromViewport(vec3 t_PosViewport) {
    vec4 t_PosClip = vec4(t_PosViewport.xy * 2.0 - 1.0, t_PosViewport.z, 1.0);
#if !GFX_CLIPSPACE_NEAR_ZERO()
    t_PosClip.z = t_PosClip.z * 2.0 - 1.0;
#endif
    return t_PosClip;
}

vec3 CalcPosWorldFromScreen(vec2 t_ProjTexCoord, float t_DepthSample) {
    // Reconstruct world-space position for the sample.
    vec3 t_PosViewport = vec3(t_ProjTexCoord.x, t_ProjTexCoord.y, t_DepthSample);
    vec4 t_PosClip = CalcPosClipFromViewport(t_PosViewport);
    vec4 t_PosWorld = Mul(u_ProjectedDepthToWorld, t_PosClip);
    // Divide by W.
    t_PosWorld.xyz /= t_PosWorld.www;
    return t_PosWorld.xyz;
}

float CalcFogAmountFromScreenPos(vec2 t_ProjTexCoord, float t_DepthSample) {
    vec3 t_DepthSamplePosWorld = CalcPosWorldFromScreen(t_ProjTexCoord, t_DepthSample);

    // Now retrieve the height difference (+Z is up in Source Engine BSP space)
    float t_HeightDifference = v_PositionWorld.z - t_DepthSamplePosWorld.z;

    // Also account for the distance from the eye (emulate "traditional" scattering fog)
    float t_DistanceFromEye = u_CameraPosWorld.z - v_PositionWorld.z;
    float t_FogDepth = saturate(t_HeightDifference / t_DistanceFromEye);

    // float t_PositionClipZ = v_PositionWorld.w;
    // Not quite equivalent since we don't have the near clip plane, but it's close enough and doesn't
    // depend on a certain configuration in our projection matrix.
    float t_PositionClipZ = distance(u_CameraPosWorld.xyz, v_PositionWorld.xyz);

    float t_FogAmount = saturate((t_FogDepth * t_PositionClipZ) / u_WaterFogRange);

    return t_FogAmount;
}

${SampleFlowMap}

vec3 ReconstructNormal(in vec2 t_NormalXY) {
    float t_NormalZ = sqrt(saturate(1.0 - dot(t_NormalXY.xy, t_NormalXY.xy)));
    return vec3(t_NormalXY.xy, t_NormalZ);
}

vec4 SampleBumpmap(PD_SAMPLER_2D(t_Texture0), PD_SAMPLER_2D(t_Texture1), vec2 t_TexCoord, float t_Blend) {
    vec4 t_Sample0 = texture(PU_SAMPLER_2D(t_Texture0), t_TexCoord.xy);
#if defined USE_FLOWMAP
    return t_Sample0;
#else
    vec4 t_Sample1 = texture(PU_SAMPLER_2D(t_Texture1), t_TexCoord.xy);
    return mix(t_Sample0, t_Sample1, t_Blend);
#endif
}

void mainPS() {
    bool use_flowmap = ${MaterialUtil.getDefineBool(m, `USE_FLOWMAP`)};

    vec2 t_BumpmapCoord0 = CalcScaleBias(v_TexCoord1.xy, u_BumpScaleBias);

#if defined USE_FLOWMAP

    vec2 t_FlowTexCoord = t_BumpmapCoord0.xy * u_FlowTexCoordScale;

    vec2 t_TexCoordWorldBase = vec2(v_PositionWorld.x, -v_PositionWorld.y);
    vec2 t_FlowNoiseTexCoord = t_TexCoordWorldBase * u_FlowNoiseTexCoordScale;
    vec4 t_FlowNoiseSample = texture(SAMPLER_2D(u_TextureFlowNoise), t_FlowNoiseTexCoord.xy);

    vec4 t_FlowSample = texture(SAMPLER_2D(u_TextureFlowmap), t_FlowTexCoord.xy);
    vec2 t_FlowVectorTangent = UnpackUnsignedNormalMap(t_FlowSample).rg;

    vec2 t_FlowNormalTexCoordBase = t_TexCoordWorldBase * u_FlowNormalTexCoordScale;
    float t_FlowTimeInIntervals = u_FlowTimeInIntervals + t_FlowNoiseSample.g;
    float t_FlowNormalLerpExp = 1.0;
    vec4 t_FlowNormalSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureNormalmap), t_FlowNormalTexCoordBase.xy, t_FlowTimeInIntervals, u_FlowNormalTexCoordScrollDistance, t_FlowVectorTangent.xy, t_FlowNormalLerpExp);

    vec2 t_FlowNormalXY = UnpackUnsignedNormalMap(t_FlowNormalSample).xy * (length(t_FlowVectorTangent.xy) + 0.1) * u_FlowBumpStrength;
    vec3 t_BumpmapNormal = ReconstructNormal(t_FlowNormalXY);
    float t_BumpmapStrength = 1.0;

#else

    // Sample our normal map with scroll offsets.
    vec4 t_BumpmapSample0 = SampleBumpmap(PP_SAMPLER_2D(u_TextureNormalmap), PP_SAMPLER_2D(u_TextureFlowmap), t_BumpmapCoord0, u_FrameBlend);
#if defined USE_TEXSCROLL
    vec2 t_BumpmapCoord1 = CalcScaleBias(vec2(v_TexCoord1.x + v_TexCoord1.y, -v_TexCoord1.x + v_TexCoord1.y) * 0.1, u_TexScroll0ScaleBias);
    vec4 t_BumpmapSample1 = SampleBumpmap(PP_SAMPLER_2D(u_TextureNormalmap), PP_SAMPLER_2D(u_TextureFlowmap), t_BumpmapCoord1, u_FrameBlend);
    vec2 t_BumpmapCoord2 = CalcScaleBias(v_TexCoord1.yx * 0.45, u_TexScroll1ScaleBias);
    vec4 t_BumpmapSample2 = SampleBumpmap(PP_SAMPLER_2D(u_TextureNormalmap), PP_SAMPLER_2D(u_TextureFlowmap), t_BumpmapCoord2, u_FrameBlend);
    vec4 t_BumpmapSample = (0.33 * (t_BumpmapSample0 + t_BumpmapSample1 + t_BumpmapSample2));
#else
    vec4 t_BumpmapSample = t_BumpmapSample0;
#endif
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;
    float t_BumpmapStrength = t_BumpmapSample.a;

#endif

    // It's assumed the surface normal is facing up, so this is roughly correct.
    vec3 t_NormalWorld = t_BumpmapNormal.xyz;

    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    float t_NoV = saturate(dot(t_WorldDirectionToEye.xyz, t_NormalWorld.xyz));
    float t_Reflectance = 0.2;
    float t_Fresnel = mix(CalcFresnelTerm5(t_NoV), 1.0, t_Reflectance);

    // Compute reflection and refraction colors.

    vec3 t_DiffuseLighting = vec3(1.0);

    bool use_lightmap_water_fog = ${MaterialUtil.getDefineBool(m, `USE_LIGHTMAP_WATER_FOG`)};
    if (use_lightmap_water_fog) {
        vec3 t_LightmapColor = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.zw, 0.0)));
        t_DiffuseLighting.rgb *= t_LightmapColor;
    }
    vec3 t_WaterFogColor = u_WaterFogColor.rgb * t_DiffuseLighting.rgb;

    // Compute a 2D offset vector in view space.
    // TODO(jstpierre): Rotate bumpmap normal to be in camera space.
    vec2 t_TexCoordBumpOffset = t_BumpmapNormal.xy * t_BumpmapStrength;

    vec3 t_RefractColor;
    bool use_refract = ${MaterialUtil.getDefineBool(m, `USE_REFRACT`)};
    if (use_refract) {
        float t_RefractFogBendAmount = CalcFogAmountFromScreenPos(t_ProjTexCoord, SampleFramebufferDepth(SampleFramebufferCoord(t_ProjTexCoord)));
        float t_RefractStrength = u_RefractAmount * (1.0 - t_RefractFogBendAmount);
        vec2 t_RefractTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_RefractStrength);

        float t_RefractFogAmount;
        float t_RefractDepthSample = SampleFramebufferDepth(SampleFramebufferCoord(t_RefractTexCoord));
        if (IsSomethingInFront(t_RefractDepthSample)) {
            // Something's in front, just use the original...
            t_RefractTexCoord = t_ProjTexCoord;
            t_RefractFogAmount = t_RefractFogBendAmount;
        } else {
            t_RefractFogAmount = CalcFogAmountFromScreenPos(t_RefractTexCoord, t_RefractDepthSample);
        }

        vec4 t_RefractSample = texture(SAMPLER_2D(u_TextureRefract), SampleFramebufferCoord(t_RefractTexCoord));

        // Our refraction framebuffer has been tone-mapped. Divide back out to get linear.
        t_RefractSample.rgb /= u_ToneMapScale;

        t_RefractColor.rgb = t_RefractSample.rgb * u_RefractTint.rgb;

        t_RefractColor.rgb = mix(t_RefractColor.rgb, t_WaterFogColor.rgb, t_RefractFogAmount);
    } else {
        t_RefractColor.rgb = t_WaterFogColor.rgb;
    }

    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_WorldDirectionToEye);

    vec3 t_ReflectColor = vec3(0.0);

    float t_ReflectAmount = u_ReflectAmount;
    if (t_ReflectAmount > 0.0) {
        vec2 t_ReflectTexCoord = t_ProjTexCoord + (t_TexCoordBumpOffset.xy * t_ReflectAmount);

        // Reflection texture is stored upside down
        t_ReflectTexCoord.y = 1.0 - t_ReflectTexCoord.y;

        vec4 t_ReflectSample = texture(SAMPLER_2D(u_TextureReflect), SampleFramebufferCoord(t_ReflectTexCoord));

        // Our reflection framebuffer has been tone-mapped. Divide back out to get linear.
        t_ReflectSample.rgb /= u_ToneMapScale;

        t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
    } else if (t_ReflectAmount < 0.0) {
        vec4 t_ReflectSample = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection) * g_EnvmapScale;
        t_ReflectColor = t_ReflectSample.rgb * u_ReflectTint.rgb;
    }

    vec4 t_FinalColor;

#if defined USE_FLOWMAP
    bool use_flowmap_basetexture = ${MaterialUtil.getDefineBool(m, `USE_FLOWMAP_BASETEXTURE`)};
    if (use_flowmap_basetexture) {
        // Parallax scum layer
        float t_ParallaxStrength = t_FlowNormalSample.a * u_FlowColorDisplacementStrength;
        vec3 t_InteriorDirection = t_ParallaxStrength * (t_WorldDirectionToEye.xyz - t_NormalWorld.xyz);
        vec2 t_FlowColorTexCoordBase = t_TexCoordWorldBase.xy * u_FlowColorTexCoordScale + t_InteriorDirection.xy;
        float t_FlowColorTimeInIntervals = u_FlowColorTimeInIntervals + t_FlowNoiseSample.g;
        vec4 t_FlowColorSample = SampleFlowMap(PP_SAMPLER_2D(u_TextureBase), t_FlowColorTexCoordBase, t_FlowColorTimeInIntervals, u_FlowColorTexCoordScrollDistance, t_FlowVectorTangent.xy, u_FlowColorLerpExp);

        vec4 t_FlowColor = t_FlowColorSample.rgba;

        // Mask by flowmap alpha and apply light
        t_FlowColor.rgba *= t_FlowSample.a;
        t_FlowColor.rgb *= t_DiffuseLighting.rgb;

        // Sludge can either be below or on top of the water, according to base texture alpha.
        //   0.0 - 0.5 = translucency, and 0.5 - 1.0 = above water
        t_RefractColor.rgb = mix(t_RefractColor.rgb, t_FlowColor.rgb, saturate(invlerp(0.0, 0.5, t_FlowColor.a)));

        float t_AboveWater = 1.0 - smoothstep(0.5, 0.7, t_FlowColor.a);
        t_Fresnel = saturate(t_Fresnel * t_AboveWater);
    }
#endif

    t_FinalColor.rgb = t_RefractColor.rgb + (t_ReflectColor.rgb * t_Fresnel);

#if defined USE_FLOWMAP
    t_FinalColor.a = u_WaterBlendFactor;
#endif

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
    }
}

export class Material_Water extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram | null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    private wantsTexScroll = false;
    private wantsFlowmap = false;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new P.ParameterTexture();
        p['$bumpframe']                    = new P.ParameterNumber(0);
        p['$bumptransform']                = new P.ParameterMatrix();
        p['$envmap']                       = new P.ParameterTexture(true, true);
        p['$envmapframe']                  = new P.ParameterNumber(0);
        p['$refracttexture']               = new P.ParameterTexture(true, false, '_rt_WaterRefraction');
        p['$refracttint']                  = new P.ParameterColor(1, 1, 1);
        p['$refractamount']                = new P.ParameterNumber(0);
        p['$reflecttexture']               = new P.ParameterTexture(true, false, '_rt_WaterReflection');
        p['$reflecttint']                  = new P.ParameterColor(1, 1, 1);
        p['$reflectamount']                = new P.ParameterNumber(0.8);
        p['$scroll1']                      = new P.ParameterVector(3);
        p['$scroll2']                      = new P.ParameterVector(3);
        p['$cheapwaterstartdistance']      = new P.ParameterNumber(500.0);
        p['$cheapwaterenddistance']        = new P.ParameterNumber(1000.0);

        p['$forcecheap']                   = new P.ParameterBoolean(false, false);
        p['$forceenvmap']                  = new P.ParameterBoolean(false, false);

        p['$flowmap']                      = new P.ParameterTexture(false, false);
        p['$flowmapframe']                 = new P.ParameterNumber(0);
        p['$flowmapscrollrate']            = new P.ParameterVector(2);
        p['$flow_worlduvscale']            = new P.ParameterNumber(1);
        p['$flow_normaluvscale']           = new P.ParameterNumber(1);
        p['$flow_bumpstrength']            = new P.ParameterNumber(1);
        p['$flow_noise_texture']           = new P.ParameterTexture(false, false);
        p['$flow_noise_scale']             = new P.ParameterNumber(0.0002);
        p['$flow_timeintervalinseconds']   = new P.ParameterNumber(0.4);
        p['$flow_uvscrolldistance']        = new P.ParameterNumber(0.2);

        p['$color_flow_uvscale']           = new P.ParameterNumber(1);
        p['$color_flow_timeintervalinseconds'] = new P.ParameterNumber(0.4);
        p['$color_flow_uvscrolldistance']  = new P.ParameterNumber(0.2);
        p['$color_flow_lerpexp']           = new P.ParameterNumber(1);
        p['$color_flow_displacebynormalstrength'] = new P.ParameterNumber(0.0025);

        p['$lightmapwaterfog']             = new P.ParameterBoolean(false, false);
        p['$waterblendfactor']             = new P.ParameterNumber(1.0);
        p['$fogcolor']                     = new P.ParameterColor(0, 0, 0);

        // Hacky way to get RT depth
        p['$depthtexture']                 = new P.ParameterTexture(false, false, '_rt_Depth');
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = this.shaderInstance.getGfxProgram(cache);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Water);

        if (this.paramGetVTF('$flowmap') !== null) {
            this.wantsFlowmap = true;
            this.shaderInstance.setDefineBool('USE_FLOWMAP', true);

            if (this.paramGetVTF('$basetexture') !== null)
                this.shaderInstance.setDefineBool('USE_FLOWMAP_BASETEXTURE', true);

            if (this.paramGetBoolean('$lightmapwaterfog')) {
                this.shaderInstance.setDefineBool('USE_LIGHTMAP_WATER_FOG', true);
                this.wantsLightmap = true;
            }

            this.isTranslucent = false;
        } else {
            if (this.paramGetVector('$scroll1').get(0) !== 0) {
                this.wantsTexScroll = true;
                this.shaderInstance.setDefineBool('USE_TEXSCROLL', true);
            }
        }

        if (this.paramGetVTF('$refracttexture') !== null)
            this.shaderInstance.setDefineBool('USE_REFRACT', true);

        this.isIndirect = this.textureIsIndirect('$refracttexture') || this.textureIsIndirect('$reflecttexture');

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, lightmapPageIndex: number | null = null): void {
        assert(this.isMaterialLoaded());

        this.setupOverrideSceneParams(renderContext, renderInst);

        const textureMappings = MaterialUtil.textureMappings;
        MaterialUtil.resetTextureMappings(textureMappings);

        this.paramGetTexture('$refracttexture').fillTextureMapping(textureMappings[0], 0);
        this.paramGetTexture('$normalmap').fillTextureMapping(textureMappings[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$reflecttexture').fillTextureMapping(textureMappings[2], 0);

        this.paramGetTexture('$basetexture').fillTextureMapping(textureMappings[3], this.paramGetInt('$frame'));
        this.paramGetTexture('$flowmap').fillTextureMapping(textureMappings[4], this.paramGetInt('$flowmapframe'));
        this.paramGetTexture('$flow_noise_texture').fillTextureMapping(textureMappings[5], 0);

        renderContext.lightmapManager.fillTextureMapping(textureMappings[10], lightmapPageIndex);
        this.paramGetTexture('$envmap').fillTextureMapping(textureMappings[11], this.paramGetInt('$envmapframe'));
        this.paramGetTexture('$depthtexture').fillTextureMapping(textureMappings[14], 0);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Water.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Water.ub_ObjectParams);
        offs += this.paramFillScaleBias(d, offs, '$bumptransform');

        if (this.wantsTexScroll) {
            const m = MaterialUtil.scratchMat4a;
            mat4.identity(m);
            m[0] = this.texCoord0Scale[0];
            m[5] = this.texCoord0Scale[1];

            m[12] = this.paramGetVector('$scroll1').get(0) * renderContext.globalTime;
            m[13] = this.paramGetVector('$scroll1').get(1) * renderContext.globalTime;
            offs += fillScaleBias(d, offs, m);

            m[12] = this.paramGetVector('$scroll2').get(0) * renderContext.globalTime;
            m[13] = this.paramGetVector('$scroll2').get(1) * renderContext.globalTime;
            offs += fillScaleBias(d, offs, m);
        }

        const forceEnvMap = this.paramGetBoolean('$forceenvmap');
        const forceCheap = this.paramGetBoolean('$forcecheap');
        const useExpensiveReflect = renderContext.currentView.useExpensiveWater && !forceEnvMap && !forceCheap;

        let reflectAmount = this.paramGetNumber('$reflectamount');
        if (!useExpensiveReflect)
            reflectAmount = -1.0;

        offs += this.paramFillGammaColor(d, offs, '$refracttint', this.paramGetNumber('$refractamount'));
        offs += this.paramFillGammaColor(d, offs, '$reflecttint', reflectAmount);

        const fogStart = this.paramGetNumber('$fogstart');
        const fogEnd = this.paramGetNumber('$fogend');
        // The start is actually unused, only the range is used...
        const fogRange = fogEnd - fogStart;

        this.paramGetVector('$fogcolor').fillColor(MaterialUtil.scratchColor, fogRange);
        offs += fillGammaColor(d, offs, MaterialUtil.scratchColor);

        // This will take us from -1...1 to world space position.
        mat4.invert(MaterialUtil.scratchMat4a, renderContext.currentView.clipFromWorldMatrix);
        offs += fillMatrix4x4(d, offs, MaterialUtil.scratchMat4a);

        if (this.wantsFlowmap) {
            offs += this.paramFillScaleBias(d, offs, '$basetexturetransform');

            // Texture coordinate scales
            offs += fillVec4(d, offs,
                1.0 / this.paramGetNumber('$flow_worlduvscale'),
                1.0 / this.paramGetNumber('$flow_normaluvscale'),
                this.paramGetNumber('$flow_noise_scale'),
                1.0 / this.paramGetNumber('$color_flow_uvscale'));

            // Compute local time.
            const timeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$flow_timeintervalinseconds') * 2.0);
            const colorTimeInIntervals = (renderContext.globalTime) / (this.paramGetNumber('$color_flow_timeintervalinseconds') * 2.0);
            offs += fillVec4(d, offs,
                timeInIntervals,
                colorTimeInIntervals,
                this.paramGetNumber('$flow_uvscrolldistance'),
                this.paramGetNumber('$color_flow_uvscrolldistance'));

            offs += fillVec4(d, offs,
                this.paramGetNumber('$flow_bumpstrength'),
                this.paramGetNumber('$color_flow_displacebynormalstrength'),
                this.paramGetNumber('$color_flow_lerpexp'),
                this.paramGetNumber('$waterblendfactor'));
        } else {
            this.paramGetTexture('$normalmap').fillTextureMapping(textureMappings[4], this.paramGetInt('$bumpframe') + 1);
            offs += fillVec4(d, offs, this.paramGetNumber('$bumpframe') % 1);
        }

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public override isMaterialVisible(renderContext: SourceRenderContext): boolean {
        if (!super.isMaterialVisible(renderContext))
            return false;

        if (renderContext.currentView.viewType === SourceEngineViewType.WaterReflectView)
            return false;

        return true;
    }
}
//#endregion
