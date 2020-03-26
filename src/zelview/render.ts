
import * as Viewer from '../viewer';
import * as F3DZEX from './f3dzex';
import * as RDP from '../Common/N64/RDP';
import { DeviceProgram } from "../Program";
import { Texture, getImageFormatString, Vertex, DrawCall, getTextFiltFromOtherModeH, OtherModeL_Layout, translateBlendMode, RSP_Geometry, RSPSharedOutput, getCycleTypeFromOtherModeH, OtherModeH_CycleType } from "./f3dzex";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray, align } from '../util';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TextFilt } from '../Common/N64/Image';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

export class F3DZEX_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    public static ub_CombineParams = 2;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
#ifdef TEXTURE_GEN
    vec4 u_LookAtVectors[2];
#endif
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_ModelView;
    Mat4x2 u_TexMatrix[2];
};

uniform ub_CombineParameters {
    vec4 u_PrimColor;
    vec4 u_EnvColor;
    float u_Lighting;
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;

const vec4 t_Zero = vec4(0.0);
const vec4 t_One = vec4(1.0);
`;

    public vert = `
layout(location = ${F3DZEX_Program.a_Position}) in vec4 a_Position;
layout(location = ${F3DZEX_Program.a_Color}) in vec4 a_Color;
layout(location = ${F3DZEX_Program.a_TexCoord}) in vec2 a_TexCoord;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position.xyz, 1.0)));
    v_Color = t_One;

#ifdef USE_VERTEX_COLOR
    v_Color = a_Color;
#endif

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    if (u_Lighting != 0.0) {
        // convert (unsigned) colors to normal vector components
        vec3 t_Normal = 2.0*a_Color.rgb - 2.0*trunc(2.0*a_Color.rgb);
        t_Normal = normalize(t_Normal);
        // TODO: If the model matrix is non-identity, the normal must be transformed by the normal matrix:
        // normalMatrix = transpose(inverse(modelMatrix))
        // We don't use a model matrix right now, so the normal matrix is omitted.

        vec3 lightDirection = normalize(vec3(1, 1, 1));
        float intensity = max(0.0, dot(t_Normal, lightDirection));
        vec3 ambient = vec3(0.25, 0.25, 0.25);
        vec3 lightColor = vec3(1.0, 1.0, 1.0);
        v_Color.rgb = ambient + intensity * lightColor;
    }

    v_TexCoord.xy = Mul(u_TexMatrix[0], vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = Mul(u_TexMatrix[1], vec4(a_TexCoord, 1.0, 1.0));

#ifdef TEXTURE_GEN
    // generate texture coordinates based on the vertex normal in screen space

    // convert (unsigned) colors to normal vector components
    vec4 t_Normal = vec4(2.0*a_Color.rgb - 2.0*trunc(2.0*a_Color.rgb), 0.0);
    t_Normal = normalize(t_Normal);
    t_Normal.xy = vec2(dot(t_Normal, u_LookAtVectors[0]), dot(t_Normal, u_LookAtVectors[1]));

    // shift and rescale to tex coordinates - straight towards the camera is the center
#   ifdef TEXTURE_GEN_LINEAR
        v_TexCoord.xy = acos(t_Normal.xy)/radians(180.0);
#   else
        v_TexCoord.xy = (t_Normal.xy + vec2(1.0))/2.0;
#   endif

    v_TexCoord.zw = v_TexCoord.xy;
#endif
}
`;

    constructor(private DP_OtherModeH: number, private DP_OtherModeL: number, private DP_Combine: RDP.CombineParams) {
        super();
        if (getCycleTypeFromOtherModeH(DP_OtherModeH) === OtherModeH_CycleType.G_CYC_2CYCLE)
            this.defines.set("TWO_CYCLE", "1");
        this.frag = this.generateFrag();
    }

    private generateAlphaTest(): string {
        const alphaCompare = (this.DP_OtherModeL >>> 0) & 0x03;
        const cvgXAlpha = (this.DP_OtherModeL >>> OtherModeL_Layout.CVG_X_ALPHA) & 0x01;
        let alphaThreshold = 0;
        if (alphaCompare === 0x01) {
            alphaThreshold = 0.5; // actually blend color, seems to always be 0.5
        } else if (alphaCompare != 0x00) {
            alphaThreshold = .0125; // should be dither
        } else if (cvgXAlpha != 0x00) {
            // this line is taken from GlideN64, but here's some rationale:
            // With this bit set, the pixel coverage value is multiplied by alpha
            // before being sent to the blender. While coverage mostly matters for
            // the n64 antialiasing, a pixel with zero coverage will be ignored.
            // Since coverage is really an integer from 0 to 8, we assume anything
            // less than 1 would be truncated to 0, leading to the value below.
            alphaThreshold = 0.125;
        }

        if (alphaThreshold > 0) {
            return `
    if (t_Color.a < ${alphaThreshold})
        discard;
`;
        } else {
            return "";
        }
    }

    private generateFrag(): string {
        const textFilt = getTextFiltFromOtherModeH(this.DP_OtherModeH);
        let texFiltStr: string;
        if (textFilt === TextFilt.G_TF_POINT)
            texFiltStr = 'Point';
        else if (textFilt === TextFilt.G_TF_AVERAGE)
            texFiltStr = 'Average';
        else if (textFilt === TextFilt.G_TF_BILERP)
            texFiltStr = 'Bilerp';
        else
            throw "whoops";

        const colorInputs: string[] = [
            't_CombColor.rgb', 't_Tex0.rgb', 't_Tex1.rgb', 'u_PrimColor.rgb',
            'v_Color.rgb', 'u_EnvColor.rgb', 't_One.rgb', 't_Zero.rgb'
        ];

        const multInputs: string[] = [
            't_CombColor.rgb', 't_Tex0.rgb', 't_Tex1.rgb', 'u_PrimColor.rgb',
            'v_Color.rgb', 'u_EnvColor.rgb', 't_Zero.rgb' /* key */, 't_CombColor.aaa',
            't_Tex0.aaa', 't_Tex1.aaa', 'u_PrimColor.aaa', 'v_Color.aaa',
            'u_EnvColor.aaa', 't_Zero.rgb' /* LOD */, 't_Zero.rgb' /* prim LOD */, 't_Zero.rgb'
        ];

        const alphaInputs: string[] = [
            'combAlpha', 't_Tex0', 't_Tex1', 'u_PrimColor.a',
            'v_Color.a', 'u_EnvColor.a', '1.0', '0.0'
        ];

        function generateColorCombine(c: RDP.ColorCombinePass) {
            return `((${colorInputs[c.a]} - ${colorInputs[c.b]}) * ${multInputs[c.c]} + ${colorInputs[c.d]})`;
        }

        function generateAlphaCombine(a: RDP.AlphaCombinePass) {
            return `((${alphaInputs[a.a]} - ${alphaInputs[a.b]}) * ${alphaInputs[a.c]} + ${alphaInputs[a.d]})`;
        }

        return `
vec4 Texture2D_N64_Point(sampler2D t_Texture, vec2 t_TexCoord) {
    return texture(t_Texture, t_TexCoord);
}

vec4 Texture2D_N64_Average(sampler2D t_Texture, vec2 t_TexCoord) {
    // Unimplemented.
    return texture(t_Texture, t_TexCoord);
}

// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(sampler2D t_Texture, vec2 t_TexCoord) {
    vec2 t_Size = vec2(textureSize(t_Texture, 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(t_Texture, t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

#define Texture2D_N64 Texture2D_N64_${texFiltStr}

vec3 CombineColorCycle0(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1) {
    return ${generateColorCombine(this.DP_Combine.c0)};
}

float CombineAlphaCycle0(float combAlpha, float t_Tex0, float t_Tex1) {
    return ${generateAlphaCombine(this.DP_Combine.a0)};
}

vec3 CombineColorCycle1(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1) {
    return ${generateColorCombine(this.DP_Combine.c1)};
}

float CombineAlphaCycle1(float combAlpha, float t_Tex0, float t_Tex1) {
    return ${generateAlphaCombine(this.DP_Combine.a1)};
}

void main() {
    vec4 t_Color = t_One;
    vec4 t_Tex0 = t_One, t_Tex1 = t_One;

#ifdef USE_TEXTURE
    t_Tex0 = Texture2D_N64(u_Texture[0], v_TexCoord.xy);
    t_Tex1 = Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#endif

    t_Color = vec4(
        CombineColorCycle0(t_Zero, t_Tex0, t_Tex1),
        CombineAlphaCycle0(t_Zero.a, t_Tex0.a, t_Tex1.a)
    );

#ifdef TWO_CYCLE
    t_Color = vec4(
        CombineColorCycle1(t_Color, t_Tex0, t_Tex1),
        CombineAlphaCycle1(t_Color.a, t_Tex0.a, t_Tex1.a)
    );
#endif

#ifdef ONLY_VERTEX_COLOR
    t_Color.rgba = v_Color.rgba;
#endif

#ifdef USE_ALPHA_VISUALIZER
    t_Color.rgb = vec3(v_Color.a);
    t_Color.a = 1.0;
#endif

${this.generateAlphaTest()}

    gl_FragColor = t_Color;
}
`;
    }
}

export function textureToCanvas(texture: Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.tile.fmt, texture.tile.siz));
    return { name: texture.name, surfaces, extraInfo };
}

const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
    case TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    // TODO: handle TexCM.MIRROR | TexCM.CLAMP (0x3) -- "mirror once" mode; occurs in Forest Temple
    default:
        console.warn(`Unknown TexCM ${cm}`);
        return GfxWrapMode.CLAMP;
    }
}

function makeVertexBufferData(v: Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 1.0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

function translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    const hostAccessPass = device.createHostAccessPass();
    hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    device.submitPass(hostAccessPass);
    return gfxTexture;
}

function translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
    return cache.createSampler(device, {
        wrapS: translateCM(texture.tile.cmS),
        wrapT: translateCM(texture.tile.cmT),
        minFilter: GfxTexFilterMode.POINT,
        magFilter: GfxTexFilterMode.POINT,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0, maxLOD: 0,
    });
}

export class RenderData {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public vertexBufferData: Float32Array;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sharedOutput: RSPSharedOutput, dynamic = false) {
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices);
        if (dynamic) {
            // there are vertex effects, so the vertex buffer data will change
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexBufferData.buffer);
        }
        assert(sharedOutput.vertices.length <= 0xFFFFFFFF);

        const indexBufferData = new Uint32Array(sharedOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DZEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0*0x04, },
            { location: F3DZEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DZEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x0200);
    const cullBack = !!(m & 0x0400);
    if (cullFront && cullBack)
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

function calcScaleForShift(shift: number): number {
    if (shift <= 10) {
        return 1 / (1 << shift);
    } else {
        return 1 << (16 - shift);
    }
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, geometryData: RenderData, private drawMatrix: mat4[], private drawCall: DrawCall) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            const tex = drawCall.textures[i];
            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = translateTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(device, cache, tex);
            }
        }

        this.megaStateFlags = translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL)
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DZEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);

        if (this.texturesEnabled && this.textureEntry.length)
            program.defines.set('USE_TEXTURE', '1');

        // FIXME: Levels disable the SHADE flags. wtf?
        const shade = true; // (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADING_SMOOTH) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
        this.megaStateFlags.cullMode = cullMode;
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

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            // G_TEXTURE scaleS and scaleT parameters always seem to be 0xFFFF, so they're ignored here.
            const entry = this.textureEntry[textureEntryIndex];
            const scaleS0 = calcScaleForShift(entry.tile.shiftS);
            const scaleT0 = calcScaleForShift(entry.tile.shiftT);
            mat4.fromScaling(m,
                [scaleS0 / entry.width, scaleT0 / entry.height, 1]);
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DZEX_Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DZEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        offs += fillMatrix4x3(mappedF32, offs, viewMatrixScratch); // u_ModelView
        
        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[0]

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[1]

        offs = renderInst.allocateUniformBuffer(F3DZEX_Program.ub_CombineParams, 9);
        const comb = renderInst.mapUniformBufferF32(F3DZEX_Program.ub_CombineParams);
        offs += fillVec4v(comb, offs, this.drawCall.primColor); // primitive color
        offs += fillVec4v(comb, offs, this.drawCall.envColor); // environment color
        comb[offs] = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING) ? 1.0 : 0.0; // Lighting flag
        offs++;
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureMappings.length; i++)
            if (this.textureMappings[i].gfxTexture !== null)
                device.destroyTexture(this.textureMappings[i].gfxTexture!);
    }
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

export interface Mesh {
    sharedOutput: F3DZEX.RSPSharedOutput;
    rspState: F3DZEX.RSPState;
    rspOutput: F3DZEX.RSPOutput | null;
}

export class MeshData {
    public renderData: RenderData;

    constructor(device: GfxDevice, cache: GfxRenderCache, public mesh: Mesh) {
        this.renderData = new RenderData(device, cache, mesh.sharedOutput, false);
    }

    public destroy(device: GfxDevice): void {
        this.renderData.destroy(device);
    }
}

class MeshRenderer {
    public drawCallInstances: DrawCallInstance[] = [];

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setAlphaVisualizerEnabled(v);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}

const lookatScratch = vec3.create();
const vec3up = vec3.fromValues(0, 1, 0);
const vec3Zero = vec3.create();
export class RootMeshRenderer {
    private visible = true;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public sortKeyBase: number;
    public modelMatrix = mat4.create();

    public objectFlags = 0;
    private rootNodeRenderer: MeshRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, private geometryData: MeshData) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        const geo = this.geometryData.mesh;

        // Traverse the node tree.
        this.rootNodeRenderer = this.buildGeoNodeRenderer(device, cache, geo);
    }

    private buildGeoNodeRenderer(device: GfxDevice, cache: GfxRenderCache, node: Mesh): MeshRenderer {
        const geoNodeRenderer = new MeshRenderer();

        if (node.rspOutput !== null) {
            for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                const drawMatrix = [mat4.create()];
                const drawCallInstance = new DrawCallInstance(device, cache, this.geometryData.renderData, drawMatrix, node.rspOutput.drawCalls[i]);
                geoNodeRenderer.drawCallInstances.push(drawCallInstance);
            }
        }

        return geoNodeRenderer;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        this.rootNodeRenderer.setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.rootNodeRenderer.setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.rootNodeRenderer.setAlphaVisualizerEnabled(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const renderData = this.geometryData.renderData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(renderData.inputLayout, renderData.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.filterKey = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;
        template.sortKey = this.sortKeyBase;

        const computeLookAt = false; // FIXME: or true?
        const sceneParamsSize = 16 + (computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DZEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DZEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, vec3Zero, lookatScratch, vec3up);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.isSkybox);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.rootNodeRenderer.destroy(device);
    }
}
