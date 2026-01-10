
import { TextureMapping } from "../../TextureHolder.js";
import { fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import type { GfxMegaStateDescriptor, GfxProgram } from "../../gfx/platform/GfxPlatform.js";
import { GfxRendererLayer, GfxRenderInst, makeSortKey, setSortKeyProgramKey } from "../../gfx/render/GfxRenderInstManager.js";
import { assert } from "../../util.js";
import type { SourceRenderContext } from "../Main.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import { BaseMaterial, MaterialShaderTemplateBase, MaterialUtil } from "./MaterialBase.js";
import type { MaterialCache } from "./MaterialCache.js";
import * as P from "./MaterialParameters.js";

//#region Refract
export class ShaderTemplate_Refract extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision highp float;

${MaterialShaderTemplateBase.Common}

layout(std140) uniform ub_ObjectParams {
    vec4 u_BumpScaleBias;
    vec4 u_RefractTint;
    vec4 u_Misc[1];
#if defined USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
#if defined USE_VERTEX_MODULATE
    // XXX(jstpierre): ParticleSystem uses a uniform buffer until
    // we can switch it to using custom vertex data.
    vec4 u_FakeVertexModulate;
#endif
};

#define u_RefractAmount (u_RefractTint.a)
#define u_RefractDepth  (u_Misc[0].x)

// Base Texture Coordinates
varying vec3 v_TexCoord0;
// Normal Map Coordinates
varying vec2 v_TexCoord1;
varying vec3 v_PositionWorld;

#if defined USE_VERTEX_MODULATE
varying vec4 v_Modulate;
#endif

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Base Texture, Normalmap, Refract Tint Texture
layout(binding = 0) uniform sampler2D u_TextureBase;
layout(binding = 1) uniform sampler2D u_TextureNormalmap;
layout(binding = 2) uniform sampler2D u_TextureRefractTint;

// Envmap
layout(binding = 11) uniform samplerCube u_TextureEnvmap;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    v_PositionWorld.xyz = t_PositionWorld;
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);

    vec3 t_NormalWorld = normalize(t_WorldFromLocalMatrix * vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = normalize(t_WorldFromLocalMatrix * vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    // Convert from projected position to texture space.
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xy = CalcScaleBias(a_TexCoord01.xy, u_BumpScaleBias);

#if defined USE_VERTEX_MODULATE
    v_Modulate.rgba = a_Color.rgba * u_FakeVertexModulate.rgba;
#endif
}
#endif

#if defined FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord1.xy;
    vec4 t_BumpmapSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureNormalmap), t_BumpmapCoord0));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb;

    vec4 t_FinalColor = vec4(0);

    vec3 t_RefractTint = u_RefractTint.rgb;
#if defined USE_REFRACT_TINT_TEXTURE
    vec4 t_RefractTintTextureSample = texture(SAMPLER_2D(u_TextureRefractTint), t_BumpmapCoord0);
    t_RefractTint *= 2.0 * t_RefractTintTextureSample.rgb;
#endif

#if defined USE_VERTEX_MODULATE
    t_RefractTint.rgb *= v_Modulate.rgb;
#endif

#if defined USE_LOCAL_REFRACT
    vec3 t_LookDirWorld = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    // Get the tangent-space look direction to offset our texture.
    vec3 t_LookDirTangent = normalize(CalcWorldToTangent(t_LookDirWorld, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2));

    // Look dir in tangent space gives us the texture offset.
    // That is, when viewed in view-space, we move parallel to the view-space surface normal.
    vec2 t_RefractOffs = -t_LookDirTangent.xy / t_LookDirTangent.zz;
    vec2 t_RefractTexCoordOffs = t_RefractOffs.xy;

    // Add on the bumpmap normal for displacement.
    t_RefractTexCoordOffs += t_BumpmapNormal.xy + (1.0 - t_BumpmapNormal.z) * t_RefractOffs.xy;

    vec2 t_TexSize = vec2(textureSize(TEXTURE(u_TextureBase), 0));
    vec2 t_Aspect = vec2(-t_TexSize.y / t_TexSize.x, 1.0);
    t_RefractTexCoordOffs *= t_Aspect * u_RefractDepth;
    vec2 t_RefractTexCoord = v_TexCoord1.xy + t_RefractTexCoordOffs.xy;

    vec4 t_Refract1 = texture(SAMPLER_2D(u_TextureBase), saturate(t_RefractTexCoord));

    // "Shadow" since this is used to emulate light.
    vec4 t_Refract2 = texture(SAMPLER_2D(u_TextureBase), saturate(v_TexCoord1.xy + t_BumpmapNormal.xy * 0.1));

    vec3 t_Refract = mix(t_Refract1.rgb, t_Refract2.aaa, 0.025);

    // Add some cheap, fake, glass-y lighting using the bumpmap.
    float t_GlassLighting = pow(t_BumpmapNormal.z, 3.0);

    t_FinalColor.rgb += t_Refract.rgb * t_GlassLighting * t_RefractTint.rgb;
#else
    // "Classic" refract
    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;

    float t_RefractAmount = u_RefractAmount;
#if defined USE_VERTEX_MODULATE
    t_RefractAmount *= v_Modulate.a;
#endif

    vec2 t_RefractTexCoord = t_ProjTexCoord + (t_RefractAmount * t_BumpmapSample.a) * t_BumpmapNormal.xy;

    vec4 t_BlurAccum = vec4(0);
    int g_BlurAmount = BLUR_AMOUNT;
    int g_BlurWidth = g_BlurAmount * 2 + 1;
    float g_BlurWeight = 1.0 / (float(g_BlurWidth * g_BlurWidth) * u_ToneMapScale);

    vec2 t_FramebufferSize = vec2(textureSize(TEXTURE(u_TextureBase), 0));
    vec2 t_BlurSampleOffset = vec2(1.0) / t_FramebufferSize;
    for (int y = -g_BlurAmount; y <= g_BlurAmount; y++) {
        for (int x = -g_BlurAmount; x <= g_BlurAmount; x++) {
            vec2 t_TexCoord = t_RefractTexCoord + vec2(t_BlurSampleOffset.x * float(x), t_BlurSampleOffset.y * float(y));

#if GFX_VIEWPORT_ORIGIN_TL()
            t_TexCoord.y = 1.0 - t_TexCoord.y;
#endif

            t_BlurAccum += g_BlurWeight * texture(SAMPLER_2D(u_TextureBase), t_TexCoord);
        }
    }

    t_FinalColor.rgb += t_BlurAccum.rgb * t_RefractTint.rgb;
#endif

#if defined USE_ENVMAP
    vec3 t_NormalWorld = CalcTangentToWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_SpecularFactor = vec3(u_EnvmapTint);
    t_SpecularFactor.rgb *= t_BumpmapSample.a;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting += texture(SAMPLER_Cube(u_TextureEnvmap), t_Reflection).rgb * g_EnvmapScale;
    t_SpecularLighting *= t_SpecularFactor;

    t_SpecularLighting = mix(t_SpecularLighting, t_SpecularLighting*t_SpecularLighting, u_EnvmapContrastSaturationFresnel.x);
    t_SpecularLighting = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_SpecularLighting)), t_SpecularLighting, u_EnvmapContrastSaturationFresnel.y);

    t_FinalColor.rgb += t_SpecularLighting;
#endif

    t_FinalColor.a = t_BumpmapSample.a;

    CalcFog(t_FinalColor, v_PositionWorld.xyz);
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

export class Material_Refract extends BaseMaterial {
    private wantsEnvmap: boolean = false;
    private wantsLocalRefract: boolean = false;
    private wantsVertexModulate: boolean = false;

    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new P.ParameterTexture();
        p['$bumpframe']                    = new P.ParameterNumber(0);
        p['$bumptransform']                = new P.ParameterMatrix();
        p['$envmap']                       = new P.ParameterTexture(true, true);
        p['$envmapframe']                  = new P.ParameterNumber(0);
        p['$refracttint']                  = new P.ParameterColor(1, 1, 1);
        p['$refractamount']                = new P.ParameterNumber(2);
        p['$refracttinttexture']           = new P.ParameterTexture(true, false);
        p['$refracttinttextureframe']      = new P.ParameterNumber(0);
        p['$envmaptint']                   = new P.ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new P.ParameterNumber(0);
        p['$envmapsaturation']             = new P.ParameterNumber(1);
        p['$fresnelreflection']            = new P.ParameterNumber(1);
        p['$bluramount']                   = new P.ParameterNumber(1, false);
        p['$localrefract']                 = new P.ParameterBoolean(false, false);
        p['$localrefractdepth']            = new P.ParameterNumber(0.05);
        p['$vertexcolormodulate']          = new P.ParameterBoolean(false, false);

        this.paramGetTexture('$basetexture').ref = '_rt_RefractTexture';
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Refract);

        if (this.paramGetVTF('$envmap') !== null) {
            this.shaderInstance.setDefineBool('USE_ENVMAP', true);
            this.wantsEnvmap = true;
        }

        if (this.paramGetVTF('$refracttinttexture') !== null) {
            this.shaderInstance.setDefineBool('USE_REFRACT_TINT_TEXTURE', true);
        }

        if (this.paramGetBoolean('$localrefract')) {
            this.shaderInstance.setDefineBool('USE_LOCAL_REFRACT', true);
            this.wantsLocalRefract = true;
        }

        const blurAmount = this.paramGetNumber('$bluramount') | 0;
        this.shaderInstance.setDefineString('BLUR_AMOUNT', '' + blurAmount);

        if (this.hasVertexColorInput && (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha'))) {
            this.shaderInstance.setDefineBool('USE_VERTEX_COLOR', true);

            if (this.paramGetBoolean('$vertexcolormodulate')) {
                this.shaderInstance.setDefineBool('USE_VERTEX_MODULATE', true);
                this.wantsVertexModulate = true;
            }
        }

        const isTranslucent = this.textureIsTranslucent('$basetexture');
        this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendMode(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);
        this.isIndirect = this.textureIsIndirect('$basetexture');

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        MaterialUtil.resetTextureMappings(dst);
        this.paramGetTexture('$basetexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$normalmap').fillTextureMapping(dst[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$refracttinttexture').fillTextureMapping(dst[2], this.paramGetInt('$refracttinttextureframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(dst[11], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Refract.ub_ObjectParams, 24);
        const d = renderInst.mapUniformBufferF32(ShaderTemplate_Refract.ub_ObjectParams);

        offs += this.paramFillScaleBias(d, offs, '$bumptransform');
        offs += this.paramFillGammaColor(d, offs, '$refracttint', this.paramGetNumber('$refractamount'));
        offs += fillVec4(d, offs, this.paramGetNumber('$localrefractdepth'));

        if (this.wantsEnvmap) {
            offs += this.paramFillGammaColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        if (this.wantsVertexModulate)
            offs += this.paramFillGammaColor(d, offs, `$color`, this.paramGetNumber(`$alpha`));

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
