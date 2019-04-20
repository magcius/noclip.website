
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { BINModel, BINTexture, BIN } from "./bin";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { Camera, computeViewMatrix } from "../Camera";
import { mat4 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";

//@ts-ignore
import { readFileSync } from 'fs';
import { BasicRendererHelper } from "../oot3d/render";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { nArray } from "../util";

class KatamariDamacyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;
    public static a_Color = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    private static program = readFileSync('src/katamari_damacy/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(KatamariDamacyProgram.program);
    public both = KatamariDamacyProgram.program;
}

export class BINModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public binModel: BINModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.binModel.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.binModel.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KatamariDamacyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*4, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: KatamariDamacyProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*4, format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: KatamariDamacyProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6*4, format: GfxFormat.F32_RG,  frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: KatamariDamacyProgram.a_Color,    bufferIndex: 0, bufferByteOffset: 8*4, format: GfxFormat.F32_RGBA, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });

        const VERTEX_STRIDE = 3+3+2+4;
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: VERTEX_STRIDE*4 },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const scratchMat4 = mat4.create();
export class BINModelInstance {
    public renderInst: GfxRenderInst;
    public modelMatrix: mat4 = mat4.create();
    private gfxSampler: GfxSampler;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, textureHolder: KatamariDamacyTextureHolder, public binModelData: BINModelData) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        this.renderInst.inputState = this.binModelData.inputState;
        // TODO(jstpierre): Which render flags to use?
        this.renderInst.setMegaStateFlags({
            cullMode: GfxCullMode.BACK,
        });
        renderInstBuilder.newUniformBufferInstance(this.renderInst, KatamariDamacyProgram.ub_ModelParams);
        const indexCount = this.binModelData.binModel.indexData.length;
        this.renderInst.drawIndexes(indexCount, 0);

        mat4.rotateX(this.modelMatrix, this.modelMatrix, Math.PI);

        const program = new KatamariDamacyProgram();
        program.defines.set('USE_VERTEX_COLOR', '1');
        this.renderInst.setDeviceProgram(program);

        // TODO(jstpierre): Read this from TEX_1 / CLAMP_1.
        this.gfxSampler = device.createSampler({
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minLOD: 1, maxLOD: 1,
        });

        const textureMapping = nArray(1, () => new TextureMapping());
        textureHolder.fillTextureMapping(textureMapping[0], this.binModelData.binModel.textureSettings.name);
        this.renderInst.setSamplerBindingsFromTextureMappings(textureMapping);
    }

    private computeModelMatrix(camera: Camera, modelMatrix: mat4): mat4 {
        computeViewMatrix(scratchMat4, camera);
        mat4.mul(scratchMat4, scratchMat4, modelMatrix);
        return scratchMat4;
    }

    public prepareToRender(modelParamsBuffer: GfxRenderBuffer, viewRenderer: Viewer.ViewerRenderInput) {
        let offs = this.renderInst.getUniformBufferOffset(KatamariDamacyProgram.ub_ModelParams);
        const mapped = modelParamsBuffer.mapBufferF32(offs, 12);
        fillMatrix4x3(mapped, offs, this.computeModelMatrix(viewRenderer.camera, this.modelMatrix));
    }

    public destroy(device: GfxDevice): void {
        device.destroySampler(this.gfxSampler);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

function textureToCanvas(texture: BINTexture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width;
    const height = texture.height;
    const name = texture.name;
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const context = canvas.getContext("2d");
    const imgData = context.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    context.putImageData(imgData, 0, 0);
    const surfaces = [canvas];
    return { name: name, surfaces };
}

class KatamariDamacyTextureHolder extends TextureHolder<BINTexture> {
    public addBINTexture(device: GfxDevice, bin: BIN) {
        this.addTextures(device, [bin.textureData]);
    }

    public loadTexture(device: GfxDevice, texture: BINTexture): LoadedTexture {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

export class KatamariDamacyRenderer extends BasicRendererHelper {
    private sceneParamsBuffer: GfxRenderBuffer;
    private modelParamsBuffer: GfxRenderBuffer;
    private templateRenderInst: GfxRenderInst;
    public renderInstBuilder: GfxRenderInstBuilder;
    public modelData: BINModelData[] = [];
    public modelInstances: BINModelInstance[] = [];
    public textureHolder = new KatamariDamacyTextureHolder();

    constructor(device: GfxDevice) {
        super();
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.modelParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_ModelParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.modelParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, KatamariDamacyProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, KatamariDamacyProgram.ub_SceneParams);
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(KatamariDamacyProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.modelParamsBuffer, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.modelParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.sceneParamsBuffer.destroy(device);
        this.modelParamsBuffer.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}
