
// Sun lens-flare overlay. When the sun is on-screen, draws a chain of additive
// halo ghosts along the line FROM the sun's screen position THROUGH the screen
// centre. Vertices are emitted in NDC; projection is one CPU mat-vec on the
// sun direction. The original 2D client did not flare the sun — this is a
// viewer enhancement, gated to outdoor maps (sky.ts categoryWantsDome).

import { vec3, vec4 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { Camera } from "../Camera.js";
import { makeSoftDiscImage } from "./weather.js";

// t parameterises the sun→centre ray: 0 = sun, 1 = screen centre, >1 = past
// the centre (anti-flare anchors).
interface GhostDef {
    t: number;
    sizeNDC: number;
    r: number; g: number; b: number; a: number;
}

const GHOSTS: GhostDef[] = [
    { t: 0.00, sizeNDC: 0.045, r: 1.00, g: 0.95, b: 0.85, a: 0.85 },
    { t: 0.50, sizeNDC: 0.085, r: 1.00, g: 0.90, b: 0.70, a: 0.45 },
    { t: 1.10, sizeNDC: 0.075, r: 1.00, g: 0.80, b: 0.45, a: 0.40 },
    { t: 1.55, sizeNDC: 0.110, r: 1.00, g: 0.55, b: 0.30, a: 0.30 },
    { t: 2.10, sizeNDC: 0.140, r: 0.95, g: 0.35, b: 0.30, a: 0.22 },
];

// pos (2) + uv (2) + rgba (4) = 8 floats.
const VERTEX_STRIDE_BYTES = 8 * 4;
const FLOATS_PER_VERTEX = 8;

const VERTS_PER_GHOST = 6;
const MAX_VERTS = GHOSTS.length * VERTS_PER_GHOST;

const SUN_PROJECTION_DISTANCE = 1.0e5;

// NDC distance from the viewport edge where ghosts fade out.
const SUN_EDGE_FADE = 0.15;

class LensflareProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    vec4 u_Misc;
};

uniform sampler2D u_FlareTexture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = ${LensflareProgram.a_Position}) in vec2 a_Position;
layout(location = ${LensflareProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${LensflareProgram.a_Color}) in vec4 a_Color;

void main() {
    // NDC directly; depth test is disabled by the megastate.
    gl_Position = vec4(a_Position, 0.0, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
}
`;

    public override frag = `
void main() {
    float t_A = texture(SAMPLER_2D(u_FlareTexture), v_TexCoord).a;
    gl_FragColor = vec4(v_Color.rgb * v_Color.a * t_A, v_Color.a * t_A);
}
`;
}

export class LensflareRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private texture: GfxTexture;

    private vertexBuffer: ReturnType<GfxDevice["createBuffer"]> | null = null;
    private vertexCapacityVerts = 0;

    private cpuData: ArrayBuffer;
    private cpuF32: Float32Array;

    private scratchClip = vec4.create();
    private scratchWorld = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"]) {
        this.device = device;
        this.program = cache.createProgram(new LensflareProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: LensflareProgram.a_Position, format: GfxFormat.F32_RG, bufferByteOffset: 0, bufferIndex: 0 },
                { location: LensflareProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 2 * 4, bufferIndex: 0 },
                { location: LensflareProgram.a_Color, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
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

        const img = makeSoftDiscImage(255, 255, 255);
        this.texture = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.texture, 0, [img.rgba]);

        this.cpuData = new ArrayBuffer(MAX_VERTS * VERTEX_STRIDE_BYTES);
        this.cpuF32 = new Float32Array(this.cpuData);
    }

    // sunDirRender: unit vector FROM ground TOWARD sun in the renderer's
    // (mirrored, Y-up) frame. Caller should only invoke this when the sky
    // dome is showing.
    public prepare(renderHelper: GfxRenderHelper, camera: Camera, sunDirRender: vec3 | [number, number, number]): void {
        // Project a synthetic world point in the sun's direction to NDC.
        const camWorld = camera.worldMatrix;
        const cx = camWorld[12], cy = camWorld[13], cz = camWorld[14];
        const w0 = this.scratchWorld;
        w0[0] = cx + sunDirRender[0] * SUN_PROJECTION_DISTANCE;
        w0[1] = cy + sunDirRender[1] * SUN_PROJECTION_DISTANCE;
        w0[2] = cz + sunDirRender[2] * SUN_PROJECTION_DISTANCE;

        const clip = this.scratchClip;
        vec4.set(clip, w0[0], w0[1], w0[2], 1.0);
        vec4.transformMat4(clip, clip, camera.clipFromWorldMatrix);
        // w <= 0: sun is behind the camera. Bail before the divide.
        if (clip[3] <= 1e-5)
            return;
        const ndcX = clip[0] / clip[3];
        const ndcY = clip[1] / clip[3];

        if (ndcX < -1.0 || ndcX > 1.0 || ndcY < -1.0 || ndcY > 1.0)
            return;

        // Edge-fade envelope: smooth ramp-out as the sun nears any edge.
        const dEdge = Math.min(1.0 - Math.abs(ndcX), 1.0 - Math.abs(ndcY));
        const edgeT = Math.max(0.0, Math.min(1.0, dEdge / SUN_EDGE_FADE));
        const intensity = edgeT * edgeT * (3.0 - 2.0 * edgeT);
        if (intensity <= 0.001)
            return;

        // Aspect-correct: GHOSTS sizeNDC is a "smaller axis" half-extent, so
        // scale Y by aspect = proj[1][1] / proj[0][0] to keep ghosts circular.
        const proj = camera.projectionMatrix;
        const aspect = proj[5] !== 0 && proj[0] !== 0 ? proj[5] / proj[0] : 1.0;
        const sxMul = 1.0;
        const syMul = aspect;

        const f32 = this.cpuF32;
        let vi = 0;
        for (const g of GHOSTS) {
            // Ghost centre along the sun→origin ray.
            const gx = ndcX * (1.0 - g.t);
            const gy = ndcY * (1.0 - g.t);
            const sx = g.sizeNDC * sxMul;
            const sy = g.sizeNDC * syMul;
            const a = g.a * intensity;

            const x0 = gx - sx, x1 = gx + sx;
            const y0 = gy - sy, y1 = gy + sy;

            const writeVert = (x: number, y: number, u: number, v: number): void => {
                const o = vi * FLOATS_PER_VERTEX;
                f32[o + 0] = x;
                f32[o + 1] = y;
                f32[o + 2] = u;
                f32[o + 3] = v;
                f32[o + 4] = g.r;
                f32[o + 5] = g.g;
                f32[o + 6] = g.b;
                f32[o + 7] = a;
                vi++;
            };
            writeVert(x0, y1, 0, 0); // TL
            writeVert(x1, y1, 1, 0); // TR
            writeVert(x0, y0, 0, 1); // BL
            writeVert(x1, y1, 1, 0); // TR
            writeVert(x1, y0, 1, 1); // BR
            writeVert(x0, y0, 0, 1); // BL
        }

        const vertexCount = vi;
        if (vertexCount === 0)
            return;

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.cpuData, 0, vertexCount * VERTEX_STRIDE_BYTES));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // TRANSLUCENT + 2: paints over everything else including weather,
        // particles, and name labels (TRANSLUCENT + 1).
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 2);

        // Depth always: a faithful flare is an artifact of the LENS and
        // survives through occluding geometry.
        const megaState = template.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            depthWrite: false,
            depthCompare: GfxCompareMode.Always,
        });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.One,
        });

        let offs = template.allocateUniformBuffer(LensflareProgram.ub_SceneParams, 4);
        const mapped = template.mapUniformBufferF32(LensflareProgram.ub_SceneParams);
        offs += fillVec4(mapped, offs, 0, 0, 0, 0);

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
