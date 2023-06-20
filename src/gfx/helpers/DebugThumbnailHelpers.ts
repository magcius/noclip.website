
import { gfxSamplerBindingNew, nArray, range } from '../platform/GfxPlatformUtil';
import { GfxColor, GfxMipFilterMode, GfxProgram, GfxRenderPass, GfxRenderPassDescriptor, GfxSampler, GfxSamplerBinding, GfxTexFilterMode, GfxWrapMode } from '../platform/GfxPlatform';
import { GfxShaderLibrary } from './GfxShaderLibrary';
import { preprocessProgram_GLSL } from '../shaderc/GfxShaderCompiler';
import { fullscreenMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';
import { GfxRenderInstList, GfxRenderInstManager } from '../render/GfxRenderInstManager';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPassScope, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from '../render/GfxRenderGraph';

import { lerp, saturate, smoothstep } from '../../MathHelpers';
import { GfxRenderHelper } from '../render/GfxRenderHelper';
import { GfxRenderDynamicUniformBuffer } from '../render/GfxRenderDynamicUniformBuffer';
import { gfxDeviceNeedsFlipY } from './GfxDeviceHelpers';
import { FormatFlags } from '../platform/GfxPlatformFormat';
import { getFormatFlags } from '../platform/GfxPlatformFormat';

interface MouseLocation {
    mouseX: number;
    mouseY: number;
}

type Rect = { x1: number, y1: number, x2: number, y2: number };

function rectContainsPoint(r: Rect, x: number, y: number): boolean {
    const { x1, y1, x2, y2 } = r;
    return x >= x1 && x < x2 && y >= y1 && y < y2;
}

function rectLerp(dst: Rect, r1: Rect, r2: Rect, t: number): void {
    dst.x1 = lerp(r1.x1, r2.x1, t);
    dst.y1 = lerp(r1.y1, r2.y1, t);
    dst.x2 = lerp(r1.x2, r2.x2, t);
    dst.y2 = lerp(r1.y2, r2.y2, t);
}

function rectFlipY(r: Rect, h: number): void {
    const y1 = r.y1;
    r.y1 = h - r.y2;
    r.y2 = h - y1;
}

export interface TextDrawer {
    textColor: GfxColor;
    setFontScale(v: number): void;
    getScaledLineHeight(): number;
    beginDraw(): void;
    endDraw(renderInstManager: GfxRenderInstManager): void;
    reserveString(numChars: number, strokeNum?: number): void;
    drawString(renderInstManager: GfxRenderInstManager, vw: number, vh: number, str: string, x: number, y: number, strokeWidth?: number, strokeNum?: number): void;
}

export class DebugThumbnailDrawer {
    private blitProgram: GfxProgram;
    private blitProgramSRGB: GfxProgram;
    private anim: number[] = [];
    private textureMapping: GfxSamplerBinding[] = nArray(1, gfxSamplerBindingNew);

    // Used for text.
    private uniformBuffer: GfxRenderDynamicUniformBuffer;

    public enabled = false;
    public thumbnailWidth: number = 128;
    public thumbnailHeight: number = 128;
    public padding: number = 32;

    constructor(private helper: GfxRenderHelper) {
        const device = helper.device, cache = helper.renderCache;

        const blitProgram = preprocessProgram_GLSL(device.queryVendorInfo(), GfxShaderLibrary.fullscreenVS, GfxShaderLibrary.fullscreenBlitOneTexPS);
        this.blitProgram = cache.createProgramSimple(blitProgram);

        const blitProgramSRGB = preprocessProgram_GLSL(device.queryVendorInfo(), GfxShaderLibrary.fullscreenVS, `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));
}
`);
        this.blitProgramSRGB = cache.createProgramSimple(blitProgramSRGB);

        this.textureMapping[0].gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });

        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    private computeViewport(desc: GfxrRenderTargetDescription, location: Rect): Rect {
        const thumbAspect = desc.width / desc.height;
        const slotWidth = location.x2 - location.x1;
        const slotHeight = location.y2 - location.y1;
        const slotAspect = slotWidth / slotHeight;
        const aspect = (thumbAspect / slotAspect);

        const w = slotWidth * aspect;
        const x1 = location.x1 - (w - slotWidth) * 0.5;
        const x2 = location.x2 + (w - slotWidth) * 0.5;
        const y1 = location.y1;
        const y2 = location.y2;
        return { x1, x2, y1, y2 };
    }

    private adjustAnim(i: number, location: Rect, mouseLocation: MouseLocation): number {
        const thumbnailContainsMouse = rectContainsPoint(location, mouseLocation.mouseX, mouseLocation.mouseY);
        const speed = 0.05 * (thumbnailContainsMouse ? 1 : -1);
        this.anim[i] = saturate(this.anim[i] + speed);
        return smoothstep(this.anim[i]);
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mouseLocation: MouseLocation): void {
        if (!this.enabled)
            return;

        const textDrawer = this.helper.getDebugTextDrawer() as TextDrawer | null;

        const builderDebug = builder.getDebug();
        const debugThumbnails = builderDebug.getDebugThumbnails();

        if (debugThumbnails.length === 0)
            return;

        // Add our passes.
        const resolveTextureIDs: GfxrResolveTextureID[] = [];

        for (let i = 0; i < debugThumbnails.length; i++)
            resolveTextureIDs.push(builder.resolveRenderTargetPassAttachmentSlot(debugThumbnails[i].pass, debugThumbnails[i].attachmentSlot));

        const desc = builder.getRenderTargetDescription(mainColorTargetID);

        const fullscreenRect = { x1: 0, y1: 0, x2: desc.width, y2: desc.height };

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.drawPrimitives(3);

        const thumbnailWidth = this.thumbnailWidth * window.devicePixelRatio;
        const thumbnailHeight = this.thumbnailHeight * window.devicePixelRatio;

        const y2 = desc.height - this.padding;
        const y1 = y2 - thumbnailHeight;

        const prepareAnim = (i: number) => {
            const thumbnailDesc = builder.getRenderTargetDescription(debugThumbnails[i].renderTargetID);

            const slotIndex = debugThumbnails.length - 1 - i;
            const x2 = desc.width - (thumbnailWidth + this.padding) * slotIndex - this.padding;
            const x1 = x2 - thumbnailWidth;

            const location = { x1, y1, x2, y2 };
            const t = this.adjustAnim(i, location, mouseLocation);
            rectLerp(location, location, fullscreenRect, t);

            // y-flip will never die!!
            if (gfxDeviceNeedsFlipY(renderInstManager.gfxRenderCache.device))
                rectFlipY(location, desc.height);

            const viewport = this.computeViewport(thumbnailDesc, location);
            const vx = Math.max(0, Math.ceil(viewport.x1)), vy = Math.max(0, Math.ceil(viewport.y1));
            const vw = Math.min(desc.width, Math.floor(viewport.x2 - viewport.x1)), vh = Math.min(desc.height, Math.floor(viewport.y2 - viewport.y1));
            return { t, location, vx, vy, vw, vh };
        };

        const prepareText = (textDrawer: TextDrawer, i: number, anim: ReturnType<typeof prepareAnim>) => {
            const renderInstList = new GfxRenderInstList(null);

            const oldRenderInstList = renderInstManager.currentRenderInstList;
            renderInstManager.currentRenderInstList = renderInstList;

            const template = renderInstManager.pushTemplateRenderInst();
            template.setUniformBuffer(this.uniformBuffer);

            const { t, vw, vh } = anim;
            const thumbnailDebugLabels = debugThumbnails[i].debugLabel.split('\n');
            for (let i = 0; i < thumbnailDebugLabels.length; i++) {
                textDrawer.textColor.a = lerp(0.6, 1.0, t);
                textDrawer.setFontScale(lerp(0.5, 1.0, t));
                const y = lerp(5, 20, t) + textDrawer.getScaledLineHeight() * i;
                textDrawer.drawString(renderInstManager, vw, vh, thumbnailDebugLabels[i], vw / 2, vh - y);
            }

            renderInstManager.popTemplateRenderInst();
            renderInstManager.currentRenderInstList = oldRenderInstList;
            return renderInstList;
        };

        const calcBlitProgram = (desc: GfxrRenderTargetDescription) => {
            const formatFlags = getFormatFlags(desc.pixelFormat);
            if (!!(formatFlags & FormatFlags.sRGB))
                return this.blitProgramSRGB;
            else
                return this.blitProgram;
        };

        const drawThumbnail = (scope: GfxrPassScope, passRenderer: GfxRenderPass, i: number, textAnimList: GfxRenderInstList | undefined, anim: ReturnType<typeof prepareAnim>) => {
            const gfxTexture = scope.getResolveTextureForID(resolveTextureIDs[i]);
            this.textureMapping[0].gfxTexture = gfxTexture;

            const { location, vx, vy, vw, vh } = anim;
            passRenderer.setViewport(vx, vy, vw, vh);
            passRenderer.setScissor(location.x1, location.y1, location.x2 - location.x1, location.y2 - location.y1);

            const desc = builder.getRenderTargetDescription(debugThumbnails[i].renderTargetID);
            renderInst.setGfxProgram(calcBlitProgram(desc));

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
            renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);

            if (textAnimList !== undefined)
                textAnimList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
        };

        for (let i = 0; i < debugThumbnails.length; i++)
            if (!this.anim[i])
                this.anim[i] = 0.0;

        const drawOrder = range(0, debugThumbnails.length);
        drawOrder.sort((a, b) => (this.anim[a] - this.anim[b]));

        builder.pushPass((pass) => {
            pass.setDebugName('Debug Thumbnails');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            for (let i = 0; i < debugThumbnails.length; i++)
                pass.attachResolveTexture(resolveTextureIDs[i]);

            pass.exec((passRenderer, scope) => {
                const anims = debugThumbnails.map((tex, i) => prepareAnim(drawOrder[i]));

                let textLists: GfxRenderInstList[] = [];
                if (textDrawer !== null) {
                    textDrawer.beginDraw();

                    const totalNumChar = debugThumbnails.map((tex) => tex.debugLabel.length).reduce((a, b) => a + b);
                    textDrawer.reserveString(totalNumChar);

                    textLists = debugThumbnails.map((tex, i) => prepareText(textDrawer, drawOrder[i], anims[i]));
                    textDrawer.endDraw(renderInstManager);
                    this.uniformBuffer.prepareToRender();
                }

                debugThumbnails.forEach((tex, i) => drawThumbnail(scope, passRenderer, drawOrder[i], textLists[i], anims[i]));
            });
        });
    }

    public destroy(): void {
        this.uniformBuffer.destroy();
    }
}
//#endregion
