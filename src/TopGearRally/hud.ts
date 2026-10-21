import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { DeviceProgram } from "../Program.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
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
    GfxProgram,
    GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { Vehicle, VEHICLE_CAMERA_BUMPER, VEHICLE_CAMERA_TRACKSIDE } from "./sim/types.js";
import { SpriteFormat, SpriteTexture, TGRSprites, TexRectBlend } from "./sprite.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TGRText, TextAlign, TextAssets } from "./text.js";

const DATA_SEGMENT_RAM = 0x8025f000;
const CAR_MODELS_RAM = 0x8028ae0c;
const CAR_MODEL_STRIDE = 0x60;
const DASHBOARD_ROM = 0xe0900;
const DASHBOARD_PALETTE_COLORS = 256;
const DASHBOARD_PALETTE_BYTES = DASHBOARD_PALETTE_COLORS * 2;
const DASHBOARD_PALETTES_BYTES = DASHBOARD_PALETTE_BYTES * 2;

const TACHOMETER_NEEDLE = 0;
const TACHOMETER_BAR_DIMMED = 1;
const TACHOMETER_BAR_HIDDEN = 2;
const TACHOMETER_FULL_RPM = 8000;
const NEEDLE_TIP_HALF = 0.05;
const NEEDLE_BASE_HALF = 0.3;
const NEEDLE_TIP_LENGTH = 20;
const NEEDLE_BASE_LENGTH = 7;
const NEEDLE_JITTER_MASK = 0x7f;
const PALETTE_QUARTER_MASK = 0x18c6;
const PALETTE_OPAQUE = 0x0001;

const VIEWPORT = { x: 8, y: 8, width: SCREEN_WIDTH - 16, height: SCREEN_HEIGHT - 16 };
const HUD_RIGHT = 296;
const SPEED_DASHBOARD_RIGHT = 266;
const HUD_BOTTOM_MARGIN = 4;
const SPEED_TEXT_SIZE = 20;
const SPEED_UNIT_TEXT_SIZE = 15;
const KM_PER_MILE = 1.609344;
const GLARE_MIN_LEVEL = 0.1;
const GLARE_MAX_LEVEL = 0.7;
const RACER_FINISHED = 0x1;
const GAME_MODE_DEMO = 4;

const MAX_QUADS = 8;
const FLOATS_PER_VERTEX = 6;

export interface HudAssets {
    text: TextAssets;
    dashboards: ArrayBufferSlice;
    dataSegment: ArrayBufferSlice;
}

export interface HudState {
    gameMode: number;
    totalLaps: number;
    night: boolean;
    camera: number;
    numLocalPlayers?: number;
    jitter?: number;
    glare?: number;
    mph?: boolean;
}

export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CarDashboard {
    dashboardRom: number;
    width: number;
    height: number;
    gearX: number;
    gearY: number;
    gearWidth: number;
    gearHeight: number;
    tachometer: number;
    needleX: number;
    needleY: number;
    needleFullAngle: number;
    needleRestAngle: number;
}

class FlatProgram extends DeviceProgram {
    public override both = `
varying vec4 v_Color;
`;

    public override vert = `
layout(location = 0) in vec2 a_Position;
layout(location = 1) in vec4 a_Color;

void main() {
    v_Color = a_Color;
    gl_Position = vec4(a_Position, 0.5, 1.0);
}
`;

    public override frag = `
void main() {
    gl_FragColor = v_Color;
}
`;
}

export function rearViewMirrorRect(): ScreenRect {
    const width = Math.trunc((VIEWPORT.width * 3) / 8) + 2;
    const height = width >> 2;
    return {
        x: ((VIEWPORT.width - width) >> 1) + VIEWPORT.x,
        y: Math.trunc(VIEWPORT.height / 16) + VIEWPORT.y,
        width,
        height,
    };
}

export class TGRHud {
    private readonly cars: CarDashboard[] = [];
    private readonly dashboards: Uint8Array;
    private readonly sprites: TGRSprites;
    private readonly text: TGRText;
    private readonly textures = new Map<string, SpriteTexture>();
    private readonly flatProgram: GfxProgram;
    private readonly flatBuffer: GfxBuffer;
    private readonly flatIndices: GfxBuffer;
    private readonly flatLayout: GfxInputLayout;
    private readonly flatData = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERTEX);
    private flatCount = 0;
    private readonly flatState: Partial<GfxMegaStateDescriptor> = {
        depthCompare: GfxCompareMode.Always,
        depthWrite: false,
        cullMode: GfxCullMode.None,
    };

    public constructor(
        private readonly device: GfxDevice,
        cache: GfxRenderCache,
        assets: HudAssets,
    ) {
        const data = assets.dataSegment.createDataView();
        for (let car = 0; car < 13; car++) {
            const o = CAR_MODELS_RAM - DATA_SEGMENT_RAM + car * CAR_MODEL_STRIDE;
            this.cars.push({
                dashboardRom: data.getUint32(o + 0x20),
                width: data.getUint8(o + 0x28),
                height: data.getUint8(o + 0x29),
                gearX: data.getInt8(o + 0x2a),
                gearY: data.getInt8(o + 0x2b),
                gearWidth: data.getUint8(o + 0x2c),
                gearHeight: data.getUint8(o + 0x2d),
                tachometer: data.getUint8(o + 0x2e),
                needleX: data.getUint8(o + 0x2f),
                needleY: data.getUint8(o + 0x30),
                needleFullAngle: data.getFloat32(o + 0x34),
                needleRestAngle: data.getFloat32(o + 0x38),
            });
        }
        this.dashboards = assets.dashboards.createTypedArray(Uint8Array);
        this.sprites = new TGRSprites(device, cache);
        this.text = new TGRText(device, cache, assets.text);
        this.flatProgram = cache.createProgram(new FlatProgram());
        setAttachmentStateSimple(this.flatState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        this.flatBuffer = device.createBuffer(this.flatData.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const indices = new Uint16Array(MAX_QUADS * 6);
        for (let i = 0; i < MAX_QUADS; i++) {
            indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
        }
        this.flatIndices = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.flatLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexBufferDescriptors: [{ byteStride: FLOATS_PER_VERTEX * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 2 * 4 },
            ],
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, vehicle: Vehicle, state: HudState, box: number[]): void {
        this.sprites.reset();
        this.text.reset();
        this.flatCount = 0;
        const glare = state.glare ?? 0;
        if (glare >= GLARE_MIN_LEVEL) {
            const alpha = Math.trunc(255 * Math.min(glare, GLARE_MAX_LEVEL)) / 255;
            this.quad([[0, 0], [SCREEN_WIDTH, 0], [SCREEN_WIDTH, SCREEN_HEIGHT], [0, SCREEN_HEIGHT]], [1, 1, 1, alpha], box);
        }
        const bumper = state.camera === VEHICLE_CAMERA_BUMPER;
        if (bumper) {
            this.drawMirrorBorder(box);
        }
        if (state.gameMode !== GAME_MODE_DEMO) {
            if (state.camera !== VEHICLE_CAMERA_TRACKSIDE) {
                this.drawSpeedAndHudOverlay(vehicle, state, box);
            } else if ((vehicle.racer?.status ?? 0) & RACER_FINISHED) {
                this.drawHudMessage(vehicle, box);
            }
        }
        this.sprites.prepareToRender(renderInstManager);
        this.prepareFlat(renderInstManager);
        this.text.prepareToRender(renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        for (const texture of this.textures.values()) {
            texture.destroy(device);
        }
        this.sprites.destroy(device);
        this.text.destroy(device);
        device.destroyBuffer(this.flatBuffer);
        device.destroyBuffer(this.flatIndices);
    }

    private dashboardTexture(key: string, offset: number, width: number, height: number, palette: Uint16Array): SpriteTexture {
        let texture = this.textures.get(key);
        if (texture === undefined) {
            const rgba = new Uint8Array(width * height * 2);
            for (let i = 0; i < width * height; i++) {
                const color = palette[this.dashboards[offset + i]];
                rgba[i * 2] = color >>> 8;
                rgba[i * 2 + 1] = color & 0xff;
            }
            texture = new SpriteTexture(this.device, rgba, width, height, SpriteFormat.RGBA16);
            this.textures.set(key, texture);
        }
        return texture;
    }

    private palette(car: CarDashboard, night: boolean): Uint16Array {
        const base = car.dashboardRom - DASHBOARD_ROM + (night ? DASHBOARD_PALETTE_BYTES : 0);
        const palette = new Uint16Array(DASHBOARD_PALETTE_COLORS);
        for (let i = 0; i < DASHBOARD_PALETTE_COLORS; i++) {
            palette[i] = (this.dashboards[base + i * 2] << 8) | this.dashboards[base + i * 2 + 1];
        }
        return palette;
    }

    private renderDashboardGauges(vehicle: Vehicle, state: HudState, box: number[]): number {
        const car = this.cars[vehicle.carModel];
        let x = HUD_RIGHT - car.width;
        let y = VIEWPORT.y + VIEWPORT.height - car.height - HUD_BOTTOM_MARGIN;
        const gear = vehicle.throttle >= 0 ? vehicle.gear + 1 : 0;
        const night = state.night ? 1 : 0;
        const jitter = state.jitter ?? Math.trunc(Math.random() * 0x80) & NEEDLE_JITTER_MASK;
        const rpm = Math.fround(jitter + vehicle.engineRpm);
        const palette = this.palette(car, state.night);
        let faceKey = `face:${vehicle.carModel}:${night}`;
        if (car.tachometer === TACHOMETER_BAR_DIMMED || car.tachometer === TACHOMETER_BAR_HIDDEN) {
            const segments = car.needleX;
            const first = DASHBOARD_PALETTE_COLORS - segments;
            let lit = Math.trunc((rpm / TACHOMETER_FULL_RPM) * Math.fround(segments + 1) - 0.5);
            lit = Math.min(Math.max(lit, 0) + first, DASHBOARD_PALETTE_COLORS);
            for (let i = lit; i < DASHBOARD_PALETTE_COLORS; i++) {
                palette[i] =
                    car.tachometer === TACHOMETER_BAR_DIMMED ? ((palette[i] >> 3) & PALETTE_QUARTER_MASK) | PALETTE_OPAQUE : palette[i] & ~PALETTE_OPAQUE;
            }
            faceKey += `:${lit}`;
        }
        const faceOffset = car.dashboardRom - DASHBOARD_ROM + DASHBOARD_PALETTES_BYTES;
        const face = this.dashboardTexture(faceKey, faceOffset, car.width, car.height, palette);
        const gearOffset = faceOffset + car.width * car.height + car.gearWidth * car.gearHeight * gear;
        const cell = this.dashboardTexture(`gear:${vehicle.carModel}:${night}:${gear}`, gearOffset, car.gearWidth, car.gearHeight, palette);
        const white = [0xff, 0xff, 0xff, 0xff];
        this.sprites.draw(face, x, y, car.width, car.height, [0, 0, 0, 0xff], white, TexRectBlend.Texture, box);
        this.sprites.draw(cell, car.gearX + x, car.gearY + y, car.gearWidth, car.gearHeight, [0, 0, 0, 0xff], white, TexRectBlend.Texture, box);
        if (car.tachometer === TACHOMETER_NEEDLE) {
            x += car.needleX;
            y += car.needleY;
            y = SCREEN_HEIGHT - y;
            let angle = car.needleRestAngle;
            if (rpm > 0) {
                angle = car.needleRestAngle - (rpm * (car.needleRestAngle - car.needleFullAngle)) / TACHOMETER_FULL_RPM;
            }
            const point = (offset: number, length: number): [number, number] => [
                Math.trunc(Math.cos(angle + offset) * length + x),
                SCREEN_HEIGHT - Math.trunc(Math.sin(angle + offset) * length + y),
            ];
            this.quad(
                [point(-NEEDLE_TIP_HALF, NEEDLE_TIP_LENGTH), point(NEEDLE_TIP_HALF, NEEDLE_TIP_LENGTH), point(NEEDLE_BASE_HALF, NEEDLE_BASE_LENGTH), point(-NEEDLE_BASE_HALF, NEEDLE_BASE_LENGTH)],
                [0, 1, 0, 1],
                box,
            );
        }
        return car.height;
    }

    private drawHudMessage(vehicle: Vehicle, box: number[]): void {
        const large = 30;
        const small = 20;
        const x = VIEWPORT.x + VIEWPORT.width / 2;
        const top = VIEWPORT.y + Math.trunc(VIEWPORT.height / 3);
        this.text.align = TextAlign.Center;
        if (vehicle.message !== null) {
            this.text.size = large;
            this.text.draw(vehicle.message, x, Math.trunc(large / 4) + top, box);
        } else if (vehicle.subMessage !== null) {
            this.text.size = small;
            this.text.draw(vehicle.subMessage, x, Math.trunc((large * 3) / 16) + top, box);
        }
    }

    private drawSpeedAndHudOverlay(vehicle: Vehicle, state: HudState, box: number[]): void {
        const speed = Math.max(vehicle.speedKph, 0);
        const dashboardHeight = this.renderDashboardGauges(vehicle, state, box);
        this.drawHudMessage(vehicle, box);
        this.text.bold = false;
        this.text.custom = null;
        this.text.align = TextAlign.Right;
        const mph = state.mph ?? false;
        const value = `%yw${(mph ? speed / KM_PER_MILE : speed).toFixed(0)}`;
        const x = SPEED_DASHBOARD_RIGHT;
        const y = VIEWPORT.y + VIEWPORT.height - HUD_BOTTOM_MARGIN - dashboardHeight;
        this.text.size = SPEED_TEXT_SIZE;
        this.text.draw(value, mph ? x : x - 3, y - 3, box);
        this.text.size = SPEED_UNIT_TEXT_SIZE;
        this.text.align = TextAlign.Left;
        this.text.draw(mph ? "%wwmph" : "%wwkph", mph ? x : x - 3, y - 3, box);
    }

    private drawMirrorBorder(box: number[]): void {
        const { x, y, width, height } = rearViewMirrorRect();
        const black = [0, 0, 0, 1];
        const rect = (x0: number, y0: number, x1: number, y1: number): void => {
            this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], black, box);
        };
        rect(x - 1, y - 2, x + width + 1, y - 1);
        rect(x - 1, y + height, x + width + 1, y + height + 1);
        rect(x - 2, y - 1, x - 1, y + height);
        rect(x + width, y - 1, x + width + 1, y + height);
    }

    private quad(points: [number, number][], color: number[], box: number[]): void {
        if (this.flatCount >= MAX_QUADS) {
            return;
        }
        points.forEach(([px, py], k) => {
            const nx = box[0] + (px / SCREEN_WIDTH) * box[2];
            const ny = box[1] + (py / SCREEN_HEIGHT) * box[3];
            this.flatData.set([nx * 2 - 1, 1 - ny * 2, ...color], (this.flatCount * 4 + k) * FLOATS_PER_VERTEX);
        });
        this.flatCount++;
    }

    private prepareFlat(renderInstManager: GfxRenderInstManager): void {
        if (this.flatCount === 0) {
            return;
        }
        this.device.uploadBufferData(this.flatBuffer, 0, new Uint8Array(this.flatData.buffer, 0, this.flatCount * 4 * FLOATS_PER_VERTEX * 4));
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 0 }]);
        renderInst.setGfxProgram(this.flatProgram);
        renderInst.setMegaStateFlags(this.flatState);
        renderInst.setVertexInput(this.flatLayout, [{ buffer: this.flatBuffer }], { buffer: this.flatIndices });
        renderInst.setDrawCount(this.flatCount * 6, 0);
        renderInstManager.submitRenderInst(renderInst);
    }
}
