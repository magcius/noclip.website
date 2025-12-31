import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxFormat, GfxProgram, GfxBufferFrequencyHint,
         GfxBufferUsage, GfxBindingLayoutDescriptor, GfxCullMode } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, SceneGroup, ViewerRenderInput } from "../viewer.js";
import * as BFRES from "./bfres_switch.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { DeviceProgram } from '../Program.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { createBufferFromData, createBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { fillColor, fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { mat4, vec2, vec3 } from 'gl-matrix';
import { Color, colorNewFromRGBA } from "../Color";

class TMSFEProgram extends DeviceProgram {
    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams
{
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

#ifdef VERT
layout(location = ${TMSFEProgram.a_Position}) attribute vec3 a_Position;

void mainVS()
{
    vec3 t_PositionWorld = UnpackMatrix(u_ModelView) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionWorld, 1.0);
}
#endif

#ifdef FRAG
void mainPS()
{
    gl_FragColor = vec4(0.0, 0.0, 1.0, 0.0);
}
#endif
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] =
[
    { numUniformBuffers: 2, numSamplers: 0 },
];

export class TMSFEScene implements SceneGfx
{
    private renderHelper: GfxRenderHelper;
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: (GfxVertexBufferDescriptor | null)[];
    private renderInstListMain = new GfxRenderInstList();
    private vertexCount: number;
    private fmdl: BFRES.FMDL;

    constructor(device: GfxDevice, fmdl: BFRES.FMDL)
    {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = this.renderHelper.renderCache.createProgram(new TMSFEProgram());
        /*
        const fvtx = fmdl.fvtx[0];
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
        [
            { location: 0, format: fvtx.vertexAttributes[0].format, bufferIndex: fvtx.vertexAttributes[0].bufferIndex, bufferByteOffset: fvtx.vertexAttributes[0].bufferOffset},
        ];
        console.log(vertexAttributeDescriptors);

        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
        [
            { byteStride: fvtx.vertexBuffers[0].stride, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        console.log(inputLayoutBufferDescriptors);

        const indexBufferFormat: GfxFormat | null = null;
        const cache = this.renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });

        
        const gfx_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[0].data);
        this.vertexBufferDescriptors =
        [
            { buffer: gfx_buffer },
        ];
        */
       // test render a triangle
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
        [
            { location: 0, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0 },
        ];
        const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
        [
            { byteStride: 0xC, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        const indexBufferFormat: GfxFormat | null = null;
        const cache = this.renderHelper.renderCache;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });

        // make vertex buffer
        var positions =
        [
            -10.0, 10.0, 0,
            10.0, 10, 0,
            10, -10, 0,
            -10, 10, 0,
            10, -10, 0,
            -10, -10, 0,
            // -198.0884, -647.991, -242.2954,
            // -194.6871, -645.1612, -238.2419,
            // -189.0081, -671.5596, -231.4739,
		];

        this.vertexCount = positions.length / 3;

        const vertexData = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i++)
        {
            vertexData[i] = positions[i];
        }
        console.log(vertexData);

        // const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.buffer);
        // this.vertexBufferDescriptors =
        // [
        //     { buffer: vertexBuffer },
        // ];

        // try reading my vertex data
        const fvtx = fmdl.fvtx[0];
        this.fmdl = fmdl;
        const data = fvtx.vertexBuffers[0].data;
        this.vertexCount = fvtx.vertexCount;
        // console.log(fvtx);
        // console.log(this.vertexCount);
        // const view = data.createDataView();
        // const x = view.getFloat32(0, true);
        // console.log(x);
        const gfx_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, data);
        this.vertexBufferDescriptors =
        [
            { buffer: gfx_buffer },
        ];
    }


    public debugDrawVertices(viewerInput: ViewerRenderInput)
    {
        const fvtx = this.fmdl.fvtx[0];
        const vertexData = fvtx.vertexBuffers[0].data;
        const view = vertexData.createDataView();
        const vec = vec3.create();

        for (let i = 0; i < this.vertexCount * 3 ; i += 3) {
            vec3.set(vec, view.getFloat32(i * 4 + 0, true), view.getFloat32(i * 4 + 4, true), view.getFloat32(i * 4 + 8, true));
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, vec, colorNewFromRGBA(0.0, 1.0, 0.0, 1.0));
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        this.debugDrawVertices(viewerInput);
        this.renderHelper.pushTemplateRenderInst();
        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, null);
        renderInst.setDrawCount(this.vertexCount);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setGfxProgram(this.program);
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        
        let offs = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 32);
        const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderHelper.renderInstManager.submitRenderInst(renderInst);
        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

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

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void
    {
        this.renderHelper.destroy();
    }
}