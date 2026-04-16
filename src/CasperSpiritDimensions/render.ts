import { mat4, quat, vec4 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { CasperMesh, CasperTexture, CasperObjectInstance, CapserLevel, CasperBSPNode, CasperBoundingSphere } from "./bin";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { computeModelMatrixSRT, MathConstants } from "../MathHelpers";
import { AABB } from "../Geometry";
import { Layer } from "../ui";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";

interface DrawCall {
    textureName: string;
    indexOffset: number;
    indexCount: number;
}

interface MeshBufferData {
    vertices: Float32Array;
    indices: Uint32Array;
    colors: Float32Array;
    uvs: Float32Array;
}

interface MeshBuffers {
    vertex: GfxBuffer;
    index: GfxBuffer;
    color: GfxBuffer;
    uv: GfxBuffer;
    shift0?: GfxBuffer;
    shift1?: GfxBuffer;
    shift2?: GfxBuffer;
    shift3?: GfxBuffer;
}

class Shader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static a_Shift0 = 3;
    public static a_Shift1 = 4;
    public static a_Shift2 = 5;
    public static a_Shift3 = 6;
    public static ub_SceneParams = 0;
    public static ub_InstanceParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    float u_ShowTextures;
};

uniform sampler2D u_Texture;

varying vec3 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = ${Shader.a_Position}) in vec3 a_Position;
layout(location = ${Shader.a_Color}) in vec3 a_Color;
layout(location = ${Shader.a_UV}) in vec2 a_UV;
layout(location = ${Shader.a_Shift0}) in vec4 a_Shift0;
layout(location = ${Shader.a_Shift1}) in vec4 a_Shift1;
layout(location = ${Shader.a_Shift2}) in vec4 a_Shift2;
layout(location = ${Shader.a_Shift3}) in vec4 a_Shift3;

void main() {
    v_Color = a_Color;
    v_UV = a_UV;
    vec4 worldPos = mat4(a_Shift0, a_Shift1, a_Shift2, a_Shift3) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * worldPos;
}
#endif

#ifdef FRAG
void main() {
    if (u_ShowTextures > 0.1) {
        vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);
        if (color.a < 0.1) {
            discard;
        }
        vec3 ambient = vec3(0.075); // close approx to PS2 appearance
        color *= vec4(clamp(v_Color + ambient, 0.0, 1.0), 1.0);
        gl_FragColor = color;
    } else {
        gl_FragColor = vec4(v_Color, 1.0);
    }
}
#endif
    `;

    constructor() {
        super();
    }
}

const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];
const WORLD_SCALE = 300; // raw XYZ are extremely small
const BACK_CULL_LEVELS = [5, 8, 9, 11, 12, 14]; // levels that are mostly interior

export class CasperLevelRenderer {
    private buffers: Map<string, MeshBuffers> = new Map();
    private batches: Map<string, DrawCall[]> = new Map();
    private sortKeys: Map<string, number> = new Map();
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private gfxSampler: GfxSampler;
    public showTextures: boolean = true;
    public showObjects: boolean = true;
    public cullMode: GfxCullMode = GfxCullMode.None;
    public meshLayers: Layer[] = [];

    constructor(cache: GfxRenderCache, private level: CapserLevel, private textures: Map<string, CasperTexture>, meshes: Map<string, CasperMesh>, private objInstances: CasperObjectInstance[]) {
        if (BACK_CULL_LEVELS.includes(this.level.number)) {
            this.cullMode = GfxCullMode.Back;
        }

        const { vertices, indices, uvs, colors } = this.buildBuffersLevel();
        this.buffers.set(this.level.name, {
            vertex: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer),
            index: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer),
            color: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer),
            uv: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer)
        });
        this.meshLayers.push({ name: this.level.name, visible: true, setVisible(v: boolean) { this.visible = v } });

        const boundingSpheres: Map<string, CasperBoundingSphere> = new Map();
        for (const [name, mesh] of meshes.entries()) {
            const { vertices, indices, uvs, colors } = this.buildBuffersObj(name, mesh);
            this.buffers.set(name, {
                vertex: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer),
                index: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer),
                color: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer),
                uv: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer)
            });
            this.meshLayers.push({ name, visible: true, setVisible(v: boolean) { this.visible = v } });

            const bs = mesh.boundingSphere!;
            bs.x *= WORLD_SCALE;
            bs.y *= WORLD_SCALE;
            bs.z *= WORLD_SCALE;
            bs.r *= WORLD_SCALE;
            boundingSpheres.set(name, bs);
        }

        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: Shader.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: Shader.a_Color, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: Shader.a_UV, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
                { location: Shader.a_Shift0, bufferIndex: 3, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: Shader.a_Shift1, bufferIndex: 4, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: Shader.a_Shift2, bufferIndex: 5, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: Shader.a_Shift3, bufferIndex: 6, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 }
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerInstance },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerInstance },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerInstance },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerInstance }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });

        // pre-compute shift matrices and bounding boxes
        for (const instance of this.objInstances) {
            instance.shiftMatrix = this.computeShiftMatrix(instance);
            const bs = boundingSpheres.get(instance.name);
            if (!bs) {
                continue;
            }
            const bbox = new AABB(bs.x - bs.r, bs.y - bs.r, bs.z - bs.r, bs.x + bs.r, bs.y + bs.r, bs.z + bs.r);
            bbox.transform(bbox, instance.shiftMatrix);
            instance.bbox = bbox;
        }

        // patch buffers with instance shifts
        for (const name of this.buffers.keys()) {
            const buffers = this.buffers.get(name)!;
            const shift0: number[] = [];
            const shift1: number[] = [];
            const shift2: number[] = [];
            const shift3: number[] = [];
            if (name === this.level.name) {
                const identity = this.convertMat4ToVec4Columns(this.computeShiftMatrix(new CasperObjectInstance()));
                shift0.push(...identity[0]);
                shift1.push(...identity[1]);
                shift2.push(...identity[2]);
                shift3.push(...identity[3]);
            } else {
                for (const instance of this.objInstances.filter(i => i.name === name)) {
                    const shiftColumns = this.convertMat4ToVec4Columns(instance.shiftMatrix);
                    shift0.push(...shiftColumns[0]);
                    shift1.push(...shiftColumns[1]);
                    shift2.push(...shiftColumns[2]);
                    shift3.push(...shiftColumns[3]);
                }
            }
            buffers.shift0 = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(shift0).buffer);
            buffers.shift1 = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(shift1).buffer);
            buffers.shift2 = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(shift2).buffer);
            buffers.shift3 = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, new Float32Array(shift3).buffer);
            // this.buffers.set(name, buffers);
        }

        for (const t of this.textures.values()) {
            const sk = makeSortKey(t.hasAlpha ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0);
            this.sortKeys.set(t.gfxTexture.ResourceName!, sk);
        }

        this.gfxProgram = cache.createProgram(new Shader());
        this.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(Shader.ub_SceneParams, 17);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.clipFromWorldMatrix);
        // u_ShowTextures (1)
        uniformBuffer[offset++] = this.showTextures ? 1.0 : 0.0;

        for (const [name, batch] of this.batches.entries()) {
            const isLevel = name === this.level.name;
            if (isLevel || (!isLevel && this.showObjects)) {
                if (!this.meshLayers.find(m => m.name === name)!.visible) {
                    continue;
                }
                const buffers = this.buffers.get(name)!;
                const renderInst = renderHelper.renderInstManager.pushTemplate();
                renderInst.setVertexInput(this.gfxInputLayout, [
                    { buffer: buffers.vertex, byteOffset: 0 },
                    { buffer: buffers.color, byteOffset: 0 },
                    { buffer: buffers.uv, byteOffset: 0 },
                    { buffer: buffers.shift0!, byteOffset: 0 },
                    { buffer: buffers.shift1!, byteOffset: 0 },
                    { buffer: buffers.shift2!, byteOffset: 0 },
                    { buffer: buffers.shift3!, byteOffset: 0 }
                ], { buffer: buffers.index, byteOffset: 0 });

                this.renderBatch(batch, renderHelper.renderInstManager, isLevel ? 1 : this.objInstances.filter(i => i.name === name).length, isLevel);

                renderHelper.renderInstManager.popTemplate();
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const buffers of this.buffers.values()) {
            device.destroyBuffer(buffers.vertex);
            device.destroyBuffer(buffers.index);
            device.destroyBuffer(buffers.color);
            device.destroyBuffer(buffers.uv);
            device.destroyBuffer(buffers.shift0!);
            device.destroyBuffer(buffers.shift1!);
            device.destroyBuffer(buffers.shift2!);
            device.destroyBuffer(buffers.shift3!);
        }
        for (const texture of this.textures.values()) {
            device.destroyTexture(texture.gfxTexture);
        }
    }

    private buildBuffersLevel(): MeshBufferData {
        let vertexOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        const traverse = (node: CasperBSPNode) => {
            if (node.mesh && node.mesh.vertices.length > 0) {
                const offsetBase = vertexOffset;
                vertices.push(...node.mesh.vertices.map(p => p * WORLD_SCALE));
                colors.push(...node.mesh.colors.map(c => c / 255));
                uvs.push(...node.mesh.uvs);
                vertexOffset += node.mesh.vertices.length / 3;
                for (const split of node.mesh.indexSplits) {
                    const textureName = this.level.materials[split.materialIndex];
                    if (textureName === undefined || textureName.length === 0) {
                        continue;
                    }
                    if (!indexGroups.has(textureName)) {
                        indexGroups.set(textureName, []);
                    }
                    const groupIndices = indexGroups.get(textureName)!;
                    for (const index of split.indices) {
                        groupIndices.push(index + offsetBase);
                    }
                }
            }
            if (node.leaves) {
                node.leaves.forEach(traverse);
            }
        };

        traverse(this.level.root);

        const indices: number[] = [];
        indexGroups.forEach((groupIndices, textureName) => {
            const batch = { textureName, indexOffset: indices.length, indexCount: groupIndices.length };
            indices.push(...groupIndices);
            const batches = this.batches.get(this.level.name);
            if (!batches) {
                this.batches.set(this.level.name, [batch]);
            } else {
                batches.push(batch);
            }
        });

        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs) };
    }

    private buildBuffersObj(name: string, mesh: CasperMesh): MeshBufferData {
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        if (mesh.vertices.length > 0 && mesh.materials) {
            vertices.push(...mesh.vertices.map(p => p * WORLD_SCALE));
            colors.push(...mesh.colors.map(c => c / 255));
            uvs.push(...mesh.uvs);
            for (const split of mesh.indexSplits) {
                const textureName = mesh.materials[split.materialIndex];
                if (textureName === undefined || textureName.length === 0) {
                    continue;
                }
                if (!indexGroups.has(textureName)) {
                    indexGroups.set(textureName, []);
                }
                const groupIndices = indexGroups.get(textureName)!;
                for (const i of split.indices) {
                    groupIndices.push(i);
                }
            }
        }

        const indices: number[] = [];
        indexGroups.forEach((groupIndices, textureName) => {
            const batch = { textureName, indexOffset: indices.length, indexCount: groupIndices.length };
            indices.push(...groupIndices);
            const batches = this.batches.get(name);
            if (!batches) {
                this.batches.set(name, [batch]);
            } else {
                batches.push(batch);
            }
        });

        return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), colors: new Float32Array(colors), uvs: new Float32Array(uvs) };
    }

    private renderBatch(drawCalls: DrawCall[], renderInstManager: GfxRenderInstManager, instanceCount: number, respectCullMode: boolean = true) {
        for (const drawCall of drawCalls) {
            const texture = this.textures.get(drawCall.textureName);
            if (!texture) {
                // console.warn(batch.textureName);
                continue;
            }
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            megaState.cullMode = respectCullMode ? this.cullMode : GfxCullMode.None;
            if (texture.hasAlpha) {
                setAttachmentStateSimple(megaState, {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha
                });
            }
            renderInst.sortKey = this.sortKeys.get(texture.gfxTexture.ResourceName!)!;
            renderInst.setMegaStateFlags(megaState);
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: texture.gfxTexture, gfxSampler: this.gfxSampler }]);
            renderInst.setDrawCount(drawCall.indexCount, drawCall.indexOffset);
            renderInst.setInstanceCount(instanceCount);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    private computeShiftMatrix(obj: CasperObjectInstance): mat4 {
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            obj.scale.x, obj.scale.y, obj.scale.z,
            0, obj.rotation.z * MathConstants.DEG_TO_RAD, 0,
            obj.position.x * WORLD_SCALE, obj.position.z * WORLD_SCALE, -obj.position.y * WORLD_SCALE
        );
        return srt;
    }

    private convertMat4ToVec4Columns(m: Readonly<mat4>): vec4[] {
        const col0 = vec4.fromValues(m[0], m[1], m[2], m[3]);
        const col1 = vec4.fromValues(m[4], m[5], m[6], m[7]);
        const col2 = vec4.fromValues(m[8], m[9], m[10], m[11]);
        const col3 = vec4.fromValues(m[12], m[13], m[14], m[15]);
        return [col0, col1, col2, col3];
    }
}
