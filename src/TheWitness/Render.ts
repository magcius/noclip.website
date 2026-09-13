
import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { CameraController } from "../Camera.js";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA, Red, White } from "../Color.js";
import { AABB } from "../Geometry.js";
import { fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBindingLayoutSamplerDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxFormat, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxRenderProgramDescriptor, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTextureDimension, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { preprocessShader_GLSL } from "../gfx/shaderc/GfxShaderCompiler.js";
import { hashCodeNumberUpdate, HashMap } from "../HashMap.js";
import { setMatrixTranslation, Vec3UnitY } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { UberShaderInstance, UberShaderTemplate } from "../SourceEngine/UberShader.js";
import { TextureMapping } from "../TextureHolder.js";
import { nArray } from "../util.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { Asset_Type, Material_Flags, Material_Type, Mesh_Asset, Render_Material, Texture_Asset } from "./Assets.js";
import { Entity_World, Entity_Light, Lightmap_Table, MAX_LIGHTS_PER_ENTITY } from "./Entity.js";
import { noclipSpaceFromTheWitnessSpace, TheWitnessGlobals } from "./Globals.js";
import { Post_Process } from "./PostProcess.js";

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

    protected override createGfxProgramDescriptor(cache: GfxRenderCache, variantSettings: Render_Material, shaderTextOverride?: string): GfxRenderProgramDescriptor {
        const maxSamplerBinding = bindingLayouts[0].numSamplers - 1;
        const vendorInfo = cache.device.queryVendorInfo();
        const programString = shaderTextOverride ?? this.generateProgramString(variantSettings);
        const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', programString, null, maxSamplerBinding);
        const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', programString, null, maxSamplerBinding);
        return { preprocessedVert, preprocessedFrag };
    }

    protected override createGfxProgram(cache: GfxRenderCache, variantSettings: Render_Material): GfxProgram {
        // We do our own caching here; no need to use the render cache for this.
        return cache.device.createProgram(this.createGfxProgramDescriptor(cache, variantSettings));
    }

    public generateProgramString(m: Render_Material): string {
        return `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ViewProjection;
    Mat4x4 u_WorldFromClip;
    vec4 u_CameraPosWorld;
    vec4 u_KeyLightDir;
    vec4 u_KeyLightColor;

    vec4 u_FogColor;
    vec4 u_FogSkyColor;
    vec4 u_FogSunColor;
    // xyz: what the sky says the baked light is worth (lightmap_color * lightmap_brightness).
    // w: the sky's own brightness.
    vec4 u_LightMapScale;
    // xy: the world point the shadow map's first texel stands over, z: 1 / the world size it
    // covers, w: the height its zero reads as.
    vec4 u_ShadowMapParams;
    // x: the height range its full scale spans, y: 1 once the map is there, z: depth bias,
    // w: the height range the shadow edge is softened over.
    vec4 u_ShadowMapDecode;
};

#define u_WindDirection (vec3(u_CameraPosWorld.w, u_KeyLightDir.w, 0.0))
#define u_SceneTime (u_KeyLightColor.w)
#define u_SkyBrightness (u_LightMapScale.w)
#define u_ShadowMapEnabled (u_ShadowMapDecode.y)

layout(std140) uniform ub_ObjectParams {
    Mat3x4 u_ModelMatrix;
    vec4 u_MaterialColorAndEmission;
    vec4 u_FoliageParams;
    vec4 u_SpecularParams;
    vec4 u_Misc[1];

    // Terrain Tint System
    vec4 u_TerrainScaleBias;
    vec4 u_TintFactor;
    vec4 u_AverageColor[3];

    // The point lights reaching this entity; see Light_Manager. xyz: where the light stands,
    // w: 1 / its radius squared. rgb: colour times intensity, a: 0 in an unused slot.
    vec4 u_LightPosition[${MAX_LIGHTS_PER_ENTITY}];
    vec4 u_LightColor[${MAX_LIGHTS_PER_ENTITY}];
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

// The height at which the sun arrives, over every column of the world; see Shadow_Map.
uniform sampler2D u_ShadowMap;

// The scene as it stood before the water was drawn over it; see the 'Water' pass.
uniform sampler2D u_SceneColor;
uniform sampler2D u_SceneDepth;

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.CalcScaleBias}
${GfxShaderLibrary.MulNormalMatrix}

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
        t_LightMapSample += UnpackLightMapSample(textureLod(SAMPLER_2D(u_LightMap0), t_TexCoord.xy, 0.0)) * u_LightMap0Blend;
    if (u_LightMap1Blend > 0.0)
        t_LightMapSample += UnpackLightMapSample(textureLod(SAMPLER_2D(u_LightMap1), t_TexCoord.xy, 0.0)) * u_LightMap1Blend;
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

    mat4x3 t_ModelMatrix = UnpackMatrix(u_ModelMatrix);
    v_PositionWorld = t_ModelMatrix * vec4(t_PositionLocal, 1.0);

    vec3 t_NormalWorld = MulNormalMatrix(t_ModelMatrix, t_NormalLocal);
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_NormalWorld, t_TangentSWorld);

    bool use_wind = ${this.is_flag(m, Material_Flags.Wind_Animation)};
    if (use_wind) {
        vec4 t_WindParam = a_Color0.xyzw;
        vec3 t_ObjectPos = t_ModelMatrix[3];
        CalcTrunkWind(v_PositionWorld, a_Color0, t_ObjectPos);
    }

    gl_Position = UnpackMatrix(u_ViewProjection) * vec4(v_PositionWorld, 1.0);
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
    // A material that asks for no tint must come back untouched. It did not: the divide below
    // runs first, and a material with no texture in a slot gets an average colour of zero, so
    // the result was inf -- and mix(x, inf, 0.0) is inf * 0.0, which is NaN, not x. A NaN colour
    // then poisons the whole primitive through the blend, transparent texels included, which is
    // what turned the keep's rust stains into black slabs across its gateway.
    if (t_TintAmount <= 0.0)
        return t_Sample;

    vec3 t_TintedColor = t_TintColor.rgb * (t_Sample.rgb / max(t_AverageColor.rgb, vec3(1e-6)));
    t_Sample.rgb = mix(t_Sample.rgb, t_TintedColor.rgb, t_TintAmount);
    return t_Sample;
}

vec4 SampleTerrain() {
    vec2 t_TerrainTexCoord = CalcScaleBias(v_PositionWorld.xy, u_TerrainScaleBias);
    return texture(SAMPLER_2D(u_TerrainColor), t_TerrainTexCoord);
}

vec4 TintTerrain(in vec4 t_Sample, in vec4 t_TerrainSample, in vec3 t_AverageColor, in float t_TintAmount) {
    bool use_terrain_tint = ${this.is_type(m, Material_Type.Blended3) || this.is_type(m, Material_Type.Tinted) || this.is_type(m, Material_Type.Decal)};

    if (use_terrain_tint) {
        return TintTexture(t_Sample, t_TerrainSample.rgb, t_AverageColor, t_TintAmount);
    } else {
        return t_Sample;
    }
}

vec4 CalcAlbedoMap() {
    vec2 t_TexCoord0 = v_TexCoord0.xy;
    vec3 t_BlendWeightAlbedo = CalcBlendWeightAlbedo(t_TexCoord0.xy, v_Color0.rgba, u_BlendFactor);
    vec4 t_Albedo = vec4(0.0);
    vec4 t_TerrainSample = SampleTerrain();
    vec4 t_TexSample0 = texture(SAMPLER_2D(u_TextureMap0), t_TexCoord0.xy);
    vec4 t_TexSample1 = texture(SAMPLER_2D(u_TextureMap1), t_TexCoord0.xy);
    vec4 t_TexSample2 = texture(SAMPLER_2D(u_TextureMap2), t_TexCoord0.xy);
    if (t_BlendWeightAlbedo.x > 0.0)
        t_Albedo += TintTerrain(t_TexSample0, t_TerrainSample, u_AverageColor[0].rgb, u_TintFactor.x) * t_BlendWeightAlbedo.x;
    if (t_BlendWeightAlbedo.y > 0.0)
        t_Albedo += TintTerrain(t_TexSample1, t_TerrainSample, u_AverageColor[1].rgb, u_TintFactor.y) * t_BlendWeightAlbedo.y;
    if (t_BlendWeightAlbedo.z > 0.0)
        t_Albedo += TintTerrain(t_TexSample2, t_TerrainSample, u_AverageColor[2].rgb, u_TintFactor.z) * t_BlendWeightAlbedo.z;
    return t_Albedo;
}

vec3 CalcNormalMap() {
    vec2 t_TexCoord0 = v_TexCoord0.xy;
    vec3 t_BlendWeightNormal = CalcBlendWeightNormal(t_TexCoord0.xy, v_Color0.rgba, u_BlendFactor);
    vec3 t_NormalMapSample = vec3(0.0);
    vec3 t_NormalMap0 = UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap0), t_TexCoord0.xy));
    vec3 t_NormalMap1 = UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap1), t_TexCoord0.xy));
    vec3 t_NormalMap2 = UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap2), t_TexCoord0.xy));
    if (t_BlendWeightNormal.x > 0.0)
        t_NormalMapSample += t_NormalMap0.rgb * t_BlendWeightNormal.x;
    if (t_BlendWeightNormal.y > 0.0)
        t_NormalMapSample += t_NormalMap1.rgb * t_BlendWeightNormal.y;
    if (t_BlendWeightNormal.z > 0.0)
        t_NormalMapSample += t_NormalMap2.rgb * t_BlendWeightNormal.z;
    return t_NormalMapSample;
}

// The sky along a direction, without the sun's disc. The skydome draws with this, and the water
// reflects it, so the two always agree about what the sky looks like.
vec3 CalcSkyColor(in vec3 t_Direction) {
    vec3 t_Color = u_FogSkyColor.rgb;
    // Everything below mixes between colours, so the sky's brightness goes on at the end.

    float t_FogColorAmount = pow(saturate(1.0 - t_Direction.z), u_FogColor.a);
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogColorAmount);

    float t_SunAmount = saturate(dot(t_Direction.xyz, u_KeyLightDir.xyz));
    float t_FogSunColorAmount = pow(t_SunAmount, 8.0);
    t_Color.rgb = mix(t_Color.rgb, u_FogSunColor.rgb, t_FogSunColorAmount);

    return t_Color * u_SkyBrightness;
}

vec3 CalcWorldFromScreen(in vec2 t_ScreenUV, in float t_Depth) {
    vec4 t_PosClip = vec4(t_ScreenUV.xy * 2.0 - 1.0, t_Depth, 1.0);
#if !GFX_CLIPSPACE_NEAR_ZERO()
    t_PosClip.z = t_PosClip.z * 2.0 - 1.0;
#endif
    vec4 t_PosWorld = UnpackMatrix(u_WorldFromClip) * t_PosClip;
    return t_PosWorld.xyz / t_PosWorld.www;
}

// The island's lakes are mirrors, and what they mirror is standing right above them and already
// drawn: the water pass runs after the rest of the scene and has its colour and depth to hand.
// So the reflection is traced against those rather than by drawing the world a second time from
// under the surface. The march is in world space, projecting each step, which keeps the test
// below in metres instead of in the depth buffer's own crooked units. The water is not in that
// depth buffer yet, so the ray cannot trip over the surface it started from.
vec3 CalcScreenReflection(in vec3 t_Origin, in vec3 t_Direction, out float t_Confidence) {
    t_Confidence = 0.0;

    float t_Step = 0.4;
    vec3 t_Position = t_Origin;

    for (int i = 0; i < 20; i++) {
        t_Position += t_Direction * t_Step;
        t_Step *= 1.35;

        vec4 t_Clip = UnpackMatrix(u_ViewProjection) * vec4(t_Position, 1.0);
        if (t_Clip.w <= 0.0)
            return vec3(0.0);

        vec2 t_UV = (t_Clip.xy / t_Clip.w) * 0.5 + 0.5;
        if (t_UV.x < 0.0 || t_UV.x > 1.0 || t_UV.y < 0.0 || t_UV.y > 1.0)
            return vec3(0.0);

        vec3 t_ScenePosition = CalcWorldFromScreen(t_UV, texture(SAMPLER_2D(u_SceneDepth), t_UV).r);

        // Behind what was drawn there is a hit -- but only just behind it. Further back than the
        // step that carried us there and the ray has passed clean through something thin and
        // come out in front of scenery that has nothing to do with it.
        float t_Behind = distance(t_Position, u_CameraPosWorld.xyz) - distance(t_ScenePosition, u_CameraPosWorld.xyz);
        if (t_Behind > 0.0 && t_Behind < t_Step * 4.0) {
            // Nothing traced across the screen can know what lies outside it, so let the answer
            // fade out towards the borders rather than stop at one.
            vec2 t_Fade = smoothstep(vec2(0.0), vec2(0.12), t_UV) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - t_UV);
            t_Confidence = t_Fade.x * t_Fade.y;
            return texture(SAMPLER_2D(u_SceneColor), t_UV).rgb;
        }
    }

    return vec3(0.0);
}

vec4 CalcAlbedo() {
    bool use_sky = ${this.is_type(m, Material_Type.Sky)};
    if (use_sky) {
        vec3 t_Normal = normalize(v_PositionWorld.xyz);

        vec3 t_Color = CalcSkyColor(t_Normal);

        float t_SunAmount = saturate(dot(t_Normal.xyz, u_KeyLightDir.xyz));
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

    bool use_lightmap = ${this.is_flag(m, Material_Flags.Lightmapped)};

    // Whether the sun reaches this surface at all. The world ships a height field of itself,
    // swept along the sun into the height at which its light arrives, so the question is just
    // whether this point stands above that height -- which works for geometry that is nowhere
    // near here, and for geometry that has yet to stream in.
    float t_SunVisibility = 1.0;
    if (u_ShadowMapEnabled > 0.0) {
        vec2 t_ShadowCoord = (u_ShadowMapParams.xy - v_PositionWorld.yx) * u_ShadowMapParams.z;
        float t_SunReachesHeight = u_ShadowMapParams.w - texture(SAMPLER_2D(u_ShadowMap), t_ShadowCoord).r * u_ShadowMapDecode.x;
        float t_AboveShadow = v_PositionWorld.z - t_SunReachesHeight + u_ShadowMapDecode.z;
        t_SunVisibility = smoothstep(0.0, u_ShadowMapDecode.w, t_AboveShadow);
    }

    vec3 t_LightMapSample = vec3(0.0);
    if (use_lightmap) {
        bool use_vertex_lightmap = ${this.is_flag(m, Material_Flags.Vertex_Lightmap | Material_Flags.Vertex_Lightmap_Auto)};

        if (use_vertex_lightmap) {
            t_LightMapSample = v_LightMapData.xyz;
        } else {
            t_LightMapSample = CalcLightMapColor(v_LightMapData.xy);
        }

        // Without the map, the bake stands in for it: it already knows what is buried and what
        // is open, so dark bakes take little sun and open ones take it all.
        if (u_ShadowMapEnabled == 0.0) {
            float t_BakedBrightness = dot(t_LightMapSample * u_LightMapScale.rgb, vec3(0.2126, 0.7152, 0.0722));
            t_SunVisibility = clamp(t_BakedBrightness * 0.35, 0.15, 1.0);
        }
    }

    // Add directional light.
    CalcLight(t_HasIncomingLight, t_DiffuseLight, u_KeyLightDir.xyz, u_KeyLightColor.rgb * t_SunVisibility, t_NormalWorld.xyz, t_WorldDirectionToEye.xyz);

    // Add the world's own lamps. The bake carries the daylight and the bounce, but not these --
    // the interiors it lights are dark without them. Inverse square, windowed so a light stops
    // at the radius it states rather than trailing off across the island; the +1 keeps the pole
    // at the centre of the bulb from blowing out the surface it stands on. Nothing shadows
    // these, so a light does reach through a thin wall; their radii are small enough that it
    // costs less than leaving the rooms black.
    bool use_point_lights = ${this.is_type(m, Material_Type.Standard) || this.is_type(m, Material_Type.Blended) || this.is_type(m, Material_Type.Blended3) || this.is_type(m, Material_Type.Foliage)};
    if (use_point_lights) {
        for (int i = 0; i < ${MAX_LIGHTS_PER_ENTITY}; i++) {
            if (u_LightColor[i].a == 0.0)
                continue;

            vec3 t_ToLight = u_LightPosition[i].xyz - v_PositionWorld.xyz;
            float t_DistanceSq = dot(t_ToLight, t_ToLight);

            float t_Window = saturate(1.0 - t_DistanceSq * u_LightPosition[i].w);
            if (t_Window <= 0.0)
                continue;
            t_Window *= t_Window;

            float t_Attenuation = t_Window / (t_DistanceSq + 1.0);
            CalcLight(t_HasIncomingLight, t_DiffuseLight, normalize(t_ToLight), u_LightColor[i].rgb * t_Attenuation, t_NormalWorld.xyz, t_WorldDirectionToEye.xyz);
        }
    }

    if (use_lightmap) {
        bool use_vegetation = ${this.is_type(m, Material_Type.Vegetation)};
        if (use_vegetation) {
            // Kill some of the existing light.
            t_DiffuseLight *= t_LightMapSample * 0.5 + 0.5;
        } else {
            // Foliage and Standard both use a half-lambert mapping.
            t_LightMapSample *= HalfLambert(dot(t_NormalWorld, t_NormalWorldSurface));
        }

        t_DiffuseLight += t_LightMapSample * u_LightMapScale.rgb;
        // Only count the bake as light if a page is really bound. A material can be marked
        // lightmapped and have none -- the puzzle panels are, because the game draws and lights
        // those itself -- and Translucent takes no directional light either, so calling it lit
        // leaves the surface with nothing at all and paints it black. That is the grid on the
        // entry yard floor. Falling through to the unlit default below at least shows it.
        if (u_LightMap0Blend > 0.0 || u_LightMap1Blend > 0.0)
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

    // Lake is the sea and the big open water; Pool is the small still water -- the cave
    // pools, the cisterns. They are the same material to look at, and a Pool left out of
    // this branch has no albedo and no lightmap to fall back on, so it came out black.
    bool use_lake = ${this.is_type(m, Material_Type.Lake) || this.is_type(m, Material_Type.Pool)};
    if (use_lake) {
        // What the scene looked like where this pixel is, before the water went over it. The
        // fragment coordinate indexes the framebuffer directly, so it needs no flipping.
        vec2 t_ScreenUV = gl_FragCoord.xy / vec2(textureSize(TEXTURE(u_SceneDepth), 0));
        float t_SceneDepthSample = texture(SAMPLER_2D(u_SceneDepth), t_ScreenUV).r;

        // Turn that depth back into a world position, so the distance down through the water is
        // just the drop from this surface to whatever lies under it.
        vec3 t_BottomWorld = CalcWorldFromScreen(t_ScreenUV, t_SceneDepthSample);
        float t_WaterDepth = max(v_PositionWorld.z - t_BottomWorld.z, 0.0);

        // The island's water is still. Not nearly still -- still: the lakes are mirrors, and the
        // reflection puzzles are only readable because nothing disturbs them.
        vec3 t_WaterNormal = vec3(0.0, 0.0, 1.0);

        // Grazing angles mirror the sky, straight down looks into the water: the Fresnel term
        // between the two is what gives the horizon its pale band and the foreground its blue.
        vec3 t_Reflected = reflect(-t_WorldDirectionToEye, t_WaterNormal);
        vec3 t_SkyDirection = t_Reflected;
        t_SkyDirection.z = abs(t_SkyDirection.z);
        vec3 t_SkyReflection = CalcSkyColor(t_SkyDirection);

        float t_ViewDot = saturate(dot(t_WaterNormal, t_WorldDirectionToEye));
        float t_Fresnel = 0.02 + 0.98 * pow(1.0 - t_ViewDot, 5.0);

        // The world's own reflection where the screen still holds it, the sky wherever it does
        // not. Looking straight down the water barely reflects at all, and the march is much the
        // most expensive thing here, so it is only worth walking when the answer will be seen.
        vec3 t_Reflection = t_SkyReflection;
        if (t_Fresnel > 0.06) {
            float t_ReflectionConfidence;
            vec3 t_TracedReflection = CalcScreenReflection(v_PositionWorld.xyz, t_Reflected, t_ReflectionConfidence);
            t_Reflection = mix(t_SkyReflection, t_TracedReflection, t_ReflectionConfidence);
        }

        // Looking into the water: the bottom, dimmed by however much water stands over it. A
        // metre of it barely tints the sand; ten metres of it is just blue. Light travelling
        // down and back means the path is twice the depth.
        vec3 t_Bottom = texture(SAMPLER_2D(u_SceneColor), t_ScreenUV).rgb;
        vec3 t_Extinction = vec3(0.29, 0.086, 0.062);
        vec3 t_Transmittance = exp(-t_Extinction * (t_WaterDepth * 2.0));

        // What comes back out of deep water is skylight scattered by the column, so it belongs in
        // the same units as everything else the sky lights. The fixed colour this replaces was a
        // hundredth of what u_LightMapScale is worth, so deep water went to black wherever the
        // bottom was too far down to show through. The tint is that old constant normalised;
        // what it now multiplies is the sky's own brightness.
        vec3 t_DeepColor = vec3(0.048, 0.393, 1.0) * u_LightMapScale.rgb * 0.055;
        vec3 t_WaterColor = t_Bottom * t_Transmittance + t_DeepColor * (1.0 - t_Transmittance);

        t_FinalColor = mix(t_WaterColor, t_Reflection, t_Fresnel);

        // The sun's glint, tight enough to read as a highlight rather than a second sun.
        float t_SunDot = saturate(dot(t_SkyDirection, u_KeyLightDir.xyz));
        t_FinalColor += u_FogSunColor.rgb * pow(t_SunDot, 350.0) * 6.0;
    }

    // TODO(jstpierre): Fog

    // The scene is drawn in HDR; exposure, the filmic curve and the vignette come later, in
    // PostProcess.ts, the way the game does them.

    float t_Alpha = 1.0;
    bool use_albedo_alpha = ${this.is_type(m, Material_Type.Vegetation) || this.is_type(m, Material_Type.Foliage) || this.is_type(m, Material_Type.Translucent) || this.is_type(m, Material_Type.Cloud)};
    if (use_albedo_alpha) {
        t_Alpha *= t_Albedo.a;
    } else if (${this.is_type(m, Material_Type.Distant_Foliage)}) {
        t_Alpha *= t_Albedo.r;
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

    bool use_alpharef = ${this.is_type(m, Material_Type.Vegetation) || this.is_type(m, Material_Type.Foliage) || this.is_type(m, Material_Type.Hedge) || this.is_type(m, Material_Type.Grate) || this.is_type(m, Material_Type.Distant_Foliage)};
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
    light_set: Entity_Light[] | null;
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

export function load_texture(globals: TheWitnessGlobals, m: TextureMapping, texture_name: string | null, gfxSampler: GfxSampler): Texture_Asset | null {
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

    public destroy(device: GfxDevice): void {
        this.template.destroy(device);
    }
}

const scratchColor = colorNewCopy(White);
const scratchAABB = new AABB();
const ASSET_LOADS_PER_FRAME = 64;

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMatrix = mat4.create();
const KEY_LIGHT_STRENGTH = 12.0;
// The game's light intensities are in its own units, and the key light above is not the game's
// either, so the two have to be reconciled somewhere; this is where. Chosen so that the lamps in
// the caves and the huts read at about the strength the game's own screenshots show them.
const POINT_LIGHT_STRENGTH = 6.0;
class Device_Material {
    public visible: boolean = true;

    private shader_instance: TheWitnessShaderInstance;
    private gfx_program: GfxProgram;
    private texture_map: (Texture_Asset | null)[] = nArray(3, () => null);
    private texture_mapping_array: TextureMapping[] = nArray(13, () => new TextureMapping());
    public is_water: boolean = false;

    public sortKeyBase = 0;
    public megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(globals: TheWitnessGlobals, public render_material: Render_Material) {
        const __g = globalThis as any;
        const __t = Date.now();

        const wrap_sampler = globals.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const clamp_sampler = globals.renderCache.createSampler({
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
        if (material_type == Material_Type.Distant_Foliage)
            this.load_texture(globals, 0, `${globals.entity_manager.universe_name}_global-atlas`, texture_sampler);

        // 9, 10 are LightMap0 / LightMap1. By default, fill with white...
        this.load_texture(globals, 9, 'white', clamp_sampler);
        this.load_texture(globals, 10, 'white', clamp_sampler);

        if (globals.shadow_map !== null && globals.shadow_map.enabled)
            this.texture_mapping_array[12].copy(globals.shadow_map.texture_mapping);
        else
            this.load_texture(globals, 12, 'white', clamp_sampler);

        this.shader_instance = globals.device_material_cache.create_shader_instance(this.render_material);
        this.gfx_program = this.shader_instance.getGfxProgram(globals.renderCache);

        // Water draws in its own pass, once the rest of the scene is there to be seen through it.
        this.is_water = material_type === Material_Type.Lake || material_type === Material_Type.Pool;
        if (this.is_water) {
            this.texture_mapping_array.push(new TextureMapping(), new TextureMapping());
            this.texture_mapping_array[13].lateBinding = 'scene-color';
            this.texture_mapping_array[14].lateBinding = 'scene-depth';
        }

        // Disable invisible material types. Shadow_Only is the blob-shadow geometry the game
        // parks under trees and in doorways -- obj_primitives_shadowPlane and friends. It exists
        // to darken the bake, never to be looked at, and drawing it puts a flat black quad on the
        // ground at the foot of every mangrove.
        if (material_type === Material_Type.Collision_Only || material_type === Material_Type.Occluder || material_type === Material_Type.Shadow_Only)
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
        let offs = renderInst.allocateUniformBuffer(TheWitnessShaderTemplate.ub_ObjectParams, 4*4+4*9+4*(MAX_LIGHTS_PER_ENTITY*2));
        const d = renderInst.mapUniformBufferF32(TheWitnessShaderTemplate.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, params.model_matrix);

        let lightmap0Blend = 1, lightmap1Blend = 0;
        if (params.lightmap_table !== null && params.lightmap_table.current_page !== null) {
            lightmap0Blend = params.lightmap_table.blend;
            lightmap1Blend = 1.0 - params.lightmap_table.blend;

            lightmap0Blend *= params.lightmap_table.current_page.color_range;
            if (params.lightmap_table.next_page !== null)
                lightmap1Blend *= params.lightmap_table.next_page.color_range;
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

        // The lamps reaching this entity. An unused slot is left with an alpha of zero, which is
        // what the shader tests; the rest of it never gets read.
        const light_set = params.light_set;
        const light_count = light_set !== null ? Math.min(light_set.length, MAX_LIGHTS_PER_ENTITY) : 0;
        for (let i = 0; i < MAX_LIGHTS_PER_ENTITY; i++) {
            if (i >= light_count) {
                offs += fillVec4(d, offs, 0.0, 0.0, 0.0, 0.0);
                continue;
            }
            const light = light_set![i];
            offs += fillVec3v(d, offs, light.position, 1.0 / (light.radius * light.radius));
        }
        for (let i = 0; i < MAX_LIGHTS_PER_ENTITY; i++) {
            if (i >= light_count) {
                offs += fillVec4(d, offs, 0.0, 0.0, 0.0, 0.0);
                continue;
            }
            const light = light_set![i];
            const strength = light.intensity * POINT_LIGHT_STRENGTH;
            offs += fillVec4(d, offs, light.light_color[0] * strength, light.light_color[1] * strength, light.light_color[2] * strength, 1.0);
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
            if (device_material.is_water && globals.water_render_inst_list !== null)
                globals.water_render_inst_list.submitRenderInst(renderInst);
            else
                renderInstManager.submitRenderInst(renderInst);
        }
    }
}

// The scene depth the water reads is a depth texture, and the platform checks that the shader
// says so; everything else here is an ordinary colour map.
const samplerEntries: GfxBindingLayoutSamplerDescriptor[] = nArray(16, () => ({ dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float }));
samplerEntries[14] = { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Depth, comparison: false };

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 16, samplerEntries, },
];

class Skydome {
    public lightmap_table: Lightmap_Table | null = null;
    public color: Color = colorNewFromRGBA(0.213740, 0.404580, 0.519084);
    public model_matrix = mat4.create();
    public mesh_lod = 0;
    public light_set = null;

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

export class TheWitnessRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListWater = new GfxRenderInstList();

    private skydome: Skydome;

    private post_process: Post_Process;
    private sceneColorSampler: GfxSampler;
    private sceneDepthSampler: GfxSampler;

    constructor(device: GfxDevice, private globals: TheWitnessGlobals) {
        this.renderHelper = new GfxRenderHelper(device);
        this.sceneColorSampler = this.renderHelper.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.sceneDepthSampler = this.renderHelper.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.skydome = new Skydome(globals);

        globals.debug_draw = this.renderHelper.debugDraw;
        globals.water_render_inst_list = this.renderInstListWater;
        this.post_process = new Post_Process(device, this.renderHelper);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(1/100);
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        // Start the camera where the game starts the player: a marker the world names ':start'.
        const start = this.globals.entity_manager.flat_entity_list.find((e) => e.entity_name === ':start');
        if (start === undefined) {
            mat4.identity(dst);
            return;
        }

        // Work in The Witness's own space, where Z is up: lift the camera from the marker on the
        // ground to about eye height, and take the direction it faces with the vertical dropped,
        // which is what leaves the horizon level.
        vec3.set(scratchVec3a, start.position[0], start.position[1], start.position[2] + 1.2);
        vec3.transformQuat(scratchVec3b, Vec3UnitY, start.orientation);
        scratchVec3b[2] = 0.0;
        if (vec3.squaredLength(scratchVec3b) < 0.0001)
            vec3.copy(scratchVec3b, Vec3UnitY);
        vec3.normalize(scratchVec3b, scratchVec3b);
        vec3.add(scratchVec3b, scratchVec3a, scratchVec3b);

        // The camera matrix is noclip's, so hand both points over to that space, where up is +Y.
        vec3.transformMat4(scratchVec3a, scratchVec3a, noclipSpaceFromTheWitnessSpace);
        vec3.transformMat4(scratchVec3b, scratchVec3b, noclipSpaceFromTheWitnessSpace);

        mat4.targetTo(dst, scratchVec3a, scratchVec3b, Vec3UnitY);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const globals = this.globals;
        globals.scene_time = viewerInput.time / 1000;
        const viewpoint = globals.viewpoint;
        const misc = globals.all_variables.misc;

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        viewpoint.setupFromCamera(viewerInput.camera);
        this.renderHelper.debugDraw.beginFrame(viewpoint.clipFromViewMatrix, viewpoint.viewFromWorldMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        let offs = template.allocateUniformBuffer(TheWitnessShaderTemplate.ub_SceneParams, 72);
        const d = template.mapUniformBufferF32(TheWitnessShaderTemplate.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewpoint.clipFromWorldMatrix);
        mat4.invert(scratchMatrix, viewpoint.clipFromWorldMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillVec3v(d, offs, viewpoint.cameraPos, misc.wind_x as number);

        vec3.set(scratchVec3a, misc.sun_x as number, misc.sun_y as number, misc.sun_z as number);
        vec3.normalize(scratchVec3a, scratchVec3a);
        offs += fillVec3v(d, offs, scratchVec3a, misc.wind_y as number);
        // The bakes in this build carry the sky and the bounce, not the sun, so the directional
        // term is what separates a lit face from a shaded one. It could only be kept low while
        // it reached everywhere; now that Shadow_Map holds it off what the sun cannot see, it
        // can be turned up far enough to read as sunlight without washing the stone out.
        offs += fillVec4(d, offs, KEY_LIGHT_STRENGTH, KEY_LIGHT_STRENGTH, KEY_LIGHT_STRENGTH, globals.scene_time);

        const render_sky = globals.sky_variables['render/sky'];
        offs += fillVec4(d, offs, render_sky.fog_color_x as number, render_sky.fog_color_y as number, render_sky.fog_color_z as number, render_sky.fog_sky_blend as number);
        offs += fillVec4(d, offs, render_sky.fog_sky_color_x as number, render_sky.fog_sky_color_y as number, render_sky.fog_sky_color_z as number);
        offs += fillVec4(d, offs, render_sky.fog_sun_color_x as number, render_sky.fog_sun_color_y as number, render_sky.fog_sun_color_z as number);

        // The baked lighting carries the image in this game; the sky says how much it is worth.
        const lightmap_brightness = render_sky.lightmap_brightness as number;
        offs += fillVec4(d, offs,
            (render_sky.lightmap_color_x as number) * lightmap_brightness,
            (render_sky.lightmap_color_y as number) * lightmap_brightness,
            (render_sky.lightmap_color_z as number) * lightmap_brightness,
            render_sky.brightness as number);

        const shadow_map = globals.shadow_map;
        if (shadow_map !== null && shadow_map.enabled) {
            offs += fillVec4(d, offs, shadow_map.world_origin[0], shadow_map.world_origin[1], shadow_map.inv_world_size, shadow_map.z_max);
            offs += fillVec4(d, offs, shadow_map.z_range, 1.0, shadow_map.depth_bias, shadow_map.penumbra);
        } else {
            offs += fillVec4(d, offs, 0.0, 0.0, 0.0, 0.0);
            offs += fillVec4(d, offs, 1.0, 0.0, 0.0, 1.0);
        }

        globals.occlusion_manager.prepareToRender(globals, this.renderHelper.renderInstManager);

        // Building an asset costs about a millisecond, and a world holds far more of them than a
        // frame can afford, so the budget has to go somewhere. It goes to whatever covers the
        // most of the screen: entities offer up how much of it they stand to fill, and anything
        // under the floor waits. The floor rises while more is waiting than can be built and
        // falls once the view has caught up, which keeps it tracking the camera by itself.
        if (globals.asset_loads_remaining <= 0)
            globals.asset_load_priority_floor = Math.max(globals.asset_load_priority_floor, 1e-7) * 1.5;
        else if (globals.asset_loads_deferred === 0)
            globals.asset_load_priority_floor = 0.0;
        else
            globals.asset_load_priority_floor *= 0.6;

        globals.asset_loads_deferred = 0;
        globals.asset_loads_remaining = ASSET_LOADS_PER_FRAME;

        // Entities outside the cluster system -- the water among them -- come first. There are
        // far fewer of them than there are cluster elements, and going second left them at the
        // back of a queue the clusters never emptied, so the sea never arrived.
        for (let i = 0; i < globals.entity_render_list.unclustered_entities.length; i++) {
            const entity = globals.entity_render_list.unclustered_entities[i];
            entity.prepareToRender(globals, this.renderHelper.renderInstManager);
        }

        // Go through each entity cluster.
        for (let i = 0; i < globals.entity_render_list.clusters.length; i++) {
            const cluster = globals.entity_render_list.clusters[i];
            if (!cluster.occlusion_visible)
                continue;

            if (!viewpoint.frustum.containsSphere(cluster.bounding_center_world, cluster.bounding_radius_world))
                continue;

            // Brings in the cluster's package, which its elements load their assets out of. It
            // waits its turn by the same measure as everything else.
            if (!cluster.assets_are_loaded()) {
                const squared_distance = vec3.squaredDistance(viewpoint.cameraPos, cluster.bounding_center_world);
                if (cluster.asset_load_priority(squared_distance) < globals.asset_load_priority_floor) {
                    globals.asset_loads_deferred++;
                    continue;
                }

                cluster.ensure_assets_loaded(globals);
                if (!cluster.assets_are_loaded())
                    continue;
            }

            for (let j = 0; j < cluster.elements.length; j++) {
                const entity = globals.entity_manager.entity_list[cluster.elements[j]];
                if (entity === undefined)
                    continue;
                entity.prepareToRender(globals, this.renderHelper.renderInstManager);
            }
        }


        this.skydome.prepareToRender(globals, this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const globals = this.globals;

        viewerInput.camera.setClipPlanes(0.1);

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        globals.occlusion_manager.pushPasses(globals, builder, renderInstManager);

        // The scene is rendered in float, so the sun and sky keep their range until tone mapping.
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        mainColorDesc.pixelFormat = GfxFormat.F16_RGBA;
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        // The water goes over the finished scene, reading the colour and depth of what it stands
        // in front of so it can work out how deep it is at each pixel. The pass is built before
        // prepareToRender has filled any list, so it goes in unconditionally; with no water in
        // front of the camera it draws nothing.
        {
            builder.pushPass((pass) => {
                pass.setDebugName('Water');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const sceneColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(sceneColorResolveTextureID);
                const sceneDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
                pass.attachResolveTexture(sceneDepthResolveTextureID);

                pass.exec((passRenderer, scope) => {
                    this.renderInstListWater.resolveLateSamplerBinding('scene-color', { gfxTexture: scope.getResolveTextureForID(sceneColorResolveTextureID), gfxSampler: this.sceneColorSampler, lateBinding: undefined });
                    this.renderInstListWater.resolveLateSamplerBinding('scene-depth', { gfxTexture: scope.getResolveTextureForID(sceneDepthResolveTextureID), gfxSampler: this.sceneDepthSampler, lateBinding: undefined });
                    this.renderInstListWater.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                });
            });
        }

        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);

        const ldrColorTargetID = this.post_process.render(globals, builder, this.renderHelper, viewerInput, mainColorTargetID);

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, ldrColorTargetID, viewerInput.mouseLocation);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, ldrColorTargetID);
        builder.resolveRenderTargetToExternalTexture(ldrColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
        this.renderInstListWater.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.globals.destroy(device);
    }
}

