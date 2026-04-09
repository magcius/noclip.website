import { mat4 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxProgram, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropPMO, DreamDropPMOShape } from "./bin";
import { computeModelMatrixSRT } from "../MathHelpers";

class Shader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_Shift;
};

varying vec4 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = ${Shader.a_Position}) in vec3 a_Position;
layout(location = ${Shader.a_Color}) in vec4 a_Color;
layout(location = ${Shader.a_UV}) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_UV = a_UV;
    gl_Position = UnpackMatrix(u_Projection) * UnpackMatrix(u_Shift) * vec4(a_Position, 1.0);
    // gl_Position = UnpackMatrix(u_Projection) * vec4(a_Position, 1.0);
}
#endif

#ifdef FRAG
void main() {
    gl_FragColor = v_Color;
}
#endif
    `;

    constructor() {
        super();
    }
}

const WORLD_SCALE = 1.0 / 500.0; // vertices are h u g e, scale them down
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 0 }];

export class DreamDropRoomRenderer implements Destroyable {
    private modelRenderers: ModelRenderer[];
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache, pmos: DreamDropPMO[]) {
        // this.gfxSampler = cache.createSampler({
        //     minFilter: GfxTexFilterMode.Point,
        //     magFilter: GfxTexFilterMode.Point,
        //     mipFilter: GfxMipFilterMode.Nearest,
        //     wrapS: GfxWrapMode.Repeat,
        //     wrapT: GfxWrapMode.Repeat
        // });
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: Shader.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: Shader.a_Color, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: Shader.a_UV, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
        this.gfxProgram = cache.createProgram(new Shader());

        this.modelRenderers = Array(pmos.length);
        for (let i = 0; i < pmos.length; i++) {
            this.modelRenderers[i] = new ModelRenderer(cache, pmos[i], this.gfxInputLayout);
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(Shader.ub_SceneParams, 16);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.clipFromWorldMatrix);

        for (const mr of this.modelRenderers) {
            mr.prepareToRender(device, renderHelper, viewerInput);
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const mr of this.modelRenderers) {
            mr.destroy(device);
        }
    }
}

class ModelRenderer implements Destroyable {
    private shapeRenderers: ShapeRenderer[];
    private shiftMatrix: mat4;

    constructor(cache: GfxRenderCache, pmo: DreamDropPMO, private gfxInputLayout: GfxInputLayout) {
        const shapes = [...pmo.mainShapes, ...pmo.secondShapes];
        this.shapeRenderers = Array(shapes.length);
        for (let i = 0; i < shapes.length; i++) {
            this.shapeRenderers[i] = new ShapeRenderer(cache, shapes[i], this.gfxInputLayout);
        }
        this.shiftMatrix = this.computeShiftMatrix(pmo);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        let offset = template.allocateUniformBuffer(Shader.ub_ModelParams, 16);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_ModelParams);
        // u_Shift (16)
        offset += fillMatrix4x4(uniformBuffer, offset, this.shiftMatrix);

        for (const sr of this.shapeRenderers) {
            sr.prepareToRender(device, renderHelper, viewerInput);
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const sr of this.shapeRenderers) {
            sr.destroy(device);
        }
    }

    private computeShiftMatrix(pmo: DreamDropPMO) {
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            1, 1, 1, // pmo.scale[0], pmo.scale[1], pmo.scale[2],
            pmo.rotation[0], pmo.rotation[1], pmo.rotation[2],
            0, 0, 0 //pmo.position[0] * WORLD_SCALE, pmo.position[1] * WORLD_SCALE, pmo.position[2] * WORLD_SCALE
        );
        return srt;
    }
}

class ShapeRenderer implements Destroyable {
    private drawCount: number;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, shape: DreamDropPMOShape, private gfxInputLayout: GfxInputLayout) {
        const indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, new Uint32Array(shape.indices).buffer);

        const vertices = new Float32Array(shape.vertices.length * 3);
        const colors = new Float32Array(shape.vertices.length * 4);
        const uvs = new Float32Array(shape.vertices.length * 2);
        for (let i = 0; i < shape.vertices.length; i++) {
            const v = shape.vertices[i];
            for (let j = 0; j < 3; j++) {
                vertices[(i * 3) + j] = v.position[j] * WORLD_SCALE;
            }
            for (let j = 0; j < 4; j++) {
                colors[(i * 4) + j] = v.color[j];
            }
            for (let j = 0; j < 2; j++) {
                uvs[(i * 2) + j] = v.uv[j];
            }
        }
        this.drawCount = shape.indices.length;

        const vertexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        const colorBuffer = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer);
        const uvBuffer = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer);

        this.indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };
        this.vertexBufferDescriptors = [
            { buffer: vertexBuffer, byteOffset: 0 },
            { buffer: colorBuffer, byteOffset: 0 },
            { buffer: uvBuffer, byteOffset: 0 }
        ];
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setDrawCount(this.drawCount);
        renderInst.setVertexInput(this.gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        renderHelper.renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
    }
}
