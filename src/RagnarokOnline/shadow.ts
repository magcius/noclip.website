import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GfxTopology, makeTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers.js";
import { DeviceProgram } from "../Program.js";
import { makeSoftDiscImage } from "./weather.js";

const SHADOW_HALF_SIZE = 5.5;
const SHADOW_MAX_ALPHA = 0.85;

const SHADOW_LIFT = 0.4;

const SHADOW_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const SHADOW_FLOATS_PER_VERTEX = 5;
const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

export interface ShadowInstance {
    worldPos: vec3;
    size: number;
}

class ShadowProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_ShadowParams;
};

uniform sampler2D u_ShadowTexture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${ShadowProgram.a_Position}) in vec3 a_Position;
layout(location = ${ShadowProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
void main() {
    float t_A = texture(SAMPLER_2D(u_ShadowTexture), v_TexCoord).a;
    gl_FragColor = vec4(0.0, 0.0, 0.0, t_A * u_ShadowParams.x);
}
`;
}

const SHADOW_CORNER_OX = [-1, 1, 1, -1];
const SHADOW_CORNER_OZ = [-1, -1, 1, 1];
const SHADOW_CORNER_U = [0, 1, 1, 0];
const SHADOW_CORNER_V = [0, 0, 1, 1];

export class ShadowRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private texture: GfxTexture;

    private instances: ShadowInstance[] = [];

    private cpuData: ArrayBuffer = new ArrayBuffer(0);
    private cpuF32: Float32Array = new Float32Array(0);
    private cpuU8: Uint8Array = new Uint8Array(0);

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        this.program = cache.createProgram(new ShadowProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: ShadowProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: ShadowProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: SHADOW_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        const img = makeSoftDiscImage(0, 0, 0);
        this.texture = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.texture, 0, [img.rgba]);
    }

    public clearInstances(): void {
        this.instances.length = 0;
    }

    public addInstance(inst: ShadowInstance): void {
        this.instances.push(inst);
    }

    public setAnchors(anchors: vec3[], size: number): void {
        const n = anchors.length;
        while (this.instances.length < n)
            this.instances.push({ worldPos: vec3.create(), size });
        for (let i = 0; i < n; i++) {
            const inst = this.instances[i];
            inst.worldPos = anchors[i];
            inst.size = size;
        }
        this.instances.length = n;
    }

    public static defaultHalfSize(): number {
        return SHADOW_HALF_SIZE;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4): void {
        if (this.instances.length === 0)
            return;

        const vertexCount = this.instances.length * VERTS_PER_QUAD;
        const indexCount = this.instances.length * INDICES_PER_QUAD;
        const byteCount = vertexCount * SHADOW_VERTEX_STRIDE_BYTES;
        if (byteCount > this.cpuData.byteLength) {
            this.cpuData = new ArrayBuffer(byteCount);
            this.cpuF32 = new Float32Array(this.cpuData);
            this.cpuU8 = new Uint8Array(this.cpuData);
        }
        const f32 = this.cpuF32;

        let vi = 0;
        for (const inst of this.instances) {
            const wx = inst.worldPos[0];
            const wy = inst.worldPos[1] + SHADOW_LIFT;
            const wz = inst.worldPos[2];
            const s = inst.size;
            for (let c = 0; c < VERTS_PER_QUAD; c++) {
                const o = vi * SHADOW_FLOATS_PER_VERTEX;
                f32[o + 0] = wx + SHADOW_CORNER_OX[c] * s;
                f32[o + 1] = wy;
                f32[o + 2] = wz + SHADOW_CORNER_OZ[c] * s;
                f32[o + 3] = SHADOW_CORNER_U[c];
                f32[o + 4] = SHADOW_CORNER_V[c];
                vi++;
            }
        }

        const cache = renderHelper.renderCache;
        const vertexBufferDescriptors = [cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, this.cpuU8.subarray(0, byteCount))];
        const indexData = makeTriangleIndexBuffer(GfxTopology.Quads, 0, vertexCount);
        const indexBufferDescriptor = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Index, new Uint8Array(indexData.buffer));

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, indexBufferDescriptor);

        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        let offs = template.allocateUniformBuffer(ShadowProgram.ub_SceneParams, 16 + 4);
        const mapped = template.mapUniformBufferF32(ShadowProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);
        offs += fillVec4(mapped, offs, SHADOW_MAX_ALPHA, 0, 0, 0);

        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.texture, gfxSampler: this.sampler }]);
        renderInst.setDrawCount(indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}
