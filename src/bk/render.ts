
// @ts-ignore
import { readFileSync } from 'fs';
import * as Viewer from '../viewer';
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { Texture, getFormatString, RSPOutput, Vertex, DrawCall, GeometryMode } from "./f3dex";
import { GfxDevice, GfxTextureDimension, GfxFormat, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxHostAccessPass, GfxBlendMode, GfxBlendFactor, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray } from '../util';
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';

export function textureToCanvas(texture: Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatString(texture));
    return { name: texture.name, surfaces, extraInfo };
}

class F3DEX_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    private static program = readFileSync('src/bk/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(F3DEX_Program.program);
    public both = F3DEX_Program.program;
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

function makeVertexBufferData(v: Vertex[]): ArrayBuffer {
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
    return buf.buffer;
}

export class N64Data {
    public textures: GfxTexture[] = [];
    public samplers: GfxSampler[] = [];
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public rspOutput: RSPOutput) {
        for (let i = 0; i < this.rspOutput.textures.length; i++) {
            const tex = this.rspOutput.textures[i];
            this.textures.push(this.translateTexture(device, tex));
            this.samplers.push(this.translateSampler(device, tex));
        }

        const vertexBufferData = makeVertexBufferData(this.rspOutput.vertices);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBufferData);
        assert(this.rspOutput.vertices.length <= 0xFFFF);
        const indexBufferData = new Uint16Array(this.rspOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 10*0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
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

    private translateSampler(device: GfxDevice, texture: Texture): GfxSampler {
        return device.createSampler({
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
        for (let i = 0; i < this.samplers.length; i++)
            device.destroySampler(this.samplers[i]);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x200);
    const cullBack = !!(m & 0x400);
    if (cullFront && cullBack)
        return GfxCullMode.NONE;
    else if (cullFront)
        return GfxCullMode.BACK;
    else if (cullBack)
        return GfxCullMode.FRONT;
    else
        return GfxCullMode.FRONT_AND_BACK;
}

const enum TextFilt {
    G_TF_POINT   = 0x00,
    G_TF_AVERAGE = 0x03,
    G_TF_BILERP  = 0x02,
}

const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
const textureMappings = nArray(2, () => new TextureMapping());
class DrawCallInstance {
    private renderInst: GfxRenderInst;
    private textureEntry: Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private vertexNormalsEnabled = false;
    private lightingEnabled = false;

    constructor(device: GfxDevice, n64Data: N64Data, renderInstBuilder: GfxRenderInstBuilder, private drawCall: DrawCall, private drawIndex: number) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.renderInst, F3DEX_Program.ub_DrawParams);

        for (let i = 0; i < textureMappings.length; i++) {
            textureMappings[i].reset();

            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = n64Data.rspOutput.textures[idx];
                textureMappings[i].gfxTexture = n64Data.textures[idx];
                textureMappings[i].gfxSampler = n64Data.samplers[idx];
            }
        }

        const zUpd = !!(this.drawCall.DP_OtherModeL & 0x20);
        this.renderInst.setMegaStateFlags({ depthWrite: zUpd });
        this.setBackfaceCullingEnabled(true);
        this.createProgram();

        this.renderInst.setSamplerBindingsFromTextureMappings(textureMappings);

        this.renderInst.drawIndexes(drawCall.indexCount, drawCall.firstIndex);
    }

    private createProgram(): void {
        const program = new F3DEX_Program();
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

        const textFilt = (this.drawCall.DP_OtherModeH >>> 12) & 0x03;
        if (textFilt === TextFilt.G_TF_POINT)
            program.defines.set(`USE_TEXTFILT_POINT`, '1');
        else if (textFilt === TextFilt.G_TF_AVERAGE)
            program.defines.set(`USE_TEXTFILT_AVERAGE`, '1');
        else if (textFilt === TextFilt.G_TF_BILERP)
            program.defines.set(`USE_TEXTFILT_BILERP`, '1')

        this.renderInst.setDeviceProgram(program);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
        this.renderInst.setMegaStateFlags({ cullMode });
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

    public setVertexNormalsEnabled(v: boolean): void {
        this.vertexNormalsEnabled = v;
        this.createProgram();
    }

    public setLightingEnabled(v: boolean): void {
        this.lightingEnabled = v;
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

    public prepareToRender(drawParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, modelMatrix: mat4): void {
        let offs = this.renderInst.getUniformBufferOffset(F3DEX_Program.ub_DrawParams);
        const mappedF32 = drawParamsBuffer.mapBufferF32(offs, 12 + 8*2);
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

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.renderInst.gfxProgram);
    }
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

export class N64Renderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private drawParamsBuffer: GfxRenderBuffer;
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private drawCallInstances: DrawCallInstance[] = [];
    public isSkybox = false;
    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, private n64Data: N64Data) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.drawParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_DrawParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 2, }, // Mesh
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.drawParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, F3DEX_Program.programReflection, bindingLayouts, uniformBuffers);
        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, F3DEX_Program.ub_SceneParams);

        this.templateRenderInst.inputState = this.n64Data.inputState;
        this.templateRenderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        for (let i = 0; i < this.n64Data.rspOutput.drawCalls.length; i++)
            this.drawCallInstances.push(new DrawCallInstance(device, this.n64Data, this.renderInstBuilder, this.n64Data.rspOutput.drawCalls[i], i));
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
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

    public setVertexNormalsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexNormalsEnabled(v);
    }

    public setLightingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setLightingEnabled(v);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.templateRenderInst.passMask = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;

        let offs = this.templateRenderInst.getUniformBufferOffset(F3DEX_Program.ub_SceneParams);
        const mappedF32 = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(this.drawParamsBuffer, viewerInput, this.isSkybox, this.modelMatrix);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.drawParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.drawParamsBuffer.destroy(device);
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}
