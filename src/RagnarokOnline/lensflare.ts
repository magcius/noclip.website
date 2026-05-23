
// Sun lens-flare overlay for Ragnarok Online outdoor maps.
//
// When the sun (the same direction that lights the props — see render.ts's
// LightSceneData.lightDir / sky.ts's SkyDome) is on-screen, we draw a handful
// of additive halo ghost billboards along the line FROM the sun's screen
// position THROUGH the screen centre. This is the classic anamorphic-flare
// idiom: a bright ghost on the sun, a couple of warm-tinted ghosts along the
// ray, and one or two "anti-flare" ghosts past the centre to anchor the eye.
//
// Cheap effect, big atmosphere win on city/field maps. No camera-relative
// world geometry is needed: vertices live in NDC (the vertex shader emits
// gl_Position directly), so projection is one CPU mat-vec on the sun
// direction; rejection happens here, not on the GPU.
//
// Faithful note: the original 2D RO client did not flare the sun (its sky
// was a flat clear, never a real dome). This is a viewer enhancement and
// runs on every map whose sky dome runs (sky.ts categoryWantsDome).

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

// One ghost in the flare chain. `t` is the parameter along the sun→centre
// ray, where 0 is the sun's screen position, 1 is the screen centre, and
// values past 1 are the anti-flare ghosts on the far side of the centre.
// `sizeNDC` is the half-extent in NDC (so 0.05 = 10% of the smaller screen
// axis after the aspect correction below). `r/g/b/a` is the tint applied to
// the soft-disc alpha sample; a < 1 keeps even the largest ghosts subtle.
interface GhostDef {
    t: number;
    sizeNDC: number;
    r: number; g: number; b: number; a: number;
}

// The flare chain — small-to-largest, warming from white at the sun to a
// muted red on the anti-flare ghost. Order doesn't matter for correctness
// (additive blend is commutative), but reads cleanly going outward.
const GHOSTS: GhostDef[] = [
    // Right on the sun: a tight white core that pops the disc a touch
    // brighter than the sky dome's halo alone.
    { t: 0.00, sizeNDC: 0.045, r: 1.00, g: 0.95, b: 0.85, a: 0.85 },
    // First ghost back toward the centre: a soft warm white.
    { t: 0.50, sizeNDC: 0.085, r: 1.00, g: 0.90, b: 0.70, a: 0.45 },
    // Past-the-centre yellow.
    { t: 1.10, sizeNDC: 0.075, r: 1.00, g: 0.80, b: 0.45, a: 0.40 },
    // Further past — orange.
    { t: 1.55, sizeNDC: 0.110, r: 1.00, g: 0.55, b: 0.30, a: 0.30 },
    // Anchor ghost on the far edge — muted red, largest.
    { t: 2.10, sizeNDC: 0.140, r: 0.95, g: 0.35, b: 0.30, a: 0.22 },
];

// Vertex layout: NDC x,y + UV + RGBA tint. No world coords, no model matrix.
// 2 f32 pos + 2 f32 uv + 4 f32 colour = 32 bytes.
const VERTEX_STRIDE_BYTES = 8 * 4;
const FLOATS_PER_VERTEX = 8;

// 6 verts (two triangles) per ghost.
const VERTS_PER_GHOST = 6;
const MAX_VERTS = GHOSTS.length * VERTS_PER_GHOST;

// A small synthetic world-space distance to project the sun direction at.
// Has to be far enough that the sun reads as "at infinity" through the
// projection but not so far that float precision becomes an issue at typical
// RO scene scales (maps are a few hundred world units across).
const SUN_PROJECTION_DISTANCE = 1.0e5;

// Brightness envelope: the whole chain fades in over a small ring inside the
// viewport edge so a ghost doesn't pop on/off when the sun crosses the screen
// boundary. SUN_EDGE_FADE is the NDC distance from |1| where the ghosts
// reach full strength; closer to the edge than that and the chain attenuates.
const SUN_EDGE_FADE = 0.15;

// ---------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------

// Tints + multiplies the soft-disc alpha. The vertex shader emits NDC
// positions directly (no clipFromWorld); the per-vertex tint carries the
// whole-chain intensity and the per-ghost colour together.
class LensflareProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    // Reserved for future tweakables (currently unused; the per-vertex tint
    // carries everything). Kept so the program advertises a uniform block
    // and the binding layout matches the GfxRenderHelper convention.
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
    // Vertices live in NDC already. z=0 (anywhere inside the depth range is
    // fine; depth test is disabled by the megastate); w=1.
    gl_Position = vec4(a_Position, 0.0, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
}
`;

    public override frag = `
void main() {
    // Soft-disc alpha is the radial falloff (0 at edge, 1 at centre).
    // Multiply the per-vertex tint by it. Output (rgb*alpha, alpha) so the
    // additive blend (SRC_ALPHA, ONE) lands as alpha*rgb on top of the scene.
    float t_A = texture(SAMPLER_2D(u_FlareTexture), v_TexCoord).a;
    gl_FragColor = vec4(v_Color.rgb * v_Color.a * t_A, v_Color.a * t_A);
}
`;
}

// Owns the GPU resources (one program, one input layout, one soft-disc
// texture, one dynamic vertex buffer) and rebuilds the (≤30) ghost vertices
// into a persistent CPU scratch buffer each frame. Zero per-frame allocation.
export class LensflareRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private texture: GfxTexture;

    private vertexBuffer: ReturnType<GfxDevice["createBuffer"]> | null = null;
    private vertexCapacityVerts = 0;

    // Persistent CPU scratch — sized once for the max ghost count. Re-filled
    // every frame the flare is on-screen; nothing is allocated per frame.
    private cpuData: ArrayBuffer;
    private cpuF32: Float32Array;

    // Scratch reused for the sun-direction projection. No per-frame `new`.
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

        // Procedural soft-disc texture (shared with weather/shadow): the
        // alpha channel carries a smoothstep radial falloff; RGB is constant
        // white (the per-ghost tint comes in as a vertex colour).
        const img = makeSoftDiscImage(255, 255, 255);
        this.texture = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.texture, 0, [img.rgba]);

        // CPU scratch sized for the worst case (every ghost on every frame).
        this.cpuData = new ArrayBuffer(MAX_VERTS * VERTEX_STRIDE_BYTES);
        this.cpuF32 = new Float32Array(this.cpuData);
    }

    // Submit the flare chain for this frame. Caller is responsible for only
    // calling this when the sky dome is showing (the flare reads as wrong
    // against an indoor flat clear). sunDirRender is the unit direction FROM
    // the ground TOWARD the sun in the renderer's (mirrored, Y-up) frame —
    // exactly LightSceneData.lightDir / SkySceneData.sunDir on the renderer.
    public prepare(renderHelper: GfxRenderHelper, camera: Camera, sunDirRender: vec3 | [number, number, number]): void {
        // Project a synthetic world-space point in the sun's direction to NDC.
        // (cameraPos + sunDir * largeDistance) seen through clipFromWorld.
        const camWorld = camera.worldMatrix;
        const cx = camWorld[12], cy = camWorld[13], cz = camWorld[14];
        const w0 = this.scratchWorld;
        w0[0] = cx + sunDirRender[0] * SUN_PROJECTION_DISTANCE;
        w0[1] = cy + sunDirRender[1] * SUN_PROJECTION_DISTANCE;
        w0[2] = cz + sunDirRender[2] * SUN_PROJECTION_DISTANCE;

        const clip = this.scratchClip;
        vec4.set(clip, w0[0], w0[1], w0[2], 1.0);
        vec4.transformMat4(clip, clip, camera.clipFromWorldMatrix);
        // Clip w <= 0 means the sun is behind the camera (or on the plane).
        // Bail before the divide; a divide by ~0 would yield garbage NDC.
        if (clip[3] <= 1e-5)
            return;
        const ndcX = clip[0] / clip[3];
        const ndcY = clip[1] / clip[3];

        // Off-screen? Skip. The sun is on-screen iff |ndcX| and |ndcY| are
        // both within the [-1, 1] viewport; outside that, no flare ghosts
        // would land on the visible image worth drawing.
        if (ndcX < -1.0 || ndcX > 1.0 || ndcY < -1.0 || ndcY > 1.0)
            return;

        // Edge-fade envelope: full strength when the sun is comfortably
        // inside the viewport; smooth ramp-out as it nears any edge. dEdge
        // is the smallest distance from the sun to any of the four NDC edges.
        const dEdge = Math.min(1.0 - Math.abs(ndcX), 1.0 - Math.abs(ndcY));
        const edgeT = Math.max(0.0, Math.min(1.0, dEdge / SUN_EDGE_FADE));
        // Smoothstep so the fade-in is gentle at both ends.
        const intensity = edgeT * edgeT * (3.0 - 2.0 * edgeT);
        if (intensity <= 0.001)
            return;

        // Aspect-correct the ghost sizes: GHOSTS sizeNDC is a "smaller axis"
        // half-extent, so a horizontal viewport stretches ghosts on Y so
        // they read circular. Compute the aspect from the projection matrix
        // (the proj has 1/(aspect*tanHFov) at [0][0] and 1/tanHFov at [1][1],
        // so aspect = m[1][1] / m[0][0]).
        const proj = camera.projectionMatrix;
        const aspect = proj[5] !== 0 && proj[0] !== 0 ? proj[5] / proj[0] : 1.0;
        // sizeX stays as authored; sizeY scales by aspect so a ghost is a
        // disc, not an ellipse, on widescreen viewports.
        const sxMul = 1.0;
        const syMul = aspect;

        // Build the ghost quads in NDC.
        const f32 = this.cpuF32;
        let vi = 0;
        for (const g of GHOSTS) {
            // Ghost centre along the sun→origin ray. t=0 sun, t=1 centre.
            const gx = ndcX * (1.0 - g.t);
            const gy = ndcY * (1.0 - g.t);
            const sx = g.sizeNDC * sxMul;
            const sy = g.sizeNDC * syMul;
            const a = g.a * intensity;

            // Corners: TL, TR, BL, BR in (right=+x, up=+y).
            const x0 = gx - sx, x1 = gx + sx;
            const y0 = gy - sy, y1 = gy + sy;

            // Two triangles: (TL, TR, BL), (TR, BR, BL).
            // UV maps the soft disc (centre = white max alpha, edges = 0).
            // TL(0,0) TR(1,0) BL(0,1) BR(1,1).
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

        // Upload. Grow the GPU buffer only if a larger chain ever appears
        // (with GHOSTS fixed at compile time, this allocates once on the
        // first non-empty frame and then reuses for the scene lifetime).
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
        // TRANSLUCENT + 2: the lens flare paints OVER everything else,
        // including weather, particles, portals (TRANSLUCENT) and name
        // labels (TRANSLUCENT + 1). It's a post-everything overlay; a
        // weather flake should not be brighter than the flare ghosts.
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 2);

        // Depth test + write disabled: the flare lives in screen space and
        // should be visible wherever the sun is visible, including in front
        // of geometry that happens to occlude the sun (a faithful flare is
        // an artifact of the LENS, not the scene — it survives through walls).
        // No cull (the NDC tris have no meaningful winding).
        const megaState = template.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            depthWrite: false,
            depthCompare: GfxCompareMode.Always,
        });
        // Additive blend: src*alpha + dst*1. Each ghost adds its premultiplied
        // colour to the scene; overlap reads as a hot spot, exactly how a
        // real flare stack accumulates.
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.One,
        });

        // Uniform block is currently a placeholder vec4; reserved for
        // future tweakables (overall gain, hot-spot bias) — keeping the
        // binding layout consistent with the other RO renderers.
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

