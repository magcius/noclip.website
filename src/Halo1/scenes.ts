import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4, fillVec3v, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxSampler, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode, GfxTextureDimension, GfxTextureUsage, GfxTextureDescriptor, GfxSamplerFormatKind } from '../gfx/platform/GfxPlatform';
import { FormatCompFlags, FormatTypeFlags, GfxFormat, makeFormat, setFormatCompFlags } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInst, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { DetailBitmapFunction, BitmapFormat, HaloSceneManager, HaloBSP, HaloLightmap, HaloMaterial, HaloShaderEnvironment, HaloBitmap, HaloBitmapMetadata, ShaderEnvironmentType, BitmapDataType } from '../../rust/pkg/index';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { FakeTextureHolder, TextureMapping } from '../TextureHolder';
import { decompressBC } from '../Common/bc_texture';
import { preprocessProgram_GLSL } from '../gfx/shaderc/GfxShaderCompiler';
import { CameraController } from '../Camera';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary';
import { UI } from '../ui';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { InputLayout } from '../DarkSouls/flver';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { getMatrixTranslation } from '../MathHelpers';

const P8Palette = [
    0xFF,0x7A,0x19,0xCC,0xFF,0x7E,0x19,0xCC,0xFF,0x80,0x19,0xCC,0xFF,0x81,0x19,0xCC,0xFF,0x85,0x19,0xCC,0xFF,0x74,0x2F,0xE2,0xFF,0x7A,0x2F,0xE2,0xFF,0x7E,0x2F,0xE2,0xFF,0x80,0x2F,0xE2,0xFF,0x81,0x2F,0xE2,0xFF,0x85,0x2F,0xE2,0xFF,0x8B,0x2F,0xE2,0xFF,0x6B,0x42,0xED,0xFF,0x74,0x42,0xEE,0xFF,0x7A,0x42,0xEF,0xFF,0x7E,0x42,0xEF,
    0xFF,0x80,0x42,0xEF,0xFF,0x81,0x42,0xEF,0xFF,0x85,0x42,0xEF,0xFF,0x8B,0x42,0xEE,0xFF,0x94,0x42,0xED,0xFF,0x60,0x52,0xF2,0xFF,0x6B,0x52,0xF5,0xFF,0x74,0x52,0xF6,0xFF,0x7A,0x52,0xF7,0xFF,0x7E,0x52,0xF7,0xFF,0x80,0x52,0xF7,0xFF,0x81,0x52,0xF7,0xFF,0x85,0x52,0xF7,0xFF,0x8B,0x52,0xF6,0xFF,0x94,0x52,0xF5,0xFF,0x9F,0x52,0xF2,
    0xFF,0x52,0x60,0xF2,0xFF,0x60,0x60,0xF7,0xFF,0x6B,0x60,0xF9,0xFF,0x74,0x60,0xFB,0xFF,0x7A,0x60,0xFB,0xFF,0x7E,0x60,0xFB,0xFF,0x80,0x60,0xFB,0xFF,0x81,0x60,0xFB,0xFF,0x85,0x60,0xFB,0xFF,0x8B,0x60,0xFB,0xFF,0x94,0x60,0xF9,0xFF,0x9F,0x60,0xF7,0xFF,0xAD,0x60,0xF2,0xFF,0x42,0x6B,0xED,0xFF,0x52,0x6B,0xF5,0xFF,0x60,0x6B,0xF9,
    0xFF,0x6B,0x6B,0xFC,0xFF,0x74,0x6B,0xFD,0xFF,0x7A,0x6B,0xFD,0xFF,0x7E,0x6B,0xFD,0xFF,0x80,0x6B,0xFD,0xFF,0x81,0x6B,0xFD,0xFF,0x85,0x6B,0xFD,0xFF,0x8B,0x6B,0xFD,0xFF,0x94,0x6B,0xFC,0xFF,0x9F,0x6B,0xF9,0xFF,0xAD,0x6B,0xF5,0xFF,0xBD,0x6B,0xED,0xFF,0x2F,0x74,0xE2,0xFF,0x42,0x74,0xEE,0xFF,0x52,0x74,0xF6,0xFF,0x60,0x74,0xFB,
    0xFF,0x6B,0x74,0xFD,0xFF,0x74,0x74,0xFE,0xFF,0x7A,0x74,0xFE,0xFF,0x7E,0x74,0xFE,0xFF,0x80,0x74,0xFE,0xFF,0x81,0x74,0xFE,0xFF,0x85,0x74,0xFE,0xFF,0x8B,0x74,0xFE,0xFF,0x94,0x74,0xFD,0xFF,0x9F,0x74,0xFB,0xFF,0xAD,0x74,0xF6,0xFF,0xBD,0x74,0xEE,0xFF,0xD0,0x74,0xE2,0xFF,0x19,0x7A,0xCC,0xFF,0x2F,0x7A,0xE2,0xFF,0x42,0x7A,0xEF,
    0xFF,0x52,0x7A,0xF7,0xFF,0x60,0x7A,0xFB,0xFF,0x6B,0x7A,0xFD,0xFF,0x74,0x7A,0xFE,0xFF,0x7A,0x7A,0xFF,0xFF,0x7E,0x7A,0xFF,0xFF,0x80,0x7A,0xFF,0xFF,0x81,0x7A,0xFF,0xFF,0x85,0x7A,0xFF,0xFF,0x8B,0x7A,0xFE,0xFF,0x94,0x7A,0xFD,0xFF,0x9F,0x7A,0xFB,0xFF,0xAD,0x7A,0xF7,0xFF,0xBD,0x7A,0xEF,0xFF,0xD0,0x7A,0xE2,0xFF,0xE5,0x7A,0xCC,
    0xFF,0x19,0x7E,0xCC,0xFF,0x2F,0x7E,0xE2,0xFF,0x42,0x7E,0xEF,0xFF,0x52,0x7E,0xF7,0xFF,0x60,0x7E,0xFB,0xFF,0x6B,0x7E,0xFD,0xFF,0x74,0x7E,0xFE,0xFF,0x7A,0x7E,0xFF,0xFF,0x7E,0x7E,0xFF,0xFF,0x80,0x7E,0xFF,0xFF,0x81,0x7E,0xFF,0xFF,0x85,0x7E,0xFF,0xFF,0x8B,0x7E,0xFE,0xFF,0x94,0x7E,0xFD,0xFF,0x9F,0x7E,0xFB,0xFF,0xAD,0x7E,0xF7,
    0xFF,0xBD,0x7E,0xEF,0xFF,0xD0,0x7E,0xE2,0xFF,0xE5,0x7E,0xCC,0xFF,0x19,0x80,0xCC,0xFF,0x2F,0x80,0xE2,0xFF,0x42,0x80,0xEF,0xFF,0x52,0x80,0xF7,0xFF,0x60,0x80,0xFB,0xFF,0x6B,0x80,0xFD,0xFF,0x74,0x80,0xFE,0xFF,0x7A,0x80,0xFF,0xFF,0x7E,0x80,0xFF,0xFF,0x80,0x80,0xFF,0xFF,0x81,0x80,0xFF,0xFF,0x85,0x80,0xFF,0xFF,0x8B,0x80,0xFE,
    0xFF,0x94,0x80,0xFD,0xFF,0x9F,0x80,0xFB,0xFF,0xAD,0x80,0xF7,0xFF,0xBD,0x80,0xEF,0xFF,0xD0,0x80,0xE2,0xFF,0xE5,0x80,0xCC,0xFF,0x19,0x81,0xCC,0xFF,0x2F,0x81,0xE2,0xFF,0x42,0x81,0xEF,0xFF,0x52,0x81,0xF7,0xFF,0x60,0x81,0xFB,0xFF,0x6B,0x81,0xFD,0xFF,0x74,0x81,0xFE,0xFF,0x7A,0x81,0xFF,0xFF,0x7E,0x81,0xFF,0xFF,0x80,0x81,0xFF,
    0xFF,0x81,0x81,0xFF,0xFF,0x85,0x81,0xFF,0xFF,0x8B,0x81,0xFE,0xFF,0x94,0x81,0xFD,0xFF,0x9F,0x81,0xFB,0xFF,0xAD,0x81,0xF7,0xFF,0xBD,0x81,0xEF,0xFF,0xD0,0x81,0xE2,0xFF,0xE5,0x81,0xCC,0xFF,0x19,0x85,0xCC,0xFF,0x2F,0x85,0xE2,0xFF,0x42,0x85,0xEF,0xFF,0x52,0x85,0xF7,0xFF,0x60,0x85,0xFB,0xFF,0x6B,0x85,0xFD,0xFF,0x74,0x85,0xFE,
    0xFF,0x7A,0x85,0xFF,0xFF,0x7E,0x85,0xFF,0xFF,0x80,0x85,0xFF,0xFF,0x81,0x85,0xFF,0xFF,0x85,0x85,0xFF,0xFF,0x8B,0x85,0xFE,0xFF,0x94,0x85,0xFD,0xFF,0x9F,0x85,0xFB,0xFF,0xAD,0x85,0xF7,0xFF,0xBD,0x85,0xEF,0xFF,0xD0,0x85,0xE2,0xFF,0xE5,0x85,0xCC,0xFF,0x2F,0x8B,0xE2,0xFF,0x42,0x8B,0xEE,0xFF,0x52,0x8B,0xF6,0xFF,0x60,0x8B,0xFB,
    0xFF,0x6B,0x8B,0xFD,0xFF,0x74,0x8B,0xFE,0xFF,0x7A,0x8B,0xFE,0xFF,0x7E,0x8B,0xFE,0xFF,0x80,0x8B,0xFE,0xFF,0x81,0x8B,0xFE,0xFF,0x85,0x8B,0xFE,0xFF,0x8B,0x8B,0xFE,0xFF,0x94,0x8B,0xFD,0xFF,0x9F,0x8B,0xFB,0xFF,0xAD,0x8B,0xF6,0xFF,0xBD,0x8B,0xEE,0xFF,0xD0,0x8B,0xE2,0xFF,0x42,0x94,0xED,0xFF,0x52,0x94,0xF5,0xFF,0x60,0x94,0xF9,
    0xFF,0x6B,0x94,0xFC,0xFF,0x74,0x94,0xFD,0xFF,0x7A,0x94,0xFD,0xFF,0x7E,0x94,0xFD,0xFF,0x80,0x94,0xFD,0xFF,0x81,0x94,0xFD,0xFF,0x85,0x94,0xFD,0xFF,0x8B,0x94,0xFD,0xFF,0x94,0x94,0xFC,0xFF,0x9F,0x94,0xF9,0xFF,0xAD,0x94,0xF5,0xFF,0xBD,0x94,0xED,0xFF,0x52,0x9F,0xF2,0xFF,0x60,0x9F,0xF7,0xFF,0x6B,0x9F,0xF9,0xFF,0x74,0x9F,0xFB,
    0xFF,0x7A,0x9F,0xFB,0xFF,0x7E,0x9F,0xFB,0xFF,0x80,0x9F,0xFB,0xFF,0x81,0x9F,0xFB,0xFF,0x85,0x9F,0xFB,0xFF,0x8B,0x9F,0xFB,0xFF,0x94,0x9F,0xF9,0xFF,0x9F,0x9F,0xF7,0xFF,0xAD,0x9F,0xF2,0xFF,0x60,0xAD,0xF2,0xFF,0x6B,0xAD,0xF5,0xFF,0x74,0xAD,0xF6,0xFF,0x7A,0xAD,0xF7,0xFF,0x7E,0xAD,0xF7,0xFF,0x80,0xAD,0xF7,0xFF,0x81,0xAD,0xF7,
    0xFF,0x85,0xAD,0xF7,0xFF,0x8B,0xAD,0xF6,0xFF,0x94,0xAD,0xF5,0xFF,0x9F,0xAD,0xF2,0xFF,0x6B,0xBD,0xED,0xFF,0x74,0xBD,0xEE,0xFF,0x7A,0xBD,0xEF,0xFF,0x7E,0xBD,0xEF,0xFF,0x80,0xBD,0xEF,0xFF,0x81,0xBD,0xEF,0xFF,0x85,0xBD,0xEF,0xFF,0x8B,0xBD,0xEE,0xFF,0x94,0xBD,0xED,0xFF,0x74,0xD0,0xE2,0xFF,0x7A,0xD0,0xE2,0xFF,0x7E,0xD0,0xE2,
    0xFF,0x80,0xD0,0xE2,0xFF,0x81,0xD0,0xE2,0xFF,0x85,0xD0,0xE2,0xFF,0x8B,0xD0,0xE2,0xFF,0x7A,0xE5,0xCC,0xFF,0x7E,0xE5,0xCC,0xFF,0x80,0xE5,0xCC,0xFF,0x81,0xE5,0xCC,0xFF,0x85,0xE5,0xCC,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x80,0x80,0xFF
];

function p8ToRGBA(p8: number): number[] {
    const offset = p8 * 4;
    return [
        P8Palette[offset + 1],
        P8Palette[offset + 2],
        P8Palette[offset + 3],
        P8Palette[offset + 0],
    ];
}

/**
 * notes:
 *   * blood gulch building doesn't seem to be loading primary/secondary/micro detail maps
 *   * mipmaps not working up to 8, seems to be invalid sized BC1 maps
 * 
 * todo:
 *   * models
 *     * skyboxes
 *     * scenery
 *   * bumpmaps
 *   * decals/glowing elements/purple textures
 */

export const noclipSpaceFromHaloSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);
export const haloSpaceFromNoclipSpace = mat4.fromValues(
    1,  0, 0, 0,
    0,  0, 1, 0,
    0, -1, 0, 0,
    0,  0, 0, 1,
);


let _wasm: typeof import('../../rust/pkg/index') | null = null;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../rust/pkg/index');
    }
    return _wasm;
}

class MaterialProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;
    public static ub_BSPParams = 2;
    public static ub_ShaderParams = 3;
    public static a_Pos = 0;
    public static a_Norm = 1;
    public static a_Binorm = 2;
    public static a_Tangent = 3;
    public static a_TexCoord = 4;
    public static a_IncidentLight = 5;
    public static a_LightmapTexCoord = 6;

    public static varying = `
varying vec2 v_UV;
varying vec2 v_lightmapUV;
varying vec3 v_Normal;
varying vec3 v_Binormal;
varying vec3 v_Tangent;
varying vec3 v_Position;
varying vec3 v_IncidentLight;
`;

    public static includes = `
${GfxShaderLibrary.saturate}
`;
    public static BindingsDefinition = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    vec3 u_PlayerPos;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_MaterialModel;
};

layout(std140) uniform ub_BSPParams {
    vec4 u_Misc;
};

layout(std140) uniform ub_ShaderParams {
    vec4 u_ReflectionPerpendicularColor;
    vec4 u_ReflectionParallelColor;
};

#define u_BSPIndex (u_Misc.x)

uniform sampler2D u_Texture;
uniform sampler2D u_Lightmap;
uniform sampler2D u_Bumpmap;
uniform sampler2D u_PrimaryDetailTexture;
uniform sampler2D u_SecondaryDetailTexture;
uniform sampler2D u_MicroDetailTexture;
uniform samplerCube u_ReflectionCubeMap;
`;
    public override vert = `
${MaterialProgram.BindingsDefinition}
${MaterialProgram.includes}
layout(location = ${MaterialProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${MaterialProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${MaterialProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${MaterialProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${MaterialProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${MaterialProgram.a_IncidentLight}) in vec3 a_IncidentLight;
layout(location = ${MaterialProgram.a_LightmapTexCoord}) in vec2 a_LightmapTexCoord;

${MaterialProgram.varying}

vec4 toWorldCoord(vec4 x) {
    return Mul(u_MaterialModel, x);
}

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, toWorldCoord(vec4(a_Position, 1.0))));
    v_UV = a_TexCoord;
    v_Normal = normalize(toWorldCoord(vec4(a_Normal.xyz, 0.0)).xyz);
    v_Binormal = normalize(toWorldCoord(vec4(a_Binormal.xyz, 0.0)).xyz);
    v_Tangent = normalize(toWorldCoord(vec4(a_Tangent.xyz, 0.0)).xyz);
    v_Position = toWorldCoord(vec4(a_Position.xyz, 1.0)).xyz;
    v_IncidentLight = a_IncidentLight;
    v_lightmapUV = a_LightmapTexCoord;
}
`;

    private fragHeader = `
${MaterialProgram.BindingsDefinition}
${MaterialProgram.includes}
${MaterialProgram.varying}
`;

    constructor(public shader: HaloShaderEnvironment | undefined, public has_lightmap: boolean) {
        super();
        this.generateFragmentShader();
    }

    private getDetailSection(fragBody: String[]): void {
        fragBody.push(`vec2 primaryUV = v_UV * ${this.shader!.primary_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`vec4 primaryDetail = texture(SAMPLER_2D(u_PrimaryDetailTexture), primaryUV);`)
        fragBody.push(`vec2 secondaryUV = v_UV * ${this.shader!.secondary_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`vec4 secondaryDetail = texture(SAMPLER_2D(u_SecondaryDetailTexture), secondaryUV);`)
        switch (this.shader!.shader_environment_type) {
            case _wasm!.ShaderEnvironmentType.Normal:
                fragBody.push(`vec4 blendedDetail = mix(primaryDetail, secondaryDetail, secondaryDetail.a);`)
                break;
            case _wasm!.ShaderEnvironmentType.Blended:
            case _wasm!.ShaderEnvironmentType.BlendedBaseSpecular:
                fragBody.push(`vec4 blendedDetail = mix(primaryDetail, secondaryDetail, color.a);`);
                break;
            default:
                throw new Error(`don't recognize ShaderEnvironmentType ${this.shader!.shader_environment_type}`);
        }
        
        if (this.shader!.has_primary_detail_bitmap) {
            switch (this.shader!.detail_bitmap_function) {
                case _wasm!.DetailBitmapFunction.DoubleBiasedMultiply:
                    fragBody.push(`color.rgb = saturate(2.0 * color.rgb * blendedDetail.rgb);`);
                    break;
                case _wasm!.DetailBitmapFunction.Multiply:
                    fragBody.push(`color.rgb = saturate(color.rgb * blendedDetail.rgb);`);
                    break;
                case _wasm!.DetailBitmapFunction.DoubleBiasedAdd:
                    fragBody.push(`color.rgb = saturate(color.rgb + 2.0 * blendedDetail.rgb - 1.0);`);
                    break;
                default:
                    throw new Error(`don't recognize DetailBitmapFunction ${this.shader!.detail_bitmap_function}`)
            }
        }
    }

    private getMicroDetailSection(fragBody: String[]): void {
        fragBody.push(`vec2 microUV = v_UV * ${this.shader!.micro_detail_bitmap_scale.toFixed(2)};`)
        fragBody.push(`vec4 microDetail = texture(SAMPLER_2D(u_MicroDetailTexture), microUV);`)
        switch (this.shader!.shader_environment_type) {
            case _wasm!.ShaderEnvironmentType.Normal:
            case _wasm!.ShaderEnvironmentType.Blended:
                fragBody.push(`float specularReflectionMask = blendedDetail.a * microDetail.a;`)
                break;
            case _wasm!.ShaderEnvironmentType.BlendedBaseSpecular:
                fragBody.push(`float specularReflectionMask = base.a * microDetail.a;`)
                break;
            default:
                throw new Error(`don't recognize ShaderEnvironmentType ${this.shader!.shader_environment_type}`);
        }
        
        if (this.shader!.has_micro_detail_bitmap) {
            switch (this.shader!.detail_bitmap_function) {
                case _wasm!.DetailBitmapFunction.DoubleBiasedMultiply:
                    fragBody.push(`color.rgb = saturate(2.0 * color.rgb  * microDetail.rgb);`)
                    break;
                case _wasm!.DetailBitmapFunction.Multiply:
                    fragBody.push(`color.rgb = saturate(color.rgb * microDetail.rgb);`)
                    break;
                case _wasm!.DetailBitmapFunction.DoubleBiasedAdd:
                    fragBody.push(`color.rgb = saturate(color.rgb + 2.0 * microDetail.rgb - 1.0);`)
                    break;
                default:
                    throw new Error(`don't recognize DetailBitmapFunction ${this.shader!.detail_bitmap_function}`)
            }
        }
    }

    private getReflectionSection(fragBody: String[]): void {
        fragBody.push(`
vec2 bumpUV = v_UV * ${this.shader!.bump_map_scale.toFixed(2)};
vec4 t_BumpMap = 2.0 * texture(SAMPLER_2D(u_Bumpmap), bumpUV) - 1.0;
vec3 E = normalize(u_PlayerPos - v_Position);
vec3 N;
`);

        if (this.shader!.has_bump_map) {
            fragBody.push(`N = normalize(v_Tangent * t_BumpMap.r + v_Binormal * t_BumpMap.g + v_Normal * t_BumpMap.b);`);
        } else {
            fragBody.push(`N = v_Normal;`)
        }
        fragBody.push(`
N = normalize(2.0 * dot(N, E) * N - E);
vec3 reflectionColor = texture(SAMPLER_CUBE(u_ReflectionCubeMap, N.xyz)).xyz;
vec3 specularColor = pow(reflectionColor, vec3(8.0, 8.0, 8.0));
float diffuseReflection = pow(dot(N, E), 2.0);
float attenuation = mix(u_ReflectionParallelColor.a, u_ReflectionPerpendicularColor.a, diffuseReflection);
vec3 tintColor = mix(u_ReflectionParallelColor.rgb, u_ReflectionPerpendicularColor.rgb, diffuseReflection);
vec3 tintedReflection = mix(specularColor, reflectionColor, tintColor);
vec3 finalColor = tintedReflection * attenuation;
color.rgb = saturate(color.rgb + finalColor * 0.1); // FIXME specular reflection mask seems to always be 0?
`);
    }

    private generateFragmentShader(): void {
        let fragBody = [];
        if (this.shader) {
            fragBody.push(`vec4 base = texture(SAMPLER_2D(u_Texture), v_UV);`);
            fragBody.push(`vec4 color = base;`);
            if (this.has_lightmap) {
                fragBody.push(`color.rgb *= texture(SAMPLER_2D(u_Lightmap), v_lightmapUV).rgb;`)
            }
            this.getDetailSection(fragBody);
            this.getMicroDetailSection(fragBody);
            if (this.shader!.has_reflection_cube_map) {
                this.getReflectionSection(fragBody);
            }
        } else {
            fragBody.push(`vec4 color = vec4(1.0, 0.0, 1.0, 1.0);`);
        }
        fragBody.push(`gl_FragDepth = gl_FragCoord.z + 1e-6 * u_BSPIndex;`);
        fragBody.push(`gl_FragColor = vec4(color.rgb, 1.0);`);
        this.frag = `
${this.fragHeader}
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmaps: HaloLightmap[];
    public materialRenderers: MaterialRenderer[];

    constructor(public device: GfxDevice, public gfxSampler: GfxSampler, public bsp: HaloBSP, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager, public bspIndex: number) {
        this.trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        this.lightmaps = mgr.get_bsp_lightmaps(this.bsp);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.materialRenderers = this.lightmaps.flatMap(lightmap => {
            let lightmapTex: TextureMapping;
            if (lightmapsBitmap && lightmap.get_bitmap_index() !== 65535) {
                lightmapTex = makeTexture(this.device, this.gfxSampler, lightmapsBitmap!, this.mgr, lightmap.get_bitmap_index());
            }
            return mgr.get_lightmap_materials(lightmap).map(material => {
                return new MaterialRenderer(this.device, this.gfxSampler, material, this.inputLayout, this.modelMatrix, this.mgr, this.bsp, this.trisBuf, lightmapTex!);
            });
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.materialRenderers.forEach(m => m.prepareToRender(renderInstManager, viewerInput));
    }

    public destroy(device: GfxDevice) {
        this.materialRenderers.forEach(m => m.destroy(device));
        device.destroyBuffer(this.trisBuf);
    }
}

class MaterialRenderer {
    public vertsBuf: GfxBuffer;
    public lightmapVertsBuf: GfxBuffer;
    public inputState: GfxInputState;
    public textureMapping: TextureMapping | null;
    public bumpMapping: TextureMapping | null;
    public primaryDetailMapping: TextureMapping | null;
    public secondaryDetailMapping: TextureMapping | null;
    public microDetailMapping: TextureMapping | null;
    public reflectionCubeMapping: TextureMapping | null;
    public program: GfxProgram;
    public shader: HaloShaderEnvironment | undefined;

    constructor(device: GfxDevice, public gfxSampler: GfxSampler, public material: HaloMaterial, public inputLayout: GfxInputLayout, public modelMatrix: mat4, public mgr: HaloSceneManager, public bsp: HaloBSP, public trisBuf: GfxBuffer, public lightmapMapping: TextureMapping | null) {
        this.vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_vertex_data(this.material, this.bsp).buffer);
        this.lightmapVertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_lightmap_data(this.material, this.bsp).buffer);
        this.shader = mgr.get_material_shader(this.material);
        if (this.shader) {
            this.textureMapping = makeTexture(device, this.gfxSampler, this.shader.get_base_bitmap(), this.mgr);
            const bumpmap = this.shader.get_bump_map();
            if (bumpmap) {
                this.bumpMapping = makeTexture(device, this.gfxSampler, bumpmap, this.mgr);
            }
            const primaryDetailBitmap = this.shader.get_primary_detail_bitmap();
            if (primaryDetailBitmap) {
                this.primaryDetailMapping = makeTexture(device, this.gfxSampler, primaryDetailBitmap, this.mgr);
            }
            const secondaryDetailBitmap = this.shader.get_secondary_detail_bitmap();
            if (secondaryDetailBitmap) {
                this.secondaryDetailMapping = makeTexture(device, this.gfxSampler, secondaryDetailBitmap, this.mgr);
            }
            const microDetailBitmap = this.shader.get_micro_detail_bitmap();
            if (microDetailBitmap) {
                this.microDetailMapping = makeTexture(device, this.gfxSampler, microDetailBitmap, this.mgr);
            }
            const reflectionCubeMap = this.shader.get_reflection_cube_map();
            if (reflectionCubeMap) {
                this.reflectionCubeMapping = makeTexture(device, this.gfxSampler, reflectionCubeMap, this.mgr);
            }
        }
        const renderHelper = new GfxRenderHelper(device);
        this.program = renderHelper.renderCache.createProgram(new MaterialProgram(this.shader, !!this.lightmapMapping));

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertsBuf, byteOffset: 0 },
            { buffer: this.lightmapVertsBuf, byteOffset: 0 },
        ], { buffer: this.trisBuf, byteOffset: 0 })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(MaterialProgram.ub_ShaderParams, 2 * 12);
        const mapped = template.mapUniformBufferF32(MaterialProgram.ub_ShaderParams);
        if (this.shader) {
            const perpendicular = this.shader.perpendicular_color;
            offs += fillVec4(mapped, offs, perpendicular.r, perpendicular.g, perpendicular.b, this.shader.perpendicular_brightness);
            const parallel = this.shader.parallel_color;
            offs += fillVec4(mapped, offs, parallel.r, parallel.g, parallel.b, this.shader.parallel_brightness);
        }

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.program);
        renderInst.setSamplerBindingsFromTextureMappings([
            this.textureMapping,
            this.lightmapMapping,
            this.bumpMapping,
            this.primaryDetailMapping,
            this.secondaryDetailMapping,
            this.microDetailMapping,
            this.reflectionCubeMapping,
        ])
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.material.get_num_indices(), this.material.get_index_offset());
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertsBuf);
        device.destroyInputState(this.inputState);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 4, numSamplers: 7, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 0
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 1
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 2
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 3
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 4
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 5
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, },// 6
    ] },
];

function getImageFormatBPP(fmt: GfxFormat): number {
    switch (fmt) {
        case GfxFormat.U8_RGBA_NORM: return 4;
        case GfxFormat.U16_RGB_565: return 2;
        default:
            throw new Error(`don't recognize format ${GfxFormat[fmt]}`);
    }
}

function isimageFormatCompressed(format: GfxFormat): boolean {
    return format === GfxFormat.BC1 || format === GfxFormat.BC2 || format === GfxFormat.BC3;
}

function getBitmapTextureFormat(format: BitmapFormat): GfxFormat {
    switch (format) {
        case _wasm!.BitmapFormat.Dxt1: return GfxFormat.BC1;
        case _wasm!.BitmapFormat.Dxt3: return GfxFormat.BC2;
        case _wasm!.BitmapFormat.Dxt5: return GfxFormat.BC3;
        case _wasm!.BitmapFormat.X8r8g8b8: return GfxFormat.U8_RGBA_NORM;
        case _wasm!.BitmapFormat.A8r8g8b8: return GfxFormat.U8_RGBA_NORM;
        case _wasm!.BitmapFormat.R5g6b5: return GfxFormat.U16_RGB_565;
        case _wasm!.BitmapFormat.P8: return GfxFormat.U8_RGBA_NORM;
        case _wasm!.BitmapFormat.P8Bump: return GfxFormat.U8_RGBA_NORM;
        default:
            throw new Error(`couldn't recognize bitmap format ${_wasm!.BitmapFormat[format]}`);
    }
}

function getImageFormatByteLength(fmt: GfxFormat, width: number, height: number, depth = 1): number {
    if (isimageFormatCompressed(fmt)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16) * depth;
        if (fmt === GfxFormat.BC1)
            return count * 8;
        else if (fmt === GfxFormat.BC2)
            return count * 16;
        else if (fmt === GfxFormat.BC3)
            return count * 16;
        else
            throw new Error(`unrecognized compressed format ${GfxFormat[fmt]}`)
    } else {
        return (width * height * depth) * getImageFormatBPP(fmt);
    }
}

function getBitmapByteLength(metadata: HaloBitmapMetadata, mipLevel = 0, depth = 1): number {
    let width = Math.max(metadata.width / 2 ** mipLevel, 4);
    let height = Math.max(metadata.height / 2 ** mipLevel, 4);
    const format = getBitmapTextureFormat(metadata.format);
    return getImageFormatByteLength(format, width, height, depth);
}

function convertP8Data(p8Data: Uint8Array): Uint8Array {
    const result = new Uint8Array(p8Data.byteLength * 4);
    for (let i=0; i<p8Data.byteLength; i++) {
        let [r, g, b, a] = p8ToRGBA(p8Data[i]);
        result[4*i+0] = r;
        result[4*i+1] = g;
        result[4*i+2] = b;
        result[4*i+3] = a;
    }
    return result;
}

function getAndConvertBitmap(mgr: HaloSceneManager, bitmap: HaloBitmap, submap = 0): [HaloBitmapMetadata, Uint8Array] {
    const bitmapMetadata = bitmap.get_metadata_for_index(submap);
    let bitmapData = mgr.get_bitmap_data(bitmap, submap);
    if (bitmapMetadata.format === _wasm!.BitmapFormat.P8 || bitmapMetadata.format === _wasm!.BitmapFormat.P8Bump) {
        bitmapData = convertP8Data(bitmapData);
    }
    return [bitmapMetadata, bitmapData];
}

function makeTexture(device: GfxDevice, gfxSampler: GfxSampler, bitmap: HaloBitmap, mgr: HaloSceneManager, submap = 0): TextureMapping {
    const [bitmapMetadata, bitmapData] = getAndConvertBitmap(mgr, bitmap, submap);
    const format = getBitmapTextureFormat(bitmapMetadata.format);
    const mipmapCount = Math.max(bitmapMetadata.mipmap_count, 1);
    let textureDescriptor: GfxTextureDescriptor;
    if (bitmapMetadata.bitmap_type === _wasm!.BitmapDataType.CubeMap) {
        textureDescriptor = {
            dimension: GfxTextureDimension.Cube,
            pixelFormat: format,
            width: bitmapMetadata.width,
            height: bitmapMetadata.height,
            numLevels: mipmapCount,
            depth: 6,
            usage: GfxTextureUsage.Sampled,
        };
    } else {
        textureDescriptor = makeTextureDescriptor2D(format, bitmapMetadata.width, bitmapMetadata.height, mipmapCount);
    }
    const texture = device.createTexture(textureDescriptor!);
    const mips = [];
    let offset = 0;
    for (let i=0; i<mipmapCount; i++) {
        let length = getBitmapByteLength(bitmapMetadata, i, textureDescriptor.depth);
        if (format === GfxFormat.U16_RGB_565) {
            const u16buf = new Uint16Array(bitmapData.buffer);
            mips.push(u16buf.subarray(offset, offset + length/2));
            offset += length/2;
        } else {
            mips.push(bitmapData.subarray(offset, offset + length));
            offset += length;
        }
    }
    device.uploadTextureData(texture, 0, mips);
    const mapping = new TextureMapping();
    mapping.gfxSampler = gfxSampler;
    mapping.gfxTexture = texture;
    return mapping
}

class HaloScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public inputLayout: GfxInputLayout;
    public modelMatrix: mat4;
    public gfxSampler: GfxSampler;
    public bspRenderers: BSPRenderer[];

    constructor(public device: GfxDevice, public mgr: HaloSceneManager) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        const cache = new GfxRenderCache(this.device);
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.modelMatrix = mat4.create();
        const scaling = 30;
        mat4.scale(this.modelMatrix, this.modelMatrix, vec3.fromValues(scaling, scaling, scaling));

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Pos, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Norm, bufferIndex: 0, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Binorm, bufferIndex: 0, bufferByteOffset: 2 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_Tangent, bufferIndex: 0, bufferByteOffset: 3 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 4 * vec3fSize, format: GfxFormat.F32_RG});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_IncidentLight, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: MaterialProgram.a_LightmapTexCoord, bufferIndex: 1, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RG});
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        let indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(5/100);
    }

    addBSP(bsp: HaloBSP, bspIndex: number) {
        this.bspRenderers.push(new BSPRenderer(this.device, this.gfxSampler, bsp, this.inputLayout, this.modelMatrix, this.mgr, bspIndex));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_SceneParams, 32 + 12);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_SceneParams);
            offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
            const view = mat4.create();
            mat4.mul(view, viewerInput.camera.viewMatrix, noclipSpaceFromHaloSpace);
            offs += fillMatrix4x4(mapped, offs, view);
            const cameraPos = vec3.create();
            mat4.invert(view, view);
            getMatrixTranslation(cameraPos, view);
            offs += fillVec3v(mapped, offs, cameraPos);
        }
        {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_ShapeParams, 16);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_ShapeParams);
            offs += fillMatrix4x4(mapped, offs, this.modelMatrix);
        }

        this.bspRenderers.forEach((r, i) => {
            let offs = template.allocateUniformBuffer(MaterialProgram.ub_BSPParams, 16);
            const mapped = template.mapUniformBufferF32(MaterialProgram.ub_BSPParams);
            offs += fillVec4(mapped, offs, i, i, i, i);
            r.prepareToRender(this.renderHelper.renderInstManager, viewerInput)
        })

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

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

    public destroy(device: GfxDevice) {
        device.destroyInputLayout(this.inputLayout);
        this.bspRenderers.forEach(r => r.destroy(device));
        this.renderHelper.destroy();
    }
}

class HaloSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const wasm = await loadWasm();
        wasm.init_panic_hook();
        const dataFetcher = context.dataFetcher;
        const resourceMapData = await dataFetcher.fetchData("halo/bitmaps.map");
        const mapData = await dataFetcher.fetchData(`halo/${this.id}.map`);
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array), resourceMapData.createTypedArray(Uint8Array));
        const renderer = new HaloScene(device, mapManager);
        mapManager.get_bsps().forEach((bsp, i) => renderer.addBSP(bsp, i));
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    new HaloSceneDesc("bloodgulch", "Blood Gulch"),
    new HaloSceneDesc("beavercreek", "beavercreek"),
    new HaloSceneDesc("boardingaction", "boardingaction"),
    new HaloSceneDesc("carousel", "carousel"),
    new HaloSceneDesc("chillout", "chillout"),
    new HaloSceneDesc("damnation", "damnation"),
    new HaloSceneDesc("dangercanyon", "dangercanyon"),
    new HaloSceneDesc("deathisland", "deathisland"),
    new HaloSceneDesc("gephyrophobia", "gephyrophobia"),
    new HaloSceneDesc("hangemhigh", "hangemhigh"),
    new HaloSceneDesc("icefields", "icefields"),
    new HaloSceneDesc("infinity", "infinity"),
    new HaloSceneDesc("longest", "longest"),
    new HaloSceneDesc("prisoner", "prisoner"),
    new HaloSceneDesc("putput", "putput"),
    new HaloSceneDesc("ratrace", "ratrace"),
    new HaloSceneDesc("sidewinder", "sidewinder"),
    new HaloSceneDesc("timberland", "timberland"),
    new HaloSceneDesc("wizard", "wizard"),
    new HaloSceneDesc("a10", "a10"),
    new HaloSceneDesc("a30", "a30"),
    new HaloSceneDesc("a50", "a50"),
    new HaloSceneDesc("b30", "b30"),
    new HaloSceneDesc("b40", "b40"),
    new HaloSceneDesc("c10", "c10"),
    new HaloSceneDesc("c20", "c20"),
    new HaloSceneDesc("c40", "c40"),
    new HaloSceneDesc("d20", "d20"),
    new HaloSceneDesc("d40", "d40"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };