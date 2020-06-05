
import { GfxSamplerBinding, GfxBufferBinding, GfxBindingsDescriptor, GfxRenderPipelineDescriptor, GfxBindingLayoutDescriptor, GfxInputLayoutDescriptor, GfxVertexAttributeDescriptor, GfxProgram, GfxMegaStateDescriptor, GfxAttachmentState, GfxChannelBlendState, GfxSamplerDescriptor, GfxInputLayoutBufferDescriptor, GfxColor, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from './GfxPlatform';
import { copyMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';

type EqualFunc<K> = (a: K, b: K) => boolean;
type CopyFunc<T> = (a: T) => T;

function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

function arrayEqual<T>(a: T[], b: T[], e: EqualFunc<T>): boolean {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (!e(a[i], b[i]))
            return false;
    return true;
}

export function gfxSamplerBindingCopy(a: GfxSamplerBinding): GfxSamplerBinding {
    const gfxSampler = a.gfxSampler;
    const gfxTexture = a.gfxTexture;
    const lateBinding = a.lateBinding;
    return { gfxSampler, gfxTexture, lateBinding };
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
    const sampleCount = a.sampleCount;
    return { bindingLayouts, inputLayout, megaStateDescriptor, program, topology, sampleCount };
}

export function gfxVertexAttributeDescriptorCopy(a: GfxVertexAttributeDescriptor): GfxVertexAttributeDescriptor {
    const location = a.location;
    const format = a.format;
    const bufferIndex = a.bufferIndex;
    const bufferByteOffset = a.bufferByteOffset;
    return { location, format, bufferIndex, bufferByteOffset };
}

export function gfxInputLayoutBufferDescriptorCopy(a: GfxInputLayoutBufferDescriptor | null): GfxInputLayoutBufferDescriptor | null {
    if (a !== null) {
        const byteStride = a.byteStride;
        const frequency = a.frequency;
        return { byteStride, frequency };
    } else {
        return null;
    }
}

export function gfxInputLayoutDescriptorCopy(a: GfxInputLayoutDescriptor): GfxInputLayoutDescriptor {
    const vertexAttributeDescriptors = arrayCopy(a.vertexAttributeDescriptors, gfxVertexAttributeDescriptorCopy);
    const vertexBufferDescriptors = arrayCopy(a.vertexBufferDescriptors, gfxInputLayoutBufferDescriptorCopy);
    const indexBufferFormat = a.indexBufferFormat;
    return { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat };
}

function gfxBufferBindingEquals(a: GfxBufferBinding, b: GfxBufferBinding): boolean {
    return a.buffer === b.buffer && a.wordCount === b.wordCount && a.wordOffset === b.wordOffset;
}

function gfxSamplerBindingEquals(a: GfxSamplerBinding | null, b: GfxSamplerBinding | null): boolean {
    if (a === null) return b === null;
    if (b === null) return false;
    return a.gfxSampler === b.gfxSampler && a.gfxTexture === b.gfxTexture;
}

export function gfxBindingsDescriptorEquals(a: GfxBindingsDescriptor, b: GfxBindingsDescriptor): boolean {
    if (a.samplerBindings.length !== b.samplerBindings.length) return false;
    if (!arrayEqual(a.samplerBindings, b.samplerBindings, gfxSamplerBindingEquals)) return false;
    if (!arrayEqual(a.uniformBufferBindings, b.uniformBufferBindings, gfxBufferBindingEquals)) return false;
    if (a.bindingLayout !== b.bindingLayout) return false;
    return true;
}

function gfxChannelBlendStateEquals(a: GfxChannelBlendState, b: GfxChannelBlendState): boolean {
    return a.blendMode == b.blendMode && a.blendSrcFactor === b.blendSrcFactor && a.blendDstFactor === b.blendDstFactor;
}

function gfxAttachmentsStateEquals(a: GfxAttachmentState, b: GfxAttachmentState): boolean {
    if (!gfxChannelBlendStateEquals(a.rgbBlendState, b.rgbBlendState)) return false;
    if (!gfxChannelBlendStateEquals(a.alphaBlendState, b.alphaBlendState)) return false;
    if (a.colorWriteMask !== b.colorWriteMask) return false;
    return true;
}

function gfxMegaStateDescriptorEquals(a: GfxMegaStateDescriptor, b: GfxMegaStateDescriptor): boolean {
    if (!arrayEqual(a.attachmentsState, b.attachmentsState, gfxAttachmentsStateEquals))
        return false;
    if (!gfxColorEqual(a.blendConstant, b.blendConstant))
        return false;

    return (
        a.depthCompare === b.depthCompare &&
        a.depthWrite === b.depthWrite &&
        a.stencilCompare === b.stencilCompare &&
        a.stencilWrite === b.stencilWrite &&
        a.stencilPassOp === b.stencilPassOp &&
        a.cullMode === b.cullMode &&
        a.frontFace === b.frontFace &&
        a.polygonOffset === b.polygonOffset
    );
}

function gfxBindingLayoutEquals(a: GfxBindingLayoutDescriptor, b: GfxBindingLayoutDescriptor): boolean {
    return a.numSamplers === b.numSamplers && a.numUniformBuffers === b.numUniformBuffers;
}

function gfxProgramEquals(a: GfxProgram, b: GfxProgram): boolean {
    return a.ResourceUniqueId === b.ResourceUniqueId;
}

export function gfxRenderPipelineDescriptorEquals(a: GfxRenderPipelineDescriptor, b: GfxRenderPipelineDescriptor): boolean {
    if (a.topology !== b.topology) return false;
    if (a.inputLayout !== b.inputLayout) return false;
    if (a.sampleCount !== b.sampleCount) return false;
    if (!gfxMegaStateDescriptorEquals(a.megaStateDescriptor, b.megaStateDescriptor)) return false;
    if (!gfxProgramEquals(a.program, b.program)) return false;
    if (!arrayEqual(a.bindingLayouts, b.bindingLayouts, gfxBindingLayoutEquals)) return false;
    return true;
}

export function gfxVertexAttributeDescriptorEquals(a: GfxVertexAttributeDescriptor, b: GfxVertexAttributeDescriptor): boolean {
    return (
        a.bufferIndex === b.bufferIndex &&
        a.bufferByteOffset === b.bufferByteOffset &&
        a.location === b.location &&
        a.format === b.format
    );
}

export function gfxInputLayoutBufferDescriptorEquals(a: GfxInputLayoutBufferDescriptor | null, b: GfxInputLayoutBufferDescriptor | null): boolean {
    if (a === null) return b === null;
    if (b === null) return false;
    return (
        a.byteStride === b.byteStride &&
        a.frequency === b.frequency
    );
}

export function gfxInputLayoutDescriptorEquals(a: GfxInputLayoutDescriptor, b: GfxInputLayoutDescriptor): boolean {
    if (a.indexBufferFormat !== b.indexBufferFormat) return false;
    if (!arrayEqual(a.vertexBufferDescriptors, b.vertexBufferDescriptors, gfxInputLayoutBufferDescriptorEquals)) return false;
    if (!arrayEqual(a.vertexAttributeDescriptors, b.vertexAttributeDescriptors, gfxVertexAttributeDescriptorEquals)) return false;
    return true;
}

export function gfxSamplerDescriptorEquals(a: GfxSamplerDescriptor, b: GfxSamplerDescriptor): boolean {
    return (
        a.wrapS === b.wrapS &&
        a.wrapT === b.wrapT &&
        a.minFilter === b.minFilter &&
        a.magFilter === b.magFilter &&
        a.mipFilter === b.mipFilter &&
        a.minLOD === b.minLOD &&
        a.maxLOD === b.maxLOD
    );
}

// Copied from toplevel util.ts

export function assert(b: boolean, message: string = ""): asserts b {
    if (!b) {
        console.error(new Error().stack);
        throw new Error(`Assert fail: ${message}`);
    }
}

export function assertExists<T>(v: T | null | undefined): T {
    if (v !== undefined && v !== null)
        return v;
    else
        throw new Error("Missing object");
}

export function gfxColorEqual(c0: GfxColor, c1: GfxColor): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

export function gfxColorCopy(c0: GfxColor, c1: GfxColor): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

export function range(start: number, count: number): number[] {
    const L: number[] = [];
    for (let i = start; i < start + count; i++)
        L.push(i);
    return L;
}

// Eat your heart out, npm.
export function leftPad(S: string, spaces: number, ch: string = '0'): string {
    while (S.length < spaces)
        S = `${ch}${S}`;
    return S;
}

export function nArray<T>(n: number, c: () => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c();
    return d;
}
