
import { Color, colorCopy, OpaqueBlack } from "../Color";
import { ColorTexture, DEFAULT_NUM_SAMPLES, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxAttachment, GfxDevice, GfxFormat, GfxRenderPass, GfxRenderPassDescriptor, GfxSampler, GfxTexture, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { assert, assertExists } from "../util";

const enum RenderTargetId {
    MainColor,
    MainDepth,
    BloomObjects,
    BloomBlur1,
}

class RenderTargetDescription {
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    constructor(public pixelFormat: GfxFormat) {
    }
}

class ResolvedTexture {
    public refCount: number = 0;

    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;
    public readonly numLevels = 1;
    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;

    public texture: GfxTexture;

    constructor(device: GfxDevice, desc: Readonly<RenderTargetDescription>) {
        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;

        this.texture = device.createTexture(this);
    }

    public matchesDescription(desc: RenderTargetDescription): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

class RenderTarget {
    public refCount: number = 0;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    public attachment: GfxAttachment;

    constructor(device: GfxDevice, desc: Readonly<RenderTargetDescription>) {
        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;
        this.numSamples = desc.numSamples;

        this.attachment = device.createAttachment(this);
    }

    public matchesDescription(desc: RenderTargetDescription): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height && this.numSamples === desc.numSamples;
    }

    public destroy(device: GfxDevice): void {
        device.destroyAttachment(this.attachment);
    }
}

class RenderTargetManager {
    public descriptions: RenderTargetDescription[] = [];
    private renderTargetsUsed: (RenderTarget | null)[] = [];
    private renderTargetsFree: RenderTarget[] = [];
    private resolvedTexturesUsed: (ResolvedTexture | null)[] = [];
    private resolvedTexturesFree: ResolvedTexture[] = [];

    constructor() {
        this.registerDescription(RenderTargetId.MainColor, new RenderTargetDescription(GfxFormat.U8_RGBA));
        this.registerDescription(RenderTargetId.MainDepth, new RenderTargetDescription(GfxFormat.D32F_S8));
        this.registerDescription(RenderTargetId.BloomObjects, new RenderTargetDescription(GfxFormat.U8_RGBA_RT));
        this.registerDescription(RenderTargetId.BloomBlur1, new RenderTargetDescription(GfxFormat.U8_RGBA_RT));
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number): void {
        // Clean up any RTs that are not what we currently are (this is ugly... figure out a better way to do this?)
        for (let i = 0; i < this.renderTargetsFree.length; i++) {
            const rt = this.renderTargetsFree[i];
            if (rt.width !== width || rt.height !== height || rt.numSamples !== numSamples) {
                rt.destroy(device);
                this.renderTargetsFree.splice(i--, 1);
            }
        }

        for (let i = 0; i < this.resolvedTexturesFree.length; i++) {
            const rt = this.resolvedTexturesFree[i];
            if (rt.width !== width || rt.height !== height) {
                rt.destroy(device);
                this.resolvedTexturesFree.splice(i--, 1);
            }
        }

        for (let i = 0; i < this.descriptions.length; i++) {
            this.descriptions[i].width = width;
            this.descriptions[i].height = height;
            this.descriptions[i].numSamples = numSamples;
        }
    }

    private getFreeRenderTargetForDescription(device: GfxDevice, desc: Readonly<RenderTargetDescription>): RenderTarget {
        for (let i = 0; i < this.renderTargetsFree.length; i++) {
            const freeRenderTarget = this.renderTargetsFree[i];
            assert(freeRenderTarget.refCount === 0);
            if (freeRenderTarget.matchesDescription(desc)) {
                // Pop it off the list.
                this.renderTargetsFree.splice(i--, 1);
                return freeRenderTarget;
            }
        }

        // Allocate a new render target.
        return new RenderTarget(device, desc);
    }

    public acquireRenderTargetSlot(device: GfxDevice, slot: number): RenderTarget {
        const existingRenderTarget = this.renderTargetsUsed[slot];
        if (existingRenderTarget) {
            assert(existingRenderTarget.refCount >= 1);
            existingRenderTarget.refCount++;
            return existingRenderTarget;
        }

        const desc = this.descriptions[slot];
        const newRenderTarget = this.getFreeRenderTargetForDescription(device, desc);
        assert(newRenderTarget.refCount === 0);
        newRenderTarget.refCount++;
        this.renderTargetsUsed[slot] = newRenderTarget;
        return newRenderTarget;
    }


    public releaseRenderTargetSlot(slot: number): void {
        const existingRenderTarget = assertExists(this.renderTargetsUsed[slot]);
        assert(existingRenderTarget.refCount >= 1);

        if (--existingRenderTarget.refCount <= 1) {
            this.renderTargetsUsed[slot] = null;
            this.renderTargetsFree.push(existingRenderTarget);
        }
    }

    private getFreeResolvedTextureForDescription(device: GfxDevice, desc: Readonly<RenderTargetDescription>): ResolvedTexture {
        for (let i = 0; i < this.resolvedTexturesFree.length; i++) {
            const freeResolvedTexture = this.resolvedTexturesFree[i];
            assert(freeResolvedTexture.refCount === 0);
            if (freeResolvedTexture.matchesDescription(desc)) {
                // Pop it off the list.
                this.resolvedTexturesFree.splice(i--, 1);
                return freeResolvedTexture;
            }
        }

        // Allocate a new resolved texture.
        return new ResolvedTexture(device, desc);
    }

    public acquireResolvedTextureSlot(device: GfxDevice, slot: number): ResolvedTexture {
        const existingResolvedTexture = this.resolvedTexturesUsed[slot];
        if (existingResolvedTexture) {
            assert(existingResolvedTexture.refCount >= 1);
            existingResolvedTexture.refCount++;
            return existingResolvedTexture;
        }

        const desc = this.descriptions[slot];
        const newResolvedTexture = this.getFreeResolvedTextureForDescription(device, desc);
        assert(newResolvedTexture.refCount === 0);
        newResolvedTexture.refCount++;
        this.resolvedTexturesUsed[slot] = newResolvedTexture;
        return newResolvedTexture;
    }

    public releaseResolvedTextureSlot(slot: number): void {
        const existingResolvedTexture = assertExists(this.resolvedTexturesUsed[slot]);
        assert(existingResolvedTexture.refCount >= 1);

        if (--existingResolvedTexture.refCount <= 1) {
            this.resolvedTexturesUsed[slot] = null;
            this.resolvedTexturesFree.push(existingResolvedTexture);
        }
    }

    public registerDescription(slot: number, desc: RenderTargetDescription): void {
        assert(this.descriptions[slot] === undefined);
        this.descriptions[slot] = desc;
    }

    public destroy(device: GfxDevice): void {
        // We shouldn't have any used RTs by the time this is done.
        for (let i = 0; i < this.renderTargetsUsed.length; i++)
            assert(!this.renderTargetsUsed[i]);
        for (let i = 0; i < this.resolvedTexturesUsed.length; i++)
            assert(!this.resolvedTexturesUsed[i]);
        for (let i = 0; i < this.renderTargetsFree.length; i++)
            this.renderTargetsFree[i].destroy(device);
        for (let i = 0; i < this.resolvedTexturesFree.length; i++)
            this.resolvedTexturesFree[i].destroy(device);
    }
}

class SceneGraphPassExecutor {
    private renderTargetManager: RenderTargetManager;
    private renderPassDescriptor: GfxRenderPassDescriptor = makeClearRenderPassDescriptor(OpaqueBlack);
    private currentRenderPass: GfxRenderPass | null = null;

    private currentRenderTargetSlots: number[] = [];
    private currentResolvedTextureSlots: number[] = [];

    constructor(private device: GfxDevice, private renderInstManager: GfxRenderInstManager) {
        this.renderTargetManager = new RenderTargetManager();
    }

    public setParameters(width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.renderTargetManager.setParameters(this.device, width, height, numSamples);
    }

    private acquireRenderTargetAttachment(slot: number | null): GfxAttachment | null {
        if (slot !== null) {
            this.currentRenderTargetSlots.push(slot);
            return this.renderTargetManager.acquireRenderTargetSlot(this.device, slot).attachment;
        } else {
            return null;
        }
    }

    private acquireResolvedTextureTexture(slot: number): GfxTexture {
        this.currentResolvedTextureSlots.push(slot);
        return this.renderTargetManager.acquireResolvedTextureSlot(this.device, slot).texture;
    }

    public beginStage(colorRenderTargetSlot: number | null, depthStencilAttachmentSlot: number | null, renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        renderPassDescriptor.colorAttachment = this.acquireRenderTargetAttachment(colorRenderTargetSlot);
        renderPassDescriptor.depthStencilAttachment = this.acquireRenderTargetAttachment(depthStencilAttachmentSlot);
        return this.device.createRenderPass(renderPassDescriptor);
    }

    private resolveTextureFromRenderTargetSlot(name: string, renderTargetSlot: number, gfxSampler: GfxSampler | null, list: GfxRenderInstList = this.renderInstManager.simpleRenderInstList!): boolean {
        if (list.hasLateSamplerBinding(name)) {
            const gfxTexture = this.acquireResolvedTextureTexture(renderTargetSlot);
            list.resolveLateSamplerBinding(name, { gfxTexture, gfxSampler, lateBinding: null });
            return true;
        } else {
            return false;
        }
    }

    public endStage(): void {
    }

    public destroy(device: GfxDevice): void {
        this.renderTargetManager.destroy(device);
    }
}
