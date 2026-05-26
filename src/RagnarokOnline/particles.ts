import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { DataFetcher } from "../DataFetcher.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { decodeBMP, decodeTGA, DecodedImage } from "./bmp.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";

interface RawEmitterSpec {
    pos: vec3;
    radius: vec3;
    dir1: vec3;
    dir2: vec3;
    gravity: vec3;
    color: [number, number, number, number];
    rate: [number, number];
    size: [number, number];
    life: [number, number];
    speed: [number];
    srcmode: [number];
    destmode: [number];
    maxcount: [number];
    zenable: [number];
    texture: string;
}

interface RawEmitterDoc {
    version: number;
    emitters: RawEmitterSpec[];
}

interface Particle {
    posX: number; posY: number; posZ: number;
    velX: number; velY: number; velZ: number;
    age: number;
    lifeEnd: number;
    size: number;
    alive: boolean;
}

interface ResolvedEmitter {
    posX: number; posY: number; posZ: number;
    radiusX: number; radiusY: number; radiusZ: number;
    dir1X: number; dir1Y: number; dir1Z: number;
    dir2X: number; dir2Y: number; dir2Z: number;
    gravityX: number; gravityY: number; gravityZ: number;
    rateMin: number; rateMax: number;
    sizeMin: number; sizeMax: number;
    lifeMin: number; lifeMax: number;
    speed: number;
    color: Color;
    srcmode: number; destmode: number;
    maxcount: number;
    zenable: boolean;

    textureName: string;
    texture: GfxTexture | null;

    particles: Particle[];
    freeList: number[];
    spawnAccumulator: number;
}

export interface ParticleSceneData {
    emitters: ResolvedEmitter[];
    images: Map<string, DecodedImage>;
}

function gfxBlend(d3dBlend: number): GfxBlendFactor {
    switch (d3dBlend) {
    case 1: return GfxBlendFactor.Zero;
    case 2: return GfxBlendFactor.One;
    case 3: return GfxBlendFactor.Src;
    case 4: return GfxBlendFactor.OneMinusSrc;
    case 5: return GfxBlendFactor.SrcAlpha;
    case 6: return GfxBlendFactor.OneMinusSrcAlpha;
    case 7: return GfxBlendFactor.One;
    case 8: return GfxBlendFactor.OneMinusDstAlpha;
    case 9: return GfxBlendFactor.Dst;
    case 10: return GfxBlendFactor.OneMinusDst;
    case 11: return GfxBlendFactor.SrcAlpha;
    default: return GfxBlendFactor.SrcAlpha;
    }
}

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
        const rPos: vec3 = [mapOffX - e.pos[0], -e.pos[1], e.pos[2] + mapOffZ];
        const dir1: vec3 = [-e.dir1[0], -e.dir1[1], e.dir1[2]];
        const dir2: vec3 = [-e.dir2[0], -e.dir2[1], e.dir2[2]];
        const grav: vec3 = [-e.gravity[0], -e.gravity[1], e.gravity[2]];

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
            color: colorNewFromRGBA(e.color[0]/255, e.color[1]/255, e.color[2]/255, e.color[3]/255),
            srcmode: e.srcmode?.[0] ?? 5,
            destmode: e.destmode?.[0] ?? 6,
            maxcount,
            zenable: (e.zenable?.[0] ?? 1) !== 0,
            textureName: name,
            texture: null,
            particles,
            freeList: [],
            spawnAccumulator: 0,
        });
    }

    return out.length > 0 ? { emitters: out, images } : null;
}

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
    vec4 u_CamRight;
    vec4 u_CamUp;
};

layout(std140) uniform ub_DrawParams {
    vec4 u_Color;
};

uniform sampler2D u_Texture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${ParticleProgram.a_Position}) in vec3 a_Position;
layout(location = ${ParticleProgram.a_Offset}) in vec2 a_Offset;
layout(location = ${ParticleProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
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

export class ParticleRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;

    private emitters: ResolvedEmitter[];

    constructor(device: GfxDevice, cache: GfxRenderCache, data: ParticleSceneData) {
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

    private rand(a: number, b: number): number {
        return a + (b - a) * Math.random();
    }

    private spawnOne(e: ResolvedEmitter): void {
        let idx: number;
        if (e.freeList.length > 0) {
            idx = e.freeList.pop()!;
        } else {

            return;
        }
        const p = e.particles[idx];
        p.posX = e.posX + this.rand(-e.radiusX, e.radiusX);
        p.posY = e.posY + this.rand(-e.radiusY, e.radiusY);
        p.posZ = e.posZ + this.rand(-e.radiusZ, e.radiusZ);
        p.velX = this.rand(e.dir1X, e.dir2X) * e.speed;
        p.velY = this.rand(e.dir1Y, e.dir2Y) * e.speed;
        p.velZ = this.rand(e.dir1Z, e.dir2Z) * e.speed;

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

    public update(dt: number): void {
        if (dt <= 0) return;

        const dtc = Math.min(dt, 0.1);
        for (const e of this.emitters) {
            const rate = this.rand(e.rateMin, e.rateMax);
            e.spawnAccumulator += rate * dtc;

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

    private countLive(): number {
        let n = 0;
        for (const e of this.emitters)
            for (const p of e.particles) if (p.alive) n++;
        return n;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, camRight: vec3, camUp: vec3): void {
        const totalLive = this.countLive();
        if (totalLive === 0) return;

        const vertexCount = totalLive * 6;
        const data = new ArrayBuffer(vertexCount * PARTICLE_VERTEX_STRIDE_BYTES);
        const f32 = new Float32Array(data);

        const ranges: { start: number, count: number, emitter: ResolvedEmitter }[] = [];

        let vi = 0;
        for (const e of this.emitters) {
            const startV = vi;
            for (const p of e.particles) {
                if (!p.alive) continue;
                const hx = p.size * 0.5;
                const hy = p.size * 0.5;
                const cx = [-hx, hx, -hx, hx, -hx, hx];
                const cy = [-hy, -hy, hy, -hy, hy, hy];
                const uu = [0, 1, 0, 1, 0, 1];

                const vv = [1, 1, 0, 1, 0, 0];
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

        const cache = renderHelper.renderCache;
        const vertexBufferDescriptor = cache.dynamicBufferCache.allocateData(GfxBufferUsage.Vertex, new Uint8Array(data));

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, [vertexBufferDescriptor], null);

        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        let sceneOffs = template.allocateUniformBuffer(ParticleProgram.ub_SceneParams, 16 + 2 * 4);
        const sceneMapped = template.mapUniformBufferF32(ParticleProgram.ub_SceneParams);
        sceneOffs += fillMatrix4x4(sceneMapped, sceneOffs, clipFromWorld);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, camRight[0], camRight[1], camRight[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, camUp[0], camUp[1], camUp[2], 0);

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
                e.color.r, e.color.g, e.color.b, e.color.a);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        const seen = new Set<GfxTexture>();
        for (const e of this.emitters) {
            if (e.texture !== null && !seen.has(e.texture)) {
                seen.add(e.texture);
                device.destroyTexture(e.texture);
            }
        }
    }
}
