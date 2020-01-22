import * as Viewer from '../viewer';
import { DeviceProgram } from '../Program';
import { GfxDevice, GfxProgram, GfxBlendMode, GfxBlendFactor, GfxFormat, GfxBufferUsage, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxRenderPassDescriptor, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { OpaqueBlack } from '../Color';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { BasicRenderTarget, makeClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { fillMatrix4x4, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

class SFA_Program extends DeviceProgram {
    public static readonly a_Position = 0;

    public static ub_SceneParams = 0;

    public both = `
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
};
`;

    public vert = `
layout(location = ${SFA_Program.a_Position}) in vec3 a_Position;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position.xyz, 1.0)));
}
`;

    public frag = `
void main() {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}
`;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 0, },
];

export class SFARenderer implements Viewer.SceneGfx {
    private clearRenderPassDescriptor: GfxRenderPassDescriptor;

    private renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    // private positions: Uint16Array;

    private program: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;

    constructor(device: GfxDevice, private positions: Int16Array) {
        this.renderHelper = new GfxRenderHelper(device);
        this.clearRenderPassDescriptor = makeClearRenderPassDescriptor(true, OpaqueBlack);
        this.program = new SFA_Program();
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderHelper.pushTemplateRenderInst();

        const renderInst = this.renderHelper.renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(bindingLayouts);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: SFA_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, },
            // { location: F3DZEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            // { location: F3DZEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferData = new Float32Array(this.positions.length);
        for (let i = 0; i < vertexBufferData.length; i++) {
            vertexBufferData[i] = this.positions[i] / 32768.0 * 512.0;
        }
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBufferData.buffer);

        const inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });
        const indexBufferData = new Uint32Array(this.positions.length / 3);
        for (let i = 0; i < indexBufferData.length; i++) {
            indexBufferData[i] = i;
        }
        const indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const inputState = device.createInputState(inputLayout, [
            { buffer: vertexBuffer, byteOffset: 0, },
        ], { buffer: indexBuffer, byteOffset: 0 });
        renderInst.setInputLayoutAndState(inputLayout, inputState);
        
        const megaStateFlags = {};
        setAttachmentStateSimple(megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });
        renderInst.setMegaStateFlags(megaStateFlags);

        const sceneParamsSize = 16 + 12;
        let offs = renderInst.allocateUniformBuffer(SFA_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = renderInst.mapUniformBufferF32(SFA_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewerInput.camera.viewMatrix);

        if (this.gfxProgram === null) {
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        }
        renderInst.setGfxProgram(this.gfxProgram);
        //renderInst.drawIndexes(indexBufferData.length);
        renderInst.drawPrimitives(indexBufferData.length);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.clearRenderPassDescriptor);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
    }

    public setPositions(positions: Uint16Array) {
        this.positions = positions;
    }
}
