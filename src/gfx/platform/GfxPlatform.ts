
// This provides a "sane" low-level API for me to render to, kind of inspired
// by Metal, WebGPU and friends. The goal here is to be a good API to write to
// while also allowing me to port to other backends (like WebGPU) in the future.

import type { GfxBuffer, GfxTexture, GfxRenderTarget, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource, GfxReadback, GfxQueryPool, GfxComputePipeline } from "./GfxPlatformImpl";
import { GfxFormat } from "./GfxPlatformFormat";

export enum GfxCompareMode {
    Never        = WebGLRenderingContext.NEVER,
    Less         = WebGLRenderingContext.LESS,
    Equal        = WebGLRenderingContext.EQUAL,
    LessEqual    = WebGLRenderingContext.LEQUAL,
    Greater      = WebGLRenderingContext.GREATER,
    NotEqual     = WebGLRenderingContext.NOTEQUAL,
    GreaterEqual = WebGLRenderingContext.GEQUAL,
    Always       = WebGLRenderingContext.ALWAYS,
}

export enum GfxFrontFaceMode {
    CCW = WebGLRenderingContext.CCW,
    CW  = WebGLRenderingContext.CW,
}

export const enum GfxCullMode {
    None,
    Front,
    Back,
    FrontAndBack,
}

export enum GfxBlendFactor {
    Zero             = WebGLRenderingContext.ZERO,
    One              = WebGLRenderingContext.ONE,
    Src              = WebGLRenderingContext.SRC_COLOR,
    OneMinusSrc      = WebGLRenderingContext.ONE_MINUS_SRC_COLOR,
    Dst              = WebGLRenderingContext.DST_COLOR,
    OneMinusDst      = WebGLRenderingContext.ONE_MINUS_DST_COLOR,
    SrcAlpha         = WebGLRenderingContext.SRC_ALPHA,
    OneMinusSrcAlpha = WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
    DstAlpha         = WebGLRenderingContext.DST_ALPHA,
    OneMinusDstAlpha = WebGLRenderingContext.ONE_MINUS_DST_ALPHA,
}

export enum GfxBlendMode {
    Add              = WebGLRenderingContext.FUNC_ADD,
    Subtract         = WebGLRenderingContext.FUNC_SUBTRACT,
    ReverseSubtract  = WebGLRenderingContext.FUNC_REVERSE_SUBTRACT,
}

export const enum GfxWrapMode { Clamp, Repeat, Mirror }
export const enum GfxTexFilterMode { Point, Bilinear }
// TODO(jstpierre): remove NoMip
export const enum GfxMipFilterMode { NoMip, Nearest, Linear }
export const enum GfxPrimitiveTopology { Triangles }

export const enum GfxBufferUsage {
    Index   = 0b00001,
    Vertex  = 0b00010,
    Uniform = 0b00100,
    Storage = 0b01000,
    CopySrc = 0b10000,
    // All buffers are implicitly CopyDst so they can be filled by the CPU... maybe they shouldn't be...
}

export const enum GfxBufferFrequencyHint {
    Static  = 0x01,
    Dynamic = 0x02,
}

export const enum GfxVertexBufferFrequency {
    PerVertex   = 0x01,
    PerInstance = 0x02,
}

export const enum GfxTextureDimension {
    n2D, n2DArray, n3D, Cube,
}

export const enum GfxTextureUsage {
    Sampled      = 0x01,
    RenderTarget = 0x02,
}

export const enum GfxChannelWriteMask {
    None        = 0x00,
    Red         = 0x01,
    Green       = 0x02,
    Blue        = 0x04,
    Alpha       = 0x08,

    RGB         = 0x07,
    AllChannels = 0x0F,
}

export enum GfxStencilOp {
    Keep            = WebGLRenderingContext.KEEP,
    Zero            = WebGLRenderingContext.ZERO,
    Replace         = WebGLRenderingContext.REPLACE,
    Invert          = WebGLRenderingContext.INVERT,
    IncrementClamp  = WebGLRenderingContext.INCR,
    DecrementClamp  = WebGLRenderingContext.DECR,
    IncrementWrap   = WebGLRenderingContext.INCR_WRAP,
    DecrementWrap   = WebGLRenderingContext.DECR_WRAP,
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

export interface GfxTextureDescriptor {
    dimension: GfxTextureDimension;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    depth: number;
    numLevels: number;
    usage: GfxTextureUsage;
}

export function makeTextureDescriptor2D(pixelFormat: GfxFormat, width: number, height: number, numLevels: number): GfxTextureDescriptor {
    const dimension = GfxTextureDimension.n2D, depth = 1;
    const usage = GfxTextureUsage.Sampled;
    return { dimension, pixelFormat, width, height, depth, numLevels, usage };
}

export interface GfxSamplerDescriptor {
    wrapS: GfxWrapMode;
    wrapT: GfxWrapMode;
    wrapQ?: GfxWrapMode;
    minFilter: GfxTexFilterMode;
    magFilter: GfxTexFilterMode;
    mipFilter: GfxMipFilterMode;
    minLOD?: number;
    maxLOD?: number;
    maxAnisotropy?: number;
    compareMode?: GfxCompareMode;
}

export interface GfxRenderTargetDescriptor {
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    sampleCount: number;
}

export interface GfxBufferBinding {
    buffer: GfxBuffer;
    wordCount: number;
}

export interface GfxSamplerBinding {
    gfxTexture: GfxTexture | null;
    gfxSampler: GfxSampler | null;
    lateBinding: string | null;
}

export const enum GfxSamplerFormatKind {
    Float,
    Uint,
    Sint,
    Depth,
}

export interface GfxBindingLayoutSamplerDescriptor {
    dimension: GfxTextureDimension;
    formatKind: GfxSamplerFormatKind;
    comparison?: boolean;
}

export interface GfxBindingLayoutDescriptor {
    numUniformBuffers: number;
    // TODO(jstpierre): Remove / make optional?
    numSamplers: number;
    samplerEntries?: GfxBindingLayoutSamplerDescriptor[];
}

export interface GfxBindingsDescriptor {
    bindingLayout: GfxBindingLayoutDescriptor;
    uniformBufferBindings: GfxBufferBinding[];
    samplerBindings: GfxSamplerBinding[];
}

export const enum GfxBindingLayoutEntryType {
    UniformBuffer,
    Sampler,
    StorageBuffer,
    StorageTexture,
}

interface GfxBindingLayoutEntrySampler extends GfxBindingLayoutSamplerDescriptor {
    type: GfxBindingLayoutEntryType.Sampler;
}

interface GfxBindingLayoutEntryBase {
    type: GfxBindingLayoutEntryType;
}

type GfxBindingLayoutEntry = GfxBindingLayoutEntryBase | GfxBindingLayoutEntrySampler;

export interface GfxBindingLayoutDescriptor2 {
    entries: GfxBindingLayoutEntry[];
}

export interface GfxBindingsDescriptor2 {
    bindingLayout: GfxBindingLayoutDescriptor2;
    entries: (GfxBufferBinding | GfxSamplerBinding)[];
}

export interface GfxProgramDescriptorSimple {
    preprocessedVert: string;
    preprocessedFrag: string | null;
}

export interface GfxProgramDescriptor extends GfxProgramDescriptorSimple {
    ensurePreprocessed(vendorInfo: GfxVendorInfo): void;
    associate(device: GfxDevice, program: GfxProgram): void;
}

export const enum GfxShadingLanguage {
    WGSL,
    GLSL,
}

export interface GfxComputeProgramDescriptor {
    shadingLanguage: GfxShadingLanguage;
    preprocessedComp: string;
}

export interface GfxInputLayoutDescriptor {
    vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[];
    vertexAttributeDescriptors: GfxVertexAttributeDescriptor[];
    indexBufferFormat: GfxFormat | null;
}

export interface GfxChannelBlendState {
    blendMode: GfxBlendMode;
    blendSrcFactor: GfxBlendFactor;
    blendDstFactor: GfxBlendFactor;
}

export interface GfxAttachmentState {
    channelWriteMask: GfxChannelWriteMask;
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

export interface GfxRenderPipelineDescriptor {
    bindingLayouts: GfxBindingLayoutDescriptor[];
    inputLayout: GfxInputLayout | null;
    program: GfxProgram;
    topology: GfxPrimitiveTopology;
    megaStateDescriptor: GfxMegaStateDescriptor;

    // Attachment data.
    colorAttachmentFormats: (GfxFormat | null)[];
    depthStencilAttachmentFormat: GfxFormat | null;
    sampleCount: number;
}

export interface GfxComputePipelineDescriptor {
    program: GfxProgram;
    pipelineLayout: any;
}

export interface GfxColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface GfxRenderPassDescriptor {
    colorAttachment: (GfxRenderTarget | null)[];
    colorAttachmentLevel: number[];
    colorClearColor: (GfxColor | 'load')[];
    colorResolveTo: (GfxTexture | null)[];
    colorResolveToLevel: number[];
    colorStore: boolean[];
    depthStencilAttachment: GfxRenderTarget | null;
    depthStencilResolveTo: GfxTexture | null;
    depthStencilStore: boolean;
    depthClearValue: number | 'load';
    stencilClearValue: number | 'load';

    // Query system.
    occlusionQueryPool: GfxQueryPool | null;
}

export interface GfxDeviceLimits {
    uniformBufferWordAlignment: number;
    uniformBufferMaxPageWordSize: number;
    readonly supportedSampleCounts: number[];
    occlusionQueriesRecommended: boolean;
    computeShadersSupported: boolean;
}

export interface GfxDebugGroup {
    name: string;
    drawCallCount: number;
    textureBindCount: number;
    bufferUploadCount: number;
    triangleCount: number;
}

export const enum GfxViewportOrigin {
    LowerLeft,
    UpperLeft,
}

export const enum GfxClipSpaceNearZ {
    NegativeOne = -1.0,
    Zero = 0.0,
}

export interface GfxVendorInfo {
    readonly platformString: string;
    readonly glslVersion: string;
    readonly explicitBindingLocations: boolean;
    readonly separateSamplerTextures: boolean;
    readonly viewportOrigin: GfxViewportOrigin;
    readonly clipSpaceNearZ: GfxClipSpaceNearZ;
}

export type GfxPlatformFramebuffer = WebGLFramebuffer;

export const enum GfxQueryPoolType {
    OcclusionConservative,
}

export interface GfxSwapChain {
    // WebXR requires presenting to a platform-defined framebuffer, for all that is unholy.
    // This hopefully is less terrible in the future. See https://github.com/immersive-web/webxr/issues/896
    configureSwapChain(width: number, height: number, platformFramebuffer?: GfxPlatformFramebuffer): void;
    getDevice(): GfxDevice;
    getCanvas(): HTMLCanvasElement | OffscreenCanvas;
    getOnscreenTexture(): GfxTexture;
    createWebXRLayer(webXRSession: XRSession): PromiseLike<XRWebGLLayer>;
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

    // Query system.
    beginOcclusionQuery(dstOffs: number): void;
    endOcclusionQuery(): void;

    // Debug.
    beginDebugGroup(name: string): void;
    endDebugGroup(): void;
};

export interface GfxComputePass {
    // State management.
    setPipeline(pipeline: GfxComputePipeline): void;
    setBindings(bindingLayoutIndex: number, bindings: any, dynamicByteOffsets: number[]): void;

    // Dispatch commands.
    dispatch(x: number, y: number, z: number): void;

    // Debug.
    beginDebugGroup(name: string): void;
    endDebugGroup(): void;
}

export type GfxPass = GfxRenderPass | GfxComputePass;

/**
 * GfxDevice represents a "virtual GPU"; this is something that, in the abstract, has a bunch of resources
 * and can execute passes. In the concrete, this is a wrapper around a CanvasWebGL2RenderingContext for the
 * WebGL 2 backend, or a GPUDevice for the WebGPU backend.
 *
 * A bit about the design of this API; all resources are "opaque", meaning you cannot look at the
 * implementation details or underlying fields of the resources, and most objects cannot have their
 * creation parameters modified after they are created. So, while buffers and textures can have their
 * contents changed through data upload passes, they cannot be resized after creation. Create a new object
 * and destroy the old one if you wish to "resize" it.
 * 
 * To upload data to the GPU, call either {@see uploadBufferData} or {@see uploadTextureData}. Note that
 * this happens on the GPU timeline. Where possible, do try to upload data at the beginning of the frame.
 * There might be additional support for more passes in the future.
 */
export interface GfxDevice {
    createBuffer(wordCount: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer;
    createTexture(descriptor: GfxTextureDescriptor): GfxTexture;
    createSampler(descriptor: GfxSamplerDescriptor): GfxSampler;
    createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTarget;
    createRenderTargetFromTexture(texture: GfxTexture): GfxRenderTarget;
    createProgramSimple(descriptor: GfxProgramDescriptorSimple): GfxProgram;
    createComputeProgram(descriptor: GfxComputeProgramDescriptor): GfxProgram;
    createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings;
    createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout;
    createInputState(inputLayout: GfxInputLayout, buffers: (GfxVertexBufferDescriptor | null)[], indexBuffer: GfxIndexBufferDescriptor | null): GfxInputState;
    createComputePipeline(descriptor: GfxComputePipelineDescriptor): GfxComputePipeline;
    createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline;
    createReadback(byteCount: number): GfxReadback;
    createQueryPool(type: GfxQueryPoolType, elemCount: number): GfxQueryPool;

    // Destructors. You *must* call these on resources you create; they will not GC naturally. Call checkForLeaks()
    // to ensure that you are not leaking any resources. (In the noclip codebase, this happens automatically if you
    // set loadSceneDelta to 0 and switch scenes).
    destroyBuffer(o: GfxBuffer): void;
    destroyTexture(o: GfxTexture): void;
    destroySampler(o: GfxSampler): void;
    destroyRenderTarget(o: GfxRenderTarget): void;
    destroyProgram(o: GfxProgram): void;
    destroyBindings(o: GfxBindings): void;
    destroyInputLayout(o: GfxInputLayout): void;
    destroyInputState(o: GfxInputState): void;
    destroyComputePipeline(o: GfxComputePipeline): void;
    destroyRenderPipeline(o: GfxRenderPipeline): void;
    destroyReadback(o: GfxReadback): void;
    destroyQueryPool(o: GfxQueryPool): void;

    // Render pipeline compilation control.
    pipelineQueryReady(o: GfxRenderPipeline): boolean;
    pipelineForceReady(o: GfxRenderPipeline): void;

    // Command submission.
    createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass;
    createComputePass(): GfxComputePass;
    // Consumes and destroys the pass.
    submitPass(o: GfxPass): void;
    beginFrame(): void;
    endFrame(): void;

    // Copying.
    copySubTexture2D(dst: GfxTexture, dstX: number, dstY: number, src: GfxTexture, srcX: number, srcY: number): void;

    // Data submission
    uploadBufferData(buffer: GfxBuffer, dstByteOffset: number, data: Uint8Array, srcByteOffset?: number, byteCount?: number): void;
    uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void;

    // Readback system.
    readBuffer(o: GfxReadback, dstOffset: number, buffer: GfxBuffer, srcOffset: number, byteSize: number): void;
    readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void;
    submitReadback(o: GfxReadback): void;
    /**
     * Checks if the readback object {@param o} is ready. If so, this will write the full set of readback
     * values to {@param dst}, starting at index {@param dstOffs}, and returns true. If the readback is
     * not ready, false is returned, and the array is untouched.
     */
    queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean;

    // Query system
    // Returns null if the query results are still pending. Returns true if any samples passed.
    // TODO(jstpierre): Check the pool as a whole?
    queryPoolResultOcclusion(o: GfxQueryPool, dstOffs: number): boolean | null;

    // Information queries.
    queryLimits(): GfxDeviceLimits;
    queryTextureFormatSupported(format: GfxFormat, width: number, height: number): boolean;
    queryPlatformAvailable(): boolean;
    queryVendorInfo(): GfxVendorInfo;
    queryRenderPass(o: GfxRenderPass): Readonly<GfxRenderPassDescriptor>;
    queryRenderTarget(o: GfxRenderTarget): Readonly<GfxRenderTargetDescriptor>;

    // Debugging.
    setResourceName(o: GfxResource, s: string): void;
    setResourceLeakCheck(o: GfxResource, v: boolean): void;
    checkForLeaks(): void;
    programPatched(o: GfxProgram, descriptor: GfxProgramDescriptorSimple): void;
    pushDebugGroup(debugGroup: GfxDebugGroup): void;
    popDebugGroup(): void;
}

export type { GfxBuffer, GfxTexture, GfxRenderTarget, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings };
export { GfxFormat };
