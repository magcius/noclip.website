
// Renderer for Ragnarok Online terrain plus the map's props, water, sprites,
// particles and overlays. Terrain quads are grouped by base texture and
// modulated by a baked lightmap atlas.

import { mat4, vec3, vec4 } from "gl-matrix";
import { CameraController } from "../Camera.js";
import { Vec3UnitY } from "../MathHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from "../gfx/helpers/RenderGraphHelpers.js";
import { colorNewFromRGBA } from "../Color.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInstList, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import InputManager from "../InputManager.js";
import * as UI from "../ui.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { DecodedImage } from "./bmp.js";
import { GndMap, GndSurface } from "./gnd.js";
import { AnimatedDrawGroup, AnimatedModelMesh, AnimatedPose, ModelAnimator, ModelDrawGroup, ModelMesh, MODEL_VERTEX_STRIDE_BYTES } from "./model.js";
import { buildWaterMesh, WaterAnimator, WaterParams, WATER_VERTEX_STRIDE_BYTES } from "./water.js";
import { SpriteActor, SpriteRenderer } from "./sprite.js";
import { SprModel } from "./spr.js";
import { EntitySceneData, MobEntity } from "./entity.js";
import { NameLabelRenderer, NPC_LABEL_STYLE, MOB_LABEL_STYLE } from "./nametag.js";
import { ParticleRenderer, ParticleSceneData } from "./particles.js";
import { WarpPortalRenderer, WarpPortalSceneData } from "./warp-portal.js";
import { GrannyInstance, GrannyModelRenderer } from "./granny-render.js";
import { WeatherParams, WeatherRenderer } from "./weather.js";
import { GND_CELL_SIZE } from "./coord.js";
import { ShadowRenderer } from "./shadow.js";
import { SkyDomeRenderer, SkySceneData } from "./sky.js";
import { LensflareRenderer } from "./lensflare.js";
import { DustRenderer } from "./dust.js";
import { triggerTravel } from "./travel.js";
import * as BGM from "./bgm.js";
import { DataFetcher } from "../DataFetcher.js";
import { MAX_POINT_LIGHTS, pickActiveLights, PointLight, POINT_LIGHT_FALLOFF_EXPONENT, POINT_LIGHT_INTENSITY } from "./lights.js";

// CSS px of drift allowed between mousedown/up before a click counts as a drag.
const WARP_CLICK_MOVE_THRESHOLD_PX = 6;
const WARP_CLICK_PIXEL_SLOP = 24;

// Fallbacks used on the first tick after spawn, before the actor has a drawable
// frame to measure.
const MOB_HITBOX_BUFFER = 1.2;
const MOB_CLICK_PIXEL_SLOP = 10;
const MOB_FALLBACK_HALF_HEIGHT = 3.0;
const MOB_FALLBACK_RADIUS = 4.0;

const scratchClip = vec4.create();
const scratchOffset = vec3.create();
const scratchScreen: [number, number] = [0, 0];
const scratchScreen2: [number, number] = [0, 0];

class TerrainProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_LightCoord = 2;
    public static a_Color = 3;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_EnvDiff;    // rgb: day/night env-diffuse multiplier
    vec4 u_FogColor;   // rgb: fog/background color, a: 1 = fog on, 0 = off
    vec4 u_FogParams;  // x: even fog tint amount (0..1)
    vec4 u_EyePos;     // xyz: camera world position (render frame)
    vec4 u_PointLightParams;                          // x: count, y: gain, z: falloff, w: enable
    vec4 u_PointLightPosRange[${MAX_POINT_LIGHTS}];   // xyz: pos, w: range
    vec4 u_PointLightColor[${MAX_POINT_LIGHTS}];      // rgb: linear colour
};

uniform sampler2D u_BaseTexture;
uniform sampler2D u_Lightmap;

varying vec2 v_TexCoord;
varying vec2 v_LightCoord;
varying vec4 v_Color;
varying vec3 v_WorldPos;
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
    // Lightmap intensity rides in alpha; the rgb tint is additive.
    float t_Intensity = t_Light.a;
    vec3 t_Lit = t_Base.rgb * v_Color.rgb * t_Intensity + t_Light.rgb;

    t_Lit *= u_EnvDiff.rgb;

    if (u_FogColor.a > 0.5) {
        t_Lit = mix(t_Lit, u_FogColor.rgb, u_FogParams.x);
    }

    // Radial falloff added on top so dim baked areas glow under a torch.
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
    vec4 u_LightDir;       // xyz: world-space sun direction (render frame)
    vec4 u_DiffuseColor;   // rgb: directional diffuse (night-scaled)
    vec4 u_AmbientColor;   // rgb: ambient (night-scaled)
    vec4 u_FogColor;       // rgb: fog/background color, a: 1 = fog on, 0 = off
    vec4 u_FogParams;      // x: even fog tint amount (0..1)
    vec4 u_EyePos;         // xyz: camera world position (render frame)
    // Point lights — same layout as TerrainProgram's block.
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
    // Rotate the normal by the model->world linear part; renormalised per-pixel.
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

    // shadeType 0 (no normal) takes a full-bright fallback so it isn't darkened.
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

    if (u_FogColor.a > 0.5) {
        t_Color = mix(t_Color, u_FogColor.rgb, u_FogParams.x);
    }

    // Unshaded models take the radial term flat so they still glow under a torch.
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
    vec4 u_WaveParams; // x: waterLevel, y: waveOffsetDeg, z: wavePitch, w: waveHeight
    vec4 u_FogColor;   // rgb: fog/background color, a: 1 = fog on, 0 = off
    vec4 u_FogParams;  // x: even fog tint amount (0..1)
    vec4 u_EyePos;     // xyz: camera world position (render frame)
};

uniform sampler2D u_FrameTexture;

varying vec2 v_TexCoord;
varying vec3 v_WorldPos;
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

    // RO's wave phase is integer degrees (truncated sine table lookup).
    float t_PhaseDeg = trunc(t_WaveOffset + a_Grid * t_WavePitch);
    float t_Wave = sin(t_PhaseDeg * 0.01745329251994329577) * t_WaveHeight;
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
    vec3 t_Rgb = t_Color.rgb;

    if (u_FogColor.a > 0.5) {
        t_Rgb = mix(t_Rgb, u_FogColor.rgb, u_FogParams.x);
    }

    gl_FragColor = vec4(t_Rgb, 0.6);
}
`;
}

// pos (3 f32) + baseUV (2 f32) + lightmapUV (2 f32) + color (4 u8) = 32 bytes.
const VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 2 * 4 + 4;

interface TerrainDrawGroup {
    textureId: number;
    indexOffset: number;
    indexCount: number;
}

interface TerrainMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
    groups: TerrainDrawGroup[];
    lightmapAtlas: Uint8Array; // atlasW*atlasH*4 RGBA
    atlasW: number;
    atlasH: number;
    min: vec3;
    max: vec3;
}

// 8x8 lightmap tiles packed into a roughly-square atlas. Tint in RGB, intensity in A.
function buildLightmapAtlas(gnd: GndMap): { atlas: Uint8Array, atlasW: number, atlasH: number, tilesPerRow: number } {
    const n = gnd.lightmaps.length;
    const tilesPerRow = n > 0 ? Math.max(1, Math.ceil(Math.sqrt(n))) : 1;
    const tileRows = n > 0 ? Math.ceil(n / tilesPerRow) : 1;
    const atlasW = tilesPerRow * 8;
    const atlasH = tileRows * 8;
    const atlas = new Uint8Array(atlasW * atlasH * 4);

    for (let i = 0; i < n; i++) {
        const lm = gnd.lightmaps[i];
        const tx = (i % tilesPerRow) * 8;
        const ty = ((i / tilesPerRow) | 0) * 8;
        for (let y8 = 0; y8 < 8; y8++) {
            for (let x8 = 0; x8 < 8; x8++) {
                const texel = y8 * 8 + x8;
                const px = tx + x8;
                const py = ty + y8;
                const off = (py * atlasW + px) * 4;
                atlas[off + 0] = lm.color[texel * 3 + 0];
                atlas[off + 1] = lm.color[texel * 3 + 1];
                atlas[off + 2] = lm.color[texel * 3 + 2];
                atlas[off + 3] = lm.intensity[texel];
            }
        }
    }

    return { atlas, atlasW, atlasH, tilesPerRow };
}

function buildTerrainMesh(gnd: GndMap): TerrainMesh {
    const { atlas, atlasW, atlasH, tilesPerRow } = buildLightmapAtlas(gnd);
    const n = gnd.lightmaps.length;

    // GND lightmaps reserve a 1-texel border; cell corners sample at tile
    // texel boundaries 1 and 7. A half-texel inset would land on the border
    // and leave a dark blot in each cell corner (visible on prt_fild08).
    const insetU = atlasW > 0 ? 1 / atlasW : 0;
    const insetV = atlasH > 0 ? 1 / atlasH : 0;

    const lightmapUV = (lightmapId: number, k: number, out: [number, number]): void => {
        let idx = lightmapId;
        if (n === 0 || idx >= n)
            idx = 0;
        const tx = (idx % tilesPerRow) * 8;
        const ty = ((idx / tilesPerRow) | 0) * 8;
        const u0 = tx / atlasW + insetU;
        const u1 = (tx + 8) / atlasW - insetU;
        const v0 = ty / atlasH + insetV;
        const v1 = (ty + 8) / atlasH - insetV;
        out[0] = (k & 1) ? u1 : u0;
        out[1] = (k & 2) ? v1 : v0;
    };

    // X mirrored about the map centre (see coord.ts).
    const worldWidth = gnd.width * GND_CELL_SIZE;

    const cornerWorld = (x: number, y: number, k: number, h: ArrayLike<number>, out: vec3): void => {
        const cx = (k & 1) ? (x + 1) : x;
        const cz = (k & 2) ? (y + 1) : y;
        vec3.set(out, worldWidth - cx * GND_CELL_SIZE, -h[k], cz * GND_CELL_SIZE);
    };

    const vx: number[] = [], vy: number[] = [], vz: number[] = [];
    const vu: number[] = [], vv: number[] = [];
    const vlu: number[] = [], vlv: number[] = [];
    const vcol: number[] = []; // packed 0xAABBGGRR little-endian for the byte view

    const buckets = new Map<number, number[]>();

    const p0 = vec3.create(), p1 = vec3.create(), p2 = vec3.create(), p3 = vec3.create();
    const luv: [number, number] = [0, 0];

    const emitQuad = (s: GndSurface, p: vec3[]): void => {
        const argb = s.color >>> 0;
        const a = (argb >>> 24) & 0xff;
        const r = (argb >>> 16) & 0xff;
        const g = (argb >>> 8) & 0xff;
        const b = argb & 0xff;
        const packed = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;

        const base = vx.length;
        for (let k = 0; k < 4; k++) {
            vx.push(p[k][0]); vy.push(p[k][1]); vz.push(p[k][2]);
            vu.push(s.u[k]); vv.push(s.v[k]);
            lightmapUV(s.lightmapId, k, luv);
            vlu.push(luv[0]); vlv.push(luv[1]);
            vcol.push(packed);
        }
        let bucket = buckets.get(s.textureId);
        if (bucket === undefined) {
            bucket = [];
            buckets.set(s.textureId, bucket);
        }
        bucket.push(base + 0, base + 1, base + 2, base + 2, base + 1, base + 3);
    };

    const surfaceOk = (id: number): GndSurface | null => {
        if (id < 0 || id >= gnd.surfaces.length)
            return null;
        const s = gnd.surfaces[id];
        return s.textureId >= 0 ? s : null;
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
                emitQuad(top, [p0, p1, p2, p3]);
            }

            const front = surfaceOk(c.frontSurface);
            if (front !== null && y + 1 < gnd.height) {
                const nc = gnd.cells[(y + 1) * gnd.width + x];
                cornerWorld(x, y, 2, c.height, p0);
                cornerWorld(x, y, 3, c.height, p1);
                cornerWorld(x, y + 1, 0, nc.height, p2);
                cornerWorld(x, y + 1, 1, nc.height, p3);
                emitQuad(front, [p0, p1, p2, p3]);
            }

            const right = surfaceOk(c.rightSurface);
            if (right !== null && x + 1 < gnd.width) {
                const rc = gnd.cells[y * gnd.width + (x + 1)];
                cornerWorld(x, y, 1, c.height, p0);
                cornerWorld(x, y, 3, c.height, p1);
                cornerWorld(x + 1, y, 0, rc.height, p2);
                cornerWorld(x + 1, y, 2, rc.height, p3);
                emitQuad(right, [p0, p1, p2, p3]);
            }
        }
    }

    const vertexCount = vx.length;
    const vertexData = new ArrayBuffer(vertexCount * VERTEX_STRIDE_BYTES);
    const fview = new Float32Array(vertexData);
    const uview = new Uint32Array(vertexData);
    for (let i = 0; i < vertexCount; i++) {
        const fo = i * 8;
        fview[fo + 0] = vx[i];
        fview[fo + 1] = vy[i];
        fview[fo + 2] = vz[i];
        fview[fo + 3] = vu[i];
        fview[fo + 4] = vv[i];
        fview[fo + 5] = vlu[i];
        fview[fo + 6] = vlv[i];
        uview[fo + 7] = vcol[i];
    }

    const groups: TerrainDrawGroup[] = [];
    const indices: number[] = [];
    const sortedIds = Array.from(buckets.keys()).sort((a, b) => a - b);
    for (const textureId of sortedIds) {
        const bucket = buckets.get(textureId)!;
        groups.push({ textureId, indexOffset: indices.length, indexCount: bucket.length });
        for (const idx of bucket)
            indices.push(idx);
    }

    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < vertexCount; i++) {
        min[0] = Math.min(min[0], vx[i]); max[0] = Math.max(max[0], vx[i]);
        min[1] = Math.min(min[1], vy[i]); max[1] = Math.max(max[1], vy[i]);
        min[2] = Math.min(min[2], vz[i]); max[2] = Math.max(max[2], vz[i]);
    }
    if (vertexCount === 0) {
        vec3.set(min, 0, 0, 0);
        vec3.set(max, 1, 1, 1);
    }

    return {
        vertexData,
        indexData: new Uint32Array(indices),
        groups,
        lightmapAtlas: atlas,
        atlasW, atlasH,
        min, max,
    };
}

interface GpuModel {
    vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    groups: ModelDrawGroup[];
    textures: (GfxTexture | null)[];
}

export interface ModelInstance {
    modelKey: string;
    worldMatrix: mat4;
}

// placementMatrix is in the terrain render frame, sans the per-node transform.
export interface AnimatedModelInstance {
    modelKey: string;
    placementMatrix: mat4;
    animSpeed: number;
}

interface GpuAnimatedModel {
    vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    groups: AnimatedDrawGroup[];
    textures: (GfxTexture | null)[];
    pose: AnimatedPose;
    nodeCount: number;
}

export interface ModelSceneData {
    meshes: Map<string, { mesh: ModelMesh, textures: (DecodedImage | null)[] }>;
    instances: ModelInstance[];
    animatedMeshes: Map<string, { mesh: AnimatedModelMesh, textures: (DecodedImage | null)[] }>;
    animatedInstances: AnimatedModelInstance[];
}

// RSW directional sun, in the render frame.
export interface LightSceneData {
    lightDir: [number, number, number];
    diffuse: [number, number, number];
    ambient: [number, number, number];
}

export interface FogSceneData {
    enabled: boolean;
    color: [number, number, number];
    tint: number;   // even blend amount toward the fog color (0..1)
}

export interface WaterSceneData {
    gndWidth: number;
    gndHeight: number;
    zoom: number;
    params: WaterParams;
    frames: (DecodedImage | null)[];
}

// For intra-map warps (e.g. prt_in's room-to-room portals) arrivalWorldPos is
// pre-resolved so the click teleports the camera in place; absent for cross-map
// targets (we can't resolve a destination cell against another map's terrain).
export interface WarpTarget {
    worldPos: vec3;
    radius: number;
    dest: string;
    arrivalCellX?: number;
    arrivalCellY?: number;
    arrivalWorldPos?: vec3;
}

export interface WarpClickSceneData {
    targets: WarpTarget[];
    // Camera framing target when this map was reached by a warp; null when
    // opened directly (frame the whole map).
    arrivalCellX: number | null;
    arrivalCellY: number | null;
    arrivalWorldPos: vec3 | null;
}

function createRGBATexture(device: GfxDevice, width: number, height: number, rgba: Uint8Array): GfxTexture {
    const texture = device.createTexture({
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width, height,
        depthOrArrayLayers: 1,
        numLevels: 1,
        dimension: GfxTextureDimension.n2D,
        usage: GfxTextureUsage.Sampled,
    });
    device.uploadTextureData(texture, 0, [rgba]);
    return texture;
}

// Returns null when the mesh has no indices.
function uploadModelGeometry(
    device: GfxDevice,
    mesh: { vertexData: ArrayBuffer, indexData: Uint32Array },
    textures: (DecodedImage | null)[],
): { vertexBufferDescriptors: GfxVertexBufferDescriptor[], indexBufferDescriptor: GfxIndexBufferDescriptor, textures: (GfxTexture | null)[] } | null {
    if (mesh.indexData.length === 0)
        return null;
    const vbuf = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, mesh.vertexData);
    const ibuf = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexData.buffer);
    const gpuTextures = textures.map((img) => img !== null ? createRGBATexture(device, img.width, img.height, img.rgba) : null);
    return {
        vertexBufferDescriptors: [{ buffer: vbuf, byteOffset: 0 }],
        indexBufferDescriptor: { buffer: ibuf, byteOffset: 0 },
        textures: gpuTextures,
    };
}

export class RagnarokTerrainRenderer implements SceneGfx {
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

    // Neutral defaults so a map without these still renders.
    private light: LightSceneData = { lightDir: [0, 1, 0], diffuse: [1, 1, 1], ambient: [0.3, 0.3, 0.3] };
    private fog: FogSceneData = { enabled: false, color: [0, 0, 0], tint: 0 };

    private sky: SkySceneData = {
        color: [0.55, 0.75, 0.92],
        enableDome: false,
        horizonColor: [0.55, 0.75, 0.92],
        zenithColor: [0.30, 0.50, 0.78],
        groundColor: [0.30, 0.41, 0.51],
        sunDir: [0, 1, 0],
    };
    private skyDomeRenderer: SkyDomeRenderer | null = null;
    private lensflareRenderer: LensflareRenderer | null = null;

    // 0 = full day, 1 = full night.
    private nightDegree = 0;
    private fogEnabled = true;

    private scratchEye = vec3.create();
    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    private modelProgram: GfxProgram | null = null;
    private modelInputLayout: GfxInputLayout | null = null;
    private modelSamplerLinear: GfxSampler | null = null;
    private modelSamplerNearest: GfxSampler | null = null;
    private gpuModels = new Map<string, GpuModel>();
    private modelInstances: ModelInstance[] = [];

    // Each animated instance draws per-node with placement * M_node(t).
    private gpuAnimatedModels = new Map<string, GpuAnimatedModel>();
    private animatedInstances: { gpu: GpuAnimatedModel, placementMatrix: mat4, animator: ModelAnimator }[] = [];
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

    // Anchors are references into the live sprite/mob worldPos vec3s, so as a
    // mob walks each frame its shadow follows for free.
    private shadowRenderer: ShadowRenderer | null = null;
    private dustRenderer: DustRenderer | null = null;
    private shadowAnchors: vec3[] = [];
    private shadowsEnabled = true;

    private pointLights: PointLight[] = [];
    private pointLightsEnabled = true;
    // Only the first activeLightCount slots are valid.
    private activeLightBuffer: (PointLight | null)[] = new Array(MAX_POINT_LIGHTS).fill(null);
    private activeLightCount = 0;

    // Stashed so the BGM toggle can kick off the per-map track fetch on the
    // same user gesture (browsers block autoplay otherwise).
    private bgmFetcher: DataFetcher | null = null;
    private bgmEnabledUnsub: (() => void) | null = null;

    private warpTargets: WarpTarget[] = [];
    private arrivalWorldPos: vec3 | null = null;
    private warpTravelEnabled = true;
    private pendingClick: { x: number, y: number } | null = null;
    private pressX = 0;
    private pressY = 0;
    private pressMoved = 0;
    private pressActive = false;
    private mouseListenersAttached = false;
    private mouseListenerTarget: HTMLElement | null = null;
    private wantsMouseListeners = false;
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
        // movementX/Y keeps accumulating under pointer lock (where clientX/Y freeze).
        this.pressMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
    };
    private onMouseUp = (e: MouseEvent): void => {
        if (e.button !== 0 || !this.pressActive)
            return;
        this.pressActive = false;
        if (this.pressMoved <= WARP_CLICK_MOVE_THRESHOLD_PX)
            this.pendingClick = { x: this.pressX, y: this.pressY };
    };

    constructor(device: GfxDevice, gnd: GndMap, textureImages: (DecodedImage | null)[], modelData: ModelSceneData | null = null, waterData: WaterSceneData | null = null, lightData: LightSceneData | null = null, fogData: FogSceneData | null = null, entityData: EntitySceneData | null = null, warpPortalData: WarpPortalSceneData | null = null, grannyData: GrannyInstance[] | null = null, weatherParams: WeatherParams | null = null, warpClickData: WarpClickSceneData | null = null, pointLights: PointLight[] | null = null, skyData: SkySceneData | null = null, particleData: ParticleSceneData | null = null, bgmFetcher: DataFetcher | null = null) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;

        if (lightData !== null)
            this.light = lightData;
        if (fogData !== null)
            this.fog = fogData;
        if (skyData !== null)
            this.sky = skyData;
        if (bgmFetcher !== null)
            this.bgmFetcher = bgmFetcher;
        if (this.sky.enableDome) {
            this.skyDomeRenderer = new SkyDomeRenderer(cache);
            this.lensflareRenderer = new LensflareRenderer(device, cache);
        }

        this.program = cache.createProgram(new TerrainProgram());

        const mesh = buildTerrainMesh(gnd);
        this.groups = mesh.groups;

        vec3.lerp(this.center, mesh.min, mesh.max, 0.5);
        this.radius = Math.max(vec3.distance(mesh.min, mesh.max) * 0.5, 1.0);

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

        this.textures = textureImages.map((img) => img !== null ? createRGBATexture(device, img.width, img.height, img.rgba) : null);

        this.lightmapTexture = createRGBATexture(device, mesh.atlasW, mesh.atlasH, mesh.lightmapAtlas);

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

        if (modelData !== null)
            this.setupModels(device, cache, modelData);

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

        if (warpClickData !== null) {
            this.warpTargets = warpClickData.targets;
            this.arrivalWorldPos = warpClickData.arrivalWorldPos;
        }

        // Bound on the first render frame, off InputManager.toplevel (the canvas).
        this.wantsMouseListeners = this.warpTargets.length > 0 || this.mobs.length > 0;

        if (pointLights !== null)
            this.pointLights = pointLights;
    }

    private attachMouseListeners(target: HTMLElement): void {
        if (this.mouseListenersAttached)
            return;
        target.addEventListener("mousedown", this.onMouseDown);
        target.addEventListener("mousemove", this.onMouseMove);
        target.addEventListener("mouseup", this.onMouseUp);
        this.mouseListenerTarget = target;
        this.mouseListenersAttached = true;
    }

    private detachMouseListeners(): void {
        if (!this.mouseListenersAttached || this.mouseListenerTarget === null)
            return;
        const target = this.mouseListenerTarget;
        target.removeEventListener("mousedown", this.onMouseDown);
        target.removeEventListener("mousemove", this.onMouseMove);
        target.removeEventListener("mouseup", this.onMouseUp);
        this.mouseListenerTarget = null;
        this.mouseListenersAttached = false;
    }

    private setupEntities(device: GfxDevice, cache: GfxRenderHelper["renderCache"], entityData: EntitySceneData): void {
        if (entityData.sprites.length === 0 || (entityData.placements.length === 0 && entityData.mobs.length === 0))
            return;

        this.spriteRenderer = new SpriteRenderer(device, cache);
        this.shadowRenderer = new ShadowRenderer(device, cache);
        this.dustRenderer = new DustRenderer(device, cache);

        const sheetIndices = entityData.sprites.map((ls) => this.spriteRenderer!.addSheet(ls.spr));

        // Mobs hold an actor built on a SprModel, not a sheet index.
        const sheetForSpr = new Map<SprModel, number>();
        for (let i = 0; i < entityData.sprites.length; i++)
            sheetForSpr.set(entityData.sprites[i].spr, sheetIndices[i]);

        this.npcLabelRenderer = new NameLabelRenderer(device, cache, NPC_LABEL_STYLE);
        this.mobLabelRenderer = new NameLabelRenderer(device, cache, MOB_LABEL_STYLE);

        for (const p of entityData.placements) {
            if (p.spriteIndex < 0 || p.spriteIndex >= entityData.sprites.length)
                continue;
            const ls = entityData.sprites[p.spriteIndex];
            const actor = new SpriteActor(ls.spr, ls.act);
            actor.setState(p.state);
            actor.setWorldDirection(p.direction);
            const worldPos = vec3.fromValues(p.worldPos[0], p.worldPos[1], p.worldPos[2]);
            const anchor = p.anchor ?? "feet";
            this.spriteRenderer.addInstance({
                sheet: sheetIndices[p.spriteIndex],
                actor,
                worldPos,
                anchor,
            });
            // Effect sources (anchor === "center") get no shadow; RO doesn't shadow them.
            if (anchor === "feet")
                this.shadowAnchors.push(worldPos);
            if (p.name.length > 0) {
                // Lift the label to the topmost visible pixel of the idle frame.
                const headHeight = actor.currentFrameTopAboveAnchor(anchor);
                const heightAbove = headHeight !== null ? headHeight : 10;
                this.npcLabelRenderer.addLabel({ text: p.name, worldPos, heightAbove });
            }
        }
        if (!this.npcLabelRenderer.hasLabels)
            this.npcLabelRenderer = null;

        // The mob's worldPos vec3 is shared by reference, so per-frame wander
        // moves the sprite, shadow, and label together.
        for (const mob of entityData.mobs) {
            const sheet = sheetForSpr.get(mob.actor.sprModel);
            if (sheet === undefined)
                continue;
            this.spriteRenderer.addInstance({
                sheet,
                actor: mob.actor,
                worldPos: mob.worldPos,
            });
            this.shadowAnchors.push(mob.worldPos);
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

        this.waterFrameTextures = waterData.frames.map((img) => img !== null ? createRGBATexture(device, img.width, img.height, img.rgba) : null);

        this.waterParams = waterData.params;
        this.waterAnimator = new WaterAnimator(waterData.params.animSpeed, waterData.params.waveSpeed);
    }

    private setupModels(device: GfxDevice, cache: GfxRenderHelper["renderCache"], modelData: ModelSceneData): void {
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

        for (const [key, { mesh, textures }] of modelData.meshes) {
            const up = uploadModelGeometry(device, mesh, textures);
            if (up === null)
                continue;
            this.gpuModels.set(key, {
                vertexBufferDescriptors: up.vertexBufferDescriptors,
                indexBufferDescriptor: up.indexBufferDescriptor,
                groups: mesh.groups,
                textures: up.textures,
            });
        }

        this.modelInstances = modelData.instances;

        for (const [key, { mesh, textures }] of modelData.animatedMeshes) {
            const up = uploadModelGeometry(device, mesh, textures);
            if (up === null)
                continue;
            this.gpuAnimatedModels.set(key, {
                vertexBufferDescriptors: up.vertexBufferDescriptors,
                indexBufferDescriptor: up.indexBufferDescriptor,
                groups: mesh.groups,
                textures: up.textures,
                pose: new AnimatedPose(mesh),
                nodeCount: mesh.nodes.length,
            });
        }

        // Each placement has its own clock but shares the model's geometry + pose.
        for (const inst of modelData.animatedInstances) {
            const gpu = this.gpuAnimatedModels.get(inst.modelKey);
            if (gpu === undefined)
                continue;
            const mesh = modelData.animatedMeshes.get(inst.modelKey)!.mesh;
            this.animatedInstances.push({
                gpu,
                placementMatrix: inst.placementMatrix,
                animator: new ModelAnimator(mesh.animLength, inst.animSpeed),
            });
        }
    }

    public createPanels(): UI.Panel[] {
        const renderHacks = new UI.Panel();
        renderHacks.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacks.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");

        const nearest = new UI.Checkbox("Crisp (nearest) texture filtering", this.useNearestFiltering);
        nearest.onchanged = () => {
            this.useNearestFiltering = nearest.checked;
        };
        renderHacks.contents.appendChild(nearest.elem);

        const fog = new UI.Checkbox("Fog (faithful; hides distance)", this.fogEnabled);
        fog.onchanged = () => {
            this.fogEnabled = fog.checked;
        };
        renderHacks.contents.appendChild(fog.elem);

        const nameLabels = new UI.Checkbox("Name labels", this.showNameLabels);
        nameLabels.onchanged = () => {
            this.showNameLabels = nameLabels.checked;
        };
        renderHacks.contents.appendChild(nameLabels.elem);

        const shadows = new UI.Checkbox("Blob shadows", this.shadowsEnabled);
        shadows.onchanged = () => {
            this.shadowsEnabled = shadows.checked;
        };
        renderHacks.contents.appendChild(shadows.elem);

        if (this.warpTargets.length > 0) {
            const warpTravel = new UI.Checkbox("Click warps to travel", this.warpTravelEnabled);
            warpTravel.onchanged = () => {
                this.warpTravelEnabled = warpTravel.checked;
            };
            renderHacks.contents.appendChild(warpTravel.elem);
        }

        if (this.weatherRenderer !== null) {
            const weather = new UI.Checkbox("Weather (snow)", this.weatherEnabled);
            weather.onchanged = () => {
                this.weatherEnabled = weather.checked;
            };
            renderHacks.contents.appendChild(weather.elem);
        }

        if (this.pointLights.length > 0) {
            const lights = new UI.Checkbox("Point lights", this.pointLightsEnabled);
            lights.onchanged = () => {
                this.pointLightsEnabled = lights.checked;
            };
            renderHacks.contents.appendChild(lights.elem);
        }

        const bgm = new UI.Checkbox("BGM (per-map music)", BGM.isEnabled());
        bgm.onchanged = () => {
            // The toggle counts as the user gesture browsers require to start playback.
            void BGM.setEnabled(bgm.checked, this.bgmFetcher);
        };
        // Keep the checkbox in sync with the floating overlay button.
        if (this.bgmEnabledUnsub !== null)
            this.bgmEnabledUnsub();
        this.bgmEnabledUnsub = BGM.onEnabledChange((v) => { bgm.setChecked(v); });
        renderHacks.contents.appendChild(bgm.elem);
        const bgmVol = new UI.Slider();
        bgmVol.setLabel("BGM volume");
        bgmVol.setRange(0, 1, 0.01);
        bgmVol.setValue(BGM.getVolume());
        bgmVol.onvalue = (v: number) => { BGM.setVolume(v); };
        renderHacks.contents.appendChild(bgmVol.elem);

        const timeOfDay = new UI.Panel();
        timeOfDay.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        timeOfDay.setTitle(UI.TIME_OF_DAY_ICON, "Time of Day");
        const nightSlider = new UI.Slider("Night", this.nightDegree, 0, 1);
        nightSlider.setRange(0, 1, 0.01);
        nightSlider.setValue(this.nightDegree, false);
        nightSlider.onvalue = (v: number) => {
            this.nightDegree = v;
        };
        timeOfDay.contents.appendChild(nightSlider.elem);

        return [renderHacks, timeOfDay];
    }

    public adjustCameraController(c: CameraController): void {
        // keyMoveSpeed (max 200) * mult = top speed; pick mult so 200 ≈ 8.
        c.setSceneMoveSpeedMult(8 / 200);
        c.setKeyMoveSpeed(64);
    }

    // CWeather night transition: diffuse R&G pull toward a 0.5 floor (blue
    // untouched). env-diffuse is the standard 1 - (1-diffuse)*(1-ambient).
    private resolveLighting(): { diffuse: vec3, ambient: vec3, envDiff: vec3 } {
        const d = this.light.diffuse, a = this.light.ambient;
        const n = this.nightDegree;
        const dx = d[0] + (Math.min(d[0], 0.5) - d[0]) * n;
        const dy = d[1] + (Math.min(d[1], 0.5) - d[1]) * n;
        const dz = d[2];
        const diffuse = vec3.fromValues(dx, dy, dz);
        const ambient = vec3.fromValues(a[0], a[1], a[2]);
        const envDiff = vec3.fromValues(
            1.0 - (1.0 - dx) * (1.0 - a[0]),
            1.0 - (1.0 - dy) * (1.0 - a[1]),
            1.0 - (1.0 - dz) * (1.0 - a[2]),
        );
        return { diffuse, ambient, envDiff };
    }

    // .a is the on/off flag.
    private fogColorVec(): [number, number, number, number] {
        const on = this.fog.enabled && this.fogEnabled;
        return [this.fog.color[0], this.fog.color[1], this.fog.color[2], on ? 1.0 : 0.0];
    }

    private refreshActiveLights(): void {
        if (this.pointLights.length === 0 || !this.pointLightsEnabled) {
            this.activeLightCount = 0;
            return;
        }
        this.activeLightCount = pickActiveLights(
            this.pointLights,
            this.scratchEye[0], this.scratchEye[1], this.scratchEye[2],
            this.activeLightBuffer,
        );
    }

    private fillPointLightUniforms(d: Float32Array, offs: number): number {
        const start = offs;
        const enabled = this.pointLightsEnabled && this.pointLights.length > 0 ? 1 : 0;
        const count = enabled === 1 ? this.activeLightCount : 0;
        offs += fillVec4(d, offs, count, POINT_LIGHT_INTENSITY, POINT_LIGHT_FALLOFF_EXPONENT, enabled);
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const l = i < count ? this.activeLightBuffer[i] : null;
            if (l !== null)
                offs += fillVec4(d, offs, l.pos[0], l.pos[1], l.pos[2], l.range);
            else
                offs += fillVec4(d, offs, 0, 0, 0, 0);
        }
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const l = i < count ? this.activeLightBuffer[i] : null;
            if (l !== null)
                offs += fillVec4(d, offs, l.color[0], l.color[1], l.color[2], 0);
            else
                offs += fillVec4(d, offs, 0, 0, 0, 0);
        }
        return offs - start;
    }

    private prepareToRender(viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstList);

        const camWorld = viewerInput.camera.worldMatrix;
        vec3.set(this.scratchEye, camWorld[12], camWorld[13], camWorld[14]);

        this.skyDomeRenderer?.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix, this.scratchEye, this.sky);

        const lit = this.resolveLighting();
        const fogColor = this.fogColorVec();

        // Done once here so all later passes (terrain, models, granny) share the set.
        this.refreshActiveLights();

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 2 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        template.setMegaStateFlags({ cullMode: GfxCullMode.None });
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        const pointLightVec4Count = 1 + 2 * MAX_POINT_LIGHTS;
        let offs = template.allocateUniformBuffer(TerrainProgram.ub_SceneParams, 16 + 5 * 4 + pointLightVec4Count * 4);
        const mapped = template.mapUniformBufferF32(TerrainProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(mapped, offs, lit.envDiff[0], lit.envDiff[1], lit.envDiff[2], 1.0);
        offs += fillVec4(mapped, offs, fogColor[0], fogColor[1], fogColor[2], fogColor[3]);
        offs += fillVec4(mapped, offs, this.fog.tint, 0, 0, 0);
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

        this.prepareModels(viewerInput);

        // First activeLightCount slots are guaranteed non-null after refreshActiveLights.
        const activeLights = this.activeLightBuffer as PointLight[];
        const activeLightCount = this.pointLightsEnabled ? this.activeLightCount : 0;
        if (this.grannyModels.length > 0) {
            // Wrap so granny's inner pushTemplate inherits the OPAQUE sortKey
            // (it doesn't set one itself; default 0 = BACKGROUND).
            const opaque = this.renderHelper.pushTemplateRenderInst();
            opaque.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            for (const g of this.grannyModels)
                g.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix, this.light.lightDir as vec3, lit.diffuse, lit.ambient, viewerInput.deltaTime / 1000, activeLights, activeLightCount);
            renderInstManager.popTemplate();
        }

        this.prepareWater(viewerInput);

        // Mobs must advance before shadows + sprites read their positions.
        const mobDtSeconds = viewerInput.deltaTime / 1000;
        for (const mob of this.mobs)
            mob.update(mobDtSeconds);

        // Submitted before sprites so a sprite layers over its own shadow.
        this.prepareShadows(viewerInput);

        this.prepareSprites(viewerInput);

        // TRANSLUCENT so they sort after the depth-writing sprite pass (otherwise
        // a sprite's depth clobbers a particle drawn earlier — original sort bug).
        this.prepareParticles(viewerInput);

        this.prepareDust(viewerInput);

        this.prepareWarpPortals(viewerInput);

        this.prepareWeather(viewerInput);

        // Mob hits consume the click so a mob on a portal dies rather than travels.
        this.processMobClick(viewerInput);
        this.processWarpClick(viewerInput);

        this.lensflareRenderer?.prepare(this.renderHelper, viewerInput.camera, this.light.lightDir as vec3);

        this.renderHelper.prepareToRender();
    }

    private prepareWater(viewerInput: ViewerRenderInput): void {
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
        // OPAQUE layer; stable sort preserves submission order (water before sprites).
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
        const fogColor = this.fogColorVec();

        let offs = renderInst.allocateUniformBuffer(WaterProgram.ub_WaterParams, 16 + 4 + 3 * 4);
        const mapped = renderInst.mapUniformBufferF32(WaterProgram.ub_WaterParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(mapped, offs, this.waterParams.level, this.waterAnimator.waveOffsetDeg, this.waterParams.wavePitch, this.waterParams.waveHeight);
        offs += fillVec4(mapped, offs, fogColor[0], fogColor[1], fogColor[2], fogColor[3]);
        offs += fillVec4(mapped, offs, this.fog.tint, 0, 0, 0);
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
        // Wrap so sprite.ts's inner pushTemplate inherits the OPAQUE sortKey.
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
            if (this.npcLabelRenderer !== null)
                this.npcLabelRenderer.prepare(
                    this.renderHelper,
                    viewerInput.camera.clipFromWorldMatrix,
                    viewerInput.camera.worldMatrix,
                );
            if (this.mobLabelRenderer !== null)
                this.mobLabelRenderer.prepare(
                    this.renderHelper,
                    viewerInput.camera.clipFromWorldMatrix,
                    viewerInput.camera.worldMatrix,
                );
        }
    }

    // Mirrors processWarpClick; a hit consumes the click so it doesn't also
    // trigger warp travel.
    private processMobClick(viewerInput: ViewerRenderInput): void {
        const click = this.pendingClick;
        if (click === null || this.mobs.length === 0)
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
            // Sphere fit to the current motion frame, with a buffer so a click
            // just outside the silhouette still registers.
            const size = mob.actor.currentFrameWorldSize();
            const halfH = size !== null ? size.height * 0.5 : MOB_FALLBACK_HALF_HEIGHT;
            const radius = (size !== null ? Math.max(size.width, size.height) * 0.5 : MOB_FALLBACK_RADIUS) * MOB_HITBOX_BUFFER;
            const cx = mob.worldPos[0];
            const cy = mob.worldPos[1] + halfH;
            const cz = mob.worldPos[2];
            vec3.set(scratchOffset, cx, cy, cz);
            if (!projectToScreen(scratchOffset, scratchScreen))
                continue;
            // Project a second point offset along camera-right by `radius`,
            // so the pixel hit radius scales with camera distance.
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
        // Click is in CSS px; backbuffer is device px.
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
            // NDC (-1..1, Y up) -> device px (Y down).
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

            // Project a second point offset by `radius` along camera-right to
            // scale the hit radius with distance.
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
        // Intra-map warp (e.g. prt_in): teleport the camera in place.
        if (best.arrivalWorldPos !== undefined) {
            this.frameArrivalAt(viewerInput, best.arrivalWorldPos);
            return;
        }
        triggerTravel(best.dest, best.arrivalCellX, best.arrivalCellY);
    }

    // Fixed framing of the arrival cell — scaling with map radius produced a
    // whole-map overview on big indoor maps (e.g. prt_in).
    private frameArrivalAt(viewerInput: ViewerRenderInput, target: vec3): void {
        const back = 50;
        const eye = vec3.fromValues(target[0], target[1] + back, target[2] + back);
        mat4.targetTo(viewerInput.camera.worldMatrix, eye, target, Vec3UnitY);
        viewerInput.camera.worldMatrixUpdated();
    }

    private prepareWarpPortals(viewerInput: ViewerRenderInput): void {
        if (this.warpPortalRenderer === null)
            return;
        this.warpPortalRenderer.prepare(
            this.renderHelper,
            viewerInput.camera.clipFromWorldMatrix,
            viewerInput.camera.worldMatrix,
            viewerInput.deltaTime / 1000,
        );
    }

    private prepareShadows(viewerInput: ViewerRenderInput): void {
        if (this.shadowRenderer === null || !this.shadowsEnabled || this.shadowAnchors.length === 0)
            return;
        // The anchors are live mob/NPC worldPos vec3 refs.
        this.shadowRenderer.setAnchors(this.shadowAnchors, ShadowRenderer.defaultHalfSize());
        this.shadowRenderer.prepare(this.renderHelper, viewerInput.camera.clipFromWorldMatrix);
    }

    private prepareParticles(viewerInput: ViewerRenderInput): void {
        if (this.particleRenderer === null)
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
        const fogColor = this.fogColorVec();
        const L = this.light.lightDir;

        const pointLightVec4Count = 1 + 2 * MAX_POINT_LIGHTS;
        let sceneOffs = template.allocateUniformBuffer(ModelProgram.ub_SceneParams, 16 + 6 * 4 + pointLightVec4Count * 4);
        const sceneMapped = template.mapUniformBufferF32(ModelProgram.ub_SceneParams);
        sceneOffs += fillMatrix4x4(sceneMapped, sceneOffs, viewerInput.camera.clipFromWorldMatrix);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, L[0], L[1], L[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, lit.diffuse[0], lit.diffuse[1], lit.diffuse[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, lit.ambient[0], lit.ambient[1], lit.ambient[2], 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, fogColor[0], fogColor[1], fogColor[2], fogColor[3]);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, this.fog.tint, 0, 0, 0);
        sceneOffs += fillVec4(sceneMapped, sceneOffs, this.scratchEye[0], this.scratchEye[1], this.scratchEye[2], 0);
        sceneOffs += this.fillPointLightUniforms(sceneMapped, sceneOffs);

        for (const inst of this.modelInstances) {
            const gpu = this.gpuModels.get(inst.modelKey);
            if (gpu === undefined)
                continue;

            for (const group of gpu.groups) {
                if (group.indexCount === 0)
                    continue;
                const tex = (group.textureId >= 0 && group.textureId < gpu.textures.length) ? gpu.textures[group.textureId] : null;
                if (tex === null)
                    continue;

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.modelInputLayout, gpu.vertexBufferDescriptors, gpu.indexBufferDescriptor);

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

        const dtSeconds = viewerInput.deltaTime / 1000;
        for (const inst of this.animatedInstances) {
            const gpu = inst.gpu;

            inst.animator.update(dtSeconds);
            gpu.pose.evaluate(inst.animator.currentFrame, this.animNodeMatrices);

            for (const group of gpu.groups) {
                if (group.indexCount === 0)
                    continue;
                const tex = (group.textureId >= 0 && group.textureId < gpu.textures.length) ? gpu.textures[group.textureId] : null;
                if (tex === null)
                    continue;
                if (group.nodeIndex < 0 || group.nodeIndex >= gpu.nodeCount)
                    continue;

                // world = placement * M_node(t)
                mat4.mul(this.scratchWorld, inst.placementMatrix, this.animNodeMatrices[group.nodeIndex]);

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.modelInputLayout, gpu.vertexBufferDescriptors, gpu.indexBufferDescriptor);

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

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        // mouseLocation is typed as a {mouseX, mouseY} shim but is actually
        // the InputManager (which exposes `toplevel` = the rendering canvas).
        if (!this.mouseListenersAttached && this.wantsMouseListeners) {
            const im = viewerInput.mouseLocation as unknown as InputManager;
            if (im.toplevel !== undefined)
                this.attachMouseListeners(im.toplevel);
        }

        if (!this.cameraInitialized) {
            if (this.arrivalWorldPos !== null) {
                this.frameArrivalAt(viewerInput, this.arrivalWorldPos);
            } else {
                const eye = vec3.fromValues(this.center[0], this.center[1] + this.radius * 1.2, this.center[2] + this.radius * 1.2);
                mat4.targetTo(viewerInput.camera.worldMatrix, eye, this.center, Vec3UnitY);
                viewerInput.camera.worldMatrixUpdated();
            }
            this.cameraInitialized = true;
        }

        this.prepareToRender(viewerInput);

        // Per-map sky colour — see sky.ts for the policy.
        const clearDescriptor = makeAttachmentClearDescriptor(
            colorNewFromRGBA(this.sky.color[0], this.sky.color[1], this.sky.color[2], 1.0));

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
        if (this.bgmEnabledUnsub !== null) {
            this.bgmEnabledUnsub();
            this.bgmEnabledUnsub = null;
        }
        BGM.teardownScene();
        this.renderHelper.destroy();
        device.destroyBuffer(this.vertexBufferDescriptors[0].buffer);
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        device.destroyTexture(this.lightmapTexture);
        for (const t of this.textures)
            if (t !== null)
                device.destroyTexture(t);
        for (const gpu of this.gpuModels.values()) {
            device.destroyBuffer(gpu.vertexBufferDescriptors[0].buffer);
            device.destroyBuffer(gpu.indexBufferDescriptor.buffer);
            for (const t of gpu.textures)
                if (t !== null)
                    device.destroyTexture(t);
        }
        for (const gpu of this.gpuAnimatedModels.values()) {
            device.destroyBuffer(gpu.vertexBufferDescriptors[0].buffer);
            device.destroyBuffer(gpu.indexBufferDescriptor.buffer);
            for (const t of gpu.textures)
                if (t !== null)
                    device.destroyTexture(t);
        }
        if (this.waterVertexBufferDescriptors !== null)
            device.destroyBuffer(this.waterVertexBufferDescriptors[0].buffer);
        if (this.waterIndexBufferDescriptor !== null)
            device.destroyBuffer(this.waterIndexBufferDescriptor.buffer);
        for (const t of this.waterFrameTextures)
            if (t !== null)
                device.destroyTexture(t);
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
        if (this.lensflareRenderer !== null)
            this.lensflareRenderer.destroy(device);
    }
}
