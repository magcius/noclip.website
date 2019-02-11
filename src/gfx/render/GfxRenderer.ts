
import { GfxInputState, GfxRenderPass, GfxBindings, GfxRenderPipeline, GfxDevice, GfxSamplerBinding, GfxBindingLayoutDescriptor, GfxBufferBinding, GfxProgram, GfxPrimitiveTopology, GfxSampler, GfxBindingsDescriptor, GfxMegaStateDescriptor } from "../platform/GfxPlatform";
import { align, assertExists, assert } from "../../util";
import { GfxRenderBuffer } from "./GfxRenderBuffer";
import { TextureMapping } from "../../TextureHolder";
import { DeviceProgramReflection, DeviceProgram } from "../../Program";
import { GfxRenderCache } from "./GfxRenderCache";
import { setMegaStateFlags, copyMegaState, defaultMegaState } from "../helpers/GfxMegaStateDescriptorHelpers";

// The "Render" subsystem is a high-level scene graph, built on top of gfx/platform and gfx/helpers.
// A rough overview of the design:
//
// A GfxRenderInst is basically equivalent to one draw call, and should be retained with the correct scene
// graph object that has the power to update and rebind it every frame. GfxRenderer is designed for as little
// per-frame GC garbage and pressure as possible, so this object should be retained in client code.
//
// Currently, GfxRenderInst is pretty expensive in terms of GC pressure. A future goal should be able to
// remove as much as the bookkeeping and state on GfxRenderInst as possible, or compress the fields into a
// cheaper form.
//
// GfxRenderInstBuilder is a way to create many GfxRenderInsts at once. It is not required to use, but is
// very helpful and convenient for setting up the correct fields. It works best when the scene can be built
// in one giant chunk. For cases where different parts of the scene are loaded at different times, it's a bit
// clunky and doesn't cache the correct GfxBindings values. A planned future change is to change this so that
// it can better support building a scene a piece at a time.
//
// GfxRenderInstViewRenderer is in charge of wrangling all of the GfxRenderInsts, sorting them, and then
// executing the draws on the platform layer.

// Suggested values for the "layer" of makeSortKey. These are rough groups, and you can define your own
// ordering within the rough groups (e.g. you might use BACKGROUND + 1, or BACKGROUND + 2).
// TRANSLUCENT is meant to be used as a bitflag. It's special as it changes the behavior of the generic sort key
// functions like makeSortKey and setSortKeyDepth.
export const enum GfxRendererLayer {
    BACKGROUND  = 0x00,
    ALPHA_TEST  = 0x10,
    OPAQUE      = 0x20,
    TRANSLUCENT = 0x80,
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

const MAX_DEPTH = 0x10000;

const DEPTH_BITS = 16;

export function makeDepthKeyEx(depth: number, flipDepth: boolean, maxDepth: number = MAX_DEPTH) {
    // Input depth here is: 0 is the closest to the camera, positive values are further away. Negative values (behind camera) are clamped to 0.
    // normalizedDepth: 0.0 is closest to camera, 1.0 is farthest from camera.
    // These values are flipped if flipDepth is set.
    let normalizedDepth = (clamp(depth, 0, maxDepth) / maxDepth);
    if (flipDepth)
        normalizedDepth = 1.0 - normalizedDepth;
    const depthKey = (normalizedDepth * ((1 << DEPTH_BITS) - 1));
    return depthKey & 0xFFFF;
}

// Common sort key kinds.
// Indexed:     TLLLLLLL IIIIIIII IIIIIIII IIIIIIII
// Opaque:      0LLLLLLL DDDDDDDD DDDDDDPP PPPPPPDD
// Translucent: 1LLLLLLL DDDDDDDD DDDDDDDD BBBBBBBB

export function getSortKeyLayer(sortKey: number): number {
    return (sortKey >>> 24) & 0xFF;
}

export function setSortKeyLayer(sortKey: number, layer: number): number {
    return ((sortKey & 0x00FFFFFF) | ((layer & 0xFF) << 24)) >>> 0;
}

export function setSortKeyProgramKey(sortKey: number, programKey: number): number {
    const isTransparent = !!((sortKey >>> 31) & 1);
    if (isTransparent)
        return sortKey;
    else
        return (sortKey & 0xFFFFFC03) | ((programKey & 0xFF) << 2);
}

export function setSortKeyBias(sortKey: number, bias: number): number {
    const isTransparent = !!((sortKey >>> 31) & 1);
    if (isTransparent)
        return ((sortKey & 0xFFFFFF00) | (bias & 0xFF)) >>> 0;
    else
        return sortKey;
}

export function makeSortKeyOpaque(layer: number, programKey: number): number {
    return setSortKeyLayer(setSortKeyProgramKey(0, programKey), layer);
}

export function setSortKeyOpaqueDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFF0003FC) | ((depthKey & 0xFFFC) << 8) | (depthKey & 0x0003)) >>> 0;
}

export function makeSortKeyTranslucent(layer: number): number {
    return setSortKeyLayer(0, layer);
}

export function setSortKeyTranslucentDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFF0000FF) | (depthKey << 8)) >>> 0;
}

export function makeSortKey(layer: GfxRendererLayer, programKey: number = 0): number {
    if (layer & GfxRendererLayer.TRANSLUCENT)
        return makeSortKeyTranslucent(layer);
    else
        return makeSortKeyOpaque(layer, programKey);
}

export function setSortKeyDepthKey(sortKey: number, depthKey: number): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

export function setSortKeyDepth(sortKey: number, depth: number, maxDepth: number = MAX_DEPTH): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    const depthKey = makeDepthKeyEx(depth, isTranslucent, maxDepth);
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

export function getSortKeyDepth(sortKey: number): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    if (isTranslucent)
        return (sortKey >>> 8) & 0xFFFF;
    else {
        return ((sortKey >>> 8) & 0xFFFC | (sortKey & 0x03));
    }
}

function assignRenderInst(dst: GfxRenderInst, src: GfxRenderInst): void {
    dst.sortKey = src.sortKey;
    // TODO(jstpierre): Immutable render flags.
    dst._megaState = src._megaState;
    dst.inputState = src.inputState;
    dst._pipeline = src._pipeline;
    dst._bindingLayouts = src._bindingLayouts;
    dst._samplerBindings = src._samplerBindings.slice();
    dst._uniformBufferOffsets = src._uniformBufferOffsets.slice();
}

const enum GfxRenderInstFlags {
    DESTROYED                = 1 << 0,
    VISIBLE                  = 1 << 1,
    DRAW_INDEXED             = 1 << 2,
    SAMPLER_BINDINGS_INHERIT = 1 << 3,
    BINDINGS_DIRTY           = 1 << 4,
    PIPELINE_DIRTY           = 1 << 5,
    PIPELINE_DIRECT          = 1 << 6,
}

function setBitValue(bucket: number, bit: number, v: boolean): number {
    if (v)
        return bucket | bit;
    else
        return bucket & ~bit;
}

// The finished, low-level instance of a draw call. This is what's sorted and executed.
// TODO(jstpierre): Is this class too big?
export class GfxRenderInst {
    // A name for convenience during debugging.
    public name: string = '';

    // The sort key of the render inst. See makeSortKey and friends for details.
    public sortKey: number = 0;

    // The pass mask. Used in conjunction with GfxRenderInstViewer.executeOnPass.
    public passMask: number | null = null;

    // Pipeline building.
    public inputState: GfxInputState | null = null;
    public gfxProgram: GfxProgram | null = null;

    // Internal.

    // Draw calls.
    // Call drawTriangles / drawIndexed to set these fields properly.
    public _drawStart: number = 0;
    public _drawCount: number = 0;

    public _flags: GfxRenderInstFlags = GfxRenderInstFlags.VISIBLE | GfxRenderInstFlags.PIPELINE_DIRTY;

    // The pipeline to use for this RenderInst.
    public _pipeline: GfxRenderPipeline | null = null;

    // Pipeline building.

    // The public API to access this is setMegaStateFlags().
    public _megaState: GfxMegaStateDescriptor;

    // The public API to access this is setDeviceProgram().
    public _deviceProgram: DeviceProgram | null = null;

    // Bindings state.
    public _bindings: GfxBindings[] = [];
    public _uniformBufferOffsetGroups: number[][] = [];
    public _uniformBufferBindings: GfxBufferBinding[] = [];
    public _bindingLayouts: GfxBindingLayoutDescriptor[];
    public _uniformBufferOffsets: number[] = [];
    public _samplerBindings: GfxSamplerBinding[] = [];

    constructor(public parentRenderInst: GfxRenderInst = null) {
        if (parentRenderInst !== null)
            assignRenderInst(this, parentRenderInst);
    }

    public _setFlag(flag: GfxRenderInstFlags, v: boolean): void {
        this._flags = setBitValue(this._flags, flag, v);
    }

    private _tryInheritSamplerBindings(): void {
        if ((this._flags & GfxRenderInstFlags.SAMPLER_BINDINGS_INHERIT)) {
            this.parentRenderInst._tryInheritSamplerBindings();
            this.inheritSamplerBindings();
        }
    }

    public set visible(v: boolean) {
        this._setFlag(GfxRenderInstFlags.VISIBLE, v);
    }

    public get visible(): boolean {
        return !!(this._flags & GfxRenderInstFlags.VISIBLE);
    }

    public destroy(): void {
        this._setFlag(GfxRenderInstFlags.DESTROYED, true);
    }

    public rebuildPipeline(): void {
        this._setFlag(GfxRenderInstFlags.PIPELINE_DIRTY, true);
    }

    public setDeviceProgram(deviceProgram: DeviceProgram): void {
        this._deviceProgram = deviceProgram;
        this.gfxProgram = null;
        this.rebuildPipeline();
    }

    public setPipelineDirect(pipeline: GfxRenderPipeline): void {
        this._pipeline = pipeline;
        this._setFlag(GfxRenderInstFlags.PIPELINE_DIRECT, true);
    }

    public setSamplerBindingsInherit(v: boolean = true): void {
        this._setFlag(GfxRenderInstFlags.SAMPLER_BINDINGS_INHERIT, v);
        if (v) {
            const parentDirty = !!(this.parentRenderInst._flags & GfxRenderInstFlags.BINDINGS_DIRTY);
            this._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, parentDirty);
        }
    }

    public inheritSamplerBindings(): void {
        this.setSamplerBindings(this.parentRenderInst._samplerBindings);
    }

    public setSamplerBindings(m: GfxSamplerBinding[], firstSampler: number = 0): void {
        for (let i = 0; i < m.length; i++) {
            const j = firstSampler + i;
            if (!this._samplerBindings[j] || this._samplerBindings[j].texture !== m[i].texture || this._samplerBindings[j].sampler !== m[i].sampler) {
                this._samplerBindings[j] = m[i];
                this._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, true);
            }
        }
    }

    public setSamplerBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            if (!this._samplerBindings[i] || this._samplerBindings[i].texture !== m[i].gfxTexture || this._samplerBindings[i].sampler !== m[i].gfxSampler) {
                this._samplerBindings[i] = { texture: m[i].gfxTexture, sampler: m[i].gfxSampler };
                this._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, true);
            }
        }
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor> | null = null): GfxMegaStateDescriptor {
        if (this._megaState === this.parentRenderInst._megaState)
            this._megaState = copyMegaState(this.parentRenderInst._megaState);
        if (r !== null)
            setMegaStateFlags(this._megaState, r);
        this.rebuildPipeline();
        return this._megaState;
    }

    public drawTriangles(vertexCount: number, firstVertex: number = 0) {
        this._setFlag(GfxRenderInstFlags.DRAW_INDEXED, false);
        this._drawStart = firstVertex;
        this._drawCount = vertexCount;
    }

    public drawIndexes(indexCount: number, firstIndex: number = 0) {
        this._setFlag(GfxRenderInstFlags.DRAW_INDEXED, true);
        this._drawStart = firstIndex;
        this._drawCount = indexCount;
    }

    public getUniformBufferOffset(i: number): number {
        if (this._uniformBufferOffsets === null)
            return this.parentRenderInst.getUniformBufferOffset(i);
        else
            return this._uniformBufferOffsets[i];
    }

    public getPassMask(): number {
        if (this.passMask === null)
            return this.parentRenderInst.getPassMask();
        else
            return this.passMask;
    }

    private _hasOrInheritsFlag(flag: GfxRenderInstFlags): boolean {
        if ((this._flags & flag))
            return true;
        else if (this.parentRenderInst !== null)
            return this.parentRenderInst._hasOrInheritsFlag(flag);
        else
            return false;
    }

    private _buildGfxProgram(device: GfxDevice, cache: GfxRenderCache): GfxProgram {
        if (this.gfxProgram !== null)
            return this.gfxProgram;

        if (this._deviceProgram !== null) {
            this.gfxProgram = cache.createProgram(device, this._deviceProgram);
            return this.gfxProgram;
        }

        return this.parentRenderInst._buildGfxProgram(device, cache);
    }

    private buildPipeline(device: GfxDevice, cache: GfxRenderCache): void {
        if (!this._hasOrInheritsFlag(GfxRenderInstFlags.PIPELINE_DIRTY))
            return;

        if (this._hasOrInheritsFlag(GfxRenderInstFlags.PIPELINE_DIRECT))
            return;

        const inputLayout = this.inputState !== null ? device.queryInputState(this.inputState).inputLayout : null;

        const gfxProgram = this._buildGfxProgram(device, cache);
        this._pipeline = cache.createRenderPipeline(device, {
            topology: GfxPrimitiveTopology.TRIANGLES,
            program: gfxProgram,
            bindingLayouts: this._bindingLayouts,
            inputLayout,
            megaStateDescriptor: this._megaState,
        });

        this._setFlag(GfxRenderInstFlags.PIPELINE_DIRTY, false);
    }

    private buildBindings(device: GfxDevice, cache: GfxRenderCache): void {
        if (!this._hasOrInheritsFlag(GfxRenderInstFlags.BINDINGS_DIRTY))
            return;

        this._tryInheritSamplerBindings();

        let firstUniformBufferBinding = 0;
        let firstSamplerBinding = 0;
        for (let i = 0; i < this._bindingLayouts.length; i++) {
            const bindingLayout = this._bindingLayouts[i];
            const uniformBufferBindings = this._uniformBufferBindings.slice(firstUniformBufferBinding, firstUniformBufferBinding + bindingLayout.numUniformBuffers);
            const samplerBindings = this._samplerBindings.slice(firstSamplerBinding, firstSamplerBinding + bindingLayout.numSamplers);
            const bindings = cache.createBindings(device, { bindingLayout, uniformBufferBindings, samplerBindings });
            this._bindings[i] = bindings;
            firstUniformBufferBinding += bindingLayout.numUniformBuffers;
            firstSamplerBinding += bindingLayout.numSamplers;
        }

        this._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, false);
    }

    public _prepareToRenderLeaf(device: GfxDevice, cache: GfxRenderCache): void {        
        this.buildPipeline(device, cache);
        this.buildBindings(device, cache);
    }

    public _prepareToRenderTemplate(device: GfxDevice, cache: GfxRenderCache): void {
        this._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, false);
        this._setFlag(GfxRenderInstFlags.PIPELINE_DIRTY, false);
    }
}

function compareRenderInsts(a: GfxRenderInst, b: GfxRenderInst): number {
    // Put invisible items to the end of the list.
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    return a.sortKey - b.sortKey;
}

export class GfxRenderInstViewRenderer {
    private viewportWidth: number;
    private viewportHeight: number;
    public renderInsts: GfxRenderInst[] = [];
    public templateRenderInsts: GfxRenderInst[] = [];
    public gfxRenderCache = new GfxRenderCache();

    public destroy(device: GfxDevice): void {
        this.gfxRenderCache.destroy(device);
    }

    public setViewport(viewportWidth: number, viewportHeight: number): void {
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
    }

    public hasAnyVisible(passMask: number): boolean {
        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            if (!renderInst.visible)
                continue;

            if ((renderInst.getPassMask() & passMask) === 0)
                continue;

            return true;
        }

        return false;
    }

    public prepareToRender(device: GfxDevice): void {
        // Give a chance to all template render insts to rebake, regardless of visiblity.
        // This is a two-step solution: first, we let leaf render insts update, and then we clear flags on templates.
        // If we do not do this, we have no way of knowing when to clear template flags.
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i]._prepareToRenderLeaf(device, this.gfxRenderCache);
        for (let i = 0; i < this.templateRenderInsts.length; i++)
            this.templateRenderInsts[i]._prepareToRenderTemplate(device, this.gfxRenderCache);
    }

    public executeOnPass(device: GfxDevice, passRenderer: GfxRenderPass, passMask: number = 1): void {
        // Kill any destroyed instances.
        for (let i = this.renderInsts.length - 1; i >= 0; i--) {
            if ((this.renderInsts[i]._flags & GfxRenderInstFlags.DESTROYED))
                this.renderInsts.splice(i, 1);
        }

        // Sort our instances.
        this.renderInsts.sort(compareRenderInsts);

        passRenderer.setViewport(this.viewportWidth, this.viewportHeight);

        let currentPipeline: GfxRenderPipeline | null = null;
        let currentInputState: GfxInputState | null = null;

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            // Invisible items should *always* be grouped up at the end of the list.
            // Once we hit an invisible item, we can stop.
            if (!renderInst.visible)
                break;

            if ((renderInst.getPassMask() & passMask) === 0)
                continue;

            assert(renderInst._pipeline !== null);
            if (currentPipeline !== renderInst._pipeline) {
                passRenderer.setPipeline(renderInst._pipeline);
                currentPipeline = renderInst._pipeline;
            }

            if (currentInputState !== renderInst.inputState) {
                passRenderer.setInputState(renderInst.inputState);
                currentInputState = renderInst.inputState;
            }

            for (let j = 0; j < renderInst._bindings.length; j++)
                passRenderer.setBindings(j, renderInst._bindings[j], renderInst._uniformBufferOffsetGroups[j]);

            if ((renderInst._flags & GfxRenderInstFlags.DRAW_INDEXED))
                passRenderer.drawIndexed(renderInst._drawCount, renderInst._drawStart);
            else
                passRenderer.draw(renderInst._drawCount, renderInst._drawStart);
        }
    }
}

export class GfxRenderInstBuilder {
    private uniformBufferOffsets: number[] = [];
    private uniformBufferWordAlignment: number;
    private newRenderInsts: GfxRenderInst[] = [];
    private newTemplateRenderInsts: GfxRenderInst[] = [];
    private allRenderInsts: GfxRenderInst[] = [];
    private templateStack: GfxRenderInst[] = [];

    constructor(device: GfxDevice, public programReflection: DeviceProgramReflection, public bindingLayouts: GfxBindingLayoutDescriptor[], public uniformBuffers: GfxRenderBuffer[]) {
        this.uniformBufferWordAlignment = device.queryLimits().uniformBufferWordAlignment;

        assert(this.uniformBuffers.length === this.programReflection.uniformBufferLayouts.length);
        for (let i = 0; i < this.programReflection.uniformBufferLayouts.length; i++) {
            const bufferName = this.uniformBuffers[i].resourceName;
            if (bufferName !== "" && bufferName !== "Unnamed GfxRenderBuffer")
                assert(bufferName === this.programReflection.uniformBufferLayouts[i].blockName);
            this.uniformBufferOffsets[i] = 0;
        }

        let totalSamplerBindings = 0, totalUniformBufferBindings = 0;
        for (let i = 0; i < this.bindingLayouts.length; i++) {
            totalSamplerBindings += this.bindingLayouts[i].numSamplers;
            totalUniformBufferBindings += this.bindingLayouts[i].numUniformBuffers;
        }
        assert(this.programReflection.uniformBufferLayouts.length === totalUniformBufferBindings);
        assert(this.programReflection.totalSamplerBindingsCount === totalSamplerBindings);

        const baseRenderInst = this.pushTemplateRenderInst();
        baseRenderInst.name = "base render inst";
        baseRenderInst.passMask = 1;
        baseRenderInst._megaState = copyMegaState(defaultMegaState);
        baseRenderInst._bindingLayouts = this.bindingLayouts;
    }

    private newUniformBufferOffset(index: number): number {
        const incrSize = align(this.programReflection.uniformBufferLayouts[index].totalWordSize, this.uniformBufferWordAlignment);
        const offset = this.uniformBuffers[index].allocateChunk(this.uniformBufferOffsets[index], incrSize);
        this.uniformBufferOffsets[index] = offset + incrSize;
        return offset;
    }

    public newUniformBufferInstance(renderInst: GfxRenderInst, index: number): number {
        const offs = this.newUniformBufferOffset(index);
        renderInst._uniformBufferOffsets[index] = offs;
        return offs;
    }

    public pushTemplateRenderInst(o: GfxRenderInst = null): GfxRenderInst {
        if (o === null)
            o = this.newRenderInst();
        this.templateStack.unshift(o);
        // TODO(jstpierre): Yes, I know this list can have duplicates.
        this.newTemplateRenderInsts.push(o);
        return o;
    }

    public popTemplateRenderInst(): void {
        this.templateStack.shift();
    }

    public newRenderInst(baseRenderInst: GfxRenderInst | null = null): GfxRenderInst {
        if (baseRenderInst === null)
            baseRenderInst = this.templateStack[0];
        return new GfxRenderInst(baseRenderInst);
    }

    public pushRenderInst(renderInst: GfxRenderInst | null = null): GfxRenderInst {
        if (renderInst === null)
            renderInst = this.newRenderInst();
        this.newRenderInsts.push(renderInst);
        return renderInst;
    }

    private buildRenderInstUniformBufferBindings(renderInst: GfxRenderInst): void {
        // Uniform buffer bindings.
        let changedBufferBinding = false;
        for (let i = 0; i < this.uniformBuffers.length; i++) {
            const { buffer } = this.uniformBuffers[i].getGfxBuffer(renderInst.getUniformBufferOffset(i));
            assertExists(buffer);

            const wordCount = this.programReflection.uniformBufferLayouts[i].totalWordSize;
            if (renderInst._uniformBufferBindings[i] === undefined) {
                renderInst._uniformBufferBindings[i] = { buffer, wordOffset: 0, wordCount };
                changedBufferBinding = true;
            } else if (renderInst._uniformBufferBindings[i].buffer !== buffer) {
                renderInst._uniformBufferBindings[i].buffer = buffer;
                changedBufferBinding = true;
            }
        }

        // Set up our dynamic uniform buffer offsets.
        let firstUniformBuffer = 0;
        let totalSamplerBindings = 0;
        for (let i = 0; i < this.bindingLayouts.length; i++) {
            const bindingLayout = this.bindingLayouts[i];

            const lastUniformBuffer = firstUniformBuffer + bindingLayout.numUniformBuffers;

            renderInst._uniformBufferOffsetGroups[i] = Array(bindingLayout.numUniformBuffers);
            for (let j = firstUniformBuffer; j < lastUniformBuffer; j++) {
                const j0 = j - firstUniformBuffer;
                const { wordOffset } = this.uniformBuffers[j].getGfxBuffer(renderInst._uniformBufferOffsets[j]);
                renderInst._uniformBufferOffsetGroups[i][j0] = wordOffset;
            }

            firstUniformBuffer = lastUniformBuffer;
            totalSamplerBindings += bindingLayout.numSamplers;
        }

        // TODO(jstpierre): Find a better way to do this.
        let shouldBuildBindings = false;
        if (changedBufferBinding) {
            if (renderInst._samplerBindings.length === totalSamplerBindings)
                shouldBuildBindings = true;
        }

        if (shouldBuildBindings)
            renderInst._setFlag(GfxRenderInstFlags.BINDINGS_DIRTY, true);
    }

    public constructRenderInsts(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        // Update our buffers for the new counts.
        for (let i = 0; i < this.uniformBuffers.length; i++)
            this.uniformBuffers[i].setWordCount(device, this.uniformBufferOffsets[i]);

        for (let i = 0; i < this.newRenderInsts.length; i++) {
            const renderInst = this.newRenderInsts[i];

            this.allRenderInsts.push(renderInst);
            viewRenderer.renderInsts.push(renderInst);
        }

        // It's plausible that our uniform buffers might have changed, so rebuild.
        for (let i = 0; i < this.allRenderInsts.length; i++)
            this.buildRenderInstUniformBufferBindings(this.allRenderInsts[i]);

        for (let i = 0; i < this.newTemplateRenderInsts.length; i++)
            if (!viewRenderer.templateRenderInsts.includes(this.newTemplateRenderInsts[i]))
                viewRenderer.templateRenderInsts.push(this.newTemplateRenderInsts[i]);

        this.newRenderInsts.length = 0;
        this.newTemplateRenderInsts.length = 0;
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        assert(this.templateStack.length === 1);
        this.constructRenderInsts(device, viewRenderer);
    }
}
