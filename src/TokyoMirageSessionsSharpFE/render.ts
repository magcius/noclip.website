import { GfxDevice, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor,
         GfxVertexBufferFrequency, GfxInputLayout, GfxFormat, GfxProgram, GfxBufferFrequencyHint,
         GfxBufferUsage, GfxBindingLayoutDescriptor, GfxCullMode, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, SceneGroup, ViewerRenderInput } from "../viewer.js";
import * as BFRES from "./bfres/bfres_switch.js";
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
    private fres: BFRES.FRES;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    constructor(device: GfxDevice, fres: BFRES.FRES)
    {
        this.fres = fres;
        this.renderHelper = new GfxRenderHelper(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void
    {
        // create a draw call for every mesh in the fmdl
        const fmdl = this.fres.fmdl[0];
        const shapes = fmdl.fshp;
        for (let i = 0; i < 5; i++)
        {
            this.renderHelper.pushTemplateRenderInst();
            const renderInst = this.renderHelper.renderInstManager.newRenderInst();

            // create vertex buffers
            const fvtx = fmdl.fvtx[shapes[i].fvtx_index];
            
            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] =
            [
                { location: 0, format: fvtx.vertexAttributes[0].format, bufferIndex: fvtx.vertexAttributes[0].bufferIndex, bufferByteOffset: fvtx.vertexAttributes[0].bufferOffset},
            ];
            
            const inputLayoutBufferDescriptors: GfxInputLayoutBufferDescriptor[] =
            [
                { byteStride: fvtx.vertexBuffers[0].stride, frequency: GfxVertexBufferFrequency.PerVertex },
            ];
            
            const indexBufferFormat = shapes[i].mesh[0].index_buffer_format;
            const cache = this.renderHelper.renderCache;
            const inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: inputLayoutBufferDescriptors, indexBufferFormat });
            
            
            const gfx_buffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, fvtx.vertexBuffers[0].data);
            const vertexBufferDescriptors =
            [
                { buffer: gfx_buffer },
            ];

            const index_buffer = createBufferFromSlice(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shapes[i].mesh[0].index_buffer_data);
            const indexBufferDescriptor = { buffer: index_buffer };

            renderInst.setVertexInput(inputLayout, vertexBufferDescriptors, indexBufferDescriptor);
            renderInst.setDrawCount(shapes[i].mesh[0].index_count);

            // define uniform and samplers
            renderInst.setBindingLayouts(bindingLayouts);

            // set shader
            const program = this.renderHelper.renderCache.createProgram(new TMSFEProgram());
            renderInst.setGfxProgram(program);

            renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
            
            // create uniform buffers for use by the shader
            let offs = renderInst.allocateUniformBuffer(TMSFEProgram.ub_SceneParams, 32);
            const mapped = renderInst.mapUniformBufferF32(TMSFEProgram.ub_SceneParams);
            offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
            offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
            
            this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
            this.renderHelper.renderInstManager.submitRenderInst(renderInst);
            this.renderHelper.renderInstManager.popTemplate();
        }

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
        // TODO: destroy vertex buffer, index buffer, etc
    }
}