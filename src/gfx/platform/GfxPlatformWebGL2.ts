
import { GfxBufferUsage, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxTexFilterMode, GfxMipFilterMode, GfxPrimitiveTopology, GfxSwapChain, GfxDevice, GfxSamplerDescriptor, GfxWrapMode, GfxVertexBufferDescriptor, GfxRenderPipelineDescriptor, GfxBufferBinding, GfxSamplerBinding, GfxDeviceLimits, GfxVertexAttributeDescriptor, GfxRenderPass, GfxPass, GfxMegaStateDescriptor, GfxCompareMode, GfxBlendMode, GfxCullMode, GfxBlendFactor, GfxVertexBufferFrequency, GfxRenderPassDescriptor, GfxTextureDescriptor, GfxTextureDimension, GfxBindingsDescriptor, GfxDebugGroup, GfxInputLayoutDescriptor, GfxAttachmentState, GfxChannelWriteMask, GfxPlatformFramebuffer, GfxVendorInfo, GfxInputLayoutBufferDescriptor, GfxIndexBufferDescriptor, GfxChannelBlendState, GfxProgramDescriptor, GfxProgramDescriptorSimple, GfxRenderTargetDescriptor, GfxClipSpaceNearZ, GfxViewportOrigin, GfxQueryPoolType, GfxSamplerFormatKind, GfxTextureUsage, GfxComputeProgramDescriptor, GfxComputePipelineDescriptor, GfxComputePass } from './GfxPlatform';
import { _T, GfxBuffer, GfxTexture, GfxRenderTarget, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource, GfxReadback, GfxQueryPool, defaultBindingLayoutSamplerDescriptor, GfxComputePipeline } from "./GfxPlatformImpl";
import { GfxFormat, getFormatCompByteSize, FormatTypeFlags, FormatCompFlags, FormatFlags, getFormatTypeFlags, getFormatCompFlags, getFormatFlags, getFormatByteSize, getFormatSamplerKind } from "./GfxPlatformFormat";

import { gfxColorEqual, assert, assertExists, leftPad, gfxColorCopy, nullify, nArray } from './GfxPlatformUtil';
import { copyMegaState, defaultMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';

// This is a workaround for ANGLE not supporting UBOs greater than 64kb (the limit of D3D).
// https://bugs.chromium.org/p/angleproject/issues/detail?id=3388
const UBO_PAGE_MAX_BYTE_SIZE = 0x10000;

interface GfxBufferP_GL extends GfxBuffer {
    gl_buffer_pages: WebGLBuffer[];
    gl_target: GLenum;
    usage: GfxBufferUsage;
    byteSize: number;
    pageByteSize: number;
}

interface GfxTextureP_GL extends GfxTexture {
    gl_texture: WebGLTexture;
    gl_target: GLenum;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    depth: number;
    numLevels: number;
    formatKind: GfxSamplerFormatKind;
}

interface GfxRenderTargetP_GL extends GfxRenderTarget {
    gl_renderbuffer: WebGLRenderbuffer | null;
    gfxTexture: GfxTexture | null;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    sampleCount: number;
}

interface GfxSamplerP_GL extends GfxSampler {
    gl_sampler: WebGLSampler;
}

const enum GfxProgramCompileStateP_GL {
    NeedsCompile,
    Compiling,
    NeedsBind,
    ReadyToUse,
}

interface GfxProgramP_GL extends GfxProgram {
    gl_program: WebGLProgram;
    gl_shader_vert: WebGLShader | null;
    gl_shader_frag: WebGLShader | null;
    compileState: GfxProgramCompileStateP_GL;
    descriptor: GfxProgramDescriptorSimple;
}

interface GfxBindingsP_GL extends GfxBindings {
    uniformBufferBindings: GfxBufferBinding[];
    samplerBindings: (GfxSamplerBinding | null)[];
}

interface GfxInputLayoutP_GL extends GfxInputLayout {
    vertexAttributeDescriptors: GfxVertexAttributeDescriptor[];
    vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[];
    indexBufferFormat: GfxFormat | null;
}

interface GfxInputStateP_GL extends GfxInputState {
    vao: WebGLVertexArrayObject;
    indexBufferByteOffset: number | null;
    indexBufferType: GLenum | null;
    indexBufferCompByteSize: number | null;
    inputLayout: GfxInputLayoutP_GL;
    vertexBuffers: (GfxVertexBufferDescriptor | null)[];
}

interface GfxBindingLayoutSamplerDescriptorP_GL {
    gl_target: GLenum;
    formatKind: GfxSamplerFormatKind;
}

interface GfxBindingLayoutTableP_GL {
    firstUniformBuffer: number;
    numUniformBuffers: number;
    firstSampler: number;
    numSamplers: number;
    samplerEntries: GfxBindingLayoutSamplerDescriptorP_GL[];
}

interface GfxBindingLayoutsP_GL {
    numSamplers: number;
    numUniformBuffers: number;
    bindingLayoutTables: GfxBindingLayoutTableP_GL[];
}

interface GfxRenderPipelineP_GL extends GfxRenderPipeline {
    bindingLayouts: GfxBindingLayoutsP_GL;
    program: GfxProgramP_GL;
    drawMode: GLenum;
    megaState: GfxMegaStateDescriptor;
    inputLayout: GfxInputLayoutP_GL | null;

    // Attachment data.
    colorAttachmentFormats: (GfxFormat | null)[];
    depthStencilAttachmentFormat: GfxFormat | null;
    sampleCount: number;
}

interface GfxReadbackP_GL extends GfxReadback {
    byteSize: number;
    gl_buffer: WebGLBuffer;
    gl_sync: WebGLSync | null;
}

interface GfxQueryPoolP_GL extends GfxQueryPool {
    gl_query: WebGLQuery[];
    gl_query_type: GLenum;
}

function translateQueryPoolType(type: GfxQueryPoolType): GLenum {
    switch (type) {
    case GfxQueryPoolType.OcclusionConservative:
        return WebGL2RenderingContext.ANY_SAMPLES_PASSED_CONSERVATIVE;
    default:
        throw "whoops";
    }
}

function translateVertexFormat(fmt: GfxFormat): { size: number, type: GLenum, normalized: boolean } {
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
        case FormatTypeFlags.F16:
            return WebGL2RenderingContext.HALF_FLOAT;
        case FormatTypeFlags.F32:
            return WebGL2RenderingContext.FLOAT;
        default:
            throw "whoops";
        }
    }

    function translateSize(flags: FormatCompFlags): number {
        switch (flags) {
        case FormatCompFlags.R:
            return 1;
        case FormatCompFlags.RG:
            return 2;
        case FormatCompFlags.RGB:
            return 3;
        case FormatCompFlags.RGBA:
            return 4;
        }
    }

    const typeFlags = getFormatTypeFlags(fmt);
    const compFlags = getFormatCompFlags(fmt);
    const flags = getFormatFlags(fmt);

    const type = translateType(typeFlags);
    const size = translateSize(compFlags);
    const normalized = !!(flags & FormatFlags.Normalized);
    return { size, type, normalized };
}

function isFormatSizedInteger(fmt: GfxFormat): boolean {
    const flags = getFormatFlags(fmt);
    if (!!(flags & FormatFlags.Normalized))
        return false;

    const typeFlags = getFormatTypeFlags(fmt);
    // Check for integer types.
    if (typeFlags === FormatTypeFlags.S8 || typeFlags === FormatTypeFlags.S16 || typeFlags === FormatTypeFlags.S32)
        return true;
    if (typeFlags === FormatTypeFlags.U8 || typeFlags === FormatTypeFlags.U16 || typeFlags === FormatTypeFlags.U32)
        return true;

    return false;
}

function translateIndexFormat(format: GfxFormat): GLenum {
    switch (format) {
    case GfxFormat.U8_R:
        return WebGL2RenderingContext.UNSIGNED_BYTE;
    case GfxFormat.U16_R:
        return WebGL2RenderingContext.UNSIGNED_SHORT;
    case GfxFormat.U32_R:
        return WebGL2RenderingContext.UNSIGNED_INT;
    default:
        throw "whoops";
    }
}

function translateBufferHint(hint: GfxBufferFrequencyHint): GLenum {
    switch (hint) {
    case GfxBufferFrequencyHint.Static:
        return WebGL2RenderingContext.STATIC_DRAW;
    case GfxBufferFrequencyHint.Dynamic:
        return WebGL2RenderingContext.DYNAMIC_DRAW;
    }
}

function translateBufferUsageToTarget(usage: GfxBufferUsage): GLenum {
    if (usage & GfxBufferUsage.Index)
        return WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER;
    else if (usage & GfxBufferUsage.Vertex)
        return WebGL2RenderingContext.ARRAY_BUFFER;
    else if (usage & GfxBufferUsage.Uniform)
        return WebGL2RenderingContext.UNIFORM_BUFFER;
    else if (usage & (GfxBufferUsage.Storage | GfxBufferUsage.CopySrc))
        return WebGL2RenderingContext.COPY_WRITE_BUFFER;
    else
        throw "whoops";
}

function translateWrapMode(wrapMode: GfxWrapMode): GLenum {
    switch (wrapMode) {
    case GfxWrapMode.Clamp:
        return WebGL2RenderingContext.CLAMP_TO_EDGE;
    case GfxWrapMode.Repeat:
        return WebGL2RenderingContext.REPEAT;
    case GfxWrapMode.Mirror:
        return WebGL2RenderingContext.MIRRORED_REPEAT;
    default:
        throw "whoops";
    }
}

function translateFilterMode(filter: GfxTexFilterMode, mipFilter: GfxMipFilterMode): GLenum {
    if (mipFilter === GfxMipFilterMode.Linear && filter === GfxTexFilterMode.Bilinear)
        return WebGL2RenderingContext.LINEAR_MIPMAP_LINEAR;
    if (mipFilter === GfxMipFilterMode.Linear && filter === GfxTexFilterMode.Point)
        return WebGL2RenderingContext.NEAREST_MIPMAP_LINEAR;
    if (mipFilter === GfxMipFilterMode.Nearest && filter === GfxTexFilterMode.Bilinear)
        return WebGL2RenderingContext.LINEAR_MIPMAP_NEAREST;
    if (mipFilter === GfxMipFilterMode.Nearest && filter === GfxTexFilterMode.Point)
        return WebGL2RenderingContext.NEAREST_MIPMAP_NEAREST;
    if (mipFilter === GfxMipFilterMode.NoMip && filter === GfxTexFilterMode.Bilinear)
        return WebGL2RenderingContext.LINEAR;
    if (mipFilter === GfxMipFilterMode.NoMip && filter === GfxTexFilterMode.Point)
        return WebGL2RenderingContext.NEAREST;
    throw new Error(`Unknown texture filter mode`);
}

function translatePrimitiveTopology(topology: GfxPrimitiveTopology): GLenum {
    switch (topology) {
    case GfxPrimitiveTopology.Triangles:
        return WebGL2RenderingContext.TRIANGLES;
    default:
        throw new Error("Unknown primitive topology mode");
    }
}

function translateTextureDimension(dimension: GfxTextureDimension): GLenum {
    if (dimension === GfxTextureDimension.n2D)
        return WebGL2RenderingContext.TEXTURE_2D;
    else if (dimension === GfxTextureDimension.n2DArray)
        return WebGL2RenderingContext.TEXTURE_2D_ARRAY;
    else if (dimension === GfxTextureDimension.Cube)
        return WebGL2RenderingContext.TEXTURE_CUBE_MAP;
    else if (dimension === GfxTextureDimension.n3D)
        return WebGL2RenderingContext.TEXTURE_3D;
    else
        throw "whoops";
}

function getPlatformBuffer(buffer_: GfxBuffer, byteOffset: number = 0): WebGLBuffer {
    const buffer = buffer_ as GfxBufferP_GL;
    return buffer.gl_buffer_pages[(byteOffset / buffer.pageByteSize) | 0];
}

function getPlatformTexture(texture_: GfxTexture): WebGLTexture {
    const texture = texture_ as GfxTextureP_GL;
    return texture.gl_texture;
}

function getPlatformSampler(sampler_: GfxSampler): WebGLSampler {
    const sampler = sampler_ as GfxSamplerP_GL;
    return sampler.gl_sampler;
}

function assignPlatformName(o: any, name: string): void {
    o.name = name;
    o.__SPECTOR_Metadata = { name };
}

function createBindingLayouts(bindingLayouts: GfxBindingLayoutDescriptor[]): GfxBindingLayoutsP_GL {
    let firstUniformBuffer = 0, firstSampler = 0;
    const bindingLayoutTables: GfxBindingLayoutTableP_GL[] = [];
    for (let i = 0; i < bindingLayouts.length; i++) {
        const { numUniformBuffers, numSamplers, samplerEntries } = bindingLayouts[i];

        const bindingSamplerEntries: GfxBindingLayoutSamplerDescriptorP_GL[] = [];

        if (samplerEntries !== undefined)
            assert(samplerEntries.length === numSamplers);

        for (let j = 0; j < numSamplers; j++) {
            const samplerEntry = samplerEntries !== undefined ? samplerEntries[j] : defaultBindingLayoutSamplerDescriptor;
            const { dimension, formatKind } = samplerEntry;
            bindingSamplerEntries.push({ gl_target: translateTextureDimension(dimension), formatKind });
        }

        bindingLayoutTables.push({ firstUniformBuffer, numUniformBuffers, firstSampler, numSamplers, samplerEntries: bindingSamplerEntries });
        firstUniformBuffer += numUniformBuffers;
        firstSampler += numSamplers;
    }
    return { numUniformBuffers: firstUniformBuffer, numSamplers: firstSampler, bindingLayoutTables };
}

function findall(haystack: string, needle: RegExp): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    while (true) {
        const result = needle.exec(haystack);
        if (!result)
            break;
        results.push(result);
    }
    return results;
}

function isBlendStateNone(blendState: GfxChannelBlendState): boolean {
    return (
        blendState.blendMode == GfxBlendMode.Add &&
        blendState.blendSrcFactor == GfxBlendFactor.One &&
        blendState.blendDstFactor === GfxBlendFactor.Zero
    );
}

function isBlockCompressSized(w: number, h: number, bw: number, bh: number): boolean {
    if ((w % bw) !== 0)
        return false;
    if ((h % bh) !== 0)
        return false;
    return true;
}

class ResourceCreationTracker {
    public liveObjects = new Set<GfxResource>();
    public creationStacks = new WeakMap<GfxResource, string>();
    public deletionStacks = new WeakMap<GfxResource, string>();

    public trackResourceCreated(o: GfxResource): void {
        this.creationStacks.set(o, new Error().stack!);
        this.liveObjects.add(o);
    }

    public trackResourceDestroyed(o: GfxResource): void {
        if (this.deletionStacks.has(o))
            console.warn(`Object double freed:`, o, `\n\nCreation stack: `, this.creationStacks.get(o), `\n\nDeletion stack: `, this.deletionStacks.get(o), `\n\nThis stack: `, new Error().stack!);
        this.deletionStacks.set(o, new Error().stack!);
        this.liveObjects.delete(o);
    }

    public checkForLeaks(): void {
        for (const o of this.liveObjects.values())
            console.warn("Object leaked:", o, "Creation stack:", this.creationStacks.get(o));
    }

    public setResourceLeakCheck(o: GfxResource, v: boolean): void {
        if (v)
            this.liveObjects.add(o);
        else
            this.liveObjects.delete(o);
    }
}

interface KHR_parallel_shader_compile {
    COMPLETION_STATUS_KHR: number;
}

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
}

export class GfxPlatformWebGL2Config {
    public trackResources: boolean = false;
    public shaderDebug: boolean = false;
}

interface EXT_texture_compression_rgtc {
    COMPRESSED_RED_RGTC1_EXT: GLenum;
    COMPRESSED_SIGNED_RED_RGTC1_EXT: GLenum;
    COMPRESSED_RED_GREEN_RGTC2_EXT: GLenum;
    COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: GLenum;
}

interface EXT_texture_norm16 {
    R16_EXT: GLenum;
    RG16_EXT: GLenum;
    RGB16_EXT: GLenum;
    RGBA16_EXT: GLenum;
    R16_SNORM_EXT: GLenum;
    RG16_SNORM_EXT: GLenum;
    RGB16_SNORM_EXT: GLenum;
    RGBA16_SNORM_EXT: GLenum;
}

interface OES_draw_buffers_indexed {
    enableiOES(target: GLuint, index: GLuint): void;
    disableiOES(target: GLenum, index: GLuint): void;
    blendEquationiOES(buf: GLuint, mode: GLenum): void;
    blendEquationSeparateiOES(buf: GLuint, modeRGB: GLenum, modeAlpha: GLenum): void;
    blendFunciOES(buf: GLuint, src: GLenum, dst: GLenum): void;
    blendFuncSeparateiOES(buf: GLuint, srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void;
    colorMaskiOES(buf: GLuint, r: GLboolean, g: GLboolean, b: GLboolean, a: GLboolean): void;
}

class GfxImplP_GL implements GfxSwapChain, GfxDevice {
    // Configuration
    private _shaderDebug = false;
    private _contextAttributes: WebGLContextAttributes;

    // GL extension
    private _WEBGL_compressed_texture_s3tc: WEBGL_compressed_texture_s3tc | null = null;
    private _WEBGL_compressed_texture_s3tc_srgb: WEBGL_compressed_texture_s3tc_srgb | null = null;
    private _EXT_texture_compression_rgtc: EXT_texture_compression_rgtc | null = null;
    private _EXT_texture_filter_anisotropic: EXT_texture_filter_anisotropic | null = null;
    private _EXT_texture_norm16: EXT_texture_norm16 | null = null;
    private _KHR_parallel_shader_compile: KHR_parallel_shader_compile | null = null;
    private _OES_draw_buffers_indexed: OES_draw_buffers_indexed | null = null;
    private _OES_texture_float_linear: OES_texture_float_linear | null = null;
    private _OES_texture_half_float_linear: OES_texture_half_float_linear | null = null;

    // Swap Chain
    private _scTexture: GfxTexture | null = null;
    private _scPlatformFramebuffer: WebGLFramebuffer | null = null;

    // GfxDevice
    private _currentActiveTexture: GLenum | null = null;
    private _currentBoundVAO: WebGLVertexArrayObject | null = null;
    private _currentProgram: GfxProgramP_GL | null = null;
    private _resourceCreationTracker: ResourceCreationTracker | null = null;
    private _resourceUniqueId = 0;

    // Cached GL driver state
    private _currentColorAttachments: (GfxRenderTargetP_GL | null)[] = [];
    private _currentColorAttachmentLevels: number[] = [];
    private _currentColorResolveTos: (GfxTextureP_GL | null)[] = [];
    private _currentColorResolveToLevels: number[] = [];
    private _currentDepthStencilAttachment: GfxRenderTargetP_GL | null = null;
    private _currentDepthStencilResolveTo: GfxTextureP_GL | null = null;
    private _currentSampleCount: number = -1;
    private _currentPipeline!: GfxRenderPipelineP_GL;
    private _currentInputState!: GfxInputStateP_GL;
    private _currentMegaState: GfxMegaStateDescriptor = copyMegaState(defaultMegaState);
    private _currentSamplers: (WebGLSampler | null)[] = [];
    private _currentTextures: (WebGLTexture | null)[] = [];
    private _currentUniformBuffers: GfxBuffer[] = [];
    private _currentUniformBufferByteOffsets: number[] = [];
    private _currentUniformBufferByteSizes: number[] = [];
    private _currentScissorEnabled: boolean = false;
    private _currentStencilRef: number | null = null;

    // Pass Execution
    private _currentRenderPassDescriptor: GfxRenderPassDescriptor | null = null;
    private _debugGroupStack: GfxDebugGroup[] = [];
    private _resolveColorAttachmentsChanged: boolean = false;
    private _resolveColorReadFramebuffer: WebGLFramebuffer;
    private _resolveColorDrawFramebuffer: WebGLFramebuffer;
    private _resolveDepthStencilAttachmentsChanged: boolean = false;
    private _resolveDepthStencilReadFramebuffer: WebGLFramebuffer;
    private _resolveDepthStencilDrawFramebuffer: WebGLFramebuffer;
    private _renderPassDrawFramebuffer: WebGLFramebuffer;
    private _readbackFramebuffer: WebGLFramebuffer;

    private _fallbackTexture2D: WebGLTexture;
    private _fallbackTexture2DDepth: WebGLTexture | undefined = undefined;
    private _fallbackTexture2DArray: WebGLTexture;
    private _fallbackTexture3D: WebGLTexture;
    private _fallbackTextureCube: WebGLTexture;

    // GfxVendorInfo
    public readonly platformString: string = 'WebGL2';
    public readonly glslVersion = `#version 300 es`;
    public readonly explicitBindingLocations = false;
    public readonly separateSamplerTextures = false;
    public readonly viewportOrigin = GfxViewportOrigin.LowerLeft;
    public readonly clipSpaceNearZ = GfxClipSpaceNearZ.NegativeOne;

    // GfxLimits
    private _uniformBufferMaxPageByteSize: number;
    public uniformBufferWordAlignment: number;
    public uniformBufferMaxPageWordSize: number;
    public supportedSampleCounts: number[];
    public occlusionQueriesRecommended: boolean;
    public computeShadersSupported: boolean = false;

    constructor(public gl: WebGL2RenderingContext, configuration: GfxPlatformWebGL2Config) {
        this._contextAttributes = assertExists(gl.getContextAttributes());

        this._WEBGL_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        this._WEBGL_compressed_texture_s3tc_srgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');
        this._EXT_texture_compression_rgtc = gl.getExtension('EXT_texture_compression_rgtc');
        this._EXT_texture_filter_anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
        this._EXT_texture_norm16 = gl.getExtension('EXT_texture_norm16');
        this._KHR_parallel_shader_compile = gl.getExtension('KHR_parallel_shader_compile');
        this._OES_texture_float_linear = gl.getExtension('OES_texture_float_linear');
        this._OES_texture_half_float_linear = gl.getExtension('OES_texture_half_float_linear');
        // this._OES_draw_buffers_indexed = gl.getExtension('OES_draw_buffers_indexed');

        this._uniformBufferMaxPageByteSize = Math.min(gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE), UBO_PAGE_MAX_BYTE_SIZE);

        // Create our fake swap-chain texture.
        this._scTexture = {
            _T: _T.Texture,
            ResourceUniqueId: this.getNextUniqueId(),
            width: 0, height: 0, depth: 1, numLevels: 1,
            gl_target: null!, gl_texture: null!,
            pixelFormat: (this._contextAttributes.alpha === false) ? GfxFormat.U8_RGB_RT : GfxFormat.U8_RGBA_RT,
            formatKind: GfxSamplerFormatKind.Float,
        } as GfxTextureP_GL;

        this._resolveColorReadFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._resolveColorDrawFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._resolveDepthStencilReadFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._resolveDepthStencilDrawFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._renderPassDrawFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._readbackFramebuffer = this.ensureResourceExists(gl.createFramebuffer());

        this._fallbackTexture2D = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Float);
        // this._fallbackTexture2DDepth = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Depth);
        this._fallbackTexture2DArray = this.createFallbackTexture(GfxTextureDimension.n2DArray, GfxSamplerFormatKind.Float);
        this._fallbackTexture3D = this.createFallbackTexture(GfxTextureDimension.n3D, GfxSamplerFormatKind.Float);
        this._fallbackTextureCube = this.createFallbackTexture(GfxTextureDimension.Cube, GfxSamplerFormatKind.Float);

        // Adjust for GL defaults.
        this._currentMegaState.depthCompare = GfxCompareMode.Less;
        this._currentMegaState.depthWrite = false;
        this._currentMegaState.attachmentsState[0].channelWriteMask = GfxChannelWriteMask.AllChannels;

        // We always have depth & stencil test enabled.
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.STENCIL_TEST);

        this._checkLimits();
        this._checkForBugQuirks();

        if (configuration.shaderDebug)
            this._shaderDebug = true;

        if (configuration.trackResources)
            this._resourceCreationTracker = new ResourceCreationTracker();
    }

    private createFallbackTexture(dimension: GfxTextureDimension, formatKind: GfxSamplerFormatKind): WebGLTexture {
        const depth = dimension === GfxTextureDimension.Cube ? 6 : 1;
        const pixelFormat = formatKind === GfxSamplerFormatKind.Depth ? GfxFormat.D32F : GfxFormat.U8_RGBA_NORM;
        const texture = this.createTexture({
            dimension, pixelFormat, usage: GfxTextureUsage.Sampled,
            width: 1, height: 1, depth, numLevels: 1,
        });
        if (formatKind === GfxSamplerFormatKind.Float)
            this.uploadTextureData(texture, 0, [new Uint8Array(4 * depth)]);
        return getPlatformTexture(texture);
    }

    private _checkLimits(): void {
        const gl = this.gl;

        this.uniformBufferWordAlignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) / 4;
        this.uniformBufferMaxPageWordSize = this._uniformBufferMaxPageByteSize / 4;

        const supportedSampleCounts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH32F_STENCIL8, gl.SAMPLES);
        this.supportedSampleCounts = supportedSampleCounts ? [...supportedSampleCounts] : [];
        if (!this.supportedSampleCounts.includes(1))
            this.supportedSampleCounts.push(1);
        this.supportedSampleCounts.sort((a, b) => (a - b));

        this.occlusionQueriesRecommended = true;
    }

    private _checkForBugQuirks(): void {
        if (navigator.userAgent.includes('Firefox')) {
            // TODO(jstpierre): File Bugzilla bug, check Firefox version.
            // getQueryParameter on Firefox causes a full GL command buffer sync
            // (verified with private correspondence with Kelsey Gilbert).
            this.occlusionQueriesRecommended = false;
        }
    }

    //#region GfxSwapChain
    public configureSwapChain(width: number, height: number, platformFramebuffer?: GfxPlatformFramebuffer): void {
        const texture = this._scTexture as GfxTextureP_GL;
        texture.width = width;
        texture.height = height;
        this._scPlatformFramebuffer = nullify(platformFramebuffer);
    }

    public getDevice(): GfxDevice {
        return this;
    }

    public getCanvas(): HTMLCanvasElement | OffscreenCanvas {
        return this.gl.canvas;
    }

    public getOnscreenTexture(): GfxTexture {
        return this._scTexture!;
    }
    //#endregion

    //#region GfxDevice
    private translateTextureInternalFormat(fmt: GfxFormat): GLenum {
        switch (fmt) {
        case GfxFormat.F16_R:
            return WebGL2RenderingContext.R16F;
        case GfxFormat.F16_RG:
            return WebGL2RenderingContext.RG16F;
        case GfxFormat.F16_RGB:
            return WebGL2RenderingContext.RGB16F;
        case GfxFormat.F16_RGBA:
            return WebGL2RenderingContext.RGBA16F;
        case GfxFormat.F32_R:
            return WebGL2RenderingContext.R32F;
        case GfxFormat.F32_RG:
            return WebGL2RenderingContext.RG32F;
        case GfxFormat.F32_RGB:
            return WebGL2RenderingContext.RGB32F;
        case GfxFormat.F32_RGBA:
            return WebGL2RenderingContext.RGBA32F;
        case GfxFormat.U8_R_NORM:
            return WebGL2RenderingContext.R8;
        case GfxFormat.U8_RG_NORM:
            return WebGL2RenderingContext.RG8;
        case GfxFormat.U8_RGB_NORM:
        case GfxFormat.U8_RGB_RT:
            return WebGL2RenderingContext.RGB8;
        case GfxFormat.U8_RGB_SRGB:
            return WebGL2RenderingContext.SRGB8;
        case GfxFormat.U8_RGBA_NORM:
        case GfxFormat.U8_RGBA_RT:
            return WebGL2RenderingContext.RGBA8;
        case GfxFormat.U8_RGBA_SRGB:
        case GfxFormat.U8_RGBA_RT_SRGB:
            return WebGL2RenderingContext.SRGB8_ALPHA8;
        case GfxFormat.U16_R:
            return WebGL2RenderingContext.R16UI;
        case GfxFormat.U16_R_NORM:
            return this._EXT_texture_norm16!.R16_EXT;
        case GfxFormat.U16_RG_NORM:
            return this._EXT_texture_norm16!.RG16_EXT;
        case GfxFormat.U16_RGBA_NORM:
            return this._EXT_texture_norm16!.RGBA16_EXT;
        case GfxFormat.U16_RGBA_5551:
            return WebGL2RenderingContext.RGB5_A1;
        case GfxFormat.U16_RGB_565:
            return WebGL2RenderingContext.RGB565;
        case GfxFormat.U32_R:
            return WebGL2RenderingContext.R32UI;
        case GfxFormat.S8_RGBA_NORM:
            return WebGL2RenderingContext.RGBA8_SNORM;
        case GfxFormat.S8_RG_NORM:
            return WebGL2RenderingContext.RG8_SNORM;
        case GfxFormat.BC1:
            return this._WEBGL_compressed_texture_s3tc!.COMPRESSED_RGBA_S3TC_DXT1_EXT;
        case GfxFormat.BC1_SRGB:
            return this._WEBGL_compressed_texture_s3tc_srgb!.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;
        case GfxFormat.BC2:
            return this._WEBGL_compressed_texture_s3tc!.COMPRESSED_RGBA_S3TC_DXT3_EXT;
        case GfxFormat.BC2_SRGB:
            return this._WEBGL_compressed_texture_s3tc_srgb!.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;
        case GfxFormat.BC3:
            return this._WEBGL_compressed_texture_s3tc!.COMPRESSED_RGBA_S3TC_DXT5_EXT;
        case GfxFormat.BC3_SRGB:
            return this._WEBGL_compressed_texture_s3tc_srgb!.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT;
        case GfxFormat.BC4_UNORM:
            return this._EXT_texture_compression_rgtc!.COMPRESSED_RED_RGTC1_EXT;
        case GfxFormat.BC4_SNORM:
            return this._EXT_texture_compression_rgtc!.COMPRESSED_SIGNED_RED_RGTC1_EXT;
        case GfxFormat.BC5_UNORM:
            return this._EXT_texture_compression_rgtc!.COMPRESSED_RED_GREEN_RGTC2_EXT;
        case GfxFormat.BC5_SNORM:
            return this._EXT_texture_compression_rgtc!.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT;
        case GfxFormat.D32F_S8:
            return WebGL2RenderingContext.DEPTH32F_STENCIL8;
        case GfxFormat.D24_S8:
            return WebGL2RenderingContext.DEPTH24_STENCIL8;
        case GfxFormat.D32F:
            return WebGL2RenderingContext.DEPTH_COMPONENT32F;
        case GfxFormat.D24:
            return WebGL2RenderingContext.DEPTH_COMPONENT24;
        default:
            throw "whoops";
        }
    }

    private translateTextureFormat(fmt: GfxFormat): GLenum {
        if (this.isTextureFormatCompressed(fmt))
            return this.translateTextureInternalFormat(fmt);

        switch (fmt) {
        case GfxFormat.D24_S8:
        case GfxFormat.D32F_S8:
            return WebGL2RenderingContext.DEPTH_STENCIL;
        case GfxFormat.D24:
        case GfxFormat.D32F:
            return WebGL2RenderingContext.DEPTH_COMPONENT;
        default:
            break;
        }

        const isInteger = isFormatSizedInteger(fmt);

        const compFlags: FormatCompFlags = getFormatCompFlags(fmt);
        switch (compFlags) {
        case FormatCompFlags.R:
            return isInteger ? WebGL2RenderingContext.RED_INTEGER : WebGL2RenderingContext.RED;
        case FormatCompFlags.RG:
            return isInteger ? WebGL2RenderingContext.RG_INTEGER : WebGL2RenderingContext.RG;
        case FormatCompFlags.RGB:
            return isInteger ? WebGL2RenderingContext.RGB_INTEGER : WebGL2RenderingContext.RGB;
        case FormatCompFlags.RGBA:
            return isInteger ? WebGL2RenderingContext.RGBA_INTEGER : WebGL2RenderingContext.RGBA;
        }
    }
    
    private translateTextureType(fmt: GfxFormat): GLenum {
        const typeFlags: FormatTypeFlags = getFormatTypeFlags(fmt);
        switch (typeFlags) {
        case FormatTypeFlags.U8:
            return WebGL2RenderingContext.UNSIGNED_BYTE;
        case FormatTypeFlags.U16:
            return WebGL2RenderingContext.UNSIGNED_SHORT;
        case FormatTypeFlags.U32:
            return WebGL2RenderingContext.UNSIGNED_INT;
        case FormatTypeFlags.S8:
            return WebGL2RenderingContext.BYTE;
        case FormatTypeFlags.F16:
            return WebGL2RenderingContext.HALF_FLOAT;
        case FormatTypeFlags.F32:
            return WebGL2RenderingContext.FLOAT;
        case FormatTypeFlags.U16_PACKED_5551:
            return WebGL2RenderingContext.UNSIGNED_SHORT_5_5_5_1;
        case FormatTypeFlags.U16_PACKED_565:
            return WebGL2RenderingContext.UNSIGNED_SHORT_5_6_5;
        case FormatTypeFlags.D32F:
            return WebGL2RenderingContext.FLOAT;
        case FormatTypeFlags.D24:
        case FormatTypeFlags.D24S8:
            return WebGL2RenderingContext.UNSIGNED_INT_24_8;
        case FormatTypeFlags.D32FS8:
            return WebGL2RenderingContext.FLOAT_32_UNSIGNED_INT_24_8_REV;
        default:
            throw "whoops";
        }
    }

    private isTextureFormatCompressed(fmt: GfxFormat): boolean {
        const typeFlags: FormatTypeFlags = getFormatTypeFlags(fmt);
        switch (typeFlags) {
        case FormatTypeFlags.BC1:
        case FormatTypeFlags.BC2:
        case FormatTypeFlags.BC3:
        case FormatTypeFlags.BC4_UNORM:
        case FormatTypeFlags.BC4_SNORM:
        case FormatTypeFlags.BC5_UNORM:
        case FormatTypeFlags.BC5_SNORM:
            return true;
        default:
            return false;
        }
    }

    private clampNumLevels(descriptor: GfxTextureDescriptor): number {
        if (descriptor.dimension === GfxTextureDimension.n2DArray && descriptor.depth > 1) {
            const typeFlags: FormatTypeFlags = getFormatTypeFlags(descriptor.pixelFormat);
            if (typeFlags === FormatTypeFlags.BC1) {
                // Chrome/ANGLE seems to have issues with compressed miplevels of size 1/2, so clamp before they arrive...
                // https://bugs.chromium.org/p/angleproject/issues/detail?id=4056
                let w = descriptor.width, h = descriptor.height;
                for (let i = 0; i < descriptor.numLevels; i++) {
                    if (w <= 2 || h <= 2)
                        return i - 1;

                    w = Math.max((w / 2) | 0, 1);
                    h = Math.max((h / 2) | 0, 1);
                }
            }
        }

        return descriptor.numLevels;
    }

    private _setActiveTexture(texture: GLenum): void {
        if (this._currentActiveTexture !== texture) {
            this.gl.activeTexture(texture);
            this._currentActiveTexture = texture;
        }
    }

    private _setVAO(vao: WebGLVertexArrayObject | null): void {
        if (this._currentBoundVAO !== vao) {
            this.gl.bindVertexArray(vao);
            this._currentBoundVAO = vao;
        }
    }

    private _programCompiled(program: GfxProgramP_GL): void {
        assert(program.compileState !== GfxProgramCompileStateP_GL.NeedsCompile);

        if (program.compileState === GfxProgramCompileStateP_GL.Compiling) {
            program.compileState = GfxProgramCompileStateP_GL.NeedsBind;

            if (this._shaderDebug)
                this._checkProgramCompilationForErrors(program);
        }
    }

    private _setProgram(program: GfxProgramP_GL): void {
        if (this._currentProgram === program)
            return;

        this._programCompiled(program);
        this.gl.useProgram(program.gl_program);
        this._currentProgram = program;
    }

    private ensureResourceExists<T>(resource: T | null): T {
        if (resource === null) {
            const error = this.gl.getError();
            throw new Error(`Created resource is null; GL error encountered: ${error}`);
        } else {
            return resource;
        }
    }

    private _createBufferPage(byteSize: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): WebGLBuffer {
        const gl = this.gl;
        const gl_buffer = this.ensureResourceExists(gl.createBuffer());
        const gl_target = translateBufferUsageToTarget(usage);
        const gl_hint = translateBufferHint(hint);
        gl.bindBuffer(gl_target, gl_buffer);
        gl.bufferData(gl_target, byteSize, gl_hint);
        return gl_buffer;
    }

    private getNextUniqueId(): number {
        return ++this._resourceUniqueId;
    }

    public createBuffer(wordCount: number, usage: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer {
        // Temporarily unbind VAO when creating buffers to not stomp on the VAO configuration.
        this.gl.bindVertexArray(null);

        const byteSize = wordCount * 4;
        const gl_buffer_pages: WebGLBuffer[] = [];

        let pageByteSize: number;
        if (usage === GfxBufferUsage.Uniform) {
            assert((byteSize % this._uniformBufferMaxPageByteSize) === 0);
            let byteSizeLeft = byteSize;
            while (byteSizeLeft > 0) {
                gl_buffer_pages.push(this._createBufferPage(Math.min(byteSizeLeft, this._uniformBufferMaxPageByteSize), usage, hint));
                byteSizeLeft -= this._uniformBufferMaxPageByteSize;
            }

            pageByteSize = this._uniformBufferMaxPageByteSize;
        } else {
            gl_buffer_pages.push(this._createBufferPage(byteSize, usage, hint));
            pageByteSize = byteSize;
        }

        const gl_target = translateBufferUsageToTarget(usage);
        const buffer: GfxBufferP_GL = { _T: _T.Buffer, ResourceUniqueId: this.getNextUniqueId(), gl_buffer_pages, gl_target, usage, byteSize, pageByteSize };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(buffer);

        this.gl.bindVertexArray(this._currentBoundVAO);

        return buffer;
    }

    private _createTexture(descriptor: GfxTextureDescriptor): GfxTexture {
        const gl = this.gl;
        const gl_texture = this.ensureResourceExists(gl.createTexture());
        let gl_target: GLenum;
        const internalformat = this.translateTextureInternalFormat(descriptor.pixelFormat);
        this._setActiveTexture(gl.TEXTURE0);
        this._currentTextures[0] = null;
        const numLevels = this.clampNumLevels(descriptor);
        if (descriptor.dimension === GfxTextureDimension.n2D) {
            gl_target = WebGL2RenderingContext.TEXTURE_2D;
            gl.bindTexture(gl_target, gl_texture);
            gl.texStorage2D(gl_target, numLevels, internalformat, descriptor.width, descriptor.height);
            assert(descriptor.depth === 1);
        } else if (descriptor.dimension === GfxTextureDimension.n2DArray) {
            gl_target = WebGL2RenderingContext.TEXTURE_2D_ARRAY;
            gl.bindTexture(gl_target, gl_texture);
            gl.texStorage3D(gl_target, numLevels, internalformat, descriptor.width, descriptor.height, descriptor.depth);
        } else if (descriptor.dimension === GfxTextureDimension.n3D) {
            gl_target = WebGL2RenderingContext.TEXTURE_3D;
            gl.bindTexture(gl_target, gl_texture);
            gl.texStorage3D(gl_target, numLevels, internalformat, descriptor.width, descriptor.height, descriptor.depth);
        } else if (descriptor.dimension === GfxTextureDimension.Cube) {
            gl_target = WebGL2RenderingContext.TEXTURE_CUBE_MAP;
            gl.bindTexture(gl_target, gl_texture);
            gl.texStorage2D(gl_target, numLevels, internalformat, descriptor.width, descriptor.height);
            assert(descriptor.depth === 6);
        } else {
            throw "whoops";
        }
        const texture: GfxTextureP_GL = { _T: _T.Texture, ResourceUniqueId: this.getNextUniqueId(),
            gl_texture, gl_target,
            pixelFormat: descriptor.pixelFormat,
            width: descriptor.width,
            height: descriptor.height,
            depth: descriptor.depth,
            numLevels,
            formatKind: getFormatSamplerKind(descriptor.pixelFormat),
        };
        return texture;
    }

    public createTexture(descriptor: GfxTextureDescriptor): GfxTexture {
        const texture = this._createTexture(descriptor);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(texture);
        return texture;
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        const gl = this.gl;
        const gl_sampler = this.ensureResourceExists(gl.createSampler());
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_WRAP_S, translateWrapMode(descriptor.wrapS));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_WRAP_T, translateWrapMode(descriptor.wrapT));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_WRAP_R, translateWrapMode(descriptor.wrapQ ?? descriptor.wrapS));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MIN_FILTER, translateFilterMode(descriptor.minFilter, descriptor.mipFilter));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MAG_FILTER, translateFilterMode(descriptor.magFilter, GfxMipFilterMode.NoMip));

        if (descriptor.minLOD !== undefined)
            gl.samplerParameterf(gl_sampler, gl.TEXTURE_MIN_LOD, descriptor.minLOD);
        if (descriptor.maxLOD !== undefined)
            gl.samplerParameterf(gl_sampler, gl.TEXTURE_MAX_LOD, descriptor.maxLOD);
        if (descriptor.compareMode !== undefined) {
            gl.samplerParameteri(gl_sampler, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
            gl.samplerParameteri(gl_sampler, gl.TEXTURE_COMPARE_FUNC, descriptor.compareMode);
        }

        const maxAnisotropy = descriptor.maxAnisotropy ?? 1;
        if (maxAnisotropy > 1 && this._EXT_texture_filter_anisotropic !== null) {
            assert(descriptor.minFilter === GfxTexFilterMode.Bilinear && descriptor.magFilter === GfxTexFilterMode.Bilinear && descriptor.mipFilter === GfxMipFilterMode.Linear);
            gl.samplerParameterf(gl_sampler, this._EXT_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
        }

        const sampler: GfxSamplerP_GL = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gl_sampler };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(sampler);
        return sampler;
    }

    public createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTarget {
        const { pixelFormat, width, height, sampleCount } = descriptor;
        const gl = this.gl;

        const gl_renderbuffer = this.ensureResourceExists(gl.createRenderbuffer());
        gl.bindRenderbuffer(gl.RENDERBUFFER, gl_renderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, sampleCount, this.translateTextureInternalFormat(pixelFormat), width, height);

        const renderTarget: GfxRenderTargetP_GL = { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            gl_renderbuffer,
            gfxTexture: null,
            pixelFormat, width, height, sampleCount,
        };

        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(renderTarget);
        return renderTarget;
    }

    public createRenderTargetFromTexture(gfxTexture: GfxTexture): GfxRenderTarget {
        const { pixelFormat, width, height } = gfxTexture as GfxTextureP_GL;

        const renderTarget: GfxRenderTargetP_GL = { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            gl_renderbuffer: null,
            gfxTexture,
            pixelFormat, width, height, sampleCount: 1,
        };

        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(renderTarget);
        return renderTarget;
    }

    private _createProgram(descriptor: GfxProgramDescriptorSimple): GfxProgramP_GL {
        const gl = this.gl;
        const gl_program: WebGLProgram = this.ensureResourceExists(gl.createProgram());
        const gl_shader_vert: WebGLShader | null = null;
        const gl_shader_frag: WebGLShader | null = null;
        const compileState = GfxProgramCompileStateP_GL.NeedsCompile;
        const program: GfxProgramP_GL = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor, compileState, gl_program, gl_shader_vert, gl_shader_frag };
        this._tryCompileProgram(program);
        return program;
    }

    public createComputeProgram(program: GfxComputeProgramDescriptor): GfxProgram {
        throw "whoops";
    }

    public createProgramSimple(descriptor: GfxProgramDescriptor): GfxProgramP_GL {
        const program = this._createProgram(descriptor);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(program);
        return program;
    }

    public createBindings(descriptor: GfxBindingsDescriptor): GfxBindings {
        const { bindingLayout, uniformBufferBindings, samplerBindings } = descriptor;
        assert(uniformBufferBindings.length >= bindingLayout.numUniformBuffers);
        assert(samplerBindings.length >= bindingLayout.numSamplers);
        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            assert(uniformBufferBindings[i].wordCount > 0);
        const bindings: GfxBindingsP_GL = { _T: _T.Bindings, ResourceUniqueId: this.getNextUniqueId(), uniformBufferBindings, samplerBindings };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(bindings);
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        const { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat } = inputLayoutDescriptor;
        assert(indexBufferFormat === GfxFormat.U16_R || indexBufferFormat === GfxFormat.U32_R || indexBufferFormat === null);
        const inputLayout: GfxInputLayoutP_GL = { _T: _T.InputLayout, ResourceUniqueId: this.getNextUniqueId(), vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(inputLayout);
        return inputLayout;
    }

    public createInputState(inputLayout_: GfxInputLayout, vertexBuffers: (GfxVertexBufferDescriptor | null)[], indexBufferBinding: GfxIndexBufferDescriptor | null): GfxInputState {
        const inputLayout = inputLayout_ as GfxInputLayoutP_GL;

        const gl = this.gl;
        const vao = this.ensureResourceExists(gl.createVertexArray());
        gl.bindVertexArray(vao);

        for (let i = 0; i < inputLayout.vertexAttributeDescriptors.length; i++) {
            const attr = inputLayout.vertexAttributeDescriptors[i];

            if (isFormatSizedInteger(attr.format)) {
                // See https://groups.google.com/d/msg/angleproject/yQb5DaCzcWg/Ova0E3wcAQAJ for more info.
                // console.warn("Vertex format uses sized integer types; this will cause a shader recompile on ANGLE platforms");
                // debugger;
            }

            const { size, type, normalized } = translateVertexFormat(attr.format);
            const vertexBuffer = vertexBuffers[attr.bufferIndex];
            if (vertexBuffer === null)
                continue;

            const inputLayoutBuffer = assertExists(inputLayout.vertexBufferDescriptors[attr.bufferIndex]);

            const buffer = vertexBuffer.buffer as GfxBufferP_GL;
            assert(buffer.usage === GfxBufferUsage.Vertex);
            gl.bindBuffer(gl.ARRAY_BUFFER, getPlatformBuffer(vertexBuffer.buffer));

            const bufferOffset = vertexBuffer.byteOffset + attr.bufferByteOffset;
            gl.vertexAttribPointer(attr.location, size, type, normalized, inputLayoutBuffer.byteStride, bufferOffset);

            if (inputLayoutBuffer.frequency === GfxVertexBufferFrequency.PerInstance) {
                gl.vertexAttribDivisor(attr.location, 1);
            }

            gl.enableVertexAttribArray(attr.location);
        }

        let indexBufferType: GLenum | null = null;
        let indexBufferCompByteSize: number | null = null;
        let indexBufferByteOffset: number | null = null;
        if (indexBufferBinding !== null) {
            const buffer = indexBufferBinding.buffer as GfxBufferP_GL;
            assert(buffer.usage === GfxBufferUsage.Index);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, getPlatformBuffer(indexBufferBinding.buffer));
            indexBufferType = translateIndexFormat(assertExists(inputLayout.indexBufferFormat));
            indexBufferCompByteSize = getFormatCompByteSize(inputLayout.indexBufferFormat!);
            indexBufferByteOffset = indexBufferBinding.byteOffset;
        }

        gl.bindVertexArray(null);

        const inputState: GfxInputStateP_GL = { _T: _T.InputState, ResourceUniqueId: this.getNextUniqueId(), vao, indexBufferByteOffset, indexBufferType, indexBufferCompByteSize, inputLayout, vertexBuffers };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(inputState);
        return inputState;
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const bindingLayouts = createBindingLayouts(descriptor.bindingLayouts);
        const drawMode = translatePrimitiveTopology(descriptor.topology);
        const program = descriptor.program as GfxProgramP_GL;
        const inputLayout = descriptor.inputLayout as GfxInputLayoutP_GL | null;

        const megaState = descriptor.megaStateDescriptor;
        const colorAttachmentFormats = descriptor.colorAttachmentFormats.slice();
        const depthStencilAttachmentFormat = descriptor.depthStencilAttachmentFormat;
        const sampleCount = descriptor.sampleCount;

        const pipeline: GfxRenderPipelineP_GL = { _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(),
            bindingLayouts, drawMode, program, megaState, inputLayout,
            colorAttachmentFormats, depthStencilAttachmentFormat, sampleCount,
        };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(pipeline);
        return pipeline;
    }

    public createComputePipeline(descriptor: GfxComputePipelineDescriptor): GfxComputePipeline {
        throw "whoops";
    }

    public createReadback(byteSize: number): GfxReadback {
        const gl = this.gl;
        const gl_buffer = this.ensureResourceExists(gl.createBuffer());
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, gl_buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, byteSize, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const readback: GfxReadbackP_GL = { _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId(), byteSize, gl_buffer, gl_sync: null };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(readback);
        return readback;
    }

    public createQueryPool(type: GfxQueryPoolType, elemCount: number): GfxQueryPool {
        const gl = this.gl;
        const gl_query = nArray(elemCount, () => this.ensureResourceExists(gl.createQuery()));
        const gl_query_type = translateQueryPoolType(type);
        const queryPool: GfxQueryPoolP_GL = { _T: _T.QueryPool, ResourceUniqueId: this.getNextUniqueId(), gl_query, gl_query_type };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(queryPool);
        return queryPool;
    }

    public async createWebXRLayer(webXRSession: XRSession): Promise<XRWebGLLayer> {
        await this.gl.makeXRCompatible();
        return new XRWebGLLayer(webXRSession, this.gl, { antialias: false });
    }

    public destroyBuffer(o: GfxBuffer): void {
        const { gl_buffer_pages } = o as GfxBufferP_GL;
        for (let i = 0; i < gl_buffer_pages.length; i++)
            this.gl.deleteBuffer(gl_buffer_pages[i]);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    private _destroyTexture(o: GfxTexture): void {
        this.gl.deleteTexture(getPlatformTexture(o));
    }

    public destroyTexture(o: GfxTexture): void {
        this._destroyTexture(o);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroySampler(o: GfxSampler): void {
        this.gl.deleteSampler(getPlatformSampler(o));
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyRenderTarget(o_: GfxRenderTarget): void {
        const o = o_ as GfxRenderTargetP_GL;
        if (o.gl_renderbuffer !== null)
            this.gl.deleteRenderbuffer(o.gl_renderbuffer);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyProgram(o: GfxProgram): void {
        const program = o as GfxProgramP_GL;
        this.gl.deleteProgram(program.gl_program);
        this.gl.deleteShader(program.gl_shader_vert);
        this.gl.deleteShader(program.gl_shader_frag);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyBindings(o: GfxBindings): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyInputLayout(o: GfxInputLayout): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyInputState(o: GfxInputState): void {
        const inputState = o as GfxInputStateP_GL;
        if (this._currentBoundVAO === inputState.vao) {
            this.gl.bindVertexArray(null);
            this._currentBoundVAO = null;
        }
        this.gl.deleteVertexArray(inputState.vao);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyComputePipeline(o: GfxComputePipeline): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyReadback(o: GfxReadback): void {
        const readback = o as GfxReadbackP_GL;
        if (readback.gl_sync !== null)
            this.gl.deleteSync(readback.gl_sync);
        if (readback.gl_buffer !== null)
            this.gl.deleteBuffer(readback.gl_buffer);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyQueryPool(o: GfxQueryPool): void {
        const queryPool = o as GfxQueryPoolP_GL;
        for (let i = 0; i < queryPool.gl_query.length; i++)
            this.gl.deleteQuery(queryPool.gl_query[i]);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(queryPool);
    }

    public pipelineQueryReady(o: GfxRenderPipeline): boolean {
        const pipeline = o as GfxRenderPipelineP_GL;
        return this.queryProgramReady(pipeline.program);
    }

    public pipelineForceReady(o: GfxRenderPipeline): void {
        // No need to do anything; it will be forced to compile when used naturally.
    }

    public createRenderPass(descriptor: GfxRenderPassDescriptor): GfxRenderPass {
        assert(this._currentRenderPassDescriptor === null);
        this._currentRenderPassDescriptor = descriptor;

        const { colorAttachment, colorAttachmentLevel, colorClearColor, colorResolveTo, colorResolveToLevel, depthStencilAttachment, depthClearValue, stencilClearValue, depthStencilResolveTo } = descriptor;
        this._setRenderPassParametersBegin(colorAttachment.length);
        for (let i = 0; i < colorAttachment.length; i++)
            this._setRenderPassParametersColor(i, colorAttachment[i] as GfxRenderTargetP_GL | null, colorAttachmentLevel[i], colorResolveTo[i]  as GfxTextureP_GL | null, colorResolveToLevel[i]);
        this._setRenderPassParametersDepthStencil(depthStencilAttachment as GfxRenderTargetP_GL | null, depthStencilResolveTo as GfxTextureP_GL | null);
        this._validateCurrentAttachments();
        for (let i = 0; i < colorAttachment.length; i++) {
            const clearColor = colorClearColor[i];
            if (clearColor === 'load')
                continue;
            this._setRenderPassParametersClearColor(i, clearColor.r, clearColor.g, clearColor.b, clearColor.a);
        }
        this._setRenderPassParametersClearDepthStencil(depthClearValue, stencilClearValue);
        return this;
    }

    public createComputePass(): GfxComputePass {
        throw "whoops";
    }

    public submitPass(o: GfxPass): void {
        assert(o === this);
        assert(this._currentRenderPassDescriptor !== null);
        this.endPass();
        this._currentRenderPassDescriptor = null;
    }

    public beginFrame(): void {
    }

    public endFrame(): void {
        const gl = this.gl;

        // Force alpha to white.

        // TODO(jstpierre): Remove this eventually?
        if (this._currentMegaState.attachmentsState[0].channelWriteMask !== GfxChannelWriteMask.Alpha) {
            gl.colorMask(false, false, false, true);
            this._currentMegaState.attachmentsState[0].channelWriteMask = GfxChannelWriteMask.Alpha;
        }

        // TODO(jstpierre): gl.clearBufferfv seems to have an issue in Chrome / ANGLE which causes a nasty visual tear.
        // gl.clearBufferfv(gl.COLOR, 0, [0.0, 0.0, 0.0, 1.0]);

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    public copySubTexture2D(dst_: GfxTexture, dstX: number, dstY: number, src_: GfxTexture, srcX: number, srcY: number): void {
        const gl = this.gl;

        const dst = dst_ as GfxTextureP_GL;
        const src = src_ as GfxTextureP_GL;
        assert(src.numLevels === 1);
        assert(dst.numLevels === 1);

        if (dst === this._scTexture) {
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._scPlatformFramebuffer);
        } else {
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolveColorDrawFramebuffer);
            this._bindFramebufferAttachment(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, dst, 0);
        }

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveColorReadFramebuffer);
        this._bindFramebufferAttachment(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, src, 0);

        gl.blitFramebuffer(srcX, srcY, srcX + src.width, srcY + src.height, dstX, dstY, dstX + src.width, dstY + src.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    public uploadBufferData(buffer: GfxBuffer, dstByteOffset: number, data: Uint8Array, srcByteOffset: number = 0, byteSize: number = data.byteLength - srcByteOffset): void {
        const gl = this.gl;
        const { gl_target, byteSize: dstByteSize, pageByteSize: dstPageByteSize } = buffer as GfxBufferP_GL;
        if (gl_target === gl.UNIFORM_BUFFER) {
            // Manually check asserts for speed.
            if (!((dstByteOffset % dstPageByteSize) === 0))
                throw new Error(`Assert fail: (dstByteOffset [${dstByteOffset}] % dstPageByteSize [${dstPageByteSize}]) === 0`);
            if (!((byteSize % dstPageByteSize) === 0))
                throw new Error(`Assert fail: (byteSize [${byteSize}] % dstPageByteSize [${dstPageByteSize}]) === 0`);
        }
        if (!((dstByteOffset + byteSize) <= dstByteSize))
            throw new Error(`Assert fail: (dstByteOffset [${dstByteOffset}] + byteSize [${byteSize}]) <= dstByteSize [${dstByteSize}], gl_target ${gl_target}`);

        const virtBufferByteOffsetEnd = dstByteOffset + byteSize;
        let virtBufferByteOffset = dstByteOffset;
        let physBufferByteOffset = dstByteOffset % dstPageByteSize;
        while (virtBufferByteOffset < virtBufferByteOffsetEnd) {
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, getPlatformBuffer(buffer, virtBufferByteOffset));
            gl.bufferSubData(gl.COPY_WRITE_BUFFER, physBufferByteOffset, data, srcByteOffset, Math.min(virtBufferByteOffsetEnd - virtBufferByteOffset, dstPageByteSize));
            virtBufferByteOffset += dstPageByteSize;
            physBufferByteOffset = 0;
            srcByteOffset += dstPageByteSize;
            this._debugGroupStatisticsBufferUpload();
        }
    }

    public uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void {
        const gl = this.gl;
       
        const { gl_texture, gl_target, pixelFormat, width, height, depth, numLevels } = texture as GfxTextureP_GL;
        const isCompressed = this.isTextureFormatCompressed(pixelFormat);
        const is3D = gl_target === WebGL2RenderingContext.TEXTURE_3D || gl_target === WebGL2RenderingContext.TEXTURE_2D_ARRAY;
        const isCube = gl_target === WebGL2RenderingContext.TEXTURE_CUBE_MAP;

        this._setActiveTexture(gl.TEXTURE0);
        this._currentTextures[0] = null;
        gl.bindTexture(gl_target, gl_texture);
        let w = width, h = height, d = depth;
        const maxMipLevel = Math.min(firstMipLevel + levelDatas.length, numLevels);

        const gl_format = this.translateTextureFormat(pixelFormat);

        for (let i = 0, levelDatasIdx = 0; i < maxMipLevel; i++) {
            if (i >= firstMipLevel) {
                const levelData = levelDatas[levelDatasIdx++] as Uint8Array;
                const sliceElementSize = levelData.length / depth;

                if (is3D && isCompressed) {
                    // Workaround for https://bugs.chromium.org/p/chromium/issues/detail?id=1004511
                    for (let z = 0; z < depth; z++) {
                        gl.compressedTexSubImage3D(gl_target, i, 0, 0, z, w, h, 1, gl_format, levelData, z * sliceElementSize, sliceElementSize);
                    }
                } else if (isCube) {
                    for (let z = 0; z < depth; z++) {
                        const face_target = WebGL2RenderingContext.TEXTURE_CUBE_MAP_POSITIVE_X + (z % 6);
                        if (isCompressed) {
                            gl.compressedTexSubImage2D(face_target, i, 0, 0, w, h, gl_format, levelData, z * sliceElementSize, sliceElementSize);
                        } else {
                            const gl_type = this.translateTextureType(pixelFormat);
                            gl.texSubImage2D(face_target, i, 0, 0, w, h, gl_format, gl_type, levelData, z * sliceElementSize);
                        }
                    }
                } else if (is3D) {
                    if (isCompressed) {
                        gl.compressedTexSubImage3D(gl_target, i, 0, 0, 0, w, h, d, gl_format, levelData);
                    } else {
                        const gl_type = this.translateTextureType(pixelFormat);
                        gl.texSubImage3D(gl_target, i, 0, 0, 0, w, h, d, gl_format, gl_type, levelData);
                    }
                } else {
                    if (isCompressed) {
                        gl.compressedTexSubImage2D(gl_target, i, 0, 0, w, h, gl_format, levelData);
                    } else {
                        const gl_type = this.translateTextureType(pixelFormat);
                        gl.texSubImage2D(gl_target, i, 0, 0, w, h, gl_format, gl_type, levelData);
                    }
                }
            }

            w = Math.max((w / 2) | 0, 1);
            h = Math.max((h / 2) | 0, 1);
        }
    }

    public readBuffer(o: GfxReadback, dstOffset: number, buffer_: GfxBuffer, srcOffset: number, byteSize: number): void {
        const gl = this.gl;
        const readback = o as GfxReadbackP_GL;
        const buffer = buffer_ as GfxBufferP_GL;

        const end = srcOffset + byteSize;
        assert(end <= buffer.byteSize);
        assert((dstOffset + byteSize) <= readback.byteSize);

        while (srcOffset < end) {
            const pageIdx = (srcOffset / buffer.pageByteSize) | 0;
            const pageOffset = pageIdx * buffer.pageByteSize;
            const pageSrcOffset = srcOffset - pageOffset;
            const pageSize = buffer.pageByteSize - pageSrcOffset;

            gl.bindBuffer(gl.COPY_READ_BUFFER, buffer.gl_buffer_pages[pageIdx]);
            gl.bindBuffer(gl.COPY_WRITE_BUFFER, readback.gl_buffer);
            gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, pageSrcOffset, dstOffset, pageSize);

            srcOffset += pageSize;
            dstOffset += pageSize;
        }

        gl.bindBuffer(gl.COPY_READ_BUFFER, null);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    }

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void {
        const gl = this.gl;
        const readback = o as GfxReadbackP_GL;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._readbackFramebuffer);
        const texture = a as GfxTextureP_GL;
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.gl_texture, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readback.gl_buffer);

        const gl_format = this.translateTextureFormat(texture.pixelFormat);
        const gl_type = this.translateTextureType(texture.pixelFormat);
        const formatByteSize = getFormatByteSize(texture.pixelFormat);

        gl.readPixels(x, y, 1, 1, gl_format, gl_type, dstOffset * formatByteSize);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }

    public submitReadback(o: GfxReadback): void {
        const gl = this.gl;
        const readback = o as GfxReadbackP_GL;
        if (readback.gl_sync !== null) {
            // TODO(jstpierre): Any way to avoid this? :/
            gl.deleteSync(readback.gl_sync);
        }
        readback.gl_sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }

    public queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean {
        const gl = this.gl;
        const readback = o as GfxReadbackP_GL;
        const gl_sync = assertExists(readback.gl_sync);
        if (gl.getSyncParameter(gl_sync, gl.SYNC_STATUS) === gl.SIGNALED) {
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, readback.gl_buffer);
            gl.getBufferSubData(gl.PIXEL_UNPACK_BUFFER, 0, dst, dstOffs);
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            return true;
        } else {
            return false;
        }
    }

    public queryPoolResultOcclusion(o: GfxQueryPool, dstOffs: number): boolean | null {
        const gl = this.gl;
        const queryPool = o as GfxQueryPoolP_GL;
        const gl_query = queryPool.gl_query[dstOffs];
        if (!gl.getQueryParameter(gl_query, gl.QUERY_RESULT_AVAILABLE))
            return null;

        // Returns whether any samples passed.
        return !!gl.getQueryParameter(gl_query, gl.QUERY_RESULT);
    }

    public queryLimits(): GfxDeviceLimits {
        return this;
    }

    public queryTextureFormatSupported(format: GfxFormat, width: number, height: number): boolean {
        switch (format) {
        case GfxFormat.BC1_SRGB:
        case GfxFormat.BC2_SRGB:
        case GfxFormat.BC3_SRGB:
            if (this._WEBGL_compressed_texture_s3tc_srgb !== null)
                return isBlockCompressSized(width, height, 4, 4);
            return false;
        case GfxFormat.BC1:
        case GfxFormat.BC2:
        case GfxFormat.BC3:
            if (this._WEBGL_compressed_texture_s3tc !== null)
                return isBlockCompressSized(width, height, 4, 4);
            return false;
        case GfxFormat.BC4_UNORM:
        case GfxFormat.BC4_SNORM:
        case GfxFormat.BC5_UNORM:
        case GfxFormat.BC5_SNORM:
            if (this._EXT_texture_compression_rgtc !== null)
                return isBlockCompressSized(width, height, 4, 4);
            return false;
        case GfxFormat.U16_R_NORM:
        case GfxFormat.U16_RG_NORM:
        case GfxFormat.U16_RGBA_NORM:
            return this._EXT_texture_norm16 !== null;
        case GfxFormat.F32_R:
        case GfxFormat.F32_RG:
        case GfxFormat.F32_RGB:
        case GfxFormat.F32_RGBA:
            return this._OES_texture_float_linear !== null;
        case GfxFormat.F16_R:
        case GfxFormat.F16_RG:
        case GfxFormat.F16_RGB:
        case GfxFormat.F16_RGBA:
            return this._OES_texture_half_float_linear !== null;
        default:
            return true;
        }
    }

    private queryProgramReady(program: GfxProgramP_GL): boolean {
        const gl = this.gl;

        if (program.compileState === GfxProgramCompileStateP_GL.NeedsCompile) {
            // This should not happen.
            throw "whoops";
        } if (program.compileState === GfxProgramCompileStateP_GL.Compiling) {
            let complete: boolean;

            if (this._KHR_parallel_shader_compile !== null) {
                complete = gl.getProgramParameter(program.gl_program, this._KHR_parallel_shader_compile!.COMPLETION_STATUS_KHR);
            } else {
                // If we don't have async shader compilation, assume all compilation is done immediately :/
                complete = true;
            }

            if (complete)
                this._programCompiled(program);

            return complete;
        }

        return program.compileState === GfxProgramCompileStateP_GL.NeedsBind || program.compileState === GfxProgramCompileStateP_GL.ReadyToUse;
    }

    public queryPlatformAvailable(): boolean {
        return this.gl.isContextLost();
    }

    public queryVendorInfo(): GfxVendorInfo {
        return this;
    }

    public queryRenderPass(o: GfxRenderPass): Readonly<GfxRenderPassDescriptor> {
        // assert(o === this);
        // return assertExists(this._currentRenderPassDescriptor);
        return this._currentRenderPassDescriptor!;
    }

    public queryRenderTarget(o: GfxRenderTarget): Readonly<GfxRenderTargetDescriptor> {
        const renderTarget = o as GfxRenderTargetP_GL;
        return renderTarget;
    }
    //#endregion

    //#region Debugging

    public setResourceName(o: GfxResource, name: string): void {
        o.ResourceName = name;

        if (o._T === _T.Buffer) {
            const { gl_buffer_pages } = o as GfxBufferP_GL;
            for (let i = 0; i < gl_buffer_pages.length; i++)
                assignPlatformName(gl_buffer_pages[i], `${name} Page ${i}`);
        } else if (o._T === _T.Texture) {
            assignPlatformName(getPlatformTexture(o), name);
        } else if (o._T === _T.Sampler) {
            assignPlatformName(getPlatformSampler(o), name);
        } else if (o._T === _T.RenderTarget) {
            const { gl_renderbuffer } = o as GfxRenderTargetP_GL;
            if (gl_renderbuffer !== null)
                assignPlatformName(gl_renderbuffer, name);
        } else if (o._T === _T.InputState) {
            assignPlatformName((o as GfxInputStateP_GL).vao, name);
        }
    }

    public setResourceLeakCheck(o: GfxResource, v: boolean): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.setResourceLeakCheck(o, v);
    }

    public checkForLeaks(): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.checkForLeaks();
    }

    public pushDebugGroup(debugGroup: GfxDebugGroup): void {
        this._debugGroupStack.push(debugGroup);
    }

    public popDebugGroup(): void {
        this._debugGroupStack.pop();
    }

    public programPatched(o: GfxProgram, descriptor: GfxProgramDescriptorSimple): void {
        assert(this._shaderDebug);

        const program = o as GfxProgramP_GL;
        const gl = this.gl;
        gl.deleteProgram(program.gl_program);
        program.descriptor = descriptor;
        program.gl_program = this.ensureResourceExists(gl.createProgram());
        program.compileState = GfxProgramCompileStateP_GL.NeedsCompile;
        this._tryCompileProgram(program);
        this._checkProgramCompilationForErrors(program);
    }

    public getBufferData(buffer: GfxBuffer, dstBuffer: ArrayBufferView, wordOffset: number = 0): void {
        const gl = this.gl;
        gl.bindBuffer(gl.COPY_READ_BUFFER, getPlatformBuffer(buffer, wordOffset * 4));
        gl.getBufferSubData(gl.COPY_READ_BUFFER, wordOffset * 4, dstBuffer);
    }
    //#endregion

    //#region Pass execution
    private _debugGroupStatisticsDrawCall(count: number = 1): void {
        for (let i = this._debugGroupStack.length - 1; i >= 0; i--)
            this._debugGroupStack[i].drawCallCount += count;
    }

    private _debugGroupStatisticsBufferUpload(count: number = 1): void {
        for (let i = this._debugGroupStack.length - 1; i >= 0; i--)
            this._debugGroupStack[i].bufferUploadCount += count;
    }

    private _debugGroupStatisticsTextureBind(count: number = 1): void {
        for (let i = this._debugGroupStack.length - 1; i >= 0; i--)
            this._debugGroupStack[i].textureBindCount += count;
    }

    private _debugGroupStatisticsTriangles(count: number): void {
        for (let i = this._debugGroupStack.length - 1; i >= 0; i--)
            this._debugGroupStack[i].triangleCount += count;
    }

    private _compileShader(contents: string, type: GLenum): WebGLShader {
        const gl = this.gl;
        const shader: WebGLShader = this.ensureResourceExists(gl.createShader(type));
        gl.shaderSource(shader, contents);
        gl.compileShader(shader);
        return shader;
    }

    private _reportShaderError(shader: WebGLShader, str: string): boolean {
        const gl = this.gl;
        const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!status) {
            console.error(prependLineNo(str));
            const debug_shaders = gl.getExtension('WEBGL_debug_shaders');
            if (debug_shaders)
                console.error(debug_shaders.getTranslatedShaderSource(shader));
            console.error(gl.getShaderInfoLog(shader));
        }
        return status;
    }

    private _checkProgramCompilationForErrors(program: GfxProgramP_GL): void {
        const gl = this.gl;

        const prog = program.gl_program!;
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const descriptor = program.descriptor as GfxProgramDescriptor;

            if (!this._reportShaderError(program.gl_shader_vert!, descriptor.preprocessedVert))
                return;

            if (program.gl_shader_frag !== null) {
                if (!this._reportShaderError(program.gl_shader_frag, descriptor.preprocessedFrag!))
                    return;
            }

            // Neither shader had an error, report the program info log.
            console.error(gl.getProgramInfoLog(program.gl_program!));
            debugger;
        }
    }

    private _tryCompileProgram(program: GfxProgramP_GL): void {
        assert(program.compileState === GfxProgramCompileStateP_GL.NeedsCompile);

        const descriptor = program.descriptor;

        const gl = this.gl;
        if (program.gl_shader_vert !== null)
            gl.deleteShader(program.gl_shader_vert);
        if (program.gl_shader_frag !== null)
            gl.deleteShader(program.gl_shader_frag);
        program.gl_shader_vert = this._compileShader(descriptor.preprocessedVert, gl.VERTEX_SHADER);
        gl.attachShader(program.gl_program, program.gl_shader_vert);

        if (descriptor.preprocessedFrag !== null) {
            program.gl_shader_frag = this._compileShader(descriptor.preprocessedFrag, gl.FRAGMENT_SHADER);
            gl.attachShader(program.gl_program, program.gl_shader_frag);
        }

        gl.linkProgram(program.gl_program);

        program.compileState = GfxProgramCompileStateP_GL.Compiling;
    }

    private _bindFramebufferAttachment(framebuffer: GLenum, binding: GLenum, attachment: GfxRenderTargetP_GL | GfxTextureP_GL | null, level: number): void {
        const gl = this.gl;

        if (attachment === null) {
            gl.framebufferRenderbuffer(framebuffer, binding, gl.RENDERBUFFER, null);
        } else if (attachment._T === _T.RenderTarget) {
            if (attachment.gl_renderbuffer !== null)
                gl.framebufferRenderbuffer(framebuffer, binding, gl.RENDERBUFFER, attachment.gl_renderbuffer);
            else if (attachment.gfxTexture !== null)
                gl.framebufferTexture2D(framebuffer, binding, gl.TEXTURE_2D, getPlatformTexture(attachment.gfxTexture), level);
        } else if (attachment._T === _T.Texture) {
            gl.framebufferTexture2D(framebuffer, binding, gl.TEXTURE_2D, getPlatformTexture(attachment), level);
        }
    }

    private _bindFramebufferDepthStencilAttachment(framebuffer: GLenum, attachment: GfxRenderTargetP_GL | GfxTextureP_GL | null): void {
        const gl = this.gl;

        const flags = attachment !== null ? getFormatFlags(attachment.pixelFormat) : (FormatFlags.Depth | FormatFlags.Stencil);
        const depth = !!(flags & FormatFlags.Depth), stencil = !!(flags & FormatFlags.Stencil);
        if (depth && stencil) {
            this._bindFramebufferAttachment(framebuffer, gl.DEPTH_STENCIL_ATTACHMENT, attachment, 0);
        } else if (depth) {
            this._bindFramebufferAttachment(framebuffer, gl.DEPTH_ATTACHMENT, attachment, 0);
            this._bindFramebufferAttachment(framebuffer, gl.STENCIL_ATTACHMENT, null, 0);
        } else if (stencil) {
            this._bindFramebufferAttachment(framebuffer, gl.STENCIL_ATTACHMENT, attachment, 0);
            this._bindFramebufferAttachment(framebuffer, gl.DEPTH_ATTACHMENT, null, 0);
        }
    }

    private _validateCurrentAttachments(): void {
        let sampleCount = -1, width = -1, height = -1;

        for (let i = 0; i < this._currentColorAttachments.length; i++) {
            const attachment = this._currentColorAttachments[i];

            if (attachment === null)
                continue;

            if (sampleCount === -1) {
                sampleCount = attachment.sampleCount;
                width = attachment.width;
                height = attachment.height;
            } else {
                assert(sampleCount === attachment.sampleCount);
                assert(width === attachment.width);
                assert(height === attachment.height);
            }
        }

        if (this._currentDepthStencilAttachment !== null) {
            if (sampleCount === -1) {
                sampleCount = this._currentDepthStencilAttachment.sampleCount;
                width = this._currentDepthStencilAttachment.width;
                height = this._currentDepthStencilAttachment.height;
            } else {
                assert(sampleCount === this._currentDepthStencilAttachment.sampleCount);
                assert(width === this._currentDepthStencilAttachment.width);
                assert(height === this._currentDepthStencilAttachment.height);
            }
        }

        this._currentSampleCount = sampleCount;
    }

    private _setRenderPassParametersBegin(numColorAttachments: number): void {
        const gl = this.gl;

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._renderPassDrawFramebuffer);
        for (let i = numColorAttachments; i < this._currentColorAttachments.length; i++) {
            gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, null);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
        }
        this._currentColorAttachments.length = numColorAttachments;
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    }

    private _setRenderPassParametersColor(i: number, colorAttachment: GfxRenderTargetP_GL | null, attachmentLevel: number, colorResolveTo: GfxTextureP_GL | null, resolveToLevel: number): void {
        const gl = this.gl;

        if (this._currentColorAttachments[i] !== colorAttachment || this._currentColorAttachmentLevels[i] !== attachmentLevel) {
            this._currentColorAttachments[i] = colorAttachment;
            this._currentColorAttachmentLevels[i] = attachmentLevel;
            this._bindFramebufferAttachment(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, colorAttachment, attachmentLevel);
            this._resolveColorAttachmentsChanged = true;
        }

        if (this._currentColorResolveTos[i] !== colorResolveTo || this._currentColorResolveToLevels[i] !== resolveToLevel) {
            this._currentColorResolveTos[i] = colorResolveTo;
            this._currentColorResolveToLevels[i] = resolveToLevel;

            if (colorResolveTo !== null)
                this._resolveColorAttachmentsChanged = true;
        }
    }

    private _setRenderPassParametersDepthStencil(depthStencilAttachment: GfxRenderTarget | null, depthStencilResolveTo: GfxTexture | null): void {
        const gl = this.gl;

        if (this._currentDepthStencilAttachment !== depthStencilAttachment) {
            this._currentDepthStencilAttachment = depthStencilAttachment as (GfxRenderTargetP_GL | null);
            this._bindFramebufferDepthStencilAttachment(gl.DRAW_FRAMEBUFFER, this._currentDepthStencilAttachment);
            this._resolveDepthStencilAttachmentsChanged = true;
        }

        if (this._currentDepthStencilResolveTo !== depthStencilResolveTo) {
            this._currentDepthStencilResolveTo = depthStencilResolveTo as GfxTextureP_GL;

            if (depthStencilResolveTo !== null)
                this._resolveDepthStencilAttachmentsChanged = true;
        }
    }

    private _setScissorEnabled(v: boolean): void {
        if (this._currentScissorEnabled === v)
            return;

        const gl = this.gl;
        if (v)
            gl.enable(gl.SCISSOR_TEST);
        else
            gl.disable(gl.SCISSOR_TEST);
        this._currentScissorEnabled = v;
    }

    private _setRenderPassParametersClearColor(slot: number, r: number, g: number, b: number, a: number): void {
        const gl = this.gl;

        if (this._OES_draw_buffers_indexed !== null) {
            const attachment = this._currentMegaState.attachmentsState[slot];
            if (attachment.channelWriteMask !== GfxChannelWriteMask.AllChannels) {
                this._OES_draw_buffers_indexed.colorMaskiOES(slot, true, true, true, true);
                attachment.channelWriteMask = GfxChannelWriteMask.AllChannels;
            }
        } else {
            const attachment = this._currentMegaState.attachmentsState[0];
            if (attachment.channelWriteMask !== GfxChannelWriteMask.AllChannels) {
                gl.colorMask(true, true, true, true);
                attachment.channelWriteMask = GfxChannelWriteMask.AllChannels;
            }
        }

        this._setScissorEnabled(false);
        gl.clearBufferfv(gl.COLOR, slot, [r, g, b, a]);
    }

    private _setRenderPassParametersClearDepthStencil(depthClearValue: number | 'load', stencilClearValue: number | 'load'): void {
        const gl = this.gl;

        if (depthClearValue !== 'load') {
            assert(this._currentDepthStencilAttachment !== null);
            // GL clears obey the masks... bad API or worst API?
            if (!this._currentMegaState.depthWrite) {
                gl.depthMask(true);
                this._currentMegaState.depthWrite = true;
            }
            gl.clearBufferfv(gl.DEPTH, 0, [depthClearValue]);
        }
        if (stencilClearValue !== 'load') {
            assert(this._currentDepthStencilAttachment !== null);
            if (!this._currentMegaState.stencilWrite) {
                gl.stencilMask(0xFF);
                this._currentMegaState.stencilWrite = true;
            }
            gl.clearBufferiv(gl.STENCIL, 0, [stencilClearValue]);
        }
    }

    private _getFallbackTexture(samplerEntry: GfxBindingLayoutSamplerDescriptorP_GL): WebGLTexture {
        const gl = this.gl;
        const gl_target = samplerEntry.gl_target, formatKind = samplerEntry.formatKind;
        if (gl_target === gl.TEXTURE_2D && formatKind === GfxSamplerFormatKind.Depth)
            return this._fallbackTexture2DDepth!;
        else if (gl_target === gl.TEXTURE_2D)
            return this._fallbackTexture2D;
        else if (gl_target === gl.TEXTURE_2D_ARRAY)
            return this._fallbackTexture2DArray;
        else if (gl_target === gl.TEXTURE_3D)
            return this._fallbackTexture3D;
        else if (gl_target === gl.TEXTURE_CUBE_MAP)
            return this._fallbackTextureCube;
        else
            throw "whoops";
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const gl = this.gl;

        assert(bindingLayoutIndex < this._currentPipeline.bindingLayouts.bindingLayoutTables.length);
        const bindingLayoutTable = this._currentPipeline.bindingLayouts.bindingLayoutTables[bindingLayoutIndex];

        const { uniformBufferBindings, samplerBindings } = bindings_ as GfxBindingsP_GL;
        // Ignore extra bindings.
        assert(uniformBufferBindings.length >= bindingLayoutTable.numUniformBuffers);
        assert(samplerBindings.length >= bindingLayoutTable.numSamplers);
        assert(dynamicByteOffsets.length >= uniformBufferBindings.length);

        for (let i = 0; i < uniformBufferBindings.length; i++) {
            const binding = uniformBufferBindings[i];
            if (binding.wordCount === 0)
                continue;
            const index = bindingLayoutTable.firstUniformBuffer + i;
            const buffer = binding.buffer as GfxBufferP_GL;
            const byteOffset = dynamicByteOffsets[i];
            const byteSize = (binding.wordCount * 4);
            if (buffer !== this._currentUniformBuffers[index] || byteOffset !== this._currentUniformBufferByteOffsets[index] || byteSize !== this._currentUniformBufferByteSizes[index]) {
                const platformBufferByteOffset = byteOffset % buffer.pageByteSize;
                const platformBuffer = buffer.gl_buffer_pages[(byteOffset / buffer.pageByteSize) | 0];
                assert(platformBufferByteOffset + byteSize <= buffer.pageByteSize);
                gl.bindBufferRange(gl.UNIFORM_BUFFER, index, platformBuffer, platformBufferByteOffset, byteSize);
                this._currentUniformBuffers[index] = buffer;
                this._currentUniformBufferByteOffsets[index] = byteOffset;
                this._currentUniformBufferByteSizes[index] = byteSize;
            }
        }

        for (let i = 0; i < bindingLayoutTable.numSamplers; i++) {
            const binding = samplerBindings[i];
            const samplerIndex = bindingLayoutTable.firstSampler + i;
            const samplerEntry = bindingLayoutTable.samplerEntries[i];
            const gfxTexture = binding !== null ? binding.gfxTexture : null;
            const gl_texture = gfxTexture !== null ? getPlatformTexture(gfxTexture) : null;
            const gl_sampler = binding !== null && binding.gfxSampler !== null ? getPlatformSampler(binding.gfxSampler) : null;

            if (this._currentSamplers[samplerIndex] !== gl_sampler) {
                gl.bindSampler(samplerIndex, gl_sampler);
                this._currentSamplers[samplerIndex] = gl_sampler;
            }

            if (this._currentTextures[samplerIndex] !== gl_texture) {
                this._setActiveTexture(gl.TEXTURE0 + samplerIndex);
                if (gfxTexture !== null) {
                    const { gl_target, formatKind } = (gfxTexture as GfxTextureP_GL);
                    // assert(!this._resourceCreationTracker!.deletionStacks.has(gfxTexture));
                    gl.bindTexture(gl_target, gl_texture);
                    this._debugGroupStatisticsTextureBind();

                    // Validate sampler entry.

                    assert(samplerEntry.gl_target === gl_target);
                    assert(samplerEntry.formatKind === formatKind);
                } else {
                    gl.bindTexture(samplerEntry.gl_target, this._getFallbackTexture(samplerEntry));
                }
                this._currentTextures[samplerIndex] = gl_texture;
            }
        }
    }

    public setViewport(x: number, y: number, w: number, h: number): void {
        const gl = this.gl;
        gl.viewport(x, y, w, h);
    }

    public setScissor(x: number, y: number, w: number, h: number): void {
        const gl = this.gl;
        this._setScissorEnabled(true);
        gl.scissor(x, y, w, h);
    }

    private _setAttachmentStateIndexed(i: number, currentAttachmentState: GfxAttachmentState, newAttachmentState: GfxAttachmentState): void {
        const gl = this.gl;
        const dbi = this._OES_draw_buffers_indexed!;

        if (currentAttachmentState.channelWriteMask !== newAttachmentState.channelWriteMask) {
            dbi.colorMaskiOES(i,
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Red),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Green),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Blue),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Alpha),
            );
            currentAttachmentState.channelWriteMask = newAttachmentState.channelWriteMask;
        }
    
        const blendModeChanged = (
            currentAttachmentState.rgbBlendState.blendMode !== newAttachmentState.rgbBlendState.blendMode ||
            currentAttachmentState.alphaBlendState.blendMode !== newAttachmentState.alphaBlendState.blendMode
        );
        const blendFuncChanged = (
            currentAttachmentState.rgbBlendState.blendSrcFactor !== newAttachmentState.rgbBlendState.blendSrcFactor ||
            currentAttachmentState.alphaBlendState.blendSrcFactor !== newAttachmentState.alphaBlendState.blendSrcFactor ||
            currentAttachmentState.rgbBlendState.blendDstFactor !== newAttachmentState.rgbBlendState.blendDstFactor ||
            currentAttachmentState.alphaBlendState.blendDstFactor !== newAttachmentState.alphaBlendState.blendDstFactor
        );
    
        if (blendFuncChanged || blendModeChanged) {
            if (isBlendStateNone(currentAttachmentState.rgbBlendState) && isBlendStateNone(currentAttachmentState.alphaBlendState))
                dbi.enableiOES(i, gl.BLEND);
            else if (isBlendStateNone(newAttachmentState.rgbBlendState) && isBlendStateNone(newAttachmentState.alphaBlendState))
                dbi.disableiOES(i, gl.BLEND);
        }
    
        if (blendModeChanged) {
            dbi.blendEquationSeparateiOES(i,
                newAttachmentState.rgbBlendState.blendMode,
                newAttachmentState.alphaBlendState.blendMode,
            );
            currentAttachmentState.rgbBlendState.blendMode = newAttachmentState.rgbBlendState.blendMode;
            currentAttachmentState.alphaBlendState.blendMode = newAttachmentState.alphaBlendState.blendMode;
        }
    
        if (blendFuncChanged) {
            dbi.blendFuncSeparateiOES(i,
                newAttachmentState.rgbBlendState.blendSrcFactor, newAttachmentState.rgbBlendState.blendDstFactor,
                newAttachmentState.alphaBlendState.blendSrcFactor, newAttachmentState.alphaBlendState.blendDstFactor,
            );
            currentAttachmentState.rgbBlendState.blendSrcFactor = newAttachmentState.rgbBlendState.blendSrcFactor;
            currentAttachmentState.alphaBlendState.blendSrcFactor = newAttachmentState.alphaBlendState.blendSrcFactor;
            currentAttachmentState.rgbBlendState.blendDstFactor = newAttachmentState.rgbBlendState.blendDstFactor;
            currentAttachmentState.alphaBlendState.blendDstFactor = newAttachmentState.alphaBlendState.blendDstFactor;
        }
    }

    private _setAttachmentState(currentAttachmentState: GfxAttachmentState, newAttachmentState: GfxAttachmentState): void {
        const gl = this.gl;

        if (currentAttachmentState.channelWriteMask !== newAttachmentState.channelWriteMask) {
            gl.colorMask(
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Red),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Green),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Blue),
                !!(newAttachmentState.channelWriteMask & GfxChannelWriteMask.Alpha),
            );
            currentAttachmentState.channelWriteMask = newAttachmentState.channelWriteMask;
        }
    
        const blendModeChanged = (
            currentAttachmentState.rgbBlendState.blendMode !== newAttachmentState.rgbBlendState.blendMode ||
            currentAttachmentState.alphaBlendState.blendMode !== newAttachmentState.alphaBlendState.blendMode
        );
        const blendFuncChanged = (
            currentAttachmentState.rgbBlendState.blendSrcFactor !== newAttachmentState.rgbBlendState.blendSrcFactor ||
            currentAttachmentState.alphaBlendState.blendSrcFactor !== newAttachmentState.alphaBlendState.blendSrcFactor ||
            currentAttachmentState.rgbBlendState.blendDstFactor !== newAttachmentState.rgbBlendState.blendDstFactor ||
            currentAttachmentState.alphaBlendState.blendDstFactor !== newAttachmentState.alphaBlendState.blendDstFactor
        );

        if (blendFuncChanged || blendModeChanged) {
            if (isBlendStateNone(currentAttachmentState.rgbBlendState) && isBlendStateNone(currentAttachmentState.alphaBlendState))
                gl.enable(gl.BLEND);
            else if (isBlendStateNone(newAttachmentState.rgbBlendState) && isBlendStateNone(newAttachmentState.alphaBlendState))
                gl.disable(gl.BLEND);
        }

        if (blendModeChanged) {
            gl.blendEquationSeparate(
                newAttachmentState.rgbBlendState.blendMode,
                newAttachmentState.alphaBlendState.blendMode,
            );
            currentAttachmentState.rgbBlendState.blendMode = newAttachmentState.rgbBlendState.blendMode;
            currentAttachmentState.alphaBlendState.blendMode = newAttachmentState.alphaBlendState.blendMode;
        }
    
        if (blendFuncChanged) {
            gl.blendFuncSeparate(
                newAttachmentState.rgbBlendState.blendSrcFactor, newAttachmentState.rgbBlendState.blendDstFactor,
                newAttachmentState.alphaBlendState.blendSrcFactor, newAttachmentState.alphaBlendState.blendDstFactor,
            );
            currentAttachmentState.rgbBlendState.blendSrcFactor = newAttachmentState.rgbBlendState.blendSrcFactor;
            currentAttachmentState.alphaBlendState.blendSrcFactor = newAttachmentState.alphaBlendState.blendSrcFactor;
            currentAttachmentState.rgbBlendState.blendDstFactor = newAttachmentState.rgbBlendState.blendDstFactor;
            currentAttachmentState.alphaBlendState.blendDstFactor = newAttachmentState.alphaBlendState.blendDstFactor;
        }
    }

    private _applyStencil(): void {
        if (this._currentStencilRef === null)
            return;
        this.gl.stencilFunc(this._currentMegaState.stencilCompare, this._currentStencilRef, 0xFF);
    }

    private _setMegaState(newMegaState: GfxMegaStateDescriptor): void {
        const gl = this.gl;
        const currentMegaState = this._currentMegaState;

        if (this._OES_draw_buffers_indexed !== null) {
            for (let i = 0; i < newMegaState.attachmentsState.length; i++)
                this._setAttachmentStateIndexed(i, currentMegaState.attachmentsState[0], newMegaState.attachmentsState[0]);
        } else {
            assert(newMegaState.attachmentsState.length === 1);
            this._setAttachmentState(currentMegaState.attachmentsState[0], newMegaState.attachmentsState[0]);
        }

        if (!gfxColorEqual(currentMegaState.blendConstant, newMegaState.blendConstant)) {
            gl.blendColor(newMegaState.blendConstant.r, newMegaState.blendConstant.g, newMegaState.blendConstant.b, newMegaState.blendConstant.a);
            gfxColorCopy(currentMegaState.blendConstant, newMegaState.blendConstant);
        }

        if (currentMegaState.depthCompare !== newMegaState.depthCompare) {
            gl.depthFunc(newMegaState.depthCompare);
            currentMegaState.depthCompare = newMegaState.depthCompare;
        }

        if (currentMegaState.depthWrite !== newMegaState.depthWrite) {
            gl.depthMask(newMegaState.depthWrite);
            currentMegaState.depthWrite = newMegaState.depthWrite;
        }

        if (currentMegaState.stencilCompare !== newMegaState.stencilCompare) {
            currentMegaState.stencilCompare = newMegaState.stencilCompare;
            this._applyStencil();
        }

        if (currentMegaState.stencilWrite !== newMegaState.stencilWrite) {
            gl.stencilMask(newMegaState.stencilWrite ? 0xFF : 0x00);
            currentMegaState.stencilWrite = newMegaState.stencilWrite;
        }

        if (currentMegaState.stencilWrite) {
            if (currentMegaState.stencilPassOp !== newMegaState.stencilPassOp) {
                gl.stencilOp(gl.KEEP, gl.KEEP, newMegaState.stencilPassOp);
                currentMegaState.stencilPassOp = newMegaState.stencilPassOp;
            }
        }

        if (currentMegaState.cullMode !== newMegaState.cullMode) {
            if (currentMegaState.cullMode === GfxCullMode.None)
                gl.enable(gl.CULL_FACE);
            else if (newMegaState.cullMode === GfxCullMode.None)
                gl.disable(gl.CULL_FACE);
    
            if (newMegaState.cullMode === GfxCullMode.Back)
                gl.cullFace(gl.BACK);
            else if (newMegaState.cullMode === GfxCullMode.Front)
                gl.cullFace(gl.FRONT);
            else if (newMegaState.cullMode === GfxCullMode.FrontAndBack)
                gl.cullFace(gl.FRONT_AND_BACK);
            currentMegaState.cullMode = newMegaState.cullMode;
        }

        if (currentMegaState.frontFace !== newMegaState.frontFace) {
            gl.frontFace(newMegaState.frontFace);
            currentMegaState.frontFace = newMegaState.frontFace;
        }
    
        if (currentMegaState.polygonOffset !== newMegaState.polygonOffset) {
            if (newMegaState.polygonOffset) {
                gl.polygonOffset(1, 1);
                gl.enable(gl.POLYGON_OFFSET_FILL);
            } else {
                gl.disable(gl.POLYGON_OFFSET_FILL);
            }
            currentMegaState.polygonOffset = newMegaState.polygonOffset;
        }
    }

    private _validatePipelineFormats(pipeline: GfxRenderPipelineP_GL): void {
        for (let i = 0; i < this._currentColorAttachments.length; i++) {
            const attachment = this._currentColorAttachments[i];
            if (attachment === null)
                continue;
            assert(attachment.pixelFormat === pipeline.colorAttachmentFormats[i]);
        }

        if (this._currentDepthStencilAttachment !== null)
            assert(this._currentDepthStencilAttachment.pixelFormat === pipeline.depthStencilAttachmentFormat);

        if (this._currentSampleCount !== -1)
            assert(this._currentSampleCount === pipeline.sampleCount);
    }

    public setPipeline(o: GfxRenderPipeline): void {
        this._currentPipeline = o as GfxRenderPipelineP_GL;
        this._validatePipelineFormats(this._currentPipeline);

        // We allow users to use "non-ready" pipelines for emergencies. In this case, there can be a bit of stuttering.
        // assert(this.queryPipelineReady(this._currentPipeline));

        this._setMegaState(this._currentPipeline.megaState);

        const program = this._currentPipeline.program;
        this._setProgram(program);

        if (program.compileState === GfxProgramCompileStateP_GL.NeedsBind) {
            const gl = this.gl, prog = program.gl_program!;
            const deviceProgram = program.descriptor;

            const uniformBlocks = findall(deviceProgram.preprocessedVert, /uniform (\w+) {([^]*?)}/g);
            for (let i = 0; i < uniformBlocks.length; i++) {
                const [m, blockName, contents] = uniformBlocks[i];
                const blockIdx = gl.getUniformBlockIndex(prog, blockName);
                if (blockIdx !== -1 && blockIdx !== 0xFFFFFFFF)
                    gl.uniformBlockBinding(prog, blockIdx, i);
            }

            const samplers = findall(deviceProgram.preprocessedVert, /^uniform .*sampler\S+ (\w+);\s* \/\/ BINDING=(\d+)$/gm);
            for (let i = 0; i < samplers.length; i++) {
                const [m, name, location] = samplers[i];
                const samplerUniformLocation = gl.getUniformLocation(prog, name);
                gl.uniform1i(samplerUniformLocation, parseInt(location));
            }

            program.compileState = GfxProgramCompileStateP_GL.ReadyToUse;
        }
    }

    public setInputState(inputState_: GfxInputState | null): void {
        const inputState = inputState_ as GfxInputStateP_GL;
        this._currentInputState = inputState;
        if (this._currentInputState !== null) {
            assert(this._currentPipeline.inputLayout === this._currentInputState.inputLayout);
            this._setVAO(this._currentInputState.vao);
        } else {
            assert(this._currentPipeline.inputLayout === null);
            this._setVAO(null);
        }
    }

    public setStencilRef(value: number): void {
        if (this._currentStencilRef === value)
            return;
        this._currentStencilRef = value;
        this._applyStencil();
    }

    public draw(count: number, firstVertex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        gl.drawArrays(pipeline.drawMode, firstVertex, count);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles(count / 3);
    }

    public drawIndexed(count: number, firstIndex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        const inputState = this._currentInputState;
        const byteOffset = assertExists(inputState.indexBufferByteOffset) + firstIndex * assertExists(inputState.indexBufferCompByteSize);
        gl.drawElements(pipeline.drawMode, count, assertExists(inputState.indexBufferType), byteOffset);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles(count / 3);
    }

    public drawIndexedInstanced(count: number, firstIndex: number, instanceCount: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        const inputState = this._currentInputState;
        const byteOffset = assertExists(inputState.indexBufferByteOffset) + firstIndex * assertExists(inputState.indexBufferCompByteSize);
        gl.drawElementsInstanced(pipeline.drawMode, count, assertExists(inputState.indexBufferType), byteOffset, instanceCount);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles((count / 3) * instanceCount);
    }

    public beginOcclusionQuery(dstOffs: number): void {
        const gl = this.gl;
        const queryPool = this._currentRenderPassDescriptor!.occlusionQueryPool! as GfxQueryPoolP_GL;
        gl.beginQuery(queryPool.gl_query_type, queryPool.gl_query[dstOffs]);
    }

    public endOcclusionQuery(): void {
        const gl = this.gl;
        const queryPool = this._currentRenderPassDescriptor!.occlusionQueryPool! as GfxQueryPoolP_GL;
        gl.endQuery(queryPool.gl_query_type);
    }

    public beginDebugGroup(name: string): void {
    }

    public endDebugGroup(): void {
    }

    private endPass(): void {
        const gl = this.gl;

        let didUnbindDraw = false;

        for (let i = 0; i < this._currentColorAttachments.length; i++) {
            const colorResolveFrom = this._currentColorAttachments[i];

            if (colorResolveFrom !== null) {
                const colorResolveTo = this._currentColorResolveTos[i];
                let didBindRead = false;

                if (colorResolveTo !== null) {
                    assert(colorResolveFrom.width === colorResolveTo.width && colorResolveFrom.height === colorResolveTo.height);
                    assert(colorResolveFrom.pixelFormat === colorResolveTo.pixelFormat);

                    this._setScissorEnabled(false);
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveColorReadFramebuffer);
                    if (this._resolveColorAttachmentsChanged)
                        this._bindFramebufferAttachment(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, colorResolveFrom, this._currentColorAttachmentLevels[i]);
                    didBindRead = true;

                    // Special case: Blitting to the on-screen.
                    if (colorResolveTo === this._scTexture) {
                        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._scPlatformFramebuffer);
                    } else {
                        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolveColorDrawFramebuffer);
                        if (this._resolveColorAttachmentsChanged)
                            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorResolveTo.gl_texture, this._currentColorResolveToLevels[i]);
                    }

                    gl.blitFramebuffer(0, 0, colorResolveFrom.width, colorResolveFrom.height, 0, 0, colorResolveTo.width, colorResolveTo.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
                    didUnbindDraw = true;
                }

                if (!this._currentRenderPassDescriptor!.colorStore[i]) {
                    if (!didBindRead) {
                        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveColorReadFramebuffer);
                        if (this._resolveColorAttachmentsChanged)
                            this._bindFramebufferAttachment(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, colorResolveFrom, this._currentColorAttachmentLevels[i]);
                    }

                    gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
                }

                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            }
        }

        this._resolveColorAttachmentsChanged = false;

        const depthStencilResolveFrom = this._currentDepthStencilAttachment;
        if (depthStencilResolveFrom !== null) {
            const depthStencilResolveTo = this._currentDepthStencilResolveTo;
            let didBindRead = false;

            if (depthStencilResolveTo !== null) {
                assert(depthStencilResolveFrom.width === depthStencilResolveTo.width && depthStencilResolveFrom.height === depthStencilResolveTo.height);

                this._setScissorEnabled(false);

                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveDepthStencilReadFramebuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolveDepthStencilDrawFramebuffer);
                if (this._resolveDepthStencilAttachmentsChanged) {
                    this._bindFramebufferDepthStencilAttachment(gl.READ_FRAMEBUFFER, depthStencilResolveFrom);
                    this._bindFramebufferDepthStencilAttachment(gl.DRAW_FRAMEBUFFER, depthStencilResolveTo);
                }
                didBindRead = true;

                gl.blitFramebuffer(0, 0, depthStencilResolveFrom.width, depthStencilResolveFrom.height, 0, 0, depthStencilResolveTo.width, depthStencilResolveTo.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
                didUnbindDraw = true;
            }

            if (!this._currentRenderPassDescriptor!.depthStencilStore) {
                if (!didBindRead) {
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveDepthStencilReadFramebuffer);
                    if (this._resolveDepthStencilAttachmentsChanged)
                        this._bindFramebufferDepthStencilAttachment(gl.READ_FRAMEBUFFER, depthStencilResolveFrom);
                    didBindRead = true;
                }

                gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [gl.DEPTH_STENCIL_ATTACHMENT]);
            }

            if (didBindRead)
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

            this._resolveDepthStencilAttachmentsChanged = false;
        }

        if (!didUnbindDraw) {
            // If we did not unbind from a resolve, then we need to unbind our render pass draw FBO here.
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        }
    }
    //#endregion
}

export function createSwapChainForWebGL2(gl: WebGL2RenderingContext, configuration: GfxPlatformWebGL2Config): GfxSwapChain {
    return new GfxImplP_GL(gl, configuration);
}

export function gfxDeviceGetImpl_GL(gfxDevice: GfxDevice): GfxImplP_GL {
    return gfxDevice as GfxImplP_GL;
}
