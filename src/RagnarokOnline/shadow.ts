
// Soft blob shadows under feet-anchored sprites (NPCs, monsters) to ground them
// on the terrain instead of having them float as free-standing billboards.
//
// The original client renders data\sprite\shadow.spr — a flat soft-round dark
// disc — under every character at its world position. We stand in for that with
// a procedurally generated soft-round dark texture (same trick weather.ts uses
// for snow flakes via makeFlakeImage), drawn as a flat textured quad on the XZ
// plane (parallel to the ground) at each sprite's world anchor.
//
// Blend: standard src-alpha over with a low max alpha (~0.4) so the shadow
// reads as a gentle darkening rather than an opaque black disc. Depth-tested
// (so a wall in front occludes it) but NO depth write (so it doesn't shadow the
// transparent layers drawn on top — water, sprites, effects).
//
// The quad is lifted slightly above the terrain along world-up to avoid
// z-fighting with the ground mesh. The sprite renderer's worldPos is
// already correctly mirrored (gatCellToWorld / mapOffX - e.pos.x), so the
// shadow just consumes that anchor unchanged — no new mirror.
//
// Effect-source placements (anchor === "center", e.g. torch flames) are
// authored centred on their emit point, often well above the ground; we skip
// them, matching the original which does not shadow them either. Only
// feet-anchored sprites (NPCs/mobs) get a shadow.
//
// Mobs move every frame, so the renderer re-emits the instance list from the
// current world positions each frame (clear -> add -> prepare). Sub-frame
// re-emit is cheap (hundreds of shadows at most).

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { makeSoftDiscImage } from "./weather.js";

// ---------------------------------------------------------------------------
// Tunables. These read well from a free-fly camera; tweak if the shadows feel
// too heavy/light or too small/large.
// ---------------------------------------------------------------------------

// Half-extent of a shadow quad in world units (so the quad spans 2*SIZE).
// A GAT cell is ~5 world units (zoom/2); 5.5 puts a feet-anchored sprite's
// shadow at ~2.2 cells across — comfortably readable from the wide free-fly
// camera. (Was 2.4 then 4.0 — both too subtle to spot under most sprites.)
const SHADOW_HALF_SIZE = 5.5;

// Peak alpha at the shadow center, after the texture's radial falloff. The
// disc fades to 0 at the edge so the average darkening is gentler than this
// peak suggests; 0.85 gives the centre a clearly visible "this thing has a
// shadow" feel without being a black blob.
const SHADOW_MAX_ALPHA = 0.85;

// World-up lift above the worldPos anchor (in render-frame units) so the quad
// sits just above the terrain and doesn't z-fight with the ground mesh. The
// ground surface at a cell is at -height; entities sit on that, so lifting by
// a small positive amount along +Y in the render frame raises the shadow above
// the ground. Render frame here is Y-up; the terrain mesh world_y = -height.
const SHADOW_LIFT = 0.4;

// 3 floats world pos + 2 floats uv = 20 bytes per vertex. Color is constant
// (black at SHADOW_MAX_ALPHA) so it lives in the shader, not per-vertex.
const SHADOW_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const SHADOW_FLOATS_PER_VERTEX = 5;

// One placed shadow: its world anchor (the sprite's worldPos) and a half-size
// for the quad. Size is per-instance so a giant mob (MVP) could get a larger
// shadow than a Poring; the renderer caller can scale by sprite frame size,
// or just pass SHADOW_HALF_SIZE for a uniform look.
export interface ShadowInstance {
    worldPos: vec3;
    size: number;
}

// The shadow texture is the same soft-round disc weather flakes use, just
// black instead of white. See makeSoftDiscImage in weather.ts.

// Shader for the shadow quads: world-space vertices projected by the scene
// matrix, fragment samples the soft-round texture; constant black tint scaled
// by the texture's alpha and a uniform peak alpha. Alpha-blended (no cutout)
// so the soft edge stays soft.
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

// Owns the GPU resources for the shadow pass: a single small soft-round texture,
// the shared pipeline, and a transient per-frame vertex buffer rebuilt from the
// caller's instance list. Driven from inside the terrain renderer's prepare
// cycle BEFORE the sprite pass, so shadows render under their sprites.
// Quad-corner offset and triangle-index tables are constant; hoist them out of
// the per-frame inner loop so we don't churn six small Arrays per instance.
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
    // Persistent CPU scratch buffers grown on demand and reused every frame;
    // avoids `new ArrayBuffer / Float32Array / Uint8Array` per prepare().
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

    // Caller refreshes the instance list each frame from current sprite/mob
    // positions (mobs move) and then calls prepare(); the renderer is purely a
    // GPU front-end with no state of its own across frames besides the texture.
    public clearInstances(): void {
        this.instances.length = 0;
    }

    public addInstance(inst: ShadowInstance): void {
        this.instances.push(inst);
    }

    // Refreshes the instance list from a caller-owned anchor list, mutating
    // slots in place to avoid the `{ worldPos, size }` literal per anchor per
    // frame. Slots beyond `anchors.length` are dropped. Use this in place of
    // clearInstances + addInstance when all instances share the same size.
    public setAnchors(anchors: vec3[], size: number): void {
        const n = anchors.length;
        // Grow the pool to fit the new anchor count; mutate existing slots.
        while (this.instances.length < n)
            this.instances.push({ worldPos: vec3.create(), size });
        for (let i = 0; i < n; i++) {
            const inst = this.instances[i];
            // Keep the reference to the live anchor vec3 (mobs walk by mutating
            // their worldPos), so the next frame reads current positions for free.
            inst.worldPos = anchors[i];
            inst.size = size;
        }
        this.instances.length = n;
    }

    // The default half-size, exposed so callers can use it as a uniform-look
    // value without re-importing the tunable name.
    public static defaultHalfSize(): number {
        return SHADOW_HALF_SIZE;
    }

    // Builds this frame's quads and submits one draw covering them all. Call
    // inside the renderer's prepare cycle BEFORE the sprite pass so shadows
    // render under their sprites (the sprite's own alpha-blend layers on top).
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4): void {
        if (this.instances.length === 0)
            return;

        const vertexCount = this.instances.length * 6;
        const byteCount = vertexCount * SHADOW_VERTEX_STRIDE_BYTES;
        // Grow the persistent CPU scratch only when the frame outsizes it.
        if (byteCount > this.cpuData.byteLength) {
            this.cpuData = new ArrayBuffer(byteCount);
            this.cpuF32 = new Float32Array(this.cpuData);
            this.cpuU8 = new Uint8Array(this.cpuData);
        }
        const f32 = this.cpuF32;

        // Each shadow is a flat quad on the XZ plane (parallel to the ground)
        // centered on (wx, wy, wz) with corners at (+/- s, 0, +/- s). World Y
        // is up in the render frame (terrain world_y = -height); SHADOW_LIFT
        // raises the quad along +Y so it sits just above the ground mesh and
        // doesn't z-fight with it. Corner offsets and triangle indices come
        // from module-scope const tables (no per-instance literals).
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
        // OPAQUE layer so shadows draw BEFORE the sprite billboards that layer
        // over them (sprite renderer's depthWrite would clobber a later-drawn
        // shadow). Within the OPAQUE layer, stable sort preserves the renderer's
        // submission order (shadows before sprites).
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        let offs = template.allocateUniformBuffer(ShadowProgram.ub_SceneParams, 16 + 4);
        const mapped = template.mapUniformBufferF32(ShadowProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);
        offs += fillVec4(mapped, offs, SHADOW_MAX_ALPHA, 0, 0, 0);

        // Two-sided (an upward-facing quad would otherwise vanish if viewed
        // from below the terrain in a fly-through), depth-tested (closer
        // geometry occludes it) but NO depth write — the shadow should never
        // block the transparent layers drawn over it (sprites, water, effects).
        // Standard src-alpha over blend for the soft round look.
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
