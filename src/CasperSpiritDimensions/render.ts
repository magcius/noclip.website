import { mat4, quat } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { RWMesh, RWTexture, TOMObjectInstance, CapserLevel, RWBSPNode, BoundingSphere } from "./bin";
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
}

class Shader extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_InstanceParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    float u_ShowTextures;
};

layout(std140) uniform ub_InstanceParams {
    Mat4x4 u_ShiftMatrix;
};

uniform sampler2D u_Texture;

varying vec3 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_UV = a_UV;
    vec4 worldPos = UnpackMatrix(u_ShiftMatrix) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ProjectionView) * worldPos;
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
const NOSHIFT_MATRIX = mat4.create();

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

    constructor(cache: GfxRenderCache, private level: CapserLevel, private textures: Map<string, RWTexture>, meshes: Map<string, RWMesh>, private objInstances: TOMObjectInstance[]) {
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

        const boundingSpheres: Map<string, BoundingSphere> = new Map();
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
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 } // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos (x, y, z)
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // color (x: r, y: g, z: b)
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex } // uv (x: u, y: v)
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
        // u_ProjectionView (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.clipFromWorldMatrix);
        // u_ShowTextures (1)
        uniformBuffer[offset++] = this.showTextures ? 1.0 : 0.0;

        for (const [name, batch] of this.batches.entries()) {
            if (name === this.level.name || (name !== this.level.name && this.showObjects)) {
                if (!this.meshLayers.find(m => m.name === name)!.visible) {
                    continue;
                }
                const buffers = this.buffers.get(name)!;
                const renderInst = renderHelper.renderInstManager.pushTemplate();
                renderInst.setVertexInput(this.gfxInputLayout, [
                    { buffer: buffers.vertex, byteOffset: 0 },
                    { buffer: buffers.color, byteOffset: 0 },
                    { buffer: buffers.uv, byteOffset: 0 }
                ], { buffer: buffers.index, byteOffset: 0 });

                if (name === this.level.name) {
                    let instanceOffset = renderInst.allocateUniformBuffer(Shader.ub_InstanceParams, 16);
                    const instanceUniformBuffer = renderInst.mapUniformBufferF32(Shader.ub_InstanceParams);
                    // u_ShiftMatrix (16)
                    instanceOffset += fillMatrix4x4(instanceUniformBuffer, instanceOffset, NOSHIFT_MATRIX);

                    this.renderBatch(viewerInput, batch, renderHelper.renderInstManager);
                } else {
                    for (const instance of this.objInstances.filter(i => i.name === name)) {
                        if (viewerInput.camera.frustum.contains(instance.bbox)) {
                            let instanceOffset = renderInst.allocateUniformBuffer(Shader.ub_InstanceParams, 16);
                            const instanceUniformBuffer = renderInst.mapUniformBufferF32(Shader.ub_InstanceParams);
                            // u_ShiftMatrix (16)
                            instanceOffset += fillMatrix4x4(instanceUniformBuffer, instanceOffset, instance.shiftMatrix);

                            this.renderBatch(viewerInput, batch, renderHelper.renderInstManager, false, instance.bbox);
                        }
                    }
                }

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
        }
    }

    private buildBuffersLevel(): MeshBufferData {
        let vertexOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        const traverse = (node: RWBSPNode) => {
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

    private buildBuffersObj(name: string, mesh: RWMesh): MeshBufferData {
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

    private renderBatch(viewerInput: ViewerRenderInput, drawCalls: DrawCall[], renderInstManager: GfxRenderInstManager, respectCullMode: boolean = true, bbox?: AABB) {
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
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
            }
            if (bbox) {
                renderInst.sortKey = setSortKeyDepth(this.sortKeys.get(texture.gfxTexture.ResourceName!)!, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bbox));
            } else {
                renderInst.sortKey = this.sortKeys.get(texture.gfxTexture.ResourceName!)!;
            }
            renderInst.setMegaStateFlags(megaState);
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: texture.gfxTexture, gfxSampler: this.gfxSampler }]);
            renderInst.setDrawCount(drawCall.indexCount, drawCall.indexOffset);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    private computeShiftMatrix(obj: TOMObjectInstance): mat4 {
        const srt = mat4.create();
        computeModelMatrixSRT(srt,
            obj.scale.x, obj.scale.y, obj.scale.z,
            0, obj.rotation.z * MathConstants.DEG_TO_RAD, 0,
            obj.position.x * WORLD_SCALE, obj.position.z * WORLD_SCALE, -obj.position.y * WORLD_SCALE
        );
        return srt;
    }
}
