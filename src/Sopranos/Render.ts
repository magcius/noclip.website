import { mat4 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera.js";
import { AABB } from "../Geometry.js";
import { DeviceProgram } from "../Program.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { AlphaMode, BlendMode, DecodedTexture } from "./Texture.js";

const MASK_CUTOFF = 0.5;
const CUTOUT_REF = 16 / 255;
const GLOW_STRENGTH = 0.14;

/**
 * Take a glow sprite's vertex alpha from its vertex brightness. A glow sprite is a single pure
 * white texture the hardware draws additively, so on the console its whole appearance comes from
 * its vertex colours, and alpha blending only approximates that.
 * @param colors The mesh's RGBA vertex colours, modified in place.
 */
export function applyGlowAlpha(colors: Uint8Array): void {
    for (let i = 0; i < colors.length; i += 4) {
        const luminance = (colors[i] * 2 + colors[i + 1] * 5 + colors[i + 2]) >> 3;
        colors[i + 3] = luminance * GLOW_STRENGTH;
    }
}

class SopranosProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;
    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_DrawParams {
    Mat3x4 u_WorldFromLocal;
    vec4 u_Misc;
};

#define u_AlphaCutoff (u_Misc.x)
#define u_TextureEnabled (u_Misc.y)

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = ${SopranosProgram.a_Position}) in vec3 a_Position;
layout(location = ${SopranosProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${SopranosProgram.a_Color}) in vec4 a_Color;

void main() {
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    vec3 t_WorldPosition = UnpackMatrix(u_WorldFromLocal) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_WorldPosition, 1.0);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = v_Color;
    if (u_TextureEnabled > 0.5) {
        t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    }
    if (u_AlphaCutoff > 0.0 && t_Color.a < u_AlphaCutoff) {
        discard;
    }
    gl_FragColor = t_Color;
}
#endif
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

interface ModelPart {
    texture: number;
    alphaMode: AlphaMode;
    blendMode: BlendMode;
    indexOffset: number;
    indexCount: number;
}

/** One drawable object: the level shell, or one prop or character. */
export interface Model {
    parts: ModelPart[];
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    bbox: AABB;
}

/** One placement of a model in the world. */
export interface ModelInstance {
    model: Model;
    modelMatrix: mat4;
    /** A prop or cast member placed by the level's `.OLV`. */
    isProp: boolean;
}

/** A model's geometry before it reaches the GPU, in draw order. */
export interface ModelBuilderPart {
    texture: number;
    alphaMode: AlphaMode;
    /** The cooker's blend mode. `Default` leaves the choice to `alphaMode` for props. */
    blendMode: BlendMode;
    positions: Float32Array;
    texcoords: Float32Array;
    /** RGBA, one byte per channel. `null` gives an opaque white vertex colour. */
    colors: Uint8Array | null;
    indices: Uint32Array;
}

const VERTEX_STRIDE = 24;

/**
 * Pack a model's parts into one vertex and one index buffer.
 * @param device The device to allocate on.
 * @param parts The model's parts, in draw order.
 * @returns The model, or `null` when it holds no triangles.
 */
export function buildModel(device: GfxDevice, parts: ModelBuilderPart[]): Model | null {
    let vertexCount = 0, indexCount = 0;
    for (const part of parts) {
        vertexCount += part.positions.length / 3;
        indexCount += part.indices.length;
    }
    if (indexCount === 0) {
        return null;
    }

    const vertexData = new ArrayBuffer(vertexCount * VERTEX_STRIDE);
    const floats = new Float32Array(vertexData);
    const bytes = new Uint8Array(vertexData);
    const indexData = new Uint32Array(indexCount);
    const bbox = new AABB();
    bbox.reset();

    const built: ModelPart[] = [];
    let vertexBase = 0, indexBase = 0;
    for (const part of parts) {
        const count = part.positions.length / 3;
        for (let i = 0; i < count; i++) {
            const at = (vertexBase + i) * 6;
            floats[at + 0] = part.positions[i * 3 + 0];
            floats[at + 1] = part.positions[i * 3 + 1];
            floats[at + 2] = part.positions[i * 3 + 2];
            floats[at + 3] = part.texcoords[i * 2 + 0];
            floats[at + 4] = part.texcoords[i * 2 + 1];
            const color = (vertexBase + i) * VERTEX_STRIDE + 20;
            if (part.colors !== null) {
                bytes[color + 0] = part.colors[i * 4 + 0];
                bytes[color + 1] = part.colors[i * 4 + 1];
                bytes[color + 2] = part.colors[i * 4 + 2];
                bytes[color + 3] = part.colors[i * 4 + 3];
            } else {
                bytes[color + 0] = bytes[color + 1] = bytes[color + 2] = bytes[color + 3] = 0xFF;
            }
            bbox.unionPoint(part.positions.subarray(i * 3, i * 3 + 3) as unknown as [number, number, number]);
        }
        for (let i = 0; i < part.indices.length; i++) {
            indexData[indexBase + i] = part.indices[i] + vertexBase;
        }
        built.push({ texture: part.texture, alphaMode: part.alphaMode, blendMode: part.blendMode, indexOffset: indexBase, indexCount: part.indices.length });
        vertexBase += count;
        indexBase += part.indices.length;
    }

    return {
        parts: built,
        vertexBuffer: createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData),
        indexBuffer: createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexData.buffer),
        bbox,
    };
}

/**
 * Upload a decoded texture.
 * @param device The device to allocate on.
 * @param texture The decoded pixels.
 * @returns The uploaded texture.
 */
export function makeTexture(device: GfxDevice, texture: DecodedTexture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    device.setResourceName(gfxTexture, texture.name);
    return gfxTexture;
}

const scratchAABB = new AABB();

export class SopranosRenderer {
    private inputLayout: GfxInputLayout;
    private program: GfxProgram;
    private sampler: GfxSampler;
    public showProps = true;

    constructor(cache: GfxRenderCache, private textures: GfxTexture[], private instances: ModelInstance[]) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: SopranosProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: SopranosProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 12 },
                { location: SopranosProgram.a_Color, bufferIndex: 0, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 20 },
            ],
            vertexBufferDescriptors: [{ byteStride: VERTEX_STRIDE, frequency: GfxVertexBufferFrequency.PerVertex }],
            indexBufferFormat: GfxFormat.U32_R,
        });
        this.program = cache.createProgram(new SopranosProgram());
        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
    }

    public prepareToRender(renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput): void {
        const manager = renderHelper.renderInstManager;
        const template = manager.pushTemplate();
        template.setGfxProgram(this.program);
        template.setBindingLayouts(bindingLayouts);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(SopranosProgram.ub_SceneParams, 16);
        fillMatrix4x4(template.mapUniformBufferF32(SopranosProgram.ub_SceneParams), offset, viewerInput.camera.clipFromWorldMatrix);

        for (const instance of this.instances) {
            if (instance.isProp && !this.showProps) {
                continue;
            }
            scratchAABB.transform(instance.model.bbox, instance.modelMatrix);
            if (!viewerInput.camera.frustum.contains(scratchAABB)) {
                continue;
            }
            const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, scratchAABB);
            for (const part of instance.model.parts) {
                const renderInst = manager.newRenderInst();
                renderInst.setVertexInput(this.inputLayout, [{ buffer: instance.model.vertexBuffer, byteOffset: 0 }], { buffer: instance.model.indexBuffer, byteOffset: 0 });

                const additive = part.blendMode === BlendMode.Additive;
                const subtractive = part.blendMode === BlendMode.Subtractive;
                const translucent = additive || subtractive || part.blendMode === BlendMode.Blend
                    || part.alphaMode === AlphaMode.Blend || part.alphaMode === AlphaMode.Glow;
                const megaState = renderInst.getMegaStateFlags();
                megaState.cullMode = GfxCullMode.None;
                if (additive || subtractive) {
                    setAttachmentStateSimple(megaState, {
                        blendMode: additive ? GfxBlendMode.Add : GfxBlendMode.ReverseSubtract,
                        blendSrcFactor: GfxBlendFactor.One,
                        blendDstFactor: GfxBlendFactor.One,
                    });
                    megaState.depthWrite = false;
                } else if (translucent) {
                    setAttachmentStateSimple(megaState, {
                        blendMode: GfxBlendMode.Add,
                        blendSrcFactor: GfxBlendFactor.SrcAlpha,
                        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                    });
                }
                renderInst.sortKey = makeSortKey(translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

                let drawOffset = renderInst.allocateUniformBuffer(SopranosProgram.ub_DrawParams, 16);
                const draw = renderInst.mapUniformBufferF32(SopranosProgram.ub_DrawParams);
                drawOffset += fillMatrix4x3(draw, drawOffset, instance.modelMatrix);
                fillVec4(draw, drawOffset, part.blendMode === BlendMode.Cutout ? CUTOUT_REF
                    : part.alphaMode === AlphaMode.Mask ? MASK_CUTOFF : 0.0, part.texture >= 0 ? 1.0 : 0.0);

                if (part.texture >= 0) {
                    renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.textures[part.texture], gfxSampler: this.sampler }]);
                } else {
                    renderInst.setSamplerBindingsFromTextureMappings([null]);
                }
                renderInst.setDrawCount(part.indexCount, part.indexOffset);
                manager.submitRenderInst(renderInst);
            }
        }
        manager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        const seen = new Set<Model>();
        for (const instance of this.instances) {
            if (seen.has(instance.model)) {
                continue;
            }
            seen.add(instance.model);
            device.destroyBuffer(instance.model.vertexBuffer);
            device.destroyBuffer(instance.model.indexBuffer);
        }
        for (const texture of this.textures) {
            device.destroyTexture(texture);
        }
    }
}
