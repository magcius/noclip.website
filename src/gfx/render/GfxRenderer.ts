
import { GfxInputState, GfxRenderPass, GfxBindings, GfxRenderPipeline, GfxDevice, GfxSamplerBinding, GfxBindingLayoutDescriptor, GfxBufferBinding, GfxProgram, GfxPrimitiveTopology, GfxSampler, GfxBindingsDescriptor } from "../platform/GfxPlatform";
import { align, assertExists, assert } from "../../util";
import { GfxRenderBuffer } from "./GfxRenderBuffer";
import { RenderFlags } from "../helpers/RenderFlagsHelpers";
import { TextureMapping } from "../../TextureHolder";
import { HashMap, EqualFunc, nullHashFunc } from "../../HashMap";
import { DeviceProgramReflection } from "../../Program";

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


// Suggested values for the "layer" of makeSortKey. These are rough groups, and you can define your
// orders within the rough groups (e.g. you might use BACKGROUND + 1, or BACKGROUND + 2).
// TRANSLUCENT is meant to be used as a bitflag, and changes the behavior of the generic sort key
// functions like makeSortKey and setSortKeyDepth.
export const enum GfxRendererLayer {
    BACKGROUND = 0x00,
    ALPHA_TEST = 0x10,
    OPAQUE = 0x20,
    TRANSLUCENT = 0x40,
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

const MAX_DEPTH = 500;

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
// Indexed:     0TLLLLLL IIIIIIII IIIIIIII IIIIIIII
// Opaque:      00LLLLLL DDDDDDDD DDDDDDPP PPPPPPDD
// Translucent: 01LLLLLL DDDDDDDD DDDDDDDD PPPPPPPP

export function makeSortKeyOpaque(layer: number, programKey: number): number {
    return ((layer & 0xFF) << 24) | ((programKey & 0xFF) << 2);
}

export function setSortKeyOpaqueDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return (sortKey & 0xFF0003FC) | ((depthKey & 0xFFFC) << 8) | (depthKey & 0x0003);
}

export function makeSortKeyTranslucent(layer: number, programKey: number): number {
    return ((layer & 0xFF) << 24) | (programKey & 0xFF);
}

export function setSortKeyTranslucentDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return (sortKey & 0xFF0000FF) | (depthKey);
}

export function makeSortKey(layer: GfxRendererLayer, programKey: number): number {
    if (layer & GfxRendererLayer.TRANSLUCENT)
        return makeSortKeyTranslucent(layer, programKey);
    else
        return makeSortKeyOpaque(layer, programKey);
}

export function setSortKeyDepth(sortKey: number, depthKey: number): number {
    const isTranslucent = (sortKey >>> 31) & 1;
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

function assignRenderInst(dst: GfxRenderInst, src: GfxRenderInst): void {
    dst.sortKey = src.sortKey;
    dst.passMask = src.passMask;
    dst.gfxProgram = src.gfxProgram;
    dst.samplerBindings = src.samplerBindings.slice();
    dst.inputState = src.inputState;
    dst.pipeline = src.pipeline;
    dst.uniformBufferOffsets = src.uniformBufferOffsets.slice();
    dst.renderFlags = new RenderFlags(src.renderFlags);
}

// The finished, low-level instance of a draw call. This is what's sorted and executed.
// TODO(jstpierre): Is this class too big?
export class GfxRenderInst {
    public destroyed: boolean = false;
    public visible: boolean = true;
    public sortKey: number = 0;

    // Draw calls.
    // We only support drawing triangles. Other primitives are unsupported.
    // Use gfx/helpers/TopologyHelpers.ts to make an index buffer for other kinds of primitives.
    // public _primitiveTopology: GfxPrimitiveTopology;
    // Internal state.
    public _drawIndexed: boolean;
    public _drawStart: number = 0;
    public _drawCount: number = 0;
    public passMask: number = 1;

    // Pipeline building.
    public inputState: GfxInputState | null = null;
    public gfxProgram: GfxProgram | null = null;
    public renderFlags: RenderFlags;
    public pipeline: GfxRenderPipeline | null = null;

    // Debugging.
    public name: string = '';

    // Internal.
    public bindings: GfxBindings[] = [];
    public bindingLayouts: GfxBindingLayoutDescriptor[] = [];
    public uniformBufferOffsets: number[] = [];
    public uniformBufferOffsetGroups: number[][] = [];
    public uniformBufferBindings: GfxBufferBinding[] = [];
    public samplerBindingsDirty: boolean = false;
    public samplerBindings: GfxSamplerBinding[] = [];

    constructor(other: GfxRenderInst = null) {
        if (other)
            assignRenderInst(this, other);
    }

    public destroy(): void {
        this.destroyed = true;
    }

    public setPipelineDirect(pipeline: GfxRenderPipeline): void {
        this.pipeline = pipeline;
    }

    public drawTriangles(vertexCount: number, firstVertex: number = 0) {
        this._drawIndexed = false;
        this._drawStart = firstVertex;
        this._drawCount = vertexCount;
    }

    public drawIndexes(indexCount: number, firstIndex: number = 0) {
        this._drawIndexed = true;
        this._drawStart = firstIndex;
        this._drawCount = indexCount;
    }

    public setSamplerBindings(m: GfxSamplerBinding[], firstSampler: number = 0): void {
        for (let i = 0; i < m.length; i++) {
            const j = firstSampler + i;
            if (!this.samplerBindings[j] || this.samplerBindings[j].texture !== m[i].texture || this.samplerBindings[j].sampler !== m[i].sampler) {
                this.samplerBindings[j] = m[i];
                this.samplerBindingsDirty = true;
            }
        }
    }

    public setSamplerBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            if (!this.samplerBindings[i] || this.samplerBindings[i].texture !== m[i].gfxTexture || this.samplerBindings[i].sampler !== m[i].gfxSampler) {
                this.samplerBindings[i] = { texture: m[i].gfxTexture, sampler: m[i].gfxSampler };
                this.samplerBindingsDirty = true;
            }
        }
    }
}

export class GfxRenderInstViewRenderer {
    private viewportWidth: number;
    private viewportHeight: number;
    public renderInsts: GfxRenderInst[] = [];
    public gfxBindings: GfxBindings[] = []
    public gfxPipelines: GfxRenderPipeline[] = [];

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxBindings.length; i++)
            device.destroyBindings(this.gfxBindings[i]);
        for (let i = 0; i < this.gfxPipelines.length; i++)
            device.destroyRenderPipeline(this.gfxPipelines[i]);
    }

    public setViewport(viewportWidth: number, viewportHeight: number): void {
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
    }

    private rebuildBindingsForNewSampler(device: GfxDevice, renderInst: GfxRenderInst): void {
        let firstUniformBufferBinding = 0;
        let firstSamplerBinding = 0;
        for (let i = 0; i < renderInst.bindingLayouts.length; i++) {
            const bindingLayout = renderInst.bindingLayouts[i];
            if (bindingLayout.numSamplers > 0) {
                // Rebuild. TODO(jstpierre): Cache.
                const uniformBufferBindings = renderInst.uniformBufferBindings.slice(firstUniformBufferBinding, firstUniformBufferBinding + bindingLayout.numUniformBuffers);
                const samplerBindings = renderInst.samplerBindings.slice(firstSamplerBinding, firstSamplerBinding + bindingLayout.numSamplers);
                const bindings = device.createBindings({ bindingLayout, uniformBufferBindings, samplerBindings });
                renderInst.bindings[i] = bindings;
                this.gfxBindings.push(bindings);
            }
            firstUniformBufferBinding += bindingLayout.numUniformBuffers;
            firstSamplerBinding += bindingLayout.numSamplers;
        }
        renderInst.samplerBindingsDirty = false;
    }

    public executeOnPass(device: GfxDevice, passRenderer: GfxRenderPass, passMask: number = 1): void {
        // Kill any destroyed instances.
        for (let i = this.renderInsts.length - 1; i >= 0; i--) {
            if (this.renderInsts[i].destroyed)
                this.renderInsts.splice(i, 1);
        }

        // Sort our instances.
        this.renderInsts.sort((a, b) => a.sortKey - b.sortKey);

        passRenderer.setViewport(this.viewportWidth, this.viewportHeight);

        let currentPipeline: GfxRenderPipeline | null = null;
        let currentInputState: GfxInputState | null = null;

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            if ((renderInst.passMask & passMask) === 0)
                continue;

            if (!renderInst.visible)
                continue;

            if (renderInst.samplerBindingsDirty)
                this.rebuildBindingsForNewSampler(device, renderInst);

            if (currentPipeline !== renderInst.pipeline) {
                passRenderer.setPipeline(renderInst.pipeline);
                currentPipeline = renderInst.pipeline;
            }

            if (currentInputState !== renderInst.inputState) {
                passRenderer.setInputState(renderInst.inputState);
                currentInputState = renderInst.inputState;
            }

            for (let j = 0; j < renderInst.bindings.length; j++)
                passRenderer.setBindings(j, renderInst.bindings[j], renderInst.uniformBufferOffsetGroups[j]);

            if (renderInst._drawIndexed)
                passRenderer.drawIndexed(renderInst._drawCount, renderInst._drawStart);
            else
                passRenderer.draw(renderInst._drawCount, renderInst._drawStart);
        }
    }
}

function arrayEqual<T>(a: T[], b: T[], e: EqualFunc<T>): boolean {
    if (a.length !== b.length) return false;
    for (let i = a.length - 1; i >= 0; i--)
        if (!e(a[i], b[i]))
            return false;
    return true;
}

function bufferBindingEquals(a: GfxBufferBinding, b: GfxBufferBinding): boolean {
    return a.buffer === b.buffer && a.wordCount === b.wordCount && a.wordOffset === b.wordOffset;
}

function samplerBindingEquals(a: GfxSamplerBinding, b: GfxSamplerBinding): boolean {
    if (a === undefined) return b === undefined;
    if (b === undefined) return false;
    return a.sampler === b.sampler && a.texture === b.texture;
}

function gfxBindingsDescriptorEquals(a: GfxBindingsDescriptor, b: GfxBindingsDescriptor): boolean {
    if (a.bindingLayout !== b.bindingLayout) return false;
    if (!arrayEqual(a.uniformBufferBindings, b.uniformBufferBindings, bufferBindingEquals)) return false;
    if (!arrayEqual(a.samplerBindings, b.samplerBindings, samplerBindingEquals)) return false;
    return true;
}

export class GfxRenderInstBuilder {
    private uniformBufferOffsets: number[] = [];
    private uniformBufferWordAlignment: number;
    private renderInsts: GfxRenderInst[] = [];
    private templateStack: GfxRenderInst[] = [];
    private bindingCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, nullHashFunc);

    constructor(device: GfxDevice, public programReflection: DeviceProgramReflection, public bindingLayouts: GfxBindingLayoutDescriptor[], public uniformBuffers: GfxRenderBuffer[]) {
        this.uniformBufferWordAlignment = device.queryLimits().uniformBufferWordAlignment;

        for (let i = 0; i < this.programReflection.uniformBufferLayouts.length; i++)
            this.uniformBufferOffsets[i] = 0;

        const baseRenderInst = this.pushTemplateRenderInst();
        baseRenderInst.name = "base render inst";
        baseRenderInst.renderFlags = new RenderFlags();
    }

    public newUniformBufferOffset(index: number): number {
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

    private createBindings(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer, bindingLayout: GfxBindingLayoutDescriptor, uniformBufferBindings: GfxBufferBinding[], samplerBindings: GfxSamplerBinding[]): GfxBindings {
        const descriptor: GfxBindingsDescriptor = { bindingLayout, uniformBufferBindings, samplerBindings, };
        let bindings: GfxBindings = this.bindingCache.get(descriptor);
        if (bindings === null) {
            bindings = device.createBindings(descriptor);
            viewRenderer.gfxBindings.push(bindings);
            this.bindingCache.insert(descriptor, bindings);
        }
        return bindings;
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        assert(this.templateStack.length === 1);

        // Once we're finished building our RenderInsts, go through and assign buffers and bindings for all.
        for (let i = 0; i < this.uniformBuffers.length; i++)
            this.uniformBuffers[i].setWordCount(device, this.uniformBufferOffsets[i]);

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            // Construct a pipeline if we need one.
            // TODO(jstpierre): Cache similar pipelines.
            if (renderInst.pipeline === null) {
                const inputLayout = renderInst.inputState !== null ? device.queryInputState(renderInst.inputState).inputLayout : null;
                const pipeline = device.createRenderPipeline({
                    topology: GfxPrimitiveTopology.TRIANGLES,
                    program: renderInst.gfxProgram,
                    bindingLayouts: this.bindingLayouts,
                    inputLayout,
                    megaStateDescriptor: renderInst.renderFlags.resolveMegaState(),
                });
                renderInst.pipeline = pipeline;
                viewRenderer.gfxPipelines.push(pipeline);
            }

            // Uniform buffer bindings.
            for (let j = 0; j < this.uniformBuffers.length; j++) {
                const { buffer } = this.uniformBuffers[j].getGfxBuffer(renderInst.uniformBufferOffsets[j]);
                assertExists(buffer);

                const wordCount = this.programReflection.uniformBufferLayouts[j].totalWordSize;
                renderInst.uniformBufferBindings[j] = { buffer, wordOffset: 0, wordCount };
            }

            let firstUniformBuffer = 0;
            let firstSamplerBinding = 0;
            for (let j = 0; j < this.bindingLayouts.length; j++) {
                const bindingLayout = this.bindingLayouts[j];

                const lastUniformBuffer = firstUniformBuffer + bindingLayout.numUniformBuffers;
                const lastSamplerBinding = firstSamplerBinding + bindingLayout.numSamplers;

                const samplerBindings = renderInst.samplerBindings.slice(firstSamplerBinding, lastSamplerBinding);
                const uniformBufferBindings = renderInst.uniformBufferBindings.slice(firstUniformBuffer, lastUniformBuffer);
                const bindings = this.createBindings(device, viewRenderer, this.bindingLayouts[j], uniformBufferBindings, samplerBindings);
                renderInst.bindings[j] = bindings;

                // Uniform buffer offset groups.
                renderInst.uniformBufferOffsetGroups[j] = Array(bindingLayout.numUniformBuffers);
                for (let k = firstUniformBuffer; k < lastUniformBuffer; k++) {
                    const k0 = k - firstUniformBuffer;
                    const { wordOffset } = this.uniformBuffers[k].getGfxBuffer(renderInst.uniformBufferOffsets[k]);
                    renderInst.uniformBufferOffsetGroups[j][k0] = wordOffset;
                }

                firstUniformBuffer = lastUniformBuffer;
                firstSamplerBinding = lastSamplerBinding;
            }

            // Save off our uniform buffer bindings in case we need to rebind in the future.
            renderInst.bindingLayouts = this.bindingLayouts;
            viewRenderer.renderInsts.push(renderInst);
        }

        this.renderInsts.length = 0;
        console.log(`Stats: ${viewRenderer.gfxBindings.length} Bindings`);
    }
}
