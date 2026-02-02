import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxTexFilterMode, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { Texture, WorldData, WorldSector } from "./bin";

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
};

uniform sampler2D u_Texture;

varying vec3 v_Position;
varying vec3 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_UV;
    vec4 worldPos = vec4(a_Position, 1.0);
    v_Position = worldPos.xyz;
    gl_Position = UnpackMatrix(u_ProjectionView) * worldPos;
}
#endif

#ifdef FRAG
void main() {
    // vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    // vec4 finalColor = texColor * vec4(v_Color, 1.0);
    // if (finalColor.a < 0.1) {
    //     discard;
    // }
    // // gl_FragColor = vec4(v_Color, 1.0);
    // gl_FragColor = finalColor;

    vec4 texColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec3 ambient = vec3(0.075); // close approx to PS2 appearance
    vec3 lightColor = v_Color + ambient;
    vec4 finalColor = texColor * vec4(clamp(lightColor, 0.0, 1.0), 1.0);

    if (finalColor.a < 0.1) discard;

    gl_FragColor = finalColor;
}
#endif
    `;

    constructor() {
        super();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];
const WORLD_SCALE = 300;

export class LevelRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private batches: MeshBatch[] = [];

    constructor(cache: GfxRenderCache, world: WorldData, private textures: Map<string, Texture>) {
        const device = cache.device;
        const { vertices, indices, uvs, colors } = this.buildBuffers(world);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.colorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer);
        this.uvBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, uvs.buffer);
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

        let offs = template.allocateUniformBuffer(LevelProgram.ub_SceneParams, 16);
        const buf = template.mapUniformBufferF32(LevelProgram.ub_SceneParams);
        offs += fillMatrix4x4(buf, offs, viewerInput.camera.clipFromWorldMatrix);
        template.setVertexInput(
            this.inputLayout,
            [
                { buffer: this.vertexBuffer, byteOffset: 0 },
                { buffer: this.colorBuffer, byteOffset: 0 },
                { buffer: this.uvBuffer, byteOffset: 0 }
            ],
            { buffer: this.indexBuffer, byteOffset: 0 }
        );

        // opaque pass
        for (const batch of this.batches) {
            const texture = this.textures.get(batch.textureName);
            if (!texture || texture.hasAlpha) {
                continue;
            }
            const renderInst = renderInstManager.newRenderInst();
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

        // semi-transparent pass
        for (const batch of this.batches) {
            const texture = this.textures.get(batch.textureName);
            if (!texture || !texture.hasAlpha) {
                continue;
            }
            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.getMegaStateFlags();
            megaState.depthCompare = GfxCompareMode.GreaterEqual;
            setAttachmentStateSimple(megaState, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
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
    }

    private buildBuffers(world: WorldData): LevelBuffer {
        let vOffset = 0;
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const indexGroups = new Map<string, number[]>();
        this.batches = [];
        const traverse = (node: WorldSector) => {
            if (node.mesh && node.mesh.vertexCount > 0 && node.mesh.positions.length > 0) {
                const vBase = vOffset;
                vertices.push(...node.mesh.positions.map(p => p * WORLD_SCALE));
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
}
