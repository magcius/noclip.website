
// Faithful recreation of Ragnarok Online's warp-portal effect (the glowing
// swirling gate that sits on a map's warp tiles). Modern clients render warp
// NPCs with CRagEffect::WarpZone2 (EF_WARPZONE2; see Npc.cpp SECONDJOB_SKILL2),
// which composes three kinds of CEffectPrim primitive:
//
//   * a soft filled ground disc (alpha_down.tga, PP_3DCIRCLE + PT_FILLCIRCLE):
//     radius 15, lying flat, alpha ramps 0 -> 128. The base glow.
//   * the swirl itself: two PP_3DCASTING_4 primitives, each four "arms" — rings
//     of radius `distance` that continuously collapse inward (distance -= 0.05,
//     looping 10 -> 0) while flaring up and out by `rise_angle = 90 - distance*9`.
//     Each arm is a textured ribbon (ring_blue.tga) drawn by Render3DCasting as a
//     quad-strip from the ground ring (v=1) to the risen ring (v=0). The arms are
//     tinted blue and blended ADDITIVELY (RenderTeiRect: srcAlpha/ONE), the two
//     sets staggered in start radius/angle so the funnel reads as a living vortex.
//   * orbiting rising sparkles (particle1.spr, PP_3DPARTICLEORBIT): every 10
//     ticks, motes orbiting at radius ~4.5-6 (+/-2.5 deg/tick) drifting upward,
//     also additive.
//
// Coordinate frame: RO authors these in a Y-down local frame around the effect
// origin; this renderer's world is Y-up (terrain stores world_y = -height), so
// "flat on the ground" is the XZ plane at the ground height and RO's downward
// drift (-y) becomes our +Y. Decomp world units map 1:1 to render units (the map
// geometry is the same RO world), so radii/heights are used as-is; PORTAL_SCALE
// is provided only for tuning.
//
// Framerate independence (project rule): the per-portal state advances at the
// engine's fixed ~62.5 Hz game tick, drained from accumulated real dt (clamped
// against stalls), so the animation runs at the same cadence at any render rate.

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { DataFetcher } from "../DataFetcher.js";
import { DecodedImage, decodeTGA } from "./bmp.js";
import { GndMap } from "./gnd.js";
import { GatMap } from "./gat.js";
import { gatCellToWorld, gatCellGroundHeight, gatCellSurfaceHeight } from "./coord.js";
import { parseSPR } from "./spr.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// The game tick: WarpZone2 (like all CEffectPrim effects) advances one step per
// ~60 fps game tick. 1000/60 -> a 16 ms integer period (62.5 ticks/sec).
const SECONDS_PER_TICK = 16.0 / 1000.0;

// Clamp on the dt accumulator so a stall can't burst the tick loop.
const MAX_ACCUM = 0.25;

// Overall portal size multiplier (decomp radii are used 1:1; this is for taste).
const PORTAL_SCALE = 1.0;

// Lift the flat geometry just above the terrain so it reads on top and does not
// z-fight the ground (the decomp nudges the disc 1.5 units; a small lift suffices).
const GROUND_LIFT = 0.6;

// Circle tessellation for the disc (the engine's default m_arcAngle, 36 deg).
const DISC_ARC_DEG = 36;
// Casting-arm tessellation (Render3DCasting's E_DIVISION = 21 points -> 20 segs).
const CONE_DIVISIONS = 21;

// pos(3 f32) + uv(2 f32) + colour(1 u32) = 24 bytes.
const VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 4;
const FLOATS_PER_VERTEX = 6;

const DEG2RAD = Math.PI / 180;

// Spark billboard corner / UV / triangle-index tables, constant across all
// sparks. Hoisted out of emitSpark so we don't allocate them per spark.
const SPARK_CORNER_H = [-1, 1, -1, 1];
const SPARK_CORNER_V = [1, 1, -1, -1];
const SPARK_UV_U = [0, 1, 0, 1];
const SPARK_UV_V = [0, 0, 1, 1];
const SPARK_TRI = [0, 1, 2, 1, 3, 2];

// ---------------------------------------------------------------------------
// Primitive state
// ---------------------------------------------------------------------------

// One casting "arm" (a TeiEffect in m_GI[]): a full ring at radius `distance`
// that collapses inward and rises. `process`/`alphaB` drive the alpha fade-in;
// colour is fixed per casting set.
interface CastArm {
    rotStart: number;   // azimuth offset (deg) where the ring's seam sits
    distance: number;   // current ring radius (collapses 10 -> 0, loops)
    riseAngle: number;  // derived: 90 - distance*9 (deg)
    alphaB: number;     // 0..70
    r: number; g: number; b: number;
}

// One orbiting sparkle (PP_3DPARTICLEORBIT).
interface Spark {
    stateCnt: number;
    duration: number;
    alpha: number;
    fadeOutCnt: number;
    radius: number;
    radiusSpeed: number;
    longitude: number;  // deg around the centre
    longSpeed: number;  // deg/tick
    riseY: number;      // accumulated rise (render +Y)
    riseVel: number;    // rise speed/tick (render +Y)
    riseAccel: number;  // eases the rise
    size: number;       // billboard half-size
}

// The casting-set definitions from WarpZone2 (two PP_3DCASTING_4 prims). Each
// arm's rise_angle is recomputed every tick, so only the start radius/azimuth and
// the set colour matter here. Set A is the lighter-blue outer funnel (m_size 11),
// set B the deeper-blue inner one (m_size 4).
const CAST_SET_A = { r: 170, g: 170, b: 255, arms: [{ rot: 270, dist: 2.5 }, { rot: 0, dist: 5.0 }, { rot: 90, dist: 7.5 }, { rot: 180, dist: 10.0 }] };
const CAST_SET_B = { r: 100, g: 100, b: 255, arms: [{ rot: 271, dist: 2.7 }, { rot: 1, dist: 5.2 }, { rot: 91, dist: 7.7 }, { rot: 181, dist: 10.2 }] };

// A single warp portal: its world centre and the running WarpZone2 state. The
// disc and casting arms are persistent (the engine spawns them once with a
// near-infinite duration and the arms loop internally); only the sparkles come
// and go.
class WarpZone {
    public arms: CastArm[] = [];
    public sparks: Spark[] = [];
    public discAlpha = 0; // ramps 0 -> 128
    private stateCnt = 0;

    constructor(public cx: number, public cy: number, public cz: number, phase: number) {
        for (const set of [CAST_SET_A, CAST_SET_B])
            for (const a of set.arms)
                this.arms.push({ rotStart: a.rot, distance: a.dist, riseAngle: 90 - a.dist * 9, alphaB: 0, r: set.r, g: set.g, b: set.b });
        // Pre-warm to a populated steady state, staggered per portal so a field of
        // warps does not pulse in lockstep.
        const warm = 80 + (phase % 200);
        for (let i = 0; i < warm; i++)
            this.tick();
    }

    public tick(): void {
        // Disc alpha ramps to 128 and holds.
        if (this.discAlpha < 128)
            this.discAlpha = Math.min(128, this.discAlpha + 128 / 10);

        // Casting arms: collapse inward, rise more steeply, fade alpha in to 70.
        for (const a of this.arms) {
            a.distance -= 0.05;
            if (a.distance <= 0) {
                a.distance = 10.0;
                a.alphaB = 0;
            }
            a.riseAngle = 90 - a.distance * 9;
            if (a.alphaB < 70)
                a.alphaB += 1;
        }

        // Spawn an orbiting sparkle every 10 ticks.
        if (this.stateCnt % 10 === 0)
            this.sparks.push(this.makeSpark());
        for (const s of this.sparks)
            this.updateSpark(s);
        this.sparks = this.sparks.filter((s) => s.stateCnt < s.duration && s.alpha > 0.5);

        this.stateCnt++;
    }

    private makeSpark(): Spark {
        const rnd = Math.floor(Math.random() * 200) / 100;
        const duration = 70;
        const roVel = -0.3; // RO -y is up; ported to render +Y below
        return {
            stateCnt: 0, duration,
            alpha: 255, fadeOutCnt: duration - ((duration / 3) | 0),
            radius: 4.5 + rnd * 0.75, radiusSpeed: 0.0005,
            longitude: Math.floor(Math.random() * 360),
            longSpeed: Math.random() < 0.5 ? 2.5 - Math.floor(Math.random() * 11) * 0.1 : -2.5 + Math.floor(Math.random() * 11) * 0.1,
            riseY: 0, riseVel: -roVel, riseAccel: (roVel / duration) / 1.5,
            size: 0.7 + Math.floor(Math.random() * 10) / 10,
        };
    }

    private updateSpark(s: Spark): void {
        // Linear fade-out over the tail (after fadeOutCnt).
        if (s.stateCnt >= s.fadeOutCnt)
            s.alpha = Math.max(0, 255 * (1 - (s.stateCnt - s.fadeOutCnt) / (s.duration - s.fadeOutCnt)));
        s.riseVel += s.riseAccel;
        s.riseY += s.riseVel;
        s.radius += s.radiusSpeed;
        s.longitude += s.longSpeed;
        s.stateCnt++;
    }
}

// ---------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------

class WarpPortalProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Color = 2;
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_Texture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = ${WarpPortalProgram.a_Position}) in vec3 a_Position;
layout(location = ${WarpPortalProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${WarpPortalProgram.a_Color}) in vec4 a_Color;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
}
`;

    public override frag = `
void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord) * v_Color;
}
`;
}

function createRGBATexture(device: GfxDevice, img: DecodedImage): GfxTexture {
    const texture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: img.width, height: img.height,
        depthOrArrayLayers: 1, numLevels: 1,
        dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
    });
    device.uploadTextureData(texture, 0, [img.rgba]);
    return texture;
}

// The decoded textures the portal needs. A missing one disables that layer (the
// portal still renders its other layers).
export interface WarpPortalAssets {
    disc: DecodedImage | null;
    ring: DecodedImage | null;
    spark: DecodedImage | null;
}

// Everything the renderer needs: the shared textures plus one ground anchor per
// warp tile.
export interface WarpPortalSceneData {
    assets: WarpPortalAssets;
    placements: vec3[];
}

// Owns the GPU resources and the per-warp WarpZone2 state. Built once for a map
// with warps; ticked + drawn each frame from the renderer's prepare cycle as a
// transparent pass. Geometry is grouped into three batches (disc, cone, spark) so
// the whole field draws in three textured draws regardless of warp count.
export class WarpPortalRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;

    private discTex: GfxTexture | null = null;
    private ringTex: GfxTexture | null = null;
    private sparkTex: GfxTexture | null = null;

    private zones: WarpZone[] = [];
    private accum = 0;

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;
    private cpuData: ArrayBuffer = new ArrayBuffer(0);
    private cpuF32: Float32Array = new Float32Array(0);
    private cpuU32: Uint32Array = new Uint32Array(0);

    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    // emitCone: per-arm precomputed rings. Sized to CONE_DIVISIONS once at
    // construction so emitCone reuses these instead of allocating five
    // Float32Arrays per arm per zone per frame.
    private coneBX = new Float32Array(CONE_DIVISIONS);
    private coneBZ = new Float32Array(CONE_DIVISIONS);
    private coneTX = new Float32Array(CONE_DIVISIONS);
    private coneTY = new Float32Array(CONE_DIVISIONS);
    private coneTZ = new Float32Array(CONE_DIVISIONS);

    // emitSpark: four-corner billboard scratch reused across sparks.
    private sparkWX = new Float32Array(4);
    private sparkWY = new Float32Array(4);
    private sparkWZ = new Float32Array(4);

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], data: WarpPortalSceneData) {
        this.device = device;
        this.program = cache.createProgram(new WarpPortalProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: WarpPortalProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: WarpPortalProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: WarpPortalProgram.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: null,
        });

        // Smooth gradients, no tiling.
        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        if (data.assets.disc !== null) this.discTex = createRGBATexture(device, data.assets.disc);
        if (data.assets.ring !== null) this.ringTex = createRGBATexture(device, data.assets.ring);
        if (data.assets.spark !== null) this.sparkTex = createRGBATexture(device, data.assets.spark);

        for (let i = 0; i < data.placements.length; i++) {
            const p = data.placements[i];
            this.zones.push(new WarpZone(p[0], p[1] + GROUND_LIFT, p[2], i * 37));
        }
    }

    public get zoneCount(): number {
        return this.zones.length;
    }

    // Advance every portal off real dt and draw the field. Call after the opaque
    // and sprite passes, with the active render-inst list selected.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4, dtSeconds: number): void {
        if (this.zones.length === 0)
            return;

        this.accum += dtSeconds;
        if (this.accum > MAX_ACCUM)
            this.accum = MAX_ACCUM;
        while (this.accum >= SECONDS_PER_TICK) {
            this.accum -= SECONDS_PER_TICK;
            for (const z of this.zones)
                z.tick();
        }

        // Billboard basis for the sparks (camera right flattened to horizontal,
        // world-up leaned toward the camera up — same convention as sprites).
        vec3.set(this.scratchRight, cameraWorldMatrix[0], 0, cameraWorldMatrix[2]);
        if (vec3.len(this.scratchRight) < 1e-5) vec3.set(this.scratchRight, 1, 0, 0);
        else vec3.normalize(this.scratchRight, this.scratchRight);
        const t = 0.5;
        vec3.set(this.scratchUp, t * cameraWorldMatrix[4], (1 - t) + t * cameraWorldMatrix[5], t * cameraWorldMatrix[6]);
        if (vec3.len(this.scratchUp) < 1e-5) vec3.set(this.scratchUp, 0, 1, 0);
        else vec3.normalize(this.scratchUp, this.scratchUp);

        // Count vertices per batch so they can be laid out contiguously.
        const discSectors = Math.round(360 / DISC_ARC_DEG);
        const discVertsPer = discSectors * 6;
        const coneVertsPerArm = (CONE_DIVISIONS - 1) * 6; // 20 segments, 2 tris each
        let discVerts = 0, coneVerts = 0, sparkVerts = 0;
        for (const z of this.zones) {
            if (this.discTex !== null) discVerts += discVertsPer;
            if (this.ringTex !== null) coneVerts += z.arms.length * coneVertsPerArm;
            sparkVerts += z.sparks.length * 6;
        }
        const totalVerts = discVerts + coneVerts + sparkVerts;
        if (totalVerts === 0)
            return;

        if (totalVerts * FLOATS_PER_VERTEX > this.cpuF32.length) {
            this.cpuData = new ArrayBuffer(totalVerts * VERTEX_STRIDE_BYTES);
            this.cpuF32 = new Float32Array(this.cpuData);
            this.cpuU32 = new Uint32Array(this.cpuData);
        }
        const f = this.cpuF32, u = this.cpuU32;

        // Three contiguous regions: [disc | cone | spark]. Disc draws first (under
        // everything), then the additive cones, then the additive sparks on top.
        const discBase = 0;
        const coneBase = discVerts;
        const sparkBase = discVerts + coneVerts;
        let discAt = discBase, coneAt = coneBase, sparkAt = sparkBase;

        for (const z of this.zones) {
            if (this.discTex !== null)
                discAt = this.emitDisc(f, u, discAt, z, discSectors);
            if (this.ringTex !== null)
                for (const arm of z.arms)
                    coneAt = this.emitCone(f, u, coneAt, z, arm);
            for (const s of z.sparks)
                sparkAt = this.emitSpark(f, u, sparkAt, z, s);
        }

        if (totalVerts > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(totalVerts * VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = totalVerts;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.cpuData, 0, totalVerts * VERTEX_STRIDE_BYTES));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        const renderInstManager = renderHelper.renderInstManager;

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // TRANSLUCENT layer: portals are additive overlays drawn after the
        // opaque scene, depth-tested but not depth-writing.
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        let offs = template.allocateUniformBuffer(WarpPortalProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(WarpPortalProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        // Two-sided, transparent (no depth write — a translucent layer must not
        // block later draws). Depth TEST stays at the pipeline default so opaque
        // geometry standing between the camera and the portal (a wall, a column,
        // an indoor floor above the portal's room) occludes it correctly; the
        // portal anchors are lifted onto the walkable surface (GAT heights, not
        // GND) at load time, so the disc sits on top of staircase/platform props.
        template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });

        // Disc is a gradient meant for standard src-alpha over; the cone funnel and
        // the glow sparkles are additive (RenderTeiRect srcAlpha/ONE; the sparkle
        // sprite is a glow mote on a black field).
        this.drawBatch(renderInstManager, this.discTex, discBase, discVerts, false);
        this.drawBatch(renderInstManager, this.ringTex, coneBase, coneVerts, true);
        this.drawBatch(renderInstManager, this.sparkTex, sparkBase, sparkVerts, true);

        renderInstManager.popTemplate();
    }

    private drawBatch(renderInstManager: GfxRenderHelper["renderInstManager"], tex: GfxTexture | null, baseVert: number, vertCount: number, additive: boolean): void {
        if (tex === null || vertCount === 0)
            return;
        const renderInst = renderInstManager.newRenderInst();
        const megaState = renderInst.setMegaStateFlags({});
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: additive ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: tex, gfxSampler: this.sampler }]);
        renderInst.setDrawCount(vertCount, baseVert);
        renderInstManager.submitRenderInst(renderInst);
    }

    // The filled ground disc: a radial quad-strip flat on the XZ plane (the
    // engine's Render3DCircle with PT_FILLCIRCLE -> inner radius 0). v runs 1 at
    // the centre to 0 at the rim, u cycles by 0.25 each sector.
    private emitDisc(f: Float32Array, u: Uint32Array, at: number, z: WarpZone, sectors: number): number {
        const outerR = 15 * PORTAL_SCALE;
        const color = packColor(255, 255, 255, z.discAlpha);
        const cx = z.cx, cy = z.cy, cz = z.cz;
        const arc = 360 / sectors;
        let uInc = 0;
        for (let si = 0; si < sectors; si++) {
            const a1 = si * arc * DEG2RAD, a2 = (si + 1) * arc * DEG2RAD;
            const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
            const ox1 = cx + outerR * c1, oz1 = cz + outerR * s1;
            const ox2 = cx + outerR * c2, oz2 = cz + outerR * s2;
            const u0 = uInc, u1 = uInc + 0.25;
            at = this.vert(f, u, at, cx, cy, cz, u0, 1, color);
            at = this.vert(f, u, at, cx, cy, cz, u1, 1, color);
            at = this.vert(f, u, at, ox1, cy, oz1, u0, 0, color);
            at = this.vert(f, u, at, ox2, cy, oz2, u1, 0, color);
            at = this.vert(f, u, at, ox1, cy, oz1, u0, 0, color);
            at = this.vert(f, u, at, cx, cy, cz, u1, 1, color);
            uInc += 0.25;
            if (uInc >= 1.0) uInc = 0;
        }
        return at;
    }

    // One casting arm (Render3DCasting): a ribbon around a ring of radius
    // `distance`, extruded up-and-outward by `height = distance` at `rise_angle`.
    // Builds the ground ring (v=1) and the risen ring (v=0), then a quad strip
    // between consecutive points. u runs around the circumference.
    private emitCone(f: Float32Array, u: Uint32Array, at: number, z: WarpZone, arm: CastArm): number {
        const N = CONE_DIVISIONS;
        const d = arm.distance * PORTAL_SCALE;
        const ra = arm.riseAngle * DEG2RAD;
        const csR = Math.cos(ra), snR = Math.sin(ra);
        const color = packColor(arm.r, arm.g, arm.b, arm.alphaB);
        const cx = z.cx, cy = z.cy, cz = z.cz;
        const arc = 360 / (N - 1);

        // Precompute the two rings into module-persistent scratch buffers.
        const bx = this.coneBX, bz = this.coneBZ;
        const tx = this.coneTX, ty = this.coneTY, tz = this.coneTZ;
        for (let o = 0; o < N; o++) {
            let angle = o * arc + arm.rotStart;
            if (o === N - 1) angle = arm.rotStart; // close the loop on the seam
            const cs = Math.cos(angle * DEG2RAD), sn = Math.sin(angle * DEG2RAD);
            bx[o] = cx + cs * d; bz[o] = cz + sn * d;
            const rxr = csR * d;        // radial extrusion length
            const ry = snR * d;         // vertical extrusion (render +Y)
            tx[o] = cx + cs * (d + rxr);
            tz[o] = cz + sn * (d + rxr);
            ty[o] = cy + ry * PORTAL_SCALE;
        }

        for (let o = 1; o < N; o++) {
            const tu0 = (o - 1) / N, tu1 = o / N;
            // quad: prevBase(v1), curBase(v1), curTop(v0), prevTop(v0)
            at = this.vert(f, u, at, bx[o - 1], cy, bz[o - 1], tu0, 1, color);
            at = this.vert(f, u, at, bx[o], cy, bz[o], tu1, 1, color);
            at = this.vert(f, u, at, tx[o], ty[o], tz[o], tu1, 0, color);
            at = this.vert(f, u, at, tx[o - 1], ty[o - 1], tz[o - 1], tu0, 0, color);
            at = this.vert(f, u, at, tx[o], ty[o], tz[o], tu1, 0, color);
            at = this.vert(f, u, at, bx[o - 1], cy, bz[o - 1], tu0, 1, color);
        }
        return at;
    }

    // A camera-facing billboard quad for one orbiting spark.
    private emitSpark(f: Float32Array, u: Uint32Array, at: number, z: WarpZone, s: Spark): number {
        const lon = s.longitude * DEG2RAD;
        const r = s.radius * PORTAL_SCALE;
        const cx = z.cx + r * Math.sin(lon);
        const cz = z.cz + r * Math.cos(lon);
        const cy = z.cy + s.riseY * PORTAL_SCALE;
        const sz = s.size * PORTAL_SCALE;
        const rX = this.scratchRight, uP = this.scratchUp;
        const color = packColor(255, 255, 255, s.alpha);
        // Corner offsets / UVs / triangle indices live in module-scope const
        // tables; the per-spark world positions go into persistent scratch.
        const wx = this.sparkWX, wy = this.sparkWY, wz = this.sparkWZ;
        for (let k = 0; k < 4; k++) {
            const ch = SPARK_CORNER_H[k] * sz, cv = SPARK_CORNER_V[k] * sz;
            wx[k] = cx + rX[0] * ch + uP[0] * cv;
            wy[k] = cy + rX[1] * ch + uP[1] * cv;
            wz[k] = cz + rX[2] * ch + uP[2] * cv;
        }
        for (let n = 0; n < 6; n++) {
            const c = SPARK_TRI[n];
            at = this.vert(f, u, at, wx[c], wy[c], wz[c], SPARK_UV_U[c], SPARK_UV_V[c], color);
        }
        return at;
    }

    private vert(f: Float32Array, u: Uint32Array, at: number, x: number, y: number, z: number, tu: number, tv: number, color: number): number {
        const o = at * FLOATS_PER_VERTEX;
        f[o + 0] = x; f[o + 1] = y; f[o + 2] = z;
        f[o + 3] = tu; f[o + 4] = tv;
        u[o + 5] = color;
        return at + 1;
    }

    public destroy(device: GfxDevice): void {
        if (this.discTex !== null) device.destroyTexture(this.discTex);
        if (this.ringTex !== null) device.destroyTexture(this.ringTex);
        if (this.sparkTex !== null) device.destroyTexture(this.sparkTex);
        if (this.vertexBuffer !== null) device.destroyBuffer(this.vertexBuffer);
    }
}

// Pack an RGBA colour (0..255 each) as a little-endian u32 whose bytes read
// [R,G,B,A] for the U8_RGBA_NORM attribute.
function packColor(r: number, g: number, b: number, a: number): number {
    const cl = (v: number) => Math.max(0, Math.min(255, v | 0));
    return ((cl(a) << 24) | (cl(b) << 16) | (cl(g) << 8) | cl(r)) >>> 0;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// The portal's three textures, staged flat under effects/textures/ (the two
// TGAs) and as a sprite under sprite/이팩트/ (particle1). Names match the decomp.
const DISC_TEX = "alpha_down.tga";
const RING_TEX = "ring_blue.tga";
const SPARK_SPR = "particle1.spr";

// Loads the warp-portal textures and places one portal anchor per warp tile
// (grounded on the walkable surface — the GAT heights when available, falling
// back to GND when not, so a warp under a staircase prop sits on the stairs
// rather than sinking through them into the flat ground underneath). Returns
// null when there are no warps or none of the textures load (a partial set
// still renders the layers it has). Failure of any single fetch is tolerated.
export async function loadWarpPortals(
    dataFetcher: DataFetcher,
    pathBase: string,
    warps: { cellX: number, cellY: number }[],
    gnd: GndMap,
    gat: GatMap | null,
): Promise<WarpPortalSceneData | null> {
    if (warps.length === 0)
        return null;

    const tryDecode = async <T>(url: string, decode: (b: import("../ArrayBufferSlice.js").default) => T): Promise<T | null> => {
        try {
            return decode(await dataFetcher.fetchData(url, { allow404: true }));
        } catch {
            return null;
        }
    };

    const disc = await tryDecode(`${pathBase}/effects/textures/${DISC_TEX}`, decodeTGA);
    const ring = await tryDecode(`${pathBase}/effects/textures/${RING_TEX}`, decodeTGA);
    const spark = await tryDecode(`${pathBase}/sprite/이팩트/${SPARK_SPR}`, (b) => {
        const spr = parseSPR(b);
        return spr.rgba.length > 0 ? spr.rgba[0] : null;
    });

    if (disc === null && ring === null && spark === null)
        return null;

    const placements: vec3[] = warps.map((w) => {
        const h = gat !== null ? gatCellSurfaceHeight(gat, w.cellX, w.cellY) : gatCellGroundHeight(gnd, w.cellX, w.cellY);
        const wp = gatCellToWorld(w.cellX, w.cellY, h, gnd.width);
        return vec3.fromValues(wp[0], wp[1], wp[2]);
    });

    return { assets: { disc, ring, spark }, placements };
}
