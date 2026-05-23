
// Walking dust puffs under wandering mobs: when a mob steps into a new GAT cell
// we emit one small tan/grey puff at its feet that fades out over ~0.4s while
// lifting slightly and expanding a bit. Ambient life — the live client does the
// same to make foot traffic read as travel rather than sliding.
//
// Trigger: each MobEntity carries a `stepEpoch` counter that bumps every time
// its walk loop crosses into a new cell (see entity.ts:updateWalk). We keep a
// parallel `lastSeenEpoch` per mob; when a mob's epoch advances since last
// frame we spawn one puff at its published `stepWorldX/Y/Z`. The renderer
// doesn't need to know about respawns or kills — those don't bump the epoch.
//
// Particle pool: a single global ring of fixed-size slots, reused via a
// free-list so we never allocate per spawn/integrate. With ~hundreds of mobs
// each stepping at most a few times per second and a 0.4s lifetime, a few
// hundred slots cover any realistic in-flight count; the pool is grown
// (doubled) on demand if a stress case ever exceeds it.
//
// Render: camera-facing billboard quads (same trick the ParticleRenderer uses),
// textured with a small tan/grey soft-round disc (makeSoftDiscImage from
// weather.ts). Blend is standard src-alpha over (NOT additive) — dust over
// grass is a subtle grey smudge, not an emissive glow. Layer TRANSLUCENT so
// puffs sort after the opaque sprite pass and depth-test against terrain.
//
// Per-frame allocation budget: zero. The CPU vertex scratch buffer, the GPU
// vertex buffer, and the particle pool are all persistent and grown on demand
// only when the high-water mark increases.

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { MobEntity } from "./entity.js";
import { makeSoftDiscImage } from "./weather.js";

// ---------------------------------------------------------------------------
// Tunables.
// ---------------------------------------------------------------------------

// One GAT cell is 5 world units. Dust dimensions are picked relative to that
// so they read at the right scale from the free-fly camera.

// Lifetime of one puff in seconds. The live client's puff fades quickly so
// the trail under a walking mob feels like a brief kicked-up scuff, not a
// lingering cloud.
const DUST_LIFETIME = 0.4;

// Half-extent (world units) of the quad at spawn and at end-of-life. The puff
// expands linearly across the lifetime: small kick at the foot, slightly wider
// drift as it dissipates. ~1 unit (~0.2 cell) start, ~2.5 (~0.5 cell) end.
const DUST_HALF_SIZE_START = 1.0;
const DUST_HALF_SIZE_END = 2.5;

// Peak alpha at spawn (faded linearly to 0 by end-of-life). The texture's
// radial falloff multiplies this, so the visible peak is well under 0.5 —
// reads as a faint smudge, not a opaque patch.
const DUST_PEAK_ALPHA = 0.5;

// World-up lift over the lifetime (positive Y in the render frame: terrain
// world_y = -height, so +Y is upward). ~0.5 cell of rise.
const DUST_LIFT_TOTAL = 2.5;

// Small upward bias on spawn so the puff sits just above the ground mesh and
// doesn't z-fight with the terrain on its very first frame.
const DUST_LIFT_INITIAL = 0.4;

// Tan/grey puff colour (RGB; alpha is computed per-frame from the radial
// texture and the age fade). Matches the live client's dust palette.
const DUST_COLOR_R = 180;
const DUST_COLOR_G = 165;
const DUST_COLOR_B = 140;

// Initial pool size. Each in-flight puff occupies one slot until its age
// reaches DUST_LIFETIME, after which the slot returns to the free list. Pool
// grows (doubles) only if a frame ever runs out of slots — under normal play
// (a few hundred mobs, ~step/s each, 0.4s lifetime) this cap is plenty.
const DUST_INITIAL_POOL = 256;

// ---------------------------------------------------------------------------
// CPU-side state.
// ---------------------------------------------------------------------------

// One live puff. `alive` flips false when age >= DUST_LIFETIME and the slot
// goes back on the free list.
interface DustParticle {
    posX: number; posY: number; posZ: number;
    age: number;
    alive: boolean;
}

// 3 floats world pos + 2 floats billboard offset + 2 floats UV = 7 floats =
// 28 bytes per vertex. The size/age fade lives in per-particle uniforms is
// overkill for a single draw call; we pre-bake the corner offset (scaled by
// the current half-size) and the age-driven alpha into a per-vertex colour
// in the same buffer, so one draw covers every live puff.
//   pos.xyz (3) | offset.xy in world units (2) | uv.xy (2) | rgba (4 packed
//   as a 32-bit float lane: stored as 4 floats in the uniform draw call for
//   simplicity, since per-particle ageing differs).
//
// Keep this simple: instead of packing colour per-vertex (a streaming
// 32-bit RGBA attribute), we encode the per-particle alpha into the v_TexCoord
// w slot — i.e. push uv as a vec4(u, v, alpha, 0). That keeps the layout
// trivially 9 floats / 36 bytes per vertex and the shader needs no extra
// attribute beyond what the ParticleRenderer already passes.
const DUST_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 4 * 4;
const DUST_FLOATS_PER_VERTEX = 9;

// Constant per-corner tables hoisted out of the inner loop. Order matches
// shadow.ts: two triangles, six vertices, with the camera-billboard offset
// supplied as +/- half-size on the camera right/up axes (the shader adds
// camRight*offset.x + camUp*offset.y to a_Position).
const DUST_CORNER_OX = [-1, 1, -1, 1];
const DUST_CORNER_OY = [-1, -1, 1, 1];
const DUST_CORNER_U = [0, 1, 0, 1];
const DUST_CORNER_V = [1, 1, 0, 0];
const DUST_TRI = [0, 1, 2, 1, 3, 2];

// ---------------------------------------------------------------------------
// Shader.
// ---------------------------------------------------------------------------

class DustProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Offset = 1;
    public static a_TexCoord = 2;
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_CamRight;  // xyz: render-frame camera right (world axis)
    vec4 u_CamUp;     // xyz: render-frame camera up    (world axis)
    vec4 u_DustColor; // rgb: 0..1 tint, a: 1 (per-particle alpha rides in v_TexCoord.z)
};

uniform sampler2D u_Texture;

varying vec3 v_TexCoord;  // .xy uv, .z per-particle alpha
`;

    public override vert = `
layout(location = ${DustProgram.a_Position}) in vec3 a_Position;
layout(location = ${DustProgram.a_Offset}) in vec2 a_Offset;
layout(location = ${DustProgram.a_TexCoord}) in vec4 a_TexCoord;  // uv.xy, alpha.z

void main() {
    // Billboard the puff: anchor at a_Position, expand on the camera basis.
    // a_Offset is already scaled by the puff's current half-size on the CPU,
    // so the shader just sums in world space.
    vec3 t_World = a_Position
                 + u_CamRight.xyz * a_Offset.x
                 + u_CamUp.xyz    * a_Offset.y;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_World, 1.0);
    v_TexCoord = a_TexCoord.xyz;
}
`;

    public override frag = `
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
    // Tan/grey RGB from the uniform tint, alpha = texture radial falloff
    // (its .a channel) * the per-particle age-fade alpha.
    gl_FragColor = vec4(u_DustColor.rgb, t_Tex.a * v_TexCoord.z);
}
`;
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------

export class DustRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private texture: GfxTexture;
    private device: GfxDevice;

    // Mob references (set once after setup). Each frame we walk these and
    // compare stepEpoch to the per-slot lastSeenEpoch in the parallel array.
    private mobs: MobEntity[] = [];
    private lastSeenEpoch: number[] = [];

    // Particle pool. Slots beyond `particles.length` don't exist; `freeList`
    // holds indices of dead slots. On spawn we pop a free index; on death
    // (age >= DUST_LIFETIME) we push the slot back.
    private particles: DustParticle[] = [];
    private freeList: number[] = [];

    // GPU buffer + persistent CPU scratch (grown on demand).
    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;
    private cpuData: ArrayBuffer = new ArrayBuffer(0);
    private cpuF32: Float32Array = new Float32Array(0);
    private cpuU8: Uint8Array = new Uint8Array(0);

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"]) {
        this.device = device;
        this.program = cache.createProgram(new DustProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: DustProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: DustProgram.a_Offset, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: DustProgram.a_TexCoord, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: DUST_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
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

        const img = makeSoftDiscImage(DUST_COLOR_R, DUST_COLOR_G, DUST_COLOR_B);
        this.texture = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.texture, 0, [img.rgba]);

        this.growPool(DUST_INITIAL_POOL);
    }

    // Replace the mob list the renderer polls. Called once at scene setup;
    // the per-mob `lastSeenEpoch` is sized to match and primed to each mob's
    // current epoch so we never spawn a "catch-up" puff for whatever stepping
    // happened before the renderer existed.
    public setMobs(mobs: MobEntity[]): void {
        this.mobs = mobs;
        if (this.lastSeenEpoch.length !== mobs.length)
            this.lastSeenEpoch = new Array(mobs.length);
        for (let i = 0; i < mobs.length; i++)
            this.lastSeenEpoch[i] = mobs[i].stepEpoch;
    }

    // Grow the particle pool to at least `target` slots, seeding the new
    // tail onto the free list so they're immediately spawnable.
    private growPool(target: number): void {
        const oldLen = this.particles.length;
        if (oldLen >= target)
            return;
        for (let i = oldLen; i < target; i++) {
            this.particles.push({ posX: 0, posY: 0, posZ: 0, age: 0, alive: false });
            this.freeList.push(i);
        }
    }

    // Pop one free slot and spawn a puff at (x, y, z). If the pool is
    // exhausted (extreme step burst), double its size — bounded by reality:
    // mobs only step on segment completion so a real-world burst still tops
    // out in the low hundreds.
    private spawnOne(x: number, y: number, z: number): void {
        if (this.freeList.length === 0)
            this.growPool(this.particles.length * 2);
        const idx = this.freeList.pop()!;
        const p = this.particles[idx];
        // Initial lift so the puff sits clearly above the terrain (avoids a
        // first-frame z-fight on a perfectly flat ground tile).
        p.posX = x;
        p.posY = y + DUST_LIFT_INITIAL;
        p.posZ = z;
        p.age = 0;
        p.alive = true;
    }

    // Per-frame tick: spawn puffs for any mob whose epoch advanced since last
    // frame, then age the live pool. Call BEFORE prepare(). Safe to call on
    // a frame where prepare is skipped (no draw submission happens here).
    public update(dt: number): void {
        if (dt <= 0) {
            // Still drain the epoch deltas so we don't double-fire next frame.
            this.drainStepEvents();
            return;
        }
        this.drainStepEvents();

        // Integrate + kill. Position is computed from age at prepare time
        // (lift + size scale linearly with age), so integration here is only
        // ageing the slot and recycling on expiry.
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.alive)
                continue;
            p.age += dt;
            if (p.age >= DUST_LIFETIME) {
                p.alive = false;
                this.freeList.push(i);
            }
        }
    }

    // Walk the mob list once, comparing each mob's stepEpoch to the per-slot
    // last-seen value. Spawn one puff per epoch advance (an epoch can advance
    // by more than 1 in a single frame if the mob crossed multiple cells; we
    // still only emit one — the puff is decorative, not a step counter, and
    // collapsing bursts keeps the pool sane). Update last-seen unconditionally.
    private drainStepEvents(): void {
        const n = this.mobs.length;
        for (let i = 0; i < n; i++) {
            const mob = this.mobs[i];
            const epoch = mob.stepEpoch;
            const last = this.lastSeenEpoch[i];
            if (epoch !== last) {
                this.spawnOne(mob.stepWorldX, mob.stepWorldY, mob.stepWorldZ);
                this.lastSeenEpoch[i] = epoch;
            }
        }
    }

    // Count live puffs across the pool (used to size the per-frame vertex
    // buffer once instead of growing it ad-hoc).
    private countLive(): number {
        let n = 0;
        for (const p of this.particles)
            if (p.alive) n++;
        return n;
    }

    // Build this frame's quads and submit one draw covering them all. Caller
    // passes the current frame's clipFromWorld + camera basis (right/up in
    // the render frame) so the vertex shader can billboard each puff without
    // an inverse-view computation. Call AFTER update().
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, camRight: vec3, camUp: vec3): void {
        const totalLive = this.countLive();
        if (totalLive === 0)
            return;

        const vertexCount = totalLive * 6;
        const byteCount = vertexCount * DUST_VERTEX_STRIDE_BYTES;
        if (byteCount > this.cpuData.byteLength) {
            this.cpuData = new ArrayBuffer(byteCount);
            this.cpuF32 = new Float32Array(this.cpuData);
            this.cpuU8 = new Uint8Array(this.cpuData);
        }
        const f32 = this.cpuF32;

        // Build six vertices per live puff. Per-particle derived state:
        //   t      in [0, 1]: age/lifetime
        //   size   half-extent at this age (linear lerp start -> end)
        //   alpha  age fade: PEAK * (1 - t)
        //   y      anchor Y + lift * t
        let vi = 0;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!p.alive)
                continue;
            const t = p.age / DUST_LIFETIME;
            const size = DUST_HALF_SIZE_START + (DUST_HALF_SIZE_END - DUST_HALF_SIZE_START) * t;
            const alpha = DUST_PEAK_ALPHA * (1.0 - t);
            const ax = p.posX;
            const ay = p.posY + DUST_LIFT_TOTAL * t;
            const az = p.posZ;
            for (let n = 0; n < 6; n++) {
                const c = DUST_TRI[n];
                const o = vi * DUST_FLOATS_PER_VERTEX;
                f32[o + 0] = ax;
                f32[o + 1] = ay;
                f32[o + 2] = az;
                f32[o + 3] = DUST_CORNER_OX[c] * size;
                f32[o + 4] = DUST_CORNER_OY[c] * size;
                f32[o + 5] = DUST_CORNER_U[c];
                f32[o + 6] = DUST_CORNER_V[c];
                f32[o + 7] = alpha;
                f32[o + 8] = 0;
                vi++;
            }
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * DUST_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
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
        // TRANSLUCENT layer so puffs sort after the opaque sprite pass (their
        // depth-write would otherwise clobber an earlier-drawn puff) and after
        // the per-map particle pass; within the layer, stable sort preserves
        // submission order. Depth-tested (a wall in front occludes a puff)
        // but no depth write (later transparent layers should still see through).
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
        // Standard src-alpha over: dust over grass is a subtle grey/tan smudge,
        // not an emissive glow — additive would brighten the ground unnaturally.
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        let offs = template.allocateUniformBuffer(DustProgram.ub_SceneParams, 16 + 3 * 4);
        const mapped = template.mapUniformBufferF32(DustProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);
        offs += fillVec4(mapped, offs, camRight[0], camRight[1], camRight[2], 0);
        offs += fillVec4(mapped, offs, camUp[0], camUp[1], camUp[2], 0);
        // RGB tint is 0..1; the texture already carries the tan colour in its
        // RGB channels (we baked them at construction), so this uniform mostly
        // exists for future per-map colour tweaks. Keep at white for now so the
        // texture's RGB passes through unchanged.
        offs += fillVec4(mapped, offs, 1, 1, 1, 1);

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
