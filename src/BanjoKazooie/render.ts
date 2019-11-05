
import * as Viewer from '../viewer';
import { DeviceProgram } from "../Program";
import { Texture, getImageFormatString, Vertex, DrawCall, GeometryMode, OtherModeH_CycleType, getTextFiltFromOtherModeH } from "./f3dex";
import { GfxDevice, GfxTextureDimension, GfxFormat, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray, align } from '../util';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { interactiveVizSliderSelect } from '../DebugJunk';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TextFilt } from '../Common/N64/Image';
import { Geometry, VertexAnimationEffect, VertexEffectType } from './geo';
import { clamp } from '../MathHelpers';
import { AttachmentStateSimple, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

class F3DEX_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x2 u_TexMatrix[2];
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_TexCoord.xy = Mul(u_TexMatrix[0], vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = Mul(u_TexMatrix[1], vec4(a_TexCoord, 1.0, 1.0));
}
`;

    constructor(private drawCall: DrawCall) {
        super();
        this.frag = this.generateFrag();
    }

    private generateAlphaTest(): string {
        const alphaCompare = (this.drawCall.DP_OtherModeL >>> 0) & 0x03;
        if (alphaCompare !== 0x00) {
            return `
    if (t_Color.a < 0.0125)
        discard;
`;
        } else {
            return "";
        }
    }

    private generateFrag(): string {
        const drawCall = this.drawCall;
        const cycletype: OtherModeH_CycleType = (drawCall.DP_OtherModeH >>> 20) & 0x03;

        const textFilt = getTextFiltFromOtherModeH(drawCall.DP_OtherModeH);
        let texFiltStr: string;
        if (textFilt === TextFilt.G_TF_POINT)
            texFiltStr = 'Point';
        else if (textFilt === TextFilt.G_TF_AVERAGE)
            texFiltStr = 'Average';
        else if (textFilt === TextFilt.G_TF_BILERP)
            texFiltStr = 'Bilerp';
        else
            throw "whoops";

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

void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= Texture2D_N64(u_Texture[0], v_TexCoord.xy);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgba *= v_Color.rgba;
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
    }
}

function makeVertexBufferData(v: Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

function updateVertexEffectState(effect: VertexAnimationEffect, timeInSeconds: number, deltaSeconds: number) {
    if (effect.type === VertexEffectType.ColorFlicker) {
        // game updates once per frame
        const delta = (.08 * Math.random() - .04) * deltaSeconds * 30;
        effect.colorFactor = clamp(effect.colorFactor + delta, 0.8, 1.0);
    } else if (effect.type === VertexEffectType.FlowingWater) {
        effect.dty = (timeInSeconds * effect.subID) % 0x100;
    } else if (effect.type === VertexEffectType.OtherInteractive || effect.type === VertexEffectType.Interactive) {
        effect.dy = Math.sin(timeInSeconds * Math.PI / 3) * 20;
    } else if (effect.type === VertexEffectType.StillWater || effect.type === VertexEffectType.RipplingWater) {
        const anglePhase = effect.type === VertexEffectType.StillWater ? effect.xPhase : 0;
        const angle = (anglePhase + timeInSeconds) * Math.PI;
        // uv coordinates must be rescaled to respect the fixed point format
        effect.dtx = 80 * (Math.sin(angle * .08) + Math.cos(angle * .2) * 1.5) / 0x40;
        effect.dty = 80 * (Math.cos(angle * .22) + Math.sin(angle * .5) * .5) / 0x40;
        if (effect.type === VertexEffectType.StillWater) {
            // TODO: understand the extra water level changing logic which is off by default
            effect.dy = effect.subID * (Math.sin(angle * .11) * .25 + Math.cos(angle * .5) * .75);
        } else if (effect.type === VertexEffectType.RipplingWater) {
            const waveSpeed = effect.subID < 10 ? effect.subID / 10 : 1;
            effect.xPhase = 3 * waveSpeed * timeInSeconds;
            effect.yPhase = 3 * (waveSpeed + .01) * timeInSeconds;
        }
    } else if (effect.type === VertexEffectType.ColorPulse) {
        const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % 1.4;
        effect.colorFactor = 0.3 + (distance < .7 ? distance : 1.4 - distance);
    } else if (effect.type === VertexEffectType.AlphaBlink) {
        // kind of hacky, there's a 1-second wait after the blink, so add in more to the cycle
        const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % (2 + (effect.subID + 1) / 100);
        if (distance < 1)
            effect.colorFactor = distance;
        else if (distance < 2)
            effect.colorFactor = 2 - distance;
        else
            effect.colorFactor = 0;
    } else if (effect.type === VertexEffectType.LightningBolt) {
        const blinker = effect.blinker!;
        blinker.timer -= Math.max(deltaSeconds, 0); // pause on reversing time
        if (blinker.duration === 0) { // not blinking
            effect.colorFactor = 0;
            if (blinker.timer <= 0) {
                blinker.currBlink++;
                blinker.strength = (100 + 155 * Math.random()) / 255;
                blinker.duration = .08 + .04 * Math.random();
                blinker.timer = blinker.duration;
            }
        }
        if (blinker.duration > 0) { // blinking
            // compute blink envelope
            if (blinker.timer < .04)
                effect.colorFactor = blinker.strength * Math.max(blinker.timer, 0) / .04;
            else if (blinker.timer < blinker.duration - .04)
                effect.colorFactor = blinker.strength;
            else
                effect.colorFactor = blinker.strength * (blinker.duration - blinker.timer) / .04;

            if (blinker.timer <= 0) {
                effect.colorFactor = 0;
                blinker.duration = 0;
                if (blinker.currBlink < blinker.count) {
                    blinker.timer = .1 + .1 * Math.random();
                } else {
                    blinker.currBlink = 0;
                    blinker.count = 1 + Math.floor(4 * Math.random());
                    blinker.timer = 4 + 2 * Math.random();
                }
            }
        }
    } else if (effect.type === VertexEffectType.LightningLighting) {
        effect.colorFactor = effect.pairedEffect!.colorFactor * 100 / 255;
    }
}

function applyVertexEffect(effect: VertexAnimationEffect, vertexBuffer: Float32Array, base: Vertex, index: number) {
    // per vertex setup
    if (effect.type === VertexEffectType.RipplingWater) {
        const waveHeight = Math.sin((base.x - effect.bbMin![0]) * 200 + effect.xPhase)
            + Math.cos((base.z - effect.bbMin![2]) * 200 + effect.yPhase);

        effect.dy = waveHeight * (effect.bbMax![1] - effect.bbMin![1]) / 4;
        effect.colorFactor = (205 + 50 * (waveHeight / 2)) / 255;
    }

    // vertex movement
    if (effect.type === VertexEffectType.StillWater || effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 1] = base.y + effect.dy;
    }

    // texture coordinates
    if (effect.type === VertexEffectType.FlowingWater ||
        effect.type === VertexEffectType.StillWater ||
        effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 4] = base.tx + effect.dtx;
        vertexBuffer[index * 10 + 5] = base.ty + effect.dty;
    }

    // color
    if (effect.type === VertexEffectType.ColorFlicker ||
        effect.type === VertexEffectType.ColorPulse ||
        effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 6] = base.c0 * effect.colorFactor;
        vertexBuffer[index * 10 + 7] = base.c1 * effect.colorFactor;
        vertexBuffer[index * 10 + 8] = base.c2 * effect.colorFactor;
    } else if (effect.type === VertexEffectType.LightningLighting) {
        vertexBuffer[index * 10 + 6] = clamp(base.c0 + effect.colorFactor, 0, 1);
        vertexBuffer[index * 10 + 7] = clamp(base.c1 + effect.colorFactor, 0, 1);
        vertexBuffer[index * 10 + 8] = clamp(base.c2 + effect.colorFactor, 0, 1);
    }

    // alpha
    if (effect.type === VertexEffectType.AlphaBlink) {
        vertexBuffer[index * 10 + 9] = base.a * effect.colorFactor;
    } else if (effect.type === VertexEffectType.LightningBolt) {
        vertexBuffer[index * 10 + 9] = effect.colorFactor;
    }
}

export class N64Data {
    public textures: GfxTexture[] = [];
    public samplers: GfxSampler[] = [];
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    public vertexBufferData: Float32Array;

    constructor(device: GfxDevice, cache: GfxRenderCache, public geo: Geometry) {
        for (let i = 0; i < this.geo.rspOutput.textures.length; i++) {
            const tex = this.geo.rspOutput.textures[i];
            this.textures.push(this.translateTexture(device, tex));
            this.samplers.push(this.translateSampler(device, cache, tex));
        }

        this.vertexBufferData = makeVertexBufferData(this.geo.rspOutput.vertices);
        if (this.geo.vertexEffects.length > 0) {
            // there are vertex effects, so the vertex buffer data will change
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexBufferData.buffer);
        }
        assert(this.geo.rspOutput.vertices.length <= 0xFFFFFFFF);
        const indexBufferData = new Uint32Array(this.geo.rspOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }
    
    private translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);
        return gfxTexture;
    }

    private translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
        return cache.createSampler(device, {
            wrapS: translateCM(texture.tile.cms),
            wrapT: translateCM(texture.tile.cmt),
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++)
            device.destroyTexture(this.textures[i]);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x1000);
    const cullBack = !!(m & 0x2000);
    if (cullFront && cullBack)
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

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

    constructor(n64Data: N64Data, private drawCall: DrawCall) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = n64Data.geo.rspOutput.textures[idx];
                this.textureMappings[i].gfxTexture = n64Data.textures[idx];
                this.textureMappings[i].gfxSampler = n64Data.samplers[idx];
            }
        }

        const zUpd = !!(this.drawCall.DP_OtherModeL & 0x20);
        this.megaStateFlags = { depthWrite: zUpd };
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall);

        // TODO(jstpierre): texture combiners.
        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        const shade = (this.drawCall.SP_GeometryMode & GeometryMode.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

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
            // TODO(jstpierre): whatever this is
            // const s = (0x7FFF / this.drawCall.SP_TextureState.s);
            // const t = (0x7FFF / this.drawCall.SP_TextureState.t);

            const entry = this.textureEntry[textureEntryIndex];
            const ss = 1 / (entry.width);
            const st = 1 / (entry.height);
            m[0] = ss;
            m[5] = st;
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, modelMatrix: mat4): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);
        if (isSkybox)
            computeViewMatrixSkybox(modelViewScratch, viewerInput.camera);
        else
            computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, modelMatrix);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);
    }
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
];

export class N64Renderer {
    private drawCallInstances: DrawCallInstance[] = [];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public modelMatrix = mat4.create();

    constructor(private n64Data: N64Data) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        for (let i = 0; i < this.n64Data.geo.rspOutput.drawCalls.length; i++)
            this.drawCallInstances.push(new DrawCallInstance(this.n64Data, this.n64Data.geo.rspOutput.drawCalls[i]));
    }

    public slider(): void {
        interactiveVizSliderSelect(this.drawCallInstances);
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(this.n64Data.inputLayout, this.n64Data.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.filterKey = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (this.n64Data.geo.vertexEffects.length > 0) {
            for (let i = 0; i < this.n64Data.geo.vertexEffects.length; i++) {
                const effect = this.n64Data.geo.vertexEffects[i];
                updateVertexEffectState(effect, viewerInput.time / 1000, viewerInput.deltaTime / 1000);
                for (let j = 0; j < effect.vertexIndices.length; j++) {
                    applyVertexEffect(effect, this.n64Data.vertexBufferData, effect.baseVertexValues[j], effect.vertexIndices[j]);
                }
            }
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadBufferData(this.n64Data.vertexBuffer, 0, new Uint8Array(this.n64Data.vertexBufferData.buffer));
            device.submitPass(hostAccessPass);
        }

        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, this.isSkybox, this.modelMatrix);
    }
}
