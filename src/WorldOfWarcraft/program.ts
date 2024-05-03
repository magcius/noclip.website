import { mat4 } from "gl-matrix";
import { WowLightResult, WowVec3 } from "../../rust/pkg/index.js";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager.js";
import { rust } from "../rustlib.js";
import { LiquidCategory } from "./data.js";
import { SkyboxColor } from './mesh.js';
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
  vec3 emissive) {
    vec3 lDiffuse = vec3(0.0);
    vec3 localDiffuse = accumLight;
    vec3 currentColor = vec3(0.0);
    vec3 normalizedN = normalize(normal);

    if (applyExteriorLight) {
        float nDotL = clamp(dot(normalizedN, -exteriorDirectColorDir.xyz), 0.0, 1.0);
        float nDotUp = dot(normalizedN, vec3(0.0, 0.0, 1.0));
        vec3 adjAmbient = exteriorAmbientColor.rgb + precomputedLight;
        vec3 adjHorizontal = exteriorAmbientColor.rgb + precomputedLight;
        vec3 adjGround = exteriorAmbientColor.rgb + precomputedLight;
        if (nDotUp >= 0.0) {
          currentColor = mix(adjHorizontal, adjAmbient, vec3(nDotUp));
        } else {
          currentColor = mix(adjHorizontal, adjGround, vec3(-nDotUp));
        }
        vec3 skyColor = (currentColor * 1.10000002);
        vec3 groundColor = (currentColor * 0.699999988);
        lDiffuse = exteriorDirectColor.xyz * nDotL;
        currentColor = mix(groundColor, skyColor, vec3((0.5 + (0.5 * nDotL))));
    }
    if (applyInteriorLight) {
        float nDotL = clamp(dot(normalizedN, -interiorSunDir.xyz), 0.0, 1.0);
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

    //Specular term
    vec3 specTerm = specular;
    //Emission term
    vec3 emTerm = emissive;

    return sqrt(gammaDiffTerm*gammaDiffTerm + linearDiffTerm) + specTerm + emTerm;
}

vec3 calcFog(vec3 inColor, vec3 worldPosition) {
    float dist = distance(u_CameraPos.xyz, worldPosition);
    float t = saturate(invlerp(fogParams.x, fogParams.y, dist)) * skyFogColor.a;
    return mix(inColor, skyFogColor.rgb, t);
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
    Mat4x4 u_ModelView;
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
    vec4 waterAlphas; // waterShallow, waterDeep, oceanShallow, oceanDeep
    vec4 glow; // glow, highlightSky, _, _
};

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.invlerp}
${BaseProgram.utils}
  `;

  public static layoutUniformBufs(renderInst: GfxRenderInst, view: View, lightingData: WowLightResult) {
    const numMat4s = 2;
    const numVec4s = 24;
    const totalSize = numMat4s * 16 + numVec4s * 4;
    let offset = renderInst.allocateUniformBuffer(BaseProgram.ub_SceneParams, totalSize);
    const uniformBuf = renderInst.mapUniformBufferF32(BaseProgram.ub_SceneParams);

    offset += fillMatrix4x4(uniformBuf, offset, view.clipFromViewMatrix);
    offset += fillMatrix4x4(uniformBuf, offset, view.viewFromWorldMatrix);
    offset += fillVec4(uniformBuf, offset, view.cameraPos[0], view.cameraPos[1], view.cameraPos[2], 0.0);

    // lighting
    offset += fillVec4v(uniformBuf, offset, view.interiorSunDirection);
    offset += fillVec4v(uniformBuf, offset, view.exteriorDirectColorDirection);
    offset += fillColor(uniformBuf, offset, lightingData.direct_color);
    offset += fillColor(uniformBuf, offset, lightingData.ambient_color);
    offset += fillColor(uniformBuf, offset, lightingData.sky_top_color);
    offset += fillColor(uniformBuf, offset, lightingData.sky_middle_color);
    offset += fillColor(uniformBuf, offset, lightingData.sky_band1_color);
    offset += fillColor(uniformBuf, offset, lightingData.sky_band2_color);
    offset += fillColor(uniformBuf, offset, lightingData.sky_fog_color, view.fogEnabled ? 1.0 : 0.0);
    offset += fillColor(uniformBuf, offset, lightingData.sky_smog_color);
    offset += fillColor(uniformBuf, offset, lightingData.sun_color);
    offset += fillColor(uniformBuf, offset, lightingData.cloud_sun_color);
    offset += fillColor(uniformBuf, offset, lightingData.cloud_emissive_color);
    offset += fillColor(uniformBuf, offset, lightingData.cloud_layer1_ambient_color);
    offset += fillColor(uniformBuf, offset, lightingData.cloud_layer2_ambient_color);
    offset += fillColor(uniformBuf, offset, lightingData.ocean_close_color);
    offset += fillColor(uniformBuf, offset, lightingData.ocean_far_color);
    offset += fillColor(uniformBuf, offset, lightingData.river_close_color);
    offset += fillColor(uniformBuf, offset, lightingData.river_far_color);
    offset += fillColor(uniformBuf, offset, lightingData.shadow_opacity);
    const fogEnd = view.cullingFarPlane;
    const fogStart = Math.max(lightingData.fog_scaler * fogEnd, 0);
    offset += fillVec4(uniformBuf, offset,
      fogStart,
      fogEnd,
      0,
      0
    );
    offset += fillVec4(uniformBuf, offset,
      lightingData.water_shallow_alpha,
      lightingData.water_deep_alpha,
      lightingData.ocean_shallow_alpha,
      lightingData.ocean_deep_alpha,
    );
    offset += fillVec4(uniformBuf, offset,
      lightingData.glow,
      lightingData.highlight_sky ? 1 : 0,
      0,
      0
    );
    lightingData.free();
  }
}

function fillColor(buf: Float32Array, offset: number, color: WowVec3, a: number = 1.0): number {
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
    { numUniformBuffers: super.numUniformBuffers, numSamplers: super.numSamplers },
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
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position, 0.0)));
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
    { numUniformBuffers: super.numUniformBuffers + 2, numSamplers: super.numSamplers + 4 },
  ];

  public override both = `
${BaseProgram.commonDeclarations}

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_Transform;
    Mat4x4 u_NormalTransform;
};

layout(std140) uniform ub_BatchParams {
    vec4 shaderParams; // vertexShader, pixelShader, _, _
    vec4 materialParams; // blendMode, applyInteriorLight, applyExteriorLight, _
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

void mainVS() {
    v_Position = Mul(u_Transform, vec4(a_Position, 1.0)).xyz;
    v_Normal = normalize(Mul(u_Transform, vec4(a_Normal, 0.0))).xyz;

    vec3 viewPosition = Mul(u_ModelView, vec4(v_Position, 1.0)).xyz;
    vec3 viewNormal = Mul(u_ModelView, vec4(v_Normal, 0.0)).xyz;
    gl_Position = Mul(u_Projection, vec4(viewPosition, 1.0));
    v_Color0 = a_Color0.bgra / 255.0;
    v_Color1 = a_Color1.rgba / 255.0;

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

vec3 Slerp(vec3 p0, vec3 p1, float t)
{
    float dotp = dot(normalize(p0), normalize(p1));
    if ((dotp > 0.9999) || (dotp<-0.9999))
    {
        if (t<=0.5)
        return p0;
        return p1;
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
        sunDir = Slerp(sunDir, -exteriorDirectColor.rgb, v_Color0.a);
        sunColor = mix(sunColor, exteriorDirectColor.xyz, v_Color0.a);
      }
    }

    vec3 t849 = normalize((sunDir + normalize(-(v_Position.xyz))));
    float dirAtten_956 = clamp(dot(normal, sunDir), 0.0, 1.0);
    float spec = (1.25 * pow(clamp(dot(normal, t849), 0.0, 1.0), 8.0));
    vec3 specTerm = ((((vec3(mix(pow((1.0 - clamp(dot(sunDir, t849), 0.0, 1.0)), 5.0), 1.0, texAlpha)) * spec) * sunColor) * dirAtten_956));
    float distFade = 1.0;
    specTerm = (specTerm * distFade);
    return specTerm;
}

void mainPS() {
    vec4 tex = texture(SAMPLER_2D(u_Texture0), v_UV0);
    vec4 tex2 = texture(SAMPLER_2D(u_Texture1), v_UV1);
    vec4 tex3 = texture(SAMPLER_2D(u_Texture2), v_UV2);

    int blendMode = int(materialParams.x);
    if (blendMode == 1) {
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
    finalColor = vec4(
        calcLight(
            matDiffuse,
            v_Normal,
            interiorAmbientColor,
            interiorDirectColor,
            v_Color0.a,
            applyInteriorLight,
            applyExteriorLight,
            vec3(0.0) /*accumLight*/,
            v_Color0.rgb,
            spec,
            emissive
        ),
        finalOpacity
    );

    finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz);

    gl_FragColor = finalColor;
}
#endif
`;
}

export class DebugWmoPortalProgram extends BaseProgram {
  public static a_Position = 0;

  public static ub_ModelParams = 1;

  public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
      { numUniformBuffers: super.numUniformBuffers + 1, numSamplers: super.numSamplers },
  ];

  public override both = `
${BaseProgram.commonDeclarations}

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
};

#ifdef VERT
layout(location = ${DebugWmoPortalProgram.a_Position}) attribute vec3 a_Position;

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(u_ModelMatrix, vec4(a_Position, 1.0))));
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
      { numUniformBuffers: super.numUniformBuffers + 1, numSamplers: super.numSamplers },
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
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(u_ModelMatrix, vec4(a_Position, 1.0))));
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

  public static ub_WaterParams = 1;

  public static bindingLayouts: GfxBindingLayoutDescriptor[] = [
      { numUniformBuffers: super.numUniformBuffers + 1, numSamplers: super.numSamplers + 1 },
  ];

  public override both = `
${BaseProgram.commonDeclarations}

varying vec3 v_Color;
varying vec4 v_Position;
varying vec2 v_TexCoord;

layout(std140) uniform ub_WaterParams {
    vec4 u_WaterParams; // LiquidCategory, _, _, _
    Mat4x4 u_ModelMatrix;
};

layout(binding = 0) uniform sampler2D u_Texture0;

#ifdef VERT
layout(location = ${WaterProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${WaterProgram.a_TexCoord}) attribute vec2 a_TexCoord;

void mainVS() {
    v_TexCoord = a_TexCoord;
    v_Position = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_Projection, Mul(u_ModelView, v_Position));
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
        vec4 lightColor = liquidCategory == ${LiquidCategory.Ocean} ? oceanFarColor : riverFarColor;
        finalColor = vec4(saturate(lightColor.xyz + tex.xyz), 0.7);
    }
    finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz);
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
      { numUniformBuffers: super.numUniformBuffers, numSamplers: super.numSamplers + 5 },
  ];

  public override both = `
${BaseProgram.commonDeclarations}

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;
layout(binding = 4) uniform sampler2D u_AlphaTexture0;

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
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position, 1.0)));
    v_Position = a_Position.xyz;
}
#endif

#ifdef FRAG
void mainPS() {
    vec2 alphaCoord = v_ChunkCoords / 8.0;
    vec4 alphaBlend = texture(SAMPLER_2D(u_AlphaTexture0), alphaCoord);
    vec4 tex0 = texture(SAMPLER_2D(u_Texture0), v_ChunkCoords);
    vec4 tex1 = texture(SAMPLER_2D(u_Texture1), v_ChunkCoords);
    vec4 tex2 = texture(SAMPLER_2D(u_Texture2), v_ChunkCoords);
    vec4 tex3 = texture(SAMPLER_3D(u_Texture3), v_ChunkCoords);
    vec4 tex = mix(mix(mix(tex0, tex1, alphaBlend.g), tex2, alphaBlend.b), tex3, alphaBlend.a);
    vec4 diffuse = 2.0 * tex * v_Color;
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
      vec3(0.0), // specular
      vec3(0.0) // emissive
    ), 1.0);

    float specBlend = tex.a;
    vec3 halfVec = -normalize(exteriorDirectColorDir.xyz + normalize(v_Position));
    vec3 lSpecular = exteriorDirectColor.xyz * pow(max(0.0, dot(halfVec, v_Normal)), 20.0);
    float adtSpecMult = 1.0;
    vec3 specTerm = vec3(specBlend) * lSpecular * adtSpecMult;
    finalColor.rgb += specTerm;

    finalColor.rgb = calcFog(finalColor.rgb, v_Position);

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
      { numUniformBuffers: super.numUniformBuffers + 2, numSamplers: super.numSamplers + 4 },
  ];

  private static buildVertexShaderBlock(colorType: string, uvs: string[]): string {
    const colorAssignment = colorType === 'diffuse' ? `v_DiffuseColor = vec4(combinedColorHalved.r, combinedColorHalved.g, combinedColorHalved.b, combinedColor.a);`
      : colorType === 'color' ? `v_DiffuseColor = vec4(0.5, 0.5, 0.5, 1.0);`
      : colorType === 'edgeFade' ? `v_DiffuseColor = v_DiffuseColor = vec4(combinedColorHalved.r, combinedColorHalved.g, combinedColorHalved.b, combinedColor.a * edgeScanVal);`
      : `v_DiffuseColor = vec4(combinedColor.rgb * 0.5, combinedColor.a);`;
    const uvAssignments = uvs.map((uv, uvIndex) => {
      if (uv.startsWith('t')) {
        let n = parseInt(uv[1]);
        if (n < 2) {
          return `    v_UV${uvIndex} = Mul(texMat${n - 1}, vec4(a_TexCoord${n - 1}, 0.0, 1.0)).xy;`;
        } else {
          return `    v_UV${uvIndex} = v_UV${n};`
        }
      } else if (uv === 'env') {
        return `    v_UV${uvIndex} = envCoord;`;
      } else {
        throw `unrecognized uv ${uv}`;
      }
    }).join('\n');
    return `${colorAssignment}\n${uvAssignments}`
  }

  public override both = `
${BaseProgram.commonDeclarations}

struct DoodadInstance {
    Mat4x4 transform;
    Mat4x4 normalMat;
    vec4 interiorAmbientColor;
    vec4 interiorDirectColor;
    vec4 lightingParams; // [applyInteriorLighting, applyExteriorLighting, interiorExteriorBlend, isSkybox]
};

struct BoneParams {
  Mat4x4 transform;
  vec4 params; // isSphericalBillboard, _, _, _
};

layout(std140) uniform ub_DoodadParams {
    DoodadInstance instances[${MAX_DOODAD_INSTANCES}];
    BoneParams bones[${MAX_BONE_TRANSFORMS}];
};

layout(std140) uniform ub_MaterialParams {
    vec4 shaderTypes; // [pixelShader, vertexShader, _, _]
    vec4 materialParams; // [blendMode, unfogged, unlit, alphaTest]
    vec4 meshColor;
    Mat4x4 texMat0;
    Mat4x4 texMat1;
    vec4 textureWeight;
};

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 1) uniform sampler2D u_Texture2;
layout(binding = 1) uniform sampler2D u_Texture3;

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
layout(location = ${ModelProgram.a_BoneIndices}) attribute vec4 a_BoneIndices;
layout(location = ${ModelProgram.a_Normal}) attribute vec3 a_Normal;
layout(location = ${ModelProgram.a_TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${ModelProgram.a_TexCoord1}) attribute vec2 a_TexCoord1;

float edgeScan(vec3 position, vec3 normal){
    float dotProductClamped = clamp(dot(-normalize(position),normal), 0.0, 1.0);
    return clamp(2.7* dotProductClamped * dotProductClamped - 0.4, 0.0, 1.0);
}

void ScaledAddMat(inout Mat4x4 self, float t, Mat4x4 other) {
    self.mx += t * other.mx;
    self.my += t * other.my;
    self.mz += t * other.mz;
    self.mw += t * other.mw;
}

Mat4x4 getCombinedBoneMat() {
    Mat4x4 result;
    result.mx = vec4(0.0);
    result.my = vec4(0.0);
    result.mz = vec4(0.0);
    result.mw = vec4(0.0);
    ScaledAddMat(result, a_BoneWeights.x, bones[int(a_BoneIndices.x)].transform);
    ScaledAddMat(result, a_BoneWeights.y, bones[int(a_BoneIndices.y)].transform);
    ScaledAddMat(result, a_BoneWeights.z, bones[int(a_BoneIndices.z)].transform);
    ScaledAddMat(result, a_BoneWeights.w, bones[int(a_BoneIndices.w)].transform);
    return result;
}

mat4 convertMat4x4(Mat4x4 m) {
  return transpose(mat4(m.mx, m.my, m.mz, m.mw));
}

void CalcBillboardMat(inout mat4 m) {
  // extract scale from column vectors
  mat4 colMat = transpose(m);
  m[0] = vec4(0.0, 0.0, -length(colMat[2].xyz), 0.0);
  m[1] = vec4(length(colMat[0].xyz), 0.0, 0.0, 0.0);
  m[2] = vec4(0.0, length(colMat[1].xyz), 0.0, 0.0);
}

void mainVS() {
    DoodadInstance params = instances[gl_InstanceID];
    bool isSkybox = params.lightingParams.w > 0.0;
    float w = isSkybox ? 0.0 : 1.0;
    Mat4x4 boneTransform = getCombinedBoneMat();

    v_Position = Mul(params.transform, Mul(boneTransform, vec4(a_Position, w))).xyz;
    v_Normal = normalize(Mul(params.transform, Mul(boneTransform, vec4(a_Normal, 0.0))).xyz);

    vec3 viewPosition;

    bool isSphericalBone = bones[int(a_BoneIndices.x)].params.x > 0.0;
    if (isSphericalBone) {
      mat4 combinedModelMat = convertMat4x4(u_ModelView) * convertMat4x4(params.transform) * convertMat4x4(boneTransform);
      CalcBillboardMat(combinedModelMat);
      viewPosition = (combinedModelMat * vec4(a_Position, w)).xyz;
    } else {
      viewPosition = Mul(u_ModelView, Mul(params.transform, Mul(boneTransform, vec4(a_Position, w)))).xyz;
    }

    gl_Position = Mul(u_Projection, vec4(viewPosition, 1.0));
    v_InstanceID = float(gl_InstanceID); // FIXME: hack until we get flat variables working

    vec4 combinedColor = clamp(meshColor, 0.0, 1.0);
    vec4 combinedColorHalved = combinedColor * 0.5;
    vec2 envCoord = envmapTexCoord(viewPosition, v_Normal);
    float edgeScanVal = edgeScan(viewPosition, v_Normal);
    int vertexShader = int(shaderTypes.g);

    v_UV0 = a_TexCoord0;
    v_UV1 = a_TexCoord1;
    v_UV2 = vec2(0.0);
    v_UV3 = vec2(0.0);

    if (vertexShader == ${rust.WowVertexShader.DiffuseT1}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnv}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['env'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 't2'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1Env}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 'env'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnvT1}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['env', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEnvEnv}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['env', 'env'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1EnvT1}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 'env', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T1}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T1T1}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 't1', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeT1}) {
      ${ModelProgram.buildVertexShaderBlock('edgeFade', ['t1', 't1', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT2}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1EnvT2}) {
      ${ModelProgram.buildVertexShaderBlock('diffuse', ['t1', 'env', 't2'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeT1T2}) {
      ${ModelProgram.buildVertexShaderBlock('edgeFade', ['t1', 't2'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseEdgeFadeEnv}) {
      ${ModelProgram.buildVertexShaderBlock('edgeFade', ['env'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2T1}) {
      ${ModelProgram.buildVertexShaderBlock('edgeFade', ['t1', 't2', 't1'])}
    } else if (vertexShader == ${rust.WowVertexShader.DiffuseT1T2T3}) {
      ${ModelProgram.buildVertexShaderBlock('edgeFade', ['t1', 't2', 't3'])}
    } else if (vertexShader == ${rust.WowVertexShader.ColorT1T2T3}) {
      ${ModelProgram.buildVertexShaderBlock('color', ['t1', 't2', 't3'])}
    } else if (vertexShader == ${rust.WowVertexShader.BWDiffuseT1}) {
      ${ModelProgram.buildVertexShaderBlock('bw', ['t1'])}
    } else if (vertexShader == ${rust.WowVertexShader.BWDiffuseT1T2}) {
      ${ModelProgram.buildVertexShaderBlock('bw', ['t1', 't2'])}
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

    // TODO: iterate through local lights to calculate this
    vec3 accumLight = vec3(0.0);

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

    int instanceID = int(v_InstanceID + 0.5);
    DoodadInstance params = instances[instanceID];
    bool applyInterior = params.lightingParams.x > 0.0;
    bool applyExterior = params.lightingParams.y > 0.0;
    float interiorExteriorBlend = params.lightingParams.z;
    bool isSkybox = params.lightingParams.w > 0.0;

    if (isSkybox) {
      gl_FragColor = vec4(matDiffuse.rgb, finalOpacity);
      return;
    }

    finalColor = vec4(calcLight(
      matDiffuse.rgb,
      v_Normal,
      params.interiorAmbientColor,
      params.interiorDirectColor,
      interiorExteriorBlend,
      applyInterior,
      applyExterior,
      accumLight,
      vec3(0.0), // precomputedLight
      specular,
      vec3(0.0) // emissive
   ), finalOpacity);

   finalColor.rgb = calcFog(finalColor.rgb, v_Position.xyz);
    
   gl_FragColor = finalColor;
}
#endif
`;
}
