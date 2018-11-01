
import { GfxInputState, GfxRenderPass, GfxBindings, GfxRenderPipeline, GfxDevice, GfxSamplerBinding, GfxBindingLayoutDescriptor, GfxBufferBinding, GfxProgram, GfxPrimitiveTopology } from "../platform/GfxPlatform";
import { align, assertExists } from "../../util";
import { GfxRenderBuffer } from "./GfxRenderBuffer";
import { RenderFlags } from "../helpers/RenderFlagsHelpers";
import { TextureMapping } from "../../TextureHolder";
import { DeviceProgramReflection } from "../../Program";

// The "Render" subsystem is a high-level scene graph, built on top of gfx/platform and gfx/helpers.
// Similar to bgfx and T3, it implements a bare minimum set of features for high performance graphics.

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

function makeDepthKey(depth: number, maxDepth: number = 200) {
    // Create a normalized depth key.
    const normalizedDepth = clamp(depth, 0, maxDepth);
    const depthKey = (normalizedDepth * ((1 << 16) - 1)) >>> 2;
    return depthKey;
}

export function makeSortKey(layer: number, depth: number, programKey: number): number {
    const depthKey = makeDepthKey(depth);
    return (((layer & 0xFF) << 24) |
            ((depthKey & 0xFFFF) << 16) |
            ((programKey & 0xFF)));
}

// The finished, low-level instance of a draw call. This is what's sorted and executed.
export class GfxRenderInst {
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
    public uniformBufferBindings: GfxBufferBinding[] = [];
    public samplerBindingsDirty: boolean = false;
    public samplerBindings: GfxSamplerBinding[] = [];

    public setPipelineDirect(pipeline: GfxRenderPipeline): void {
        this.pipeline = pipeline;
    }

    public drawTriangles(count: number, startVertex: number = 0) {
        this._drawIndexed = false;
        this._drawStart = startVertex;
        this._drawCount = count;
    }

    public drawIndexes(indexCount: number, startIndex: number = 0) {
        this._drawIndexed = true;
        this._drawStart = startIndex;
        this._drawCount = indexCount;
    }

    public fillBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            if (!this.samplerBindings[i] || this.samplerBindings[i].texture !== m[i].gfxTexture || this.samplerBindings[i].sampler !== m[i].gfxSampler) {
                this.samplerBindings[i] = { texture: m[i].gfxTexture, sampler: m[i].gfxSampler };
                this.samplerBindingsDirty = true;
            }
        }
    }

    // Internal.
    public destroy(device: GfxDevice): void {
        if (this.pipeline !== null)
            device.destroyRenderPipeline(this.pipeline);
    }
}

export class GfxRenderInstViewRenderer {
    private viewportWidth: number;
    private viewportHeight: number;
    public renderInsts: GfxRenderInst[] = [];
    public gfxBindings: GfxBindings[] = []

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxBindings.length; i++)
            device.destroyBindings(this.gfxBindings[i]);
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].destroy(device);
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
                // Rebuild. TODO(jstpierre): Maybe cache these more visibly?
                const uniformBufferBindings = renderInst.uniformBufferBindings.slice(firstUniformBufferBinding, firstUniformBufferBinding + bindingLayout.numUniformBuffers);
                const samplerBindings = renderInst.samplerBindings.slice(firstSamplerBinding, firstSamplerBinding + bindingLayout.numSamplers);
                const bindings = device.createBindings(bindingLayout, uniformBufferBindings, samplerBindings);
                renderInst.bindings[i] = bindings;
                this.gfxBindings.push(bindings);
            }
            firstUniformBufferBinding += bindingLayout.numUniformBuffers;
            firstSamplerBinding += bindingLayout.numSamplers;
        }
        renderInst.samplerBindingsDirty = false;
    }

    public executeOnPass(device: GfxDevice, passRenderer: GfxRenderPass): void {
        // Sort our instances.
        this.renderInsts.sort((a, b) => a.sortKey - b.sortKey);

        passRenderer.setViewport(this.viewportWidth, this.viewportHeight);

        let currentPipeline: GfxRenderPipeline | null = null;
        let currentInputState: GfxInputState | null = null;
        let currentBindings: GfxBindings[] = [];

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

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

            for (let j = 0; j < renderInst.bindings.length; j++) {
                if (currentBindings[j] !== renderInst.bindings[j]) {
                    passRenderer.setBindings(j, renderInst.bindings[j]);
                    currentBindings[j] = renderInst.bindings[j];
                }
            }

            if (renderInst._drawIndexed)
                passRenderer.drawIndexed(renderInst._drawCount, renderInst._drawStart);
            else
                passRenderer.draw(renderInst._drawCount, renderInst._drawStart);
        }
    }
}

export class GfxRenderInstBuilder {
    private templateStack: GfxRenderInst[] = [];
    private uniformBufferOffsets: number[] = [];
    private uniformBufferWordAlignment: number;
    private renderInsts: GfxRenderInst[] = [];

    constructor(device: GfxDevice, public programReflection: DeviceProgramReflection, public bindingLayouts: GfxBindingLayoutDescriptor[], public uniformBuffers: GfxRenderBuffer[]) {
        this.uniformBufferWordAlignment = device.queryLimits().uniformBufferWordAlignment;

        for (let i = 0; i < this.programReflection.uniformBufferLayouts.length; i++)
            this.uniformBufferOffsets[i] = 0;

        const baseRenderInst = new GfxRenderInst();
        baseRenderInst.renderFlags = new RenderFlags();
        this.templateStack.push(baseRenderInst);
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

    private assignRenderInst(dst: GfxRenderInst, src: GfxRenderInst) {
        dst.sortKey = src.sortKey;
        dst.gfxProgram = src.gfxProgram;
        dst.samplerBindings = src.samplerBindings;
        dst.inputState = src.inputState;
        dst.pipeline = src.pipeline;
        dst.uniformBufferOffsets = src.uniformBufferOffsets.slice();
        dst.renderFlags = new RenderFlags(src.renderFlags);
    }

    public newTemplateRenderInst(): GfxRenderInst {
        const o = new GfxRenderInst();
        this.assignRenderInst(o, this.templateStack[0]);
        return o;
    }

    public pushTemplateRenderInst(o: GfxRenderInst = null): GfxRenderInst {
        if (o === null)
            o = this.newTemplateRenderInst();
        this.templateStack.unshift(o);
        return o;
    }

    public popTemplateRenderInst(): void {
        this.templateStack.shift();
    }

    public newRenderInst(): GfxRenderInst {
        const o = this.newTemplateRenderInst();
        this.renderInsts.push(o);
        return o;
    }

    public finish(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer) {
        // Once we're finished building our RenderInsts, go through and assign buffers and bindings for all.
        for (let i = 0; i < this.uniformBuffers.length; i++)
            this.uniformBuffers[i].setWordCount(device, this.uniformBufferOffsets[i]);

        // Now assign bindings. This tries to be as conservative as it can in making sure it can create
        // as few bindings as possible, while obeying the layout.
        let currentBindings: GfxBindings[] = [];
        let currentUniformBufferOffsets: number[] = [];
        let currentUniformBufferBindings: GfxBufferBinding[] = [];
        let currentSamplerBindings: GfxSamplerBinding[] = [];

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
            }

            let firstUniformBuffer = 0;
            let firstSamplerBinding = 0;
            for (let j = 0; j < this.bindingLayouts.length; j++) {
                const bindingLayout = this.bindingLayouts[j];

                const lastUniformBuffer = firstUniformBuffer + bindingLayout.numUniformBuffers;
                const lastSamplerBinding = firstSamplerBinding + bindingLayout.numSamplers;

                // Check whether we can reuse the last binding layout.
                let isCachedBindingValid = true;

                for (let k = firstUniformBuffer; k < lastUniformBuffer; k++) {
                    if (currentUniformBufferOffsets[k] !== renderInst.uniformBufferOffsets[k]) {
                        currentUniformBufferOffsets[k] = renderInst.uniformBufferOffsets[k];
                        isCachedBindingValid = false;

                        // Recreate binding and assign.
                        const { buffer, wordOffset } = this.uniformBuffers[k].getGfxBuffer(currentUniformBufferOffsets[k]);
                        assertExists(buffer);
                        const wordCount = this.programReflection.uniformBufferLayouts[k].totalWordSize;
                        currentUniformBufferBindings[k] = { buffer, wordOffset, wordCount };
                    }
                }

                for (let k = firstSamplerBinding; k < lastSamplerBinding; k++) {
                    // TODO(jstpierre): I know this comparison will always fail.
                    if (currentSamplerBindings[k] !== renderInst.samplerBindings[k]) {
                        currentSamplerBindings[k] = renderInst.samplerBindings[k];
                        isCachedBindingValid = false;
                    }
                }

                if (isCachedBindingValid) {
                    // Reuse existing binding.
                    renderInst.bindings[j] = currentBindings[j];
                } else {
                    const samplerBindings = currentSamplerBindings.slice(firstSamplerBinding, lastSamplerBinding);
                    const uniformBufferBindings = currentUniformBufferBindings.slice(firstUniformBuffer, lastUniformBuffer);
                    const bindings = device.createBindings(this.bindingLayouts[j], uniformBufferBindings, samplerBindings);
                    renderInst.bindings[j] = bindings;
                    currentBindings[j] = bindings;
                    viewRenderer.gfxBindings.push(bindings);
                }

                firstUniformBuffer = lastUniformBuffer;
                firstSamplerBinding = lastSamplerBinding;
            }

            // Save off our uniform buffer bindings in case we need to rebind in the future.
            renderInst.bindingLayouts = this.bindingLayouts;
            renderInst.uniformBufferBindings = currentUniformBufferBindings.slice();
            viewRenderer.renderInsts.push(renderInst);
        }
    }
}
