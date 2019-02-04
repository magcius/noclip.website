
import * as MDL0 from './mdl0';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { OrbitCameraController } from '../Camera';
import { GfxBlendMode, GfxBlendFactor, GfxDevice, GfxBufferUsage, GfxBuffer, GfxProgram, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstBuilder, GfxRenderInstViewRenderer, GfxRenderInst } from '../gfx/render/GfxRenderer';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { BasicRendererHelper } from '../oot3d/render';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';

class FancyGrid_Program extends DeviceProgram {
    public static a_Position = 0;
    public static ub_Scene = 0;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
    mat4x3 u_ModelView;
};

layout(location = ${FancyGrid_Program.a_Position}) attribute vec3 a_Position;
varying float v_EyeFade;
varying vec2 v_SurfCoord;

void main() {
    v_SurfCoord = a_Position.xz;

    float t_Scale = 200.0;
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(a_Position * t_Scale, 1.0);

    vec3 V = (vec3(0.0, 0.0, 1.0) * u_ModelView).xyz;
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

class FancyGrid {
    public gfxProgram: GfxProgram;
    private posBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private sceneParamsBuffer: GfxRenderBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private renderInst: GfxRenderInst;

    constructor(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        const program = new FancyGrid_Program();
        this.gfxProgram = device.createProgram(program);
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);

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

        const programReflection = device.queryProgram(this.gfxProgram);
        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numSamplers: 0, numUniformBuffers: 1 },
        ];
        const uniformBuffers = [ this.sceneParamsBuffer ];
        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, uniformBuffers);

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
        this.renderInst = renderInstBuilder.pushRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.renderInst, 0);
        this.renderInst.gfxProgram = this.gfxProgram;
        this.renderInst.inputState = this.inputState;
        this.renderInst.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });
        this.renderInst.drawIndexes(6);

        renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.renderInst.getUniformBufferOffset(FancyGrid_Program.a_Position);
        const mappedF32 = this.sceneParamsBuffer.mapBufferF32(offs, 4*7);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewerInput.camera.viewMatrix);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice) {
        device.destroyProgram(this.gfxProgram);
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        this.sceneParamsBuffer.destroy(device);
    }
}

class MDL0_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;

    public static ub_SceneParams = 0;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
    mat4x3 u_ModelView;
};

layout(location = ${MDL0_Program.a_Position}) attribute vec3 a_Position;
layout(location = ${MDL0_Program.a_Color}) attribute vec4 a_Color;
varying vec4 v_Color;

void main() {
    v_Color = a_Color.bgra;
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(a_Position, 1.0);
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

class MDL0Renderer {
    private gfxProgram: GfxProgram;
    private posBuffer: GfxBuffer;
    private clrBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private templateRenderInst: GfxRenderInst;
    private renderInsts: GfxRenderInst[] = [];
    private sceneParamsBuffer: GfxRenderBuffer;

    constructor(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer, public mdl0: MDL0.MDL0) {
        const program = new MDL0_Program();
        this.gfxProgram = device.createProgram(program);
        const programReflection = device.queryProgram(this.gfxProgram);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numSamplers: 0, numUniformBuffers: 1 },
        ];
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        const uniformBuffers = [ this.sceneParamsBuffer ];
        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, uniformBuffers);

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

        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, MDL0_Program.ub_SceneParams);

        const idxCount = this.mdl0.idxData.byteLength / 2;

        for (let i = 0; i < this.mdl0.animCount; i++) {
            const posByteOffset = i * this.mdl0.animSize;
            const renderInst = renderInstBuilder.pushRenderInst();
            renderInst.inputState = device.createInputState(this.inputLayout, [
                { buffer: this.posBuffer, byteOffset: posByteOffset, byteStride: this.mdl0.vertSize },
                { buffer: this.clrBuffer, byteOffset: 0, byteStride: 4 },
            ], { buffer: this.idxBuffer, byteOffset: 0, byteStride: 2 });
            renderInst.drawIndexes(idxCount);

            this.renderInsts[i] = renderInst;
        }

        renderInstBuilder.popTemplateRenderInst();
        renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(FancyGrid_Program.a_Position);
        const mappedF32 = this.sceneParamsBuffer.mapBufferF32(offs, 4*7);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewerInput.camera.viewMatrix);

        const frameNumber = ((viewerInput.time / 16) % this.mdl0.animCount) | 0;
        for (let i = 0; i < this.renderInsts.length; i++) {
            this.renderInsts[i].visible = (i === frameNumber);
        }

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.clrBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        this.sceneParamsBuffer.destroy(device);
        for (let i = 0; i < this.renderInsts.length; i++)
            device.destroyInputState(this.renderInsts[i].inputState);
    }
}

class SceneRenderer extends BasicRendererHelper {
    public defaultCameraController = OrbitCameraController;

    public mdl0Renderer: MDL0Renderer;
    public fancyGrid: FancyGrid;

    constructor(device: GfxDevice, mdl0: MDL0.MDL0) {
        super();
        this.mdl0Renderer = new MDL0Renderer(device, this.viewRenderer, mdl0);
        this.fancyGrid = new FancyGrid(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.mdl0Renderer.prepareToRender(hostAccessPass, viewerInput);
        this.fancyGrid.prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice) {
        super.destroy(device);
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

    public createScene(device: GfxDevice): Progressable<SceneRenderer> {
        return fetchData(this.path).then((result: ArrayBufferSlice) => {
            const mdl0 = MDL0.parse(result);
            return new SceneRenderer(device, mdl0);
        });
    }
}
