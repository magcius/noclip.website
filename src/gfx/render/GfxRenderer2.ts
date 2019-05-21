
import { DeviceProgram } from "../../Program";
import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxBindings, GfxSamplerBinding, GfxProgram } from "../platform/GfxPlatform";
import { defaultMegaState, makeMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { nArray, assert } from "../../util";
import { TextureMapping } from "../../TextureHolder";

// Changes to V2:
//  * RenderInst is now meant to be reconstructed every frame, even more similarly to T3.
//    GC costs are absorbed with an object pool.
//  * Because we recreate RenderInsts every single frame, instead of the heavy runtime template
//    dynamic inheritance system, we can simply demand that RenderInsts are recreated. So
//    templates become a "blueprint" rather than an actual RenderInst.

const enum GfxRenderInstFlags {
    VISIBLE = 1 << 0,
    DRAW_INDEXED = 1 << 1,
}

export class GfxRenderInst {
    public sortKey: number = 0;
    public passMask: number = 0;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ samplerBindings: [], uniformBufferBindings: [] } as GfxBindingsDescriptor));
    private _dynamicUniformBufferOffsets: number[] = nArray(4, () => 0);

    public _flags: number = 0;
    public _parentTemplateIndex: number = -1;
    private _inputState: GfxInputState;
    private _drawStart: number;
    private _drawCount: number;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null,
            topology: GfxPrimitiveTopology.TRIANGLES,
        };
    }

    public reset(): void {
        this.sortKey = 0;
        this.passMask = 0;
    }

    public setFromTemplate(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._inputState = o._inputState;
        this.setBindingBase([o._bindingDescriptors[0].bindingLayout], o._uniformBuffer);
        this.setSamplerBindings(o._bindingDescriptors[0].samplerBindings);
        for (let i = 0; i < o._bindingDescriptors[0].bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].wordCount = o._bindingDescriptors[0].uniformBufferBindings[i].wordCount;
    }

    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
    }

    public setInputState(device: GfxDevice, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputState !== null ? device.queryInputState(inputState).inputLayout : null;
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

    public setBindingBase(bindingLayouts: GfxBindingLayoutDescriptor[], uniformBuffer: GfxRenderDynamicUniformBuffer): void {
        assert(bindingLayouts.length <= this._bindingDescriptors.length);

        for (let i = 0; i < bindingLayouts.length; i++) {
            this._renderPipelineDescriptor.bindingLayouts[i] = bindingLayouts[i];

            const desc = this._bindingDescriptors[i];
            desc.bindingLayout = bindingLayouts[i];
            while (desc.uniformBufferBindings.length < desc.bindingLayout.numUniformBuffers)
                desc.uniformBufferBindings.push({ buffer: null, wordCount: 0, wordOffset: 0 });
            while (desc.samplerBindings.length < desc.bindingLayout.numSamplers)
                desc.samplerBindings.push({ sampler: null, texture: null });
        }

        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);

        this._uniformBuffer = uniformBuffer;
    }

    public allocateUniformBuffer(bufferIndex: number, wordCount: number): number {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._dynamicUniformBufferOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount);

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
        return this._dynamicUniformBufferOffsets[bufferIndex];
    }

    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        return this._uniformBuffer.mapBufferF32(this._dynamicUniformBufferOffsets[bufferIndex], this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordCount);
    }

    public copyUniformBufferBinding(bufferIndex: number, src: GfxRenderInst): void {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordOffset = src._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordOffset;
    }

    public setSamplerBindings(m: GfxSamplerBinding[]): void {
        for (let i = 0; i < m.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            dst.texture = m[i].texture;
            dst.sampler = m[i].sampler;
        }
    }

    public setSamplerBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            dst.texture = m[i].gfxTexture;
            dst.sampler = m[i].gfxSampler;
        }
    }

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        if (!device.queryPipelineReady(gfxPipeline))
            return;

        passRenderer.setPipeline(gfxPipeline);
        passRenderer.setInputState(this._inputState);

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer;

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
    public renderInstPool: GfxRenderInst[] = [];
    // The number of render insts currently allocated out to the user.
    public renderInstAllocCount: number = 0;

    public allocRenderInst(): GfxRenderInst {
        this.renderInstAllocCount++;

        if (this.renderInstAllocCount > this.renderInstPool.length)
            this.renderInstPool.push(new GfxRenderInst());

        return this.renderInstPool[this.renderInstAllocCount - 1];
    }

    public reset(): void {
        for (let i = 0; i < this.renderInstAllocCount; i++)
            this.renderInstPool[i]._flags = 0;

        this.renderInstAllocCount = 0;
    }

    public destroy(): void {
        this.renderInstPool.length = 0;
        this.renderInstAllocCount = 0;
    }
}

function compareRenderInsts(a: GfxRenderInst, b: GfxRenderInst): number {
    // Force unallocated items to the end of the list.
    if (!!(a._flags & GfxRenderInstFlags.VISIBLE)) return -1;
    if (!!(b._flags & GfxRenderInstFlags.VISIBLE)) return 1;
    return a.sortKey - b.sortKey;
}

export class GfxRenderInstManager {
    // TODO(jstpierre): Share these caches between scenes.
    public gfxRenderCache = new GfxRenderCache();
    public gfxRenderInstPool = new GfxRenderInstPool();

    public pushRenderInst(): GfxRenderInst {
        const renderInst = this.gfxRenderInstPool.allocRenderInst();
        if (this.renderInstTemplate !== null)
            renderInst.setFromTemplate(this.renderInstTemplate);
        else
            renderInst.reset();
        renderInst._flags = GfxRenderInstFlags.VISIBLE;
        return renderInst;
    }

    // TODO(jstpierre): Reconsider the template API?
    private renderInstTemplate: GfxRenderInst | null = null;
    public pushTemplateRenderInst(): GfxRenderInst {
        const newTemplate = this.gfxRenderInstPool.allocRenderInst();
        if (this.renderInstTemplate !== null) {
            newTemplate.setFromTemplate(this.renderInstTemplate);
            newTemplate._parentTemplateIndex = this.gfxRenderInstPool.renderInstPool.indexOf(this.renderInstTemplate);
        }
        this.renderInstTemplate = newTemplate;
        return newTemplate;
    }

    public popTemplateRenderInst(): void {
        if (this.renderInstTemplate._parentTemplateIndex === -1)
            this.renderInstTemplate = null;
        else
            this.renderInstTemplate = this.gfxRenderInstPool.renderInstPool[this.renderInstTemplate._parentTemplateIndex];
    }

    public executeOnPass(device: GfxDevice, passRenderer: GfxRenderPass): void {
        if (this.gfxRenderInstPool.renderInstAllocCount === 0)
            return;

        // Sort the render insts. This is guaranteed to keep unallocated render insts at the end of the list.
        this.gfxRenderInstPool.renderInstPool.sort(compareRenderInsts);

        for (let i = 0; i < this.gfxRenderInstPool.renderInstAllocCount; i++) {
            // Once we reach the first invisible item, we're done.
            if (!(this.gfxRenderInstPool.renderInstPool[i]._flags & GfxRenderInstFlags.VISIBLE))
                break;

            this.gfxRenderInstPool.renderInstPool[i].drawOnPass(device, this.gfxRenderCache, passRenderer);
        }

        // Retire the existing render insts.
        this.gfxRenderInstPool.reset();
    }
}
