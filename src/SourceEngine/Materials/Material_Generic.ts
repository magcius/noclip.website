
import { colorCopy, colorScale, OpaqueBlack } from "../../Color.js";
import { AABB } from "../../Geometry.js";
import { scaleMatrix } from "../../MathHelpers.js";
import { TextureMapping } from "../../TextureHolder.js";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillColor, fillMatrix4x2, fillMatrix4x4, fillVec3v, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxDevice, GfxMegaStateDescriptor, GfxProgram } from "../../gfx/platform/GfxPlatform.js";
import type { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { GfxRendererLayer, GfxRenderInst, makeSortKey, setSortKeyProgramKey } from "../../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists } from "../../util.js";
import { SourceEngineViewType } from "../Main.js";
import type { SourceRenderContext } from "../Main.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { AlphaBlendMode, BaseMaterial, LateBindingTexture, MaterialShaderTemplateBase, MaterialUtil, RenderMode, StaticLightingMode } from "./MaterialBase.js";
import type { MaterialCache } from "./MaterialCache.js";
import * as P from "./MaterialParameters.js";
import { ProjectedLight, ShaderWorldLightType } from "./WorldLight.js";

//#region Generic (LightmappedGeneric, UnlitGeneric, VertexLitGeneric, WorldVertexTransition)
export class ShaderTemplate_Generic extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public static MaxDynamicWorldLights = 4;

    public override generateProgramString(m: Map<string, string>): string {
        return `
precision mediump float;
precision mediump sampler2DArray;
precision mediump sampler2DShadow;

${MaterialShaderTemplateBase.Common}

struct WorldLight {
    // w = ShaderWorldLightType.
    vec4 Position;
    // w = Spot exponent
    vec4 Color;
    // w = stopdot
    vec4 DistAttenuation;
    // Direction for directional / spotlight. w = stopdot2
    vec4 Direction;
};

layout(std140) uniform ub_ObjectParams {
#if defined USE_AMBIENT_CUBE
    // TODO(jstpierre): Pack this more efficiently?
    vec4 u_AmbientCube[6];
#endif
#if defined USE_DYNAMIC_LIGHTING
    // We support up to N lights.
    WorldLight u_WorldLights[${ShaderTemplate_Generic.MaxDynamicWorldLights}];
#endif
    Mat2x4 u_BaseTextureTransform;
#if defined USE_BUMPMAP
    Mat2x4 u_BumpmapTransform;
#endif
#if defined USE_BUMPMAP2
    Mat2x4 u_Bumpmap2Transform;
#endif
#if defined USE_DETAIL
    Mat2x4 u_DetailTextureTransform;
#endif
#if defined USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#if defined USE_BLEND_MODULATE
    vec4 u_BlendModulateScaleBias;
#endif
#if defined USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnelLightScale;
#endif
#if defined USE_SELFILLUM
    vec4 u_SelfIllumTint;
#endif
#if defined USE_SELFILLUM_FRESNEL
    vec4 u_SelfIllumFresnel;
#endif
#if defined USE_PHONG
    vec4 u_FresnelRangeSpecAlbedoBoost;
    vec4 u_SpecTintBoost;
#endif
#if defined USE_PROJECTED_LIGHT
    Mat4x4 u_ProjectedLightFromWorldMatrix;
    vec4 u_ProjectedLightColor;
    vec4 u_ProjectedLightOrigin;
#endif
#if defined USE_TREE_SWAY

#define u_TreeSwayWindDir              (u_TreeSwayParam[0].xy)
#define u_TreeSwayTime                 (u_TreeSwayParam[0].z)
#define u_TreeSwaySpeed                (u_TreeSwayParam[0].w)

#define u_TreeSwayHeight               (u_TreeSwayParam[1].x)
#define u_TreeSwayStartHeight          (u_TreeSwayParam[1].y)
#define u_TreeSwayRadius               (u_TreeSwayParam[1].z)
#define u_TreeSwayStartRadius          (u_TreeSwayParam[1].w)

#define u_TreeSwayIntensity            (u_TreeSwayParam[2].x)
#define u_TreeSwayIntensityPow         (u_TreeSwayParam[2].y)
#define u_TreeSwayFastScale            (u_TreeSwayParam[2].z)

#define u_TreeSwayScrumbleIntensity    (u_TreeSwayParam[3].x)
#define u_TreeSwayScrumbleIntensityPow (u_TreeSwayParam[3].y)
#define u_TreeSwayScrumbleFrequency    (u_TreeSwayParam[3].z)
#define u_TreeSwayScrumbleSpeed        (u_TreeSwayParam[3].w)

// TODO(jstpierre): If we combine time and speed, I think we can lose a vec4 here...
#define u_TreeSwaySpeedLerpStart       (u_TreeSwayParam[4].x)
#define u_TreeSwaySpeedLerpEnd         (u_TreeSwayParam[4].y)
    vec4 u_TreeSwayParam[5];

#endif

    vec4 u_ModulationColor;

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)
#define u_SpecExponentFactor (u_Misc[0].z)
#define u_SeamlessScale      (u_Misc[0].w)
    vec4 u_Misc[1];
};

#if defined USE_BUMPMAP
    #define HAS_FULL_TANGENTSPACE 1
#endif

// Base, Raw Coords
varying vec4 v_TexCoord0;
// Lightmap / Decal
varying vec2 v_TexCoord1;

// w contains BaseTexture2 blend factor.
varying vec4 v_PositionWorld;
varying vec4 v_Color;
varying vec3 v_DiffuseLighting0;

#if defined USE_STATIC_VERTEX_LIGHTING_3
varying vec3 v_DiffuseLighting1;
varying vec3 v_DiffuseLighting2;
#endif

#if defined HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;
#if defined USE_DYNAMIC_PIXEL_LIGHTING
varying vec4 v_LightAtten;
#endif

layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureBase2;
layout(binding = 2) uniform sampler2D u_TextureBumpmap;
layout(binding = 3) uniform sampler2D u_TextureBumpmap2;
layout(binding = 4) uniform sampler2D u_TextureBumpMask;
layout(binding = 5) uniform sampler2D u_TextureDetail;
layout(binding = 6) uniform sampler2D u_TextureEnvmapMask;
layout(binding = 7) uniform sampler2D u_TextureSpecularExponent;
layout(binding = 8) uniform sampler2D u_TextureSelfIllumMask;
layout(binding = 9) uniform sampler2D u_TextureBlendModulate;
layout(binding = 10) uniform sampler2DArray u_TextureLightmap;
layout(binding = 11) uniform samplerCube u_TextureEnvmap;
layout(binding = 12) uniform sampler2DShadow u_TextureProjectedLightDepth;
layout(binding = 13) uniform sampler2D u_TextureProjectedLight;

float ApplyAttenuation(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}

struct DiffuseLightInput {
    vec3 PositionWorld;
    vec3 NormalWorld;
    vec4 LightAttenuation;
    bool HalfLambert;
};

float WorldLightCalcAttenuation(in WorldLight t_WorldLight, in vec3 t_PositionWorld) {
    int t_LightType = int(t_WorldLight.Position.w);

    float t_Attenuation = 1.0;
    bool t_UseDistanceAttenuation = (t_LightType == ${ShaderWorldLightType.Point} || t_LightType == ${ShaderWorldLightType.Spot});
    bool t_UseAngleAttenuation = (t_LightType == ${ShaderWorldLightType.Spot});

    if (t_UseDistanceAttenuation) {
        float t_Distance = distance(t_WorldLight.Position.xyz, t_PositionWorld);
        t_Attenuation *= 1.0 / ApplyAttenuation(t_WorldLight.DistAttenuation.xyz, t_Distance);

        if (t_UseAngleAttenuation) {
            // Unpack spot parameters
            float t_Exponent = t_WorldLight.Color.w;
            float t_Stopdot = t_WorldLight.DistAttenuation.w;
            float t_Stopdot2 = t_WorldLight.Direction.w;

            vec3 t_LightDirectionWorld = normalize(t_WorldLight.Position.xyz - t_PositionWorld);
            float t_AngleDot = dot(t_WorldLight.Direction.xyz, -t_LightDirectionWorld);

            // invlerp
            float t_AngleAttenuation = max(invlerp(t_Stopdot2, t_Stopdot, t_AngleDot), 0.01);
            t_AngleAttenuation = saturate(pow(t_AngleAttenuation, t_Exponent));

            t_Attenuation *= t_AngleAttenuation;
        }
    }

    return t_Attenuation;
}

vec3 WorldLightCalcDirection(in WorldLight t_WorldLight, in vec3 t_PositionWorld) {
    int t_LightType = int(t_WorldLight.Position.w);

    if (t_LightType == ${ShaderWorldLightType.Directional}) {
        // Directionals just have incoming light direction stored in Direction field.
        return -t_WorldLight.Direction.xyz;
    } else {
        return normalize(t_WorldLight.Position.xyz - t_PositionWorld);
    }
}

float WorldLightCalcVisibility(in WorldLight t_WorldLight, in vec3 t_PositionWorld, in vec3 t_NormalWorld, bool t_HalfLambert) {
    vec3 t_LightDirectionWorld = WorldLightCalcDirection(t_WorldLight, t_PositionWorld);

    float t_NoL = dot(t_NormalWorld, t_LightDirectionWorld);
    if (t_HalfLambert) {
        // Valve's Half-Lambert / Wrapped lighting term.
        t_NoL = t_NoL * 0.5 + 0.5;
        t_NoL = t_NoL * t_NoL;
        return t_NoL;
    } else {
        return max(0.0, t_NoL);
    }
}

vec3 WorldLightCalcDiffuse(in vec3 t_PositionWorld, in vec3 t_NormalWorld, bool t_HalfLambert, in float t_Attenuation, in WorldLight t_WorldLight) {
    int t_LightType = int(t_WorldLight.Position.w);

    if (t_LightType == ${ShaderWorldLightType.None})
        return vec3(0.0);

    float t_Visibility = WorldLightCalcVisibility(t_WorldLight, t_PositionWorld, t_NormalWorld, t_HalfLambert);
    return t_WorldLight.Color.rgb * t_Attenuation * t_Visibility;
}

#if defined USE_DYNAMIC_LIGHTING
vec4 WorldLightCalcAllAttenuation(in vec3 t_PositionWorld) {
    vec4 t_FinalAtten = vec4(0.0);
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        t_FinalAtten[i] = WorldLightCalcAttenuation(u_WorldLights[i], t_PositionWorld);
    return t_FinalAtten;
}

vec3 WorldLightCalcAllDiffuse(in DiffuseLightInput t_DiffuseLightInput) {
    vec3 t_FinalLight = vec3(0.0);
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        t_FinalLight += WorldLightCalcDiffuse(t_DiffuseLightInput.PositionWorld, t_DiffuseLightInput.NormalWorld, t_DiffuseLightInput.HalfLambert, t_DiffuseLightInput.LightAttenuation[i], u_WorldLights[i]);
    return t_FinalLight;
}
#endif

#if defined USE_AMBIENT_CUBE
vec3 AmbientLight(in vec3 t_NormalWorld) {
    vec3 t_Weight = t_NormalWorld * t_NormalWorld;
    bvec3 t_Negative = lessThan(t_NormalWorld, vec3(0.0));
    return (
        t_Weight.x * u_AmbientCube[t_Negative.x ? 1 : 0].rgb +
        t_Weight.y * u_AmbientCube[t_Negative.y ? 3 : 2].rgb +
        t_Weight.z * u_AmbientCube[t_Negative.z ? 5 : 4].rgb
    );
}
#endif

void CalcTreeSway(inout vec3 t_PositionLocal) {
#if defined VERT && defined USE_TREE_SWAY
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    float t_WindIntensity = length(u_TreeSwayWindDir);
    vec3 t_WindDirLocal = (vec3(u_TreeSwayWindDir, 0.0) * t_WorldFromLocalMatrix).xyz;

    vec3 t_PosOffs = vec3(0.0);

    vec3 t_OriginWorld = t_WorldFromLocalMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float t_TimeOffset = dot(t_OriginWorld, vec3(1.0)) * 19.0;

    float t_SwayTime = (u_TreeSwayTime + t_TimeOffset) * u_TreeSwaySpeed;
    float t_SpeedLerp = smoothstep(u_TreeSwaySpeedLerpStart, u_TreeSwaySpeedLerpEnd, t_WindIntensity);

    float t_ScaleHeight = saturate(invlerp(t_PositionLocal.z, u_TreeSwayHeight * u_TreeSwayStartHeight, u_TreeSwayHeight));

    float t_TrunkSin = mix(sin(t_SwayTime), sin(u_TreeSwayFastScale * t_SwayTime), t_SpeedLerp);
    float t_TrunkSwayIntensity = (u_TreeSwayIntensity * pow(t_ScaleHeight, u_TreeSwayIntensityPow)) * (t_TrunkSin + 0.1);
    t_PosOffs.xyz += t_WindDirLocal * t_TrunkSwayIntensity;

    if (t_ScaleHeight > 0.0) {
        float t_ScaleRadius = saturate(invlerp(length(t_PositionLocal), u_TreeSwayRadius * u_TreeSwayStartRadius, u_TreeSwayRadius));

        float t_BranchScale = 1.0 - abs(dot(normalize(t_WindDirLocal), vec3(normalize(t_PositionLocal.xy), 0.0)));
        float t_BranchSin = mix(sin(2.31 * t_SwayTime), sin(2.41 * u_TreeSwayFastScale * t_SwayTime), t_SpeedLerp);
        float t_BranchSwayIntensity = u_TreeSwayIntensity * t_BranchScale * t_ScaleRadius * (t_BranchSin + 0.4);
        t_PosOffs.xyz += t_WindDirLocal * t_BranchSwayIntensity;

        vec3 t_ScrumblePhase = normalize(t_PositionLocal.yzx) * u_TreeSwayScrumbleFrequency;
        vec3 t_ScrumbleScale = vec3(u_TreeSwayIntensity * pow(t_ScaleRadius, u_TreeSwayScrumbleIntensityPow));
        t_PosOffs.xyz += t_WindIntensity * t_ScrumbleScale * sin(u_TreeSwayScrumbleSpeed * u_TreeSwayTime + t_ScrumblePhase + t_TimeOffset);
    }

    t_PositionLocal.xyz += t_PosOffs.xyz;
#endif
}

#if defined VERT
void mainVS() {
    vec3 t_PositionLocal = a_Position;
    CalcTreeSway(t_PositionLocal);

    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(t_PositionLocal, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);

    vec3 t_NormalWorld = normalize(t_WorldFromLocalMatrix * vec4(a_Normal.xyz, 0.0));

#if defined USE_VERTEX_COLOR
    v_Color = a_Color;
#else
    v_Color = vec4(1.0);
#endif

    v_DiffuseLighting0.rgb = vec3(0.0);

#if !defined USE_DYNAMIC_LIGHTING && !defined USE_STATIC_VERTEX_LIGHTING
    // If we don't have any lighting, it's fullbright.
    v_DiffuseLighting0.rgb = vec3(1.0);
#endif

#if defined USE_DYNAMIC_LIGHTING
    vec4 t_LightAtten = WorldLightCalcAllAttenuation(t_PositionWorld.xyz);
#endif

#if defined USE_STATIC_VERTEX_LIGHTING
    // Static vertex lighting should already include ambient lighting.
    // 2.0 here is overbright.
    v_DiffuseLighting0.rgb = GammaToLinear(a_StaticVertexLighting0 * 2.0);

#if defined USE_STATIC_VERTEX_LIGHTING_3
    v_DiffuseLighting1.rgb = GammaToLinear(a_StaticVertexLighting1 * 2.0);
    v_DiffuseLighting2.rgb = GammaToLinear(a_StaticVertexLighting2 * 2.0);
#endif
#endif

#if defined USE_DYNAMIC_VERTEX_LIGHTING
#if defined USE_AMBIENT_CUBE
    v_DiffuseLighting0.rgb += AmbientLight(t_NormalWorld);
#endif

    bool use_half_lambert = ${MaterialUtil.getDefineBool(m, 'USE_HALF_LAMBERT')};

    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = t_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = t_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = use_half_lambert;
    vec3 t_DiffuseLighting = WorldLightCalcAllDiffuse(t_DiffuseLightInput);
    v_DiffuseLighting0.rgb += t_DiffuseLighting;
#endif

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    v_LightAtten.xyzw = t_LightAtten;
#endif

#if defined USE_MODULATIONCOLOR_ALPHA
    v_Color.a *= u_ModulationColor.a;
#endif

#if defined USE_BASETEXTURE2
    // This is the BaseTexture2 blend factor, smuggled through using unobvious means.
    v_PositionWorld.w = a_Normal.w;
#endif

#if defined HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = normalize(t_WorldFromLocalMatrix * vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = UnpackMatrix(u_BaseTextureTransform) * vec4(a_TexCoord01.xy, 1.0, 1.0);
    v_TexCoord0.zw = a_TexCoord01.xy;
#if defined USE_LIGHTMAP || defined USE_DECAL
    v_TexCoord1.xy = a_TexCoord01.zw;
#endif
}
#endif

#if defined FRAG

#define DETAIL_BLEND_MODE_MUL_DETAIL2                             (0)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE                            (1)
#define DETAIL_BLEND_MODE_DETAIL_OVER_BASE                        (2)
#define DETAIL_BLEND_MODE_FADE                                    (3)
#define DETAIL_BLEND_MODE_BASE_OVER_DETAIL                        (4)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM                  (5)
#define DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE   (6)
#define DETAIL_BLEND_MODE_MOD2X_SELECT_TWO_PATTERNS               (7)
#define DETAIL_BLEND_MODE_MULTIPLY                                (8)
#define DETAIL_BLEND_MODE_MASK_BASE_BY_DETAIL_ALPHA               (9)
#define DETAIL_BLEND_MODE_SSBUMP_BUMP                             (10)
#define DETAIL_BLEND_MODE_SSBUMP_NOBUMP                           (11)

vec4 CalcDetail(in vec4 t_BaseTexture, in vec4 t_DetailTexture) {
    bool use_detail = ${MaterialUtil.getDefineBool(m, 'USE_DETAIL')};
    if (!use_detail)
        return t_BaseTexture;

    int t_BlendMode = ${MaterialUtil.getDefineString(m, 'DETAIL_BLEND_MODE')};
    float t_BlendFactor = u_DetailBlendFactor;

    if (t_BlendMode == DETAIL_BLEND_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE) {
        return t_BaseTexture + t_DetailTexture * t_BlendFactor;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_DETAIL_OVER_BASE) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, t_BlendFactor * t_DetailTexture.a), t_BaseTexture.a);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_FADE) {
        return mix(t_BaseTexture, t_DetailTexture, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_BASE_OVER_DETAIL) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, (t_BlendFactor * (1.0 - t_BaseTexture.a))), t_DetailTexture.a);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_MULTIPLY) {
        return mix(t_BaseTexture, t_BaseTexture * t_DetailTexture, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_MOD2X_SELECT_TWO_PATTERNS) {
        vec4 t_DetailPattern = vec4(mix(t_DetailTexture.r, t_DetailTexture.a, t_BaseTexture.a));
        return t_BaseTexture * mix(vec4(1.0), t_DetailPattern * 2.0, t_BlendFactor);
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM || t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Done in Post-Lighting.
        return t_BaseTexture;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
        // Done as part of bumpmapping.
        return t_BaseTexture;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_SSBUMP_NOBUMP) {
        return vec4(t_BaseTexture.rgb * dot(t_DetailTexture.rgb, vec3(2.0 / 3.0)), t_BaseTexture.a);
    }

    // Unknown.
    return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
}

vec3 CalcDetailPostLighting(in vec3 t_DiffuseColor, in vec3 t_DetailTexture) {
    bool use_detail = ${MaterialUtil.getDefineBool(m, 'USE_DETAIL')};
    if (!use_detail)
        return t_DiffuseColor;

    int t_BlendMode = ${MaterialUtil.getDefineString(m, 'DETAIL_BLEND_MODE')};
    float t_BlendFactor = u_DetailBlendFactor;

    if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM) {
        return t_DiffuseColor.rgb + t_DetailTexture.rgb * t_BlendFactor;
    } else if (t_BlendMode == DETAIL_BLEND_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Remap.
        if (t_BlendFactor >= 0.5) {
            float t_Mult = (1.0 / t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (1.0 - t_Mult), 0.0, 1.0);
        } else {
            float t_Mult = (4.0 * t_BlendFactor);
            return t_DiffuseColor.rgb + clamp((t_Mult * t_DetailTexture.rgb) + (-0.5 * t_Mult), 0.0, 1.0);
        }
    }

    // Nothing to do.
    return t_DiffuseColor.rgb;
}

#define DECAL_BLEND_MODE_ALPHA      0
#define DECAL_BLEND_MODE_MUL        1

vec3 CalcDecal(in vec3 t_BaseTexture, in vec3 t_DecalLighting) {
    bool use_decal = ${MaterialUtil.getDefineBool(m, 'USE_DECAL')};
    if (!use_decal)
        return t_BaseTexture;

    vec2 t_DecalTexCoord = v_TexCoord1.xy;

    // Decal reuses $basetexture2 slot...
    vec4 t_DecalTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureBase2), t_DecalTexCoord));

    int t_BlendMode = ${MaterialUtil.getDefineString(m, 'DECAL_BLEND_MODE')};
    if (t_BlendMode == DECAL_BLEND_MODE_ALPHA) {
        return mix(t_BaseTexture.rgb, t_DecalTexture.rgb * t_DecalLighting.rgb, t_DecalTexture.a);
    } else if (t_BlendMode == DECAL_BLEND_MODE_MUL) {
        return t_BaseTexture.rgb * t_DecalTexture.rgb;
    }

    // Unknown.
    return t_BaseTexture + vec3(1.0, 0.0, 1.0);
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 0.8660254037844386,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

struct SpecularLightResult {
    vec3 SpecularLight;
    vec3 RimLight;
};

SpecularLightResult SpecularLightResult_New() {
    SpecularLightResult t_Result;
    t_Result.SpecularLight = vec3(0, 0, 0);
    t_Result.RimLight = vec3(0, 0, 0);
    return t_Result;
}

void SpecularLightResult_Sum(inout SpecularLightResult t_Dst, in SpecularLightResult t_Src) {
    t_Dst.SpecularLight += t_Src.SpecularLight;
    t_Dst.RimLight += t_Src.RimLight;
}

struct SpecularLightInput {
    vec3 PositionWorld;
    vec3 NormalWorld;
    vec3 WorldDirectionToEye;
    float Fresnel;
    float SpecularExponent;
    float RimExponent;
};

SpecularLightResult WorldLightCalcSpecular(in SpecularLightInput t_Input, in WorldLight t_WorldLight) {
    vec3 t_Reflect = CalcReflection(t_Input.NormalWorld, t_Input.WorldDirectionToEye);
    vec3 t_LightDirectionWorld = WorldLightCalcDirection(t_WorldLight, t_Input.PositionWorld);

    float t_NoL = saturate(dot(t_Input.NormalWorld, t_LightDirectionWorld));
    float t_RoL = saturate(dot(t_Reflect, t_LightDirectionWorld));

    SpecularLightResult t_Result = SpecularLightResult_New();

    float t_Attenuation = WorldLightCalcAttenuation(t_WorldLight, t_Input.PositionWorld);

    t_Result.SpecularLight += vec3(pow(t_RoL, t_Input.SpecularExponent));
    // TODO(jstpierre): Specular Warp
    t_Result.SpecularLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation * t_Input.Fresnel;

    t_Result.RimLight += vec3(pow(t_RoL, t_Input.RimExponent));
    t_Result.RimLight *= t_NoL * t_WorldLight.Color.rgb * t_Attenuation;

    return t_Result;
}

SpecularLightResult WorldLightCalcAllSpecular(in SpecularLightInput t_Input) {
    SpecularLightResult t_FinalLight = SpecularLightResult_New();
#if defined USE_DYNAMIC_PIXEL_LIGHTING
    for (int i = 0; i < ${ShaderTemplate_Generic.MaxDynamicWorldLights}; i++)
        SpecularLightResult_Sum(t_FinalLight, WorldLightCalcSpecular(t_Input, u_WorldLights[i]));
#endif
    return t_FinalLight;
}

vec4 UnpackNormalMap(vec4 t_Sample) {
    bool use_ssbump = ${MaterialUtil.getDefineBool(m, `USE_SSBUMP`)};
    if (!use_ssbump)
        t_Sample = UnpackUnsignedNormalMap(t_Sample);
    return t_Sample;
}

vec4 SeamlessSampleTex(PD_SAMPLER_2D(t_Texture), in float t_SeamlessScale) {
    // Seamless ignores the base texture coordinate, and instead blends three copies
    // of the same texture based on world position (similar to tri-planar).

    t_SeamlessScale *= u_SeamlessScale;
    vec3 t_BaseTexCoord = v_PositionWorld.xyz * t_SeamlessScale;

    // Weights should sum to 1.
    vec3 t_Weights = v_TangentSpaceBasis2.xyz * v_TangentSpaceBasis2.xyz;
    vec4 t_Sample = vec4(0.0);
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.yz) * t_Weights.x;
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.zx) * t_Weights.y;
    t_Sample += texture(PU_SAMPLER_2D(t_Texture), t_BaseTexCoord.xy) * t_Weights.z;
    return t_Sample;
}

vec4 SeamlessSampleTex(PD_SAMPLER_2D(t_Texture), in bool t_UseSeamless, in vec2 t_TexCoord) {
    if (t_UseSeamless) {
        return SeamlessSampleTex(PF_SAMPLER_2D(t_Texture), 1.0);
    } else {
        return texture(PU_SAMPLER_2D(t_Texture), t_TexCoord.xy);
    }
}

float CalcShadowPCF9(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    float t_Res = 0.0;
    t_Res += textureLod(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0,  1)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0, -1)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 1,  0)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2(-1,  0)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 1,  1)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 1, -1)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2(-1,  1)) * (1.0 / 9.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2(-1, -1)) * (1.0 / 9.0);
    return t_Res;
}

float CalcShadowPCF5(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    float t_Res = 0.0;
    t_Res += textureLod(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0,  1)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 0, -1)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2( 1,  0)) * (1.0 / 5.0);
    t_Res += textureLodOffset(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0, ivec2(-1,  0)) * (1.0 / 5.0);
    return t_Res;
}

float CalcShadowPCF1(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord) {
    return textureLod(PU_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz, 0.0);
}

float CalcShadowPCF(PD_SAMPLER_2DShadow(t_TextureDepth), in vec3 t_ProjCoord, in float t_Bias) {
    t_ProjCoord.z += t_Bias;
    return CalcShadowPCF5(PF_SAMPLER_2DShadow(t_TextureDepth), t_ProjCoord.xyz);
}

void mainPS() {
    vec4 t_Albedo, t_BlendedAlpha;

    bool use_seamless_base = ${MaterialUtil.getDefineBool(m, `USE_SEAMLESS_BASE`)};
    vec4 t_BaseTexture = DebugColorTexture(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBase), use_seamless_base, v_TexCoord0.xy));

    bool use_basetexture2 = ${MaterialUtil.getDefineBool(m, `USE_BASETEXTURE2`)};

    float t_BlendFactorWorld = v_PositionWorld.w;

    bool use_blend_modulate = ${MaterialUtil.getDefineBool(m, `USE_BLEND_MODULATE`)};
    if (use_blend_modulate) {
        vec2 t_BlendModulateTexCoord = ${MaterialUtil.ifDefineBool(m, `USE_BLEND_MODULATE`, `CalcScaleBias(v_TexCoord0.zw, u_BlendModulateScaleBias)`, `vec2(0.0)`)};
        vec4 t_BlendModulateSample = texture(SAMPLER_2D(u_TextureBlendModulate), t_BlendModulateTexCoord);
        float t_BlendModulateMin = t_BlendModulateSample.g - t_BlendModulateSample.r;
        float t_BlendModulateMax = t_BlendModulateSample.g + t_BlendModulateSample.r;
        t_BlendFactorWorld = smoothstep(t_BlendModulateMin, t_BlendModulateMax, t_BlendFactorWorld);
    }

    if (use_basetexture2) {
        // Blend in BaseTexture2 using blend factor.
        vec4 t_BaseTexture2 = DebugColorTexture(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBase2), use_seamless_base, v_TexCoord0.xy));
        t_Albedo = mix(t_BaseTexture, t_BaseTexture2, t_BlendFactorWorld);
    } else {
        t_Albedo = t_BaseTexture;
    }

    vec4 t_DetailTexture = vec4(0.0);

#if defined USE_DETAIL
    bool use_seamless_detail = ${MaterialUtil.getDefineBool(m, `USE_SEAMLESS_DETAIL`)};
    if (use_seamless_detail) {
        float t_SeamlessDetailScale = u_DetailTextureTransform.mx.x;
        t_DetailTexture = DebugColorTexture(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureDetail), t_SeamlessDetailScale));
    } else {
        vec2 t_DetailTexCoord = UnpackMatrix(u_DetailTextureTransform) * vec4(v_TexCoord0.zw, 1.0, 1.0);
        t_DetailTexture = DebugColorTexture(texture(SAMPLER_2D(u_TextureDetail), t_DetailTexCoord));
    }
    t_Albedo = CalcDetail(t_Albedo, t_DetailTexture);
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;

    vec3 t_EnvmapFactor = vec3(1.0);
    bool use_bumpmap = ${MaterialUtil.getDefineBool(m, `USE_BUMPMAP`)};
    bool use_ssbump = ${MaterialUtil.getDefineBool(m, `USE_SSBUMP`)};

    // TODO(jstpierre): It seems like $bumptransform might not even be respected in lightmappedgeneric shaders?
    vec2 t_BumpmapTexCoord = ${MaterialUtil.ifDefineBool(m, `USE_BUMPMAP`, `UnpackMatrix(u_BumpmapTransform) * vec4(v_TexCoord0.zw, 1.0, 1.0)`, `vec2(0.0)`)};
    vec4 t_BumpmapSample = vec4(0.0);
    vec3 t_BumpmapNormal;

    if (use_bumpmap) {
        t_BumpmapSample = UnpackNormalMap(SeamlessSampleTex(PP_SAMPLER_2D(u_TextureBumpmap), use_seamless_base, t_BumpmapTexCoord.xy));

        bool use_bumpmap2 = ${MaterialUtil.getDefineBool(m, `USE_BUMPMAP2`)};
        if (use_bumpmap2) {
            vec2 t_Bumpmap2TexCoord = ${MaterialUtil.ifDefineBool(m, `USE_BUMPMAP2`, `UnpackMatrix(u_Bumpmap2Transform) * vec4(v_TexCoord0.zw, 1.0, 1.0)`, `vec2(0.0)`)};
            vec4 t_Bumpmap2Sample = UnpackNormalMap(texture(SAMPLER_2D(u_TextureBumpmap2), t_Bumpmap2TexCoord));

            bool use_bumpmask = ${MaterialUtil.getDefineBool(m, `USE_BUMPMASK`)};
            if (use_bumpmask) {
                vec4 t_BumpMaskSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureBumpMask), v_TexCoord0.xy));
                t_BumpmapSample.rgb = normalize(t_BumpmapSample.rgb + t_Bumpmap2Sample.rgb);
                t_BumpmapSample.rgb = mix(t_BumpMaskSample.rgb, t_BumpmapSample.rgb, t_BumpMaskSample.a);
                // Envmap factor from bump mask is multiplied in regardless of whether we have use_normalmap_alpha_envmap_mask set.
                t_EnvmapFactor *= t_BumpMaskSample.a;
            } else {
                // TODO(jstpierre): $addbumpmaps
                t_BumpmapSample.rgb = mix(t_BumpmapSample.rgb, t_Bumpmap2Sample.rgb, t_BlendFactorWorld);
            }
        }

        bool use_normalmap_alpha_envmap_mask = ${MaterialUtil.getDefineBool(m, `USE_NORMALMAP_ALPHA_ENVMAP_MASK`)};
        if (use_normalmap_alpha_envmap_mask)
            t_EnvmapFactor *= t_BumpmapSample.a;

        if (use_ssbump) {
            // In SSBUMP, the bumpmap is pre-convolved with the basis. Compute the normal by re-applying our basis.
            t_BumpmapNormal = normalize(g_RNBasis0*t_BumpmapSample.x + g_RNBasis1*t_BumpmapSample.y + g_RNBasis2*t_BumpmapSample.z);
        } else {
            // In non-SSBUMP, this is a traditional normal map with signed offsets.
            t_BumpmapNormal = t_BumpmapSample.rgb;
        }

        // Transform from tangent space into world-space.
#if defined HAS_FULL_TANGENTSPACE
        t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
#endif
    } else {
        t_NormalWorld = v_TangentSpaceBasis2;
    }

    vec3 t_DiffuseLighting = vec3(0.0);
    vec3 t_SpecularLighting = vec3(0.0);
    vec3 t_SpecularLightingEnvMap = vec3(0.0);

    bool use_lightmap = ${MaterialUtil.getDefineBool(m, `USE_LIGHTMAP`)};
    bool use_diffuse_bumpmap = ${MaterialUtil.getDefineBool(m, `USE_DIFFUSE_BUMPMAP`)};

    // Lightmap Diffuse
    if (use_lightmap) {
        if (use_diffuse_bumpmap) {
            vec3 t_LightmapColor1 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 1.0)));
            vec3 t_LightmapColor2 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 2.0)));
            vec3 t_LightmapColor3 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 3.0)));

            vec3 t_Influence;

            bool t_NormalizeInfluence = false;

            if (use_ssbump) {
                // SSBUMP precomputes the elements of t_Influence (calculated below) offline.
                t_Influence = t_BumpmapSample.rgb;

                if (DETAIL_BLEND_MODE == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
                    t_Influence.xyz *= mix(vec3(1.0), 2.0 * t_DetailTexture.rgb, t_BaseTexture.a);
                    t_Albedo.a = 1.0; // Reset alpha
                }

                bool use_ssbump_normalize = ${MaterialUtil.getDefineBool(m, `USE_SSBUMP_NORMALIZE`)};
                t_NormalizeInfluence = use_ssbump_normalize;
            } else {
                t_Influence.x = saturate(dot(t_BumpmapNormal, g_RNBasis0));
                t_Influence.y = saturate(dot(t_BumpmapNormal, g_RNBasis1));
                t_Influence.z = saturate(dot(t_BumpmapNormal, g_RNBasis2));

                if (DETAIL_BLEND_MODE == DETAIL_BLEND_MODE_SSBUMP_BUMP) {
                    t_Influence.xyz *= t_DetailTexture.rgb * 2.0;
                }
            }

            // The lightmap is constructed assuming that the three basis tap weights sum to 1, however,
            // a flat vector projected against our three HL2 basis vectors would sum to sqrt(3).
            // Renormalize so that the weights sum to 1.
            if (t_NormalizeInfluence)
                t_Influence.xyz *= 0.5773502691896258; // 1/sqrt(3)

            t_DiffuseLighting = vec3(0.0);
            t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
            t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
            t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
        } else {
            vec3 t_LightmapColor0 = SampleLightmapTexture(texture(SAMPLER_2DArray(u_TextureLightmap), vec3(v_TexCoord1.xy, 0.0)));
            t_DiffuseLighting.rgb = t_LightmapColor0;
        }
    } else {
        bool use_static_vertex_lighting_3 = ${MaterialUtil.getDefineBool(m, `USE_STATIC_VERTEX_LIGHTING_3`)};
        if (use_static_vertex_lighting_3) {
#if defined USE_STATIC_VERTEX_LIGHTING_3
            vec3 t_Influence;

            if (use_bumpmap) {
                t_Influence.x = clamp(dot(t_BumpmapNormal, g_RNBasis0), 0.0, 1.0);
                t_Influence.y = clamp(dot(t_BumpmapNormal, g_RNBasis1), 0.0, 1.0);
                t_Influence.z = clamp(dot(t_BumpmapNormal, g_RNBasis2), 0.0, 1.0);
                t_Influence.xyz = normalize(t_Influence.xyz);
            } else {
                // No bumpmap, equal diffuse influence
                t_Influence.xyz = vec3(1.0 / 3.0);
            }

            t_DiffuseLighting = vec3(0.0);
            t_DiffuseLighting += v_DiffuseLighting0.rgb * t_Influence.x;
            t_DiffuseLighting += v_DiffuseLighting1.rgb * t_Influence.y;
            t_DiffuseLighting += v_DiffuseLighting2.rgb * t_Influence.z;
#endif
        } else {
            t_DiffuseLighting.rgb = v_DiffuseLighting0.rgb;
        }
    }

    t_Albedo *= v_Color;

#if defined USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    bool use_half_lambert = ${MaterialUtil.getDefineBool(m, `USE_HALF_LAMBERT`)};
    bool use_phong = ${MaterialUtil.getDefineBool(m, `USE_PHONG`)};

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    // World Diffuse
    bool t_HalfLambert = use_half_lambert;

    if (use_phong) {
        // Skin shader forces half-lambert on.
        t_HalfLambert = true;
    }

    DiffuseLightInput t_DiffuseLightInput;
    t_DiffuseLightInput.PositionWorld = v_PositionWorld.xyz;
    t_DiffuseLightInput.NormalWorld = t_NormalWorld.xyz;
    t_DiffuseLightInput.LightAttenuation = v_LightAtten.xyzw;
    t_DiffuseLightInput.HalfLambert = t_HalfLambert;
    t_DiffuseLighting.rgb += WorldLightCalcAllDiffuse(t_DiffuseLightInput);

#if defined USE_AMBIENT_CUBE
    t_DiffuseLighting.rgb += AmbientLight(t_NormalWorld.xyz);
#endif
#endif

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    float t_FresnelDot = dot(t_NormalWorld, t_WorldDirectionToEye);

    float t_Fresnel;
#if defined USE_PHONG
    t_Fresnel = CalcFresnelTerm2Ranges(t_FresnelDot, u_FresnelRangeSpecAlbedoBoost.xyz);
#else
    t_Fresnel = CalcFresnelTerm2(t_FresnelDot);
#endif

    bool use_base_alpha_envmap_mask = ${MaterialUtil.getDefineBool(m, `USE_BASE_ALPHA_ENVMAP_MASK`)};

#if defined USE_ENVMAP
    t_EnvmapFactor *= u_EnvmapTint.rgb;

    bool use_envmap_mask = ${MaterialUtil.getDefineBool(m, `USE_ENVMAP_MASK`)};
    if (use_envmap_mask) {
        vec2 t_EnvmapMaskTexCoord = ${MaterialUtil.ifDefineBool(m, `USE_ENVMAP_MASK`, `CalcScaleBias(v_TexCoord0.zw, u_EnvmapMaskScaleBias)`, `vec2(0.0)`)};
        t_EnvmapFactor *= texture(SAMPLER_2D(u_TextureEnvmapMask), t_EnvmapMaskTexCoord).rgb;
    }

    if (use_base_alpha_envmap_mask)
        t_EnvmapFactor *= 1.0 - t_BaseTexture.a;

    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_WorldDirectionToEye);
    vec3 t_EnvmapColor = texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb * g_EnvmapScale;
    t_EnvmapColor *= t_EnvmapFactor;

    // TODO(jstpierre): Double-check all of this with Phong. I don't think it's 100% right...

    // TODO(jstpierre): $envmaplightscaleminmax
    vec3 t_EnvmapDiffuseLightScale = saturate(t_DiffuseLighting.rgb);
    t_EnvmapColor.rgb *= mix(vec3(1.0), t_EnvmapDiffuseLightScale.rgb, u_EnvmapContrastSaturationFresnelLightScale.w);

    t_EnvmapColor = mix(t_EnvmapColor, t_EnvmapColor*t_EnvmapColor, u_EnvmapContrastSaturationFresnelLightScale.x);
    t_EnvmapColor = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_EnvmapColor)), t_EnvmapColor, u_EnvmapContrastSaturationFresnelLightScale.y);
    t_EnvmapColor *= mix(t_Fresnel, 1.0, u_EnvmapContrastSaturationFresnelLightScale.z);

    t_SpecularLightingEnvMap.rgb += t_EnvmapColor.rgb;
#endif

    // World Specular
    SpecularLightInput t_SpecularLightInput;
    t_SpecularLightInput.PositionWorld = v_PositionWorld.xyz;
    t_SpecularLightInput.NormalWorld = t_NormalWorld;
    t_SpecularLightInput.WorldDirectionToEye = t_WorldDirectionToEye;
    t_SpecularLightInput.Fresnel = t_Fresnel;
    t_SpecularLightInput.RimExponent = 4.0;

    vec4 t_SpecularMapSample = vec4(0.0);

    if (use_phong) {
        bool use_phong_exponent_texture = ${MaterialUtil.getDefineBool(m, `USE_PHONG_EXPONENT_TEXTURE`)};
        if (use_phong_exponent_texture) {
            t_SpecularMapSample = texture(SAMPLER_2D(u_TextureSpecularExponent), v_TexCoord0.xy);
            t_SpecularLightInput.SpecularExponent = 1.0 + u_SpecExponentFactor * t_SpecularMapSample.r;
        } else {
            t_SpecularLightInput.SpecularExponent = u_SpecExponentFactor;
        }
    }

#if defined USE_DYNAMIC_PIXEL_LIGHTING
    if (use_phong) {
        SpecularLightResult t_SpecularLightResult = WorldLightCalcAllSpecular(t_SpecularLightInput);
        t_SpecularLighting.rgb += t_SpecularLightResult.SpecularLight;
    }
#endif // USE_DYNAMIC_PIXEL_LIGHTING

#if defined USE_PROJECTED_LIGHT
    // Projected Light (Flashlight, env_projected_texture)
    vec4 t_ProjectedLightCoord = UnpackMatrix(u_ProjectedLightFromWorldMatrix) * vec4(v_PositionWorld.xyz, 1.0);
    t_ProjectedLightCoord.xyz /= t_ProjectedLightCoord.www;

    // Clip space is between -1 and 1. Move it into 0...1 space.
    t_ProjectedLightCoord.xy = t_ProjectedLightCoord.xy * 0.5 + 0.5;
#if !GFX_CLIPSPACE_NEAR_ZERO()
    t_ProjectedLightCoord.z = t_ProjectedLightCoord.z * 0.5 + 0.5;
#endif

    vec4 t_ProjectedLightSample = texture(SAMPLER_2D(u_TextureProjectedLight), t_ProjectedLightCoord.xy);
    if (all(greaterThan(t_ProjectedLightCoord.xyz, vec3(0.0))) && all(lessThan(t_ProjectedLightCoord.xyz, vec3(1.0)))) {
        vec2 t_ProjectedGoboTexCoord = t_ProjectedLightCoord.xy;

#if GFX_VIEWPORT_ORIGIN_TL()
        t_ProjectedLightCoord.y = 1.0 - t_ProjectedLightCoord.y;
#else
        t_ProjectedGoboTexCoord.y = 1.0 - t_ProjectedGoboTexCoord.y;
#endif

        vec3 t_ProjectedLightColor = (t_ProjectedLightSample.rgb * u_ProjectedLightColor.rgb);

        vec3 t_WorldToProjectedLight = u_ProjectedLightOrigin.xyz - v_PositionWorld.xyz;
        vec3 t_WorldDirectionToProjectedLight = normalize(t_WorldToProjectedLight);
        float t_AngleAttenuation = saturate(dot(t_WorldDirectionToProjectedLight.xyz, t_NormalWorld.xyz));

        float t_DistanceNorm = length(t_WorldToProjectedLight) / u_ProjectedLightOrigin.w;
        float t_DistanceAttenuation = saturate(invlerp(1.0, 0.6, t_DistanceNorm));
        t_ProjectedLightColor *= t_DistanceAttenuation * t_AngleAttenuation;

        if (any(greaterThan(t_ProjectedLightColor.rgb, vec3(0.0)))) {
            float t_ShadowVisibility = 1.0 - CalcShadowPCF(PP_SAMPLER_2DShadow(u_TextureProjectedLightDepth), t_ProjectedLightCoord.xyz, 0.01);
            t_ProjectedLightColor.rgb *= t_ShadowVisibility;

            t_DiffuseLighting.rgb += t_ProjectedLightColor.rgb;

            bool t_CalcSpecularFlashlight = use_phong;
            if (t_CalcSpecularFlashlight) {
                vec3 t_Reflect = CalcReflection(t_SpecularLightInput.NormalWorld, t_SpecularLightInput.WorldDirectionToEye);
                float t_RoL = saturate(dot(t_Reflect, t_WorldDirectionToProjectedLight));

                // TODO(jstpierre): $phongwarptexture
                t_SpecularLighting.rgb += t_ProjectedLightColor.rgb * pow(t_RoL, t_SpecularLightInput.SpecularExponent);
            }
        }
    }
#endif

    // Compute final specular
#if defined USE_DYNAMIC_PIXEL_LIGHTING
    if (use_phong) {
        // Specular mask is either in base map or normal map alpha.
        float t_SpecularMask;
        bool use_base_alpha_phong_mask = ${MaterialUtil.getDefineBool(m, `USE_BASE_ALPHA_PHONG_MASK`)};
        if (use_base_alpha_phong_mask) {
            t_SpecularMask = t_BaseTexture.a;
        } else if (use_bumpmap) {
            t_SpecularMask = t_BumpmapSample.a;
        } else {
            t_SpecularMask = 1.0;
        }

        bool use_phong_mask_invert = ${MaterialUtil.getDefineBool(m, `USE_PHONG_MASK_INVERT`)};
        if (use_phong_mask_invert)
            t_SpecularMask = 1.0 - t_SpecularMask;

        vec3 t_SpecularTint = vec3(u_SpecTintBoost.w);
        bool use_phong_albedo_tint = ${MaterialUtil.getDefineBool(m, `USE_PHONG_ALBEDO_TINT`)};
        if (use_phong_albedo_tint) {
            t_SpecularTint.rgb = mix(t_SpecularTint.rgb, t_Albedo.rgb * u_FresnelRangeSpecAlbedoBoost.www, t_SpecularMapSample.ggg);
        } else {
            t_SpecularTint.rgb *= u_SpecTintBoost.rgb;
        }

        t_SpecularLighting.rgb *= t_SpecularTint.rgb * t_SpecularMask;

        // TODO(jstpierre): $rimlight, $rimlightexponent, $rimlightboost, $rimmask
    }
#endif

    vec3 t_DecalLighting = t_DiffuseLighting;

    vec3 t_FinalDiffuse = t_DiffuseLighting * t_Albedo.rgb;
    t_FinalDiffuse.rgb = CalcDecal(t_FinalDiffuse.rgb, t_DecalLighting.rgb);

    t_FinalDiffuse = CalcDetailPostLighting(t_FinalDiffuse, t_DetailTexture.rgb);

    // TODO(jstpierre): Support $blendtintbybasealpha and $blendtintcoloroverbase
    #if defined USE_MODULATIONCOLOR_COLOR
        t_FinalDiffuse *= u_ModulationColor.rgb;
    #endif

#if defined USE_SELFILLUM
    vec3 t_SelfIllumMask;

    bool use_selfillum_envmapmask_alpha = ${MaterialUtil.getDefineBool(m, `USE_SELFILLUM_ENVMAPMASK_ALPHA`)};
    bool use_selfillum_mask = ${MaterialUtil.getDefineBool(m, `USE_SELFILLUM_MASK`)};
    if (use_selfillum_envmapmask_alpha) {
        vec2 t_EnvmapMaskTexCoord = ${MaterialUtil.ifDefineBool(m, `USE_ENVMAP_MASK`, `CalcScaleBias(v_TexCoord0.zw, u_EnvmapMaskScaleBias)`, `vec2(0.0)`)};
        t_SelfIllumMask = texture(SAMPLER_2D(u_TextureEnvmapMask), t_EnvmapMaskTexCoord).aaa;
    } else if (use_selfillum_mask) {
        t_SelfIllumMask = texture(SAMPLER_2D(u_TextureSelfIllumMask), v_TexCoord0.xy).rgb;
    } else {
        t_SelfIllumMask = t_BaseTexture.aaa;
    }

    vec3 t_SelfIllum = u_SelfIllumTint.rgb * t_Albedo.rgb;

#if defined USE_SELFILLUM_FRESNEL
    float t_SelfIllumFresnelMin = u_SelfIllumFresnel.r;
    float t_SelfIllumFresnelMax = u_SelfIllumFresnel.g;
    float t_SelfIllumFresnelExp = u_SelfIllumFresnel.b;

    float t_SelfIllumFresnel = saturate(mix(t_SelfIllumFresnelMin, t_SelfIllumFresnelMax, pow(saturate(t_FresnelDot), t_SelfIllumFresnelExp)));
    t_SelfIllumMask.rgb *= t_SelfIllumFresnel;
#endif

    t_FinalDiffuse.rgb = mix(t_FinalDiffuse.rgb, t_SelfIllum.rgb, t_SelfIllumMask.rgb);
#endif

    t_FinalColor.rgb += t_FinalDiffuse;

    t_FinalColor.rgb += t_SpecularLighting.rgb;
    t_FinalColor.rgb += t_SpecularLightingEnvMap.rgb;

    t_FinalColor.a = t_Albedo.a;
    if (!use_base_alpha_envmap_mask)
        t_FinalColor.a *= t_BaseTexture.a;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
        `;
    }
}

enum GenericShaderType {
    LightmappedGeneric, VertexLitGeneric, UnlitGeneric, WorldVertexTransition, Skin, Black, DecalModulate, Sprite, Unknown,
};

export class Material_Generic extends BaseMaterial {
    private wantsTreeSway = false;
    private wantsDetail = false;
    private wantsBaseTexture2 = false;
    private wantsDecal = false;
    private wantsBumpmap = false;
    private wantsBumpmap2 = false;
    private wantsEnvmapMask = false;
    private wantsEnvmap = false;
    private wantsSelfIllum = false;
    private wantsSelfIllumFresnel = false;
    private wantsBlendModulate = false;
    private wantsPhong = false;
    private wantsPhongExponentTexture = false;
    private wantsDynamicLighting = false;
    private wantsAmbientCube = false;
    private wantsProjectedTexture = false;
    private shaderType: GenericShaderType;
    private objectParamsWordCount: number = 0;

    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private projectedLight: ProjectedLight | null = null;

    public override setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        let wantsStaticVertexLighting: boolean;
        let wantsDynamicVertexLighting: boolean;
        let wantsDynamicPixelLighting: boolean;

        const isStudioVertexLighting = (staticLightingMode === StaticLightingMode.StudioVertexLighting || staticLightingMode === StaticLightingMode.StudioVertexLighting3);
        const isStudioVertexLighting3 = (staticLightingMode === StaticLightingMode.StudioVertexLighting3);
        const isStudioAmbientCube = (staticLightingMode === StaticLightingMode.StudioAmbientCube);

        if (this.shaderType === GenericShaderType.VertexLitGeneric) {
            wantsStaticVertexLighting = isStudioVertexLighting;
            this.wantsAmbientCube = isStudioAmbientCube;
            wantsDynamicVertexLighting = isStudioAmbientCube;
            wantsDynamicPixelLighting = false;
        } else if (this.shaderType === GenericShaderType.Skin) {
            wantsStaticVertexLighting = isStudioVertexLighting;
            this.wantsAmbientCube = isStudioAmbientCube;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = true;
        } else {
            wantsStaticVertexLighting = false;
            this.wantsAmbientCube = false;
            wantsDynamicVertexLighting = false;
            wantsDynamicPixelLighting = false;
        }

        this.wantsDynamicLighting = wantsDynamicVertexLighting || wantsDynamicPixelLighting;

        // Ensure that we never have a lightmap at the same time as "studio model" lighting, as they're exclusive...
        if (wantsStaticVertexLighting || this.wantsDynamicLighting || this.wantsAmbientCube) {
            assert(!this.wantsLightmap);
        }

        let changed = false;
        changed = this.shaderInstance.setDefineBool('USE_STATIC_VERTEX_LIGHTING', wantsStaticVertexLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_STATIC_VERTEX_LIGHTING_3', isStudioVertexLighting3) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_VERTEX_LIGHTING', wantsDynamicVertexLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_PIXEL_LIGHTING', wantsDynamicPixelLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_DYNAMIC_LIGHTING', this.wantsDynamicLighting) || changed;
        changed = this.shaderInstance.setDefineBool('USE_AMBIENT_CUBE', this.wantsAmbientCube) || changed;

        if (changed)
            this.gfxProgram = null;
    }

    protected override initParameters(): void {
        super.initParameters();

        const shaderTypeStr = this.vmt._Root.toLowerCase();
        if (shaderTypeStr === 'lightmappedgeneric' || shaderTypeStr === 'sdk_lightmappedgeneric')
            this.shaderType = GenericShaderType.LightmappedGeneric;
        else if (shaderTypeStr === 'vertexlitgeneric')
            this.shaderType = GenericShaderType.VertexLitGeneric;
        else if (shaderTypeStr === 'unlitgeneric')
            this.shaderType = GenericShaderType.UnlitGeneric;
        else if (shaderTypeStr === 'worldvertextransition' || shaderTypeStr === 'sdk_worldvertextransition')
            this.shaderType = GenericShaderType.WorldVertexTransition;
        else if (shaderTypeStr === 'black')
            this.shaderType = GenericShaderType.Black;
        else if (shaderTypeStr === 'decalmodulate')
            this.shaderType = GenericShaderType.DecalModulate;
        else if (shaderTypeStr === 'sprite')
            this.shaderType = GenericShaderType.Sprite;
        else
            this.shaderType = GenericShaderType.Unknown;

        const p = this.param;

        // Generic
        p['$envmap']                       = new P.ParameterTexture(true, true);
        p['$envmapframe']                  = new P.ParameterNumber(0);
        p['$envmapmask']                   = new P.ParameterTexture();
        p['$envmapmaskframe']              = new P.ParameterNumber(0);
        p['$envmapmasktransform']          = new P.ParameterMatrix();
        p['$envmaptint']                   = new P.ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new P.ParameterNumber(0);
        p['$envmapsaturation']             = new P.ParameterNumber(1);
        p['$envmaplightscale']             = new P.ParameterNumber(0);
        p['$fresnelreflection']            = new P.ParameterNumber(1);
        p['$detail']                       = new P.ParameterTexture();
        p['$detailframe']                  = new P.ParameterNumber(0);
        p['$detailblendmode']              = new P.ParameterNumber(0, false);
        p['$detailblendfactor']            = new P.ParameterNumber(1);
        p['$detailtint']                   = new P.ParameterColor(1, 1, 1);
        p['$detailscale']                  = new P.ParameterNumber(4);
        p['$detailtexturetransform']       = new P.ParameterMatrix();
        p['$bumpmap']                      = new P.ParameterTexture();             // Generic
        p['$bumpframe']                    = new P.ParameterNumber(0);
        p['$bumptransform']                = new P.ParameterMatrix();
        p['$bumpmap2']                     = new P.ParameterTexture();             // LightmappedGeneric, WorldVertexTransition
        p['$bumpframe2']                   = new P.ParameterNumber(0);
        p['$bumptransform2']               = new P.ParameterMatrix();
        p['$bumpmask']                     = new P.ParameterTexture();
        p['$alphatestreference']           = new P.ParameterNumber(0.7);
        p['$nodiffusebumplighting']        = new P.ParameterBoolean(false, false);
        p['$ssbump']                       = new P.ParameterBoolean(false, false);
        p['$halflambert']                  = new P.ParameterBoolean(false, false);
        p['$selfillumtint']                = new P.ParameterColor(1, 1, 1);
        p['$selfillummask']                = new P.ParameterTexture(false, false);
        p['$selfillumfresnel']             = new P.ParameterBoolean(false, false);
        p['$selfillumfresnelminmaxexp']    = new P.ParameterVector(3);
        p['$decaltexture']                 = new P.ParameterTexture();             // VertexLitGeneric, Phong
        p['$decalblendmode']               = new P.ParameterNumber(-1, false);

        // World Vertex Transition
        p['$basetexture2']                 = new P.ParameterTexture(true);         // WorldVertexTransition
        p['$frame2']                       = new P.ParameterNumber(0.0);
        p['$blendmodulatetexture']         = new P.ParameterTexture(true);         // WorldVertexTransition
        p['$blendmasktransform']           = new P.ParameterMatrix();
        p['$seamless_base']                = new P.ParameterBoolean(false, false);
        p['$seamless_detail']              = new P.ParameterBoolean(false, false);
        p['$seamless_scale']               = new P.ParameterNumber(0.0);

        // Phong (Skin)
        p['$phong']                        = new P.ParameterBoolean(false, false);
        p['$phongboost']                   = new P.ParameterNumber(1.0);
        p['$phongtint']                    = new P.ParameterColor(1, 1, 1);
        p['$phongalbedoboost']             = new P.ParameterNumber(1.0);
        p['$phongalbedotint']              = new P.ParameterBoolean(false, false);
        p['$phongexponent']                = new P.ParameterNumber(5.0);
        p['$phongexponenttexture']         = new P.ParameterTexture(false);       // Phong
        p['$phongexponentfactor']          = new P.ParameterNumber(149.0);
        p['$phongfresnelranges']           = new P.ParameterVector(3);
        p['$basemapalphaphongmask']        = new P.ParameterBoolean(false, false);
        p['$invertphongmask']              = new P.ParameterBoolean(false, false);

        // Sprite
        p['$spriteorientation']            = new P.ParameterString('parallel_upright');
        p['$spriteorigin']                 = new P.ParameterVector(2, [0.5, 0.5]);

        // TreeSway (VertexLitGeneric)
        p['$treesway']                     = new P.ParameterBoolean(false, false);
        p['$treeswayheight']               = new P.ParameterNumber(1000.0);
        p['$treeswaystartheight']          = new P.ParameterNumber(0.2);
        p['$treeswayradius']               = new P.ParameterNumber(300.0);
        p['$treeswaystartradius']          = new P.ParameterNumber(0.1);
        p['$treeswayspeed']                = new P.ParameterNumber(1.0);
        p['$treeswayspeedhighwindmultiplier'] = new P.ParameterNumber(2.0);
        p['$treeswayspeedstrength']        = new P.ParameterNumber(10.0);
        p['$treeswayspeedscrumblespeed']   = new P.ParameterNumber(0.1);
        p['$treeswayspeedscrumblestrength'] = new P.ParameterNumber(0.1);
        p['$treeswayspeedscrumblefrequency'] = new P.ParameterNumber(0.1);
        p['$treeswayfalloffexp']           = new P.ParameterNumber(1.5);
        p['$treeswayscrumblefalloffexp']   = new P.ParameterNumber(1.0);
        p['$treeswayspeedlerpstart']       = new P.ParameterNumber(3.0);
        p['$treeswayspeedlerpend']         = new P.ParameterNumber(6.0);
        p['$treeswaystatic']               = new P.ParameterBoolean(false, false);
    }

    private recacheProgram(cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = this.shaderInstance.getGfxProgram(cache);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected override initStaticBeforeResourceFetch() {
        // The detailBlendMode parameter determines whether we load an SRGB texture or not.
        const detailBlendMode = this.paramGetNumber('$detailblendmode');
        this.paramGetTexture('$detail').isSRGB = (detailBlendMode === 1);

        // The detailBlendMode parameter determines whether we load an SRGB texture or not.
        const decalBlendMode = this.paramGetNumber('$decalblendmode');
        this.paramGetTexture('$decaltexture').isSRGB = (decalBlendMode === 0);

        // decalmodulate doesn't load basetexture as sRGB.
        if (this.shaderType === GenericShaderType.DecalModulate)
            this.paramGetTexture('$basetexture').isSRGB = false;

        // In some world materials, $envmap is incorrectly set up and isn't overridden correctly.
        // In these cases, just replace it with a null texture.
        // Simple example: Portal 1's observationwall_001b.vmt overrides in escape_01
        if (this.shaderType === GenericShaderType.LightmappedGeneric && this.paramGetTexture('$envmap').ref === 'env_cubemap')
            this.paramGetTexture('$envmap').ref = null;
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Generic);

        if (this.shaderType === GenericShaderType.LightmappedGeneric || this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsLightmap = true;
            this.shaderInstance.setDefineBool('USE_LIGHTMAP', true);
        }

        if (this.shaderType === GenericShaderType.WorldVertexTransition) {
            this.wantsBaseTexture2 = true;
            this.shaderInstance.setDefineBool('USE_BASETEXTURE2', true);
        }

        if (this.wantsBaseTexture2 && this.paramGetVTF('$blendmodulatetexture') !== null) {
            this.wantsBlendModulate = true;
            this.shaderInstance.setDefineBool('USE_BLEND_MODULATE', true);
        }

        if (this.shaderType === GenericShaderType.VertexLitGeneric && this.paramGetBoolean('$phong')) {
            // $phong on a vertexlitgeneric tells it to use the Skin shader instead.
            this.shaderType = GenericShaderType.Skin;
            this.wantsPhong = true;
            this.shaderInstance.setDefineBool('USE_PHONG', true);

            if (this.paramGetVTF('$phongexponenttexture') !== null) {
                this.wantsPhongExponentTexture = true;
                this.shaderInstance.setDefineBool('USE_PHONG_EXPONENT_TEXTURE', true);
                this.shaderInstance.setDefineBool('USE_PHONG_ALBEDO_TINT', this.paramGetBoolean('$phongalbedotint'));
            }
        }

        if (this.paramGetBoolean('$treesway')) {
            this.wantsTreeSway = true;
            this.shaderInstance.setDefineBool('USE_TREE_SWAY', true);
        }

        if (this.paramGetVTF('$detail') !== null) {
            this.wantsDetail = true;
            this.shaderInstance.setDefineBool('USE_DETAIL', true);
            const detailBlendMode = this.paramGetNumber('$detailblendmode');
            this.shaderInstance.setDefineString('DETAIL_BLEND_MODE', '' + detailBlendMode);
        } else {
            this.shaderInstance.setDefineString('DETAIL_BLEND_MODE', '-1');
        }

        if (this.paramGetVTF('$bumpmap') !== null) {
            this.wantsBumpmap = true;
            this.shaderInstance.setDefineBool('USE_BUMPMAP', true);
            const wantsDiffuseBumpmap = !this.paramGetBoolean('$nodiffusebumplighting');
            this.shaderInstance.setDefineBool('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap);
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;

            if (this.paramGetVTF('$bumpmap2') !== null) {
                this.wantsBumpmap2 = true;
                this.shaderInstance.setDefineBool(`USE_BUMPMAP2`, true);

                if (this.paramGetVTF('$bumpmask'))
                    this.shaderInstance.setDefineBool(`USE_BUMPMASK`, true);
            }
        }

        if (this.paramGetVTF('$decaltexture') !== null) {
            assert(!this.wantsBaseTexture2); // Incompatible with decal
            this.wantsDecal = true;
            this.shaderInstance.setDefineBool('USE_DECAL', true);
            const decalBlendMode = this.paramGetNumber('$decalblendmode');
            this.shaderInstance.setDefineString('DECAL_BLEND_MODE', '' + decalBlendMode);
        } else {
            this.shaderInstance.setDefineString('DECAL_BLEND_MODE', '-1');
        }

        if (this.paramGetVTF('$envmapmask') !== null) {
            this.wantsEnvmapMask = true;
            this.shaderInstance.setDefineBool('USE_ENVMAP_MASK', true);
        }

        if (this.paramGetVTF('$envmap') !== null) {
            this.wantsEnvmap = true;
            this.shaderInstance.setDefineBool('USE_ENVMAP', true);
        }

        if (this.paramGetBoolean('$selfillum')) {
            this.wantsSelfIllum = true;
            this.shaderInstance.setDefineBool('USE_SELFILLUM', true);

            if (this.paramGetVTF('$selfillummask')) {
                this.shaderInstance.setDefineBool('USE_SELFILLUM_MASK', true);
            }

            if (this.paramGetBoolean('$selfillumfresnel')) {
                this.wantsSelfIllumFresnel = true;
                this.shaderInstance.setDefineBool('USE_SELFILLUM_FRESNEL', true);
            }
        }

        // LightmappedGeneric uses only $seamless_scale to turn on seamless mode (for base), while the vertex has $seamless_base / $seamless_detail
        if (this.paramGetBoolean('$seamless_base')) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_BASE', true);
            if (this.paramGetNumber('$seamless_scale') === 0.0)
                this.paramSetNumber('$seamless_scale', 1.0);
        } else if (this.paramGetBoolean('$seamless_detail')) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_DETAIL', true);
            if (this.paramGetNumber('$seamless_scale') === 0.0)
                this.paramSetNumber('$seamless_scale', 1.0);
        } else if (this.paramGetNumber('$seamless_scale') > 0.0 && this.shaderType === GenericShaderType.LightmappedGeneric) {
            this.shaderInstance.setDefineBool('USE_SEAMLESS_BASE', true);
        }

        // Modulation color is used differently between lightmapped and non-lightmapped.
        // In vertexlit / unlit, then the modulation color is multiplied in with the texture (and possibly blended).
        // In lightmappedgeneric, then the modulation color is used as the diffuse lightmap scale, and contains the
        // lightmap scale factor.
        // USE_MODULATIONCOLOR_COLOR only handles the vertexlit / unlit case. USE_LIGHTMAP will also use the modulation
        // color if necessary.
        if (this.wantsLightmap) {
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_COLOR', false);
            // TODO(jstpierre): Figure out if modulation alpha is used in lightmappedgeneric.
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_ALPHA', false);
        } else {
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_COLOR', true);
            this.shaderInstance.setDefineBool('USE_MODULATIONCOLOR_ALPHA', true);
        }

        if (this.hasVertexColorInput && (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha')))
            this.shaderInstance.setDefineBool('USE_VERTEX_COLOR', true);

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.shaderInstance.setDefineBool('USE_BASE_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$normalmapalphaenvmapmask') && this.wantsBumpmap)
            this.shaderInstance.setDefineBool('USE_NORMALMAP_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$basemapalphaphongmask'))
            this.shaderInstance.setDefineBool('USE_BASE_ALPHA_PHONG_MASK', true);

        if (this.paramGetBoolean('$invertphongmask'))
            this.shaderInstance.setDefineBool('USE_PHONG_MASK_INVERT', true);

        if (this.paramGetBoolean('$ssbump'))
            this.shaderInstance.setDefineBool('USE_SSBUMP', true);

        if (this.paramGetBoolean('$halflambert'))
            this.shaderInstance.setDefineBool('USE_HALF_LAMBERT', true);

        if (this.paramGetBoolean('$alphatest')) {
            this.shaderInstance.setDefineBool('USE_ALPHATEST', true);
        } else if (this.shaderType === GenericShaderType.DecalModulate) {
            this.isTranslucent = true;
            this.isToneMapped = false;

            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Src,
            });
            this.megaStateFlags.depthWrite = false;
        } else if (this.paramGetNumber('$rendermode') > 0) {
            const renderMode: RenderMode = this.paramGetNumber('$rendermode');

            if (renderMode === RenderMode.Glow || renderMode === RenderMode.WorldGlow) {
                this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Glow);
                // TODO(jstpierre): Once we support glow traces, re-enable this.
                // this.megaStateFlags.depthCompare = GfxCompareMode.Always;
            } else if (renderMode === RenderMode.TransAdd) {
                this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Add);
            } else if (renderMode === RenderMode.TransTexture) {
                this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Blend);
            } else {
                // Haven't seen this render mode yet.
                debugger;
            }
        } else {
            let isTranslucent = false;

            if (this.textureIsTranslucent('$basetexture'))
                isTranslucent = true;

            this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        }

        this.shaderInstance.setDefineBool(`USE_SSBUMP_NORMALIZE`, materialCache.ssbumpNormalize);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.recacheProgram(materialCache.cache);
        this.calcObjectParamsWordCount();
    }

    private updateTextureMappings(dst: TextureMapping[], renderContext: SourceRenderContext, lightmapPageIndex: number | null): void {
        MaterialUtil.resetTextureMappings(dst);

        const systemTextures = renderContext.materialCache.staticResources;
        if (!this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'))) {
            // If we don't have a base texture, then it depends on $envmap. With an $envmap, we bind black, otherwise
            // we bind white.
            if (this.wantsEnvmap)
                dst[0].gfxTexture = systemTextures.opaqueBlackTexture2D;
            else
                dst[0].gfxTexture = systemTextures.whiteTexture2D;
        }

        if (this.wantsBaseTexture2)
            this.paramGetTexture('$basetexture2').fillTextureMapping(dst[1], this.paramGetInt('$frame2'));

        this.paramGetTexture('$bumpmap').fillTextureMapping(dst[2], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$bumpmap2').fillTextureMapping(dst[3], this.paramGetInt('$bumpframe2'));
        this.paramGetTexture('$bumpmask').fillTextureMapping(dst[4], 0);
        this.paramGetTexture('$detail').fillTextureMapping(dst[5], this.paramGetInt('$detailframe'));

        if (this.wantsDecal)
            this.paramGetTexture('$decaltexture').fillTextureMapping(dst[1], 0);

        this.paramGetTexture('$envmapmask').fillTextureMapping(dst[6], this.paramGetInt('$envmapmaskframe'));
        this.paramGetTexture('$phongexponenttexture').fillTextureMapping(dst[7], 0);
        this.paramGetTexture('$selfillummask').fillTextureMapping(dst[8], 0);
        this.paramGetTexture('$blendmodulatetexture').fillTextureMapping(dst[9], 0);
        if (this.wantsLightmap)
            renderContext.lightmapManager.fillTextureMapping(dst[10], lightmapPageIndex);
        this.paramGetTexture('$envmap').fillTextureMapping(dst[11], this.paramGetInt('$envmapframe'));

        if (this.wantsProjectedTexture && renderContext.currentView.viewType !== SourceEngineViewType.ShadowMap) {
            dst[12].lateBinding = LateBindingTexture.ProjectedLightDepth;
            this.projectedLight!.texture!.fillTextureMapping(dst[13], this.projectedLight!.textureFrame);
        }
    }

    public override calcProjectedLight(renderContext: SourceRenderContext, bbox: AABB): void {
        if (this.shaderType === GenericShaderType.UnlitGeneric)
            return;

        let projectedLightRenderer = null;
        if (renderContext.currentViewRenderer !== null)
            projectedLightRenderer = renderContext.currentViewRenderer.currentProjectedLightRenderer;

        if (projectedLightRenderer !== null) {
            if (!projectedLightRenderer.light.frustumView.frustum.contains(bbox))
                projectedLightRenderer = null;
        }

        this.projectedLight = projectedLightRenderer !== null ? projectedLightRenderer.light : null;

        this.wantsProjectedTexture = this.projectedLight !== null && this.projectedLight.texture !== null;
        if (this.shaderInstance.setDefineBool('USE_PROJECTED_LIGHT', this.wantsProjectedTexture))
            this.gfxProgram = null;
    }

    private calcObjectParamsWordCount(): void {
        let vec4Count = 0;

        if (this.wantsAmbientCube)
            vec4Count += 6;
        if (this.wantsDynamicLighting)
            vec4Count += 4 * ShaderTemplate_Generic.MaxDynamicWorldLights;
        vec4Count += 2;
        if (this.wantsBumpmap)
            vec4Count += 2;
        if (this.wantsBumpmap2)
            vec4Count += 2;
        if (this.wantsDetail)
            vec4Count += 2;
        if (this.wantsEnvmapMask)
            vec4Count += 1;
        if (this.wantsBlendModulate)
            vec4Count += 1;
        if (this.wantsEnvmap)
            vec4Count += 2;
        if (this.wantsSelfIllum)
            vec4Count += 1;
        if (this.wantsSelfIllumFresnel)
            vec4Count += 1;
        if (this.wantsPhong)
            vec4Count += 2;
        if (this.wantsProjectedTexture)
            vec4Count += 4 + 2;
        if (this.wantsTreeSway)
            vec4Count += 5;
        vec4Count += 1; // Color
        vec4Count += 1; // Misc
        this.objectParamsWordCount = vec4Count * 4;
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, lightmapPageIndex: number | null = null): void {
        // TODO(jstpierre): Special shader program for depth-only?

        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings, renderContext, lightmapPageIndex);

        this.setupOverrideSceneParams(renderContext, renderInst);

        if (this.gfxProgram === null)
            this.calcObjectParamsWordCount();

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Generic.ub_ObjectParams, this.objectParamsWordCount);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Generic.ub_ObjectParams);

        if (this.wantsAmbientCube) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillAmbientCube(d, offs);
        }

        if (this.wantsDynamicLighting) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillWorldLights(d, offs, renderContext.worldLightingState);
        }

        offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform', this.paramGetFlipY(renderContext, '$basetexture'));

        if (this.wantsBumpmap)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform');

        if (this.wantsBumpmap2)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform2');

        if (this.wantsDetail) {
            const detailTextureTransform = this.paramGetMatrix('$detailtexturetransform');
            const detailScale = this.paramGetNumber('$detailscale');
            scaleMatrix(MaterialUtil.scratchMat4a, detailTextureTransform, detailScale, detailScale);
            offs += fillMatrix4x2(d, offs, MaterialUtil.scratchMat4a);
        }

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsBlendModulate)
            offs += this.paramFillScaleBias(d, offs, '$blendmasktransform');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            const envmapLightScale = this.paramGetNumber('$envmaplightscale');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection, envmapLightScale);
        }

        if (this.wantsSelfIllum)
            offs += this.paramFillGammaColor(d, offs, '$selfillumtint');

        if (this.wantsSelfIllumFresnel) {
            const minMaxExp = this.paramGetVector('$selfillumfresnelminmaxexp');
            const min = minMaxExp.get(0), max = minMaxExp.get(1), exp = minMaxExp.get(2);
            offs += fillVec4(d, offs, min, max, exp);
        }

        if (this.wantsPhong) {
            const fresnelRanges = this.paramGetVector('$phongfresnelranges');
            const r0 = fresnelRanges.get(0), r1 = fresnelRanges.get(1), r2 = fresnelRanges.get(2);
            offs += fillVec4(d, offs, r0, r1, r2, this.paramGetNumber('$phongalbedoboost'));
            offs += this.paramFillColor(d, offs, '$phongtint', this.paramGetNumber('$phongboost'));
        }

        if (this.wantsProjectedTexture) {
            const projectedLight = this.projectedLight!;
            // We only need rows for X, Y and W (skip Z).
            offs += fillMatrix4x4(d, offs, projectedLight.frustumView.clipFromWorldMatrix);
            colorScale(MaterialUtil.scratchColor, projectedLight.lightColor, projectedLight.lightColor.a * projectedLight.brightnessScale * 0.25);
            offs += fillColor(d, offs, MaterialUtil.scratchColor);
            offs += fillVec3v(d, offs, projectedLight.frustumView.cameraPos, projectedLight.farZ);
        }

        if (this.wantsTreeSway) {
            const windDirX = 0.5, windDirY = 0.5;
            const time = renderContext.globalTime;
            offs += fillVec4(d, offs, windDirX, windDirY, time, this.paramGetNumber('$treeswayspeed'));

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayheight'),
                this.paramGetNumber('$treeswaystartheight'),
                this.paramGetNumber('$treeswayradius'),
                this.paramGetNumber('$treeswaystartradius'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswaystrength'),
                this.paramGetNumber('$treeswayfalloffexp'),
                this.paramGetNumber('$treeswayspeedhighwindmultiplier'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayscrumblestrength'),
                this.paramGetNumber('$treeswayscrumblefalloffexp'),
                this.paramGetNumber('$treeswayscrumblefrequency'),
                this.paramGetNumber('$treeswayscrumblespeed'),
            );

            offs += fillVec4(d, offs,
                this.paramGetNumber('$treeswayspeedlerpstart'),
                this.paramGetNumber('$treeswayspeedlerpend'),
            );
        }

        // Compute modulation color.
        if (this.shaderType === GenericShaderType.Black) {
            colorCopy(MaterialUtil.scratchColor, OpaqueBlack);
            MaterialUtil.scratchColor.a *= this.paramGetNumber('$alpha');
            offs += fillColor(d, offs, MaterialUtil.scratchColor);
        } else {
            offs += this.paramFillModulationColor(d, offs, false);
        }

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        const specExponentFactor = this.wantsPhongExponentTexture ? this.paramGetNumber('$phongexponentfactor') : this.paramGetNumber('$phongexponent');
        const seamlessScale = this.paramGetNumber('$seamless_scale');
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor, specExponentFactor, seamlessScale);

        this.recacheProgram(renderContext.renderCache);
        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public destroy(device: GfxDevice): void {
    }
}
