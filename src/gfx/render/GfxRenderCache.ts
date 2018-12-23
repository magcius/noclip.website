
import { GfxBindingsDescriptor, GfxBindings, GfxDevice, GfxBufferBinding, GfxSamplerBinding, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxMegaStateDescriptor, GfxBindingLayoutDescriptor, GfxProgram } from "../platform/GfxPlatform";
import { HashMap, EqualFunc, nullHashFunc } from "../../HashMap";

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
    return a.sampler === b.sampler && a.texture === b.texture;
}

function gfxBindingsDescriptorEquals(a: GfxBindingsDescriptor, b: GfxBindingsDescriptor): boolean {
    if (a.bindingLayout !== b.bindingLayout) return false;
    if (!arrayEqual(a.uniformBufferBindings, b.uniformBufferBindings, bufferBindingEquals)) return false;
    if (!arrayEqual(a.samplerBindings, b.samplerBindings, samplerBindingEquals)) return false;
    return true;
}

function megaStateDescriptorEquals(a: GfxMegaStateDescriptor, b: GfxMegaStateDescriptor): boolean {
    return (
        a.blendDstFactor === b.blendDstFactor &&
        a.blendSrcFactor === b.blendSrcFactor &&
        a.blendMode === b.blendMode &&
        a.cullMode === b.cullMode &&
        a.depthCompare === b.depthCompare &&
        a.depthWrite === b.depthWrite &&
        a.frontFace === b.frontFace &&
        a.polygonOffset === b.polygonOffset
    );
}

function bindingLayoutEquals(a: GfxBindingLayoutDescriptor, b: GfxBindingLayoutDescriptor): boolean {
    return a.numSamplers === b.numSamplers && a.numUniformBuffers === b.numSamplers;
}

// XXX(jstpierre): giant hack!!!
// We need to cache programs at a higher level so we won't have to query program keys here.
let _device: GfxDevice;
function programEquals(a: GfxProgram, b: GfxProgram): boolean {
    return _device.queryProgram(a).uniqueKey === _device.queryProgram(b).uniqueKey;
}

function gfxRenderPipelineDescriptorEquals(a: GfxRenderPipelineDescriptor, b: GfxRenderPipelineDescriptor): boolean {
    if (a.topology !== b.topology) return false;
    if (a.inputLayout !== b.inputLayout) return false;
    if (!megaStateDescriptorEquals(a.megaStateDescriptor, b.megaStateDescriptor)) return false;
    if (!programEquals(a.program, b.program)) return false;
    if (!arrayEqual(a.bindingLayouts, b.bindingLayouts, bindingLayoutEquals)) return false;
    return true;
}

export class GfxRenderCache {
    private bindingsCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, nullHashFunc);
    private renderPipelinesCache = new HashMap<GfxRenderPipelineDescriptor, GfxRenderPipeline>(gfxRenderPipelineDescriptorEquals, nullHashFunc);

    public createBindings(device: GfxDevice, descriptor: GfxBindingsDescriptor): GfxBindings {
        let bindings = this.bindingsCache.get(descriptor);
        if (bindings === null) {
            bindings = device.createBindings(descriptor);
            this.bindingsCache.insert(descriptor, bindings);
        }
        return bindings;
    }

    public createRenderPipeline(device: GfxDevice, descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        _device = device;

        let renderPipeline = this.renderPipelinesCache.get(descriptor);
        if (renderPipeline === null) {
            renderPipeline = device.createRenderPipeline(descriptor);
            this.renderPipelinesCache.insert(descriptor, renderPipeline);
        }
        return renderPipeline;
    }

    public numBindings(): number {
        return this.bindingsCache.size();
    }

    public destroy(device: GfxDevice): void {
        for (const [descriptor, bindings] of this.bindingsCache.entries())
            device.destroyBindings(bindings);
        for (const [descriptor, renderPipeline] of this.renderPipelinesCache.entries())
            device.destroyRenderPipeline(renderPipeline);
        this.bindingsCache.clear();
        this.renderPipelinesCache.clear();
    }
}
