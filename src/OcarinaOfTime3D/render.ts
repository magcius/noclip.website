
import * as CMAB from './cmab.js';
import * as CMB from './cmb.js';
import * as CSAB from './csab.js';
import * as ZSI from './zsi.js';

import * as Viewer from '../viewer.js';

import { mat4, ReadonlyMat4, vec3, vec4 } from 'gl-matrix';
import AnimationController from '../AnimationController.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { Camera, computeViewMatrix, computeViewMatrixSkybox } from '../Camera.js';
import { Color, colorAdd, colorClamp, colorCopy, colorMult, colorNewCopy, colorNewFromRGBA, OpaqueBlack, TransparentBlack } from '../Color.js';
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBuffer, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform.js';
import { getFormatByteSize, setFormatCompFlags } from '../gfx/platform/GfxPlatformFormat.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { transformVec3Mat4w0 } from '../MathHelpers.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import { ColorAnimType } from './cmab.js';
import { BumpMode, FresnelSelector, LightingConfig, LutInput, TexCoordConfig } from './cmb.js';

interface DMPMaterialHacks {
    texturesEnabled: boolean;
    vertexColorsEnabled: boolean;
}

const enum MatLutType {
    Distribution0,
    Distribution1,
    Fresnel,
    ReflectR,
    ReflectG,
    ReflectB
}

class DMPProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PrmParams = 2;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Tangent = 2;
    public static a_Color = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord12 = 5;
    public static a_BoneIndices = 6;
    public static a_BoneWeights = 7;

    public static BindingsDefinition = `
${GfxShaderLibrary.MatrixLibrary}

struct Light {
    vec4 Ambient;
    vec4 Diffuse;
    vec4 Specular0;
    vec4 Specular1;
    vec4 Direction;
};

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(std140) uniform ub_MaterialParams {
    vec4 u_MatDiffuseColor;
    vec4 u_MatAmbientColor;
    vec4 u_MaterialFlags;

    vec4 u_SceneAmbient;
    Light u_SceneLights[3];

    vec4 u_FogColor;
    vec4 u_FogStartEnd;

    vec4 u_ConstantColor[6];
    Mat3x4 u_TexMtx[3];
    vec4 u_MatMisc[1];
};

// xyz are used by GenerateTextureCoord
#define u_FogStart         (u_FogStartEnd.x)
#define u_FogEnd           (u_FogStartEnd.y)
#define u_IsVertexLighting (u_MaterialFlags.x)
#define u_IsFragLighting   (u_MaterialFlags.w)
#define u_IsFogEnabled     (u_MaterialFlags.y)
#define u_RenderFog        (u_MaterialFlags.z)
#define u_DepthOffset      (u_MatMisc[0].w)

layout(std140) uniform ub_PrmParams {
    Mat3x4 u_BoneMatrix[16];
    Mat3x4 u_ViewMatrix;
    vec4 u_PrmMisc[1];
};

#define u_BoneDimension   (u_PrmMisc[0].x)
#define u_UseVertexColor  (u_PrmMisc[0].y)
#define u_HasTangent      (u_PrmMisc[0].z)

uniform sampler2D u_Texture0;
uniform sampler2D u_Texture1;
uniform sampler2D u_Texture2;
uniform sampler2D u_TextureLUT;

uniform samplerCube u_Cubemap;
`;

    constructor(public material: CMB.Material, private materialHacks: DMPMaterialHacks) {
        super();
        this.generateFragmentShader();
    }

    public generateFloat(v: number): string {
        let s = v.toString();
        if (!s.includes('.'))
            s += '.0';
        return s;
    }

    private generateColor(v: Color): string {
        return `vec4(${this.generateFloat(v.r)}, ${this.generateFloat(v.g)}, ${this.generateFloat(v.b)}, ${this.generateFloat(v.a)})`;
    }

    private generateAlphaTestCompare(compare: GfxCompareMode, reference: number): string {
        const ref = this.generateFloat(reference);
        switch (compare) {
        case GfxCompareMode.Never:   return `false`;
        case GfxCompareMode.Less:    return `t_CmbOut.a <  ${ref}`;
        case GfxCompareMode.LessEqual:  return `t_CmbOut.a <= ${ref}`;
        case GfxCompareMode.Equal:   return `t_CmbOut.a == ${ref}`;
        case GfxCompareMode.NotEqual:  return `t_CmbOut.a != ${ref}`;
        case GfxCompareMode.Greater: return `t_CmbOut.a >  ${ref}`;
        case GfxCompareMode.GreaterEqual:  return `t_CmbOut.a >= ${ref}`;
        case GfxCompareMode.Always:  return `true`;
        default: throw "whoops";
        }
    }

    private generateTexAccess(which: 0 | 1 | 2): string {
        if (!this.materialHacks.texturesEnabled)
            return `vec4(0.5, 0.5, 0.5, 1.0)`;

        switch (which) {
        case 0: // Texture 0 has TexCoord 0
            return `texture(SAMPLER_2D(u_Texture0), v_TexCoord0.xy)`;
        case 1: // Texture 1 has TexCoord 1
            return `texture(SAMPLER_2D(u_Texture1), v_TexCoord1.xy)`;
        case 2: // Texture 2 has either TexCoord 1 or 2 as input
            if (this.material.texCoordConfig === TexCoordConfig.Config0110 || this.material.texCoordConfig === TexCoordConfig.Config0111 || this.material.texCoordConfig === TexCoordConfig.Config0112)
                return `texture(SAMPLER_2D(u_Texture2), v_TexCoord1.xy)`;
            else
                return `texture(SAMPLER_2D(u_Texture2), v_TexCoord2.xy)`;
        }
    }

    private generateVertexColorAccess(): string {
        if (!this.materialHacks.vertexColorsEnabled)
            return `vec4(0.5, 0.5, 0.5, 1.0)`;
        return `v_Color`;
    }

    private generateTexCombinerSrc(src: CMB.CombineSourceDMP): string {
        switch (src) {
            // TODO(jstpierre): Move this to a uniform buffer?
        case CMB.CombineSourceDMP.CONSTANT: return `t_CmbConstant`;
        case CMB.CombineSourceDMP.TEXTURE0: return `t_Tex0`;
        case CMB.CombineSourceDMP.TEXTURE1: return `t_Tex1`;
        case CMB.CombineSourceDMP.TEXTURE2: return `t_Tex2`;
        case CMB.CombineSourceDMP.TEXTURE3: return `t_Tex3`;
        case CMB.CombineSourceDMP.PREVIOUS: return `t_CmbOut`;
        case CMB.CombineSourceDMP.PREVIOUS_BUFFER: return `t_CmbOutBuffer`;
        case CMB.CombineSourceDMP.PRIMARY_COLOR: return this.generateVertexColorAccess();
        case CMB.CombineSourceDMP.FRAGMENT_PRIMARY_COLOR: return `t_FragPriColor`;
        case CMB.CombineSourceDMP.FRAGMENT_SECONDARY_COLOR: return `t_FragSecColor`;
        }
    }

    private generateTexCombinerOp(src: CMB.CombineSourceDMP, op: CMB.CombineOpDMP): string {
        const s = this.generateTexCombinerSrc(src);
        switch (op) {
        case CMB.CombineOpDMP.SRC_COLOR:           return `${s}`;
        case CMB.CombineOpDMP.SRC_R:               return `${s}.rrrr`;
        case CMB.CombineOpDMP.SRC_G:               return `${s}.gggg`;
        case CMB.CombineOpDMP.SRC_B:               return `${s}.bbbb`;
        case CMB.CombineOpDMP.SRC_ALPHA:           return `${s}.aaaa`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_COLOR: return `(1.0 - ${s}.rgba)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_R:     return `(1.0 - ${s}.rrrr)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_G:     return `(1.0 - ${s}.gggg)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_B:     return `(1.0 - ${s}.bbbb)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_ALPHA: return `(1.0 - ${s}.aaaa)`;
        }
    }

    private generateTexCombinerCombine(combine: CMB.CombineResultOpDMP): string {
        switch (combine) {
        case CMB.CombineResultOpDMP.REPLACE:     return `(t_CmbIn0)`;
        case CMB.CombineResultOpDMP.MODULATE:    return `(t_CmbIn0 * t_CmbIn1)`;
        case CMB.CombineResultOpDMP.ADD:         return `(t_CmbIn0 + t_CmbIn1)`;
        case CMB.CombineResultOpDMP.ADD_SIGNED:  return `(t_CmbIn0 + t_CmbIn1 - 0.5)`;
        case CMB.CombineResultOpDMP.INTERPOLATE: return `(mix(t_CmbIn1, t_CmbIn0, t_CmbIn2))`;
        case CMB.CombineResultOpDMP.SUBTRACT:    return `(t_CmbIn0 - t_CmbIn1)`;
        case CMB.CombineResultOpDMP.DOT3_RGB:    return `vec4(vec3(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))), 1.0)`;
        case CMB.CombineResultOpDMP.DOT3_RGBA:   return `vec4(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))))`;
        case CMB.CombineResultOpDMP.MULT_ADD:    return `((t_CmbIn0 * t_CmbIn1) + t_CmbIn2)`;
        case CMB.CombineResultOpDMP.ADD_MULT:    return `(min(t_CmbIn0 + t_CmbIn1, vec4(1.0)) * t_CmbIn2)`;
        }
    }

    private generateTexCombinerScale(combine: CMB.CombineResultOpDMP, scale: CMB.CombineScaleDMP): string {
        const s = this.generateTexCombinerCombine(combine);
        switch (scale) {
        case CMB.CombineScaleDMP._1: return `saturate(${s})`;
        case CMB.CombineScaleDMP._2: return `(saturate(${s}) * 2.0)`;
        case CMB.CombineScaleDMP._4: return `(saturate(${s}) * 4.0)`;
        }
    }

    private generateTexCombinerBuffer(buffer: CMB.CombineBufferInputDMP): string {
        switch (buffer) {
        case CMB.CombineBufferInputDMP.PREVIOUS:        return `t_CmbOut`;
        case CMB.CombineBufferInputDMP.PREVIOUS_BUFFER: return `t_CmbOutBuffer`;
        }
    }

    private generateTexCombiner(c: CMB.TextureCombiner, i: number): string {
        // Generate the combiner itself.
        return `
    // Texture Combiner Stage ${i}
    // Constant index ${c.constantIndex}
    t_CmbConstant = u_ConstantColor[${c.constantIndex}];
    t_CmbOutBuffer = vec4(${this.generateTexCombinerBuffer(c.bufferInputRGB)}.rgb, ${this.generateTexCombinerBuffer(c.bufferInputAlpha)}.a);
    t_CmbIn0 = vec4(${this.generateTexCombinerOp(c.source0RGB, c.op0RGB)}.rgb, ${this.generateTexCombinerOp(c.source0Alpha, c.op0Alpha)}.a);
    t_CmbIn1 = vec4(${this.generateTexCombinerOp(c.source1RGB, c.op1RGB)}.rgb, ${this.generateTexCombinerOp(c.source1Alpha, c.op1Alpha)}.a);
    t_CmbIn2 = vec4(${this.generateTexCombinerOp(c.source2RGB, c.op2RGB)}.rgb, ${this.generateTexCombinerOp(c.source2Alpha, c.op2Alpha)}.a);
    t_CmbOut = clamp(vec4(${this.generateTexCombinerScale(c.combineRGB, c.scaleRGB)}.rgb, ${this.generateTexCombinerScale(c.combineAlpha, c.scaleAlpha)}.a), vec4(0.0), vec4(1.0));
`;
    }

    private generateTextureEnvironment(texEnv: CMB.TextureEnvironment): string {
        let S = `
    vec4 t_CmbConstant;
    vec4 t_CmbIn0, t_CmbIn1, t_CmbIn2;
    vec4 t_CmbOut, t_CmbOutBuffer;

    t_CmbOutBuffer = clamp(${this.generateColor(texEnv.combinerBufferColor)}, vec4(0.0), vec4(1.0));
    `;
        for (let i = 0; i < texEnv.textureCombiners.length; i++)
            S += this.generateTexCombiner(texEnv.textureCombiners[i], i);
        return S;
    }

    private generateFragColors(): string {
        const material = this.material;
        if(!material.isFragmentLightingEnabled)
            return ``;

        let S = `
    vec3 t_LightVector = vec3(0.0);
    vec3 t_ReflValue = vec3(1.0);
    float t_ClampHighlights = 1.0;
    float t_GeoFactor = 1.0;
    `;

        const bumpColor = `2.0 * t_Tex${material.bumpTextureIndex}.xyz - 1.0;`;
        S += `
    vec3 t_SurfNormal = ${material.bumpMode === BumpMode.AsBump ? bumpColor : `vec3(0.0, 0.0, 1.0);`}
    vec3 t_SurfTangent = ${material.bumpMode === BumpMode.AsTangent ? bumpColor : `vec3(1.0, 0.0, 0.0);`}

    bool isBumpRenormEnabled = ${material.isBumpRenormEnabled};
    if (isBumpRenormEnabled) {
        t_SurfNormal.z = sqrt(max(1.0 - dot(t_SurfNormal.xy, t_SurfNormal.xy), 0.0));
    }
    `;

        S += `
    vec4 t_NormQuat = normalize(v_QuatNormal);
    vec3 t_Normal = QuatRotate(t_NormQuat, t_SurfNormal);
    vec3 t_Tangent = QuatRotate(t_NormQuat, t_SurfTangent);

    for (int i = 0; i < 2; i++) {
        vec3 t_LightVector = normalize(u_SceneLights[i].Direction.xyz);
        vec3 t_HalfVector = t_LightVector + normalize(v_View.xyz);
        float t_DotProduct = max(dot(t_LightVector, t_Normal), 0.0);

        bool isClampHighlight = ${material.isClampHighlight};
        if (isClampHighlight) {
            t_ClampHighlights = sign(t_DotProduct);
        }
    `;
        // Might have to support this later for LM3D
        const spot_atten = "1.0";
        const dist_atten = "1.0";
        let d0_lut_value = "1.0";
        let d1_lut_value = "1.0";

        if(material.isGeoFactorEnabled){
            S += `
        t_GeoFactor = dot(t_HalfVector, t_HalfVector);
        t_GeoFactor = t_GeoFactor == 0.0 ? 0.0 : min(t_DotProduct / t_GeoFactor, 1.0);
        `;
        }

        if(material.isDist0Enabled && this.IsLUTSupported(MatLutType.Distribution0))
            d0_lut_value = this.getLutInput(material.lutDist0);

        let specular_0 = `(${d0_lut_value} * u_SceneLights[i].Specular0.xyz)`;
        if(material.isGeo0Enabled)
            specular_0 = `(${specular_0} * t_GeoFactor)`;

        if(material.isReflectionEnabled){
            if(this.IsLUTSupported(MatLutType.ReflectR))
                S+= `
        t_ReflValue.r = ${this.getLutInput(material.lutReflectR)};
        t_ReflValue.g = ${this.IsLUTSupported(MatLutType.ReflectG) ? this.getLutInput(material.lutReflectG) : `t_ReflValue.r`};
        t_ReflValue.b = ${this.IsLUTSupported(MatLutType.ReflectB) ? this.getLutInput(material.lutReflectB) : `t_ReflValue.r`};
        `;
        }

        if(material.isDist1Enabled && this.IsLUTSupported(MatLutType.Distribution1))
            d1_lut_value = this.getLutInput(material.lutDist1);

        let specular_1 = `(${d1_lut_value} * t_ReflValue * u_SceneLights[i].Specular1.xyz)`;
        if(material.isGeo1Enabled)
            specular_1 = `(${specular_1} * t_GeoFactor)`;

        if (material.fresnelSelector !== FresnelSelector.No && this.IsLUTSupported(MatLutType.Fresnel)) {
            const value = this.getLutInput(material.lutFresnel);

            // Only use the last light
            S += `\tif(i == 1){\n\t\t\t`;
            switch(material.fresnelSelector){
                case FresnelSelector.Pri: S += `t_FragPriColor.a = ${value};\n`; break;
                case FresnelSelector.Sec: S += `t_FragSecColor.a = ${value};\n`; break;
                case FresnelSelector.PriSec: S += `t_FragPriColor.a = ${value};\n` + "\t\t\t" + `t_FragSecColor.a = t_FragPriColor.a;\n`; break;
            }
            S+=`\t\t}\n`;
        }

        S += `
        t_FragPriColor.rgb += ((u_SceneLights[i].Diffuse.xyz * t_DotProduct) + u_SceneLights[i].Ambient.xyz) * ${dist_atten} * ${spot_atten};
        t_FragSecColor.rgb += (${specular_0} + ${specular_1}) * t_ClampHighlights * ${dist_atten} * ${spot_atten};
    }`;

        S += `
    t_FragPriColor.rgb += u_SceneAmbient.rgb;
    t_FragPriColor = clamp(t_FragPriColor, vec4(0.0), vec4(1.0));
    t_FragSecColor = clamp(t_FragSecColor, vec4(0.0), vec4(1.0));`;

        return S;
    }

    private IsLUTSupported(lutType: MatLutType): boolean {
        const config = this.material.lightingConfig;
        switch(lutType){
            case MatLutType.Distribution0: return config !== LightingConfig.Config1;
            case MatLutType.Distribution1: return config !== LightingConfig.Config0 && config !== LightingConfig.Config1 && config !== LightingConfig.Config5;
            case MatLutType.Fresnel: return config !== LightingConfig.Config0 && config !== LightingConfig.Config2 && config !== LightingConfig.Config4;
            case MatLutType.ReflectR: return config !== LightingConfig.Config3;
            case MatLutType.ReflectG:
            case MatLutType.ReflectB: return config === LightingConfig.Config4 || config === LightingConfig.Config5 || config === LightingConfig.Config7;
        }
    }

    private getLutInput(sampler: CMB.MaterialLutSampler): string {
        let index, output: string;

        switch (sampler.input) {
        case LutInput.CosNormalHalf:  index = `dot(t_Normal, normalize(t_HalfVector))`; break;
        case LutInput.CosViewHalf:    index = "dot(normalize(v_View.xyz), normalize(t_HalfVector))"; break;
        case LutInput.CosNormalView:  index = "dot(t_Normal, normalize(v_View.xyz))"; break;
        case LutInput.CosLightNormal: index = "dot(t_LightVector, t_Normal)"; break;
        case LutInput.CosLightSpot:   index = "dot(t_LightVector, t_SpotDir)"; break;
        case LutInput.CosPhi: {
            const half_angle_proj = "normalize(t_HalfVector) - t_Normal * dot(t_Normal, normalize(t_HalfVector))"
            index = `dot(${half_angle_proj}, t_Tangent)`;
        } break;
        }

        output = `texture(SAMPLER_2D(u_TextureLUT), vec2(((${index} + 1.0) * 0.5) + (1.0 / 512.0), ${this.generateFloat(sampler.index)})).r`;

        return `${output} * ${this.generateFloat(sampler.scale)}`;
    }

    private generateFragmentShader(): void {
        this.frag = `
precision mediump float;
${DMPProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}

in vec4 v_Color;
in vec3 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;

in vec3 v_Normal;
in vec4 v_QuatNormal;
in float v_Depth;
in vec3 v_View;

vec3 QuatRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
    vec4 t_Tex0 = ${this.generateTexAccess(0)};
    vec4 t_Tex1 = ${this.generateTexAccess(1)};
    vec4 t_Tex2 = ${this.generateTexAccess(2)};
    vec4 t_Tex3 = vec4(0.0);

    vec4 t_FragPriColor = vec4(0.0);
    vec4 t_FragSecColor = vec4(0.0);
    ${this.generateFragColors()}
    ${this.generateTextureEnvironment(this.material.textureEnvironment)}

    if (!(${this.generateAlphaTestCompare(this.material.alphaTestFunction, this.material.alphaTestReference)}))
        discard;

    vec4 t_ResultColor = t_CmbOut;

    #ifdef USE_VERTEX_NORMAL
        t_ResultColor.rgba = vec4((v_Normal * 0.5 + 0.5), 1.0);
    #endif

    #ifdef USE_UV
        t_ResultColor.rgba = vec4(v_TexCoord0.xy, 1.0, 1.0);
    #endif

    if (u_IsFogEnabled > 0.0 && u_RenderFog > 0.0) {
        // TODO(M-1): Implement true fog
        float t_FogFactor = smoothstep(u_FogStart - v_Depth, u_FogEnd + v_Depth, v_Depth);
        t_ResultColor.rgb = mix(t_ResultColor.rgb, u_FogColor.rgb, t_FogFactor);
    }

    gl_FragColor = t_ResultColor;
    gl_FragDepth = gl_FragCoord.z + u_DepthOffset;
}
`;
    }
}

class OoT3DProgram extends DMPProgram {
    constructor(material: CMB.Material, materialHacks: DMPMaterialHacks) {
        super(material, materialHacks);

        this.vert = `
precision mediump float;
${DMPProgram.BindingsDefinition}
${GfxShaderLibrary.MulNormalMatrix}
${GfxShaderLibrary.saturate}

layout(location = ${DMPProgram.a_Position}) in vec3 a_Position;
layout(location = ${DMPProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${DMPProgram.a_Tangent}) in vec3 a_Tangent;
layout(location = ${DMPProgram.a_Color}) in vec4 a_Color;
layout(location = ${DMPProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${DMPProgram.a_TexCoord12}) in vec4 a_TexCoord12;
layout(location = ${DMPProgram.a_BoneIndices}) in vec4 a_BoneIndices;
layout(location = ${DMPProgram.a_BoneWeights}) in vec4 a_BoneWeights;

out vec4 v_Color;
out vec3 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;

out vec3 v_Normal;
out vec4 v_QuatNormal;
out float v_Depth;
out vec3 v_View;

vec4 CalcQuatFromNormal(vec3 normal) {
    float QuatZ = 0.5 * (normal.z + 1.0);
    if (QuatZ <= 0.0)
        return vec4(1.0, 0.0, 0.0, 0.0);
    QuatZ = 1.0 / sqrt(QuatZ);
    return vec4((0.5 * normal.xy) * QuatZ, (1.0 / QuatZ), 0.0);
}

//TODO(M-1): Clean this up and figure out what is really happening
vec4 FullQuatCalcFallback(in vec4 t_temp0, in vec4 t_Normal, in vec4 t_temp1) {
    vec4 t_fallback = vec4(0.0);
    vec3 t_constant = vec3(1.0, 1.0, -1.0);

	if (t_temp0.z > t_temp0.y) {
		if (t_temp0.y > t_temp0.x) {
            t_fallback.x = (1.0 + -t_temp0.y) + (t_temp0.z + -t_temp0.x);
            t_fallback.yzw = (t_temp1.yzw * t_constant) + t_Normal.wxy;
		} else {
            t_fallback = vec4((1.0 + -t_temp0.y), t_temp1.yzw * t_constant);
			if (t_temp0.z > t_temp0.x) {
                t_fallback += vec4((t_temp0.z + -t_temp0.x), t_Normal.wxy);
			} else {
				t_fallback.xyw = (t_temp1.zwy * t_constant) + t_Normal.xyw;
				t_fallback.z = (1.0 + -t_temp0.z) + (t_temp0.z + -t_temp0.x);
			}
		}
		t_fallback.w = -t_fallback.w;
	} else {
		if (t_temp0.y > t_temp0.x) {
            t_fallback.xzw = (t_temp1.ywz * t_constant) + t_Normal.wyx;
            t_fallback.y = (1.0 + -t_temp0.z) + (t_temp0.y + -t_temp0.x);
		} else {
            t_fallback.xyw = (t_temp1.zwy * t_constant) + t_Normal.xyw;
            t_fallback.z = (1.0 + -t_temp0.z) + (t_temp0.x + -t_temp0.y);
			t_fallback.w = -t_fallback.w;
		}
	}

	return normalize(t_fallback);
}

vec4 CalcQuatFromTangent(in vec3 t_Tangent) {
    vec4 t_temp0 = vec4(normalize(cross(v_Normal, t_Tangent)), 0.0);
    vec4 t_temp1 = vec4(cross(t_temp0.xyz, v_Normal.xyz), t_temp0.z);
    vec4 t_Normal = vec4(v_Normal.xyz, t_temp0.x);
    float t_tempW = 1.0 + ((v_Normal.z + t_temp0.y) + t_temp1.x);

	t_temp0.zx = vec2(t_temp1.x, t_Normal.z);

	if (0.00390625 > t_tempW) {
		return FullQuatCalcFallback(t_temp0, t_Normal, t_temp1);
	}

    return normalize(vec4(vec3(t_temp1.w, t_Normal.x, t_temp1.y) + -vec3(t_Normal.y, t_temp1.z, t_Normal.w), t_tempW));
}

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

ivec4 UnpackParams(float t_Param) {
    int t_Int = int(t_Param);
    ivec4 t_Params;
    t_Params.x = (t_Int >> 12) & 0x0F;
    t_Params.y = (t_Int >>  8) & 0x0F;
    t_Params.z = (t_Int >>  4) & 0x0F;
    t_Params.w = (t_Int >>  0) & 0x0F;
    return t_Params;
}

vec2 CalcTextureSrc(in int t_TexSrcIdx) {
    if (t_TexSrcIdx == 0)
        return a_TexCoord0;
    else if (t_TexSrcIdx == 1)
        return a_TexCoord12.xy;
    else if (t_TexSrcIdx == 2)
        return a_TexCoord12.zw;
    else
        // Should not be possible.
        return vec2(0.0, 0.0);
}

vec3 CalcTextureCoordRaw(in int t_Idx) {
    ivec4 t_Params = UnpackParams(u_MatMisc[0][t_Idx]);
    int t_MappingMode = t_Params.x;

    if (t_MappingMode == 0) {
        // No mapping, should be illegal.
        return vec3(0.0);
    } else if (t_MappingMode == 1) {
        // UV mapping.
        vec2 t_TexSrc = CalcTextureSrc(t_Params.y);
        return UnpackMatrix(u_TexMtx[t_Idx]) * vec4(t_TexSrc, 0.0, 1.0);
    } else if (t_MappingMode == 2) {
        // Cube env mapping.
        //vec3 t_Incident = normalize(vec3(t_Position.xy, -t_Position.z) - vec3(u_CameraPos.xy, -u_CameraPos.z));
        //vec3 t_TexSrc = reflect(-t_Incident, v_Normal);

        return vec3(0.0);
    } else if (t_MappingMode == 3) {
        // Sphere env mapping.
        // Convert view-space normal to proper place.
        vec2 t_TexSrc = (v_Normal.xy * 0.5) + 0.5;
        return UnpackMatrix(u_TexMtx[t_Idx]) * vec4(t_TexSrc, 0.0, 1.0);
    } else if (t_MappingMode == 4) {
        // Projection mapping.
        // Not implemented yet.
        return vec3(0.0);
    } else {
        // Should not be possible.
        return vec3(0.0);
    }
}

vec3 CalcTextureCoord(in int t_Idx) {
    vec3 t_Coords = CalcTextureCoordRaw(t_Idx);
    t_Coords.t = 1.0 - t_Coords.t;
    return t_Coords;
}

void main() {
    // Compute our matrix.
    mat4x3 t_BoneMatrix;

    vec4 t_BoneWeights = a_BoneWeights;

    // Mask off bone dimension.
    if (u_BoneDimension < 4.0)
        t_BoneWeights.w = 0.0;
    if (u_BoneDimension < 3.0)
        t_BoneWeights.z = 0.0;
    if (u_BoneDimension < 2.0)
        t_BoneWeights.y = 0.0;
    if (u_BoneDimension < 1.0)
        t_BoneWeights.x = 0.0;

    if (any(greaterThan(t_BoneWeights.xyzw, vec4(0.0)))) {
        t_BoneMatrix = mat4x3(0.0);
        t_BoneMatrix += UnpackMatrix(u_BoneMatrix[int(a_BoneIndices.x)]) * t_BoneWeights.x;
        t_BoneMatrix += UnpackMatrix(u_BoneMatrix[int(a_BoneIndices.y)]) * t_BoneWeights.y;
        t_BoneMatrix += UnpackMatrix(u_BoneMatrix[int(a_BoneIndices.z)]) * t_BoneWeights.z;
        t_BoneMatrix += UnpackMatrix(u_BoneMatrix[int(a_BoneIndices.w)]) * t_BoneWeights.w;
    } else {
        // If we have no bone weights, then we're in rigid skinning, so take the first bone index.
        // If we're single-bone, then our bone indices will be 0, so this also works for that.
        t_BoneMatrix = UnpackMatrix(u_BoneMatrix[int(a_BoneIndices.x)]);
    }

    vec3 t_ModelPosition = t_BoneMatrix * vec4(a_Position, 1.0);
    vec3 t_ViewPosition = UnpackMatrix(u_ViewMatrix) * vec4(t_ModelPosition, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_ViewPosition, 1.0);

    vec3 t_ModelNormal = MulNormalMatrix(t_BoneMatrix, a_Normal);
    vec3 t_ModelTangent = (t_BoneMatrix * vec4(a_Tangent, 0.0)).xyz;
    vec3 t_ViewTangent = normalize((UnpackMatrix(u_ViewMatrix) * vec4(t_ModelTangent, 0.0)).xyz);
    v_Normal = normalize((UnpackMatrix(u_ViewMatrix) * vec4(t_ModelNormal, 0.0)).xyz);
    v_QuatNormal = vec4(1.0, 0.0, 0.0, 0.0);

    v_Depth = gl_Position.w;
    v_View = -t_ViewPosition;

    if (u_IsFragLighting > 0.0) {
        v_QuatNormal = u_HasTangent > 0.0 ? CalcQuatFromTangent(t_ViewTangent) : CalcQuatFromNormal(v_Normal);
    }

    if (u_IsVertexLighting > 0.0) {
        vec4 t_VertexLightingColor = vec4(0);

        for (int i = 0; i < 2; i++) {
            vec4 t_Diffuse = u_SceneLights[i].Diffuse * u_MatDiffuseColor;
            vec4 t_Ambient = u_SceneLights[i].Ambient * u_MatAmbientColor;
            float t_LightDir = max(dot(-u_SceneLights[i].Direction.xyz, v_Normal.xyz), 0.0);
            t_VertexLightingColor += vec4((t_Diffuse * t_LightDir + t_Ambient).xyz, t_Diffuse.w);
        }

        v_Color = u_UseVertexColor > 0.0 ? (t_VertexLightingColor * a_Color) : t_VertexLightingColor;
    } else {
        v_Color = u_UseVertexColor > 0.0 ? a_Color : u_MatDiffuseColor;
    }

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_Color = saturate(v_Color);

    v_TexCoord0 = CalcTextureCoord(0);
    v_TexCoord1 = CalcTextureCoord(1).xy;
    v_TexCoord2 = CalcTextureCoord(2).xy;
}
`;
    }
}

export function fillSceneParamsDataOnTemplate(template: GfxRenderInst, camera: Camera): void {
    let offs = template.allocateUniformBuffer(DMPProgram.ub_SceneParams, 16);
    const d = template.mapUniformBufferF32(DMPProgram.ub_SceneParams);
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const scratchMatrix = mat4.create();
const scratchVec4 = vec4.create();
const scratchVec3 = vec3.create();
const scratchColor = colorNewFromRGBA(0, 0, 0, 1);
class MaterialInstance {
    public textureMappings: TextureMapping[] = nArray(5, () => new TextureMapping());
    private gfxSamplers: GfxSampler[] = [];
    private colorAnimators: CMAB.ColorAnimator[] = [];
    private srtAnimators: CMAB.TextureSRTAnimator[] = [];
    private texturePaletteAnimators: CMAB.TexturePaletteAnimator[] = [];

    public diffuseColor: Color = OpaqueBlack;
    public ambientColor: Color = OpaqueBlack;
    public specular0Color: Color = OpaqueBlack;
    public specular1Color: Color = OpaqueBlack;
    public emissionColor: Color = OpaqueBlack;
    public constantColors: Color[] = [];

    public visible: boolean = true;
    public texturesEnabled: boolean = true;
    public vertexColorsEnabled: boolean = true;
    public monochromeVertexColorsEnabled: boolean = false;

    private vertexNormalsEnabled: boolean = false;
    private uvEnabled: boolean = false;
    private renderFog: boolean = true;
    private vertexColorScale = 1;
    private program: DMPProgram | null = null;
    private gfxProgram: GfxProgram | null = null;

    public environmentSettings = new ZSI.ZSIEnvironmentSettings;

    constructor(cache: GfxRenderCache, lutTexure: GfxTexture | null, public cmbData: CmbData, public material: CMB.Material) {
        this.diffuseColor = colorNewCopy(this.material.diffuseColor);
        this.ambientColor = colorNewCopy(this.material.ambientColor);
        this.specular0Color = colorNewCopy(this.material.specular0Color);
        this.specular1Color = colorNewCopy(this.material.specular1Color);
        this.emissionColor = colorNewCopy(this.material.emissionColor);

        for (let i = 0; i < this.material.constantColors.length; i++)
            this.constantColors[i] = colorNewCopy(this.material.constantColors[i]);

        for (let i = 0; i < this.material.textureBindings.length; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = this.translateTextureFilter(binding.minFilter);
            const [magFilter] = this.translateTextureFilter(binding.magFilter);

            const gfxSampler = cache.createSampler({
                wrapS: this.translateWrapMode(binding.wrapS),
                wrapT: this.translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            });
            this.gfxSamplers.push(gfxSampler);

            const cmb = this.cmbData.cmb;
            if (i === 0 && cmb.textures[binding.textureIdx].dimension === GfxTextureDimension.Cube)
                this.textureMappings[4].gfxSampler = gfxSampler;
            else
                this.textureMappings[i].gfxSampler = gfxSampler;
        }

        const lutSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
        });
        this.gfxSamplers.push(lutSampler);
        this.textureMappings[3].gfxSampler = lutSampler;
        this.textureMappings[3].gfxTexture = lutTexure;

        this.createProgram();
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setVertexNormalsEnabled(v: boolean): void {
        this.vertexNormalsEnabled = v;
        this.createProgram();
    }

    public setUVEnabled(v: boolean): void {
        this.uvEnabled = v;
        this.createProgram();
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        this.environmentSettings.copy(environmentSettings);
    }

    public setRenderFog(isFogEnabled: boolean): void {
        this.renderFog = isFogEnabled;
    }

    public setVertexColorScale(n: number): void {
        this.vertexColorScale = n;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new OoT3DProgram(this.material, this);

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');
        if (this.vertexNormalsEnabled)
            program.defines.set('USE_VERTEX_NORMAL', '1');
        if (this.uvEnabled)
            program.defines.set('USE_UV', '1');

        program.defines.set('VERTEX_COLOR_SCALE', program.generateFloat(this.vertexColorScale));

        this.program = program;
        this.gfxProgram = null;
    }

    private calcTexMtx(dst: mat4, i: number, textureCoordinator: CMB.TextureCoordinator): void {
        // Compute SRT matrix.
        if (this.srtAnimators[i]) {
            this.srtAnimators[i].calcTexMtx(dst);
            mat4.mul(dst, textureCoordinator.textureMatrix, dst);
        } else {
            mat4.copy(dst, textureCoordinator.textureMatrix);
        }
    }

    private packTexCoordParams(textureCoordinator: CMB.TextureCoordinator) {
        return (textureCoordinator.mappingMethod << 12) | (textureCoordinator.sourceCoordinate << 8);
    }

    public setOnRenderInst(cache: GfxRenderCache, template: GfxRenderInst, viewMatrix: ReadonlyMat4): void {
        let offs = template.allocateUniformBuffer(DMPProgram.ub_MaterialParams, 4*4 + 4*5*3 + 4*2 + 4*6 + 4*3*3 + 4);
        const layer = this.material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer + this.material.renderLayer);
        template.setMegaStateFlags(this.material.megaStateFlags);
        template.setBlendColor(this.material.blendColor);

        if (this.gfxProgram === null)
            this.gfxProgram = cache.createProgram(this.program!);
        template.setGfxProgram(this.gfxProgram);

        const mapped = template.mapUniformBufferF32(DMPProgram.ub_MaterialParams);

        this.calcColor(this.emissionColor,  this.material.emissionColor,  ColorAnimType.Emission);
        this.calcColor(this.ambientColor,   this.material.ambientColor,   ColorAnimType.Ambient);
        this.calcColor(this.diffuseColor,   this.material.diffuseColor,   ColorAnimType.Diffuse);
        this.calcColor(this.specular0Color, this.material.specular0Color, ColorAnimType.Specular0);
        this.calcColor(this.specular1Color, this.material.specular1Color, ColorAnimType.Specular1);

        offs += fillColor(mapped, offs, this.diffuseColor);
        offs += fillColor(mapped, offs, this.ambientColor);
        offs += fillVec4(mapped, offs, this.material.isVertexLightingEnabled ? 1:0, this.material.isFogEnabled? 1:0, this.renderFog ? 1:0, this.material.isFragmentLightingEnabled ? 1:0);

        colorMult(scratchColor, this.ambientColor, this.environmentSettings.actorGlobalAmbient);
        colorAdd(scratchColor, this.emissionColor, scratchColor);
        colorClamp(scratchColor, scratchColor, 0, 1);
        offs += fillColor(mapped, offs, scratchColor);


        if (this.material.isFragmentLightingEnabled) {
            for (let i = 0; i < 3; i++) {
                const light = this.environmentSettings.lights[i];

                colorMult(scratchColor, light.ambient, this.ambientColor);
                offs += fillColor(mapped, offs, scratchColor);

                colorMult(scratchColor, light.diffuse, this.diffuseColor);
                offs += fillColor(mapped, offs, scratchColor);

                colorMult(scratchColor, light.specular0, this.specular0Color);
                offs += fillColor(mapped, offs, scratchColor);

                this.material.isReflectionEnabled ? colorCopy(scratchColor, light.specular1) : colorMult(scratchColor, light.specular1, this.specular1Color);
                offs += fillColor(mapped, offs, scratchColor);

                transformVec3Mat4w0(scratchVec3, viewMatrix, light.direction);
                offs += fillVec4(mapped, offs, scratchVec3[0], scratchVec3[1], scratchVec3[2]);
            }
        } else {
            for (let i = 0; i < 3; i++) {
                const light = this.environmentSettings.lights[i];

                offs += fillColor(mapped, offs, light.ambient);
                offs += fillColor(mapped, offs, light.diffuse);
                offs += fillColor(mapped, offs, light.specular0);
                offs += fillColor(mapped, offs, light.specular1);

                transformVec3Mat4w0(scratchVec3, viewMatrix, light.direction);
                offs += fillVec4(mapped, offs, scratchVec3[0], scratchVec3[1], scratchVec3[2]);
            }
        }

        offs += fillColor(mapped, offs, this.environmentSettings.fogColor, 0);
        offs += fillVec4(mapped, offs, this.environmentSettings.fogStart, this.environmentSettings.fogEnd);

        for (let i = 0; i < 6; i++) {
            this.calcColor(scratchColor, this.constantColors[i], i);
            offs += fillColor(mapped, offs, scratchColor);
        }

        for (let i = 0; i < 3; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx >= 0) {
                const texture = this.cmbData.cmb.textures[binding.textureIdx];
                const dst = this.textureMappings[texture.dimension === GfxTextureDimension.Cube ? 4 : i];

                if (this.texturePaletteAnimators[i]) {
                    dst.gfxTexture = this.texturePaletteAnimators[i].getTexture();
                } else {
                    dst.gfxTexture = this.cmbData.textureData[binding.textureIdx].gfxTexture;
                }

                assert(dst.gfxTexture !== undefined);
                scratchVec4[i] = this.packTexCoordParams(this.material.textureCoordinators[i]);
                this.calcTexMtx(scratchMatrix, i, this.material.textureCoordinators[i]);
            } else {
                scratchVec4[i] = 0.0;
                mat4.identity(scratchMatrix);
            }

            offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        }

        const depthOffset = reverseDepthForDepthOffset(this.material.polygonOffset);
        scratchVec4[3] = depthOffset;

        offs += fillVec4v(mapped, offs, scratchVec4);

        template.setSamplerBindingsFromTextureMappings(this.textureMappings);
    }

    public bindCMAB(cmabData: CmabData, animationController: AnimationController): void {
        const cmab = cmabData.cmab;
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.materialIndex !== this.material.index)
                continue;

            if (animEntry.animationType === CMAB.AnimationType.Translation || animEntry.animationType === CMAB.AnimationType.Rotation || animEntry.animationType === CMAB.AnimationType.Scale) {
                this.srtAnimators[animEntry.channelIndex] = new CMAB.TextureSRTAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.ConstColor    || animEntry.animationType === CMAB.AnimationType.DiffuseColor ||
                       animEntry.animationType === CMAB.AnimationType.Spec0Color    || animEntry.animationType === CMAB.AnimationType.Spec1Color ||
                       animEntry.animationType === CMAB.AnimationType.EmissionColor || animEntry.animationType === CMAB.AnimationType.AmbientColor) {
                this.colorAnimators[animEntry.channelIndex] = new CMAB.ColorAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.TexturePalette) {
                this.texturePaletteAnimators[animEntry.channelIndex] = new CMAB.TexturePaletteAnimator(animationController, cmabData, animEntry);
            }
        }
    }

    private calcColor(dst: Color, fallback: Color, type: ColorAnimType): void{
        if (this.colorAnimators[type])
            this.colorAnimators[type].calcColor(dst, fallback);
        else
            colorCopy(dst, fallback);
    }

    private translateWrapMode(wrapMode: CMB.TextureWrapMode): GfxWrapMode {
        switch (wrapMode) {
        case CMB.TextureWrapMode.CLAMP: return GfxWrapMode.Clamp;
        case CMB.TextureWrapMode.CLAMP_TO_EDGE: return GfxWrapMode.Clamp;
        case CMB.TextureWrapMode.REPEAT: return GfxWrapMode.Repeat;
        case CMB.TextureWrapMode.MIRRORED_REPEAT: return GfxWrapMode.Mirror;
        default: throw new Error();
        }
    }

    private translateTextureFilter(filter: CMB.TextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
        switch (filter) {
        case CMB.TextureFilter.LINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.NoMip];
        case CMB.TextureFilter.NEAREST:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.NoMip];
        case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Linear];
        case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Nearest];
        case CMB.TextureFilter.NEAREST_MIPMAP_LINEAR:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.Linear];
        case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.Nearest];
        default: throw new Error();
        }
    }

    public destroy(device: GfxDevice): void {
    }
}

class PrmsData {
    constructor(public prms: CMB.Prms, public indexBufferOffset: number) {
    }
}

class SepdData {
    private buffers: GfxBuffer[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public useVertexColor: boolean = false;
    public indexBuffer: GfxBuffer;
    public prmsData: PrmsData[] = [];

    constructor(cache: GfxRenderCache, indexDataSlice: ArrayBufferSlice, vatr: CMB.VatrChunk, public sepd: CMB.Sepd) {
        const device = cache.device;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
        this.useVertexColor = sepd.hasVertexColors;

        const transformVertexData = (buffer: ArrayBufferSlice, dataType: CMB.DataType, scale: number) => {
            if (dataType === CMB.DataType.Float) {
                return buffer.createTypedArray(Float32Array);
            } else if (dataType === CMB.DataType.Byte) {
                return Float32Array.from(buffer.createTypedArray(Int8Array), (v) => v * scale);
            } else if (dataType === CMB.DataType.UByte) {
                return Float32Array.from(buffer.createTypedArray(Uint8Array), (v) => v * scale);
            } else if (dataType === CMB.DataType.Short) {
                return Float32Array.from(buffer.createTypedArray(Int16Array), (v) => v * scale);
            } else if (dataType === CMB.DataType.UShort) {
                return Float32Array.from(buffer.createTypedArray(Uint16Array), (v) => v * scale);
            } else if (dataType === CMB.DataType.Int) {
                return Float32Array.from(buffer.createTypedArray(Int32Array), (v) => v * scale);
            } else if (dataType === CMB.DataType.UInt) {
                return Float32Array.from(buffer.createTypedArray(Uint32Array), (v) => v * scale);
            } else {
                throw "whoops";
            }
        };

        const hasVertexAttib = (data: ArrayBufferSlice | null, vertexAttrib: CMB.SepdVertexAttrib | null) => {
            return vertexAttrib !== null && data !== null && data.byteLength !== 0 && vertexAttrib.mode !== CMB.SepdVertexAttribMode.CONSTANT;
        };

        const pushBuffer = (location: number, format: GfxFormat, data: Float32Array, frequency: GfxVertexBufferFrequency) => {
            const buffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, data.buffer, data.byteOffset, data.byteLength);
            const bufferIndex = this.vertexBufferDescriptors.length;
            this.buffers.push(buffer);
            this.vertexBufferDescriptors.push({ buffer });
            vertexBufferDescriptors.push({ byteStride: getFormatByteSize(format), frequency });
            vertexAttributeDescriptors.push({ location, format, bufferIndex, bufferByteOffset: 0 });
        };

        const getConstantData = (vertexAttrib: CMB.SepdVertexAttrib | null) => {
            const constantData = new Float32Array(4);
            if (vertexAttrib !== null)
                constantData.set(vertexAttrib.constant);
            return constantData;
        };

        // Transform everything into floats.
        const loadVertexAttrib = (location: number, format: GfxFormat, data: ArrayBufferSlice | null, vertexAttrib: CMB.SepdVertexAttrib | null) => {
            if (hasVertexAttib(data, vertexAttrib)) {
                const newData = transformVertexData(data!.slice(vertexAttrib!.start), vertexAttrib!.dataType, vertexAttrib!.scale);
                pushBuffer(location, format, newData, GfxVertexBufferFrequency.PerVertex);
            } else {
                const constantData = getConstantData(vertexAttrib);
                pushBuffer(location, format, constantData, GfxVertexBufferFrequency.Constant);
            }
        };

        loadVertexAttrib(DMPProgram.a_Position,  GfxFormat.F32_RGB, vatr.position, sepd.position);
        loadVertexAttrib(DMPProgram.a_Normal,    GfxFormat.F32_RGB, vatr.normal, sepd.normal);
        loadVertexAttrib(DMPProgram.a_Tangent,   GfxFormat.F32_RGB, sepd.hasTangents ? vatr.tangent : null, sepd.tangent);
        loadVertexAttrib(DMPProgram.a_Color,     GfxFormat.F32_RGBA, vatr.color, sepd.color);
        loadVertexAttrib(DMPProgram.a_TexCoord0, GfxFormat.F32_RG, vatr.texCoord0, sepd.texCoord0);

        // We special case a_TexCoord12 here since we need to staple it together from texCoord0 and texCoord1.
        // loadVertexAttrib(DMPProgram.a_TexCoord1, GfxFormat.F32_RG, vatr.texCoord1, sepd.texCoord1);
        // loadVertexAttrib(DMPProgram.a_TexCoord2, GfxFormat.F32_RG, vatr.texCoord2, sepd.texCoord2);

        const hasTexCoord1 = hasVertexAttib(vatr.texCoord1, sepd.texCoord1);
        const hasTexCoord2 = hasVertexAttib(vatr.texCoord2, sepd.texCoord2);
        if (hasTexCoord1 || hasTexCoord2) {
            const data1 = hasTexCoord1 ? transformVertexData(vatr.texCoord1!.slice(sepd.texCoord1!.start), sepd.texCoord1!.dataType, sepd.texCoord1!.scale) : getConstantData(sepd.texCoord1);
            const data1Stride = hasTexCoord1 ? 2 : 0;

            const data2 = hasTexCoord2 ? transformVertexData(vatr.texCoord2!.slice(sepd.texCoord2!.start), sepd.texCoord2!.dataType, sepd.texCoord2!.scale) : getConstantData(sepd.texCoord1);
            const data2Stride = hasTexCoord2 ? 2 : 0;

            const vertexCount = data1.length / 2;
            const newData = new Float32Array(vertexCount * 4);

            for (let i = 0; i < vertexCount; i++) {
                newData[i*4+0] = data1[i*data1Stride+0];
                newData[i*4+1] = data1[i*data1Stride+1];
                newData[i*4+2] = data2[i*data2Stride+0];
                newData[i*4+3] = data2[i*data2Stride+1];
            }

            pushBuffer(DMPProgram.a_TexCoord12, GfxFormat.F32_RGBA, newData, GfxVertexBufferFrequency.PerVertex);
        } else {
            const constantData = new Float32Array(4);
            if (sepd.texCoord0 !== null)
                constantData.set(sepd.texCoord0.constant.slice(0, 2), 0);
            if (sepd.texCoord1 !== null)
                constantData.set(sepd.texCoord1.constant.slice(0, 2), 2);
            pushBuffer(DMPProgram.a_TexCoord12, GfxFormat.F32_RGBA, constantData, GfxVertexBufferFrequency.Constant);
        }

        const hasBoneIndices = sepd.prms[0].skinningMode !== CMB.SkinningMode.SingleBone && sepd.boneIndices.dataType === CMB.DataType.UByte;
        loadVertexAttrib(DMPProgram.a_BoneIndices, setFormatCompFlags(GfxFormat.F32_R, sepd.boneDimension), hasBoneIndices ? vatr.boneIndices : null, sepd.boneIndices);
        const hasBoneWeights = sepd.prms[0].skinningMode === CMB.SkinningMode.SmoothSkinning;
        loadVertexAttrib(DMPProgram.a_BoneWeights, setFormatCompFlags(GfxFormat.F32_R, sepd.boneDimension), hasBoneWeights ? vatr.boneWeights : null, sepd.boneWeights);

        let indexBufferCount = 0;
        for (let i = 0; i < this.sepd.prms.length; i++) {
            const prms = sepd.prms[i];
            assert(prms.prm.indexType === CMB.DataType.UShort || prms.prm.indexType === CMB.DataType.UByte);
            indexBufferCount += prms.prm.count;
        }

        const indexData = new Uint16Array(indexBufferCount);
        let indexBufferOffs = 0;
        for (let i = 0; i < this.sepd.prms.length; i++) {
            const prms = sepd.prms[i];
            this.prmsData.push(new PrmsData(prms, indexBufferOffs));

            if (prms.prm.indexType === CMB.DataType.UShort)
                indexData.set(indexDataSlice.createTypedArray(Uint16Array, prms.prm.offset, prms.prm.count), indexBufferOffs);
            else if (prms.prm.indexType === CMB.DataType.UByte)
                indexData.set(indexDataSlice.createTypedArray(Uint8Array, prms.prm.offset, prms.prm.count), indexBufferOffs);

            indexBufferOffs += prms.prm.count;
        }

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData.buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        for (let i = 0; i < this.buffers.length; i++)
            device.destroyBuffer(this.buffers[i]);
    }
}

class ShapeInstance {
    public visible: boolean = true;

    constructor(private sepdData: SepdData, private materialInstance: MaterialInstance) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, boneMatrices: ReadonlyMat4[], viewMatrix: ReadonlyMat4, inverseBindPoseMatrices: ReadonlyMat4[]): void {
        if (!this.visible || !this.materialInstance.visible)
            return;

        const sepd = this.sepdData.sepd;

        const materialTemplate = renderInstManager.pushTemplate();
        materialTemplate.setVertexInput(this.sepdData.inputLayout, this.sepdData.vertexBufferDescriptors, this.sepdData.indexBufferDescriptor);
        this.materialInstance.setOnRenderInst(renderInstManager.gfxRenderCache, materialTemplate, viewMatrix);

        for (let i = 0; i < this.sepdData.sepd.prms.length; i++) {
            const prmsData = this.sepdData.prmsData[i];
            const prms = prmsData.prms;
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setDrawCount(prms.prm.count, prmsData.indexBufferOffset);

            let offs = renderInst.allocateUniformBuffer(DMPProgram.ub_PrmParams, 12*16+12 + 4);
            const prmParamsMapped = renderInst.mapUniformBufferF32(DMPProgram.ub_PrmParams);

            for (let i = 0; i < 16; i++) {
                if (i < prms.boneTable.length) {
                    const boneId = prms.boneTable[i];
                    if (prms.skinningMode === CMB.SkinningMode.SmoothSkinning) {
                        mat4.mul(scratchMatrix, boneMatrices[boneId], inverseBindPoseMatrices[boneId]);
                    } else {
                        mat4.copy(scratchMatrix, boneMatrices[boneId]);
                    }
                } else {
                    mat4.identity(scratchMatrix);
                }

                offs += fillMatrix4x3(prmParamsMapped, offs, scratchMatrix);
            }

            offs += fillMatrix4x3(prmParamsMapped, offs, viewMatrix);

            offs += fillVec4(prmParamsMapped, offs, sepd.boneDimension, this.sepdData.useVertexColor ? 1 : 0, this.sepdData.sepd.hasTangents ? 1 : 0);

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        //
    }
}

class TextureData {
    public gfxTexture: GfxTexture;

    constructor(cache: GfxRenderCache, texture: CMB.Texture) {
        assert(texture.levels.length > 0);
        const device = cache.device;

        const descriptor: GfxTextureDescriptor = {
            width: texture.width,
            height: texture.height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            dimension: texture.dimension,
            depthOrArrayLayers: texture.dimension === GfxTextureDimension.Cube ? 6 : 1,
            numLevels: texture.levels.length,
            usage: GfxTextureUsage.Sampled,
        };

        this.gfxTexture = device.createTexture(descriptor);
        device.setResourceName(this.gfxTexture, texture.name);
        device.uploadTextureData(this.gfxTexture, 0, texture.levels.map((level) => level.pixels));
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class CmabData {
    public textureData: TextureData[] = [];

    constructor(cache: GfxRenderCache, public cmab: CMAB.CMAB) {
        for (let i = 0; i < this.cmab.textures.length; i++)
            this.textureData.push(new TextureData(cache, this.cmab.textures[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
    }
}

export class CmbData {
    public textureData: TextureData[] = [];
    public sepdData: SepdData[] = [];
    public inverseBindPoseMatrices: mat4[] = [];

    constructor(cache: GfxRenderCache, public cmb: CMB.CMB) {
        const vatrChunk = cmb.vatrChunk;

        for (let i = 0; i < this.cmb.textures.length; i++)
            this.textureData.push(new TextureData(cache, this.cmb.textures[i]));

        for (let i = 0; i < this.cmb.sepds.length; i++)
            this.sepdData.push(new SepdData(cache, cmb.indexBuffer, vatrChunk, this.cmb.sepds[i]));

        const tempBones = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++) {
            const bone = cmb.bones[i];
            CSAB.calcBoneMatrix(tempBones[i], null, null, bone);
            if (bone.parentBoneId >= 0)
                mat4.mul(tempBones[i], tempBones[bone.parentBoneId], tempBones[i]);
        }

        this.inverseBindPoseMatrices = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++)
            mat4.invert(this.inverseBindPoseMatrices[i], tempBones[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.sepdData.length; i++)
            this.sepdData[i].destroy(device);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchViewMatrix = mat4.create();
export class CmbInstance {
    public animationController = new AnimationController();
    public visible: boolean = true;
    public materialInstances: MaterialInstance[] = [];
    public shapeInstances: ShapeInstance[] = [];
    private lutTexture: GfxTexture | null = null;

    public csab: CSAB.CSAB | null = null;
    public debugBones: boolean = false;
    public boneMatrices: mat4[] = [];
    public modelMatrix = mat4.create();
    public isSkybox = false;
    public passMask: number = 1;

    constructor(cache: GfxRenderCache, public cmbData: CmbData, public name: string = '') {
        if (this.cmbData.cmb.lutTexture) {
            const texture = this.cmbData.cmb.lutTexture;
            this.lutTexture = cache.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_R_NORM, texture.width, texture.height, 1));
            cache.device.uploadTextureData(this.lutTexture, 0, texture.levels.map((level) => level.pixels));
        }

        for (let i = 0; i < this.cmbData.cmb.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(cache, this.lutTexture, this.cmbData, this.cmbData.cmb.materials[i]));

        for (let i = 0; i < this.cmbData.cmb.meshs.length; i++) {
            const mesh = this.cmbData.cmb.meshs[i];
            this.shapeInstances.push(new ShapeInstance(this.cmbData.sepdData[mesh.sepdIdx], this.materialInstances[mesh.matsIdx]));
        }

        this.boneMatrices = nArray(this.cmbData.cmb.bones.length, () => mat4.create());
        this.updateBoneMatrices();
    }

    public setConstantColor(index: number, color: Color): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            colorCopy(this.materialInstances[i].constantColors[index], color);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMonochromeVertexColorsEnabled(v);
    }

    public setVertexNormalsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexNormalsEnabled(v);
    }

    public setUVEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setUVEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setEnvironmentSettings(environmentSettings);
    }

    public setVertexColorScale(n: number): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorScale(n);
    }

    public setRenderFog(isFogEnabled: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setRenderFog(isFogEnabled);
    }

    private updateBoneMatrices(): void {
        for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
            const bone = this.cmbData.cmb.bones[i];

            CSAB.calcBoneMatrix(this.boneMatrices[bone.boneId], this.animationController, this.csab, bone);

            const parentBoneMatrix = bone.parentBoneId >= 0 ? this.boneMatrices[bone.parentBoneId] : this.modelMatrix;
            mat4.mul(this.boneMatrices[bone.boneId], parentBoneMatrix, this.boneMatrices[bone.boneId]);
        }
    }

    private computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox)
            computeViewMatrixSkybox(dst, viewerInput.camera);
        else
            computeViewMatrix(dst, viewerInput.camera);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.computeViewMatrix(scratchViewMatrix, viewerInput);

        this.updateBoneMatrices();

        if (this.debugBones) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
                const bone = this.cmbData.cmb.bones[i];
                if (bone.parentBoneId < 0) continue;

                vec3.set(scratchVec3a, 0, 0, 0);
                vec3.transformMat4(scratchVec3a, scratchVec3a, this.boneMatrices[bone.parentBoneId]);
                vec3.set(scratchVec3b, 0, 0, 0);
                vec3.transformMat4(scratchVec3b, scratchVec3b, this.boneMatrices[bone.boneId]);

                drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b);
            }
        }

        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(device, renderInstManager, this.boneMatrices, scratchViewMatrix, this.cmbData.inverseBindPoseMatrices);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        if(this.lutTexture)
            device.destroyTexture(this.lutTexture);

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }

    public bindCSAB(csab: CSAB.CSAB | null): void {
        this.csab = csab;
    }

    public bindCMAB(cmab: CmabData, animationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCMAB(cmab, animationController);
    }
}

export class RoomRenderer {
    public visible: boolean = true;
    public opaqueData: CmbData | null = null;
    public opaqueMesh: CmbInstance | null = null;
    public transparentData: CmbData | null = null;
    public transparentMesh: CmbInstance | null = null;
    public objectRenderers: CmbInstance[] = [];
    public roomSetups: ZSI.ZSIRoomSetup[] = [];

    constructor(cache: GfxRenderCache, public version: ZSI.Version, public mesh: ZSI.Mesh, public name: string) {
        const device = cache.device;

        if (mesh.opaque !== null) {
            this.opaqueData = new CmbData(cache, mesh.opaque);
            this.opaqueMesh = new CmbInstance(cache, this.opaqueData, `${name} Opaque`);
            this.opaqueMesh.animationController.fps = 20;
            this.opaqueMesh.setConstantColor(1, TransparentBlack);
        }

        if (mesh.transparent !== null) {
            this.transparentData = new CmbData(cache, mesh.transparent);
            this.transparentMesh = new CmbInstance(cache, this.transparentData, `${name} Transparent`);
            this.transparentMesh.animationController.fps = 20;
            this.transparentMesh.setConstantColor(1, TransparentBlack);
        }
    }

    public bindCMAB(cmab: CmabData): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.bindCMAB(cmab);
        if (this.transparentMesh !== null)
            this.transparentMesh.bindCMAB(cmab);
    }

    public setVisible(visible: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVisible(visible);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVisible(visible);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVisible(visible);
    }

    public setVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setTexturesEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setTexturesEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setMonochromeVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setMonochromeVertexColorsEnabled(v);
    }

    public setShowVertexNormals(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexNormalsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexNormalsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexNormalsEnabled(v);
    }

    public setShowTextureCoordinates(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setUVEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setUVEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setUVEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        //(M-1): Temporary hack until I get kankyo implemented
        const envSettingsRoom = new ZSI.ZSIEnvironmentSettings();
        envSettingsRoom.copy(environmentSettings);

        if(this.version === ZSI.Version.Ocarina){
            envSettingsRoom.actorGlobalAmbient = envSettingsRoom.sceneGlobalAmbient;
            envSettingsRoom.lights[0].diffuse = OpaqueBlack;
            envSettingsRoom.lights[1].diffuse = OpaqueBlack;
            envSettingsRoom.lights[1].ambient = environmentSettings.lights[0].ambient;
        }
        else
            envSettingsRoom.actorGlobalAmbient = envSettingsRoom.sceneGlobalAmbient;

        if (this.opaqueMesh !== null)
            this.opaqueMesh.setEnvironmentSettings(envSettingsRoom);
        if (this.transparentMesh !== null)
            this.transparentMesh.setEnvironmentSettings(envSettingsRoom);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setEnvironmentSettings(environmentSettings);
    }

    public setRenderFog(isFogEnabled: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setRenderFog(isFogEnabled);
        if (this.transparentMesh !== null)
            this.transparentMesh.setRenderFog(isFogEnabled);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setRenderFog(isFogEnabled);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.opaqueMesh !== null)
            this.opaqueMesh.prepareToRender(device, renderInstManager, viewerInput);
        if (this.transparentMesh !== null)
            this.transparentMesh.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.opaqueData !== null)
            this.opaqueData.destroy(device);
        if (this.transparentData !== null)
            this.transparentData.destroy(device);
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(device);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}
