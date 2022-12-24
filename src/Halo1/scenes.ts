
import { mat4, ReadonlyMat4, vec3, vec4 } from 'gl-matrix';
import { AnimationFunction, FramebufferBlendFunction, FunctionSource, HaloBitmapReader, HaloBSP, HaloLightmap, HaloMaterial, HaloModel, HaloModelPart, HaloSceneManager, HaloScenery, HaloSceneryInstance, HaloShaderEnvironment, HaloShaderModel, HaloShaderTransparencyChicago, HaloShaderTransparencyGeneric, HaloShaderTransparentChicagoMap, HaloShaderTransparentGenericMap, HaloShaderTransparentWater, HaloShaderTransparentWaterRipple, HaloSky, ShaderAlphaInput, ShaderInput, ShaderMapping, ShaderOutput, ShaderOutputFunction, ShaderOutputMapping, ShaderTransparentChicagoColorFunction } from '../../rust/pkg/index';
import { CameraController, computeViewSpaceDepthFromWorldSpacePoint } from '../Camera';
import { Color, colorCopy, colorNewCopy, White } from '../Color';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { fullscreenMegaState, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GfxShaderLibrary, glslGenerateFloat } from '../gfx/helpers/GfxShaderLibrary';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { fillColor, fillMatrix4x2, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFrontFaceMode, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxSamplerFormatKind, GfxTexture, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKeyOpaque, makeSortKeyTranslucent, setSortKeyDepth, setSortKeyLayer } from '../gfx/render/GfxRenderInstManager';
import { computeModelMatrixS, computeModelMatrixSRT, getMatrixTranslation, setMatrixTranslation } from '../MathHelpers';
import { DeviceProgram } from '../Program';
import { SceneContext } from '../SceneBase';
import { TextureMapping } from '../TextureHolder';
import { assert, nArray } from '../util';
import * as Viewer from '../viewer';
import { TextureCache } from './tex';

/**
 * todo:
 *   * decals/glowing elements/selfillum
 *   * planar fog
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

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;
layout(binding = 4) uniform sampler2D u_Texture4;
layout(binding = 5) uniform sampler2D u_Texture5;
layout(binding = 6) uniform sampler2D u_Texture6;
layout(binding = 7) uniform samplerCube u_TextureCube;
`;

    public static CalcFog = `
float CalcFogFactor(in vec3 t_PositionWorld) {
#if defined USE_FOG
    float t_DistanceWorld = distance(t_PositionWorld.xyz, u_PlayerPos.xyz);
    float t_FogFactor = saturate(invlerp(u_FogDistances.x, u_FogDistances.y, t_DistanceWorld));
    t_FogFactor = min(t_FogFactor, u_FogColor.a);

    // Square the fog factor to better approximate fixed-function HW (which happens all in clip space)
    t_FogFactor *= t_FogFactor;
    return t_FogFactor;
#else
    return 0.0;
#endif
}

void CalcFog(inout vec4 t_Color, in vec3 t_PositionWorld) {
#if defined USE_FOG
    float t_FogFactor = CalcFogFactor(t_PositionWorld);
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, t_FogFactor);
#endif
}
`;

    public static vertexAttrs = `
layout(location = ${BaseProgram.a_Pos}) attribute vec3 a_Position;
layout(location = ${BaseProgram.a_Norm}) attribute vec3 a_Normal;
layout(location = ${BaseProgram.a_Binorm}) attribute vec3 a_Binormal;
layout(location = ${BaseProgram.a_Tangent}) attribute vec3 a_Tangent;
layout(location = ${BaseProgram.a_TexCoord}) in vec2 a_TexCoord;
`;

    public static CalcTangentToWorld = `
vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}
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
            BaseProgram.CalcTangentToWorld,
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
    vec4 u_Color0[8];
    vec4 u_Color1[8];
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
            fragBody.push(`vec4 t0 = texture(SAMPLER_2D(u_Texture0), uv0);`);
        } else {
            fragBody.push(`vec3 t_EyeWorld = normalize(u_PlayerPos - v_Position);`);
            fragBody.push(`vec4 t0 = texture(SAMPLER_CUBE(u_TextureCube), t_EyeWorld);`);
        }

        fragBody.push(`
vec4 t1 = texture(SAMPLER_2D(u_Texture1), uv1);
vec4 t2 = texture(SAMPLER_2D(u_Texture2), uv2);
vec4 t3 = texture(SAMPLER_2D(u_Texture3), uv3);
vec4 r0 = vec4(0.0, 0.0, 0.0, t0.a);
vec4 r1 = vec4(0.0, 0.0, 0.0, 0.0);
vec4 v0 = vec4(0.0, 0.0, 0.0, 0.0); // TODO(jstpierre): Vertex lighting
vec4 v1 = vec4(0.0, 0.0, 0.0, 0.0); // TODO(jstpierre): Vertex lighting

vec4 A, B, C, D;
vec4 AB, CD, ABCD;
`);

        function genInputColor(input: ShaderInput, stage: number): string { // vec3
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
                return `u_Color0[${stage}].rgb`;
            else if (input === _wasm!.ShaderInput.Constant1Color)
                return `u_Color1[${stage}].rgb`;
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
                return `u_Color0[${stage}].aaa`;
            else if (input === _wasm!.ShaderInput.Constant1Alpha)
                return `u_Color1[${stage}].aaa`;
            else
                throw "whoops";
        }

        function genInputAlpha(input: ShaderAlphaInput, stage: number): string { // float
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
                return `u_Color0[${stage}].a`;
            else if (input === _wasm!.ShaderAlphaInput.Constant1Alpha)
                return `u_Color1[${stage}].a`;
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
                return `u_Color0[${stage}].b`;
            else if (input === _wasm!.ShaderAlphaInput.Constant1Blue)
                return `u_Color1[${stage}].b`;
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

        function genInput(colorInput: ShaderInput, colorMapping: ShaderMapping, alphaInput: ShaderAlphaInput, alphaMapping: ShaderMapping, stage: number): string {
            const color = genMapping(genInputColor(colorInput, stage), colorMapping, true);
            const alpha = genMapping(genInputAlpha(alphaInput, stage), alphaMapping, false);
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
A = ${genInput(stage.input_a, stage.input_a_mapping, stage.input_a_alpha, stage.input_a_mapping_alpha, i)};
B = ${genInput(stage.input_b, stage.input_b_mapping, stage.input_b_alpha, stage.input_b_mapping_alpha, i)};
C = ${genInput(stage.input_c, stage.input_c_mapping, stage.input_c_alpha, stage.input_c_mapping_alpha, i)};
D = ${genInput(stage.input_d, stage.input_d_mapping, stage.input_d_alpha, stage.input_d_mapping_alpha, i)};

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

class ColorAnimationController {
    public lower = colorNewCopy(White);
    public upper = colorNewCopy(White);

    constructor(private dst: Color, private source: FunctionSource, private fn: AnimationFunction, private period: number, lower: Color, upper: Color) {
        colorCopy(this.lower, lower);
        colorCopy(this.upper, upper);
    }

    public calc(time: number): void {
        // TODO(jstpierre): How does color animation work, exactly?
        colorCopy(this.dst, this.upper);
    }
}

class MaterialRender_TransparencyGeneric {
    private textureMapping: (TextureMapping | null)[] = nArray(8, () => null);
    private animationHandlers: (TextureAnimationHandler | undefined)[];
    private mapTransform: mat4;
    private gfxProgram: GfxProgram;
    private color0: Color[] = nArray(8, () => colorNewCopy(White));
    private color0Animation: ColorAnimationController[] = [];
    private color1: Color[] = nArray(8, () => colorNewCopy(White));
    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderTransparencyGeneric, fogEnabled: boolean) {
        this.textureMapping[1] = textureCache.getTextureMapping(shader.get_bitmap(1));
        this.textureMapping[2] = textureCache.getTextureMapping(shader.get_bitmap(2));
        this.textureMapping[3] = textureCache.getTextureMapping(shader.get_bitmap(3));
        if (shader.first_map_type === _wasm!.ShaderTransparentGenericMapType.Map2D) {
            this.textureMapping[0] = textureCache.getTextureMapping(shader.get_bitmap(0));
        } else {
            this.textureMapping[7] = textureCache.getTextureMapping(shader.get_bitmap(0));
        }
        const maps = [
            this.shader.get_map(0),
            this.shader.get_map(1),
            this.shader.get_map(2),
            this.shader.get_map(3),
        ];
        this.animationHandlers = maps.map(map => map ? new TextureAnimationHandler(map) : undefined);

        this.mapTransform = mat4.create();
        const prog = new ShaderTransparencyGenericProgram(shader);
        prog.setDefineBool('USE_FOG', fogEnabled);
        this.gfxProgram = cache.createProgram(prog);
        this.sortKeyBase = makeSortKeyTranslucent(SortKey.Translucent);

        for (let i = 0; i < 8; i++) {
            const stage = this.shader.get_stage(i);
            if (stage === undefined)
                break;

            const color0_lower = stage.color0_animation_lower_bound;
            const color0_upper = stage.color0_animation_upper_bound;
            this.color0Animation.push(new ColorAnimationController(this.color0[i], stage.color0_source, stage.color0_animation_function, stage.color0_animation_period, color0_lower, color0_upper));
            color0_lower.free();
            color0_upper.free();

            const color1 = stage.color1;
            colorCopy(this.color1[i], color1);
            color1.free();

            stage.free();
        }
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
    }

    private setupMapTransform(i: number, t: number, baseMapTransform: ReadonlyMat4 | null): ReadonlyMat4 {
        const dst = this.mapTransform;
        const handler = this.animationHandlers[i];
        if (handler) {
            handler.setTransform(dst, t, baseMapTransform);
            if (baseMapTransform !== null)
                mat4.mul(dst, baseMapTransform, dst);
        } else if (baseMapTransform !== null) {
            mat4.copy(dst, baseMapTransform);
        } else {
            mat4.identity(dst);
        }
        return dst;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, baseMapTransform: ReadonlyMat4 | null): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const megaStateFlags = { depthWrite: false };
        setBlendMode(megaStateFlags, this.shader.framebuffer_blend_function);
        renderInst.setMegaStateFlags(megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 4 * 8 + 4 * 8 + 4 * 8);
        const mapped = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(0, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(1, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(2, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(3, view.time, baseMapTransform));

        for (let i = 0; i < this.color0Animation.length; i++)
            this.color0Animation[i].calc(view.time);

        for (let i = 0; i < 8; i++)
            offs += fillColor(mapped, offs, this.color0[i]);
        for (let i = 0; i < 8; i++)
            offs += fillColor(mapped, offs, this.color1[i]);

        renderInstManager.submitRenderInst(renderInst);
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
                return `${out} = ${current};`;
            case _wasm!.ShaderTransparentChicagoColorFunction.NextMap:
                return `${out} = ${next};`
            case _wasm!.ShaderTransparentChicagoColorFunction.Multiply:
                return `${out} = ${current} * ${next};`;
            case _wasm!.ShaderTransparentChicagoColorFunction.DoubleMultiply:
                return `${out} = 2.0 * ${current} * ${next};`;
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
            `vec4 t0 = texture(SAMPLER_2D(u_Texture0), uv0);`,
            `vec4 t1 = texture(SAMPLER_2D(u_Texture1), uv1);`,
            `vec4 t2 = texture(SAMPLER_2D(u_Texture2), uv2);`,
            `vec4 t3 = texture(SAMPLER_2D(u_Texture3), uv3);`,
        ];

        fragBody.push(`vec4 scratch, next, current = t0;`);

        for (let i = 0; i < maps.length - 1; i++) {
            const map = maps[i];
            fragBody.push(`next = t${i + 1};`);
            fragBody.push(this.getColorFunction('scratch.rgb', 'current.rgb', 'next.rgb', map.color_function));
            fragBody.push(this.getColorFunction('scratch.a', 'current.a', 'next.a', map.color_function));
            fragBody.push(`current = scratch;`);
        }

        fragBody.push(`gl_FragColor = current;`);
        fragBody.push(`CalcFog(gl_FragColor, v_Position);`);
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

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderTransparencyChicago, fogEnabled: boolean) {
        for (let i = 0; i < 4; i++)
            this.textureMapping[i] = textureCache.getTextureMapping(shader.get_bitmap(i));

        this.mapTransform = mat4.create();
        const prog = new ShaderTransparencyChicagoProgram(shader);
        prog.setDefineBool('USE_FOG', fogEnabled);
        this.gfxProgram = cache.createProgram(prog);
        this.sortKeyBase = makeSortKeyTranslucent(SortKey.Translucent);
        const maps = [
            this.shader.get_map(0),
            this.shader.get_map(1),
            this.shader.get_map(2),
            this.shader.get_map(3),
        ];
        this.animationHandlers = maps.map(map => map ? new TextureAnimationHandler(map) : undefined);
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
    }

    private setupMapTransform(i: number, t: number, baseMapTransform: ReadonlyMat4 | null): ReadonlyMat4 {
        const dst = this.mapTransform;
        const handler = this.animationHandlers[i];
        if (handler) {
            handler.setTransform(dst, t, baseMapTransform);
            if (baseMapTransform !== null)
                mat4.mul(dst, baseMapTransform, dst);
        } else if (baseMapTransform !== null) {
            mat4.copy(dst, baseMapTransform);
        } else {
            mat4.identity(dst);
        }
        return dst;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, baseMapTransform: ReadonlyMat4 | null): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const megaStateFlags = { depthWrite: false };
        setBlendMode(megaStateFlags, this.shader.framebuffer_blend_function);
        renderInst.setMegaStateFlags(megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 4 * 8);
        const mapped = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(0, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(1, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(2, view.time, baseMapTransform));
        offs += fillMatrix4x2(mapped, offs, this.setupMapTransform(3, view.time, baseMapTransform));

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

class ShaderTransparencyWaterModulateBackgroundProgram extends BaseProgram {
    public override frag = `
void mainPS() {
    vec4 t_BaseMap = texture(SAMPLER_2D(u_Texture0), v_UV);
    gl_FragColor.rgba = t_BaseMap;

    float t_FogFactor = CalcFogFactor(v_Position);
    // Since we mul against background, white is transparent
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), t_FogFactor);
}
`;

    constructor(public shader: HaloShaderTransparentWater) {
        super([]);
    }
}

class ShaderTransparencyWaterProgram extends BaseProgram {
    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    Mat4x2 u_RippleTransform;
    vec4 u_PerpendicularTint;
    vec4 u_ParallelTint;
};
`;

    constructor(public shader: HaloShaderTransparentWater) {
        super([ShaderTransparencyWaterProgram.BindingsDefinition]);
        this.frag = this.generateFragSection();
    }

    private generateFragSection(): string {
        const ripples = [];
        for (let i=0; i<4; i++) {
            const ripple = this.shader.get_ripple(i);
            if (ripple)
                ripples.push(ripple);
        }

        return `
void mainPS() {
    vec4 t_Base = texture(SAMPLER_2D(u_Texture0), v_UV.xy);
    vec3 t_EyeWorld = normalize(u_PlayerPos - v_Position);

    float t_ReflectionAlpha = 1.0;
    bool alpha_modulates_reflection = ${!!(this.shader.flags & 0x01)};
    if (alpha_modulates_reflection) {
        float t_Fresnel = dot(t_EyeWorld, v_Normal);
        t_ReflectionAlpha *= mix(u_ParallelTint.a, u_PerpendicularTint.a, t_Fresnel);
        t_ReflectionAlpha *= t_Base.a;
    }

    vec2 uv = Mul(u_RippleTransform, vec4(v_UV, 1.0, 1.0));
    vec4 t_BumpMap = 2.0 * texture(SAMPLER_2D(u_Texture1), uv) - 1.0;

    vec3 t_NormalWorld = normalize(CalcTangentToWorld(t_BumpMap.rgb, v_Tangent, v_Binormal, v_Normal));
    vec3 N = normalize(2.0 * dot(t_NormalWorld, t_EyeWorld) * t_NormalWorld - t_EyeWorld);

    vec3 reflectionColor = texture(SAMPLER_CUBE(u_TextureCube, N.xyz)).xyz;
    vec3 specularColor = pow(reflectionColor, vec3(8.0));

    vec3 t_MixColor = mix(u_PerpendicularTint.rgb, u_ParallelTint.rgb, 0.5);
    specularColor = mix(specularColor, reflectionColor, t_MixColor);

    gl_FragColor.rgba = vec4(specularColor, t_ReflectionAlpha);
    CalcFog(gl_FragColor, v_Position);
}
`;
    }
}

class RippleAnimation {
    public angle = 0.0;
    public velocity = 0.0;
    public offsetU = 0.0;
    public offsetV = 0.0;
    public scale = 0.0;
    public transform = mat4.create();

    public setFromRipple(ripple: HaloShaderTransparentWaterRipple) {
        this.angle = ripple.animation_angle();
        this.velocity = ripple.animation_velocity();
        this.offsetU = ripple.map_u_offset();
        this.offsetV = ripple.map_v_offset();
        this.scale = ripple.map_repeats();
    }

    public calc(time: number): ReadonlyMat4 {
        const dst = this.transform;

        dst[0] = this.scale;
        dst[5] = this.scale;

        const av = Math.sin(this.angle), au = Math.cos(this.angle);
        const timeSecs = time / 1000;
        dst[12] = this.offsetU + (this.velocity * au * timeSecs);
        dst[13] = this.offsetV + (this.velocity * av * timeSecs);

        return dst;
    }
}

class ShaderCompositeRippleProgram extends DeviceProgram {
    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    Mat4x2 u_MapTransform0;
    Mat4x2 u_MapTransform1;
    Mat4x2 u_MapTransform2;
    Mat4x2 u_MapTransform3;
    vec4 u_Misc[1];
};
`;

    public override vert = `
${ShaderCompositeRippleProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${ShaderCompositeRippleProgram.BindingsDefinition}
in vec2 v_TexCoord;

layout(binding = 0) uniform sampler2D u_Texture0;
layout(binding = 1) uniform sampler2D u_Texture1;
layout(binding = 2) uniform sampler2D u_Texture2;
layout(binding = 3) uniform sampler2D u_Texture3;

void mainPS() {
    vec2 uv0 = Mul(u_MapTransform0, vec4(v_TexCoord, 1.0, 1.0));
    vec2 uv1 = Mul(u_MapTransform1, vec4(v_TexCoord, 1.0, 1.0));
    vec2 uv2 = Mul(u_MapTransform2, vec4(v_TexCoord, 1.0, 1.0));
    vec2 uv3 = Mul(u_MapTransform3, vec4(v_TexCoord, 1.0, 1.0));

    vec4 t_BumpMap0 = 2.0 * texture(SAMPLER_2D(u_Texture0), uv0) - 1.0;
    vec4 t_BumpMap1 = 2.0 * texture(SAMPLER_2D(u_Texture1), uv1) - 1.0;
    vec4 t_BumpMap2 = 2.0 * texture(SAMPLER_2D(u_Texture2), uv2) - 1.0;
    vec4 t_BumpMap3 = 2.0 * texture(SAMPLER_2D(u_Texture3), uv3) - 1.0;

    vec4 t_BumpMap01 = mix(t_BumpMap0, t_BumpMap1, 0.5);
    vec4 t_BumpMap23 = mix(t_BumpMap2, t_BumpMap3, 0.5);
    vec4 t_BumpMap = mix(t_BumpMap01, t_BumpMap23, 0.5);
    t_BumpMap.rgb = mix(t_BumpMap.rgb, vec3(0.0, 0.0, 1.0), u_Misc[0].x);
    gl_FragColor = vec4(t_BumpMap.rgb * 0.5 + 0.5, 1.0);
}
`;
}

class MaterialRender_TransparencyWater {
    private rippleTexture: GfxTexture;
    private rippleTextureSize: number = 128;
    private rippleCompositeProgram: GfxProgram;
    private rippleCompositeMapping = nArray(4, () => new TextureMapping());
    private rippleCompositeAnimation: RippleAnimation[] = nArray(4, () => new RippleAnimation());

    private waterProgram: GfxProgram;
    private waterModulateBackgroundProgram: GfxProgram;
    private textureMapping: (TextureMapping | null)[] = nArray(8, () => null);
    private rippleTransformAnimation = new RippleAnimation();
    private perpendicularTint = vec4.create();
    private parallelTint = vec4.create();

    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderTransparentWater, fogEnabled: boolean) {
        const device = cache.device;
        this.rippleTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.rippleTextureSize, this.rippleTextureSize, this.shader.ripple_mipmap_levels));

        this.textureMapping[0] = textureCache.getTextureMapping(shader.get_base_bitmap(), 0, { wrap: false });
        this.textureMapping[7] = textureCache.getTextureMapping(shader.get_reflection_bitmap());

        this.textureMapping[1] = new TextureMapping();
        this.textureMapping[1].gfxTexture = this.rippleTexture;
        this.textureMapping[1].gfxSampler = textureCache.getSampler({ wrap: true });

        this.rippleCompositeProgram = cache.createProgram(new ShaderCompositeRippleProgram());

        const ripple_bitmap = shader.get_ripple_bitmap();
        for (let i = 0; i < 4; i++) {
            const ripple = shader.get_ripple(i);
            if (!ripple)
                break;

            this.rippleCompositeMapping[i] = textureCache.getTextureMapping(ripple_bitmap, ripple.map_index());
            this.rippleCompositeAnimation[i].setFromRipple(ripple);
            ripple.free();
        }

        this.rippleTransformAnimation.angle = this.shader.ripple_animation_angle;
        this.rippleTransformAnimation.velocity = this.shader.ripple_animation_velocity;
        this.rippleTransformAnimation.scale = this.shader.ripple_scale;

        const perpendicular_tint_color = this.shader.view_perpendicular_tint_color;
        const parallel_tint_color = this.shader.view_parallel_tint_color;
        vec4.set(this.perpendicularTint, perpendicular_tint_color.r, perpendicular_tint_color.g, perpendicular_tint_color.b, this.shader.view_perpendicular_brightness);
        vec4.set(this.parallelTint, parallel_tint_color.r, parallel_tint_color.g, parallel_tint_color.b, this.shader.view_parallel_brightness);
        perpendicular_tint_color.free();
        parallel_tint_color.free();

        const prog1 = new ShaderTransparencyWaterProgram(shader);
        prog1.setDefineBool('USE_FOG', fogEnabled);
        this.waterProgram = cache.createProgram(prog1);

        const prog2 = new ShaderTransparencyWaterModulateBackgroundProgram(shader);
        prog2.setDefineBool('USE_FOG', fogEnabled);
        this.waterModulateBackgroundProgram = cache.createProgram(prog2);

        this.sortKeyBase = makeSortKeyTranslucent(SortKey.Translucent);
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
        // Build normal map
        const desc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_NORM);
        desc.width = this.rippleTextureSize;
        desc.height = this.rippleTextureSize;
        desc.numLevels = this.shader.ripple_mipmap_levels;
        desc.sampleCount = 1;
        const renderTarget = builder.createRenderTargetID(desc, "Ripple Mipmap");

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 4 }]);
        template.setInputLayoutAndState(null, null);
        template.setGfxProgram(this.rippleCompositeProgram);
        template.setMegaStateFlags(fullscreenMegaState);
        template.setSamplerBindingsFromTextureMappings(this.rippleCompositeMapping);
        template.drawPrimitives(3);

        for (let i = 0; i < this.shader.ripple_mipmap_levels; i++) {
            builder.pushPass((pass) => {
                pass.setDebugName(`Ripple Mipmap ${i}`);
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, renderTarget, i);

                const renderInst = renderInstManager.newRenderInst();

                let offs = renderInst.allocateUniformBuffer(0, 4 * 8 + 4);
                const d = renderInst.mapUniformBufferF32(0);

                for (let i = 0; i < this.rippleCompositeAnimation.length; i++)
                    offs += fillMatrix4x2(d, offs, this.rippleCompositeAnimation[i].calc(view.time));

                const fade = this.shader.ripple_mipmap_levels > 1 ? (i / (this.shader.ripple_mipmap_levels - 1)) * this.shader.ripple_mipmap_fade_factor : 0;
                offs += fillVec4(d, offs, fade);

                pass.exec((passRenderer) => {
                    renderInst.drawOnPass(cache, passRenderer);
                });
            });
            builder.resolveRenderTargetToExternalTexture(renderTarget, this.rippleTexture, i);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, baseMapTransform: ReadonlyMat4 | null): void {
        if (!!(this.shader.flags & 0x02)) { // color modulates background
            const renderInst = renderInstManager.newRenderInst();

            renderInst.setGfxProgram(this.waterModulateBackgroundProgram);
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

            const megaStateFlags = { depthWrite: false, cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW };
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.Dst,
                blendDstFactor: GfxBlendFactor.Zero,
            });
            renderInst.setMegaStateFlags(megaStateFlags);

            // have to allocate something
            let offs = renderInst.allocateUniformBuffer(ShaderTransparencyWaterProgram.ub_ShaderParams, 4);

            renderInstManager.submitRenderInst(renderInst);
        }

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.waterProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const megaStateFlags = { depthWrite: false, cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW };
        if (baseMapTransform !== null) {
            // Skybox water doesn't seem to get a blend? WTF? Skybox water in a30
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
        } else {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
        }
        renderInst.setMegaStateFlags(megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderTransparencyWaterProgram.ub_ShaderParams, 4 * 2 + 4 * 2);
        const mapped = renderInst.mapUniformBufferF32(ShaderTransparencyWaterProgram.ub_ShaderParams);

        offs += fillMatrix4x2(mapped, offs, this.rippleTransformAnimation.calc(view.time));
        offs += fillVec4v(mapped, offs, this.perpendicularTint);
        offs += fillVec4v(mapped, offs, this.parallelTint);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
        device.destroyTexture(this.rippleTexture);
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

    public setTransform(out: mat4, t: number, baseMapTransform: ReadonlyMat4 | null) {
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
vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture0), Mul(u_BaseMapTransform, vec4(v_UV, 1.0, 1.0))).rgba;
gl_FragColor.rgba = t_BaseTexture.rgba;
CalcFog(gl_FragColor, v_Position);
`);

        if (!(this.shader.flags & 0x04)) { // "not alpha tested"
            fragBody.push(`
if (t_BaseTexture.a < 0.5)
    discard;
`);
        }

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
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    public sortKeyBase: number = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderModel, fogEnabled: boolean) {
        this.textureMapping[0] = textureCache.getTextureMapping(shader.get_base_bitmap());
        this.textureMapping[1] = textureCache.getTextureMapping(shader.get_detail_bitmap());
        if (shader.has_reflection_cube_map)
            this.textureMapping[7] = textureCache.getTextureMapping(shader.get_reflection_cube_map());
        this.textureMapping[5] = textureCache.getTextureMapping(shader.get_multipurpose_map());

        const prog = new ShaderModelProgram(shader);
        prog.setDefineBool('USE_FOG', fogEnabled);
        this.gfxProgram = cache.createProgram(prog);
        this.sortKeyBase = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, this.gfxProgram.ResourceUniqueId);

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        if (!!(this.shader.flags & 0x02)) { // "two sided"
            this.megaStateFlags.cullMode = GfxCullMode.None;
        } else {
            this.megaStateFlags.cullMode = GfxCullMode.Back;
        }
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, baseMapTransform: ReadonlyMat4 | null): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ShaderModelProgram.ub_ShaderParams, 16);
        const d = renderInst.mapUniformBufferF32(ShaderModelProgram.ub_ShaderParams);

        if (baseMapTransform !== null)
            offs += fillMatrix4x2(d, offs, baseMapTransform);
        else
            offs += fillMatrix4x2(d, offs, mat4.create());

        renderInstManager.submitRenderInst(renderInst);
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

    public static BindingsDefinition = `
layout(std140) uniform ub_ShaderParams {
    vec4 u_ReflectionPerpendicularColor;
    vec4 u_ReflectionParallelColor;
};
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
        super([ShaderEnvironmentProgram.varying, ShaderEnvironmentProgram.BindingsDefinition]);
        this.generateFragmentShader();
    }

    private getDetailSection(fragBody: String[]): void {
        fragBody.push(`vec2 primaryUV = v_UV * ${glslGenerateFloat(this.shader!.primary_detail_bitmap_scale)};`)
        fragBody.push(`vec4 primaryDetail = texture(SAMPLER_2D(u_Texture3), primaryUV);`)
        fragBody.push(`vec2 secondaryUV = v_UV * ${glslGenerateFloat(this.shader!.secondary_detail_bitmap_scale)};`)
        fragBody.push(`vec4 secondaryDetail = texture(SAMPLER_2D(u_Texture4), secondaryUV);`)
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
        fragBody.push(`vec4 microDetail = texture(SAMPLER_2D(u_Texture5), microUV);`)
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
vec3 reflectionColor = texture(SAMPLER_CUBE(u_TextureCube, N.xyz)).xyz;
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
vec4 base = texture(SAMPLER_2D(u_Texture0), v_UV);
vec4 color = base;
vec2 t_BumpTexCoord = v_UV * ${glslGenerateFloat(this.shader!.bump_map_scale)};
vec4 t_BumpMap = 2.0 * texture(SAMPLER_2D(u_Texture2), t_BumpTexCoord) - 1.0;
vec3 t_EyeWorld = normalize(u_PlayerPos - v_Position);
`);

            if (this.shader!.has_bump_map) {
                fragBody.push(`vec3 t_NormalWorld = normalize(CalcTangentToWorld(t_BumpMap.rgb, v_Tangent, v_Binormal, v_Normal));`);
            } else {
                fragBody.push(`vec3 t_NormalWorld = v_Normal;`);
            }

            if (this.has_lightmap) {
                fragBody.push(`
vec3 t_LightmapSample = texture(SAMPLER_2D(u_Texture1), v_lightmapUV).rgb;
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
                fragBody.push(`vec4 color = texture(SAMPLER_2D(u_Texture1), v_lightmapUV);`);
            } else {
                fragBody.push(`vec4 color = vec4(1.0, 0.0, 1.0, 1.0);`);
            }
        }

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
    public sortKeyBase = 0;
    public visible = true;

    constructor(textureCache: TextureCache, cache: GfxRenderCache, private shader: HaloShaderEnvironment, lightmapMapping: TextureMapping | null, fogEnabled: boolean) {
        const prog = new ShaderEnvironmentProgram(shader, !!lightmapMapping);
        prog.setDefineBool('USE_FOG', fogEnabled);
        this.gfxProgram = cache.createProgram(prog);
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
            null,
            this.shader && this.shader.has_reflection_cube_map ? textureCache.getTextureMapping(this.shader.get_reflection_cube_map()) : null,
        ];

        this.sortKeyBase = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, this.gfxProgram.ResourceUniqueId);
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: View, baseMapTransform: ReadonlyMat4 | null): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        let offs = renderInst.allocateUniformBuffer(ShaderEnvironmentProgram.ub_ShaderParams, 3 * 16);
        let mapped = renderInst.mapUniformBufferF32(ShaderEnvironmentProgram.ub_ShaderParams);
        offs += fillVec4v(mapped, offs, this.perpendicularColor);
        offs += fillVec4v(mapped, offs, this.parallelColor);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shader.free();
    }
}

type MaterialRender = MaterialRender_Environment | MaterialRender_TransparencyChicago | MaterialRender_TransparencyGeneric | MaterialRender_Model | MaterialRender_TransparencyWater;

class LightmapRenderer {
    public modelData: LightmapModelData[];
    public materialRenderers: (MaterialRender | null)[];
    public visible = true;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public trisBuf: GfxBuffer, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number, public lightmap: HaloLightmap, public lightmapTex: TextureMapping | null, public fogEnabled: boolean) {
        this.modelData = [];
        this.materialRenderers = [];
        mgr.get_lightmap_materials(lightmap).forEach(material => {
            const shader = this.mgr.get_material_shader(material);
            if (shader instanceof _wasm!.HaloShaderEnvironment) {
                this.materialRenderers.push(new MaterialRender_Environment(textureCache, renderCache, shader, lightmapTex, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyGeneric) {
                this.materialRenderers.push(new MaterialRender_TransparencyGeneric(textureCache, renderCache, shader, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyChicago) {
                this.materialRenderers.push(new MaterialRender_TransparencyChicago(textureCache, renderCache, shader, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparentWater) {
                this.materialRenderers.push(new MaterialRender_TransparencyWater(textureCache, renderCache, shader, fogEnabled));
            } else {
                this.materialRenderers.push(null);
            }

            this.modelData.push(new LightmapModelData(renderCache, mgr, bsp, material, trisBuf));
        });
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
        for (let i = 0; i < this.materialRenderers.length; i++)
            this.materialRenderers[i]?.pushPasses(cache, builder, renderInstManager, view);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        if (!this.visible)
            return;

        this.materialRenderers.forEach((materialRenderer, i) => {
            if (!materialRenderer)
                return;

            if (!materialRenderer.visible)
                return;

            const template = renderInstManager.pushTemplateRenderInst();
            template.sortKey = materialRenderer.sortKeyBase;

            this.modelData[i].setOnRenderInst(template);
            materialRenderer.prepareToRender(renderInstManager, mainView, null);

            renderInstManager.popTemplateRenderInst();
        });
    }

    public destroy(device: GfxDevice) {
        this.modelData.forEach(r => r.destroy(device));
    }
}

class LightmapModelData {
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

class ModelRenderer {
    private materialRenderers: (MaterialRender | null)[] = [];

    public baseMapTransform = mat4.create();

    // per part
    public isSkybox: boolean = false;
    public visible = true;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public mgr: HaloSceneManager, public model: HaloModel, public modelMatrix: mat4, public modelData: ModelData, fogEnabled: boolean) {
        const shaders = mgr.get_model_shaders(this.model);
        shaders.forEach(shader => {
            if (shader instanceof _wasm!.HaloShaderModel) {
                this.materialRenderers.push(new MaterialRender_Model(textureCache, renderCache, shader, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyGeneric) {
                this.materialRenderers.push(new MaterialRender_TransparencyGeneric(textureCache, renderCache, shader, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparencyChicago) {
                this.materialRenderers.push(new MaterialRender_TransparencyChicago(textureCache, renderCache, shader, fogEnabled));
            } else if (shader instanceof _wasm!.HaloShaderTransparentWater) {
                this.materialRenderers.push(new MaterialRender_TransparencyWater(textureCache, renderCache, shader, fogEnabled));
            } else {
                this.materialRenderers.push(null);
            }
        });

        computeModelMatrixS(this.baseMapTransform, this.model.get_base_bitmap_u_scale(), this.model.get_base_bitmap_v_scale());
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.materialRenderers.length; i++)
            this.materialRenderers[i]?.pushPasses(cache, builder, renderInstManager, view);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(BaseProgram.ub_ModelParams, 16);
        let mapped = template.mapUniformBufferF32(BaseProgram.ub_ModelParams);
        offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

        this.modelData.setOnRenderInst(template);

        this.modelData.parts.forEach((part) => {
            const materialRenderer = this.materialRenderers[part.shaderIndex];

            if (!materialRenderer)
                return; // Renderer will return...

            if (!materialRenderer.visible)
                return;

            const template = renderInstManager.pushTemplateRenderInst();
            part.setOnRenderInst(template);

            // TODO: Part AABB?
            template.sortKey = materialRenderer.sortKeyBase;

            // XXX(jstpierre): This is a bit ugly... perhaps do skyboxen in a different render pass?
            if (this.isSkybox)
                template.sortKey = setSortKeyLayer(template.sortKey, SortKey.Skybox);

            getMatrixTranslation(scratchVec3a, this.modelMatrix);
            const depth = computeViewSpaceDepthFromWorldSpacePoint(mainView.viewFromWorldMatrix, scratchVec3a);

            template.sortKey = setSortKeyDepth(template.sortKey, depth);
            materialRenderer.prepareToRender(renderInstManager, mainView, this.baseMapTransform);

            renderInstManager.popTemplateRenderInst();
        });

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        this.materialRenderers.forEach((materialRenderer) => materialRenderer?.destroy(device));
    }
}

class ModelPartData {
    public indexCount = 0;
    public shaderIndex: number;
    public origIndex: number;

    constructor(private part: HaloModelPart, public indexStart: number) {
        this.shaderIndex = part.shader_index;
        this.origIndex = (part as any).index;
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.drawIndexes(this.indexCount, this.indexStart);
    }

    public destroy(device: GfxDevice): void {
        this.part.free();
    }
}

class ModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    public parts: ModelPartData[] = [];

    constructor(cache: GfxRenderCache, mgr: HaloSceneManager, private model: HaloModel) {
        // TODO(jstpierre): Do this draw combining in Rust?
        const parts = mgr.get_model_parts(this.model) as HaloModelPart[];
        parts.forEach((part, i) => {
            (part as any).index = i;
        });

        // Group draws that are the same shader.
        // TODO(jstpierre): We can't group parts that are transparent shaders... but for now we'll pretend.
        parts.sort((a, b) => {
            return a.shader_index - b.shader_index;
        });

        let vertexCount = 0, indexCount = 0;
        for (let i = 0; i < parts.length; i++) {
            vertexCount += parts[i].vert_count;
            indexCount += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriStrips, parts[i].tri_count);
        }
        assert(vertexCount <= 0xFFFF);

        const device = cache.device;
        this.vertexBuffer = device.createBuffer((vertexCount * 68) >>> 2, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static);

        const indexData = new Uint16Array(indexCount);

        let indexOffs = 0, vertexOffs = 0, vertexBase = 0;

        for (let i = 0; i < parts.length; i++) {
            const shaderIndex = parts[i].shader_index;

            if (this.parts[shaderIndex] === undefined)
                this.parts[shaderIndex] = new ModelPartData(parts[i], indexOffs);

            const indexBuffer = mgr.get_model_part_indices(parts[i]);

            // convertToTriangles(indexData, indexOffs, GfxTopology.TriStrips, indexBuffer);
            // Inlined to support vertexBase
            for (let i = 0; i < indexBuffer.length - 2; i++) {
                if (i % 2 === 0) {
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 0];
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 1];
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 2];
                } else {
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 1];
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 0];
                    indexData[indexOffs++] = vertexBase + indexBuffer[i + 2];
                }
            }
            this.parts[shaderIndex].indexCount += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriStrips, indexBuffer.length);

            const vertexData = mgr.get_model_part_vertices(parts[i]);
            device.uploadBufferData(this.vertexBuffer, vertexOffs, vertexData);
            vertexOffs += vertexData.byteLength;
            vertexBase += parts[i].vert_count;
        }

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData.buffer);

        this.inputLayout = this.getInputLayout(cache);
        this.inputState = device.createInputState(this.inputLayout, [{ buffer: this.vertexBuffer, byteOffset: 0 }], { buffer: this.indexBuffer, byteOffset: 0 });

        this.parts.sort((a, b) => {
            return a.origIndex - b.origIndex;
        });
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
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
        this.model.free();
        this.parts.forEach((part) => part.destroy(device));
    }
}

class SceneryRenderer {
    public modelRenderers: ModelRenderer[];
    public model: HaloModel | undefined;
    public modelData: ModelData | null = null;
    public visible = true;

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public mgr: HaloSceneManager, public scenery: HaloScenery, public instances: HaloSceneryInstance[], fogEnabled: boolean) {
        this.model = mgr.get_scenery_model(this.scenery);
        if (this.model) {
            this.modelData = new ModelData(renderCache, mgr, this.model);
            this.modelRenderers = this.instances.map(instance => {
                const instModelMatrix = mat4.create();
                computeModelMatrixSRT(instModelMatrix, 1, 1, 1,
                    instance.rotation.roll, instance.rotation.pitch, instance.rotation.yaw,
                    instance.position.x + this.scenery.origin_offset.x,
                    instance.position.y + this.scenery.origin_offset.y,
                    instance.position.z + this.scenery.origin_offset.z);
                return new ModelRenderer(this.textureCache, renderCache, this.mgr, this.model!, instModelMatrix, this.modelData!, fogEnabled);
            });
        } else {
            assert(this.instances.length === 0);
            this.modelRenderers = [];
        }
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
        for (let i = 0; i < this.modelRenderers.length; i++)
            this.modelRenderers[i].pushPasses(cache, builder, renderInstManager, view);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, mainView: View): void {
        if (!this.visible)
            return;

        this.modelRenderers.forEach(m => m.prepareToRender(renderInstManager, mainView));
    }

    public destroy(device: GfxDevice) {
        this.modelRenderers.forEach(m => m.destroy(device));
        if (this.modelData !== null)
            this.modelData.destroy(device);
        this.scenery.free();
    }
}

class BSPRenderer {
    public trisBuf: GfxBuffer;
    public lightmapRenderers: LightmapRenderer[];

    constructor(public textureCache: TextureCache, renderCache: GfxRenderCache, public bsp: HaloBSP, public mgr: HaloSceneManager, public bspIndex: number, public fogEnabled: boolean) {
        this.trisBuf = makeStaticDataBuffer(renderCache.device, GfxBufferUsage.Index, mgr.get_bsp_indices(this.bsp).buffer);
        const lightmapsBitmap = this.bsp.get_lightmaps_bitmap();
        this.lightmapRenderers = mgr.get_bsp_lightmaps(this.bsp).map(lightmap => {
            let lightmapTex: TextureMapping | null = null;
            if (lightmapsBitmap && lightmap.get_bitmap_index() !== 65535) {
                lightmapTex = this.textureCache.getTextureMapping(lightmapsBitmap!, lightmap.get_bitmap_index());
            }
            return new LightmapRenderer(this.textureCache, renderCache, this.trisBuf, this.bsp, this.mgr, this.bspIndex, lightmap, lightmapTex, fogEnabled);
        });
    }

    public pushPasses(cache: GfxRenderCache, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, view: View): void {
        for (let i = 0; i < this.lightmapRenderers.length; i++)
            this.lightmapRenderers[i].pushPasses(cache, builder, renderInstManager, view);
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
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, }, // 6
        { dimension: GfxTextureDimension.Cube, formatKind: GfxSamplerFormatKind.Float, }, // 7
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
    public skyboxData: ModelData | null = null;
    public activeSky: HaloSky | undefined;
    public fogEnabled: boolean
    public fogColor = vec4.create();
    public fogDistances = vec4.create();
    private mainView = new View();

    constructor(public device: GfxDevice, public mgr: HaloSceneManager, public bitmapReader: HaloBitmapReader, public fogSettings: FogSettings) {
        this.bspRenderers = [];
        this.renderHelper = new GfxRenderHelper(device);
        this.textureCache = new TextureCache(this.renderHelper.renderCache, this.mgr, bitmapReader);
        // for now, just choose the first skybox. eventually we'll want to switch between them depending on the current BSP
        this.activeSky = mgr.get_skies()[0];
        this.setupFogSettings();
        if (this.activeSky !== undefined) {
            const color = this.activeSky.outdoor_fog_color;
            vec4.set(this.fogColor, color.r, color.g, color.b, this.activeSky.outdoor_fog_max_density);
            color.free();
            vec4.set(this.fogDistances, this.activeSky.outdoor_fog_start_distance, this.activeSky.outdoor_fog_opaque_distance, 0, 0);
            const modelMatrix = mat4.create();
            const skyModel = this.activeSky.get_model();
            if (skyModel) {
                const skyModelData = new ModelData(this.renderHelper.renderCache, mgr, skyModel);
                this.skyboxData = skyModelData;
                this.skyboxRenderer = new ModelRenderer(this.textureCache, this.renderHelper.renderCache, mgr, skyModel, modelMatrix, skyModelData, this.fogEnabled);
                this.skyboxRenderer.isSkybox = true;
            }
        }
        const sceneryInstances: HaloSceneryInstance[] = mgr.get_scenery_instances();
        this.sceneryRenderers = mgr.get_scenery_palette().map((scenery, i) => {
            const instances = sceneryInstances.filter(instance => instance.scenery_type === i);
            return new SceneryRenderer(this.textureCache, this.renderHelper.renderCache, this.mgr, scenery, instances, this.fogEnabled);
        });
    }

    private setupFogSettings() {
        this.fogEnabled = this.fogSettings !== FogSettings.Disabled;
        if (this.activeSky && this.fogEnabled) {
            const fogLocation = this.fogSettings === FogSettings.Outdoor ? 'outdoor' : 'indoor';
            const color =  this.activeSky[`${fogLocation}_fog_color`];
            this.fogColor = vec4.fromValues(color.r, color.g, color.b, this.activeSky[`${fogLocation}_fog_max_density`]);
            color.free();
            this.fogDistances = vec4.fromValues(this.activeSky[`${fogLocation}_fog_start_distance`], this.activeSky[`${fogLocation}_fog_opaque_distance`], 0, 0);
        } else {
            this.fogEnabled = false;
            this.fogColor = vec4.create();
            this.fogDistances = vec4.create();
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/1000);
    }

    public addBSP(bsp: HaloBSP, bspIndex: number) {
        this.bspRenderers.push(new BSPRenderer(this.textureCache, this.renderHelper.renderCache, bsp, this.mgr, bspIndex, this.fogEnabled));
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
        });

        this.sceneryRenderers.forEach(r => r.prepareToRender(this.renderHelper.renderInstManager, this.mainView));
        if (this.skyboxRenderer) {
            this.skyboxRenderer.prepareToRender(this.renderHelper.renderInstManager, this.mainView)
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const cache = this.renderHelper.renderCache;
        viewerInput.camera.setClipPlanes(0.01);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].pushPasses(cache, builder, renderInstManager, this.mainView);
        for (let i = 0; i < this.sceneryRenderers.length; i++)
            this.sceneryRenderers[i].pushPasses(cache, builder, renderInstManager, this.mainView);
        if (this.skyboxRenderer)
            this.skyboxRenderer.pushPasses(cache, builder, renderInstManager, this.mainView);
        renderInstManager.popTemplateRenderInst();

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
        if (this.activeSky)
            this.activeSky.free();
        if (this.skyboxData !== null)
            this.skyboxData.destroy(device);
        this.mgr.free();
    }
}

const pathBase = `Halo1`;

enum FogSettings {
    Indoor,
    Outdoor,
    Disabled,
}

class HaloSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public specificBSPs: number[] = [], public fogSettings = FogSettings.Outdoor) {
        this.id;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const wasm = await loadWasm();
        wasm.init_panic_hook();
        const bitmapReader = await context.dataShare.ensureObject(`${pathBase}/BitmapReader`, async () => {
            const resourceMapData = await dataFetcher.fetchData(`${pathBase}/maps/bitmaps.map`);
            const bitmapReader = wasm.HaloBitmapReader.new(resourceMapData.createTypedArray(Uint8Array));
            bitmapReader.destroy = () => { // hax!!
                bitmapReader.free();
            };
            return bitmapReader;
        });
        const mapName = this.id.split('-')[0];
        const mapData = await dataFetcher.fetchData(`${pathBase}/maps/${mapName}.map`);
        const mapManager = wasm.HaloSceneManager.new(mapData.createTypedArray(Uint8Array));
        const renderer = new HaloScene(device, mapManager, bitmapReader, this.fogSettings);
        let bsps = mapManager.get_bsps();
        if (this.specificBSPs.length > 0) {
            bsps = bsps.filter((_, i) => this.specificBSPs.indexOf(i) >= 0);
        }
        bsps.forEach((bsp, i) => renderer.addBSP(bsp, i));
        return renderer;
    }

}

const id = 'Halo';
const name = 'Halo';

const sceneDescs = [
    "Multiplayer",
    new HaloSceneDesc("bloodgulch", "Blood Gulch"),
    new HaloSceneDesc("beavercreek", "Battle Creek"),
    new HaloSceneDesc("boardingaction", "Boarding Action"),
    new HaloSceneDesc("chillout", "Chill Out"),
    new HaloSceneDesc("putput", "Chiron TL-34"),
    new HaloSceneDesc("damnation", "Damnation"),
    new HaloSceneDesc("dangercanyon", "Danger Canyon"),
    new HaloSceneDesc("deathisland", "Death Island"),
    new HaloSceneDesc("carousel", "Derelict"),
    new HaloSceneDesc("gephyrophobia", "Gephyrophobia"),
    new HaloSceneDesc("hangemhigh", "Hang 'em High"),
    new HaloSceneDesc("icefields", "Ice Fields"),
    new HaloSceneDesc("infinity", "Infinity"),
    new HaloSceneDesc("longest", "Longest"),
    new HaloSceneDesc("prisoner", "Prisoner"),
    new HaloSceneDesc("ratrace", "Rat Race"),
    new HaloSceneDesc("sidewinder", "Sidewinder"),
    new HaloSceneDesc("timberland", "Timberland"),
    new HaloSceneDesc("wizard", "Wizard"),
    "Campaign",
    new HaloSceneDesc("a10", "Pillar of Autumn", [0, 1, 2, 3, 4, 5, 6, 7], FogSettings.Disabled), // the BSPs don't all play nice here
    new HaloSceneDesc("a30", "Halo"),
    new HaloSceneDesc("a50-1", "Truth and Reconciliation - Outside", [0]),
    new HaloSceneDesc("a50-2", "Truth and Reconciliation - Inside", [1, 2, 3]),
    new HaloSceneDesc("b30", "The Silent Cartographer"),
    new HaloSceneDesc("b40", "Assault on the Control Room"),
    new HaloSceneDesc("c10", "343 Guilty Spark"),
    new HaloSceneDesc("c20", "The Library", [], FogSettings.Disabled),
    new HaloSceneDesc("c40", "Two Betrayals"),
    new HaloSceneDesc("d20", "Keyes"),
    new HaloSceneDesc("d40", "The Maw"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, hidden: false };
