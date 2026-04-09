import { mat4 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropPMO, DreamDropPMOShape } from "./bin";
import { computeModelMatrixSRT } from "../MathHelpers";
import { DreamDropTexture } from "./texture";

class Shader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_CallParams = 2;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_Shift;
};

layout(std140) uniform ub_CallParams {
    float u_HasTexture;
};

uniform sampler2D u_Texture;

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
    if (u_HasTexture > 0.1) {
        vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);
        if (color.a < 0.1) {
            discard;
        }
        color *= v_Color;
        gl_FragColor = color;
    } else {
        gl_FragColor = v_Color;
    }
}
#endif
    `;

    constructor() {
        super();
    }
}

const WORLD_SCALE = 200.0;
const INVALID_TEXTURE_INDEX = 0xFF;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

export class DreamDropRoomRenderer implements Destroyable {
    private modelRenderers: RoomModelRenderer[];
    private gfxSampler: GfxSampler;
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache, pmos: DreamDropPMO[], textures: DreamDropTexture[]) {
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });
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
            const t: DreamDropTexture[] = [];
            for (const m of pmos[i].materials) {
                t.push(textures.find(ddt => ddt.name === m.textureName)!);
            }
            this.modelRenderers[i] = new RoomModelRenderer(cache, pmos[i], t);
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
            mr.prepareToRender(device, renderHelper, this.gfxInputLayout, this.gfxSampler);
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const mr of this.modelRenderers) {
            mr.destroy(device);
        }
    }
}

interface DrawCall {
    textureIndex: number;
    indexCount: number;
    indexOffset: number;
}

interface RoomData {
    indices: Uint32Array;
    vertices: Float32Array;
    colors: Float32Array;
    uvs: Float32Array;
    drawCalls: DrawCall[];
}

class RoomModelRenderer implements Destroyable {
    private drawCalls: DrawCall[];
    private shiftMatrix: mat4;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, pmo: DreamDropPMO, private textures: DreamDropTexture[]) {
        const shapes = [...pmo.mainShapes, ...pmo.secondShapes];
        const roomData = this.buildRoomData(shapes);
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, roomData.indices.buffer), byteOffset: 0 };
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, roomData.vertices.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, roomData.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, roomData.uvs.buffer), byteOffset: 0 }
        ];
        this.drawCalls = roomData.drawCalls;
        this.shiftMatrix = this.computeShiftMatrix(pmo);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, gfxInputLayout: GfxInputLayout, gfxSampler: GfxSampler) {
        const template = renderHelper.renderInstManager.pushTemplate();

        let offset = template.allocateUniformBuffer(Shader.ub_ModelParams, 16);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_ModelParams);
        // u_Shift (16)
        offset += fillMatrix4x4(uniformBuffer, offset, this.shiftMatrix);

        template.setVertexInput(gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        for (const drawCall of this.drawCalls) {
            const renderInst = renderHelper.renderInstManager.newRenderInst();

            let o = renderInst.allocateUniformBuffer(Shader.ub_CallParams, 1);
            const d = renderInst.mapUniformBufferF32(Shader.ub_CallParams);
            if (drawCall.textureIndex !== INVALID_TEXTURE_INDEX) {
                d[o++] = 1.0;
                renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.textures[drawCall.textureIndex].gfxTexture, gfxSampler }]);
            } else {
                d[o++] = 0.0;
            }

            renderInst.setDrawCount(drawCall.indexCount, drawCall.indexOffset);
            renderHelper.renderInstManager.submitRenderInst(renderInst);
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
    }

    private buildRoomData(shapes: DreamDropPMOShape[]): RoomData {
        let vertexOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<number, number[]>();
        for (const shape of shapes) {
            const offsetBase = vertexOffset;
            vertices.push(...shape.vertices);
            colors.push(...shape.colors);
            uvs.push(...shape.uvs);
            vertexOffset += shape.vertices.length / 3;
            if (!indexGroups.has(shape.textureIndex)) {
                indexGroups.set(shape.textureIndex, []);
            }
            const groupIndices = indexGroups.get(shape.textureIndex)!;
            groupIndices.push(...shape.indices.map(i => i + offsetBase));
        }

        const drawCalls: DrawCall[] = [];
        const indices: number[] = [];
        indexGroups.forEach((groupIndices, textureIndex) => {
            const drawCall = {
                textureIndex: this.textures[textureIndex] ? textureIndex : INVALID_TEXTURE_INDEX,
                indexOffset: indices.length,
                indexCount: groupIndices.length
            };
            indices.push(...groupIndices);
            drawCalls.push(drawCall);
        });

        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs), drawCalls };
    }

    private computeShiftMatrix(pmo: DreamDropPMO) {
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            pmo.scale[0] * WORLD_SCALE, pmo.scale[1] * WORLD_SCALE, pmo.scale[2] * WORLD_SCALE,
            pmo.rotation[0], pmo.rotation[1], pmo.rotation[2],
            pmo.position[0] * WORLD_SCALE, pmo.position[1] * WORLD_SCALE, pmo.position[2] * WORLD_SCALE
        );
        return srt;
    }
}
