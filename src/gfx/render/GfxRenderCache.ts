
import { GfxBindingsDescriptor, GfxBindings, GfxDevice, GfxBufferBinding, GfxSamplerBinding } from "../platform/GfxPlatform";
import { HashMap, EqualFunc, nullHashFunc } from "../../HashMap";
import { threadId } from "worker_threads";

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

export class GfxRenderCache {
    private bindingsCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, nullHashFunc);

    public createBindings(device: GfxDevice, descriptor: GfxBindingsDescriptor): GfxBindings {
        let bindings = this.bindingsCache.get(descriptor);
        if (bindings === null) {
            bindings = device.createBindings(descriptor);
            this.bindingsCache.insert(descriptor, bindings);
        }
        return bindings;
    }

    public numBindings(): number {
        return this.bindingsCache.size();
    }

    public destroy(device: GfxDevice): void {
        for (const [descriptor, bindings] of this.bindingsCache.entries())
            device.destroyBindings(bindings);
    }
}
