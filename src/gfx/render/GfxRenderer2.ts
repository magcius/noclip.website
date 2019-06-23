
import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxBindings, GfxSamplerBinding, GfxProgram, GfxInputLayout, GfxBuffer, GfxRenderPipeline } from "../platform/GfxPlatform";
import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { nArray, assert } from "../../util";
import { gfxRenderPipelineDescriptorEquals, gfxBindingsDescriptorEquals } from "../platform/GfxPlatformUtil";

// Changes to V2:
//  * RenderInst is now meant to be reconstructed every frame, even more similarly to T3.
//    GC costs are absorbed with an object pool.
//  * Because we recreate RenderInsts every single frame, instead of the heavy runtime template
//    dynamic inheritance system, we can simply demand that RenderInsts are recreated. So
//    templates become a "blueprint" rather than an actual RenderInst.

const enum GfxRenderInstFlags {
    TEMPLATE_RENDER_INST = 1 << 1,
    DRAW_RENDER_INST = 1 << 2,
    DRAW_INDEXED = 1 << 3,
}

interface GfxRendererTransientState {
    currentRenderPipelineDescriptor: GfxRenderPipelineDescriptor | null;
    currentRenderPipelineReady: boolean;
    currentInputState: GfxInputState | null;
    currentBindingDescriptors: GfxBindingsDescriptor | null;
    currentBindings: GfxBindings | null;
}

export class GfxRenderInst {
    public sortKey: number = 0;
    public filterKey: number = 0;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ bindingLayout: null!, samplerBindings: [], uniformBufferBindings: [] }));
    private _dynamicUniformBufferOffsets: number[] = nArray(4, () => 0);

    public _flags: number = 0;
    private _inputState: GfxInputState | null = null;
    private _drawStart: number;
    private _drawCount: number;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null!, // lol
            topology: GfxPrimitiveTopology.TRIANGLES,
        };
    }

    public reset(): void {
        this.sortKey = 0;
        this.filterKey = 0;
    }

    public setFromTemplate(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._inputState = o._inputState;
        this._uniformBuffer = o._uniformBuffer;
        this.sortKey = o.sortKey;
        this.filterKey = o.filterKey;
        this._setBindingLayout(o._bindingDescriptors[0].bindingLayout);
        this.setSamplerBindingsFromTextureMappings(o._bindingDescriptors[0].samplerBindings);
        for (let i = 0; i < o._bindingDescriptors[0].bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].wordCount = o._bindingDescriptors[0].uniformBufferBindings[i].wordCount;
        for (let i = 0; i < o._dynamicUniformBufferOffsets.length; i++)
            this._dynamicUniformBufferOffsets[i] = o._dynamicUniformBufferOffsets[i];
    }

    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
    }

    public getMegaStateFlags(): GfxMegaStateDescriptor {
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    public setInputState(device: GfxDevice, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputState !== null ? device.queryInputState(inputState).inputLayout : null;
    }

    public setInputLayoutAndState(inputLayout: GfxInputLayout | null, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputLayout;
    }

    public drawIndexes(indexCount: number, indexStart: number = 0): void {
        this._flags |= GfxRenderInstFlags.DRAW_INDEXED;
        this._drawCount = indexCount;
        this._drawStart = indexStart;
    }

    public drawPrimitives(primitiveCount: number, primitiveStart: number = 0): void {
        this._drawCount = primitiveCount;
        this._drawStart = primitiveStart;
    }

    private _setBindingLayout(bindingLayout: GfxBindingLayoutDescriptor): void {
        assert(bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
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
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._dynamicUniformBufferOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount);

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
        return this._dynamicUniformBufferOffsets[bufferIndex];
    }

    public getUniformBufferOffset(bufferIndex: number) {
        return this._dynamicUniformBufferOffsets[bufferIndex];
    }

    public setUniformBufferOffset(bufferIndex: number, offset: number, wordCount: number): void {
        this._dynamicUniformBufferOffsets[bufferIndex] = offset;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
    }

    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        return this._uniformBuffer.mapBufferF32(this._dynamicUniformBufferOffsets[bufferIndex], this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordCount);
    }

    public getUniformBuffer(): GfxRenderDynamicUniformBuffer {
        return this._uniformBuffer;
    }

    public setSamplerBindingsFromTextureMappings(m: (GfxSamplerBinding | null)[]): void {
        for (let i = 0; i < m.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i]!;
            if (m[i] !== null) {
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

        if (this._inputState !== state.currentInputState) {
            state.currentInputState = this._inputState;
            passRenderer.setInputState(state.currentInputState);
        }

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer!;

        if (state.currentBindingDescriptors === null || !gfxBindingsDescriptorEquals(this._bindingDescriptors[0], state.currentBindingDescriptors)) {
            state.currentBindingDescriptors = this._bindingDescriptors[0];
            state.currentBindings = cache.createBindings(device, state.currentBindingDescriptors);
        }

        passRenderer.setBindings(0, state.currentBindings, this._dynamicUniformBufferOffsets);

        if ((this._flags & GfxRenderInstFlags.DRAW_INDEXED))
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        else
            passRenderer.draw(this._drawCount, this._drawStart);
    }

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        assert(!!(this._flags & GfxRenderInstFlags.DRAW_RENDER_INST));

        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        passRenderer.setPipeline(gfxPipeline);
        passRenderer.setInputState(this._inputState);

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer!;

        // TODO(jstpierre): Support multiple binding descriptors.
        const gfxBindings = cache.createBindings(device, this._bindingDescriptors[0]);
        passRenderer.setBindings(0, gfxBindings, this._dynamicUniformBufferOffsets);

        if ((this._flags & GfxRenderInstFlags.DRAW_INDEXED))
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        else
            passRenderer.draw(this._drawCount, this._drawStart);
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

function compareRenderInsts(a: GfxRenderInst, b: GfxRenderInst): number {
    return a.sortKey - b.sortKey;
}

function gfxRendererTransientStateReset(state: GfxRendererTransientState): void {
    state.currentRenderPipelineDescriptor = null;
    state.currentRenderPipelineReady = false;
    state.currentInputState = null;
    state.currentBindingDescriptors = null;
    state.currentBindings = null;
}

export function gfxRendererTransientStateNew(): GfxRendererTransientState {
    return {
        currentRenderPipelineDescriptor: null,
        currentRenderPipelineReady: false,
        currentInputState: null,
        currentBindingDescriptors: null,
        currentBindings: null,
    };
}

const defaultTransientState = gfxRendererTransientStateNew();

export class GfxRenderInstManager {
    // TODO(jstpierre): Share these caches between scenes.
    public gfxRenderCache = new GfxRenderCache();
    public instPool = new GfxRenderInstPool();
    public templatePool = new GfxRenderInstPool();
    public visibleRenderInsts: GfxRenderInst[] = [];

    public pushRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        const renderInstIndex = this.instPool.allocRenderInstIndex();
        const renderInst = this.instPool.pool[renderInstIndex];
        if (templateIndex >= 0)
            renderInst.setFromTemplate(this.templatePool.pool[templateIndex]);
        else
            renderInst.reset();
        // draw render insts are visible by default.
        renderInst._flags = GfxRenderInstFlags.DRAW_RENDER_INST;
        this.visibleRenderInsts.push(renderInst);
        return renderInst;
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

    public hasAnyVisible(): boolean {
        return this.visibleRenderInsts.length > 0;
    }

    // TODO(jstpierre): Build a better API for pass management -- should not be attached to the GfxRenderer2.
    public setVisibleByFilterKeyExact(filterKey: number): void {
        this.visibleRenderInsts.length = 0;

        for (let i = 0; i < this.instPool.pool.length; i++) {
            if ((this.instPool.pool[i]._flags & GfxRenderInstFlags.DRAW_RENDER_INST &&
                 this.instPool.pool[i].filterKey === filterKey))
                this.visibleRenderInsts.push(this.instPool.pool[i]);
        }
    }

    public setVisibleNone(): void {
        this.visibleRenderInsts.length = 0;
    }

    public drawOnPassRenderer(device: GfxDevice, passRenderer: GfxRenderPass, state: GfxRendererTransientState = null): void {
        if (this.visibleRenderInsts.length === 0)
            return;

        if (state === null) {
            gfxRendererTransientStateReset(defaultTransientState);
            state = defaultTransientState;
        }
    
        // Sort the render insts.
        this.visibleRenderInsts.sort(compareRenderInsts);

        for (let i = 0; i < this.visibleRenderInsts.length; i++)
            this.visibleRenderInsts[i].drawOnPassWithState(device, this.gfxRenderCache, passRenderer, state);
    }

    public resetRenderInsts(): void {
        // Retire the existing render insts.
        this.instPool.reset();
        this.visibleRenderInsts.length = 0;
    }

    public destroy(device: GfxDevice): void {
        this.instPool.destroy();
        this.gfxRenderCache.destroy(device);
    }
}

// Convenience for porting.
export function executeOnPass(renderInstManager: GfxRenderInstManager, device: GfxDevice, passRenderer: GfxRenderPass, passMask: number, state: GfxRendererTransientState = null): void {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    renderInstManager.drawOnPassRenderer(device, passRenderer, state);
}

export function hasAnyVisible(renderInstManager: GfxRenderInstManager, passMask: number): boolean {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    return renderInstManager.hasAnyVisible();
}
