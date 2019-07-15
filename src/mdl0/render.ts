
import * as MDL0 from './mdl0';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { OrbitCameraController } from '../Camera';
import { GfxBlendMode, GfxBlendFactor, GfxDevice, GfxBufferUsage, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';

class FancyGrid_Program extends DeviceProgram {
    public static a_Position = 0;
    public static ub_Scene = 0;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
};

layout(location = ${FancyGrid_Program.a_Position}) attribute vec3 a_Position;
varying float v_EyeFade;
varying vec2 v_SurfCoord;

void main() {
    v_SurfCoord = a_Position.xz;

    float t_Scale = 200.0;
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position * t_Scale, 1.0)));

    vec3 V = Mul(vec3(0.0, 0.0, 1.0), u_ModelView).xyz;
    vec3 N = vec3(0.0, 1.0, 0.0);
    v_EyeFade = dot(V, N);
}
`;

    public frag = `
precision highp float;
varying float v_EyeFade;
varying vec2 v_SurfCoord;

void main() {
    float t_DistFromCenter = distance(v_SurfCoord, vec2(0.0));
    vec2 t_UV = (v_SurfCoord + 1.0) * 0.5;

    vec4 t_Color;
    t_Color.a = 1.0;

    // Base Grid color
    t_Color.rgb = mix(vec3(0.8, 0.0, 0.8), vec3(0.4, 0.2, 0.8), clamp(t_DistFromCenter * 1.5, 0.0, 1.0));
    t_Color.a *= clamp(mix(2.0, 0.0, t_DistFromCenter), 0.0, 1.0);

    // Grid lines mask.
    t_UV *= 80.0;
    float t_SharpDx = clamp(1.0 / min(abs(dFdx(t_UV.x)), abs(dFdy(t_UV.y))), 2.0, 20.0);
    float t_SharpMult = t_SharpDx * 10.0;
    float t_SharpOffs = t_SharpDx * 4.40;
    vec2 t_GridM = (abs(fract(t_UV) - 0.5)) * t_SharpMult - t_SharpOffs;
    float t_GridMask = max(t_GridM.x, t_GridM.y);
    t_Color.a *= clamp(t_GridMask, 0.0, 1.0);

    t_Color.a += (1.0 - clamp(t_DistFromCenter * 1.2, 0.0, 1.0)) * 0.5 * v_EyeFade;

    // Eye fade.
    t_Color.a *= clamp(v_EyeFade, 0.3, 1.0);
    gl_FragColor = t_Color;

    gl_FragDepth = gl_FragCoord.z + 1e-6;
}
`;
}

const fancyGridBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 0, numUniformBuffers: 1 },
];

class FancyGrid {
    public gfxProgram: GfxProgram;
    private posBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    constructor(device: GfxDevice) {
        const program = new FancyGrid_Program();
        this.gfxProgram = device.createProgram(program);

        const vtx = new Float32Array(4 * 3);
        vtx[0]  = -1;
        vtx[1]  = 0;
        vtx[2]  = -1;
        vtx[3]  = 1;
        vtx[4]  = 0;
        vtx[5]  = -1;
        vtx[6]  = -1;
        vtx[7]  = 0;
        vtx[8]  = 1;
        vtx[9]  = 1;
        vtx[10] = 0;
        vtx[11] = 1;
        this.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vtx.buffer);

        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, 4).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FancyGrid_Program.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        })
        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.posBuffer, byteOffset: 0, byteStride: 12 },
        ];
        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.idxBuffer, byteOffset: 0, byteStride: 1 });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(fancyGridBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });
        renderInst.drawIndexes(6);

        let offs = renderInst.allocateUniformBuffer(FancyGrid_Program.a_Position, 4*4 + 4*3);
        const mappedF32 = renderInst.mapUniformBufferF32(FancyGrid_Program.a_Position);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewerInput.camera.viewMatrix);
    }

    public destroy(device: GfxDevice) {
        device.destroyProgram(this.gfxProgram);
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class MDL0_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;

    public static ub_SceneParams = 0;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
};

layout(location = ${MDL0_Program.a_Position}) attribute vec3 a_Position;
layout(location = ${MDL0_Program.a_Color}) attribute vec4 a_Color;
varying vec4 v_Color;

void main() {
    v_Color = a_Color.bgra;
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
}
`;

    public frag = `
precision mediump float;

varying vec4 v_Color;

void main() {
    gl_FragColor = v_Color;
}
`;
}

const mdl0BindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 0, numUniformBuffers: 1 },
];

class MDL0Renderer {
    private gfxProgram: GfxProgram;
    private posBuffer: GfxBuffer;
    private clrBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputStates: GfxInputState[] = [];

    constructor(device: GfxDevice, public mdl0: MDL0.MDL0) {
        const program = new MDL0_Program();
        this.gfxProgram = device.createProgram(program);

        this.posBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, this.mdl0.vtxData);
        this.clrBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, this.mdl0.clrData);
        this.idxBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.INDEX, this.mdl0.idxData);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MDL0_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: MDL0_Program.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });

        for (let i = 0; i < this.mdl0.animCount; i++) {
            const posByteOffset = i * this.mdl0.animSize;
            const inputState = device.createInputState(this.inputLayout, [
                { buffer: this.posBuffer, byteOffset: posByteOffset, byteStride: this.mdl0.vertSize },
                { buffer: this.clrBuffer, byteOffset: 0, byteStride: 4 },
            ], { buffer: this.idxBuffer, byteOffset: 0, byteStride: 2 });
            this.inputStates.push(inputState);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(mdl0BindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);

        const frameNumber = ((viewerInput.time / 16) % this.mdl0.animCount) | 0;
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputStates[frameNumber]);

        const idxCount = this.mdl0.idxData.byteLength / 2;
        renderInst.drawIndexes(idxCount);

        let offs = renderInst.allocateUniformBuffer(MDL0_Program.ub_SceneParams, 4*4 + 4*3);
        const mappedF32 = renderInst.mapUniformBufferF32(MDL0_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewerInput.camera.viewMatrix);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.clrBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        for (let i = 0; i < this.inputStates.length; i++)
            device.destroyInputState(this.inputStates[i]);
    }
}

class SonicManiaSceneRenderer implements Viewer.SceneGfx {
    public defaultCameraController = OrbitCameraController;

    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    public mdl0Renderer: MDL0Renderer;
    public fancyGrid: FancyGrid;

    constructor(device: GfxDevice, mdl0: MDL0.MDL0) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);

        this.mdl0Renderer = new MDL0Renderer(device, mdl0);
        this.fancyGrid = new FancyGrid(device);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        this.mdl0Renderer.prepareToRender(this.renderInstManager, viewerInput);
        this.fancyGrid.prepareToRender(this.renderInstManager, viewerInput);
        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice) {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);
        this.mdl0Renderer.destroy(device);
        this.fancyGrid.destroy(device);
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<SonicManiaSceneRenderer> {
        return fetchData(this.path, abortSignal).then((result: ArrayBufferSlice) => {
            const mdl0 = MDL0.parse(result);
            return new SonicManiaSceneRenderer(device, mdl0);
        });
    }
}
