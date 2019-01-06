
import { GfxInputState, GfxRenderPass, GfxBindings, GfxRenderPipeline, GfxDevice, GfxSamplerBinding, GfxBindingLayoutDescriptor, GfxBufferBinding, GfxProgram, GfxPrimitiveTopology, GfxSampler, GfxBindingsDescriptor, GfxMegaStateDescriptor } from "../platform/GfxPlatform";
import { align, assertExists, assert } from "../../util";
import { GfxRenderBuffer } from "./GfxRenderBuffer";
import { TextureMapping } from "../../TextureHolder";
import { DeviceProgramReflection } from "../../Program";
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

export function makeDepthKey(sortKey: number, depth: number, maxDepth: number = MAX_DEPTH) {
    const isTranslucent = ((sortKey >>> 30) & 1) !== 0;
    return makeDepthKeyEx(depth, isTranslucent, maxDepth);
}

// Common sort key kinds.
// Indexed:     0TLLLLLL IIIIIIII IIIIIIII IIIIIIII
// Opaque:      00LLLLLL DDDDDDDD DDDDDDPP PPPPPPDD
// Translucent: 01LLLLLL DDDDDDDD DDDDDDDD PPPPPPPP

export function makeSortKeyOpaque(layer: number, programKey: number): number {
    return (((layer & 0xFF) << 24) | ((programKey & 0xFF) << 2)) >>> 0;
}

export function setSortKeyOpaqueDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFF0003FC) | ((depthKey & 0xFFFC) << 8) | (depthKey & 0x0003)) >>> 0;
}

export function makeSortKeyTranslucent(layer: number, programKey: number): number {
    return (((layer & 0xFF) << 24) | (programKey & 0xFF)) >>> 0;
}

export function setSortKeyTranslucentDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFF0000FF) | (depthKey)) >>> 0;
}

export function makeSortKey(layer: GfxRendererLayer, programKey: number): number {
    if (layer & GfxRendererLayer.TRANSLUCENT)
        return makeSortKeyTranslucent(layer, programKey);
    else
        return makeSortKeyOpaque(layer, programKey);
}

export function setSortKeyDepthKey(sortKey: number, depthKey: number): number {
    const isTranslucent = (sortKey >>> 31) & 1;
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

export function setSortKeyDepth(sortKey: number, depth: number, maxDepth: number = MAX_DEPTH): number {
    const isTranslucent = (sortKey >>> 31) & 1;
    const depthKey = makeDepthKey(isTranslucent, depth, maxDepth);
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

function assignRenderInst(dst: GfxRenderInst, src: GfxRenderInst): void {
    dst.sortKey = src.sortKey;
    // TODO(jstpierre): Immutable render flags.
    dst._megaState = src._megaState;
    dst.gfxProgram = src.gfxProgram;
    dst.inputState = src.inputState;
    dst._pipeline = src._pipeline;
    dst._bindingLayouts = src._bindingLayouts;
    dst.samplerBindings = src.samplerBindings.slice();
    dst.uniformBufferOffsets = src.uniformBufferOffsets.slice();
}

const enum GfxRenderInstFlags {
    DESTROYED                = 1 << 0,
    VISIBLE                  = 1 << 1,
    DRAW_INDEXED             = 1 << 2,
    SAMPLER_BINDINGS_INHERIT = 1 << 3,
    SAMPLER_BINDINGS_DIRTY   = 1 << 4,
}

function setBitValue(bucket: number, bit: number, v: boolean): number {
    if (!!(bucket & bit) === v)
        return bucket;
    else
        return (bucket & ~bit) | (v ? bit : 0);
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

    // Bindings.
    public uniformBufferOffsets: number[] = [];
    public samplerBindings: GfxSamplerBinding[] = [];

    // Internal.

    // Draw calls.
    // Call drawTriangles / drawIndexed to set these fields properly.
    public _drawStart: number = 0;
    public _drawCount: number = 0;

    public _flags: GfxRenderInstFlags = GfxRenderInstFlags.VISIBLE;

    // The pipeline to use for this RenderInst.
    public _pipeline: GfxRenderPipeline | null = null;

    // Pipeline building. The public API to access this is setRenderFlags().
    public _megaState: GfxMegaStateDescriptor;

    // Bindings state.
    public _bindings: GfxBindings[] = [];
    public _uniformBufferOffsetGroups: number[][] = [];
    public _uniformBufferBindings: GfxBufferBinding[] = [];
    public _bindingLayouts: GfxBindingLayoutDescriptor[];

    constructor(public parentRenderInst: GfxRenderInst = null) {
        if (parentRenderInst !== null)
            assignRenderInst(this, parentRenderInst);
    }

    public _setFlag(flag: GfxRenderInstFlags, v: boolean): void {
        this._flags = setBitValue(this._flags, flag, v);
    }

    private _inheritSamplerBindings(): void {
        if ((this._flags & GfxRenderInstFlags.SAMPLER_BINDINGS_INHERIT)) {
            this.parentRenderInst._inheritSamplerBindings();
            this.setSamplerBindings(this.parentRenderInst.samplerBindings);
        }
    }

    public _rebuildSamplerBindings(device: GfxDevice, cache: GfxRenderCache): void {
        this._inheritSamplerBindings();

        if (!(this._flags & GfxRenderInstFlags.SAMPLER_BINDINGS_DIRTY))
            return;

        this.buildBindings(device, cache);
        this._setFlag(GfxRenderInstFlags.SAMPLER_BINDINGS_DIRTY, false);
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

    public setPipelineDirect(pipeline: GfxRenderPipeline): void {
        this._pipeline = pipeline;
    }

    public setSamplerBindingsInherit(v: boolean = true): void {
        this._setFlag(GfxRenderInstFlags.SAMPLER_BINDINGS_INHERIT, v);
    }

    public setSamplerBindings(m: GfxSamplerBinding[], firstSampler: number = 0): void {
        for (let i = 0; i < m.length; i++) {
            const j = firstSampler + i;
            if (!this.samplerBindings[j] || this.samplerBindings[j].texture !== m[i].texture || this.samplerBindings[j].sampler !== m[i].sampler) {
                this.samplerBindings[j] = m[i];
                this._setFlag(GfxRenderInstFlags.SAMPLER_BINDINGS_DIRTY, true);
            }
        }
    }

    public setSamplerBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            if (!this.samplerBindings[i] || this.samplerBindings[i].texture !== m[i].gfxTexture || this.samplerBindings[i].sampler !== m[i].gfxSampler) {
                this.samplerBindings[i] = { texture: m[i].gfxTexture, sampler: m[i].gfxSampler };
                this._setFlag(GfxRenderInstFlags.SAMPLER_BINDINGS_DIRTY, true);
            }
        }
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor> | null = null): GfxMegaStateDescriptor {
        setMegaStateFlags(this.ensureMegaState(), r);
        return this._megaState;
    }

    public ensureMegaState(): GfxMegaStateDescriptor {
        if (this._megaState === this.parentRenderInst._megaState)
            this._megaState = copyMegaState(this.parentRenderInst._megaState);
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
        if (this.uniformBufferOffsets === null)
            return this.parentRenderInst.getUniformBufferOffset(i);
        else
            return this.uniformBufferOffsets[i];
    }

    public getPassMask(): number {
        if (this.passMask === null)
            return this.parentRenderInst.getPassMask();
        else
            return this.passMask;
    }

    public buildPipeline(device: GfxDevice, cache: GfxRenderCache): void {
        assert(this._pipeline === null);

        const inputLayout = this.inputState !== null ? device.queryInputState(this.inputState).inputLayout : null;
        this._pipeline = cache.createRenderPipeline(device, {
            topology: GfxPrimitiveTopology.TRIANGLES,
            program: this.gfxProgram,
            bindingLayouts: this._bindingLayouts,
            inputLayout,
            megaStateDescriptor: this._megaState,
        });
    }

    public buildBindings(device: GfxDevice, cache: GfxRenderCache): void {
        let firstUniformBufferBinding = 0;
        let firstSamplerBinding = 0;
        for (let i = 0; i < this._bindingLayouts.length; i++) {
            const bindingLayout = this._bindingLayouts[i];
            const uniformBufferBindings = this._uniformBufferBindings.slice(firstUniformBufferBinding, firstUniformBufferBinding + bindingLayout.numUniformBuffers);
            const samplerBindings = this.samplerBindings.slice(firstSamplerBinding, firstSamplerBinding + bindingLayout.numSamplers);
            const bindings = cache.createBindings(device, { bindingLayout, uniformBufferBindings, samplerBindings });
            this._bindings[i] = bindings;
            firstUniformBufferBinding += bindingLayout.numUniformBuffers;
            firstSamplerBinding += bindingLayout.numSamplers;
        }
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
    public gfxRenderCache = new GfxRenderCache();

    public destroy(device: GfxDevice): void {
        this.gfxRenderCache.destroy(device);
    }

    public setViewport(viewportWidth: number, viewportHeight: number): void {
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
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

            renderInst._rebuildSamplerBindings(device, this.gfxRenderCache);

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
    private renderInsts: GfxRenderInst[] = [];
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

        const baseRenderInst = this.pushTemplateRenderInst();
        baseRenderInst.name = "base render inst";
        baseRenderInst.passMask = 1;
        baseRenderInst._megaState = copyMegaState(defaultMegaState);
        baseRenderInst._bindingLayouts = this.bindingLayouts;
    }

    private newUniformBufferOffset(index: number): number {
        const offset = this.uniformBufferOffsets[index];
        const incrSize = align(this.programReflection.uniformBufferLayouts[index].totalWordSize, this.uniformBufferWordAlignment);
        this.uniformBufferOffsets[index] += incrSize;
        return offset;
    }

    public newUniformBufferInstance(renderInst: GfxRenderInst, index: number): number {
        const offs = this.newUniformBufferOffset(index);
        renderInst.uniformBufferOffsets[index] = offs;
        return offs;
    }

    public pushTemplateRenderInst(o: GfxRenderInst = null): GfxRenderInst {
        if (o === null)
            o = this.newRenderInst();
        this.templateStack.unshift(o);
        return o;
    }

    public popTemplateRenderInst(): void {
        this.templateStack.shift();
    }

    public newRenderInst(baseRenderInst: GfxRenderInst = null): GfxRenderInst {
        if (baseRenderInst === null)
            baseRenderInst = this.templateStack[0];
        return new GfxRenderInst(baseRenderInst);
    }

    public pushRenderInst(renderInst: GfxRenderInst = null): GfxRenderInst {
        if (renderInst === null)
            renderInst = this.newRenderInst();
        this.renderInsts.push(renderInst);
        return renderInst;
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        assert(this.templateStack.length === 1);

        // Once we're finished building our RenderInsts, go through and assign buffers and bindings for all.
        for (let i = 0; i < this.uniformBuffers.length; i++)
            this.uniformBuffers[i].setWordCount(device, this.uniformBufferOffsets[i]);

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            // Construct a pipeline if we need one.
            if (renderInst._pipeline !== null) {
                assert(renderInst.gfxProgram === null);
            } else {
                renderInst.buildPipeline(device, viewRenderer.gfxRenderCache);
            }

            // Uniform buffer bindings.
            for (let j = 0; j < this.uniformBuffers.length; j++) {
                const { buffer } = this.uniformBuffers[j].getGfxBuffer(renderInst.getUniformBufferOffset(j));
                assertExists(buffer);

                const wordCount = this.programReflection.uniformBufferLayouts[j].totalWordSize;
                renderInst._uniformBufferBindings[j] = { buffer, wordOffset: 0, wordCount };
            }

            // Set up our dynamic uniform buffer offsets.
            let firstUniformBuffer = 0;
            for (let j = 0; j < this.bindingLayouts.length; j++) {
                const bindingLayout = this.bindingLayouts[j];

                const lastUniformBuffer = firstUniformBuffer + bindingLayout.numUniformBuffers;

                renderInst._uniformBufferOffsetGroups[j] = Array(bindingLayout.numUniformBuffers);
                for (let k = firstUniformBuffer; k < lastUniformBuffer; k++) {
                    const k0 = k - firstUniformBuffer;
                    const { wordOffset } = this.uniformBuffers[k].getGfxBuffer(renderInst.uniformBufferOffsets[k]);
                    renderInst._uniformBufferOffsetGroups[j][k0] = wordOffset;
                }

                firstUniformBuffer = lastUniformBuffer;
            }

            renderInst.buildBindings(device, viewRenderer.gfxRenderCache);

            viewRenderer.renderInsts.push(renderInst);
        }

        this.renderInsts.length = 0;
    }
}
