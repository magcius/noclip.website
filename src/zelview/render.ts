
//@ts-ignore
import program_glsl from './program.glsl';
import * as Viewer from '../viewer';
import { mat4 } from 'gl-matrix';
import { GfxBindingLayoutDescriptor, GfxProgram, GfxCullMode, GfxBuffer, GfxBufferUsage, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxDevice, GfxFormat, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { DeviceProgram } from '../Program';
import { RSPOutput, Vertex } from './f3dex2';
import { assert } from '../util';
import { fillMatrix4x4, fillVec4, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';

class ZelviewProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    private static program = program_glsl;
    public both = ZelviewProgram.program;
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

class N64Data {
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
            { location: ZelviewProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, },
            { location: ZelviewProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: ZelviewProgram.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
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
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
];

export class ZelviewMeshRenderer {
    private n64Data: N64Data;
    private program: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;

    constructor(device: GfxDevice, rspOutput: RSPOutput) {
        this.n64Data = new N64Data(device, rspOutput);

        this.createProgram();
    }
    
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(ZelviewProgram.ub_SceneParams, 16 + 4);
        const mappedF32 = template.mapUniformBufferF32(ZelviewProgram.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        // XXX(beholdnec): Adapted from PaperMario64. Probably removable.
        const lodBias = -1.5;
        offs += fillVec4(mappedF32, offs, viewerInput.backbufferWidth, viewerInput.backbufferHeight, lodBias);

        {
            if (this.gfxProgram === null)
                this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

            const template = renderInstManager.pushTemplateRenderInst();

            template.setGfxProgram(this.gfxProgram);
            template.setInputLayoutAndState(this.n64Data.inputLayout, this.n64Data.inputState);

            let offs = template.allocateUniformBuffer(ZelviewProgram.ub_DrawParams, 12 + 8*2);
            const mappedF32 = template.mapUniformBufferF32(ZelviewProgram.ub_DrawParams);

            // TODO: Model matrix goes here
            const identity = mat4.create();
            offs += fillMatrix4x3(mappedF32, offs, identity);

            for (let i = 0; i < this.n64Data.rspOutput.drawCalls.length; i++) {
                const drawCall = this.n64Data.rspOutput.drawCalls[i];
                const renderInst = renderInstManager.pushRenderInst();
                renderInst.drawIndexes(drawCall.indexCount, drawCall.firstIndex);
                const megaStateFlags = renderInst.getMegaStateFlags();
                megaStateFlags.cullMode = translateCullMode(drawCall.SP_GeometryMode);

                const depth = 65536; // TODO
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            }

            renderInstManager.popTemplateRenderInst();
        }

        renderInstManager.popTemplateRenderInst();
    }
    
    public destroy(device: GfxDevice): void {
        this.n64Data.destroy(device);
    }
    
    private createProgram(): void {
        const program = new ZelviewProgram();

        program.defines.set(`USE_TEXTFILT_POINT`, '1');

        this.gfxProgram = null;
        this.program = program;
    }
}
