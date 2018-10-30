
import { GfxInputState, GfxRenderPass, GfxBindings, GfxRenderPipeline, GfxDevice, GfxBuffer, GfxSamplerBinding, GfxBindingLayoutDescriptor, GfxBufferBinding } from "../platform/GfxPlatform";
import { BufferLayout } from "../helpers/BufferHelpers";
import { align } from "../../util";
import { GfxRenderBuffer } from "./GfxRenderBuffer";

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
    // We only support drawing triangles. Other primitives are unsupported.
    // Use gfx/helpers/TopologyHelpers.ts to make an index buffer for other kinds of primitives.
    // public primitiveTopology: GfxPrimitiveTopology;
    public startIndex: number = 0;
    public indexCount: number = 0;
    public inputState: GfxInputState | null = null;
    public pipeline: GfxRenderPipeline | null = null;
    public uniformBufferOffsets: number[] = [];
    public samplerBindings: GfxSamplerBinding[] = [];

    // Should be modified internally.
    public $bindings: GfxBindings[] = [];
}

export class GfxRenderInstViewRenderer {
    private viewportWidth: number;
    private viewportHeight: number;

    constructor(private renderInsts: GfxRenderInst[], private gfxBindings: GfxBindings[]) {
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxBindings.length; i++)
            device.destroyBindings(this.gfxBindings[i]);
    }

    public setViewport(viewportWidth: number, viewportHeight: number): void {
        this.viewportWidth = viewportWidth;
        this.viewportHeight = viewportHeight;
    }

    public executeOnPass(passRenderer: GfxRenderPass): void {
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

            if (currentPipeline !== renderInst.pipeline) {
                passRenderer.setPipeline(renderInst.pipeline);
                currentPipeline = renderInst.pipeline;
            }

            if (currentInputState !== renderInst.inputState) {
                passRenderer.setInputState(renderInst.inputState);
                currentInputState = renderInst.inputState;
            }

            for (let j = 0; j < renderInst.$bindings.length; j++) {
                if (currentBindings[j] !== renderInst.$bindings[j]) {
                    passRenderer.setBindings(j, renderInst.$bindings[j]);
                    currentBindings[j] = renderInst.$bindings[j];
                }
            }

            passRenderer.draw(renderInst.indexCount, renderInst.startIndex);
        }
    }
}

export class GfxRenderInstBuilder {
    private templateStack: GfxRenderInst[] = [];
    private uniformBufferOffsets: number[] = [];
    private uniformBufferWordAlignment: number;
    private renderInsts: GfxRenderInst[] = [];

    constructor(device: GfxDevice, private bindingLayouts: GfxBindingLayoutDescriptor[], private uniformBuffers: GfxRenderBuffer[], private uniformBufferLayouts: BufferLayout[], ) {
        this.uniformBufferWordAlignment = device.queryLimits().uniformBufferWordAlignment;

        for (let i = 0; i < this.uniformBufferLayouts.length; i++)
            this.uniformBufferOffsets[i] = 0;
    }

    private newUniformBufferOffset(index: number): number {
        const offset = this.uniformBufferOffsets[index];
        const incrSize = align(this.uniformBufferLayouts[index].totalWordSize, this.uniformBufferWordAlignment);
        this.uniformBufferOffsets[index] += incrSize;
        return offset;
    }

    public newUniformBufferInstance(renderInst: GfxRenderInst, index: number): number {
        const offs = this.newUniformBufferOffset(index);
        renderInst.uniformBufferOffsets[index] = offs;
        return offs;
    }

    private assignRenderInst(dst: GfxRenderInst, src: GfxRenderInst) {
        dst.pipeline = src.pipeline;
        dst.inputState = src.inputState;
        dst.uniformBufferOffsets = src.uniformBufferOffsets.slice();
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const o = new GfxRenderInst();
        if (this.templateStack.length)
            this.assignRenderInst(o, this.templateStack[0]);
        this.templateStack.unshift(o);
        return o;
    }

    public popTemplateRenderInst(): void {
        this.templateStack.shift();
    }

    public newRenderInst(): GfxRenderInst {
        const o = new GfxRenderInst();
        this.assignRenderInst(o, this.templateStack[0]);
        this.renderInsts.push(o);
        return o;
    }

    public finish(device: GfxDevice): GfxRenderInstViewRenderer {
        const gfxBindings: GfxBindings[] = [];

        // Once we're finished building our RenderInsts, go through and assign buffers and bindings for all.
        for (let i = 0; i < this.uniformBuffers.length; i++)
            this.uniformBuffers[i].setWordCount(device, this.uniformBufferOffsets[i]);

        // Now assign bindings. This tries to be as conservative as it can in making sure it can create
        // as few bindings as possible, while obeying the layout.
        let currentBindings: GfxBindings[] = [];
        let currentBufferOffsets: number[] = [];
        let currentSamplerBindings: GfxSamplerBinding[] = [];

        for (let i = 0; i < this.renderInsts.length; i++) {
            const renderInst = this.renderInsts[i];

            let firstUniformBuffer = 0;
            let firstSamplerBinding = 0;
            for (let j = 0; j < this.bindingLayouts.length; j++) {
                const bindingLayout = this.bindingLayouts[j];

                const lastUniformBuffer = firstUniformBuffer + bindingLayout.numUniformBuffers;
                const lastSamplerBinding = firstSamplerBinding + bindingLayout.numSamplers;

                // Check whether we can reuse the last binding layout.
                let isCachedBindingValid = true;

                for (let k = firstUniformBuffer; k < lastUniformBuffer; k++) {
                    if (currentBufferOffsets[k] !== renderInst.uniformBufferOffsets[k]) {
                        currentBufferOffsets[k] = renderInst.uniformBufferOffsets[k];
                        isCachedBindingValid = false;
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
                    renderInst.$bindings[j] = currentBindings[j];
                } else {
                    const uniformBufferBindings: GfxBufferBinding[] = [];
                    for (let k = firstUniformBuffer; k < lastUniformBuffer; k++) {
                        const buffer = this.uniformBuffers[k].getGfxBuffer();
                        const wordOffset = currentBufferOffsets[k];
                        const wordCount = this.uniformBufferLayouts[k].totalWordSize;
                        uniformBufferBindings.push({ buffer, wordOffset, wordCount });
                    }

                    const samplerBindings = currentSamplerBindings.slice(firstSamplerBinding, lastSamplerBinding);
                    const bindings = device.createBindings(this.bindingLayouts[j], uniformBufferBindings, samplerBindings);
                    renderInst.$bindings[j] = bindings;
                    currentBindings[j] = bindings;
                    gfxBindings.push(bindings);
                }

                firstUniformBuffer = lastUniformBuffer;
                firstSamplerBinding = lastSamplerBinding;
            }
        }

        return new GfxRenderInstViewRenderer(this.renderInsts, gfxBindings);
    }
}
