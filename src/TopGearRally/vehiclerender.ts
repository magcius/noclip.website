import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as RDP from "../Common/N64/RDP.js";
import { F3DEX_Program } from "../BanjoKazooie/render.js";
import { computeViewMatrix } from "../Camera.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBufferFrequencyHint, GfxCullMode, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { nArray } from "../util.js";
import { RSP_Geometry, RSPSharedOutput, RSPState, runDL_F3DEX } from "./f3dex.js";
import {
    DrawParams,
    FogState,
    GeometryBuffers,
    LightState,
    TGRDrawCallInstance,
    TRACK_OTHER_MODE_H,
    TextureHandle,
    combineLERP,
    createGeometryBuffers,
    createTextureHandle,
} from "./render.js";
import { reflectionLookAt } from "./splash.js";
import { Vehicle } from "./sim/types.js";

const RAM_SIZE = 0x400000;
const MODEL_RAM = 0x803c8000;
const MODEL_SIZE = 0xdf88;
const DATA_SEGMENT_RAM = 0x8025f000;
const SECTION_DATA_RAM = [0x803736b0, 0x80373ed0];
const SECTION_HEADER_RAM = [0x80373eb0, 0x803746d0];
const SECTION_HEADER_SIZE = 0x20;
const SECTION_DATA_SIZE = 0x800;
const SCRATCH_DL_RAM = 0x80390000;

const SHADE_PALETTE_RAM = 0x8028c340;
const REFLECTION_TEXTURES_RAM = 0x8028c308;
const REFLECTION_TLUTS_RAM = 0x8028c318;
const REFLECTION_SELECT_RAM = 0x8028c32c;
const HILITE_TEXTURES_RAM = [0x802a1968, 0x802a2170];
const DEFAULT_LIGHTS_RAM = 0x8028a9f0;
const TEXTURE_RENDER_TILE_RAM = 0x8028ab18;
const TEXTURE_TMEM_RAM = 0x8028ab1c;

const MODEL_TEXTURES = 0x14;
const MODEL_DISPLAY_LISTS = 0x18;
const MODEL_WHEEL_DISPLAY_LISTS = 0xbc;
const MODEL_WHEELS = 0xe0;
const MODEL_MATERIALS = 0x110;
const VEHICLE_DISPLAY_LISTS = 10;
const VEHICLE_WHEEL_DISPLAY_LISTS = 3;
const VEHICLE_WHEELS = 4;
const VEHICLE_MATERIALS = 12;
const TEXTURE_STRIDE = 0x24;

const VEHICLE_DL_NEAR_DETAIL = 3;
const VEHICLE_DL_BODY = 4;
const VEHICLE_DL_HEADLIGHT_BEAMS = 5;
const HEADLIGHT_BEAM_TEXTURE = 5;
const VEHICLE_DL_UNDERSIDE = 6;
const VEHICLE_DL_TEXTURED = 8;
const VEHICLE_DL_HIGHLIGHTED = 9;
const VEHICLE_WHEEL_DL_NORMAL = 0;
const VEHICLE_WHEEL_DL_SNOW = 2;
const VEHICLE_MATERIAL_HEADLIGHTS = 10;
const VEHICLE_MATERIAL_REAR_LIGHTS = 11;
const UNDERSIDE_TEXTURE = 6;
const NEAR_DETAIL_TEXTURE = 3;
const HEADLIGHT_FIRST_ENTRY = 12;
const HEADLIGHT_ENTRIES = 4;
const SHADE_PALETTE = 14;
const TEXTURE_CI4_PALETTE = 15;
const TEXTURE_FORMAT_CI4 = 1;
const TEXTURE_FORMAT_I8 = 4;
const HILITE_SIZE = 64;
const VEHICLE_GHOST = 2;

const MODEL_SCALE = 1 / 255;
const NEAR_DISTANCE = 50;
const NEAR_REPLAY_DISTANCE = 120;
const NIGHT_LIGHT_DISTANCE = 10;
const HEADLIGHT_DIRECTION = 120;
const GLARE_THRESHOLD = 0.95;
const GLARE_STRENGTH = 750;
const INPUT_BRAKE = 0x00040000;
const INPUT_EBRAKE = 0x00080000;

const G_IM_FMT_RGBA = 0;
const G_IM_FMT_CI = 2;
const G_IM_FMT_I = 4;
const G_IM_SIZ_4b = 0;
const G_IM_SIZ_8b = 1;
const G_IM_SIZ_16b = 2;
const G_TX_LOADTILE = 7;
const G_TX_WRAP = 0;
const G_TX_MIRROR = 1;
const G_TX_CLAMP = 2;
const G_CYC_1CYCLE = 0;
const G_CYC_2CYCLE = 1 << 20;
const G_TL_TILE = 0;
const G_TL_LOD = 1 << 16;
const G_TT_NONE = 0;
const G_TT_RGBA16 = 2 << 14;
const G_TF_BILERP = 2 << 12;

const AA_EN = 0x8;
const Z_CMP = 0x10;
const Z_UPD = 0x20;
const IM_RD = 0x40;
const CLR_ON_CVG = 0x80;
const CVG_DST_CLAMP = 0;
const CVG_DST_WRAP = 0x100;
const CVG_DST_FULL = 0x200;
const ZMODE_XLU = 0x800;
const CVG_DST_SAVE = 0x300;
const ZMODE_DEC = 0xc00;
const ALPHA_CVG_SEL = 0x2000;
const FORCE_BL = 0x4000;
const G_BL_CLR_IN = 0;
const G_BL_CLR_MEM = 1;
const G_BL_CLR_FOG = 3;
const G_BL_A_IN = 0;
const G_BL_A_SHADE = 2;
const G_BL_0 = 3;
const G_BL_1MA = 0;
const G_BL_A_MEM = 1;
const G_BL_1 = 2;

const GBL_c1 = (m1a: number, m1b: number, m2a: number, m2b: number): number => ((m1a << 30) | (m1b << 26) | (m2a << 22) | (m2b << 18)) >>> 0;
const GBL_c2 = (m1a: number, m1b: number, m2a: number, m2b: number): number => ((m1a << 28) | (m1b << 24) | (m2a << 20) | (m2b << 16)) >>> 0;

const BLEND_PLAIN = GBL_c1(G_BL_CLR_IN, G_BL_0, G_BL_CLR_IN, G_BL_1);
const BLEND_FOG = GBL_c1(G_BL_CLR_FOG, G_BL_A_SHADE, G_BL_CLR_IN, G_BL_1MA);
const FLAGS_FAR = Z_CMP | Z_UPD | CVG_DST_FULL | ALPHA_CVG_SEL | GBL_c2(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_A_MEM);
const FLAGS_NEAR = AA_EN | Z_CMP | Z_UPD | CVG_DST_CLAMP | ALPHA_CVG_SEL | GBL_c2(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_A_MEM);
const HILITE_RENDER_MODE = [
    (Z_CMP | IM_RD | CVG_DST_SAVE | ZMODE_DEC | FORCE_BL | GBL_c1(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_1MA)) >>> 0,
    GBL_c2(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_1MA),
];

const CC_COMBINED = 0;
const CC_TEXEL0 = 1;
const CC_PRIMITIVE = 3;
const CC_SHADE = 4;
const CC_ENVIRONMENT = 5;
const CC_ENV_ALPHA = 12;
const CC_0 = 31;
const AC_COMBINED = 0;
const AC_TEXEL0 = 1;
const AC_SHADE = 4;
const AC_0 = 7;

const COMBINE_TEXEL_SHADE = combineLERP(
    [CC_TEXEL0, CC_0, CC_SHADE, CC_0],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
    [CC_0, CC_0, CC_0, CC_COMBINED],
    [AC_0, AC_0, AC_0, AC_COMBINED],
);
const COMBINE_TEXTURED = combineLERP(
    [CC_TEXEL0, CC_0, CC_SHADE, CC_0],
    [AC_TEXEL0, AC_0, AC_SHADE, AC_0],
    [CC_0, CC_0, CC_0, CC_COMBINED],
    [AC_0, AC_0, AC_0, AC_COMBINED],
);
const COMBINE_LIT = combineLERP(
    [CC_TEXEL0, CC_0, CC_SHADE, CC_0],
    [AC_0, AC_0, AC_0, AC_SHADE],
    [CC_0, CC_0, CC_0, CC_COMBINED],
    [AC_0, AC_0, AC_0, AC_COMBINED],
);
const COMBINE_HILITE = combineLERP(
    [CC_0, CC_0, CC_0, CC_PRIMITIVE],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
    [CC_0, CC_0, CC_0, CC_PRIMITIVE],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
);
const CC_1 = 6;
const COMBINE_BEAMS = combineLERP(
    [CC_0, CC_0, CC_0, CC_1],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
    [CC_0, CC_0, CC_0, CC_1],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
);
const BEAM_RENDER_MODE = [
    (AA_EN | Z_CMP | IM_RD | CVG_DST_WRAP | CLR_ON_CVG | ZMODE_XLU | FORCE_BL | GBL_c1(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_MEM, G_BL_1MA)) >>> 0,
    GBL_c2(G_BL_CLR_IN, G_BL_A_IN, G_BL_CLR_IN, G_BL_1MA),
];
const COMBINE_REFLECT = combineLERP(
    [CC_TEXEL0, CC_ENVIRONMENT, CC_ENV_ALPHA, CC_ENVIRONMENT],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
    [CC_TEXEL0, CC_ENVIRONMENT, CC_ENV_ALPHA, CC_ENVIRONMENT],
    [AC_0, AC_0, AC_0, AC_TEXEL0],
);

const GEOMETRY_MODE = RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_LIGHTING | RSP_Geometry.G_SHADING_SMOOTH;
const TEXTURE_GEN_BOTH = RSP_Geometry.G_TEXTURE_GEN | RSP_Geometry.G_TEXTURE_GEN_LINEAR;

class GfxWriter {
    private offset: number;

    public constructor(
        private readonly view: DataView,
        public readonly start: number,
    ) {
        this.offset = start & 0xffffff;
    }

    public cmd(w0: number, w1: number): void {
        this.view.setUint32(this.offset, w0 >>> 0);
        this.view.setUint32(this.offset + 4, w1 >>> 0);
        this.offset += 8;
    }

    public get address(): number {
        return (0x80000000 | this.offset) >>> 0;
    }

    public pipeSync(): void {
        this.cmd(0xe7000000, 0);
    }

    public tileSync(): void {
        this.cmd(0xe8000000, 0);
    }

    public loadSync(): void {
        this.cmd(0xe6000000, 0);
    }

    public otherModeH(sft: number, len: number, data: number): void {
        this.cmd(0xba000000 | (sft << 8) | len, data);
    }

    public cycleType(type: number): void {
        this.otherModeH(20, 2, type);
    }

    public textureLOD(mode: number): void {
        this.otherModeH(16, 1, mode);
    }

    public textureLUT(mode: number): void {
        this.otherModeH(14, 2, mode);
    }

    public textureFilter(mode: number): void {
        this.otherModeH(12, 2, mode);
    }

    public renderMode(c1: number, c2: number): void {
        this.cmd(0xb9000000 | (3 << 8) | 29, (c1 | c2) >>> 0);
    }

    public combine(combine: [number, number]): void {
        this.cmd(0xfc000000 | combine[0], combine[1]);
    }

    public setGeometryMode(mode: number): void {
        this.cmd(0xb7000000, mode);
    }

    public clearGeometryMode(mode: number): void {
        this.cmd(0xb6000000, mode);
    }

    public texture(s: number, t: number, level: number, tile: number, on: number): void {
        this.cmd(0xbb000000 | (level << 11) | (tile << 8) | on, ((s << 16) | t) >>> 0);
    }

    public setTextureImage(fmt: number, siz: number, width: number, address: number): void {
        this.cmd(0xfd000000 | (fmt << 21) | (siz << 19) | (width - 1), address);
    }

    public setTile(
        fmt: number,
        siz: number,
        line: number,
        tmem: number,
        tile: number,
        palette: number,
        cmt: number,
        maskt: number,
        shiftt: number,
        cms: number,
        masks: number,
        shifts: number,
    ): void {
        this.cmd(
            0xf5000000 | (fmt << 21) | (siz << 19) | ((line & 0x1ff) << 9) | (tmem & 0x1ff),
            (tile << 24) | (palette << 20) | (cmt << 18) | (maskt << 14) | (shiftt << 10) | (cms << 8) | (masks << 4) | shifts,
        );
    }

    public setTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.cmd(0xf2000000 | ((uls & 0xfff) << 12) | (ult & 0xfff), (tile << 24) | ((lrs & 0xfff) << 12) | (lrt & 0xfff));
    }

    public loadBlock(tile: number, uls: number, ult: number, lrs: number, dxt: number): void {
        this.cmd(0xf3000000 | (uls << 12) | ult, (tile << 24) | (Math.min(lrs, 0x7ff) << 12) | dxt);
    }

    public loadTLUTPal16(palette: number, address: number): void {
        this.setTextureImage(G_IM_FMT_RGBA, G_IM_SIZ_16b, 1, address);
        this.tileSync();
        this.setTile(0, 0, 0, 256 + ((palette & 0xf) << 4), G_TX_LOADTILE, 0, 0, 0, 0, 0, 0, 0);
        this.loadSync();
        this.cmd(0xf0000000, (G_TX_LOADTILE << 24) | (15 << 14));
        this.pipeSync();
    }

    public loadTextureBlock4b(
        address: number,
        fmt: number,
        width: number,
        height: number,
        palette: number,
        cms: number,
        cmt: number,
        masks: number,
        maskt: number,
        shifts: number,
        shiftt: number,
    ): void {
        this.setTextureImage(fmt, G_IM_SIZ_16b, 1, address);
        this.setTile(fmt, G_IM_SIZ_16b, 0, 0, G_TX_LOADTILE, 0, cmt, maskt, shiftt, cms, masks, shifts);
        this.loadSync();
        this.loadBlock(G_TX_LOADTILE, 0, 0, ((width * height + 3) >> 2) - 1, 0);
        this.pipeSync();
        this.setTile(fmt, G_IM_SIZ_4b, ((width >> 1) + 7) >> 3, 0, 0, palette, cmt, maskt, shiftt, cms, masks, shifts);
        this.setTileSize(0, 0, 0, (width - 1) << 2, (height - 1) << 2);
    }

    public primColor(m: number, l: number, rgba: number): void {
        this.cmd(0xfa000000 | (m << 8) | l, rgba);
    }

    public envColor(rgba: number): void {
        this.cmd(0xfb000000, rgba);
    }

    public displayList(address: number): void {
        if (address !== 0) {
            this.cmd(0x06000000, address);
        }
    }

    public end(): void {
        this.cmd(0xb8000000, 0);
    }
}

function maskBits(size: number): number {
    const largest = size - 1;
    return largest <= 0 ? 0 : 32 - Math.clz32(largest);
}

interface ModelTextureInfo {
    image: number;
    palette: number;
    width: number;
    height: number;
    tileS0: number;
    tileT0: number;
    tileS1: number;
    tileT1: number;
    mirrorS: boolean;
    mirrorT: boolean;
    clampS: boolean;
    clampT: boolean;
    format: number;
}

interface CarBuild {
    weatherActive: boolean;
    sharedOutput: RSPSharedOutput;
    buffers: GeometryBuffers;
    handles: TextureHandle[];
    textured: TGRDrawCallInstance[];
    underside: TGRDrawCallInstance[];
    nearDetail: TGRDrawCallInstance[];
    hilite: TGRDrawCallInstance[][];
    body: TGRDrawCallInstance[][];
    wheels: TGRDrawCallInstance[][];
    beams: TGRDrawCallInstance[];
}

export interface CarAssets {
    dataSegment: ArrayBufferSlice;
    sections: ArrayBufferSlice;
}

export interface CarPose {
    frame: number[][];
    wheels: number[][][];
}

export interface CarEnvironment {
    drawDistance: number;
    n64ToGL: mat4;
    cameraPosition: vec3;
    cameraForward: vec3;
    cameraUp: vec3;
    cameraVehicle: Vehicle;
    cockpitView: boolean;
    bumperView: boolean;
    tracksideCamera: boolean;
    replay: boolean;
    weatherActive: boolean;
    night: boolean;
    rain: boolean;
    snow: boolean;
    mirrored: boolean;
    viewportMirrored: boolean;
    viewMode: number;
    fog: FogState;
    lights: LightState;
    sunDirection: vec3;
}

const lightDirScratch = vec3.create();
const viewScratch = mat4.create();

export class TGRCar {
    private readonly ram: Uint8Array;
    private readonly view: DataView;
    private readonly segmentBuffers: ArrayBufferSlice[];
    private readonly textures: ModelTextureInfo[] = [];
    private readonly displayLists: number[];
    private readonly wheelDisplayLists: number[];
    private readonly materials: number[];
    public readonly wheels: vec3[] = [];
    private build: CarBuild | null = null;
    private paletteKey = "";

    public constructor(
        model: ArrayBufferSlice,
        assets: CarAssets,
    ) {
        this.ram = new Uint8Array(RAM_SIZE);
        this.view = new DataView(this.ram.buffer);
        this.ram.set(assets.dataSegment.createTypedArray(Uint8Array), DATA_SEGMENT_RAM & 0xffffff);
        const sections = assets.sections.createTypedArray(Uint8Array);
        for (let i = 0; i < 2; i++) {
            const piece = i * (SECTION_HEADER_SIZE + SECTION_DATA_SIZE);
            this.ram.set(sections.subarray(piece, piece + SECTION_HEADER_SIZE), SECTION_HEADER_RAM[i] & 0xffffff);
            this.ram.set(sections.subarray(piece + SECTION_HEADER_SIZE, piece + SECTION_HEADER_SIZE + SECTION_DATA_SIZE), SECTION_DATA_RAM[i] & 0xffffff);
        }
        this.ram.set(model.createTypedArray(Uint8Array), MODEL_RAM & 0xffffff);
        const slice = new ArrayBufferSlice(this.ram.buffer);
        this.segmentBuffers = nArray(256, () => slice);

        const m = (offset: number): number => (MODEL_RAM & 0xffffff) + offset;
        const textureTable = this.view.getUint32(m(MODEL_TEXTURES)) & 0xffffff;
        const textureCount = this.view.getInt32(m(0x10));
        for (let i = 0; i < textureCount; i++) {
            const o = textureTable + i * TEXTURE_STRIDE;
            const bits = this.view.getUint32(o + 0x20);
            this.textures.push({
                image: this.view.getUint32(o),
                palette: this.view.getUint32(o + 0x04),
                width: this.view.getUint16(o + 0x0c),
                height: this.view.getUint16(o + 0x0e),
                tileT0: this.view.getInt16(o + 0x10),
                tileS0: this.view.getInt16(o + 0x12),
                tileT1: this.view.getInt16(o + 0x14),
                tileS1: this.view.getInt16(o + 0x16),
                mirrorS: (bits & 0x80000000) !== 0,
                mirrorT: (bits & 0x40000000) !== 0,
                clampS: (bits & 0x20000000) !== 0,
                clampT: (bits & 0x10000000) !== 0,
                format: (bits >>> 24) & 0xf,
            });
        }
        this.displayLists = nArray(VEHICLE_DISPLAY_LISTS, (k) => this.view.getUint32(m(MODEL_DISPLAY_LISTS + k * 4)));
        this.wheelDisplayLists = nArray(VEHICLE_WHEEL_DISPLAY_LISTS, (k) => this.view.getUint32(m(MODEL_WHEEL_DISPLAY_LISTS + k * 4)));
        for (let i = 0; i < VEHICLE_WHEELS; i++) {
            const o = m(MODEL_WHEELS + i * 12);
            this.wheels.push(vec3.fromValues(this.view.getFloat32(o), this.view.getFloat32(o + 4), this.view.getFloat32(o + 8)));
        }
        this.materials = nArray(VEHICLE_MATERIALS, (i) => this.view.getUint8(m(MODEL_MATERIALS + i)));
    }

    public destroy(device: GfxDevice): void {
        this.destroyBuild(device);
    }

    public prepareToRender(
        device: GfxDevice,
        cache: GfxRenderCache,
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        vehicle: Vehicle,
        pose: CarPose,
        env: CarEnvironment,
        inTunnel: boolean,
    ): void {
        const isCameraVehicle = vehicle === env.cameraVehicle;
        if (isCameraVehicle && env.cockpitView) {
            return;
        }
        const frame = pose.frame;
        const position = vec3.fromValues(frame[3][0], frame[3][1], frame[3][2]);
        const distance = vec3.distance(position, env.cameraPosition);
        if (distance > env.drawDistance) {
            return;
        }
        if (this.build === null || this.build.weatherActive !== env.weatherActive) {
            this.destroyBuild(device);
            this.paletteKey = "";
            this.build = this.createBuild(device, cache, env.weatherActive);
        }
        const build = this.build;
        this.updatePalettes(device, build, vehicle, env.night || env.rain);

        const light = env.lights;
        let dirColor = light.dirColor;
        let ambient = light.ambient;
        if (env.night) {
            const divisor = Math.max(Math.fround(distance / NIGHT_LIGHT_DISTANCE), 1);
            dirColor = [0, 1, 2].map((i) => Math.trunc(light.dirColor[i] / divisor) & 0xff) as [number, number, number];
        } else if (inTunnel) {
            dirColor = [0, 0, 0];
            ambient = [0, 1, 2].map((i) => Math.trunc((light.ambient[i] * 4) / 5) & 0xff) as [number, number, number];
        }

        const lightDir = vec3.create();
        if (env.night || env.rain) {
            const f = env.cameraVehicle.frame.forward;
            vec3.set(lightDir, -Math.trunc(f.x * HEADLIGHT_DIRECTION), -Math.trunc(f.y * HEADLIGHT_DIRECTION), -Math.trunc(f.z * HEADLIGHT_DIRECTION));
        } else {
            const o = DEFAULT_LIGHTS_RAM & 0xffffff;
            vec3.set(lightDir, this.view.getInt8(o + 0x10), this.view.getInt8(o + 0x11), this.view.getInt8(o + 0x12));
        }
        const lights: LightState = {
            direction: vec3.transformMat4(vec3.create(), lightDir, env.n64ToGL),
            dirColor,
            ambient,
            ramps: [],
        };

        const vehicleLight = vec3.create();
        if (env.night) {
            if (env.tracksideCamera) {
                vec3.negate(vehicleLight, env.cameraForward);
            } else {
                const f = env.cameraVehicle.frame.forward;
                vec3.set(vehicleLight, -f.x, -f.y, -f.z);
            }
        } else {
            vec3.copy(vehicleLight, env.sunDirection);
        }
        vec3.normalize(vehicleLight, vehicleLight);
        const toCamera = vec3.sub(vec3.create(), env.cameraPosition, position);
        const toCameraLength = vec3.length(toCamera);
        if (toCameraLength === 0) {
            vec3.negate(toCamera, env.cameraForward);
        } else {
            vec3.scale(toCamera, toCamera, 1 / toCameraLength);
        }
        const hiliteDir = vec3.scale(vec3.create(), vec3.add(vec3.create(), toCamera, vehicleLight), 0.5);
        const hiliteLength = vec3.length(hiliteDir);
        if (hiliteLength === 0) {
            vec3.copy(hiliteDir, env.cameraUp);
        } else {
            vec3.scale(hiliteDir, hiliteDir, 1 / hiliteLength);
        }

        let nudgeX = 0;
        let nudgeZ = 0;
        if (env.cameraPosition[0] === position[0] && env.cameraPosition[1] === position[1]) {
            if (env.cameraPosition[2] === position[2]) {
                nudgeZ = 1;
            } else {
                nudgeX = 0.1;
            }
        }
        const target = [position[0] + nudgeX, position[1], position[2] + nudgeZ];
        const [hiliteRight, hiliteUp] = reflectionLookAt([...env.cameraPosition], target, [0, 0, 1]);
        const look = vec3.normalize(vec3.create(), [env.cameraPosition[0] - target[0], env.cameraPosition[1] - target[1], env.cameraPosition[2] - target[2]]);
        const hilite = vec3.add(vec3.create(), hiliteDir, look);
        let hiliteX = HILITE_SIZE * 2;
        let hiliteY = HILITE_SIZE * 2;
        const hiliteVectorLength = vec3.length(hilite);
        if (hiliteVectorLength > 0.1) {
            vec3.scale(hilite, hilite, 1 / hiliteVectorLength);
            hiliteX = Math.trunc(HILITE_SIZE * 4 + vec3.dot(hilite, hiliteRight) * HILITE_SIZE * 2);
            hiliteY = Math.trunc(HILITE_SIZE * 4 + vec3.dot(hilite, hiliteUp) * HILITE_SIZE * 2);
        }

        const eye = [env.cameraForward[0], env.cameraForward[1], 0];
        if (eye[0] === 0 && eye[1] === 0) {
            eye[0] = 1e-4;
        }
        const reflectLookAt = reflectionLookAt(eye, [0, 0, 0], [0, 0, 1]);

        const toVehicle = vec3.sub(vec3.create(), position, env.cameraPosition);
        const underside = frame[2][0] * toVehicle[0] + frame[2][1] * toVehicle[1] + frame[2][2] * toVehicle[2] > 0;
        const near = distance < (env.replay && env.tracksideCamera ? NEAR_REPLAY_DISTANCE : NEAR_DISTANCE);
        const ghost = vehicle.ghostMode === VEHICLE_GHOST;
        const drawHilite = !env.viewportMirrored && !env.snow && !env.rain && (!inTunnel || env.night) && near && !(env.night && isCameraVehicle) && !vehicle.otherLook;

        let envAlpha = 0xff;
        if (env.weatherActive) {
            envAlpha = inTunnel ? (env.fog.intensity >> 3) + 0xdf : (env.fog.intensity >> 1) + 0x7f;
        }
        const reflection = this.view.getUint8((REFLECTION_SELECT_RAM & 0xffffff) + env.viewMode * 2 + (inTunnel ? 1 : 0));
        const heading = Math.trunc(Math.fround(Math.fround(env.cameraVehicle.cameraHeading * 64) * 0.3183098733));
        const offset = 31 - (64 - heading);

        const model = this.modelMatrix(pose, env);

        const cullMode = env.mirrored ? GfxCullMode.Front : GfxCullMode.Back;
        const fog = env.weatherActive ? env.fog : null;
        const base: DrawParams = { model, cullMode, lights, ramp: -1, nightLit: false, fog, env: null };

        const submit = (lookAt: [vec3, vec3], draw: () => void): void => {
            this.pushTemplate(renderInstManager, viewerInput, build, env, lookAt);
            draw();
            renderInstManager.popTemplate();
        };
        const run = (list: TGRDrawCallInstance[], params: DrawParams): void => {
            for (const dci of list) {
                dci.prepareToRender(renderInstManager, viewerInput, params);
            }
        };

        submit([hiliteRight, hiliteUp], () => {
            if (!vehicle.otherLook) {
                run(build.textured, base);
            }
            if (underside) {
                run(build.underside, base);
            }
            if (!env.viewportMirrored && near && !ghost) {
                run(build.nearDetail, base);
            }
            if (drawHilite) {
                run(build.hilite[env.night ? 1 : 0], { ...base, tileOrigin: [hiliteX & 0xfff, hiliteY & 0xfff] });
            }
        });
        submit(reflectLookAt, () => {
            run(build.body[reflection], {
                ...base,
                lights: { ...lights, dirColor: [0, 0, 0], ambient: [0, 0, 0] },
                env: [env.fog.color[0], env.fog.color[1], env.fog.color[2], envAlpha],
                tileOrigin: [(offset + 2) & 0xfff, 2],
            });
        });
        submit([hiliteRight, hiliteUp], () => {
            const wheel = mat4.create();
            for (let i = 0; i < VEHICLE_WHEELS; i++) {
                mat4.mul(wheel, env.n64ToGL, TGRCar.frameMatrix(pose.wheels[i]));
                mat4.scale(wheel, wheel, [MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]);
                run(build.wheels[env.snow ? 1 : 0], { ...base, model: mat4.clone(wheel) });
            }
        });
    }

    public prepareBeams(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, vehicle: Vehicle, pose: CarPose, env: CarEnvironment): number {
        const build = this.build;
        if (build === null || (!env.night && !env.rain) || vehicle.ghostMode === VEHICLE_GHOST) {
            return 0;
        }
        const p = pose.frame[3];
        if (Math.hypot(p[0] - env.cameraPosition[0], p[1] - env.cameraPosition[1], p[2] - env.cameraPosition[2]) > env.drawDistance) {
            return 0;
        }
        if (vehicle === env.cameraVehicle && (env.bumperView || env.cockpitView)) {
            return 0;
        }
        this.pushTemplate(renderInstManager, viewerInput, build, env, null);
        const params: DrawParams = {
            model: this.modelMatrix(pose, env),
            cullMode: env.mirrored ? GfxCullMode.Front : GfxCullMode.Back,
            lights: { direction: vec3.fromValues(0, 1, 0), dirColor: [0, 0, 0], ambient: [0xff, 0xff, 0xff], ramps: [] },
            ramp: -1,
            nightLit: false,
            fog: env.weatherActive ? env.fog : null,
            env: null,
        };
        for (const dci of build.beams) {
            dci.prepareToRender(renderInstManager, viewerInput, params);
        }
        renderInstManager.popTemplate();
        if (vehicle === env.cameraVehicle) {
            return 0;
        }
        const forward = pose.frame[0];
        const toCamera = vec3.fromValues(env.cameraPosition[0] - p[0] - forward[0], env.cameraPosition[1] - p[1] - forward[1], env.cameraPosition[2] - p[2] - forward[2]);
        const distance = vec3.length(toCamera);
        if (distance === 0) {
            return 0;
        }
        vec3.scale(toCamera, toCamera, 1 / distance);
        const facing = vec3.dot(toCamera, env.cameraForward);
        if (facing >= 0) {
            return 0;
        }
        const glare = -facing * (toCamera[0] * forward[0] + toCamera[1] * forward[1] + toCamera[2] * forward[2]);
        return glare > GLARE_THRESHOLD ? (GLARE_STRENGTH * (glare - GLARE_THRESHOLD)) / (distance * distance) : 0;
    }

    public transformWheelPositions(vehicle: Vehicle): void {
        const vehicleMatrix = TGRCar.frameMatrix(vehicle.frame.m);
        for (let i = 0; i < VEHICLE_WHEELS; i++) {
            const m = vehicle.wheelFrames[i].m;
            for (let row = 0; row < 3; row++) {
                m[row] = [...vehicle.frame.m[row]];
            }
            const p = vec3.transformMat4(vec3.create(), this.wheels[i], vehicleMatrix);
            m[3] = [p[0], p[1], p[2], 1];
        }
    }

    private static frameMatrix(vm: number[][]): mat4 {
        return mat4.fromValues(vm[0][0], vm[0][1], vm[0][2], vm[0][3], vm[1][0], vm[1][1], vm[1][2], vm[1][3], vm[2][0], vm[2][1], vm[2][2], vm[2][3], vm[3][0], vm[3][1], vm[3][2], vm[3][3]);
    }

    private modelMatrix(pose: CarPose, env: CarEnvironment): mat4 {
        const model = mat4.mul(mat4.create(), env.n64ToGL, TGRCar.frameMatrix(pose.frame));
        return mat4.scale(model, model, [MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]);
    }

    private pushTemplate(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, build: CarBuild, env: CarEnvironment, lookAt: [vec3, vec3] | null): void {
        const template = renderInstManager.pushTemplate();
        template.setVertexInput(build.buffers.inputLayout, [{ buffer: build.buffers.vertexBuffer }], { buffer: build.buffers.indexBuffer });
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 8);
        const scene = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(scene, offs, viewerInput.camera.projectionMatrix);
        computeViewMatrix(viewScratch, viewerInput.camera);
        for (const axis of lookAt ?? [vec3.create(), vec3.create()]) {
            const q = [0, 1, 2].map((i) => Math.trunc(Math.min(axis[i] * 128, 127)) / 128);
            vec3.transformMat4(lightDirScratch, q as [number, number, number], env.n64ToGL);
            vec3.transformMat4(lightDirScratch, lightDirScratch, viewScratch);
            vec3.sub(lightDirScratch, lightDirScratch, [viewScratch[12], viewScratch[13], viewScratch[14]]);
            vec3.normalize(lightDirScratch, lightDirScratch);
            offs += fillVec4(scene, offs, lightDirScratch[0], lightDirScratch[1], lightDirScratch[2], 0);
        }
    }

    private destroyBuild(device: GfxDevice): void {
        const build = this.build;
        if (build === null) {
            return;
        }
        device.destroyBuffer(build.buffers.vertexBuffer);
        device.destroyBuffer(build.buffers.indexBuffer);
        for (const handle of build.handles) {
            device.destroyTexture(handle.gfxTexture);
        }
        this.build = null;
    }

    private setModelTiles(g: GfxWriter): void {
        g.setTile(G_IM_FMT_RGBA, G_IM_SIZ_16b, 0, 0, G_TX_LOADTILE, 0, 0, 0, 0, 0, 0, 0);
        g.setTile(G_IM_FMT_RGBA, G_IM_SIZ_4b, 0, 0x1f0, 6, 0, 0, 0, 0, 0, 0, 0);
        g.setTile(G_IM_FMT_RGBA, G_IM_SIZ_4b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
    }

    private setModelTextures(g: GfxWriter): void {
        g.texture(0xffff, 0xffff, 0, 0, 1);
        g.clearGeometryMode(TEXTURE_GEN_BOTH);
        g.tileSync();
        this.setModelTiles(g);
    }

    private drawTexturedTile(g: GfxWriter, index: number): void {
        const texture = this.textures[index];
        const maskS = maskBits(texture.width);
        const maskT = maskBits(texture.height);
        let cms = texture.clampS ? G_TX_CLAMP : G_TX_WRAP;
        if (texture.mirrorS) {
            cms |= G_TX_MIRROR;
        }
        let cmt = texture.clampT ? G_TX_CLAMP : G_TX_WRAP;
        if (texture.mirrorT) {
            cmt |= G_TX_MIRROR;
        }
        g.tileSync();
        g.setTextureImage(G_IM_FMT_RGBA, G_IM_SIZ_16b, 1, texture.image);
        const tmem = this.view.getUint32(TEXTURE_TMEM_RAM & 0xffffff) & 0x1ff;
        g.setTile(G_IM_FMT_RGBA, G_IM_SIZ_16b, 0, tmem, G_TX_LOADTILE, 0, G_TX_WRAP, maskT, 0, G_TX_WRAP, maskS, 0);
        g.loadSync();
        let palette = 0;
        let format: number;
        let size: number;
        if (texture.format === TEXTURE_FORMAT_CI4) {
            g.loadBlock(G_TX_LOADTILE, 0, 0, ((texture.width * texture.height + 3) >> 2) - 1, 0);
            palette = TEXTURE_CI4_PALETTE;
            g.loadSync();
            g.loadTLUTPal16(TEXTURE_CI4_PALETTE, texture.palette);
            g.textureLUT(G_TT_RGBA16);
            format = G_IM_FMT_CI;
            size = G_IM_SIZ_4b;
        } else if (texture.format === TEXTURE_FORMAT_I8) {
            cms = G_TX_CLAMP;
            cmt = G_TX_CLAMP;
            g.loadBlock(G_TX_LOADTILE, 0, 0, ((texture.width * texture.height + 1) >> 1) - 1, 0);
            g.textureLUT(G_TT_NONE);
            format = G_IM_FMT_I;
            size = G_IM_SIZ_8b;
        } else {
            g.loadBlock(G_TX_LOADTILE, 0, 0, texture.width * texture.height - 1, 0);
            g.textureLUT(G_TT_NONE);
            format = G_IM_FMT_RGBA;
            size = G_IM_SIZ_16b;
        }
        const tile = this.view.getUint32(TEXTURE_RENDER_TILE_RAM & 0xffffff) & 7;
        g.setTile(format, size, (texture.width * (4 << size) + 63) >> 6, tmem, tile, palette, cmt, maskT, 0, cms, maskS, 0);
        g.setTileSize(tile, texture.tileS0 * 4 + 2, texture.tileT0 * 4 + 2, texture.tileS1 * 4 + 2, texture.tileT1 * 4 + 2);
        g.texture(0xffff, 0xffff, 0, tile, 1);
    }

    private drawLitParts(g: GfxWriter, blend: number, flags: number, displayList: number): void {
        g.pipeSync();
        g.cycleType(G_CYC_2CYCLE);
        g.renderMode(blend, flags);
        g.combine(COMBINE_LIT);
        g.texture(0xffff, 0xffff, 0, 0, 1);
        this.setModelTiles(g);
        g.displayList(displayList);
    }

    private createBuild(device: GfxDevice, cache: GfxRenderCache, weatherActive: boolean): CarBuild {
        const sharedOutput = new RSPSharedOutput();
        const rsp = new RSPState(this.segmentBuffers, sharedOutput);
        rsp.gSPClearGeometryMode(0xffffffff);
        rsp.gDPSetOtherModeH(0, 32, TRACK_OTHER_MODE_H);
        rsp.gSPTexture(true, 0, 0, 0xffff, 0xffff);
        rsp.markStateChanged();
        const blend = weatherActive ? BLEND_FOG : BLEND_PLAIN;
        const flags = FLAGS_NEAR;
        const dls = this.displayLists;
        let address = SCRATCH_DL_RAM;
        const pass = (emit: (g: GfxWriter) => void): [number, number] => {
            const g = new GfxWriter(this.view, address);
            emit(g);
            g.end();
            address = g.address;
            const start = rsp.drawCalls.length;
            runDL_F3DEX(rsp, g.start);
            return [start, rsp.drawCalls.length];
        };

        const textured = pass((g) => {
            g.pipeSync();
            g.textureLOD(G_TL_LOD);
            g.setGeometryMode(GEOMETRY_MODE);
            if (weatherActive) {
                g.setGeometryMode(RSP_Geometry.G_FOG);
            }
            g.cycleType(G_CYC_2CYCLE);
            g.renderMode(blend, flags);
            g.combine(COMBINE_TEXEL_SHADE);
            g.textureFilter(G_TF_BILERP);
            g.textureLOD(G_TL_TILE);
            g.clearGeometryMode(TEXTURE_GEN_BOTH);
            g.loadTLUTPal16(SHADE_PALETTE, SHADE_PALETTE_RAM);
            this.setModelTextures(g);
            g.renderMode(blend, flags);
            g.combine(COMBINE_TEXEL_SHADE);
            g.textureLUT(G_TT_NONE);
            g.combine(COMBINE_TEXTURED);
            g.clearGeometryMode(RSP_Geometry.G_TEXTURE_GEN);
            g.textureFilter(G_TF_BILERP);
            g.displayList(dls[VEHICLE_DL_TEXTURED]);
            this.setModelTextures(g);
            g.textureLOD(G_TL_LOD);
            g.texture(0xffff, 0xffff, 0, 0, 1);
            this.setModelTiles(g);
        });
        const underside = pass((g) => {
            this.drawTexturedTile(g, UNDERSIDE_TEXTURE);
            this.drawLitParts(g, blend, flags, dls[VEHICLE_DL_UNDERSIDE]);
        });
        const nearDetail = pass((g) => {
            this.drawTexturedTile(g, NEAR_DETAIL_TEXTURE);
            this.drawLitParts(g, blend, flags, dls[VEHICLE_DL_NEAR_DETAIL]);
        });
        const hilite = HILITE_TEXTURES_RAM.map((texture) =>
            pass((g) => {
                g.clearGeometryMode(TEXTURE_GEN_BOTH);
                g.pipeSync();
                g.cycleType(G_CYC_1CYCLE);
                g.setGeometryMode(RSP_Geometry.G_TEXTURE_GEN);
                g.texture(0x0f80, 0x0f80, 0, 0, 1);
                g.textureFilter(G_TF_BILERP);
                g.primColor(0, 0, 0xffffccff);
                g.combine(COMBINE_HILITE);
                g.renderMode(HILITE_RENDER_MODE[0], HILITE_RENDER_MODE[1]);
                g.tileSync();
                g.textureLUT(G_TT_NONE);
                g.loadTextureBlock4b(texture, G_IM_FMT_I, HILITE_SIZE, HILITE_SIZE, 0, G_TX_WRAP, G_TX_WRAP, 6, 6, 0, 0);
                g.setTileSize(0, 0, 0, (HILITE_SIZE - 1) * 4, (HILITE_SIZE - 1) * 4);
                g.displayList(dls[VEHICLE_DL_HIGHLIGHTED]);
            }),
        );
        const body = nArray(4, (k) =>
            pass((g) => {
                const texture = this.view.getUint32((REFLECTION_TEXTURES_RAM & 0xffffff) + k * 4);
                const tlut = this.view.getUint32((REFLECTION_TLUTS_RAM & 0xffffff) + k * 4);
                g.pipeSync();
                g.cycleType(G_CYC_2CYCLE);
                g.setGeometryMode(TEXTURE_GEN_BOTH);
                g.texture(0x0800, 0x1000, 0, 0, 1);
                g.textureFilter(G_TF_BILERP);
                g.combine(COMBINE_REFLECT);
                g.envColor(0xffffffff);
                g.renderMode(blend, flags);
                g.tileSync();
                g.textureLUT(G_TT_NONE);
                g.loadTextureBlock4b(texture, G_IM_FMT_CI, 32, 128, 0, G_TX_WRAP, G_TX_WRAP, 5, 7, 15, 15);
                g.loadSync();
                g.loadTLUTPal16(0, tlut);
                g.textureLUT(G_TT_RGBA16);
                g.setTileSize(0, 2, 2, 126, 510);
                g.pipeSync();
                g.displayList(dls[VEHICLE_DL_BODY]);
                g.clearGeometryMode(RSP_Geometry.G_TEXTURE_GEN);
                g.textureFilter(G_TF_BILERP);
                g.textureLUT(G_TT_NONE);
            }),
        );
        const wheels = [VEHICLE_WHEEL_DL_NORMAL, VEHICLE_WHEEL_DL_SNOW].map((k) =>
            pass((g) => {
                g.pipeSync();
                g.cycleType(G_CYC_2CYCLE);
                g.combine(COMBINE_TEXEL_SHADE);
                g.renderMode(blend, FLAGS_FAR);
                this.setModelTextures(g);
                g.displayList(this.wheelDisplayLists[k]);
            }),
        );
        const beams = pass((g) => {
            this.drawTexturedTile(g, HEADLIGHT_BEAM_TEXTURE);
            g.pipeSync();
            g.cycleType(G_CYC_1CYCLE);
            g.combine(COMBINE_BEAMS);
            g.renderMode(BEAM_RENDER_MODE[0], BEAM_RENDER_MODE[1]);
            g.displayList(dls[VEHICLE_DL_HEADLIGHT_BEAMS]);
        });

        const buffers = createGeometryBuffers(device, cache, sharedOutput, GfxBufferFrequencyHint.Static);
        const handleMap = new Map<string, TextureHandle>();
        const instances = ([start, end]: [number, number]): TGRDrawCallInstance[] =>
            rsp.drawCalls
                .slice(start, end)
                .filter((dc) => dc.indexCount > 0)
                .map(
                    (dc) =>
                        new TGRDrawCallInstance(
                            dc,
                            dc.textures.map((levels, slot) => createTextureHandle(device, cache, sharedOutput, handleMap, levels, dc.tiles[slot])),
                            sharedOutput,
                            false,
                        ),
                );
        return {
            weatherActive,
            sharedOutput,
            buffers,
            textured: instances(textured),
            underside: instances(underside),
            nearDetail: instances(nearDetail),
            hilite: hilite.map(instances),
            body: body.map(instances),
            wheels: wheels.map(instances),
            beams: instances(beams),
            handles: [...handleMap.values()],
        };
    }

    private setMaterialColor(red: number, green: number, blue: number): void {
        for (let i = 0; i < VEHICLE_MATERIALS; i++) {
            const texture = this.textures[this.materials[i]];
            if (texture.palette === 0 || texture.format !== TEXTURE_FORMAT_CI4) {
                continue;
            }
            const p = texture.palette & 0xffffff;
            this.view.setUint16(p, (this.view.getUint16(p + i * 2) & 1) | (red << 11) | (green << 6) | (blue << 1));
            this.view.setUint16(p + 2, (this.view.getUint16(p + i * 2) & 1) | ((red & 0x1e) << 10) | ((green & 0x1e) << 5) | (blue & 0x1e));
        }
    }

    private updatePalettes(device: GfxDevice, build: CarBuild, vehicle: Vehicle, lit: boolean): void {
        const braking = ((vehicle.input?.buttons ?? 0) & (INPUT_BRAKE | INPUT_EBRAKE)) !== 0;
        const reversing = vehicle.throttle < 0;
        const [r, g, b] = vehicle.color;
        const key = `${r},${g},${b},${lit},${braking},${reversing}`;
        if (key === this.paletteKey) {
            return;
        }
        this.paletteKey = key;
        this.setMaterialColor(r >> 3, g >> 3, b >> 3);
        const headlights = this.textures[this.materials[VEHICLE_MATERIAL_HEADLIGHTS]].palette;
        if (headlights !== 0) {
            for (let i = HEADLIGHT_FIRST_ENTRY; i < HEADLIGHT_FIRST_ENTRY + HEADLIGHT_ENTRIES; i++) {
                const o = (headlights & 0xffffff) + i * 2;
                const entry = this.view.getUint16(o);
                this.view.setUint16(o, lit ? entry & ~1 : entry | 1);
            }
        }
        const rear = this.textures[this.materials[VEHICLE_MATERIAL_REAR_LIGHTS]].palette;
        if (rear !== 0) {
            const p = rear & 0xffffff;
            const set = (i: number, value: number): void => this.view.setUint16(p + i * 2, value);
            const get = (i: number): number => this.view.getUint16(p + i * 2);
            if (lit) {
                set(15, 0x7000);
                set(10, 0x9082);
            } else {
                set(15, 0x9001);
                set(10, 0xa001);
            }
            if (braking) {
                set(14, 0xc000);
                set(13, 0xc000);
                set(9, 0xf904);
                set(8, 0xf904);
            } else {
                set(14, 0x9001);
                set(9, 0xa001);
                set(13, get(15));
                set(8, get(10));
            }
            set(12, 0x7981);
            set(7, 0x9241);
            if (reversing) {
                set(11, 0xb5ac);
                set(6, 0xfffe);
            } else {
                set(11, 0xad6b);
                set(6, 0xc631);
            }
        }
        const textures = build.sharedOutput.textureCache.textures;
        const modelStart = MODEL_RAM & 0xffffff;
        for (const handle of build.handles) {
            const touched = handle.levels.some((l) => {
                const t = textures[l];
                const palette = t.dramPalAddr & 0xffffff;
                return t.dramPalAddr !== 0 && palette >= modelStart && palette < modelStart + MODEL_SIZE;
            });
            if (!touched) {
                continue;
            }
            const pixels = handle.levels.map((l) => {
                const t = textures[l];
                return RDP.translateTileTexture(this.segmentBuffers, t.dramAddr, t.dramPalAddr, t.tile, true, true).pixels;
            });
            device.uploadTextureData(handle.gfxTexture, 0, pixels);
        }
    }
}
