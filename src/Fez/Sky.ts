
import { GfxDevice, GfxTexture, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxProgram, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager, makeSortKeyOpaque, GfxRendererLayer, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ModelCache } from "./Scenes_Fez";
import { makeTextureFromImageData } from "./Texture";
import { DeviceProgram } from "../Program";
import { reverseDepthForDepthOffset } from "../gfx/helpers/ReversedDepthHelpers";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { invlerp, MathConstants } from "../MathHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";

const backgroundBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 1, numUniformBuffers: 1 },
]

class SkyBackgroundProgram extends DeviceProgram {
    public static ub_Params = 0;

    public both: string = `
layout(row_major, std140) uniform ub_Params {
    vec4 u_ScaleOffset;
    vec4 u_Misc[1];
};

#define u_Alpha (u_Misc[0].x)

uniform sampler2D u_Texture;
`;

    public vert: string = `
out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;
}
`;

    public frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(u_Texture, v_TexCoord);
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

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, backgroundImage: ImageData, starsImage: ImageData | null, shadowsImage: ImageData | null) {
        this.backgroundProgram = device.createProgram(new SkyBackgroundProgram());

        this.backgroundTexture = makeTextureFromImageData(device, backgroundImage);
        this.backgroundTextureMapping[0].gfxTexture = this.backgroundTexture;
        this.backgroundTextureMapping[0].gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        this.starsTexture = starsImage !== null ? makeTextureFromImageData(device, starsImage) : null;
        this.starsTextureMapping[0].gfxTexture = this.starsTexture;
        this.starsTextureMapping[0].gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        this.shadowsTexture = shadowsImage !== null ? makeTextureFromImageData(device, shadowsImage) : null;
        this.shadowsTextureMapping[0].gfxTexture = this.shadowsTexture;
        this.shadowsTextureMapping[0].gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.backgroundTexture);
        if (this.starsTexture !== null)
            device.destroyTexture(this.starsTexture);
        if (this.shadowsTexture !== null)
            device.destroyTexture(this.shadowsTexture);
    }
}

export const enum DayPhase {
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
        const template = renderInstManager.pushTemplateRenderInst();
        template.drawPrimitives(3);
        template.setInputLayoutAndState(null, null);
        template.setBindingLayouts(backgroundBindingLayouts);
        template.setGfxProgram(this.skyData.backgroundProgram);

        const dayFraction = ((viewerInput.time / 40000) + 0.5) % 1.0;

        // Sky.
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND + 0, this.skyData.backgroundProgram.ResourceUniqueId);
        renderInst.setSamplerBindingsFromTextureMappings(this.skyData.backgroundTextureMapping);
        const scaleS = 0.0001;
        const offsS = dayFraction;
        fillBackgroundParams(renderInst, viewerInput, scaleS, 1, offsS, 0);

        if (this.skyData.starsTexture !== null) {
            const starsOpacity = getPhaseContribution(DayPhase.Night, dayFraction);
            if (starsOpacity > 0.0) {
                const renderInst = renderInstManager.pushRenderInst();
                renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND + 1, this.skyData.backgroundProgram.ResourceUniqueId);
                setAttachmentStateSimple(renderInst.getMegaStateFlags(), { blendMode: GfxBlendMode.ADD, blendSrcFactor: GfxBlendFactor.SRC_ALPHA, blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA });
                renderInst.setSamplerBindingsFromTextureMappings(this.skyData.starsTextureMapping);

                const view = viewerInput.camera.viewMatrix;
                const o = (Math.atan2(-view[2], view[0]) / MathConstants.TAU) * 4;

                fillBackgroundParams(renderInst, viewerInput, 0.5, 0.5, o, 0, starsOpacity);
            }
        }

        renderInstManager.popTemplateRenderInst();
    }
}

export async function fetchSkyData(modelCache: ModelCache, device: GfxDevice, cache: GfxRenderCache, path: string): Promise<SkyData> {
    const skyPath = `skies/${path}`;

    const xml = await modelCache.fetchXML(`skies/${path}.xml`);
    const sky = xml.querySelector('Sky')!;

    const background = sky.getAttribute('background')!.toLowerCase();
    const backgroundImage = await modelCache.fetchPNG(`${skyPath}/${background}.png`);

    const stars = sky.getAttribute('stars');
    const starsImage = stars !== null ? await modelCache.fetchPNG(`${skyPath}/${stars.toLowerCase()}.png`) : null;

    const shadows = sky.getAttribute('shadows');
    const shadowsImage = shadows !== null ? await modelCache.fetchPNG(`${skyPath}/${shadows.toLowerCase()}.png`) : null;

    return new SkyData(device, cache, path, backgroundImage, starsImage, shadowsImage);
}
