
import { mat4, vec3, vec4 } from 'gl-matrix';
import { AnimationFunction, FramebufferBlendFunction, HaloBSP, HaloBitmapReader, HaloLightmap, HaloMaterial, HaloModel, HaloModelPart, HaloSceneManager, HaloScenery, HaloSceneryInstance, HaloShaderEnvironment, HaloShaderModel, HaloShaderTransparencyChicago, HaloShaderTransparencyGeneric, HaloShaderTransparentChicagoMap, HaloSky, ShaderOutput, ShaderOutputMapping, ShaderTransparentChicagoColorFunction, ShaderMapping, ShaderOutputFunction, ShaderAlphaInput, ShaderInput, HaloShaderTransparentGenericMap, } from '../../rust/pkg/index';
import { Camera, CameraController, computeViewSpaceDepthFromWorldSpacePoint } from '../Camera';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxShaderLibrary, glslGenerateFloat } from '../gfx/helpers/GfxShaderLibrary';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { convertToTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { fillMatrix4x2, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFrontFaceMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSamplerFormatKind, GfxTexFilterMode, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKeyOpaque, setSortKeyDepth, setSortKeyLayer } from '../gfx/render/GfxRenderInstManager';
import { computeModelMatrixS, computeModelMatrixSRT, getMatrixTranslation, setMatrixTranslation } from '../MathHelpers';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { TextureMapping } from '../TextureHolder';
import { assert, nArray } from '../util';
import * as Viewer from '../viewer';
import { TextureCache } from './tex';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

/**
 * todo:
 *   * decals/glowing elements/purple textures
 *   * fog
 *   * water
 */

const noclipSpaceFromHaloSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

const scratchVec3a = vec3.create();

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

const enum SortKey {
    Translucent = GfxRendererLayer.TRANSLUCENT + 2,
    Skybox = GfxRendererLayer.TRANSLUCENT + 1,
}

class BaseProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_BSPParams = 2;
    public static ub_ShaderParams = 2;

    public static u_Texture = 0;
    public static u_Lightmap = 1;
    public static u_Bumpmap = 2;
    public static u_PrimaryDetailTexture = 3;
    public static u_SecondaryDetailTexture = 4;
    public static u_MicroDetailTexture = 5;
    public static u_ReflectionCubeMap = 6;
    public static u_MultipurposeMap = 7;

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

    public static common = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    vec3 u_PlayerPos;
    vec4 u_FogColor;
    vec4 u_FogDistances;
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

    public static CalcFog = `
void CalcFog(inout vec4 t_Color, in vec3 t_PositionWorld) {
    return; // broken???
    float t_DistanceWorld = distance(t_PositionWorld.xyz, u_PlayerPos.xyz);
    float t_FogFactor = saturate(invlerp(u_FogDistances.x, u_FogDistances.y, t_DistanceWorld));
    t_FogFactor = min(t_FogFactor, u_FogColor.a);

    // Square the fog factor to better approximate fixed-function HW (which happens all in clip space)
    t_FogFactor *= t_FogFactor;

    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogFactor);
}
`;

    public static vertexAttrs = `
layout(location = ${BaseProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${BaseProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${BaseProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${BaseProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${BaseProgram.a_TexCoord}) in vec2 a_TexCoord;
`;

    public override vert = `
${BaseProgram.vertexAttrs}
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

    constructor(includes: string[]) {
        super();
        const baseIncludes: string[] = [
            GfxShaderLibrary.saturate,
            GfxShaderLibrary.invlerp,
            BaseProgram.common,
            BaseProgram.CalcFog,
            BaseProgram.varying,
        ];
        this.both = baseIncludes.concat(includes).join('\n');
    }
}

class ShaderTransparencyGenericProgram extends BaseProgram {
    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    Mat4x2 u_MapTransform0;
    Mat4x2 u_MapTransform1;
    Mat4x2 u_MapTransform2;
    Mat4x2 u_MapTransform3;
};
`;

    constructor(public shader: HaloShaderTransparencyGeneric) {
        super([ShaderTransparencyGenericProgram.BindingsDefinition])
        this.frag = this.generateFragSection();
    }

    private generateFragSection(): string {
        const fragBody: string[] = [];

        fragBody.push(`
vec2 uv0 = Mul(u_MapTransform0, vec4(v_UV, 1.0, 1.0));
vec2 uv1 = Mul(u_MapTransform1, vec4(v_UV, 1.0, 1.0));
vec2 uv2 = Mul(u_MapTransform2, vec4(v_UV, 1.0, 1.0));
vec2 uv3 = Mul(u_MapTransform3, vec4(v_UV, 1.0, 1.0));
`);
        if (this.shader.first_map_type === _wasm!.ShaderTransparentGenericMapType.Map2D) {
            fragBody.push(`vec4 t0 = texture(SAMPLER_2D(u_Texture), uv0);`);
        } else {
            fragBody.push(`vec3 t_EyeWorld = normalize(u_PlayerPos - v_Position);`);
            fragBody.push(`vec4 t0 = texture(SAMPLER_CUBE(u_ReflectionCubeMap), t_EyeWorld);`);
        }

        fragBody.push(`
vec4 t1 = texture(SAMPLER_2D(u_Lightmap), uv1);
vec4 t2 = texture(SAMPLER_2D(u_Bumpmap), uv2);
vec4 t3 = texture(SAMPLER_2D(u_PrimaryDetailTexture), uv3);
vec4 r0 = vec4(0.0, 0.0, 0.0, t0.a);
vec4 r1 = vec4(0.0, 0.0, 0.0, 0.0);
vec4 v0 = vec4(0.0, 0.0, 0.0, 0.0); // TODO(jstpierre): Vertex lighting
vec4 v1 = vec4(0.0, 0.0, 0.0, 0.0); // TODO(jstpierre): Vertex lighting

vec4 A, B, C, D;
vec4 AB, CD, ABCD;
`);

        function genInputColor(input: ShaderInput): string { // vec3
            if (input === _wasm!.ShaderInput.Zero)
                return `vec3(0.0)`;
            else if (input === _wasm!.ShaderInput.One)
                return `vec3(1.0)`;
            else if (input === _wasm!.ShaderInput.OneHalf)
                return `vec3(0.5)`;
            else if (input === _wasm!.ShaderInput.NegativeOne)
                return `vec3(-1.0)`;
            else if (input === _wasm!.ShaderInput.NegativeOneHalf)
                return `vec3(-0.5)`;
            else if (input === _wasm!.ShaderInput.Texture0Color)
                return `t0.rgb`;
            else if (input === _wasm!.ShaderInput.Texture1Color)
                return `t1.rgb`;
            else if (input === _wasm!.ShaderInput.Texture2Color)
                return `t2.rgb`;
            else if (input === _wasm!.ShaderInput.Texture3Color)
                return `t3.rgb`;
            else if (input === _wasm!.ShaderInput.VertexColor0Color)
                return `v0.rgb`;
            else if (input === _wasm!.ShaderInput.VertexColor1Color)
                return `v1.rgb`;
            else if (input === _wasm!.ShaderInput.Scratch0Color)
                return `r0.rgb`;
            else if (input === _wasm!.ShaderInput.Scratch1Color)
                return `r1.rgb`;
            else if (input === _wasm!.ShaderInput.Constant0Color)
                return `vec3(0.0)`; // TODO(jstpierre): Constant stage color
            else if (input === _wasm!.ShaderInput.Constant1Color)
                return `vec3(0.0)`; // TODO(jstpierre): Constant stage color
            else if (input === _wasm!.ShaderInput.Texture0Alpha)
                return `t0.aaa`;
            else if (input === _wasm!.ShaderInput.Texture1Alpha)
                return `t1.aaa`;
            else if (input === _wasm!.ShaderInput.Texture2Alpha)
                return `t2.aaa`;
            else if (input === _wasm!.ShaderInput.Texture3Alpha)
                return `t3.aaa`;
            else if (input === _wasm!.ShaderInput.VertexColor0Alpha)
                return `v0.aaa`;
            else if (input === _wasm!.ShaderInput.VertexColor1Alpha)
                return `v1.aaa`;
            else if (input === _wasm!.ShaderInput.Scratch0Alpha)
                return `r0.aaa`;
            else if (input === _wasm!.ShaderInput.Scratch1Alpha)
                return `r1.aaa`;
            else if (input === _wasm!.ShaderInput.Constant0Alpha)
                return `vec3(0.0)`; // TODO(jstpierre): Constant stage alpha
            else if (input === _wasm!.ShaderInput.Constant1Alpha)
                return `vec3(0.0)`; // TODO(jstpierre): Constant stage alpha
            else
                throw "whoops";
        }

        function genInputAlpha(input: ShaderAlphaInput): string { // float
            if (input === _wasm!.ShaderAlphaInput.Zero)
                return `0.0`;
            else if (input === _wasm!.ShaderAlphaInput.One)
                return `1.0`;
            else if (input === _wasm!.ShaderAlphaInput.OneHalf)
                return `0.5`;
            else if (input === _wasm!.ShaderAlphaInput.NegativeOne)
                return `-1.0`;
            else if (input === _wasm!.ShaderAlphaInput.NegativeOneHalf)
                return `-0.5`;
            else if (input === _wasm!.ShaderAlphaInput.Texture0Alpha)
                return `t0.a`;
            else if (input === _wasm!.ShaderAlphaInput.Texture1Alpha)
                return `t1.a`;
            else if (input === _wasm!.ShaderAlphaInput.Texture2Alpha)
                return `t2.a`;
            else if (input === _wasm!.ShaderAlphaInput.Texture3Alpha)
                return `t3.a`;
            else if (input === _wasm!.ShaderAlphaInput.VertexColor0Alpha)
                return `v0.a`;
            else if (input === _wasm!.ShaderAlphaInput.VertexColor1Alpha)
                return `v1.a`;
            else if (input === _wasm!.ShaderAlphaInput.Scratch0Alpha)
                return `r0.a`;
            else if (input === _wasm!.ShaderAlphaInput.Scratch1Alpha)
                return `r1.a`;
            else if (input === _wasm!.ShaderAlphaInput.Constant0Alpha)
                return `0.0`; // TODO(jstpierre): Constant stage alpha
            else if (input === _wasm!.ShaderAlphaInput.Constant1Alpha)
                return `0.0`; // TODO(jstpierre): Constant stage alpha
            else if (input === _wasm!.ShaderAlphaInput.Texture0Blue)
                return `t0.b`;
            else if (input === _wasm!.ShaderAlphaInput.Texture1Blue)
                return `t1.b`;
            else if (input === _wasm!.ShaderAlphaInput.Texture2Blue)
                return `t2.b`;
            else if (input === _wasm!.ShaderAlphaInput.Texture3Blue)
                return `t3.b`;
            else if (input === _wasm!.ShaderAlphaInput.VertexColor0Blue)
                return `v0.b`;
            else if (input === _wasm!.ShaderAlphaInput.VertexColor1Blue)
                return `v1.b`;
            else if (input === _wasm!.ShaderAlphaInput.Scratch0Blue)
                return `r0.b`;
            else if (input === _wasm!.ShaderAlphaInput.Scratch1Blue)
                return `r1.b`;
            else if (input === _wasm!.ShaderAlphaInput.Constant0Blue)
                return `0.0`; // TODO(jstpierre): Constant stage blue
            else if (input === _wasm!.ShaderAlphaInput.Constant1Blue)
                return `0.0`; // TODO(jstpierre): Constant stage blue
            else
                throw "whoops";
        }

        function genMapping(input: string, mapping: ShaderMapping, color: boolean): string {
            const constructor = color ? `vec3` : ``;
            if (mapping === _wasm!.ShaderMapping.UnsignedIdentity)
                return `max(${input}, ${constructor}(0.0))`;
            else if (mapping === _wasm!.ShaderMapping.UnsignedInvert)
                return `${constructor}(1.0) - saturate(${input})`;
            else if (mapping === _wasm!.ShaderMapping.ExpandNormal)
                return `${constructor}(2.0) * max(${input}, ${constructor}(0.0)) - ${constructor}(1.0)`;
            else if (mapping === _wasm!.ShaderMapping.ExpandNegate)
                return `${constructor}(-2.0) * max(${input}, ${constructor}(0.0)) + ${constructor}(1.0)`;
            else if (mapping === _wasm!.ShaderMapping.HalfbiasNormal)
                return `max(${input}, ${constructor}(0.0)) - ${constructor}(0.5)`;
            else if (mapping === _wasm!.ShaderMapping.HalfbiasNegate)
                return `-max(${input}, ${constructor}(0.0)) + ${constructor}(0.5)`;
            else if (mapping === _wasm!.ShaderMapping.SignedIdentity)
                return `${input}`;
            else if (mapping === _wasm!.ShaderMapping.SignedNegate)
                return `-${input}`;
            else
                throw "whoops";
        }

        function genInput(colorInput: ShaderInput, colorMapping: ShaderMapping, alphaInput: ShaderAlphaInput, alphaMapping: ShaderMapping): string {
            const color = genMapping(genInputColor(colorInput), colorMapping, true);
            const alpha = genMapping(genInputAlpha(alphaInput), alphaMapping, false);
            return `vec4(${color}, ${alpha})`;
        }

        function genOutputFunction(func: ShaderOutputFunction, a: string, b: string): string {
            if (func === _wasm!.ShaderOutputFunction.DotProduct)
                return `dot(${a}, ${b})`;
            else if (func === _wasm!.ShaderOutputFunction.Multiply)
                return `(${a} * ${b})`;
            else
                throw "whoops";
        }

        function genMux(mux: boolean, ab: string, cd: string): string {
            return mux ? `(r0.a >= 0.5) ? ${cd} : ${ab}` : `${ab} + ${cd}`;
        }

        function genOutputMapping(mapping: ShaderOutputMapping, v: string): string {
            if (mapping === _wasm!.ShaderOutputMapping.Identity)
                return ``;
            else if (mapping === _wasm!.ShaderOutputMapping.ScaleByHalf)
                return `${v} = ${v} * 0.5;`;
            else if (mapping === _wasm!.ShaderOutputMapping.ScaleByTwo)
                return `${v} = ${v} * 2.0;`;
            else if (mapping === _wasm!.ShaderOutputMapping.ScaleByFour)
                return `${v} = ${v} * 4.0;`;
            else if (mapping === _wasm!.ShaderOutputMapping.BiasByHalf)
                return `${v} = ${v} - 0.5;`;
            else if (mapping === _wasm!.ShaderOutputMapping.ExpandNormal)
                return `${v} = (${v} - 0.5) * 2.0;`;
            else
                throw "whoops";
        }

        function genOutputColor(output: ShaderOutput, v: string): string {
            if (output === _wasm!.ShaderOutput.Discard)
                return ``;
            else if (output === _wasm!.ShaderOutput.Scratch0)
                return `r0.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.Scratch1)
                return `r1.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.VertexColor0)
                return `v0.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.VertexColor1)
                return `v1.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture0)
                return `t0.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture1)
                return `t1.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture2)
                return `t2.rgb = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture3)
                return `t3.rgb = ${v};`;
            else
                throw "whoops";
        }

        function genOutputAlpha(output: ShaderOutput, v: string): string {
            if (output === _wasm!.ShaderOutput.Discard)
                return ``;
            else if (output === _wasm!.ShaderOutput.Scratch0)
                return `r0.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.Scratch1)
                return `r1.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.VertexColor0)
                return `v0.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.VertexColor1)
                return `v1.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture0)
                return `t0.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture1)
                return `t1.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture2)
                return `t2.a = ${v};`;
            else if (output === _wasm!.ShaderOutput.Texture3)
                return `t3.a = ${v};`;
            else
                throw "whoops";
        }

        for (let i=0; i<8; i++) {
            const stage = this.shader.get_stage(i);
            if (!stage) continue;

            fragBody.push(`
// Stage ${i}
A = ${genInput(stage.input_a, stage.input_a_mapping, stage.input_a_alpha, stage.input_a_mapping_alpha)};
B = ${genInput(stage.input_b, stage.input_b_mapping, stage.input_b_alpha, stage.input_b_mapping_alpha)};
C = ${genInput(stage.input_c, stage.input_c_mapping, stage.input_c_alpha, stage.input_c_mapping_alpha)};
D = ${genInput(stage.input_d, stage.input_d_mapping, stage.input_d_alpha, stage.input_d_mapping_alpha)};

AB.rgb = ${genOutputFunction(stage.output_ab_function, `A.rgb`, `B.rgb`)};
AB.a   = A.a * B.a;

CD.rgb = ${genOutputFunction(stage.output_cd_function, `C.rgb`, `D.rgb`)};
CD.a   = C.a * D.a;

ABCD.rgb = ${genMux(!!(stage.flags & 0x01), `AB.rgb`, `CD.rgb`)};
ABCD.a   = ${genMux(!!(stage.flags & 0x02), `AB.a`, `CD.a`)};
ABCD.rgba = clamp(ABCD.rgba, -1.0, 1.0);

${genOutputMapping(stage.output_mapping_color, `AB.rgb`)}
${genOutputMapping(stage.output_mapping_color, `CD.rgb`)}
${genOutputMapping(stage.output_mapping_color, `ABCD.rgb`)}

${genOutputMapping(stage.output_mapping_alpha, `AB.a`)}
${genOutputMapping(stage.output_mapping_alpha, `CD.a`)}
${genOutputMapping(stage.output_mapping_alpha, `ABCD.a`)}

${genOutputColor(stage.output_ab,       `AB.rgb`)}
${genOutputAlpha(stage.output_ab_alpha, `AB.a`)}

${genOutputColor(stage.output_cd,       `CD.rgb`)}
${genOutputAlpha(stage.output_cd_alpha, `CD.a`)}

${genOutputColor(stage.output_ab_cd_mux_sum, `ABCD.rgb`)}
${genOutputAlpha(stage.output_ab_cd_mux_sum_alpha, `ABCD.a`)}
`);
            stage.free();
        }

        fragBody.push(`gl_FragColor = r0.rgba;`);
        fragBody.push(`CalcFog(gl_FragColor, v_Position);`);

        return `
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

function setBlendMode(dst: Partial<GfxMegaStateDescriptor>, fn: FramebufferBlendFunction) {
    if (fn === _wasm!.FramebufferBlendFunction.AlphaBlend) {
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
    } else if (fn === _wasm!.FramebufferBlendFunction.Multiply) {
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.Dst,
            blendDstFactor: GfxBlendFactor.Zero,
        });
    } else if (fn === _wasm!.FramebufferBlendFunction.Add) {
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.One,
        });
    } else if (fn === _wasm!.FramebufferBlendFunction.AlphaMultiplyAdd) {
        setAttachmentStateSimple(dst, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.One,
        });
    } else {
        throw new Error(`unsupported blend mode ${_wasm!.FramebufferBlendFunction[fn]}`)
    }
}

class MaterialRender_TransparencyGeneric {
    private textureMapping: (TextureMapping | null)[] = nArray(8, () => null);
    private animationHandlers: (TextureAnimationHandler | undefined)[];
    private mapTransform: mat4;
    private gfxProgram: GfxProgram;
    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderTransparencyGeneric) {
        this.textureMapping[1] = textureCache.getTextureMapping(shader.get_bitmap(1));
        this.textureMapping[2] = textureCache.getTextureMapping(shader.get_bitmap(2));
        this.textureMapping[3] = textureCache.getTextureMapping(shader.get_bitmap(3));
        if (shader.first_map_type === _wasm!.ShaderTransparentGenericMapType.Map2D) {
            this.textureMapping[0] = textureCache.getTextureMapping(shader.get_bitmap(0));
        } else {
            this.textureMapping[6] = textureCache.getTextureMapping(shader.get_bitmap(0));
        }
        const maps = [
            this.shader.get_map(0),
            this.shader.get_map(1),
            this.shader.get_map(2),
            this.shader.get_map(3),
        ];
        this.animationHandlers = maps.map(map => map ? new TextureAnimationHandler(map) : undefined);

        this.mapTransform = mat4.create();
        this.gfxProgram = cache.createProgram(new ShaderTransparencyGenericProgram(shader));
        this.sortKeyBase = makeSortKeyOpaque(SortKey.Translucent, this.gfxProgram.ResourceUniqueId);
    }

    private setupMapTransform(i: number, t: number): mat4 {
        const handler = this.animationHandlers[i];
        if (handler) {
            handler.setTransform(this.mapTransform, t);
        } else {
            mat4.identity(this.mapTransform);
        }
        return this.mapTransform;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, view: View): void {
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const megaStateFlags = { depthWrite: false };
        setBlendMode(megaStateFlags, this.shader.framebuffer_blend_function);
        renderInst.setMegaStateFlags(megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 4 * 8);
        const mapped = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(0, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(1, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(2, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(3, view.time));
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

class ShaderTransparencyChicagoProgram extends BaseProgram {
    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    Mat4x2 u_MapTransform0;
    Mat4x2 u_MapTransform1;
    Mat4x2 u_MapTransform2;
    Mat4x2 u_MapTransform3;
};
`;

    constructor(public shader: HaloShaderTransparencyChicago) {
        super([ShaderTransparencyChicagoProgram.BindingsDefinition])
        this.frag = this.generateFragSection();
    }

    private getColorFunction(out: string, current: string, next: string, fn: ShaderTransparentChicagoColorFunction): string {
        switch (fn) {
            case _wasm!.ShaderTransparentChicagoColorFunction.Current:
                return ``;
            case _wasm!.ShaderTransparentChicagoColorFunction.NextMap:
                return `${out} = ${next};`
            case _wasm!.ShaderTransparentChicagoColorFunction.Multiply:
                return `${out} = ${current} * ${next};`;
            case _wasm!.ShaderTransparentChicagoColorFunction.DoubleMultiply:
                return `${next} = 2.0 * ${current} * ${next};`;
            case _wasm!.ShaderTransparentChicagoColorFunction.Add:
                return `${out} = ${current} + ${next};`;
            default:
                throw new Error(`unrecognized ShaderTransparentChicagoColorFunction ${fn}`)
        }
    }

    private generateFragSection(): string {
        const maps = [];
        for (let i=0; i<4; i++) {
            const map = this.shader.get_map(i);
            if (map) {
                maps.push(map);
            }
        }
        const fragBody: string[] = [
            `vec2 uv0 = Mul(u_MapTransform0, vec4(v_UV, 1.0, 1.0));`,
            `vec2 uv1 = Mul(u_MapTransform1, vec4(v_UV, 1.0, 1.0));`,
            `vec2 uv2 = Mul(u_MapTransform2, vec4(v_UV, 1.0, 1.0));`,
            `vec2 uv3 = Mul(u_MapTransform3, vec4(v_UV, 1.0, 1.0));`,
            `vec4 t0 = texture(SAMPLER_2D(u_Texture), uv0);`,
            `vec4 t1 = texture(SAMPLER_2D(u_Lightmap), uv1);`,
            `vec4 t2 = texture(SAMPLER_2D(u_Bumpmap), uv2);`,
            `vec4 t3 = texture(SAMPLER_2D(u_PrimaryDetailTexture), uv3);`,
        ];

        fragBody.push(`vec4 scratch;`)
        fragBody.push(`vec4 current = t0;`)
        fragBody.push(`vec4 next;`)

        maps.slice(0, 3).forEach((map, i) => {
            fragBody.push(`next = t${i+1};`)
            fragBody.push(this.getColorFunction('scratch.rgb', 'current.rgb', 'next.rgb', map.color_function));
            fragBody.push(this.getColorFunction('scratch.a', 'current.a', 'next.a', map.color_function));
            fragBody.push(`current = scratch;`)
        })

        fragBody.push(`gl_FragColor = current;`)
        fragBody.push(`CalcFog(gl_FragColor, v_Position);`)
        return `
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class MaterialRender_TransparencyChicago {
    private textureMapping: (TextureMapping | null)[] = nArray(8, () => null);
    private gfxProgram: GfxProgram;
    private mapTransform: mat4;
    private animationHandlers: (TextureAnimationHandler | undefined)[];
    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderTransparencyChicago) {
        for (let i = 0; i < 4; i++)
            this.textureMapping[i] = textureCache.getTextureMapping(shader.get_bitmap(i));

        this.mapTransform = mat4.create();
        this.gfxProgram = cache.createProgram(new ShaderTransparencyChicagoProgram(shader));
        this.sortKeyBase = makeSortKeyOpaque(SortKey.Translucent, this.gfxProgram.ResourceUniqueId);
        const maps = [
            this.shader.get_map(0),
            this.shader.get_map(1),
            this.shader.get_map(2),
            this.shader.get_map(3),
        ];
        this.animationHandlers = maps.map(map => map ? new TextureAnimationHandler(map) : undefined);
    }

    private setupMapTransform(i: number, t: number): mat4 {
        const handler = this.animationHandlers[i];
        if (handler) {
            handler.setTransform(this.mapTransform, t);
        } else {
            mat4.identity(this.mapTransform);
        }
        return this.mapTransform;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, view: View): void {
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const megaStateFlags = { depthWrite: false };
        setBlendMode(megaStateFlags, this.shader.framebuffer_blend_function);
        renderInst.setMegaStateFlags(megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 4 * 8);
        const mapped = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(0, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(1, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(2, view.time));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(3, view.time));
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

class TextureAnimationHandler {
    private u: TextureAnimationFunction;
    private v: TextureAnimationFunction;
    private rotation: TextureAnimationFunction;
    constructor(map: HaloShaderTransparentGenericMap | HaloShaderTransparentChicagoMap) {
        this.u = {
            fn: map.u_animation_function,
            scale: map.u_animation_scale,
            period: map.u_animation_period,
            phase: map.u_animation_phase,
            baseScale: map.map_u_scale,
            baseOffset: map.map_u_offset,
            baseRotation: 0,
            center: null,
        };
        this.v = {
            fn: map.v_animation_function,
            scale: map.v_animation_scale,
            period: map.v_animation_period,
            phase: map.v_animation_phase,
            baseScale: map.map_v_scale,
            baseOffset: map.map_v_offset,
            baseRotation: 0,
            center: null,
        };
        this.rotation = {
            fn: map.rotation_animation_function,
            scale: map.rotation_animation_scale,
            period: map.rotation_animation_period,
            phase: map.rotation_animation_phase,
            baseScale: 0,
            baseOffset: 0,
            baseRotation: map.map_rotation,
            center: [map.rotation_animation_center.x, map.rotation_animation_center.y],
        };
    }

    public setTransform(out: mat4, t: number) {
        // TODO: Spark/Noise
        computeModelMatrixS(out, this.u.baseScale, this.v.baseScale);
        const translation = vec3.fromValues(this.u.baseOffset, this.v.baseOffset, 0);
        const tSecs = t / 1000;
        switch (this.u.fn) {
            case _wasm!.AnimationFunction.One: break;
            case _wasm!.AnimationFunction.Slide:
                translation[0] += (tSecs / this.u.period) * this.u.scale;
                break;
        }
        switch (this.v.fn) {
            case _wasm!.AnimationFunction.One: break;
            case _wasm!.AnimationFunction.Slide:
                translation[1] += (tSecs / this.v.period) * this.v.scale;
                break;
        }
        setMatrixTranslation(out, translation);
    }
}

interface TextureAnimationFunction {
    fn: AnimationFunction;
    scale: number;
    period: number; // in seconds
    phase: number;
    baseScale: number,
    baseOffset: number,
    baseRotation: number,
    center: [number, number] | null;
}

class ShaderModelProgram extends BaseProgram {
    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    Mat4x2 u_BaseMapTransform;
};
`;

    constructor(public shader: HaloShaderModel) {
        super([ShaderModelProgram.BindingsDefinition]);
        this.frag = this.generateFragSection();
    }

    private generateFragSection(): string {
        const fragBody: string[] = [];

        fragBody.push(`
vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture), v_UV).rgba;
gl_FragColor.rgba = t_BaseTexture.rgba;
CalcFog(gl_FragColor, v_Position);
if (t_BaseTexture.a < 0.5)
    discard;
`);

        return `
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class MaterialRender_Model {
    private textureMapping: (TextureMapping | null)[] = nArray(8, () => null);
    private gfxProgram: GfxProgram;
    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderModel, private model: ModelRenderer) {
        this.textureMapping[0] = textureCache.getTextureMapping(shader.get_base_bitmap());
        this.textureMapping[1] = textureCache.getTextureMapping(shader.get_detail_bitmap());
        if (shader.has_reflection_cube_map)
            this.textureMapping[6] = textureCache.getTextureMapping(shader.get_reflection_cube_map());
        this.textureMapping[5] = textureCache.getTextureMapping(shader.get_multipurpose_map());

        this.gfxProgram = cache.createProgram(new ShaderModelProgram(shader));
        this.sortKeyBase = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, this.gfxProgram.ResourceUniqueId);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 16);
        const d = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);

        offs += fillMatrix4x2(d, offs, this.model.baseMapTransform);
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

class ShaderEnvironmentProgram extends BaseProgram {
    public static a_IncidentLight = 5;
    public static a_LightmapTexCoord = 6;

    public static override varying = `
varying vec2 v_lightmapUV;
varying vec3 v_IncidentLight;
`;

    public static CalcTangentToWorld = `
vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}
`;

    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    vec4 u_ReflectionPerpendicularColor;
    vec4 u_ReflectionParallelColor;
    vec4 u_Misc;
};

#define u_BSPIndex (u_Misc.x)
`;

    public override vert = `
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
        super([ShaderEnvironmentProgram.CalcTangentToWorld, ShaderEnvironmentProgram.varying, ShaderEnvironmentProgram.BindingsDefinition]);
        this.generateFragmentShader();
    }

    private getDetailSection(fragBody: String[]): void {
        fragBody.push(`vec2 primaryUV = v_UV * ${glslGenerateFloat(this.shader!.primary_detail_bitmap_scale)};`)
        fragBody.push(`vec4 primaryDetail = texture(SAMPLER_2D(u_PrimaryDetailTexture), primaryUV);`)
        fragBody.push(`vec2 secondaryUV = v_UV * ${glslGenerateFloat(this.shader!.secondary_detail_bitmap_scale)};`)
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
        fragBody.push(`vec2 microUV = v_UV * ${glslGenerateFloat(this.shader!.micro_detail_bitmap_scale)};`)
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
vec3 N = normalize(2.0 * dot(t_NormalWorld, t_EyeWorld) * t_NormalWorld - t_EyeWorld);
vec3 reflectionColor = texture(SAMPLER_CUBE(u_ReflectionCubeMap, N.xyz)).xyz;
vec3 specularColor = pow(reflectionColor, vec3(8.0));
float diffuseReflection = pow(dot(t_NormalWorld, t_EyeWorld), 2.0);
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
            fragBody.push(`
vec4 base = texture(SAMPLER_2D(u_Texture), v_UV);
vec4 color = base;
vec2 t_BumpTexCoord = v_UV * ${glslGenerateFloat(this.shader!.bump_map_scale)};
vec4 t_BumpMap = 2.0 * texture(SAMPLER_2D(u_Bumpmap), t_BumpTexCoord) - 1.0;
vec3 t_EyeWorld = normalize(u_PlayerPos - v_Position);
`);

            if (this.shader!.has_bump_map) {
                fragBody.push(`vec3 t_NormalWorld = normalize(CalcTangentToWorld(t_BumpMap.rgb, v_Tangent, v_Binormal, v_Normal));`);
            } else {
                fragBody.push(`vec3 t_NormalWorld = v_Normal;`);
            }

            if (this.has_lightmap) {
                fragBody.push(`
vec3 t_LightmapSample = texture(SAMPLER_2D(u_Lightmap), v_lightmapUV).rgb;
float t_Variance = dot(v_IncidentLight.rgb, v_IncidentLight.rgb);
float t_BumpAtten = (dot(v_IncidentLight, t_NormalWorld) * t_Variance) + (1.0 - t_Variance);
color.rgb *= t_LightmapSample * t_BumpAtten;
`);
            }

            if (!!(this.shader!.flags & 0x01)) {
                fragBody.push(`
if (t_BumpMap.a < 0.5)
    discard;
`);
            }

            this.getDetailSection(fragBody);
            this.getMicroDetailSection(fragBody);
            if (this.shader!.has_reflection_cube_map) {
                this.getReflectionSection(fragBody);
            }
        } else {
            if (this.has_lightmap) {
                fragBody.push(`vec4 color = texture(SAMPLER_2D(u_Lightmap), v_lightmapUV);`);
            } else {
                fragBody.push(`vec4 color = vec4(1.0, 0.0, 1.0, 1.0);`);
            }
        }

        fragBody.push(`gl_FragDepth = gl_FragCoord.z + 1e-6 * u_BSPIndex;`);
        fragBody.push(`gl_FragColor = vec4(color.rgb, 1.0);`);
        fragBody.push(`CalcFog(gl_FragColor, v_Position);`)
        this.frag = `
void mainPS() {
${fragBody.join('\n')}
}
`;
    }
}

class MaterialRender_Environment {
    private textureMappings: (TextureMapping | null)[] = nArray(8, () => null);
    private gfxProgram: GfxProgram;
    private perpendicularColor: vec4;
    private parallelColor: vec4;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderEnvironment, lightmapMapping: TextureMapping | null, private bspIndex: number) {
        this.gfxProgram = cache.createProgram(new ShaderEnvironmentProgram(shader, !!lightmapMapping));
        const perpendicular = this.shader.perpendicular_color;
        this.perpendicularColor = vec4.fromValues(perpendicular.r, perpendicular.g, perpendicular.b, this.shader.perpendicular_brightness);
        perpendicular.free();
        const parallel = this.shader.parallel_color;
        this.parallelColor = vec4.fromValues(parallel.r, parallel.g, parallel.b, this.shader.parallel_brightness);
        parallel.free();
        this.textureMappings = [
            textureCache.getTextureMapping(this.shader.get_base_bitmap()),
            lightmapMapping,
            textureCache.getTextureMapping(this.shader.get_bump_map()),
            textureCache.getTextureMapping(this.shader.get_primary_detail_bitmap()),
            textureCache.getTextureMapping(this.shader.get_secondary_detail_bitmap()),
            textureCache.getTextureMapping(this.shader.get_micro_detail_bitmap()),
            this.shader && this.shader.has_reflection_cube_map ? textureCache.getTextureMapping(this.shader.get_reflection_cube_map()) : null,
        ];
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        let offs = renderInst.allocateUniformBuffer(ShaderEnvironmentProgram.ub_ShaderParams, 3 * 16);
        let mapped = renderInst.mapUniformBufferF32(ShaderEnvironmentProgram.ub_ShaderParams);
        offs += fillVec4v(mapped, offs, this.perpendicularColor);
        offs += fillVec4v(mapped, offs, this.parallelColor);
        offs += fillVec4(mapped, offs, this.bspIndex);
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

class LightmapRenderer {
    public materials: LightmapMaterial[];
    public materialRenderers: (MaterialRender_Environment | MaterialRender_TransparencyChicago | MaterialRender_TransparencyGeneric | null)[];
    public visible = true;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public trisBuf: GfxBuffer, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number, public lightmap: HaloLightmap, public lightmapTex: TextureMapping | null) {
        this.materials = [];
        this.materialRenderers = [];
        mgr.get_lightmap_materials(lightmap).forEach(material => {
            const shader = this.mgr.get_material_shaders(material)[0];
            if (shader instanceof _wasm!.HaloShaderEnvironment) {
                this.materialRenderers.push(new MaterialRender_Environment(textureCache, renderCache, shader, lightmapTex, bspIndex));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyGeneric) {
                this.materialRenderers.push(new MaterialRender_TransparencyGeneric(textureCache, renderCache, shader));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyChicago) {
                this.materialRenderers.push(new MaterialRender_TransparencyChicago(textureCache, renderCache, shader));
            } else {
                this.materialRenderers.push(null);
            }
            this.materials.push(new LightmapMaterial(renderCache, mgr, bsp, material, trisBuf));
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        if (!this.visible)
            return;

        this.materialRenderers.forEach((materialRenderer, i) => {
            const renderInst = renderInstManager.newRenderInst();

            if (!materialRenderer) {
                return;
            }

            materialRenderer.setOnRenderInst(renderInst, mainView);
            this.materials[i].setOnRenderInst(renderInst);

            renderInstManager.submitRenderInst(renderInst);
        });
    }

    public destroy(device: GfxDevice) {
        this.materials.forEach(r => r.destroy(device));
    }
}

class LightmapMaterial {
    private vertexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private indexCount = 0;
    private lightmapVertexBuffer: GfxBuffer;
    private modelMatrix: mat4;
    private indexOffset: number;

    constructor(cache: GfxRenderCache, mgr: HaloSceneManager, bsp: HaloBSP, public material: HaloMaterial, private indexBuffer: GfxBuffer) {
        this.inputLayout = this.getInputLayout(cache);
        this.modelMatrix = mat4.create();
        this.vertexBuffer = makeStaticDataBuffer(cache.device, GfxBufferUsage.Vertex, mgr.get_material_vertex_data(this.material, bsp).buffer);
        this.lightmapVertexBuffer = makeStaticDataBuffer(cache.device, GfxBufferUsage.Vertex, mgr.get_material_lightmap_data(this.material, bsp).buffer);
        this.indexCount = this.material.get_num_indices();
        this.indexOffset = this.material.get_index_offset();

        this.inputState = cache.device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
            { buffer: this.lightmapVertexBuffer, byteOffset: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0 })
    }

    public setOnRenderInst(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(BaseProgram.ub_ModelParams, 16);
        const mapped = renderInst.mapUniformBufferF32(BaseProgram.ub_ModelParams);
        offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indexCount, this.indexOffset);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputState(this.inputState);
        this.material.free();
    }

    private getInputLayout(cache: GfxRenderCache): GfxInputLayout {
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
        return cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }
}

class ModelPart {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private indexCount = 0;
    public shaderIndex = 0;

    constructor(cache: GfxRenderCache, mgr: HaloSceneManager, private part: HaloModelPart) {
        const triStrips = mgr.get_model_part_indices(part);
        const indices = convertToTriangleIndexBuffer(GfxTopology.TriStrips, triStrips);
        this.indexCount = indices.length;

        const device = cache.device;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mgr.get_model_part_vertices(part).buffer);

        this.inputLayout = this.getInputLayout(cache);
        this.inputState = device.createInputState(this.inputLayout, [{ buffer: this.vertexBuffer, byteOffset: 0 }], { buffer: this.indexBuffer, byteOffset: 0 });

        this.shaderIndex = part.shader_index;
    }

    private getInputLayout(cache: GfxRenderCache): GfxInputLayout {
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
        return cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
        this.part.free();
    }
}

class ModelRenderer {
    private materialRenderers: (MaterialRender_Model | MaterialRender_TransparencyChicago | MaterialRender_TransparencyGeneric | null)[] = [];

    public baseMapTransform = mat4.create();

    // per part
    public parts: ModelPart[];
    public isSkybox: boolean = false;
    public visible = true;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public mgr: HaloSceneManager, public model: HaloModel, public modelMatrix: mat4) {
        const shaders = mgr.get_model_shaders(this.model);
        shaders.forEach(shader => {
            if (shader instanceof _wasm!.HaloShaderModel) {
                this.materialRenderers.push(new MaterialRender_Model(textureCache, renderCache, shader, this));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyGeneric) {
                this.materialRenderers.push(new MaterialRender_TransparencyGeneric(textureCache, renderCache, shader));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyChicago) {
                this.materialRenderers.push(new MaterialRender_TransparencyChicago(textureCache, renderCache, shader));
            } else {
                this.materialRenderers.push(null);
            }
        });

        computeModelMatrixS(this.baseMapTransform, this.model.get_base_bitmap_u_scale(), this.model.get_base_bitmap_v_scale());

        this.parts = mgr.get_model_parts(this.model).map((part) => {
            return new ModelPart(renderCache, mgr, part);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(BaseProgram.ub_ModelParams, 16);
        let mapped = template.mapUniformBufferF32(BaseProgram.ub_ModelParams);
        offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

        this.parts.forEach((part, partIdx) => {
            const materialRenderer = this.materialRenderers[part.shaderIndex];

            if (!materialRenderer)
                return; // Renderer will return...

            if (!materialRenderer.visible)
                return;

            const renderInst = renderInstManager.newRenderInst();
            part.setOnRenderInst(renderInst);
            materialRenderer.setOnRenderInst(renderInst, mainView);

            // TODO: Part AABB?
            renderInst.sortKey = materialRenderer.sortKeyBase;

            // XXX(jstpierre): This is a bit ugly... perhaps do skyboxen in a different render pass?
            if (this.isSkybox)
                renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, SortKey.Skybox);

            getMatrixTranslation(scratchVec3a, this.modelMatrix);
            const depth = computeViewSpaceDepthFromWorldSpacePoint(mainView.viewFromWorldMatrix, scratchVec3a);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        });

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.parts.forEach((part) => part.destroy(device));
        this.materialRenderers.forEach((materialRenderer) => materialRenderer?.destroy(device));
    }
}

class SceneryRenderer {
    public modelRenderers: ModelRenderer[];
    public model: HaloModel;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public mgr: HaloSceneManager, public scenery: HaloScenery, public instances: HaloSceneryInstance[]) {
        this.model = mgr.get_scenery_model(this.scenery)!;
        this.modelRenderers = this.instances.map(instance => {
            const instModelMatrix = mat4.create();
            computeModelMatrixSRT(instModelMatrix, 1, 1, 1,
                instance.rotation.roll, instance.rotation.pitch, instance.rotation.yaw,
                instance.position.x + this.scenery.origin_offset.x,
                instance.position.y + this.scenery.origin_offset.y,
                instance.position.z + this.scenery.origin_offset.z);
            return new ModelRenderer(this.textureCache, renderCache, this.mgr, this.model, instModelMatrix);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        this.modelRenderers.forEach(m => m.prepareToRender(renderInstManager, mainView));
    }

    public destroy(device: GfxDevice) {
        this.modelRenderers.forEach(m => m.destroy(device));
    }
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmapRenderers: LightmapRenderer[];

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number) {
        this.trisBuf = makeStaticDataBuffer(renderCache.device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.lightmapRenderers = mgr.get_bsp_lightmaps(this.bsp).map(lightmap => {
            let lightmapTex: TextureMapping | null = null;
            if (lightmapsBitmap && lightmap.get_bitmap_index() !== 65535) {
                lightmapTex = this.textureCache.getTextureMapping(lightmapsBitmap!, lightmap.get_bitmap_index());
            }
            return new LightmapRenderer(this.textureCache, renderCache, this.trisBuf, this.bsp, this.mgr, this.bspIndex, lightmap, lightmapTex);
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        this.lightmapRenderers.forEach(r => r.prepareToRender(renderInstManager, mainView));
    }

    public destroy(device: GfxDevice) {
        this.lightmapRenderers.forEach(r => r.destroy(device));
        device.destroyBuffer(this.trisBuf);
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

// A "View" is effectively camera settings, but in Halo space.
class View {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();
    public cameraPos = vec3.create();
    public time: number;

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
    }

    public setupFromViewerInput(viewerInput: Viewer.ViewerRenderInput): void {
        mat4.mul(this.viewFromWorldMatrix, viewerInput.camera.viewMatrix, noclipSpaceFromHaloSpace);
        mat4.copy(this.clipFromViewMatrix, viewerInput.camera.projectionMatrix);
        this.time = viewerInput.time;
        this.finishSetup();
    }
}

class HaloScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public textureCache: TextureCache;
    public bspRenderers: BSPRenderer[];
    public sceneryRenderers: SceneryRenderer[];
    public skyboxRenderer: ModelRenderer | undefined;
    public activeSky: HaloSky;
    public fogColor: vec4;
    public fogDistances: vec4;
    private mainView = new View();

    constructor(public device: GfxDevice, public mgr: HaloSceneManager, public bitmapReader: HaloBitmapReader) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        const gfxSampler = this.renderHelper.renderCache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Linear,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.textureCache = new TextureCache(this.device, gfxSampler, this.mgr, bitmapReader);
        const sceneryInstances: HaloSceneryInstance[] = mgr.get_scenery_instances();
        this.sceneryRenderers = mgr.get_scenery_palette().map((scenery, i) => {
            const instances = sceneryInstances.filter(instance => instance.scenery_type === i);
            return new SceneryRenderer(this.textureCache, this.renderHelper.renderCache, this.mgr, scenery, instances);
        });
        // for now, just choose the first skybox. eventually we'll want to switch between them depending on the current BSP
        this.activeSky = mgr.get_skies()[0];
        const color = this.activeSky.outdoor_fog_color;
        this.fogColor = vec4.fromValues(color.r, color.g, color.b, this.activeSky.outdoor_fog_max_density);
        color.free();
        this.fogDistances = vec4.fromValues(this.activeSky.outdoor_fog_start_distance, this.activeSky.outdoor_fog_opaque_distance, 0, 0);
        const modelMatrix = mat4.create();
        const skyModel = this.activeSky.get_model();
        if (skyModel) {
            this.skyboxRenderer = new ModelRenderer(this.textureCache, this.renderHelper.renderCache, mgr, skyModel, modelMatrix);
            this.skyboxRenderer.isSkybox = true;
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/1000);
    }

    public addBSP(bsp: HaloBSP, bspIndex: number) {
        this.bspRenderers.push(new BSPRenderer(this.textureCache, this.renderHelper.renderCache, bsp, this.mgr, bspIndex));
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        this.mainView.setupFromViewerInput(viewerInput);

        let offs = template.allocateUniformBuffer(BaseProgram.ub_SceneParams, 32 + 12);
        const mapped = template.mapUniformBufferF32(BaseProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, this.mainView.clipFromViewMatrix);
        offs += fillMatrix4x4(mapped, offs, this.mainView.viewFromWorldMatrix);
        offs += fillVec3v(mapped, offs, this.mainView.cameraPos);
        offs += fillVec4v(mapped, offs, this.fogColor);
        offs += fillVec4v(mapped, offs, this.fogDistances);

        this.bspRenderers.forEach((r, i) => {
            r.prepareToRender(this.renderHelper.renderInstManager, this.mainView);
        })
        this.sceneryRenderers.forEach(r => r.prepareToRender(this.renderHelper.renderInstManager, this.mainView));
        if (this.skyboxRenderer) {
            this.skyboxRenderer.prepareToRender(this.renderHelper.renderInstManager, this.mainView)
        }

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
        this.sceneryRenderers.forEach(r => r.destroy(device));
        if (this.skyboxRenderer) {
            this.skyboxRenderer.destroy(device);
        }
        this.renderHelper.destroy();
    }
}

const pathBase = `Halo1`;

class HaloSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const wasm = await loadWasm();
        wasm.init_panic_hook();
        const bitmapReader = await context.dataShare.ensureObject(`${pathBase}/BitmapReader`, async () => {
            const resourceMapData = await dataFetcher.fetchData(`${pathBase}/maps/bitmaps.map`);
            return wasm.HaloBitmapReader.new(resourceMapData.createTypedArray(Uint8Array));
        });
        const mapData = await dataFetcher.fetchData(`${pathBase}/maps/${this.id}.map`);
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array));
        const renderer = new HaloScene(device, mapManager, bitmapReader);
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
    new HaloSceneDesc("a10", "a10"), // the BSPs don't all play nice here
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