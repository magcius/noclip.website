import { mat4, vec3 } from "gl-matrix";
import { GfxProgram } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { mapCategory } from "./mapcategory.js";

const DEFAULT_OUTDOOR_SKY = vec3.fromValues(0.55, 0.75, 0.92);
const DEFAULT_INDOOR_SKY = vec3.fromValues(0.12, 0.12, 0.14);

const SKY_BLUE = vec3.fromValues(0.30, 0.50, 0.78);
const HAZE = vec3.fromValues(0.78, 0.85, 0.88);

const SUN_DISC_COS = Math.cos(0.0105);
const SUN_HALO_EXP = 96.0;
const SUN_COLOR = vec3.fromValues(1.0, 0.95, 0.85);

export interface SkySceneData {
    color: vec3;
    enableDome: boolean;
    horizonColor: vec3;
    zenithColor: vec3;
    groundColor: vec3;
}

function categoryWantsDome(id: string): boolean {
    const cat = mapCategory(id);
    return cat === "city" || cat === "field" || cat === "other";
}

export function defaultSkyForMap(id: string): vec3 {
    const cat = mapCategory(id);
    if (cat === "dungeon" || cat === "indoor" || cat === "castle")
        return vec3.clone(DEFAULT_INDOOR_SKY);
    return vec3.clone(DEFAULT_OUTDOOR_SKY);
}

function deriveZenith(horizon: vec3): vec3 {
    return vec3.lerp(vec3.create(), SKY_BLUE, horizon, 0.15);
}

function deriveGround(horizon: vec3): vec3 {
    return vec3.scale(vec3.create(), horizon, 0.55);
}

function deriveHorizon(horizon: vec3): vec3 {
    return vec3.lerp(vec3.create(), horizon, HAZE, 0.35);
}

export function buildSkyData(
    id: string,
    fogColor: vec3 | null,
): SkySceneData {
    const horizon: vec3 = fogColor !== null
        ? vec3.clone(fogColor)
        : defaultSkyForMap(id);

    const softHorizon = deriveHorizon(horizon);
    return {
        color: horizon,
        enableDome: categoryWantsDome(id),
        horizonColor: softHorizon,
        zenithColor: deriveZenith(horizon),
        groundColor: deriveGround(softHorizon),
    };
}

class SkyDomeProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {

    Mat4x4 u_WorldFromClip;
    vec4 u_HorizonColor;
    vec4 u_ZenithColor;
    vec4 u_GroundColor;
    vec4 u_SunDir;
    vec4 u_SunColor;
    vec4 u_SunParams;
};

varying vec3 v_RayDir;
`;

    public override vert = `
void main() {

    vec2 t_NDC = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                      (gl_VertexID == 2) ? 3.0 : -1.0);
    gl_Position = vec4(t_NDC, 1.0, 1.0);

    vec4 t_Far = UnpackMatrix(u_WorldFromClip) * vec4(t_NDC, 1.0, 1.0);
    v_RayDir = t_Far.xyz / t_Far.w;
}
`;

    public override frag = `
void main() {
    vec3 t_Dir = normalize(v_RayDir);
    float t_Up = clamp(t_Dir.y, -1.0, 1.0);

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

    float t_HaloMask = clamp(t_Up + 0.1, 0.0, 1.0);
    float t_Halo = pow(max(t_CosA, 0.0), u_SunParams.y) * t_HaloMask * 0.6;

    vec3 t_Color = t_Sky + u_SunColor.rgb * (t_Disc + t_Halo);

    float t_HazeBand = exp(-pow(t_Up * 6.0, 2.0)) * 0.35;
    t_Color = mix(t_Color, u_HorizonColor.rgb, t_HazeBand);

    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}

export class SkyDomeRenderer {
    private program: GfxProgram;
    private scratchClip = mat4.create();
    private scratchInv = mat4.create();

    constructor(cache: GfxRenderHelper["renderCache"]) {
        this.program = cache.createProgram(new SkyDomeProgram());
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, eyePos: vec3, sky: SkySceneData, sunDir: vec3): void {
        if (!sky.enableDome)
            return;

        mat4.translate(this.scratchClip, clipFromWorld, eyePos);
        mat4.invert(this.scratchInv, this.scratchClip);

        const renderInstManager = renderHelper.renderInstManager;
        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 0 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(null, null, null);

        template.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        template.setMegaStateFlags(fullscreenMegaState);

        const renderInst = renderInstManager.newRenderInst();

        let offs = renderInst.allocateUniformBuffer(SkyDomeProgram.ub_SceneParams, 16 + 6 * 4);
        const mapped = renderInst.mapUniformBufferF32(SkyDomeProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, this.scratchInv);
        offs += fillVec4(mapped, offs, sky.horizonColor[0], sky.horizonColor[1], sky.horizonColor[2], 0);
        offs += fillVec4(mapped, offs, sky.zenithColor[0], sky.zenithColor[1], sky.zenithColor[2], 0);
        offs += fillVec4(mapped, offs, sky.groundColor[0], sky.groundColor[1], sky.groundColor[2], 0);
        offs += fillVec4(mapped, offs, sunDir[0], sunDir[1], sunDir[2], 0);
        offs += fillVec4(mapped, offs, SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2], 0);
        offs += fillVec4(mapped, offs, SUN_DISC_COS, SUN_HALO_EXP, 0, 0);

        renderInst.setDrawCount(3, 0);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }
}
