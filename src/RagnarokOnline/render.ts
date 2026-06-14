import { mat4, vec3, vec4 } from "gl-matrix";
import { CameraController } from "../Camera.js";
import { clamp, MathConstants, Vec3UnitY } from "../MathHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from "../gfx/helpers/RenderGraphHelpers.js";
import { colorNewFromRGBA } from "../Color.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInstList, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import * as UI from "../ui.js";
import { SceneContext } from "../SceneBase.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GndMap, GndSurface } from "./gnd.js";
import { AnimatedPose, ModelAnimator, MODEL_VERTEX_STRIDE_BYTES } from "./model.js";
import type { AnimatedModelMesh, ModelMesh } from "./model.js";
import { buildWaterMesh, WaterAnimator, WaterParams, WATER_VERTEX_STRIDE_BYTES } from "./water.js";
import { SpriteActor, SpriteKind, SpriteRenderer } from "./sprite.js";
import { SprModel } from "./spr.js";
import { EntitySceneData, MobEntity } from "./entity.js";
import { NameLabelRenderer, NPC_LABEL_STYLE, MOB_LABEL_STYLE } from "./nametag.js";
import { ParticleRenderer, ParticleSceneData } from "./particles.js";
import { WarpPortalRenderer, WarpPortalSceneData } from "./warp-portal.js";
import { GrannyInstance, GrannyModelRenderer } from "./granny-render.js";
import { WeatherParams, WeatherRenderer } from "./weather.js";
import { gatCellGroundHeight, gatCellToWorld, GND_CELL_SIZE } from "./coord.js";
import { computeSunDirections } from "./rsw.js";
import { ShadowRenderer } from "./shadow.js";
import { SkyDomeRenderer, SkySceneData } from "./sky.js";
import { DustRenderer } from "./dust.js";
import { triggerTravel } from "./travel.js";
import { currentEra, setEra } from "./era.js";
import type { Era } from "./era.js";
import { Bgm } from "./bgm.js";
import { MAX_POINT_LIGHTS, pickActiveLights, PointLight, POINT_LIGHT_FALLOFF_EXPONENT, POINT_LIGHT_INTENSITY } from "./lights.js";
import BitMap, { bitMapDeserialize, bitMapGetSerializedByteLength, bitMapSerialize } from "../BitMap.js";
import { assertExists } from "../util.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";

export interface EntityLayerBundle {
    entityData: EntitySceneData;
    warpPortalData: WarpPortalSceneData | null;
    warpClickData: WarpClickSceneData;
}

const WARP_CLICK_MOVE_THRESHOLD_PX = 6;
const WARP_CLICK_PIXEL_SLOP = 24;

const MOB_HITBOX_BUFFER = 1.2;
const MOB_CLICK_PIXEL_SLOP = 10;
const MOB_FALLBACK_HALF_HEIGHT = 3.0;
const MOB_FALLBACK_RADIUS = 4.0;

const FOG_NEAR_RADIUS_FRACTION = 0.05;
const FOG_FAR_RADIUS_FRACTION = 1.5;
const FOG_NEAR_FLOOR_UNITS = 50;
const FOG_FAR_MIN_DEPTH_UNITS = 100;
const FOG_DIST_SLIDER_MAX_MULT = 4;
const FOG_DIST_SLIDER_MAX_FLOOR = 2000;

const LIGHT_MULTIPLIER_MAX = 4;

export const FOG_DEFAULT_COLOR_UNFOGGED = vec3.fromValues(0.6, 0.6, 0.65);
export const FOG_DEFAULT_TINT_UNFOGGED = 0.25;

const enum LayerBit {
    NPCs = 0,
    Mobs = 1,
    Effects = 2,
    Props = 3,
    Water = 4,
    Granny = 5,
    Particles = 6,
    NameLabels = 7,
    Weather = 8,
    WarpPortals = 9,
}
const NUM_LAYER_BITS = 10;

const scratchClip = vec4.create();
const scratchOffset = vec3.create();
const scratchScreen: [number, number] = [0, 0];
const scratchScreen2: [number, number] = [0, 0];

const FOG_GLSL = `
vec3 ApplyFog(vec3 t_Color, vec3 t_WorldPos, vec3 t_EyePos, vec4 t_FogColor, vec4 t_FogParams) {
    if (t_FogColor.a < 0.5) return t_Color;
    float t_FogAmt = t_FogParams.x;
    if (t_FogParams.y > 0.5) {
        float t_Dist = distance(t_WorldPos, t_EyePos);
        t_FogAmt *= clamp((t_Dist - t_FogParams.z) / max(t_FogParams.w - t_FogParams.z, 1e-3), 0.0, 1.0);
    }
    return mix(t_Color, t_FogColor.rgb, t_FogAmt);
}
`;

class TerrainProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_LightCoord = 2;
    public static a_Color = 3;

    public static ub_SceneParams = 0;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_EnvDiff;
    vec4 u_FogColor;
    vec4 u_FogParams;
    vec4 u_EyePos;
    vec4 u_PointLightParams;
    vec4 u_PointLightPosRange[${MAX_POINT_LIGHTS}];
    vec4 u_PointLightColor[${MAX_POINT_LIGHTS}];
};

uniform sampler2D u_BaseTexture;
uniform sampler2D u_Lightmap;

varying vec2 v_TexCoord;
varying vec2 v_LightCoord;
varying vec4 v_Color;
varying vec3 v_WorldPos;

${FOG_GLSL}
`;

    public override vert = `
layout(location = ${TerrainProgram.a_Position}) in vec3 a_Position;
layout(location = ${TerrainProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${TerrainProgram.a_LightCoord}) in vec2 a_LightCoord;
layout(location = ${TerrainProgram.a_Color}) in vec4 a_Color;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
    v_LightCoord = a_LightCoord;
    v_Color = a_Color;
    v_WorldPos = a_Position;
}
`;

    public override frag = `
void main() {
    vec4 t_Base = texture(SAMPLER_2D(u_BaseTexture), v_TexCoord);
    if (t_Base.a < 0.5)
        discard;
    vec4 t_Light = texture(SAMPLER_2D(u_Lightmap), v_LightCoord);

    float t_Intensity = t_Light.a;
    vec3 t_Lit = t_Base.rgb * v_Color.rgb * t_Intensity + t_Light.rgb;

    t_Lit *= u_EnvDiff.rgb;

    t_Lit = ApplyFog(t_Lit, v_WorldPos, u_EyePos.xyz, u_FogColor, u_FogParams);

    if (u_PointLightParams.w > 0.5) {
        int t_Count = int(u_PointLightParams.x);
        float t_Gain = u_PointLightParams.y;
        float t_Falloff = u_PointLightParams.z;
        vec3 t_Add = vec3(0.0);
        for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
            if (i >= t_Count) break;
            vec3 t_Lp = u_PointLightPosRange[i].xyz;
            float t_R = u_PointLightPosRange[i].w;
            float t_D = distance(v_WorldPos, t_Lp);
            float t_K = max(0.0, 1.0 - t_D / t_R);
            t_Add += u_PointLightColor[i].rgb * (pow(t_K, t_Falloff) * t_Gain);
        }
        t_Lit = min(t_Lit + t_Add, vec3(1.0));
    }

    gl_FragColor = vec4(t_Lit, 1.0);
}
`;
}

class ModelProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Normal = 2;
    public static a_Color = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_LightDir;
    vec4 u_DiffuseColor;
    vec4 u_AmbientColor;
    vec4 u_FogColor;
    vec4 u_FogParams;
    vec4 u_EyePos;

    vec4 u_PointLightParams;
    vec4 u_PointLightPosRange[${MAX_POINT_LIGHTS}];
    vec4 u_PointLightColor[${MAX_POINT_LIGHTS}];
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_WorldFromModel;
};

uniform sampler2D u_BaseTexture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
varying vec3 v_Normal;
varying vec3 v_WorldPos;

${FOG_GLSL}
`;

    public override vert = `
layout(location = ${ModelProgram.a_Position}) in vec3 a_Position;
layout(location = ${ModelProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${ModelProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${ModelProgram.a_Color}) in vec4 a_Color;

void main() {
    vec4 t_WorldPos = UnpackMatrix(u_WorldFromModel) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_WorldPos;
    v_TexCoord = a_TexCoord;
    v_Color = a_Color;

    mat4 t_M = UnpackMatrix(u_WorldFromModel);
    v_Normal = mat3(t_M[0].xyz, t_M[1].xyz, t_M[2].xyz) * a_Normal;
    v_WorldPos = t_WorldPos.xyz;
}
`;

    public override frag = `
void main() {
    vec4 t_Base = texture(SAMPLER_2D(u_BaseTexture), v_TexCoord);
    if (t_Base.a < 0.5)
        discard;

    vec3 t_Shade;
    float t_NLen = length(v_Normal);
    bool t_HasNormal = t_NLen >= 0.0001;
    vec3 t_N = t_HasNormal ? v_Normal / t_NLen : vec3(0.0);
    if (!t_HasNormal) {
        t_Shade = vec3(1.0);
    } else {
        float t_NdotL = max(dot(t_N, u_LightDir.xyz), 0.0);
        t_Shade = min(u_AmbientColor.rgb + t_NdotL * u_DiffuseColor.rgb, vec3(1.0));
    }

    vec3 t_Color = t_Base.rgb * v_Color.rgb * t_Shade;

    t_Color = ApplyFog(t_Color, v_WorldPos, u_EyePos.xyz, u_FogColor, u_FogParams);

    if (u_PointLightParams.w > 0.5) {
        int t_Count = int(u_PointLightParams.x);
        float t_Gain = u_PointLightParams.y;
        float t_Falloff = u_PointLightParams.z;
        vec3 t_Add = vec3(0.0);
        for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
            if (i >= t_Count) break;
            vec3 t_Lp = u_PointLightPosRange[i].xyz;
            float t_R = u_PointLightPosRange[i].w;
            vec3 t_To = t_Lp - v_WorldPos;
            float t_D = length(t_To);
            float t_K = max(0.0, 1.0 - t_D / t_R);
            float t_Att = pow(t_K, t_Falloff) * t_Gain;
            float t_NdotL = t_HasNormal ? max(dot(t_N, t_To / max(t_D, 1e-4)), 0.0) : 1.0;
            t_Add += u_PointLightColor[i].rgb * (t_Att * t_NdotL);
        }
        t_Color = min(t_Color + t_Base.rgb * t_Add, vec3(1.0));
    }

    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}

class WaterProgram extends DeviceProgram {
    public static a_WorldXZ = 0;
    public static a_Grid = 1;
    public static a_TexCoord = 2;

    public static ub_WaterParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_WaterParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_WaveParams;
    vec4 u_FogColor;
    vec4 u_FogParams;
    vec4 u_EyePos;
};

uniform sampler2D u_FrameTexture;

varying vec2 v_TexCoord;
varying vec3 v_WorldPos;

${FOG_GLSL}
`;

    public override vert = `
layout(location = ${WaterProgram.a_WorldXZ}) in vec2 a_WorldXZ;
layout(location = ${WaterProgram.a_Grid}) in float a_Grid;
layout(location = ${WaterProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    float t_WaterLevel = u_WaveParams.x;
    float t_WaveOffset = u_WaveParams.y;
    float t_WavePitch = u_WaveParams.z;
    float t_WaveHeight = u_WaveParams.w;

    float t_PhaseDeg = trunc(t_WaveOffset + a_Grid * t_WavePitch);
    float t_Wave = sin(t_PhaseDeg * ${MathConstants.DEG_TO_RAD}) * t_WaveHeight;
    float t_WorldY = -(t_WaterLevel + t_Wave);

    vec3 t_WorldPos = vec3(a_WorldXZ.x, t_WorldY, a_WorldXZ.y);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_WorldPos, 1.0);
    v_TexCoord = a_TexCoord;
    v_WorldPos = t_WorldPos;
}
`;

    public override frag = `
void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_FrameTexture), v_TexCoord);
    vec3 t_Rgb = ApplyFog(t_Color.rgb, v_WorldPos, u_EyePos.xyz, u_FogColor, u_FogParams);

    gl_FragColor = vec4(t_Rgb, 0.6);
}
`;
}

const VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 2 * 4 + 4;

function lightmapAtlasGridSide(n: number): number {
    return Math.max(1, Math.ceil(Math.sqrt(Math.max(n, 1))));
}

interface TerrainDrawGroup {
    textureId: number;
    indexOffset: number;
    indexCount: number;
}

interface TerrainMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
    groups: TerrainDrawGroup[];

    lightmapAtlas: Uint8Array;
    lightmapAtlasGridSide: number;
    min: vec3;
    max: vec3;
}

function buildLightmapTiles(gnd: GndMap): Uint8Array[] {
    const tiles: Uint8Array[] = [];
    for (const lm of gnd.lightmaps) {
        const tile = new Uint8Array(8 * 8 * 4);
        for (let texel = 0; texel < 64; texel++) {
            const off = texel * 4;
            tile[off + 0] = lm.color[texel * 3 + 0];
            tile[off + 1] = lm.color[texel * 3 + 1];
            tile[off + 2] = lm.color[texel * 3 + 2];
            tile[off + 3] = lm.intensity[texel];
        }
        tiles.push(tile);
    }
    return tiles;
}

function buildTerrainMesh(gnd: GndMap): TerrainMesh {
    const lightmapTiles = buildLightmapTiles(gnd);
    const n = lightmapTiles.length;

    const gridSide = lightmapAtlasGridSide(n);
    const atlasSize = gridSide * 8;
    const lightmapAtlas = new Uint8Array(atlasSize * atlasSize * 4);
    for (let i = 0; i < n; i++) {
        const col = i % gridSide;
        const row = Math.floor(i / gridSide);
        const tile = lightmapTiles[i];
        for (let r = 0; r < 8; r++) {
            const srcOff = r * 8 * 4;
            const dstOff = ((row * 8 + r) * atlasSize + col * 8) * 4;
            lightmapAtlas.set(tile.subarray(srcOff, srcOff + 8 * 4), dstOff);
        }
    }

    const lightmapUV = (lightmapId: number, k: number, out: [number, number]): void => {
        let idx = lightmapId;
        if (n === 0 || idx >= n)
            idx = 0;
        const col = idx % gridSide;
        const row = Math.floor(idx / gridSide);
        const localU = (k & 1) ? 7 / 8 : 1 / 8;
        const localV = (k & 2) ? 7 / 8 : 1 / 8;
        out[0] = (col + localU) / gridSide;
        out[1] = (row + localV) / gridSide;
    };

    const worldWidth = gnd.width * GND_CELL_SIZE;

    const cornerWorld = (x: number, y: number, k: number, h: ArrayLike<number>, out: vec3): void => {
        const cx = (k & 1) ? (x + 1) : x;
        const cz = (k & 2) ? (y + 1) : y;
        vec3.set(out, worldWidth - cx * GND_CELL_SIZE, -h[k], cz * GND_CELL_SIZE);
    };

    const surfaceOk = (id: number): GndSurface | null => {
        if (id < 0 || id >= gnd.surfaces.length)
            return null;
        const s = gnd.surfaces[id];
        return s.textureId >= 0 ? s : null;
    };

    let quadCount = 0;
    for (let y = 0; y < gnd.height; y++) {
        for (let x = 0; x < gnd.width; x++) {
            const c = gnd.cells[y * gnd.width + x];
            if (surfaceOk(c.topSurface) !== null)
                quadCount++;
            if (y + 1 < gnd.height && surfaceOk(c.frontSurface) !== null)
                quadCount++;
            if (x + 1 < gnd.width && surfaceOk(c.rightSurface) !== null)
                quadCount++;
        }
    }

    const vertexCount = quadCount * 4;
    const indexCount = quadCount * 6;
    const vertexData = new ArrayBuffer(vertexCount * VERTEX_STRIDE_BYTES);
    const fview = new Float32Array(vertexData);
    const uview = new Uint32Array(vertexData);
    const indexData = new Uint32Array(indexCount);

    const buckets = new Map<number, number[]>();

    const p0 = vec3.create(), p1 = vec3.create(), p2 = vec3.create(), p3 = vec3.create();
    const luv: [number, number] = [0, 0];

    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    let vertexCursor = 0;

    const surfaceColor = (s: GndSurface): number => {
        const argb = s.color >>> 0;
        const r = (argb >>> 16) & 0xff;
        const g = (argb >>> 8) & 0xff;
        const b = argb & 0xff;
        return (r | (g << 8) | (b << 16) | (0xff << 24)) >>> 0;
    };

    const cellTopColor = (cx: number, cy: number, fallback: number): number => {
        if (cx < 0 || cy < 0 || cx >= gnd.width || cy >= gnd.height)
            return fallback;
        const cell = gnd.cells[cy * gnd.width + cx];
        const s = surfaceOk(cell.topSurface);
        if (s === null)
            return fallback;
        return surfaceColor(s);
    };

    const emitQuad = (s: GndSurface, p: vec3[], cornerColors: number[]): void => {
        const base = vertexCursor;
        for (let k = 0; k < 4; k++) {
            const fo = (base + k) * 8;
            const px = p[k][0], py = p[k][1], pz = p[k][2];
            fview[fo + 0] = px;
            fview[fo + 1] = py;
            fview[fo + 2] = pz;
            fview[fo + 3] = s.u[k];
            fview[fo + 4] = s.v[k];
            lightmapUV(s.lightmapId, k, luv);
            fview[fo + 5] = luv[0];
            fview[fo + 6] = luv[1];
            uview[fo + 7] = cornerColors[k];
            if (px < min[0]) min[0] = px; if (px > max[0]) max[0] = px;
            if (py < min[1]) min[1] = py; if (py > max[1]) max[1] = py;
            if (pz < min[2]) min[2] = pz; if (pz > max[2]) max[2] = pz;
        }
        vertexCursor += 4;

        let bucket = buckets.get(s.textureId);
        if (bucket === undefined) {
            bucket = [];
            buckets.set(s.textureId, bucket);
        }
        bucket.push(base + 0, base + 1, base + 2, base + 2, base + 1, base + 3);
    };

    for (let y = 0; y < gnd.height; y++) {
        for (let x = 0; x < gnd.width; x++) {
            const c = gnd.cells[y * gnd.width + x];

            const top = surfaceOk(c.topSurface);
            if (top !== null) {
                cornerWorld(x, y, 0, c.height, p0);
                cornerWorld(x, y, 1, c.height, p1);
                cornerWorld(x, y, 2, c.height, p2);
                cornerWorld(x, y, 3, c.height, p3);
                const cOwn = surfaceColor(top);
                emitQuad(top, [p0, p1, p2, p3], [
                    cellTopColor(x, y, cOwn),
                    cellTopColor(x + 1, y, cOwn),
                    cellTopColor(x, y + 1, cOwn),
                    cellTopColor(x + 1, y + 1, cOwn),
                ]);
            }

            const front = surfaceOk(c.frontSurface);
            if (front !== null && y + 1 < gnd.height) {
                const nc = gnd.cells[(y + 1) * gnd.width + x];
                cornerWorld(x, y, 2, c.height, p0);
                cornerWorld(x, y, 3, c.height, p1);
                cornerWorld(x, y + 1, 0, nc.height, p2);
                cornerWorld(x, y + 1, 1, nc.height, p3);
                const cOwn = surfaceColor(front);
                const cL = cellTopColor(x, y + 1, cOwn);
                const cR = cellTopColor(x + 1, y + 1, cOwn);
                emitQuad(front, [p0, p1, p2, p3], [cL, cR, cL, cR]);
            }

            const right = surfaceOk(c.rightSurface);
            if (right !== null && x + 1 < gnd.width) {
                const rc = gnd.cells[y * gnd.width + (x + 1)];
                cornerWorld(x, y, 1, c.height, p0);
                cornerWorld(x, y, 3, c.height, p1);
                cornerWorld(x + 1, y, 0, rc.height, p2);
                cornerWorld(x + 1, y, 2, rc.height, p3);
                const cOwn = surfaceColor(right);
                const cT = cellTopColor(x + 1, y, cOwn);
                const cB = cellTopColor(x + 1, y + 1, cOwn);
                emitQuad(right, [p0, p1, p2, p3], [cT, cB, cT, cB]);
            }
        }
    }

    const groups: TerrainDrawGroup[] = [];
    let indexCursor = 0;
    const sortedIds = Array.from(buckets.keys()).sort((a, b) => a - b);
    for (const textureId of sortedIds) {
        const bucket = buckets.get(textureId)!;
        groups.push({ textureId, indexOffset: indexCursor, indexCount: bucket.length });
        for (const idx of bucket)
            indexData[indexCursor++] = idx;
    }

    return {
        vertexData,
        indexData,
        groups,
        lightmapAtlas,
        lightmapAtlasGridSide: gridSide,
        min, max,
    };
}

export interface SharedModelEntry {
    mesh: Pick<ModelMesh, "groups" | "bbox"> | null;
    animatedMesh: Pick<AnimatedModelMesh, "groups" | "nodes" | "animLength" | "modernRsm2" | "bbox"> | null;
    pose: AnimatedPose | null;
    vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    textures: (GfxTexture | null)[];
}

export interface ModelPlacement {
    modelKey: string;
    worldMatrix: mat4;
}

export interface AnimatedModelPlacement {
    modelKey: string;
    placementMatrix: mat4;
    animSpeed: number;
}

interface LiveModelInstance {
    entry: SharedModelEntry;
    worldMatrix: mat4;
}

interface LiveAnimatedModelInstance {
    entry: SharedModelEntry;
    placementMatrix: mat4;
    animator: ModelAnimator;
}

export interface ModelSceneData {
    entries: Map<string, SharedModelEntry>;
    instances: ModelPlacement[];
    animatedInstances: AnimatedModelPlacement[];
}

export interface LightSceneData {
    diffuse: vec3;
    ambient: vec3;
    longitudeDeg: number;
    pitchDeg: number;
}

export interface FogSceneData {
    enabled: boolean;
    color: vec3;
    tint: number;
}

export interface WaterSceneData {
    gndWidth: number;
    gndHeight: number;
    zoom: number;
    params: WaterParams;
    frames: (GfxTexture | null)[];
}

export interface WarpTarget {
    worldPos: vec3;
    radius: number;
    dest: string;
    destEra: Era;
    arrivalCellX?: number;
    arrivalCellY?: number;
    arrivalWorldPos?: vec3;
}

export interface WarpClickSceneData {
    targets: WarpTarget[];
}

export class RagnarokTerrainRenderer implements SceneGfx {

    public onstatechanged: (() => void) | undefined;

    private renderHelper: GfxRenderHelper;
    private renderInstList = new GfxRenderInstList();

    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    private groups: TerrainDrawGroup[];
    private textures: (GfxTexture | null)[] = [];
    private lightmapTexture: GfxTexture;
    private baseSamplerLinear: GfxSampler;
    private baseSamplerNearest: GfxSampler;
    private lightmapSampler: GfxSampler;

    private useNearestFiltering = false;

    private center = vec3.create();
    private radius = 1000;
    private cameraInitialized = false;

    private light: LightSceneData = {
        diffuse: vec3.fromValues(1, 1, 1),
        ambient: vec3.fromValues(0.3, 0.3, 0.3),
        longitudeDeg: 45,
        pitchDeg: 45,
    };
    private fog: FogSceneData = { enabled: false, color: vec3.create(), tint: 0 };

    private sky: SkySceneData = {
        color: vec3.fromValues(0.55, 0.75, 0.92),
        enableDome: false,
        horizonColor: vec3.fromValues(0.55, 0.75, 0.92),
        zenithColor: vec3.fromValues(0.30, 0.50, 0.78),
        groundColor: vec3.fromValues(0.30, 0.41, 0.51),
    };
    private skyDomeRenderer: SkyDomeRenderer | null = null;

    private sunLightDir = vec3.create();
    private sunSkyDir = vec3.create();

    private nightDegree = 0;

    private fogEnabled = true;
    private fogDistanceMode = false;
    private fogNear = 0;
    private fogFar = 0;

    private lightAmbientMul = 1.0;
    private lightDiffuseMul = 1.0;

    private showProps = true;
    private showWater = true;
    private showGrannyModels = true;
    private showParticles = true;
    private showWarpPortals = true;

    private scratchEye = vec3.create();
    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    private modelProgram: GfxProgram | null = null;
    private modelInputLayout: GfxInputLayout | null = null;
    private modelSamplerLinear: GfxSampler | null = null;
    private modelSamplerNearest: GfxSampler | null = null;
    private modelInstances: LiveModelInstance[] = [];

    private animatedInstances: LiveAnimatedModelInstance[] = [];
    private animNodeMatrices: mat4[] = [];
    private scratchWorld = mat4.create();

    private waterProgram: GfxProgram | null = null;
    private waterInputLayout: GfxInputLayout | null = null;
    private waterSampler: GfxSampler | null = null;
    private waterVertexBufferDescriptors: GfxVertexBufferDescriptor[] | null = null;
    private waterIndexBufferDescriptor: GfxIndexBufferDescriptor | null = null;
    private waterIndexCount = 0;
    private waterFrameTextures: (GfxTexture | null)[] = [];
    private waterParams: WaterParams | null = null;
    private waterAnimator: WaterAnimator | null = null;

    private spriteRenderer: SpriteRenderer | null = null;

    private mobs: MobEntity[] = [];

    private npcLabelRenderer: NameLabelRenderer | null = null;
    private mobLabelRenderer: NameLabelRenderer | null = null;
    private showNameLabels = true;

    private warpPortalRenderer: WarpPortalRenderer | null = null;

    private grannyModels: GrannyModelRenderer[] = [];

    private weatherRenderer: WeatherRenderer | null = null;
    private weatherEnabled = true;

    private particleRenderer: ParticleRenderer | null = null;

    private shadowRenderer: ShadowRenderer | null = null;
    private dustRenderer: DustRenderer | null = null;
    private npcShadowAnchors: vec3[] = [];
    private mobShadowAnchors: vec3[] = [];
    private shadowAnchorsScratch: vec3[] = [];
    private shadowsEnabled = true;

    private pointLights: PointLight[] = [];
    private pointLightsEnabled = true;

    private activeLights: PointLight[] = [];

    private bgm: Bgm;

    private gnd: GndMap;
    private warpTargets: WarpTarget[] = [];
    private arrivalCellX: number | null = null;
    private arrivalCellY: number | null = null;
    private warpTravelEnabled = true;
    private pendingClick: { x: number, y: number } | null = null;
    private pressX = 0;
    private pressY = 0;
    private pressMoved = 0;
    private pressActive = false;
    private mouseListenerTarget: HTMLElement | null = null;

    constructor(private sceneContext: SceneContext, private mapId: string, gnd: GndMap, groundTextures: (GfxTexture | null)[], modelSceneData: ModelSceneData | null, waterData: WaterSceneData | null, lightData: LightSceneData | null, fogData: FogSceneData | null, entityData: EntitySceneData | null, warpPortalData: WarpPortalSceneData | null, grannyData: GrannyInstance[] | null, weatherParams: WeatherParams | null, warpClickData: WarpClickSceneData | null, pointLights: PointLight[] | null, skyData: SkySceneData | null, particleData: ParticleSceneData | null, bgm: Bgm, private rebuildEntityLayer: (() => Promise<EntityLayerBundle>) | null) {
        const device = sceneContext.device;
        this.gnd = gnd;
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;

        if (lightData !== null)
            this.light = lightData;
        if (fogData !== null)
            this.fog = fogData;
        if (skyData !== null)
            this.sky = skyData;
        this.bgm = bgm;
        if (this.sky.enableDome)
            this.skyDomeRenderer = new SkyDomeRenderer(cache);

        this.updateSunDir();
        this.fogEnabled = this.fog.enabled;

        this.program = cache.createProgram(new TerrainProgram());

        const mesh = buildTerrainMesh(gnd);
        this.groups = mesh.groups;

        vec3.lerp(this.center, mesh.min, mesh.max, 0.5);
        this.radius = Math.max(vec3.distance(mesh.min, mesh.max) * 0.5, 1.0);

        this.fogNear = Math.max(this.radius * FOG_NEAR_RADIUS_FRACTION, FOG_NEAR_FLOOR_UNITS);
        this.fogFar = Math.max(this.radius * FOG_FAR_RADIUS_FRACTION, this.fogNear + FOG_FAR_MIN_DEPTH_UNITS);

        const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, mesh.vertexData);
        const indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexData.buffer);

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: TerrainProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: TerrainProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: TerrainProgram.a_LightCoord, format: GfxFormat.F32_RG, bufferByteOffset: 5 * 4, bufferIndex: 0 },
                { location: TerrainProgram.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 7 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.vertexBufferDescriptors = [{ buffer: vertexBuffer, byteOffset: 0 }];
        this.indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0 };

        this.textures = groundTextures;

        const lightmapAtlasSize = mesh.lightmapAtlasGridSide * 8;
        this.lightmapTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D,
            width: lightmapAtlasSize, height: lightmapAtlasSize,
            depthOrArrayLayers: 1,
            numLevels: 1,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.lightmapTexture, 0, [mesh.lightmapAtlas]);

        this.baseSamplerLinear = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.baseSamplerNearest = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        this.lightmapSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        if (modelSceneData !== null)
            this.setupModels(device, cache, modelSceneData);

        if (waterData !== null)
            this.setupWater(device, cache, waterData);

        if (entityData !== null)
            this.setupEntities(device, cache, entityData);

        if (warpPortalData !== null)
            this.warpPortalRenderer = new WarpPortalRenderer(device, cache, warpPortalData);

        if (grannyData !== null)
            for (const instance of grannyData)
                this.grannyModels.push(new GrannyModelRenderer(device, cache, instance));

        if (weatherParams !== null)
            this.weatherRenderer = new WeatherRenderer(device, cache, weatherParams);

        if (particleData !== null)
            this.particleRenderer = new ParticleRenderer(device, cache, particleData);

        if (warpClickData !== null)
            this.warpTargets = warpClickData.targets;

        this.syncMouseListeners();

        if (pointLights !== null)
            this.pointLights = pointLights;
    }

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0)
            return;
        this.pressActive = true;
        this.pressX = e.clientX;
        this.pressY = e.clientY;
        this.pressMoved = 0;
    };
    private onMouseMove = (e: MouseEvent): void => {
        if (!this.pressActive)
            return;

        this.pressMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
    };
    private onMouseUp = (e: MouseEvent): void => {
        if (e.button !== 0 || !this.pressActive)
            return;
        this.pressActive = false;
        if (this.pressMoved <= WARP_CLICK_MOVE_THRESHOLD_PX)
            this.pendingClick = { x: this.pressX, y: this.pressY };
    };

    private detachMouseListeners(): void {
        const target = this.mouseListenerTarget;
        if (target === null)
            return;
        target.removeEventListener("mousedown", this.onMouseDown);
        target.removeEventListener("mousemove", this.onMouseMove);
        target.removeEventListener("mouseup", this.onMouseUp);
        this.mouseListenerTarget = null;
        this.pressActive = false;
        this.pendingClick = null;
    }

    private syncMouseListeners(): void {
        const shouldListen = this.warpTargets.length > 0 || this.mobs.length > 0;
        if (shouldListen && this.mouseListenerTarget === null) {
            const target = this.sceneContext.inputManager.toplevel;
            target.addEventListener("mousedown", this.onMouseDown);
            target.addEventListener("mousemove", this.onMouseMove);
            target.addEventListener("mouseup", this.onMouseUp);
            this.mouseListenerTarget = target;
        } else if (!shouldListen) {
            this.detachMouseListeners();
        }
    }

    private setupEntities(device: GfxDevice, cache: GfxRenderHelper["renderCache"], entityData: EntitySceneData): void {
        if (entityData.sprites.length === 0 || (entityData.placements.length === 0 && entityData.mobs.length === 0))
            return;

        this.spriteRenderer = new SpriteRenderer(device, cache);
        this.shadowRenderer = new ShadowRenderer(device, cache);
        this.dustRenderer = new DustRenderer(device, cache);

        const sheetIndices = entityData.sprites.map((ls) => this.spriteRenderer!.addSheet(ls.spr));

        const sheetForSpr = new Map<SprModel, number>();
        for (let i = 0; i < entityData.sprites.length; i++)
            sheetForSpr.set(entityData.sprites[i].spr, sheetIndices[i]);

        this.npcLabelRenderer = new NameLabelRenderer(device, cache, NPC_LABEL_STYLE);
        this.mobLabelRenderer = new NameLabelRenderer(device, cache, MOB_LABEL_STYLE);

        for (const p of entityData.placements) {
            if (p.spriteIndex < 0 || p.spriteIndex >= entityData.sprites.length)
                continue;
            const ls = entityData.sprites[p.spriteIndex];
            const actor = new SpriteActor(ls.spr, ls.act, ls.footPxY);
            actor.setState(p.state);
            actor.setWorldDirection(p.direction);
            const worldPos = vec3.fromValues(p.worldPos[0], p.worldPos[1], p.worldPos[2]);
            const anchor = p.anchor ?? "feet";
            const kind: SpriteKind = p.kind ?? "npc";
            this.spriteRenderer.addInstance({
                sheet: sheetIndices[p.spriteIndex],
                actor,
                worldPos,
                anchor,
                kind,
            });

            if (anchor === "feet" && kind === "npc")
                this.npcShadowAnchors.push(worldPos);
            if (p.name.length > 0) {

                const headHeight = actor.currentFrameTopAboveAnchor(anchor);
                const heightAbove = headHeight !== null ? headHeight : 10;
                this.npcLabelRenderer.addLabel({ text: p.name, worldPos, heightAbove });
            }
        }
        if (!this.npcLabelRenderer.hasLabels)
            this.npcLabelRenderer = null;

        for (const mob of entityData.mobs) {
            const sheet = sheetForSpr.get(mob.actor.sprModel);
            if (sheet === undefined)
                continue;
            this.spriteRenderer.addInstance({
                sheet,
                actor: mob.actor,
                worldPos: mob.worldPos,
                kind: "mob",
            });
            this.mobShadowAnchors.push(mob.worldPos);
            if (mob.name.length > 0) {
                const headHeight = mob.actor.currentFrameTopAboveAnchor("feet");
                const heightAbove = headHeight !== null ? headHeight : 6;
                this.mobLabelRenderer.addLabel({ text: mob.name, worldPos: mob.worldPos, heightAbove });
            }
        }
        if (!this.mobLabelRenderer.hasLabels)
            this.mobLabelRenderer = null;
        this.mobs = entityData.mobs;
        this.dustRenderer?.setMobs(this.mobs);
    }

    private reloadToken = 0;

    private async reloadEntities(): Promise<void> {
        if (this.rebuildEntityLayer === null)
            return;
        const token = ++this.reloadToken;
        const { entityData, warpPortalData, warpClickData } = await this.rebuildEntityLayer();
        if (token !== this.reloadToken)
            return;
        const device = this.sceneContext.device;
        const cache = this.renderHelper.renderCache;

        if (this.spriteRenderer !== null) { this.spriteRenderer.destroy(device); this.spriteRenderer = null; }
        if (this.shadowRenderer !== null) { this.shadowRenderer.destroy(device); this.shadowRenderer = null; }
        if (this.dustRenderer !== null) { this.dustRenderer.destroy(device); this.dustRenderer = null; }
        if (this.npcLabelRenderer !== null) { this.npcLabelRenderer.destroy(device); this.npcLabelRenderer = null; }
        if (this.mobLabelRenderer !== null) { this.mobLabelRenderer.destroy(device); this.mobLabelRenderer = null; }
        if (this.warpPortalRenderer !== null) { this.warpPortalRenderer.destroy(device); this.warpPortalRenderer = null; }
        this.mobs = [];
        this.npcShadowAnchors = [];
        this.mobShadowAnchors = [];

        this.setupEntities(device, cache, entityData);
        if (warpPortalData !== null)
            this.warpPortalRenderer = new WarpPortalRenderer(device, cache, warpPortalData);
        this.warpTargets = warpClickData.targets;
        this.syncMouseListeners();
    }

    private setupWater(device: GfxDevice, cache: GfxRenderHelper["renderCache"], waterData: WaterSceneData): void {
        const hasFrame = waterData.frames.some((f) => f !== null);
        if (!hasFrame)
            return;

        this.waterProgram = cache.createProgram(new WaterProgram());

        this.waterInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: WaterProgram.a_WorldXZ, format: GfxFormat.F32_RG, bufferByteOffset: 0, bufferIndex: 0 },
                { location: WaterProgram.a_Grid, format: GfxFormat.F32_R, bufferByteOffset: 2 * 4, bufferIndex: 0 },
                { location: WaterProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: WATER_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.waterSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const mesh = buildWaterMesh(waterData.gndWidth, waterData.gndHeight, waterData.zoom);
        const vbuf = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, mesh.vertexData);
        const ibuf = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexData.buffer);
        this.waterVertexBufferDescriptors = [{ buffer: vbuf, byteOffset: 0 }];
        this.waterIndexBufferDescriptor = { buffer: ibuf, byteOffset: 0 };
        this.waterIndexCount = mesh.indexData.length;

        this.waterFrameTextures = waterData.frames;

        this.waterParams = waterData.params;
        this.waterAnimator = new WaterAnimator(waterData.params.animSpeed, waterData.params.waveSpeed);
    }

    private setupModels(device: GfxDevice, cache: GfxRenderHelper["renderCache"], sceneData: ModelSceneData): void {
        this.modelProgram = cache.createProgram(new ModelProgram());

        this.modelInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: ModelProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: ModelProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: ModelProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 5 * 4, bufferIndex: 0 },
                { location: ModelProgram.a_Color, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 8 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: MODEL_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.modelSamplerLinear = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
        this.modelSamplerNearest = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        for (const placement of sceneData.instances) {
            const entry = sceneData.entries.get(placement.modelKey);
            if (entry === undefined || entry.mesh === null)
                continue;
            this.modelInstances.push({ entry, worldMatrix: placement.worldMatrix });
        }

        for (const placement of sceneData.animatedInstances) {
            const entry = sceneData.entries.get(placement.modelKey);
            if (entry === undefined || entry.animatedMesh === null)
                continue;
            this.animatedInstances.push({
                entry,
                placementMatrix: placement.placementMatrix,
                animator: new ModelAnimator(entry.animatedMesh.animLength, placement.animSpeed),
            });
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];
        const layers = this.buildLayersPanel();
        if (layers !== null)
            panels.push(layers);
        panels.push(this.buildRenderHacksPanel());
        return panels;
    }

    private addCheckbox(panel: UI.Panel, label: string, initial: boolean, set: (v: boolean) => void): void {
        const c = new UI.Checkbox(label, initial);
        c.onchanged = () => { set(c.checked); this.onstatechanged?.(); };
        panel.contents.appendChild(c.elem);
    }

    private addSlider(panel: UI.Panel, label: string, min: number, max: number, step: number, initial: number, set: (v: number) => void): void {
        const s = new UI.Slider();
        s.setLabel(label);
        s.setRange(min, max, step);
        s.setValue(initial);
        s.onvalue = (v) => { set(v); this.onstatechanged?.(); };
        panel.contents.appendChild(s.elem);
    }

    private buildLayersPanel(): UI.Panel | null {
        const spr = this.spriteRenderer;
        const hasNPC = spr !== null && spr.hasKind("npc");
        const hasEffect = spr !== null && spr.hasKind("effect");
        const hasMob = this.mobs.length > 0;
        const hasProps = this.modelInstances.length > 0 || this.animatedInstances.length > 0;
        const hasWater = this.waterProgram !== null;
        const hasGranny = this.grannyModels.length > 0;
        const hasParticles = this.particleRenderer !== null;
        const hasWarpPortals = this.warpPortalRenderer !== null;
        const hasLabels = hasNPC || hasMob;

        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.LAYER_ICON, "Layers");

        if (!this.mapId.endsWith("@classic")) {
            const classicToggle = new UI.Checkbox("Pre-Renewal Era", currentEra() === "classic");
            classicToggle.onchanged = () => {
                setEra(classicToggle.checked ? "classic" : "renewal");
                void this.reloadEntities();
            };
            panel.contents.appendChild(classicToggle.elem);
        }

        if (spr !== null && hasNPC)
            this.addCheckbox(panel, "Show NPCs", spr.isKindEnabled("npc"), (v) => this.spriteRenderer?.setKindEnabled("npc", v));
        if (spr !== null && hasMob)
            this.addCheckbox(panel, "Show Monsters", spr.isKindEnabled("mob"), (v) => this.spriteRenderer?.setKindEnabled("mob", v));
        if (spr !== null && hasEffect)
            this.addCheckbox(panel, "Show Effect Sprites", spr.isKindEnabled("effect"), (v) => this.spriteRenderer?.setKindEnabled("effect", v));
        if (hasProps)
            this.addCheckbox(panel, "Show Map Props", this.showProps, (v) => { this.showProps = v; });
        if (hasWater)
            this.addCheckbox(panel, "Show Water", this.showWater, (v) => { this.showWater = v; });
        if (hasGranny)
            this.addCheckbox(panel, "Show WoE Models", this.showGrannyModels, (v) => { this.showGrannyModels = v; });
        if (hasParticles)
            this.addCheckbox(panel, "Show Particles", this.showParticles, (v) => { this.showParticles = v; });
        if (hasWarpPortals)
            this.addCheckbox(panel, "Show Warp Portals", this.showWarpPortals, (v) => { this.showWarpPortals = v; });
        if (hasLabels)
            this.addCheckbox(panel, "Show Name Labels", this.showNameLabels, (v) => { this.showNameLabels = v; });
        return panel;
    }

    private buildRenderHacksPanel(): UI.Panel {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");

        this.addCheckbox(panel, "Crisp Texture Filtering", this.useNearestFiltering, (v) => { this.useNearestFiltering = v; });
        this.addCheckbox(panel, "Enable Blob Shadows", this.shadowsEnabled, (v) => { this.shadowsEnabled = v; });
        if (this.warpTargets.length > 0)
            this.addCheckbox(panel, "Click Warps to Travel", this.warpTravelEnabled, (v) => { this.warpTravelEnabled = v; });
        if (this.pointLights.length > 0)
            this.addCheckbox(panel, "Enable Point Lights", this.pointLightsEnabled, (v) => { this.pointLightsEnabled = v; });
        if (this.weatherRenderer !== null)
            this.addCheckbox(panel, "Enable Weather", this.weatherEnabled, (v) => { this.weatherEnabled = v; });

        this.addCheckbox(panel, "Enable Fog", this.fogEnabled, (v) => { this.fogEnabled = v; });
        this.addSlider(panel, "Fog Intensity", 0, 1, 0.01, this.fog.tint, (v) => { this.fog.tint = v; });
        this.addCheckbox(panel, "Distance-Based Fog", this.fogDistanceMode, (v) => { this.fogDistanceMode = v; });
        const distMax = Math.max(this.radius * FOG_DIST_SLIDER_MAX_MULT, FOG_DIST_SLIDER_MAX_FLOOR);
        this.addSlider(panel, "Fog Near", 0, distMax, 1, this.fogNear, (v) => { this.fogNear = v; });
        this.addSlider(panel, "Fog Far", 0, distMax, 1, this.fogFar, (v) => { this.fogFar = v; });

        this.addSlider(panel, "Ambient Light", 0, LIGHT_MULTIPLIER_MAX, 0.01, this.lightAmbientMul, (v) => { this.lightAmbientMul = v; });
        this.addSlider(panel, "Diffuse Light", 0, LIGHT_MULTIPLIER_MAX, 0.01, this.lightDiffuseMul, (v) => { this.lightDiffuseMul = v; });
        this.addSlider(panel, "Sun Longitude", -180, 180, 1, this.light.longitudeDeg, (v) => { this.light.longitudeDeg = v; this.updateSunDir(); });
        this.addSlider(panel, "Sun Pitch", -90, 90, 1, this.light.pitchDeg, (v) => { this.light.pitchDeg = v; this.updateSunDir(); });

        this.addSlider(panel, "Night", 0, 1, 0.01, this.nightDegree, (v) => { this.nightDegree = v; });

        const bgmToggle = new UI.Checkbox("BGM (per-map music)", this.bgm.isEnabled());

        bgmToggle.onchanged = () => this.bgm.setEnabled(bgmToggle.checked, null);
        panel.contents.appendChild(bgmToggle.elem);

        const bgmVol = new UI.Slider();
        bgmVol.setLabel("BGM volume");
        bgmVol.setRange(0, 1, 0.01);
        bgmVol.setValue(this.bgm.getVolume());
        bgmVol.onvalue = (v: number) => this.bgm.setVolume(v);
        panel.contents.appendChild(bgmVol.elem);

        return panel;
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(0.04);
        c.setKeyMoveSpeed(64);
    }

    private resolveLighting(): { diffuse: vec3, ambient: vec3, envDiff: vec3 } {
        const d = this.light.diffuse, a = this.light.ambient;
        const n = this.nightDegree;
        const mD = this.lightDiffuseMul, mA = this.lightAmbientMul;
        const dr = (d[0] + (Math.min(d[0], 0.5) - d[0]) * n) * mD;
        const dg = (d[1] + (Math.min(d[1], 0.5) - d[1]) * n) * mD;
        const db = d[2] * mD;
        const ar = a[0] * mA, ag = a[1] * mA, ab = a[2] * mA;
        const diffuse = vec3.fromValues(dr, dg, db);
        const ambient = vec3.fromValues(ar, ag, ab);
        const envDiff = vec3.fromValues(
            1.0 - (1.0 - Math.min(dr, 1)) * (1.0 - Math.min(ar, 1)),
            1.0 - (1.0 - Math.min(dg, 1)) * (1.0 - Math.min(ag, 1)),
            1.0 - (1.0 - Math.min(db, 1)) * (1.0 - Math.min(ab, 1)),
        );
        return { diffuse, ambient, envDiff };
    }

    private fillFogUniforms(d: Float32Array, offs: number): number {
        offs += fillVec4(d, offs, this.fog.color[0], this.fog.color[1], this.fog.color[2], this.fogEnabled ? 1 : 0);
        offs += fillVec4(d, offs, this.fog.tint, this.fogDistanceMode ? 1 : 0, this.fogNear, this.fogFar);
        return offs;
    }

    private updateSunDir(): void {
        computeSunDirections(this.light.longitudeDeg, this.light.pitchDeg, this.sunLightDir, this.sunSkyDir);
    }

    private refreshActiveLights(): void {
        if (this.pointLights.length === 0 || !this.pointLightsEnabled) {
            this.activeLights.length = 0;
            return;
        }
        pickActiveLights(
            this.pointLights,
            this.scratchEye[0], this.scratchEye[1], this.scratchEye[2],
            this.activeLights,
        );
    }

    private fillPointLightUniforms(d: Float32Array, offs: number): number {
        const start = offs;
        const enabled = this.pointLightsEnabled && this.pointLights.length > 0 ? 1 : 0;
        const count = this.activeLights.length;
        offs += fillVec4(d, offs, count, POINT_LIGHT_INTENSITY, POINT_LIGHT_FALLOFF_EXPONENT, enabled);
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            if (i < count) {
                const l = this.activeLights[i];
                offs += fillVec4(d, offs, l.pos[0], l.pos[1], l.pos[2], l.range);
            } else {
                offs += fillVec4(d, offs, 0, 0, 0, 0);
            }
        }
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            if (i < count) {
                const l = this.activeLights[i];
                offs += fillVec4(d, offs, l.color[0], l.color[1], l.color[2], 0);
            } else {
                offs += fillVec4(d, offs, 0, 0, 0, 0);
            }
        }
        return offs - start;
    }

    private prepareToRender(viewerInput: ViewerRenderInput): void {

        const mobDtSeconds = viewerInput.deltaTime / 1000;
        for (const mob of this.mobs)
            mob.update(mobDtSeconds);

        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstList);

        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchEye, camWorld[12], camWorld[13], camWorld[14]);

        this.skyDomeRenderer?.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix, this.scratchEye, this.sky, this.sunSkyDir);

        const lit = this.resolveLighting();

        this.refreshActiveLights();

        this.prepareTerrain(viewerInput, lit);

        this.prepareModels(viewerInput);

        if (this.grannyModels.length > 0 && this.showGrannyModels) {

            const opaque = this.renderHelper.pushTemplateRenderInst();
            opaque.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            for (const g of this.grannyModels)
                g.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix, this.sunLightDir, lit.diffuse, lit.ambient, viewerInput.deltaTime / 1000, this.activeLights, this.activeLights.length);
            renderInstManager.popTemplate();
        }

        this.prepareWater(viewerInput);

        this.prepareShadows(viewerInput);

        this.prepareSprites(viewerInput);

        this.prepareParticles(viewerInput);

        this.prepareDust(viewerInput);

        this.prepareWarpPortals(viewerInput);

        this.prepareWeather(viewerInput);

        this.processMobClick(viewerInput);
        this.processWarpClick(viewerInput);

        this.renderHelper.prepareToRender();
    }

    private prepareTerrain(viewerInput: ViewerRenderInput, lit: { diffuse: vec3, ambient: vec3, envDiff: vec3 }): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{
            numUniformBuffers: 1,
            numSamplers: 2,
            samplerEntries: [
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
                { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
            ],
        }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        template.setMegaStateFlags({ cullMode: GfxCullMode.None });
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        const pointLightVec4Count = 1 + 2 * MAX_POINT_LIGHTS;
        let offs = template.allocateUniformBuffer(TerrainProgram.ub_SceneParams, 16 + 5 * 4 + pointLightVec4Count * 4);
        const mapped = template.mapUniformBufferF32(TerrainProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(mapped, offs, lit.envDiff[0], lit.envDiff[1], lit.envDiff[2], 1.0);
        offs = this.fillFogUniforms(mapped, offs);
        offs += fillVec4(mapped, offs, this.scratchEye[0], this.scratchEye[1], this.scratchEye[2], 0);
        offs += this.fillPointLightUniforms(mapped, offs);

        for (const group of this.groups) {
            if (group.indexCount === 0)
                continue;
            const baseTexture = (group.textureId >= 0 && group.textureId < this.textures.length) ? this.textures[group.textureId] : null;
            if (baseTexture === null)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            const baseSampler = this.useNearestFiltering ? this.baseSamplerNearest : this.baseSamplerLinear;
            renderInst.setSamplerBindingsFromTextureMappings([
                { gfxTexture: baseTexture, gfxSampler: baseSampler },
                { gfxTexture: this.lightmapTexture, gfxSampler: this.lightmapSampler },
            ]);
            renderInst.setDrawCount(group.indexCount, group.indexOffset);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    private prepareWater(viewerInput: ViewerRenderInput): void {
        if (!this.showWater)
            return;
        if (this.waterProgram === null || this.waterInputLayout === null || this.waterSampler === null)
            return;
        if (this.waterVertexBufferDescriptors === null || this.waterIndexBufferDescriptor === null)
            return;
        if (this.waterParams === null || this.waterAnimator === null || this.waterIndexCount === 0)
            return;

        this.waterAnimator.update(viewerInput.deltaTime / 1000);

        const frameIndex = this.waterAnimator.frameIndex;
        let tex = (frameIndex >= 0 && frameIndex < this.waterFrameTextures.length) ? this.waterFrameTextures[frameIndex] : null;
        if (tex === null) {
            tex = this.waterFrameTextures.find((t) => t !== null) ?? null;
        }
        if (tex === null)
            return;

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.waterProgram);
        template.setVertexInput(this.waterInputLayout, this.waterVertexBufferDescriptors, this.waterIndexBufferDescriptor);

        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
        const megaState = template.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const renderInst = renderInstManager.newRenderInst();

        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchEye, camWorld[12], camWorld[13], camWorld[14]);

        let offs = renderInst.allocateUniformBuffer(WaterProgram.ub_WaterParams, 16 + 4 + 3 * 4);
        const mapped = renderInst.mapUniformBufferF32(WaterProgram.ub_WaterParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(mapped, offs, this.waterParams.level, this.waterAnimator.waveOffsetDeg, this.waterParams.wavePitch, this.waterParams.waveHeight);
        offs = this.fillFogUniforms(mapped, offs);
        offs += fillVec4(mapped, offs, this.scratchEye[0], this.scratchEye[1], this.scratchEye[2], 0);

        renderInst.setSamplerBindingsFromTextureMappings([
            { gfxTexture: tex, gfxSampler: this.waterSampler },
        ]);
        renderInst.setDrawCount(this.waterIndexCount, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    private prepareSprites(viewerInput: ViewerRenderInput): void {
        if (this.spriteRenderer === null)
            return;
        const renderInstManager = this.renderHelper.renderInstManager;

        const opaque = this.renderHelper.pushTemplateRenderInst();
        opaque.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
        this.spriteRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            viewerInput.camera.worldMatrix,
            viewerInput.deltaTime / 1000,
        );
        renderInstManager.popTemplate();

        if (this.showNameLabels) {
            if (this.npcLabelRenderer !== null && this.spriteRenderer.isKindEnabled("npc"))
                this.npcLabelRenderer.prepare(
                    this.renderHelper,
                    viewerInput.camera.clipFromWorldMatrix,
                    viewerInput.camera.worldMatrix,
                );
            if (this.mobLabelRenderer !== null && this.spriteRenderer.isKindEnabled("mob"))
                this.mobLabelRenderer.prepare(
                    this.renderHelper,
                    viewerInput.camera.clipFromWorldMatrix,
                    viewerInput.camera.worldMatrix,
                );
        }
    }

    private processMobClick(viewerInput: ViewerRenderInput): void {
        const click = this.pendingClick;
        if (click === null || this.mobs.length === 0)
            return;
        if (!assertExists(this.spriteRenderer).isKindEnabled("mob"))
            return;

        const clipFromWorld = viewerInput.camera.clipFromWorldMatrix;
        const dpr = window.devicePixelRatio || 1;
        const clickX = click.x * dpr;
        const clickY = click.y * dpr;
        const w = viewerInput.backbufferWidth;
        const h = viewerInput.backbufferHeight;
        if (w <= 0 || h <= 0)
            return;

        const projectToScreen = (p: vec3, out: [number, number]): boolean => {
            vec4.set(scratchClip, p[0], p[1], p[2], 1.0);
            vec4.transformMat4(scratchClip, scratchClip, clipFromWorld);
            const cw = scratchClip[3];
            if (cw <= 1e-5)
                return false;
            const ndcX = scratchClip[0] / cw;
            const ndcY = scratchClip[1] / cw;
            out[0] = (ndcX * 0.5 + 0.5) * w;
            out[1] = (1.0 - (ndcY * 0.5 + 0.5)) * h;
            return true;
        };

        const slopPx = MOB_CLICK_PIXEL_SLOP * dpr;
        const camWorld = viewerInput.camera.worldMatrix;
        let best: MobEntity | null = null;
        let bestDist = Infinity;
        for (const mob of this.mobs) {
            if (mob.lifecycle !== "alive")
                continue;

            const size = mob.actor.currentFrameWorldSize();
            const halfH = size !== null ? size.height * 0.5 : MOB_FALLBACK_HALF_HEIGHT;
            const radius = (size !== null ? Math.max(size.width, size.height) * 0.5 : MOB_FALLBACK_RADIUS) * MOB_HITBOX_BUFFER;
            const cx = mob.worldPos[0];
            const cy = mob.worldPos[1] + halfH;
            const cz = mob.worldPos[2];
            vec3.set(scratchOffset, cx, cy, cz);
            if (!projectToScreen(scratchOffset, scratchScreen))
                continue;

            vec3.set(scratchOffset,
                cx + camWorld[0] * radius,
                cy + camWorld[1] * radius,
                cz + camWorld[2] * radius);
            let pixelRadius = slopPx;
            if (projectToScreen(scratchOffset, scratchScreen2))
                pixelRadius = Math.hypot(scratchScreen2[0] - scratchScreen[0], scratchScreen2[1] - scratchScreen[1]) + slopPx;

            const dx = scratchScreen[0] - clickX;
            const dy = scratchScreen[1] - clickY;
            const dist = Math.hypot(dx, dy);
            if (dist <= pixelRadius && dist < bestDist) {
                bestDist = dist;
                best = mob;
            }
        }
        if (best === null)
            return;
        best.kill();
        this.pendingClick = null;
    }

    private processWarpClick(viewerInput: ViewerRenderInput): void {
        const click = this.pendingClick;
        this.pendingClick = null;
        if (click === null || !this.warpTravelEnabled || this.warpTargets.length === 0)
            return;

        const clipFromWorld = viewerInput.camera.clipFromWorldMatrix;

        const dpr = window.devicePixelRatio || 1;
        const clickX = click.x * dpr;
        const clickY = click.y * dpr;
        const w = viewerInput.backbufferWidth;
        const h = viewerInput.backbufferHeight;
        if (w <= 0 || h <= 0)
            return;

        const projectToScreen = (p: vec3, out: [number, number]): boolean => {
            vec4.set(scratchClip, p[0], p[1], p[2], 1.0);
            vec4.transformMat4(scratchClip, scratchClip, clipFromWorld);
            const cw = scratchClip[3];
            if (cw <= 1e-5)
                return false;
            const ndcX = scratchClip[0] / cw;
            const ndcY = scratchClip[1] / cw;

            out[0] = (ndcX * 0.5 + 0.5) * w;
            out[1] = (1.0 - (ndcY * 0.5 + 0.5)) * h;
            return true;
        };

        const slopPx = WARP_CLICK_PIXEL_SLOP * dpr;
        let best: WarpTarget | null = null;
        let bestDist = Infinity;
        for (const t of this.warpTargets) {
            if (!projectToScreen(t.worldPos, scratchScreen))
                continue;
            const dx = scratchScreen[0] - clickX;
            const dy = scratchScreen[1] - clickY;
            const dist = Math.hypot(dx, dy);

            const camWorld = viewerInput.camera.worldMatrix;
            vec3.set(scratchOffset,
                t.worldPos[0] + camWorld[0] * t.radius,
                t.worldPos[1] + camWorld[1] * t.radius,
                t.worldPos[2] + camWorld[2] * t.radius);
            let pixelRadius = slopPx;
            if (projectToScreen(scratchOffset, scratchScreen2))
                pixelRadius = Math.hypot(scratchScreen2[0] - scratchScreen[0], scratchScreen2[1] - scratchScreen[1]) + slopPx;

            if (dist <= pixelRadius && dist < bestDist) {
                bestDist = dist;
                best = t;
            }
        }

        if (best === null)
            return;

        if (best.arrivalWorldPos !== undefined) {
            this.frameArrivalAt(viewerInput, best.arrivalWorldPos);
            return;
        }
        if (best.destEra !== currentEra())
            setEra(best.destEra);
        triggerTravel(this.sceneContext.sceneLoader, best.dest, best.arrivalCellX, best.arrivalCellY, viewerInput.camera.worldMatrix);
    }

    private frameArrivalAt(viewerInput: ViewerRenderInput, target: vec3): void {
        const ARRIVAL_CAMERA_OFFSET = 50;
        const eye = vec3.fromValues(target[0], target[1] + ARRIVAL_CAMERA_OFFSET, target[2] + ARRIVAL_CAMERA_OFFSET);
        mat4.targetTo(viewerInput.camera.worldMatrix, eye, target, Vec3UnitY);
        viewerInput.camera.worldMatrixUpdated();
    }

    private prepareWarpPortals(viewerInput: ViewerRenderInput): void {
        if (this.warpPortalRenderer === null || !this.showWarpPortals)
            return;
        this.warpPortalRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            viewerInput.camera.worldMatrix,
            viewerInput.deltaTime / 1000,
        );
    }

    private prepareShadows(viewerInput: ViewerRenderInput): void {
        if (this.shadowRenderer === null || !this.shadowsEnabled)
            return;
        const spr = assertExists(this.spriteRenderer);
        const showNpc = spr.isKindEnabled("npc");
        const showMob = spr.isKindEnabled("mob");
        if (!showNpc && !showMob)
            return;
        const out = this.shadowAnchorsScratch;
        out.length = 0;
        if (showNpc) for (const a of this.npcShadowAnchors) out.push(a);
        if (showMob) for (const a of this.mobShadowAnchors) out.push(a);
        if (out.length === 0)
            return;
        this.shadowRenderer.setAnchors(out, ShadowRenderer.defaultHalfSize());
        this.shadowRenderer.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix);
    }

    private prepareParticles(viewerInput: ViewerRenderInput): void {
        if (this.particleRenderer === null || !this.showParticles)
            return;
        const dt = viewerInput.deltaTime / 1000;
        this.particleRenderer.update(dt);
        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchRight, camWorld[0], camWorld[1], camWorld[2]);
        vec3.set(this.scratchUp, camWorld[4], camWorld[5], camWorld[6]);
        this.particleRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            this.scratchRight,
            this.scratchUp,
        );
    }

    private prepareDust(viewerInput: ViewerRenderInput): void {
        if (this.dustRenderer === null)
            return;
        if (!assertExists(this.spriteRenderer).isKindEnabled("mob"))
            return;
        const dt = viewerInput.deltaTime / 1000;
        this.dustRenderer.update(dt);
        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchRight, camWorld[0], camWorld[1], camWorld[2]);
        vec3.set(this.scratchUp, camWorld[4], camWorld[5], camWorld[6]);
        this.dustRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            this.scratchRight,
            this.scratchUp,
        );
    }

    private prepareWeather(viewerInput: ViewerRenderInput): void {
        if (this.weatherRenderer === null || !this.weatherEnabled)
            return;
        this.weatherRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            viewerInput.camera.worldMatrix,
            viewerInput.deltaTime / 1000,
        );
    }

    private prepareModels(viewerInput: ViewerRenderInput): void {

        const dtSeconds = viewerInput.deltaTime / 1000;
        for (const inst of this.animatedInstances)
            inst.animator.update(dtSeconds);

        if (!this.showProps)
            return;
        if (this.modelProgram === null || this.modelInputLayout === null || this.modelSamplerLinear === null || this.modelSamplerNearest === null)
            return;
        if (this.modelInstances.length === 0 && this.animatedInstances.length === 0)
            return;

        const modelSampler = this.useNearestFiltering ? this.modelSamplerNearest : this.modelSamplerLinear;

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 1 }]);
        template.setGfxProgram(this.modelProgram);
        template.setMegaStateFlags({ cullMode: GfxCullMode.None });
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchEye, camWorld[12], camWorld[13], camWorld[14]);

        const lit = this.resolveLighting();
        const L = this.sunLightDir;

        const pointLightVec4Count = 1 + 2 * MAX_POINT_LIGHTS;
        let sceneOffs = template.allocateUniformBuffer(ModelProgram.ub_SceneParams, 16 + 6 * 4 + pointLightVec4Count * 4);
        const sceneMapped = template.mapUniformBufferF32(ModelProgram.ub_SceneParams);
        sceneOffs += fillMatrix4x4(sceneMapped, sceneOffs, viewerInput.camera.clipFromWorldMatrix);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, L[0], L[1], L[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, lit.diffuse[0], lit.diffuse[1], lit.diffuse[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, lit.ambient[0], lit.ambient[1], lit.ambient[2], 0);
        sceneOffs = this.fillFogUniforms(sceneMapped, sceneOffs);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, this.scratchEye[0], this.scratchEye[1], this.scratchEye[2], 0);
        sceneOffs += this.fillPointLightUniforms(sceneMapped, sceneOffs);

        for (const inst of this.modelInstances) {
            const entry = inst.entry;
            for (const group of entry.mesh!.groups) {
                if (group.indexCount === 0)
                    continue;
                const tex = (group.textureId >= 0 && group.textureId < entry.textures.length) ? entry.textures[group.textureId] : null;
                if (tex === null)
                    continue;

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.modelInputLayout, entry.vertexBufferDescriptors, entry.indexBufferDescriptor);

                let offs = renderInst.allocateUniformBuffer(ModelProgram.ub_ModelParams, 16);
                const mapped = renderInst.mapUniformBufferF32(ModelProgram.ub_ModelParams);
                offs += fillMatrix4x4(mapped, offs, inst.worldMatrix);

                renderInst.setSamplerBindingsFromTextureMappings([
                    { gfxTexture: tex, gfxSampler: modelSampler },
                ]);
                renderInst.setDrawCount(group.indexCount, group.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            }
        }

        for (const inst of this.animatedInstances) {
            const entry = inst.entry;
            const animMesh = entry.animatedMesh!;
            entry.pose!.evaluate(inst.animator.currentFrame, this.animNodeMatrices);

            for (const group of animMesh.groups) {
                if (group.indexCount === 0)
                    continue;
                const tex = (group.textureId >= 0 && group.textureId < entry.textures.length) ? entry.textures[group.textureId] : null;
                if (tex === null)
                    continue;
                if (group.nodeIndex < 0 || group.nodeIndex >= animMesh.nodes.length)
                    continue;

                mat4.mul(this.scratchWorld, inst.placementMatrix, this.animNodeMatrices[group.nodeIndex]);

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.modelInputLayout, entry.vertexBufferDescriptors, entry.indexBufferDescriptor);

                let offs = renderInst.allocateUniformBuffer(ModelProgram.ub_ModelParams, 16);
                const mapped = renderInst.mapUniformBufferF32(ModelProgram.ub_ModelParams);
                offs += fillMatrix4x4(mapped, offs, this.scratchWorld);

                renderInst.setSamplerBindingsFromTextureMappings([
                    { gfxTexture: tex, gfxSampler: modelSampler },
                ]);
                renderInst.setDrawCount(group.indexCount, group.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            }
        }

        renderInstManager.popTemplate();
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        const eye = vec3.fromValues(this.center[0], this.center[1] + this.radius * 1.2, this.center[2] + this.radius * 1.2);
        mat4.targetTo(dst, eye, this.center, Vec3UnitY);
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);

        if (this.arrivalCellX !== null && this.arrivalCellY !== null) {
            view.setUint8(offs++, 1);
            view.setInt16(offs, this.arrivalCellX, true); offs += 2;
            view.setInt16(offs, this.arrivalCellY, true); offs += 2;
        } else {
            view.setUint8(offs++, 0);
        }

        let fogPacked = 0;
        if (this.fogEnabled)      fogPacked |= 0x01;
        if (this.fogDistanceMode) fogPacked |= 0x02;
        view.setUint8(offs++, fogPacked);
        view.setUint8(offs++, clamp(Math.round(this.fog.tint * 255), 0, 255));
        view.setUint16(offs, clamp(Math.round(this.fogNear), 0, 0xffff), true); offs += 2;
        view.setUint16(offs, clamp(Math.round(this.fogFar), 0, 0xffff), true); offs += 2;

        view.setInt16(offs, Math.round(this.light.longitudeDeg), true); offs += 2;
        view.setInt16(offs, Math.round(this.light.pitchDeg), true); offs += 2;

        view.setUint8(offs++, clamp(Math.round(this.nightDegree * 255), 0, 255));

        const bits = new BitMap(NUM_LAYER_BITS);
        const spr = this.spriteRenderer;
        bits.setBit(LayerBit.NPCs, spr !== null && spr.isKindEnabled("npc"));
        bits.setBit(LayerBit.Mobs, spr !== null && spr.isKindEnabled("mob"));
        bits.setBit(LayerBit.Effects, spr !== null && spr.isKindEnabled("effect"));
        bits.setBit(LayerBit.Props, this.showProps);
        bits.setBit(LayerBit.Water, this.showWater);
        bits.setBit(LayerBit.Granny, this.showGrannyModels);
        bits.setBit(LayerBit.Particles, this.showParticles);
        bits.setBit(LayerBit.NameLabels, this.showNameLabels);
        bits.setBit(LayerBit.Weather, this.weatherEnabled);
        bits.setBit(LayerBit.WarpPortals, this.showWarpPortals);
        offs = bitMapSerialize(view, offs, bits);

        return offs;
    }

    public deserializeSaveState(src: ArrayBufferSlice): void {
        const view = src.createDataView();
        let offs = 0;

        if (view.byteLength - offs < 1)
            return;
        const hasArrival = view.getUint8(offs++);
        if (hasArrival === 1) {
            if (view.byteLength - offs < 4)
                return;
            this.arrivalCellX = view.getInt16(offs, true); offs += 2;
            this.arrivalCellY = view.getInt16(offs, true); offs += 2;
        }

        if (view.byteLength - offs < 6)
            return;
        const fogPacked = view.getUint8(offs++);
        this.fogEnabled = (fogPacked & 0x01) !== 0;
        this.fogDistanceMode = (fogPacked & 0x02) !== 0;
        this.fog.tint = view.getUint8(offs++) / 255;
        this.fogNear = view.getUint16(offs, true); offs += 2;
        this.fogFar = view.getUint16(offs, true); offs += 2;

        if (view.byteLength - offs < 4)
            return;
        this.light.longitudeDeg = view.getInt16(offs, true); offs += 2;
        this.light.pitchDeg = view.getInt16(offs, true); offs += 2;
        this.updateSunDir();

        if (view.byteLength - offs < 1)
            return;
        this.nightDegree = view.getUint8(offs++) / 255;

        const layerBytes = bitMapGetSerializedByteLength(NUM_LAYER_BITS);
        if (view.byteLength - offs < layerBytes)
            return;
        const bits = new BitMap(NUM_LAYER_BITS);
        offs = bitMapDeserialize(view, offs, bits);
        const spr = this.spriteRenderer;
        if (spr !== null) {
            spr.setKindEnabled("npc", bits.getBit(LayerBit.NPCs));
            spr.setKindEnabled("mob", bits.getBit(LayerBit.Mobs));
            spr.setKindEnabled("effect", bits.getBit(LayerBit.Effects));
        }
        this.showProps = bits.getBit(LayerBit.Props);
        this.showWater = bits.getBit(LayerBit.Water);
        this.showGrannyModels = bits.getBit(LayerBit.Granny);
        this.showParticles = bits.getBit(LayerBit.Particles);
        this.showNameLabels = bits.getBit(LayerBit.NameLabels);
        this.weatherEnabled = bits.getBit(LayerBit.Weather);
        this.showWarpPortals = bits.getBit(LayerBit.WarpPortals);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        if (!this.cameraInitialized) {

            if (this.arrivalCellX !== null && this.arrivalCellY !== null) {
                const wp = gatCellToWorld(this.arrivalCellX, this.arrivalCellY, gatCellGroundHeight(this.gnd, this.arrivalCellX, this.arrivalCellY), this.gnd.width);
                this.frameArrivalAt(viewerInput, vec3.fromValues(wp[0], wp[1], wp[2]));
                this.arrivalCellX = this.arrivalCellY = null;
            }
            this.cameraInitialized = true;
        }

        this.prepareToRender(viewerInput);

        const sky = this.sky;
        const clearDescriptor = makeAttachmentClearDescriptor(
            colorNewFromRGBA(sky.color[0], sky.color[1], sky.color[2], 1.0));

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");

        builder.pushPass((pass) => {
            pass.setDebugName("Terrain");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        builder.execute();
        this.renderInstList.reset();
    }

    public destroy(device: GfxDevice): void {
        this.detachMouseListeners();
        this.bgm.destroy();
        this.renderHelper.destroy();
        device.destroyBuffer(this.vertexBufferDescriptors[0].buffer);
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        device.destroyTexture(this.lightmapTexture);
        if (this.waterVertexBufferDescriptors !== null)
            device.destroyBuffer(this.waterVertexBufferDescriptors[0].buffer);
        if (this.waterIndexBufferDescriptor !== null)
            device.destroyBuffer(this.waterIndexBufferDescriptor.buffer);
        if (this.spriteRenderer !== null)
            this.spriteRenderer.destroy(device);
        if (this.npcLabelRenderer !== null)
            this.npcLabelRenderer.destroy(device);
        if (this.mobLabelRenderer !== null)
            this.mobLabelRenderer.destroy(device);
        if (this.warpPortalRenderer !== null)
            this.warpPortalRenderer.destroy(device);
        for (const g of this.grannyModels)
            g.destroy(device);
        if (this.weatherRenderer !== null)
            this.weatherRenderer.destroy(device);
        if (this.particleRenderer !== null)
            this.particleRenderer.destroy(device);
        if (this.shadowRenderer !== null)
            this.shadowRenderer.destroy(device);
        if (this.dustRenderer !== null)
            this.dustRenderer.destroy(device);
    }
}
