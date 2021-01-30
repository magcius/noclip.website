
import { Color } from "../Color";
import { DEFAULT_NUM_SAMPLES, IdentityViewportCoords } from "../gfx/helpers/RenderTargetHelpers";
import { GfxAttachment, GfxDevice, GfxFormat, GfxNormalizedViewportCoords, GfxRenderPass, GfxRenderPassDescriptor, GfxTexture, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import { assert, assertExists } from "../util";

export class RenderTargetDescription {
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    public colorClearColor: Color | 'load' = 'load';
    public depthClearValue: number | 'load' = 'load';
    public stencilClearValue: number | 'load' = 'load';

    constructor(public debugName: string, public pixelFormat: GfxFormat) {
    }

    public setParameters(width: number, height: number, numSamples = DEFAULT_NUM_SAMPLES): void {
        this.width = width;
        this.height = height;
        this.numSamples = numSamples;
    }
}

export const enum RenderTargetAttachmentSlot {
    Color0, DepthStencil,
}

class SceneGraphPass {
    // RenderTargetAttachmentSlot => renderTargetID
    public renderTargetIDs: number[] = [];
    // RenderTargetAttachmentSlot => resolveTextureID
    public resolveTextureOutputIDs: number[] = [];
    // List of resolveTextureIDs that we have a reference to.
    public resolveTextureInputIDs: number[] = [];
    public func: SceneGraphFunc | null = null;
    public present: boolean = false;
    public viewport: GfxNormalizedViewportCoords = IdentityViewportCoords;

    // Execution state stored by the schedule.
    public descriptor: GfxRenderPassDescriptor = {
        colorAttachment: null,
        colorResolveTo: null,
        depthStencilAttachment: null,
        depthStencilResolveTo: null,
        colorClearColor: 'load',
        depthClearValue: 'load',
        stencilClearValue: 'load',
    };

    public viewportX: number = 0;
    public viewportY: number = 0;
    public viewportW: number = 0;
    public viewportH: number = 0;

    constructor(private debugName: string) {
    }
}

interface SceneGraphPassScope {
    getResolveTextureForID(id: number): GfxTexture;
}

type SceneGraphFunc = (renderPass: GfxRenderPass, scope: SceneGraphPassScope) => void;

class SceneGraph {
    // Used for determining scheduling.
    public renderTargetUseCounts: number[] = [];
    public renderTargetDescriptions: RenderTargetDescription[] = [];
    public resolveTextureUseCounts: number[] = [];
    public resolveTextureRenderTargetIDs: number[] = [];

    public passes: SceneGraphPass[] = [];
}

export class SceneGraphBuilder {
    private currentGraph: SceneGraph | null = null;
    private currentPass: SceneGraphPass | null = null;

    public begin() {
        assert(this.currentPass === null);
        this.currentGraph = new SceneGraph();
    }

    public end(): SceneGraph {
        assert(this.currentPass === null);
        const sceneGraph = assertExists(this.currentGraph);
        this.currentGraph = null;
        return sceneGraph;
    }

    public beginPass(debugName: string): void {
        assert(this.currentPass === null);
        this.currentPass = new SceneGraphPass(debugName);
        this.currentGraph!.passes.push(this.currentPass);
    }

    public createRenderTargetID(desc: RenderTargetDescription): number {
        const renderTargetID = this.currentGraph!.renderTargetDescriptions.push(desc) - 1;
        this.currentGraph!.renderTargetUseCounts[renderTargetID] = 0;
        return renderTargetID;
    }

    public attachRenderTargetID(attachment: RenderTargetAttachmentSlot, renderTargetID: number): void {
        assert(this.currentPass!.renderTargetIDs[attachment] === undefined);
        this.currentPass!.renderTargetIDs[attachment] = renderTargetID;
        this.currentGraph!.renderTargetUseCounts[renderTargetID]++;
    }

    public attachResolveTexture(resolveTextureID: number): void {
        this.currentGraph!.resolveTextureUseCounts[resolveTextureID]++;
        this.currentPass!.resolveTextureInputIDs.push(resolveTextureID);
    }

    private createResolveTextureID(renderTargetID: number): number {
        const resolveTextureID = this.currentGraph!.resolveTextureRenderTargetIDs.push(renderTargetID) - 1;
        this.currentGraph!.resolveTextureUseCounts[resolveTextureID] = 0;
        return resolveTextureID;
    }

    private findLastPassForRenderTarget(renderTargetID: number): SceneGraphPass | null {
        for (let i = this.currentGraph!.passes.length - 1; i >= 0; i--) {
            const pass = this.currentGraph!.passes[i];
            if (pass.renderTargetIDs.includes(renderTargetID))
                return pass;
        }

        return null;
    }

    public resolveRenderTargetToColorTexture(renderTargetID: number): number {
        const resolveTextureID = this.createResolveTextureID(renderTargetID);

        // We must be in a pass to resolve.
        const currentPass = assertExists(this.currentPass);

        // The render target we're fetching to resolve must *not* be one we're rendering to.
        assert(!currentPass.renderTargetIDs.includes(renderTargetID));

        // Find the last pass that rendered to this render target, and resolve it now.

        // If you wanted a previous snapshot copy of it, you should have created a separate,
        // intermediate pass to copy that out. Perhaps we should have a helper for this?

        // If there was no pass that wrote to this RT, well there's no point in resolving it, is there?
        const renderPass = assertExists(this.findLastPassForRenderTarget(renderTargetID));

        const attachmentSlot: RenderTargetAttachmentSlot = renderPass.renderTargetIDs.indexOf(renderTargetID);
        renderPass.resolveTextureOutputIDs[attachmentSlot] = resolveTextureID;

        return resolveTextureID;
    }

    public exec(func: SceneGraphFunc): void {
        assert(this.currentPass!.func === null);
        this.currentPass!.func = func;
    }

    public present(): void {
        this.currentPass!.present = true;
    }

    public endPass(): void {
        assert(this.currentPass !== null);
        this.currentPass = null;
    }
}

class ResolveTexture {
    public debugName: string;

    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;
    public readonly numLevels = 1;
    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;

    public texture: GfxTexture;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<RenderTargetDescription>) {
        this.debugName = desc.debugName;

        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;

        this.texture = device.createTexture(this);
    }

    public matchesDescription(desc: Readonly<RenderTargetDescription>): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height;
    }

    public reset(desc: Readonly<RenderTargetDescription>): void {
        assert(this.matchesDescription(desc));
        this.age = 0;
        this.debugName = desc.debugName;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

class RenderTarget {
    public debugName: string;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    public needsClear: boolean = true;
    public attachment: GfxAttachment;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<RenderTargetDescription>) {
        this.debugName = desc.debugName;
        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;
        this.numSamples = desc.numSamples;

        this.attachment = device.createAttachment(this);
    }

    public matchesDescription(desc: Readonly<RenderTargetDescription>): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height && this.numSamples === desc.numSamples;
    }

    public reset(desc: Readonly<RenderTargetDescription>): void {
        assert(this.matchesDescription(desc));
        this.age = 0;
        this.debugName = desc.debugName;
    }

    public destroy(device: GfxDevice): void {
        device.destroyAttachment(this.attachment);
    }
}

export class SceneGraphExecutor {
    private renderTargetAliveForID: RenderTarget[] = [];
    private renderTargetDeadPool: RenderTarget[] = [];
    private resolveTextureForID: ResolveTexture[] = [];
    private resolveTextureDeadPool: ResolveTexture[] = [];

    // For debugging and scope callbacks.
    private currentGraph: SceneGraph | null = null;
    private currentGraphPass: SceneGraphPass | null = null;

    private acquireRenderTargetForDescription(device: GfxDevice, desc: Readonly<RenderTargetDescription>): RenderTarget {
        for (let i = 0; i < this.renderTargetDeadPool.length; i++) {
            const freeRenderTarget = this.renderTargetDeadPool[i];
            if (freeRenderTarget.matchesDescription(desc)) {
                // Pop it off the list.
                freeRenderTarget.age = 0;
                this.renderTargetDeadPool.splice(i--, 1);
                return freeRenderTarget;
            }
        }

        // Allocate a new render target.
        return new RenderTarget(device, desc);
    }

    private acquireRenderTargetForID(device: GfxDevice, graph: SceneGraph, renderTargetID: number | undefined): RenderTarget | null {
        if (renderTargetID === undefined)
            return null;

        assert(graph.renderTargetUseCounts[renderTargetID] > 0);

        if (!this.renderTargetAliveForID[renderTargetID]) {
            const desc = graph.renderTargetDescriptions[renderTargetID];
            this.renderTargetAliveForID[renderTargetID] = this.acquireRenderTargetForDescription(device, desc);
        }

        return this.renderTargetAliveForID[renderTargetID];
    }

    private releaseRenderTargetForID(graph: SceneGraph, renderTargetID: number | undefined): void {
        if (renderTargetID === undefined)
            return;

        assert(graph.renderTargetUseCounts[renderTargetID] > 0);

        if (--graph.renderTargetUseCounts[renderTargetID] === 0) {
            // This was the last reference to this RT -- steal it from the alive list, and put it back into the pool.
            const renderTarget = assertExists(this.renderTargetAliveForID[renderTargetID]);
            renderTarget.needsClear = true;

            delete this.renderTargetAliveForID[renderTargetID];
            this.renderTargetDeadPool.push(renderTarget);
        }
    }

    private acquireResolveTextureForDescription(device: GfxDevice, desc: Readonly<RenderTargetDescription>): ResolveTexture {
        for (let i = 0; i < this.resolveTextureDeadPool.length; i++) {
            const freeResolveTexture = this.resolveTextureDeadPool[i];
            if (freeResolveTexture.matchesDescription(desc)) {
                // Pop it off the list.
                freeResolveTexture.reset(desc);
                this.resolveTextureDeadPool.splice(i--, 1);
                return freeResolveTexture;
            }
        }

        // Allocate a new resolve texture.
        return new ResolveTexture(device, desc);
    }

    private acquireResolveTextureForID(device: GfxDevice, graph: SceneGraph, resolveTextureID: number | undefined): GfxTexture | null {
        if (resolveTextureID === undefined)
            return null;

        assert(graph.resolveTextureUseCounts[resolveTextureID] > 0);

        if (!this.resolveTextureForID[resolveTextureID]) {
            const associatedRenderTargetID = assertExists(graph.resolveTextureRenderTargetIDs[resolveTextureID]);
            const desc = assertExists(graph.renderTargetDescriptions[associatedRenderTargetID]);
            this.resolveTextureForID[resolveTextureID] = this.acquireResolveTextureForDescription(device, desc);
        }

        return this.resolveTextureForID[resolveTextureID].texture;
    }

    private releaseResolveTextureForID(graph: SceneGraph, resolveTextureID: number | undefined): void {
        if (resolveTextureID === undefined)
            return;

        assert(graph.resolveTextureUseCounts[resolveTextureID] > 0);

        if (--graph.resolveTextureUseCounts[resolveTextureID] === 0) {
            // This was the last reference to this resolve texture -- put it back in the dead pool to be reused.
            // Note that we don't remove it from the for-ID pool, because it's still needed in the scope. If
            // we revise this API a bit more, then we can be a bit clearer about this.
            const resolveTexture = assertExists(this.resolveTextureForID[resolveTextureID]);
            this.resolveTextureDeadPool.push(resolveTexture);
        }
    }

    public getResolveTextureForID(resolveTextureID: number): GfxTexture {
        assert(this.currentGraphPass!.resolveTextureInputIDs.includes(resolveTextureID));
        return this.resolveTextureForID[resolveTextureID].texture;
    }

    private execPass(device: GfxDevice, pass: SceneGraphPass): void {
        assert(this.currentGraphPass === null);
        this.currentGraphPass = pass;

        const renderPass = device.createRenderPass(pass.descriptor);

        renderPass.setViewport(pass.viewportX, pass.viewportY, pass.viewportW, pass.viewportH);

        if (pass.func !== null)
            pass.func(renderPass, this);

        device.submitPass(renderPass);
        this.currentGraphPass = null;
    }

    private schedulePass(device: GfxDevice, graph: SceneGraph, pass: SceneGraphPass, presentColorTexture: GfxTexture | null) {
        const color0RenderTargetID = pass.renderTargetIDs[RenderTargetAttachmentSlot.Color0];
        const depthStencilRenderTargetID = pass.renderTargetIDs[RenderTargetAttachmentSlot.DepthStencil];

        const color0RenderTarget = this.acquireRenderTargetForID(device, graph, color0RenderTargetID);
        pass.descriptor.colorAttachment = color0RenderTarget !== null ? color0RenderTarget.attachment : null;
        pass.descriptor.colorClearColor = (color0RenderTarget !== null && color0RenderTarget.needsClear) ? graph.renderTargetDescriptions[color0RenderTargetID].colorClearColor : 'load';

        const depthStencilRenderTarget = this.acquireRenderTargetForID(device, graph, depthStencilRenderTargetID);
        pass.descriptor.depthStencilAttachment = depthStencilRenderTarget !== null ? depthStencilRenderTarget.attachment : null;
        pass.descriptor.depthClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].depthClearValue : 'load';
        pass.descriptor.stencilClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].stencilClearValue : 'load';

        pass.descriptor.colorResolveTo = pass.present ? presentColorTexture : this.acquireResolveTextureForID(device, graph, pass.resolveTextureOutputIDs[RenderTargetAttachmentSlot.Color0]);
        pass.descriptor.depthStencilResolveTo = this.acquireResolveTextureForID(device, graph, pass.resolveTextureOutputIDs[RenderTargetAttachmentSlot.DepthStencil]);

        if (color0RenderTarget !== null)
            color0RenderTarget.needsClear = false;
        if (depthStencilRenderTarget !== null)
            depthStencilRenderTarget.needsClear = false;

        if (color0RenderTarget !== null && depthStencilRenderTarget !== null) {
            // Parameters for all attachments must match.
            assert(color0RenderTarget.width === depthStencilRenderTarget.width);
            assert(color0RenderTarget.height === depthStencilRenderTarget.height);
            assert(color0RenderTarget.numSamples === depthStencilRenderTarget.numSamples);
        }

        let attachmentWidth = 0, attachmentHeight = 0;

        if (color0RenderTarget !== null) {
            attachmentWidth = color0RenderTarget.width;
            attachmentHeight = color0RenderTarget.height;
        } else if (depthStencilRenderTarget !== null) {
            attachmentWidth = depthStencilRenderTarget.width;
            attachmentHeight = depthStencilRenderTarget.height;
        }

        if (attachmentWidth > 0 && attachmentHeight > 0) {
            const x = attachmentWidth * pass.viewport.x;
            const y = attachmentHeight * pass.viewport.y;
            const w = attachmentWidth * pass.viewport.w;
            const h = attachmentHeight * pass.viewport.h;
            pass.viewportX = x;
            pass.viewportY = y;
            pass.viewportW = w;
            pass.viewportH = h;
        }

        // Now that we're done with the pass, release our resources back to the pool.
        for (let i = 0; i < pass.renderTargetIDs.length; i++)
            this.releaseRenderTargetForID(graph, pass.renderTargetIDs[i]);
        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++)
            this.releaseResolveTextureForID(graph, pass.resolveTextureInputIDs[i]);
    }

    private scheduleGraph(device: GfxDevice, graph: SceneGraph, presentColorTexture: GfxTexture | null): void {
        // Go through and increment the age of everything in our dead pools.
        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].age++;
        for (let i = 0; i < this.resolveTextureDeadPool.length; i++)
            this.resolveTextureDeadPool[i].age++;

        for (let i = 0; i < graph.passes.length; i++)
            this.schedulePass(device, graph, graph.passes[i], presentColorTexture);

        // Double-check all of our sanity.
        for (let i = 0; i < graph.renderTargetUseCounts.length; i++)
            assert(graph.renderTargetUseCounts[i] === 0);
        for (let i = 0; i < graph.resolveTextureUseCounts.length; i++)
            assert(graph.resolveTextureUseCounts[i] === 0);
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);

        // Now go through and kill anything that's over our age threshold (hasn't been used in a bit)
        for (let i = 0; i < this.renderTargetDeadPool.length; i++) {
            if (this.renderTargetDeadPool[i].age >= 1) {
                this.renderTargetDeadPool[i].destroy(device);
                this.renderTargetDeadPool.splice(i--, 1);
            }
        }

        for (let i = 0; i < this.resolveTextureDeadPool.length; i++) {
            if (this.resolveTextureDeadPool[i].age >= 1) {
                this.resolveTextureDeadPool[i].destroy(device);
                this.resolveTextureDeadPool.splice(i--, 1);
            }
        }
    }

    public execGraph(device: GfxDevice, graph: SceneGraph, presentColorTexture: GfxTexture | null = null): void {
        // Schedule our graph.
        this.scheduleGraph(device, graph, presentColorTexture);

        assert(this.currentGraph === null);
        this.currentGraph = graph;

        for (let i = 0; i < graph.passes.length; i++)
            this.execPass(device, graph.passes[i]);

        this.currentGraph = null;

        // Clear our transient scope state.
        this.resolveTextureForID.length = 0;
    }

    public destroy(device: GfxDevice): void {
        // At the time this is called, we shouldn't have anything alive.
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);
        for (let i = 0; i < this.resolveTextureForID.length; i++)
            assert(this.resolveTextureForID[i] === undefined);

        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].destroy(device);
        for (let i = 0; i < this.resolveTextureDeadPool.length; i++)
            this.resolveTextureDeadPool[i].destroy(device);
    }
}
