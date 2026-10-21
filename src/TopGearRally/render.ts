import { mat4, vec3 } from "gl-matrix";
import * as RDP from "../Common/N64/RDP.js";
import { TextFilt } from "../Common/N64/Image.js";
import { calcTextureScaleForShift } from "../Common/N64/RSP.js";
import { F3DEX_Program } from "../BanjoKazooie/render.js";
import { Camera, CameraController, computeViewMatrix } from "../Camera.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import {
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
    GfxRenderPass,
    GfxSampler,
    GfxTexFilterMode,
    GfxTexture,
    GfxVertexBufferFrequency,
    makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { TextureMapping } from "../TextureHolder.js";
import { SceneGfx, ViewerRenderInput, Texture as ViewerTexture } from "../viewer.js";
import * as UI from "../ui.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { nArray } from "../util.js";
import {
    castCameraRay,
    TRACK_INSTANCE_SHELTER,
    TEXTURE_FORMAT_CI4,
    TEXTURE_FORMAT_SNOW_STILL,
    TEXTURE_ROM_NONE,
    TGRTrack,
    TRACK_INSTANCE_ARCADE,
    TRACK_INSTANCE_CLEAR_SKY,
    TRACK_INSTANCE_DARK_OR_WET,
    TRACK_INSTANCE_LIGHT_RAMP,
    TRACK_INSTANCE_NIGHT_LIT,
    TRACK_INSTANCE_RAMPED,
    TRACK_INSTANCE_TRANSLUCENT,
    TRACK_INSTANCE_TWO_SIDED,
    TRACK_INSTANCE_UNROTATED,
    TrackSpecialType,
} from "./data.js";
import { TGRWeatherEffects, WeatherCamera } from "./weather.js";
import type { CarEnvironment } from "./vehiclerender.js";
import type { RaceCarsView, TGRRaceDriver } from "./racescene.js";
import { HudAssets, TGRHud, rearViewMirrorRect } from "./hud.js";

const MIRROR_FAR_SCALE = 0.3;
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./text.js";
import { VEHICLE_CAMERA_MIRROR } from "./sim/types.js";
import { ShadowSurface, TGRShadows } from "./shadow.js";
import { TGRModel } from "./model.js";
import { TGREffects } from "./effectsrender.js";

const MODEL_ANIMATION_REPEAT = 0x1;
const MODEL_ANIMATION_BOUNCE = 0x2;
const START_LIGHTS_SCALE = 1 / 1024;
const START_LIGHTS_HEIGHT = 2;
const START_LIGHTS_ACROSS = -0.3;
const START_LIGHTS_ALONG = -0.6;

const VEHICLE_GHOST = 2;
const SHADOW_MIN_DOT = 2;
const MAX_SHADOW_CASTERS = 4;
const TRACK_INSTANCE_NO_SHADOW = 0x0200;
import { screenBox } from "./splash.js";
import { G } from "./sim/globals.js";
import { DrawCall, LodMode, RSP_Geometry, RSPSharedOutput, RSPState, Vertex, getImageFormatString, runDL_F3DEX } from "./f3dex.js";

const WORLD_SCALE = 100;
const CAMERA_NEAR = 2.4;
const CAMERA_FAR = 400;
const GAME_FRAMES_PER_SECOND = 30;
const SKY_DEPTH_SCALE = 0.99;
const DESERT_HAZE_Y = 1024;
const MIRRORED_TRACK_OFFSET = 5;
const TRACK_DESERT = 0;
const TRACK_MOUNTAIN = 1;
const TRACK_COASTLINE = 2;
const PRIM_MIN_LEVEL = 0x17;
const LIGHT_DIRECTION_SCALE = 120;
const N64_SCREEN_HEIGHT = 240;
const GRID_ROW_SPACING = 8;
const GRID_HEIGHT = 0.1;
const CHASE_DISTANCE = 11;
const CHASE_HEIGHT = 2.4;
const LOOK_AT_HEIGHT = 0.66;
const LOOK_AHEAD_START = 2;
const FLASH_COLOR = [0xf0, 0xf8, 0xff];

const G_SETOTHERMODE_L = 0xb9;
const G_ENDDL = 0xb8;
const G_SETCOMBINE = 0xfc;
const G_SETPRIMCOLOR = 0xfa;
const G_SETENVCOLOR = 0xfb;

const RENDER_MODE_TRANSLUCENT_ROW = 3;
const RENDER_MODE_COMMAND = 0xb900031d;
const RENDER_MODES = [
    [0x0c192038, 0x0c192038, 0xc8112038, 0xc8112038],
    [0x0c192078, 0x0c192078, 0xc8112078, 0xc8112078],
    [0x0c193078, 0x0c193078, 0xc8113078, 0xc8113078],
    [0x2c184b58, 0x2c184b58, 0xe8104b58, 0xe8104b78],
    [0x0c1849d8, 0x0c1849d8, 0xc81049d8, 0xc81049d8],
    [0x0c1848f8, 0x0c1849d8, 0xc81049d8, 0xc81048f8],
];
const CLEAR_COMBINE_PATCH = [0xfc127e08, 0xf3fff2f8, 0xfc26a004, 0x1ffc93f8];
const SNOW_TINT_COMBINES = [
    [0xfcffa004, 0xfffd93f8],
    [0xfc50fe04, 0x3ffdf3f8],
];
const SNOW_PRIM_COLOR = 0x60789000;
const SNOW_ENV_COLOR = 0x8c9ca800;

export const TRACK_OTHER_MODE_H =(1 << 20) | (1 << 19) | (1 << 16) | (2 << 12) | (6 << 9);
const SKY_OTHER_MODE_H = (1 << 19) | (2 << 12) | (6 << 9);
const TRACK_RENDER_MODE_CLEAR = 0x0c192038;
const TRACK_RENDER_MODE_FOG = 0xc8112038;
const SKY_RENDER_MODE = 0x0f0a4200;
const TRACK_GEOMETRY_MODE =
    RSP_Geometry.G_CULL_BACK | RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_LIGHTING | RSP_Geometry.G_SHADING_SMOOTH;
const BLENDER_FOG_C1 = 3;

enum Weather {
    Sunny,
    Fog,
    Rain,
    Snow,
    Night,
}

interface WeatherState {
    active: boolean;
    rain: boolean;
    snow: boolean;
    night: boolean;
}

function weatherState(weather: Weather): WeatherState {
    return {
        active: weather !== Weather.Sunny,
        rain: weather === Weather.Rain,
        snow: weather === Weather.Snow,
        night: weather === Weather.Night,
    };
}

export function combineLERP(c0: number[], a0: number[], c1: number[], a1: number[]): [number, number] {
    const w0 =
        ((c0[0] & 0xf) << 20) |
        ((c0[2] & 0x1f) << 15) |
        ((a0[0] & 0x7) << 12) |
        ((a0[2] & 0x7) << 9) |
        ((c1[0] & 0xf) << 5) |
        (c1[2] & 0x1f);
    const w1 =
        ((c0[1] & 0xf) << 28) |
        ((c1[1] & 0xf) << 24) |
        ((a1[0] & 0x7) << 21) |
        ((a1[2] & 0x7) << 18) |
        ((c0[3] & 0x7) << 15) |
        ((a0[1] & 0x7) << 12) |
        ((a0[3] & 0x7) << 9) |
        ((c1[3] & 0x7) << 6) |
        ((a1[1] & 0x7) << 3) |
        (a1[3] & 0x7);
    return [w0 >>> 0, w1 >>> 0];
}

export const TRACK_COMBINE = combineLERP([2, 1, 13, 1], [2, 1, 0, 1], [0, 15, 4, 7], [7, 7, 7, 0]);
const SKY_COMBINE_FOG = combineLERP([1, 5, 12, 5], [7, 7, 7, 1], [1, 5, 12, 5], [7, 7, 7, 1]);
const SKY_COMBINE_CLEAR = combineLERP([15, 15, 31, 1], [7, 7, 7, 4], [15, 15, 31, 1], [7, 7, 7, 4]);

export interface FogState {
    color: [number, number, number];
    intensity: number;
    min: number;
    max: number;
}

export interface LightState {
    direction: vec3;
    dirColor: [number, number, number];
    ambient: [number, number, number];
    ramps: [number, number, number][];
}

function lightRamp(light: number): number[] {
    return [light >> 2, light >> 1, (light >> 1) + (light >> 2), light];
}

function patchSource(source: string, from: string, to: string): string {
    if (!source.includes(from)) {
        throw new Error(`TGR: shader patch target missing: ${from}`);
    }
    return source.replace(from, to);
}

const LOD_SAMPLING = `
vec4 TGR_Fetch(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord, float t_Level) {
#ifdef TGR_POINT
    return textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord, t_Level);
#else
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), int(t_Level)));
    vec2 t_Offs = fract(t_TexCoord * t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - t_Offs / t_Size, t_Level);
    vec4 t_S1 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size, t_Level);
    vec4 t_S2 = textureLod(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size, t_Level);
    return t_S0 + abs(t_Offs.x) * (t_S1 - t_S0) + abs(t_Offs.y) * (t_S2 - t_S0);
#endif
}

vec4 TGR_SampleLod() {
    vec2 t_BaseSize = vec2(textureSize(u_Texture0, 0));
    vec2 t_Dx = dFdx(v_TexCoord.xy * t_BaseSize);
    vec2 t_Dy = dFdy(v_TexCoord.xy * t_BaseSize);
    float t_Lod = max(max(abs(t_Dx.x), abs(t_Dx.y)), max(abs(t_Dy.x), abs(t_Dy.y))) * u_MiscComb.y;
    float t_MaxLevel = float(TGR_MAX_LEVEL);
    bool t_Magnify = t_Lod < 1.0;
#if TGR_LOD == 2
    if (t_Magnify) {
        vec4 t_Detail = TGR_Fetch(PP_SAMPLER_2D(u_Texture1), v_TexCoord.zw, 0.0);
        vec4 t_Base = TGR_Fetch(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy, 0.0);
        return mix(t_Detail, t_Base, max(t_Lod, float(TGR_MIN_LEVEL) / 32.0));
    }
#else
    if (t_Magnify || t_MaxLevel == 0.0) {
        return TGR_Fetch(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy, 0.0);
    }
#endif
    float t_Tile = floor(log2(t_Lod));
    if (t_Tile >= t_MaxLevel) {
        return TGR_Fetch(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy, t_MaxLevel);
    }
    float t_Frac = t_Lod / exp2(t_Tile) - 1.0;
    vec4 t_Near = TGR_Fetch(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy, t_Tile);
    vec4 t_Far = TGR_Fetch(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy, t_Tile + 1.0);
    return mix(t_Near, t_Far, t_Frac);
}

void main() {`;

class TGRProgram extends F3DEX_Program {
    public constructor(dc: DrawCall, levels: number) {
        super(dc.DP_OtherModeH, dc.DP_OtherModeL, dc.DP_Combine, 0.5, [], 1);
        this.defines.set("BONE_MATRIX_COUNT", "1");
        this.defines.set("USE_FOG", "1");
        this.defines.set("EXTRA_COMBINE", "1");
        if (dc.textures.length > 0) {
            this.defines.set("USE_TEXTURE", "1");
        }
        if (dc.SP_GeometryMode & RSP_Geometry.G_SHADE) {
            this.defines.set("USE_VERTEX_COLOR", "1");
        }
        if (dc.SP_GeometryMode & RSP_Geometry.G_LIGHTING) {
            this.defines.set("LIGHTING", "1");
            this.defines.set("PARAMETERIZED_LIGHTING", "1");
        }
        this.vert = patchSource(
            this.vert,
            "v_FogFactor = saturate(((-t_PositionView.z) - u_FogParam.x) / (u_FogParam.y - u_FogParam.x));",
            "v_FogFactor = saturate((u_FogParam.x - u_FogParam.y / max(-t_PositionView.z, 1e-4)) * u_FogParam.z + u_FogParam.w);",
        );
        this.vert = patchSource(
            this.vert,
            "u_AmbientColor.rgb, a_Color.a)",
            "u_AmbientColor.rgb, a_Color.a); v_Color.rgb = min(v_Color.rgb, vec3(1.0))",
        );
        if (dc.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN) {
            this.defines.set("TEXTURE_GEN", "1");
            if (dc.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR) {
                this.defines.set("TEXTURE_GEN_LINEAR", "1");
            }
            this.vert = patchSource(this.vert, "v_TexCoord.xy = acos(t_Normal.xy)/radians(180.0);", "v_TexCoord.xy = acos(t_Normal.xy) * 325.94931;");
            this.vert = patchSource(this.vert, "v_TexCoord.xy = (t_Normal.xy + vec2(1.0))/2.0;", "v_TexCoord.xy = (t_Normal.xy + vec2(1.0)) * 512.0;");
            this.vert = patchSource(
                this.vert,
                "v_TexCoord.zw = v_TexCoord.xy;",
                "v_TexCoord = vec4(UnpackMatrix(u_TexMatrix[0]) * vec4(v_TexCoord.xy, 1.0, 1.0), UnpackMatrix(u_TexMatrix[1]) * vec4(v_TexCoord.xy, 1.0, 1.0));",
            );
        }
        if (dc.lodMode !== LodMode.Tile && dc.textures.length > 0) {
            this.defines.set("TGR_LOD", dc.lodMode === LodMode.Detail ? "2" : "1");
            this.defines.set("TGR_MAX_LEVEL", `${levels - 1}`);
            this.defines.set("TGR_MIN_LEVEL", `${dc.minLevel}`);
            if (RDP.getTextFiltFromOtherModeH(dc.DP_OtherModeH) === TextFilt.G_TF_POINT) {
                this.defines.set("TGR_POINT", "1");
            }
            this.frag = patchSource(this.frag, "void main() {", LOD_SAMPLING);
            this.frag = patchSource(
                this.frag,
                "t_Tex0 = Texture2D_N64(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy);",
                "t_Tex0 = TGR_SampleLod();",
            );
            this.frag = patchSource(
                this.frag,
                "t_Tex1 = Texture2D_N64(PP_SAMPLER_2D(u_Texture1), v_TexCoord.zw);",
                "t_Tex1 = t_Tex0;",
            );
        }
    }
}

export interface TextureHandle {
    levels: number[];
    gfxTexture: GfxTexture;
    sampler: GfxSampler;
}

export interface DrawParams {
    view?: mat4;
    model: mat4;
    cullMode: GfxCullMode;
    lights: LightState | null;
    ramp: number;
    nightLit: boolean;
    fog: FogState | null;
    env: [number, number, number, number] | null;
    tileOrigin?: [number, number];
}

export interface GeometryBuffers {
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    inputLayout: GfxInputLayout;
    vertexData: Float32Array;
}

export function fillVertexData(data: Float32Array, vertices: Vertex[]): void {
    vertices.forEach((v, i) => {
        data.set([v.x, v.y, v.z, 0, v.tx, v.ty, v.c0, v.c1, v.c2, v.a], i * 10);
    });
}

export function createGeometryBuffers(
    device: GfxDevice,
    cache: GfxRenderCache,
    sharedOutput: RSPSharedOutput,
    frequency: GfxBufferFrequencyHint,
): GeometryBuffers {
    const vertexData = new Float32Array(sharedOutput.vertices.length * 10);
    fillVertexData(vertexData, sharedOutput.vertices);
    const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, frequency, vertexData.buffer);
    const indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, new Uint32Array(sharedOutput.indices).buffer);
    const inputLayout = cache.createInputLayout({
        indexBufferFormat: GfxFormat.U32_R,
        vertexBufferDescriptors: [{ byteStride: 10 * 4, frequency: GfxVertexBufferFrequency.PerVertex }],
        vertexAttributeDescriptors: [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 4 },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 4 },
        ],
    });
    return { vertexBuffer, indexBuffer, inputLayout, vertexData };
}

export function createTextureHandle(
    device: GfxDevice,
    cache: GfxRenderCache,
    sharedOutput: RSPSharedOutput,
    handleMap: Map<string, TextureHandle>,
    requested: number[],
    tile: RDP.TileState,
): TextureHandle {
    const textures = sharedOutput.textureCache.textures;
    const base = textures[requested[0]];
    const levels = [requested[0]];
    for (let i = 1; i < requested.length; i++) {
        const t = textures[requested[i]];
        if (t.width !== Math.max(1, base.width >> i) || t.height !== Math.max(1, base.height >> i)) {
            break;
        }
        levels.push(requested[i]);
    }
    const key = `${levels.join(",")}:${tile.cms}:${tile.cmt}:${tile.masks}:${tile.maskt}`;
    const existing = handleMap.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, base.width, base.height, levels.length));
    device.setResourceName(gfxTexture, base.name);
    device.uploadTextureData(gfxTexture, 0, levels.map((l) => textures[l].pixels));
    const masked = new RDP.TileState();
    masked.copy(base.tile);
    masked.cms = tile.cms;
    masked.cmt = tile.cmt;
    const sampler = cache.createSampler({
        wrapS: RDP.translateCM(RDP.getMaskedCMS(masked)),
        wrapT: RDP.translateCM(RDP.getMaskedCMT(masked)),
        minFilter: GfxTexFilterMode.Point,
        magFilter: GfxTexFilterMode.Point,
        mipFilter: GfxMipFilterMode.Nearest,
        minLOD: 0,
        maxLOD: levels.length - 1,
    });
    const handle: TextureHandle = { levels, gfxTexture, sampler };
    handleMap.set(key, handle);
    return handle;
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const lightDirScratch = vec3.create();
const bindingLayouts = [{ numUniformBuffers: 3, numSamplers: 2 }];

export class TGRDrawCallInstance {
    private readonly program: TGRProgram;
    private gfxProgram: GfxProgram | null = null;
    private readonly megaState: Partial<GfxMegaStateDescriptor>;
    private readonly textureMappings = nArray(2, () => new TextureMapping());
    private readonly texMatrices = nArray(2, () => mat4.create());
    private readonly texSizes = nArray(2, () => [1, 1]);
    private readonly lighting: boolean;
    private readonly fog: boolean;

    public constructor(
        public readonly dc: DrawCall,
        handles: TextureHandle[],
        sharedOutput: RSPSharedOutput,
        isSky: boolean,
    ) {
        const textures = sharedOutput.textureCache.textures;
        for (let i = 0; i < handles.length && i < 2; i++) {
            this.textureMappings[i].gfxTexture = handles[i].gfxTexture;
            this.textureMappings[i].gfxSampler = handles[i].sampler;
            const entry = textures[handles[i].levels[0]];
            const tile = dc.tiles[i];
            const m = this.texMatrices[i];
            m[0] = (dc.SP_TextureState.s * calcTextureScaleForShift(tile.shifts)) / entry.width;
            m[5] = (dc.SP_TextureState.t * calcTextureScaleForShift(tile.shiftt)) / entry.height;
            m[12] = (0.5 - tile.uls / 4) / entry.width;
            m[13] = (0.5 - tile.ult / 4) / entry.height;
            this.texSizes[i] = [entry.width, entry.height];
        }
        this.program = new TGRProgram(dc, handles.length > 0 ? handles[0].levels.length : 1);
        let renderMode = dc.DP_OtherModeL;
        if (((dc.DP_OtherModeH >>> 20) & 0x03) === 0) {
            renderMode = ((renderMode & ~0x33330000) | ((renderMode & 0xcccc0000) >>> 2)) >>> 0;
        }
        this.megaState = RDP.translateRenderMode(renderMode);
        if (isSky) {
            this.megaState.depthCompare = GfxCompareMode.Always;
            this.megaState.depthWrite = false;
        }
        this.lighting = (dc.SP_GeometryMode & RSP_Geometry.G_LIGHTING) !== 0;
        this.fog = (dc.SP_GeometryMode & RSP_Geometry.G_FOG) !== 0 && dc.DP_OtherModeL >>> 30 === BLENDER_FOG_C1;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, params: DrawParams): void {
        this.gfxProgram ??= renderInstManager.gfxRenderCache.createProgram(this.program);
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaState);
        renderInst.setMegaStateFlags({ cullMode: params.cullMode });
        renderInst.setDrawCount(this.dc.indexCount, this.dc.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 16 + (this.lighting ? 12 : 0) + 8);
        const d = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);
        if (params.view !== undefined) {
            mat4.copy(viewMatrixScratch, params.view);
        } else {
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);
        }
        mat4.mul(modelViewScratch, viewMatrixScratch, params.model);
        offs += fillMatrix4x3(d, offs, modelViewScratch);
        const origin = params.tileOrigin;
        if (origin !== undefined) {
            const m = this.texMatrices[0];
            m[12] = (0.5 - origin[0] / 4) / this.texSizes[0][0];
            m[13] = (0.5 - origin[1] / 4) / this.texSizes[0][1];
        }
        offs += fillMatrix4x2(d, offs, this.texMatrices[0]);
        offs += fillMatrix4x2(d, offs, this.texMatrices[1]);
        if (this.lighting) {
            const lights = params.lights;
            let dir: number[] = [0, 0, 0];
            let ambient: number[] = [0, 0, 0];
            if (lights !== null) {
                dir = lights.dirColor;
                ambient = lights.ambient;
                if (params.ramp >= 0) {
                    dir = params.nightLit ? lights.dirColor.map((c) => (c >> 1) & 0x7f) : [0, 0, 0];
                    ambient = lights.ramps[params.ramp];
                }
                vec3.transformMat4(lightDirScratch, lights.direction, viewMatrixScratch);
                vec3.sub(lightDirScratch, lightDirScratch, [viewMatrixScratch[12], viewMatrixScratch[13], viewMatrixScratch[14]]);
                vec3.normalize(lightDirScratch, lightDirScratch);
            }
            offs += fillVec4(d, offs, dir[0] / 0xff, dir[1] / 0xff, dir[2] / 0xff, 0);
            offs += fillVec4(d, offs, lightDirScratch[0], lightDirScratch[1], lightDirScratch[2], 0);
            offs += fillVec4(d, offs, ambient[0] / 0xff, ambient[1] / 0xff, ambient[2] / 0xff, 1);
        }
        const fog = this.fog ? params.fog : null;
        if (fog !== null) {
            const range = fog.max - fog.min;
            const scale = Math.trunc(128000 / range);
            const offset = Math.trunc(((500 - fog.min) * 256) / range);
            offs += fillVec4(
                d,
                offs,
                (CAMERA_FAR + CAMERA_NEAR) / (CAMERA_FAR - CAMERA_NEAR),
                ((2 * CAMERA_FAR * CAMERA_NEAR) / (CAMERA_FAR - CAMERA_NEAR)) * WORLD_SCALE,
                scale / 0xff,
                offset / 0xff,
            );
            fillVec4(d, offs, fog.color[0] / 0xff, fog.color[1] / 0xff, fog.color[2] / 0xff, 1);
        } else {
            offs += fillVec4(d, offs, 0, 0, 0, 0);
            fillVec4(d, offs, 0, 0, 0, 0);
        }

        let comb = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 12);
        const c = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const prim = this.dc.DP_PrimColor;
        comb += fillVec4(c, comb, prim[0], prim[1], prim[2], prim[3]);
        const env = params.env;
        if (env !== null) {
            comb += fillVec4(c, comb, env[0] / 0xff, env[1] / 0xff, env[2] / 0xff, env[3] / 0xff);
        } else {
            const e = this.dc.DP_EnvColor;
            comb += fillVec4(c, comb, e[0], e[1], e[2], e[3]);
        }
        fillVec4(c, comb, 0, N64_SCREEN_HEIGHT / viewerInput.backbufferHeight, 0, 0);
        renderInstManager.submitRenderInst(renderInst);
    }
}

export type RaceCars = RaceCarsView;

const SUBLIST_INDENT = "16px";

function panelLabel(text: string): HTMLElement {
    const label = document.createElement("div");
    label.textContent = text;
    label.style.fontWeight = "bold";
    label.style.marginTop = "6px";
    return label;
}

class SceneLists {
    public readonly sky = new GfxRenderInstList(null);
    public readonly opaque = new GfxRenderInstList(null);
    public readonly translucent = new GfxRenderInstList(null);
    public readonly car = new GfxRenderInstList(null);
    public readonly beam = new GfxRenderInstList(null);
    public readonly overlay = new GfxRenderInstList(null);
    public carsAfterTranslucent = false;

    public draw(cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        this.sky.drawOnPassRenderer(cache, passRenderer);
        this.opaque.drawOnPassRenderer(cache, passRenderer);
        if (!this.carsAfterTranslucent) {
            this.car.drawOnPassRenderer(cache, passRenderer);
        }
        this.translucent.drawOnPassRenderer(cache, passRenderer);
        if (this.carsAfterTranslucent) {
            this.car.drawOnPassRenderer(cache, passRenderer);
        }
        this.beam.drawOnPassRenderer(cache, passRenderer);
        this.overlay.drawOnPassRenderer(cache, passRenderer);
    }

    public reset(): void {
        for (const list of [this.sky, this.opaque, this.translucent, this.car, this.beam, this.overlay]) {
            list.reset();
        }
    }
}

interface InstanceDraw {
    index: number;
    drawCalls: TGRDrawCallInstance[];
    translucent: boolean;
}

class TGRTextureHolder implements UI.TextureListHolder {
    public textureNames: string[] = [];
    public onnewtextures: (() => void) | null = null;
    private handles: TextureHandle[] = [];

    public setTextures(handles: TextureHandle[], sharedOutput: RSPSharedOutput): void {
        this.handles = handles;
        this.textureNames = handles.map((h, i) => {
            const t = sharedOutput.textureCache.textures[h.levels[0]];
            return `${i}: ${getImageFormatString(t.tile.fmt, t.tile.siz)} ${t.width}x${t.height}${h.levels.length > 1 ? ` (${h.levels.length} levels)` : ""}`;
        });
        this.onnewtextures?.();
    }

    public getViewerTexture(i: number): Promise<ViewerTexture> {
        return Promise.resolve({ gfxTexture: this.handles[i].gfxTexture });
    }
}

interface Build {
    ram: Uint8Array;
    segmentBuffers: ArrayBufferSlice[];
    sharedOutput: RSPSharedOutput;
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    inputLayout: GfxInputLayout;
    handles: TextureHandle[];
    instances: InstanceDraw[];
    sky: TGRDrawCallInstance[];
    streamedFrames: Int32Array;
    streamedSnowMode: number;
}

interface Airplane {
    instance: number;
    left: number;
    right: number;
    nodeCount: number;
    node: number;
    distance: number;
    segmentLength: number;
    dir: vec3;
    dirPrev: vec3;
    dirNext: vec3;
    scale: number;
}

function normalizeOrUp(v: vec3): vec3 {
    const length = vec3.length(v);
    if (length === 0) {
        return vec3.set(v, 0, 0, 1);
    }
    return vec3.scale(v, v, 1 / length);
}

export class TGRRenderer implements SceneGfx {
    public textureHolder = new TGRTextureHolder();

    private readonly renderHelper: GfxRenderHelper;
    private readonly mainLists = new SceneLists();
    private readonly mirrorLists = new SceneLists();
    private lists = this.mainLists;
    private cullFlipped = false;
    public raceCars: RaceCars | null = null;
    public raceDriver: TGRRaceDriver | null = null;
    public gameCamera = false;
    private readonly weatherEffects: TGRWeatherEffects;
    private gameFrames = 0;
    private readonly n64ToGL = mat4.create();
    private gameTrackId = 0;
    public showCars = true;
    private reflectCamera = false;
    private hud: TGRHud | null = null;
    private shadows: TGRShadows | null = null;
    private headlightGlare = 0;
    private effects: TGREffects | null = null;

    public attachEffects(device: GfxDevice, particle: ArrayBufferSlice, dataSegment: ArrayBufferSlice): void {
        this.effects = new TGREffects(device, this.renderHelper.renderCache, particle, dataSegment);
    }
    private startLightsData: ArrayBufferSlice | null = null;
    private startLights: TGRModel | null = null;
    private startLightsSession: object | null = null;
    private startLightsFrame = 0;

    public attachStartLights(data: ArrayBufferSlice): void {
        this.startLightsData = data;
    }

    private updateStartLights(device: GfxDevice): void {
        const driver = this.raceDriver;
        const data = this.startLightsData;
        if (driver === null || data === null) {
            return;
        }
        const session = driver.session;
        if (this.startLights === null || this.startLightsSession !== session) {
            this.startLights?.destroy(device);
            this.startLights = new TGRModel(data);
            this.startLights.setAnimationFlags(0, MODEL_ANIMATION_REPEAT | MODEL_ANIMATION_BOUNCE);
            this.startLights.build(device, this.renderHelper.renderCache, false);
            this.startLightsSession = session;
            this.startLightsFrame = session.frame;
        }
        const frames = session.frame - this.startLightsFrame;
        this.startLightsFrame = session.frame;
        const state = session.startLights;
        if (frames > 0 && state.animation !== 0) {
            this.startLights.advanceAnimations(state.animation === -1 ? 0 : frames / GAME_FRAMES_PER_SECOND);
        }
    }

    private prepareStartLights(viewerInput: ViewerRenderInput, lights: LightState): void {
        const model = this.startLights;
        const driver = this.raceDriver;
        if (model === null || driver === null || !driver.session.startLights.visible) {
            return;
        }
        const points = G.g_LoadedTrack.rootSection?.points;
        if (points === undefined || points.length === 0) {
            return;
        }
        const position = points[0].position;
        const right = points[0].right;
        const along = vec3.normalize(vec3.create(), [right.x - position.x, right.y - position.y, right.z - position.z]);
        const up = vec3.fromValues(0, 0, 1);
        const across = vec3.cross(vec3.create(), along, up);
        vec3.cross(along, up, across);
        const origin = vec3.fromValues(position.x, position.y, position.z + START_LIGHTS_HEIGHT + driver.session.startLights.drop);
        vec3.scaleAndAdd(origin, origin, across, START_LIGHTS_ACROSS);
        vec3.scaleAndAdd(origin, origin, along, START_LIGHTS_ALONG);
        const m = mat4.fromValues(across[0], across[1], across[2], 0, along[0], along[1], along[2], 0, 0, 0, 1, 0, origin[0], origin[1], origin[2], 1);
        mat4.mul(m, this.n64ToGL, m);
        mat4.scale(m, m, [START_LIGHTS_SCALE, START_LIGHTS_SCALE, START_LIGHTS_SCALE]);
        this.renderHelper.renderInstManager.setCurrentList(this.lists.car);
        model.prepareToRender(this.renderHelper.renderCache.device, this.renderHelper.renderInstManager, viewerInput, undefined, m, lights);
    }

    public attachHud(device: GfxDevice, assets: HudAssets): void {
        this.hud = new TGRHud(device, this.renderHelper.renderCache, assets);
    }
    private readonly matrices: Float32Array[];
    private readonly flags: Uint16Array;
    private build: Build | null = null;
    public weather = Weather.Sunny;
    private builtWeather = -1;
    private gameTimeMs = 0;
    private airplane: Airplane | null = null;
    private readonly cameraN64 = vec3.create();
    private readonly forwardN64 = vec3.create();
    private readonly upN64 = vec3.create();

    public constructor(
        device: GfxDevice,
        private readonly track: TGRTrack,
        private mirrored: boolean,
        private readonly trackIndex: number,
        particleTexture: Uint8Array,
        private readonly canMirror = true,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        this.weatherEffects = new TGRWeatherEffects(device, this.renderHelper.renderCache, particleTexture, track.minZ);
        this.shadows = new TGRShadows(device, this.renderHelper.renderCache, particleTexture);
        this.setMirrored(mirrored);
        this.matrices = track.instances.map((inst) => Float32Array.from(inst.matrix));
        this.flags = Uint16Array.from(track.instances.map((inst) => inst.flags));
        for (let i = 0; i < this.matrices.length; i++) {
            const m = this.matrices[i];
            const length = Math.hypot(m[0], m[1], m[2]);
            if (length === 0) {
                continue;
            }
            const scale = 1 / length;
            if (m[0] * scale === 1 && m[5] * scale === 1 && m[10] * scale === 1) {
                this.flags[i] |= TRACK_INSTANCE_UNROTATED;
            }
        }
        for (const special of track.specials) {
            if (special.type <= TrackSpecialType.SpinY) {
                this.flags[special.target] &= ~TRACK_INSTANCE_UNROTATED;
            }
        }
        this.ensureBuild(device);
    }

    private setMirrored(mirrored: boolean): void {
        this.mirrored = mirrored;
        this.gameTrackId = this.trackIndex + (mirrored ? MIRRORED_TRACK_OFFSET : 0);
        const s = WORLD_SCALE;
        mat4.set(this.n64ToGL, 0, 0, mirrored ? -s : s, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 1);
        this.airplane = null;
    }

    private restartRace(): void {
        this.raceDriver?.restart(this.weather, this.mirrored);
    }

    private static mirrorCull(mirrored: boolean): GfxCullMode {
        return mirrored ? GfxCullMode.Front : GfxCullMode.Back;
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        const [sx, sy, sz] = this.track.startPosition;
        const fx = Math.cos(this.track.startHeading);
        const fy = Math.sin(this.track.startHeading);
        const carX = sx - fx * GRID_ROW_SPACING;
        const carY = sy - fy * GRID_ROW_SPACING;
        const carZ = sz + GRID_HEIGHT;
        const eye = vec3.fromValues(carX - fx * CHASE_DISTANCE, carY - fy * CHASE_DISTANCE, carZ + CHASE_HEIGHT);
        const center = vec3.fromValues(carX + fx * LOOK_AHEAD_START, carY + fy * LOOK_AHEAD_START, carZ + LOOK_AT_HEIGHT);
        vec3.transformMat4(eye, eye, this.n64ToGL);
        vec3.transformMat4(center, center, this.n64ToGL);
        mat4.lookAt(dst, eye, center, [0, 1, 0]);
        mat4.invert(dst, dst);
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.TIME_OF_DAY_ICON, "Weather");
        const select = new UI.SingleSelect();
        select.setStrings(["Sunny", "Fog", "Rain", "Snow", "Night"]);
        select.onselectionchange = (index: number) => {
            if (this.weather !== index) {
                this.weather = index as Weather;
                this.raceDriver?.setWeather(index);
            }
        };
        select.selectItem(this.weather);
        panel.contents.appendChild(select.elem);
        const driver = this.raceDriver;
        if (driver === null) {
            return [panel];
        }
        const race = new UI.Panel();
        race.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        race.setTitle(UI.LAYER_ICON, "Race");
        if (this.canMirror) {
            const mirror = new UI.Checkbox("Mirrored", this.mirrored);
            mirror.onchanged = () => {
                this.setMirrored(mirror.checked);
                this.reflectCamera = true;
                this.restartRace();
            };
            race.contents.appendChild(mirror.elem);
        }
        const show = new UI.Checkbox("Show Cars", this.showCars);
        const simulate = new UI.Checkbox("Simulate", driver.simulate);
        show.onchanged = () => {
            this.showCars = show.checked;
            if (!show.checked) {
                driver.simulate = false;
                simulate.setChecked(false);
            }
        };
        race.contents.appendChild(show.elem);
        simulate.onchanged = () => {
            driver.simulate = simulate.checked;
            if (simulate.checked) {
                this.showCars = true;
                show.setChecked(true);
            }
        };
        race.contents.appendChild(simulate.elem);
        {
            const cars = new UI.SingleSelect();
            cars.setStrings(driver.carNames);
            cars.onselectionchange = (index: number) => {
                if (index !== driver.recordedCar) {
                    driver.setCar(index);
                }
            };
            cars.selectItem(driver.recordedCar);
            cars.elem.style.paddingLeft = SUBLIST_INDENT;
            race.contents.appendChild(panelLabel("Car"));
            race.contents.appendChild(cars.elem);
        }
        const follow = new UI.Checkbox("Game Camera", this.gameCamera);
        follow.onchanged = () => {
            this.gameCamera = follow.checked;
        };
        race.contents.appendChild(follow.elem);
        if (driver.canChooseView) {
            const views = new UI.SingleSelect();
            views.setStrings(["Cockpit", "Chase", "Bumper"]);
            let ready = false;
            views.onselectionchange = (index: number) => {
                if (ready) {
                    this.gameCamera = true;
                    follow.setChecked(true);
                }
                driver.setView(index);
            };
            views.selectItem(driver.view);
            ready = true;
            views.elem.style.paddingLeft = SUBLIST_INDENT;
            race.contents.appendChild(panelLabel("Camera"));
            race.contents.appendChild(views.elem);
        }
        return [panel, race];
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(1.0);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.ensureBuild(device);
        if (this.reflectCamera) {
            this.reflectCamera = false;
            this.getDefaultWorldMatrix(viewerInput.camera.worldMatrix);
            viewerInput.camera.worldMatrixUpdated();
        }
        this.updateRace(device, viewerInput);
        this.updateCamera(viewerInput);
        const ws = weatherState(this.weather);
        this.tickWeather(viewerInput, ws);
        const fog = this.computeFog(ws);
        const skyFilled = this.isSkyFogFilled(ws);
        let clear = skyFilled ? fog.color : [0, 0, 0];
        if (skyFilled && this.weatherEffects.isFlashing()) {
            clear = fog.color.map((c, i) => (c * 3 + FLASH_COLOR[i]) >> 2);
        }
        const clearDescriptor = makeAttachmentClearDescriptor({ r: clear[0] / 0xff, g: clear[1] / 0xff, b: clear[2] / 0xff, a: 1 });

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.mainLists.draw(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mirror = this.mirrorViewport(viewerInput);
        if (mirror !== null) {
            const mirrorDepthID = builder.createRenderTargetID(mainDepthDesc, "Mirror Depth");
            builder.pushPass((pass) => {
                pass.setDebugName("Mirror");
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mirrorDepthID);
                pass.exec((passRenderer) => {
                    passRenderer.setViewport(mirror.x, mirror.y, mirror.width, mirror.height);
                    passRenderer.setScissor(mirror.x, mirror.y, mirror.width, mirror.height);
                    this.mirrorLists.draw(this.renderHelper.renderCache, passRenderer);
                });
            });
        }
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput, ws, fog, skyFilled, mirror);
        builder.execute();
        this.mainLists.reset();
        this.mirrorLists.reset();
    }

    private mirrorViewport(viewerInput: ViewerRenderInput): { x: number; y: number; width: number; height: number } | null {
        const race = this.raceCars;
        if (!this.gameCamera || race === null || !race.bumperView || this.raceDriver === null) {
            return null;
        }
        const rect = rearViewMirrorRect();
        const box = screenBox(viewerInput);
        const sx = box.width / SCREEN_WIDTH;
        const sy = box.height / SCREEN_HEIGHT;
        const width = Math.round(rect.width * sx);
        const height = Math.round(rect.height * sy);
        const x = Math.round(box.x + rect.x * sx);
        const top = Math.round(box.y + rect.y * sy);
        return { x, y: viewerInput.backbufferHeight - top - height, width, height };
    }

    public destroy(device: GfxDevice): void {
        this.hud?.destroy(device);
        this.shadows?.destroy(device);
        this.startLights?.destroy(device);
        this.effects?.destroy(device);
        if (this.raceDriver !== null) {
            this.raceDriver.destroy(device);
        } else {
            for (const { car } of this.raceCars?.entries ?? []) {
                car.destroy(device);
            }
        }
        this.weatherEffects.destroy(device);
        this.destroyBuild(device);
        this.renderHelper.destroy();
    }

    private prepareToRender(
        device: GfxDevice,
        viewerInput: ViewerRenderInput,
        ws: WeatherState,
        fog: FogState,
        skyFilled: boolean,
        mirror: { width: number; height: number } | null,
    ): void {
        const build = this.build;
        if (build === null) {
            return;
        }
        const frames = this.gameFrames;
        const elapsedMs = Math.floor((frames * 1000) / GAME_FRAMES_PER_SECOND);
        this.streamTextures(device, build, elapsedMs);
        this.updateSpecials(frames, viewerInput.deltaTime / 1000, ws);
        const lights = this.computeLights(ws, fog);
        this.headlightGlare = 0;
        this.effects?.reset();
        this.prepareScene(device, viewerInput, ws, fog, skyFilled, lights, build, true);
        const race = this.raceCars;
        if (mirror !== null && race !== null) {
            const frame = race.cameraVehicle.cameras[VEHICLE_CAMERA_MIRROR];
            const camera = new Camera();
            camera.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
            const eye = vec3.fromValues(frame.position.x, frame.position.y, frame.position.z);
            const center = vec3.fromValues(eye[0] + frame.forward.x, eye[1] + frame.forward.y, eye[2] + frame.forward.z);
            const up = vec3.fromValues(frame.up.x, frame.up.y, frame.up.z);
            vec3.transformMat4(eye, eye, this.n64ToGL);
            vec3.transformMat4(center, center, this.n64ToGL);
            vec3.transformMat4(up, up, this.n64ToGL);
            mat4.lookAt(camera.worldMatrix, eye, center, up);
            mat4.invert(camera.worldMatrix, camera.worldMatrix);
            const rect = rearViewMirrorRect();
            const aspect = rect.width / rect.height;
            camera.setPerspective((frame.fov * 4) / 3 / aspect, aspect, CAMERA_NEAR * WORLD_SCALE, CAMERA_FAR * MIRROR_FAR_SCALE * WORLD_SCALE);
            camera.projectionMatrix[0] = -camera.projectionMatrix[0];
            camera.worldMatrixUpdated();
            const mirrorInput: ViewerRenderInput = { ...viewerInput, camera, backbufferWidth: mirror.width, backbufferHeight: mirror.height };
            const saved = [vec3.clone(this.cameraN64), vec3.clone(this.forwardN64), vec3.clone(this.upN64)];
            this.updateCamera(mirrorInput);
            this.lists = this.mirrorLists;
            this.cullFlipped = true;
            this.raceCars = { ...race, cockpitView: true, bumperView: false };
            this.prepareScene(device, mirrorInput, ws, fog, skyFilled, lights, build, false);
            this.raceCars = race;
            this.cullFlipped = false;
            this.lists = this.mainLists;
            vec3.copy(this.cameraN64, saved[0]);
            vec3.copy(this.forwardN64, saved[1]);
            vec3.copy(this.upN64, saved[2]);
        }
        this.renderHelper.prepareToRender();
    }

    private prepareScene(
        device: GfxDevice,
        viewerInput: ViewerRenderInput,
        ws: WeatherState,
        fog: FogState,
        skyFilled: boolean,
        lights: LightState,
        build: Build,
        main: boolean,
    ): void {
        const { renderInstManager } = this.renderHelper;
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setVertexInput(build.inputLayout, [{ buffer: build.vertexBuffer }], { buffer: build.indexBuffer });
        const offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        fillMatrix4x4(template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams), offs, viewerInput.camera.projectionMatrix);

        if (!skyFilled) {
            renderInstManager.setCurrentList(this.lists.sky);
            const sky = mat4.create();
            mat4.fromTranslation(sky, [this.cameraN64[0], this.cameraN64[1], this.cameraN64[2] * SKY_DEPTH_SCALE]);
            mat4.mul(sky, this.n64ToGL, sky);
            const params: DrawParams = {
                model: sky,
                cullMode: TGRRenderer.mirrorCull(this.mirrored !== this.cullFlipped),
                lights: null,
                ramp: -1,
                nightLit: false,
                fog: null,
                env: ws.active ? [fog.color[0], fog.color[1], fog.color[2], fog.intensity] : null,
            };
            for (const dci of build.sky) {
                dci.prepareToRender(renderInstManager, viewerInput, params);
            }
        }

        const hit = this.track.instances[castCameraRay(this.track, this.cameraN64[0], this.cameraN64[1], this.cameraN64[2])];
        const hideGroups = hit?.hidesGroups ?? 0;
        const sheltered = ((hit?.flags ?? 0) & TRACK_INSTANCE_SHELTER) !== 0;
        const hideFlags = this.instanceHideFlags(ws);
        const clearSkyUnfogged = ws.active && !ws.night && !ws.snow && !ws.rain;
        const cameraGL = vec3.fromValues(viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]);
        const translucent: { draw: InstanceDraw; model: mat4; distance: number }[] = [];
        renderInstManager.setCurrentList(this.lists.opaque);
        for (const draw of build.instances) {
            const flags = this.flags[draw.index];
            if (flags & hideFlags || this.track.instances[draw.index].groups & hideGroups) {
                continue;
            }
            const visible = this.track.gridInstances.has(draw.index) || this.airplane?.instance === draw.index;
            if (!visible) {
                continue;
            }
            const model = this.instanceModelMatrix(draw.index);
            if (draw.translucent) {
                translucent.push({ draw, model, distance: vec3.squaredDistance(cameraGL, [model[12], model[13], model[14]]) });
                continue;
            }
            this.submitInstance(renderInstManager, viewerInput, draw, model, lights, fog, flags, clearSkyUnfogged);
        }
        if (main) {
            this.prepareShadows(viewerInput, build, ws, fog, hideFlags, hideGroups);
        }
        translucent.sort((a, b) => b.distance - a.distance);
        renderInstManager.setCurrentList(this.lists.translucent);
        for (const t of translucent) {
            this.submitInstance(renderInstManager, viewerInput, t.draw, t.model, lights, fog, this.flags[t.draw.index], clearSkyUnfogged);
        }
        this.prepareCars(device, viewerInput, ws, fog, lights);
        if (main) {
            this.prepareStartLights(viewerInput, lights);
        }
        renderInstManager.setCurrentList(this.lists.overlay);
        if (!sheltered && main) {
            this.weatherEffects.prepareToRender(renderInstManager, viewerInput, this.weatherCamera(), ws.rain, ws.snow, this.mirrored);
        }
        const race = this.raceCars;
        if (main && this.hud !== null && this.raceDriver !== null && this.gameCamera && race !== null) {
            const vehicle = race.cameraVehicle;
            this.hud.prepareToRender(
                renderInstManager,
                vehicle,
                {
                    gameMode: G.g_dwGameMode,
                    totalLaps: G.g_dwTotalLaps,
                    night: ws.night,
                    camera: vehicle.cameras.indexOf(vehicle.activeCamera),
                    glare: this.headlightGlare,
                },
                screenBox(viewerInput).normalized,
            );
        }
        renderInstManager.popTemplate();
    }

    private updateRace(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const driver = this.raceDriver;
        if (driver === null) {
            return;
        }
        driver.update(viewerInput.deltaTime);
        this.updateStartLights(device);
        this.raceCars = driver.cars(device);
        if (!this.gameCamera) {
            this.raceCars = { ...this.raceCars, cockpitView: false, bumperView: false, tracksideCamera: false };
            return;
        }
        const frame = driver.camera();
        const eye = vec3.clone(frame.position);
        const center = vec3.add(vec3.create(), eye, frame.forward);
        const up = vec3.clone(frame.up);
        vec3.transformMat4(eye, eye, this.n64ToGL);
        vec3.transformMat4(center, center, this.n64ToGL);
        vec3.transformMat4(up, up, this.n64ToGL);
        const camera = viewerInput.camera;
        mat4.lookAt(camera.worldMatrix, eye, center, up);
        mat4.invert(camera.worldMatrix, camera.worldMatrix);
        camera.fovY = (frame.fov * 4) / 3 / camera.aspect;
        camera.setClipPlanes(5);
        camera.worldMatrixUpdated();
    }

    private prepareCars(device: GfxDevice, viewerInput: ViewerRenderInput, ws: WeatherState, fog: FogState, lights: LightState): void {
        const race = this.raceCars;
        if (race === null || !this.showCars) {
            return;
        }
        const { renderInstManager } = this.renderHelper;
        this.lists.carsAfterTranslucent = ws.snow && !this.isCoastline();
        renderInstManager.setCurrentList(this.lists.car);
        const env: CarEnvironment = {
            drawDistance: CAMERA_FAR,
            n64ToGL: this.n64ToGL,
            cameraPosition: this.cameraN64,
            cameraForward: this.forwardN64,
            cameraUp: this.upN64,
            cameraVehicle: race.cameraVehicle,
            cockpitView: race.cockpitView,
            bumperView: race.bumperView,
            tracksideCamera: race.tracksideCamera,
            replay: race.replay,
            weatherActive: ws.active,
            night: ws.night,
            rain: ws.rain,
            snow: ws.snow,
            mirrored: this.mirrored !== this.cullFlipped,
            viewportMirrored: this.cullFlipped,
            viewMode: ws.night ? 2 : 1,
            fog,
            lights,
            sunDirection: vec3.normalize(vec3.create(), [15, 10, 20]),
        };
        for (const { car, vehicle, pose } of race.entries) {
            const ground = vehicle.groundInstanceCount > 0 ? this.track.instances[vehicle.groundInstances[0]] : undefined;
            const inTunnel = ((ground?.flags ?? 0) & TRACK_INSTANCE_SHELTER) !== 0;
            car.prepareToRender(device, this.renderHelper.renderCache, renderInstManager, viewerInput, vehicle, pose, env, inTunnel);
        }
        const main = this.lists === this.mainLists;
        const fxEnv = { n64ToGL: this.n64ToGL, trackId: this.gameTrackId, snow: ws.snow, night: ws.night };
        if (this.effects !== null && this.raceDriver !== null) {
            this.effects.prepareTireSmoke(renderInstManager, viewerInput, fxEnv);
        }
        renderInstManager.setCurrentList(this.lists.beam);
        for (const { car, vehicle, pose } of race.entries) {
            const glare = car.prepareBeams(renderInstManager, viewerInput, vehicle, pose, env);
            if (main) {
                this.headlightGlare += glare;
            }
        }
        if (main && this.effects !== null && this.raceDriver !== null) {
            this.effects.prepareExhaustAndSpray(renderInstManager, viewerInput, fxEnv);
        }
    }

    private prepareShadows(viewerInput: ViewerRenderInput, build: Build, ws: WeatherState, fog: FogState, hideFlags: number, hideGroups: number): void {
        const race = this.raceCars;
        if (race === null || !this.showCars || this.shadows === null) {
            return;
        }
        const casters: { entry: RaceCarsView["entries"][number]; dot: number }[] = [];
        for (const entry of race.entries) {
            if (entry.vehicle.ghostMode === VEHICLE_GHOST) {
                continue;
            }
            if (entry.vehicle === race.cameraVehicle && (race.cockpitView || race.bumperView)) {
                continue;
            }
            const p = entry.pose.frame[3];
            const dot =
                (p[0] - this.cameraN64[0]) * this.forwardN64[0] + (p[1] - this.cameraN64[1]) * this.forwardN64[1] + (p[2] - this.cameraN64[2]) * this.forwardN64[2];
            if (dot >= SHADOW_MIN_DOT && dot <= CAMERA_FAR) {
                casters.push({ entry, dot });
            }
        }
        casters.sort((a, b) => a.dot - b.dot);
        const draws = new Map(build.instances.map((d) => [d.index, d]));
        const view = mat4.create();
        computeViewMatrix(view, viewerInput.camera);
        const clipFromWorld = mat4.mul(mat4.create(), viewerInput.camera.projectionMatrix, view);
        const { renderInstManager } = this.renderHelper;
        for (const { entry, dot } of casters.slice(0, MAX_SHADOW_CASTERS)) {
            const vehicle = entry.vehicle;
            const surfaces: ShadowSurface[] = [];
            for (let i = 0; i < vehicle.nearbyInstanceCount; i++) {
                const index = vehicle.nearbyInstances[i];
                const draw = draws.get(index);
                const flags = this.flags[index];
                if (draw === undefined || draw.translucent || flags & (hideFlags | TRACK_INSTANCE_NO_SHADOW) || this.track.instances[index].groups & hideGroups) {
                    continue;
                }
                surfaces.push({
                    clipFromLocal: mat4.mul(mat4.create(), clipFromWorld, this.instanceModelMatrix(index)),
                    instanceMatrix: this.matrices[index],
                    ranges: draw.drawCalls.map((dci) => [dci.dc.firstIndex, dci.dc.indexCount]),
                });
            }
            const frame = entry.pose.frame;
            const wheel = entry.car.wheels[0];
            let fogFactor = 0;
            if (ws.active) {
                const range = fog.max - fog.min;
                const ndc = (CAMERA_FAR + CAMERA_NEAR) / (CAMERA_FAR - CAMERA_NEAR) - (2 * CAMERA_FAR * CAMERA_NEAR) / ((CAMERA_FAR - CAMERA_NEAR) * dot);
                fogFactor = Math.min(Math.max((ndc * Math.trunc(128000 / range) + Math.trunc(((500 - fog.min) * 256) / range)) / 255, 0), 1);
            }
            this.shadows.prepareToRender(
                renderInstManager,
                { position: frame[3], forward: frame[0], side: frame[1], up: frame[2], wheelX: wheel[0], wheelY: wheel[1], fogFactor },
                surfaces,
                fog.color,
                TGRRenderer.mirrorCull(this.mirrored),
            );
        }
    }

    private submitInstance(
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        draw: InstanceDraw,
        model: mat4,
        lights: LightState,
        fog: FogState,
        flags: number,
        clearSkyUnfogged: boolean,
    ): void {
        const ws = weatherState(this.weather);
        const params: DrawParams = {
            model,
            cullMode: flags & TRACK_INSTANCE_TWO_SIDED ? GfxCullMode.None : TGRRenderer.mirrorCull(this.mirrored !== this.cullFlipped),
            lights,
            ramp: flags & TRACK_INSTANCE_RAMPED ? flags & TRACK_INSTANCE_LIGHT_RAMP : -1,
            nightLit: ws.night && (flags & TRACK_INSTANCE_NIGHT_LIT) !== 0,
            fog: ws.active && !(clearSkyUnfogged && flags & TRACK_INSTANCE_CLEAR_SKY) ? fog : null,
            env: null,
        };
        for (const dci of draw.drawCalls) {
            dci.prepareToRender(renderInstManager, viewerInput, params);
        }
    }

    private instanceModelMatrix(index: number): mat4 {
        const m = this.matrices[index];
        const out = mat4.create();
        if (this.flags[index] & TRACK_INSTANCE_UNROTATED) {
            mat4.set(out, m[0], 0, 0, 0, 0, m[0], 0, 0, 0, 0, m[0], 0, m[12], m[13], m[14], m[15]);
        } else {
            mat4.copy(out, m as unknown as mat4);
        }
        return mat4.mul(out, this.n64ToGL, out);
    }

    private instanceHideFlags(ws: WeatherState): number {
        let hide = 0;
        if (!ws.night && !ws.rain) {
            hide |= TRACK_INSTANCE_DARK_OR_WET;
        }
        if (ws.active && (ws.snow || ws.rain || ws.night) && !this.isCoastline()) {
            hide |= TRACK_INSTANCE_CLEAR_SKY;
        }
        return hide & ~TRACK_INSTANCE_ARCADE;
    }

    private isCoastline(): boolean {
        return this.gameTrackId === TRACK_COASTLINE || this.gameTrackId === TRACK_COASTLINE + MIRRORED_TRACK_OFFSET;
    }

    private isSkyFogFilled(ws: WeatherState): boolean {
        return ws.night || ws.snow || ws.rain || this.track.skyDisplayList === 0 || this.build?.sky.length === 0;
    }

    private weatherCamera(): WeatherCamera {
        return { position: this.cameraN64, forward: this.forwardN64, up: this.upN64 };
    }

    private tickWeather(viewerInput: ViewerRenderInput, ws: WeatherState): void {
        this.gameTimeMs += viewerInput.deltaTime;
        const frames = Math.floor((this.gameTimeMs * GAME_FRAMES_PER_SECOND) / 1000);
        const first = Math.max(this.gameFrames, frames - GAME_FRAMES_PER_SECOND);
        for (let frame = first + 1; frame <= frames; frame++) {
            const delta =
                Math.floor((frame * 1000) / GAME_FRAMES_PER_SECOND) - Math.floor(((frame - 1) * 1000) / GAME_FRAMES_PER_SECOND);
            this.weatherEffects.update(delta / 1000, this.weatherCamera(), ws.rain, ws.snow);
        }
        this.gameFrames = frames;
    }

    private updateCamera(viewerInput: ViewerRenderInput): void {
        const w = viewerInput.camera.worldMatrix;
        const toN64 = (out: vec3, x: number, y: number, z: number): void => {
            vec3.set(out, this.mirrored ? -z : z, x, y);
        };
        toN64(this.cameraN64, w[12] / WORLD_SCALE, w[13] / WORLD_SCALE, w[14] / WORLD_SCALE);
        toN64(this.forwardN64, -w[8], -w[9], -w[10]);
        toN64(this.upN64, w[4], w[5], w[6]);
    }

    private computeFog(ws: WeatherState): FogState {
        if (ws.night) {
            return { color: [0, 0, 0], intensity: 0x40, min: 968, max: 1020 };
        }
        if (ws.snow) {
            return { color: [0xb8, 0xb8, 0xd8], intensity: 0x40, min: 800, max: 1050 };
        }
        if (ws.rain) {
            const color: [number, number, number] = [0x60, 0x68, 0x70];
            if (this.weatherEffects.isFlashing()) {
                const bolt = this.weatherEffects.lightningBolt;
                const flash = 100 / (Math.hypot(this.cameraN64[0] - bolt[0], this.cameraN64[1] - bolt[1]) + 100);
                for (let i = 0; i < 3; i++) {
                    color[i] = Math.trunc(color[i] * (1 - flash) + FLASH_COLOR[i] * flash);
                }
            }
            return { color, intensity: 0x40, min: 850, max: 1025 };
        }
        if (ws.active) {
            const cameraVehicle = this.gameCamera ? this.raceCars?.cameraVehicle : undefined;
            const z = cameraVehicle !== undefined ? cameraVehicle.frame.position.z : this.cameraN64[2];
            const level = ((z - this.track.minZ) / (this.track.maxZ - this.track.minZ)) * 255;
            const intensity = Math.min(Math.max(Math.trunc(level), 0), 0xff);
            const color: [number, number, number] = [...this.track.fogColor];
            if (this.gameTrackId === TRACK_DESERT) {
                const y = this.cameraN64[1];
                let haze = DESERT_HAZE_Y < y ? (y - DESERT_HAZE_Y) * 0.00087890622 * (this.cameraN64[0] * 0.00043945311) : 0;
                const fade = 1 - haze;
                haze *= 160;
                for (let i = 0; i < 3; i++) {
                    color[i] = Math.trunc(this.track.fogColor[i] * fade + haze) & 0xff;
                }
            }
            return { color, intensity, min: 980, max: 1000 };
        }
        return { color: [0, 0, 0], intensity: 0xff, min: 0, max: 1000 };
    }

    private computeLights(ws: WeatherState, fog: FogState): LightState {
        const [fr, fg, fb] = fog.color;
        const i = fog.intensity;
        let dirColor: [number, number, number];
        let ambient: [number, number, number];
        if (ws.snow || ws.rain) {
            dirColor = [(fr + 765) >> 2, (fg + 765) >> 2, (fb + 612) >> 2];
            ambient = [Math.trunc((fr * 5) / 8), Math.trunc((fg * 5) / 8), Math.trunc((fb * 5) / 8)];
        } else if (ws.night) {
            dirColor = [0xdd, 0xee, 0xff];
            ambient = [0x3c, 0x39, 0x36];
        } else if (ws.active) {
            const mix = (c: number, base: number, full: number): number => Math.trunc((((c + base) >> 1) * i + (255 - i) * full) / 255);
            dirColor = [mix(fr, 255, 255), mix(fg, 255, 255), mix(fb, 204, 204)];
            const amb = (c: number, base: number): number => Math.trunc((Math.trunc((c * 4) / 5) * i + (255 - i) * base) / 255);
            ambient = [amb(fr, 102), amb(fg, 102), amb(fb, 119)];
        } else {
            dirColor = [255, 255, 204];
            ambient = [102, 102, 119];
        }
        let ramps: [number, number, number][];
        if (ws.night) {
            ramps = [0x22, 0x44, 0x66, 0xff].map((v) => [v, v, v]);
        } else if (ws.snow) {
            ramps = [
                [0xd0, 0xd0, 0xf0],
                [0xe0, 0xe0, 0xff],
                [0xf0, 0xf0, 0xff],
                [0xff, 0xff, 0xff],
            ];
        } else {
            const r = lightRamp(dirColor[0]);
            const g = lightRamp(dirColor[1]);
            const b = lightRamp(dirColor[2]);
            ramps = [0, 1, 2, 3].map((k) => [r[k], g[k], b[k]]);
        }
        const direction = vec3.create();
        const cameraVehicle = this.raceCars?.cameraVehicle;
        if (ws.night && cameraVehicle !== undefined) {
            const { forward, up } = cameraVehicle.frame;
            vec3.set(direction, forward.x * -4 + up.x, forward.y * -4 + up.y, forward.z * -4 + up.z);
        } else if (ws.night) {
            vec3.scaleAndAdd(direction, this.upN64, this.forwardN64, -4);
        } else {
            vec3.set(direction, 15, 10, 20);
        }
        normalizeOrUp(direction);
        vec3.set(
            direction,
            Math.trunc(direction[0] * LIGHT_DIRECTION_SCALE),
            Math.trunc(direction[1] * LIGHT_DIRECTION_SCALE),
            Math.trunc(direction[2] * LIGHT_DIRECTION_SCALE),
        );
        vec3.transformMat4(direction, direction, this.n64ToGL);
        return { direction, dirColor, ambient, ramps };
    }

    private updateSpecials(frames: number, deltaSeconds: number, ws: WeatherState): void {
        const rotation = mat4.create();
        for (const special of this.track.specials) {
            const base = this.track.instances[special.target]?.matrix;
            let axis: vec3 | null = null;
            if (special.type === TrackSpecialType.SpinZ) {
                axis = vec3.fromValues(0, 0, 1);
            } else if (special.type === TrackSpecialType.SpinX) {
                axis = vec3.fromValues(1, 0, 0);
            } else if (special.type === TrackSpecialType.SpinY) {
                axis = vec3.fromValues(0, 1, 0);
            }
            if (axis === null || this.airplane?.instance === special.target) {
                continue;
            }
            const degrees = new Float32Array(new Uint32Array([special.param]).buffer)[0] * frames;
            mat4.fromRotation(rotation, (degrees * Math.PI) / 180, axis);
            mat4.mul(this.matrices[special.target] as unknown as mat4, base as unknown as mat4, rotation);
        }
        if (this.airplane === null) {
            this.airplane = this.createAirplane(ws);
        }
        if (this.airplane !== null) {
            this.flyAirplane(this.airplane, deltaSeconds);
        }
    }

    private createAirplane(ws: WeatherState): Airplane | null {
        let instance = 0;
        let trigger = 0;
        let left = 0;
        let right = 0;
        let nodeCount = 0;
        for (const special of this.track.specials) {
            if (special.type === TrackSpecialType.Airplane) {
                instance = special.target;
            } else if (special.type === TrackSpecialType.AirplanePathLeft) {
                left = special.target - this.track.pointerBase;
                nodeCount = special.param;
            } else if (special.type === TrackSpecialType.AirplanePathRight) {
                right = special.target - this.track.pointerBase;
            } else if (special.type === TrackSpecialType.AirplaneTrigger) {
                trigger = special.target;
            }
        }
        if (instance === 0 || trigger === 0 || left <= 0 || right <= 0) {
            return null;
        }
        const desert = this.gameTrackId === TRACK_DESERT || this.gameTrackId === TRACK_DESERT + MIRRORED_TRACK_OFFSET;
        if (desert && !ws.night) {
            return null;
        }
        if (this.isCoastline() && (ws.rain || ws.snow || ws.night)) {
            return null;
        }
        const m = this.track.instances[instance].matrix;
        const w = m[3] + m[15];
        const scale = Math.hypot(m[0] + m[12], m[1] + m[13], m[2] + m[14]) / w;
        return {
            instance,
            left,
            right,
            nodeCount,
            node: 0,
            distance: 0,
            segmentLength: 0,
            dir: vec3.create(),
            dirPrev: vec3.create(),
            dirNext: vec3.create(),
            scale,
        };
    }

    private pathMidpoint(out: vec3, a: Airplane, node: number): vec3 {
        const view = this.track.data.createDataView();
        for (let i = 0; i < 3; i++) {
            out[i] = (view.getFloat32(a.right + node * 12 + i * 4) + view.getFloat32(a.left + node * 12 + i * 4)) * 0.5;
        }
        return out;
    }

    private pathPoint(out: vec3, offset: number, node: number): vec3 {
        const view = this.track.data.createDataView();
        return vec3.set(out, view.getFloat32(offset + node * 12), view.getFloat32(offset + node * 12 + 4), view.getFloat32(offset + node * 12 + 8));
    }

    private flyAirplane(a: Airplane, deltaSeconds: number): void {
        const mountain = this.gameTrackId === TRACK_MOUNTAIN || this.gameTrackId === TRACK_MOUNTAIN + MIRRORED_TRACK_OFFSET;
        a.distance += deltaSeconds * (mountain ? 18 : 50);
        const pa = vec3.create();
        const pb = vec3.create();
        const pc = vec3.create();
        while (a.segmentLength < a.distance) {
            a.distance -= a.segmentLength;
            a.node++;
            if (a.node >= a.nodeCount) {
                a.node = 0;
                a.distance = 0;
                a.segmentLength = 0;
                continue;
            }
            this.pathMidpoint(pa, a, a.node - 1);
            this.pathMidpoint(pb, a, a.node);
            a.segmentLength = vec3.distance(pa, pb);
            normalizeOrUp(vec3.sub(a.dir, pb, pa));
            if (a.node < 2) {
                vec3.copy(a.dirPrev, a.dir);
            } else {
                this.pathMidpoint(pc, a, a.node - 2);
                normalizeOrUp(vec3.sub(a.dirPrev, pa, pc));
            }
            if (a.node + 1 === a.nodeCount) {
                vec3.copy(a.dirNext, a.dir);
            } else {
                this.pathMidpoint(pc, a, a.node + 1);
                normalizeOrUp(vec3.sub(a.dirNext, pc, pb));
            }
        }
        if (a.node === 0) {
            return;
        }
        const t = a.distance / a.segmentLength;
        const l0 = this.pathPoint(vec3.create(), a.left, a.node - 1);
        const l1 = this.pathPoint(vec3.create(), a.left, a.node);
        const r0 = this.pathPoint(vec3.create(), a.right, a.node - 1);
        const r1 = this.pathPoint(vec3.create(), a.right, a.node);
        vec3.lerp(pa, l0, l1, t);
        vec3.lerp(pb, r0, r1, t);
        const row0 = vec3.create();
        if (t > 0.5) {
            vec3.lerp(row0, a.dir, a.dirNext, t - 0.5);
        } else {
            vec3.lerp(row0, a.dirPrev, a.dir, t + 0.5);
        }
        normalizeOrUp(row0);
        const row2 = normalizeOrUp(vec3.sub(vec3.create(), pa, pb));
        const row1 = normalizeOrUp(vec3.cross(vec3.create(), row0, row2));
        normalizeOrUp(vec3.cross(row2, row1, row0));
        vec3.scale(row0, row0, a.scale);
        vec3.scale(row2, row2, -a.scale);
        vec3.scale(row1, row1, a.scale);
        const m = this.matrices[a.instance];
        m.set(row0, 0);
        m.set(row1, 4);
        m.set(row2, 8);
        m[12] = (pa[0] + pb[0]) * 0.5;
        m[13] = (pa[1] + pb[1]) * 0.5;
        m[14] = (pa[2] + pb[2]) * 0.5;
    }

    private ensureBuild(device: GfxDevice): void {
        if (this.builtWeather === this.weather && this.build !== null) {
            return;
        }
        this.destroyBuild(device);
        this.airplane = null;
        this.build = this.createBuild(device, weatherState(this.weather));
        this.builtWeather = this.weather;
        this.textureHolder.setTextures(this.build.handles, this.build.sharedOutput);
    }

    private destroyBuild(device: GfxDevice): void {
        const build = this.build;
        if (build === null) {
            return;
        }
        device.destroyBuffer(build.vertexBuffer);
        device.destroyBuffer(build.indexBuffer);
        for (const handle of build.handles) {
            device.destroyTexture(handle.gfxTexture);
        }
        this.build = null;
    }

    private processDisplayLists(ram: DataView, ws: WeatherState): Set<number> {
        const translucent = new Set<number>();
        const clear = !ws.night && !ws.rain;
        const column = (ws.active ? 1 : 0) + (clear ? 0 : 1) + 1;
        const snowTintTrack = !this.isCoastline();
        this.track.instances.forEach((instance, index) => {
            const tint = (instance.flags & TRACK_INSTANCE_TWO_SIDED) === 0 && snowTintTrack;
            if (instance.displayList === 0) {
                return;
            }
            let snowTint = false;
            for (let o = (instance.displayList & 0xffffff); ram.getUint8(o) !== G_ENDDL; o += 8) {
                const w0 = ram.getUint32(o);
                const w1 = ram.getUint32(o + 4);
                const op = w0 >>> 24;
                if (op === G_SETOTHERMODE_L) {
                    const row = RENDER_MODES.findIndex((r) => w0 === RENDER_MODE_COMMAND && w1 === r[0]);
                    if (row >= 0) {
                        ram.setUint32(o + 4, RENDER_MODES[row][column]);
                        if (row >= RENDER_MODE_TRANSLUCENT_ROW) {
                            translucent.add(index);
                        }
                    }
                } else if (op === G_SETCOMBINE) {
                    if (clear && w0 === CLEAR_COMBINE_PATCH[0] && w1 === CLEAR_COMBINE_PATCH[1]) {
                        ram.setUint32(o, CLEAR_COMBINE_PATCH[2]);
                        ram.setUint32(o + 4, CLEAR_COMBINE_PATCH[3]);
                    }
                    if (ws.snow && tint) {
                        const p0 = ram.getUint32(o);
                        const p1 = ram.getUint32(o + 4);
                        snowTint = SNOW_TINT_COMBINES.some(([c0, c1]) => p0 === c0 && p1 === c1);
                    }
                } else if (op === G_SETPRIMCOLOR && snowTint && ws.snow) {
                    ram.setUint32(o + 4, SNOW_PRIM_COLOR);
                } else if (op === G_SETENVCOLOR && snowTint && ws.snow) {
                    ram.setUint32(o + 4, SNOW_ENV_COLOR);
                }
            }
        });
        return translucent;
    }

    private resetTrackState(rsp: RSPState, ws: WeatherState): void {
        rsp.gSPClearGeometryMode(0xffffffff);
        rsp.gSPSetGeometryMode(TRACK_GEOMETRY_MODE | (ws.active ? RSP_Geometry.G_FOG : 0));
        rsp.gDPSetOtherModeH(0, 32, TRACK_OTHER_MODE_H);
        rsp.gDPSetOtherModeL(0, 32, ws.active ? TRACK_RENDER_MODE_FOG : TRACK_RENDER_MODE_CLEAR);
        rsp.gDPSetCombine(TRACK_COMBINE[0], TRACK_COMBINE[1]);
        rsp.gDPSetPrimColor(PRIM_MIN_LEVEL, 0xff, 0, 0, 0xff);
        rsp.gSPTexture(true, 0, 2, 0xffff, 0xffff);
        rsp.markStateChanged();
    }

    private createBuild(device: GfxDevice, ws: WeatherState): Build {
        const track = this.track;
        const ramBase = track.pointerBase & 0xffffff;
        const ram = new Uint8Array(ramBase + track.data.byteLength);
        ram.set(track.data.createTypedArray(Uint8Array), ramBase);
        const ramSlice = new ArrayBufferSlice(ram.buffer);
        const segmentBuffers = nArray(256, () => ramSlice);
        const build: Build = {
            ram,
            segmentBuffers,
            sharedOutput: new RSPSharedOutput(),
            vertexBuffer: null as unknown as GfxBuffer,
            indexBuffer: null as unknown as GfxBuffer,
            inputLayout: null as unknown as GfxInputLayout,
            handles: [],
            instances: [],
            sky: [],
            streamedFrames: new Int32Array(track.textures.length).fill(-1),
            streamedSnowMode: -1,
        };
        this.streamTexturesToRam(build, Math.floor((Math.floor((this.gameTimeMs * GAME_FRAMES_PER_SECOND) / 1000) * 1000) / GAME_FRAMES_PER_SECOND));
        const translucent = this.processDisplayLists(new DataView(ram.buffer), ws);

        const rsp = new RSPState(segmentBuffers, build.sharedOutput);
        rsp.gDPSetTile(0, 2, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
        rsp.gDPSetTile(0, 0, 0, 0x1f0, 6, 0, 0, 0, 0, 0, 0, 0);
        rsp.gDPSetTile(0, 0, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
        const ranges = new Map<number, [number, number]>();
        track.instances.forEach((instance) => {
            if (instance.displayList === 0 || ranges.has(instance.displayList)) {
                return;
            }
            this.resetTrackState(rsp, ws);
            const start = rsp.drawCalls.length;
            runDL_F3DEX(rsp, instance.displayList);
            ranges.set(instance.displayList, [start, rsp.drawCalls.length]);
        });

        let skyRange: [number, number] | null = null;
        if (track.skyDisplayList !== 0) {
            rsp.gSPClearGeometryMode(0xffffffff);
            rsp.gSPSetGeometryMode(RSP_Geometry.G_CULL_BACK);
            rsp.gDPSetOtherModeH(0, 32, SKY_OTHER_MODE_H);
            rsp.gDPSetOtherModeL(0, 32, SKY_RENDER_MODE);
            const skyCombine = ws.active ? SKY_COMBINE_FOG : SKY_COMBINE_CLEAR;
            rsp.gDPSetCombine(skyCombine[0], skyCombine[1]);
            rsp.gSPTexture(true, 0, 0, 0xffff, 0xffff);
            rsp.gDPSetTile(0, 2, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
            rsp.gDPSetTile(0, 0, 0, 0x1f0, 6, 0, 0, 0, 0, 0, 0, 0);
            rsp.gDPSetTile(0, 0, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
            rsp.markStateChanged();
            const start = rsp.drawCalls.length;
            runDL_F3DEX(rsp, track.skyDisplayList);
            skyRange = [start, rsp.drawCalls.length];
        }

        const cache = this.renderHelper.renderCache;
        this.createBuffers(device, cache, build);
        const handleMap = new Map<string, TextureHandle>();
        const handlesFor = (dc: DrawCall): TextureHandle[] =>
            dc.textures.map((levels, slot) => this.textureHandle(device, cache, build, handleMap, levels, dc.tiles[slot]));
        const instanceFor = (dc: DrawCall, isSky: boolean): TGRDrawCallInstance =>
            new TGRDrawCallInstance(dc, handlesFor(dc), build.sharedOutput, isSky);

        const dlInstances = new Map<number, TGRDrawCallInstance[]>();
        for (const [dl, [start, end]] of ranges) {
            const list: TGRDrawCallInstance[] = [];
            for (let i = start; i < end; i++) {
                if (rsp.drawCalls[i].indexCount > 0) {
                    list.push(instanceFor(rsp.drawCalls[i], false));
                }
            }
            dlInstances.set(dl, list);
        }
        track.instances.forEach((instance, index) => {
            const drawCalls = dlInstances.get(instance.displayList);
            if (drawCalls === undefined || drawCalls.length === 0) {
                return;
            }
            const flagged = (this.flags[index] & TRACK_INSTANCE_TRANSLUCENT) !== 0;
            build.instances.push({ index, drawCalls, translucent: flagged || translucent.has(index) });
        });
        if (skyRange !== null) {
            for (let i = skyRange[0]; i < skyRange[1]; i++) {
                if (rsp.drawCalls[i].indexCount > 0) {
                    build.sky.push(instanceFor(rsp.drawCalls[i], true));
                }
            }
        }
        build.handles = [...handleMap.values()];
        return build;
    }

    private createBuffers(device: GfxDevice, cache: GfxRenderCache, build: Build): void {
        const buffers = createGeometryBuffers(device, cache, build.sharedOutput, GfxBufferFrequencyHint.Static);
        build.vertexBuffer = buffers.vertexBuffer;
        build.indexBuffer = buffers.indexBuffer;
        build.inputLayout = buffers.inputLayout;
    }

    private textureHandle(
        device: GfxDevice,
        cache: GfxRenderCache,
        build: Build,
        handleMap: Map<string, TextureHandle>,
        requested: number[],
        tile: RDP.TileState,
    ): TextureHandle {
        return createTextureHandle(device, cache, build.sharedOutput, handleMap, requested, tile);
    }

    private streamTexturesToRam(build: Build, elapsedMs: number): [number, number][] {
        const ws = weatherState(this.weather);
        const snowMode = ws.snow ? 1 : 0;
        const snowTint = ws.snow && !this.isCoastline();
        const stream = this.track.stream.createTypedArray(Uint8Array);
        const ramBase = this.track.pointerBase & 0xffffff;
        const changed: [number, number][] = [];
        const copy = (rom: number, address: number, size: number): void => {
            build.ram.set(stream.subarray(rom, rom + size), (address & 0xffffff) - (this.track.pointerBase & 0xffffff) + ramBase);
            changed.push([address, size]);
        };
        this.track.textures.forEach((texture, i) => {
            if (texture.image === 0) {
                return;
            }
            let paletteRom: number;
            if (texture.frames === null) {
                if (snowMode === build.streamedSnowMode) {
                    return;
                }
                paletteRom = texture.paletteRomIndex << 5;
            } else {
                const frames = texture.frames;
                let frame: number;
                let imageRom: number;
                if (frames.length === 2 && frames[0].time === TEXTURE_ROM_NONE) {
                    if (build.streamedSnowMode === snowMode) {
                        return;
                    }
                    frame = snowMode === 0 ? 1 : 0;
                    imageRom = frame ? TEXTURE_ROM_NONE : frames[frame].imageRom;
                    paletteRom = frames[frame].paletteRom;
                } else {
                    const period = (frames[frames.length - 1].time - frames[0].time) >>> 0;
                    const phase = period === 0 ? 0 : (elapsedMs >>> 0) % period;
                    if (snowTint && texture.format === TEXTURE_FORMAT_SNOW_STILL) {
                        frame = 0;
                    } else {
                        for (frame = 1; frame < frames.length; frame++) {
                            if (phase < frames[frame].time) {
                                break;
                            }
                        }
                        frame--;
                    }
                    if (build.streamedFrames[i] === frame) {
                        return;
                    }
                    build.streamedFrames[i] = frame;
                    imageRom = frames[frame].imageRom;
                    paletteRom = frames[frame].paletteRom;
                }
                if (texture.size !== 0 && imageRom !== TEXTURE_ROM_NONE) {
                    copy(imageRom, texture.image, texture.size);
                }
            }
            if (texture.palette !== 0 && paletteRom !== TEXTURE_ROM_NONE) {
                copy(paletteRom, texture.palette, texture.format === TEXTURE_FORMAT_CI4 ? 0x20 : 0x200);
            }
        });
        build.streamedSnowMode = snowMode;
        return changed;
    }

    private streamTextures(device: GfxDevice, build: Build, elapsedMs: number): void {
        const changed = this.streamTexturesToRam(build, elapsedMs);
        if (changed.length === 0) {
            return;
        }
        const textures = build.sharedOutput.textureCache.textures;
        const overlaps = (address: number, size: number): boolean =>
            size > 0 && changed.some(([start, length]) => address < start + length && start < address + size);
        for (const handle of build.handles) {
            const touched = handle.levels.some((l) => {
                const t = textures[l];
                const paletteSize = t.tile.siz === 0 ? 0x20 : 0x200;
                return overlaps(t.dramAddr, t.tile.line * 8 * t.height) || (t.dramPalAddr !== 0 && overlaps(t.dramPalAddr, paletteSize));
            });
            if (!touched) {
                continue;
            }
            const pixels = handle.levels.map((l) => {
                const t = textures[l];
                return RDP.translateTileTexture(build.segmentBuffers, t.dramAddr, t.dramPalAddr, t.tile, true, true).pixels;
            });
            device.uploadTextureData(handle.gfxTexture, 0, pixels);
        }
    }
}
