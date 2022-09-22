
import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { CameraController } from "../Camera";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA, White } from "../Color";
import { AABB } from "../Geometry";
import { fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxFormat, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgramDescriptorSimple, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxProgram, GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { setMatrixTranslation } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Asset_Type, Material_Flags, Material_Type, Mesh_Asset, Render_Material, Texture_Asset } from "./Assets";
import { Entity_World, Lightmap_Table } from "./Entity";
import { TheWitnessGlobals } from "./Globals";
import { UberShaderInstance, UberShaderTemplate } from "../SourceEngine/UberShader";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { preprocessShader_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { hashCodeNumberUpdate, HashMap } from "../HashMap";

class DepthCopyProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    float t_Depth = texture(SAMPLER_2D(u_Texture), v_TexCoord).r;
    gl_FragDepth = 1.0 - t_Depth;
}
`;
}

function shader_equals(a: Render_Material, b: Render_Material): boolean {
    // The only things that influence the shader are these.
    if (a.material_type !== b.material_type) return false;
    if (a.flags !== b.flags) return false;
    return true;
}

function shader_hash(a: Render_Material): number {
    let hash = 0;
    hash = hashCodeNumberUpdate(hash, a.material_type);
    hash = hashCodeNumberUpdate(hash, a.flags);
    return hash;
}

class TheWitnessShaderTemplate extends UberShaderTemplate<Render_Material> {
    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    constructor() {
        super();
        this.cache = new HashMap<Render_Material, GfxProgram>(shader_equals, shader_hash);
    }

    protected override createGfxProgramDescriptor(cache: GfxRenderCache, variantSettings: Render_Material, shaderTextOverride?: string): GfxProgramDescriptorSimple {
        const programString = shaderTextOverride !== undefined ? shaderTextOverride : this.generateProgramString(variantSettings);
        const preprocessedVert = preprocessShader_GLSL(cache.device.queryVendorInfo(), 'vert', programString);
        const preprocessedFrag = preprocessShader_GLSL(cache.device.queryVendorInfo(), 'frag', programString);
        return { preprocessedVert, preprocessedFrag };
    }

    protected override createGfxProgram(cache: GfxRenderCache, variantSettings: Render_Material): GfxProgram {
        // We do our own caching here; no need to use the render cache for this.
        return cache.device.createProgramSimple(this.createGfxProgramDescriptor(cache, variantSettings));
    }

    public generateProgramString(m: Render_Material): string {
        return `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ViewProjection;
    vec4 u_CameraPosWorld;
    vec4 u_KeyLightDir;
    vec4 u_KeyLightColor;

    vec4 u_FogColor;
    vec4 u_FogSkyColor;
    vec4 u_FogSunColor;
};

#define u_WindDirection (vec3(u_CameraPosWorld.w, u_KeyLightDir.w, 0.0))
#define u_SceneTime (u_KeyLightColor.w)

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_MaterialColorAndEmission;
    vec4 u_FoliageParams;
    vec4 u_SpecularParams;
    vec4 u_Misc[1];

    // Terrain Tint System
    vec4 u_TerrainScaleBias;
    vec4 u_TintFactor;
    vec4 u_AverageColor[3];
};

#define u_BlendFactor    (u_Misc[0].x)
#define u_LightMap0Blend (u_Misc[0].y)
#define u_LightMap1Blend (u_Misc[0].z)
#define u_UsageDetail    (u_Misc[0].w)

uniform sampler2D u_TextureMap0;
uniform sampler2D u_TextureMap1;
uniform sampler2D u_TextureMap2;

uniform sampler2D u_NormalMap0;
uniform sampler2D u_NormalMap1;
uniform sampler2D u_NormalMap2;

uniform sampler2D u_BlendMap0;
uniform sampler2D u_BlendMap1;
uniform sampler2D u_BlendMap2;

uniform sampler2D u_LightMap0;
uniform sampler2D u_LightMap1;

uniform sampler2D u_TerrainColor;

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.CalcScaleBias}

vec3 UnpackNormalMap(in vec4 t_NormalMapSample) {
    vec3 t_Normal;

    t_Normal.x = dot(t_NormalMapSample.xx, t_NormalMapSample.ww) - 1.0;
    t_Normal.y = t_NormalMapSample.y * 2.0 - 1.0;
    t_Normal.z = 1.0 - dot(t_Normal.xy, t_Normal.xy);

    return t_Normal;
}

vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}

vec3 UnpackLightMapSample(in vec4 t_Sample) {
    vec3 t_Color = t_Sample.rgb * ((t_Sample.a * 0.85) + 0.15);
    t_Color *= t_Color;
    return t_Color;
}

vec3 CalcLightMapColor(in vec2 t_TexCoord) {
    vec3 t_LightMapSample = vec3(0.0);
    if (u_LightMap0Blend > 0.0)
        t_LightMapSample += UnpackLightMapSample(texture(SAMPLER_2D(u_LightMap0), t_TexCoord.xy)) * u_LightMap0Blend;
    if (u_LightMap1Blend > 0.0)
        t_LightMapSample += UnpackLightMapSample(texture(SAMPLER_2D(u_LightMap1), t_TexCoord.xy)) * u_LightMap1Blend;
    return t_LightMapSample;
}

float smoothvalue(float t) {
    return (3.0 - 2.0 * t) * t * t;
}

// Scale/bias rather than specifying line endpoints
float smoothstep2(float m, float a, float x) {
    float t = saturate(m * x + a);
    return smoothvalue(t);
}

float TriangleWave(float t) {
    return abs(fract(t + 0.5) * 2.0 - 1.0);
}

float SmoothTriangleWave(float t) {
    return smoothvalue(TriangleWave(t));
}

varying vec2 v_TexCoord0;
varying vec3 v_LightMapData;
varying vec4 v_Color0;
varying vec3 v_PositionWorld;

// TBN
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

#ifdef VERT
layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec2 a_TexCoord0;
layout(location = 2) in vec2 a_TexCoord1;
layout(location = 3) in vec3 a_Normal;
layout(location = 4) in vec4 a_TangentS;
layout(location = 5) in vec4 a_Color0;
layout(location = 6) in vec4 a_Color1;
layout(location = 7) in vec4 a_BlendIndices;
layout(location = 8) in vec4 a_BlendWeights;

void CalcTrunkWind(inout vec3 t_PositionWorld, in vec4 a_WindParam, in vec3 t_ObjectPosition) {
    float t_WindFactor = a_WindParam.x;
    float t_Phase = dot(t_ObjectPosition.xy, u_WindDirection.xy);
    float t_Wave = ((4.0 * SmoothTriangleWave(t_Phase + u_SceneTime * 0.096)) - 1.0);
    float t_DistanceFromOrigin = distance(t_PositionWorld, t_ObjectPosition);

    t_PositionWorld -= t_WindFactor * (u_WindDirection * t_Wave);

    // Re-normalize to keep object lengths consistent.
    t_PositionWorld -= t_ObjectPosition;
    if (t_DistanceFromOrigin > 0.0)
        t_PositionWorld = normalize(t_PositionWorld) * t_DistanceFromOrigin;
    t_PositionWorld += t_ObjectPosition;
}

void mainVS() {
    vec3 t_PositionLocal = a_Position.xyz;
    vec3 t_NormalLocal = a_Normal.xyz;

    bool use_hedge = ${this.is_type(m, Material_Type.Hedge)};
    float t_ShellT = 0.0;
    if (use_hedge) {
        t_ShellT = (float(gl_InstanceID) / u_UsageDetail);
        float t_ShellExtrude = (t_ShellT * 0.03) + 0.015;
        t_PositionLocal += (t_NormalLocal * t_ShellExtrude);
    }

    v_PositionWorld = Mul(_Mat4x4(u_ModelMatrix), vec4(t_PositionLocal, 1.0)).xyz;

    vec3 t_NormalWorld = Mul(_Mat4x4(u_ModelMatrix), vec4(t_NormalLocal, 0.0)).xyz;
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_NormalWorld, t_TangentSWorld);

    bool use_wind = ${this.is_flag(m, Material_Flags.Wind_Animation)};
    if (use_wind) {
        vec4 t_WindParam = a_Color0.xyzw;
        vec3 t_ObjectPos = Mat4x3GetCol3(u_ModelMatrix);
        CalcTrunkWind(v_PositionWorld, a_Color0, t_ObjectPos);
    }

    gl_Position = Mul(u_ViewProjection, vec4(v_PositionWorld, 1.0));
    v_TexCoord0 = a_TexCoord0.xy;

    bool use_scroll_speed = ${this.is_type(m, Material_Type.Refract) || this.is_type(m, Material_Type.Decal)};
    if (use_scroll_speed) {
        float t_ScrollSpeed = u_SpecularParams.w;
        v_TexCoord0.y += t_ScrollSpeed * u_SceneTime;
    }

    v_TangentSpaceBasis0 = t_TangentSWorld * sign(a_TangentS.w);
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;
    v_Color0 = a_Color0;

    if (use_hedge) {
        v_Color0.w = t_ShellT;
    }

    bool use_vertex_lightmap = ${this.is_flag(m, Material_Flags.Vertex_Lightmap | Material_Flags.Vertex_Lightmap_Auto)};
    if (use_vertex_lightmap) {
        v_LightMapData = CalcLightMapColor(a_TexCoord1.xy);
    } else {
        v_LightMapData = vec3(a_TexCoord1.xy, 0.0);
    }
}
#endif

#ifdef FRAG
vec3 CalcBlendWeight2(in vec2 t_TexCoord, in vec4 t_Blend, in float t_BlendRange) {
    float t_Blend0 = t_Blend.w - texture(SAMPLER_2D(u_BlendMap0), t_TexCoord.xy).x;
    float t_Weight0 = t_Blend0 * t_BlendRange + 0.5;

    vec3 t_BlendWeight;
    t_BlendWeight.x = (1.0 - t_Weight0);
    t_BlendWeight.y = t_Weight0;
    t_BlendWeight.z = 0.0;
    return t_BlendWeight;
}

vec3 CalcBlendWeight3(in vec2 t_TexCoord, in vec4 t_Blend, in float t_BlendRange) {
    float t_Blend0 = t_Blend.x * texture(SAMPLER_2D(u_BlendMap0), t_TexCoord.xy).x;
    float t_Blend1 = t_Blend.y * texture(SAMPLER_2D(u_BlendMap1), t_TexCoord.xy).x;
    float t_Blend2 = t_Blend.z * texture(SAMPLER_2D(u_BlendMap2), t_TexCoord.xy).x;

    float t_Weight0 = saturate(((t_Blend1 - t_Blend0) / (t_Blend0 + t_Blend1)) * t_BlendRange + 0.5);
    float t_BlendM = max(t_Blend0, t_Blend1);
    float t_Weight1 = saturate(((t_Blend2 - t_BlendM) / (t_BlendM + t_Blend2)) * t_BlendRange + 0.5);

    vec3 t_BlendWeight;
    t_BlendWeight.x = (1.0 - t_Weight0) * (1.0 - t_Weight1);
    t_BlendWeight.y = t_Weight0 * (1.0 - t_Weight1);
    t_BlendWeight.z = t_Weight1;
    return t_BlendWeight;
}

vec3 CalcBlendWeightAlbedo(in vec2 t_TexCoord, in vec4 t_Blend, in float t_BlendRange) {
    bool type_blended = ${this.is_type(m, Material_Type.Blended)};
    bool type_blended3 = ${this.is_type(m, Material_Type.Blended3)};

    if (type_blended3) {
        return CalcBlendWeight3(t_TexCoord, t_Blend, t_BlendRange);
    } else if (type_blended) {
        return CalcBlendWeight2(t_TexCoord, t_Blend, t_BlendRange);
    } else {
        return vec3(1.0, 0.0, 0.0);
    }
}

vec3 CalcBlendWeightNormal(in vec2 t_TexCoord, in vec4 t_Blend, in float t_BlendRange) {
    bool type_blended3 = ${this.is_type(m, Material_Type.Blended3)};

    if (type_blended3) {
        return CalcBlendWeight3(t_TexCoord, t_Blend, t_BlendRange);
    } else {
        return vec3(1.0, 0.0, 0.0);
    }
}

float HalfLambert(in float t_Dot) {
    return saturate(t_Dot) * 0.5 + 0.5;
}

void CalcLight(inout bool t_HasLighting, inout vec3 t_Diffuse, vec3 t_LightDirWorld, vec3 t_LightColor, vec3 t_NormalWorld, vec3 t_WorldDirectionToEye) {
    float t_NoL = dot(t_NormalWorld, t_LightDirWorld);

    bool use_standard_light = ${this.is_type(m, Material_Type.Standard) || this.is_type(m, Material_Type.Blended) || this.is_type(m, Material_Type.Blended3)};
    if (use_standard_light) {
        t_NoL = saturate(t_NoL);
        t_NoL *= t_NoL;

        t_Diffuse += t_LightColor * t_NoL;
        t_HasLighting = true;
    }

    bool use_foliage = ${this.is_type(m, Material_Type.Foliage)};
    if (use_foliage) {
        if (t_NoL >= 0.0) {
            t_NoL = mix(0.2, 1.0, t_NoL);
        } else {
            t_NoL = (-0.3 * t_NoL) + 0.2;
        }

        t_NoL *= 0.578597;

        t_Diffuse += t_LightColor * t_NoL;
        t_HasLighting = true;
    }

    bool use_vegetation = ${this.is_type(m, Material_Type.Vegetation)};
    if (use_vegetation) {
        float t_Wrap = u_FoliageParams.x;

        t_NoL = saturate((t_NoL + t_Wrap) / (1.0 + t_Wrap));
        t_NoL *= 1.0 / (1.0 + t_Wrap);

        t_Diffuse += t_LightColor * t_NoL;
        t_HasLighting = true;
    }
}

vec4 TintTexture(in vec4 t_Sample, in vec3 t_TintColor, in vec3 t_AverageColor, in float t_TintAmount) {
    vec3 t_TintedColor = t_TintColor.rgb * (t_Sample.rgb / t_AverageColor.rgb);
    t_Sample.rgb = mix(t_Sample.rgb, t_TintedColor.rgb, t_TintAmount);
    return t_Sample;
}

vec4 SampleTerrain() {
    vec2 t_TerrainTexCoord = CalcScaleBias(v_PositionWorld.xy, u_TerrainScaleBias);
    return texture(SAMPLER_2D(u_TerrainColor), t_TerrainTexCoord);
}

vec4 TintTerrain(in vec4 t_Sample, in vec3 t_AverageColor, in float t_TintAmount) {
    bool use_terrain_tint = ${this.is_type(m, Material_Type.Blended3) || this.is_type(m, Material_Type.Tinted) || this.is_type(m, Material_Type.Decal)};

    if (use_terrain_tint) {
        vec3 t_TerrainColor = SampleTerrain().rgb;
        return TintTexture(t_Sample, t_TerrainColor, t_AverageColor, t_TintAmount);
    } else {
        return t_Sample;
    }
}

vec4 CalcAlbedoMap() {
    vec2 t_TexCoord0 = v_TexCoord0.xy;
    vec3 t_BlendWeightAlbedo = CalcBlendWeightAlbedo(t_TexCoord0.xy, v_Color0.rgba, u_BlendFactor);
    vec4 t_Albedo = vec4(0.0);
    if (t_BlendWeightAlbedo.x > 0.0)
        t_Albedo += TintTerrain(texture(SAMPLER_2D(u_TextureMap0), t_TexCoord0.xy), u_AverageColor[0].rgb, u_TintFactor.x) * t_BlendWeightAlbedo.x;
    if (t_BlendWeightAlbedo.y > 0.0)
        t_Albedo += TintTerrain(texture(SAMPLER_2D(u_TextureMap1), t_TexCoord0.xy), u_AverageColor[1].rgb, u_TintFactor.y) * t_BlendWeightAlbedo.y;
    if (t_BlendWeightAlbedo.z > 0.0)
        t_Albedo += TintTerrain(texture(SAMPLER_2D(u_TextureMap2), t_TexCoord0.xy), u_AverageColor[2].rgb, u_TintFactor.z) * t_BlendWeightAlbedo.z;
    return t_Albedo;
}

vec3 CalcNormalMap() {
    vec2 t_TexCoord0 = v_TexCoord0.xy;
    vec3 t_BlendWeightNormal = CalcBlendWeightNormal(t_TexCoord0.xy, v_Color0.rgba, u_BlendFactor);
    vec3 t_NormalMapSample = vec3(0.0);
    if (t_BlendWeightNormal.x > 0.0)
        t_NormalMapSample += UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap0), t_TexCoord0.xy)) * t_BlendWeightNormal.x;
    if (t_BlendWeightNormal.y > 0.0)
        t_NormalMapSample += UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap1), t_TexCoord0.xy)) * t_BlendWeightNormal.y;
    if (t_BlendWeightNormal.z > 0.0)
        t_NormalMapSample += UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap2), t_TexCoord0.xy)) * t_BlendWeightNormal.z;
    return t_NormalMapSample;
}

vec4 CalcAlbedo() {
    bool use_sky = ${this.is_type(m, Material_Type.Sky)};
    if (use_sky) {
        vec3 t_Normal = normalize(v_PositionWorld.xyz);

        vec3 t_Color = u_FogSkyColor.rgb;

        float t_FogColorAmount = pow(saturate(1.0 - t_Normal.z), u_FogColor.a);
        t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogColorAmount);

        float t_SunAmount = saturate(dot(t_Normal.xyz, u_KeyLightDir.xyz));
        float t_FogSunColorAmount = pow(t_SunAmount, 8.0);
        t_Color.rgb = mix(t_Color.rgb, u_FogSunColor.rgb, t_FogSunColorAmount);

        vec3 t_SunColor = vec3(1.0, 0.8, 0.4) * 256.0;
        t_Color.rgb += t_SunColor * smoothstep(0.9985, 0.9989, t_SunAmount);

        return vec4(t_Color, 1.0);
    }

    vec4 t_Color = CalcAlbedoMap();

    bool use_hedge = ${this.is_type(m, Material_Type.Hedge)};
    if (use_hedge) {
        float t_ShellT = v_Color0.w;
        t_Color.rgb *= 0.5 + (0.6 * t_ShellT);
    }

    return t_Color;
}

float Uncharted2Tonemap(float x) {
    // http://filmicworlds.com/blog/filmic-tonemapping-operators/
    float A = 0.15;
    float B = 0.5;
    float C = 0.1;
    float D = 0.1;
    float E = 0.02;
    float F = 0.6;
    return (((x * ((A * x) + (C * B))) + (D * E)) / ((x * ((A * x) + B)) + (D * F))) - (E / F);
}

void CalcToneMap(inout vec3 t_Color) {
    float t_Luma = max(max(max(t_Color.x, t_Color.y), t_Color.z), 0.01);
    float ExposureBias = 2.0;
    float t_TonemappedLuma = Uncharted2Tonemap(ExposureBias * t_Luma);

    float W = 32.0;
    float whiteScale = 1.0 / Uncharted2Tonemap(W);
    t_TonemappedLuma *= whiteScale;

    float t_Scale = (t_TonemappedLuma / t_Luma);
    t_Color.rgb *= t_Scale;
}

void mainPS() {
    vec2 t_TexCoord0 = v_TexCoord0.xy;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    vec4 t_Albedo = CalcAlbedo();
    vec3 t_NormalMapSample = CalcNormalMap();
    vec3 t_NormalWorld = CalcTangentToWorld(t_NormalMapSample, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
    vec3 t_NormalWorldSurface = normalize(v_TangentSpaceBasis2);

    t_Albedo.rgb *= u_MaterialColorAndEmission.rgb;

    vec3 t_DiffuseLight = vec3(0.0);

    bool t_HasIncomingLight = false;

    // Add directional light.
    CalcLight(t_HasIncomingLight, t_DiffuseLight, u_KeyLightDir.xyz, u_KeyLightColor.rgb, t_NormalWorld.xyz, t_WorldDirectionToEye.xyz);

    bool use_lightmap = ${this.is_flag(m, Material_Flags.Lightmapped)};
    if (use_lightmap) {
        bool use_vertex_lightmap = ${this.is_flag(m, Material_Flags.Vertex_Lightmap | Material_Flags.Vertex_Lightmap_Auto)};

        vec3 t_LightMapSample;
        if (use_vertex_lightmap) {
            t_LightMapSample = v_LightMapData.xyz;
        } else {
            t_LightMapSample = CalcLightMapColor(v_LightMapData.xy);
        }

        bool use_vegetation = ${this.is_type(m, Material_Type.Vegetation)};
        if (use_vegetation) {
            // Kill some of the existing light.
            t_DiffuseLight *= t_LightMapSample * 0.5 + 0.5;
        } else {
            // Foliage and Standard both use a half-lambert mapping.
            t_LightMapSample *= HalfLambert(dot(t_NormalWorld, t_NormalWorldSurface));
        }

        t_DiffuseLight += t_LightMapSample;
        t_HasIncomingLight = true;
    }

    if (!t_HasIncomingLight)
        t_DiffuseLight = vec3(1.0);

    bool use_cloud = ${this.is_type(m, Material_Type.Cloud)};
    if (use_cloud) {
        float t_Wrap = u_FoliageParams.x;
        float t_Dot = saturate((dot(t_NormalWorld.xyz, u_KeyLightDir.xyz) + t_Wrap) / (t_Wrap + 1.0));

        float t_Scatter = saturate(-10.0 * 0.9 + dot(t_WorldDirectionToEye.xyz, u_KeyLightDir.xyz));
        float t_Occlusion = saturate(1.75 - abs(dot(t_NormalWorld.xyz, u_KeyLightDir.xyz)));

        t_Dot += pow(t_Scatter * t_Occlusion, 4.0);

        t_DiffuseLight = vec3(0.0);
        t_DiffuseLight.rgb += (0.78 * t_Dot * u_KeyLightColor.rgb);
        t_DiffuseLight.rgb += vec3(2.496, 4.68, 2.64);
    }

    float t_Emission = u_MaterialColorAndEmission.a;
    t_DiffuseLight.rgb += vec3(t_Emission);

    vec3 t_FinalColor = vec3(0.0);
    t_FinalColor.rgb += t_DiffuseLight.rgb * t_Albedo.rgb;

    // TODO(jstpierre): Fog

    // Tone mapping & gamma correction
    CalcToneMap(t_FinalColor.rgb);
    t_FinalColor = pow(t_FinalColor, vec3(1.0 / 2.2));

    float t_Alpha = 1.0;
    bool use_albedo_alpha = ${this.is_type(m, Material_Type.Vegetation) || this.is_type(m, Material_Type.Foliage) || this.is_type(m, Material_Type.Translucent) || this.is_type(m, Material_Type.Cloud)};
    if (use_albedo_alpha) {
        t_Alpha *= t_Albedo.a;
    }

    bool use_hedge_alpha = ${this.is_type(m, Material_Type.Hedge)};
    if (use_hedge_alpha) {
        float t_ShellT = v_Color0.w;
        float t_Thresh = t_ShellT + (1.0 - v_Color0.x);
        t_Alpha = smoothstep(t_Thresh - 0.1, t_Thresh + 0.1, t_Albedo.a);
        if (t_Thresh <= 0.01)
            t_Alpha = 1.0;
    }

    bool use_blend_map_alpha = ${this.is_type(m, Material_Type.Grate)};
    if (use_blend_map_alpha) {
        float t_Blend0 = texture(SAMPLER_2D(u_BlendMap0), t_TexCoord0.xy).x;
        t_Alpha *= t_Blend0;
    }

    bool use_decal_alpha = ${this.is_type(m, Material_Type.Decal)};
    if (use_decal_alpha) {
        float t_Blend0 = texture(SAMPLER_2D(u_BlendMap0), t_TexCoord0.xy).x;
        float t_BlendFactor = saturate(v_Color0.r + (((v_Color0.r + t_Blend0) - 1.0) * u_BlendFactor));
        t_Alpha *= t_BlendFactor;
    }

    bool use_alpha_fade_out = ${this.is_type(m, Material_Type.Vegetation) || this.is_type(m, Material_Type.Foliage) || this.is_type(m, Material_Type.Cloud)};
    if (use_alpha_fade_out) {
        vec2 t_FadeOutParams = u_FoliageParams.zw;
        vec3 t_NormalP = normalize(cross(dFdx(v_PositionWorld.xyz), dFdy(v_PositionWorld.xyz)));
        float t_Dot = saturate(abs(dot(t_WorldDirectionToEye, t_NormalP)));
        t_Alpha += smoothstep2(t_FadeOutParams.x, t_FadeOutParams.y, t_Dot) - 1.0;
        t_Alpha = saturate(t_Alpha);
    }

    bool use_alpharef = ${this.is_type(m, Material_Type.Vegetation) || this.is_type(m, Material_Type.Foliage) || this.is_type(m, Material_Type.Hedge) || this.is_type(m, Material_Type.Grate)};
    if (use_alpharef) {
        if (t_Alpha < 0.5)
            discard;
    }

    gl_FragColor = vec4(t_FinalColor.rgb, t_Alpha);
}
#endif
`;
    }

    private is_type(m: Render_Material, type: Material_Type): boolean {
        return m.material_type === type;
    }

    private is_flag(m: Render_Material, flag: Material_Flags): boolean {
        return !!(m.flags & flag);
    }
}

interface Mesh_Render_Params {
    lightmap_table: Lightmap_Table | null;
    model_matrix: ReadonlyMat4;
    color: Color | null;
    mesh_lod: number;
}

function material_will_dynamically_override_color(type: Material_Type, flags: Material_Flags): boolean {
    if (!!(flags & Material_Flags.Dynamic_Substitute)) {
        if (type === Material_Type.Standard)
            return true;
        if (type === Material_Type.Blended)
            return true;
        if (type === Material_Type.Hedge)
            return true;
        if (type === Material_Type.Blended3)
            return true;
        if (type === Material_Type.Tinted)
            return true;
        if (type === Material_Type.Decal)
            return true;
        if (type === Material_Type.Puzzle)
            return true;
        if (type === Material_Type.Foam_Decal)
            return true;
        if (type === Material_Type.Underwater)
            return true;
    } else {
        if (type === Material_Type.Foliage)
            return true;
        if (type === Material_Type.Vegetation)
            return true;
    }

    return false;
}

function load_texture(globals: TheWitnessGlobals, m: TextureMapping, texture_name: string | null, gfxSampler: GfxSampler): Texture_Asset | null {
    m.gfxSampler = gfxSampler;
    if (texture_name === null)
        return null;
    const texture = globals.asset_manager.load_asset(Asset_Type.Texture, texture_name);
    if (texture !== null)
        texture.fillTextureMapping(m);
    return texture;
}

type TheWitnessShaderInstance = UberShaderInstance<Render_Material>;

export class Render_Material_Cache {
    private template = new TheWitnessShaderTemplate();

    public create_shader_instance(render_material: Render_Material): TheWitnessShaderInstance {
        return new UberShaderInstance<Render_Material>(this.template, render_material);
    }
}

const scratchColor = colorNewCopy(White);
const scratchAABB = new AABB();
const scratchVec3a = vec3.create();
class Device_Material {
    public visible: boolean = true;

    private shader_instance: TheWitnessShaderInstance;
    private gfx_program: GfxProgram;
    private texture_map: (Texture_Asset | null)[] = nArray(3, () => null);
    private texture_mapping_array: TextureMapping[] = nArray(12, () => new TextureMapping());

    public sortKeyBase = 0;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(globals: TheWitnessGlobals, public render_material: Render_Material) {
        const wrap_sampler = globals.cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const clamp_sampler = globals.cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        const material_type = this.render_material.material_type;
        const is_terrain = material_type === Material_Type.Blended3 || material_type === Material_Type.Tinted || material_type === Material_Type.Decal;
        const is_foliage = material_type === Material_Type.Foliage || material_type === Material_Type.Vegetation;

        if (is_terrain)
            this.load_texture(globals, 11, 'color_map', clamp_sampler);
        const texture_sampler = is_foliage ? clamp_sampler : wrap_sampler;

        for (let i = 0; i < 3; i++)
            this.texture_map[i] = this.load_texture(globals, 0 + i, this.render_material.texture_map_names[i], texture_sampler);
        for (let i = 0; i < 3; i++)
            this.load_texture(globals, 3 + i, this.render_material.normal_map_names[i], texture_sampler);
        for (let i = 0; i < 3; i++)
            this.load_texture(globals, 6 + i, this.render_material.blend_map_names[i], texture_sampler);

        // 9, 10 are LightMap0 / LightMap1. By default, fill with white...
        this.load_texture(globals, 9, 'white', clamp_sampler);
        this.load_texture(globals, 10, 'white', clamp_sampler);

        this.shader_instance = globals.device_material_cache.create_shader_instance(this.render_material);
        this.gfx_program = this.shader_instance.getGfxProgram(globals.cache);

        // Disable invisible material types.
        if (material_type === Material_Type.Collision_Only || material_type === Material_Type.Occluder)
            this.visible = false;

        // This should go in the foam decal pass only...
        if (material_type === Material_Type.Foam_Decal)
            this.visible = false;

        if (material_type === Material_Type.Translucent || material_type === Material_Type.Decal || material_type === Material_Type.Cloud) {
            this.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT, this.gfx_program.ResourceUniqueId);
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            this.megaStateFlags.depthWrite = false;
        } else if (material_type === Material_Type.Refract || material_type === Material_Type.Underwater) {
            this.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT, this.gfx_program.ResourceUniqueId);
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
        } else {
            this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE, this.gfx_program.ResourceUniqueId);
        }

        this.megaStateFlags.cullMode = GfxCullMode.Back;

        if (material_type === Material_Type.Foliage || material_type === Material_Type.Vegetation)
            this.megaStateFlags.cullMode = GfxCullMode.None;
    }

    private load_texture(globals: TheWitnessGlobals, i: number, texture_name: string | null, gfxSampler: GfxSampler): Texture_Asset | null {
        return load_texture(globals, this.texture_mapping_array[i], texture_name, gfxSampler);
    }

    public fillMaterialParams(globals: TheWitnessGlobals, renderInst: GfxRenderInst, params: Mesh_Render_Params): void {
        let offs = renderInst.allocateUniformBuffer(TheWitnessShaderTemplate.ub_ObjectParams, 4*4+4*9);
        const d = renderInst.mapUniformBufferF32(TheWitnessShaderTemplate.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, params.model_matrix);

        let lightmap0Blend = 1, lightmap1Blend = 0;
        if (params.lightmap_table !== null && params.lightmap_table.current_page !== null) {
            lightmap0Blend = params.lightmap_table.blend;
            lightmap1Blend = 1.0 - params.lightmap_table.blend;

            lightmap0Blend *= params.lightmap_table.current_page.color_range;
            if (params.lightmap_table.next_page !== null)
                lightmap0Blend *= params.lightmap_table.next_page.color_range;
        }

        const emission_scale = 10.0;

        if (params.color !== null && material_will_dynamically_override_color(this.render_material.material_type, this.render_material.flags)) {
            if (this.render_material.material_type === Material_Type.Vegetation && this.texture_map[0] !== null) {
                colorCopy(scratchColor, params.color);
                scratchColor.r /= this.texture_map[0].average_color.r;
                scratchColor.g /= this.texture_map[0].average_color.g;
                scratchColor.b /= this.texture_map[0].average_color.b;
                offs += fillColor(d, offs, scratchColor, scratchColor.a * emission_scale);
            } else {
                offs += fillColor(d, offs, params.color, params.color.a * emission_scale);
            }
        } else {
            offs += fillColor(d, offs, this.render_material.color, this.render_material.color.a * emission_scale);
        }

        offs += fillVec4v(d, offs, this.render_material.foliage_parameters);
        offs += fillVec4v(d, offs, this.render_material.specular_parameters);

        const blendFactor = 1.0 / this.render_material.blend_ranges[0];
        offs += fillVec4(d, offs, blendFactor, lightmap0Blend, lightmap1Blend, -this.render_material.usage_detail);

        // Terrain Tint System

        const terrain_scale = globals.all_variables.terrain.scale as number;
        const terrain_offset_x = globals.all_variables.terrain.offset_x as number;
        const terrain_offset_y = globals.all_variables.terrain.offset_y as number;

        const map_scale_x = terrain_scale;
        const map_scale_y = 0.5 * terrain_scale;
        const map_offset_x = terrain_offset_x;

        const alternate_map = !!(this.render_material.flags & Material_Flags.Alternate_Map);
        const map_offset_y = 0.5 * (terrain_offset_y + (alternate_map ? 0 : 1));
        offs += fillVec4(d, offs, map_scale_x, map_scale_y, map_offset_x, map_offset_y);

        offs += fillVec4v(d, offs, this.render_material.tint_factors);

        for (let i = 0; i < this.texture_map.length; i++) {
            if (this.texture_map[i] !== null)
                offs += fillColor(d, offs, this.texture_map[i]!.average_color);
            else
                offs += fillVec4(d, offs, 0);
        }
    }

    public setOnRenderInst(renderInst: GfxRenderInst, params: Mesh_Render_Params): void {
        if (params.lightmap_table !== null && params.lightmap_table.current_page !== null) {
            params.lightmap_table.current_page.fillTextureMapping(this.texture_mapping_array[9]);
            if (params.lightmap_table.next_page !== null)
                params.lightmap_table.next_page.fillTextureMapping(this.texture_mapping_array[10]);
        }

        renderInst.sortKey = this.sortKeyBase;
        renderInst.setGfxProgram(this.gfx_program);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setSamplerBindingsFromTextureMappings(this.texture_mapping_array);
    }
}

export class Mesh_Instance {
    public device_material_array: Device_Material[] = [];

    constructor(globals: TheWitnessGlobals, public mesh_asset: Mesh_Asset) {
        for (let i = 0; i < this.mesh_asset.material_array.length; i++)
            this.device_material_array.push(new Device_Material(globals, this.mesh_asset.material_array[i]));
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager, params: Mesh_Render_Params, depth: number): void {
        // Choose LOD level.
        const detail_level = params.mesh_lod;

        scratchAABB.transform(this.mesh_asset.box, params.model_matrix);
        if (!globals.viewpoint.frustum.contains(scratchAABB))
            return;

        for (let i = 0; i < this.mesh_asset.device_mesh_array.length; i++) {
            const device_mesh = this.mesh_asset.device_mesh_array[i];
            if (device_mesh.detail_level !== detail_level)
                continue;

            const device_material = this.device_material_array[device_mesh.material_index];
            if (!device_material.visible)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            device_mesh.setOnRenderInst(renderInst);
            device_material.setOnRenderInst(renderInst, params);
            device_material.fillMaterialParams(globals, renderInst, params);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        }
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 16, },
];

class Skydome {
    public lightmap_table: Lightmap_Table | null = null;
    public color: Color = colorNewFromRGBA(0.213740, 0.404580, 0.519084);
    public model_matrix = mat4.create();
    public mesh_lod = 0;

    private mesh_instance: Mesh_Instance;

    constructor(globals: TheWitnessGlobals) {
        const mesh_asset = globals.asset_manager.load_asset(Asset_Type.Mesh, 'new-skydome')!;

        // Do some finagling to set the material as the sky...
        mesh_asset.material_array[0].material_type = Material_Type.Sky;

        this.mesh_instance = new Mesh_Instance(globals, mesh_asset);
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
        setMatrixTranslation(this.model_matrix, globals.viewpoint.cameraPos);
        this.mesh_instance.prepareToRender(globals, renderInstManager, this, 0);
    }
}

export class Cached_Shadow_Map {
    public texture_mapping = nArray(1, () => new TextureMapping());
    private shadow_map_size = 8192;

    constructor(globals: TheWitnessGlobals, world: Entity_World) {
        const texture_name = `${globals.entity_manager.universe_name}_shadow_map_${this.shadow_map_size}`;

        const clamp_sampler = globals.cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        load_texture(globals, this.texture_mapping[0], texture_name, clamp_sampler);
    }
}

export class TheWitnessRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;

    private skydome: Skydome;
    private cached_shadow_map: Cached_Shadow_Map | null = null;

    constructor(device: GfxDevice, private globals: TheWitnessGlobals) {
        this.renderHelper = new GfxRenderHelper(device);
        this.skydome = new Skydome(globals);

        const world = this.globals.entity_manager.flat_entity_list.find((e) => e instanceof Entity_World) as Entity_World;
        // this.cached_shadow_map = new Cached_Shadow_Map(globals, world);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(1/100);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const globals = this.globals;
        globals.scene_time = viewerInput.time / 1000;
        const viewpoint = globals.viewpoint;
        const misc = globals.all_variables.misc;

        viewpoint.setupFromCamera(viewerInput.camera);
        let offs = template.allocateUniformBuffer(TheWitnessShaderTemplate.ub_SceneParams, 44);
        const d = template.mapUniformBufferF32(TheWitnessShaderTemplate.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewpoint.clipFromWorldMatrix);
        offs += fillVec3v(d, offs, viewpoint.cameraPos, misc.wind_x as number);

        vec3.set(scratchVec3a, misc.sun_x as number, misc.sun_y as number, misc.sun_z as number);
        vec3.normalize(scratchVec3a, scratchVec3a);
        offs += fillVec3v(d, offs, scratchVec3a, misc.wind_y as number);
        offs += fillVec4(d, offs, 32, 32, 32, globals.scene_time);

        const render_sky = globals.sky_variables['render/sky'];
        offs += fillVec4(d, offs, render_sky.fog_color_x as number, render_sky.fog_color_y as number, render_sky.fog_color_z as number, render_sky.fog_sky_blend as number);
        offs += fillVec4(d, offs, render_sky.fog_sky_color_x as number, render_sky.fog_sky_color_y as number, render_sky.fog_sky_color_z as number);
        offs += fillVec4(d, offs, render_sky.fog_sun_color_x as number, render_sky.fog_sun_color_y as number, render_sky.fog_sun_color_z as number);

        globals.occlusion_manager.prepareToRender(globals, this.renderHelper.renderInstManager);

        // Go through each entity and render them.
        for (let i = 0; i < globals.entity_manager.flat_entity_list.length; i++)
            globals.entity_manager.flat_entity_list[i].prepareToRender(globals, this.renderHelper.renderInstManager);

        this.skydome.prepareToRender(globals, this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const globals = this.globals;

        viewerInput.camera.setClipPlanes(0.1);

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        globals.occlusion_manager.pushPasses(globals, builder, renderInstManager);

        if (this.cached_shadow_map !== null) {
            const shadowDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D24);
            shadowDepthDesc.setDimensions(1024, 1024, 1);

            const shadowDepthTargetID = builder.createRenderTargetID(shadowDepthDesc, 'Main Depth');
            builder.pushPass((pass) => {
                pass.setDebugName('Cached Shadow Map');
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, shadowDepthTargetID);

                const renderHelper = this.renderHelper;
                const renderInst = renderHelper.renderInstManager.newRenderInst();
                renderInst.setUniformBuffer(renderHelper.uniformBuffer);
                renderInst.setAllowSkippingIfPipelineNotReady(false);

                renderInst.setMegaStateFlags(fullscreenMegaState);
                renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
                renderInst.drawPrimitives(3);

                const copyProgram = new DepthCopyProgram();
                const gfxProgram = renderHelper.renderCache.createProgram(copyProgram);

                renderInst.setGfxProgram(gfxProgram);

                pass.exec((passRenderer) => {
                    renderInst.setSamplerBindingsFromTextureMappings(this.cached_shadow_map!.texture_mapping);
                    renderInst.drawOnPass(renderHelper.renderCache, passRenderer);
                });
            });
        }

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}
