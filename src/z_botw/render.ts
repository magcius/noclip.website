
import { GfxDevice, GfxBufferUsage, GfxBuffer, GfxInputLayout, GfxFormat, GfxVertexAttributeFrequency, GfxBindingLayoutDescriptor, GfxProgram, GfxInputState, GfxVertexBufferDescriptor, GfxCompareMode, GfxRenderPass, GfxHostAccessPass, GfxBufferFrequencyHint, GfxTexture } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { assert, nArray } from "../util";
import { AreaInfo } from "./tscb";
import { vec3, mat4 } from "gl-matrix";
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import * as Viewer from "../viewer";
import { BasicRendererHelper } from "../oot3d/render";
import { fillMatrix4x4, fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { Camera } from "../Camera";
// @ts-ignore -- this feature is provided by Parcel.
import { readFileSync } from 'fs';
import { GX2TextureHolder } from "../fres/render";
import { TextureMapping } from "../TextureHolder";

export interface Area {
    areaInfo: AreaInfo;
    hghtData: Uint16Array;
    mateData: Uint8Array;
    width: number;
    height: number;
}

class TerrainProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_AreaParams = 1;

    public static a_Position = 0;
    public static a_Normal = 1;

    public both = readFileSync('src/z_botw/TerrainProgram.glsl', { encoding: 'utf8' });
}

function buildGridMeshIndexBuffer(indexData: Uint16Array, i: number, x1: number, x2: number, y1: number, y2: number, stride: number): number {
    const firstIndex = i;
    for (let y = y1 + 1; y < y2; y++) {
        for (let x = x1 + 1; x < x2; x++) {
            const i0 = (y - 1) * stride + (x - 1);
            const i1 = (y - 1) * stride + x;
            const i2 = y * stride + (x - 1);
            const i3 = y * stride + x;
            // Quad.
            indexData[i++] = i0;
            indexData[i++] = i1;
            indexData[i++] = i2;
            indexData[i++] = i2;
            indexData[i++] = i1;
            indexData[i++] = i3;
        }
    }
    return i - firstIndex;
}

export class LoadedTerrainArea {
    public posBuffer: GfxBuffer;
    public nbtBuffer: GfxBuffer;
    public mateTexture: GfxTexture;

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nbtBuffer);
        device.destroyTexture(this.mateTexture);
    }
}

class TerrainAreaRendererStatic {
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public subSectionFirstIndex: number[] = [];
    public subSectionCount: number[] = [];
    public numIndices: number;

    constructor(device: GfxDevice, public width: number, public height: number) {
        assert(width * height <= 0x10000);
        const indexData = new Uint16Array(width * height * 6);
        const hw = width >>> 1, hh = height >>> 1;

        // Build four quarters.
        this.subSectionFirstIndex[0] = 0;
        this.subSectionCount[0] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[0], 0, hw+1, 0, hh+1, width); // Top left
        this.subSectionFirstIndex[1] = this.subSectionFirstIndex[0] + this.subSectionCount[0];
        this.subSectionCount[1] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[1], hw, width, 0, hh+1, width); // Top right
        this.subSectionFirstIndex[2] = this.subSectionFirstIndex[1] + this.subSectionCount[1];
        this.subSectionCount[2] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[2], 0, hw+1, hh, height, width); // Bottom left
        this.subSectionFirstIndex[3] = this.subSectionFirstIndex[2] + this.subSectionCount[2];
        this.subSectionCount[3] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[3], hw, width, hh, height, width); // Bottom right

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);
        this.inputLayout = device.createInputLayout([
            { location: TerrainProgram.a_Position, format: GfxFormat.U16_RGB, bufferByteOffset: 0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: TerrainProgram.a_Normal, format: GfxFormat.S16_RGB_NORM, bufferByteOffset: 0, bufferIndex: 1, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ], GfxFormat.U16_R);
    }

    public drawRenderInst(renderInst: GfxRenderInst, sub: number) {
        renderInst.drawIndexes(this.subSectionCount[sub], this.subSectionFirstIndex[sub]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
    }
}

const scratch = mat4.create();
class TerrainAreaRenderer {
    public modelMatrix = mat4.create();
    public renderInsts: GfxRenderInst[] = [];
    public templateRenderInst: GfxRenderInst;

    constructor(public loadedArea: LoadedTerrainArea) {
        mat4.fromScaling(this.modelMatrix, [100, 0.04, 100]);
    }

    public buildRenderInsts(device: GfxDevice, staticData: TerrainAreaRendererStatic, renderInstBuilder: GfxRenderInstBuilder): void {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, TerrainProgram.ub_AreaParams);
        const inputBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.loadedArea.posBuffer, byteOffset: 0, byteStride: 0 },
            { buffer: this.loadedArea.nbtBuffer, byteOffset: 0, byteStride: 0 },
        ];
        this.templateRenderInst.inputState = device.createInputState(staticData.inputLayout, inputBuffers, { buffer: staticData.indexBuffer, byteOffset: 0, byteStride: 0 });
        this.templateRenderInst.setSamplerBindings([{ texture: this.loadedArea.mateTexture, sampler: null }], 2);

        for (let i = 0; i < 4; i++) {
            this.renderInsts[i] = renderInstBuilder.pushRenderInst();
            staticData.drawRenderInst(this.renderInsts[i], i);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public computeModelMatrix(m: mat4, camera: Camera): void {
        mat4.mul(m, camera.viewMatrix, this.modelMatrix);
    }

    public prepareToRender(areaUniformBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.uniformBufferOffsets[TerrainProgram.ub_AreaParams];
        const areaBuffer = areaUniformBuffer.mapBufferF32(offs, 12);
        this.computeModelMatrix(scratch, viewerInput.camera);
        offs += fillMatrix4x3(areaBuffer, offs, scratch);
    }
}

class TerrainRenderer {
    private sceneUniformBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, "ub_SceneParams");
    private areaUniformBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, "ub_AreaParams");
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private gfxProgram: GfxProgram;
    private areaRenderers: TerrainAreaRenderer[] = [];

    constructor(device: GfxDevice, textureHolder: GX2TextureHolder, private staticData: TerrainAreaRendererStatic) {
        this.gfxProgram = device.createProgram(new TerrainProgram());
        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 2 },
            { numUniformBuffers: 1, numSamplers: 1 },
        ];
        this.renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [this.sceneUniformBuffer, this.areaUniformBuffer]);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();

        const textureMappings = nArray(2, () => new TextureMapping());
        textureHolder.fillTextureMapping(textureMappings[0], 'MaterialAlb');
        textureHolder.fillTextureMapping(textureMappings[1], 'MaterialCmb');
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMappings);

        this.templateRenderInst.gfxProgram = this.gfxProgram;
        this.templateRenderInst.renderFlags.set({ depthCompare: GfxCompareMode.LESS, depthWrite: true });
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, TerrainProgram.ub_SceneParams);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs: number;

        offs = this.templateRenderInst.uniformBufferOffsets[TerrainProgram.ub_SceneParams];
        const sceneBuffer = this.sceneUniformBuffer.mapBufferF32(offs, 16);
        offs += fillMatrix4x4(sceneBuffer, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(this.areaUniformBuffer, viewerInput);

        this.sceneUniformBuffer.prepareToRender(hostAccessPass);
        this.areaUniformBuffer.prepareToRender(hostAccessPass);
    }

    public addTerrainArea(device: GfxDevice, loadedArea: LoadedTerrainArea): void {
        const areaRenderer = new TerrainAreaRenderer(loadedArea);
        areaRenderer.buildRenderInsts(device, this.staticData, this.renderInstBuilder);
        this.areaRenderers.push(areaRenderer);
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public destroy(device: GfxDevice): void {
        this.sceneUniformBuffer.destroy(device);
        device.destroyProgram(this.gfxProgram);
    }
}

export class TerrainScene extends BasicRendererHelper implements Viewer.Scene_Device {
    public terrainRenderer: TerrainRenderer;
    public staticData: TerrainAreaRendererStatic;

    constructor(device: GfxDevice, textureHolder: GX2TextureHolder, area: LoadedTerrainArea) {
        super();
        this.staticData = new TerrainAreaRendererStatic(device, 256, 256);
        this.terrainRenderer = new TerrainRenderer(device, textureHolder, this.staticData);
        this.terrainRenderer.addTerrainArea(device, area);
        this.terrainRenderer.finish(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.terrainRenderer.prepareToRender(hostAccessPass, viewerInput);
    }
}
