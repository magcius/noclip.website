
import { GfxDevice, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxProgram, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInstManager, makeSortKeyOpaque, GfxRendererLayer, GfxRenderInst, setSortKeyLayer } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { ModelCache } from "./Scenes_Fez.js";
import { makeTextureFromXNA_Texture2D } from "./Texture.js";
import { DeviceProgram } from "../Program.js";
import { reverseDepthForDepthOffset } from "../gfx/helpers/ReversedDepthHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import { nArray, assert, assertExists } from "../util.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { invlerp, MathConstants } from "../MathHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { Fez_Sky } from "./XNB_Fez.js";
import { XNA_Texture2D } from "./XNB.js";

const backgroundBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 1, numUniformBuffers: 1 },
]

class SkyBackgroundProgram extends DeviceProgram {
    public static ub_Params = 0;

    public override both: string = `
layout(std140) uniform ub_Params {
    vec4 u_ScaleOffset;
    vec4 u_Misc[1];
};

#define u_Alpha (u_Misc[0].x)

uniform sampler2D u_Texture;
`;

    public override vert: string = `
out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;

#if GFX_CLIPSPACE_NEAR_ZERO()
    gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
#endif
}
`;

    public override frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = vec4(color.rgb, u_Alpha);
}
`;
}

export class SkyData {
    public backgroundProgram: GfxProgram;

    public backgroundTexture: GfxTexture;
    public backgroundTextureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    public starsTexture: GfxTexture | null;
    public starsTextureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    public shadowsTexture: GfxTexture | null;
    public shadowsTextureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    public layerTexture: GfxTexture[] = [];

    constructor(modelCache: ModelCache, public name: string, public sky: Fez_Sky) {
        const cache = modelCache.renderCache, device = cache.device;
        this.backgroundProgram = cache.createProgram(new SkyBackgroundProgram());

        const skyPath = `xnb/skies/${this.name}`;
        const getTexture = (path: string | null) => {
            if (path !== null)
                return modelCache.getTexture(`${skyPath}/${path.toLowerCase()}.xnb`);
            return null;
        };

        this.backgroundTexture = assertExists(getTexture(sky.background));
        this.backgroundTextureMapping[0].gfxTexture = this.backgroundTexture;
        this.backgroundTextureMapping[0].gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        this.starsTexture = getTexture(sky.stars);
        this.starsTextureMapping[0].gfxTexture = this.starsTexture;
        this.starsTextureMapping[0].gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        this.shadowsTexture = getTexture(sky.shadows);
        this.shadowsTextureMapping[0].gfxTexture = this.shadowsTexture;
        this.shadowsTextureMapping[0].gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        // for (let i = 0; i < this.sky.layers.length; i++)
        //     this.layerTexture.push(assertExists(getTexture(this.sky.layers[i].name)));
    }

    public static async fetch(modelCache: ModelCache, skyName: string): Promise<SkyData> {
        const skyPath = `xnb/skies/${skyName}`;
        const sky = await modelCache.fetchXNB<Fez_Sky>(`xnb/skies/${skyName}.xnb`);

        let promises: Promise<void>[] = [];
        const requestTexture = (path: string | null) => {
            if (path !== null)
                promises.push(modelCache.requestTexture(`${skyPath}/${path.toLowerCase()}.xnb`));
        };

        requestTexture(sky.background);
        requestTexture(sky.shadows);
        requestTexture(sky.stars);
        // for (let i = 0; i < sky.layers.length; i++)
        //     requestTexture(sky.layers[i].name);
        await Promise.all(promises);

        return new SkyData(modelCache, skyName, sky);
    }

    public destroy(device: GfxDevice): void {
    }
}

export enum DayPhase {
    Night, Dawn, Day, Dusk
}

function getDayPhaseStartTime(phase: DayPhase): number {
    if (phase === DayPhase.Dusk)
        return 18 / 24;
    else if (phase === DayPhase.Day)
        return 5 / 24;
    else if (phase === DayPhase.Dawn)
        return 2 / 24;
    else if (phase === DayPhase.Night)
        return 20 / 24;
    else
        throw "whoops";
}

function getDayPhaseEndTime(phase: DayPhase): number {
    if (phase === DayPhase.Dusk)
        return 22 / 24;
    else if (phase === DayPhase.Day)
        return 20 / 24;
    else if (phase === DayPhase.Dawn)
        return 6 / 24;
    else if (phase === DayPhase.Night)
        return 4 / 24;
    else
        throw "whoops";
}

function ease(t: number): number {
    // Each day phase is divided into three equal parts.
    if (t < 0.0 || t > 1.0)
        return 0;

    if (t < 1/3)
        return t * 3;
    else if (t > 2/3)
        return (1 - t) * 3;
    else
        return 1;
}

function getPhaseContribution(phase: DayPhase, t: number): number {
    assert(t >= 0.0 && t <= 1.0);

    // Get time within phase.
    let startTime = getDayPhaseStartTime(phase);
    let endTime = getDayPhaseEndTime(phase);
    if (endTime < startTime) {
        endTime++;
        if (t < startTime)
            t++;
    }

    return ease(invlerp(startTime, endTime, t));
}

function fillBackgroundParams(renderInst: GfxRenderInst, viewerInput: ViewerRenderInput, scaleS: number = 1, scaleT: number = 1, offsS: number = 0, offsT: number = 0, alpha: number = 1.0): void {
    let offs = renderInst.allocateUniformBuffer(SkyBackgroundProgram.ub_Params, 8);
    const d = renderInst.mapUniformBufferF32(SkyBackgroundProgram.ub_Params);
    const aspect = viewerInput.backbufferWidth / viewerInput.backbufferHeight;
    offs += fillVec4(d, offs, scaleS * aspect, scaleT * aspect, offsS, offsT + 1);
    offs += fillVec4(d, offs, alpha);
}

export class SkyRenderer {
    constructor(private skyData: SkyData) {
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setDrawCount(3);
        template.setVertexInput(null, null, null);
        template.setBindingLayouts(backgroundBindingLayouts);
        template.setGfxProgram(this.skyData.backgroundProgram);

        const dayFraction = ((viewerInput.time / 40000) + 0.5) % 1.0;

        // Sky.
        const renderInst = renderInstManager.newRenderInst();
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND + 0, this.skyData.backgroundProgram.ResourceUniqueId);
        renderInst.setSamplerBindingsFromTextureMappings(this.skyData.backgroundTextureMapping);
        const scaleS = 0.0001;
        const offsS = dayFraction;
        fillBackgroundParams(renderInst, viewerInput, scaleS, 1, offsS, 0);

        if (this.skyData.starsTexture !== null) {
            const starsOpacity = getPhaseContribution(DayPhase.Night, dayFraction);
            if (starsOpacity > 0.0) {
                const renderInst = renderInstManager.newRenderInst();
                renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.BACKGROUND + 1);
                setAttachmentStateSimple(renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
                renderInst.setSamplerBindingsFromTextureMappings(this.skyData.starsTextureMapping);

                const view = viewerInput.camera.viewMatrix;
                const o = (Math.atan2(-view[2], view[0]) / MathConstants.TAU) * 4;

                fillBackgroundParams(renderInst, viewerInput, 0.5, 0.5, o, 0, starsOpacity);
                renderInstManager.submitRenderInst(renderInst);
            }
        }

        /*
        const sky = this.skyData.sky;
        for (let i = 0; i < sky.layers.length; i++) {
            const layer = sky.layers[i];
            const gfxTexture = this.skyData.layerTexture[i];
            const renderInst = renderInstManager.newRenderInst();
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.BACKGROUND + 2 + i);

            setAttachmentStateSimple(renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
            renderInst.setSamplerBindings(0, [{ gfxTexture, gfxSampler: this.skyData.starsTextureMapping[0].gfxSampler, lateBinding: null }]);

            const view = viewerInput.camera.viewMatrix;
            const o = (Math.atan2(-view[2], view[0]) / MathConstants.TAU) * 4;

            fillBackgroundParams(renderInst, viewerInput, 0.5, 0.5, o, 0, layer.opacity);
            renderInstManager.submitRenderInst(renderInst);
            break;
        }
        */

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplate();
    }
}
