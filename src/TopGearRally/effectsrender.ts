import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as RDP from "../Common/N64/RDP.js";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxInputLayout,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgram,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxVertexBufferFrequency,
    GfxWrapMode,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { PARTICLES, effectsGlobals, g_aParticlePool } from "./sim/effects.js";
import { G } from "./sim/globals.js";
import { SPRAY_SEGMENTS, VEHICLE_WHEELS } from "./sim/types.js";

const DATA_SEGMENT_RAM = 0x8025f000;
const TIRE_SPRAY_TEXTURE_RAM = 0x802a2978;
const G_IM_FMT_I = 4;
const G_IM_SIZ_4b = 0;
const G_IM_SIZ_8b = 1;
const SPRAY_UNITS = 127;
const MAX_QUADS = 512;
const FLOATS_PER_VERTEX = 9;
const PARTICLE_SIDE = 64;
const PARTICLE_TEXELS = 63;
const SPRAY_WIDTH = 32;
const SPRAY_HEIGHT = 64;
const SPRAY_TILE_OFFSET = 0.5;
const BILLBOARD_SCALE = 16 / 3;
const BILLBOARD_WIDTH = 0.75;
const EXHAUST_COLOR = [0xe0, 0xe0, 0xff];

class EffectsProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_Texture;
varying vec2 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec4 a_Color;

void main() {
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
}
`;

    public override frag = `
void main() {
    gl_FragColor = vec4(v_Color.rgb, v_Color.a * texture(SAMPLER_2D(u_Texture), v_TexCoord).r);
}
`;
}

export interface EffectsEnvironment {
    n64ToGL: mat4;
    trackId: number;
    snow: boolean;
    night: boolean;
}

function decodeIntensity(data: ArrayBufferSlice, address: number, siz: number, line: number, width: number, height: number, masks: number, maskt: number): Uint8Array {
    const tile = new RDP.TileState();
    tile.set(G_IM_FMT_I, siz, line, 0, 0, 0, maskt, 0, 0, masks, 0);
    tile.setSize(0, 0, (width - 1) << 2, (height - 1) << 2);
    return RDP.translateTileTexture([data], address, 0, tile, true, true).pixels;
}

export class TGREffects {
    private readonly program: GfxProgram;
    private readonly particleTexture: GfxTexture;
    private readonly sprayTexture: GfxTexture;
    private readonly sampler: GfxSampler;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;
    private readonly inputLayout: GfxInputLayout;
    private readonly vertexData = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERTEX);
    private readonly megaState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };
    private quads = 0;

    public constructor(
        private readonly device: GfxDevice,
        cache: GfxRenderCache,
        particle: ArrayBufferSlice,
        dataSegment: ArrayBufferSlice,
    ) {
        setAttachmentStateSimple(this.megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        this.program = cache.createProgram(new EffectsProgram());
        this.particleTexture = this.createTexture(decodeIntensity(particle, 0, G_IM_SIZ_8b, 8, PARTICLE_SIDE, PARTICLE_SIDE, 6, 6), PARTICLE_SIDE, PARTICLE_SIDE);
        this.sprayTexture = this.createTexture(
            decodeIntensity(dataSegment, TIRE_SPRAY_TEXTURE_RAM - DATA_SEGMENT_RAM, G_IM_SIZ_4b, 2, SPRAY_WIDTH, SPRAY_HEIGHT, 5, 6),
            SPRAY_WIDTH,
            SPRAY_HEIGHT,
        );
        this.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 0,
        });
        this.vertexBuffer = device.createBuffer(this.vertexData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const indices = new Uint16Array(MAX_QUADS * 6);
        for (let i = 0; i < MAX_QUADS; i++) {
            indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
        }
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors: [{ byteStride: FLOATS_PER_VERTEX * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4 },
                { location: 2, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 4 },
            ],
        });
    }

    public reset(): void {
        this.quads = 0;
    }

    public prepareTireSmoke(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, env: EffectsEnvironment): void {
        if (env.night) {
            return;
        }
        const first = this.quads;
        let colors: number[][];
        switch (env.trackId) {
            case 1:
            case 6:
                colors = [
                    [0x60, 0x54, 0x38],
                    [0x60, 0x5c, 0x50],
                ];
                break;
            case 4:
            case 9:
                colors = [
                    [0x70, 0x58, 0x38],
                    [0x70, 0x68, 0x58],
                ];
                break;
            default:
                colors = [
                    [0xa0, 0x88, 0x60],
                    [0x70, 0x68, 0x58],
                ];
                break;
        }
        this.addBillboards(effectsGlobals.g_wTireSmokeListHead, colors[0], viewerInput, env);
        this.addBillboards(effectsGlobals.g_wPavedTireSmokeListHead, colors[1], viewerInput, env);
        this.submit(renderInstManager, viewerInput, first, this.particleTexture);
    }

    public prepareExhaustAndSpray(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, env: EffectsEnvironment): void {
        if (env.snow) {
            const first = this.quads;
            this.addBillboards(effectsGlobals.g_wExhaustParticleListHead, EXHAUST_COLOR, viewerInput, env);
            this.submit(renderInstManager, viewerInput, first, this.particleTexture);
        }
        if (env.snow && env.trackId !== 2 && env.trackId !== 7) {
            return;
        }
        const first = this.quads;
        this.addSpray(env);
        this.submit(renderInstManager, viewerInput, first, this.sprayTexture);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.particleTexture);
        device.destroyTexture(this.sprayTexture);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }

    private createTexture(pixels: Uint8Array, width: number, height: number): GfxTexture {
        const texture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        this.device.uploadTextureData(texture, 0, [pixels]);
        return texture;
    }

    private vertex(index: number, position: vec3, s: number, t: number, color: number[], alpha: number): void {
        this.vertexData.set([position[0], position[1], position[2], s, t, color[0] / 0xff, color[1] / 0xff, color[2] / 0xff, alpha / 0xff], index * FLOATS_PER_VERTEX);
    }

    private addBillboards(head: number, color: number[], viewerInput: ViewerRenderInput, env: EffectsEnvironment): void {
        const world = viewerInput.camera.worldMatrix;
        const right = vec3.fromValues(world[0], world[1], world[2]);
        const up = vec3.fromValues(world[4], world[5], world[6]);
        const scale = Math.hypot(env.n64ToGL[0], env.n64ToGL[1], env.n64ToGL[2]);
        const extent = BILLBOARD_SCALE * Math.tan(G.g_fCameraFovRadians / 2) * scale;
        const center = vec3.create();
        const corner = vec3.create();
        let count = 0;
        for (let index = head; index !== 0 && count < PARTICLES && this.quads < MAX_QUADS; index = g_aParticlePool[index].next, count++) {
            const particle = g_aParticlePool[index];
            vec3.transformMat4(center, [particle.position.x, particle.position.y, particle.position.z], env.n64ToGL);
            const height = particle.size * extent;
            const width = height * BILLBOARD_WIDTH;
            const alpha = (particle.alpha * particle.fade) >> 8;
            const base = this.quads * 4;
            const last = PARTICLE_TEXELS / PARTICLE_SIDE;
            for (let k = 0; k < 4; k++) {
                const sx = k & 1 ? 1 : -1;
                const sy = k & 2 ? 1 : -1;
                vec3.scaleAndAdd(corner, center, right, sx * width);
                vec3.scaleAndAdd(corner, corner, up, sy * height);
                this.vertex(base + k, corner, sx > 0 ? last : 0, sy > 0 ? last : 0, color, alpha);
            }
            this.quads++;
        }
    }

    private addSpray(env: EffectsEnvironment): void {
        const position = vec3.create();
        const seen = new Set<object>();
        for (let i = 0; i < G.g_dwNumVehicles; i++) {
            const vehicle = G.g_aRacerSlots[i].vehicle;
            if (vehicle === null || seen.has(vehicle)) {
                continue;
            }
            seen.add(vehicle);
            const origin = vehicle.sprayOrigin;
            for (let wheel = 0; wheel < VEHICLE_WHEELS; wheel++) {
                const vertices = vehicle.sprayVertices[wheel];
                const velocities = vehicle.sprayVelocities[wheel];
                for (let segment = 1; segment < SPRAY_SEGMENTS - 1 && this.quads < MAX_QUADS; segment++) {
                    const a = velocities[segment][1];
                    const b = velocities[segment + 1][1];
                    if (a[0] === 0 && a[1] === 0 && a[2] === 0 && b[0] === 0 && b[1] === 0 && b[2] === 0) {
                        continue;
                    }
                    const base = this.quads * 4;
                    const corners = [vertices[segment][0], vertices[segment + 1][0], vertices[segment][1], vertices[segment + 1][1]];
                    corners.forEach((v, k) => {
                        vec3.set(position, origin.x + v.ob[0] / SPRAY_UNITS, origin.y + v.ob[1] / SPRAY_UNITS, origin.z + v.ob[2] / SPRAY_UNITS);
                        vec3.transformMat4(position, position, env.n64ToGL);
                        const s = (v.tc[0] / 32 - SPRAY_TILE_OFFSET) / SPRAY_WIDTH;
                        const t = (v.tc[1] / 32 - SPRAY_TILE_OFFSET) / SPRAY_HEIGHT;
                        this.vertex(base + k, position, s, t, v.cn, v.cn[3]);
                    });
                    this.quads++;
                }
            }
        }
    }

    private submit(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, first: number, texture: GfxTexture): void {
        const count = this.quads - first;
        if (count === 0) {
            return;
        }
        const floats = 4 * FLOATS_PER_VERTEX;
        this.device.uploadBufferData(
            this.vertexBuffer,
            first * floats * 4,
            new Uint8Array(this.vertexData.buffer, first * floats * 4, count * floats * 4),
        );
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        renderInst.setGfxProgram(this.program);
        renderInst.setMegaStateFlags(this.megaState);
        renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
        renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: texture, gfxSampler: this.sampler }]);
        const offs = renderInst.allocateUniformBuffer(EffectsProgram.ub_Params, 16);
        fillMatrix4x4(renderInst.mapUniformBufferF32(EffectsProgram.ub_Params), offs, viewerInput.camera.clipFromWorldMatrix);
        renderInst.setDrawCount(count * 6, first * 6);
        renderInstManager.submitRenderInst(renderInst);
    }
}
