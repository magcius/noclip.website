
import { vec3 } from 'gl-matrix';

import { RenderFlags } from '../render';
import { DeviceProgram } from '../Program';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import * as IV from './iv';
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxBuffer, GfxPrimitiveTopology, GfxInputState, GfxFormat, GfxInputLayout, GfxProgram, GfxBindingLayoutDescriptor, GfxRenderPipeline, GfxPassRenderer } from '../gfx/platform/GfxPlatform';
import { BufferFillerHelper, fillColor } from '../gfx/helpers/BufferHelpers';
import { BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { GfxBindings } from '../gfx/platform/GfxPlatformImpl';

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
    mat4 u_ModelView;
};

layout(row_major, std140) uniform ub_ObjectParams {
    vec4 u_Color;
};

varying vec2 v_LightIntensity;

#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;

void mainVS() {
    const float t_ModelScale = 20.0;
    gl_Position = u_Projection * u_ModelView * vec4(a_Position * t_ModelScale, 1.0);
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    float t_LightIntensityF = dot(-a_Normal, t_LightDirection);
    float t_LightIntensityB = dot( a_Normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
#endif

#ifdef FRAG
void mainPS() {
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.3 * t_LightIntensity;
    gl_FragColor = u_Color + t_LightTint;
}
#endif
`;
}

class Chunk {
    public numVertices: number;
    public posBuffer: GfxBuffer;
    public nrmBuffer: GfxBuffer;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public chunk: IV.Chunk, inputLayout: GfxInputLayout) {
        // Run through our data, calculate normals and such.
        const t = vec3.create();

        const posData = new Float32Array(chunk.indexData.length * 3);
        const nrmData = new Float32Array(chunk.indexData.length * 3);

        for (let i = 0; i < chunk.indexData.length; i += 3) {
            const i0 = chunk.indexData[i + 0];
            const i1 = chunk.indexData[i + 1];
            const i2 = chunk.indexData[i + 2];

            const t0x = chunk.positionData[i0 * 3 + 0];
            const t0y = chunk.positionData[i0 * 3 + 1];
            const t0z = chunk.positionData[i0 * 3 + 2];
            const t1x = chunk.positionData[i1 * 3 + 0];
            const t1y = chunk.positionData[i1 * 3 + 1];
            const t1z = chunk.positionData[i1 * 3 + 2];
            const t2x = chunk.positionData[i2 * 3 + 0];
            const t2y = chunk.positionData[i2 * 3 + 1];
            const t2z = chunk.positionData[i2 * 3 + 2];

            vec3.cross(t, [t0x - t1x, t0y - t1y, t0z - t1z], [t0x - t2x, t0y - t2y, t0z - t2z]);
            vec3.normalize(t, t);

            posData[(i + 0) * 3 + 0] = t0x;
            posData[(i + 0) * 3 + 1] = t0y;
            posData[(i + 0) * 3 + 2] = t0z;
            posData[(i + 1) * 3 + 0] = t1x;
            posData[(i + 1) * 3 + 1] = t1y;
            posData[(i + 1) * 3 + 2] = t1z;
            posData[(i + 2) * 3 + 0] = t2x;
            posData[(i + 2) * 3 + 1] = t2y;
            posData[(i + 2) * 3 + 2] = t2z;

            nrmData[(i + 0) * 3 + 0] = t[0];
            nrmData[(i + 0) * 3 + 1] = t[1];
            nrmData[(i + 0) * 3 + 2] = t[2];
            nrmData[(i + 1) * 3 + 0] = t[0];
            nrmData[(i + 1) * 3 + 1] = t[1];
            nrmData[(i + 1) * 3 + 2] = t[2];
            nrmData[(i + 2) * 3 + 0] = t[0];
            nrmData[(i + 2) * 3 + 1] = t[1];
            nrmData[(i + 2) * 3 + 2] = t[2];
        }

        const hostUploader = device.createHostUploader();

        this.posBuffer = device.createBuffer(posData.length, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);
        this.nrmBuffer = device.createBuffer(nrmData.length, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);

        hostUploader.uploadBufferData(this.posBuffer, 0, posData);
        hostUploader.uploadBufferData(this.nrmBuffer, 0, nrmData);

        this.inputState = device.createInputState(inputLayout, [
            { buffer: this.posBuffer, offset: 0, stride: 0 },
            { buffer: this.nrmBuffer, offset: 0, stride: 0 },
        ], null);

        this.numVertices = chunk.indexData.length;
    }

    public render(passRenderer: GfxPassRenderer): void {
        passRenderer.setInputState(this.inputState);
        passRenderer.draw(this.numVertices, 0);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nrmBuffer);
        device.destroyInputState(this.inputState);
    }
}

export class IVRenderer {
    public visible: boolean = true;
    public name: string;

    private chunks: Chunk[];

    constructor(device: GfxDevice, public iv: IV.IV, inputLayout: GfxInputLayout, public objBindings: GfxBindings) {
        // TODO(jstpierre): Coalesce chunks?
        this.name = iv.name;
        this.chunks = this.iv.chunks.map((chunk) => new Chunk(device, chunk, inputLayout));
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public render(passRenderer: GfxPassRenderer): void {
        if (!this.visible)
            return;

        passRenderer.setBindings(1, this.objBindings);

        this.chunks.forEach((chunk) => {
            chunk.render(passRenderer);
        });
    }

    public destroy(device: GfxDevice): void {
        this.chunks.forEach((chunk) => chunk.destroy(device));
        device.destroyBindings(this.objBindings);
    }
}

export class Scene implements Viewer.Scene_Device {
    private inputLayout: GfxInputLayout;
    private pipeline: GfxRenderPipeline;
    private program: GfxProgram;
    private renderFlags: RenderFlags;
    private sceneUniformBufferFiller: BufferFillerHelper;
    private sceneUniformBuffer: GfxBuffer;
    private colorUniformBuffer: GfxBuffer;
    private renderTarget = new BasicRenderTarget();
    private ivRenderers: IVRenderer[] = [];
    private sceneUniformBufferBinding: GfxBindings;

    constructor(device: GfxDevice, public ivs: IV.IV[]) {
        this.program = device.createProgram(new IVProgram());

        this.inputLayout = device.createInputLayout([
            { location: IVProgram.a_Position, bufferIndex: 0, bufferOffset: 0, format: GfxFormat.F32_RGB },
            { location: IVProgram.a_Normal,   bufferIndex: 1, bufferOffset: 0, format: GfxFormat.F32_RGB },
        ], null);

        // Two binding layouts: one scene level, one object level.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // ub_SceneParams
            { numUniformBuffers: 1, numSamplers: 0 }, // ub_ObjectParams
        ];

        this.renderFlags = new RenderFlags();
        this.renderFlags.depthTest = true;

        this.pipeline = device.createRenderPipeline({
            topology: GfxPrimitiveTopology.TRIANGLES,
            bindingLayouts: bindingLayouts,
            inputLayout: this.inputLayout,
            program: this.program,
            renderFlags: this.renderFlags,
        });

        const deviceLimits = device.queryLimits();
        const colorWordCount = Math.max(4, deviceLimits.uniformBufferWordAlignment);
        const colorBufferTotalWordCount = colorWordCount * this.ivs.length;
        const colorData = new Float32Array(colorBufferTotalWordCount);

        for (let i = 0; i < this.ivs.length; i++)
            fillColor(colorData, colorWordCount * i, this.ivs[i].color);

        this.colorUniformBuffer = device.createBuffer(colorBufferTotalWordCount, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.STATIC);
        const hostUploader = device.createHostUploader();
        hostUploader.uploadBufferData(this.colorUniformBuffer, 0, colorData);

        device.destroyHostUploader(hostUploader);

        const sceneBufferLayout = device.queryProgram(this.program).uniformBuffers[0];
        this.sceneUniformBufferFiller = new BufferFillerHelper(sceneBufferLayout);
        this.sceneUniformBuffer = device.createBuffer(sceneBufferLayout.totalWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);

        this.sceneUniformBufferBinding = device.createBindings(bindingLayouts[0], [
            { buffer: this.sceneUniformBuffer, wordOffset: 0, wordCount: this.sceneUniformBufferFiller.bufferLayout.totalWordSize },
        ], []);

        this.ivRenderers = this.ivs.map((iv, i) => {
            const objBindings = device.createBindings(bindingLayouts[1], [
                { buffer: this.colorUniformBuffer, wordOffset: colorWordCount * i, wordCount: colorWordCount }
            ], []);
            return new IVRenderer(device, iv, this.inputLayout, objBindings);
        });
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxPassRenderer {
        this.sceneUniformBufferFiller.reset();
        this.sceneUniformBufferFiller.fillMatrix4x4(viewerInput.camera.projectionMatrix);
        this.sceneUniformBufferFiller.fillMatrix4x4(viewerInput.camera.viewMatrix);
        const hostUploader = device.createHostUploader();
        this.sceneUniformBufferFiller.endAndUpload(hostUploader, this.sceneUniformBuffer);
        device.destroyHostUploader(hostUploader);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        const passRenderer = device.createPassRenderer(this.renderTarget.gfxRenderTarget);
        passRenderer.setPipeline(this.pipeline);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        passRenderer.setBindings(0, this.sceneUniformBufferBinding);

        for (let i = 0; i < this.ivRenderers.length; i++)
            this.ivRenderers[i].render(passRenderer);

        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.sceneUniformBuffer);
        device.destroyBuffer(this.colorUniformBuffer);
        device.destroyRenderPipeline(this.pipeline);
        device.destroyInputLayout(this.inputLayout);
        device.destroyProgram(this.program);
        device.destroyBindings(this.sceneUniformBufferBinding);
        this.ivRenderers.forEach((r) => r.destroy(device));
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.ivRenderers);
        return [layersPanel];
    }
}
