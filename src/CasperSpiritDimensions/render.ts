import { mat4, quat } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxTexFilterMode, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { DFFMesh, Texture, TOMInstance, WorldData, WorldSector } from "./bin";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";

interface MeshBatch {
    textureName: string;
    indexOffset: number;
    indexCount: number;
}

interface LevelBuffer {
    vertices: Float32Array;
    indices: Uint32Array;
    colors: Float32Array;
    uvs: Float32Array;
}

class LevelProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    Mat4x4 u_ShiftMatrix;
    vec4 u_Options; // x = show textures (0, 1)
};

uniform sampler2D u_Texture;

varying vec3 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;
    vec4 worldPos = UnpackMatrix(u_ShiftMatrix) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ProjectionView) * worldPos;
}
#endif

#ifdef FRAG
void main() {
    if (u_Options.x > 0.1) {
        vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
        vec3 ambient = vec3(0.075); // close approx to PS2 appearance
        vec3 lightColor = v_Color + ambient;
        vec4 finalColor = texColor * vec4(clamp(lightColor, 0.0, 1.0), 1.0);
        if (finalColor.a < 0.1) {
            discard;
        }
        gl_FragColor = finalColor;
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

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];
const WORLD_SCALE = 300; // xyz are extremely small in the data
const BACK_CULL_LEVELS = [5, 8, 9, 11, 12, 14]; // levels that are mostly interior

export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private dffBuffers: Map<string, GfxBuffer[]> = new Map();
    private dffBatches: Map<string, MeshBatch[]> = new Map();
    private inputLayout: GfxInputLayout;
    private batches: MeshBatch[] = [];
    public showTextures: boolean = true;
    public cullMode: GfxCullMode = GfxCullMode.None;

    constructor(cache: GfxRenderCache, number: number, world: WorldData, private textures: Map<string, Texture>, private tomInstances: TOMInstance[], private dffs: Map<string, DFFMesh>) {
        if (BACK_CULL_LEVELS.includes(number)) {
            this.cullMode = GfxCullMode.Back;
        }
        const device = cache.device;
        const { vertices, indices, uvs, colors } = this.buildBuffers(world);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer);
        for (const [name, dff] of this.dffs.entries()) {
            const { vertices: v, indices: i, uvs: u, colors: c } = this.buildBuffersDFF(name, dff);
            const vb = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, v.buffer);
            const ib = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, i.buffer);
            const cb = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, c.buffer);
            const ub = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, u.buffer);
            this.dffBuffers.set(name, [vb, ib, cb, ub]);
        }
        console.log("Built buffers for", this.dffs.size, "DFFs");
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // a_Color
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 } // a_UV
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // pos (x, y, z)
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex }, // color (x: r, y: g, z: b)
                { byteStride: 8,  frequency: GfxVertexBufferFrequency.PerVertex } // uv (x: u, y: v)
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const renderInstManager = renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();
        const program = renderHelper.renderCache.createProgram(new LevelProgram());
        template.setGfxProgram(program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);
        template.setVertexInput(this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 }
        );

        let offset = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 36);
        const buffer = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        // u_ProjectionView (16)
        offset += fillMatrix4x4(buffer, offset, viewerInput.camera.clipFromWorldMatrix);
        // u_ShiftMatrix (16)
        offset += fillMatrix4x4(buffer, offset, mat4.create());
        // u_Options (4)
        buffer[offset++] = this.showTextures ? 1.0 : 0.0;
        buffer[offset++] = 0.0;
        buffer[offset++] = 0.0;
        buffer[offset++] = 0.0;

        // static level geometry
        this.submitBatches(renderInstManager, this.batches, renderHelper);

        // render objects
        for (const tom of this.tomInstances) {
            const mesh = this.dffs.get(tom.name);
            const buffers = this.dffBuffers.get(tom.name);
            if (!mesh || !buffers) {
                continue;
            }
            const shiftMatrix = this.buildShiftMatrix(tom);
            const instanceTemplate = renderInstManager.pushTemplate();
            let instanceOffset = instanceTemplate.allocateUniformBuffer(LevelProgram.ub_SceneParams, 36);
            const instanceBuffer = instanceTemplate.mapUniformBufferF32(LevelProgram.ub_SceneParams);
            // u_ProjectionView (16)
            instanceOffset += fillMatrix4x4(instanceBuffer, instanceOffset, viewerInput.camera.clipFromWorldMatrix);
            // u_ShiftMatrix (16)
            instanceOffset += fillMatrix4x4(instanceBuffer, instanceOffset, shiftMatrix);
            // u_Options (4)
            instanceBuffer[instanceOffset++] = this.showTextures ? 1.0 : 0.0;
            instanceBuffer[instanceOffset++] = 0.0;
            instanceBuffer[instanceOffset++] = 0.0;
            instanceBuffer[instanceOffset++] = 0.0;
            instanceTemplate.setVertexInput(this.inputLayout, [
                { buffer: buffers[0], byteOffset: 0 },
                { buffer: buffers[2], byteOffset: 0 },
                { buffer: buffers[3], byteOffset: 0 }
            ], { buffer: buffers[1], byteOffset: 0 });
            this.submitBatches(renderInstManager, this.dffBatches.get(tom.name)!, renderHelper, false);
            renderInstManager.popTemplate();
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        for (const t of this.textures.values()) {
            device.destroyTexture(t.gfxTexture);
        }
        for (const buffers of this.dffBuffers.values()) {
            buffers.forEach(b => device.destroyBuffer(b));
        }
    }

    private buildBuffers(world: WorldData): LevelBuffer {
        let vOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        this.batches = [];
        const traverse = (node: WorldSector) => {
            if (node.mesh && node.mesh.vertexCount > 0 && node.mesh.vertices.length > 0) {
                const vBase = vOffset;
                vertices.push(...node.mesh.vertices.map(p => p * WORLD_SCALE));
                colors.push(...node.mesh.colors.map(c => c / 255));
                uvs.push(...node.mesh.uvs);
                vOffset += node.mesh.vertexCount;
                for (const split of node.mesh.splits) {
                    const textureName = world.materials[split.materialIndex];
                    if (textureName === undefined || textureName.length === 0) {
                        continue;
                    }
                    if (!indexGroups.has(textureName)) {
                        indexGroups.set(textureName, []);
                    }
                    const groupIndices = indexGroups.get(textureName)!;
                    for (const i of split.indices) {
                        groupIndices.push(i + vBase);
                    }
                }
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        };
        traverse(world.rootSector);
        const finalIndices: number[] = [];
        indexGroups.forEach((groupIndices, textureName) => {
            const indexStart = finalIndices.length;
            finalIndices.push(...groupIndices);
            this.batches.push({
                textureName: textureName,
                indexOffset: indexStart,
                indexCount: groupIndices.length
            });
        });
        return { 
            vertices: new Float32Array(vertices), 
            indices: new Uint32Array(finalIndices), 
            colors: new Float32Array(colors), 
            uvs: new Float32Array(uvs) 
        };
    }

    private buildBuffersDFF(name: string, mesh: DFFMesh): LevelBuffer {
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        if (mesh.vertexCount > 0 && mesh.vertices.length > 0) {
            vertices.push(...mesh.vertices.map(p => p * WORLD_SCALE));
            colors.push(...mesh.colors.map(c => c / 255));
            uvs.push(...mesh.uvs);
            for (const split of mesh.splits) {
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
        const finalIndices: number[] = [];
        indexGroups.forEach((groupIndices, textureName) => {
            const indexStart = finalIndices.length;
            finalIndices.push(...groupIndices);
            let mbs = this.dffBatches.get(name);
            if (mbs === undefined) {
                this.dffBatches.set(name, [{
                    textureName: textureName,
                    indexOffset: indexStart,
                    indexCount: groupIndices.length
                }]);
            } else {
                mbs.push({
                    textureName: textureName,
                    indexOffset: indexStart,
                    indexCount: groupIndices.length
                });
                this.dffBatches.set(name, mbs);
            }
        });
        return { 
            vertices: new Float32Array(vertices), 
            indices: new Uint32Array(finalIndices), 
            colors: new Float32Array(colors), 
            uvs: new Float32Array(uvs) 
        };
    }

    private submitBatches(renderInstManager: GfxRenderInstManager, batches: MeshBatch[], renderHelper: GfxRenderHelper, respectCullMode: boolean = true) {
        for (const batch of batches) {
            const texture = this.textures.get(batch.textureName);
            if (!texture) {
                continue;
            }
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            if (respectCullMode) {
                megaState.cullMode = this.cullMode;
            }
            if (texture.hasAlpha) {
                megaState.depthCompare = GfxCompareMode.GreaterEqual;
                setAttachmentStateSimple(megaState, {
                    channelWriteMask: GfxChannelWriteMask.RGB,
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
            }
            renderInst.setMegaStateFlags(megaState);
            renderInst.setSamplerBindingsFromTextureMappings([{
                gfxTexture: texture.gfxTexture,
                gfxSampler: renderHelper.renderCache.createSampler({
                    minFilter: GfxTexFilterMode.Bilinear,
                    magFilter: GfxTexFilterMode.Bilinear,
                    mipFilter: GfxMipFilterMode.Nearest,
                    wrapS: GfxWrapMode.Repeat,
                    wrapT: GfxWrapMode.Repeat
                }),
                lateBinding: null
            }]);
            renderInst.setDrawCount(batch.indexCount, batch.indexOffset);
            renderInstManager.submitRenderInst(renderInst);
        }
    }

    private buildShiftMatrix(tom: TOMInstance): mat4 {
        const out = mat4.create();
        const q = quat.create();
        const posX = tom.position.x * WORLD_SCALE;
        const posY = tom.position.z * WORLD_SCALE;
        const posZ = -tom.position.y * WORLD_SCALE;
        quat.rotateY(q, q, (tom.rotation.z * Math.PI / 180));
        quat.rotateZ(q, q, (tom.rotation.y * Math.PI / 180));
        quat.rotateX(q, q, (tom.rotation.x * Math.PI / 180));
        mat4.fromRotationTranslationScale(out, q, [posX, posY, posZ],
            [tom.scale.x, tom.scale.z, tom.scale.y]
        );
        return out;
    }
}
