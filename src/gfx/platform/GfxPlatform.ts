
// This provides a "sane" low-level API for me to render to, kind of inspired
// by Metal, WebGPU and friends. The goal here is to be a good API to write to
// while also allowing me to port to other backends (like WebGPU) in the future.

import { BlendMode, BlendFactor, RenderFlags, CompareMode, CullMode, FrontFaceMode } from "../../render";
import { GfxBuffer, GfxTexture, GfxColorAttachment, GfxDepthStencilAttachment, GfxRenderTarget, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource } from "./GfxPlatformImpl";
import { GfxFormat } from "./GfxPlatformFormat";
import { DeviceProgram } from "../../Program";
import { BufferLayout } from "../helpers/BufferHelpers";
import { Color } from "../../Color";

export const enum GfxLoadDisposition { CLEAR, LOAD }
export const enum GfxWrapMode { CLAMP, REPEAT, MIRROR }
export const enum GfxTexFilterMode { POINT, BILINEAR }
export const enum GfxMipFilterMode { NO_MIP, NEAREST, LINEAR }
export const enum GfxPrimitiveTopology { TRIANGLES }

export enum GfxBufferUsage {
    INDEX   = 0x01,
    VERTEX  = 0x02,
    UNIFORM = 0x03,
}

export enum GfxBufferFrequencyHint {
    STATIC = 0x01,
    DYNAMIC = 0x02,
}

export interface GfxVertexBufferDescriptor {
    buffer: GfxBuffer;
    offset: number;
    stride: number;
}

export interface GfxVertexAttributeDescriptor {
    location: number;
    format: GfxFormat;
    bufferIndex: number;
    bufferOffset: number;
}

export interface GfxSamplerDescriptor {
    wrapS: GfxWrapMode;
    wrapT: GfxWrapMode;
    minFilter: GfxTexFilterMode;
    magFilter: GfxTexFilterMode;
    mipFilter: GfxMipFilterMode;
    minLOD: number;
    maxLOD: number;
}

export interface GfxBufferBinding {
    buffer: GfxBuffer;
    wordOffset: number;
    wordCount: number;
}

export interface GfxSamplerBinding {
    texture: GfxTexture;
    sampler: GfxSampler;
}

export interface GfxBindingLayoutDescriptor {
    numUniformBuffers: number;
    numSamplers: number;
}

export interface GfxBlendStateDescriptor {
    blendMode: BlendMode;
    srcFactor: BlendFactor;
    dstFactor: BlendFactor;
}

export interface GfxDepthStencilStateDescriptor {
    depthCompare: CompareMode;
    depthWrite: boolean;
}

export interface GfxRasterizationStateDescriptor {
    cullMode: CullMode;
    frontFace: FrontFaceMode;
}

export interface GfxRenderTargetDescriptor {
    colorAttachment: GfxColorAttachment;
    colorLoadDisposition: GfxLoadDisposition;
    colorClearColor: Color;

    depthStencilAttachment: GfxDepthStencilAttachment;
    depthLoadDisposition: GfxLoadDisposition;
    depthClearValue: number;
    stencilLoadDisposition: GfxLoadDisposition;
    stencilClearValue: number;
}

export interface GfxRenderPipelineDescriptor {
    bindingLayouts: GfxBindingLayoutDescriptor[];
    inputLayout: GfxInputLayout;
    program: GfxProgram;
    topology: GfxPrimitiveTopology;
    renderFlags: RenderFlags;
}

export interface GfxDeviceLimits {
    uniformBufferWordAlignment: number;
}

export interface GfxProgramReflection {
    uniformBuffers: BufferLayout[];
}

export interface GfxSwapChain {
    configureSwapChain(width: number, height: number): void;
    getDevice(): GfxDevice;
    getOnscreenTexture(): GfxTexture;
    present(): void;
}

export interface GfxHostAccessPass {
    // Transfer commands.
    uploadBufferData(buffer: GfxBuffer, dstWordOffset: number, data: ArrayBuffer, srcWordOffset?: number, wordCount?: number): void;
    uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void;
}

export interface GfxRenderPass {
    // State management.
    setViewport(width: number, height: number): void;
    setPipeline(pipeline: GfxRenderPipeline): void;
    setBindings(bindingLayoutIndex: number, bindings: GfxBindings): void;
    setInputState(inputState: GfxInputState): void;

    // Draw commands.
    draw(count: number, firstIndex: number): void;
    drawIndexed(count: number, firstIndex: number): void;

    // Pass resolution.
    endPass(resolveColorAttachmentTo: GfxTexture | null): void;
};

export type GfxPass = GfxRenderPass | GfxHostAccessPass;

export interface GfxDevice {
    createBuffer(wordCount: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer;
    // TODO(jstpierre): The number of mipmaps is not explicitly choosable on Metal. I assume WebGPU
    // will not allow this either. At some point, I will have to move this into the sampler.
    createTexture(format: GfxFormat, width: number, height: number, numLevels: number): GfxTexture;
    createSampler(descriptor: GfxSamplerDescriptor): GfxSampler;
    createColorAttachment(width: number, height: number, numSamples: number): GfxColorAttachment;
    createDepthStencilAttachment(width: number, height: number, numSamples: number): GfxDepthStencilAttachment;
    createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTarget;
    createProgram(program: DeviceProgram): GfxProgram;
    createBindings(bindingLayout: GfxBindingLayoutDescriptor, uniformBuffers: GfxBufferBinding[], samplers: GfxSamplerBinding[]): GfxBindings;
    createInputLayout(attributes: GfxVertexAttributeDescriptor[], indexBufferFormat: GfxFormat | null): GfxInputLayout;
    createInputState(inputLayout: GfxInputLayout, buffers: GfxVertexBufferDescriptor[], indexBuffer: GfxBuffer | null): GfxInputState;
    createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline;

    destroyBuffer(o: GfxBuffer): void;
    destroyTexture(o: GfxTexture): void;
    destroySampler(o: GfxSampler): void;
    destroyColorAttachment(o: GfxColorAttachment): void;
    destroyDepthStencilAttachment(o: GfxDepthStencilAttachment): void;
    destroyRenderTarget(o: GfxRenderTarget): void;
    destroyProgram(o: GfxProgram): void;
    destroyBindings(o: GfxBindings): void;
    destroyInputLayout(o: GfxInputLayout): void;
    destroyInputState(o: GfxInputState): void;
    destroyRenderPipeline(o: GfxRenderPipeline): void;

    // Command submission.
    createHostAccessPass(): GfxHostAccessPass;
    createRenderPass(renderTarget: GfxRenderTarget): GfxRenderPass;
    // Consumes and destroys the pass.
    submitPass(o: GfxPass): void;

    queryLimits(): GfxDeviceLimits;
    queryProgram(program: GfxProgram): GfxProgramReflection;
    queryTextureFormatSupported(format: GfxFormat): boolean;

    setResourceName(o: GfxResource, s: string): void;
}

export interface GfxQueue {

}

export { GfxBuffer, GfxTexture, GfxColorAttachment, GfxDepthStencilAttachment, GfxRenderTarget, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline };
export { GfxFormat };
 
