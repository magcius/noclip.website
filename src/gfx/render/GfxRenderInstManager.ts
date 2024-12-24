
import { nArray, assert, assertExists } from "../../util.js";
import { clamp } from "../../MathHelpers.js";

import { GfxMegaStateDescriptor, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxSamplerBinding, GfxProgram, GfxInputLayout, GfxFormat, GfxRenderPassDescriptor, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from "../platform/GfxPlatform.js";

import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers.js";

import { GfxRenderCache } from "./GfxRenderCache.js";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer.js";

/**
 * The "Render" subsystem provides high-level scene graph utiltiies, built on top of gfx/platform and gfx/helpers. A
 * rough overview of the design:
 *
 * A {@see GfxRenderInst} is basically equivalent to one draw call. It contains everything that should be necessary to submit
 * it to the pass. It is also a transient structure that will not persist past "one frame" of the renderer. The
 * intention is to build up a large collection of {@see GfxRenderInst}s during scene graph traversal, and then dispatch them
 * in whatever order you want. This allows efficient pass management.
 *
 * The {@see GfxRenderInst} also lets you build your scene out of building independent building blocks like the mega state, the
 * shader program, and the resource bindings. This means that one does not have to worry about building {@see GfxRenderPipeline}
 * objects; it is taken care of you behind the scenes. A cache is used to share common pipelines.
 *
 * To provide different sets of draw calls for different passes, one should use multiple GfxRenderInstList objects. Each
 * object is a list of GfxRenderInst's, where the sort function and sort order can be chosen.
 *
 * For integration with the {@see GfxRenderGraph}, most passes should simply consist of calls to
 * {@see GfxRenderInstList.drawOnPassRenderer} to dispatch pre-built lists of render lists.
 *
 * All GfxRenderInsts are owned by the {@see GfxRenderInstManager}, which stores a pool of them together to cut down on GC
 * allocation costs. At the end of a frame, call {@see GfxRenderInstManager.reset} to reset all allocated GfxRenderInsts.
 *
 * As a convenience for creation, a stack-based template system can be used which allows one to set up multiple
 * parameters. Templates are just like regular {@see GfxRenderInst}s, but they are not added to draw lists automatically,
 * instead, they are only added to the template stack. Regular render insts will copy their initial values from the top
 * of the template stack.
 */

// TODO(jstpierre): Possible future investigations
//
//   - Actually remove more of the globals, and possibly clean up the template system from a global stack. Templates
//     will behave poorly for rendering. Perhaps move a lot of the simpler, legacy systems to a subclass or a sub-mode
//     which can be turned off. Unfortunately, a lot of generic code relies on the globals; would have to clean up
//     DebugThumbnails / DebugTextDrawer (though that's already a mess...)
//
//   - Remove the special behavior of sort keys, and just demand that the inversion happens on the client, through the
//     GfxRenderInstList sort order field.

//#region Sort Keys

// Suggested values for the "layer" of makeSortKey. These are rough groups, and you can define your own ordering within
// the rough groups (e.g. you might use BACKGROUND + 1, or BACKGROUND + 2). TRANSLUCENT is meant to be used as a
// bitflag. It's special as it changes the behavior of the generic sort key functions like makeSortKey and
// setSortKeyDepth.

export const enum GfxRendererLayer {
    BACKGROUND  = 0x00,
    ALPHA_TEST  = 0x10,
    OPAQUE      = 0x20,
    TRANSLUCENT = 0x80,
}

const MAX_DEPTH = 0x10000;

const DEPTH_BITS = 16;

export function makeDepthKey(depth: number, flipDepth: boolean, maxDepth: number = MAX_DEPTH) {
    // Input depth here is: 0 is the closest to the camera, positive values are further away. Negative values (behind
    // camera) are clamped to 0. normalizedDepth: 0.0 is closest to camera, 1.0 is farthest from camera. These values
    // are flipped if flipDepth is set.
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
        return ((sortKey & 0xFF0000FF) | ((programKey & 0xFFFF) << 8)) >>> 0;
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
//#endregion

//#region GfxRenderInst
export class GfxRenderInst {
    public sortKey: number = 0;

    // Debugging pointer for whomever wants it...
    public debug: any = null;
    public debugMarker: string | null = null;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ bindingLayout: null!, samplerBindings: [], uniformBufferBindings: [] }));
    private _dynamicUniformBufferByteOffsets: number[] = nArray(4, () => 0);

    private _allowSkippingPipelineIfNotReady: boolean = true;
    private _vertexBuffers: (GfxVertexBufferDescriptor | null)[] | null = null;
    private _indexBuffer: GfxIndexBufferDescriptor | null = null;
    private _drawStart: number = 0;
    private _drawCount: number = 0;
    private _drawInstanceCount: number = 1;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null!,
            topology: GfxPrimitiveTopology.Triangles,
            colorAttachmentFormats: [],
            depthStencilAttachmentFormat: null,
            sampleCount: 1,
        };
    }

    /**
     * Copies the fields from another render inst {@param o} to this render inst.
     */
    public copyFrom(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._renderPipelineDescriptor.colorAttachmentFormats.length = Math.max(this._renderPipelineDescriptor.colorAttachmentFormats.length, o._renderPipelineDescriptor.colorAttachmentFormats.length);
        for (let i = 0; i < o._renderPipelineDescriptor.colorAttachmentFormats.length; i++)
            this._renderPipelineDescriptor.colorAttachmentFormats[i] = o._renderPipelineDescriptor.colorAttachmentFormats[i];
        this._renderPipelineDescriptor.depthStencilAttachmentFormat = o._renderPipelineDescriptor.depthStencilAttachmentFormat;
        this._renderPipelineDescriptor.sampleCount = o._renderPipelineDescriptor.sampleCount;
        this._uniformBuffer = o._uniformBuffer;
        this._drawCount = o._drawCount;
        this._drawStart = o._drawStart;
        this._drawInstanceCount = o._drawInstanceCount;
        this._vertexBuffers = o._vertexBuffers;
        this._indexBuffer = o._indexBuffer;
        this._allowSkippingPipelineIfNotReady = o._allowSkippingPipelineIfNotReady;
        this.sortKey = o.sortKey;
        for (let i = 0; i < o._bindingDescriptors.length; i++) {
            const tbd = this._bindingDescriptors[i], obd = o._bindingDescriptors[i];
            if (obd.bindingLayout !== null)
                this._setBindingLayout(i, obd.bindingLayout);
            for (let j = 0; j < Math.min(tbd.uniformBufferBindings.length, obd.uniformBufferBindings.length); j++)
                tbd.uniformBufferBindings[j].wordCount = obd.uniformBufferBindings[j].wordCount;
            this.setSamplerBindingsFromTextureMappings(obd.samplerBindings);
        }
        for (let i = 0; i < o._dynamicUniformBufferByteOffsets.length; i++)
            this._dynamicUniformBufferByteOffsets[i] = o._dynamicUniformBufferByteOffsets[i];
    }

    public validate(): void {
        // Validate uniform buffer bindings.
        for (let i = 0; i < this._bindingDescriptors.length; i++) {
            const bd = this._bindingDescriptors[i];
            for (let j = 0; j < bd.bindingLayout.numUniformBuffers; j++)
                assert(bd.uniformBufferBindings[j].wordCount > 0);
        }

        assert(this._drawCount > 0);
    }

    /**
     * Set the {@see GfxPrimitiveTopology} that this render inst will render with.
     */
    public setPrimitiveTopology(topology: GfxPrimitiveTopology): void {
        this._renderPipelineDescriptor.topology = topology;
    }

    /**
     * Set the {@see GfxProgram} that this render inst will render with.
     */
    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    /**
     * Set the {@see GfxMegaStateDescriptor} that this render inst will render with.
     */
    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): GfxMegaStateDescriptor {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    /**
     * Retrieve the {@see GfxMegaStateDescriptor} property bag that this will render with. This is similar to
     * {@see setMegaStateFlags} but allows you to set fields directly on the internal property bag, rather than
     * merge them. This can be slightly more efficient.
     */
    public getMegaStateFlags(): GfxMegaStateDescriptor {
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    /**
     * Sets the vertex input configuration to be used by this render instance.
     * The {@see GfxInputLayout} is used to construct the pipeline as part of the automatic pipeline building
     * facilities, while the {@see GfxVertexBufferDescriptor} and {@see GfxIndexBufferDescriptor} is used for the render.
     */
    public setVertexInput(inputLayout: GfxInputLayout | null, vertexBuffers: (GfxVertexBufferDescriptor | null)[] | null, indexBuffer: GfxIndexBufferDescriptor | null): void {
        this._vertexBuffers = vertexBuffers;
        this._indexBuffer = indexBuffer;
        this._renderPipelineDescriptor.inputLayout = inputLayout;
    }

    private _setBindingLayout(i: number, bindingLayout: GfxBindingLayoutDescriptor): void {
        assert(bindingLayout.numUniformBuffers <= this._dynamicUniformBufferByteOffsets.length);
        this._renderPipelineDescriptor.bindingLayouts[i] = bindingLayout;
        const bindingDescriptor = this._bindingDescriptors[i];
        bindingDescriptor.bindingLayout = bindingLayout;

        for (let j = bindingDescriptor.uniformBufferBindings.length; j < bindingLayout.numUniformBuffers; j++)
            bindingDescriptor.uniformBufferBindings.push({ buffer: null!, wordCount: 0 });
        for (let j = bindingDescriptor.samplerBindings.length; j < bindingLayout.numSamplers; j++)
            bindingDescriptor.samplerBindings.push({ gfxSampler: null, gfxTexture: null, lateBinding: null });
    }

    /**
     * Sets the {@see GfxBindingLayoutDescriptor}s that this render inst will render with.
     */
    public setBindingLayouts(bindingLayouts: GfxBindingLayoutDescriptor[]): void {
        assert(bindingLayouts.length <= this._bindingDescriptors.length);
        for (let i = 0; i < this._bindingDescriptors.length; i++)
            this._setBindingLayout(i, bindingLayouts[i]);
    }

    /**
     * Sets the draw count parameters for this render inst. Whether this is an indexed or an unindexed draw is
     * determined by whether an index buffer is bound in the input layout. If this is an indexed draw, then
     * the counts are index counts. If this is an unindexed draw, then this is a vertex count.
     *
     * @param count The index count, or vertex count.
     * @param start The first index, or first vertex to render with.
     */
    public setDrawCount(count: number, start: number = 0): void {
        this._drawCount = count;
        this._drawStart = start;
    }

    public getDrawCount(): number {
        return this._drawCount;
    }

    /**
     * Sets the number of instances to draw.
     *
     * Instance counts are the same for both indexed and unindexed draws, however instanced draws are (currently)
     * only supported for indexed draws.
     *
     * @param instanceCount The number of instances to render.
     */
    public setInstanceCount(instanceCount: number): void {
        this._drawInstanceCount = instanceCount;
    }

    public setUniformBuffer(uniformBuffer: GfxRenderDynamicUniformBuffer): void {
        this._uniformBuffer = uniformBuffer;
    }

    /**
     * Allocates {@param wordCount} words from the uniform buffer and assigns it to the buffer
     * slot at index {@param bufferIndex}. As a convenience, this also directly returns the same
     * offset into the uniform buffer, in words, that would be returned by a subsequent call to
     * {@see getUniformBufferOffset}.
     */
    public allocateUniformBuffer(bufferIndex: number, wordCount: number): number {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers <= this._dynamicUniformBufferByteOffsets.length);
        assert(bufferIndex < this._bindingDescriptors[0].bindingLayout.numUniformBuffers);
        this._dynamicUniformBufferByteOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount) << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordCount = wordCount;
        return this.getUniformBufferOffset(bufferIndex);
    }

    /**
     * This is a convenience wrapper for {@param allocateUniformBuffer} and {@param mapUniformBufferF32}
     * that returns a pre-sliced {@see Float32Array} for the given offset.
     */
    public allocateUniformBufferF32(bufferIndex: number, wordCount: number): Float32Array {
        const wordOffset = this.allocateUniformBuffer(bufferIndex, wordCount);
        return this._uniformBuffer.mapBufferF32().subarray(wordOffset);
    }

    /**
     * Returns the offset into the uniform buffer, in words, that is assigned to the buffer slot
     * at index {@param bufferIndex}, to be used with e.g. {@see mapUniformBufferF32}.
     */
    public getUniformBufferOffset(bufferIndex: number) {
        return this._dynamicUniformBufferByteOffsets[bufferIndex] >>> 2;
    }

    /**
     * Directly sets the uniform buffer assigned to the buffer slot at index {@param bufferIndex}
     * to be {@param wordOffset}. Use this if you have already allocated a uniform buffer chunk through
     * some other means and wish to directly assign it to this render inst.
     */
    public setUniformBufferOffset(bufferIndex: number, wordOffset: number, wordCount: number): void {
        this._dynamicUniformBufferByteOffsets[bufferIndex] = wordOffset << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordCount = wordCount;
    }

    /**
     * This is a convenience wrapper for {@see GfxRenderDynamicUniformBuffer.mapBufferF32}, but uses
     * the values previously assigned for the uniform buffer slot at index {@param bufferIndex}.
     * Like {@see GfxRenderDynamicUniformBuffer.mapBufferF32}, this does not return a slice for the
     * buffer; you need to write to it with the correct uniform buffer offset; this will usually be
     * returned by {@see allocateUniformBuffer}.
     */
    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        return this._uniformBuffer.mapBufferF32();
    }

    /**
     * Retrieve the {@see GfxRenderDynamicUniformBuffer} that this render inst will use to allocate.
     */
    public getUniformBuffer(): GfxRenderDynamicUniformBuffer {
        return this._uniformBuffer;
    }

    public setSamplerBindings(bindingIndex: number, m: (GfxSamplerBinding | null)[]): void {
        const bindingDescriptor = this._bindingDescriptors[bindingIndex];
        for (let i = 0; i < bindingDescriptor.samplerBindings.length; i++) {
            const dst = bindingDescriptor.samplerBindings[i];
            const binding = m[i];

            if (binding === undefined || binding === null) {
                dst.gfxTexture = null;
                dst.gfxSampler = null;
                dst.lateBinding = null;
                continue;
            }

            dst.gfxTexture = binding.gfxTexture;
            dst.gfxSampler = binding.gfxSampler;
            dst.lateBinding = binding.lateBinding;
        }
    }

    /**
     * Sets the {@param GfxSamplerBinding}s in use by this render instance.
     *
     * Note that {@see GfxRenderInst} has a method of doing late binding, intended to solve cases where live render
     * targets are used, which can have difficult control flow consequences for users. Pass a string instead of a
     * GfxSamplerBinding to record that it can be resolved later, and use {@see GfxRenderInst.resolveLateSamplerBinding}
     * or equivalent to fill it in later.
     */
    public setSamplerBindingsFromTextureMappings(m: (GfxSamplerBinding | null)[]): void {
        assert(this._bindingDescriptors.length === 1);
        this.setSamplerBindings(0, m);
    }

    public hasLateSamplerBinding(name: string): boolean {
        for (let i = 0; i < this._bindingDescriptors.length; i++) {
            const bindingDescriptor = this._bindingDescriptors[i];
            for (let j = 0; j < bindingDescriptor.samplerBindings.length; j++) {
                const dst = bindingDescriptor.samplerBindings[j];
                if (dst.lateBinding === name)
                    return true;
            }
        }

        return false;
    }

    /**
     * Resolve a previously registered "late bound" sampler binding for the given {@param name} to the provided
     * {@param binding}, as registered through {@see setSamplerBindingsFromTextureMappings}.
     *
     * This is intended to be called by high-level code, and is especially helpful when juggling render targets
     * for framebuffer effects.
     */
    public resolveLateSamplerBinding(name: string, binding: GfxSamplerBinding | null): void {
        for (let i = 0; i < this._bindingDescriptors.length; i++) {
            const bindingDescriptor = this._bindingDescriptors[i];
            for (let j = 0; j < bindingDescriptor.samplerBindings.length; j++) {
                const dst = bindingDescriptor.samplerBindings[j];
                if (dst.lateBinding === name) {
                    if (binding === null) {
                        dst.gfxTexture = null;
                        dst.gfxSampler = null;
                    } else {
                        assert(binding.lateBinding === null);
                        dst.gfxTexture = binding.gfxTexture;
                        if (binding.gfxSampler !== null)
                            dst.gfxSampler = binding.gfxSampler;
                    }
    
                    dst.lateBinding = null;
                }
            }
        }
    }

    /**
     * Sets whether this render inst should be skipped if the render pipeline isn't ready.
     *
     * Some draws of objects can be skipped if the pipelines aren't ready. Others are more
     * crucial to draw, and so this can be set to force for the pipeline to become available.
     *
     * By default, this is true.
     */
    public setAllowSkippingIfPipelineNotReady(v: boolean): void {
        this._allowSkippingPipelineIfNotReady = v;
    }

    private setAttachmentFormatsFromRenderPass(device: GfxDevice, passRenderer: GfxRenderPass): void {
        const passDescriptor = device.queryRenderPass(passRenderer);

        let sampleCount = -1;
        for (let i = 0; i < passDescriptor.colorAttachments.length; i++) {
            const colorAttachmentDescriptor = passDescriptor.colorAttachments[i] !== null ? device.queryRenderTarget(passDescriptor.colorAttachments[i]!.renderTarget) : null;
            this._renderPipelineDescriptor.colorAttachmentFormats[i] = colorAttachmentDescriptor !== null ? colorAttachmentDescriptor.pixelFormat : null;
            if (colorAttachmentDescriptor !== null) {
                if (sampleCount === -1)
                    sampleCount = colorAttachmentDescriptor.sampleCount;
                else
                    assert(sampleCount === colorAttachmentDescriptor.sampleCount);
            }
        }

        const depthStencilAttachmentDescriptor = passDescriptor.depthStencilAttachment !== null ? device.queryRenderTarget(passDescriptor.depthStencilAttachment.renderTarget) : null;
        this._renderPipelineDescriptor.depthStencilAttachmentFormat = depthStencilAttachmentDescriptor !== null ? depthStencilAttachmentDescriptor.pixelFormat : null;
        if (depthStencilAttachmentDescriptor !== null) {
            if (sampleCount === -1)
                sampleCount = depthStencilAttachmentDescriptor.sampleCount;
            else
                assert(sampleCount === depthStencilAttachmentDescriptor.sampleCount);
        }

        assert(sampleCount > 0);
        this._renderPipelineDescriptor.sampleCount = sampleCount;
    }

    public drawOnPass(cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        const device = cache.device;
        this.setAttachmentFormatsFromRenderPass(device, passRenderer);

        const gfxPipeline = cache.createRenderPipeline(this._renderPipelineDescriptor);

        const pipelineReady = device.pipelineQueryReady(gfxPipeline);
        if (!pipelineReady) {
            if (this._allowSkippingPipelineIfNotReady)
                return;

            device.pipelineForceReady(gfxPipeline);
        }

        if (this.debugMarker !== null)
            passRenderer.beginDebugGroup(this.debugMarker);

        passRenderer.setPipeline(gfxPipeline);
        passRenderer.setVertexInput(this._renderPipelineDescriptor.inputLayout, this._vertexBuffers, this._indexBuffer);

        let uboIndex = 0;
        for (let i = 0; i < this._bindingDescriptors.length; i++) {
            const bindingDescriptor = this._bindingDescriptors[i];
            for (let j = 0; j < bindingDescriptor.uniformBufferBindings.length; j++)
                bindingDescriptor.uniformBufferBindings[j].buffer = assertExists(this._uniformBuffer.gfxBuffer);
            const gfxBindings = cache.createBindings(bindingDescriptor);
            const numBuffers = bindingDescriptor.bindingLayout.numUniformBuffers;
            passRenderer.setBindings(i, gfxBindings, this._dynamicUniformBufferByteOffsets.slice(uboIndex, uboIndex + numBuffers));
            uboIndex += numBuffers;
        }

        const indexed = this._indexBuffer !== null;
        if (this._drawInstanceCount > 1) {
            assert(indexed);
            passRenderer.drawIndexedInstanced(this._drawCount, this._drawStart, this._drawInstanceCount);
        } else if (indexed) {
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        } else {
            passRenderer.draw(this._drawCount, this._drawStart);
        }

        if (this.debugMarker !== null)
            passRenderer.endDebugGroup();
    }
}
//#endregion

//#region GfxRenderInstList
export const gfxRenderInstCompareNone = null;

export function gfxRenderInstCompareSortKey(a: GfxRenderInst, b: GfxRenderInst): number {
    return a.sortKey - b.sortKey;
}

export const enum GfxRenderInstExecutionOrder {
    Forwards,
    Backwards,
}

export type GfxRenderInstCompareFunc = (a: GfxRenderInst, b: GfxRenderInst) => number;

export class GfxRenderInstList {
    public renderInsts: GfxRenderInst[] = [];

    constructor(
        public compareFunction: GfxRenderInstCompareFunc | null = gfxRenderInstCompareSortKey,
        public executionOrder = GfxRenderInstExecutionOrder.Forwards,
    ) {
    }

    public submitRenderInst(renderInst: GfxRenderInst): void {
        renderInst.validate();
        this.renderInsts.push(renderInst);
    }

    public hasLateSamplerBinding(name: string): boolean {
        for (let i = 0; i < this.renderInsts.length; i++)
            if (this.renderInsts[i].hasLateSamplerBinding(name))
                return true;
        return false;
    }

    /**
     * Resolve sampler bindings for all render insts on this render inst list. See the
     * documentation for {@see GfxRenderInst.resolveLateSamplerBinding}.
     */
    public resolveLateSamplerBinding(name: string, binding: GfxSamplerBinding): void {
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].resolveLateSamplerBinding(name, binding);
    }

    public ensureSorted(): void {
        if (this.compareFunction !== null && this.renderInsts.length !== 0)
            this.renderInsts.sort(this.compareFunction);
    }

    private drawOnPassRendererNoReset(cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        this.ensureSorted();

        if (this.executionOrder === GfxRenderInstExecutionOrder.Forwards) {
            for (let i = 0; i < this.renderInsts.length; i++)
                this.renderInsts[i].drawOnPass(cache, passRenderer);
        } else {
            for (let i = this.renderInsts.length - 1; i >= 0; i--)
                this.renderInsts[i].drawOnPass(cache, passRenderer);
        }
    }

    public reset(): void {
        this.renderInsts.length = 0;
    }

    /**
     * Execute all scheduled render insts in this list onto the {@param GfxRenderPass},
     * using {@param device} and {@param cache} to create any device-specific resources
     * necessary to complete the draws.
     */
    public drawOnPassRenderer(cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        this.drawOnPassRendererNoReset(cache, passRenderer);
        this.reset();
    }
}
//#endregion

//#region GfxRenderInstManager
export class GfxRenderInstManager {
    public templateStack: GfxRenderInst[] = [];
    public currentList: GfxRenderInstList = null!;

    constructor(public gfxRenderCache: GfxRenderCache) {
    }

    /**
     * Creates a new {@see GfxRenderInst} object and returns it. If there is a template
     * pushed onto the template stack, then its values will be used as a base for this
     * render inst.
     */
    public newRenderInst(): GfxRenderInst {
        const renderInst = new GfxRenderInst();
        if (this.templateStack.length > 0)
            renderInst.copyFrom(this.getCurrentTemplate());
        return renderInst;
    }

    /**
     * Submits {@param renderInst} to the current render inst list. Note that
     * this assumes the render inst was fully filled in, so do not modify it
     * after submitting it.
     */
    public submitRenderInst(renderInst: GfxRenderInst): void {
        this.currentList.submitRenderInst(renderInst);
    }

    /**
     * Sets the currently active render inst list. This is the list that will
     * be used by {@see submitRenderInst}. This is provided as convenience so
     * you don't need to pass a {@see GfxRenderInstList} around at the same time
     * you pass the manager, you can also call {@see submitRenderInst} directly
     * on the provided list.
     */
    public setCurrentList(list: GfxRenderInstList): void {
        this.currentList = list;
    }

    /**
     * Pushes a new template render inst to the template stack. All properties set
     * on the topmost template on the template stack will be the defaults for both
     * for any future render insts created. Once done with a template, call
     * {@see popTemplateRenderInst} to pop it off the template stack.
     */
    public pushTemplate(): GfxRenderInst {
        const newTemplate = new GfxRenderInst();
        if (this.templateStack.length > 0)
            newTemplate.copyFrom(this.getCurrentTemplate());
        this.templateStack.push(newTemplate);
        return newTemplate;
    }

    public popTemplate(): void {
        this.templateStack.pop();
    }

    /**
     * Retrieves the current template render inst on the top of the template stack.
     */
    public getCurrentTemplate(): GfxRenderInst {
        return this.templateStack[this.templateStack.length - 1];
    }
}
//#endregion
