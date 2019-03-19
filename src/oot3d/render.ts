
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { DeviceProgram, DeviceProgramReflection } from '../Program';
import AnimationController from '../AnimationController';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler, GfxDevice, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxHostAccessPass, GfxRenderPass, GfxTextureDimension, GfxInputState, GfxInputLayout, GfxCompareMode } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { colorNew, Color, colorNewCopy, colorCopy, TransparentBlack } from '../Color';
import { getTextureFormatName } from './pica_texture';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { nArray, assert } from '../util';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderer';
import { makeFormat, FormatFlags, FormatTypeFlags, FormatCompFlags } from '../gfx/platform/GfxPlatformFormat';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { Camera } from '../Camera';

// @ts-ignore
// This feature is provided by Parcel.
import { readFileSync } from 'fs';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { getDebugOverlayCanvas2D, prepareFrameDebugOverlayCanvas2D, drawWorldSpaceLine } from '../DebugJunk';

function surfaceToCanvas(textureLevel: CMB.TextureLevel): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = textureLevel.width;
    canvas.height = textureLevel.height;
    canvas.title = textureLevel.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    imgData.data.set(textureLevel.pixels, 0);

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

function textureToCanvas(texture: CMB.Texture): Viewer.Texture {
    const surfaces = texture.levels.map((textureLevel) => surfaceToCanvas(textureLevel));

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getTextureFormatName(texture.format));

    return { name: texture.name, surfaces, extraInfo };
}

export class CtrTextureHolder extends TextureHolder<CMB.Texture> {
    public loadTexture(device: GfxDevice, texture: CMB.Texture): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: texture.levels.length,
        });
        device.setResourceName(gfxTexture, texture.name);

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, texture.levels.map((level) => level.pixels));

        device.submitPass(hostAccessPass);
        const viewerTexture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

interface DMPMaterialHacks {
    texturesEnabled: boolean;
    vertexColorsEnabled: boolean;
}

abstract class DMPProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PrmParams = 2;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord1 = 5;
    public static a_TexCoord2 = 6;
    public static a_BoneIndices = 7;
    public static a_BoneWeights = 8;

    public static BindingsDefinition = `
// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_ConstantColor[6];
    Mat4x3 u_TexMtx[3];
};

layout(row_major, std140) uniform ub_PrmParams {
    Mat4x3 u_BoneMatrix[16];
    vec4 u_PrmMisc[2];
};

#define u_PosScale (u_PrmMisc[0].x)
#define u_TexCoord0Scale (u_PrmMisc[0].y)
#define u_TexCoord1Scale (u_PrmMisc[0].z)
#define u_TexCoord2Scale (u_PrmMisc[0].w)
#define u_BoneWeightScale (u_PrmMisc[1].x)
#define u_BoneDimension   (u_PrmMisc[1].y)

uniform sampler2D u_Texture[3];
`;

    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(DMPProgram.BindingsDefinition);

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
        case GfxCompareMode.NEVER:   return `false`;
        case GfxCompareMode.LESS:    return `t_CmbOut.a <  ${ref}`;
        case GfxCompareMode.LEQUAL:  return `t_CmbOut.a <= ${ref}`;
        case GfxCompareMode.EQUAL:   return `t_CmbOut.a == ${ref}`;
        case GfxCompareMode.NEQUAL:  return `t_CmbOut.a != ${ref}`;
        case GfxCompareMode.GREATER: return `t_CmbOut.a >  ${ref}`;
        case GfxCompareMode.GEQUAL:  return `t_CmbOut.a >= ${ref}`;
        case GfxCompareMode.ALWAYS:  return `true`;
        default: throw "whoops";
        }
    }

    private generateTexAccess(which: 0 | 1 | 2 | 3): string {
        if (!this.materialHacks.texturesEnabled)
            return `vec4(0.5, 0.5, 0.5, 1.0)`;

        switch (which) {
        case 0: // Texture 0 has TexCoord 0
            return `texture(u_Texture[0], v_TexCoord0)`;
        case 1: // Texture 1 has TexCoord 1
            return `texture(u_Texture[1], v_TexCoord1)`;
        case 2: // Texture 2 has either TexCoord 1 or 2 as input. TODO(jstpierre): Add a material setting for this.
            return `texture(u_Texture[2], v_TexCoord2)`;
        case 3: // Texture 3 is the procedural texture unit. We don't support this yet; return white.
            return `vec4(1.0)`;
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
        case CMB.CombineSourceDMP.TEXTURE0: return this.generateTexAccess(0);
        case CMB.CombineSourceDMP.TEXTURE1: return this.generateTexAccess(1);
        case CMB.CombineSourceDMP.TEXTURE2: return this.generateTexAccess(2);
        case CMB.CombineSourceDMP.TEXTURE3: return this.generateTexAccess(3);
        case CMB.CombineSourceDMP.PREVIOUS: return `t_CmbOut`;
        case CMB.CombineSourceDMP.PREVIOUS_BUFFER: return `t_CmbOutBuffer`;
        case CMB.CombineSourceDMP.PRIMARY_COLOR:
            return this.generateVertexColorAccess();
        case CMB.CombineSourceDMP.FRAGMENT_PRIMARY_COLOR:
        case CMB.CombineSourceDMP.FRAGMENT_SECONDARY_COLOR:
            // TODO(jstpierre): Fragment lighting
            return this.generateVertexColorAccess();
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
        case CMB.CombineResultOpDMP.INTERPOLATE: return `(mix(t_CmbIn0, t_CmbIn1, t_CmbIn2))`;
        case CMB.CombineResultOpDMP.SUBTRACT:    return `(t_CmbIn0 - t_CmbIn1)`;
        case CMB.CombineResultOpDMP.DOT3_RGB:    return `vec4(vec3(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))), 1.0)`;
        case CMB.CombineResultOpDMP.DOT3_RGBA:   return `vec4(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))))`;
        case CMB.CombineResultOpDMP.MULT_ADD:    return `((t_CmbIn0 * t_CmbIn1) + t_CmbIn2)`;
        case CMB.CombineResultOpDMP.ADD_MULT:    return `((t_CmbIn0 + t_CmbIn1) * t_CmbIn2)`;
        }
    }

    private generateTexCombinerScale(combine: CMB.CombineResultOpDMP, scale: CMB.CombineScaleDMP): string {
        const s = this.generateTexCombinerCombine(combine);
        switch (scale) {
        case CMB.CombineScaleDMP._1: return `${s}`;
        case CMB.CombineScaleDMP._2: return `(${s} * 2.0)`;
        case CMB.CombineScaleDMP._4: return `(${s} * 4.0)`;
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
    t_CmbIn0 = vec4(${this.generateTexCombinerOp(c.source0RGB, c.op0RGB)}.rgb, ${this.generateTexCombinerOp(c.source0Alpha, c.op0Alpha)}.a);
    t_CmbIn1 = vec4(${this.generateTexCombinerOp(c.source1RGB, c.op1RGB)}.rgb, ${this.generateTexCombinerOp(c.source1Alpha, c.op1Alpha)}.a);
    t_CmbIn2 = vec4(${this.generateTexCombinerOp(c.source2RGB, c.op2RGB)}.rgb, ${this.generateTexCombinerOp(c.source2Alpha, c.op2Alpha)}.a);
    t_CmbOut = vec4(${this.generateTexCombinerScale(c.combineRGB, c.scaleRGB)}.rgb, ${this.generateTexCombinerScale(c.combineAlpha, c.scaleAlpha)}.a);
    t_CmbOutBuffer = vec4(${this.generateTexCombinerBuffer(c.bufferInputRGB)}.rgb, ${this.generateTexCombinerBuffer(c.bufferInputRGB)}.a);
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

    private generateFragmentShader(): void {
        this.frag = `
precision mediump float;
${DMPProgram.BindingsDefinition}

in vec4 v_Color;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;

in vec3 v_Lighting;
in vec3 v_FogColor;
in vec3 v_Normal;
in float v_Depth;
in float v_DrawDistance;
in float v_FogStart;

void main() {
    ${this.generateTextureEnvironment(this.material.textureEnvironment)}

    if (!(${this.generateAlphaTestCompare(this.material.alphaTestFunction, this.material.alphaTestReference)}))
        discard;

    vec4 t_ResultColor = t_CmbOut;

    //#ifdef USE_LIGHTING
        float t_FogFactor = clamp((v_DrawDistance - v_Depth) / (v_DrawDistance - v_FogStart), 0.15, 1.0);
        t_ResultColor.rgb = mix(v_FogColor, t_ResultColor.rgb, t_FogFactor);
    //#endif

    #ifdef USE_VERTEX_NORMAL
        t_ResultColor.rgb = normalize(v_Normal) * 0.5 + 0.5; 
    #endif

    #ifdef USE_UV
        t_ResultColor.r = v_TexCoord0.x;
        t_ResultColor.g = v_TexCoord0.y;
        t_ResultColor.b = 1.0;
    #endif

    gl_FragColor = t_ResultColor;
}
`;
    }
}

class OoT3DProgram extends DMPProgram {
    private texMtx = [0, 1, 2];
    private texAttrib = [0, 1, 2];

    public setTexCoordGen(dstChannel: number, srcMtx: number, srcAttrib: number): void {
        this.texMtx[dstChannel] = srcMtx;
        this.texAttrib[dstChannel] = srcAttrib;
    }

    private generateVertexCoord(channel: number): string {
        const mtxIndex = this.texMtx[channel];
        const attribIndex = this.texAttrib[channel];
        return `Mul(u_TexMtx[${mtxIndex}], vec4(a_TexCoord${attribIndex} * u_TexCoord${attribIndex}Scale, 0.0, 1.0)).st`;
    }

    public generateVertexShader(additionalProperties: string): void {
        this.vert = `
precision mediump float;
${DMPProgram.BindingsDefinition}
${additionalProperties}

layout(location = ${DMPProgram.a_Position}) in vec3 a_Position;
layout(location = ${DMPProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${DMPProgram.a_Color}) in vec4 a_Color;
layout(location = ${DMPProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${DMPProgram.a_TexCoord1}) in vec2 a_TexCoord1;
layout(location = ${DMPProgram.a_TexCoord2}) in vec2 a_TexCoord2;
layout(location = ${DMPProgram.a_BoneIndices}) in vec4 a_BoneIndices;
layout(location = ${DMPProgram.a_BoneWeights}) in vec4 a_BoneWeights;

out vec4 v_Color;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;

out vec3 v_FogColor;
out vec3 v_Normal;
out float v_Depth;
out float v_DrawDistance;
out float v_FogStart;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    // Compute our matrix.
    Mat4x3 t_BoneMatrix;

    vec4 t_BoneWeights = a_BoneWeights * u_BoneWeightScale;

    // Mask off bone dimension.
    if (u_BoneDimension == 0.0)
        t_BoneWeights.xyzw = vec4(0.0);
    else if (u_BoneDimension == 1.0)
        t_BoneWeights.yzw  = vec3(0.0);
    else if (u_BoneDimension == 2.0)
        t_BoneWeights.zw   = vec2(0.0);

    if ((t_BoneWeights.x + t_BoneWeights.y + t_BoneWeights.z + t_BoneWeights.w) > 0.0) {
        t_BoneMatrix = _Mat4x3(0.0);

        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.x)], t_BoneWeights.x);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.y)], t_BoneWeights.y);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.z)], t_BoneWeights.z);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.w)], t_BoneWeights.w);
    } else {
        // If we have no bone weights, then we're in rigid skinning, so take the first bone index.
        // If we're single-bone, then our bone indices will be 0, so this also works for that.
        t_BoneMatrix = u_BoneMatrix[int(a_BoneIndices.x)];
    }

    vec4 t_Position = vec4(a_Position * u_PosScale, 1.0);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(t_BoneMatrix), t_Position));

    v_Color = a_Color;

    v_Normal = a_Normal;
    v_Depth = gl_Position.w;
    v_FogColor = FOG_COLOR;
    v_DrawDistance = DRAW_DISTANCE;
    v_FogStart = FOG_START;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

//#ifdef USE_LIGHTING
    vec3 t_Lighting = AMBIENT_LIGHT_COLOR * 2.0;
    //t_Lighting += clamp(dot(-a_Normal, PRIMARY_LIGHT_DIRECTION), 0.0, 1.0) * PRIMARY_LIGHT_COLOR;
    //t_Lighting += clamp(dot(-a_Normal, SECONDARY_LIGHT_DIRECTION), 0.0, 1.0) * SECONDARY_LIGHT_COLOR;

    v_Color.rgb *= t_Lighting;
//#endif

    v_TexCoord0 = ${this.generateVertexCoord(0)};
    v_TexCoord0.t = 1.0 - v_TexCoord0.t;

    v_TexCoord1 = ${this.generateVertexCoord(1)};
    v_TexCoord1.t = 1.0 - v_TexCoord1.t;

    v_TexCoord2 = ${this.generateVertexCoord(2)};
    v_TexCoord2.t = 1.0 - v_TexCoord2.t;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    // Disable normals for now until I can solve them.
    // v_LightIntensity = 1.0;
}
`;
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

interface CmbContext {
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    vatrChunk: CMB.VatrChunk;
}

const scratchMatrix = mat4.create();
const scratchColor = colorNew(0, 0, 0, 1);

class MaterialInstance {
    private textureMappings: TextureMapping[] = nArray(3, () => new TextureMapping());
    private gfxSamplers: GfxSampler[] = [];
    private colorAnimators: CMAB.ColorAnimator[] = [];
    private srtAnimators: CMAB.TextureSRTAnimator[] = [];
    private texturePaletteAnimators: CMAB.TexturePaletteAnimator[] = [];
    public constantColors: Color[] = [];
    public templateRenderInst: GfxRenderInst;
    public visible: boolean = true;

    public texturesEnabled: boolean = true;
    public vertexColorsEnabled: boolean = true;
    public monochromeVertexColorsEnabled: boolean = false;

    private vertexNormalsEnabled: boolean = false;
    private lightingEnabled: boolean = false;
    private uvEnabled: boolean = false;

    public environmentSettings: ZSI.ZSIEnvironmentSettings[];

    public environmentIndex: number = 3;

    constructor(public cmb: CMB.CMB, public material: CMB.Material) {
        for (let i = 0; i < this.material.constantColors.length; i++)
            this.constantColors[i] = colorNewCopy(this.material.constantColors[i]);
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

    public setLightingEnabled(v: boolean): void {
        this.lightingEnabled = v;
        this.createProgram();
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings[]): void {
        this.environmentSettings = environmentSettings;
        this.createProgram();
    }

    public setEnvironmentIndex(index: number): void {
        this.environmentIndex = index;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new OoT3DProgram(this.material, this);
        program.setTexCoordGen(0, 0, 0);
        program.setTexCoordGen(1, 1, 0);
        program.setTexCoordGen(2, 2, 0);

        let additionalParameters = "";

        let tempEnvironmentSettings = new ZSI.ZSIEnvironmentSettings();

        if (this.environmentSettings && this.environmentSettings[this.environmentIndex]) tempEnvironmentSettings = this.environmentSettings[this.environmentIndex];

        additionalParameters += `vec3 AMBIENT_LIGHT_COLOR = vec3(${tempEnvironmentSettings.ambientLightCol});\n`;
        additionalParameters += `vec3 PRIMARY_LIGHT_COLOR = vec3(${tempEnvironmentSettings.primaryLightCol});\n`;
        additionalParameters += `vec3 PRIMARY_LIGHT_DIRECTION = vec3(${tempEnvironmentSettings.primaryLightDir});\n`;
        additionalParameters += `vec3 SECONDARY_LIGHT_COLOR = vec3(${tempEnvironmentSettings.secondaryLightCol});\n`;
        additionalParameters += `vec3 SECONDARY_LIGHT_DIRECTION = vec3(${tempEnvironmentSettings.secondaryLightDir});\n`;
        additionalParameters += `vec3 FOG_COLOR = vec3(${tempEnvironmentSettings.fogCol});\n`;
        additionalParameters += `float FOG_START = ${program.generateFloat(tempEnvironmentSettings.fogStart)};\n`;
        additionalParameters += `float DRAW_DISTANCE = ${program.generateFloat(tempEnvironmentSettings.drawDistance)};\n`;
        additionalParameters += `float FOG_MIN = ${program.generateFloat(tempEnvironmentSettings.fogMin)};\n`;
        additionalParameters += `float FOG_MAX = ${program.generateFloat(tempEnvironmentSettings.fogMax)};\n`;

        program.generateVertexShader(additionalParameters);

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');
        if (this.vertexNormalsEnabled)
            program.defines.set('USE_VERTEX_NORMAL', '1');
        if (this.lightingEnabled)
            program.defines.set('USE_LIGHTING', '1');
        if (this.uvEnabled)
            program.defines.set('USE_UV', '1');

        if (this.templateRenderInst) this.templateRenderInst.setDeviceProgram(program);
    }

    public buildTemplateRenderInst(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: CtrTextureHolder): void {
        this.templateRenderInst = renderInstBuilder.newRenderInst();
        if (this.material.textureBindings[0].textureIdx >= 0)
            this.templateRenderInst.name = this.cmb.textures[this.material.textureBindings[0].textureIdx].name;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DMPProgram.ub_MaterialParams);
        const layer = this.material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.templateRenderInst.sortKey = makeSortKey(layer);
        this.templateRenderInst.setMegaStateFlags(this.material.renderFlags);

        for (let i = 0; i < this.material.textureBindings.length; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = this.translateTextureFilter(binding.minFilter);
            const [magFilter] = this.translateTextureFilter(binding.magFilter);

            const texture = this.cmb.textures[binding.textureIdx];
            textureHolder.fillTextureMapping(this.textureMappings[i], texture.name);

            const gfxSampler = device.createSampler({
                wrapS: this.translateWrapMode(binding.wrapS),
                wrapT: this.translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            });
            this.gfxSamplers.push(gfxSampler);
            this.textureMappings[i].gfxSampler = gfxSampler;
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        this.createProgram();
    }

    public bindCMAB(cmab: CMAB.CMAB, animationController: AnimationController): void {
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.materialIndex !== this.material.index)
                continue;

            if (animEntry.animationType === CMAB.AnimationType.TRANSLATION || animEntry.animationType === CMAB.AnimationType.ROTATION) {
                this.srtAnimators[animEntry.channelIndex] = new CMAB.TextureSRTAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.COLOR) {
                this.colorAnimators[animEntry.channelIndex] = new CMAB.ColorAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.TEXTURE_PALETTE) {
                this.texturePaletteAnimators[animEntry.channelIndex] = new CMAB.TexturePaletteAnimator(animationController, cmab, animEntry);
            }
        }
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, visible: boolean, textureHolder: CtrTextureHolder): void {
        this.templateRenderInst.visible = visible && this.visible;

        if (visible) {
            let offs = this.templateRenderInst.getUniformBufferOffset(DMPProgram.ub_MaterialParams);
            const mapped = materialParamsBuffer.mapBufferF32(offs, 4+4*6+4*3*3);

            for (let i = 0; i < 6; i++) {
                if (this.colorAnimators[i]) {
                    this.colorAnimators[i].calcColor(scratchColor);
                } else {
                    colorCopy(scratchColor, this.constantColors[i]);
                }

                offs += fillColor(mapped, offs, scratchColor);
            }

            let rebindSamplers = false;
            for (let i = 0; i < 3; i++) {
                if (this.texturePaletteAnimators[i]) {
                    this.texturePaletteAnimators[i].fillTextureMapping(textureHolder, this.textureMappings[i]);
                    rebindSamplers = true;
                }

                if (this.srtAnimators[i]) {
                    this.srtAnimators[i].calcTexMtx(scratchMatrix);
                    mat4.mul(scratchMatrix, this.material.textureMatrices[i], scratchMatrix);
                } else {
                    mat4.copy(scratchMatrix, this.material.textureMatrices[i]);
                }
                offs += fillMatrix4x3(mapped, offs, scratchMatrix);
            }

            if (rebindSamplers)
                this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        }
    }

    private translateWrapMode(wrapMode: CMB.TextureWrapMode): GfxWrapMode {
        switch (wrapMode) {
        case CMB.TextureWrapMode.CLAMP: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.CLAMP_TO_EDGE: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.REPEAT: return GfxWrapMode.REPEAT;
        case CMB.TextureWrapMode.MIRRORED_REPEAT: return GfxWrapMode.MIRROR;
        default: throw new Error();
        }
    }

    private translateTextureFilter(filter: CMB.TextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
        switch (filter) {
        case CMB.TextureFilter.LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case CMB.TextureFilter.NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
        case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
        case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR];
        case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST];
        default: throw new Error();
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

function translateDataType(dataType: CMB.DataType, size: number, normalized: boolean): GfxFormat {
    function translateDataTypeFlags(dataType: CMB.DataType) {
        switch (dataType) {
        case CMB.DataType.UByte: return FormatTypeFlags.U8;
        case CMB.DataType.UShort: return FormatTypeFlags.U16;
        case CMB.DataType.UInt: return FormatTypeFlags.U32;
        case CMB.DataType.Byte: return FormatTypeFlags.S8;
        case CMB.DataType.Short: return FormatTypeFlags.S16;
        case CMB.DataType.Int: return FormatTypeFlags.S32;
        case CMB.DataType.Float: return FormatTypeFlags.F32;
        }
    }

    const formatTypeFlags = translateDataTypeFlags(dataType);
    const formatCompFlags = size as FormatCompFlags;
    const formatFlags = normalized ? FormatFlags.NORMALIZED : FormatFlags.NONE;
    return makeFormat(formatTypeFlags, formatCompFlags, formatFlags);
}

class SepdData {
    private perInstanceBuffer: GfxBuffer | null = null;
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;

    constructor(device: GfxDevice, cmbContext: CmbContext, public sepd: CMB.Sepd) {
        const vatr = cmbContext.vatrChunk;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        const perInstanceBufferData = new Float32Array(32);
        let perInstanceBufferWordOffset = 0;

        const bindVertexAttrib = (location: number, size: number, normalized: boolean, bufferOffs: number, vertexAttrib: CMB.SepdVertexAttrib) => {
            const format = translateDataType(vertexAttrib.dataType, size, normalized);
            if (vertexAttrib.mode === CMB.SepdVertexAttribMode.ARRAY && bufferOffs >= 0) {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 1 + location, bufferByteOffset: vertexAttrib.start, frequency: GfxVertexAttributeFrequency.PER_VERTEX });
            } else {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 0, bufferByteOffset: perInstanceBufferWordOffset * 0x04, frequency: GfxVertexAttributeFrequency.PER_INSTANCE });
                perInstanceBufferData.set(vertexAttrib.constant, perInstanceBufferWordOffset);
                perInstanceBufferWordOffset += 0x04;
            }
        };

        bindVertexAttrib(DMPProgram.a_Position,    3, false, vatr.positionByteOffset,  sepd.position);
        bindVertexAttrib(DMPProgram.a_Normal,      3, true,  vatr.normalByteOffset,    sepd.normal);
        // tangent

        // If we don't have any color, use opaque white. The constant in the sepd is not guaranteed to be correct.
        // XXX(jstpierre): Don't modify the input data if we can help it.
        if (vatr.colorByteOffset < 0)
            vec4.set(sepd.color.constant, 1, 1, 1, 1);

        bindVertexAttrib(DMPProgram.a_Color,       4, true,  vatr.colorByteOffset,     sepd.color);
        bindVertexAttrib(DMPProgram.a_TexCoord0,   2, false, vatr.texCoord0ByteOffset, sepd.texCoord0);
        bindVertexAttrib(DMPProgram.a_TexCoord1,   2, false, vatr.texCoord1ByteOffset, sepd.texCoord1);
        bindVertexAttrib(DMPProgram.a_TexCoord2,   2, false, vatr.texCoord2ByteOffset, sepd.texCoord2);

        const hasBoneIndices = sepd.prms[0].skinningMode !== CMB.SkinningMode.SINGLE_BONE && sepd.boneIndices.dataType === CMB.DataType.UByte;
        bindVertexAttrib(DMPProgram.a_BoneIndices, sepd.boneDimension, false, hasBoneIndices ? vatr.boneIndicesByteOffset : -1, sepd.boneIndices);
        const hasBoneWeights = sepd.prms[0].skinningMode === CMB.SkinningMode.SMOOTH_SKINNING;
        bindVertexAttrib(DMPProgram.a_BoneWeights, sepd.boneDimension, false, hasBoneWeights ? vatr.boneWeightsByteOffset : -1, sepd.boneWeights);

        let perInstanceBinding: GfxVertexBufferDescriptor | null = null;
        if (perInstanceBufferWordOffset !== 0) {
            this.perInstanceBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(perInstanceBufferData.buffer));
            perInstanceBinding = { buffer: this.perInstanceBuffer, byteOffset: 0, byteStride: 0 };
        }

        for (let i = 1; i < sepd.prms.length; i++)
            assert(sepd.prms[i].prm.indexType === sepd.prms[0].prm.indexType);

        const indexType = sepd.prms[0].prm.indexType;
        const indexBufferFormat = translateDataType(indexType, 1, false);
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            perInstanceBinding,
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.positionByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.normalByteOffset, byteStride: 0 },
            null, // tangent
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.colorByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord0ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord1ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.texCoord2ByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.boneIndicesByteOffset, byteStride: 0 },
            { buffer: cmbContext.vertexBuffer, byteOffset: vatr.boneWeightsByteOffset, byteStride: 0 },
        ], { buffer: cmbContext.indexBuffer, byteOffset: 0, byteStride: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.perInstanceBuffer !== null)
            device.destroyBuffer(this.perInstanceBuffer);
    }
}

class ShapeInstance {
    private renderInsts: GfxRenderInst[] = [];

    public visible: boolean = true;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, private sepdData: SepdData, private materialInstance: MaterialInstance) {
        // Create our template render inst.
        const templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        templateRenderInst.inputState = sepdData.inputState;
        templateRenderInst.setSamplerBindingsInherit();

        function getFirstIndex(prm: CMB.Prm): number {
            if (prm.indexType === CMB.DataType.UByte) {
                return prm.offset;
            } else if (prm.indexType === CMB.DataType.UShort) {
                assert((prm.offset & 0x01) === 0);
                return prm.offset >>> 1;
            } else if (prm.indexType === CMB.DataType.UInt) {
                assert((prm.offset & 0x03) === 0);
                return prm.offset >>> 2;
            }
            throw new Error();
        }

        for (let i = 0; i < this.sepdData.sepd.prms.length; i++) {
            const prms = this.sepdData.sepd.prms[i];
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInstBuilder.newUniformBufferInstance(renderInst, DMPProgram.ub_PrmParams);
            const firstIndex = getFirstIndex(prms.prm);
            renderInst.drawIndexes(prms.prm.count, firstIndex);
            renderInst.setSamplerBindingsInherit();
            this.renderInsts.push(renderInst);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(prmParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, boneMatrices: mat4[], inverseBindPoseMatrices: mat4[]): void {
        const sepd = this.sepdData.sepd;

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];
            renderInst.visible = this.visible && this.materialInstance.templateRenderInst.visible;

            if (renderInst.visible) {
                const prms = sepd.prms[i];

                let offs = renderInst.getUniformBufferOffset(DMPProgram.ub_PrmParams);
                const prmParamsMapped = prmParamsBuffer.mapBufferF32(offs, 16);

                for (let i = 0; i < 16; i++) {
                    if (i < prms.boneTable.length) {
                        const boneId = prms.boneTable[i];
                        if (prms.skinningMode === CMB.SkinningMode.SMOOTH_SKINNING) {
                            mat4.mul(scratchMatrix, boneMatrices[boneId], inverseBindPoseMatrices[boneId]);
                            mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);
                        } else {
                            mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, boneMatrices[boneId]);
                        }
                    } else {
                        mat4.identity(scratchMatrix);
                    }

                    offs += fillMatrix4x3(prmParamsMapped, offs, scratchMatrix);
                }

                offs += fillVec4(prmParamsMapped, offs, sepd.position.scale, sepd.texCoord0.scale, sepd.texCoord1.scale, sepd.texCoord2.scale);
                offs += fillVec4(prmParamsMapped, offs, sepd.boneWeights.scale, sepd.boneDimension);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        //
    }
}

export class CmbData {
    public sepdData: SepdData[] = [];
    public inverseBindPoseMatrices: mat4[] = [];

    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public cmb: CMB.CMB) {
        this.vertexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, cmb.vatrChunk.dataBuffer);
        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.INDEX, cmb.indexBuffer);

        const vatrChunk = cmb.vatrChunk;
        const cmbContext: CmbContext = {
            vertexBuffer: this.vertexBuffer,
            indexBuffer: this.indexBuffer,
            vatrChunk,
        };

        for (let i = 0; i < this.cmb.sepds.length; i++)
            this.sepdData[i] = new SepdData(device, cmbContext, this.cmb.sepds[i]);

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
        for (let i = 0; i < this.sepdData.length; i++)
            this.sepdData[i].destroy(device);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class CmbRenderer {
    public animationController = new AnimationController();
    public visible: boolean = true;
    public materialInstances: MaterialInstance[] = [];
    public shapeInstances: ShapeInstance[] = [];

    public csab: CSAB.CSAB | null = null;
    public debugBones: boolean = false;
    public boneMatrices: mat4[] = [];
    public modelMatrix = mat4.create();

    private sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
    private materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
    private prmParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_PrmParams`);

    private templateRenderInst: GfxRenderInst;

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;
    private monochromeVertexColorsEnabled: boolean = false;

    private vertexNormalsEnabled: boolean = false;
    private lightingEnabled: boolean = false;
    private uvEnabled: boolean = false;

    public ambientLightCol: vec3;
    public primaryLightCol: vec3;
    public primaryLightDir: vec3;
    public secondaryLightCol: vec3;
    public secondaryLightDir: vec3;
    public fogCol: vec3;
    public fogStart: number;
    public drawDistance: number;

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public cmbData: CmbData, public name: string = '') {
        for (let i = 0; i < this.cmbData.cmb.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(this.cmbData.cmb, this.cmbData.cmb.materials[i]));

        this.boneMatrices = nArray(this.cmbData.cmb.bones.length, () => mat4.create());
        this.updateBoneMatrices();
    }

    private translateCmb(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder): void {
        const cmb = this.cmbData.cmb;

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].buildTemplateRenderInst(device, renderInstBuilder, this.textureHolder);

        for (let i = 0; i < cmb.meshs.length; i++) {
            const mesh = cmb.meshs[i];
            const materialInstance = this.materialInstances[mesh.matsIdx];
            renderInstBuilder.pushTemplateRenderInst(materialInstance.templateRenderInst);
            this.shapeInstances.push(new ShapeInstance(device, renderInstBuilder, this.cmbData.sepdData[mesh.sepdIdx], materialInstance));
            renderInstBuilder.popTemplateRenderInst();
        }
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        // Standard GX binding model of three bind groups.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 3, }, // Material
            { numUniformBuffers: 1, numSamplers: 0, }, // Packet
        ];

        const renderInstBuilder = new GfxRenderInstBuilder(device, DMPProgram.programReflection, bindingLayouts, [ this.sceneParamsBuffer, this.materialParamsBuffer, this.prmParamsBuffer ]);
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, DMPProgram.ub_SceneParams);
        this.translateCmb(device, renderInstBuilder);
        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
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

    public setLightingEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setLightingEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings[]): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setEnvironmentSettings(environmentSettings);
    }

    public setEnvironmentIndex(index: number): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setEnvironmentIndex(index);
    }

    private updateBoneMatrices(): void {
        for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
            const bone = this.cmbData.cmb.bones[i];

            CSAB.calcBoneMatrix(this.boneMatrices[bone.boneId], this.animationController, this.csab, bone);
            const parentBoneMatrix = bone.parentBoneId >= 0 ? this.boneMatrices[bone.parentBoneId] : this.modelMatrix;
            mat4.mul(this.boneMatrices[bone.boneId], parentBoneMatrix, this.boneMatrices[bone.boneId]);
        }
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.updateBoneMatrices();

        if (this.debugBones) {
            prepareFrameDebugOverlayCanvas2D();
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
                const bone = this.cmbData.cmb.bones[i];
                if (bone.parentBoneId < 0) continue;

                vec3.set(scratchVec3a, 0, 0, 0);
                vec3.transformMat4(scratchVec3a, scratchVec3a, this.boneMatrices[bone.parentBoneId]);
                vec3.set(scratchVec3b, 0, 0, 0);
                vec3.transformMat4(scratchVec3b, scratchVec3b, this.boneMatrices[bone.boneId]);

                drawWorldSpaceLine(ctx, viewerInput.camera, scratchVec3a, scratchVec3b);
            }
        }

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        let offs = this.templateRenderInst.getUniformBufferOffset(DMPProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera);

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].prepareToRender(this.materialParamsBuffer, viewerInput, this.visible, this.textureHolder);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(this.prmParamsBuffer, viewerInput, this.boneMatrices, this.cmbData.inverseBindPoseMatrices);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.prmParamsBuffer.prepareToRender(hostAccessPass);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.prmParamsBuffer.destroy(device);
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }

    public bindCSAB(csab: CSAB.CSAB | null): void {
        this.csab = csab;
    }

    public bindCMAB(cmab: CMAB.CMAB, animationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCMAB(cmab, animationController);
    }
}

export abstract class BasicRendererHelper {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();

    protected abstract prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void;

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const finalPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, finalPassRenderer);
        return finalPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
    }
}

export class RoomRenderer {
    public visible: boolean = true;
    public opaqueData: CmbData | null = null;
    public opaqueMesh: CmbRenderer | null = null;
    public transparentData: CmbData | null = null;
    public transparentMesh: CmbRenderer | null = null;
    public wMesh: CmbRenderer | null = null;
    public objectRenderers: CmbRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public mesh: ZSI.Mesh, public name: string) {
        if (mesh.opaque !== null) {
            textureHolder.addTextures(device, mesh.opaque.textures);
            this.opaqueData = new CmbData(device, mesh.opaque);
            this.opaqueMesh = new CmbRenderer(device, textureHolder, this.opaqueData, `${name} Opaque`);
            this.opaqueMesh.setConstantColor(1, TransparentBlack);
        }

        if (mesh.transparent !== null) {
            textureHolder.addTextures(device, mesh.transparent.textures);
            this.transparentData = new CmbData(device, mesh.transparent);
            this.transparentMesh = new CmbRenderer(device, textureHolder, this.transparentData, `${name} Transparent`);
            this.transparentMesh.setConstantColor(1, TransparentBlack);
        }
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.addToViewRenderer(device, viewRenderer);
        if (this.transparentMesh !== null)
            this.transparentMesh.addToViewRenderer(device, viewRenderer);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].addToViewRenderer(device, viewRenderer);
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.bindCMAB(cmab);
        if (this.transparentMesh !== null)
            this.transparentMesh.bindCMAB(cmab);
    }

    public bindWCMAB(cmab: CMAB.CMAB): void {
        if (this.wMesh !== null)
            this.wMesh.bindCMAB(cmab);
    }

    public setVisible(visible: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVisible(visible);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVisible(visible);
        if (this.wMesh !== null)
            this.wMesh.setVisible(visible);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVisible(visible);
    }

    public setVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexColorsEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setTexturesEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setTexturesEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setTexturesEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setMonochromeVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setMonochromeVertexColorsEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setMonochromeVertexColorsEnabled(v);
    }

    public setVertexNormalsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexNormalsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexNormalsEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setVertexNormalsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexNormalsEnabled(v);
    }

    public setLightingEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setLightingEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setLightingEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setLightingEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setLightingEnabled(v);
    }

    public setUVEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setUVEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setUVEnabled(v);
        if (this.wMesh !== null)
            this.wMesh.setUVEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setUVEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings[]): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setEnvironmentSettings(environmentSettings);
        if (this.transparentMesh !== null)
            this.transparentMesh.setEnvironmentSettings(environmentSettings);
        if (this.wMesh !== null)
            this.wMesh.setEnvironmentSettings(environmentSettings);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setEnvironmentSettings(environmentSettings);
    }

    public setEnvironmentIndex(index: number): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setEnvironmentIndex(index);
        if (this.transparentMesh !== null)
            this.transparentMesh.setEnvironmentIndex(index);
        if (this.wMesh !== null)
            this.wMesh.setEnvironmentIndex(index);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setEnvironmentIndex(index);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.transparentMesh !== null)
            this.transparentMesh.prepareToRender(hostAccessPass, viewerInput);
        if (this.wMesh !== null)
            this.wMesh.prepareToRender(hostAccessPass, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(hostAccessPass, viewerInput);
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
        if (this.wMesh !== null)
            this.wMesh.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}
