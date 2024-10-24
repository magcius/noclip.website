import {
    WowLightResult,
    WowVec3,
} from "../../rust/pkg/noclip_support";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import {
    fillMatrix4x3,
    fillMatrix4x4,
    fillVec4,
    fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxSamplerFormatKind, GfxTextureDimension } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { LiquidCategory } from "./data.js";
import { SkyboxColor } from "./mesh.js";
import { View } from "./scenes.js";

export class BaseProgram extends DeviceProgram {
    public static numUniformBuffers = 1;
    public static ub_SceneParams = 0;

    public static numSamplers = 0;

    public static utils = `
vec3 calcLight(
  vec3 diffuseColor,
  vec3 normal,
  vec4 interiorAmbientColor,
  vec4 interiorDirectColor,
  float interiorExteriorBlend,
  bool applyInteriorLight,
  bool applyExteriorLight,
  vec3 accumLight,
  vec3 precomputedLight,
  vec3 specular,
  vec3 emissive,
  float shadow) {
    vec3 lDiffuse = vec3(0.0);
    vec3 localDiffuse = accumLight;
    vec3 currentColor = vec3(0.0);
    vec3 normalizedN = normalize(normal);

    if (applyExteriorLight) {
        float nDotL = saturate(dot(normalizedN, -exteriorDirectColorDir.xyz));
        currentColor = exteriorAmbientColor.rgb + precomputedLight;
        vec3 skyColor = currentColor * 1.1f;
        vec3 groundColor = currentColor * 0.7f;
        lDiffuse = (exteriorDirectColor.xyz * nDotL) * (1.0 - shadow);
        currentColor = mix(groundColor, skyColor, nDotL * 0.5 + 0.5); // wrapped lighting
    }

    if (applyInteriorLight) {
        float nDotL = saturate(dot(normalizedN, -interiorSunDir.xyz));
        vec3 lDiffuseInterior = interiorDirectColor.xyz * nDotL;
        vec3 interiorAmbient = interiorAmbientColor.xyz + precomputedLight;

        if (applyExteriorLight) {
            lDiffuse = mix(lDiffuseInterior, lDiffuse, interiorExteriorBlend);
            currentColor = mix(interiorAmbient, currentColor, interiorExteriorBlend);
        } else {
            lDiffuse = lDiffuseInterior;
            currentColor = interiorAmbient;
        }
    }

    vec3 gammaDiffTerm = diffuseColor * (currentColor + lDiffuse);
    vec3 linearDiffTerm = (diffuseColor * diffuseColor) * localDiffuse;

    specular *= (1.0 - shadow);

    return sqrt(gammaDiffTerm*gammaDiffTerm + linearDiffTerm) + specular + emissive;
}

vec3 calcFog(vec3 inColor, vec3 worldPosition, bool isAdditive) {
    float dist = distance(u_CameraPos.xyz, worldPosition);
    float t = saturate(invlerp(fogParams.x, fogParams.y, dist)) * skyFogColor.a;
    if (isAdditive) {
        return mix(inColor, vec3(0.0), t);
    } else {
        return mix(inColor, skyFogColor.rgb, t);
    }
}

vec2 envmapTexCoord(const vec3 viewSpacePos, const vec3 viewSpaceNormal) {
    vec3 refl = reflect(-normalize(viewSpacePos), normalize(viewSpaceNormal));
    refl.z += 1.0;
    refl = normalize(refl);
    return refl.xy * 0.5 + vec2(0.5);
}
  `;

    public static commonDeclarations = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_View;
    vec4 u_CameraPos;

    // lighting
    vec4 interiorSunDir;
    vec4 exteriorDirectColorDir;
    vec4 exteriorDirectColor;
    vec4 exteriorAmbientColor;
    vec4 skyTopColor;
    vec4 skyMiddleColor;
    vec4 skyBand1Color;
    vec4 skyBand2Color;
    vec4 skyFogColor;
    vec4 skySmogColor;
    vec4 sunColor;
    vec4 cloudSunColor;
    vec4 cloudEmissiveColor;
    vec4 cloudLayer1AmbientColor;
    vec4 cloudLayer2AmbientColor;
    vec4 oceanCloseColor;
    vec4 oceanFarColor;
    vec4 riverCloseColor;
    vec4 riverFarColor;
    vec4 shadowOpacity;
    vec4 fogParams; // fogStart, fogEnd
    vec4 waterAlphas; // riverShallow, riverDeep, oceanShallow, oceanDeep
    vec4 glow; // glow, highlightSky, _, _
};

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}
${BaseProgram.utils}
  `;

    public static layoutUniformBufs(renderInst: GfxRenderInst, view: View, lightingData: WowLightResult) {
        const numVec4s = 24;
        const totalSize = 16 + 12 + numVec4s * 4;
        let offset = renderInst.allocateUniformBuffer(
            BaseProgram.ub_SceneParams,
            totalSize,
        );
        const uniformBuf = renderInst.mapUniformBufferF32(
            BaseProgram.ub_SceneParams,
        );

        offset += fillMatrix4x4(uniformBuf, offset, view.clipFromViewMatrix);
        offset += fillMatrix4x3(uniformBuf, offset, view.viewFromWorldMatrix);
        offset += fillVec4(
            uniformBuf,
            offset,
            view.cameraPos[0],
            view.cameraPos[1],
            view.cameraPos[2],
            0.0,
        );

        // lighting
        offset += fillVec4v(uniformBuf, offset, view.interiorSunDirection);
        offset += fillVec4v(
            uniformBuf,
            offset,
            view.exteriorDirectColorDirection,
        );
        offset += fillColor(uniformBuf, offset, lightingData.direct_color);
        offset += fillColor(uniformBuf, offset, lightingData.ambient_color);
        offset += fillColor(uniformBuf, offset, lightingData.sky_top_color);
        offset += fillColor(uniformBuf, offset, lightingData.sky_middle_color);
        offset += fillColor(uniformBuf, offset, lightingData.sky_band1_color);
        offset += fillColor(uniformBuf, offset, lightingData.sky_band2_color);
        offset += fillColor(
            uniformBuf,
            offset,
            lightingData.sky_fog_color,
            view.fogEnabled ? 1.0 : 0.0,
        );
        offset += fillColor(uniformBuf, offset, lightingData.sky_smog_color);
        offset += fillColor(uniformBuf, offset, lightingData.sun_color);
        offset += fillColor(uniformBuf, offset, lightingData.cloud_sun_color);
        offset += fillColor(
            uniformBuf,
            offset,
            lightingData.cloud_emissive_color,
        );
        offset += fillColor(
            uniformBuf,
            offset,
            lightingData.cloud_layer1_ambient_color,
        );
        offset += fillColor(
            uniformBuf,
            offset,
            lightingData.cloud_layer2_ambient_color,
        );
        offset += fillColor(uniformBuf, offset, lightingData.ocean_close_color);
        offset += fillColor(uniformBuf, offset, lightingData.ocean_far_color);
        offset += fillColor(uniformBuf, offset, lightingData.river_close_color);
        offset += fillColor(uniformBuf, offset, lightingData.river_far_color);
        offset += fillColor(uniformBuf, offset, lightingData.shadow_opacity);
        const fogEnd = view.cullingFarPlane;
        const fogStart = Math.max(lightingData.fog_scaler * fogEnd, 0);
        offset += fillVec4(uniformBuf, offset, fogStart, fogEnd, 0, 0);
        offset += fillVec4(
            uniformBuf,
            offset,
            lightingData.water_shallow_alpha,
            lightingData.water_deep_alpha,
            lightingData.ocean_shallow_alpha,
            lightingData.ocean_deep_alpha,
        );
        offset += fillVec4(
            uniformBuf,
            offset,
            lightingData.glow,
            lightingData.highlight_sky ? 1 : 0,
            0,
            0,
        );
    }
}

function fillColor(buf: Float32Array, offset: number, color: WowVec3, a: number = 1.0) {
    buf[offset + 0] = color.x;
    buf[offset + 1] = color.y;
    buf[offset + 2] = color.z;
    buf[offset + 3] = a;
    color.free();
    return 4;
}

export class SkyboxProgram extends BaseProgram {
    public static a_Position = 0;
    public static a_ColorIndex = 1;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers,
            numSamplers: super.numSamplers,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

varying vec4 v_Color;

#ifdef VERT
layout(location = ${SkyboxProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${SkyboxProgram.a_ColorIndex}) attribute float a_ColorIndex;

void mainVS() {
    int colorIndex = int(a_ColorIndex);
    v_Color = vec4(1.0);
    if (colorIndex == ${SkyboxColor.Top}) {
      v_Color = skyTopColor;
    } else if (colorIndex == ${SkyboxColor.Middle}) {
      v_Color = skyMiddleColor;
    } else if (colorIndex == ${SkyboxColor.Band1}) {
      v_Color = skyBand1Color;
    } else if (colorIndex == ${SkyboxColor.Band2}) {
      v_Color = skyBand2Color;
    } else if (colorIndex == ${SkyboxColor.Smog}) {
      v_Color = skySmogColor;
    } else if (colorIndex == ${SkyboxColor.Fog}) {
      v_Color = skyFogColor;
    } else {
      v_Color = vec4(1.0, 0.0, 1.0, 1.0);
    }
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), vec4(a_Position, 0.0)));
}
#endif

#ifdef FRAG
void mainPS() {
    gl_FragColor = v_Color;
}
#endif
`;
}

export class WmoProgram extends BaseProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color0 = 2;
    public static a_Color1 = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord1 = 5;
    public static a_TexCoord2 = 6;
    public static a_TexCoord3 = 7;

    public static ub_ModelParams = 1;
    public static ub_BatchParams = 2;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 2,
            numSamplers: super.numSamplers + 4,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

layout(std140) uniform ub_ModelParams {
    Mat4x3 u_Transform;
};

layout(std140) uniform ub_BatchParams {
    vec4 shaderParams; // vertexShader, pixelShader, numColorBufs, _
    vec4 materialParams; // blendMode, applyInteriorLight, applyExteriorLight, unlit
    vec4 moreMaterialParams; // unfogged, exterior_light, sidn, window
    vec4 sidnColor;
    vec4 interiorAmbientColor; // rgb, _
    vec4 interiorDirectColor; // rgb, _
};

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;

varying vec2 v_UV0;
varying vec2 v_UV1;
varying vec2 v_UV2;
varying vec2 v_UV3;
varying vec4 v_Color0;
varying vec4 v_Color1;
varying vec3 v_Normal;
varying vec3 v_Position;

#ifdef VERT
layout(location = ${WmoProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${WmoProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${WmoProgram.a_Color0}) attribute vec4 a_Color0;
layout(location = ${WmoProgram.a_Color1}) attribute vec4 a_Color1;
layout(location = ${WmoProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${WmoProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;
layout(location = ${WmoProgram.a_TexCoord2}) attribute vec2 a_TexCoord2;
layout(location = ${WmoProgram.a_TexCoord3}) attribute vec2 a_TexCoord3;

${GfxShaderLibrary.MulNormalMatrix}

void mainVS() {
    v_Position = Mul(u_Transform, vec4(a_Position, 1.0)).xyz;
    v_Normal = MulNormalMatrix(u_Transform, a_Normal);

    vec3 viewPosition = Mul(_Mat4x4(u_View), vec4(v_Position, 1.0)).xyz;
    vec3 viewNormal = Mul(_Mat4x4(u_View), vec4(v_Normal, 0.0)).xyz;
    gl_Position = Mul(u_Projection, vec4(viewPosition, 1.0));

    int numColorBuffers = int(shaderParams.z);
    v_Color0 = numColorBuffers >= 1 ? a_Color0.bgra : vec4(0.0, 0.0, 0.0, 1.0);
    v_Color1 = numColorBuffers >= 2 ? a_Color1.rgba : vec4(0.0, 0.0, 0.0, 1.0);

    int vertexShader = int(shaderParams.x);
    if (vertexShader == ${rust.WowWmoMaterialVertexShader.None}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1;
       v_UV2 = a_TexCoord2;
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseT1}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1; //not used
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseT1Refl}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = reflect(normalize(viewPosition), viewNormal).xy;
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseT1EnvT2}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = envmapTexCoord(viewPosition, viewNormal);
       v_UV2 = a_TexCoord2;
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.SpecularT1}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1; //not used
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseComp}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1; //not used
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseCompRefl}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1;
       v_UV2 = reflect(normalize(viewPosition), viewNormal).xy;
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseCompTerrain}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = viewPosition.xy * -0.239999995;
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.DiffuseCompAlpha}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = viewPosition.xy * -0.239999995;
       v_UV2 = a_TexCoord2; //not used
   } else if (vertexShader == ${rust.WowWmoMaterialVertexShader.Parallax}) {
       v_UV0 = a_TexCoord0;
       v_UV1 = a_TexCoord1;
       v_UV2 = a_TexCoord2;
   }
}
#endif

#ifdef FRAG

vec3 Slerp(vec3 p0, vec3 p1, float t) {
    float dotp = dot(normalize(p0), normalize(p1));
    if ((dotp > 0.9999) || (dotp < -0.9999)) {
        return t <= 0.5 ? p0 : p1;
    }
    float theta = acos(dotp);
    vec3 P = ((p0*sin((1.0-t)*theta) + p1*sin(t*theta)) / sin(theta));

    return P;
}

vec3 calcSpec(float texAlpha) {
    vec3 normal = normalize(v_Normal);
    bool enableInteriorLight = int(materialParams.y) > 0;
    bool enableExteriorLight = int(materialParams.z) > 0;
    vec3 sunDir = vec3(0.0);
    vec3 sunColor = vec3(0.0);

    if (enableExteriorLight) {
        sunDir = -exteriorDirectColorDir.xyz;
        sunColor = exteriorDirectColor.rgb;
    }

    if (enableInteriorLight) {
        sunDir = -interiorSunDir.xyz;
        sunColor = interiorDirectColor.rgb;

        if (enableExteriorLight) {
            sunDir = Slerp(sunDir, -exteriorDirectColorDir.xyz, v_Color0.a);
            sunColor = mix(sunColor, exteriorDirectColor.rgb, v_Color0.a);
        }
    }

    vec3 dirToEye = normalize(u_CameraPos.xyz - v_Position.xyz);
    vec3 halfDir = normalize(sunDir + dirToEye);
    float dirAtten = saturate(dot(normal, sunDir));
    float spec = (1.25 * pow(saturate(dot(normal, halfDir)), 8.0));
    vec3 specTerm = ((((vec3(mix(pow((1.0 - saturate(dot(sunDir, halfDir))), 5.0), 1.0, texAlpha)) * spec) * sunColor) * dirAtten));
    return specTerm;
}

void mainPS() {
    vec4 tex = texture(SAMPLER_2D(u_Texture0), v_UV0);
    vec4 tex2 = texture(SAMPLER_2D(u_Texture1), v_UV1);
    vec4 tex3 = texture(SAMPLER_2D(u_Texture2), v_UV2);

    int blendMode = int(materialParams.x);
    if (blendMode == ${rust.WowM2BlendingMode.AlphaKey}) {
        if (tex.a < 0.501960814) {
            discard;
        }
    }

    vec4 finalColor = vec4(0.0, 0.0, 0.0, 1.0);
    vec3 matDiffuse = vec3(0.0);
    vec3 spec = vec3(0.0);
    vec3 emissive = vec3(0.0);
    float finalOpacity = 0.0;
    float distFade = 1.0;

    int pixelShader = int(shaderParams.y);
    if (pixelShader == ${rust.WowWmoMaterialPixelShader.None}) {
        matDiffuse = tex.rgb * tex2.rgb;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Diffuse}) {
        matDiffuse = tex.rgb;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Specular}) {
        matDiffuse = tex.rgb;
        spec = calcSpec(tex.a);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Metal}) {
        matDiffuse = tex.rgb;
        spec = calcSpec(((tex * 4.0) * tex.a).x);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Env}) {
        matDiffuse = tex.rgb ;
        emissive = tex2.rgb * tex.a * distFade;
        finalOpacity = 1.0;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Opaque}) {
        matDiffuse = tex.rgb ;
        finalOpacity = 1.0;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.EnvMetal}) {
        matDiffuse = tex.rgb ;
        emissive = (((tex.rgb * tex.a) * tex2.rgb) * distFade);
        finalOpacity = 1.0;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuse}) {
        vec3 layer1 = tex.rgb;
        vec3 layer2 = mix(layer1, tex2.rgb, tex2.a);
        matDiffuse = mix(layer2, layer1, v_Color1.a);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerEnvMetal}) {
        vec4 colorMix = mix(tex, tex2, 1.0 - v_Color1.a);
        matDiffuse = colorMix.rgb ;
        emissive = (colorMix.rgb * colorMix.a) * tex3.rgb * distFade;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerTerrain}) {
        vec3 layer1 = tex.rgb;
        vec3 layer2 = tex2.rgb;
        matDiffuse = mix(layer2, layer1, v_Color1.a);
        spec = calcSpec(tex2.a * (1.0 - v_Color1.a));
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.DiffuseEmissive}) {
        matDiffuse = tex.rgb ;
        emissive = tex2.rgb * tex2.a * v_Color1.a;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.MaskedEnvMetal}) {
        float mixFactor = clamp((tex3.a * v_Color1.a), 0.0, 1.0);
        matDiffuse =
            mix(mix(((tex.rgb * tex2.rgb) * 2.0), tex3.rgb, mixFactor), tex.rgb, tex.a);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.EnvMetalEmissive}) {
        matDiffuse = tex.rgb ;
        emissive =
            (
                ((tex.rgb * tex.a) * tex2.rgb) +
                ((tex3.rgb * tex3.a) * v_Color1.a)
            );
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuseOpaque}) {
        matDiffuse = mix(tex2.rgb, tex.rgb, v_Color1.a);
        finalOpacity = 1.0;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuseEmissive}) {
        vec3 t1diffuse = (tex2.rgb * (1.0 - tex2.a));
        matDiffuse = mix(t1diffuse, tex.rgb, v_Color1.a);
        emissive = (tex2.rgb * tex2.a) * (1.0 - v_Color1.a);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.AdditiveMaskedEnvMetal}) {
        matDiffuse = mix(
            (tex.rgb * tex2.rgb * 2.0) + (tex3.rgb * clamp(tex3.a * v_Color1.a, 0.0, 1.0)),
            tex.rgb,
            vec3(tex.a)
        );
        finalOpacity = 1.0;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuseMod2x}) {
        vec3 layer1 = tex.rgb;
        vec3 layer2 = mix(layer1, tex2.rgb, vec3(tex2.a));
        vec3 layer3 = mix(layer2, layer1, vec3(v_Color1.a));
        matDiffuse = layer3 * tex3.rgb * 2.0;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuseMod2xNA}) {
        vec3 layer1 = ((tex.rgb * tex2.rgb) * 2.0);
        matDiffuse = mix(tex.rgb, layer1, vec3(v_Color1.a)) ;
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.TwoLayerDiffuseAlpha}) {
        vec3 layer1 = tex.rgb;
        vec3 layer2 = mix(layer1, tex2.rgb, vec3(tex2.a));
        vec3 layer3 = mix(layer2, layer1, vec3(tex3.a));
        matDiffuse = ((layer3 * tex3.rgb) * 2.0);
        finalOpacity = tex.a;
    } else if (pixelShader == ${rust.WowWmoMaterialPixelShader.Lod}) {
        matDiffuse = tex.rgb;
        finalOpacity = tex.a;
    } else {
        // unsupported shader
        gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    bool applyInteriorLight = int(materialParams.y) > 0;
    bool applyExteriorLight = int(materialParams.z) > 0;
    bool unlit = int(materialParams.w) > 0;
    bool unfogged = int(moreMaterialParams.r) > 0;
    bool exteriorLight = int(moreMaterialParams.g) > 0;
    float sidn = moreMaterialParams.b;
    vec3 accumLight = vec3(0.0);
    if (sidn >= 0.0) {
        accumLight = sidnColor.rgb * sidn;
    }
    bool window = int(moreMaterialParams.a) > 0;

    if (!unlit) {
        finalColor = vec4(
            calcLight(
                matDiffuse,
                v_Normal,
                interiorAmbientColor,
                interiorDirectColor,
                v_Color0.a,
                applyInteriorLight,
                applyExteriorLight,
                accumLight,
                v_Color0.rgb,
                spec,
                emissive,
                0.0
            ),
            finalOpacity
        );
    } else {
        finalColor = vec4(matDiffuse, finalOpacity);
    }

    if (!unfogged) {
        finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz, false);
    }

    gl_FragColor = finalColor;
}
#endif
`;
}

export class DebugWmoPortalProgram extends BaseProgram {
    public static a_Position = 0;

    public static ub_ModelParams = 1;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 1,
            numSamplers: super.numSamplers,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
};

#ifdef VERT
layout(location = ${DebugWmoPortalProgram.a_Position}) attribute vec3 a_Position;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), Mul(u_ModelMatrix, vec4(a_Position, 1.0))));
}
#endif

#ifdef FRAG
void mainPS() {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}
#endif
`;
}

export class LoadingAdtProgram extends BaseProgram {
    public static a_Position = 0;

    public static ub_ModelParams = 1;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 1,
            numSamplers: super.numSamplers,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

varying vec4 v_Color;

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
    vec4 u_Params; // time, _, _, _
};

#ifdef VERT
layout(location = ${LoadingAdtProgram.a_Position}) attribute vec3 a_Position;

void mainVS() {
    vec4 color1 = vec4(0.55);
    vec4 color2 = vec4(0.75);
    v_Color = mix(skyFogColor, skyBand1Color, sin(u_Params.x) * 0.5 + 0.2);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), Mul(u_ModelMatrix, vec4(a_Position, 1.0))));
}
#endif

#ifdef FRAG
void mainPS() {
    gl_FragColor = v_Color;
}
#endif
`;
}

export class WaterProgram extends BaseProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Depth = 2;

    public static ub_WaterParams = 1;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 1,
            numSamplers: super.numSamplers + 1,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

varying vec3 v_Color;
varying vec4 v_Position;
varying vec2 v_TexCoord;
varying float v_Depth;

layout(std140) uniform ub_WaterParams {
    vec4 u_WaterParams; // LiquidCategory, _, _, _
    Mat4x4 u_ModelMatrix;
};

layout(binding = 0) uniform sampler2D u_Texture0;

#ifdef VERT
layout(location = ${WaterProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${WaterProgram.a_TexCoord}) attribute vec2 a_TexCoord;
layout(location = ${WaterProgram.a_Depth}) attribute float a_Depth;

void mainVS() {
    v_TexCoord = a_TexCoord;
    v_Depth = a_Depth;
    v_Position = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), v_Position));
}
#endif

#ifdef FRAG
void mainPS() {
    int liquidCategory = int(u_WaterParams.x);
    vec4 tex = texture(SAMPLER_2D(u_Texture0), v_TexCoord);
    vec4 finalColor;
    if (liquidCategory == ${LiquidCategory.Slime} || liquidCategory == ${LiquidCategory.Lava}) {
        finalColor = vec4(saturate(tex.xyz), 1.0);
    } else {
        // TODO: specular/diffuse color from sun direction
        vec4 liquidColor, diffuseColor, specularColor;
        float depth = saturate(v_Depth / 50.0);
        if (liquidCategory == ${LiquidCategory.Ocean}) {
            vec4 shallowColor = vec4(oceanCloseColor.rgb, waterAlphas.b);
            vec4 deepColor = vec4(oceanFarColor.rgb, waterAlphas.a);
            liquidColor = mix(shallowColor, deepColor, depth);
        } else {
            vec4 shallowColor = vec4(riverCloseColor.rgb, waterAlphas.r);
            vec4 deepColor = vec4(riverFarColor.rgb, waterAlphas.g);
            liquidColor = mix(shallowColor, deepColor, depth);
        }
        diffuseColor = vec4(liquidColor.rgb + tex.rgb, liquidColor.a);
        specularColor = vec4(vec3(0.25) * tex.a, 0.0);
        finalColor = diffuseColor + specularColor;
    }
    finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz, false);
    gl_FragColor = finalColor;
}
#endif
`;
}

export class TerrainProgram extends BaseProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_ChunkIndex = 3;
    public static a_Lighting = 4;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers,
            numSamplers: super.numSamplers + 6,
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;
layout(binding = 4) uniform sampler2D u_AlphaTexture0;
layout(binding = 5) uniform sampler2D u_ShadowTexture;

varying vec3 v_Normal;
varying vec4 v_Color;
varying vec4 v_Lighting;
varying vec3 v_Binormal;
varying vec3 v_Tangent;
varying vec3 v_Position;
varying vec2 v_ChunkCoords;

#ifdef VERT
layout(location = ${TerrainProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${TerrainProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${TerrainProgram.a_Color}) attribute vec4 a_Color;
layout(location = ${TerrainProgram.a_Lighting}) attribute vec4 a_Lighting;
layout(location = ${TerrainProgram.a_ChunkIndex}) attribute float a_ChunkIndex;

void mainVS() {
    float iX = mod(a_ChunkIndex, 17.0);
    float iY = floor(a_ChunkIndex / 17.0);

    if (iX > 8.01) {
        iY = iY + 0.5;
        iX = iX - 8.5;
    }

    v_ChunkCoords = vec2(iX, iY);
    v_Color = a_Color;
    v_Lighting = a_Lighting;
    v_Normal = a_Normal;
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), vec4(a_Position, 1.0)));
    v_Position = a_Position.xyz;
}
#endif

#ifdef FRAG
void mainPS() {
    vec2 alphaCoord = v_ChunkCoords / 8.0;
    vec4 alphaBlend = texture(SAMPLER_2D(u_AlphaTexture0), alphaCoord);
    float shadow = texture(SAMPLER_2D(u_ShadowTexture), alphaCoord).r;
    vec4 tex0 = texture(SAMPLER_2D(u_Texture0), v_ChunkCoords);
    vec4 tex1 = texture(SAMPLER_2D(u_Texture1), v_ChunkCoords);
    vec4 tex2 = texture(SAMPLER_2D(u_Texture2), v_ChunkCoords);
    vec4 tex3 = texture(SAMPLER_2D(u_Texture3), v_ChunkCoords);
    vec4 tex = mix(mix(mix(tex0, tex1, alphaBlend.g), tex2, alphaBlend.b), tex3, alphaBlend.a);
    vec4 diffuse = 2.0 * tex * v_Color;

    vec3 sunDir = -exteriorDirectColorDir.xyz;
    vec3 sunColor = exteriorDirectColor.rgb;
    float specBlend = tex.a;
    vec3 dirToEye = normalize(u_CameraPos.xyz - v_Position.xyz);
    vec3 halfDir = normalize(sunDir + dirToEye);
    vec3 lSpecular = sunColor * pow(saturate(dot(halfDir, v_Normal)), 20.0);
    vec3 specular = specBlend * lSpecular;

    vec4 finalColor = vec4(calcLight(
        diffuse.rgb,
        v_Normal,
        vec4(0.0), // ambient color
        vec4(0.0), // direct color
        1.0, // interiorExteriorBlend
        false, // apply interior light
        true, // apply exterior light
        v_Lighting.rgb, // accumLight
        vec3(0.0), // precomputedLight
        specular,
        vec3(0.0), // emissive
        shadow
    ), 1.0);

    finalColor.rgb = calcFog(finalColor.rgb, v_Position, false);

    gl_FragColor = finalColor;
}
#endif
`;
}

export const MAX_DOODAD_INSTANCES = 32;
export const MAX_BONE_TRANSFORMS = 300;

export class ModelProgram extends BaseProgram {
    public static a_Position = 0;
    public static a_BoneWeights = 1;
    public static a_BoneIndices = 2;
    public static a_Normal = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord1 = 5;

    public static ub_DoodadParams = 1;
    public static ub_MaterialParams = 2;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 2,
            numSamplers: super.numSamplers + 5,
            samplerEntries: [
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat },
            ],
        },
    ];

    private static buildVertexShaderBlock(
        colorType: string,
        uvs: string[],
    ): string {
        const colorAssignment =
            colorType === "diffuse"
                ? `v_DiffuseColor = vec4(combinedColorHalved.r, combinedColorHalved.g, combinedColorHalved.b, combinedColor.a);`
                : colorType === "color"
                  ? `v_DiffuseColor = vec4(0.5, 0.5, 0.5, 1.0);`
                  : colorType === "edgeFade"
                    ? `v_DiffuseColor = vec4(combinedColorHalved.r, combinedColorHalved.g, combinedColorHalved.b, combinedColor.a * edgeScanVal);`
                    : `v_DiffuseColor = vec4(combinedColor.rgb * 0.5, combinedColor.a);`;
        const uvAssignments = uvs
            .map((uv, uvIndex) => {
                if (uv.startsWith("t")) {
                    let n = parseInt(uv[1]);
                    if (n < 2) {
                        return `    v_UV${uvIndex} = Mul(texMat${n - 1}, vec4(a_TexCoord${n - 1}, 0.0, 1.0)).xy;`;
                    } else {
                        return `    v_UV${uvIndex} = v_UV${n};`;
                    }
                } else if (uv === "env") {
                    return `    v_UV${uvIndex} = envCoord;`;
                } else {
                    throw `unrecognized uv ${uv}`;
                }
            })
            .join("\n");
        return `${colorAssignment}\n${uvAssignments}`;
    }

    public override both = `
${BaseProgram.commonDeclarations}
${GfxShaderLibrary.MulNormalMatrix}

struct DoodadInstance {
    Mat4x3 transform;
    vec4 interiorAmbientColor;
    vec4 interiorDirectColor;
    vec4 lightingParams; // [applyInteriorLighting, applyExteriorLighting, interiorExteriorBlend/skyboxBlend, isSkybox]
};

struct M2Light {
  vec4 ambientColor;
  vec4 diffuseColor;
  vec4 position; // x, y, z, boneIndex
  vec4 params; // attenuationStart, attenuationEnd, visible, _
};

struct BoneParams {
    Mat4x4 transform;
    Mat4x4 postBillboardTransform;
    vec4 params; // isSphericalBillboard, _, _, _
};

layout(std140) uniform ub_DoodadParams {
    M2Light modelLights[4];
    DoodadInstance instances[${MAX_DOODAD_INSTANCES}];
};

layout(std140) uniform ub_MaterialParams {
    vec4 shaderTypes; // [pixelShader, vertexShader, _, _]
    vec4 materialParams; // [blendMode, unfogged, unlit, _]
    vec4 meshColor;
    Mat4x4 texMat0;
    Mat4x4 texMat1;
    vec4 textureWeight;
};

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;
layout(binding = 4) uniform sampler2D u_TextureBoneMatrix;

varying vec2 v_UV0;
varying vec2 v_UV1;
varying vec2 v_UV2;
varying vec2 v_UV3;
varying vec4 v_DiffuseColor;
varying vec3 v_Normal;
varying vec3 v_Position;
varying float v_InstanceID;

#ifdef VERT
layout(location = ${ModelProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${ModelProgram.a_BoneWeights}) attribute vec4 a_BoneWeights;
layout(location = ${ModelProgram.a_BoneIndices}) attribute uvec4 a_BoneIndices;
layout(location = ${ModelProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${ModelProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${ModelProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;

float edgeScan(vec3 position, vec3 normal){
    float dotProductClamped = clamp(dot(-normalize(position), normal), 0.0, 1.0);
    return clamp(2.7 * dotProductClamped * dotProductClamped - 0.4, 0.0, 1.0);
}

Mat4x3 convertMat4(mat4 m) {
    mat4 t = transpose(m);
    Mat4x3 result;
    result.mx = t[0];
    result.my = t[1];
    result.mz = t[2];
    return result;
}

mat4 convertMat4x4(Mat4x4 m) {
    return transpose(mat4(m.mx, m.my, m.mz, m.mw));
}

mat4 convertMat4x4(Mat4x3 m) {
    return transpose(mat4(m.mx, m.my, m.mz, vec4(0, 0, 0, 1)));
}

void calcBillboardMat(inout mat4 m) {
    vec3 upVec = vec3(0, 0, 1);
    vec3 forwardVec = normalize(u_CameraPos.xyz - m[3].xyz);
    vec3 leftVec = normalize(cross(upVec, forwardVec));
    upVec = normalize(cross(forwardVec, leftVec));
    m[0] = vec4(forwardVec, 0.0);
    m[1] = vec4(leftVec, 0.0);
    m[2] = vec4(upVec, 0.0);
}

mat4 getBoneTransform(uint boneIndex) {
    vec4 mx = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(1, boneIndex), 0);
    vec4 my = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(2, boneIndex), 0);
    vec4 mz = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(3, boneIndex), 0);
    return transpose(mat4(mx, my, mz, vec4(0, 0, 0, 1)));
}

mat4 getPostBillboardTransform(uint boneIndex) {
    vec4 mx = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(4, boneIndex), 0);
    vec4 my = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(5, boneIndex), 0);
    vec4 mz = texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(6, boneIndex), 0);
    return transpose(mat4(mx, my, mz, vec4(0, 0, 0, 1)));
}

vec4 getBoneParams(uint boneIndex) {
    return texelFetch(TEXTURE(u_TextureBoneMatrix), ivec2(0, boneIndex), 0);
}

Mat4x3 getBoneMatrix(uint index) {
    DoodadInstance params = instances[gl_InstanceID];
    vec4 boneParams = getBoneParams(index);
    mat4 modelMatrix = convertMat4x4(params.transform);
    mat4 transform = modelMatrix * getPostBillboardTransform(index);
    if (boneParams.x > 0.0) {
        calcBillboardMat(transform);
    }
    transform = transform * getBoneTransform(index);
    return convertMat4(transform);
}

Mat4x3 getCombinedBoneMat() {
    Mat4x3 result = _Mat4x3(0.0);
    Fma(result, getBoneMatrix(a_BoneIndices.x), a_BoneWeights.x);
    Fma(result, getBoneMatrix(a_BoneIndices.y), a_BoneWeights.y);
    Fma(result, getBoneMatrix(a_BoneIndices.z), a_BoneWeights.z);
    Fma(result, getBoneMatrix(a_BoneIndices.w), a_BoneWeights.w);
    return result;
}

void mainVS() {
    DoodadInstance params = instances[gl_InstanceID];
    bool isSkybox = params.lightingParams.w > 0.0;
    float w = isSkybox ? 0.0 : 1.0;
    Mat4x3 boneTransform = getCombinedBoneMat();

    v_Position = Mul(_Mat4x4(boneTransform), vec4(a_Position, 1.0)).xyz;
    v_Normal = MulNormalMatrix(boneTransform, a_Normal);

    vec3 viewPosition = Mul(_Mat4x4(u_View), vec4(v_Position, w)).xyz;
    vec3 viewNormal = Mul(_Mat4x4(u_View), vec4(v_Normal, 0.0)).xyz;

    gl_Position = Mul(u_Projection, vec4(viewPosition, 1.0));
    v_InstanceID = float(gl_InstanceID); // FIXME: hack until we get flat variables working

    vec4 combinedColor = clamp(meshColor, 0.0, 1.0);

    vec4 combinedColorHalved = combinedColor * 0.5;
    vec2 envCoord = envmapTexCoord(viewPosition, viewNormal);
    float edgeScanVal = edgeScan(viewPosition, viewNormal);
    int vertexShader = int(shaderTypes.g);

    v_UV0 = a_TexCoord0;
    v_UV1 = a_TexCoord1;
    v_UV2 = vec2(0.0);
    v_UV3 = vec2(0.0);

    if (vertexShader == ${rust.WowVertexShader.DiffuseT1}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnv}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["env"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "t2"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1Env}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "env"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnvT1}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["env", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnvEnv}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["env", "env"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1EnvT1}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "env", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T1}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T1T1}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "t1", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeT1}) {
        ${ModelProgram.buildVertexShaderBlock("edgeFade", ["t1", "t1", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT2}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1EnvT2}) {
        ${ModelProgram.buildVertexShaderBlock("diffuse", ["t1", "env", "t2"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeT1T2}) {
        ${ModelProgram.buildVertexShaderBlock("edgeFade", ["t1", "t2"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeEnv}) {
        ${ModelProgram.buildVertexShaderBlock("edgeFade", ["env"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2T1}) {
        ${ModelProgram.buildVertexShaderBlock("edgeFade", ["t1", "t2", "t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2T3}) {
        ${ModelProgram.buildVertexShaderBlock("edgeFade", ["t1", "t2", "t3"])}
    } else if (vertexShader == ${rust.WowVertexShader.ColorT1T2T3}) {
        ${ModelProgram.buildVertexShaderBlock("color", ["t1", "t2", "t3"])}
    } else if (vertexShader == ${rust.WowVertexShader.BWDiffuseT1}) {
        ${ModelProgram.buildVertexShaderBlock("bw", ["t1"])}
    } else if (vertexShader == ${rust.WowVertexShader.BWDiffuseT1T2}) {
        ${ModelProgram.buildVertexShaderBlock("bw", ["t1", "t2"])}
    }
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 tex0 = texture(SAMPLER_2D(u_Texture0), v_UV0);
    vec4 tex1 = texture(SAMPLER_2D(u_Texture1), v_UV1);
    vec4 tex2 = texture(SAMPLER_2D(u_Texture2), v_UV2);
    vec4 tex3 = texture(SAMPLER_2D(u_Texture3), v_UV3);

    vec4 tex1WithUV0 = texture(SAMPLER_2D(u_Texture1), v_UV0);
    vec4 tex2WithUV0 = texture(SAMPLER_2D(u_Texture2), v_UV0);
    vec4 tex3WithUV1 = texture(SAMPLER_2D(u_Texture3), v_UV1);

    vec3 precomputedLight = vec3(0.0);
    vec3 accumLight = vec3(0.0);

    int instanceID = int(v_InstanceID + 0.5);
    DoodadInstance doodad = instances[instanceID];
    for (int i = 0; i < 4; i++) {
        M2Light light = modelLights[i];
        int boneIndex = int(light.position.z);
        float attenuationStart = light.params.x;
        float attenuationEnd = light.params.y;
        bool visible = light.params.z > 0.0;
        vec3 posToLight = v_Position - Mul(_Mat4x4(doodad.transform), vec4(light.position.xyz, 1.0)).xyz;
        float distance = length(posToLight);
        float diffuse = max(dot(posToLight, v_Normal) / distance, 0.0);
        float attenuation = 1.0 - clamp((distance - attenuationStart) * (1.0 / (attenuationEnd - attenuationStart)), 0.0, 1.0);
        vec3 attenuatedColor = attenuation * light.diffuseColor.rgb * light.diffuseColor.a;
        accumLight = accumLight + vec3(attenuatedColor * attenuatedColor * diffuse) + light.ambientColor.rgb * light.ambientColor.a;
    }

    int pixelShader = int(shaderTypes.r);
    vec4 finalColor = vec4(1.0);
    vec3 specular = vec3(0.0);
    float finalOpacity = 0.0;
    bool canDiscard = false;
    float discardAlpha = 1.0;
    vec4 genericParams[3];
    genericParams[0] = vec4(1.0);
    genericParams[1] = vec4(1.0);
    genericParams[2] = vec4(1.0);
    vec3 matDiffuse;

    if (pixelShader == ${rust.WowPixelShader.CombinersOpaque}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersMod}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb;
        discardAlpha = tex1.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2x}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb * 2.0;
        discardAlpha = tex1.a * 2.0;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNA}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb * 2.0;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueOpaque}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModMod}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb;
        discardAlpha = tex0.a * tex1.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModMod2x}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb * 2.0;
        discardAlpha = tex0.a * tex1.a * 2.0;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAdd}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a + tex1.a;
        canDiscard = true;
        specular = tex1.rgb;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModMod2xNA}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb * 2.0;
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAddNA}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
        specular = tex1.rgb;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModOpaque}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNAAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * tex1.rgb * 2.0, tex0.rgb, vec3(tex0.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueAddAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        specular = tex1.rgb * tex1.a;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueAddAlphaAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        specular = tex1.rgb * tex1.a * (1.0 - tex0.a);
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNAAlphaAdd}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * tex1.rgb * 2.0, tex0.rgb, vec3(tex0.a));
        specular = tex2.rgb * tex2.a * textureWeight.b;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAddAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
        specular = tex1.rgb * tex1.a;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAddAlphaAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a + tex1.a * (0.3 * tex1.r + 0.59 * tex1.g + 0.11 * tex1.b);
        canDiscard = true;
        specular = tex1.rgb * tex1.a * (1.0 - tex0.a);
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueAlphaAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(mix(tex0.rgb, tex1.rgb, vec3(tex1.a)), tex0.rgb, vec3(tex0.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNAAlpha3s}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * tex1.rgb * 2.0, tex2.rgb, vec3(tex2.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueAddAlphaWgt}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        specular = tex1.rgb * tex1.a * textureWeight.g;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAddAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a + tex1.a;
        canDiscard = true;
        specular = tex1.rgb * (1.0 - tex0.a);
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueModNAAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * tex1.rgb, tex0.rgb, vec3(tex0.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModAddAlphaWgt}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
        specular = tex1.rgb * tex1.a * textureWeight.g;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueModAddWgt}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb, tex1.rgb, vec3(tex1.a));
        specular = tex0.rgb * tex0.a * textureWeight.r;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNAAlphaUnshAlpha}) {
        float glowOpacity = clamp(tex2.a * textureWeight.b, 0.0, 1.0);
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * tex1.rgb * 2.0, tex0.rgb, vec3(tex0.a)) * (1.0 - glowOpacity);
        specular = tex2.rgb * glowOpacity;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModDualCrossfade}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(mix(tex0, tex1WithUV0, vec4(clamp(textureWeight.g, 0.0, 1.0))), tex2WithUV0, vec4(clamp(textureWeight.b, 0.0, 1.0))).rgb;
        discardAlpha = mix(mix(tex0, tex1WithUV0, vec4(clamp(textureWeight.g, 0.0, 1.0))), tex2WithUV0, vec4(clamp(textureWeight.b, 0.0, 1.0))).a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueMod2xNAAlphaAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(mix(tex0.rgb * tex1.rgb * 2.0, tex2.rgb, vec3(tex2.a)), tex0.rgb, vec3(tex0.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModMaskedDualCrossfade}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(mix(tex0, tex1WithUV0, vec4(clamp(textureWeight.g, 0.0, 1.0))), tex2WithUV0, vec4(clamp(textureWeight.b, 0.0, 1.0))).rgb;
        discardAlpha = mix(mix(tex0, tex1WithUV0, vec4(clamp(textureWeight.g, 0.0, 1.0))), tex2WithUV0, vec4(clamp(textureWeight.b, 0.0, 1.0))).a * tex3WithUV1.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersOpaqueAlpha}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb, tex1.rgb, vec3(tex1.a));
    } else if (pixelShader == ${rust.WowPixelShader.Guild}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * mix(genericParams[0].rgb, tex1.rgb * genericParams[1].rgb, vec3(tex1.a)), tex2.rgb * genericParams[2].rgb, vec3(tex2.a));
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.GuildNoBorder}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * mix(genericParams[0].rgb, tex1.rgb * genericParams[1].rgb, vec3(tex1.a));
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.GuildOpaque}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * mix(tex0.rgb * mix(genericParams[0].rgb, tex1.rgb * genericParams[1].rgb, vec3(tex1.a)), tex2.rgb * genericParams[2].rgb, vec3(tex2.a));
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModDepth}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb;
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.Illum}) {
        discardAlpha = tex0.a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.CombinersModModModConst}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * (tex0 * tex1 * tex2 * genericParams[0]).rgb;
        discardAlpha = (tex0 * tex1 * tex2 * genericParams[0]).a;
        canDiscard = true;
    } else if (pixelShader == ${rust.WowPixelShader.NewUnkCombiner}) {
        matDiffuse = v_DiffuseColor.rgb * 2.0 * tex0.rgb * tex1.rgb;
        discardAlpha = tex0.a * tex1.a;
        canDiscard = true;
    }

    int blendMode = int(materialParams.r);
    if (blendMode == ${rust.WowM2BlendingMode.BlendAdd}) {
        finalOpacity = discardAlpha * v_DiffuseColor.a;
    } else if (blendMode == ${rust.WowM2BlendingMode.AlphaKey}) {
        finalOpacity = v_DiffuseColor.a;
        if (canDiscard && discardAlpha < 0.501960814) {
            discard;
        }
    } else if (blendMode == ${rust.WowM2BlendingMode.Opaque}) {
        finalOpacity = v_DiffuseColor.a;
    } else {
        finalOpacity = discardAlpha * v_DiffuseColor.a;
    }

    bool applyInterior = doodad.lightingParams.x > 0.0;
    bool applyExterior = doodad.lightingParams.y > 0.0;
    float interiorExteriorBlend = doodad.lightingParams.z;
    bool isSkybox = doodad.lightingParams.w > 0.0;

    if (isSkybox) {
        gl_FragColor = vec4(matDiffuse.rgb, finalOpacity * interiorExteriorBlend);
        return;
    }

    if (materialParams.z == 0.0) {
        finalColor = vec4(calcLight(
            matDiffuse.rgb,
            v_Normal,
            doodad.interiorAmbientColor,
            doodad.interiorDirectColor,
            interiorExteriorBlend,
            applyInterior,
            applyExterior,
            accumLight,
            precomputedLight,
            specular,
            vec3(0.0), // emissive
            0.0
        ), finalOpacity);
    } else {
        finalColor = vec4(matDiffuse.rgb, finalOpacity);
    }

   if (materialParams.g == 0.0) { // unfogged
        bool isAdditive = (blendMode == ${rust.WowM2BlendingMode.Add});
        finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz, isAdditive);
   }

   gl_FragColor = finalColor;
}
#endif
`;
}

export class ParticleProgram extends BaseProgram {
    public static ub_EmitterParams = 1;
    public static ub_DoodadParams = 2;

    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
        {
            numUniformBuffers: super.numUniformBuffers + 2,
            numSamplers: super.numSamplers + 4,
            samplerEntries: [
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat },
            ],
        },
    ];

    public override both = `
${BaseProgram.commonDeclarations}

struct DoodadInstance {
    Mat4x3 transform;
};

layout(std140) uniform ub_EmitterParams {
    vec4 params; // alphaTest, fragShaderType, blendMode
    vec4 ub_texScale; // x, y, _, _
};

layout(std140) uniform ub_DoodadParams {
    DoodadInstance instances[${MAX_DOODAD_INSTANCES}];
};

layout(binding = 0) uniform sampler2D u_Tex0;
layout(binding = 1) uniform sampler2D u_Tex1;
layout(binding = 2) uniform sampler2D u_Tex2;
layout(binding = 3) uniform sampler2D u_DataTex;

varying float v_InstanceID;
varying vec4 v_Color;
varying vec3 v_Position;
varying vec2 v_UV0;
varying vec2 v_UV1;
varying vec2 v_UV2;

#ifdef VERT
void mainVS() {
    DoodadInstance doodad = instances[gl_InstanceID];
    int vertNum = int(gl_VertexID) % 4;
    int texelY = int(gl_VertexID) / 4;
    vec3 pos = texelFetch(TEXTURE(u_DataTex), ivec2(0, texelY), 0).xyz;
    v_Color = texelFetch(TEXTURE(u_DataTex), ivec2(1, texelY), 0);
    vec2 scale = texelFetch(TEXTURE(u_DataTex), ivec2(2, texelY), 0).xy;
    vec2 texPos = texelFetch(TEXTURE(u_DataTex), ivec2(3, texelY), 0).xy;
    v_Position = Mul(_Mat4x4(doodad.transform), vec4(pos, 1.0)).xyz;
    vec4 viewSpacePos = Mul(_Mat4x4(u_View), vec4(v_Position, 1.0));
    vec2 texScale = ub_texScale.xy;
    if (vertNum == 0) {
        viewSpacePos.x -= scale.x;
        viewSpacePos.y += scale.y;
        v_UV0 = texPos + vec2(0.0, 0.0) * texScale;
    } else if (vertNum == 1) {
        viewSpacePos.x += scale.x;
        viewSpacePos.y += scale.y;
        v_UV0 = texPos + vec2(1.0, 0.0) * texScale;
    } else if (vertNum == 2) {
        viewSpacePos.x += scale.x;
        viewSpacePos.y -= scale.y;
        v_UV0 = texPos + vec2(1.0, 1.0) * texScale;
    } else if (vertNum == 3) {
        viewSpacePos.x -= scale.x;
        viewSpacePos.y -= scale.y;
        v_UV0 = texPos + vec2(0.0, 1.0) * texScale;
    }

    gl_Position = Mul(u_Projection, vec4(viewSpacePos.xyz, 1.0));
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 tex0 = texture(SAMPLER_2D(u_Tex0), v_UV0);
    vec4 tex1 = texture(SAMPLER_2D(u_Tex1), v_UV1);
    vec4 tex2 = texture(SAMPLER_2D(u_Tex2), v_UV2);

    int shaderType = int(params.y);
    vec4 finalColor;
    if (shaderType == ${rust.WowM2ParticleShaderType.Mod}) {
        finalColor = v_Color * tex0;
    } else if (shaderType == ${rust.WowM2ParticleShaderType.TwoColorTexThreeAlphaTex}) {
        finalColor = vec4(1.0, 0.0, 1.0, 1.0);
    } else if (shaderType == ${rust.WowM2ParticleShaderType.ThreeColorTexThreeAlphaTex}) {
        finalColor = vec4(1.0, 0.0, 1.0, 1.0);
    } else if (shaderType == ${rust.WowM2ParticleShaderType.ThreeColorTexThreeAlphaTexUV}) {
        finalColor = vec4(1.0, 0.0, 1.0, 1.0);
    } else if (shaderType == ${rust.WowM2ParticleShaderType.Refraction}) {
        finalColor = vec4(1.0, 0.0, 1.0, 1.0);
    }

    if (finalColor.a < params.x) {
        discard;
    }

    int blendMode = int(params.z);
    bool isAdditive = (blendMode == ${rust.WowM2BlendingMode.Add});
    finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz, isAdditive);
    gl_FragColor = finalColor;
}
#endif
`;
}
