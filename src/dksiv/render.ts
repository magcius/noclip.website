
import { vec3 } from 'gl-matrix';

import { DeviceProgram } from '../Program';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import * as IV from './iv';
import { GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxBuffer, GfxPrimitiveTopology, GfxInputState, GfxFormat, GfxInputLayout, GfxProgram, GfxBindingLayoutDescriptor, GfxRenderPipeline, GfxRenderPass, GfxCompareMode, GfxBindings, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BufferFillerHelper, fillColor } from '../gfx/helpers/UniformBufferHelpers';
import { BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderInst, GfxRenderInstViewRenderer, GfxRenderInstBuilder } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { RenderFlags } from '../gfx/helpers/RenderFlagsHelpers';
import { assert } from '../util';

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

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
    public renderInst: GfxRenderInst;

    constructor(device: GfxDevice, public chunk: IV.Chunk, inputLayout: GfxInputLayout, renderInstBuilder: GfxRenderInstBuilder, baseRenderInst: GfxRenderInst) {
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

        const hostAccessPass = device.createHostAccessPass();

        this.posBuffer = device.createBuffer(posData.length, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);
        this.nrmBuffer = device.createBuffer(nrmData.length, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.STATIC);

        hostAccessPass.uploadBufferData(this.posBuffer, 0, new Uint8Array(posData.buffer));
        hostAccessPass.uploadBufferData(this.nrmBuffer, 0, new Uint8Array(nrmData.buffer));

        device.submitPass(hostAccessPass);

        this.inputState = device.createInputState(inputLayout, [
            { buffer: this.posBuffer, wordOffset: 0, byteStride: 0 },
            { buffer: this.nrmBuffer, wordOffset: 0, byteStride: 0 },
        ], null);

        this.numVertices = chunk.indexData.length;

        this.renderInst = new GfxRenderInst(baseRenderInst);
        this.renderInst.drawTriangles(this.numVertices);
        this.renderInst.inputState = this.inputState;
        renderInstBuilder.pushRenderInst(this.renderInst);
    }

    public prepareForRender(hostAccessPass: GfxHostAccessPass, visible: boolean): void {
        this.renderInst.visible = visible;
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
    public colorBufferOffset: number;

    private chunks: Chunk[];

    constructor(device: GfxDevice, public iv: IV.IV, inputLayout: GfxInputLayout, renderInstBuilder: GfxRenderInstBuilder, baseRenderInst: GfxRenderInst) {
        // TODO(jstpierre): Coalesce chunks?
        this.name = iv.name;

        const renderInst = new GfxRenderInst(baseRenderInst);
        this.colorBufferOffset = renderInstBuilder.newUniformBufferInstance(renderInst, IVProgram.ub_ObjectParams);

        this.chunks = this.iv.chunks.map((chunk) => new Chunk(device, chunk, inputLayout, renderInstBuilder, renderInst));
    }

    public fillColorUniformBufferData(hostAccessPass: GfxHostAccessPass, buffer: GfxRenderBuffer): void {
        const d = new Float32Array(4);
        let offs = 0;
        offs += fillColor(d, offs, this.iv.color);
        buffer.uploadSubData(hostAccessPass, this.colorBufferOffset, d);
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareForRender(hostAccessPass: GfxHostAccessPass): void {
        for (let i = 0; i < this.chunks.length; i++)
            this.chunks[i].prepareForRender(hostAccessPass, this.visible);
    }

    public destroy(device: GfxDevice): void {
        this.chunks.forEach((chunk) => chunk.destroy(device));
    }
}

export class Scene implements Viewer.Scene_Device {
    private inputLayout: GfxInputLayout;
    private pipeline: GfxRenderPipeline;
    private program: GfxProgram;
    private sceneUniformBufferFiller: BufferFillerHelper;
    private sceneUniformBuffer: GfxRenderBuffer;
    private colorUniformBuffer: GfxRenderBuffer;
    private renderTarget = new BasicRenderTarget();
    private ivRenderers: IVRenderer[] = [];
    private sceneUniformBufferBinding: GfxBindings;
    private viewRenderer = new GfxRenderInstViewRenderer();

    constructor(device: GfxDevice, public ivs: IV.IV[]) {
        this.program = device.createProgram(new IVProgram());

        this.inputLayout = device.createInputLayout([
            { location: IVProgram.a_Position, bufferIndex: 0, bufferWordOffset: 0, format: GfxFormat.F32_RGB },
            { location: IVProgram.a_Normal,   bufferIndex: 1, bufferWordOffset: 0, format: GfxFormat.F32_RGB },
        ], null);

        // Two binding layouts: one scene level, one object level.
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // ub_SceneParams
            { numUniformBuffers: 1, numSamplers: 0 }, // ub_ObjectParams
        ];

        const renderFlags = new RenderFlags();
        renderFlags.depthWrite = true;

        this.pipeline = device.createRenderPipeline({
            topology: GfxPrimitiveTopology.TRIANGLES,
            bindingLayouts: bindingLayouts,
            inputLayout: this.inputLayout,
            program: this.program,
            megaStateDescriptor: renderFlags.resolveMegaState(),
        });

        this.sceneUniformBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        this.colorUniformBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.STATIC);

        const programReflection = device.queryProgram(this.program);
        const sceneBufferLayout = programReflection.uniformBufferLayouts[IVProgram.ub_SceneParams];
        this.sceneUniformBufferFiller = new BufferFillerHelper(sceneBufferLayout);

        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [ this.sceneUniformBuffer, this.colorUniformBuffer ]);

        const baseRenderInst = new GfxRenderInst();
        baseRenderInst.setPipelineDirect(this.pipeline);

        // Nab a scene buffer instance.
        const sceneParamsOffs = renderInstBuilder.newUniformBufferInstance(baseRenderInst, IVProgram.ub_SceneParams);
        assert(sceneParamsOffs == 0);

        this.ivRenderers = this.ivs.map((iv) => {
            return new IVRenderer(device, iv, this.inputLayout, renderInstBuilder, baseRenderInst);
        });

        renderInstBuilder.finish(device, this.viewRenderer);

        // Now that we have our buffers created, fill 'em in.
        const hostAccessPass = device.createHostAccessPass();
        for (let i = 0; i < this.ivRenderers.length; i++)
            this.ivRenderers[i].fillColorUniformBufferData(hostAccessPass, this.colorUniformBuffer);
        this.colorUniformBuffer.prepareToRender(hostAccessPass);
        device.submitPass(hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.sceneUniformBufferFiller.reset();
        this.sceneUniformBufferFiller.fillMatrix4x4(viewerInput.camera.projectionMatrix);
        this.sceneUniformBufferFiller.fillMatrix4x4(viewerInput.camera.viewMatrix);
        this.sceneUniformBufferFiller.endAndUpload(hostAccessPass, this.sceneUniformBuffer);

        for (let i = 0; i < this.ivRenderers.length; i++)
            this.ivRenderers[i].prepareForRender(hostAccessPass);

        this.sceneUniformBuffer.prepareToRender(hostAccessPass);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, passRenderer);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.sceneUniformBuffer.destroy(device);
        this.colorUniformBuffer.destroy(device);
        device.destroyRenderPipeline(this.pipeline);
        device.destroyInputLayout(this.inputLayout);
        device.destroyProgram(this.program);
        device.destroyBindings(this.sceneUniformBufferBinding);
        this.ivRenderers.forEach((r) => r.destroy(device));
        this.viewRenderer.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.ivRenderers);
        return [layersPanel];
    }
}
