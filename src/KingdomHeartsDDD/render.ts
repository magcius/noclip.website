import { mat4 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropPMO, DreamDropPMOShape } from "./bin";
import { computeModelMatrixSRT } from "../MathHelpers";
import { DreamDropTexture } from "./texture";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";

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
}
#endif

#ifdef FRAG
void main() {
    if (u_HasTexture > 0.1) {
        vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);
        if (color.a < 0.1) {
            discard;
        }
        vec3 ambient = vec3(0.075);
        color *= vec4(clamp(v_Color.xyz + ambient, 0.0, 1.0), 1.0);
        gl_FragColor = color;
    } else {
        gl_FragColor = v_Color;
    }
}
#endif
    `;
}

const WORLD_SCALE = 200.0;
const INVALID_TEXTURE_INDEX = 0xFF;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const SCRATCH_SKY_MAT = mat4.create();
const SCRATCH_CLIP = mat4.create();

/**
 * Renderer for a room from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropRoomRenderer implements Destroyable {
    private parts: RoomPartRenderer[];
    private skyboxParts: RoomSkyboxRenderer[];
    private gfxSampler: GfxSampler;
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache, pmos: DreamDropPMO[], textures: DreamDropTexture[], skyboxIds: number[]) {
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

        this.parts = [];
        this.skyboxParts = [];
        for (let i = 0; i < pmos.length; i++) {
            const materialTextures: GfxTexture[] = [];
            for (const m of pmos[i].materials) {
                materialTextures.push(textures.find(ddt => ddt.name === m.textureName)!.gfxTexture);
            }
            if (skyboxIds.includes(pmos[i].id)) {
                this.skyboxParts.push(new RoomSkyboxRenderer(cache, pmos[i], materialTextures));
            } else {
                this.parts.push(new RoomPartRenderer(cache, pmos[i], materialTextures));
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        if (this.skyboxParts.length > 0) {
            const skyTemplate = renderHelper.renderInstManager.pushTemplate();

            let skyOffset = skyTemplate.allocateUniformBuffer(Shader.ub_SceneParams, 16);
            const skyUniformBuffer = skyTemplate.mapUniformBufferF32(Shader.ub_SceneParams);
            mat4.copy(SCRATCH_SKY_MAT, viewerInput.camera.viewMatrix);
            SCRATCH_SKY_MAT[12] = 0;
            SCRATCH_SKY_MAT[13] = 0;
            SCRATCH_SKY_MAT[14] = 0;
            mat4.mul(SCRATCH_CLIP, viewerInput.camera.projectionMatrix, SCRATCH_SKY_MAT);
            // u_Projection (16)
            skyOffset += fillMatrix4x4(skyUniformBuffer, skyOffset, SCRATCH_CLIP);

            for (const part of this.skyboxParts) {
                part.prepareToRender(device, renderHelper, this.gfxInputLayout, this.gfxSampler);
            }

            renderHelper.renderInstManager.popTemplate();
        }

        let offset = template.allocateUniformBuffer(Shader.ub_SceneParams, 16);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.clipFromWorldMatrix);

        for (const part of this.parts) {
            part.prepareToRender(device, renderHelper, this.gfxInputLayout, this.gfxSampler);
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const part of [...this.skyboxParts, ...this.parts]) {
            part.destroy(device);
        }
    }
}

interface DrawCall {
    textureIndex: number;
    indexCount: number;
    indexOffset: number;
    isTranslucent: boolean;
    sortKey: number;
    megaStateFlags: Partial<GfxMegaStateDescriptor>;
}

interface RoomPartData {
    indices: Uint32Array;
    vertices: Float32Array;
    colors: Float32Array;
    uvs: Float32Array;
    drawCalls: DrawCall[];
}

class RoomPartRenderer implements Destroyable {
    protected drawCalls: DrawCall[];
    protected shiftMatrix: mat4;
    protected indexBufferDescriptor: GfxIndexBufferDescriptor;
    protected vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, model: DreamDropPMO, protected textures: GfxTexture[]) {
        const data = this.buildData(model.opaqueShapes, model.translucentShapes);
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, data.indices.buffer), byteOffset: 0 };
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, data.vertices.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, data.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, data.uvs.buffer), byteOffset: 0 }
        ];
        this.drawCalls = data.drawCalls;
        this.shiftMatrix = this.computeShiftMatrix(model);
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
                renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.textures[drawCall.textureIndex], gfxSampler }]);
            } else {
                d[o++] = 0.0;
            }
            renderInst.setMegaStateFlags(drawCall.megaStateFlags);
            renderInst.sortKey = drawCall.sortKey;
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

    private buildData(opaqueShapes: DreamDropPMOShape[], translucentShapes: DreamDropPMOShape[]): RoomPartData {
        let vertexOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<number, number[]>();
        for (const shape of [...opaqueShapes, ...translucentShapes]) {
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
        const translucentTextureIndices = translucentShapes.map(s => s.textureIndex);
        indexGroups.forEach((groupIndices, textureIndex) => {
            const isTranslucent = translucentTextureIndices.includes(textureIndex);
            const megaStateFlags = {};
            if (isTranslucent) {
                setAttachmentStateSimple(megaStateFlags, {
                    blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
            }
            const drawCall = {
                textureIndex: this.textures[textureIndex] ? textureIndex : INVALID_TEXTURE_INDEX,
                indexOffset: indices.length,
                indexCount: groupIndices.length,
                isTranslucent,
                sortKey: makeSortKey(isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0),
                megaStateFlags
            };
            indices.push(...groupIndices);
            drawCalls.push(drawCall);
        });

        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs), drawCalls };
    }

    protected computeShiftMatrix(model: DreamDropPMO) {
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            model.scale[0] * WORLD_SCALE, model.scale[1] * WORLD_SCALE, model.scale[2] * WORLD_SCALE,
            model.rotation[0], model.rotation[1], model.rotation[2],
            model.position[0] * WORLD_SCALE, model.position[1] * WORLD_SCALE, model.position[2] * WORLD_SCALE
        );
        return srt;
    }
}

class RoomSkyboxRenderer extends RoomPartRenderer {
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(cache: GfxRenderCache, model: DreamDropPMO, textures: GfxTexture[]) {
        super(cache, model, textures);
        this.megaStateFlags = {
            depthCompare: GfxCompareMode.Always,
            depthWrite: false
        };
    }

    public override prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, gfxInputLayout: GfxInputLayout, gfxSampler: GfxSampler) {
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
            d[o++] = 1.0;

            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.textures[drawCall.textureIndex], gfxSampler }]);
            renderInst.setMegaStateFlags(this.megaStateFlags);
            renderInst.setDrawCount(drawCall.indexCount, drawCall.indexOffset);

            renderHelper.renderInstManager.submitRenderInst(renderInst);
        }

        renderHelper.renderInstManager.popTemplate();
    }
}
