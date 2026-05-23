
// Soft blob shadows under feet-anchored sprites (NPCs, monsters). Flat textured
// quad on the XZ plane at each sprite's world anchor, lifted slightly to avoid
// z-fighting. Standard alpha blend; no depth write so the shadow doesn't
// occlude the transparent layers drawn over it (sprites, water, effects).

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { makeSoftDiscImage } from "./weather.js";

const SHADOW_HALF_SIZE = 5.5;
const SHADOW_MAX_ALPHA = 0.85;
// Lift along +Y (terrain world_y = -height, render frame is Y-up) so the quad
// doesn't z-fight with the ground.
const SHADOW_LIFT = 0.4;

// 3 floats pos + 2 floats uv = 20 bytes. Color is constant in the shader.
const SHADOW_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const SHADOW_FLOATS_PER_VERTEX = 5;

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
    vec4 u_ShadowParams; // x: peak alpha
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

const SHADOW_CORNER_OX = [-1, 1, -1, 1];
const SHADOW_CORNER_OZ = [-1, -1, 1, 1];
const SHADOW_CORNER_U = [0, 1, 0, 1];
const SHADOW_CORNER_V = [0, 0, 1, 1];
const SHADOW_TRI = [0, 1, 2, 1, 3, 2];

export class ShadowRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private texture: GfxTexture;

    private instances: ShadowInstance[] = [];

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;
    private cpuData: ArrayBuffer = new ArrayBuffer(0);
    private cpuF32: Float32Array = new Float32Array(0);
    private cpuU8: Uint8Array = new Uint8Array(0);

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"]) {
        this.device = device;
        this.program = cache.createProgram(new ShadowProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: ShadowProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: ShadowProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: SHADOW_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: null,
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

    // Mutates slots in place to avoid the `{ worldPos, size }` literal per
    // anchor per frame. Keeps the reference to each live anchor vec3 (mobs
    // walk by mutating their worldPos).
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

    // Call BEFORE the sprite pass so shadows render under their sprites.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4): void {
        if (this.instances.length === 0)
            return;

        const vertexCount = this.instances.length * 6;
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
            for (let n = 0; n < 6; n++) {
                const c = SHADOW_TRI[n];
                const o = vi * SHADOW_FLOATS_PER_VERTEX;
                f32[o + 0] = wx + SHADOW_CORNER_OX[c] * s;
                f32[o + 1] = wy;
                f32[o + 2] = wz + SHADOW_CORNER_OZ[c] * s;
                f32[o + 3] = SHADOW_CORNER_U[c];
                f32[o + 4] = SHADOW_CORNER_V[c];
                vi++;
            }
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * SHADOW_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, this.cpuU8.subarray(0, byteCount));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // OPAQUE layer so shadows draw BEFORE the sprite billboards (sprite
        // renderer's depthWrite would clobber a later-drawn shadow). Stable
        // sort preserves submission order within the layer.
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        let offs = template.allocateUniformBuffer(ShadowProgram.ub_SceneParams, 16 + 4);
        const mapped = template.mapUniformBufferF32(ShadowProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);
        offs += fillVec4(mapped, offs, SHADOW_MAX_ALPHA, 0, 0, 0);

        // depthWrite off: shadow must not block the transparent layers drawn
        // over it (sprites, water, effects).
        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: this.texture, gfxSampler: this.sampler }]);
        renderInst.setDrawCount(vertexCount, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
