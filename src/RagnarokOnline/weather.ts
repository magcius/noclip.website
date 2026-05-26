import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";

export interface WeatherParams {
    count: number;
    radius: number;
    ceiling: number;
    floor: number;
    fallSpeed: number;
    fallSpeedJitter: number;
    swaySpeed: number;
    swayRate: number;
    size: number;
    sizeJitter: number;
}

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

const MAX_DT = 0.25;

const FLAKE_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const FLAKE_FLOATS_PER_VERTEX = 5;

interface Flake {

    ox: number;
    oy: number;
    oz: number;
    fallSpeed: number;
    size: number;
    swayPhase: number;
    swayRate: number;
    swayAmpX: number;
    swayAmpZ: number;
}

function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function makeSoftDiscImage(r: number, g: number, b: number): { width: number, height: number, rgba: Uint8Array } {
    const N = 16;
    const rgba = new Uint8Array(N * N * 4);
    const c = (N - 1) / 2;
    const rMax = c;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const dx = x - c, dy = y - c;
            const d = Math.sqrt(dx * dx + dy * dy) / rMax;
            let a = 1.0 - d;
            a = Math.max(0, a);
            a = a * a * (3 - 2 * a);
            const o = (y * N + x) * 4;
            rgba[o + 0] = r;
            rgba[o + 1] = g;
            rgba[o + 2] = b;
            rgba[o + 3] = Math.round(a * 255);
        }
    }
    return { width: N, height: N, rgba };
}

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

    private newFlake(initial: boolean): Flake {
        const p = this.params;
        const r = this.rng;
        const ox = (r() * 2 - 1) * p.radius;
        const oz = (r() * 2 - 1) * p.radius;
        const fall = p.fallSpeed * (1 + (r() * 2 - 1) * p.fallSpeedJitter);
        const size = p.size * (1 + (r() * 2 - 1) * p.sizeJitter);
        const swayPhase = r() * Math.PI * 2;
        const swayRate = p.swayRate * (0.6 + r() * 0.8);
        const ang = r() * Math.PI * 2;
        const oy = initial ? (r() * (p.ceiling + p.floor) - p.floor) : p.ceiling;
        return {
            ox, oy, oz,
            fallSpeed: fall, size,
            swayPhase, swayRate,
            swayAmpX: Math.cos(ang), swayAmpZ: Math.sin(ang),
        };
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4, dtSeconds: number): void {
        const p = this.params;
        const camX = cameraWorldMatrix[12], camY = cameraWorldMatrix[13], camZ = cameraWorldMatrix[14];

        vec3.set(this.scratchRight, cameraWorldMatrix[0], 0, cameraWorldMatrix[2]);
        if (vec3.len(this.scratchRight) < 1e-5)
            vec3.set(this.scratchRight, 1, 0, 0);
        else
            vec3.normalize(this.scratchRight, this.scratchRight);
        const t = 0.5;
        vec3.set(this.scratchUp, t * cameraWorldMatrix[4], (1 - t) + t * cameraWorldMatrix[5], t * cameraWorldMatrix[6]);
        if (vec3.len(this.scratchUp) < 1e-5)
            vec3.set(this.scratchUp, 0, 1, 0);
        else
            vec3.normalize(this.scratchUp, this.scratchUp);

        this.accum += dtSeconds;
        if (this.accum > MAX_DT)
            this.accum = MAX_DT;
        const dt = this.accum;
        this.accum = 0;

        for (const f of this.flakes) {
            f.oy -= f.fallSpeed * dt;
            f.swayPhase += f.swayRate * dt;
            if (f.oy < -p.floor || Math.abs(f.ox) > p.radius * 1.2 || Math.abs(f.oz) > p.radius * 1.2) {
                const nf = this.newFlake(false);
                f.ox = nf.ox; f.oz = nf.oz;
                f.fallSpeed = nf.fallSpeed; f.size = nf.size;
                f.swayPhase = nf.swayPhase; f.swayRate = nf.swayRate;
                f.swayAmpX = nf.swayAmpX; f.swayAmpZ = nf.swayAmpZ;
                f.oy = p.ceiling;
            }
        }

        const f32 = this.cpuF32;
        const rX = this.scratchRight, uP = this.scratchUp;
        let vi = 0;
        for (const f of this.flakes) {
            const sway = Math.sin(f.swayPhase) * p.swaySpeed * f.swayRate;
            const cx = camX + f.ox + f.swayAmpX * sway;
            const cz = camZ + f.oz + f.swayAmpZ * sway;
            const cy = camY + f.oy;
            const s = f.size;

            const cornerH = [-s, s, -s, s];
            const cornerV = [s, s, -s, -s];
            const wx = [0, 0, 0, 0], wy = [0, 0, 0, 0], wz = [0, 0, 0, 0];
            for (let k = 0; k < 4; k++) {
                wx[k] = cx + rX[0] * cornerH[k] + uP[0] * cornerV[k];
                wy[k] = cy + rX[1] * cornerH[k] + uP[1] * cornerV[k];
                wz[k] = cz + rX[2] * cornerH[k] + uP[2] * cornerV[k];
            }
            const uu = [0, 1, 0, 1];
            const vv = [0, 0, 1, 1];
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
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        let offs = template.allocateUniformBuffer(WeatherProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(WeatherProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

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
