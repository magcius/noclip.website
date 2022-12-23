
import { GfxColor, GfxRenderTarget, GfxDevice, GfxFormat, GfxRenderPass, GfxRenderPassDescriptor, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxComputePass } from "../platform/GfxPlatform";
import { GfxQueryPool } from "../platform/GfxPlatformImpl";
import { assert, assertExists } from "../platform/GfxPlatformUtil";

// GfxrRenderGraph is a simple, automatically managed "frame graph".
// The API is slightly in flux for improved ergonomics.
//
// The goal is to make it easier to manage render targets and render passes, and smartly
// save on resources in common cases. It is a replacement for the classes in RenderTargetHelpers.
//
// TODO(jstpierre):
//   - Clean up the algorithm? I think resolveTextureUseCount can be simplified.
//     - Add graph pass "culling" a la Frostbite frame graphs?
//     - Turn resolves into pseudo-passes?
//     - MoveResource?
//
//   - Unify render target / resolve texture ID spaces?
//     - Add more resource types?

export class GfxrRenderTargetDescription {
    public width: number = 0;
    public height: number = 0;
    public numLevels: number = 1;
    public sampleCount: number = 0;

    public colorClearColor: Readonly<GfxColor> | 'load' = 'load';
    public depthClearValue: number | 'load' = 'load';
    public stencilClearValue: number | 'load' = 'load';

    constructor(public pixelFormat: GfxFormat) {
    }

    /**
     * Set the dimensions of a render target description.
     */
    public setDimensions(width: number, height: number, sampleCount: number): void {
        this.width = width;
        this.height = height;
        this.sampleCount = sampleCount;
    }

    public copyDimensions(desc: Readonly<GfxrRenderTargetDescription>): void {
        this.width = desc.width;
        this.height = desc.height;
        this.sampleCount = desc.sampleCount;
    }
}

export const enum GfxrAttachmentSlot {
    Color0 = 0,
    Color1 = 1,
    Color2 = 2,
    Color3 = 3,
    ColorMax = Color3,
    DepthStencil,
}

type PassExecFunc = (passRenderer: GfxRenderPass, scope: GfxrPassScope) => void;
type ComputePassExecFunc = (pass: GfxComputePass, scope: GfxrPassScope) => void;
type PassPostFunc = (scope: GfxrPassScope) => void;

declare const isRenderTargetID: unique symbol;
export type GfxrRenderTargetID = number & { [isRenderTargetID]: true };

declare const isResolveTextureID: unique symbol;
export type GfxrResolveTextureID = number & { [isResolveTextureID]: true };

interface GfxrPassBase {
    /**
     * Set the debug name of a given pass. Strongly encouraged.
     */
     setDebugName(debugName: string): void;

    /**
     * Attach the resolve texture ID to the given pass. All resolve textures used within the pass
     * must be attached before-hand in order for the scheduler to properly allocate our resolve texture.
     */
    attachResolveTexture(resolveTextureID: GfxrResolveTextureID): void;

    /**
     * Set the pass's post callback. This will be immediately right after the pass is submitted,
     * allowing you to do additional custom work once the pass has been done. This is expected to be
     * seldomly used.
     */
    post(func: PassPostFunc): void;

    addExtraRef(renderTargetID: GfxrAttachmentSlot): void;
}

export interface GfxrPass extends GfxrPassBase {
    /**
     * Set the viewport for the given render pass in *normalized* coordinates (0..1).
     * Not required; defaults to full viewport.
     */
    setViewport(x: number, y: number, w: number, h: number): void;

    /**
     * Call when you want to output a debug thumbnail.
     */
    pushDebugThumbnail(attachmentSlot: GfxrAttachmentSlot): void;

    /**
     * Attach the given render target with ID {@param renderTargetID} to the given attachment slot.
     *
     * This determines which render targets this pass will render to.
     */
    attachRenderTargetID(attachmentSlot: GfxrAttachmentSlot, renderTargetID: GfxrRenderTargetID, level?: number): void;

    /**
     * Attach the occlusion query pool used by this rendering pass.
     */
    attachOcclusionQueryPool(queryPool: GfxQueryPool): void;

    /**
     * Set the pass's execution callback. This will be called with the {@see GfxRenderPass} for the
     * pass, along with the {@see GfxrPassScope} to access any resources that the system has allocated.
     */
    exec(func: PassExecFunc): void;
}

export interface GfxrComputePass extends GfxrPassBase {
    /**
     * Set the pass's execution callback. This will be called with the {@see GfxRenderPass} for the
     * pass, along with the {@see GfxrPassScope} to access any resources that the system has allocated.
     */
    exec(func: ComputePassExecFunc): void;
}

class PassImpl implements GfxrPass {
    public debugName: string = '';

    // Input state used for scheduling.

    // GfxrAttachmentSlot => renderTargetID
    public renderTargetIDs: GfxrRenderTargetID[] = [];
    public renderTargetLevels: number[] = [];
    // GfxrAttachmentSlot => resolveTextureID
    public resolveTextureOutputIDs: GfxrResolveTextureID[] = [];
    // GfxrAttachmentSlot => GfxTexture
    public resolveTextureOutputExternalTextures: GfxTexture[] = [];
    public resolveTextureOutputExternalTextureLevel: number[] = [];
    // List of resolveTextureIDs that we have a reference to.
    public resolveTextureInputIDs: GfxrResolveTextureID[] = [];
    // GfxrAttachmentSlot => refcount.
    public renderTargetExtraRefs: boolean[] = [];

    public resolveTextureInputTextures: GfxTexture[] = [];

    public renderTargets: (RenderTarget | null)[] = [];

    // Execution state computed by scheduling.
    public descriptor: GfxRenderPassDescriptor = {
        colorAttachment: [],
        colorAttachmentLevel: [],
        colorResolveTo: [],
        colorResolveToLevel: [],
        colorStore: [],
        depthStencilAttachment: null,
        depthStencilResolveTo: null,
        depthStencilStore: true,
        colorClearColor: ['load'],
        depthClearValue: 'load',
        stencilClearValue: 'load',
        occlusionQueryPool: null,
    };

    public viewportX: number = 0;
    public viewportY: number = 0;
    public viewportW: number = 1;
    public viewportH: number = 1;

    // Execution callback from user.
    public execFunc: PassExecFunc | ComputePassExecFunc | null = null;
    public postFunc: PassPostFunc | null = null;

    // Misc. state.
    public debugThumbnails: boolean[] = [];

    constructor(public passType: 'render' | 'compute') {
    }

    public setDebugName(debugName: string): void {
        this.debugName = debugName;
    }

    public setViewport(x: number, y: number, w: number, h: number): void {
        this.viewportX = x;
        this.viewportY = y;
        this.viewportW = w;
        this.viewportH = h;
    }

    public pushDebugThumbnail(attachmentSlot: GfxrAttachmentSlot): void {
        this.debugThumbnails[attachmentSlot] = true;
    }

    public attachRenderTargetID(attachmentSlot: GfxrAttachmentSlot, renderTargetID: GfxrRenderTargetID, level: number = 0): void {
        assert(this.renderTargetIDs[attachmentSlot] === undefined);
        this.renderTargetIDs[attachmentSlot] = renderTargetID;
        this.renderTargetLevels[attachmentSlot] = level;
    }

    public attachResolveTexture(resolveTextureID: GfxrResolveTextureID): void {
        this.resolveTextureInputIDs.push(resolveTextureID);
    }

    public attachOcclusionQueryPool(queryPool: GfxQueryPool): void {
        this.descriptor.occlusionQueryPool = queryPool;
    }

    public exec(func: any): void {
        assert(this.execFunc === null);
        this.execFunc = func;
    }

    public post(func: PassPostFunc): void {
        assert(this.postFunc === null);
        this.postFunc = func;
    }

    public addExtraRef(slot: GfxrAttachmentSlot): void {
        this.renderTargetExtraRefs[slot] = true;
    }
}

export interface GfxrPassScope {
    /**
     * Retrieve the resolve texture resource for a given resolve texture ID. This is guaranteed to be
     * a single-sampled texture which can be bound to a shader's texture binding.
     *
     * @param id A resolve texture ID, as returned by {@see GfxrGraphBuilder::resolveRenderTarget},
     * {@see GfxrGraphBuilder::resolveRenderTargetPassAttachmentSlot}, or
     * {@see GfxrGraphBuilder::resolveRenderTargetToExternalTexture}.
     */
    getResolveTextureForID(id: number): GfxTexture;

    /**
     * Retrieve the underlying render target resource for a given attachment slot {@param slot}.
     */
    getRenderTargetAttachment(slot: GfxrAttachmentSlot): GfxRenderTarget | null;

    /**
     * Retrieve the underlying texture resource for a given attachment slot {@param slot}. This is not
     * guaranteed to be a single-sampled texture; to resolve the resource, see {@see getResolveTextureForID}.
     */
    getRenderTargetTexture(slot: GfxrAttachmentSlot): GfxTexture | null;
}

// These classes might go away...
class GraphImpl {
    [Symbol.species]?: 'GfxrGraph';

    // Used for determining scheduling.
    public renderTargetDescriptions: Readonly<GfxrRenderTargetDescription>[] = [];
    public resolveTextureRenderTargetIDs: number[] = [];

    public passes: PassImpl[] = [];

    // Debugging.
    public renderTargetDebugNames: string[] = [];
}

type PassSetupFunc = (pass: GfxrPass) => void;
type ComputePassSetupFunc = (pass: GfxrComputePass) => void;

export interface GfxrGraphBuilder {
    /**
     * Add a new pass. {@param setupFunc} will be called *immediately* to set up the
     * pass. This is wrapped in a function simply to limit the scope of a pass. It
     * is possible I might change this in the future to limit the allocations caused
     * by closures.
     */
    pushPass(setupFunc: PassSetupFunc): void;
    pushComputePass(setupFunc: ComputePassSetupFunc): void;

    /**
     * Tell the system about a render target with the given descriptions. Render targets
     * are "virtual", and is only backed by an actual device resource when inside of a pass.
     * This allows render targets to be reused without the user having to track any of this
     * logic.
     *
     * When a pass has a render target ID attached, the created {@see GfxRenderPass} will have
     * the render targets already bound. To use a render target as an input to a rendering
     * algorithm, it must first be "resolved" to a texture. Use {@see resolveRenderTarget} to
     * get a resolved texture ID corresponding to a given render target.
     *
     * To retrieve actual backing resource for a given render target ID inside of a pass,
     * use the {@see GfxrPassScope} given to the pass's execution or post callbacks, however
     * this usage should be rarer than the resolve case.
     */
    createRenderTargetID(desc: Readonly<GfxrRenderTargetDescription>, debugName: string): GfxrRenderTargetID;

    /**
     * Resolve the render target in slot {@param attachmentSlot} of pass {@param pass}, and return
     * the resolve texture ID.
     *
     * To bind the image of a render target in a rendering pass, it first must be "resolved" to
     * a texture. Please remember to attach the resolve texture to a pass where it is used with
     * {@see GfxrPassScope::attachResolveTexture}. When in the pass's execution or post callbacks,
     * you can retrieve a proper {@param GfxTexture} for a resolve texture ID with
     * {@see GfxrPassScope::getResolveTextureForID}}.
     */
    resolveRenderTargetPassAttachmentSlot(pass: GfxrPass, attachmentSlot: GfxrAttachmentSlot): GfxrResolveTextureID;

    /**
     * Resolve the render target ID {@param renderTargetID}, and return the resolve texture ID.
     *
     * To bind the image of a render target in a rendering pass, it first must be "resolved" to
     * a texture. Please remember to attach the resolve texture to a pass where it is used with
     * {@see GfxrPassScope::attachResolveTexture}. When in the pass's execution or post callbacks,
     * you can retrieve a proper {@param GfxTexture} for a resolve texture ID with
     * {@see GfxrPassScope::getResolveTextureForID}}.
     *
     * This just looks up the last pass that drew to the render target {@param renderTargetID},
     * and then calls {@see resolveRenderTargetPassAttachmentSlot} using the information it found.
     */
    resolveRenderTarget(renderTargetID: GfxrRenderTargetID): GfxrResolveTextureID;

    /**
     * Specify that the render target ID {@param renderTargetID} should be resolved to an
     * externally-provided texture. The texture must have been allocated by the user, and it must
     * match the dimensions of the render target.
     *
     * Warning: This API might change in the near future.
     */
    resolveRenderTargetToExternalTexture(renderTargetID: GfxrRenderTargetID, texture: GfxTexture, level?: number): void;

    /**
     * Return the description that a render target was created with. This allows the creator to
     * not have to pass information to any dependent modules to derive from it.
     */
    getRenderTargetDescription(renderTargetID: GfxrRenderTargetID): Readonly<GfxrRenderTargetDescription>;

    /**
     * Internal API.
     */
    getDebug(): GfxrGraphBuilderDebug;
}

export interface GfxrGraphBuilderDebug {
    getPasses(): GfxrPass[];
    getPassDebugThumbnails(pass: GfxrPass): boolean[];
    getPassRenderTargetID(pass: GfxrPass, slot: GfxrAttachmentSlot): GfxrRenderTargetID;
    getRenderTargetIDDebugName(renderTargetID: GfxrRenderTargetID): string;
    getPassDebugName(pass: GfxrPass): string;
}

class RenderTarget {
    public debugName: string = '';

    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;
    public numLevels: number = 1;
    public sampleCount: number = 0;
    public usage: GfxTextureUsage = GfxTextureUsage.RenderTarget;

    public needsClear: boolean = true;
    public texture: GfxTexture | null = null;
    public attachment: GfxRenderTarget;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>) {
        this.pixelFormat = desc.pixelFormat;
        this.width = desc.width;
        this.height = desc.height;
        this.numLevels = desc.numLevels;
        this.sampleCount = desc.sampleCount;

        assert(this.sampleCount >= 1);

        if (this.sampleCount > 1) {
            // MSAA render targets must be backed by attachments.
            this.attachment = device.createRenderTarget(this);
        } else {
            // Single-sampled textures can be backed by regular textures.
            this.texture = device.createTexture(this);

            this.attachment = device.createRenderTargetFromTexture(this.texture);
        }
    }

    public setDebugName(device: GfxDevice, debugName: string): void {
        this.debugName = debugName;
        if (this.texture !== null)
            device.setResourceName(this.texture, this.debugName);
        device.setResourceName(this.attachment, this.debugName);
    }

    public matchesDescription(desc: Readonly<GfxrRenderTargetDescription>): boolean {
        return this.pixelFormat === desc.pixelFormat && this.width === desc.width && this.height === desc.height && this.numLevels === desc.numLevels && this.sampleCount === desc.sampleCount;
    }

    public reset(desc: Readonly<GfxrRenderTargetDescription>): void {
        assert(this.matchesDescription(desc));
        this.age = 0;
    }

    public destroy(device: GfxDevice): void {
        if (this.texture !== null)
            device.destroyTexture(this.texture);
        device.destroyRenderTarget(this.attachment);
    }
}

// Whenever we need to resolve a multi-sampled render target to a single-sampled texture,
// we record an extra single-sampled texture here.
class SingleSampledTexture {
    public readonly dimension = GfxTextureDimension.n2D;
    public readonly depth = 1;
    public readonly numLevels = 1;
    public readonly usage = GfxTextureUsage.RenderTarget;

    public pixelFormat: GfxFormat;
    public width: number = 0;
    public height: number = 0;

    public texture: GfxTexture;
    public age: number = 0;

    constructor(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>) {
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
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

// Public API for saving off copies of images for temporal-style effects.
export class GfxrTemporalTexture {
    // These names might be a bit confusing, but they're named relative to the graph.
    // outputTexture is the target of a resolve, inputTexture is the source for sampling.

    private inputTexture: SingleSampledTexture | null = null;
    private outputTexture: SingleSampledTexture | null = null;

    public setDescription(device: GfxDevice, desc: Readonly<GfxrRenderTargetDescription>): void {
        // Updating the description will happen at the start of the frame,
        // so we need to keep the inputTexture alive (the previous frame's texture),
        // and create a new outputTexture.

        if (this.inputTexture !== this.outputTexture) {
            if (this.inputTexture !== null)
                this.inputTexture.destroy(device);

            // Set the input texture to our old output texture.
            this.inputTexture = this.outputTexture;
        }

        assert(this.inputTexture === this.outputTexture);

        if (this.outputTexture !== null && this.outputTexture.matchesDescription(desc))
            return;

        this.outputTexture = new SingleSampledTexture(device, desc);
        if (this.inputTexture === null)
            this.inputTexture = this.outputTexture;
    }

    public getTextureForSampling(): GfxTexture | null {
        return this.inputTexture !== null ? this.inputTexture.texture : null;
    }

    public getTextureForResolving(): GfxTexture {
        return assertExists(this.outputTexture).texture;
    }

    public destroy(device: GfxDevice): void {
        if (this.outputTexture !== null && this.outputTexture !== this.inputTexture) {
            this.outputTexture.destroy(device);
            this.outputTexture = null;
        }
        if (this.inputTexture !== null) {
            this.inputTexture.destroy(device);
            this.inputTexture = null;
        }
    }
}

function fillArray<T>(L: T[], n: number, v: T): void {
    L.length = n;
    L.fill(v);
}

export interface GfxrRenderGraph {
    newGraphBuilder(): GfxrGraphBuilder;
    execute(builder: GfxrGraphBuilder): void;
    destroy(): void;
}

interface ResolveParam {
    resolveTo: GfxTexture | null;
    store: boolean;
    level: number;
}

export class GfxrRenderGraphImpl implements GfxrRenderGraph, GfxrGraphBuilder, GfxrRenderGraphImpl {
    // For scope callbacks.
    private currentPass: PassImpl | null = null;

    //#region Resource Creation & Caching
    private renderTargetDeadPool: RenderTarget[] = [];
    private singleSampledTextureDeadPool: SingleSampledTexture[] = [];

    constructor(private device: GfxDevice) {
    }

    private acquireRenderTargetForDescription(desc: Readonly<GfxrRenderTargetDescription>): RenderTarget {
        for (let i = 0; i < this.renderTargetDeadPool.length; i++) {
            const freeRenderTarget = this.renderTargetDeadPool[i];
            if (freeRenderTarget.matchesDescription(desc)) {
                // Pop it off the list.
                freeRenderTarget.reset(desc);
                this.renderTargetDeadPool.splice(i--, 1);
                return freeRenderTarget;
            }
        }

        // Allocate a new render target.
        return new RenderTarget(this.device, desc);
    }

    private acquireSingleSampledTextureForDescription(desc: Readonly<GfxrRenderTargetDescription>): SingleSampledTexture {
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
        return new SingleSampledTexture(this.device, desc);
    }
    //#endregion

    //#region Graph Builder
    private currentGraph: GraphImpl | null = null;

    public beginGraphBuilder() {
        assert(this.currentGraph === null);
        this.currentGraph = new GraphImpl();
    }

    public pushPass(setupFunc: PassSetupFunc): void {
        const pass = new PassImpl('render');
        setupFunc(pass);
        this.currentGraph!.passes.push(pass);
    }

    public pushComputePass(setupFunc: ComputePassSetupFunc): void {
        const pass = new PassImpl('compute');
        setupFunc(pass as GfxrComputePass);
        this.currentGraph!.passes.push(pass);
    }

    public createRenderTargetID(desc: Readonly<GfxrRenderTargetDescription>, debugName: string): GfxrRenderTargetID {
        this.currentGraph!.renderTargetDebugNames.push(debugName);
        return (this.currentGraph!.renderTargetDescriptions.push(desc) - 1) as GfxrRenderTargetID;
    }

    private createResolveTextureID(renderTargetID: GfxrRenderTargetID): GfxrResolveTextureID {
        return (this.currentGraph!.resolveTextureRenderTargetIDs.push(renderTargetID) - 1) as GfxrResolveTextureID;
    }

    private findMostRecentPassThatAttachedRenderTarget(renderTargetID: GfxrRenderTargetID): PassImpl | null {
        for (let i = this.currentGraph!.passes.length - 1; i >= 0; i--) {
            const pass = this.currentGraph!.passes[i];
            if (pass.renderTargetIDs.includes(renderTargetID))
                return pass;
        }

        return null;
    }

    private findPassForResolveRenderTarget(renderTargetID: GfxrRenderTargetID): PassImpl {
        // Find the last pass that rendered to this render target, and resolve it now.

        // If you wanted a previous snapshot copy of it, you should have created a separate,
        // intermediate pass to copy that out. Perhaps we should have a helper for that use case?

        // If there was no pass that wrote to this RT, well there's no point in resolving it, is there?
        const renderPass = assertExists(this.findMostRecentPassThatAttachedRenderTarget(renderTargetID));

        // Check which attachment we're in. This could possibly be explicit from the user, but it's
        // easy enough to find...
        const attachmentSlot: GfxrAttachmentSlot = renderPass.renderTargetIDs.indexOf(renderTargetID);

        // Check that the pass isn't resolving its attachment to another texture. Can't do both!
        assert(renderPass.resolveTextureOutputExternalTextures[attachmentSlot] === undefined);

        return renderPass;
    }

    public resolveRenderTargetPassAttachmentSlot(pass: GfxrPass, attachmentSlot: GfxrAttachmentSlot): GfxrResolveTextureID {
        const renderPass = pass as PassImpl;

        if (renderPass.resolveTextureOutputIDs[attachmentSlot] === undefined) {
            const renderTargetID = renderPass.renderTargetIDs[attachmentSlot];
            const resolveTextureID = this.createResolveTextureID(renderTargetID);
            renderPass.resolveTextureOutputIDs[attachmentSlot] = resolveTextureID;
        }

        return renderPass.resolveTextureOutputIDs[attachmentSlot];
    }

    public resolveRenderTarget(renderTargetID: GfxrRenderTargetID): GfxrResolveTextureID {
        const renderPass = this.findPassForResolveRenderTarget(renderTargetID);
        const attachmentSlot: GfxrAttachmentSlot = renderPass.renderTargetIDs.indexOf(renderTargetID);
        return this.resolveRenderTargetPassAttachmentSlot(renderPass, attachmentSlot);
    }

    public resolveRenderTargetToExternalTexture(renderTargetID: GfxrRenderTargetID, texture: GfxTexture, level: number = 0): void {
        const renderPass = this.findPassForResolveRenderTarget(renderTargetID);
        const attachmentSlot: GfxrAttachmentSlot = renderPass.renderTargetIDs.indexOf(renderTargetID);
        // We shouldn't be resolving to a resolve texture ID in this case.
        assert(renderPass.resolveTextureOutputIDs[attachmentSlot] === undefined);
        renderPass.resolveTextureOutputExternalTextures[attachmentSlot] = texture;
        renderPass.resolveTextureOutputExternalTextureLevel[attachmentSlot] = level;
    }

    public getRenderTargetDescription(renderTargetID: number): Readonly<GfxrRenderTargetDescription> {
        return assertExists(this.currentGraph!.renderTargetDescriptions[renderTargetID]);
    }
    //#endregion

    //#region Scheduling
    private renderTargetOutputCount: number[] = [];
    private renderTargetResolveCount: number[] = [];
    private resolveTextureUseCount: number[] = [];

    private renderTargetAliveForID: RenderTarget[] = [];
    private singleSampledTextureForResolveTextureID: SingleSampledTexture[] = [];

    private scheduleAddUseCount(graph: GraphImpl, pass: PassImpl): void {
        for (let slot = 0; slot < pass.renderTargetIDs.length; slot++) {
            const renderTargetID = pass.renderTargetIDs[slot];
            if (renderTargetID === undefined)
                continue;

            this.renderTargetOutputCount[renderTargetID]++;

            if (pass.renderTargetExtraRefs[slot])
                this.renderTargetOutputCount[renderTargetID]++;
        }

        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++) {
            const resolveTextureID = pass.resolveTextureInputIDs[i];
            if (resolveTextureID === undefined)
                continue;

            this.resolveTextureUseCount[resolveTextureID]++;

            const renderTargetID = graph.resolveTextureRenderTargetIDs[resolveTextureID];
            this.renderTargetResolveCount[renderTargetID]++;
        }
    }

    private acquireRenderTargetForID(graph: GraphImpl, renderTargetID: number | undefined): RenderTarget | null {
        if (renderTargetID === undefined)
            return null;

        assert(this.renderTargetOutputCount[renderTargetID] > 0);

        if (!this.renderTargetAliveForID[renderTargetID]) {
            const desc = graph.renderTargetDescriptions[renderTargetID];
            const newRenderTarget = this.acquireRenderTargetForDescription(desc);
            newRenderTarget.setDebugName(this.device, graph.renderTargetDebugNames[renderTargetID]);
            this.renderTargetAliveForID[renderTargetID] = newRenderTarget;
        }

        return this.renderTargetAliveForID[renderTargetID];
    }

    private releaseRenderTargetForID(renderTargetID: number | undefined, forOutput: boolean): RenderTarget | null {
        if (renderTargetID === undefined)
            return null;

        const renderTarget = assertExists(this.renderTargetAliveForID[renderTargetID]);

        if (forOutput) {
            assert(this.renderTargetOutputCount[renderTargetID] > 0);
            this.renderTargetOutputCount[renderTargetID]--;
        } else {
            assert(this.renderTargetResolveCount[renderTargetID] > 0);
            this.renderTargetResolveCount[renderTargetID]--;
        }

        if (this.renderTargetOutputCount[renderTargetID] === 0 && this.renderTargetResolveCount[renderTargetID] === 0) {
            // This was the last reference to this RT -- steal it from the alive list, and put it back into the pool.
            renderTarget.needsClear = true;

            delete this.renderTargetAliveForID[renderTargetID];
            this.renderTargetDeadPool.push(renderTarget);
        }

        return renderTarget;
    }

    private acquireResolveTextureInputTextureForID(graph: GraphImpl, resolveTextureID: number): GfxTexture {
        const renderTargetID = graph.resolveTextureRenderTargetIDs[resolveTextureID];

        assert(this.resolveTextureUseCount[resolveTextureID] > 0);
        this.resolveTextureUseCount[resolveTextureID]--;

        const renderTarget = assertExists(this.releaseRenderTargetForID(renderTargetID, false));

        if (this.singleSampledTextureForResolveTextureID[resolveTextureID] !== undefined) {
            // The resolved texture belonging to this RT is backed by our own single-sampled texture.

            const singleSampledTexture = this.singleSampledTextureForResolveTextureID[resolveTextureID];

            if (this.resolveTextureUseCount[resolveTextureID] === 0) {
                // Release this single-sampled texture back to the pool, if this is the last use of it.
                this.singleSampledTextureDeadPool.push(singleSampledTexture);
            }

            return singleSampledTexture.texture;
        } else {
            // The resolved texture belonging to this RT is backed by our render target.
            return assertExists(renderTarget.texture);
        }
    }

    private determineResolveParam(graph: GraphImpl, pass: PassImpl, slot: GfxrAttachmentSlot): ResolveParam {
        const renderTargetID = pass.renderTargetIDs[slot];
        const resolveTextureOutputID = pass.resolveTextureOutputIDs[slot];
        const externalTexture = pass.resolveTextureOutputExternalTextures[slot];

        // We should have either an output ID or an external texture, not both.
        const hasResolveTextureOutputID = resolveTextureOutputID !== undefined;
        const hasExternalTexture = externalTexture !== undefined;
        assert(!(hasResolveTextureOutputID && hasExternalTexture));

        let resolveTo: GfxTexture | null = null;
        let store = false;
        let level = 0;

        if (this.renderTargetOutputCount[renderTargetID] > 1) {
            // A future pass is going to render to this RT, we need to store the results.
            store = true;
        }

        if (hasResolveTextureOutputID) {
            assert(graph.resolveTextureRenderTargetIDs[resolveTextureOutputID] === renderTargetID);
            assert(this.resolveTextureUseCount[resolveTextureOutputID] > 0);
            assert(this.renderTargetOutputCount[renderTargetID] > 0);

            const renderTarget = assertExists(this.renderTargetAliveForID[renderTargetID]);

            // If we're the last user of this RT, then we don't need to resolve -- the texture itself will be enough.
            // Note that this isn't exactly an exactly correct algorithm. If we have pass A writing to RenderTargetA,
            // pass B resolving RenderTargetA to ResolveTextureA, and pass C writing to RenderTargetA, then we don't
            // strictly need to copy, but in order to determine that at the time of pass A, we'd need a much fancier
            // schedule than just tracking refcounts...
            if (renderTarget.texture !== null && this.renderTargetOutputCount[renderTargetID] === 1) {
                resolveTo = null;
                store = true;
            } else {
                if (!this.singleSampledTextureForResolveTextureID[resolveTextureOutputID]) {
                    const desc = assertExists(graph.renderTargetDescriptions[renderTargetID]);
                    this.singleSampledTextureForResolveTextureID[resolveTextureOutputID] = this.acquireSingleSampledTextureForDescription(desc);
                    this.device.setResourceName(this.singleSampledTextureForResolveTextureID[resolveTextureOutputID].texture, renderTarget.debugName + ` (Resolve ${resolveTextureOutputID})`);
                }

                resolveTo = this.singleSampledTextureForResolveTextureID[resolveTextureOutputID].texture;
            }
        } else if (hasExternalTexture) {
            resolveTo = externalTexture;
            level = pass.resolveTextureOutputExternalTextureLevel[slot];
        } else {
            resolveTo = null;
        }

        return { resolveTo, store, level };
    }

    private schedulePass(graph: GraphImpl, pass: PassImpl) {
        const depthStencilRenderTargetID = pass.renderTargetIDs[GfxrAttachmentSlot.DepthStencil];

        for (let slot = GfxrAttachmentSlot.Color0; slot <= GfxrAttachmentSlot.ColorMax; slot++) {
            const colorRenderTargetID = pass.renderTargetIDs[slot];
            const colorRenderTarget = this.acquireRenderTargetForID(graph, colorRenderTargetID);
            pass.renderTargets[slot] = colorRenderTarget;
            pass.descriptor.colorAttachment[slot] = colorRenderTarget !== null ? colorRenderTarget.attachment : null;
            pass.descriptor.colorAttachmentLevel[slot] = pass.renderTargetLevels[slot];
            const { resolveTo, store, level } = this.determineResolveParam(graph, pass, slot);
            pass.descriptor.colorResolveTo[slot] = resolveTo;
            pass.descriptor.colorResolveToLevel[slot] = level;
            pass.descriptor.colorStore[slot] = store;
            pass.descriptor.colorClearColor[slot] = (colorRenderTarget !== null && colorRenderTarget.needsClear) ? graph.renderTargetDescriptions[colorRenderTargetID].colorClearColor : 'load';
        }

        const depthStencilRenderTarget = this.acquireRenderTargetForID(graph, depthStencilRenderTargetID);
        pass.renderTargets[GfxrAttachmentSlot.DepthStencil] = depthStencilRenderTarget;
        pass.descriptor.depthStencilAttachment = depthStencilRenderTarget !== null ? depthStencilRenderTarget.attachment : null;
        const { resolveTo, store } = this.determineResolveParam(graph, pass, GfxrAttachmentSlot.DepthStencil);
        pass.descriptor.depthStencilResolveTo = resolveTo;
        pass.descriptor.depthStencilStore = store;
        pass.descriptor.depthClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].depthClearValue : 'load';
        pass.descriptor.stencilClearValue = (depthStencilRenderTarget !== null && depthStencilRenderTarget.needsClear) ? graph.renderTargetDescriptions[depthStencilRenderTargetID].stencilClearValue : 'load';

        let rtWidth = 0, rtHeight = 0, rtSampleCount = 0;
        for (let i = 0; i < pass.renderTargets.length; i++) {
            const renderTarget = pass.renderTargets[i];
            if (!renderTarget)
                continue;

            const width = renderTarget.width >>> pass.renderTargetLevels[i];
            const height = renderTarget.height >>> pass.renderTargetLevels[i];

            if (rtWidth === 0) {
                rtWidth = width;
                rtHeight = height;
                rtSampleCount = renderTarget.sampleCount;
            }

            assert(width === rtWidth);
            assert(height === rtHeight);
            assert(renderTarget.sampleCount === rtSampleCount);
            renderTarget.needsClear = false;
        }

        if (rtWidth > 0 && rtHeight > 0) {
            // Convert from normalized to normalized viewport.
            const x = rtWidth  * pass.viewportX;
            const y = rtHeight * pass.viewportY;
            const w = rtWidth  * pass.viewportW;
            const h = rtHeight * pass.viewportH;
            pass.viewportX = x;
            pass.viewportY = y;
            pass.viewportW = w;
            pass.viewportH = h;
        }

        for (let i = 0; i < pass.resolveTextureInputIDs.length; i++) {
            const resolveTextureID = pass.resolveTextureInputIDs[i];
            pass.resolveTextureInputTextures[i] = this.acquireResolveTextureInputTextureForID(graph, resolveTextureID);
        }

        for (let i = 0; i < pass.renderTargetIDs.length; i++)
            this.releaseRenderTargetForID(pass.renderTargetIDs[i], true);

        for (let slot = 0; slot < pass.renderTargetExtraRefs.length; slot++)
            if (pass.renderTargetExtraRefs[slot])
                this.releaseRenderTargetForID(pass.renderTargetIDs[slot], true);
    }

    private scheduleGraph(graph: GraphImpl): void {
        assert(this.renderTargetOutputCount.length === 0);
        assert(this.renderTargetResolveCount.length === 0);
        assert(this.resolveTextureUseCount.length === 0);

        // Go through and increment the age of everything in our dead pools to mark that it's old.
        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].age++;
        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++)
            this.singleSampledTextureDeadPool[i].age++;

        // Schedule our resources -- first, count up all uses of resources, then hand them out.

        // Initialize our accumulators.
        fillArray(this.renderTargetOutputCount, graph.renderTargetDescriptions.length, 0);
        fillArray(this.renderTargetResolveCount, graph.renderTargetDescriptions.length, 0);
        fillArray(this.resolveTextureUseCount, graph.resolveTextureRenderTargetIDs.length, 0);

        // Count.
        for (let i = 0; i < graph.passes.length; i++)
            this.scheduleAddUseCount(graph, graph.passes[i]);

        // Now hand out resources.
        for (let i = 0; i < graph.passes.length; i++)
            this.schedulePass(graph, graph.passes[i]);

        // Double-check that all resources were handed out.
        for (let i = 0; i < this.renderTargetOutputCount.length; i++)
            assert(this.renderTargetOutputCount[i] === 0);
        for (let i = 0; i < this.renderTargetResolveCount.length; i++)
            assert(this.renderTargetResolveCount[i] === 0);
        for (let i = 0; i < this.resolveTextureUseCount.length; i++)
            assert(this.resolveTextureUseCount[i] === 0);
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);

        // Now go through and kill anything that's over our age threshold (hasn't been used in a bit)
        const ageThreshold = 1;

        for (let i = 0; i < this.renderTargetDeadPool.length; i++) {
            if (this.renderTargetDeadPool[i].age >= ageThreshold) {
                this.renderTargetDeadPool[i].destroy(this.device);
                this.renderTargetDeadPool.splice(i--, 1);
            }
        }

        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++) {
            if (this.singleSampledTextureDeadPool[i].age >= ageThreshold) {
                this.singleSampledTextureDeadPool[i].destroy(this.device);
                this.singleSampledTextureDeadPool.splice(i--, 1);
            }
        }

        // Clear out our transient scheduling state.
        this.renderTargetResolveCount.length = 0;
        this.renderTargetOutputCount.length = 0;
        this.resolveTextureUseCount.length = 0;
    }
    //#endregion

    //#region Execution
    private execRenderPass(pass: PassImpl): void {
        const renderPass = this.device.createRenderPass(pass.descriptor);

        renderPass.beginDebugGroup(pass.debugName);

        renderPass.setViewport(pass.viewportX, pass.viewportY, pass.viewportW, pass.viewportH);

        if (pass.execFunc !== null)
            (pass.execFunc as PassExecFunc)(renderPass, this);

        renderPass.endDebugGroup();
        this.device.submitPass(renderPass);

        if (pass.postFunc !== null)
            pass.postFunc(this);
    }

    private execComputePass(pass: PassImpl): void {
        const computePass = this.device.createComputePass();

        computePass.beginDebugGroup(pass.debugName);

        if (pass.execFunc !== null)
            (pass.execFunc as ComputePassExecFunc)(computePass, this);

        computePass.endDebugGroup();
        this.device.submitPass(computePass);

        if (pass.postFunc !== null)
            pass.postFunc(this);
    }

    private execPass(pass: PassImpl): void {
        assert(this.currentPass === null);
        this.currentPass = pass;

        if (pass.passType === 'render')
            this.execRenderPass(pass);
        else if (pass.passType === 'compute')
            this.execComputePass(pass);

        this.currentPass = null;
    }

    private execGraph(graph: GraphImpl): void {
        // Schedule our graph.
        this.scheduleGraph(graph);

        for (let i = 0; i < graph.passes.length; i++)
            this.execPass(graph.passes[i]);

        // Clear our transient scope state.
        this.singleSampledTextureForResolveTextureID.length = 0;
    }

    public execute(builder: GfxrGraphBuilder): void {
        assert(builder === this);
        const graph = assertExists(this.currentGraph);
        this.execGraph(graph);
        this.currentGraph = null;
    }

    public getDebug(): GfxrGraphBuilderDebug {
        return this;
    }
    //#endregion

    //#region GfxrGraphBuilderDebug
    public getPasses(): GfxrPass[] {
        return this.currentGraph!.passes;
    }

    public getPassDebugThumbnails(pass: GfxrPass): boolean[] {
        return (pass as PassImpl).debugThumbnails;
    }

    public getPassRenderTargetID(pass: GfxrPass, slot: GfxrAttachmentSlot): GfxrRenderTargetID {
        return (pass as PassImpl).renderTargetIDs[slot];
    }

    public getRenderTargetIDDebugName(renderTargetID: number): string {
        return this.currentGraph!.renderTargetDebugNames[renderTargetID];
    }

    public getPassDebugName(pass: GfxrPass): string {
        return (pass as PassImpl).debugName;
    }
    //#endregion

    //#region GfxrPassScope
    public getResolveTextureForID(resolveTextureID: GfxrResolveTextureID): GfxTexture {
        const currentGraphPass = this.currentPass!;
        const i = currentGraphPass.resolveTextureInputIDs.indexOf(resolveTextureID);
        assert(i >= 0);
        return assertExists(currentGraphPass.resolveTextureInputTextures[i]);
    }

    public getRenderTargetAttachment(slot: GfxrAttachmentSlot): GfxRenderTarget | null {
        const currentGraphPass = this.currentPass!;
        const renderTarget = currentGraphPass.renderTargets[slot];
        if (!renderTarget)
            return null;
        return renderTarget.attachment;
    }

    public getRenderTargetTexture(slot: GfxrAttachmentSlot): GfxTexture | null {
        const currentGraphPass = this.currentPass!;
        const renderTarget = currentGraphPass.renderTargets[slot];
        if (!renderTarget)
            return null;
        return renderTarget.texture;
    }
    //#endregion

    public newGraphBuilder(): GfxrGraphBuilder {
        this.beginGraphBuilder();
        return this;
    }

    public destroy(): void {
        // At the time this is called, we shouldn't have anything alive.
        for (let i = 0; i < this.renderTargetAliveForID.length; i++)
            assert(this.renderTargetAliveForID[i] === undefined);
        for (let i = 0; i < this.singleSampledTextureForResolveTextureID.length; i++)
            assert(this.singleSampledTextureForResolveTextureID[i] === undefined);

        for (let i = 0; i < this.renderTargetDeadPool.length; i++)
            this.renderTargetDeadPool[i].destroy(this.device);
        for (let i = 0; i < this.singleSampledTextureDeadPool.length; i++)
            this.singleSampledTextureDeadPool[i].destroy(this.device);
    }
}
