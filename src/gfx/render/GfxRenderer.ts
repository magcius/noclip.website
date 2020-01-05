
import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxBindings, GfxSamplerBinding, GfxProgram, GfxInputLayout, GfxBuffer, GfxRenderPipeline } from "../platform/GfxPlatform";
import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { nArray, assert, assertExists } from "../../util";
import { clamp } from "../../MathHelpers";
import { gfxRenderPipelineDescriptorEquals, gfxBindingsDescriptorEquals } from "../platform/GfxPlatformUtil";
import { DEFAULT_NUM_SAMPLES } from "../helpers/RenderTargetHelpers";

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

// Changes to V2:
//  * RenderInst is now meant to be reconstructed every frame, even more similarly to T3.
//    GC costs are absorbed with an object pool.
//  * Because we recreate RenderInsts every single frame, instead of the heavy runtime template
//    dynamic inheritance system, we can simply demand that RenderInsts are recreated. So
//    templates become a "blueprint" rather than an actual RenderInst.



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

const MAX_DEPTH = 0x10000;

const DEPTH_BITS = 16;

export function makeDepthKey(depth: number, flipDepth: boolean, maxDepth: number = MAX_DEPTH) {
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
// Opaque:      0LLLLLLL PPPPPPPP PPPPPPPP DDDDDDDD
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
        return ((sortKey & 0xFF0000FF) | ((programKey & 0xFFFF) << 16)) >>> 0;
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
    return ((sortKey & 0xFFFFFF00) | ((depthKey >>> 8) & 0xFF)) >>> 0;
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
    const depthKey = makeDepthKey(depth, isTranslucent, maxDepth);
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

const enum GfxRenderInstFlags {
    TEMPLATE_RENDER_INST = 1 << 0,
    DRAW_RENDER_INST = 1 << 1,
    DRAW_INDEXED = 1 << 2,

    INHERITED_FLAGS = (DRAW_INDEXED),
}

interface GfxRendererTransientState {
    currentRenderPipelineDescriptor: GfxRenderPipelineDescriptor | null;
    currentRenderPipelineReady: boolean;
    currentInputState: GfxInputState | null;
    currentBindingDescriptor: GfxBindingsDescriptor | null;
    currentBindings: GfxBindings | null;
}

export class GfxRenderInst {
    // TODO(jstpierre): Remove when we remove legacy GfxRenderInstManager.
    public sortKey: number = 0;
    public filterKey: number = 0;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;
    private _renderPipeline: GfxRenderPipeline | null = null;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ bindingLayout: null!, samplerBindings: [], uniformBufferBindings: [] }));
    private _dynamicUniformBufferByteOffsets: number[] = nArray(4, () => 0);

    public _flags: number = 0;
    private _inputState: GfxInputState | null = null;
    private _drawStart: number;
    private _drawCount: number;
    private _drawInstanceCount: number;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null!, // lol
            topology: GfxPrimitiveTopology.TRIANGLES,
            sampleCount: DEFAULT_NUM_SAMPLES,
        };
    }

    public reset(): void {
        this.sortKey = 0;
        this.filterKey = 0;
        this._renderPipeline = null;
    }

    public setFromTemplate(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._renderPipeline = o._renderPipeline;
        this._inputState = o._inputState;
        this._uniformBuffer = o._uniformBuffer;
        this._drawCount = o._drawCount;
        this._drawStart = o._drawStart;
        this._drawInstanceCount = o._drawInstanceCount;
        this._flags = (this._flags & ~GfxRenderInstFlags.INHERITED_FLAGS) | (o._flags & GfxRenderInstFlags.INHERITED_FLAGS);
        this.sortKey = o.sortKey;
        this.filterKey = o.filterKey;
        const tbd = this._bindingDescriptors[0], obd = o._bindingDescriptors[0];
        if (obd.bindingLayout !== null)
            this._setBindingLayout(obd.bindingLayout);
        for (let i = 0; i < Math.min(tbd.uniformBufferBindings.length, obd.uniformBufferBindings.length); i++)
            tbd.uniformBufferBindings[i].wordCount = o._bindingDescriptors[0].uniformBufferBindings[i].wordCount;
        this.setSamplerBindingsFromTextureMappings(obd.samplerBindings);
        for (let i = 0; i < o._dynamicUniformBufferByteOffsets.length; i++)
            this._dynamicUniformBufferByteOffsets[i] = o._dynamicUniformBufferByteOffsets[i];
    }

    public setGfxRenderPipeline(pipeline: GfxRenderPipeline): void {
        this._renderPipeline = pipeline;
    }

    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): GfxMegaStateDescriptor {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    public getMegaStateFlags(): GfxMegaStateDescriptor {
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    public setInputLayoutAndState(inputLayout: GfxInputLayout | null, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputLayout;
    }

    public drawIndexes(indexCount: number, indexStart: number = 0): void {
        this._flags |= GfxRenderInstFlags.DRAW_INDEXED;
        this._drawCount = indexCount;
        this._drawStart = indexStart;
        this._drawInstanceCount = 1;
    }

    public drawIndexesInstanced(indexCount: number, instanceCount: number, indexStart: number = 0): void {
        this._flags |= GfxRenderInstFlags.DRAW_INDEXED;
        this._drawCount = indexCount;
        this._drawStart = indexStart;
        this._drawInstanceCount = instanceCount;
    }

    public drawPrimitives(primitiveCount: number, primitiveStart: number = 0): void {
        this._drawCount = primitiveCount;
        this._drawStart = primitiveStart;
        this._drawInstanceCount = 1;
    }

    private _setBindingLayout(bindingLayout: GfxBindingLayoutDescriptor): void {
        assert(bindingLayout.numUniformBuffers < this._dynamicUniformBufferByteOffsets.length);
        this._renderPipelineDescriptor.bindingLayouts[0] = bindingLayout;
        this._bindingDescriptors[0].bindingLayout = bindingLayout;

        for (let i = this._bindingDescriptors[0].uniformBufferBindings.length; i < bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings.push({ buffer: null!, wordCount: 0, wordOffset: 0 });
        for (let i = this._bindingDescriptors[0].samplerBindings.length; i < bindingLayout.numSamplers; i++)
            this._bindingDescriptors[0].samplerBindings.push({ gfxSampler: null, gfxTexture: null });
    }

    public setUniformBuffer(uniformBuffer: GfxRenderDynamicUniformBuffer): void {
        this._uniformBuffer = uniformBuffer;
    }

    public setBindingLayouts(bindingLayouts: GfxBindingLayoutDescriptor[]): void {
        assert(bindingLayouts.length <= this._bindingDescriptors.length);
        assert(bindingLayouts.length === 1);
        this._setBindingLayout(bindingLayouts[0]);
    }

    public allocateUniformBuffer(bufferIndex: number, wordCount: number): number {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferByteOffsets.length);
        this._dynamicUniformBufferByteOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount) << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
        const wordOffset = this._dynamicUniformBufferByteOffsets[bufferIndex] >>> 2;
        return wordOffset;
    }

    public getUniformBufferOffset(bufferIndex: number) {
        const wordOffset = this._dynamicUniformBufferByteOffsets[bufferIndex] >>> 2;
        return wordOffset;
    }

    public setUniformBufferOffset(bufferIndex: number, wordOffset: number, wordCount: number): void {
        this._dynamicUniformBufferByteOffsets[bufferIndex] = wordOffset << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
    }

    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        const wordOffset = this._dynamicUniformBufferByteOffsets[bufferIndex] >>> 2;
        return this._uniformBuffer.mapBufferF32(wordOffset, this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordCount);
    }

    public getUniformBuffer(): GfxRenderDynamicUniformBuffer {
        return this._uniformBuffer;
    }

    public setSamplerBindingsFromTextureMappings(m: (GfxSamplerBinding | null)[]): void {
        for (let i = 0; i < this._bindingDescriptors[0].samplerBindings.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            if (m[i] !== undefined && m[i] !== null) {
                dst.gfxTexture = m[i]!.gfxTexture;
                dst.gfxSampler = m[i]!.gfxSampler;
            } else {
                dst.gfxTexture = null;
                dst.gfxSampler = null;
            }
        }
    }

    public drawOnPassWithState(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass, state: GfxRendererTransientState): void {
        assert(!!(this._flags & GfxRenderInstFlags.DRAW_RENDER_INST));

        if (this._renderPipeline !== null) {
            state.currentRenderPipelineDescriptor = null;
            const ready = device.queryPipelineReady(this._renderPipeline);
            assert(ready);
            passRenderer.setPipeline(this._renderPipeline);
        } else {
            if (state.currentRenderPipelineDescriptor === null || !gfxRenderPipelineDescriptorEquals(this._renderPipelineDescriptor, state.currentRenderPipelineDescriptor)) {
                state.currentRenderPipelineDescriptor = this._renderPipelineDescriptor;
                const gfxPipeline = cache.createRenderPipeline(device, state.currentRenderPipelineDescriptor);
                state.currentRenderPipelineReady = device.queryPipelineReady(gfxPipeline);
                if (!state.currentRenderPipelineReady)
                    return;

                passRenderer.setPipeline(gfxPipeline);
            } else {
                if (!state.currentRenderPipelineReady)
                    return;
            }
        }

        if (this._inputState !== state.currentInputState) {
            state.currentInputState = this._inputState;
            passRenderer.setInputState(state.currentInputState);
        }

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer!;

        if (state.currentBindingDescriptor === null || !gfxBindingsDescriptorEquals(this._bindingDescriptors[0], state.currentBindingDescriptor)) {
            state.currentBindingDescriptor = this._bindingDescriptors[0];
            state.currentBindings = cache.createBindings(device, state.currentBindingDescriptor);
        }

        passRenderer.setBindings(0, assertExists(state.currentBindings), this._dynamicUniformBufferByteOffsets);

        if (this._drawInstanceCount > 1) {
            assert(!!(this._flags & GfxRenderInstFlags.DRAW_INDEXED));
            passRenderer.drawIndexedInstanced(this._drawCount, this._drawCount, this._drawInstanceCount);
        } else if ((this._flags & GfxRenderInstFlags.DRAW_INDEXED)) {
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        } else {
            passRenderer.draw(this._drawCount, this._drawStart);
        }
    }

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        assert(!!(this._flags & GfxRenderInstFlags.DRAW_RENDER_INST));

        if (this._renderPipeline !== null) {
            passRenderer.setPipeline(this._renderPipeline);
        } else {
            const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
            passRenderer.setPipeline(gfxPipeline);
        }

        passRenderer.setInputState(this._inputState);

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer!;

        // TODO(jstpierre): Support multiple binding descriptors.
        const gfxBindings = cache.createBindings(device, this._bindingDescriptors[0]);
        passRenderer.setBindings(0, gfxBindings, this._dynamicUniformBufferByteOffsets);

        if (this._drawInstanceCount > 1) {
            assert(!!(this._flags & GfxRenderInstFlags.DRAW_INDEXED));
            passRenderer.drawIndexedInstanced(this._drawCount, this._drawCount, this._drawInstanceCount);
        } else if ((this._flags & GfxRenderInstFlags.DRAW_INDEXED)) {
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        } else {
            passRenderer.draw(this._drawCount, this._drawStart);
        }
    }
}

// Basic linear pool allocator.
export class GfxRenderInstPool {
    // The pool contains all render insts that we've ever created.
    public pool: GfxRenderInst[] = [];
    // The number of render insts currently allocated out to the user.
    public allocCount: number = 0;

    public allocRenderInstIndex(): number {
        this.allocCount++;

        if (this.allocCount > this.pool.length)
            this.pool.push(new GfxRenderInst());

        return this.allocCount - 1;
    }

    public popRenderInst(): void {
        this.allocCount--;
    }

    public reset(): void {
        for (let i = 0; i < this.pool.length; i++)
            this.pool[i]._flags = 0;
        this.allocCount = 0;
    }

    public destroy(): void {
        this.pool.length = 0;
        this.allocCount = 0;
    }
}

function gfxRendererTransientStateReset(state: GfxRendererTransientState): void {
    state.currentRenderPipelineDescriptor = null;
    state.currentRenderPipelineReady = false;
    state.currentInputState = null;
    state.currentBindingDescriptor = null;
    state.currentBindings = null;
}

export function gfxRendererTransientStateNew(): GfxRendererTransientState {
    return {
        currentRenderPipelineDescriptor: null,
        currentRenderPipelineReady: false,
        currentInputState: null,
        currentBindingDescriptor: null,
        currentBindings: null,
    };
}

const defaultTransientState = gfxRendererTransientStateNew();

export const gfxRenderInstCompareNone = null;

export function gfxRenderInstCompareSortKey(a: GfxRenderInst, b: GfxRenderInst): number {
    return a.sortKey - b.sortKey;
}

function bisectLeft<T>(L: T[], e: T, compare: (a: T, b: T) => number): number {
    let lo = 0, hi = L.length;
    while (lo < hi) {
        const mid = lo + ((hi - lo) >>> 1);
        const cmp = compare(L[mid], e);
        if (cmp < 0)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}

export const enum GfxRenderInstExecutionOrder {
    Forwards,
    Backwards,
}

export type GfxRenderInstCompareFunc = (a: GfxRenderInst, b: GfxRenderInst) => number;

export class GfxRenderInstList {
    public renderInsts: GfxRenderInst[] = [];
    private needsSort = false;

    constructor(
        public compareFunction: GfxRenderInstCompareFunc | null = gfxRenderInstCompareSortKey,
        public executionOrder = GfxRenderInstExecutionOrder.Forwards,
    ) {
    }

    private flushSort(): void {
        if (this.needsSort && this.compareFunction !== null)
            this.renderInsts.sort(this.compareFunction);
        this.needsSort = false;
    }

    public insertSorted(renderInst: GfxRenderInst): void {
        this.flushSort();
        if (this.compareFunction !== null) {
            const idx = bisectLeft(this.renderInsts, renderInst, this.compareFunction);
            this.renderInsts.splice(idx, 0, renderInst);
        } else {
            this.renderInsts.push(renderInst);
        }
    }

    public insertToEnd(renderInst: GfxRenderInst): void {
        this.renderInsts.push(renderInst);
        if (this.compareFunction !== null)
            this.needsSort = true;
    }

    public drawOnPassRenderer(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass, state: GfxRendererTransientState | null = null): void {
        if (this.renderInsts.length === 0)
            return;

        this.flushSort();

        // TODO(jstpierre): Remove this?
        if (state === null) {
            gfxRendererTransientStateReset(defaultTransientState);
            state = defaultTransientState;
        }

        if (this.executionOrder === GfxRenderInstExecutionOrder.Forwards) {
            for (let i = 0; i < this.renderInsts.length; i++)
                this.renderInsts[i].drawOnPassWithState(device, cache, passRenderer, state);
        } else {
            for (let i = this.renderInsts.length - 1; i >= 0; i--)
                this.renderInsts[i].drawOnPassWithState(device, cache, passRenderer, state);
        }
    }

    public reset(): void {
        this.renderInsts.length = 0;
    }
}

export class GfxRenderInstManager {
    // TODO(jstpierre): Share these caches between scenes.
    public gfxRenderCache = new GfxRenderCache();
    public instPool = new GfxRenderInstPool();
    public templatePool = new GfxRenderInstPool();
    private simpleRenderInstList: GfxRenderInstList | null = new GfxRenderInstList();
    private currentRenderInstList: GfxRenderInstList = this.simpleRenderInstList!;

    public newRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        const renderInstIndex = this.instPool.allocRenderInstIndex();
        const renderInst = this.instPool.pool[renderInstIndex];
        if (templateIndex >= 0)
            renderInst.setFromTemplate(this.templatePool.pool[templateIndex]);
        else
            renderInst.reset();
        renderInst._flags = GfxRenderInstFlags.DRAW_RENDER_INST;
        return renderInst;
    }

    public submitRenderInst(renderInst: GfxRenderInst): void {
        this.currentRenderInstList.insertSorted(renderInst);
    }

    public pushRenderInst(): GfxRenderInst {
        const renderInst = this.newRenderInst();
        // Submitted to the current list by default. We can't insert
        // sorted because there's no guarantee the sortKey is correct
        // at this point.
        this.currentRenderInstList.insertToEnd(renderInst);
        return renderInst;
    }

    public setCurrentRenderInstList(list: GfxRenderInstList): void {
        this.currentRenderInstList = list;
    }

    public returnRenderInst(renderInst: GfxRenderInst): void {
        renderInst._flags = 0;

        // We leave it completely dead for now, since we don't expect to see too many "returned" instances.
        // That said, if this is ever a memory pressure, we can have allocRenderInst allocate from dead items
        // again...
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        const newTemplateIndex = this.templatePool.allocRenderInstIndex();
        const newTemplate = this.templatePool.pool[newTemplateIndex];
        if (templateIndex >= 0)
            newTemplate.setFromTemplate(this.templatePool.pool[templateIndex]);
        newTemplate._flags = GfxRenderInstFlags.TEMPLATE_RENDER_INST;
        return newTemplate;
    }

    public popTemplateRenderInst(): void {
        this.templatePool.popRenderInst();
    }

    public getTemplateRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        return this.templatePool.pool[templateIndex];
    }

    public resetRenderInsts(): void {
        // Retire the existing render insts.
        this.instPool.reset();
        if (this.simpleRenderInstList !== null)
            this.simpleRenderInstList.reset();
    }

    public destroy(device: GfxDevice): void {
        this.instPool.destroy();
        this.gfxRenderCache.destroy(device);
    }

    // Legacy pass management API.
    public setVisibleByFilterKeyExact(filterKey: number): void {
        const list = assertExists(this.simpleRenderInstList);
        list.renderInsts.length = 0;

        for (let i = 0; i < this.instPool.pool.length; i++) {
            if ((this.instPool.pool[i]._flags & GfxRenderInstFlags.DRAW_RENDER_INST &&
                 this.instPool.pool[i].filterKey === filterKey))
                list.renderInsts.push(this.instPool.pool[i]);
        }
    }

    public hasAnyVisible(): boolean {
        const list = assertExists(this.simpleRenderInstList);
        return list.renderInsts.length > 0;
    }

    public setVisibleNone(): void {
        const list = assertExists(this.simpleRenderInstList);
        list.renderInsts.length = 0;
    }

    public drawOnPassRenderer(device: GfxDevice, passRenderer: GfxRenderPass, state: GfxRendererTransientState | null = null): void {
        const list = assertExists(this.simpleRenderInstList);
        list.drawOnPassRenderer(device, this.gfxRenderCache, passRenderer, state);
    }

    public disableSimpleMode(): void {
        // This is a one-way street!
        this.simpleRenderInstList = null;
    }
}

// Convenience for porting.
export function executeOnPass(renderInstManager: GfxRenderInstManager, device: GfxDevice, passRenderer: GfxRenderPass, passMask: number, sort: boolean = true): void {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    renderInstManager.drawOnPassRenderer(device, passRenderer);
}

export function hasAnyVisible(renderInstManager: GfxRenderInstManager, passMask: number): boolean {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    return renderInstManager.hasAnyVisible();
}
