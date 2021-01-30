
import { Color } from "../../Color";
import { DEFAULT_NUM_SAMPLES, IdentityViewportCoords } from "../helpers/RenderTargetHelpers";
import { GfxAttachment, GfxDevice, GfxFormat, GfxNormalizedViewportCoords, GfxRenderPass, GfxRenderPassDescriptor, GfxTexture, GfxTextureDimension } from "../platform/GfxPlatform";
import { assert, assertExists } from "../../util";

export class GfxrRenderTargetDescription {
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    public colorClearColor: Readonly<Color> | 'load' = 'load';
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

export const enum GfxrAttachmentSlot {
    Color0, DepthStencil,
}

export interface GfxrPass {
    setDebugName(debugName: string): void;
    attachRenderTargetID(attachmentSlot: GfxrAttachmentSlot, renderTargetID: number): void;
    attachResolveTexture(resolveTextureID: number): void;
    exec(func: PassExecFunc): void;
    present(): void;
}

class PassImpl implements GfxrPass {
    // Input state used for scheduling.

    // RenderTargetAttachmentSlot => renderTargetID
    public renderTargetIDs: number[] = [];
    // RenderTargetAttachmentSlot => resolveTextureID
    public resolveTextureOutputIDs: number[] = [];
    // List of resolveTextureIDs that we have a reference to.
    public resolveTextureInputIDs: number[] = [];
    public doPresent: boolean = false;
    public viewport: GfxNormalizedViewportCoords = IdentityViewportCoords;

    public resolveTextureInputTextures: GfxTexture[] = [];

    // Execution state computed by scheduling.
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

    // Execution callback from user.
    public func: PassExecFunc | null = null;

    // Misc. state.
    public debugName: string;

    public setDebugName(debugName: string): void {
        this.debugName = debugName;
    }

    public attachRenderTargetID(attachmentSlot: GfxrAttachmentSlot, renderTargetID: number): void {
        assert(this.renderTargetIDs[attachmentSlot] === undefined);
        this.renderTargetIDs[attachmentSlot] = renderTargetID;
    }

    public attachResolveTexture(resolveTextureID: number): void {
        this.resolveTextureInputIDs.push(resolveTextureID);
    }

    public exec(func: PassExecFunc): void {
        assert(this.func === null);
        this.func = func;
    }

    public present(): void {
        this.doPresent = true;
    }
}

export interface GfxrPassScope {
    getResolveTextureForID(id: number): GfxTexture;
}

type PassSetupFunc = (renderPass: GfxrPass) => void;
type PassExecFunc = (passRenderer: GfxRenderPass, scope: GfxrPassScope) => void;

// TODO(jstpierre): These classes might go away...

export interface GfxrGraph {
    // Opaque graph type.
    [Symbol.species]?: 'GfxrGraph';
}

class GraphImpl {
    [Symbol.species]?: 'GfxrGraph';

    // Used for determining scheduling.
    public renderTargetDescriptions: GfxrRenderTargetDescription[] = [];
    public resolveTextureRenderTargetIDs: number[] = [];

    public passes: PassImpl[] = [];
}

export interface GfxrGraphBuilder {
    begin(): void;
    end(): GfxrGraph;
    pushPass(setupFunc: PassSetupFunc): void;
    createRenderTargetID(desc: GfxrRenderTargetDescription): number;
    resolveRenderTargetToColorTexture(renderTargetID: number): number;
}

class GraphBuilderImpl implements GfxrGraphBuilder {
    private currentGraph: GraphImpl | null = null;

    public begin() {
        this.currentGraph = new GraphImpl();
    }

    public end(): GfxrGraph {
        const graph = assertExists(this.currentGraph);
        this.currentGraph = null;
        return graph;
    }

    public pushPass(setupFunc: PassSetupFunc): void {
        const pass = new PassImpl();
        setupFunc(pass);
        this.currentGraph!.passes.push(pass);
    }

    public createRenderTargetID(desc: GfxrRenderTargetDescription): number {
        return this.currentGraph!.renderTargetDescriptions.push(desc) - 1;
    }

    private createResolveTextureID(renderTargetID: number): number {
        return this.currentGraph!.resolveTextureRenderTargetIDs.push(renderTargetID) - 1;
    }

    private findLastPassForRenderTarget(renderTargetID: number): PassImpl | null {
        for (let i = this.currentGraph!.passes.length - 1; i >= 0; i--) {
            const pass = this.currentGraph!.passes[i];
            if (pass.renderTargetIDs.includes(renderTargetID))
                return pass;
        }

        return null;
    }

    public resolveRenderTargetToColorTexture(renderTargetID: number): number {
        const resolveTextureID = this.createResolveTextureID(renderTargetID);

        // Find the last pass that rendered to this render target, and resolve it now.

        // If you wanted a previous snapshot copy of it, you should have created a separate,
        // intermediate pass to copy that out. Perhaps we should have a helper for this?

        // If there was no pass that wrote to this RT, well there's no point in resolving it, is there?
        const renderPass = assertExists(this.findLastPassForRenderTarget(renderTargetID));

        const attachmentSlot: GfxrAttachmentSlot = renderPass.renderTargetIDs.indexOf(renderTargetID);
        renderPass.resolveTextureOutputIDs[attachmentSlot] = resolveTextureID;

        return resolveTextureID;
    }
}

// Whenever we need to resolve a multi-sampled render target to a single-sampled texture,
// we record an extra single-sampled texture here.
class SingleSampledTexture {
    public debugName: string;

    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;
    public readonly numLevels = 1;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;

    public texture: GfxTexture;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>) {
        this.debugName = desc.debugName;

        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;

        this.texture = device.createTexture(this);
    }

    public matchesDescription(desc: Readonly<GfxrRenderTargetDescription>): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height;
    }

    public reset(desc: Readonly<GfxrRenderTargetDescription>): void {
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

    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;
    public readonly numLevels = 1;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    public needsClear: boolean = true;
    public texture: GfxTexture | null = null;
    public attachment: GfxAttachment;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>) {
        this.debugName = desc.debugName;
        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;
        this.numSamples = desc.numSamples;

        assert(this.numSamples >= 1);

        if (this.numSamples > 1) {
            // MSAA render targets must be backed by attachments.
            this.attachment = device.createAttachment(this);
        } else {
            // Single-sampled textures can be backed by regular textures.
            this.texture = device.createTexture(this);
            this.attachment = device.createAttachmentFromTexture(this.texture);
        }
    }

    public matchesDescription(desc: Readonly<GfxrRenderTargetDescription>): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height && this.numSamples === desc.numSamples;
    }

    public reset(desc: Readonly<GfxrRenderTargetDescription>): void {
        assert(this.matchesDescription(desc));
        this.age = 0;
        this.debugName = desc.debugName;
    }

    public destroy(device: GfxDevice): void {
        if (this.texture !== null)
            device.destroyTexture(this.texture);
        device.destroyAttachment(this.attachment);
    }
}

function fillArray<T>(L: T[], n: number, v: T): void {
    L.length = n;
    L.fill(v);
}

export class GfxrRenderGraph {
    // For debugging and scope callbacks.
    private currentGraph: GraphImpl | null = null;
    private currentPass: PassImpl | null = null;

    //#region Resource Creation & Caching
    private renderTargetDeadPool: RenderTarget[] = [];
    private singleSampledTextureDeadPool: SingleSampledTexture[] = [];

    public getGraphBuilder(): GfxrGraphBuilder {
        return new GraphBuilderImpl();
    }

    private acquireRenderTargetForDescription(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>): RenderTarget {
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

    private acquireSingleSampledTextureForDescription(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>): SingleSampledTexture {
        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++) {
            const freeSingleSampledTexture = this.singleSampledTextureDeadPool[i];
            if (freeSingleSampledTexture.matchesDescription(desc)) {
                // Pop it off the list.
                freeSingleSampledTexture.reset(desc);
                this.singleSampledTextureDeadPool.splice(i--, 1);
                return freeSingleSampledTexture;
            }
        }

        // Allocate a new resolve texture.
        return new SingleSampledTexture(device, desc);
    }
    //#endregion

    //#region Scheduling
    private renderTargetUseCount: number[] = [];
    private resolveTextureUseCount: number[] = [];

    private renderTargetAliveForID: RenderTarget[] = [];
    private singleSampledTextureForResolveTextureID: SingleSampledTexture[] = [];

    private scheduleAddUseCount(graph: GraphImpl, pass: PassImpl): void {
        for (let i = 0; i < pass.renderTargetIDs.length; i++) {
            const renderTargetID = pass.renderTargetIDs[i];
            if (renderTargetID === undefined)
                continue;

            this.renderTargetUseCount[renderTargetID]++;
        }

        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++) {
            const resolveTextureID = pass.resolveTextureInputIDs[i];
            if (resolveTextureID === undefined)
                continue;

            this.resolveTextureUseCount[resolveTextureID]++;

            const renderTargetID = graph.resolveTextureRenderTargetIDs[resolveTextureID];
            this.renderTargetUseCount[renderTargetID]++;
        }
    }

    private acquireRenderTargetForID(device: GfxDevice, graph: GraphImpl, renderTargetID: number | undefined): RenderTarget | null {
        if (renderTargetID === undefined)
            return null;

        assert(this.renderTargetUseCount[renderTargetID] > 0);

        if (!this.renderTargetAliveForID[renderTargetID]) {
            const desc = graph.renderTargetDescriptions[renderTargetID];
            this.renderTargetAliveForID[renderTargetID] = this.acquireRenderTargetForDescription(device, desc);
        }

        return this.renderTargetAliveForID[renderTargetID];
    }

    private releaseRenderTargetForID(renderTargetID: number | undefined): RenderTarget | null {
        if (renderTargetID === undefined)
            return null;

        assert(this.renderTargetUseCount[renderTargetID] > 0);

        const renderTarget = assertExists(this.renderTargetAliveForID[renderTargetID]);

        if (--this.renderTargetUseCount[renderTargetID] === 0) {
            // This was the last reference to this RT -- steal it from the alive list, and put it back into the pool.
            renderTarget.needsClear = true;

            delete this.renderTargetAliveForID[renderTargetID];
            this.renderTargetDeadPool.push(renderTarget);
        }

        return renderTarget;
    }

    private acquireResolveTextureOutputForID(device: GfxDevice, graph: GraphImpl, srcRenderTargetID: number, resolveTextureID: number | undefined): GfxTexture | null {
        if (resolveTextureID === undefined)
            return null;

        assert(srcRenderTargetID === graph.resolveTextureRenderTargetIDs[resolveTextureID]);
        assert(this.resolveTextureUseCount[resolveTextureID] > 0);

        const renderTarget = assertExists(this.renderTargetAliveForID[srcRenderTargetID]);

        // No need to resolve -- we're already rendering into a texture-backed RT.
        if (renderTarget.texture !== null)
            return null;

        if (!this.singleSampledTextureForResolveTextureID[resolveTextureID]) {
            const desc = assertExists(graph.renderTargetDescriptions[srcRenderTargetID]);
            this.singleSampledTextureForResolveTextureID[resolveTextureID] = this.acquireSingleSampledTextureForDescription(device, desc);
        }

        return this.singleSampledTextureForResolveTextureID[resolveTextureID].texture;
    }

    private acquireResolveTextureInputTextureForID(graph: GraphImpl, resolveTextureID: number): GfxTexture {
        const renderTargetID = graph.resolveTextureRenderTargetIDs[resolveTextureID];

        assert(this.resolveTextureUseCount[resolveTextureID] > 0);

        let shouldFree = false;
        if (--this.resolveTextureUseCount[resolveTextureID] === 0)
            shouldFree = true;

        const renderTarget = assertExists(this.releaseRenderTargetForID(renderTargetID));

        if (renderTarget.texture === null) {
            // The resolved texture belonging to this RT is backed by our own single-sampled texture.

            const singleSampledTexture = assertExists(this.singleSampledTextureForResolveTextureID[resolveTextureID]);

            if (shouldFree) {
                // Release this single-sampled texture back to the pool, if this is the last use of it.
                this.singleSampledTextureDeadPool.push(singleSampledTexture);
            }

            return singleSampledTexture.texture;
        } else {
            assert(this.singleSampledTextureForResolveTextureID[resolveTextureID] === undefined);

            // The resolved texture belonging to this RT is backed by our render target.
            return assertExists(renderTarget.texture);
        }
    }

    private schedulePass(device: GfxDevice, graph: GraphImpl, pass: PassImpl, presentColorTexture: GfxTexture | null) {
        const color0RenderTargetID = pass.renderTargetIDs[GfxrAttachmentSlot.Color0];
        const depthStencilRenderTargetID = pass.renderTargetIDs[GfxrAttachmentSlot.DepthStencil];

        const color0RenderTarget = this.acquireRenderTargetForID(device, graph, color0RenderTargetID);
        pass.descriptor.colorAttachment = color0RenderTarget !== null ? color0RenderTarget.attachment : null;
        pass.descriptor.colorClearColor = (color0RenderTarget !== null && color0RenderTarget.needsClear) ? graph.renderTargetDescriptions[color0RenderTargetID].colorClearColor : 'load';

        const depthStencilRenderTarget = this.acquireRenderTargetForID(device, graph, depthStencilRenderTargetID);
        pass.descriptor.depthStencilAttachment = depthStencilRenderTarget !== null ? depthStencilRenderTarget.attachment : null;
        pass.descriptor.depthClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].depthClearValue : 'load';
        pass.descriptor.stencilClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].stencilClearValue : 'load';

        pass.descriptor.colorResolveTo = pass.doPresent ? presentColorTexture : this.acquireResolveTextureOutputForID(device, graph, color0RenderTargetID, pass.resolveTextureOutputIDs[GfxrAttachmentSlot.Color0]);
        pass.descriptor.depthStencilResolveTo = this.acquireResolveTextureOutputForID(device, graph, depthStencilRenderTargetID, pass.resolveTextureOutputIDs[GfxrAttachmentSlot.DepthStencil]);

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

        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++) {
            const resolveTextureID = pass.resolveTextureInputIDs[i];
            pass.resolveTextureInputTextures[i] = this.acquireResolveTextureInputTextureForID(graph, resolveTextureID);
        }

        // Now that we're done with the pass, release our render targets back to the pool.
        for (let i = 0; i < pass.renderTargetIDs.length; i++)
            this.releaseRenderTargetForID(pass.renderTargetIDs[i]);
    }

    private scheduleGraph(device: GfxDevice, graph: GraphImpl, presentColorTexture: GfxTexture | null): void {
        assert(this.renderTargetUseCount.length === 0);
        assert(this.resolveTextureUseCount.length === 0);

        // Go through and increment the age of everything in our dead pools to mark that it's old.
        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].age++;
        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++)
            this.singleSampledTextureDeadPool[i].age++;

        // Schedule our resources -- first, count up all uses of resources, then hand them out.

        // Initialize our accumulators.
        fillArray(this.renderTargetUseCount, graph.renderTargetDescriptions.length, 0);
        fillArray(this.resolveTextureUseCount, graph.resolveTextureRenderTargetIDs.length, 0);

        // Count.
        for (let i = 0; i < graph.passes.length; i++)
            this.scheduleAddUseCount(graph, graph.passes[i]);

        // Now hand out resources.
        for (let i = 0; i < graph.passes.length; i++)
            this.schedulePass(device, graph, graph.passes[i], presentColorTexture);

        // Double-check that all resources were handed out.
        for (let i = 0; i < this.renderTargetUseCount.length; i++)
            assert(this.renderTargetUseCount[i] === 0);
        for (let i = 0; i < this.resolveTextureUseCount.length; i++)
            assert(this.resolveTextureUseCount[i] === 0);
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);

        // Now go through and kill anything that's over our age threshold (hasn't been used in a bit)
        const ageThreshold = 1;

        for (let i = 0; i < this.renderTargetDeadPool.length; i++) {
            if (this.renderTargetDeadPool[i].age >= ageThreshold) {
                this.renderTargetDeadPool[i].destroy(device);
                this.renderTargetDeadPool.splice(i--, 1);
            }
        }

        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++) {
            if (this.singleSampledTextureDeadPool[i].age >= ageThreshold) {
                this.singleSampledTextureDeadPool[i].destroy(device);
                this.singleSampledTextureDeadPool.splice(i--, 1);
            }
        }

        // Clear out our transient scheduling state.
        this.renderTargetUseCount.length = 0;
        this.resolveTextureUseCount.length = 0;
    }
    //#endregion

    //#region Execution
    private execPass(device: GfxDevice, pass: PassImpl): void {
        assert(this.currentPass === null);
        this.currentPass = pass;

        const renderPass = device.createRenderPass(pass.descriptor);

        renderPass.setViewport(pass.viewportX, pass.viewportY, pass.viewportW, pass.viewportH);

        if (pass.func !== null)
            pass.func(renderPass, this);

        device.submitPass(renderPass);
        this.currentPass = null;
    }

    public execGraph(device: GfxDevice, graph_: GfxrGraph, presentColorTexture: GfxTexture | null = null): void {
        const graph = graph_ as GraphImpl;

        // Schedule our graph.
        this.scheduleGraph(device, graph, presentColorTexture);

        assert(this.currentGraph === null);
        this.currentGraph = graph;

        for (let i = 0; i < graph.passes.length; i++)
            this.execPass(device, graph.passes[i]);

        this.currentGraph = null;

        // Clear our transient scope state.
        this.singleSampledTextureForResolveTextureID.length = 0;
    }
    //#endregion

    //#region GfxrPassScope
    public getResolveTextureForID(resolveTextureID: number): GfxTexture {
        const currentGraphPass = this.currentPass!;
        const i = currentGraphPass.resolveTextureInputIDs.indexOf(resolveTextureID);
        assert(i >= 0);
        return assertExists(currentGraphPass.resolveTextureInputTextures[i]);
    }
    //#endregion

    public destroy(device: GfxDevice): void {
        // At the time this is called, we shouldn't have anything alive.
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);
        for (let i = 0; i < this.singleSampledTextureForResolveTextureID.length; i++)
            assert(this.singleSampledTextureForResolveTextureID[i] === undefined);

        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].destroy(device);
        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++)
            this.singleSampledTextureDeadPool[i].destroy(device);
    }
}
