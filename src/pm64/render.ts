
import { GfxHostAccessPass, GfxBufferUsage, GfxBufferFrequencyHint, GfxDevice, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxFormat, GfxBuffer, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from '../viewer';
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { mat4 } from "gl-matrix";
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";
import { ModelTreeNode, ModelTreeLeaf, ModelTreeGroup } from "./map_shape";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { RSPOutput, Vertex } from "./f3dex2";
import { assert, nArray, assertExists } from "../util";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import * as Tex from './tex';
//@ts-ignore
import { readFileSync } from 'fs';

class PaperMario64Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    private static program = readFileSync('src/bk/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(PaperMario64Program.program);
    public both = PaperMario64Program.program;
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
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public rspOutput: RSPOutput) {
        const vertexBufferData = makeVertexBufferData(this.rspOutput.vertices);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBufferData);
        assert(this.rspOutput.vertices.length <= 0xFFFF);
        const indexBufferData = new Uint16Array(this.rspOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PaperMario64Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: PaperMario64Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: PaperMario64Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 10*0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function textureToCanvas(texture: Tex.Image): Viewer.Texture {
    const surfaces: HTMLCanvasElement[] = [];

    for (let i = 0; i < texture.levels.length; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = texture.width >>> i;
        canvas.height = texture.height >>> i;

        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(texture.levels[i]);
        ctx.putImageData(imgData, 0, 0);

        surfaces.push(canvas);
    }

    return { name: texture.name, surfaces };
}

export class PaperMario64TextureHolder extends TextureHolder<Tex.Image> {
    public addTextureArchive(device: GfxDevice, texArc: Tex.TextureArchive): void {
        for (let i = 0; i < texArc.textureEnvironments.length; i++)
            this.addTextures(device, texArc.textureEnvironments[i].images);
    }

    public loadTexture(device: GfxDevice, texture: Tex.Image): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.levels[0]]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

function translateCM(cm: Tex.TexCM): GfxWrapMode {
    switch (cm) {
    case Tex.TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case Tex.TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case Tex.TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    }
}

const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
const textureMapping = nArray(2, () => new TextureMapping());
class ModelTreeLeafInstance {
    private n64Data: N64Data;
    private gfxSampler: GfxSampler[] = [];
    private templateRenderInst: GfxRenderInst;
    private renderInsts: GfxRenderInst[] = [];
    private textureEnvironment: Tex.TextureEnvironment | null = null;
    private visible = true;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureArchive: Tex.TextureArchive, textureHolder: PaperMario64TextureHolder, private modelTreeLeaf: ModelTreeLeaf) {
        this.n64Data = new N64Data(device, modelTreeLeaf.rspOutput);

        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.inputState = this.n64Data.inputState;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, PaperMario64Program.ub_DrawParams);

        // Find the texture environment settings.
        textureMapping[0].reset();
        textureMapping[1].reset();
        if (this.modelTreeLeaf.texEnvName !== null) {
            this.textureEnvironment = assertExists(textureArchive.textureEnvironments.find((texEnv) => texEnv.name === this.modelTreeLeaf.texEnvName));

            for (let i = 0; i < this.textureEnvironment.images.length; i++) {
                const image = this.textureEnvironment.images[i];
                textureHolder.fillTextureMapping(textureMapping[i], image.name);

                this.gfxSampler[i] = device.createSampler({
                    wrapS: translateCM(image.cms),
                    wrapT: translateCM(image.cmt),
                    minFilter: GfxTexFilterMode.POINT,
                    magFilter: GfxTexFilterMode.POINT,
                    mipFilter: GfxMipFilterMode.NO_MIP,
                    minLOD: 0, maxLOD: 0,
                });

                textureMapping[i].gfxSampler = this.gfxSampler[i];
            }
        }

        this.templateRenderInst.setDeviceProgram(this.createProgram());
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMapping);

        for (let i = 0; i < this.n64Data.rspOutput.drawCalls.length; i++) {
            const drawCall = this.n64Data.rspOutput.drawCalls[i];
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInst.drawIndexes(drawCall.indexCount, drawCall.firstIndex);
            this.renderInsts.push(renderInst);
            // TODO(jstpierre): Translate geometry mode and other things.
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    private computeTextureMatrix(dst: mat4, image: Tex.Image): void {
        const ss = 2 / (image.width);
        const st = 2 / (image.height);
        dst[0] = ss;
        dst[5] = st;

        // TODO(jstpierre): aux shift / UV pan
    }

    public prepareToRender(drawParamsBuffer: GfxRenderBuffer, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].visible = this.visible;

        let offs = this.templateRenderInst.getUniformBufferOffset(PaperMario64Program.ub_DrawParams);
        const mappedF32 = drawParamsBuffer.mapBufferF32(offs, 12 + 8*2);

        mat4.mul(modelViewScratch, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        if (this.textureEnvironment !== null) {
            this.computeTextureMatrix(texMatrixScratch, this.textureEnvironment.images[0]);
            offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

            if (this.textureEnvironment.hasSecondImage) {
                this.computeTextureMatrix(texMatrixScratch, this.textureEnvironment.images[1]);
                offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);
            }
        }
    }

    private createProgram(): PaperMario64Program {
        const program = new PaperMario64Program();

        program.defines.set('USE_VERTEX_COLOR', '1');
        if (this.textureEnvironment !== null) {
            program.defines.set('USE_TEXTURE', '1');

            const textFilt = this.textureEnvironment.texFilter;
            if (textFilt === Tex.TextFilt.G_TF_POINT)
                program.defines.set(`USE_TEXTFILT_POINT`, '1');
            else if (textFilt === Tex.TextFilt.G_TF_AVERAGE)
                program.defines.set(`USE_TEXTFILT_AVERAGE`, '1');
            else if (textFilt === Tex.TextFilt.G_TF_BILERP)
                program.defines.set(`USE_TEXTFILT_BILERP`, '1');
        } else {
            program.defines.set(`USE_TEXTFILT_POINT`, '1');
        }

        return program;
    }

    public destroy(device: GfxDevice): void {
        this.n64Data.destroy(device);
        for (let i = 0; i < this.gfxSampler.length; i++)
            device.destroySampler(this.gfxSampler[i]);
    }
}

class ModelTreeGroupInstance {
    private modelMatrixScratch = mat4.create();

    constructor(private group: ModelTreeGroup, private children: ModelTreeNodeInstance[]) {
    }

    public prepareToRender(drawParamsBuffer: GfxRenderBuffer, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.mul(this.modelMatrixScratch, modelMatrix, this.group.modelMatrix);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(drawParamsBuffer, this.modelMatrixScratch, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

type ModelTreeNodeInstance = ModelTreeGroupInstance | ModelTreeLeafInstance;

export class PaperMario64ModelTreeRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private drawParamsBuffer: GfxRenderBuffer;
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private modelTreeRootInstance: ModelTreeNodeInstance;
    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, private textureArchive: Tex.TextureArchive, private textureHolder: PaperMario64TextureHolder, private modelTreeRoot: ModelTreeNode) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.drawParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_DrawParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0, }, // Scene
            { numUniformBuffers: 1, numSamplers: 2, }, // Mesh
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.drawParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, PaperMario64Program.programReflection, bindingLayouts, uniformBuffers);
        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, PaperMario64Program.ub_SceneParams);

        this.templateRenderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        this.modelTreeRootInstance = this.translateModelTreeNode(device, modelTreeRoot);
    }

    private translateModelTreeNode(device: GfxDevice, modelTreeNode: ModelTreeNode): ModelTreeNodeInstance {
        if (modelTreeNode.type === 'group') {
            const children: ModelTreeNodeInstance[] = [];
            for (let i = 0; i < modelTreeNode.children.length; i++)
                children.push(this.translateModelTreeNode(device, modelTreeNode.children[i]));
            return new ModelTreeGroupInstance(modelTreeNode, children);
        } else if (modelTreeNode.type === 'leaf') {
            return new ModelTreeLeafInstance(device, this.renderInstBuilder, this.textureArchive, this.textureHolder, modelTreeNode);
        } else {
            throw "whoops";
        }
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(PaperMario64Program.ub_SceneParams);
        const mappedF32 = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        this.modelTreeRootInstance.prepareToRender(this.drawParamsBuffer, this.modelMatrix, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.drawParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.drawParamsBuffer.destroy(device);
        this.modelTreeRootInstance.destroy(device);
    }
}
