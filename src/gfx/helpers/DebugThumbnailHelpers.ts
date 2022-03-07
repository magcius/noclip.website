
import { gfxSamplerBindingNew, nArray, range } from '../platform/GfxPlatformUtil';
import { GfxColor, GfxProgram, GfxRenderPass, GfxSamplerBinding } from '../platform/GfxPlatform';
import { GfxShaderLibrary } from './GfxShaderLibrary';
import { preprocessProgram_GLSL } from '../shaderc/GfxShaderCompiler';
import { fullscreenMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';
import { GfxRenderInstList, GfxRenderInstManager } from '../render/GfxRenderInstManager';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPassScope, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from '../render/GfxRenderGraph';

import { lerp, saturate, smoothstep } from '../../MathHelpers';
import { GfxRenderHelper } from '../render/GfxRenderHelper';
import { GfxRenderDynamicUniformBuffer } from '../render/GfxRenderDynamicUniformBuffer';
import { gfxDeviceNeedsFlipY } from './GfxDeviceHelpers';

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
    drawString(renderInstManager: GfxRenderInstManager, vw: number, vh: number, str: string, x: number, y: number, strokeWidth?: number, strokeNum?: number): void;
}

export class DebugThumbnailDrawer {
    private blitProgram: GfxProgram;
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

        const inputPasses = builderDebug.getPasses();

        // Add our passes.
        const resolveTextureIDs: GfxrResolveTextureID[] = [];
        const renderTargetIDs: GfxrRenderTargetID[] = [];
        const debugLabels: [string, string][] = [];

        for (let i = 0; i < inputPasses.length; i++) {
            const pass = inputPasses[i];
            const debugThumbnails = builderDebug.getPassDebugThumbnails(pass);
            for (let j = 0; j < debugThumbnails.length; j++) {
                if (!debugThumbnails[j])
                    continue;

                // Allocate a resolve texture.
                const resolveTextureID = builder.resolveRenderTargetPassAttachmentSlot(pass, j);
                const renderTargetID = builderDebug.getPassRenderTargetID(pass, j);
                resolveTextureIDs.push(resolveTextureID);
                renderTargetIDs.push(renderTargetID);

                const passDebugName = builderDebug.getPassDebugName(pass);
                const thumbnailDebugName = builderDebug.getRenderTargetIDDebugName(renderTargetID);
                debugLabels.push([passDebugName, thumbnailDebugName]);
            }
        }

        const desc = builder.getRenderTargetDescription(mainColorTargetID);
        const fullscreenRect = { x1: 0, y1: 0, x2: desc.width, y2: desc.height };

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
        renderInst.setGfxProgram(this.blitProgram);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.drawPrimitives(3);

        const y2 = desc.height - this.padding;
        const y1 = y2 - this.thumbnailHeight;

        const prepareAnim = (i: number) => {
            const thumbnailDesc = builder.getRenderTargetDescription(renderTargetIDs[i]);

            const slotIndex = resolveTextureIDs.length - 1 - i;
            const x2 = desc.width - (this.thumbnailWidth + this.padding) * slotIndex - this.padding - 50;
            const x1 = x2 - this.thumbnailWidth;

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
            const thumbnailDebugLabels = debugLabels[i];
            for (let i = 0; i < thumbnailDebugLabels.length; i++) {
                const debugStr = thumbnailDebugLabels[i];
                textDrawer.textColor.a = lerp(0.6, 1.0, t);
                textDrawer.setFontScale(lerp(0.5, 1.0, t));
                const y = lerp(5, 20, t) + textDrawer.getScaledLineHeight() * i;
                textDrawer.drawString(renderInstManager, vw, vh, debugStr, vw / 2, vh - y);
            }

            renderInstManager.popTemplateRenderInst();
            renderInstManager.currentRenderInstList = oldRenderInstList;
            return renderInstList;
        };

        const drawThumbnail = (scope: GfxrPassScope, passRenderer: GfxRenderPass, i: number, textAnimList: GfxRenderInstList | undefined, anim: ReturnType<typeof prepareAnim>) => {
            const gfxTexture = scope.getResolveTextureForID(resolveTextureIDs[i]);
            this.textureMapping[0].gfxTexture = gfxTexture;

            const { location, vx, vy, vw, vh } = anim;
            passRenderer.setViewport(vx, vy, vw, vh);
            passRenderer.setScissor(location.x1, location.y1, location.x2 - location.x1, location.y2 - location.y1);
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
            renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);

            if (textAnimList !== undefined)
                textAnimList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
        };

        for (let i = 0; i < resolveTextureIDs.length; i++)
            if (!this.anim[i])
                this.anim[i] = 0.0;

        const drawOrder = range(0, resolveTextureIDs.length);
        drawOrder.sort((a, b) => (this.anim[a] - this.anim[b]));

        builder.pushPass((pass) => {
            pass.setDebugName('Debug Thumbnails');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            for (let i = 0; i < resolveTextureIDs.length; i++)
                pass.attachResolveTexture(resolveTextureIDs[i]);

            pass.exec((passRenderer, scope) => {
                const anims = resolveTextureIDs.map((tex, i) => prepareAnim(drawOrder[i]));

                let textLists: GfxRenderInstList[] = [];
                if (textDrawer !== null) {
                    textDrawer.beginDraw();
                    textLists = resolveTextureIDs.map((tex, i) => prepareText(textDrawer, drawOrder[i], anims[i]));
                    textDrawer.endDraw(renderInstManager);
                    this.uniformBuffer.prepareToRender();
                }

                resolveTextureIDs.forEach((tex, i) => drawThumbnail(scope, passRenderer, drawOrder[i], textLists[i], anims[i]));
            });
        });
    }

    public destroy(): void {
        this.uniformBuffer.destroy();
    }
}
//#endregion
