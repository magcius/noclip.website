
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
 * Approximate engine ticks per millisecond, scaled by {@link ANIMATION_SPEED}. `operate "spin"`
 * rates are per engine tick (the original game advances them once per ~30 fps frame); this converts
 * noclip's millisecond clock into an equivalent tick count to drive continuous rotation.
 */
export const SPIN_TICKS_PER_MS = (30 / 1000) * ANIMATION_SPEED;
const ANIM_FRAME_MS = 80 / ANIMATION_SPEED; // Milliseconds per frame.
const SHIELD_OPACITY = 0.4;
const FLAME_JITTER_STEP = 0.2;
const FLAME_JITTER_BASE = 2.0;
const MAX_POINT_LIGHTS = 32;

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

    // Transform the normal by the model rotation (the upper-left 3x3 of the world matrix).
    v_Normal = mat3(UnpackMatrix(u_WorldFromModel)) * a_Normal;
    v_PositionWorld = t_PositionWorld; // Incoming world space (pre-conversion), for point lights.
    v_TexCoord = a_TexCoord;

    // Linear distance fog using the perspective view depth (clip-space w).
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

    // Color-key transparency: discard near-black texels for keyed materials.
    if (u_MaterialParams.y > 0.5 && (t_Tex.r + t_Tex.g + t_Tex.b) < 0.04)
        discard;

    vec3 t_Light;
    if (u_MaterialParams.x > 0.5) {
        t_Light = vec3(1.0);
    } else {
        // Engine lighting (ProjectMeshWithDynamicLighting): color = ambient + directColor * dot(N, L),
        // where L is the UN-normalized light vector (magnitude ~2). Then add each lamp/point light's
        // contribution (color * (rangeSq - distSq)/rangeSq * max(dot(N, toLight), 0)), matching the
        // engine's per-vertex point-light loop. Clamp to 1.0 (255) before the texture modulate.
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
    // Alpha = texture alpha scaled by the material opacity (u_MaterialParams.z; 1 for opaque
    // instances, < 1 for semi-transparent ones like the energy shields, which are alpha-blended).
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
    // Peg depth to the far plane (z = w) so the dome is never near/far clipped; depth testing
    // is disabled for the sky pass so geometry always draws in front of it.
    gl_Position = (UnpackMatrix(u_ClipFromModel) * vec4(a_Position, 1.0)).xyww;
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_Altitude = a_Position.y; // dome height: +1 zenith, 0 horizon, -1 nadir (for cloud fade).
}
`;

    public override frag = `
${IncomingSkyProgram.Common}

in vec3 v_Color;
in vec2 v_TexCoord;
in float v_Altitude;

void main() {
    // v_Color is the per-vertex sky gradient color. The grayscale cloud layer sits OVERHEAD and
    // fades out toward the horizon (so it doesn't streak at the dome edge): the cloud modulation is
    // blended in by altitude. Gaps gently darken (0.7..) rather than going black.
    vec3 t_Color = v_Color;
    if (u_SkyParams.x > 0.5) {
        float t_Cloud = texture(SAMPLER_2D(u_CloudTexture), v_TexCoord).r;
        // Visible-up is the dome's +Y (the bright sky/sun side); clouds live where v_Altitude > 0 and
        // fade out toward the horizon (where the planar projection would streak). Dense cloud texels
        // mix toward a lit, lighter tint of the sky's own hue so they read as translucent billows over
        // the orange without introducing a foreign colour.
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
    const verts: number[] = [];
    const indices: number[] = [];
    const base = new Float32Array(3);

    for (let la = 0; la <= SKY_DOME_LAT; la++) {
        const t = la / SKY_DOME_LAT;
        const phi = Math.PI * (0.5 - t);
        const y = Math.sin(phi), r = Math.cos(phi);
        // The dome reads vertically flipped vs the Y-negated scene, so the VISIBLE altitude is -y
        // (+1 at the visible zenith, 0 at the horizon, -1 below). The 8 RGB values are the sky-dome
        // gradient; the visible upper hemisphere uses warm bands 0..3 (orange for canaveral, blue
        // for africa) and the hidden lower hemisphere bands 3..7 (blue/dark) — so the gradient's
        // blue middle bands sit below the horizon instead of dominating the visible sky.
        const va = -y;
        const gradT = va >= 0 ? (1 - va) * (3 / 7) : (3 / 7) + (-va) * (4 / 7);
        sampleSkyGradient(gradient, gradT, base);
        // The VISIBLE sky is the +Y hemisphere (where the sun and the warm bands show); the cloud
        // planar projection therefore uses +y as the up component (clouds live where y > 0).
        const yc = Math.max(y, 0.18);
        for (let lo = 0; lo <= SKY_DOME_LON; lo++) {
            const theta = (lo / SKY_DOME_LON) * Math.PI * 2;
            const x = r * Math.cos(theta), z = r * Math.sin(theta);
            const u = (x / yc) * 0.28 + 0.5, v = (z / yc) * 0.28 + 0.5;
            verts.push(x, y, z, base[0], base[1], base[2], u, v);
        }
    }

    const row = SKY_DOME_LON + 1;
    for (let la = 0; la < SKY_DOME_LAT; la++) {
        for (let lo = 0; lo < SKY_DOME_LON; lo++) {
            const a = la * row + lo, b = a + row;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
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
    // Anchor-depth: corner screen xy, centre depth, so the sprite occludes all-or-nothing.
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
    // rgb = textured tint; alpha = texture luminance × u_Color.a. Additive sprites (nav lights)
    // pass a=1 and ignore alpha (One/One blend); alpha-blended smoke uses it for soft puffs.
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
    // Anchor-depth: take depth from the shadow centre so it occludes all-or-nothing.
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

const scratchSunCenter = vec3.create();
const scratchSunRight = vec3.create();
const scratchSunUp = vec3.create();

/**
 * A single uploaded mesh: a vertex buffer and index buffer plus the metadata needed to draw
 * it. The vertex format is the shared interleaved pos3/norm3/uv2 layout.
 */
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
     * Horizontal (XZ-plane) bounding radius of the local mesh, in model units: `max √(x²+z²)`
     * over the vertices. Scaled by the part scale, this gives the object's ground footprint —
     * used to size the `shadow` ground sprite (mirrors the engine's bounding-box-derived shadow).
     */
    public readonly localRadiusXZ: number;

    /**
     * Uploads mesh geometry to the GPU.
     *
     * @param device The GPU device.
     * @param vertices Interleaved vertex data (8 float32 per vertex: pos3, norm3, uv2).
     * @param indices Triangle indices, either 16-bit or 32-bit.
     */
    constructor(device: GfxDevice, vertices: Float32Array, indices: Uint16Array | Uint32Array) {
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer);
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.indexCount = indices.length;

        // Horizontal bounding radius (pos.x/pos.z are vertex floats 0 and 2 of each 8-float
        // stride).
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
     * Releases the GPU buffers owned by this mesh.
     *
     * @param device The GPU device.
     */
    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

/** The index buffer format used for terrain meshes (which may exceed 65535 vertices). */
export function indexFormatFor(indices: Uint16Array | Uint32Array): GfxFormat {
    return indices instanceof Uint32Array ? GfxFormat.U32_R : GfxFormat.U16_R;
}

/**
 * A single drawable object: a shared mesh, its texture, a world transform, and material
 * flags. Both terrain tiles and placed models are represented uniformly as instances.
 */
export interface IncomingInstance {
    /** The geometry to draw. */
    readonly mesh: IncomingMeshData;
    /** The texture to bind, or undefined to use the fallback white texture. */
    readonly texture?: GfxTexture;
    /** The object's world transform. */
    readonly modelMatrix: mat4;
    /** True if the material is self-illuminating (unlit / full-bright). */
    readonly selfIllum: boolean;
    /** True if the texture uses color-key transparency (alpha-test near-black texels). */
    readonly colorKey: boolean;
    /**
     * True if the material is `semi transparent` (alpha-blended at {@link SHIELD_OPACITY}, drawn
     * after opaque).
     */
    readonly transparent?: boolean;
    /** True to disable backface culling (two-sided material). */
    readonly twoSided: boolean;
    /** GPU index format of {@link mesh}. */
    readonly indexFormat: GfxFormat;
    /**
     * Optional per-axis spin angular velocity (radians per engine tick) about the part's local
     * axes. When set (and non-zero), {@link modelMatrix} is recomputed each frame from
     * {@link baseFrame} and {@link meshScale}; otherwise {@link modelMatrix} is static.
     */
    readonly spin?: [number, number, number];
    /** True for an `operate "spinengines"` part: its local-Z scale pulses each frame. */
    readonly flameFlicker?: boolean;
    /** The instance's placement·hierarchy transform WITHOUT mesh scale, for animating spin. */
    readonly baseFrame?: mat4;
    /**
     * Target world frame for an `animate` keyframe part; the instance oscillates baseFrame↔this.
     */
    readonly animTargetFrame?: mat4;
    /** The part's mesh scale, applied after the animated rotation when spinning. */
    readonly meshScale?: number;
    /**
     * Optional mesh flipbook from the part's `animatemodel` directive (e.g. tank treads). When
     * present and non-empty, the drawn geometry+texture is cycled through these frames over time
     * (one frame per {@link ANIM_FRAME_MS}) instead of using {@link mesh}/{@link texture};
     * {@link modelMatrix} still positions it. Frames are in ODL declaration order.
     */
    readonly animFrames?: readonly IncomingAnimFrame[];
    /**
     * Optional waypoint-path mover (cooling actors like aircraft/ships/vehicles following an MDL
     * `task`/`set_task` route). When set, this instance's {@link baseFrame}/{@link modelMatrix} are
     * ACTOR-LOCAL (instanced with an identity placement), and the renderer prepends the mover's
     * per-frame world root transform {@link IncomingMover} each frame so the whole actor travels.
     */
    readonly mover?: IncomingMover;
}

/**
 * A moving actor's traversal state: a closed world-space polyline walked at constant speed, looping
 * forever (both `patrol` circuits and one-shot `goto`/`kill` transits are looped). The renderer
 * derives the actor's world position and heading each frame from {@link speed} × elapsed time.
 */
export interface IncomingMover {
    /** World-space waypoints (Incoming space) the actor visits in order; the loop closes back to [0]. */
    readonly points: ReadonlyArray<readonly [number, number, number]>;
    /** Cumulative arc length at the START of each leg (length === points.length; closes to {@link totalLength}). */
    readonly cumLengths: readonly number[];
    /**
     * Total closed-loop perimeter (includes the closing leg from the last point back to the
     * first).
     */
    readonly totalLength: number;
    /** Constant traversal speed in world units per millisecond (`maxVel · SPIN_TICKS_PER_MS`). */
    readonly speed: number;
    /** The actor's up vector for orientation (Incoming space; usually `[0, 1, 0]`). */
    readonly up: readonly [number, number, number];
    /**
     * The actor's authored forward vector (from its placement). Used as the heading fallback when
     * the path direction is (anti)parallel to {@link up}.
     */
    readonly forward: readonly [number, number, number];
    /** Phase offset along the loop (0..1) so co-spawned actors don't move in lockstep. */
    readonly phase: number;
}

function computeMoverMatrix(mover: IncomingMover, time: number): mat4 {
    const { points, cumLengths, totalLength } = mover;
    // Distance traveled along the looped path this frame, wrapped into [0, totalLength).
    let d = (time * mover.speed + mover.phase * totalLength) % totalLength;
    if (d < 0) {
        d += totalLength;
    }
    // The active leg is the last one whose start cumulative length is <= d.
    let seg = points.length - 1;
    for (let i = 0; i < points.length; i++) {
        const next = i + 1 < cumLengths.length ? cumLengths[i + 1] : totalLength;
        if (d < next) {
            seg = i;
            break;
        }
    }
    const a = points[seg];
    const b = points[(seg + 1) % points.length];
    const segStart = cumLengths[seg];
    const segEnd = seg + 1 < cumLengths.length ? cumLengths[seg + 1] : totalLength;
    const segLen = segEnd - segStart;
    const t = segLen > 1e-6 ? (d - segStart) / segLen : 0;

    scratchMoverPos[0] = a[0] + (b[0] - a[0]) * t;
    scratchMoverPos[1] = a[1] + (b[1] - a[1]) * t;
    scratchMoverPos[2] = a[2] + (b[2] - a[2]) * t;
    // Heading = leg direction (fall back to +Z if the leg is degenerate).
    vec3.set(scratchMoverFwd, b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (vec3.len(scratchMoverFwd) < 1e-4) {
        vec3.set(scratchMoverFwd, 0, 0, 1);
    }
    vec3.normalize(scratchMoverFwd, scratchMoverFwd);
    vec3.set(scratchMoverUp, mover.up[0], mover.up[1], mover.up[2]);
    vec3.normalize(scratchMoverUp, scratchMoverUp);
    // Orthonormal basis: right = up × forward. If the path direction is (anti)parallel to up — i.e.
    // the actor is moving straight up/down, as in a rocket launch — there is no valid velocity
    // heading (the cross product collapses), so keep the actor's AUTHORED forward (its standing
    // pose) instead of tipping it onto an arbitrary axis.
    vec3.cross(scratchMoverRight, scratchMoverUp, scratchMoverFwd);
    if (vec3.len(scratchMoverRight) < 1e-3) {
        vec3.set(scratchMoverFwd, mover.forward[0], mover.forward[1], mover.forward[2]);
        vec3.normalize(scratchMoverFwd, scratchMoverFwd);
        vec3.cross(scratchMoverRight, scratchMoverUp, scratchMoverFwd);
        if (vec3.len(scratchMoverRight) < 1e-3) {
            vec3.set(scratchMoverRight, 1, 0, 0);
        }
    }
    vec3.normalize(scratchMoverRight, scratchMoverRight);
    vec3.cross(scratchMoverUp, scratchMoverFwd, scratchMoverRight);

    const m = scratchMoverMatrix;
    m[0] = scratchMoverRight[0]; m[1] = scratchMoverRight[1]; m[2] = scratchMoverRight[2]; m[3] = 0;
    m[4] = scratchMoverUp[0]; m[5] = scratchMoverUp[1]; m[6] = scratchMoverUp[2]; m[7] = 0;
    m[8] = scratchMoverFwd[0]; m[9] = scratchMoverFwd[1]; m[10] = scratchMoverFwd[2]; m[11] = 0;
    m[12] = scratchMoverPos[0]; m[13] = scratchMoverPos[1]; m[14] = scratchMoverPos[2]; m[15] = 1;
    return m;
}

/** One frame of an {@link IncomingInstance.animFrames} mesh flipbook (an `animatemodel` frame). */
export interface IncomingAnimFrame {
    /** The frame's geometry. */
    readonly mesh: IncomingMeshData;
    /** The frame's texture, or undefined for the fallback white texture. */
    readonly texture?: GfxTexture;
}

/**
 * A camera-facing billboard sprite instance (a placed part's `sprite`): a wingtip nav-light,
 * engine glow, or smoke emitter. Drawn additively at real scene depth; the colour animates
 * through {@link cycleColors} when the sprite has a `colourfade` cycle.
 */
export interface IncomingSpriteInstance {
    /** Billboard center in Incoming world space. */
    readonly position: [number, number, number];
    /** Billboard size in Incoming world units. */
    readonly size: number;
    /** Atlas sub-rect, normalized 0..1: `[uMin, vMin, uSize, vSize]`. */
    readonly uvRect: [number, number, number, number];
    /** The sprite atlas texture, or undefined for the fallback white texture. */
    readonly texture?: GfxTexture;
    /** Base colour `[r, g, b]` 0..255 (used when there is no colour cycle). */
    readonly color: [number, number, number];
    /** Colour-cycle keyframes `[r, g, b]` 0..255; empty for a static-colour sprite. */
    readonly cycleColors: readonly (readonly [number, number, number])[];
    /**
     * Colour-cycle hold-frames per transition (engine frames, from `colourfade speed`);
     * 0 = static.
     */
    readonly cycleSpeed: number;
}

/**
 * A smoke-plume emitter (a placed object's `smoke` directive — cooling towers, chimneys, exhaust).
 * The renderer reproduces the engine's steady-state column: a puff spawns every {@link rate}
 * frames at {@link position}, then rises and expands over its {@link lifetime} per the physics in
 * `UpdateEffectObjectFallSpin`. {@link additive} selects the blend the engine used for this trail.
 */
export interface IncomingSmokeInstance {
    /** Emitter world position in Incoming space (the part origin + rotated local smoke offset). */
    readonly position: [number, number, number];
    /** Initial puff size (world units); each puff grows 5 units/frame from here. */
    readonly size: number;
    /** Smoke colour `[r, g, b]` 0..255. */
    readonly color: [number, number, number];
    /** Peak puff opacity 0..255 (used for the alpha-blended path). */
    readonly alpha: number;
    /**
     * Frames between puff spawns (`rate`); sets the number of simultaneous puffs with
     * {@link lifetime}.
     */
    readonly rate: number;
    /** Each puff's lifetime in game frames (`frames`); the column is `lifetime * 16` units tall. */
    readonly lifetime: number;
    /** True for additive-blended trails (negative `frames`: chimney, exhaust); false for alpha. */
    readonly additive: boolean;
    /** The smoke atlas texture (`smoke.ppm`), or undefined for the fallback. */
    readonly texture?: GfxTexture;
}

/**
 * A ground-shadow instance (a placed object's `shadow` silhouette): a flat world-space quad on
 * the terrain beneath the object, alpha-blended dark. Drawn after geometry, depth-tested.
 */
export interface IncomingShadowInstance {
    /** The quad's world transform (ground-aligned, sized to the object footprint, yaw-oriented). */
    readonly modelMatrix: mat4;
    /** The grayscale shadow silhouette texture, or undefined. */
    readonly texture?: GfxTexture;
    /** Overall shadow opacity 0..1. */
    readonly opacity: number;
}

/**
 * A world-space point/lamp light: position, color (may exceed 1.0 — HDR, summed then clamped),
 * and effective radius. Accumulated per-pixel by the main shader.
 */
export interface IncomingPointLight {
    /** World-space position `[x, y, z]` (Incoming space, pre-conversion). */
    readonly position: [number, number, number];
    /** Light color `[r, g, b]` (already divided by 255; may exceed 1.0). */
    readonly color: [number, number, number];
    /** Effective radius in world units. */
    readonly radius: number;
}

/**
 * Per-scene lighting and fog parameters, derived from the `.odl` `sky` block. Colors are
 * normalized floats in `[0,1]`.
 */
export interface IncomingSceneParams {
    /** World-space direction pointing toward the light. */
    readonly lightDir: [number, number, number];
    /** Directional (sun) light color. */
    readonly lightColor: [number, number, number];
    /** Ambient light color. */
    readonly ambientColor: [number, number, number];
    /** Fog color. */
    readonly fogColor: [number, number, number];
    /** Background/horizon sky color used to clear the framebuffer (so the horizon matches). */
    readonly skyColor: [number, number, number];
    /** Sky-dome gradient colors (each `[r,g,b]` in 0..255, top band first); empty for none. */
    readonly skyGradient: number[][];
    /** Warm sun/sky tint (normalized `[r,g,b]`) used to color the grayscale cloud sky. */
    readonly sunColor: [number, number, number];
    /** Direction to the sun in noclip space (normalized), for placing the sun sprite. */
    readonly sunDir: [number, number, number];
    /** Fog start distance (view-space), in world units. */
    readonly fogStart: number;
    /** Fog end distance (view-space), in world units. */
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
    /** Optional cloud texture for the sky dome (set by the scene loader after construction). */
    public skyCloudTexture?: GfxTexture;
    /** Optional sun-sprite texture (set by the scene loader after construction). */
    public sunTexture?: GfxTexture;
    /** All meshes owned by this scene (terrain + models), destroyed on teardown. */
    public meshes: IncomingMeshData[] = [];
    /** All textures owned by this scene, destroyed on teardown. */
    public textures: GfxTexture[] = [];
    /** Every drawable instance (terrain tiles and placed models). */
    public instances: IncomingInstance[] = [];
    /** Every billboard sprite instance (nav lights, glows), drawn additively after the geometry. */
    public sprites: IncomingSpriteInstance[] = [];
    /**
     * Every smoke-plume emitter (cooling towers, chimneys, exhaust), drawn as rising puff
     * columns.
     */
    public smoke: IncomingSmokeInstance[] = [];
    /**
     * Every ground-shadow instance (placed objects' `shadow` silhouettes), drawn after geometry.
     */
    public shadows: IncomingShadowInstance[] = [];
    /**
     * All world-space lamp/point lights in the level (uploaded, nearest-first capped, per frame).
     */
    public pointLights: IncomingPointLight[] = [];
    /** The scene's lighting and fog. */
    public sceneParams: IncomingSceneParams;

    /**
     * Creates the renderer and its shared GPU state.
     * @param device The GPU device.
     * @param sceneParams The level's lighting and fog parameters.
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
        // Sky dome: a camera-centered gradient sphere (reusing the shared input layout), drawn
        // first with depth writes disabled so all geometry renders in front of it.
        this.skyProgram = cache.createProgram(new IncomingSkyProgram());
        const dome = buildSkyDomeMesh(sceneParams.skyGradient);
        this.skyMesh = new IncomingMeshData(device, dome.vertices, dome.indices);
        // Sun sprite: a unit quad (corner offsets in a_Position.xy) billboarded in the shader.
        this.sunProgram = cache.createProgram(new IncomingSunProgram());
        this.spriteProgram = cache.createProgram(new IncomingSpriteProgram());
        // Shadow sprite: a unit quad in the local XZ plane (normal +Y), scaled/oriented per object.
        this.shadowProgram = cache.createProgram(new IncomingShadowProgram());
        const shq = new Float32Array([
            -1, 0, -1, 0, 1, 0, 0, 1,
             1, 0, -1, 0, 1, 0, 1, 1,
             1, 0,  1, 0, 1, 0, 1, 0,
            -1, 0,  1, 0, 1, 0, 0, 0,
        ]);
        this.shadowMesh = new IncomingMeshData(device, shq, new Uint32Array([0, 1, 2, 0, 2, 3]));
        const sq = new Float32Array([
            -1, -1, 0, 0, 0, 0, 0, 1,
             1, -1, 0, 0, 0, 0, 1, 1,
             1,  1, 0, 0, 0, 0, 1, 0,
            -1,  1, 0, 0, 0, 0, 0, 0,
        ]);
        this.sunMesh = new IncomingMeshData(device, sq, new Uint32Array([0, 1, 2, 0, 2, 3]));
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
        const n = Math.min(lights.length, MAX_POINT_LIGHTS);
        offs += fillVec4(d, offs, p.fogStart, p.fogEnd, 1, n);
        // Light positions + radius, then colors (two parallel std140 vec4 arrays).
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const l = i < n ? lights[i] : undefined;
            offs += l !== undefined ? fillVec4(d, offs, l.position[0], l.position[1], l.position[2], l.radius) : fillVec4(d, offs, 0, 0, 0, 0);
        }
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            const l = i < n ? lights[i] : undefined;
            offs += l !== undefined ? fillVec4(d, offs, l.color[0], l.color[1], l.color[2], 0) : fillVec4(d, offs, 0, 0, 0, 0);
        }
    }

    private computeModelMatrix(inst: IncomingInstance, viewerInput: ViewerRenderInput): mat4 {
        const local = this.computeLocalMatrix(inst, viewerInput);
        if (inst.mover === undefined) {
            return local;
        }
        // Moving actor: `local` is the part's ACTOR-LOCAL frame; prepend the mover's world root
        // (position + heading along the looped path this frame) to carry the whole craft along.
        const root = computeMoverMatrix(inst.mover, viewerInput.time);
        return mat4.multiply(scratchModelMatrix, root, local);
    }

    private computeLocalMatrix(inst: IncomingInstance, viewerInput: ViewerRenderInput): mat4 {
        if (inst.baseFrame === undefined || inst.meshScale === undefined) {
            return inst.modelMatrix;
        }
        // `animate` keyframe pose (helicopter landing gear, etc.): hold the part at its animate
        // TARGET pose (gear retracted / flight configuration) rather than oscillating — the placed
        // aircraft are airborne, so the gear stays up (per user direction). The base/target frames
        // differ only in translation here (gear position), so the target translation is applied
        // over the base orientation; orientation-change keyframes are not modeled (none in the
        // data).
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
        // Rotate about the part's own local axes (the frame already places/orients the part).
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
        // Engine-exhaust flame flicker (`spinengines`): a 4-engine-frame staircase Z-scale
        // ~2.0..2.6 (the part's local Z is the exhaust direction).
        const s = inst.meshScale;
        const sz = flicker ? s * ((Math.floor(viewerInput.time * SPIN_TICKS_PER_MS) & 3) * FLAME_JITTER_STEP + FLAME_JITTER_BASE) : s;
        mat4.scale(scratchLocalMatrix, scratchLocalMatrix, [s, s, sz]);
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
        getMatrixAxisX(scratchSunRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchSunUp, viewerInput.camera.worldMatrix);
        const dir = this.sceneParams.sunDir, dist = SKY_DOME_RADIUS * 0.9, size = SKY_DOME_RADIUS * 0.05;
        vec3.set(scratchSunCenter, scratchCameraPos[0] + dir[0] * dist, scratchCameraPos[1] + dir[1] * dist, scratchCameraPos[2] + dir[2] * dist);

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
        offs += fillVec4(d, offs, scratchSunCenter[0], scratchSunCenter[1], scratchSunCenter[2], size);
        offs += fillVec4(d, offs, scratchSunRight[0], scratchSunRight[1], scratchSunRight[2], 0);
        offs += fillVec4(d, offs, scratchSunUp[0], scratchSunUp[1], scratchSunUp[2], 0);
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

        // Camera right/up (noclip space) for billboarding; the engine frame clock for colour cycles.
        getMatrixAxisX(scratchSunRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchSunUp, viewerInput.camera.worldMatrix);
        const frames = viewerInput.time * SPIN_TICKS_PER_MS;

        for (const sp of this.sprites) {
            // Incoming world center -> noclip space, so the billboard can be built with the noclip
            // camera axes like the sun sprite.
            scratchSunCenter[0] = SCENE_SCALE * sp.position[0];
            scratchSunCenter[1] = -SCENE_SCALE * sp.position[1];
            scratchSunCenter[2] = -SCENE_SCALE * sp.position[2];
            // Current colour: linearly interpolate the cycle, holding each key `cycleSpeed` engine
            // frames; or the static base colour.
            let r = sp.color[0], g = sp.color[1], b = sp.color[2];
            const n = sp.cycleColors.length;
            if (n >= 2 && sp.cycleSpeed > 0) {
                const tt = frames / sp.cycleSpeed;
                const i0 = Math.floor(tt) % n;
                const c0 = sp.cycleColors[i0], c1 = sp.cycleColors[(i0 + 1) % n];
                const f = tt - Math.floor(tt);
                r = c0[0] + (c1[0] - c0[0]) * f;
                g = c0[1] + (c1[1] - c0[1]) * f;
                b = c0[2] + (c1[2] - c0[2]) * f;
            }

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.inputLayout, this.sunMesh.vertexBufferDescriptors, this.sunMesh.indexBufferDescriptor);
            renderInst.setDrawCount(this.sunMesh.indexCount);
            // Additive, depth-tested (occluded by closer geometry) but not depth-writing.
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.One });
            renderInst.setMegaStateFlags(mega);
            renderInst.setSamplerBindings(0, [{ gfxTexture: sp.texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingSpriteProgram.ub_SpriteParams, SPRITE_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingSpriteProgram.ub_SpriteParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
            offs += fillVec4(d, offs, scratchSunCenter[0], scratchSunCenter[1], scratchSunCenter[2], sp.size * SCENE_SCALE);
            offs += fillVec4(d, offs, scratchSunRight[0], scratchSunRight[1], scratchSunRight[2], 0);
            offs += fillVec4(d, offs, scratchSunUp[0], scratchSunUp[1], scratchSunUp[2], 0);
            offs += fillVec4(d, offs, r / 255, g / 255, b / 255, 1);
            offs += fillVec4(d, offs, sp.uvRect[0], sp.uvRect[1], sp.uvRect[2], sp.uvRect[3]);

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

        getMatrixAxisX(scratchSunRight, viewerInput.camera.worldMatrix);
        getMatrixAxisY(scratchSunUp, viewerInput.camera.worldMatrix);
        // Real milliseconds spanning one puff's `lifetime` game frames: the engine sim runs at
        // SMOKE_GAME_FPS, and ANIMATION_SPEED slows the whole scene's clock proportionally.
        const msPerFrame = (1000 / SMOKE_GAME_FPS) / ANIMATION_SPEED;

        for (const sm of this.smoke) {
            // The engine keeps `ceil(lifetime / rate)` puffs alive at once (one new puff every
            // `rate` frames, each living `lifetime` frames); reproduce that many, evenly phased.
            const puffCount = Math.min(SMOKE_MAX_PUFFS, Math.max(1, Math.ceil(sm.lifetime / sm.rate)));
            const lifeMs = sm.lifetime * msPerFrame;
            // Additive trails (chimney/exhaust) add light; the cooling-tower plume alpha-blends.
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: sm.additive ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
            for (let i = 0; i < puffCount; i++) {
                // Phase 0 (freshly spawned at the emitter) → 1 (end of life), staggered per puff.
                const p = ((viewerInput.time / lifeMs) + i / puffCount) % 1;
                // Age in game frames drives the engine's exact per-frame rise/grow/drift.
                const ageFrames = p * sm.lifetime;
                const rise = ageFrames * SMOKE_RISE_PER_FRAME;
                const drift = ageFrames * SMOKE_DRIFT_PER_FRAME;
                // Rise along Incoming up (−Y) and drift along +X, then convert to noclip space.
                scratchSunCenter[0] = SCENE_SCALE * (sm.position[0] + drift);
                scratchSunCenter[1] = -SCENE_SCALE * (sm.position[1] - rise);
                scratchSunCenter[2] = -SCENE_SCALE * sm.position[2];
                const size = (sm.size + ageFrames * SMOKE_GROW_PER_FRAME) * SCENE_SCALE;
                // The engine cycles each puff through dissipating animation frames; approximate that
                // by fading the puff out over its life so it thins as it rises rather than popping.
                const alpha = (sm.alpha / 255) * (1 - p);

                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.inputLayout, this.sunMesh.vertexBufferDescriptors, this.sunMesh.indexBufferDescriptor);
                renderInst.setDrawCount(this.sunMesh.indexCount);
                renderInst.setMegaStateFlags(mega);
                renderInst.setSamplerBindings(0, [{ gfxTexture: sm.texture ?? null, gfxSampler: this.sampler }]);

                let offs = renderInst.allocateUniformBuffer(IncomingSpriteProgram.ub_SpriteParams, SPRITE_PARAMS_SIZE);
                const d = renderInst.mapUniformBufferF32(IncomingSpriteProgram.ub_SpriteParams);
                offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);
                offs += fillVec4(d, offs, scratchSunCenter[0], scratchSunCenter[1], scratchSunCenter[2], size);
                offs += fillVec4(d, offs, scratchSunRight[0], scratchSunRight[1], scratchSunRight[2], 0);
                offs += fillVec4(d, offs, scratchSunUp[0], scratchSunUp[1], scratchSunUp[2], 0);
                offs += fillVec4(d, offs, sm.color[0] / 255, sm.color[1] / 255, sm.color[2] / 255, alpha);
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

        // Shadow quads live in Incoming world space (like the geometry), so use the same
        // Incoming->noclip->clip matrix.
        const clipFromWorld = mat4.mul(scratchClipFromWorld, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromIncomingSpace);

        for (const sh of this.shadows) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setVertexInput(this.inputLayout, this.shadowMesh.vertexBufferDescriptors, this.shadowMesh.indexBufferDescriptor);
            renderInst.setDrawCount(this.shadowMesh.indexCount);
            // Standard alpha blend (dst·(1−a)); colour is black so coverage darkens the ground.
            const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, depthWrite: false, depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) };
            setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
            renderInst.setMegaStateFlags(mega);
            renderInst.setSamplerBindings(0, [{ gfxTexture: sh.texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingShadowProgram.ub_ShadowParams, SHADOW_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingShadowProgram.ub_ShadowParams);
            offs += fillMatrix4x4(d, offs, clipFromWorld);
            offs += fillMatrix4x4(d, offs, sh.modelMatrix);
            offs += fillVec4(d, offs, sh.opacity, 0, 0, 0);

            renderInstManager.submitRenderInst(renderInst);
        }
        renderInstManager.popTemplate();
    }

    /**
     * Renders one frame of the scene.
     * @param device The GPU device.
     * @param viewerInput Per-frame viewer state (camera, backbuffer size, etc.).
     */
    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        renderInstManager.setCurrentList(this.renderInstListMain);

        // Sky first (its own program/bindings, depth disabled) so all geometry draws in front.
        this.drawSky(renderInstManager, viewerInput);
        this.drawSun(renderInstManager, viewerInput);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 2 }]);
        template.setGfxProgram(this.program);

        let sceneOffs = template.allocateUniformBuffer(IncomingProgram.ub_SceneParams, SCENE_PARAMS_SIZE);
        this.fillSceneParams(template.mapUniformBufferF32(IncomingProgram.ub_SceneParams), sceneOffs, viewerInput);

        const cache = this.renderHelper.renderCache;
        const drawInstance = (inst: IncomingInstance) => {
            // Resolve the geometry/texture to draw: a flipbook frame when the instance has an
            // `animatemodel` animation, otherwise the instance's static mesh.
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
            // Correct culling is not yet figured out.
            // const cullMode = inst.twoSided ? GfxCullMode.None : GfxCullMode.Back;
            if (inst.transparent === true) {
                const mega: Partial<GfxMegaStateDescriptor> = { cullMode: GfxCullMode.None, frontFace: GfxFrontFaceMode.CW, depthWrite: false };
                setAttachmentStateSimple(mega, { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
                renderInst.setMegaStateFlags(mega);
            } else {
                renderInst.setMegaStateFlags({ cullMode: GfxCullMode.None, frontFace: GfxFrontFaceMode.CW });
            }
            renderInst.setSamplerBindings(0, [{ gfxTexture: texture ?? null, gfxSampler: this.sampler }]);

            let offs = renderInst.allocateUniformBuffer(IncomingProgram.ub_ModelParams, MODEL_PARAMS_SIZE);
            const d = renderInst.mapUniformBufferF32(IncomingProgram.ub_ModelParams);
            offs += fillMatrix4x3(d, offs, this.computeModelMatrix(inst, viewerInput));
            offs += fillVec4(d, offs, inst.selfIllum ? 1 : 0, inst.colorKey ? 1 : 0, inst.transparent === true ? SHIELD_OPACITY : 1.0, 0);

            renderInstManager.submitRenderInst(renderInst);
        };
        // Handle Opaque instances first, then semi-transparent ones.
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

        // Ground shadows (alpha quads on the terrain), then object sprites last (additive
        // billboards): both drawn after opaque geometry so they blend over it, and depth-tested so
        // geometry in front still occludes them.
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
     * Releases all GPU resources owned by this scene.
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
