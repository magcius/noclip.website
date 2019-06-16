
import { GfxSamplerBinding, GfxBufferBinding, GfxBindingsDescriptor, GfxRenderPipelineDescriptor, GfxBindingLayoutDescriptor } from './GfxPlatform';
import { copyMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';

export type CopyFunc<T> = (a: T) => T;

export function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

export function gfxSamplerBindingCopy(a: GfxSamplerBinding): GfxSamplerBinding {
    const gfxSampler = a.gfxSampler;
    const gfxTexture = a.gfxTexture;
    return { gfxSampler, gfxTexture };
}

export function gfxBufferBindingCopy(a: GfxBufferBinding): GfxBufferBinding {
    const buffer = a.buffer;
    const wordOffset = a.wordOffset;
    const wordCount = a.wordCount;
    return { buffer, wordOffset, wordCount };
}

export function gfxBindingsDescriptorCopy(a: GfxBindingsDescriptor): GfxBindingsDescriptor {
    const bindingLayout = a.bindingLayout;
    const samplerBindings = arrayCopy(a.samplerBindings, gfxSamplerBindingCopy);
    const uniformBufferBindings = arrayCopy(a.uniformBufferBindings, gfxBufferBindingCopy);
    return { bindingLayout, samplerBindings, uniformBufferBindings };
}

export function gfxBindingLayoutDescriptorCopy(a: GfxBindingLayoutDescriptor): GfxBindingLayoutDescriptor {
    const numSamplers = a.numSamplers;
    const numUniformBuffers = a.numUniformBuffers;
    return { numSamplers, numUniformBuffers };
}

export function gfxRenderPipelineDescriptorCopy(a: GfxRenderPipelineDescriptor): GfxRenderPipelineDescriptor {
    const bindingLayouts = arrayCopy(a.bindingLayouts, gfxBindingLayoutDescriptorCopy);
    const inputLayout = a.inputLayout;
    const program = a.program;
    const topology = a.topology;
    const megaStateDescriptor = copyMegaState(a.megaStateDescriptor);
    return { bindingLayouts, inputLayout, megaStateDescriptor, program, topology };
}
