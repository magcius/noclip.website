import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxDevice, makeTextureDescriptor2D, GfxBuffer, GfxInputState, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxCullMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode, GfxTextureDimension, GfxTextureUsage, GfxTextureDescriptor, GfxSamplerFormatKind, GfxProgramDescriptor, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { FormatCompFlags, FormatTypeFlags, GfxFormat, makeFormat, setFormatCompFlags } from "../gfx/platform/GfxPlatformFormat";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderInst, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { DetailBitmapFunction, BitmapFormat, HaloSceneManager, HaloBSP, HaloLightmap, HaloMaterial, HaloShaderEnvironment, HaloBitmap, HaloBitmapMetadata, ShaderEnvironmentType, BitmapDataType, HaloSceneryInstance, HaloScenery, HaloModel, HaloShaderModel, HaloModelPart, HaloShaderTransparencyGeneric, HaloShaderTransparencyChicago, HaloSky } from '../../rust/pkg/index';
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
import { TextureCache }  from './tex';
import { assert } from '../util';
import { GfxTopology, convertToTriangleIndexBuffer } from '../gfx/helpers/TopologyHelpers';
import { Texture } from 'librw';


/**
 * notes:
 *   * mipmaps not working up to 8, seems to be invalid sized BC1 maps
 * 
 * todo:
 *   * models
 *     * skyboxes
 *   * decals/glowing elements/purple textures
 *   * garbage collection
 *   * implement some kinda tag cache (for textures mostly)
 *   * implement default textures based on globals.globals (to fix specular reflection)
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

export function wasm() {
    assert(_wasm !== null);
    return _wasm!;
}

class BaseProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_BSPParams = 2;

    public static u_Texture = 0;
    public static u_Lightmap = 1;
    public static u_Bumpmap = 2;
    public static u_PrimaryDetailTexture = 3;
    public static u_SecondaryDetailTexture = 4;
    public static u_MicroDetailTexture = 5;
    public static u_ReflectionCubeMap = 6;
    public static u_MultipurposeMap = 7;

    public static common = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    vec3 u_PlayerPos;
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
};

layout(binding = ${BaseProgram.u_Texture}) uniform sampler2D u_Texture;
layout(binding = ${BaseProgram.u_Lightmap}) uniform sampler2D u_Lightmap;
layout(binding = ${BaseProgram.u_Bumpmap}) uniform sampler2D u_Bumpmap;
layout(binding = ${BaseProgram.u_PrimaryDetailTexture}) uniform sampler2D u_PrimaryDetailTexture;
layout(binding = ${BaseProgram.u_SecondaryDetailTexture}) uniform sampler2D u_SecondaryDetailTexture;
layout(binding = ${BaseProgram.u_MicroDetailTexture}) uniform sampler2D u_MicroDetailTexture;
layout(binding = ${BaseProgram.u_ReflectionCubeMap}) uniform samplerCube u_ReflectionCubeMap;
layout(binding = ${BaseProgram.u_MultipurposeMap}) uniform sampler2D u_MultipurposeMap;
`;
}

class BaseShaderProgram extends BaseProgram {
    public static ub_ShaderParams = 2;

    public static a_Pos = 0;
    public static a_Norm = 1;
    public static a_Binorm = 2;
    public static a_Tangent = 3;
    public static a_TexCoord = 4;

    public static varying = `
varying vec2 v_UV;
varying vec3 v_Normal;
varying vec3 v_Binormal;
varying vec3 v_Tangent;
varying vec3 v_Position;
`;

    public static includes = `
${GfxShaderLibrary.saturate}
`;

    public static header = `
${BaseProgram.common}
${BaseShaderProgram.includes}
${BaseShaderProgram.varying}
`;

    public override vert = `
${BaseShaderProgram.header}
layout(location = ${BaseShaderProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${BaseShaderProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${BaseShaderProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${BaseShaderProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${BaseShaderProgram.a_TexCoord}) in vec2 a_TexCoord;

vec4 toWorldCoord(vec4 x) {
    return Mul(u_ModelMatrix, x);
}

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, toWorldCoord(vec4(a_Position, 1.0))));
    v_UV = a_TexCoord;
    v_Normal = normalize(toWorldCoord(vec4(a_Normal.xyz, 0.0)).xyz);
    v_Binormal = normalize(toWorldCoord(vec4(a_Binormal.xyz, 0.0)).xyz);
    v_Tangent = normalize(toWorldCoord(vec4(a_Tangent.xyz, 0.0)).xyz);
    v_Position = toWorldCoord(vec4(a_Position.xyz, 1.0)).xyz;
}
`;

    public override frag = `
${BaseShaderProgram.header}

void mainPS() {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}
`;
}

class ShaderTransparencyGenericProgram extends BaseShaderProgram {
    constructor(public shader: HaloShaderTransparencyChicago) {
        super()
        //this.frag = this.generateFragSection();
    }

    private generateFragSection(): string {
        const fragBody: string[] = [
            `vec4 t0 = texture(SAMPLER_2D(u_Texture), u_UV);`,
            `vec4 t1 = texture(SAMPLER_2D(u_Lightmap), u_UV);`,
            `vec4 t2 = texture(SAMPLER_2D(u_Bumpmap), u_UV);`,
            `vec4 t3 = texture(SAMPLER_2D(u_PrimaryDetailTexture), u_UV);`,
        ];

        if (this.shader.first_map_type !== _wasm!.ShaderTransparentGenericMapType.Map2D) {
            console.log('cube!!!');
        }

        return `
${BaseShaderProgram.header}

void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class ShaderTransparencyChicagoProgram extends BaseShaderProgram {
    constructor(public shader: HaloShaderTransparencyChicago) {
        super()
    }
}

class ShaderModelProgram extends BaseProgram {
    public static ub_ShaderParams = 2;

    public static a_Pos = 0;
    public static a_Norm = 1;
    public static a_Binorm = 2;
    public static a_Tangent = 3;
    public static a_TexCoord = 4;

    public static varying = `
varying vec2 v_UV;
varying vec3 v_Normal;
varying vec3 v_Binormal;
varying vec3 v_Tangent;
varying vec3 v_Position;
`;

    public static includes = `
${GfxShaderLibrary.saturate}
`;

    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    vec4 empty;
};
`;

    public static header = `
${BaseProgram.common}
${ShaderModelProgram.BindingsDefinition}
${ShaderModelProgram.includes}
${ShaderModelProgram.varying}
`;

    constructor(shader: HaloShaderModel) {
        super();
        this.frag = this.generateFragSection();
    }

    public override vert = `
${ShaderModelProgram.header}
layout(location = ${ShaderModelProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${ShaderModelProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${ShaderModelProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${ShaderModelProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${ShaderModelProgram.a_TexCoord}) in vec2 a_TexCoord;

vec4 toWorldCoord(vec4 x) {
    return Mul(u_ModelMatrix, x);
}

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, toWorldCoord(vec4(a_Position, 1.0))));
    v_UV = a_TexCoord;
    v_Normal = normalize(toWorldCoord(vec4(a_Normal.xyz, 0.0)).xyz);
    v_Binormal = normalize(toWorldCoord(vec4(a_Binormal.xyz, 0.0)).xyz);
    v_Tangent = normalize(toWorldCoord(vec4(a_Tangent.xyz, 0.0)).xyz);
    v_Position = toWorldCoord(vec4(a_Position.xyz, 1.0)).xyz;
}
`;

    private generateFragSection(): string {
        const fragBody: string[] = [];

        fragBody.push(`gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture), v_UV).rgb;`)

        return `
${ShaderModelProgram.header}

void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class ShaderEnvironmentProgram extends BaseProgram {
    public static ub_ShaderParams = 2;

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
layout(std140) uniform ub_ShaderParams {
    vec4 u_ReflectionPerpendicularColor;
    vec4 u_ReflectionParallelColor;
    vec4 u_Misc;
};

#define u_BSPIndex (u_Misc.x)
`;

    public static header = `
${BaseProgram.common}
${ShaderEnvironmentProgram.BindingsDefinition}
${ShaderEnvironmentProgram.includes}
${ShaderEnvironmentProgram.varying}
`;

    public override vert = `
${ShaderEnvironmentProgram.header}
layout(location = ${ShaderEnvironmentProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${ShaderEnvironmentProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${ShaderEnvironmentProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${ShaderEnvironmentProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${ShaderEnvironmentProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${ShaderEnvironmentProgram.a_IncidentLight}) in vec3 a_IncidentLight;
layout(location = ${ShaderEnvironmentProgram.a_LightmapTexCoord}) in vec2 a_LightmapTexCoord;

vec4 toWorldCoord(vec4 x) {
    return Mul(u_ModelMatrix, x);
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
                fragBody.push(`vec4 blendedDetail = mix(secondaryDetail, primaryDetail, secondaryDetail.a);`)
                break;
            case _wasm!.ShaderEnvironmentType.Blended:
            case _wasm!.ShaderEnvironmentType.BlendedBaseSpecular:
                fragBody.push(`vec4 blendedDetail = mix(secondaryDetail, primaryDetail, color.a);`);
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
                fragBody.push(`float specularReflectionMask = blendedDetail.a * base.a * microDetail.a;`)
                break;
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
vec3 specularColor = pow(reflectionColor, vec3(8.0));
float diffuseReflection = pow(dot(N, E), 2.0);
float attenuation = mix(u_ReflectionParallelColor.a, u_ReflectionPerpendicularColor.a, diffuseReflection);
vec3 tintColor = mix(u_ReflectionParallelColor.rgb, u_ReflectionPerpendicularColor.rgb, diffuseReflection);
vec3 tintedReflection = mix(specularColor, reflectionColor, tintColor);
vec3 finalColor = tintedReflection * attenuation;
color.rgb = saturate(color.rgb + finalColor * specularReflectionMask);
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
${ShaderEnvironmentProgram.header}
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class LightmapRenderer {
    public lightmapMaterialRenderers: LightmapMaterialRenderer[];
    public inputLayout: GfxInputLayout;
    constructor(public device: GfxDevice, public textureCache: TextureCache, public trisBuf: GfxBuffer, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number, public lightmap: HaloLightmap, public lightmapTex: TextureMapping | undefined) {
        this.inputLayout = this.getInputLayout();
        this.lightmapMaterialRenderers = mgr.get_lightmap_materials(lightmap).map(material => {
            return new LightmapMaterialRenderer(this.device, this.textureCache, material, this.inputLayout, this.mgr, this.bsp, this.trisBuf, lightmapTex!, this.bspIndex);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.lightmapMaterialRenderers.forEach(r => r.prepareToRender(renderInstManager, viewerInput));
    }

    public destroy(device: GfxDevice) {
        this.lightmapMaterialRenderers.forEach(r => r.destroy(device));
        device.destroyInputLayout(this.inputLayout);
    }

    private getInputLayout(): GfxInputLayout {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const vec3fSize = 3 * 4;
        const vec2fSize = 2 * 4;
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_Pos, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_Norm, bufferIndex: 0, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_Binorm, bufferIndex: 0, bufferByteOffset: 2 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_Tangent, bufferIndex: 0, bufferByteOffset: 3 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 4 * vec3fSize, format: GfxFormat.F32_RG});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_IncidentLight, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderEnvironmentProgram.a_LightmapTexCoord, bufferIndex: 1, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RG});
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: vec3fSize + vec2fSize, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        let indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        return this.device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }
}

class ModelRenderer {
    public inputLayout: GfxInputLayout;
    // per shader
    public shaders: (HaloShaderModel | HaloShaderTransparencyGeneric | HaloShaderTransparencyChicago | null)[];
    public programs: (GfxProgram | null)[];
    public textureMappings: (TextureMapping | null)[][];
    public shaderParams: Float32Array[];

    // per part
    public parts: HaloModelPart[];
    public inputStates: GfxInputState[];

    private setupShaderTransparencyChicago(shader: HaloShaderTransparencyChicago, renderHelper: GfxRenderHelper) {
        this.textureMappings.push([
            this.textureCache.getTextureMapping(shader.get_bitmap(0)),
            this.textureCache.getTextureMapping(shader.get_bitmap(1)),
            this.textureCache.getTextureMapping(shader.get_bitmap(2)),
            this.textureCache.getTextureMapping(shader.get_bitmap(3)),
        ]);
        this.programs.push(renderHelper.renderCache.createProgram(new ShaderTransparencyChicagoProgram(shader)));
    }

    private setupShaderTransparencyGeneric(shader: HaloShaderTransparencyGeneric, renderHelper: GfxRenderHelper) {
        this.textureMappings.push([
            this.textureCache.getTextureMapping(shader.get_bitmap(0)),
            this.textureCache.getTextureMapping(shader.get_bitmap(1)),
            this.textureCache.getTextureMapping(shader.get_bitmap(2)),
            this.textureCache.getTextureMapping(shader.get_bitmap(3)),
        ]);
        this.programs.push(renderHelper.renderCache.createProgram(new ShaderTransparencyGenericProgram(shader)));
    }

    private setupShaderModel(shader: HaloShaderModel, renderHelper: GfxRenderHelper) {
        this.textureMappings.push([
            this.textureCache.getTextureMapping(shader.get_base_bitmap()),
            null,
            null,
            this.textureCache.getTextureMapping(shader.get_detail_bitmap()),
            null,
            null,
            shader.has_reflection_cube_map ? this.textureCache.getTextureMapping(shader.get_reflection_cube_map()) : null,
            this.textureCache.getTextureMapping(shader.get_multipurpose_map()),
        ]);
        this.programs.push(renderHelper.renderCache.createProgram(new ShaderModelProgram(shader)));

    }

    constructor(public device: GfxDevice, public textureCache: TextureCache, public bsp: HaloBSP, public mgr: HaloSceneManager, public model: HaloModel, public modelMatrix: mat4) {
        this.shaders = mgr.get_model_shaders(this.model);
        this.inputLayout = this.getInputLayout();
        const renderHelper = new GfxRenderHelper(device);
        this.textureMappings = [];
        this.programs = [];
        this.shaderParams = [];
        this.shaders.forEach(shader => {
            if (shader instanceof _wasm!.HaloShaderModel) {
                this.setupShaderModel(shader, renderHelper);
            } else if (shader instanceof _wasm!.HaloShaderTransparencyGeneric) {
                this.setupShaderTransparencyGeneric(shader, renderHelper);
            } else if (shader instanceof _wasm!.HaloShaderTransparencyChicago) {
                this.setupShaderTransparencyChicago(shader, renderHelper);
            } else {
                this.textureMappings.push([
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                ]);
                this.programs.push(null);
            }
        });

        this.parts = mgr.get_model_parts(this.model);
        this.inputStates = this.parts.map(part => {
            const triStrips = mgr.get_model_part_indices(part);
            const indices = convertToTriangleIndexBuffer(GfxTopology.TriStrips, triStrips);
            part.update_tri_count(indices.length);
            const triBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);
            const vertBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_model_part_vertices(part).buffer);
            return device.createInputState(this.inputLayout, [{ buffer: vertBuf, byteOffset: 0 }], { buffer: triBuf, byteOffset: 0 });
        })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        this.parts.forEach((part, partIdx) => {
            if (!this.programs[part.shader_index]) {
                return;
            }

            let offs = template.allocateUniformBuffer(BaseProgram.ub_ModelParams, 16);
            let mapped = template.mapUniformBufferF32(BaseProgram.ub_ModelParams);
            offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

            offs = template.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 16);
            mapped = template.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setGfxProgram(this.programs[part.shader_index]!);

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings[part.shader_index])
            renderInst.setInputLayoutAndState(this.inputLayout, this.inputStates[partIdx]);
            renderInst.drawIndexes(part.tri_count, 0);
            renderInstManager.submitRenderInst(renderInst);
        });

        renderInstManager.popTemplateRenderInst();
    }

    private getInputLayout(): GfxInputLayout {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        const vec3fSize = 3 * 4;
        vertexAttributeDescriptors.push({ location: ShaderModelProgram.a_Pos, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderModelProgram.a_Norm, bufferIndex: 0, bufferByteOffset: 1 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderModelProgram.a_Binorm, bufferIndex: 0, bufferByteOffset: 2 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderModelProgram.a_Tangent, bufferIndex: 0, bufferByteOffset: 3 * vec3fSize, format: GfxFormat.F32_RGB});
        vertexAttributeDescriptors.push({ location: ShaderModelProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 4 * vec3fSize, format: GfxFormat.F32_RG});
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 68, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        let indexBufferFormat: GfxFormat = GfxFormat.U16_R;
        return this.device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }

    public destroy(device: GfxDevice) {
        this.inputStates.forEach(state => device.destroyInputState(state));
        device.destroyInputLayout(this.inputLayout);
    }
}

class SceneryRenderer {
    public modelRenderers: ModelRenderer[];
    public modelMatrix: mat4;
    public model: HaloModel;

    constructor(public device: GfxDevice, public textureCache: TextureCache, public bsp: HaloBSP, public mgr: HaloSceneManager, public scenery: HaloScenery, public instances: HaloSceneryInstance[]) {
        this.model = mgr.get_scenery_model(this.scenery)!;
        this.modelMatrix = mat4.create();
        const initPos = vec3.fromValues(this.scenery.origin_offset.x, this.scenery.origin_offset.y, this.scenery.origin_offset.z);
        mat4.fromTranslation(this.modelMatrix, initPos)
        this.modelRenderers = this.instances.map(instance => {
            const instModelMatrix = mat4.clone(this.modelMatrix);
            const pos = vec3.fromValues(instance.position.x, instance.position.y, instance.position.z);
            mat4.translate(instModelMatrix, instModelMatrix, pos);
            /*
            mat4.rotateX(instModelMatrix, instModelMatrix, 180 * instance.rotation.roll / Math.PI);
            mat4.rotateZ(instModelMatrix, instModelMatrix, 180 * instance.rotation.yaw / Math.PI);
            mat4.rotateY(instModelMatrix, instModelMatrix, 180 * instance.rotation.pitch / Math.PI);
            */
            return new ModelRenderer(this.device, this.textureCache, this.bsp, this.mgr, this.model, instModelMatrix);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.modelRenderers.forEach(m => m.prepareToRender(renderInstManager, viewerInput));
    }

    public destroy(device: GfxDevice) {
        this.modelRenderers.forEach(m => m.destroy(device));
    }
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmapRenderers: LightmapRenderer[];
    public sceneryRenderers: SceneryRenderer[];
    public skyboxRenderers: ModelRenderer[];

    constructor(public device: GfxDevice, public textureCache: TextureCache, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number) {
        this.trisBuf = makeStaticDataBuffer(device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.lightmapRenderers = mgr.get_bsp_lightmaps(this.bsp).map(lightmap => {
            let lightmapTex: TextureMapping | undefined;
            if (lightmapsBitmap && lightmap.get_bitmap_index() !== 65535) {
                lightmapTex = this.textureCache.getTextureMapping(lightmapsBitmap!, lightmap.get_bitmap_index());
            }
            return new LightmapRenderer(this.device, this.textureCache, this.trisBuf, this.bsp, this.mgr, this.bspIndex, lightmap, lightmapTex);
        });
        const sceneryInstances: HaloSceneryInstance[] = mgr.get_scenery_instances();
        this.sceneryRenderers = mgr.get_scenery_palette().map((scenery, i) => {
            const instances = sceneryInstances.filter(instance => instance.scenery_type === i);
            return new SceneryRenderer(this.device, this.textureCache, this.bsp, this.mgr, scenery, instances);
        });
        this.skyboxRenderers = mgr.get_skies().map(sky => {
            const modelMatrix = mat4.create();
            return new ModelRenderer(this.device, this.textureCache, bsp, mgr, sky.get_model(), modelMatrix);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.lightmapRenderers.forEach(r => r.prepareToRender(renderInstManager, viewerInput));
        this.sceneryRenderers.forEach(r => r.prepareToRender(renderInstManager, viewerInput));
        this.skyboxRenderers.forEach(r => r.prepareToRender(renderInstManager, viewerInput));
    }

    public destroy(device: GfxDevice) {
        this.lightmapRenderers.forEach(r => r.destroy(device));
        this.sceneryRenderers.forEach(r => r.destroy(device));
        device.destroyBuffer(this.trisBuf);
    }
}

class LightmapMaterialRenderer {
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
    public perpendicularColor: vec4;
    public parallelColor: vec4;
    public modelMatrix: mat4;

    constructor(device: GfxDevice, public textureCache: TextureCache, public material: HaloMaterial, public inputLayout: GfxInputLayout, public mgr: HaloSceneManager, public bsp: HaloBSP, public trisBuf: GfxBuffer, public lightmapMapping: TextureMapping | null, public bspIndex: number) {
        this.vertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_vertex_data(this.material, this.bsp).buffer);
        this.modelMatrix = mat4.create();
        this.lightmapVertsBuf = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_material_lightmap_data(this.material, this.bsp).buffer);
        this.shader = mgr.get_material_shader(this.material);
        this.perpendicularColor = vec4.create();
        this.parallelColor = vec4.create();
        if (this.shader) {
            this.textureMapping = this.textureCache.getTextureMapping(this.shader.get_base_bitmap());
            this.bumpMapping = this.textureCache.getTextureMapping(this.shader.get_bump_map());
            this.primaryDetailMapping = this.textureCache.getTextureMapping(this.shader.get_primary_detail_bitmap());
            this.secondaryDetailMapping = this.textureCache.getTextureMapping(this.shader.get_secondary_detail_bitmap());
            this.microDetailMapping = this.textureCache.getTextureMapping(this.shader.get_micro_detail_bitmap());
            this.reflectionCubeMapping = this.shader && this.shader.has_reflection_cube_map ? this.textureCache.getTextureMapping(this.shader.get_reflection_cube_map()) : null;
            const perpendicular = this.shader.perpendicular_color;
            this.perpendicularColor = vec4.fromValues(perpendicular.r, perpendicular.g, perpendicular.b, this.shader.perpendicular_brightness);
            const parallel = this.shader.parallel_color;
            this.parallelColor = vec4.fromValues(parallel.r, parallel.g, parallel.b, this.shader.parallel_brightness);
        }
        const renderHelper = new GfxRenderHelper(device);
        this.program = renderHelper.renderCache.createProgram(new ShaderEnvironmentProgram(this.shader, !!this.lightmapMapping));

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertsBuf, byteOffset: 0 },
            { buffer: this.lightmapVertsBuf, byteOffset: 0 },
        ], { buffer: this.trisBuf, byteOffset: 0 })
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        let offs = template.allocateUniformBuffer(ShaderEnvironmentProgram.ub_ShaderParams, 3 * 16);
        let mapped = template.mapUniformBufferF32(ShaderEnvironmentProgram.ub_ShaderParams);
        if (this.shader) {
            offs += fillVec4v(mapped, offs, this.perpendicularColor);
            offs += fillVec4v(mapped, offs, this.parallelColor);
            offs += fillVec4(mapped, offs, this.bspIndex, this.bspIndex, this.bspIndex, this.bspIndex);
        }

        {
            let offs = template.allocateUniformBuffer(BaseProgram.ub_ModelParams, 16);
            const mapped = template.mapUniformBufferF32(BaseProgram.ub_ModelParams);
            offs += fillMatrix4x4(mapped, offs, this.modelMatrix);
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
            null,
        ])
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.material.get_num_indices(), this.material.get_index_offset());
        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertsBuf);
        device.destroyBuffer(this.lightmapVertsBuf);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8, samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 0
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 1
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 2
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 3
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 4
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 5
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, },// 6
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 7
    ] },
];

class HaloScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public textureCache: TextureCache;
    public bspRenderers: BSPRenderer[];

    constructor(public device: GfxDevice, public mgr: HaloSceneManager) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        const cache = new GfxRenderCache(this.device);
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.textureCache = new TextureCache(this.device, gfxSampler, this.mgr);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/1000);
    }

    addBSP(bsp: HaloBSP, bspIndex: number) {
        this.bspRenderers.push(new BSPRenderer(this.device, this.textureCache, bsp, this.mgr, bspIndex));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        {
            let offs = template.allocateUniformBuffer(BaseProgram.ub_SceneParams, 32 + 12);
            const mapped = template.mapUniformBufferF32(BaseProgram.ub_SceneParams);
            offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
            const view = mat4.create();
            mat4.mul(view, viewerInput.camera.viewMatrix, noclipSpaceFromHaloSpace);
            offs += fillMatrix4x4(mapped, offs, view);
            const cameraPos = vec3.create();
            mat4.invert(view, view);
            getMatrixTranslation(cameraPos, view);
            offs += fillVec3v(mapped, offs, cameraPos);
        }

        this.bspRenderers.forEach((r, i) => {
            r.prepareToRender(this.renderHelper.renderInstManager, viewerInput)
        })

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        viewerInput.camera.setClipPlanes(0.01);

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
        this.bspRenderers.forEach(r => r.destroy(device));
        this.textureCache.destroy(device);
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