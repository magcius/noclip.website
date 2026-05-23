
// Camera-relative weather particle field for Ragnarok Online maps (currently
// snow; the per-map table in mapcategory-adjacent scene code can add rain etc.).
//
// RO's snow (CWeather::LaunchSnow -> EF_SNOW) is not a world-placed effect: it is
// a swarm of small flake billboards that spawn in a volume AROUND THE PLAYER,
// drift downward, and are recycled once they fall out of range, so the snowfall
// follows the camera and reads as continuous everywhere on the map. The engine
// spawned flakes in a horizontal ring (radius up to ~300 RO units) above the
// player and let them fall at a fixed per-tick speed.
//
// We reproduce that as a fixed-size pool of flakes orbiting the camera's
// horizontal position: each flake holds an offset from the camera, falls along
// world -Y (render-frame up is +Y; see render.ts cornerWorld, which stores
// world_y = -height), sways gently, and respawns at the top of the volume once it
// drops past the floor. The flakes draw as camera-facing white billboards sampling
// a small soft-round procedural texture.
//
// Framerate independence (project rule): all motion is driven by accumulated real
// dt in seconds, scaled to per-second rates derived from the engine's per-tick
// values (the original advanced one step per ~60fps game tick). The dt accumulator
// is clamped so a stall cannot teleport the whole field.

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";

// ---------------------------------------------------------------------------
// Tunables (maintainer-facing). The originals are per-game-tick at ~60fps; the
// per-second rates below are those values * 62.5 ticks/sec where noted, then
// rounded to a value that reads well from the wide free-fly camera.
// ---------------------------------------------------------------------------

export interface WeatherParams {
    // Number of flakes kept alive at once. The engine spawned 2 per tick over a
    // 320-tick lifetime (~640 live), but spread over its whole 300-unit volume; a
    // few hundred reads as a steady snowfall in the viewer without flooding it.
    count: number;
    // Horizontal half-extent of the spawn/recycle volume around the camera, in
    // world units (the engine used a ~300-unit spawn radius around the player).
    radius: number;
    // Vertical extent of the volume: flakes live between (camY - floor) and
    // (camY + ceiling); a flake that falls below the floor respawns at the top.
    ceiling: number;
    floor: number;
    // Downward fall speed in world units/second. The engine fell at m_speed=0.5
    // units/tick (~31 u/s); a touch faster reads better at viewer scale.
    fallSpeed: number;
    // Random +/- fraction applied per flake to fallSpeed so they don't fall in
    // lockstep.
    fallSpeedJitter: number;
    // Horizontal sway: peak drift speed (u/s) and how fast the sway phase cycles
    // (radians/sec). Gives each flake a gentle wandering path.
    swaySpeed: number;
    swayRate: number;
    // Flake billboard half-size in world units.
    size: number;
    // Flake size random +/- fraction.
    sizeJitter: number;
}

// The default snow profile.
export const SNOW_PARAMS: WeatherParams = {
    count: 700,
    radius: 320,
    ceiling: 220,
    floor: 140,
    fallSpeed: 36,
    fallSpeedJitter: 0.35,
    swaySpeed: 8,
    swayRate: 1.2,
    size: 2.4,
    sizeJitter: 0.4,
};

// Clamp on the dt accumulator (seconds): a long stall advances at most this much
// so the field eases back in rather than jumping.
const MAX_DT = 0.25;

// 3 floats world pos + 2 floats corner uv = 20 bytes. Color is constant (white)
// so it lives in the shader, not per-vertex.
const FLAKE_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const FLAKE_FLOATS_PER_VERTEX = 5;

interface Flake {
    // Offset from the camera's horizontal position; y is absolute world height.
    ox: number;
    oy: number;
    oz: number;
    fallSpeed: number;
    size: number;
    swayPhase: number;   // current sway phase (radians)
    swayRate: number;    // phase advance rate (radians/sec)
    swayAmpX: number;    // sway direction weights so flakes drift differently
    swayAmpZ: number;
}

// A tiny deterministic PRNG so the field is reproducible across reloads (the look
// is identical, only the seed differs the layout). Mulberry32.
function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Builds a small soft-round RGBA texture (constant RGB, radial alpha falloff)
// for camera-facing billboards: weather flakes get white, shadows get black.
// 16x16 is plenty for a small billboard. Exported so shadow.ts shares the same
// procedural generator.
export function makeSoftDiscImage(r: number, g: number, b: number): { width: number, height: number, rgba: Uint8Array } {
    const N = 16;
    const rgba = new Uint8Array(N * N * 4);
    const c = (N - 1) / 2;
    const rMax = c;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const dx = x - c, dy = y - c;
            const d = Math.sqrt(dx * dx + dy * dy) / rMax;
            // Smooth falloff: full at center, 0 at the edge, with a soft shoulder.
            let a = 1.0 - d;
            a = Math.max(0, a);
            a = a * a * (3 - 2 * a); // smoothstep
            const o = (y * N + x) * 4;
            rgba[o + 0] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
            rgba[o + 3] = Math.round(a * 255);
        }
    }
    return { width: N, height: N, rgba };
}

// Shader for the flake billboards: world-space vertices projected by the scene
// matrix, fragment samples the soft-round texture; constant white tint. Alpha
// blended (no cutout) so the soft edge stays soft.
class WeatherProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_FlakeTexture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${WeatherProgram.a_Position}) in vec3 a_Position;
layout(location = ${WeatherProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
void main() {
    float t_A = texture(SAMPLER_2D(u_FlakeTexture), v_TexCoord).a;
    gl_FragColor = vec4(1.0, 1.0, 1.0, t_A);
}
`;
}

// Owns the flake pool + GPU resources for the weather pass. Built once by the
// renderer for maps that have a weather entry; advanced + drawn each frame from
// inside the renderer's prepare cycle as a transparent billboard layer.
export class WeatherRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private texture: GfxTexture;

    private params: WeatherParams;
    private flakes: Flake[] = [];
    private rng: () => number;

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;
    private cpuData: ArrayBuffer;
    private cpuF32: Float32Array;

    private accum = 0;

    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], params: WeatherParams) {
        this.device = device;
        this.params = params;
        this.rng = makeRng(0x5e1ec7ed);
        this.program = cache.createProgram(new WeatherProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: WeatherProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: WeatherProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: FLAKE_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
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

        for (let i = 0; i < this.params.count; i++)
            this.flakes.push(this.newFlake(true));

        const verts = this.params.count * 6;
        this.cpuData = new ArrayBuffer(verts * FLAKE_VERTEX_STRIDE_BYTES);
        this.cpuF32 = new Float32Array(this.cpuData);
    }

    // Creates a flake. When `initial`, the height is randomized across the whole
    // volume (so the field starts already snowing); otherwise it spawns at the
    // top, ready to fall (used on recycle). `oy` is a camera-relative height
    // offset throughout (world height is camY + oy), so the field follows the
    // camera vertically as well as horizontally.
    private newFlake(initial: boolean): Flake {
        const p = this.params;
        const r = this.rng;
        // Uniform-ish disc placement: a random point in the square volume (the
        // few corner flakes outside the camera frustum cost nothing and keep the
        // field even when the camera turns).
        const ox = (r() * 2 - 1) * p.radius;
        const oz = (r() * 2 - 1) * p.radius;
        const fall = p.fallSpeed * (1 + (r() * 2 - 1) * p.fallSpeedJitter);
        const size = p.size * (1 + (r() * 2 - 1) * p.sizeJitter);
        // Sway: a per-flake phase, rate and 2D direction so flakes drift apart.
        const swayPhase = r() * Math.PI * 2;
        const swayRate = p.swayRate * (0.6 + r() * 0.8);
        const ang = r() * Math.PI * 2;
        // oy filled by seedHeights / recycle; placeholder relative height here.
        const oy = initial ? (r() * (p.ceiling + p.floor) - p.floor) : p.ceiling;
        return {
            ox, oy, oz,
            fallSpeed: fall, size,
            swayPhase, swayRate,
            swayAmpX: Math.cos(ang), swayAmpZ: Math.sin(ang),
        };
    }

    // Advances the field off real dt and draws it. `camWorld` supplies the camera
    // basis (for the billboard plane) and position (the field follows it).
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4, dtSeconds: number): void {
        const p = this.params;
        const camX = cameraWorldMatrix[12], camY = cameraWorldMatrix[13], camZ = cameraWorldMatrix[14];

        // Billboard basis: camera right flattened to horizontal, world-up leaned
        // toward the camera up — same convention as the sprite/effect passes so
        // the flakes face the camera consistently.
        vec3.set(this.scratchRight, cameraWorldMatrix[0], 0, cameraWorldMatrix[2]);
        if (vec3.len(this.scratchRight) < 1e-5)
            vec3.set(this.scratchRight, 1, 0, 0);
        else
            vec3.normalize(this.scratchRight, this.scratchRight);
        // Flakes are small round dots; a near-camera-facing up keeps them round
        // from any pitch. Lean world-up toward camera-up by 0.5 (like sprites).
        const t = 0.5;
        vec3.set(this.scratchUp, t * cameraWorldMatrix[4], (1 - t) + t * cameraWorldMatrix[5], t * cameraWorldMatrix[6]);
        if (vec3.len(this.scratchUp) < 1e-5)
            vec3.set(this.scratchUp, 0, 1, 0);
        else
            vec3.normalize(this.scratchUp, this.scratchUp);

        // Advance off accumulated dt (clamped against a stall). The motion is
        // continuous (not stepped) since it's pure linear fall + smooth sway, so
        // a single dt-scaled update is exact and framerate independent.
        this.accum += dtSeconds;
        if (this.accum > MAX_DT)
            this.accum = MAX_DT;
        const dt = this.accum;
        this.accum = 0;

        // All three axes are camera-relative: ox/oz are offsets from the camera's
        // horizontal position and oy is an offset from the camera's height, so the
        // whole [camY - floor, camY + ceiling] band rides with the camera and the
        // field never empties when you fly up or down. Flakes fall through the
        // band (oy decreases) and recycle to the top once past the floor.
        for (const f of this.flakes) {
            f.oy -= f.fallSpeed * dt;
            f.swayPhase += f.swayRate * dt;
            // Recycle a flake that fell past the floor, or wandered too far
            // horizontally from the camera, back to the top of the volume.
            if (f.oy < -p.floor || Math.abs(f.ox) > p.radius * 1.2 || Math.abs(f.oz) > p.radius * 1.2) {
                const nf = this.newFlake(false);
                f.ox = nf.ox; f.oz = nf.oz;
                f.fallSpeed = nf.fallSpeed; f.size = nf.size;
                f.swayPhase = nf.swayPhase; f.swayRate = nf.swayRate;
                f.swayAmpX = nf.swayAmpX; f.swayAmpZ = nf.swayAmpZ;
                f.oy = p.ceiling;
            }
        }

        // Build billboard quads. Each flake is a small square in the camera-facing
        // plane centered at (camX+ox+sway, oy, camZ+oz+sway).
        const f32 = this.cpuF32;
        const rX = this.scratchRight, uP = this.scratchUp;
        let vi = 0;
        for (const f of this.flakes) {
            const sway = Math.sin(f.swayPhase) * p.swaySpeed * f.swayRate;
            const cx = camX + f.ox + f.swayAmpX * sway;
            const cz = camZ + f.oz + f.swayAmpZ * sway;
            const cy = camY + f.oy;
            const s = f.size;

            // Four corners: (-s,+s) TL, (+s,+s) TR, (-s,-s) BL, (+s,-s) BR in the
            // (right, up) plane.
            const cornerH = [-s, s, -s, s];
            const cornerV = [s, s, -s, -s];
            const wx = [0, 0, 0, 0], wy = [0, 0, 0, 0], wz = [0, 0, 0, 0];
            for (let k = 0; k < 4; k++) {
                wx[k] = cx + rX[0] * cornerH[k] + uP[0] * cornerV[k];
                wy[k] = cy + rX[1] * cornerH[k] + uP[1] * cornerV[k];
                wz[k] = cz + rX[2] * cornerH[k] + uP[2] * cornerV[k];
            }
            // UVs: TL(0,0) TR(1,0) BL(0,1) BR(1,1).
            const uu = [0, 1, 0, 1];
            const vv = [0, 0, 1, 1];
            // Two triangles: (TL,TR,BL) and (TR,BR,BL).
            const tri = [0, 1, 2, 1, 3, 2];
            for (let n = 0; n < 6; n++) {
                const c = tri[n];
                const o = vi * FLAKE_FLOATS_PER_VERTEX;
                f32[o + 0] = wx[c];
                f32[o + 1] = wy[c];
                f32[o + 2] = wz[c];
                f32[o + 3] = uu[c];
                f32[o + 4] = vv[c];
                vi++;
            }
        }

        const vertexCount = vi;
        if (vertexCount === 0)
            return;

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * FLAKE_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.cpuData, 0, vertexCount * FLAKE_VERTEX_STRIDE_BYTES));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // TRANSLUCENT: a camera-relative billboard field drawn after the opaque
        // scene; depth-tested but not depth-writing.
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        let offs = template.allocateUniformBuffer(WeatherProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(WeatherProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        // Two-sided, depth-tested (occluded by closer geometry) but no depth write
        // — flakes never block the scene or each other. Standard src-alpha over
        // blend for the soft round look.
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
