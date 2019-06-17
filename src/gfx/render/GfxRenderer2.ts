
import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxBindings, GfxSamplerBinding, GfxProgram, GfxInputLayout, GfxBuffer } from "../platform/GfxPlatform";
import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { nArray, assert } from "../../util";

// Changes to V2:
//  * RenderInst is now meant to be reconstructed every frame, even more similarly to T3.
//    GC costs are absorbed with an object pool.
//  * Because we recreate RenderInsts every single frame, instead of the heavy runtime template
//    dynamic inheritance system, we can simply demand that RenderInsts are recreated. So
//    templates become a "blueprint" rather than an actual RenderInst.

const enum GfxRenderInstFlags {
    VISIBLE = 1 << 0,
    TEMPLATE_RENDER_INST = 1 << 1,
    DRAW_RENDER_INST = 1 << 2,
    DRAW_INDEXED = 1 << 3,
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
    public _parentTemplateIndex: number = -1;
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

    public setVisible(v: boolean = true): void {
        setVisible(this, v);
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

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        assert(!!(this._flags & GfxRenderInstFlags.DRAW_RENDER_INST));

        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        if (!device.queryPipelineReady(gfxPipeline))
            return;

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
    public renderInstAllocCount: number = 0;
    // The number of render insts that we know are free, somewhere in the allocated portion of the pool.
    public renderInstFreeCount: number = 0;

    public allocRenderInstIndex(): number {
        if (this.renderInstFreeCount > 0) {
            this.renderInstFreeCount--;
            // Search for the next free render inst.
            for (let i = 0; i < this.renderInstAllocCount; i++)
                if (this.pool[i]._flags === 0)
                    return i;
        }

        this.renderInstAllocCount++;

        if (this.renderInstAllocCount > this.pool.length)
            this.pool.push(new GfxRenderInst());

        return this.renderInstAllocCount - 1;
    }

    public returnRenderInstIndex(renderInstIndex: number): number {
        const renderInst = this.pool[renderInstIndex];
        renderInst._flags = 0;

        // Swap to the beginning of the list so we don't need as big a linear scan next time we want to
        // push a template... believe it or not this actually helps quite a lot. 20FPS diff on Firefox on
        // Comet Observatory.
        for (let i = this.renderInstFreeCount; i < this.renderInstAllocCount; i++) {
            // Search for a non-template render inst, since we don't want to screw up any indexes.
            const other = this.pool[i];
            if (!(other._flags & GfxRenderInstFlags.TEMPLATE_RENDER_INST)) {
                this.pool[i] = renderInst;
                this.pool[renderInstIndex] = other;
                break;
            }
        }

        this.renderInstFreeCount++;
        return renderInst._parentTemplateIndex;
    }

    public reset(): void {
        for (let i = 0; i < this.pool.length; i++)
            this.pool[i]._flags = 0;

        this.renderInstAllocCount = 0;
        this.renderInstFreeCount = 0;
    }

    public destroy(): void {
        this.pool.length = 0;
        this.renderInstAllocCount = 0;
        this.renderInstFreeCount = 0;
    }
}

function compareRenderInsts(a: GfxRenderInst, b: GfxRenderInst): number {
    // Force invisible items to the end of the list.
    const aVisible = !!(a._flags & GfxRenderInstFlags.VISIBLE);
    const bVisible = !!(b._flags & GfxRenderInstFlags.VISIBLE);
    if (aVisible !== bVisible)
        return aVisible ? -1 : 1;
    return a.sortKey - b.sortKey;
}

function setVisible(a: GfxRenderInst, visible: boolean): void {
    if (visible)
        a._flags |= GfxRenderInstFlags.VISIBLE;
    else
        a._flags &= ~GfxRenderInstFlags.VISIBLE;
}

export class GfxRenderInstManager {
    // TODO(jstpierre): Share these caches between scenes.
    public gfxRenderCache = new GfxRenderCache();
    public gfxRenderInstPool = new GfxRenderInstPool();
    private renderInstTemplateIndex: number = -1;

    public pushRenderInst(): GfxRenderInst {
        const renderInstIndex = this.gfxRenderInstPool.allocRenderInstIndex();
        const renderInst = this.gfxRenderInstPool.pool[renderInstIndex];
        if (this.renderInstTemplateIndex >= 0)
            renderInst.setFromTemplate(this.gfxRenderInstPool.pool[this.renderInstTemplateIndex]);
        else
            renderInst.reset();
        // draw render insts are visible by default.
        renderInst._flags = GfxRenderInstFlags.DRAW_RENDER_INST | GfxRenderInstFlags.VISIBLE;
        return renderInst;
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const newTemplateIndex = this.gfxRenderInstPool.allocRenderInstIndex();
        const newTemplate = this.gfxRenderInstPool.pool[newTemplateIndex];
        newTemplate._parentTemplateIndex = this.renderInstTemplateIndex;
        if (this.renderInstTemplateIndex >= 0)
            newTemplate.setFromTemplate(this.gfxRenderInstPool.pool[this.renderInstTemplateIndex]);
        newTemplate._flags = GfxRenderInstFlags.TEMPLATE_RENDER_INST;
        this.renderInstTemplateIndex = newTemplateIndex;
        return newTemplate;
    }

    public popTemplateRenderInst(): void {
        this.renderInstTemplateIndex = this.gfxRenderInstPool.returnRenderInstIndex(this.renderInstTemplateIndex);
    }

    public getTemplateRenderInst(): GfxRenderInst {
        return this.gfxRenderInstPool.pool[this.renderInstTemplateIndex];
    }

    // TODO(jstpierre): Build a better API for pass management -- should not be attached to the GfxRenderer2.
    public setVisibleByFilterKeyExact(filterKey: number): void {
        for (let i = 0; i < this.gfxRenderInstPool.pool.length; i++)
            if (this.gfxRenderInstPool.pool[i]._flags & GfxRenderInstFlags.DRAW_RENDER_INST)
                setVisible(this.gfxRenderInstPool.pool[i], this.gfxRenderInstPool.pool[i].filterKey === filterKey);
    }

    public hasAnyVisible(): boolean {
        for (let i = 0; i < this.gfxRenderInstPool.pool.length; i++)
            if (this.gfxRenderInstPool.pool[i]._flags & GfxRenderInstFlags.VISIBLE)
                return true;
        return false;
    }

    public setVisibleNone(): void {
        for (let i = 0; i < this.gfxRenderInstPool.pool.length; i++)
            this.gfxRenderInstPool.pool[i]._flags &= ~GfxRenderInstFlags.VISIBLE;
    }

    public drawOnPassRenderer(device: GfxDevice, passRenderer: GfxRenderPass): void {
        // We should have zero templates.
        assert(this.renderInstTemplateIndex === -1);

        if (this.gfxRenderInstPool.renderInstAllocCount === 0)
            return;

        // Sort the render insts. This is guaranteed to keep invisible render insts at the end of the list.
        this.gfxRenderInstPool.pool.sort(compareRenderInsts);

        for (let i = 0; i < this.gfxRenderInstPool.renderInstAllocCount; i++) {
            const renderInst = this.gfxRenderInstPool.pool[i];

            // Once we reach the first invisible item, we're done.
            if (!(renderInst._flags & GfxRenderInstFlags.VISIBLE))
                break;

            this.gfxRenderInstPool.pool[i].drawOnPass(device, this.gfxRenderCache, passRenderer);
        }
    }

    public resetRenderInsts(): void {
        // Retire the existing render insts.
        this.gfxRenderInstPool.reset();
    }

    public destroy(device: GfxDevice): void {
        this.gfxRenderInstPool.destroy();
        this.gfxRenderCache.destroy(device);
    }
}

// Convenience for porting.
export function executeOnPass(renderInstManager: GfxRenderInstManager, device: GfxDevice, passRenderer: GfxRenderPass, passMask: number): void {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    renderInstManager.drawOnPassRenderer(device, passRenderer);
}

export function hasAnyVisible(renderInstManager: GfxRenderInstManager, passMask: number): boolean {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    return renderInstManager.hasAnyVisible();
}
