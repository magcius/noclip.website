
import { Color } from "../Color";
import { DEFAULT_NUM_SAMPLES, IdentityViewportCoords } from "../gfx/helpers/RenderTargetHelpers";
import { GfxAttachment, GfxDevice, GfxFormat, GfxNormalizedViewportCoords, GfxRenderPass, GfxTexture, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
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
    public funcs: SceneGraphFunc[] = [];
    public present: boolean = false;
    public viewport: GfxNormalizedViewportCoords = IdentityViewportCoords;

    constructor(private debugName: string) {
    }
}

interface SceneGraphPassScope {
    getResolveTextureForID(id: number): GfxTexture;
}

type SceneGraphFunc = (renderPass: GfxRenderPass, scope: SceneGraphPassScope) => void;

class SceneGraph {
    public renderTargetRefCounts: number[] = [];
    public renderTargetDescriptions: RenderTargetDescription[] = [];
    public resolveTextureRefCounts: number[] = [];
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
        this.currentGraph!.renderTargetRefCounts[renderTargetID] = 0;
        return renderTargetID;
    }

    public attachRenderTargetID(attachment: RenderTargetAttachmentSlot, renderTargetID: number): void {
        assert(this.currentPass!.renderTargetIDs[attachment] === undefined);
        this.currentPass!.renderTargetIDs[attachment] = renderTargetID;
        this.currentGraph!.renderTargetRefCounts[renderTargetID]++;
    }

    public attachResolveTexture(resolveTextureID: number): void {
        this.currentGraph!.resolveTextureRefCounts[resolveTextureID]++;
        this.currentPass!.resolveTextureInputIDs.push(resolveTextureID);
    }

    private createResolveTextureID(renderTargetID: number): number {
        const resolveTextureID = this.currentGraph!.resolveTextureRenderTargetIDs.push(renderTargetID) - 1;
        this.currentGraph!.resolveTextureRefCounts[resolveTextureID] = 0;
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
        this.currentPass!.funcs.push(func);
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
    private resolveTextureAliveForID: ResolveTexture[] = [];
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

        assert(graph.renderTargetRefCounts[renderTargetID] > 0);

        if (!this.renderTargetAliveForID[renderTargetID]) {
            const desc = graph.renderTargetDescriptions[renderTargetID];
            this.renderTargetAliveForID[renderTargetID] = this.acquireRenderTargetForDescription(device, desc);
        }

        return this.renderTargetAliveForID[renderTargetID];
    }

    private releaseRenderTargetForID(graph: SceneGraph, renderTargetID: number | undefined): void {
        if (renderTargetID === undefined)
            return;

        assert(graph.renderTargetRefCounts[renderTargetID] > 0);

        if (--graph.renderTargetRefCounts[renderTargetID] === 0) {
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

        assert(graph.resolveTextureRefCounts[resolveTextureID] > 0);

        if (!this.resolveTextureAliveForID[resolveTextureID]) {
            const associatedRenderTargetID = assertExists(graph.resolveTextureRenderTargetIDs[resolveTextureID]);
            const desc = assertExists(graph.renderTargetDescriptions[associatedRenderTargetID]);
            this.resolveTextureAliveForID[resolveTextureID] = this.acquireResolveTextureForDescription(device, desc);
        }

        return this.resolveTextureAliveForID[resolveTextureID].texture;
    }

    private releaseResolveTextureForID(graph: SceneGraph, resolveTextureID: number | undefined): void {
        if (resolveTextureID === undefined)
            return;

        assert(graph.resolveTextureRefCounts[resolveTextureID] > 0);

        if (--graph.resolveTextureRefCounts[resolveTextureID] === 0) {
            // This was the last reference to this RT -- steal it from the alive list, and put it back into the pool.
            const resolveTexture = assertExists(this.resolveTextureAliveForID[resolveTextureID]);
            delete this.resolveTextureAliveForID[resolveTextureID];
            this.resolveTextureDeadPool.push(resolveTexture);
        }
    }

    public getResolveTextureForID(resolveTextureID: number): GfxTexture {
        assert(this.currentGraph!.resolveTextureRefCounts[resolveTextureID] > 0);
        assert(this.currentGraphPass!.resolveTextureInputIDs.includes(resolveTextureID));

        return this.resolveTextureAliveForID[resolveTextureID].texture;
    }

    private execPass(device: GfxDevice, graph: SceneGraph, pass: SceneGraphPass, presentColorTexture: GfxTexture | null): void {
        assert(this.currentGraphPass === null);
        this.currentGraphPass = pass;

        const color0RenderTargetID = pass.renderTargetIDs[RenderTargetAttachmentSlot.Color0];
        const depthStencilRenderTargetID = pass.renderTargetIDs[RenderTargetAttachmentSlot.DepthStencil];

        const color0RenderTarget = this.acquireRenderTargetForID(device, graph, color0RenderTargetID);
        const colorAttachment = color0RenderTarget !== null ? color0RenderTarget.attachment : null;
        const colorClearColor = (color0RenderTarget !== null && color0RenderTarget.needsClear) ? graph.renderTargetDescriptions[color0RenderTargetID].colorClearColor : 'load';

        const depthStencilRenderTarget = this.acquireRenderTargetForID(device, graph, depthStencilRenderTargetID);
        const depthStencilAttachment = depthStencilRenderTarget !== null ? depthStencilRenderTarget.attachment : null;
        const depthClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].depthClearValue : 'load';
        const stencilClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].stencilClearValue : 'load';

        const colorResolveTo = pass.present ? presentColorTexture : this.acquireResolveTextureForID(device, graph, pass.resolveTextureOutputIDs[RenderTargetAttachmentSlot.Color0]);
        const depthStencilResolveTo = this.acquireResolveTextureForID(device, graph, pass.resolveTextureOutputIDs[RenderTargetAttachmentSlot.DepthStencil]);

        const renderPass = device.createRenderPass({
            colorAttachment,
            depthStencilAttachment,

            colorClearColor,
            depthClearValue,
            stencilClearValue,

            colorResolveTo,
            depthStencilResolveTo,
        });

        let attachmentWidth = 0, attachmentHeight = 0;

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
            renderPass.setViewport(x, y, w, h);
        }

        for (let i = 0; i < pass.funcs.length; i++)
            pass.funcs[i](renderPass, this);

        device.submitPass(renderPass);

        // Now that we're done with the pass, release our resources back to the pool.
        for (let i = 0; i < pass.renderTargetIDs.length; i++)
            this.releaseRenderTargetForID(graph, pass.renderTargetIDs[i]);
        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++)
            this.releaseResolveTextureForID(graph, pass.resolveTextureInputIDs[i]);

        this.currentGraphPass = null;
    }

    public execGraph(device: GfxDevice, graph: SceneGraph, presentColorTexture: GfxTexture | null = null): void {
        assert(this.currentGraph === null);
        this.currentGraph = graph;

        // Go through and increment the age of everything in our dead pools.
        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].age++;
        for (let i = 0; i < this.resolveTextureDeadPool.length; i++)
            this.resolveTextureDeadPool[i].age++;

        for (let i = 0; i < graph.passes.length; i++)
            this.execPass(device, graph, graph.passes[i], presentColorTexture);

        // Double-check all of our sanity.
        for (let i = 0; i < graph.renderTargetRefCounts.length; i++)
            assert(graph.renderTargetRefCounts[i] === 0);
        for (let i = 0; i < graph.resolveTextureRefCounts.length; i++)
            assert(graph.resolveTextureRefCounts[i] === 0);
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);
        for (let i = 0; i < this.resolveTextureAliveForID.length; i++)
            assert(this.resolveTextureAliveForID[i] === undefined);

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

        this.currentGraph = null;
    }

    public destroy(device: GfxDevice): void {
        // At the time this is called, we shouldn't have anything alive.
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);
        for (let i = 0; i < this.resolveTextureAliveForID.length; i++)
            assert(this.resolveTextureAliveForID[i] === undefined);

        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].destroy(device);
        for (let i = 0; i < this.resolveTextureDeadPool.length; i++)
            this.resolveTextureDeadPool[i].destroy(device);
    }
}
