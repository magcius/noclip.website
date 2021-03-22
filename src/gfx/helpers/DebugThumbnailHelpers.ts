
import { gfxSamplerBindingNew, nArray, range } from '../platform/GfxPlatformUtil';
import { GfxProgram, GfxRenderPass, GfxSamplerBinding } from '../platform/GfxPlatform';
import { GfxShaderLibrary } from '../helpers/ShaderHelpers';
import { preprocessProgram_GLSL } from '../shaderc/GfxShaderCompiler';
import { fullscreenMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';
import { GfxRenderInstList, GfxRenderInstManager } from '../render/GfxRenderInstManager';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrPassScope, GfxrRenderTargetDescription } from '../render/GfxRenderGraph';

import { lerp, saturate, smoothstep } from '../../MathHelpers';
import { IS_DEVELOPMENT } from '../../BuildVersion';
import { GfxRenderHelper } from '../render/GfxRenderHelper';

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

export class DebugThumbnailDrawer {
    private blitProgram: GfxProgram;
    private thumbnailLerp: number[] = [];
    private textureMapping: GfxSamplerBinding[] = nArray(1, gfxSamplerBindingNew);

    // Used for text.
    private renderInstList = new GfxRenderInstList(null);

    public enabled = IS_DEVELOPMENT;
    public thumbnailWidth: number = 128;
    public thumbnailHeight: number = 128;
    public padding: number = 32;

    constructor(private helper: GfxRenderHelper) {
        const device = helper.device, cache = helper.renderCache;

        const blitProgram = preprocessProgram_GLSL(device.queryVendorInfo(), GfxShaderLibrary.fullscreenVS, GfxShaderLibrary.fullscreenBlitOneTexPS);
        this.blitProgram = cache.createProgramSimple(device, blitProgram);
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

    private lerpLocation(location: Rect, mouseLocation: MouseLocation | null, i: number, dest: Rect): void {
        const thumbnailContainsMouse = (mouseLocation !== null && rectContainsPoint(location, mouseLocation.mouseX, mouseLocation.mouseY));
        const speed = 0.1 * (thumbnailContainsMouse ? 1 : -1);
        this.thumbnailLerp[i] = saturate(this.thumbnailLerp[i] + speed);
        rectLerp(location, location, dest, smoothstep(this.thumbnailLerp[i]));
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, mouseLocation: MouseLocation | null = null): void {
        const debugTextDrawer = this.helper.getDebugTextDrawer();

        const builderDebug = builder.getDebug();

        const inputPasses = builderDebug.getPasses();

        // Add our passes.
        const resolveTextureIDs: number[] = [];
        const renderTargetIDs: number[] = [];

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

        const drawThumbnail = (scope: GfxrPassScope, passRenderer: GfxRenderPass, i: number) => {
            const thumbnailDesc = builder.getRenderTargetDescription(renderTargetIDs[i]);

            const gfxTexture = scope.getResolveTextureForID(resolveTextureIDs[i]);
            this.textureMapping[0].gfxTexture = gfxTexture;

            const slotIndex = resolveTextureIDs.length - 1 - i;
            const x2 = desc.width - (this.thumbnailWidth + this.padding) * slotIndex - this.padding;
            const x1 = x2 - this.thumbnailWidth;

            const location = { x1, y1, x2, y2 };
            this.lerpLocation(location, mouseLocation, i, fullscreenRect);

            // y-flip will never die!!
            rectFlipY(location, desc.height);

            const viewport = this.computeViewport(thumbnailDesc, location);
            passRenderer.setViewport(viewport.x1, viewport.y1, viewport.x2 - viewport.x1, viewport.y2 - viewport.y1);
            passRenderer.setScissor(location.x1, location.y1, location.x2 - location.x1, location.y2 - location.y1);
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
            renderInst.drawOnPass(renderInstManager.device, renderInstManager.gfxRenderCache, passRenderer);

            const t = this.thumbnailLerp[i];
            if (debugTextDrawer !== null && t > 0.0) {
                const oldRenderInstList = renderInstManager.currentRenderInstList;
                renderInstManager.currentRenderInstList = this.renderInstList;

                debugTextDrawer.textColor.a = t;
                const thumbnailDebugName = builderDebug.getRenderTargetIDDebugName(renderTargetIDs[i]);
                debugTextDrawer.drawString(renderInstManager, desc, thumbnailDebugName, desc.width / 2, 20);
                this.renderInstList.drawOnPassRenderer(renderInstManager.device, renderInstManager.gfxRenderCache, passRenderer);

                renderInstManager.currentRenderInstList = oldRenderInstList;
            }
        };

        for (let i = 0; i < resolveTextureIDs.length; i++)
            if (!this.thumbnailLerp[i])
                this.thumbnailLerp[i] = 0.0;

        const drawOrder = range(0, resolveTextureIDs.length);
        drawOrder.sort((a, b) => (this.thumbnailLerp[a] - this.thumbnailLerp[b]));

        builder.pushPass((pass) => {
            pass.setDebugName('Debug Thumbnails');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            for (let i = 0; i < resolveTextureIDs.length; i++)
                pass.attachResolveTexture(resolveTextureIDs[i]);

            pass.exec((passRenderer, scope) => {
                for (let i = 0; i < resolveTextureIDs.length; i++)
                    drawThumbnail(scope, passRenderer, drawOrder[i]);
            });
        });
    }
}
//#endregion
