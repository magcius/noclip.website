
import { GfxDevice, GfxBufferUsage, GfxBuffer, GfxInputLayout, GfxFormat, GfxVertexAttributeFrequency, GfxBindingLayoutDescriptor, GfxProgram, GfxInputState, GfxVertexBufferDescriptor, GfxCompareMode, GfxRenderPass, GfxHostAccessPass, GfxBufferFrequencyHint, GfxTexture, GfxVertexAttributeDescriptor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { assert, nArray } from "../util";
import { AreaInfo } from "./tscb";
import { mat4 } from "gl-matrix";
import { GfxRenderInstBuilder, GfxRenderInst, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import * as Viewer from "../viewer";
import { BasicRendererHelper } from "../oot3d/render";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
// @ts-ignore -- this feature is provided by Parcel.
import { readFileSync } from 'fs';
import { GX2TextureHolder } from "../fres/render";
import { TextureMapping } from "../TextureHolder";
import { TerrainManager } from "./tera";
import { AABB } from "../Geometry";

export interface Area {
    areaInfo: AreaInfo;
    hghtData: Uint16Array;
    mateData: Uint8Array;
    xMax: number;
    zMax: number;
}

class TerrainProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Bitangent = 2;
    public static a_AreaLocalPosition = 3;
    public static a_GridAttributes = 4;

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
    public aabb: AABB;
    public posBuffer: GfxBuffer;
    public nbtBuffer: GfxBuffer;
    public gridAttributesBuffer: GfxBuffer;
    public mateTexture: GfxTexture;

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nbtBuffer);
        device.destroyBuffer(this.gridAttributesBuffer);
        device.destroyTexture(this.mateTexture);
    }
}

class TerrainAreaRendererStatic {
    public indexBuffer: GfxBuffer;
    public areaLocalPositionBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public subSectionFirstIndex: number[] = [];
    public subSectionCount: number[] = [];
    public numIndices: number;

    constructor(device: GfxDevice, public xMax: number, public zMax: number) {
        assert(xMax * zMax <= 0x10000);
        const indexData = new Uint16Array(xMax * zMax * 6);
        const xH = xMax >>> 1, zH = zMax >>> 1;

        // Build four quarters.
        this.subSectionFirstIndex[0] = 0;
        this.subSectionCount[0] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[0], 0, xH, 0, zH, xMax); // Top left
        this.subSectionFirstIndex[1] = this.subSectionFirstIndex[0] + this.subSectionCount[0];
        this.subSectionCount[1] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[1], xH, xMax, 0, zH, xMax); // Top right
        this.subSectionFirstIndex[2] = this.subSectionFirstIndex[1] + this.subSectionCount[1];
        this.subSectionCount[2] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[2], 0, xH, zH, zMax, xMax); // Bottom left
        this.subSectionFirstIndex[3] = this.subSectionFirstIndex[2] + this.subSectionCount[2];
        this.subSectionCount[3] = buildGridMeshIndexBuffer(indexData, this.subSectionFirstIndex[3], xH, xMax, zH, zMax, xMax); // Bottom right
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const areaLocalPositionData = new Uint8Array(xMax * zMax * 2);
        let i = 0;
        for (let z = 0; z < zMax; z++) {
            for (let x = 0; x < xMax; x++) {
                areaLocalPositionData[i++] = x;
                areaLocalPositionData[i++] = z;
            }
        }

        this.areaLocalPositionBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, areaLocalPositionData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TerrainProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: TerrainProgram.a_Normal, format: GfxFormat.S16_RGB_NORM, bufferByteOffset: 0, bufferIndex: 1, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: TerrainProgram.a_Bitangent, format: GfxFormat.S16_RGB_NORM, bufferByteOffset: 4*3, bufferIndex: 1, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: TerrainProgram.a_AreaLocalPosition, format: GfxFormat.U8_RG_NORM, bufferByteOffset: 0, bufferIndex: 2, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: TerrainProgram.a_GridAttributes, format: GfxFormat.F32_RGBA, bufferByteOffset: 0, bufferIndex: 3, frequency: GfxVertexAttributeFrequency.PER_INSTANCE, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });
    }

    public drawRenderInst(renderInst: GfxRenderInst, sub: number) {
        renderInst.drawIndexes(this.subSectionCount[sub], this.subSectionFirstIndex[sub]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.areaLocalPositionBuffer);
        device.destroyInputLayout(this.inputLayout);
    }
}

export class TerrainAreaRenderer {
    public destroyed: boolean = false;
    public renderInsts: GfxRenderInst[] = [];
    public templateRenderInst: GfxRenderInst;
    // Written to by TerrainManager
    public chunkRenderMask: number = 0;

    constructor(public areaInfo: AreaInfo, public loadedArea: LoadedTerrainArea) {
    }

    public buildRenderInsts(device: GfxDevice, staticData: TerrainAreaRendererStatic, renderInstBuilder: GfxRenderInstBuilder): void {
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        const inputBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.loadedArea.posBuffer, byteOffset: 0, byteStride: 0 },
            { buffer: this.loadedArea.nbtBuffer, byteOffset: 0, byteStride: 0 },
            { buffer: staticData.areaLocalPositionBuffer, byteOffset: 0, byteStride: 0 },
            { buffer: this.loadedArea.gridAttributesBuffer, byteOffset: 0, byteStride: 0 },
        ];
        this.templateRenderInst.inputState = device.createInputState(staticData.inputLayout, inputBuffers, { buffer: staticData.indexBuffer, byteOffset: 0, byteStride: 0 });
        this.templateRenderInst.setSamplerBindings([{ texture: this.loadedArea.mateTexture, sampler: null }], 2);

        for (let i = 0; i < 4; i++) {
            this.renderInsts[i] = renderInstBuilder.pushRenderInst();
            staticData.drawRenderInst(this.renderInsts[i], i);
        }

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        const isVisibleFrustum = viewerInput.camera.frustum.contains(this.loadedArea.aabb);

        for (let i = 0; i < this.renderInsts.length; i++) {
            this.renderInsts[i].visible = isVisibleFrustum && !!(this.chunkRenderMask & (1 << i));
        }
    }

    public destroy(device: GfxDevice): void {
        this.destroyed = true;
        this.loadedArea.destroy(device);
        device.destroyInputState(this.templateRenderInst.inputState);
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].destroy();
    }
}

const scratch = mat4.create();
export class TerrainRenderer {
    private sceneUniformBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, "ub_SceneParams");
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private gfxProgram: GfxProgram;
    private areaRenderers: TerrainAreaRenderer[] = [];
    public heightScale = 1.0;

    constructor(device: GfxDevice, textureHolder: GX2TextureHolder, private staticData: TerrainAreaRendererStatic, public viewRenderer: GfxRenderInstViewRenderer) {
        this.gfxProgram = device.createProgram(new TerrainProgram());
        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 2 },
            { numUniformBuffers: 0, numSamplers: 1 },
        ];
        this.renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [this.sceneUniformBuffer]);

        this.templateRenderInst = this.renderInstBuilder.newRenderInst();

        const textureMappings = nArray(2, () => new TextureMapping());
        textureHolder.fillTextureMapping(textureMappings[0], 'MaterialAlb');
        textureHolder.fillTextureMapping(textureMappings[1], 'MaterialCmb');
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMappings);

        this.templateRenderInst.gfxProgram = this.gfxProgram;
        this.templateRenderInst.setRenderFlags({ depthCompare: GfxCompareMode.LESS, depthWrite: true });
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, TerrainProgram.ub_SceneParams);
        this.renderInstBuilder.finish(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs: number;

        viewerInput.camera.setClipPlanes(20, 500000);

        // Compute view projection.
        mat4.mul(scratch, viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix);
        offs = this.templateRenderInst.uniformBufferOffsets[TerrainProgram.ub_SceneParams];
        const sceneBuffer = this.sceneUniformBuffer.mapBufferF32(offs, 20);
        offs += fillMatrix4x4(sceneBuffer, offs, scratch);
        offs += fillVec4(sceneBuffer, offs, this.heightScale);

        for (let i = this.areaRenderers.length - 1; i >= 0; i--)
            if (this.areaRenderers[i].destroyed)
                this.areaRenderers.splice(i, 1);

        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(viewerInput);

        this.sceneUniformBuffer.prepareToRender(hostAccessPass);
    }

    public addTerrainArea(device: GfxDevice, areaInfo: AreaInfo, loadedArea: LoadedTerrainArea): TerrainAreaRenderer {
        const areaRenderer = new TerrainAreaRenderer(areaInfo, loadedArea);
        this.renderInstBuilder.pushTemplateRenderInst(this.templateRenderInst);
        areaRenderer.buildRenderInsts(device, this.staticData, this.renderInstBuilder);
        this.areaRenderers.push(areaRenderer);
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, this.viewRenderer);
        return areaRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.sceneUniformBuffer.destroy(device);
        device.destroyProgram(this.gfxProgram);
    }
}

export class TerrainScene extends BasicRendererHelper implements Viewer.Scene_Device {
    public terrainRenderer: TerrainRenderer;
    public staticData: TerrainAreaRendererStatic;
    public timeoutId: number = 0;
    public cameraPositionX: number = 0;
    public cameraPositionZ: number = 0;

    constructor(device: GfxDevice, public textureHolder: GX2TextureHolder, public terrainManager: TerrainManager) {
        super();
        this.staticData = new TerrainAreaRendererStatic(device, 256, 256);
        this.terrainRenderer = new TerrainRenderer(device, textureHolder, this.staticData, this.viewRenderer);
        this.terrainManager.terrainRenderer = this.terrainRenderer;
        // this.updateTerrainCameraPosition();
        this.terrainManager.setWorldPosition(0, 0);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.invert(scratch, viewerInput.camera.viewMatrix);
        this.cameraPositionX = scratch[12];
        this.cameraPositionZ = scratch[14];
        this.terrainManager.prepareToRender();
        this.terrainRenderer.prepareToRender(hostAccessPass, viewerInput);
    }

    public updateTerrainCameraPosition(): void {
        this.terrainManager.setCameraPosition(this.cameraPositionX, this.cameraPositionZ);
        setTimeout(() => this.updateTerrainCameraPosition(), 1000);
    }

    public destroy(device: GfxDevice): void {
        this.terrainRenderer.destroy(device);
        this.textureHolder.destroyGfx(device);
    }
}
