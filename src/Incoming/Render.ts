
// GPU rendering for Incoming (1998, Rage Software) levels in noclip.

import { mat4, vec3 } from "gl-matrix";
import { DeviceProgram } from "../Program.js";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxFrontFaceMode, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxTexture, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { getMatrixAxisX, getMatrixAxisY, getMatrixTranslation } from "../MathHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentClearDescriptor } from "../gfx/render/GfxRenderGraph.js";
import { colorNewFromRGBA } from "../Color.js";
import { fillMatrix4x4, fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { ViewerRenderInput, SceneGfx } from "../viewer.js";

const SCENE_SCALE = 1.25;
const noclipSpaceFromIncomingSpace = mat4.fromValues(
    SCENE_SCALE, 0, 0, 0,
    0, -SCENE_SCALE, 0, 0,
    0, 0, -SCENE_SCALE, 0,
    0, 0, 0, 1,
);

const scratchClipFromWorld = mat4.create();
const scratchModelMatrix = mat4.create();
const scratchLocalMatrix = mat4.create();
const scratchMoverMatrix = mat4.create();
const scratchMoverPos = vec3.create();
const scratchMoverFwd = vec3.create();
const scratchMoverRight = vec3.create();
const scratchMoverUp = vec3.create();
const scratchSkyMatrix = mat4.create();
const scratchCameraPos = vec3.create();
const SKY_DOME_RADIUS = 1000;
const ANIMATION_SPEED = 0.25;
/**
 * Engine ticks per millisecond, scaled by {@link ANIMATION_SPEED}. `operate "spin"` rates are per
 * engine tick, which the original game advanced once per frame at roughly 30 fps.
 */
export const SPIN_TICKS_PER_MS = (30 / 1000) * ANIMATION_SPEED;
const ANIM_FRAME_MS = 80 / ANIMATION_SPEED;
const SHIELD_OPACITY = 0.4;
const FLAME_JITTER_STEP = 0.2;
const FLAME_JITTER_BASE = 2.0;
const MAX_POINT_LIGHTS = 32;
const MIN_LEG_LENGTH = 1e-6;
const MIN_DIRECTION_LENGTH = 1e-4;
const MIN_CROSS_LENGTH = 1e-3;
const FLAME_JITTER_FRAME_MASK = 3;

class IncomingProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_LightDir;      // xyz = world-space direction TO the light
    vec4 u_LightColor;    // rgb
    vec4 u_AmbientColor;  // rgb
    vec4 u_FogColor;      // rgb
    vec4 u_FogParams;     // x = start dist, y = end dist, z = enabled (0/1), w = numPointLights
    vec4 u_PointLightPosRadius[${MAX_POINT_LIGHTS}]; // xyz = world pos, w = radius
    vec4 u_PointLightColor[${MAX_POINT_LIGHTS}];     // rgb = color (HDR, pre-divided by 255)
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_WorldFromModel;
    vec4 u_MaterialParams; // x = selfIllum (0/1), y = colorKey alpha-test (0/1), z = opacity (0..1)
};

layout(location = 0) uniform sampler2D u_Texture;
`;

    public override vert = `
${IncomingProgram.Common}

layout(location = ${IncomingProgram.a_Position}) in vec3 a_Position;
layout(location = ${IncomingProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${IncomingProgram.a_TexCoord}) in vec2 a_TexCoord;

out vec2 v_TexCoord;
out vec3 v_Normal;
out vec3 v_PositionWorld;
out float v_FogAmount;

void main() {
    vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromModel) * vec4(a_Position, 1.0)).xyz;
    vec4 t_PositionClip = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0);
    gl_Position = t_PositionClip;

    v_Normal = mat3(UnpackMatrix(u_WorldFromModel)) * a_Normal;
    v_PositionWorld = t_PositionWorld; // Incoming space, pre-conversion, for the point lights.
    v_TexCoord = a_TexCoord;

    // Clip-space w is the perspective view depth.
    float t_Depth = t_PositionClip.w;
    v_FogAmount = u_FogParams.z * clamp((t_Depth - u_FogParams.x) / max(u_FogParams.y - u_FogParams.x, 1.0), 0.0, 1.0);
}
`;

    public override frag = `
${IncomingProgram.Common}

in vec2 v_TexCoord;
in vec3 v_Normal;
in vec3 v_PositionWorld;
in float v_FogAmount;

void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_Texture), v_TexCoord);

    // Color-key transparency keys on near-black texels.
    if (u_MaterialParams.y > 0.5 && (t_Tex.r + t_Tex.g + t_Tex.b) < 0.04)
        discard;

    vec3 t_Light;
    if (u_MaterialParams.x > 0.5) {
        t_Light = vec3(1.0);
    } else {
        // Match the engine: ambient + directColor * dot(N, L), with L deliberately left
        // un-normalized, then each point light's (rangeSq - distSq)/rangeSq * max(dot(N, toLight),
        // 0). Clamp before the texture modulate.
        vec3 t_Normal = normalize(v_Normal);
        float t_Diffuse = max(dot(t_Normal, u_LightDir.xyz), 0.0);
        t_Light = u_AmbientColor.rgb + u_LightColor.rgb * t_Diffuse;

        int t_NumLights = int(u_FogParams.w);
        for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
            if (i >= t_NumLights) break;
            vec3 t_ToLight = u_PointLightPosRadius[i].xyz - v_PositionWorld;
            float t_DistSq = dot(t_ToLight, t_ToLight);
            float t_RangeSq = u_PointLightPosRadius[i].w * u_PointLightPosRadius[i].w;
            if (t_DistSq < t_RangeSq) {
                float t_Atten = (t_RangeSq - t_DistSq) / t_RangeSq;
                float t_NL = max(dot(t_Normal, normalize(t_ToLight)), 0.0);
                t_Light += u_PointLightColor[i].rgb * (t_Atten * t_NL);
            }
        }
        t_Light = min(t_Light, vec3(1.0));
    }

    vec3 t_Color = t_Tex.rgb * t_Light;
    t_Color = mix(t_Color, u_FogColor.rgb, v_FogAmount);
    // Opacity is 1 for opaque instances and lower for alpha-blended ones like the energy shields.
    gl_FragColor = vec4(t_Color, t_Tex.a * u_MaterialParams.z);
}
`;
}
class IncomingSkyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static ub_SkyParams = 0;

    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SkyParams {
    Mat4x4 u_ClipFromModel;
    vec4 u_SkyParams; // x = hasCloud (0/1), y = cloud brightness
    vec4 u_SunColor;  // rgb = warm sky/sun tint
};

layout(location = 0) uniform sampler2D u_CloudTexture;
`;

    public override vert = `
${IncomingSkyProgram.Common}

layout(location = ${IncomingSkyProgram.a_Position}) in vec3 a_Position;
layout(location = ${IncomingSkyProgram.a_Color}) in vec3 a_Color;
layout(location = ${IncomingSkyProgram.a_TexCoord}) in vec2 a_TexCoord;

out vec3 v_Color;
out vec2 v_TexCoord;
out float v_Altitude;

void main() {
    // Peg depth to the far plane so the dome is never clipped. The sky pass disables depth
    // testing, so geometry always draws in front of it.
    gl_Position = (UnpackMatrix(u_ClipFromModel) * vec4(a_Position, 1.0)).xyww;
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_Altitude = a_Position.y; // +1 zenith, 0 horizon, -1 nadir, for the cloud fade.
}
`;

    public override frag = `
${IncomingSkyProgram.Common}

in vec3 v_Color;
in vec2 v_TexCoord;
in float v_Altitude;

void main() {
    vec3 t_Color = v_Color;
    if (u_SkyParams.x > 0.5) {
        float t_Cloud = texture(SAMPLER_2D(u_CloudTexture), v_TexCoord).r;
        // Clouds live overhead and fade out toward the horizon, where the planar projection would
        // otherwise streak. Dense texels mix toward a lighter tint of the sky's own hue, so they
        // read as translucent billows rather than a foreign colour.
        float t_Fade = clamp(v_Altitude * 1.8, 0.0, 1.0);
        vec3 t_CloudColor = min(v_Color * 1.4 + vec3(0.25, 0.18, 0.12), vec3(1.0));
        t_Color = mix(t_Color, t_CloudColor, t_Cloud * t_Fade * u_SkyParams.y);
    }
    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}
const SKY_PARAMS_SIZE = 16 + 4 + 4;
const SKY_DOME_LAT = 16;
const CLOUD_PROJECTION_MIN_Y = 0.18;
const CLOUD_PROJECTION_SCALE = 0.28;
const SKY_DOME_LON = 24;

function sampleSkyGradient(gradient: number[][], t: number, out: Float32Array): void {
    if (gradient.length === 0) {
        out[0] = 0.5; out[1] = 0.6; out[2] = 0.7;
        return;
    }
    if (gradient.length === 1) {
        out[0] = gradient[0][0] / 255; out[1] = gradient[0][1] / 255; out[2] = gradient[0][2] / 255;
        return;
    }
    const f = Math.min(Math.max(t, 0), 1) * (gradient.length - 1);
    const i0 = Math.floor(f), i1 = Math.min(i0 + 1, gradient.length - 1);
    const frac = f - i0;
    for (let c = 0; c < 3; c++) {
        out[c] = ((gradient[i0][c] * (1 - frac) + gradient[i1][c] * frac)) / 255;
    }
}

function buildSkyDomeMesh(gradient: number[][]): { vertices: Float32Array; indices: Uint32Array } {
    const vertices: number[] = [];
    const indices: number[] = [];
    const bandColor = new Float32Array(3);

    for (let la = 0; la <= SKY_DOME_LAT; la++) {
        const phi = Math.PI * (0.5 - la / SKY_DOME_LAT);
        const domeY = Math.sin(phi), ringRadius = Math.cos(phi);
        // The dome reads vertically flipped against the Y-negated scene. Mapping the visible upper
        // hemisphere onto warm bands 0..3 and the hidden lower one onto 3..7 keeps the gradient's
        // blue middle bands below the horizon instead of letting them dominate the sky.
        const visibleAltitude = -domeY;
        const gradientT = visibleAltitude >= 0
            ? (1 - visibleAltitude) * (3 / 7)
            : (3 / 7) + (-visibleAltitude) * (4 / 7);
        sampleSkyGradient(gradient, gradientT, bandColor);
        const cloudProjectionY = Math.max(domeY, CLOUD_PROJECTION_MIN_Y);
        for (let lo = 0; lo <= SKY_DOME_LON; lo++) {
            const theta = (lo / SKY_DOME_LON) * Math.PI * 2;
            const x = ringRadius * Math.cos(theta), z = ringRadius * Math.sin(theta);
            const u = (x / cloudProjectionY) * CLOUD_PROJECTION_SCALE + 0.5;
            const v = (z / cloudProjectionY) * CLOUD_PROJECTION_SCALE + 0.5;
            vertices.push(x, domeY, z, bandColor[0], bandColor[1], bandColor[2], u, v);
        }
    }

    const vertsPerRing = SKY_DOME_LON + 1;
    for (let la = 0; la < SKY_DOME_LAT; la++) {
        for (let lo = 0; lo < SKY_DOME_LON; lo++) {
            const thisRing = la * vertsPerRing + lo, nextRing = thisRing + vertsPerRing;
            indices.push(thisRing, nextRing, thisRing + 1, thisRing + 1, nextRing, nextRing + 1);
        }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

class IncomingSunProgram extends DeviceProgram {
    public static ub_SunParams = 0;
    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SunParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_Center; // xyz = world center, w = world size
    vec4 u_Right;  // xyz = camera right axis
    vec4 u_Up;     // xyz = camera up axis
    vec4 u_Color;  // rgb = tint
};

layout(location = 0) uniform sampler2D u_SunTexture;
`;
    public override vert = `
${IncomingSunProgram.Common}
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_TexCoord;
out vec2 v_TexCoord;
void main() {
    vec3 t_World = u_Center.xyz + (a_Position.x * u_Right.xyz + a_Position.y * u_Up.xyz) * u_Center.w;
    gl_Position = (UnpackMatrix(u_ClipFromWorld) * vec4(t_World, 1.0)).xyww;
    v_TexCoord = a_TexCoord;
}
`;
    public override frag = `
${IncomingSunProgram.Common}
in vec2 v_TexCoord;
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_SunTexture), v_TexCoord);
    gl_FragColor = vec4(t_Tex.rgb * u_Color.rgb, 1.0);
}
`;
}

const SUN_PARAMS_SIZE = 16 + 4 * 4;

class IncomingSpriteProgram extends DeviceProgram {
    public static ub_SpriteParams = 0;
    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SpriteParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_Center;  // xyz = noclip-space center, w = billboard size
    vec4 u_Right;   // xyz = camera right axis (noclip)
    vec4 u_Up;      // xyz = camera up axis (noclip)
    vec4 u_Color;   // rgb = tint (0..1)
    vec4 u_UVRect;  // xy = atlas uv min, zw = atlas uv size
};

layout(location = 0) uniform sampler2D u_SpriteTexture;
`;
    public override vert = `
${IncomingSpriteProgram.Common}
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_TexCoord;
out vec2 v_TexCoord;
void main() {
    mat4 t_ClipFromWorld = UnpackMatrix(u_ClipFromWorld);
    vec3 t_World = u_Center.xyz + (a_Position.x * u_Right.xyz + a_Position.y * u_Up.xyz) * u_Center.w;
    vec4 t_Corner = t_ClipFromWorld * vec4(t_World, 1.0);
    // Take depth from the centre, not the corner, so the sprite occludes all-or-nothing.
    vec4 t_Center = t_ClipFromWorld * vec4(u_Center.xyz, 1.0);
    gl_Position = vec4(t_Corner.xy, (t_Center.z / t_Center.w) * t_Corner.w, t_Corner.w);
    v_TexCoord = u_UVRect.xy + a_TexCoord * u_UVRect.zw;
}
`;
    public override frag = `
${IncomingSpriteProgram.Common}
in vec2 v_TexCoord;
void main() {
    vec4 t_Tex = texture(SAMPLER_2D(u_SpriteTexture), v_TexCoord);
    // Additive sprites such as nav lights pass a=1 and ignore alpha; smoke uses it for soft puffs.
    gl_FragColor = vec4(t_Tex.rgb * u_Color.rgb, t_Tex.r * u_Color.a);
}
`;
}

const SPRITE_PARAMS_SIZE = 16 + 4 * 5;


const SMOKE_RISE_PER_FRAME = 16;
const SMOKE_GROW_PER_FRAME = 5;
const SMOKE_DRIFT_PER_FRAME = 1;
const SMOKE_GAME_FPS = 30;
const SMOKE_MAX_PUFFS = 64;
const SMOKE_UV: [number, number, number, number] = [0 / 256, 192 / 256, 64 / 256, 64 / 256];

class IncomingShadowProgram extends DeviceProgram {
    public static ub_ShadowParams = 0;
    public static Common = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShadowParams {
    Mat4x4 u_ClipFromWorld;
    Mat4x4 u_Model;
    vec4 u_Params;  // x = opacity
};

layout(location = 0) uniform sampler2D u_ShadowTexture;
`;
    public override vert = `
${IncomingShadowProgram.Common}
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_TexCoord;
out vec2 v_TexCoord;
void main() {
    mat4 t_ClipFromWorld = UnpackMatrix(u_ClipFromWorld);
    mat4 t_Model = UnpackMatrix(u_Model);
    vec3 t_World = (t_Model * vec4(a_Position, 1.0)).xyz;
    vec4 t_Corner = t_ClipFromWorld * vec4(t_World, 1.0);
    // Take depth from the centre so the shadow occludes all-or-nothing.
    vec4 t_Center = t_ClipFromWorld * t_Model[3];
    gl_Position = vec4(t_Corner.xy, (t_Center.z / t_Center.w) * t_Corner.w, t_Corner.w);
    v_TexCoord = a_TexCoord;
}
`;
    public override frag = `
${IncomingShadowProgram.Common}
in vec2 v_TexCoord;
void main() {
    float t_Cover = texture(SAMPLER_2D(u_ShadowTexture), v_TexCoord).r;
    gl_FragColor = vec4(0.0, 0.0, 0.0, t_Cover * u_Params.x);
}
`;
}

const SHADOW_PARAMS_SIZE = 16 + 16 + 4;

const scratchBillboardCenter = vec3.create();
const scratchCameraRight = vec3.create();
const scratchCameraUp = vec3.create();

/** An uploaded mesh: vertex and index buffers plus the metadata needed to draw them. */
export class IncomingMeshData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    /** GPU vertex buffer bindings for this mesh. */
    public readonly vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    /** GPU index buffer binding for this mesh. */
    public readonly indexBufferDescriptor: GfxIndexBufferDescriptor;
    /** Number of triangle indices to draw. */
    public readonly indexCount: number;
    /**
     * Bounding radius in the XZ plane, in model units. Scaled by the part scale, this gives the
     * ground footprint that sizes the object's `shadow` sprite.
     */
    public readonly localRadiusXZ: number;

    /**
     * Uploads mesh geometry to the GPU.
     *
     * @param device The GPU device.
     * @param vertices Interleaved, 8 float32 per vertex: position3, normal3, uv2.
     * @param indices Triangle indices.
     */
    constructor(device: GfxDevice, vertices: Float32Array, indices: Uint16Array | Uint32Array) {
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.indexCount = indices.length;

        // X and Z are floats 0 and 2 of each 8-float vertex.
        let maxR2 = 0;
        for (let i = 0; i < vertices.length; i += 8) {
            const x = vertices[i], z = vertices[i + 2];
            const r2 = x * x + z * z;
            if (r2 > maxR2) {
                maxR2 = r2;
            }
        }
        this.localRadiusXZ = Math.sqrt(maxR2);
    }

    /**
     * Releases the GPU buffers this mesh owns.
     *
     * @param device The GPU device.
     */
    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

/**
 * Picks the index format. Terrain meshes can exceed 65535 vertices and need the wider one.
 *
 * @param indices The index data.
 * @returns The matching GPU format.
 */
export function indexFormatFor(indices: Uint16Array | Uint32Array): GfxFormat {
    return indices instanceof Uint32Array ? GfxFormat.U32_R : GfxFormat.U16_R;
}

/** A drawable object. Terrain tiles and placed models are both represented as instances. */
export interface IncomingInstance {
    /** The geometry to draw. */
    readonly mesh: IncomingMeshData;
    /** The texture to bind, or undefined to use the fallback white texture. */
    readonly texture?: GfxTexture;
    /** The object's world transform. */
    readonly modelMatrix: mat4;
    /** Draw the material full-bright, skipping lighting. */
    readonly selfIllum: boolean;
    /** Alpha-test out the texture's near-black texels. */
    readonly colorKey: boolean;
    /** `semi transparent`: alpha-blended at {@link SHIELD_OPACITY} and drawn after the opaques. */
    readonly transparent?: boolean;
    /** Disable backface culling. */
    readonly twoSided: boolean;
    /** GPU index format of {@link mesh}. */
    readonly indexFormat: GfxFormat;
    /** Winding that faces the camera. Defaults to the clockwise `.ian` convention. */
    readonly frontFace?: GfxFrontFaceMode;
    /**
     * Per-axis spin in radians per engine tick, about the part's local axes. When set and non-zero,
     * {@link modelMatrix} is rebuilt each frame from {@link baseFrame} and {@link meshScale};
     * otherwise it stays static.
     */
    readonly spin?: [number, number, number];
    /** Pulse the part's local-Z scale each frame, for `operate "spinengines"`. */
    readonly flameFlicker?: boolean;
    /** The placement and hierarchy transform without mesh scale, which spin animates from. */
    readonly baseFrame?: mat4;
    /** Target world frame for an `animate` keyframe part. */
    readonly animTargetFrame?: mat4;
    /** The part's mesh scale, applied after the animated rotation when spinning. */
    readonly meshScale?: number;
    /**
     * Mesh flipbook from the part's `animatemodel` directive, as tank treads use. When non-empty it
     * replaces {@link mesh} and {@link texture}, cycling one frame per {@link ANIM_FRAME_MS} in ODL
     * declaration order. {@link modelMatrix} still positions it.
     */
    readonly animFrames?: readonly IncomingAnimFrame[];
    /**
     * Waypoint-path mover, for aircraft and ships following an MDL route. When set,
     * {@link baseFrame} and {@link modelMatrix} are actor-local, and the renderer prepends the
     * mover's world root transform each frame so the whole actor travels.
     */
    readonly mover?: IncomingMover;
}

/**
 * A moving actor's traversal state: a closed world-space polyline walked at constant speed. Both
 * `patrol` circuits and one-shot `goto` transits loop forever.
 */
export interface IncomingMover {
    /** Waypoints in Incoming space, visited in order. The loop closes back to the first. */
    readonly points: ReadonlyArray<readonly [number, number, number]>;
    /** Arc length at the start of each leg, one per point. */
    readonly cumLengths: readonly number[];
    /** Loop perimeter, including the closing leg back to the first point. */
    readonly totalLength: number;
    /** Traversal speed in world units per millisecond. */
    readonly speed: number;
    /** Up vector for orientation, in Incoming space. */
    readonly up: readonly [number, number, number];
    /**
     * Forward vector from the actor's placement. Falls back to this heading when the path direction
     * runs parallel to {@link up}.
     */
    readonly forward: readonly [number, number, number];
    /** Offset along the loop, 0..1, so actors spawned together do not move in lockstep. */
    readonly phase: number;
}

function computeMoverMatrix(mover: IncomingMover, time: number): mat4 {
    const { points, cumLengths, totalLength } = mover;
    let distanceAlongLoop = (time * mover.speed + mover.phase * totalLength) % totalLength;
    if (distanceAlongLoop < 0) {
        distanceAlongLoop += totalLength;
    }
    let legIndex = points.length - 1;
    for (let i = 0; i < points.length; i++) {
        const nextLegStart = i + 1 < cumLengths.length ? cumLengths[i + 1] : totalLength;
        if (distanceAlongLoop < nextLegStart) {
            legIndex = i;
            break;
        }
    }
    const legStart = points[legIndex];
    const legEnd = points[(legIndex + 1) % points.length];
    const legStartDistance = cumLengths[legIndex];
    const legEndDistance = legIndex + 1 < cumLengths.length ? cumLengths[legIndex + 1] : totalLength;
    const legLength = legEndDistance - legStartDistance;
    const legT = legLength > MIN_LEG_LENGTH ? (distanceAlongLoop - legStartDistance) / legLength : 0;

    scratchMoverPos[0] = legStart[0] + (legEnd[0] - legStart[0]) * legT;
    scratchMoverPos[1] = legStart[1] + (legEnd[1] - legStart[1]) * legT;
    scratchMoverPos[2] = legStart[2] + (legEnd[2] - legStart[2]) * legT;
    vec3.set(scratchMoverFwd, legEnd[0] - legStart[0], legEnd[1] - legStart[1], legEnd[2] - legStart[2]);
    if (vec3.len(scratchMoverFwd) < MIN_DIRECTION_LENGTH) {
        vec3.set(scratchMoverFwd, 0, 0, 1);
    }
    vec3.normalize(scratchMoverFwd, scratchMoverFwd);
    vec3.set(scratchMoverUp, mover.up[0], mover.up[1], mover.up[2]);
    vec3.normalize(scratchMoverUp, scratchMoverUp);
    // When the path runs parallel to up, as in a rocket launch, the cross product collapses and
    // leaves no valid heading, so keep the authored forward instead of tipping the actor onto
    // an arbitrary axis.
    vec3.cross(scratchMoverRight, scratchMoverUp, scratchMoverFwd);
    if (vec3.len(scratchMoverRight) < MIN_CROSS_LENGTH) {
        vec3.set(scratchMoverFwd, mover.forward[0], mover.forward[1], mover.forward[2]);
        vec3.normalize(scratchMoverFwd, scratchMoverFwd);
        vec3.cross(scratchMoverRight, scratchMoverUp, scratchMoverFwd);
        if (vec3.len(scratchMoverRight) < MIN_CROSS_LENGTH) {
            vec3.set(scratchMoverRight, 1, 0, 0);
        }
    }
    vec3.normalize(scratchMoverRight, scratchMoverRight);
    vec3.cross(scratchMoverUp, scratchMoverFwd, scratchMoverRight);

    const worldRoot = scratchMoverMatrix;
    worldRoot[0] = scratchMoverRight[0]; worldRoot[1] = scratchMoverRight[1]; worldRoot[2] = scratchMoverRight[2]; worldRoot[3] = 0;
    worldRoot[4] = scratchMoverUp[0]; worldRoot[5] = scratchMoverUp[1]; worldRoot[6] = scratchMoverUp[2]; worldRoot[7] = 0;
    worldRoot[8] = scratchMoverFwd[0]; worldRoot[9] = scratchMoverFwd[1]; worldRoot[10] = scratchMoverFwd[2]; worldRoot[11] = 0;
    worldRoot[12] = scratchMoverPos[0]; worldRoot[13] = scratchMoverPos[1]; worldRoot[14] = scratchMoverPos[2]; worldRoot[15] = 1;
    return worldRoot;
}

/** One frame of an {@link IncomingInstance.animFrames} mesh flipbook. */
export interface IncomingAnimFrame {
    /** The frame's geometry. */
    readonly mesh: IncomingMeshData;
    /** The frame's texture, or undefined for the fallback white texture. */
    readonly texture?: GfxTexture;
}

/**
 * A billboard from a placed part's `sprite`: a nav light, engine glow or smoke emitter. Drawn
 * additively at real scene depth.
 */
export interface IncomingSpriteInstance {
    /** Billboard center in Incoming world space. */
    readonly position: [number, number, number];
    /** Billboard size in Incoming world units. */
    readonly size: number;
    /** Atlas sub-rect normalized to 0..1, as `[uMin, vMin, uSize, vSize]`. */
    readonly uvRect: [number, number, number, number];
    /** The sprite atlas texture, or undefined for the fallback white texture. */
    readonly texture?: GfxTexture;
    /** Base RGB 0..255, used for a static sprite. */
    readonly color: [number, number, number];
    /** Cycle keyframes, RGB 0..255. Empty for a static sprite. */
    readonly cycleColors: readonly (readonly [number, number, number])[];
    /** Engine frames each cycle key is held, from `colourfade speed`. Zero means static. */
    readonly cycleSpeed: number;
}

/**
 * A smoke-plume emitter from a placed object's `smoke` directive, used for cooling towers, chimneys
 * and exhaust. The renderer reproduces the engine's steady-state column: a puff spawns every
 * {@link rate} frames at {@link position}, then rises and expands over its {@link lifetime}.
 */
export interface IncomingSmokeInstance {
    /** Emitter position in Incoming space: the part origin plus its rotated local offset. */
    readonly position: [number, number, number];
    /** Starting puff size in world units. Each puff grows 5 units per frame from here. */
    readonly size: number;
    /** RGB 0..255. */
    readonly color: [number, number, number];
    /** Peak puff opacity 0..255, used on the alpha-blended path. */
    readonly alpha: number;
    /** Frames between puff spawns. With {@link lifetime} this sets how many are alive at once. */
    readonly rate: number;
    /** Puff lifetime in game frames, making the column `lifetime * 16` units tall. */
    readonly lifetime: number;
    /** Blend the puffs additively, as chimney and exhaust trails do. */
    readonly additive: boolean;
    /** The `smoke.ppm` atlas, or undefined for the fallback texture. */
    readonly texture?: GfxTexture;
}

/** A flat quad on the terrain beneath an object, alpha-blended dark. Drawn after the geometry. */
export interface IncomingShadowInstance {
    /** World transform: ground-aligned, yaw-oriented, sized to the object footprint. */
    readonly modelMatrix: mat4;
    /** The grayscale silhouette texture. */
    readonly texture?: GfxTexture;
    /** Overall opacity, 0..1. */
    readonly opacity: number;
}

/** A world-space point or lamp light, accumulated per pixel by the main shader. */
export interface IncomingPointLight {
    /** Position in Incoming space, pre-conversion. */
    readonly position: [number, number, number];
    /** RGB, already divided by 255. May exceed 1.0, since lights are summed and then clamped. */
    readonly color: [number, number, number];
    /** Radius in world units. */
    readonly radius: number;
}

/** Lighting and fog for the scene, from the `.odl` `sky` block. Colors are normalized to 0..1. */
export interface IncomingSceneParams {
    /** World-space direction pointing toward the light. */
    readonly lightDir: [number, number, number];
    /** Sun color. */
    readonly lightColor: [number, number, number];
    /** Ambient light color. */
    readonly ambientColor: [number, number, number];
    /** Fog color. */
    readonly fogColor: [number, number, number];
    /** Clear color for the framebuffer, chosen so the horizon matches the dome. */
    readonly skyColor: [number, number, number];
    /** Dome gradient bands, RGB 0..255, top band first. */
    readonly skyGradient: number[][];
    /** Warm tint that colors the grayscale cloud texture. */
    readonly sunColor: [number, number, number];
    /** Normalized direction to the sun in noclip space, for placing the sprite. */
    readonly sunDir: [number, number, number];
    /** View-space fog start, in world units. */
    readonly fogStart: number;
    /** View-space fog end, in world units. */
    readonly fogEnd: number;
}

const SCENE_PARAMS_SIZE = 16 + 4 * 5 + MAX_POINT_LIGHTS * 4 * 2;
const MODEL_PARAMS_SIZE = 12 + 4;

/** Incoming level renderer. */
export class IncomingRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private renderInstListMain = new GfxRenderInstList();
    private skyClearDescriptor: GfxrAttachmentClearDescriptor;
    private skyProgram: GfxProgram;
    private skyMesh: IncomingMeshData;
    private sunProgram: GfxProgram;
    private sunMesh: IncomingMeshData;
    private spriteProgram: GfxProgram;
    private shadowProgram: GfxProgram;
    private shadowMesh: IncomingMeshData;
    /** Cloud texture for the dome, set by the scene loader after construction. */
    public skyCloudTexture?: GfxTexture;
    /** Sun sprite texture, set by the scene loader after construction. */
    public sunTexture?: GfxTexture;
    /** Terrain and model meshes owned by this scene, destroyed on teardown. */
    public meshes: IncomingMeshData[] = [];
    /** Textures owned by this scene, destroyed on teardown. */
    public textures: GfxTexture[] = [];
    /** Every drawable instance. */
    public instances: IncomingInstance[] = [];
    /** Billboards, drawn additively after the geometry. */
    public sprites: IncomingSpriteInstance[] = [];
    /** Smoke emitters, drawn as rising puff columns. */
    public smoke: IncomingSmokeInstance[] = [];
    /** Ground shadows, drawn after the geometry. */
    public shadows: IncomingShadowInstance[] = [];
    /** Lights in the level. Each frame the nearest {@link MAX_POINT_LIGHTS} are uploaded. */
    public pointLights: IncomingPointLight[] = [];
    /** Lighting and fog. */
    public sceneParams: IncomingSceneParams;

    /**
     * Creates the renderer and its shared GPU state.
     *
     * @param device The GPU device.
     * @param sceneParams The level's lighting and fog.
     */
    constructor(device: GfxDevice, sceneParams: IncomingSceneParams) {
        this.renderHelper = new GfxRenderHelper(device);
        this.sceneParams = sceneParams;
        const [r, g, b] = sceneParams.skyColor;
        this.skyClearDescriptor = makeAttachmentClearDescriptor(colorNewFromRGBA(r, g, b, 1.0));
        const cache = this.renderHelper.renderCache;

        this.program = cache.createProgram(new IncomingProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: IncomingProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: IncomingProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 12, bufferIndex: 0 },
                { location: IncomingProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 24, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: 32, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.sampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        // A camera-centered gradient sphere, reusing the shared input layout.
        this.skyProgram = cache.createProgram(new IncomingSkyProgram());
        const dome = buildSkyDomeMesh(sceneParams.skyGradient);
        this.skyMesh = new IncomingMeshData(device, dome.vertices, dome.indices);
        // A unit quad whose corner offsets live in a_Position.xy, billboarded in the shader.
        this.sunProgram = cache.createProgram(new IncomingSunProgram());
        this.spriteProgram = cache.createProgram(new IncomingSpriteProgram());
        // A unit quad in the local XZ plane, scaled and oriented per object.
        this.shadowProgram = cache.createProgram(new IncomingShadowProgram());
        const shadowQuadVertices = new Float32Array([
            -1, 0, -1, 0, 1, 0, 0, 1,
             1, 0, -1, 0, 1, 0, 1, 1,
             1, 0,  1, 0, 1, 0, 1, 0,
            -1, 0,  1, 0, 1, 0, 0, 0,
        ]);
        this.shadowMesh = new IncomingMeshData(device, shadowQuadVertices, new Uint32Array([0, 1, 2, 0, 2, 3]));
        const billboardQuadVertices = new Float32Array([
            -1, -1, 0, 0, 0, 0, 0, 1,
             1, -1, 0, 0, 0, 0, 1, 1,
             1,  1, 0, 0, 0, 0, 1, 0,
            -1,  1, 0, 0, 0, 0, 0, 0,
        ]);
        this.sunMesh = new IncomingMeshData(device, billboardQuadVertices, new Uint32Array([0, 1, 2, 0, 2, 3]));
    }

    private fillSceneParams(d: Float32Array, offs: number, viewerInput: ViewerRenderInput): void {
        const p = this.sceneParams;
        const clipFromWorld = mat4.mul(scratchClipFromWorld, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromIncomingSpace);
        offs += fillMatrix4x4(d, offs, clipFromWorld);
        offs += fillVec4(d, offs, p.lightDir[0], p.lightDir[1], p.lightDir[2], 0);
        offs += fillVec4(d, offs, p.lightColor[0], p.lightColor[1], p.lightColor[2], 1);
        offs += fillVec4(d, offs, p.ambientColor[0], p.ambientColor[1], p.ambientColor[2], 1);
        offs += fillVec4(d, offs, p.fogColor[0], p.fogColor[1], p.fogColor[2], 1);

        const lights = this.pointLights;
        const activeLightCount = Math.min(lights.length, MAX_POINT_LIGHTS);
        offs += fillVec4(d, offs, p.fogStart, p.fogEnd, 1, activeLightCount);
        // Two parallel std140 arrays: positions with radius, then colors.
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const light = i < activeLightCount ? lights[i] : undefined;
            offs += light !== undefined ? fillVec4(d, offs, light.position[0], light.position[1], light.position[2], light.radius) : fillVec4(d, offs, 0, 0, 0, 0);
        }
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const light = i < activeLightCount ? lights[i] : undefined;
            offs += light !== undefined ? fillVec4(d, offs, light.color[0], light.color[1], light.color[2], 0) : fillVec4(d, offs, 0, 0, 0, 0);
        }
    }

    private computeModelMatrix(inst: IncomingInstance, viewerInput: ViewerRenderInput): mat4 {
        const local = this.computeLocalMatrix(inst, viewerInput);
        if (inst.mover === undefined) {
            return local;
        }
        // `local` is actor-local here, so prepend the mover's world root to carry the whole craft.
        const root = computeMoverMatrix(inst.mover, viewerInput.time);
        return mat4.multiply(scratchModelMatrix, root, local);
    }

    private computeLocalMatrix(inst: IncomingInstance, viewerInput: ViewerRenderInput): mat4 {
        if (inst.baseFrame === undefined || inst.meshScale === undefined) {
            return inst.modelMatrix;
        }
        // Hold the part at its target pose rather than oscillating: the placed aircraft are
        // airborne, so landing gear stays retracted. Base and target differ only in translation in
        // this data, so the target translation rides on the base orientation.
        if (inst.animTargetFrame !== undefined) {
            mat4.copy(scratchLocalMatrix, inst.baseFrame);
            scratchLocalMatrix[12] = inst.animTargetFrame[12];
            scratchLocalMatrix[13] = inst.animTargetFrame[13];
            scratchLocalMatrix[14] = inst.animTargetFrame[14];
            const sa = inst.meshScale;
            mat4.scale(scratchLocalMatrix, scratchLocalMatrix, [sa, sa, sa]);
            return scratchLocalMatrix;
        }

        const spin = inst.spin;
        const hasSpin = spin !== undefined && (spin[0] !== 0 || spin[1] !== 0 || spin[2] !== 0);
        const flicker = inst.flameFlicker === true;
        if (!hasSpin && !flicker) {
            return inst.modelMatrix;
        }

        mat4.copy(scratchLocalMatrix, inst.baseFrame);
        // The frame already places and orients the part, so rotate about its own local axes.
        if (spin !== undefined && hasSpin) {
            const ticks = viewerInput.time * SPIN_TICKS_PER_MS;
            if (spin[0] !== 0) {
                mat4.rotateX(scratchLocalMatrix, scratchLocalMatrix, spin[0] * ticks);
            }
            if (spin[1] !== 0) {
                mat4.rotateY(scratchLocalMatrix, scratchLocalMatrix, spin[1] * ticks);
            }
            if (spin[2] !== 0) {
                mat4.rotateZ(scratchLocalMatrix, scratchLocalMatrix, spin[2] * ticks);
            }
        }
        const scale = inst.meshScale;
        const staircaseFrame = Math.floor(viewerInput.time * SPIN_TICKS_PER_MS) & FLAME_JITTER_FRAME_MASK;
        // The part's local Z is the exhaust direction.
        const exhaustScaleZ = flicker
            ? scale * (staircaseFrame * FLAME_JITTER_STEP + FLAME_JITTER_BASE)
            : scale;
        mat4.scale(scratchLocalMatrix, scratchLocalMatrix, [scale, scale, exhaustScaleZ]);
        return scratchLocalMatrix;
    }

    private drawSky(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const skyTemplate = this.renderHelper.pushTemplateRenderInst();
        skyTemplate.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        skyTemplate.setGfxProgram(this.skyProgram);

        getMatrixTranslation(scratchCameraPos, viewerInput.camera.worldMatrix);
        mat4.fromRotationTranslationScale(scratchSkyMatrix, [0, 0, 0, 1], scratchCameraPos,
            [SKY_DOME_RADIUS, SKY_DOME_RADIUS, SKY_DOME_RADIUS]);
        mat4.mul(scratchSkyMatrix, viewerInput.camera.clipFromWorldMatrix, scratchSkyMatrix);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.skyMesh.vertexBufferDescriptors, this.skyMesh.indexBufferDescriptor);
        renderInst.setDrawCount(this.skyMesh.indexCount);
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None, depthWrite: false, depthCompare: GfxCompareMode.Always });
        renderInst.setSamplerBindings(0, [{ gfxTexture: this.skyCloudTexture ?? null, gfxSampler: this.sampler }]);

        const sun = this.sceneParams.sunColor;
        let offs = renderInst.allocateUniformBuffer(IncomingSkyProgram.ub_SkyParams, SKY_PARAMS_SIZE);
        const d = renderInst.mapUniformBufferF32(IncomingSkyProgram.ub_SkyParams);
        offs += fillMatrix4x4(d, offs, scratchSkyMatrix);
        offs += fillVec4(d, offs, this.skyCloudTexture !== undefined ? 1 : 0, 0.9, 0, 0);
        offs += fillVec4(d, offs, sun[0], sun[1], sun[2], 1);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    private drawSun(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.sunTexture === undefined) {
            return;
        }
        const sunTemplate = this.renderHelper.pushTemplateRenderInst();
        sunTemplate.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        sunTemplate.setGfxProgram(this.sunProgram);

        getMatrixTranslation(scratchCameraPos, viewerInput.camera.worldMatrix);
        getMatrixAxisX(scratchCameraRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchCameraUp, viewerInput.camera.worldMatrix);
        const dir = this.sceneParams.sunDir, dist = SKY_DOME_RADIUS * 0.9, size = SKY_DOME_RADIUS * 0.05;
        vec3.set(scratchBillboardCenter, scratchCameraPos[0] + dir[0] * dist, scratchCameraPos[1] + dir[1] * dist, scratchCameraPos[2] + dir[2] * dist);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.inputLayout, this.sunMesh.vertexBufferDescriptors, this.sunMesh.indexBufferDescriptor);
        renderInst.setDrawCount(this.sunMesh.indexCount);
        const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: GfxCompareMode.Always };
        setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.One });
        renderInst.setMegaStateFlags(mega);
        renderInst.setSamplerBindings(0, [{ gfxTexture: this.sunTexture, gfxSampler: this.sampler }]);

        const sun = this.sceneParams.sunColor;
        let offs = renderInst.allocateUniformBuffer(IncomingSunProgram.ub_SunParams, SUN_PARAMS_SIZE);
        const d = renderInst.mapUniformBufferF32(IncomingSunProgram.ub_SunParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
        offs += fillVec4(d, offs, scratchBillboardCenter[0], scratchBillboardCenter[1], scratchBillboardCenter[2], size);
        offs += fillVec4(d, offs, scratchCameraRight[0], scratchCameraRight[1], scratchCameraRight[2], 0);
        offs += fillVec4(d, offs, scratchCameraUp[0], scratchCameraUp[1], scratchCameraUp[2], 0);
        offs += fillVec4(d, offs, sun[0], sun[1], sun[2], 1);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }

    private drawSprites(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.sprites.length === 0) {
            return;
        }
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        template.setGfxProgram(this.spriteProgram);

        getMatrixAxisX(scratchCameraRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchCameraUp, viewerInput.camera.worldMatrix);
        const engineFrames = viewerInput.time * SPIN_TICKS_PER_MS;

        for (const sprite of this.sprites) {
            // Convert to noclip space so the billboard can use the noclip camera axes.
            scratchBillboardCenter[0] = SCENE_SCALE * sprite.position[0];
            scratchBillboardCenter[1] = -SCENE_SCALE * sprite.position[1];
            scratchBillboardCenter[2] = -SCENE_SCALE * sprite.position[2];
            let r = sprite.color[0], g = sprite.color[1], b = sprite.color[2];
            const keyCount = sprite.cycleColors.length;
            if (keyCount >= 2 && sprite.cycleSpeed > 0) {
                const cyclePosition = engineFrames / sprite.cycleSpeed;
                const keyIndex = Math.floor(cyclePosition) % keyCount;
                const fromKey = sprite.cycleColors[keyIndex];
                const toKey = sprite.cycleColors[(keyIndex + 1) % keyCount];
                const keyT = cyclePosition - Math.floor(cyclePosition);
                r = fromKey[0] + (toKey[0] - fromKey[0]) * keyT;
                g = fromKey[1] + (toKey[1] - fromKey[1]) * keyT;
                b = fromKey[2] + (toKey[2] - fromKey[2]) * keyT;
            }

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.inputLayout, this.sunMesh.vertexBufferDescriptors, this.sunMesh.indexBufferDescriptor);
            renderInst.setDrawCount(this.sunMesh.indexCount);
            // Depth-tested so closer geometry occludes it, but never depth-writing.
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.One });
            renderInst.setMegaStateFlags(mega);
            renderInst.setSamplerBindings(0, [{ gfxTexture: sprite.texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingSpriteProgram.ub_SpriteParams, SPRITE_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingSpriteProgram.ub_SpriteParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
            offs += fillVec4(d, offs, scratchBillboardCenter[0], scratchBillboardCenter[1], scratchBillboardCenter[2], sprite.size * SCENE_SCALE);
            offs += fillVec4(d, offs, scratchCameraRight[0], scratchCameraRight[1], scratchCameraRight[2], 0);
            offs += fillVec4(d, offs, scratchCameraUp[0], scratchCameraUp[1], scratchCameraUp[2], 0);
            offs += fillVec4(d, offs, r / 255, g / 255, b / 255, 1);
            offs += fillVec4(d, offs, sprite.uvRect[0], sprite.uvRect[1], sprite.uvRect[2], sprite.uvRect[3]);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplate();
    }

    private drawSmoke(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.smoke.length === 0) {
            return;
        }
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        template.setGfxProgram(this.spriteProgram);

        getMatrixAxisX(scratchCameraRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchCameraUp, viewerInput.camera.worldMatrix);
        // The engine sim runs at SMOKE_GAME_FPS and ANIMATION_SPEED slows the whole scene clock.
        const msPerFrame = (1000 / SMOKE_GAME_FPS) / ANIMATION_SPEED;

        for (const emitter of this.smoke) {
            // The engine keeps this many puffs alive at once. Match it, evenly phased.
            const puffCount = Math.min(SMOKE_MAX_PUFFS, Math.max(1, Math.ceil(emitter.lifetime / emitter.rate)));
            const puffLifeMs = emitter.lifetime * msPerFrame;
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: emitter.additive ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
            for (let puffIndex = 0; puffIndex < puffCount; puffIndex++) {
                const puffPhase = ((viewerInput.time / puffLifeMs) + puffIndex / puffCount) % 1;
                const ageFrames = puffPhase * emitter.lifetime;
                const riseY = ageFrames * SMOKE_RISE_PER_FRAME;
                const driftX = ageFrames * SMOKE_DRIFT_PER_FRAME;
                // Incoming up is -Y, so rising subtracts.
                scratchBillboardCenter[0] = SCENE_SCALE * (emitter.position[0] + driftX);
                scratchBillboardCenter[1] = -SCENE_SCALE * (emitter.position[1] - riseY);
                scratchBillboardCenter[2] = -SCENE_SCALE * emitter.position[2];
                const size = (emitter.size + ageFrames * SMOKE_GROW_PER_FRAME) * SCENE_SCALE;
                // The engine cycles each puff through dissipating frames. Fade instead, so a puff
                // thins as it rises rather than popping.
                const alpha = (emitter.alpha / 255) * (1 - puffPhase);

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.inputLayout, this.sunMesh.vertexBufferDescriptors, this.sunMesh.indexBufferDescriptor);
                renderInst.setDrawCount(this.sunMesh.indexCount);
                renderInst.setMegaStateFlags(mega);
                renderInst.setSamplerBindings(0, [{ gfxTexture: emitter.texture ?? null, gfxSampler: this.sampler }]);

                let offs = renderInst.allocateUniformBuffer(IncomingSpriteProgram.ub_SpriteParams, SPRITE_PARAMS_SIZE);
                const d = renderInst.mapUniformBufferF32(IncomingSpriteProgram.ub_SpriteParams);
                offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
                offs += fillVec4(d, offs, scratchBillboardCenter[0], scratchBillboardCenter[1], scratchBillboardCenter[2], size);
                offs += fillVec4(d, offs, scratchCameraRight[0], scratchCameraRight[1], scratchCameraRight[2], 0);
                offs += fillVec4(d, offs, scratchCameraUp[0], scratchCameraUp[1], scratchCameraUp[2], 0);
                offs += fillVec4(d, offs, emitter.color[0] / 255, emitter.color[1] / 255, emitter.color[2] / 255, alpha);
                offs += fillVec4(d, offs, SMOKE_UV[0], SMOKE_UV[1], SMOKE_UV[2], SMOKE_UV[3]);

                renderInstManager.submitRenderInst(renderInst);
            }
        }
        renderInstManager.popTemplate();
    }

    private drawShadows(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.shadows.length === 0) {
            return;
        }
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        template.setGfxProgram(this.shadowProgram);

        // Shadow quads live in Incoming space like the geometry, so share its clip matrix.
        const clipFromWorld = mat4.mul(scratchClipFromWorld, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromIncomingSpace);

        for (const shadow of this.shadows) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.inputLayout, this.shadowMesh.vertexBufferDescriptors, this.shadowMesh.indexBufferDescriptor);
            renderInst.setDrawCount(this.shadowMesh.indexCount);
            // The colour is black, so texture coverage darkens the ground.
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
            renderInst.setMegaStateFlags(mega);
            renderInst.setSamplerBindings(0, [{ gfxTexture: shadow.texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingShadowProgram.ub_ShadowParams, SHADOW_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingShadowProgram.ub_ShadowParams);
            offs += fillMatrix4x4(d, offs, clipFromWorld);
            offs += fillMatrix4x4(d, offs, shadow.modelMatrix);
            offs += fillVec4(d, offs, shadow.opacity, 0, 0, 0);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplate();
    }

    /**
     * Renders one frame.
     *
     * @param device The GPU device.
     * @param viewerInput Per-frame camera and backbuffer state.
     */
    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        renderInstManager.setCurrentList(this.renderInstListMain);

        // Sky first, with depth disabled, so all geometry draws in front of it.
        this.drawSky(renderInstManager, viewerInput);
        this.drawSun(renderInstManager, viewerInput);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 2 }]);
        template.setGfxProgram(this.program);

        let sceneOffs = template.allocateUniformBuffer(IncomingProgram.ub_SceneParams, SCENE_PARAMS_SIZE);
        this.fillSceneParams(template.mapUniformBufferF32(IncomingProgram.ub_SceneParams), sceneOffs, viewerInput);

        const cache = this.renderHelper.renderCache;
        const drawInstance = (inst: IncomingInstance) => {
            let mesh = inst.mesh;
            let texture = inst.texture;
            if (inst.animFrames !== undefined && inst.animFrames.length > 0) {
                const frame = inst.animFrames[Math.floor(viewerInput.time / ANIM_FRAME_MS) % inst.animFrames.length];
                mesh = frame.mesh;
                texture = frame.texture;
            }
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.inputLayout, mesh.vertexBufferDescriptors, mesh.indexBufferDescriptor);
            renderInst.setDrawCount(mesh.indexCount);
            // Culling stays off until the per-instance front face is settled for every mesh.
            const frontFace = inst.frontFace ?? GfxFrontFaceMode.CW;
            if (inst.transparent === true) {
                const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, frontFace, depthWrite: false };
                setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
                renderInst.setMegaStateFlags(mega);
            } else {
                renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None, frontFace });
            }
            renderInst.setSamplerBindings(0, [{ gfxTexture: texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingProgram.ub_ModelParams, MODEL_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingProgram.ub_ModelParams);
            offs += fillMatrix4x3(d, offs, this.computeModelMatrix(inst, viewerInput));
            offs += fillVec4(d, offs, inst.selfIllum ? 1 : 0, inst.colorKey ? 1 : 0, inst.transparent === true ? SHIELD_OPACITY : 1.0, 0);

            renderInstManager.submitRenderInst(renderInst);
        };
        // Opaques first, so the semi-transparent pass blends over finished geometry.
        for (const inst of this.instances) {
            if (inst.transparent !== true) {
                drawInstance(inst);
            }
        }
        for (const inst of this.instances) {
            if (inst.transparent === true) {
                drawInstance(inst);
            }
        }

        renderInstManager.popTemplate();

        // All drawn after the opaque geometry so they blend over it, and depth-tested so geometry
        // in front still occludes them.
        this.drawShadows(renderInstManager, viewerInput);
        this.drawSprites(renderInstManager, viewerInput);
        this.drawSmoke(renderInstManager, viewerInput);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.skyClearDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(cache, passRenderer);
            });
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstListMain.reset();
    }

    /**
     * Releases every GPU resource this scene owns.
     *
     * @param device The GPU device.
     */
    public destroy(device: GfxDevice): void {
        this.skyMesh.destroy(device);
        this.sunMesh.destroy(device);
        this.shadowMesh.destroy(device);
        for (const m of this.meshes) {
            m.destroy(device);
        }
        for (const t of this.textures) {
            device.destroyTexture(t);
        }
        this.renderHelper.destroy();
    }
}
