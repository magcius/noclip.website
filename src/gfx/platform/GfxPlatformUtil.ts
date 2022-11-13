
import { GfxSamplerBinding, GfxBufferBinding, GfxBindingsDescriptor, GfxRenderPipelineDescriptor, GfxBindingLayoutDescriptor, GfxInputLayoutDescriptor, GfxVertexAttributeDescriptor, GfxProgram, GfxMegaStateDescriptor, GfxAttachmentState, GfxChannelBlendState, GfxSamplerDescriptor, GfxInputLayoutBufferDescriptor, GfxColor, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxFormat, GfxBindingLayoutSamplerDescriptor } from './GfxPlatform';
import { copyMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';

type EqualFunc<K> = (a: K, b: K) => boolean;
type CopyFunc<T> = (a: T) => T;

export function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

export function arrayEqual<T>(a: T[], b: T[], e: EqualFunc<T>): boolean {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (!e(a[i], b[i]))
            return false;
    return true;
}

export function gfxSamplerBindingCopy(a: Readonly<GfxSamplerBinding>): GfxSamplerBinding {
    const gfxSampler = a.gfxSampler, gfxTexture = a.gfxTexture, lateBinding = a.lateBinding;
    return { gfxSampler, gfxTexture, lateBinding };
}

export function gfxSamplerBindingNew(): GfxSamplerBinding {
    return { gfxSampler: null, gfxTexture: null, lateBinding: null };
}

export function gfxBufferBindingCopy(a: Readonly<GfxBufferBinding>): GfxBufferBinding {
    const buffer = a.buffer;
    const wordCount = a.wordCount;
    return { buffer, wordCount };
}

export function gfxBindingsDescriptorCopy(a: Readonly<GfxBindingsDescriptor>): GfxBindingsDescriptor {
    const bindingLayout = a.bindingLayout;
    const samplerBindings = arrayCopy(a.samplerBindings, gfxSamplerBindingCopy);
    const uniformBufferBindings = arrayCopy(a.uniformBufferBindings, gfxBufferBindingCopy);
    return { bindingLayout, samplerBindings, uniformBufferBindings };
}

function gfxBindingLayoutSamplerDescriptorCopy(a: Readonly<GfxBindingLayoutSamplerDescriptor>): GfxBindingLayoutSamplerDescriptor {
    const dimension = a.dimension, formatKind = a.formatKind, comparison = a.comparison === true;
    return { dimension, formatKind, comparison };
}

export function gfxBindingLayoutDescriptorCopy(a: Readonly<GfxBindingLayoutDescriptor>): GfxBindingLayoutDescriptor {
    const numSamplers = a.numSamplers;
    const numUniformBuffers = a.numUniformBuffers;
    const samplerEntries = a.samplerEntries !== undefined ? arrayCopy(a.samplerEntries!, gfxBindingLayoutSamplerDescriptorCopy) : undefined;
    return { numSamplers, numUniformBuffers, samplerEntries };
}

export function gfxRenderPipelineDescriptorCopy(a: Readonly<GfxRenderPipelineDescriptor>): GfxRenderPipelineDescriptor {
    const bindingLayouts = arrayCopy(a.bindingLayouts, gfxBindingLayoutDescriptorCopy);
    const inputLayout = a.inputLayout;
    const program = a.program;
    const topology = a.topology;
    const megaStateDescriptor = copyMegaState(a.megaStateDescriptor);
    const colorAttachmentFormats = a.colorAttachmentFormats.slice();
    const depthStencilAttachmentFormat = a.depthStencilAttachmentFormat;
    const sampleCount = a.sampleCount;
    return { bindingLayouts, inputLayout, megaStateDescriptor, program, topology, colorAttachmentFormats, depthStencilAttachmentFormat, sampleCount };
}

export function gfxVertexAttributeDescriptorCopy(a: Readonly<GfxVertexAttributeDescriptor>): GfxVertexAttributeDescriptor {
    const location = a.location, format = a.format, bufferIndex = a.bufferIndex, bufferByteOffset = a.bufferByteOffset;
    return { location, format, bufferIndex, bufferByteOffset };
}

export function gfxInputLayoutBufferDescriptorCopy(a: Readonly<GfxInputLayoutBufferDescriptor | null>): GfxInputLayoutBufferDescriptor | null {
    if (a !== null) {
        const byteStride = a.byteStride, frequency = a.frequency;
        return { byteStride, frequency };
    } else {
        return null;
    }
}

export function gfxInputLayoutDescriptorCopy(a: Readonly<GfxInputLayoutDescriptor>): GfxInputLayoutDescriptor {
    const vertexAttributeDescriptors = arrayCopy(a.vertexAttributeDescriptors, gfxVertexAttributeDescriptorCopy);
    const vertexBufferDescriptors = arrayCopy(a.vertexBufferDescriptors, gfxInputLayoutBufferDescriptorCopy);
    const indexBufferFormat = a.indexBufferFormat;
    return { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat };
}

function gfxBufferBindingEquals(a: Readonly<GfxBufferBinding>, b: Readonly<GfxBufferBinding>): boolean {
    return a.buffer === b.buffer && a.wordCount === b.wordCount;
}

function gfxSamplerBindingEquals(a: Readonly<GfxSamplerBinding | null>, b: Readonly<GfxSamplerBinding | null>): boolean {
    if (a === null) return b === null;
    if (b === null) return false;
    return a.gfxSampler === b.gfxSampler && a.gfxTexture === b.gfxTexture;
}

function gfxBindingLayoutSamplerDescriptorEqual(a: Readonly<GfxBindingLayoutSamplerDescriptor>, b: Readonly<GfxBindingLayoutSamplerDescriptor>): boolean {
    return a.dimension === b.dimension && a.formatKind === b.formatKind;
}

export function gfxBindingLayoutDescriptorEqual(a: Readonly<GfxBindingLayoutDescriptor>, b: Readonly<GfxBindingLayoutDescriptor>): boolean {
    if (a.numSamplers !== b.numSamplers) return false;
    if (a.numUniformBuffers !== b.numUniformBuffers) return false;
    if ((a.samplerEntries === undefined) !== (b.samplerEntries === undefined)) return false;
    if (a.samplerEntries !== undefined && !arrayEqual(a.samplerEntries!, b.samplerEntries!, gfxBindingLayoutSamplerDescriptorEqual)) return false;
    return true;
}

export function gfxBindingsDescriptorEquals(a: Readonly<GfxBindingsDescriptor>, b: Readonly<GfxBindingsDescriptor>): boolean {
    if (a.samplerBindings.length !== b.samplerBindings.length) return false;
    if (!arrayEqual(a.samplerBindings, b.samplerBindings, gfxSamplerBindingEquals)) return false;
    if (!arrayEqual(a.uniformBufferBindings, b.uniformBufferBindings, gfxBufferBindingEquals)) return false;
    if (!gfxBindingLayoutEquals(a.bindingLayout, b.bindingLayout)) return false;
    return true;
}

function gfxChannelBlendStateEquals(a: Readonly<GfxChannelBlendState>, b: Readonly<GfxChannelBlendState>): boolean {
    return a.blendMode == b.blendMode && a.blendSrcFactor === b.blendSrcFactor && a.blendDstFactor === b.blendDstFactor;
}

function gfxAttachmentStateEquals(a: Readonly<GfxAttachmentState>, b: Readonly<GfxAttachmentState>): boolean {
    if (!gfxChannelBlendStateEquals(a.rgbBlendState, b.rgbBlendState)) return false;
    if (!gfxChannelBlendStateEquals(a.alphaBlendState, b.alphaBlendState)) return false;
    if (a.channelWriteMask !== b.channelWriteMask) return false;
    return true;
}

function gfxMegaStateDescriptorEquals(a: GfxMegaStateDescriptor, b: GfxMegaStateDescriptor): boolean {
    if (!arrayEqual(a.attachmentsState, b.attachmentsState, gfxAttachmentStateEquals))
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

function gfxBindingLayoutEquals(a: Readonly<GfxBindingLayoutDescriptor>, b: Readonly<GfxBindingLayoutDescriptor>): boolean {
    return a.numSamplers === b.numSamplers && a.numUniformBuffers === b.numUniformBuffers;
}

function gfxProgramEquals(a: Readonly<GfxProgram>, b: Readonly<GfxProgram>): boolean {
    return a.ResourceUniqueId === b.ResourceUniqueId;
}

function gfxFormatEquals(a: GfxFormat | null, b: GfxFormat | null): boolean {
    return a === b;
}

export function gfxRenderPipelineDescriptorEquals(a: Readonly<GfxRenderPipelineDescriptor>, b: Readonly<GfxRenderPipelineDescriptor>): boolean {
    if (a.topology !== b.topology) return false;
    if (a.inputLayout !== b.inputLayout) return false;
    if (a.sampleCount !== b.sampleCount) return false;
    if (!gfxMegaStateDescriptorEquals(a.megaStateDescriptor, b.megaStateDescriptor)) return false;
    if (!gfxProgramEquals(a.program, b.program)) return false;
    if (!arrayEqual(a.bindingLayouts, b.bindingLayouts, gfxBindingLayoutEquals)) return false;
    if (!arrayEqual(a.colorAttachmentFormats, b.colorAttachmentFormats, gfxFormatEquals)) return false;
    if (a.depthStencilAttachmentFormat !== b.depthStencilAttachmentFormat) return false;
    return true;
}

export function gfxVertexAttributeDescriptorEquals(a: Readonly<GfxVertexAttributeDescriptor>, b: Readonly<GfxVertexAttributeDescriptor>): boolean {
    return (
        a.bufferIndex === b.bufferIndex &&
        a.bufferByteOffset === b.bufferByteOffset &&
        a.location === b.location &&
        a.format === b.format
    );
}

export function gfxInputLayoutBufferDescriptorEquals(a: Readonly<GfxInputLayoutBufferDescriptor | null>, b: Readonly<GfxInputLayoutBufferDescriptor | null>): boolean {
    if (a === null) return b === null;
    if (b === null) return false;
    return (
        a.byteStride === b.byteStride &&
        a.frequency === b.frequency
    );
}

export function gfxInputLayoutDescriptorEquals(a: Readonly<GfxInputLayoutDescriptor>, b: Readonly<GfxInputLayoutDescriptor>): boolean {
    if (a.indexBufferFormat !== b.indexBufferFormat) return false;
    if (!arrayEqual(a.vertexBufferDescriptors, b.vertexBufferDescriptors, gfxInputLayoutBufferDescriptorEquals)) return false;
    if (!arrayEqual(a.vertexAttributeDescriptors, b.vertexAttributeDescriptors, gfxVertexAttributeDescriptorEquals)) return false;
    return true;
}

export function gfxSamplerDescriptorEquals(a: Readonly<GfxSamplerDescriptor>, b: Readonly<GfxSamplerDescriptor>): boolean {
    return (
        a.wrapS === b.wrapS &&
        a.wrapT === b.wrapT &&
        a.wrapQ === b.wrapQ &&
        a.minFilter === b.minFilter &&
        a.magFilter === b.magFilter &&
        a.mipFilter === b.mipFilter &&
        a.minLOD === b.minLOD &&
        a.maxLOD === b.maxLOD &&
        a.maxAnisotropy === b.maxAnisotropy &&
        a.compareMode === b.compareMode
    );
}

export function gfxColorEqual(c0: Readonly<GfxColor>, c1: Readonly<GfxColor>): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

export function gfxColorCopy(dst: GfxColor, src: Readonly<GfxColor>): void {
    dst.r = src.r;
    dst.g = src.g;
    dst.b = src.b;
    dst.a = src.a;
}

export function gfxColorNewCopy(src: Readonly<GfxColor>): GfxColor {
    const { r, g, b, a } = src;
    return { r, g, b, a };
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

export function nullify<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : v;
}

// Requires that multiple is a power of two.
export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

export function alignNonPowerOfTwo(n: number, multiple: number): number {
    return (((n + multiple - 1) / multiple) | 0) * multiple;
}

export function fallbackUndefined<T>(v: T | null | undefined, fallback: T): T {
    return (v !== null && v !== undefined) ? v : fallback;
}
