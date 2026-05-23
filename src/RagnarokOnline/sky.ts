
// Per-map sky for Ragnarok Online maps.
//
// RO ships no real skybox: the original CSkyBox/CSkyBoxEllipse code is vestigial
// (m_skyBox = NULL in CView::ctor, never instantiated) and its referenced
// textures (effect\skybox_back/front/left/right/top.bmp + skybox.rsm) are not in
// the GRF — not in the 2009 kRO archive and not in the 2026 iRO "Event Horizon"
// archive either. The original client paints a flat clear behind every map and
// optionally drops cloud particle emitters over it.
//
// We do better: on outdoor maps (cities/fields/etc.) we draw a procedural sky
// dome — a screen-covering pass before terrain — with three terms:
//   - a vertical gradient zenith → horizon → ground, where the horizon colour
//     is the map's fog-table colour (the canonical RO atmosphere — warm yellow
//     for the desert, light cyan for Payon, pale white for cheerful towns) and
//     the zenith is derived from it (pushed toward deep blue, slightly
//     darkened) so the sky feels like the same atmosphere from higher up;
//   - a sun disc + halo at the RSW lat/long direction, so the sun shows where
//     the props' directional shading is coming from;
//   - a soft horizon haze band that ties the dome into the distant geometry.
//
// On dungeons / indoors / castles the dome is skipped and we keep the original
// flat clear (the existing dim category default), since there is no real sky
// to read against in those maps.
//
// All inputs come from data we already have: the fog-table colour resolved by
// the scene loader and the RSW longitude/latitude. No new GRF assets needed.

import { mat4, vec3 } from "gl-matrix";
import { GfxCullMode, GfxProgram } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { mapCategory } from "./mapcategory.js";

// The default outdoor sky: a soft daylight blue. Used as the horizon colour
// when the map has no fog-table entry to seed atmosphere from.
const DEFAULT_OUTDOOR_SKY: [number, number, number] = [0.55, 0.75, 0.92];

// The default underground / indoor clear: a neutral dim grey so caves and
// closed rooms don't show a bright sky default behind their occluded geometry.
const DEFAULT_INDOOR_SKY: [number, number, number] = [0.12, 0.12, 0.14];

// Sun disc visual size, as the cosine of its angular half-extent. cos(~0.6°)
// reads as a sharp but unmistakeable disc at the rendered FoV; smaller would
// alias against the gradient and larger would feel cartoony.
const SUN_DISC_COS = Math.cos(0.0105);

// Halo softness — the exponent on max(dot(rayDir, sunDir), 0). Higher = tighter
// halo. 96 puts the bright bloom inside ~10° of the sun while leaving the rest
// of the sky alone.
const SUN_HALO_EXP = 96.0;

// Sun colour: a warm off-white. The disc + halo are emissive (additive on top
// of the gradient), so values can exceed the gradient's range without blowing
// out — but kept under 1 so the bright sky regions stay readable.
const SUN_COLOR: [number, number, number] = [1.0, 0.95, 0.85];

export interface SkySceneData {
    // Solid background clear used when the dome is disabled (dungeon/indoor/
    // castle), or as the framebuffer clear underlying the dome on outdoor maps
    // (any pixel the dome doesn't paint reads as this — currently it covers
    // every pixel, so it's effectively the fallback).
    color: [number, number, number];
    // True if the procedural sky dome should run (outdoor maps with a real
    // open-air feeling). Indoor categories skip it and keep the flat clear.
    enableDome: boolean;
    // Dome inputs. Only consulted when enableDome=true.
    horizonColor: [number, number, number];
    zenithColor: [number, number, number];
    groundColor: [number, number, number];
    // Sun direction in the render frame — a unit vector pointing FROM the
    // ground TOWARD the sun. Computed from the RSW lat/long and pre-mirrored
    // to match the terrain's mirrored world (see scenes.ts; RO is
    // left-handed). The shader compares the camera view ray against this to
    // place the sun disc + halo where the props' directional shading comes
    // from.
    sunDir: [number, number, number];
}

// Outdoor categories where the dome reads naturally — an open sky overhead.
// Dungeon / indoor / castle maps keep the flat clear (no sky to read against).
// "instance" maps are usually dungeon-flavoured but include some open-air
// quests; we keep them flat to match the existing fog policy (mapWantsFog
// already groups them with dungeons for the same reason).
function categoryWantsDome(id: string): boolean {
    const cat = mapCategory(id);
    return cat === "city" || cat === "field" || cat === "other";
}

export function defaultSkyForMap(id: string): [number, number, number] {
    const cat = mapCategory(id);
    if (cat === "dungeon" || cat === "indoor" || cat === "castle")
        return [...DEFAULT_INDOOR_SKY];
    return [...DEFAULT_OUTDOOR_SKY];
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale3(a: [number, number, number], s: number): [number, number, number] {
    return [a[0] * s, a[1] * s, a[2] * s];
}

// Derive the zenith colour. Important: RO's fog-table colours are an even
// ATMOSPHERIC TINT applied over the geometry — for a forest map (prt_fild08)
// it's bright yellow-green to read as foliage canopy filtering daylight; for a
// desert it's warm; for Niflheim it's purple-grey. None of those are the sky.
// The original client never showed real sky on these maps either, so it didn't
// matter — but our free-fly viewer can pan up and we want a believable sky
// overhead. So the zenith is mostly a clear daylight blue, with only a faint
// memory of the map's atmospheric tint mixed in so the dome doesn't feel
// totally disconnected from the world's palette.
function deriveZenith(horizon: [number, number, number]): [number, number, number] {
    const SKY_BLUE: [number, number, number] = [0.30, 0.50, 0.78];
    // Mostly the clear daylight blue (85% blue, 15% horizon tint). Keeps the
    // dome reading as sky on every outdoor map regardless of fog colour.
    return lerp3(SKY_BLUE, horizon, 0.15);
}

// Derive the "ground" gradient — the colour the dome reads as when the camera
// looks BELOW the horizon (free-fly past the terrain). Just a darkened horizon
// so the wraparound feels coherent rather than showing the bright sky there.
function deriveGround(horizon: [number, number, number]): [number, number, number] {
    return scale3(horizon, 0.55);
}

// Derive a softened horizon colour. The raw fog-table colour can be quite
// saturated (prt_fild08's yellow-green at 0xBAFF77 is full-saturation green);
// at the horizon we want a softer atmospheric reading. Pull a bit toward a
// pale haze so the horizon band feels like distance/air rather than a painted
// stripe in the map's accent colour.
function deriveHorizon(horizon: [number, number, number]): [number, number, number] {
    const HAZE: [number, number, number] = [0.78, 0.85, 0.88];
    return lerp3(horizon, HAZE, 0.35);
}

// Builds the SkySceneData for a map.
//
//   id          : map id (drives outdoor/indoor gating).
//   fogColor    : the per-map fog-table colour (the canonical RO horizon /
//                 sky tint), or null when the map has no entry.
//   sunDir      : a unit vector FROM the ground TOWARD the sun, already in the
//                 same render frame as the camera (i.e. the caller has already
//                 mirrored X to match the world mirror — see scenes.ts:204).
//                 This is the negation of the propagation vector that the
//                 directional light feeds the model shader.
export function buildSkyData(
    id: string,
    fogColor: [number, number, number] | null,
    sunDir: [number, number, number],
): SkySceneData {
    const horizon: [number, number, number] = fogColor !== null
        ? [fogColor[0], fogColor[1], fogColor[2]]
        : defaultSkyForMap(id);

    const softHorizon = deriveHorizon(horizon);
    return {
        color: horizon,
        enableDome: categoryWantsDome(id),
        horizonColor: softHorizon,
        zenithColor: deriveZenith(horizon),
        groundColor: deriveGround(softHorizon),
        sunDir,
    };
}

// ---------------------------------------------------------------------------
// Procedural sky dome renderer.
// ---------------------------------------------------------------------------

// Fullscreen triangle generated from gl_VertexID (no vertex buffer). Each
// fragment computes its world-space view ray by unprojecting the screen NDC
// at z=1 (under noclip's reversed-depth convention this is the NEAR plane;
// any constant depth works for a ray direction since the camera position is
// subtracted off) through the inverse view-projection matrix, then shades the
// sky from that ray as:
//   - a vertical gradient zenith → horizon → ground based on ray.y;
//   - a sun disc + soft halo at dot(ray, sunDir);
//   - a narrow horizon haze band that re-asserts the fog colour near the
//     horizon so distant terrain seams into the dome.
// Depth-test always passes and depth-write is off (`fullscreenMegaState`), so
// the dome paints first inside the main pass and every subsequent draw with
// real depth wins over it where the world is visible.
class SkyDomeProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_WorldFromClip;
    vec4 u_EyePos;        // xyz: camera world position
    vec4 u_HorizonColor;  // rgb
    vec4 u_ZenithColor;   // rgb
    vec4 u_GroundColor;   // rgb
    vec4 u_SunDir;        // xyz: unit, FROM ground TOWARD sun (render frame)
    vec4 u_SunColor;      // rgb
    vec4 u_SunParams;     // x: cos(sunSize), y: halo exponent
};

varying vec3 v_RayDir;
`;

    public override vert = `
void main() {
    // Three-vertex screen-covering triangle (the unused two corners go off
    // the viewport). gl_VertexID = 0 -> (-1,-1), 1 -> (3,-1), 2 -> (-1,3).
    vec2 t_NDC = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                      (gl_VertexID == 2) ? 3.0 : -1.0);
    gl_Position = vec4(t_NDC, 1.0, 1.0);

    // Unproject the screen NDC at z=1 into world space, then subtract the
    // camera position to get a view ray in the world frame. (z=1 is the near
    // plane under noclip's reversed-depth convention; the magnitude does not
    // matter since the camera position is subtracted off.)
    vec4 t_Far = UnpackMatrix(u_WorldFromClip) * vec4(t_NDC, 1.0, 1.0);
    vec3 t_World = t_Far.xyz / t_Far.w;
    v_RayDir = t_World - u_EyePos.xyz;
}
`;

    public override frag = `
void main() {
    vec3 t_Dir = normalize(v_RayDir);

    // "Up" in the render frame is +Y. dot(dir, up) = dir.y in [-1, 1].
    float t_Up = clamp(t_Dir.y, -1.0, 1.0);

    // Vertical gradient: horizon at t_Up = 0, zenith at +1, ground at -1. The
    // exponents (<1) compress the gradient toward the horizon so the
    // colourful band sits where the eye reads it (low in the frame, against
    // the terrain) rather than evenly across the dome.
    vec3 t_Sky;
    if (t_Up >= 0.0) {
        float t_T = pow(t_Up, 0.45);
        t_Sky = mix(u_HorizonColor.rgb, u_ZenithColor.rgb, t_T);
    } else {
        float t_T = pow(-t_Up, 0.6);
        t_Sky = mix(u_HorizonColor.rgb, u_GroundColor.rgb, t_T);
    }

    // Sun disc + halo. dot(rayDir, sunDir) compared against cos(sunSize) for
    // the bright disc (smoothstep edges so it doesn't alias); the halo is a
    // broad exponent-falloff bloom around the sun, masked to the sky half so
    // it doesn't leak below the horizon when the sun is near setting.
    vec3 t_SunDirN = normalize(u_SunDir.xyz);
    float t_CosA = dot(t_Dir, t_SunDirN);
    float t_CosDisc = u_SunParams.x;
    float t_Disc = smoothstep(t_CosDisc - 0.0008, t_CosDisc + 0.0002, t_CosA);
    float t_HaloMask = clamp(t_Up + 0.1, 0.0, 1.0);
    float t_Halo = pow(max(t_CosA, 0.0), u_SunParams.y) * t_HaloMask * 0.6;

    vec3 t_Color = t_Sky + u_SunColor.rgb * (t_Disc + t_Halo);

    // Soft horizon haze: a narrow gaussian band re-asserts the fog/horizon
    // colour right at the horizon line so the terrain fades into the dome
    // instead of meeting it at a hard seam.
    float t_HazeBand = exp(-pow(t_Up * 6.0, 2.0)) * 0.35;
    t_Color = mix(t_Color, u_HorizonColor.rgb, t_HazeBand);

    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}

// Owns the sky-dome pipeline and submits its single draw per frame inside the
// main render pass. The renderer is purely a GPU front-end: no per-frame state
// across calls beyond the cached program.
export class SkyDomeRenderer {
    private program: GfxProgram;
    private scratchInv = mat4.create();

    constructor(cache: GfxRenderHelper["renderCache"]) {
        this.program = cache.createProgram(new SkyDomeProgram());
    }

    // Submit the sky dome draw. Caller is responsible for invoking this BEFORE
    // any opaque scene draws in the same pass so terrain overdraws it where
    // the world is visible. Skips when the map's category disabled the dome.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, eyePos: vec3, sky: SkySceneData): void {
        if (!sky.enableDome)
            return;

        // We need the inverse view-projection for unprojection in the vertex
        // shader. Computed once per frame here (cheap; 4x4 invert) instead of
        // on the GPU.
        mat4.invert(this.scratchInv, clipFromWorld);

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 0 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(null, null, null);
        // BACKGROUND layer: the dome must paint before terrain/props in the
        // main render-inst list, regardless of submission order. fullscreenMegaState
        // = depthCompare:Always + depthWrite:false; pair it with cull-off because
        // gl_VertexID's triangle has no real winding.
        template.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        template.setMegaStateFlags({ ...fullscreenMegaState, cullMode: GfxCullMode.None });

        const renderInst = renderInstManager.newRenderInst();

        // 1 mat4 (16) + 7 vec4 (28) = 44 floats.
        let offs = renderInst.allocateUniformBuffer(SkyDomeProgram.ub_SceneParams, 16 + 7 * 4);
        const mapped = renderInst.mapUniformBufferF32(SkyDomeProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, this.scratchInv);
        offs += fillVec4(mapped, offs, eyePos[0], eyePos[1], eyePos[2], 0);
        offs += fillVec4(mapped, offs, sky.horizonColor[0], sky.horizonColor[1], sky.horizonColor[2], 0);
        offs += fillVec4(mapped, offs, sky.zenithColor[0], sky.zenithColor[1], sky.zenithColor[2], 0);
        offs += fillVec4(mapped, offs, sky.groundColor[0], sky.groundColor[1], sky.groundColor[2], 0);
        offs += fillVec4(mapped, offs, sky.sunDir[0], sky.sunDir[1], sky.sunDir[2], 0);
        offs += fillVec4(mapped, offs, SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2], 0);
        offs += fillVec4(mapped, offs, SUN_DISC_COS, SUN_HALO_EXP, 0, 0);

        renderInst.setDrawCount(3, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }
}
