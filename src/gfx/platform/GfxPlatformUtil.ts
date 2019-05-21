
import { GfxSamplerBinding, GfxBufferBinding, GfxBindingsDescriptor } from './GfxPlatform';
import { CopyFunc } from '../../HashMap';

export function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

export function gfxSamplerBindingCopy(a: GfxSamplerBinding): GfxSamplerBinding {
    const { sampler, texture } = a;
    return { sampler, texture };
}

export function gfxBufferBindingCopy(a: GfxBufferBinding): GfxBufferBinding {
    const { buffer, wordOffset, wordCount } = a;
    return { buffer, wordOffset, wordCount };
}

export function gfxBindingsDescriptorCopy(a: GfxBindingsDescriptor): GfxBindingsDescriptor {
    const bindingLayout = a.bindingLayout;
    const samplerBindings = arrayCopy(a.samplerBindings, gfxSamplerBindingCopy);
    const uniformBufferBindings = arrayCopy(a.uniformBufferBindings, gfxBufferBindingCopy);
    return { bindingLayout, samplerBindings, uniformBufferBindings };
}
