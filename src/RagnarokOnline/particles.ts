
// Per-map particle emitters: chimney smoke, dust motes, ambient sparkles, etc.
//
// Source: each map's compiled effecttool LUB
// (`data\luafiles514\lua files\effecttool\<mapId>.lub`). At extract time the
// patched Lua 5.1 binary runs each LUB to populate its `_<mapId>_emitterInfo`
// table, which we serialize to `<mapId>.emitters.json` next to the .rsw. See
// `tools/extract-emitters.ts` for the offline pipeline.
//
// Runtime (this file): on map load we fetch the JSON, decode each emitter's
// referenced texture (effect/<name>.bmp/.tga, magic-pink keyed by bmp.ts),
// transform emitter positions into the renderer's frame, and own a particle
// pool per emitter. Each frame we:
//   - spawn new particles at the per-emitter `rate` until the pool reaches
//     `maxcount`,
//   - integrate each live particle (velocity += gravity * dt; pos += velocity
//     * dt; age += dt) and kill at `life`,
//   - build a vertex buffer of camera-facing billboard quads and submit one
//     draw per emitter (so each emitter keeps its own srcmode/destmode/color).
//
// Coordinate conversion mirrors loadEffectSources in entity.ts: the RSW frame
// is left-handed and Y-down, the render frame is Y-up + X-mirrored about the
// map centre and Z-shifted by half the map extent. For positions:
//   render = [mapOffX - x, -y, z + mapOffZ]
// For velocity/gravity (no offset, only axis flips):
//   render = [-x, -y, z]
//
// Render ordering: the pass runs as a translucent overlay AFTER the opaque
// terrain/props/water but BEFORE the sprite/warp/weather passes — depth-tested
// so a wall in front of a chimney occludes its smoke, but no depth write so
// the next transparent layer (sprites) draws over the particles. Per-emitter
// blend mode is driven by srcmode/destmode (D3DBLEND ids), translated to GL
// blend factors with the same table effect.ts uses for .str layers.

import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DataFetcher } from "../DataFetcher.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { decodeBMP, decodeTGA, DecodedImage } from "./bmp.js";

// ---------------------------------------------------------------------------
// JSON schema and resolved/render-side types.
// ---------------------------------------------------------------------------

interface RawEmitterSpec {
    pos: [number, number, number];
    radius: [number, number, number];
    dir1: [number, number, number];
    dir2: [number, number, number];
    gravity: [number, number, number];
    color: [number, number, number, number];
    rate: [number, number];
    size: [number, number];
    life: [number, number];
    speed: [number];
    srcmode: [number];
    destmode: [number];
    maxcount: [number];
    zenable: [number];
    texture: string;  // CP949 path like "effect\\smoke1.bmp"
}

interface RawEmitterDoc {
    version: number;
    emitters: RawEmitterSpec[];
}

// A particle alive this frame. The pool is per-emitter and indexed; dead
// slots are kept in `freeList` for O(1) reuse so we don't churn allocations.
interface Particle {
    posX: number; posY: number; posZ: number;
    velX: number; velY: number; velZ: number;
    age: number;       // seconds since spawn
    lifeEnd: number;   // age at which to kill
    size: number;
    alive: boolean;
}

// An emitter, resolved to the render frame and bound to its decoded texture.
// Per-emitter state is the particle pool, a spawn-time accumulator (carry the
// fractional particles owed each frame), and per-frame deterministic state
// folded into the particle update.
interface ResolvedEmitter {
    // Spec values, mostly passed straight through but with render-frame
    // velocity/gravity (axis-flipped) and render-frame position.
    posX: number; posY: number; posZ: number;
    radiusX: number; radiusY: number; radiusZ: number;
    dir1X: number; dir1Y: number; dir1Z: number;
    dir2X: number; dir2Y: number; dir2Z: number;
    gravityX: number; gravityY: number; gravityZ: number;
    rateMin: number; rateMax: number;
    sizeMin: number; sizeMax: number;
    lifeMin: number; lifeMax: number;
    speed: number;
    color: [number, number, number, number];  // 0..255 (matches RO)
    srcmode: number; destmode: number;
    maxcount: number;
    zenable: boolean;

    textureName: string;
    texture: GfxTexture | null;  // resolved when scene wires it

    particles: Particle[];
    freeList: number[];          // indices of dead slots in `particles`
    spawnAccumulator: number;    // fractional particles owed
}

// What the scene loader passes to the renderer at construction time. The
// images are kept separate from the emitter list because multiple emitters
// can share a texture and we want to upload each GPU texture once.
export interface ParticleSceneData {
    emitters: ResolvedEmitter[];
    images: Map<string, DecodedImage>;
}

// ---------------------------------------------------------------------------
// Scene loader: fetch JSON, decode textures, transform to render frame.
// ---------------------------------------------------------------------------

// Translate the RO D3DBLEND ids the emitter spec carries into the engine's
// GfxBlendFactor. 9 (DESTCOLOR) is RO's hack for "multiply into the
// framebuffer", 7 (DESTALPHA) is treated additively the way the reference
// renderer does for typical emissive effects.
function gfxBlend(d3dBlend: number): GfxBlendFactor {
    switch (d3dBlend) {
    case 1: return GfxBlendFactor.Zero;
    case 2: return GfxBlendFactor.One;
    case 3: return GfxBlendFactor.Src;
    case 4: return GfxBlendFactor.OneMinusSrc;
    case 5: return GfxBlendFactor.SrcAlpha;
    case 6: return GfxBlendFactor.OneMinusSrcAlpha;
    case 7: return GfxBlendFactor.One;  // DESTALPHA -> additive
    case 8: return GfxBlendFactor.OneMinusDstAlpha;
    case 9: return GfxBlendFactor.Dst;             // DESTCOLOR
    case 10: return GfxBlendFactor.OneMinusDst;    // INVDESTCOLOR (screen-blend dust)
    case 11: return GfxBlendFactor.SrcAlpha;       // SRCALPHASAT (~clamped; fall back)
    default: return GfxBlendFactor.SrcAlpha;
    }
}

// Decode a texture file by extension. Effect particles are either .bmp
// (magic-pink keyed) or .tga (true alpha). Other extensions are unsupported.
function decodeImage(name: string, slice: ArrayBufferSlice): DecodedImage | null {
    const ext = name.toLowerCase().split(".").pop() ?? "";
    try {
        if (ext === "bmp") return decodeBMP(slice);
        if (ext === "tga") return decodeTGA(slice);
        return null;
    } catch {
        return null;
    }
}

// Fetch and decode an effect texture. Returns null on any failure (404,
// unsupported format, decode error). Failure is logged and the emitter that
// referenced it falls out of the scene.
async function loadParticleTexture(
    dataFetcher: DataFetcher, pathBase: string, name: string,
): Promise<DecodedImage | null> {
    const safe = name.toLowerCase();
    try {
        const data = await dataFetcher.fetchData(`${pathBase}/textures/effect/${safe}`, { allow404: true });
        return decodeImage(safe, data);
    } catch {
        return null;
    }
}

// Fetch <mapId>.emitters.json, decode textures, return ResolvedEmitter[]
// already in the render frame. Texture decoding runs in parallel for all
// uniquely-referenced textures. Emitters whose texture fails to decode are
// dropped. mapOffX/mapOffZ come from the same caller that builds the entity
// world positions (scenes.ts), so emitter positions sit in the same world.
//
// Returns null if the map has no emitters JSON at all (most maps don't).
export async function loadParticles(
    dataFetcher: DataFetcher, pathBase: string, mapId: string,
    mapOffX: number, mapOffZ: number,
): Promise<ParticleSceneData | null> {
    let raw: RawEmitterDoc | null = null;
    try {
        const data = await dataFetcher.fetchData(`${pathBase}/maps/${mapId}.emitters.json`, { allow404: true });
        const text = new TextDecoder().decode(data.createTypedArray(Uint8Array));
        raw = JSON.parse(text) as RawEmitterDoc;
    } catch {
        return null;
    }
    if (raw === null || !Array.isArray(raw.emitters) || raw.emitters.length === 0)
        return null;

    // Pre-fetch every uniquely-referenced texture in parallel; an emitter
    // that doesn't get a decoded image is dropped.
    const wanted = new Set<string>();
    for (const e of raw.emitters) {
        const name = (e.texture ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
        if (name !== "")
            wanted.add(name);
    }
    const names = Array.from(wanted);
    const decoded = await Promise.all(names.map((n) => loadParticleTexture(dataFetcher, pathBase, n)));
    const images = new Map<string, DecodedImage>();
    for (let i = 0; i < names.length; i++)
        if (decoded[i] !== null)
            images.set(names[i], decoded[i]!);

    const out: ResolvedEmitter[] = [];
    for (const e of raw.emitters) {
        const name = (e.texture ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
        if (name === "" || !images.has(name))
            continue;
        // Render-frame conversion: same recipe as loadEffectSources.
        const rPos: [number, number, number] = [mapOffX - e.pos[0], -e.pos[1], e.pos[2] + mapOffZ];
        // For velocity/gravity the axis flips apply but not the offsets.
        const flipX = (v: [number, number, number]): [number, number, number] => [-v[0], -v[1], v[2]];
        const dir1 = flipX(e.dir1);
        const dir2 = flipX(e.dir2);
        const grav = flipX(e.gravity);

        const maxcount = Math.max(1, Math.floor(e.maxcount?.[0] ?? 1));
        const particles: Particle[] = new Array(maxcount);
        for (let i = 0; i < maxcount; i++)
            particles[i] = { posX: 0, posY: 0, posZ: 0, velX: 0, velY: 0, velZ: 0, age: 0, lifeEnd: 0, size: 0, alive: false };

        out.push({
            posX: rPos[0], posY: rPos[1], posZ: rPos[2],
            radiusX: Math.abs(e.radius[0]), radiusY: Math.abs(e.radius[1]), radiusZ: Math.abs(e.radius[2]),
            dir1X: dir1[0], dir1Y: dir1[1], dir1Z: dir1[2],
            dir2X: dir2[0], dir2Y: dir2[1], dir2Z: dir2[2],
            gravityX: grav[0], gravityY: grav[1], gravityZ: grav[2],
            rateMin: e.rate[0], rateMax: e.rate[1],
            sizeMin: e.size[0], sizeMax: e.size[1],
            lifeMin: e.life[0], lifeMax: e.life[1],
            speed: e.speed?.[0] ?? 1,
            color: [e.color[0], e.color[1], e.color[2], e.color[3]],
            srcmode: e.srcmode?.[0] ?? 5,
            destmode: e.destmode?.[0] ?? 6,
            maxcount,
            zenable: (e.zenable?.[0] ?? 1) !== 0,
            textureName: name,
            texture: null,  // wired by the renderer at setup
            particles,
            freeList: [],
            spawnAccumulator: 0,
        });
    }

    return out.length > 0 ? { emitters: out, images } : null;
}

// ---------------------------------------------------------------------------
// GPU pipeline.
// ---------------------------------------------------------------------------

// Vertex layout: world pos (3 floats), per-particle offset (2 floats in
// camera-aligned billboard local), uv (2 floats). 7 floats * 4 bytes = 28.
const PARTICLE_VERTEX_STRIDE_BYTES = 7 * 4;
const PARTICLE_FLOATS_PER_VERTEX = 7;

class ParticleProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Offset = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_CamRight;  // xyz: render-frame camera right (world axis)
    vec4 u_CamUp;     // xyz: render-frame camera up    (world axis)
};

layout(std140) uniform ub_DrawParams {
    vec4 u_Color;     // rgba 0..1 (uniform tint, multiplied by texel)
};

uniform sampler2D u_Texture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${ParticleProgram.a_Position}) in vec3 a_Position;
layout(location = ${ParticleProgram.a_Offset}) in vec2 a_Offset;
layout(location = ${ParticleProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    // Billboard the particle: anchor at world a_Position, offset by
    // (a_Offset.x * camRight + a_Offset.y * camUp). Camera axes come in as
    // unit vectors; the offset is already scaled by the particle's half-size
    // on the CPU.
    vec3 t_World = a_Position
                 + u_CamRight.xyz * a_Offset.x
                 + u_CamUp.xyz    * a_Offset.y;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_World, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = t_Tex * u_Color;
}
`;
}

// Owns the particle pipeline + per-emitter GPU resources (one texture per
// emitter) + the transient per-frame vertex buffer. Called from inside the
// terrain renderer's prepare cycle after the opaque pass and before sprites.
export class ParticleRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;

    private emitters: ResolvedEmitter[];

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], data: ParticleSceneData) {
        this.device = device;
        this.program = cache.createProgram(new ParticleProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: ParticleProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: ParticleProgram.a_Offset, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: ParticleProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 5 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: PARTICLE_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
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

        // Upload one GPU texture per unique decoded image. We index by name
        // so emitters sharing a texture (e.g. all of prontera's chimneys use
        // smoke1.bmp) share the same GPU resource.
        const gpuByName = new Map<string, GfxTexture>();
        for (const [name, img] of data.images.entries()) {
            const tex = device.createTexture({
                pixelFormat: GfxFormat.U8_RGBA_NORM,
                width: img.width, height: img.height,
                depthOrArrayLayers: 1, numLevels: 1,
                dimension: GfxTextureDimension.n2D, usage: GfxTextureUsage.Sampled,
            });
            device.uploadTextureData(tex, 0, [img.rgba]);
            gpuByName.set(name, tex);
        }

        this.emitters = data.emitters;
        for (const e of this.emitters)
            e.texture = gpuByName.get(e.textureName) ?? null;
    }

    // Cheap uniform random in [a, b]. Used at spawn time for jittered initial
    // velocity, size, life, and spawn-radius offsets. The original engine
    // uses rand() with the same uniform distribution; we don't bother
    // matching its seeding because none of these effects observe particle
    // identity across frames.
    private rand(a: number, b: number): number {
        return a + (b - a) * Math.random();
    }

    // Spawn one particle into the given emitter's pool (overwriting a free
    // slot, or growing in the rare case both maxcount=cap and all live).
    // Initial position jitters within `radius` around the emitter; initial
    // velocity is uniform inside the box [dir1, dir2] times `speed`.
    private spawnOne(e: ResolvedEmitter): void {
        let idx: number;
        if (e.freeList.length > 0) {
            idx = e.freeList.pop()!;
        } else {
            // All slots live (we hit maxcount). The original engine drops
            // the spawn; we do too.
            return;
        }
        const p = e.particles[idx];
        p.posX = e.posX + this.rand(-e.radiusX, e.radiusX);
        p.posY = e.posY + this.rand(-e.radiusY, e.radiusY);
        p.posZ = e.posZ + this.rand(-e.radiusZ, e.radiusZ);
        p.velX = this.rand(e.dir1X, e.dir2X) * e.speed;
        p.velY = this.rand(e.dir1Y, e.dir2Y) * e.speed;
        p.velZ = this.rand(e.dir1Z, e.dir2Z) * e.speed;
        // RO's dir bounds are an authored velocity in world units per "tick"
        // when speed=0 (the smoke just rises by the gravity component); we
        // honour that by always adding the dir-bounded base, then scaling by
        // (1 + speed) so speed=0 still gives motion. The (1 + speed) shape
        // matches what RO does in practice (its CParticleSystem applies the
        // dir as a base velocity then a separate speed multiplier).
        if (e.speed === 0) {
            p.velX = this.rand(e.dir1X, e.dir2X);
            p.velY = this.rand(e.dir1Y, e.dir2Y);
            p.velZ = this.rand(e.dir1Z, e.dir2Z);
        }
        p.age = 0;
        p.lifeEnd = this.rand(e.lifeMin, e.lifeMax);
        p.size = this.rand(e.sizeMin, e.sizeMax);
        p.alive = true;
    }

    // Advance every emitter by dt seconds: spawn pending particles, integrate
    // live ones, kill expired. Called once per render frame BEFORE building
    // the GPU buffer; safe to call on a frame the renderer skips drawing.
    public update(dt: number): void {
        if (dt <= 0) return;
        // Clamp dt to avoid spawning a flood after a long pause (tab in the
        // background, breakpoint, etc.). 0.1s ~= 6 frames at 60fps.
        const dtc = Math.min(dt, 0.1);
        for (const e of this.emitters) {
            // Spawn budget for the frame: a uniform random rate in [rateMin,
            // rateMax] particles/sec, integrated over dtc. Fractional debt
            // carries to the next frame so we never lose throughput at low
            // dt and never over-spawn at high dt.
            const rate = this.rand(e.rateMin, e.rateMax);
            e.spawnAccumulator += rate * dtc;
            // Initialise the free list lazily — `freeList` empty at start
            // means we treat every slot as free (alive=false).
            if (e.freeList.length === 0) {
                let allDead = true;
                for (const p of e.particles) if (p.alive) { allDead = false; break; }
                if (allDead) {
                    e.freeList.length = 0;
                    for (let i = e.particles.length - 1; i >= 0; i--)
                        e.freeList.push(i);
                }
            }
            while (e.spawnAccumulator >= 1) {
                e.spawnAccumulator -= 1;
                this.spawnOne(e);
            }
            // Integrate + kill.
            for (let i = 0; i < e.particles.length; i++) {
                const p = e.particles[i];
                if (!p.alive) continue;
                p.velX += e.gravityX * dtc;
                p.velY += e.gravityY * dtc;
                p.velZ += e.gravityZ * dtc;
                p.posX += p.velX * dtc;
                p.posY += p.velY * dtc;
                p.posZ += p.velZ * dtc;
                p.age += dtc;
                if (p.age >= p.lifeEnd) {
                    p.alive = false;
                    e.freeList.push(i);
                }
            }
        }
    }

    // Count live particles across all emitters (used to size the per-frame VB
    // once instead of growing it ad-hoc).
    private countLive(): number {
        let n = 0;
        for (const e of this.emitters)
            for (const p of e.particles) if (p.alive) n++;
        return n;
    }

    // Submit one draw per emitter that has live particles. Caller passes the
    // current frame's clipFromWorld + camera basis (right/up in the render
    // frame) so the vertex shader can billboard each particle without an
    // inverse-view computation.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, camRight: vec3, camUp: vec3): void {
        const totalLive = this.countLive();
        if (totalLive === 0) return;

        // 6 vertices per particle (two triangles).
        const vertexCount = totalLive * 6;
        const data = new ArrayBuffer(vertexCount * PARTICLE_VERTEX_STRIDE_BYTES);
        const f32 = new Float32Array(data);

        // Per-emitter ranges into the buffer so each emitter's draw covers
        // only its own particles. `ranges[i]` = [startVertex, count].
        const ranges: { start: number, count: number, emitter: ResolvedEmitter }[] = [];

        let vi = 0;
        for (const e of this.emitters) {
            const startV = vi;
            for (const p of e.particles) {
                if (!p.alive) continue;
                const hx = p.size * 0.5;
                const hy = p.size * 0.5;
                // Two triangles, six verts, on the camera-aligned plane.
                // Offsets are in world units (camera basis is unit-length).
                const cx = [-hx, hx, -hx, hx, -hx, hx];
                const cy = [-hy, -hy, hy, -hy, hy, hy];
                const uu = [0, 1, 0, 1, 0, 1];
                const vv = [1, 1, 0, 1, 0, 0];
                // Note: V flipped because BMP decoder writes top-down RGBA
                // but particle UV (0,0) reads as top-left on most decoders;
                // flipping V here means uv (0,0) maps to the texture's
                // bottom-left, which is RO's authoring convention for
                // billboard quads.
                const tri = [0, 1, 2, 3, 5, 4];
                for (let n = 0; n < 6; n++) {
                    const c = tri[n];
                    const o = vi * PARTICLE_FLOATS_PER_VERTEX;
                    f32[o + 0] = p.posX;
                    f32[o + 1] = p.posY;
                    f32[o + 2] = p.posZ;
                    f32[o + 3] = cx[c];
                    f32[o + 4] = cy[c];
                    f32[o + 5] = uu[c];
                    f32[o + 6] = vv[c];
                    vi++;
                }
            }
            const count = vi - startV;
            if (count > 0)
                ranges.push({ start: startV, count, emitter: e });
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * PARTICLE_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(data));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // TRANSLUCENT layer so particles draw after the opaque sprites/labels
        // and depth-test correctly against the depth they wrote.
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        // Scene-level uniforms (shared across all emitters this frame).
        let sceneOffs = template.allocateUniformBuffer(ParticleProgram.ub_SceneParams, 16 + 2 * 4);
        const sceneMapped = template.mapUniformBufferF32(ParticleProgram.ub_SceneParams);
        sceneOffs += fillMatrix4x4(sceneMapped, sceneOffs, clipFromWorld);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, camRight[0], camRight[1], camRight[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, camUp[0], camUp[1], camUp[2], 0);

        // One draw per emitter — different srcmode/destmode/colour/texture. The
        // megastate is set on the renderInst, NOT the template, so each draw
        // gets its own blend mode (the template-level setMegaStateFlags would
        // mutate one shared block and every draw would end up with the last
        // emitter's blend). See warp-portal.ts:drawBatch for the same pattern.
        for (const r of ranges) {
            const e = r.emitter;
            if (e.texture === null) continue;

            const renderInst = renderInstManager.newRenderInst();
            const megaState = renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
            setAttachmentStateSimple(megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: gfxBlend(e.srcmode),
                blendDstFactor: gfxBlend(e.destmode),
            });
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: e.texture, gfxSampler: this.sampler }]);
            let drawOffs = renderInst.allocateUniformBuffer(ParticleProgram.ub_DrawParams, 4);
            const drawMapped = renderInst.mapUniformBufferF32(ParticleProgram.ub_DrawParams);
            drawOffs += fillVec4(drawMapped, drawOffs,
                e.color[0] / 255, e.color[1] / 255, e.color[2] / 255, e.color[3] / 255);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        // GPU textures: we created them in the ctor; we own them.
        const seen = new Set<GfxTexture>();
        for (const e of this.emitters) {
            if (e.texture !== null && !seen.has(e.texture)) {
                seen.add(e.texture);
                device.destroyTexture(e.texture);
            }
        }
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
