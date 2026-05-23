
// Per-map procedural sky dome. RO has no real skybox (CSkyBox is vestigial; its
// textures aren't even in the GRF); the original client paints a flat clear.
// Outdoor maps here draw a gradient dome seeded from the map's fog colour, with
// a sun disc + halo at the RSW lat/long direction. Dungeons/indoors keep the
// flat clear.

import { mat4, vec3 } from "gl-matrix";
import { GfxCullMode, GfxProgram } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { mapCategory } from "./mapcategory.js";

const DEFAULT_OUTDOOR_SKY: [number, number, number] = [0.55, 0.75, 0.92];
const DEFAULT_INDOOR_SKY: [number, number, number] = [0.12, 0.12, 0.14];

const SUN_DISC_COS = Math.cos(0.0105);
const SUN_HALO_EXP = 96.0;
const SUN_COLOR: [number, number, number] = [1.0, 0.95, 0.85];

export interface SkySceneData {
    color: [number, number, number];
    enableDome: boolean;
    horizonColor: [number, number, number];
    zenithColor: [number, number, number];
    groundColor: [number, number, number];
    // Unit vector FROM ground TOWARD sun, pre-mirrored to the render frame.
    sunDir: [number, number, number];
}

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

// RO fog-table colours are an atmospheric tint over geometry, not a sky colour
// — so the zenith is mostly clear blue with only a hint of the map's tint.
function deriveZenith(horizon: [number, number, number]): [number, number, number] {
    const SKY_BLUE: [number, number, number] = [0.30, 0.50, 0.78];
    return lerp3(SKY_BLUE, horizon, 0.15);
}

function deriveGround(horizon: [number, number, number]): [number, number, number] {
    return scale3(horizon, 0.55);
}

function deriveHorizon(horizon: [number, number, number]): [number, number, number] {
    const HAZE: [number, number, number] = [0.78, 0.85, 0.88];
    return lerp3(horizon, HAZE, 0.35);
}

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

// Fullscreen-triangle dome. Each fragment unprojects its NDC at z=1 to a
// world-space view ray and shades a vertical gradient + sun disc/halo + haze
// band. Depth-write off; depth-test always passes (fullscreenMegaState).
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
    // Three-vertex screen-covering triangle. gl_VertexID = 0 -> (-1,-1),
    // 1 -> (3,-1), 2 -> (-1,3).
    vec2 t_NDC = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                      (gl_VertexID == 2) ? 3.0 : -1.0);
    gl_Position = vec4(t_NDC, 1.0, 1.0);

    vec4 t_Far = UnpackMatrix(u_WorldFromClip) * vec4(t_NDC, 1.0, 1.0);
    vec3 t_World = t_Far.xyz / t_Far.w;
    v_RayDir = t_World - u_EyePos.xyz;
}
`;

    public override frag = `
void main() {
    vec3 t_Dir = normalize(v_RayDir);
    float t_Up = clamp(t_Dir.y, -1.0, 1.0);

    // Exponents < 1 compress the gradient toward the horizon.
    vec3 t_Sky;
    if (t_Up >= 0.0) {
        float t_T = pow(t_Up, 0.45);
        t_Sky = mix(u_HorizonColor.rgb, u_ZenithColor.rgb, t_T);
    } else {
        float t_T = pow(-t_Up, 0.6);
        t_Sky = mix(u_HorizonColor.rgb, u_GroundColor.rgb, t_T);
    }

    vec3 t_SunDirN = normalize(u_SunDir.xyz);
    float t_CosA = dot(t_Dir, t_SunDirN);
    float t_CosDisc = u_SunParams.x;
    float t_Disc = smoothstep(t_CosDisc - 0.0008, t_CosDisc + 0.0002, t_CosA);
    // Mask halo to the sky half so it doesn't leak below the horizon at sunset.
    float t_HaloMask = clamp(t_Up + 0.1, 0.0, 1.0);
    float t_Halo = pow(max(t_CosA, 0.0), u_SunParams.y) * t_HaloMask * 0.6;

    vec3 t_Color = t_Sky + u_SunColor.rgb * (t_Disc + t_Halo);

    // Haze band re-asserts the fog colour at the horizon line so terrain
    // fades into the dome instead of meeting it at a hard seam.
    float t_HazeBand = exp(-pow(t_Up * 6.0, 2.0)) * 0.35;
    t_Color = mix(t_Color, u_HorizonColor.rgb, t_HazeBand);

    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}

export class SkyDomeRenderer {
    private program: GfxProgram;
    private scratchInv = mat4.create();

    constructor(cache: GfxRenderHelper["renderCache"]) {
        this.program = cache.createProgram(new SkyDomeProgram());
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, eyePos: vec3, sky: SkySceneData): void {
        if (!sky.enableDome)
            return;

        mat4.invert(this.scratchInv, clipFromWorld);

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 0 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(null, null, null);
        // BACKGROUND layer + fullscreenMegaState so the dome paints before
        // terrain regardless of submission order; cull-off because the
        // gl_VertexID triangle has no real winding.
        template.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        template.setMegaStateFlags({ ...fullscreenMegaState, cullMode: GfxCullMode.None });

        const renderInst = renderInstManager.newRenderInst();

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
