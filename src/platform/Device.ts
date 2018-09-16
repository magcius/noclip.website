
import { BlendMode, BlendFactor, RenderFlags, CompareMode, applyFlags, CullMode, FrontFaceMode, FullscreenCopyProgram } from "../render";
import { BaseProgram, ProgramCache } from "../Program";
import { assert } from "../util";

// This provides a "sane" low-level API for me to render to, kind of inspired
// by Metal, WebGPU and friends. The goal here is to be a good API to write to
// while also allowing me to port to other backends (like WebGPU) in the future.

export const enum WrapMode { CLAMP, REPEAT, MIRROR }
export const enum TexFilterMode { POINT, BILINEAR }
export const enum MipFilterMode { NO_MIP, NEAREST, LINEAR }

export const enum PrimitiveTopology {
    TRIANGLES,
}

const enum FormatTypeFlags {
    U8  = 0x01,
    U16 = 0x02,
    U32 = 0x03,
    S8  = 0x04,
    S16 = 0x05,
    S32 = 0x06,
    F32 = 0x07,
};

const enum FormatCompFlags {
    COMP_R    = 0x01,
    COMP_RG   = 0x02,
    COMP_RGB  = 0x03,
    COMP_RGBA = 0x04,
};

const enum FormatFlags {
    NONE       = 0x00,
    NORMALIZED = 0x01,
    SRGB       = 0x02,
}

function makeFormat(type: FormatTypeFlags, comp: FormatCompFlags, flags: FormatFlags): number {
    return (type << 16) | (comp << 8) | flags;
}

export enum Format {
    F32_R    = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    F32_RG   = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RG,   FormatFlags.NONE),
    F32_RGB  = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGB,  FormatFlags.NONE),
    F32_RGBA = makeFormat(FormatTypeFlags.F32, FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
    U16_R    = makeFormat(FormatTypeFlags.U16, FormatCompFlags.COMP_R,    FormatFlags.NONE),
    U8_RGBA  = makeFormat(FormatTypeFlags.U8,  FormatCompFlags.COMP_RGBA, FormatFlags.NONE),
}

export enum GfxBufferUsage {
    INDEX   = 0x01,
    VERTEX  = 0x02,
    UNIFORM = 0x03,
}

export enum GfxBufferFrequencyHint {
    STATIC = 0x01,
    DYNAMIC = 0x02,
}

/**
 * Gets the byte size for an individual component.
 * e.g. for F32_RGB, this will return "4", since F32 has 4 bytes.
 */
function getFormatCompByteSize(fmt: Format): number {
    const type: FormatTypeFlags = (fmt >>> 16) & 0xFF;
    switch (type) {
    case FormatTypeFlags.F32:
    case FormatTypeFlags.U32:
    case FormatTypeFlags.S32:
        return 4;
    case FormatTypeFlags.U16:
    case FormatTypeFlags.S16:
        return 2;
    case FormatTypeFlags.U8:
    case FormatTypeFlags.S8:
        return 1;
    }
}

export interface GfxVertexBufferDescriptor {
    buffer: GfxBuffer;
    stride: number;
}

export interface GfxVertexAttributeDescriptor {
    location: number;
    format: Format;
    bufferIndex: number;
    bufferOffset: number;
}

export interface GfxRenderPipeline {
}

export interface GfxTextureMipChain {
    mipLevels: ArrayBufferView[];
}

// Opaque interfaces.

// Hack to get nominal typing.
enum T { Buffer, Texture, ColorAttachment, DepthStencilAttachment, Sampler, Program, InputState, RenderTarget, RenderPipeline };

export interface GfxBuffer { _T: T.Buffer };
export interface GfxTexture { _T: T.Texture };
export interface GfxColorAttachment { _T: T.ColorAttachment };
export interface GfxDepthStencilAttachment { _T: T.DepthStencilAttachment };
export interface GfxSampler { _T: T.Sampler };
export interface GfxProgram { _T: T.Program };
export interface GfxInputState { _T: T.InputState };
export interface GfxRenderTarget { _T: T.RenderTarget };
export interface GfxRenderPipeline { _T: T.RenderPipeline };

export interface GfxSamplerDescriptor {
    wrapS: WrapMode;
    wrapT: WrapMode;
    minFilter: TexFilterMode;
    magFilter: TexFilterMode;
    mipFilter: MipFilterMode;
    minLOD: number;
    maxLOD: number;
}

export interface GfxBufferBinding {
    buffer: GfxBuffer;
    offset: number;
    size: number;
}

export interface GfxSamplerBinding {
    // TODO(jstpierre): Resolved render target?
    texture: GfxTexture;
    sampler: GfxSampler;
}

export interface GfxBindingLayoutDescriptor {
    // This is a vastly simplified interface over Vk / Metal / WebGPU.
    // In our case, we only support *one* BindGroup / DescriptorSet,
    // and each binding starts at 0 and increments. The goal is to find
    // a good middleground between WebGL and WebGPU.
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

export interface GfxRenderPipelineDescriptor {
    bindingLayout: GfxBindingLayoutDescriptor;
    program: GfxProgram;
    topology: PrimitiveTopology;
    blendState: GfxBlendStateDescriptor;
    depthStencilState: GfxDepthStencilStateDescriptor;
    rasterizationState: GfxRasterizationStateDescriptor;
    inputState: GfxInputState;
}

export interface GfxSwapChain {
    configureSwapChain(width: number, height: number): void;
    getDevice(): GfxDevice;
    getNextTexture(): GfxTexture;
    present(): void;
}

export interface GfxDevice {
    createBuffer(size: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer;
    createTexture(format: Format, width: number, height: number, mipmapped: boolean, numSamples: number): GfxTexture;
    createSampler(descriptor: GfxSamplerDescriptor): GfxSampler;
    createColorAttachment(width: number, height: number, numSamples: number): GfxColorAttachment;
    createDepthStencilAttachment(width: number, height: number, numSamples: number): GfxDepthStencilAttachment;
    createRenderTarget(colorAttachment: GfxColorAttachment, depthStencilAttachment: GfxDepthStencilAttachment): GfxRenderTarget;
    createProgram(program: BaseProgram): GfxProgram;
    createInputState(buffers: GfxVertexBufferDescriptor[], attributes: GfxVertexAttributeDescriptor[], indexBuffer: GfxBuffer, indexBufferFormat: Format): GfxInputState;
    createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline;
    createHostUploader(): GfxHostUploader;
    createPassRenderer(renderTarget: GfxRenderTarget): GfxPassRenderer;

    destroyBuffer(o: GfxBuffer): void;
    destroyTexture(o: GfxTexture): void;
    destroySampler(o: GfxSampler): void;
    destroyColorAttachment(o: GfxColorAttachment): void;
    destroyDepthStencilAttachment(o: GfxDepthStencilAttachment): void;
    destroyRenderTarget(o: GfxRenderTarget): void;
    destroyProgram(o: GfxProgram): void;
    destroyInputState(o: GfxInputState): void;
    destroyRenderPipeline(o: GfxRenderPipeline): void;
    destroyHostUploader(o: GfxHostUploader): void;
    destroyPassRenderer(o: GfxPassRenderer): void;
}

export interface GfxHostUploader {
    uploadBufferData(buffer: GfxBuffer, dstOffset: number, data: ArrayBuffer): void;
    uploadTextureData(texture: GfxTexture, data: GfxTextureMipChain): void;
}

export interface GfxPassRenderer {
    setPipeline(pipeline: GfxRenderPipeline): void;
    setBindings(uniformBuffers: GfxBufferBinding[], samplers: GfxSamplerBinding[]): void;
    setViewport(width: number, height: number): void;
    draw(count: number, firstIndex: number): void;
    drawIndexed(count: number, firstIndex: number): void;
    endPass(resolveColorTo: GfxTexture | null): void;
};

//#region GL
export interface GfxBufferP_GL extends GfxBuffer {
    gl_buffer: WebGLBuffer;
    gl_target: GLenum;
}

export interface GfxTextureP_GL extends GfxTexture {
    gl_texture: WebGLTexture;
    gl_target: GLenum;
    gl_format: GLenum;
    gl_type: GLenum;
    width: number;
    height: number;
}

export interface GfxColorAttachmentP_GL extends GfxColorAttachment {
    gl_renderbuffer: WebGLRenderbuffer;
    width: number;
    height: number;
}

export interface GfxDepthStencilAttachmentP_GL extends GfxDepthStencilAttachment {
    gl_renderbuffer: WebGLRenderbuffer;
    width: number;
    height: number;
}

export interface GfxSamplerP_GL extends GfxSampler {
    gl_sampler: WebGLSampler;
}

export interface GfxProgramP_GL extends GfxProgram {
    gl_program: WebGLProgram;
}

export interface GfxRenderTargetP_GL extends GfxRenderTarget {
    gl_framebuffer: WebGLFramebuffer;
    colorAttachment: GfxColorAttachmentP_GL;
    depthAttachment: GfxDepthStencilAttachmentP_GL;
}

export interface GfxInputStateP_GL extends GfxInputState {
    vao: WebGLVertexArrayObject;
    indexBuffer: GfxBuffer;
    indexBufferType: GLenum;
    indexBufferCompByteSize: number;
}

export interface GfxRenderPipelineP_GL extends GfxRenderPipeline {
    bindingLayout: GfxBindingLayoutDescriptor;
    program: GfxProgramP_GL;
    drawMode: GLenum;
    renderFlags: RenderFlags;
    inputState: GfxInputStateP_GL;
}

function translateVertexFormat(fmt: Format): { size: number, type: GLenum, normalized: boolean } {
    function translateType(flags: FormatTypeFlags): GLenum {
        switch (flags) {
        case FormatTypeFlags.U8:
            return WebGL2RenderingContext.UNSIGNED_BYTE;
        case FormatTypeFlags.U16:
            return WebGL2RenderingContext.UNSIGNED_SHORT;
        case FormatTypeFlags.U32:
            return WebGL2RenderingContext.UNSIGNED_INT;
        case FormatTypeFlags.S8:
            return WebGL2RenderingContext.BYTE;
        case FormatTypeFlags.S16:
            return WebGL2RenderingContext.SHORT;
        case FormatTypeFlags.S32:
            return WebGL2RenderingContext.INT;
        case FormatTypeFlags.F32:
            return WebGL2RenderingContext.FLOAT;
        }
    }

    function translateSize(flags: FormatCompFlags): number {
        switch (flags) {
        case FormatCompFlags.COMP_R:
            return 1;
        case FormatCompFlags.COMP_RG:
            return 2;
        case FormatCompFlags.COMP_RGB:
            return 3;
        case FormatCompFlags.COMP_RGBA:
            return 4;
        }
    }

    const typeFlags: FormatTypeFlags = (fmt >>> 16) & 0xFF;
    const compFlags: FormatCompFlags = (fmt >>>  8) & 0xFF;
    const flags: FormatFlags = fmt & 0xFF;

    const type = translateType(typeFlags);
    const size = translateSize(compFlags);
    const normalized = !!(flags & FormatFlags.NORMALIZED);
    return { size, type, normalized };
}

function translateIndexFormat(format: Format): GLenum {
    switch (format) {
    case Format.U16_R:
        return WebGL2RenderingContext.UNSIGNED_SHORT;
    default:
        throw "whoops";
    }
}

function translateBufferHint(hint: GfxBufferFrequencyHint): GLenum {
    switch (hint) {
    case GfxBufferFrequencyHint.STATIC:
        return WebGL2RenderingContext.STATIC_DRAW;
    case GfxBufferFrequencyHint.DYNAMIC:
        return WebGL2RenderingContext.DYNAMIC_DRAW;
    }
}

function translateBufferUsageToTarget(usage: GfxBufferUsage): GLenum {
    switch (usage) {
    case GfxBufferUsage.INDEX:
        return WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER;
    case GfxBufferUsage.VERTEX:
        return WebGL2RenderingContext.ARRAY_BUFFER;
    case GfxBufferUsage.UNIFORM:
        return WebGL2RenderingContext.UNIFORM_BUFFER;
    }
}

function translateTextureInternalFormat(fmt: Format): GLenum {
    switch (fmt) {
    case Format.F32_R:
        return WebGL2RenderingContext.R32F;
    case Format.F32_RG:
        return WebGL2RenderingContext.RG32F;
    case Format.F32_RGB:
        return WebGL2RenderingContext.RGB32F;
    case Format.F32_RGBA:
        return WebGL2RenderingContext.RGBA32F;
    case Format.U16_R:
        return WebGL2RenderingContext.R16UI;
    case Format.U8_RGBA:
        return WebGL2RenderingContext.RGBA8;
    default:
        throw "whoops";
    }
}

function translateTextureFormat(fmt: Format): GLenum {
    const compFlags: FormatCompFlags = (fmt >>>  8) & 0xFF;
    switch (compFlags) {
    case FormatCompFlags.COMP_R:
        return WebGL2RenderingContext.RED;
    case FormatCompFlags.COMP_RG:
        return WebGL2RenderingContext.RG;
    case FormatCompFlags.COMP_RGB:
        return WebGL2RenderingContext.RGB;
    case FormatCompFlags.COMP_RGBA:
        return WebGL2RenderingContext.RGBA;
    }
}

function translateTextureType(fmt: Format): GLenum {
    const typeFlags: FormatTypeFlags = (fmt >>> 16) & 0xFF;
    switch (typeFlags) {
    case FormatTypeFlags.U8:
        return WebGL2RenderingContext.UNSIGNED_BYTE;
    default:
        throw "whoops";
    }
}

function translateWrapMode(wrapMode: WrapMode): GLenum {
    switch (wrapMode) {
    case WrapMode.CLAMP:
        return WebGL2RenderingContext.CLAMP_TO_EDGE;
    case WrapMode.REPEAT:
        return WebGL2RenderingContext.REPEAT;
    case WrapMode.MIRROR:
        return WebGL2RenderingContext.MIRRORED_REPEAT;
    }
}

function translateFilterMode(filter: TexFilterMode, mipFilter: MipFilterMode): GLenum {
    if (mipFilter === MipFilterMode.LINEAR && filter === TexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR_MIPMAP_LINEAR;
    if (mipFilter === MipFilterMode.LINEAR && filter === TexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST_MIPMAP_LINEAR;
    if (mipFilter === MipFilterMode.NEAREST && filter === TexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR_MIPMAP_NEAREST;
    if (mipFilter === MipFilterMode.NEAREST && filter === TexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST_MIPMAP_NEAREST;
    if (mipFilter === MipFilterMode.NO_MIP && filter === TexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR;
    if (mipFilter === MipFilterMode.NO_MIP && filter === TexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST;
    throw new Error(`Unknown texture filter mode`);
}

function translatePrimitiveTopology(topology: PrimitiveTopology): GLenum {
    switch (topology) {
    case PrimitiveTopology.TRIANGLES:
        return WebGL2RenderingContext.TRIANGLES;
    }
}

function translatePipelineStates(blendState: GfxBlendStateDescriptor, depthStencilState: GfxDepthStencilStateDescriptor, rasterizationState: GfxRasterizationStateDescriptor): RenderFlags {
    const renderFlags = new RenderFlags();
    renderFlags.blendMode = blendState.blendMode;
    renderFlags.blendSrc = blendState.srcFactor;
    renderFlags.blendDst = blendState.dstFactor;
    renderFlags.depthTest = depthStencilState.depthCompare !== CompareMode.ALWAYS;
    renderFlags.depthFunc = depthStencilState.depthCompare;
    renderFlags.depthWrite = depthStencilState.depthWrite;
    renderFlags.cullMode = rasterizationState.cullMode;
    renderFlags.frontFace = rasterizationState.frontFace;
    return renderFlags;
}

function getPlatformBuffer(buffer_: GfxBuffer): WebGLBuffer {
    const buffer = buffer_ as GfxBufferP_GL;
    return buffer.gl_buffer;
}

function getPlatformTexture(texture_: GfxTexture): WebGLTexture {
    const texture = texture_ as GfxTextureP_GL;
    return texture.gl_texture;
}

function getPlatformSampler(sampler_: GfxSampler): WebGLSampler {
    const sampler = sampler_ as GfxSamplerP_GL;
    return sampler.gl_sampler;
}

function getPlatformColorAttachment(colorAttachment_: GfxColorAttachment): WebGLRenderbuffer {
    const colorAttachment = colorAttachment_ as GfxColorAttachmentP_GL;
    return colorAttachment.gl_renderbuffer;
}

function getPlatformDepthStencilAttachment(depthStencilAttachment_: GfxDepthStencilAttachment): WebGLRenderbuffer {
    const depthStencilAttachment = depthStencilAttachment_ as GfxDepthStencilAttachmentP_GL;
    return depthStencilAttachment.gl_renderbuffer;
}

function getPlatformRenderTarget(renderTarget_: GfxRenderTarget): WebGLFramebuffer {
    const renderTarget = renderTarget_ as GfxRenderTargetP_GL;
    return renderTarget.gl_framebuffer;
}

function calcMipLevels(w: number, h: number): number {
    let m = Math.min(w, h);
    let i = 0;
    while (m > 0) {
        m /= 2;
        i++;
    }
    return i;
}

export class GfxImplP_GL implements GfxSwapChain, GfxDevice, GfxPassRenderer, GfxHostUploader {
    constructor(private gl: WebGL2RenderingContext) {
        this._programCache = new ProgramCache(gl);
        this._fullscreenBlitProgram = this.createProgram(new FullscreenCopyProgram()) as GfxProgramP_GL;
    }

    //#region GfxSwapChain
    private _scWidth: number;
    private _scHeight: number;
    public configureSwapChain(width: number, height: number): void {
        this._scWidth = width;
        this._scHeight = height;
    }

    public getDevice(): GfxDevice {
        return this;
    }

    private _scTexture: GfxTexture = null;
    public getNextTexture(): GfxTexture {
        if (this._scTexture === null)
            this._scTexture = this.getDevice().createTexture(Format.U8_RGBA, this._scWidth, this._scHeight, false, 1);
        return this._scTexture;
    }

    public present(): void {
        this.blitFullscreenTexture(this._scTexture);
    }

    private _fullscreenBlitProgram: GfxProgramP_GL;
    private blitFullscreenTexture(texture: GfxTexture): void {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, getPlatformTexture(texture));
        gl.useProgram(this._fullscreenBlitProgram.gl_program);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    //#endregion

    //#region GfxDevice
    public createBuffer(size: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer {
        const gl = this.gl;
        const gl_buffer = gl.createBuffer();
        const gl_target = translateBufferUsageToTarget(usage);
        const gl_hint = translateBufferHint(hint);
        gl.bindBuffer(gl_target, gl_buffer);
        gl.bufferData(gl_target, size, gl_hint);
        const buffer: GfxBufferP_GL = { _T: T.Buffer, gl_buffer, gl_target };
        return buffer;
    }

    public createTexture(format: Format, width: number, height: number, mipmapped: boolean, numSamples: number): GfxTexture {
        const gl = this.gl;
        const gl_texture = gl.createTexture();
        const gl_target = gl.TEXTURE_2D;
        const numLevels = mipmapped ? calcMipLevels(width, height) : 1;
        gl.bindTexture(gl_target, gl_texture);
        const internalformat = translateTextureInternalFormat(format);
        const gl_format = translateTextureFormat(format);
        const gl_type = translateTextureType(format);
        gl.texStorage2D(gl_target, numLevels, internalformat, width, height);
        const texture: GfxTextureP_GL = { _T: T.Texture, gl_texture, gl_target, gl_format, gl_type, width, height };
        return texture;
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        const gl = this.gl;
        const gl_sampler = gl.createSampler();
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_WRAP_S, translateWrapMode(descriptor.wrapS));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_WRAP_T, translateWrapMode(descriptor.wrapT));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MIN_FILTER, translateFilterMode(descriptor.minFilter, descriptor.mipFilter));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MAG_FILTER, translateFilterMode(descriptor.magFilter, MipFilterMode.NO_MIP));
        const sampler: GfxSamplerP_GL = { _T: T.Sampler, gl_sampler };
        return sampler;
    }

    public createColorAttachment(width: number, height: number, numSamples: number): GfxColorAttachment {
        const gl = this.gl;
        const gl_renderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, gl_renderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, numSamples, gl.DEPTH24_STENCIL8, width, height);
        const colorAttachment: GfxColorAttachmentP_GL = { _T: T.ColorAttachment, gl_renderbuffer, width, height };
        return colorAttachment;
    }

    public createDepthStencilAttachment(width: number, height: number, numSamples: number): GfxDepthStencilAttachment {
        const gl = this.gl;
        const gl_renderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, gl_renderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, numSamples, gl.DEPTH24_STENCIL8, width, height);
        const depthStencilAttachment: GfxDepthStencilAttachmentP_GL = { _T: T.DepthStencilAttachment, gl_renderbuffer, width, height };
        return depthStencilAttachment;
    }

    private _programCache: ProgramCache;
    public createProgram(baseProgram: BaseProgram): GfxProgram {
        const gl = this.gl;
        const gl_program = baseProgram.compile(gl, this._programCache);
        const program: GfxProgramP_GL = { _T: T.Program, gl_program };
        return program;
    }

    public createRenderTarget(colorAttachment_: GfxColorAttachment, depthStencilAttachment_: GfxDepthStencilAttachment): GfxRenderTarget {
        const gl = this.gl;
        const gl_framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, gl_framebuffer);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, getPlatformColorAttachment(colorAttachment_), 0);
        gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, getPlatformDepthStencilAttachment(depthStencilAttachment_));
        const colorAttachment = colorAttachment_ as GfxColorAttachmentP_GL;
        const depthAttachment = depthStencilAttachment_ as GfxDepthStencilAttachmentP_GL;
        const renderTarget: GfxRenderTargetP_GL = { _T: T.RenderTarget, gl_framebuffer, colorAttachment, depthAttachment };
        return renderTarget;
    }

    public createInputState(buffers: GfxVertexBufferDescriptor[], attributes: GfxVertexAttributeDescriptor[], indexBuffer: GfxBuffer, indexBufferFormat: Format): GfxInputState {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        for (let i = 0; i < attributes.length; i++) {
            const attr = attributes[i];
            const { size, type, normalized } = translateVertexFormat(attr.format);
            const vertexBuffer = buffers[attr.bufferIndex];
            gl.bindBuffer(gl.ARRAY_BUFFER, getPlatformBuffer(vertexBuffer.buffer));
            gl.vertexAttribPointer(attr.location, size, type, normalized, vertexBuffer.stride, attr.bufferOffset);
        }

        gl.bindVertexArray(null);

        const indexBufferType = translateIndexFormat(indexBufferFormat);
        const indexBufferCompByteSize = getFormatCompByteSize(indexBufferFormat);
        const inputState: GfxInputStateP_GL = { _T: T.InputState, vao, indexBuffer, indexBufferType, indexBufferCompByteSize };
        return inputState;
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const bindingLayout = descriptor.bindingLayout;
        const drawMode = translatePrimitiveTopology(descriptor.topology);
        const inputState = descriptor.inputState as GfxInputStateP_GL;
        const program = descriptor.program as GfxProgramP_GL;
        const renderFlags = translatePipelineStates(descriptor.blendState, descriptor.depthStencilState, descriptor.rasterizationState);
        const pipeline: GfxRenderPipelineP_GL = { _T: T.RenderPipeline, bindingLayout, drawMode, inputState, program, renderFlags };
        return pipeline;
    }

    public createHostUploader(): GfxHostUploader {
        return this;
    }

    private _currentRenderTarget: GfxRenderTargetP_GL;
    private _setRenderTarget(renderTarget: GfxRenderTarget): void {
        const gl = this.gl;
        this._currentRenderTarget = renderTarget as GfxRenderTargetP_GL;
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._currentRenderTarget.gl_framebuffer);
    }

    public createPassRenderer(renderTarget: GfxRenderTarget): GfxPassRenderer {
        this._setRenderTarget(renderTarget);
        return this;
    }

    public destroyBuffer(o: GfxBuffer): void {
        this.gl.deleteBuffer(getPlatformBuffer(o));
    }

    public destroyTexture(o: GfxTexture): void {
        this.gl.deleteTexture(getPlatformTexture(o));
    }

    public destroySampler(o: GfxSampler): void {
        this.gl.deleteSampler(getPlatformSampler(o));
    }

    public destroyColorAttachment(o: GfxColorAttachment): void {
        this.gl.deleteRenderbuffer(getPlatformColorAttachment(o));
    }

    public destroyDepthStencilAttachment(o: GfxDepthStencilAttachment): void {
        this.gl.deleteRenderbuffer(getPlatformDepthStencilAttachment(o));
    }

    public destroyRenderTarget(o: GfxRenderTarget): void {
        this.gl.deleteFramebuffer(getPlatformRenderTarget(o));
    }

    public destroyProgram(o: GfxProgram): void {
        // Nothing.
    }

    public destroyInputState(o: GfxInputState): void {
        const inputState = o as GfxInputStateP_GL;
        this.gl.deleteVertexArray(inputState.vao);
    }

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
        // Nothing.
    }

    public destroyHostUploader(o: GfxHostUploader): void {
        // Nothing.
    }

    public destroyPassRenderer(o: GfxPassRenderer): void {
        // Nothing.
    }
    //#endregion

    //#region GfxPassRenderer
    private _currentPipeline: GfxRenderPipelineP_GL;
    private _currentRenderFlags: RenderFlags;

    public setBindings(uniformBuffers: GfxBufferBinding[], samplers: GfxSamplerBinding[]): void {
        const gl = this.gl;

        assert(uniformBuffers.length === this._currentPipeline.bindingLayout.numUniformBuffers);
        assert(samplers.length === this._currentPipeline.bindingLayout.numSamplers);

        for (let i = 0; i < uniformBuffers.length; i++) {
            const binding = uniformBuffers[i];
            gl.bindBufferRange(gl.UNIFORM_BUFFER, i, binding.buffer, binding.offset, binding.size);
        }

        for (let i = 0; i < samplers.length; i++) {
            const binding = samplers[i];
            gl.bindSampler(i, getPlatformSampler(binding.sampler));
            gl.activeTexture(gl.TEXTURE0 + i);
            const { gl_texture, gl_target } = (binding.texture as GfxTextureP_GL);
            gl.bindTexture(gl_target, gl_texture);
        }
    }

    public setViewport(w: number, h: number): void {
        const gl = this.gl;
        gl.viewport(0, 0, w, h);
    }

    public setPipeline(pipeline: GfxRenderPipeline): void {
        const gl = this.gl;
        this._currentPipeline = pipeline as GfxRenderPipelineP_GL;
        applyFlags(gl, this._currentRenderFlags, this._currentPipeline.renderFlags, { forceDisableCulling: false });
        gl.useProgram(this._currentPipeline.program.gl_program);
    }

    public draw(count: number, firstVertex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        gl.drawArrays(pipeline.drawMode, firstVertex, count);
    }

    public drawIndexed(count: number, firstIndex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        const inputState = pipeline.inputState;
        gl.drawElements(pipeline.drawMode, count, inputState.indexBufferType, firstIndex * inputState.indexBufferCompByteSize);
    }

    public endPass(resolveColorTo_: GfxTexture | null): void {
        if (resolveColorTo_ !== null) {
            const resolveColorTo = resolveColorTo_ as GfxTextureP_GL;
            const resolveColorFrom = this._currentRenderTarget.colorAttachment;
            const gl = this.gl;
            const readFramebuffer = gl.createFramebuffer();
            const resolveFramebuffer = gl.createFramebuffer();

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
            gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, resolveColorFrom.gl_renderbuffer);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFramebuffer);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveColorTo.gl_texture, 0);
            gl.blitFramebuffer(0, 0, resolveColorFrom.width, resolveColorFrom.height, 0, 0, resolveColorTo.width, resolveColorTo.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            gl.deleteFramebuffer(readFramebuffer);
            gl.deleteFramebuffer(resolveFramebuffer);
        }
    }
    //#endregion

    //#region GfxHostUploader
    public uploadBufferData(buffer: GfxBuffer, dstOffset: number, data: ArrayBuffer): void {
        const gl = this.gl;
        const { gl_buffer, gl_target } = buffer as GfxBufferP_GL;
        gl.bindBuffer(gl_target, gl_buffer)
        gl.bufferSubData(gl_target, dstOffset, data);
    }

    public uploadTextureData(texture: GfxTexture, data: GfxTextureMipChain): void {
        const gl = this.gl;
        const { gl_texture, gl_target, gl_format, gl_type, width, height } = texture as GfxTextureP_GL;
        gl.bindTexture(gl_target, gl_texture);
        let w = width, h = height;
        for (let i = 0; i < data.mipLevels.length; i++) {
            gl.texSubImage2D(gl_target, i, 0, 0, w, h, gl_format, gl_type, data.mipLevels[i]);
            w = Math.max((w / 2) | 0, 1);
            h = Math.max((h / 2) | 0, 1);
        }
    }
    //#endregion
}
//#endregion
