
// This provides a "sane" low-level API for me to render to, kind of inspired
// by Metal, WebGPU and friends. The goal here is to be a good API to write to
// while also allowing me to port to other backends (like WebGPU) in the future.

import { GfxBuffer, GfxTexture, GfxColorAttachment, GfxDepthStencilAttachment, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource } from "./GfxPlatformImpl";
import { GfxFormat } from "./GfxPlatformFormat";
import { DeviceProgram, DeviceProgramReflection } from "../../Program";
import { Color } from "../../Color";

export enum GfxCompareMode {
    NEVER   = WebGLRenderingContext.NEVER,
    LESS    = WebGLRenderingContext.LESS,
    EQUAL   = WebGLRenderingContext.EQUAL,
    LEQUAL  = WebGLRenderingContext.LEQUAL,
    GREATER = WebGLRenderingContext.GREATER,
    NEQUAL  = WebGLRenderingContext.NOTEQUAL,
    GEQUAL  = WebGLRenderingContext.GEQUAL,
    ALWAYS  = WebGLRenderingContext.ALWAYS,
}

export enum GfxFrontFaceMode {
    CCW = WebGLRenderingContext.CCW,
    CW  = WebGLRenderingContext.CW,
}

export const enum GfxCullMode {
    NONE,
    FRONT,
    BACK,
    FRONT_AND_BACK,
}

export enum GfxBlendFactor {
    ZERO                = WebGLRenderingContext.ZERO,
    ONE                 = WebGLRenderingContext.ONE,
    SRC_COLOR           = WebGLRenderingContext.SRC_COLOR,
    ONE_MINUS_SRC_COLOR = WebGLRenderingContext.ONE_MINUS_SRC_COLOR,
    DST_COLOR           = WebGLRenderingContext.DST_COLOR,
    ONE_MINUS_DST_COLOR = WebGLRenderingContext.ONE_MINUS_DST_COLOR,
    SRC_ALPHA           = WebGLRenderingContext.SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA = WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
    DST_ALPHA           = WebGLRenderingContext.DST_ALPHA,
    ONE_MINUS_DST_ALPHA = WebGLRenderingContext.ONE_MINUS_DST_ALPHA,
}

export enum GfxBlendMode {
    NONE             = 0,
    ADD              = WebGLRenderingContext.FUNC_ADD,
    SUBTRACT         = WebGLRenderingContext.FUNC_SUBTRACT,
    REVERSE_SUBTRACT = WebGLRenderingContext.FUNC_REVERSE_SUBTRACT,
}

export const enum GfxLoadDisposition { CLEAR, LOAD }
export const enum GfxWrapMode { CLAMP, REPEAT, MIRROR }
export const enum GfxTexFilterMode { POINT, BILINEAR }
export const enum GfxMipFilterMode { NO_MIP, NEAREST, LINEAR }
export const enum GfxPrimitiveTopology { TRIANGLES }

export const enum GfxBufferUsage {
    INDEX   = 0x01,
    VERTEX  = 0x02,
    UNIFORM = 0x03,
}

export const enum GfxBufferFrequencyHint {
    STATIC = 0x01,
    DYNAMIC = 0x02,
}

export interface GfxVertexBufferDescriptor {
    buffer: GfxBuffer;
    byteOffset: number;
    byteStride: number;
}

export const enum GfxVertexAttributeFrequency {
    PER_VERTEX = 0x01,
    PER_INSTANCE = 0x02,
}

export interface GfxVertexAttributeDescriptor {
    location: number;
    format: GfxFormat;
    bufferIndex: number;
    bufferByteOffset: number;
    frequency: GfxVertexAttributeFrequency;
    usesIntInShader?: boolean;
}

export const enum GfxTextureDimension {
    n2D, n2D_ARRAY
}

export interface GfxTextureDescriptor {
    dimension: GfxTextureDimension;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    depth: number;
    // TODO(jstpierre): The number of mipmaps is not explicitly choosable on Metal. I assume WebGPU
    // will not allow this either. At some point, I will have to move this into the sampler.
    numLevels: number;
}

export function makeTextureDescriptor2D(pixelFormat: GfxFormat, width: number, height: number, numLevels: number): GfxTextureDescriptor {
    const dimension = GfxTextureDimension.n2D, depth = 1;
    return { dimension, pixelFormat, width, height, depth, numLevels };
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

export interface GfxBindingsDescriptor {
    bindingLayout: GfxBindingLayoutDescriptor;
    uniformBufferBindings: GfxBufferBinding[];
    samplerBindings: (GfxSamplerBinding | null)[];
}

export interface GfxInputLayoutDescriptor {
    vertexAttributeDescriptors: GfxVertexAttributeDescriptor[];
    indexBufferFormat: GfxFormat | null;
}

export enum GfxStencilOp {
    KEEP            = WebGLRenderingContext.KEEP,
    ZERO            = WebGLRenderingContext.ZERO,
    REPLACE         = WebGLRenderingContext.REPLACE,
    INVERT          = WebGLRenderingContext.INVERT,
    INCREMENT_CLAMP = WebGLRenderingContext.INCR,
    DECREMENT_CLAMP = WebGLRenderingContext.DECR,
    INCREMENT_WRAP  = WebGLRenderingContext.INCR_WRAP,
    DECREMENT_WRAP  = WebGLRenderingContext.DECR_WRAP,
}

export interface GfxChannelBlendState {
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;
}

export const enum GfxColorWriteMask {
    NONE  = 0x00,
    RED   = 0x01,
    GREEN = 0x02,
    BLUE  = 0x04,
    ALPHA = 0x08,
    ALL   = 0x0F,
}

export interface GfxAttachmentState {
    colorWriteMask: GfxColorWriteMask;
    blendConstant: Color;
    rgbBlendState: GfxChannelBlendState;
    alphaBlendState: GfxChannelBlendState;
}

export interface GfxMegaStateDescriptor {
    // TODO(jstpierre): Remove this old interface.
    colorWrite: boolean;
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;

    attachmentsState?: GfxAttachmentState[];

    depthCompare: GfxCompareMode;
    depthWrite: boolean;
    stencilCompare: GfxCompareMode;
    stencilWrite: boolean;
    stencilPassOp: GfxStencilOp;
    cullMode: GfxCullMode;
    frontFace: GfxFrontFaceMode;
    polygonOffset: boolean;
}

export interface GfxRenderTargetDescriptor {
    colorAttachment: GfxColorAttachment | null;
    depthStencilAttachment: GfxDepthStencilAttachment | null;
}

export interface GfxRenderPipelineDescriptor {
    bindingLayouts: GfxBindingLayoutDescriptor[];
    inputLayout: GfxInputLayout | null;
    program: GfxProgram;
    topology: GfxPrimitiveTopology;
    megaStateDescriptor: GfxMegaStateDescriptor;
}

// TODO(jstpierre): Support MRT. This might be tricksy.
export interface GfxRenderPassDescriptor {
    colorAttachment: GfxColorAttachment;
    colorLoadDisposition: GfxLoadDisposition;
    colorClearColor: Color;
    depthStencilAttachment: GfxDepthStencilAttachment;
    depthLoadDisposition: GfxLoadDisposition;
    depthClearValue: number;
    stencilLoadDisposition: GfxLoadDisposition;
    stencilClearValue: number;
}

export interface GfxDeviceLimits {
    uniformBufferWordAlignment: number;
}

export interface GfxProgramReflection extends DeviceProgramReflection {
    name: string;
    uniqueKey: number;
}

export interface GfxInputStateReflection {
    inputLayout: GfxInputLayout;
}

export interface GfxDebugGroup {
    name: string;
    drawCallCount: number;
    textureBindCount: number;
    bufferUploadCount: number;
    triangleCount: number;
}

export interface GfxSwapChain {
    configureSwapChain(width: number, height: number): void;
    getDevice(): GfxDevice;
    getOnscreenTexture(): GfxTexture;
    present(): void;
}

export interface GfxHostAccessPass {
    // Transfer commands.
    uploadBufferData(buffer: GfxBuffer, dstWordOffset: number, data: Uint8Array, srcWordOffset?: number, wordCount?: number): void;
    uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void;
}

export interface GfxRenderPass {
    // State management.
    setViewport(width: number, height: number): void;
    setPipeline(pipeline: GfxRenderPipeline): void;
    setBindings(bindingLayoutIndex: number, bindings: GfxBindings, dynamicWordOffsets: number[]): void;
    setInputState(inputState: GfxInputState | null): void;
    setStencilRef(value: number): void;

    // Draw commands.
    draw(vertexCount: number, firstVertex: number): void;
    drawIndexed(indexCount: number, firstIndex: number): void;

    // Pass resolution.
    endPass(resolveColorAttachmentTo: GfxTexture | null): void;
};

export type GfxPass = GfxRenderPass | GfxHostAccessPass;

export interface GfxDevice {
    createBuffer(wordCount: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer;
    createTexture(descriptor: GfxTextureDescriptor): GfxTexture;
    createSampler(descriptor: GfxSamplerDescriptor): GfxSampler;
    createColorAttachment(width: number, height: number, numSamples: number): GfxColorAttachment;
    createDepthStencilAttachment(width: number, height: number, numSamples: number): GfxDepthStencilAttachment;
    createProgram(program: DeviceProgram): GfxProgram;
    createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings;
    createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout;
    createInputState(inputLayout: GfxInputLayout, buffers: (GfxVertexBufferDescriptor | null)[], indexBuffer: GfxVertexBufferDescriptor | null): GfxInputState;
    createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline;

    destroyBuffer(o: GfxBuffer): void;
    destroyTexture(o: GfxTexture): void;
    destroySampler(o: GfxSampler): void;
    destroyColorAttachment(o: GfxColorAttachment): void;
    destroyDepthStencilAttachment(o: GfxDepthStencilAttachment): void;
    destroyProgram(o: GfxProgram): void;
    destroyBindings(o: GfxBindings): void;
    destroyInputLayout(o: GfxInputLayout): void;
    destroyInputState(o: GfxInputState): void;
    destroyRenderPipeline(o: GfxRenderPipeline): void;

    // Command submission.
    createHostAccessPass(): GfxHostAccessPass;
    createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass;
    // Consumes and destroys the pass.
    submitPass(o: GfxPass): void;

    queryLimits(): GfxDeviceLimits;
    queryProgram(program: GfxProgram): GfxProgramReflection;
    queryInputState(o: GfxInputState): GfxInputStateReflection;
    queryTextureFormatSupported(format: GfxFormat): boolean;

    // Debugging and high-level queries.
    setResourceName(o: GfxResource, s: string): void;
    pushDebugGroup(debugGroup: GfxDebugGroup): void;
    popDebugGroup(): GfxDebugGroup;
}

export { GfxBuffer, GfxTexture, GfxColorAttachment, GfxDepthStencilAttachment, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings };
export { GfxFormat };
 