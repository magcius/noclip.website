import { vec3 } from "gl-matrix";
import { DeviceProgram } from "../Program.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
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
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { ViewerRenderInput } from "../viewer.js";

const RNG_MULTIPLIER = 16807;
const RNG_MASK = 0x07ffffff;
const RANDOM_TO_TWO = 2.0 / 65535.0;
const WIND_TURN = 6.2831855;
const WIND_STRENGTH_MAX = 1.0;
const WIND_STRENGTH_MIN = 0.5;
const LIGHTNING_TIMER_RATE = 343.0;
const LIGHTNING_TIMER_LIMIT = 2048.0;
const LIGHTNING_CHANCE = 0x80;
const LIGHTNING_FLASH_FRAMES = 3;
const LIGHTNING_AREA_MASK = 0x7ff;
const EYE_AHEAD = 3.0;
const RAIN_MIN_CAMERA_SPEED = 0.2777777612;
const RAIN_CAMERA_SPEED_MUL = 3.600000143;
const SNOW_FALL_RATE = 0.5;
const SNOW_DRIFT = 0.25;
const PARTICLE_UNITS = 16383.5;
const DRIFT_HOLD_MASK = 0xf;
const PARTICLE_SCALE = 6.10370189e-5;
const STREAK_CENTER = 32.0;
const STREAK_START = 28.0;
const STREAK_STEP = 3.5;
const STREAK_STEPS = 16;
const STREAK_MARGIN = 2;
const SNOW_PARTICLE_WIDTH = 24.0;
const SNOW_PARTICLE_HEIGHT = 36.0;
const RAIN_PARTICLE_SIZE = 128.0;
const PARTICLE_NEAR = 0.1;
const SCREEN_HALF_WIDTH = 640.0;
const SCREEN_HALF_HEIGHT = 480.0;
const N64_SCREEN_HEIGHT = 240;
const RAIN_PARTICLES = 512;
const TEXTURE_SIDE = 64;
const SNOW_PRIM: [number, number, number] = [0xe0, 0xe0, 0xff];
const RAIN_PRIM: [number, number, number] = [0x78, 0x80, 0x88];

class PrecipitationProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both = `
layout(std140) uniform ub_Params {
    vec4 u_PrimColor;
};

uniform sampler2D u_Texture;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec2 a_Position;
layout(location = 1) in vec2 a_TexCoord;

void main() {
    v_TexCoord = a_TexCoord;
    gl_Position = vec4(a_Position, 0.5, 1.0);
}
`;

    public override frag = `
void main() {
    gl_FragColor = vec4(u_PrimColor.rgb, texture(SAMPLER_2D(u_Texture), v_TexCoord).r);
}
`;
}

export interface WeatherCamera {
    position: vec3;
    forward: vec3;
    up: vec3;
}

export class TGRWeatherEffects {
    public lightningCounter = 0;
    public readonly lightningBolt = vec3.create();

    private seed = 1;
    private windAngle = 0;
    private windStrength = 0.5;
    private readonly rainVelocity = vec3.create();
    private lightningTimer = 0;
    private initialized = false;
    private readonly previousEye = vec3.create();
    private readonly particles = new Int16Array(RAIN_PARTICLES * 3);
    private readonly streak = new Uint8Array(TEXTURE_SIDE * TEXTURE_SIDE);
    private readonly particleTexture: GfxTexture;
    private readonly streakTexture: GfxTexture;
    private readonly sampler: GfxSampler;
    private readonly program: GfxProgram;
    private readonly vertexBuffer: GfxBuffer;
    private readonly indexBuffer: GfxBuffer;
    private readonly inputLayout: GfxInputLayout;
    private readonly vertexData = new Float32Array(RAIN_PARTICLES * 4 * 4);
    private readonly megaState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: GfxCompareMode.Always,
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };

    public constructor(
        private readonly device: GfxDevice,
        cache: GfxRenderCache,
        particle: Uint8Array,
        private readonly minZ: number,
    ) {
        setAttachmentStateSimple(this.megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        this.particleTexture = this.createIntensityTexture(particle);
        this.streakTexture = this.createIntensityTexture(this.streak);
        this.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 0,
        });
        this.program = cache.createProgram(new PrecipitationProgram());
        this.vertexBuffer = device.createBuffer(this.vertexData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const indices = new Uint16Array(RAIN_PARTICLES * 6);
        for (let i = 0; i < RAIN_PARTICLES; i++) {
            indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
        }
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors: [{ byteStride: 4 * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 2 * 4 },
            ],
        });
    }

    public isFlashing(): boolean {
        return this.lightningCounter > 0 && (this.lightningCounter & 1) !== 0;
    }

    public update(deltaSeconds: number, camera: WeatherCamera, rain: boolean, snow: boolean): void {
        this.updateWind(deltaSeconds);
        if (rain) {
            this.updateLightning(deltaSeconds);
        }
        const eye = vec3.scaleAndAdd(vec3.create(), camera.position, camera.forward, EYE_AHEAD);
        if (!this.initialized) {
            for (let i = 0; i < this.particles.length; i++) {
                this.particles[i] = this.random();
            }
            vec3.copy(this.previousEye, eye);
            this.initialized = true;
        }
        if (!snow && !rain) {
            return;
        }
        let dx = eye[0] - this.previousEye[0];
        let dy = eye[1] - this.previousEye[1];
        let dz = eye[2] - this.previousEye[2];
        let speed = Math.hypot(dx, dy, dz) / deltaSeconds;
        let speedScale = 1.0;
        if (speed > RAIN_MIN_CAMERA_SPEED) {
            speedScale = (Math.sqrt(speed * RAIN_CAMERA_SPEED_MUL) * RAIN_MIN_CAMERA_SPEED) / speed;
            dx *= speedScale;
            dy *= speedScale;
            dz *= speedScale;
            speed *= speedScale;
        }
        if (snow) {
            dz += deltaSeconds * SNOW_FALL_RATE;
        } else {
            const v = this.rainVelocity;
            v[0] = Math.cos(this.windAngle) * (deltaSeconds * this.windStrength);
            v[2] = deltaSeconds + deltaSeconds;
            const move = vec3.fromValues(dx, dy, dz);
            dz += v[2];
            v[1] = Math.sin(this.windAngle) * (deltaSeconds * this.windStrength);
            dx += v[0];
            dy += v[1];
            vec3.scaleAndAdd(v, v, move, speedScale * 0.5);
        }
        let driftStepX = 0;
        let driftStepY = 0;
        if (snow) {
            driftStepX = ((this.random() & 0xffff) * RANDOM_TO_TWO - 1.0) * deltaSeconds * SNOW_DRIFT;
            driftStepY = ((this.random() & 0xffff) * RANDOM_TO_TWO - 1.0) * deltaSeconds * SNOW_DRIFT;
        }
        vec3.copy(this.previousEye, eye);
        let holdX = this.random() & DRIFT_HOLD_MASK;
        let holdY = this.random() & DRIFT_HOLD_MASK;
        let driftX = Math.trunc(driftStepX * PARTICLE_UNITS);
        let driftY = Math.trunc(driftStepY * PARTICLE_UNITS);
        const moveX = Math.trunc(dx * PARTICLE_UNITS);
        const moveY = Math.trunc(dy * PARTICLE_UNITS);
        const moveZ = Math.trunc(dz * PARTICLE_UNITS);
        const p = this.particles;
        for (let i = 0; i < RAIN_PARTICLES * 3; i += 3) {
            if (holdX !== 0) {
                holdX--;
                p[i] += moveX;
            } else {
                p[i] += moveX + driftX;
                driftX = -driftX;
                holdX = this.random() & DRIFT_HOLD_MASK;
            }
            if (holdY !== 0) {
                holdY--;
                p[i + 1] += moveY;
            } else {
                p[i + 1] += moveY + driftY;
                driftY = -driftY;
                holdY = this.random() & DRIFT_HOLD_MASK;
            }
            p[i + 2] += moveZ;
        }
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        camera: WeatherCamera,
        rain: boolean,
        snow: boolean,
        mirrored: boolean,
    ): void {
        if (!rain && !snow) {
            return;
        }
        const side = vec3.cross(vec3.create(), camera.up, camera.forward);
        normalize(side);
        const up = vec3.cross(vec3.create(), camera.forward, side);
        normalize(up);
        const forward = camera.forward;
        if (rain) {
            this.drawStreak(forward, side, up, mirrored);
        }
        const projection = viewerInput.camera.projectionMatrix;
        const cotX = projection[0];
        const cotY = projection[5];
        const width = snow ? SNOW_PARTICLE_WIDTH : RAIN_PARTICLE_SIZE;
        const height = snow ? SNOW_PARTICLE_HEIGHT : RAIN_PARTICLE_SIZE;
        const halfWidth = mirrored ? -SCREEN_HALF_WIDTH : SCREEN_HALF_WIDTH;
        const pixel = viewerInput.backbufferHeight / N64_SCREEN_HEIGHT;
        const toNdcX = pixel / 4 / (viewerInput.backbufferWidth / 2);
        const toNdcY = pixel / 4 / (viewerInput.backbufferHeight / 2);
        const centerX = ((viewerInput.backbufferWidth / 2) / pixel) * 4;
        const centerY = ((viewerInput.backbufferHeight / 2) / pixel) * 4;
        let count = 0;
        const p = this.particles;
        for (let i = 0; i < RAIN_PARTICLES * 3; i += 3) {
            const px = p[i] * PARTICLE_SCALE;
            const py = p[i + 1] * PARTICLE_SCALE;
            const pz = p[i + 2] * PARTICLE_SCALE;
            const clipW = -(px * forward[0] + py * forward[1] + pz * forward[2]);
            if (clipW < PARTICLE_NEAR) {
                continue;
            }
            const scale = 0.5 / clipW;
            const clipY = cotY * (px * up[0] + py * up[1] + pz * up[2]) * scale;
            if (clipY < -1.0 || clipY > 1.0) {
                continue;
            }
            const clipX = cotX * (px * side[0] + py * side[1] + pz * side[2]) * scale;
            if (clipX < -1.0 || clipX > 1.0) {
                continue;
            }
            const sizeX = Math.trunc(width * scale);
            if (sizeX < 2) {
                continue;
            }
            const sizeY = Math.trunc(height * scale);
            if (sizeY < 2) {
                continue;
            }
            const x = Math.trunc(clipX * halfWidth);
            const y = Math.trunc(clipY * SCREEN_HALF_HEIGHT);
            const x0 = (x + centerX) * toNdcX - 1;
            const x1 = (x + sizeX + centerX) * toNdcX - 1;
            const y0 = 1 - (y + centerY) * toNdcY;
            const y1 = 1 - (y + sizeY + centerY) * toNdcY;
            const s1 = 63 / TEXTURE_SIDE;
            this.vertexData.set([x0, y0, 0, s1, x1, y0, s1, s1, x0, y1, 0, 0, x1, y1, s1, 0], count * 16);
            count++;
        }
        if (count === 0) {
            return;
        }
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer, 0, count * 16 * 4));
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        renderInst.setGfxProgram(this.program);
        renderInst.setMegaStateFlags(this.megaState);
        renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
        renderInst.setSamplerBindingsFromTextureMappings([
            { gfxTexture: rain ? this.streakTexture : this.particleTexture, gfxSampler: this.sampler },
        ]);
        const offs = renderInst.allocateUniformBuffer(PrecipitationProgram.ub_Params, 4);
        const prim = snow ? SNOW_PRIM : RAIN_PRIM;
        fillVec4(renderInst.mapUniformBufferF32(PrecipitationProgram.ub_Params), offs, prim[0] / 0xff, prim[1] / 0xff, prim[2] / 0xff, 1);
        renderInst.setDrawCount(count * 6);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.particleTexture);
        device.destroyTexture(this.streakTexture);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }

    private random(): number {
        this.seed = (this.seed * RNG_MULTIPLIER) % (RNG_MASK + 1);
        return this.seed;
    }

    private createIntensityTexture(intensity: Uint8Array): GfxTexture {
        const texture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, TEXTURE_SIDE, TEXTURE_SIDE, 1));
        this.uploadIntensity(texture, intensity);
        return texture;
    }

    private uploadIntensity(texture: GfxTexture, intensity: Uint8Array): void {
        const pixels = new Uint8Array(TEXTURE_SIDE * TEXTURE_SIDE * 4);
        for (let i = 0; i < intensity.length && i < TEXTURE_SIDE * TEXTURE_SIDE; i++) {
            pixels.fill(intensity[i], i * 4, i * 4 + 4);
        }
        this.device.uploadTextureData(texture, 0, [pixels]);
    }

    private updateWind(deltaSeconds: number): void {
        this.windAngle += ((this.random() & 0xffff) * RANDOM_TO_TWO - 1.0) * deltaSeconds;
        if (this.windAngle >= WIND_TURN) {
            this.windAngle -= WIND_TURN;
        } else if (this.windAngle < 0.0) {
            this.windAngle += WIND_TURN;
        }
        this.windStrength += ((this.random() & 0xffff) * RANDOM_TO_TWO - 1.0) * deltaSeconds;
        this.windStrength = Math.min(Math.max(this.windStrength, WIND_STRENGTH_MIN), WIND_STRENGTH_MAX);
    }

    private updateLightning(deltaSeconds: number): void {
        if (this.lightningCounter >= 0) {
            this.lightningTimer += LIGHTNING_TIMER_RATE * deltaSeconds;
            if (this.lightningCounter > 0) {
                this.lightningCounter--;
            } else if (this.lightningTimer > LIGHTNING_TIMER_LIMIT) {
                this.lightningCounter = -1;
            }
        } else if ((this.random() & 0xffff) < LIGHTNING_CHANCE) {
            this.lightningCounter = LIGHTNING_FLASH_FRAMES;
            this.lightningTimer = 0;
            this.lightningBolt[0] = this.random() & LIGHTNING_AREA_MASK;
            this.lightningBolt[1] = this.random() & LIGHTNING_AREA_MASK;
            this.lightningBolt[2] = this.minZ;
        }
    }

    private drawStreak(forward: vec3, side: vec3, up: vec3, mirrored: boolean): void {
        const s = this.streak;
        s.fill(0);
        const v = this.rainVelocity;
        const fall = vec3.fromValues(vec3.dot(v, side), vec3.dot(v, up), vec3.dot(v, forward));
        normalize(fall);
        if (mirrored) {
            fall[0] = -fall[0];
        }
        let u = STREAK_CENTER - fall[0] * STREAK_START;
        let t = fall[1] * STREAK_START + STREAK_CENTER;
        const du = fall[0] * STREAK_STEP;
        const dt = -fall[1] * STREAK_STEP;
        t += dt;
        const side64 = TEXTURE_SIDE;
        const disc = [
            -2 * side64 - 1, -2 * side64, -2 * side64 + 1,
            -side64 - 2, -side64 - 1, -side64, -side64 + 1, -side64 + 2,
            -2, -1, 0, 1, 2,
            side64 - 2, side64 - 1, side64, side64 + 1, side64 + 2,
            2 * side64 - 1, 2 * side64, 2 * side64 + 1,
        ];
        for (let step = 0; step < STREAK_STEPS; step++) {
            u += du;
            const row = Math.trunc(t);
            if (row >= STREAK_MARGIN && row < side64 - STREAK_MARGIN) {
                const column = Math.trunc(u);
                if (column >= STREAK_MARGIN && column < side64 - STREAK_MARGIN) {
                    const shade = (step << 4) | step;
                    const center = row * side64 + column;
                    for (const o of disc) {
                        s[center + o] = shade;
                    }
                }
            }
            t += dt;
        }
        this.uploadIntensity(this.streakTexture, s);
    }
}

function normalize(v: vec3): void {
    const length = vec3.length(v);
    if (length === 0) {
        vec3.set(v, 0, 0, 1);
    } else {
        vec3.scale(v, v, 1 / length);
    }
}
