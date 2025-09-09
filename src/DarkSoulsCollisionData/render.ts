
import { vec3 } from 'gl-matrix';

import { DeviceProgram } from '../Program.js';
import * as Viewer from '../viewer.js';
import * as UI from '../ui.js';

import * as IV from './iv.js';
import { GfxDevice, GfxBufferUsage, GfxBuffer, GfxFormat, GfxInputLayout, GfxProgram, GfxBindingLayoutDescriptor, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxCullMode, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBufferFrequencyHint } from '../gfx/platform/GfxPlatform.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { CameraController } from '../Camera.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

layout(std140) uniform ub_ObjectParams {
    vec4 u_Color;
};

varying float v_LightIntensity;

#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;

void mainVS() {
    const float t_ModelScale = 20.0;
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position * t_ModelScale, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_LightIntensity = -dot(a_Normal, t_LightDirection);
}
#endif

#ifdef FRAG
void mainPS() {
    float t_LightTint = 0.3 * v_LightIntensity;
    gl_FragColor = u_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);
}
#endif
`;
}

class Chunk {
    public numVertices: number;
    public posBuffer: GfxBuffer;
    public nrmBuffer: GfxBuffer;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private visible = true;

    constructor(device: GfxDevice, public chunk: IV.Chunk, private inputLayout: GfxInputLayout) {
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

        this.posBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, posData.buffer);
        this.nrmBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, nrmData.buffer);

        this.vertexBufferDescriptors = [
            { buffer: this.posBuffer },
            { buffer: this.nrmBuffer },
        ];

        this.numVertices = chunk.indexData.length;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, null);
        renderInst.setDrawCount(this.numVertices);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nrmBuffer);
    }
}

export class IVRenderer {
    public visible: boolean = true;
    public name: string;

    private chunks: Chunk[];

    constructor(device: GfxDevice, public iv: IV.IV, inputLayout: GfxInputLayout) {
        this.name = iv.name;
        this.chunks = this.iv.chunks.map((chunk) => new Chunk(device, chunk, inputLayout));
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        const templateRenderInst = renderInstManager.pushTemplate();

        let offs = templateRenderInst.allocateUniformBuffer(IVProgram.ub_ObjectParams, 4);
        const d = templateRenderInst.mapUniformBufferF32(IVProgram.ub_ObjectParams);
        offs += fillColor(d, offs, this.iv.color);

        for (let i = 0; i < this.chunks.length; i++)
            this.chunks[i].prepareToRender(renderInstManager);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        this.chunks.forEach((chunk) => chunk.destroy(device));
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 }, // ub_SceneParams
];

export class Scene implements Viewer.SceneGfx {
    private inputLayout: GfxInputLayout;
    private program: GfxProgram;
    private ivRenderers: IVRenderer[] = [];
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, public ivs: IV.IV[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new IVProgram());

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: IVProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
            { location: IVProgram.a_Normal,   bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat: GfxFormat | null = null;
        const cache = this.renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.ivRenderers = this.ivs.map((iv) => {
            return new IVRenderer(device, iv, this.inputLayout);
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back });

        let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        for (let i = 0; i < this.ivRenderers.length; i++)
            this.ivRenderers[i].prepareToRender(this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.ivRenderers.forEach((r) => r.destroy(device));
        this.renderHelper.destroy();
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.ivRenderers);
        return [layersPanel];
    }
}
