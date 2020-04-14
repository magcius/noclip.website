
// This provides a "sane" low-level API for me to render to, kind of inspired
// by Metal, WebGPU and friends. The goal here is to be a good API to write to
// while also allowing me to port to other backends (like WebGPU) in the future.

import { GfxBuffer, GfxTexture, GfxAttachment, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource, GfxReadback } from "./GfxPlatformImpl";
import { GfxFormat } from "./GfxPlatformFormat";
import { NormalizedViewportCoords } from "../helpers/RenderTargetHelpers";

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
    ADD              = WebGLRenderingContext.FUNC_ADD,
    SUBTRACT         = WebGLRenderingContext.FUNC_SUBTRACT,
    REVERSE_SUBTRACT = WebGLRenderingContext.FUNC_REVERSE_SUBTRACT,
}

export const enum GfxLoadDisposition { CLEAR, LOAD }
export const enum GfxWrapMode { CLAMP, REPEAT, MIRROR }
export const enum GfxTexFilterMode { POINT, BILINEAR }
// TODO(jstpierre): remove NO_MIP
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

export const enum GfxVertexBufferFrequency {
    PER_VERTEX = 0x01,
    PER_INSTANCE = 0x02,
}

export interface GfxVertexBufferDescriptor {
    buffer: GfxBuffer;
    byteOffset: number;
}

export interface GfxIndexBufferDescriptor extends GfxVertexBufferDescriptor {
}

export interface GfxVertexAttributeDescriptor {
    location: number;
    format: GfxFormat;
    bufferIndex: number;
    bufferByteOffset: number;
}

export interface GfxInputLayoutBufferDescriptor {
    byteStride: number;
    frequency: GfxVertexBufferFrequency;
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
    numLevels: number;
}

// TODO(jstpierre): Should this be moved to ../helpers?
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

export interface GfxAttachmentDescriptor {
    format: GfxFormat;
    width: number;
    height: number;
    numSamples: number;
}

export interface GfxBufferBinding {
    buffer: GfxBuffer;
    wordOffset: number;
    wordCount: number;
}

export interface GfxSamplerBinding {
    gfxTexture: GfxTexture | null;
    gfxSampler: GfxSampler | null;
}

export interface GfxBindingLayoutDescriptor {
    numUniformBuffers: number;
    numSamplers: number;
}

export interface GfxBindingsDescriptor {
    bindingLayout: GfxBindingLayoutDescriptor;
    uniformBufferBindings: GfxBufferBinding[];
    samplerBindings: GfxSamplerBinding[];
}

export interface GfxProgramDescriptorSimple {
    preprocessedVert: string;
    preprocessedFrag: string;
}

export interface GfxProgramDescriptor extends GfxProgramDescriptorSimple {
    ensurePreprocessed(vendorInfo: GfxVendorInfo): void;
}

export interface GfxInputLayoutDescriptor {
    vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[];
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
    COLOR = 0x07,
    ALPHA = 0x08,
    ALL   = 0x0F,
}

export interface GfxAttachmentState {
    colorWriteMask: GfxColorWriteMask;
    rgbBlendState: GfxChannelBlendState;
    alphaBlendState: GfxChannelBlendState;
}

export interface GfxMegaStateDescriptor {
    attachmentsState: GfxAttachmentState[];
    blendConstant: GfxColor;
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
    colorAttachment: GfxAttachment | null;
    depthStencilAttachment: GfxAttachment | null;
}

export interface GfxRenderPipelineDescriptor {
    bindingLayouts: GfxBindingLayoutDescriptor[];
    inputLayout: GfxInputLayout | null;
    program: GfxProgram;
    topology: GfxPrimitiveTopology;
    megaStateDescriptor: GfxMegaStateDescriptor;
    sampleCount: number;
}

export interface GfxColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

// TODO(jstpierre): Support MRT. This might be tricksy.
export interface GfxRenderPassDescriptor {
    colorAttachment: GfxAttachment | null;
    colorResolveTo: GfxTexture | null;
    colorLoadDisposition: GfxLoadDisposition;
    colorClearColor: GfxColor;
    depthStencilAttachment: GfxAttachment | null;
    depthStencilResolveTo: GfxTexture | null;
    depthLoadDisposition: GfxLoadDisposition;
    depthClearValue: number;
    stencilLoadDisposition: GfxLoadDisposition;
    stencilClearValue: number;
}

export interface GfxDeviceLimits {
    uniformBufferWordAlignment: number;
    uniformBufferMaxPageWordSize: number;
}

export interface GfxDebugGroup {
    name: string;
    drawCallCount: number;
    textureBindCount: number;
    bufferUploadCount: number;
    triangleCount: number;
}

export interface GfxBugQuirks {
    rowMajorMatricesBroken: boolean;
}

export const enum GfxClipSpaceNearZ {
    NegativeOne,
    Zero,
}

export interface GfxVendorInfo {
    platformString: string;
    bugQuirks: GfxBugQuirks;
    glslVersion: string;
    explicitBindingLocations: boolean;
    separateSamplerTextures: boolean;
    clipSpaceNearZ: GfxClipSpaceNearZ;
}

export type GfxPlatformFramebuffer = WebGLFramebuffer;

export interface GfxSwapChain {
    configureSwapChain(width: number, height: number): void;
    getDevice(): GfxDevice;
    getOnscreenTexture(): GfxTexture;
    // WebXR requires presenting to a platform-defined framebuffer, for all that is unholy.
    // This hopefully is less terrible in the future. See https://github.com/immersive-web/webxr/issues/896
    present(platformFramebuffer?: GfxPlatformFramebuffer, viewport?: NormalizedViewportCoords): void;
    createWebXRLayer(webXRSession: XRSession): XRWebGLLayer;
}

export interface GfxHostAccessPass {
    // Transfer commands.
    uploadBufferData(buffer: GfxBuffer, dstWordOffset: number, data: Uint8Array, srcWordOffset?: number, wordCount?: number): void;
    uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void;
}

export interface GfxRenderPass {
    // State management.
    setViewport(x: number, y: number, w: number, h: number): void;
    setScissor(x: number, y: number, w: number, h: number): void;
    setPipeline(pipeline: GfxRenderPipeline): void;
    setBindings(bindingLayoutIndex: number, bindings: GfxBindings, dynamicByteOffsets: number[]): void;
    setInputState(inputState: GfxInputState | null): void;
    setStencilRef(value: number): void;

    // Draw commands.
    draw(vertexCount: number, firstVertex: number): void;
    drawIndexed(indexCount: number, firstIndex: number): void;
    drawIndexedInstanced(indexCount: number, firstIndex: number, instanceCount: number): void;
};

export type GfxPass = GfxRenderPass | GfxHostAccessPass;

export interface GfxDevice {
    createBuffer(wordCount: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer;
    createTexture(descriptor: GfxTextureDescriptor): GfxTexture;
    createSampler(descriptor: GfxSamplerDescriptor): GfxSampler;
    createAttachment(descriptor: GfxAttachmentDescriptor): GfxAttachment;
    createAttachmentFromTexture(texture: GfxTexture): GfxAttachment;
    createProgram(program: GfxProgramDescriptor): GfxProgram;
    createProgramSimple(program: GfxProgramDescriptorSimple): GfxProgram;
    createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings;
    createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout;
    createInputState(inputLayout: GfxInputLayout, buffers: (GfxVertexBufferDescriptor | null)[], indexBuffer: GfxIndexBufferDescriptor | null): GfxInputState;
    createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline;
    createReadback(elemCount: number): GfxReadback;

    destroyBuffer(o: GfxBuffer): void;
    destroyTexture(o: GfxTexture): void;
    destroySampler(o: GfxSampler): void;
    destroyAttachment(o: GfxAttachment): void;
    destroyProgram(o: GfxProgram): void;
    destroyBindings(o: GfxBindings): void;
    destroyInputLayout(o: GfxInputLayout): void;
    destroyInputState(o: GfxInputState): void;
    destroyRenderPipeline(o: GfxRenderPipeline): void;
    destroyReadback(o: GfxReadback): void;

    // Command submission.
    createHostAccessPass(): GfxHostAccessPass;
    createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass;
    // Consumes and destroys the pass.
    submitPass(o: GfxPass): void;

    // Readback system.
    readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void;
    submitReadback(o: GfxReadback): void;
    queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean;

    // Information queries.
    queryLimits(): GfxDeviceLimits;
    queryTextureFormatSupported(format: GfxFormat): boolean;
    queryPipelineReady(o: GfxRenderPipeline): boolean;
    queryPlatformAvailable(): boolean;
    queryVendorInfo(): GfxVendorInfo;
    queryRenderPass(o: GfxRenderPass): GfxRenderPassDescriptor;

    // Debugging.
    setResourceName(o: GfxResource, s: string): void;
    setResourceLeakCheck(o: GfxResource, v: boolean): void;
    checkForLeaks(): void;
    pushDebugGroup(debugGroup: GfxDebugGroup): void;
    popDebugGroup(): void;
}

export { GfxBuffer, GfxTexture, GfxAttachment, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings };
export { GfxFormat };
