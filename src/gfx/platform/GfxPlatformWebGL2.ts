
import { GfxBufferUsage, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxTexFilterMode, GfxMipFilterMode, GfxPrimitiveTopology, GfxSwapChain, GfxDevice, GfxSamplerDescriptor, GfxWrapMode, GfxVertexBufferDescriptor, GfxRenderPipelineDescriptor, GfxBufferBinding, GfxSamplerBinding, GfxDeviceLimits, GfxVertexAttributeDescriptor, GfxLoadDisposition, GfxRenderPass, GfxPass, GfxHostAccessPass, GfxMegaStateDescriptor, GfxCompareMode, GfxBlendMode, GfxCullMode, GfxBlendFactor, GfxVertexBufferFrequency, GfxRenderPassDescriptor, GfxTextureDescriptor, GfxTextureDimension, makeTextureDescriptor2D, GfxBindingsDescriptor, GfxDebugGroup, GfxInputLayoutDescriptor, GfxAttachmentState as GfxAttachmentStateDescriptor, GfxColorWriteMask, GfxPlatformFramebuffer, GfxVendorInfo, GfxInputLayoutBufferDescriptor, GfxIndexBufferDescriptor, GfxChannelBlendState, GfxProgramDescriptor, GfxBugQuirks, GfxProgramDescriptorSimple, GfxAttachmentDescriptor } from './GfxPlatform';
import { _T, GfxBuffer, GfxTexture, GfxAttachment, GfxSampler, GfxProgram, GfxInputLayout, GfxInputState, GfxRenderPipeline, GfxBindings, GfxResource, GfxBugQuirksImpl, GfxReadback } from "./GfxPlatformImpl";
import { GfxFormat, getFormatCompByteSize, FormatTypeFlags, FormatCompFlags, FormatFlags, getFormatTypeFlags, getFormatCompFlags, getFormatFlags } from "./GfxPlatformFormat";

import { assert, assertExists, leftPad } from '../../util';
import { copyMegaState, defaultMegaState, fullscreenMegaState } from '../helpers/GfxMegaStateDescriptorHelpers';
import { IS_DEVELOPMENT } from '../../BuildVersion';
import { colorEqual, colorCopy } from '../../Color';
import { range } from '../../MathHelpers';
import { preprocessProgram_GLSL } from '../shaderc/GfxShaderCompiler';
import { WebXRContext } from '../../WebXR';
import { NormalizedViewportCoords } from '../helpers/RenderTargetHelpers';

const SHADER_DEBUG = IS_DEVELOPMENT;

const TRACK_RESOURCES = IS_DEVELOPMENT;

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
}

interface GfxAttachmentP_GL extends GfxAttachment {
    gl_renderbuffer: WebGLRenderbuffer | null;
    gfxTexture: GfxTexture | null;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
}

interface GfxSamplerP_GL extends GfxSampler {
    gl_sampler: WebGLSampler;
}

interface GfxProgramP_GL extends GfxProgram {
    gl_program: WebGLProgram | null;
    gl_shader_vert: WebGLShader | null;
    gl_shader_frag: WebGLShader | null;
    compileDirty: boolean;
    bindDirty: boolean;
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

interface GfxBindingLayoutTableP_GL {
    firstUniformBuffer: number;
    numUniformBuffers: number;
    firstSampler: number;
    numSamplers: number;
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
    ready: boolean;
}

interface GfxReadbackP_GL extends GfxReadback {
    gl_pbo: WebGLBuffer;
    gl_sync: WebGLSync | null;
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

    const typeFlags: FormatTypeFlags = getFormatTypeFlags(fmt);
    const compFlags: FormatCompFlags = getFormatCompFlags(fmt);
    const flags: FormatFlags = fmt & 0xFF;

    const type = translateType(typeFlags);
    const size = translateSize(compFlags);
    const normalized = !!(flags & FormatFlags.NORMALIZED);
    return { size, type, normalized };
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

function translateWrapMode(wrapMode: GfxWrapMode): GLenum {
    switch (wrapMode) {
    case GfxWrapMode.CLAMP:
        return WebGL2RenderingContext.CLAMP_TO_EDGE;
    case GfxWrapMode.REPEAT:
        return WebGL2RenderingContext.REPEAT;
    case GfxWrapMode.MIRROR:
        return WebGL2RenderingContext.MIRRORED_REPEAT;
    default:
        throw "whoops";
    }
}

function translateFilterMode(filter: GfxTexFilterMode, mipFilter: GfxMipFilterMode): GLenum {
    if (mipFilter === GfxMipFilterMode.LINEAR && filter === GfxTexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR_MIPMAP_LINEAR;
    if (mipFilter === GfxMipFilterMode.LINEAR && filter === GfxTexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST_MIPMAP_LINEAR;
    if (mipFilter === GfxMipFilterMode.NEAREST && filter === GfxTexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR_MIPMAP_NEAREST;
    if (mipFilter === GfxMipFilterMode.NEAREST && filter === GfxTexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST_MIPMAP_NEAREST;
    if (mipFilter === GfxMipFilterMode.NO_MIP && filter === GfxTexFilterMode.BILINEAR)
        return WebGL2RenderingContext.LINEAR;
    if (mipFilter === GfxMipFilterMode.NO_MIP && filter === GfxTexFilterMode.POINT)
        return WebGL2RenderingContext.NEAREST;
    throw new Error(`Unknown texture filter mode`);
}

function translatePrimitiveTopology(topology: GfxPrimitiveTopology): GLenum {
    switch (topology) {
    case GfxPrimitiveTopology.TRIANGLES:
        return WebGL2RenderingContext.TRIANGLES;
    default:
        throw new Error("Unknown primitive topology mode");
    }
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
        const { numUniformBuffers, numSamplers } = bindingLayouts[i];
        bindingLayoutTables.push({ firstUniformBuffer, numUniformBuffers, firstSampler, numSamplers });
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

type ArrayBufferView2 = Float32Array | Uint32Array;
class Growable<T extends ArrayBufferView2> {
    public b: T;
    public i: number;
    public o: number;

    constructor(public m: (n: number) => T, public a: number = 0x400) {
        this.i = this.a;
        this.b = m(this.i);
        this.o = 0;
    }

    public r() {
        this.o = 0;
    }

    public n(v: number) {
        if (this.o + 1 > this.b.length) {
            const b = this.m(this.b.length + this.a);
            b.set(this.b);
            this.b = b;
        }

        this.b[this.o++] = v;
    }
}

const enum RenderPassCmd { setRenderPassParameters = 471, setViewport, setScissor, setBindings, setPipeline, setInputState, setStencilRef, draw, drawIndexed, drawIndexedInstanced, endPass, invalid = 0x1234 };
class GfxRenderPassP_GL implements GfxRenderPass {
    public u32: Growable<Uint32Array> = new Growable((n) => new Uint32Array(n));
    public f32: Growable<Float32Array> = new Growable((n) => new Float32Array(n));
    public o: (object | null)[] = [];
    public descriptor: GfxRenderPassDescriptor;

    public reset() { this.u32.r(); this.f32.r(); this.o.length = 0; }

    public pu32(c: number) { this.u32.n(c); }
    public pcmd(c: number) { this.pu32(c); }
    public pf32(c: number) { this.f32.n(c); }
    public po(r: object | null) { this.o.push(r); }

    public end() { this.pcmd(RenderPassCmd.invalid); }
    public setRenderPassParameters(ca: GfxAttachment | null, cr: GfxTexture | null, dsa: GfxAttachment | null, dsr: GfxTexture | null, c: number, r: number, g: number, b: number, a: number, d: number, s: number) { this.pcmd(RenderPassCmd.setRenderPassParameters); this.pu32(ca !== null ? 1 : 0); if (ca !== null) { this.po(ca); this.po(cr); } this.po(dsa); this.po(dsr); this.pu32(c); this.pf32(r); this.pf32(g); this.pf32(b); this.pf32(a); this.pf32(d); this.pf32(s); }
    public setViewport(x: number, y: number, w: number, h: number) { this.pcmd(RenderPassCmd.setViewport); this.pf32(x); this.pf32(y); this.pf32(w); this.pf32(h); }
    public setScissor(x: number, y: number, w: number, h: number)  { this.pcmd(RenderPassCmd.setScissor); this.pf32(x); this.pf32(y); this.pf32(w); this.pf32(h); }
    public setPipeline(r: GfxRenderPipeline)      { this.pcmd(RenderPassCmd.setPipeline); this.po(r); }
    public setBindings(n: number, r: GfxBindings, o: number[]) { this.pcmd(RenderPassCmd.setBindings); this.pu32(n); this.po(r); this.pu32(o.length); for (let i = 0; i < o.length; i++) this.pu32(o[i]); }
    public setInputState(r: GfxInputState | null) { this.pcmd(RenderPassCmd.setInputState); this.po(r); }
    public setStencilRef(v: number)               { this.pcmd(RenderPassCmd.setStencilRef); this.pf32(v); }
    public draw(a: number, b: number)             { this.pcmd(RenderPassCmd.draw); this.pu32(a); this.pu32(b); }
    public drawIndexed(a: number, b: number)      { this.pcmd(RenderPassCmd.drawIndexed); this.pu32(a); this.pu32(b); }
    public drawIndexedInstanced(a: number, b: number, c: number) { this.pcmd(RenderPassCmd.drawIndexedInstanced); this.pu32(a); this.pu32(b); this.pu32(c); }
    public endPass()                              { this.pcmd(RenderPassCmd.endPass); }
}

enum HostAccessPassCmd { uploadBufferData = 491, uploadTextureData, end };
class GfxHostAccessPassP_GL implements GfxHostAccessPass {
    public u32: Growable<Uint32Array> = new Growable((n) => new Uint32Array(n));
    public gfxr: (GfxResource | null)[] = [];
    public bufr: ArrayBufferView[] = [];

    public reset() { this.u32.r(); this.gfxr.length = 0; this.bufr.length = 0; }

    public pu32(c: number) { this.u32.n(c); }
    public pcmd(c: number) { this.pu32(c); }
    public pgfxr(r: GfxResource | null) { this.gfxr.push(r); }
    public pbufr(r: ArrayBufferView) { this.bufr.push(r); }

    public end() { this.pcmd(HostAccessPassCmd.end); }
    public uploadBufferData(r: GfxBuffer, dstWordOffset: number, data: Uint8Array, srcWordOffset?: number, wordCount?: number) {
        assert(!!r);
        this.pcmd(HostAccessPassCmd.uploadBufferData); this.pgfxr(r);
        const dstByteOffset = dstWordOffset * 4;
        const srcByteOffset = (srcWordOffset !== undefined) ? (srcWordOffset * 4) : 0;
        const byteCount = (wordCount !== undefined) ? (wordCount * 4) : (data.byteLength - srcByteOffset);
        this.pu32(dstByteOffset);
        this.pbufr(data);
        this.pu32(srcByteOffset);
        this.pu32(byteCount);
    }

    public uploadTextureData(r: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]) {
        this.pcmd(HostAccessPassCmd.uploadTextureData); this.pgfxr(r);
        this.pu32(firstMipLevel);
        this.pu32(levelDatas.length);
        for (let i = 0; i < levelDatas.length; i++) this.pbufr(levelDatas[i]);
    }
}

function isBlendStateNone(blendState: GfxChannelBlendState): boolean {
    return (
        blendState.blendMode == GfxBlendMode.ADD &&
        blendState.blendSrcFactor == GfxBlendFactor.ONE &&
        blendState.blendDstFactor === GfxBlendFactor.ZERO
    );
}

function applyAttachmentState(gl: WebGL2RenderingContext, i: number, currentAttachmentState: GfxAttachmentStateDescriptor, newAttachmentState: GfxAttachmentStateDescriptor): void {
    assert(i === 0);

    if (currentAttachmentState.colorWriteMask !== newAttachmentState.colorWriteMask) {
        gl.colorMask(
            !!(newAttachmentState.colorWriteMask & GfxColorWriteMask.RED),
            !!(newAttachmentState.colorWriteMask & GfxColorWriteMask.GREEN),
            !!(newAttachmentState.colorWriteMask & GfxColorWriteMask.BLUE),
            !!(newAttachmentState.colorWriteMask & GfxColorWriteMask.ALPHA),
        );
        currentAttachmentState.colorWriteMask = newAttachmentState.colorWriteMask;
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

function applyMegaState(gl: WebGL2RenderingContext, currentMegaState: GfxMegaStateDescriptor, newMegaState: GfxMegaStateDescriptor): void {
    assert(newMegaState.attachmentsState.length === 1);
    applyAttachmentState(gl, 0, currentMegaState.attachmentsState![0], newMegaState.attachmentsState[0]);

    if (!colorEqual(currentMegaState.blendConstant, newMegaState.blendConstant)) {
        gl.blendColor(newMegaState.blendConstant.r, newMegaState.blendConstant.g, newMegaState.blendConstant.b, newMegaState.blendConstant.a);
        colorCopy(currentMegaState.blendConstant, newMegaState.blendConstant);
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
        // TODO(jstpierre): Store the stencil ref somewhere.
        const stencilRef = gl.getParameter(gl.STENCIL_REF);
        gl.stencilFunc(newMegaState.stencilCompare, stencilRef, 0xFF);
        currentMegaState.stencilCompare = newMegaState.stencilCompare;
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
        if (currentMegaState.cullMode === GfxCullMode.NONE)
            gl.enable(gl.CULL_FACE);
        else if (newMegaState.cullMode === GfxCullMode.NONE)
            gl.disable(gl.CULL_FACE);

        if (newMegaState.cullMode === GfxCullMode.BACK)
            gl.cullFace(gl.BACK);
        else if (newMegaState.cullMode === GfxCullMode.FRONT)
            gl.cullFace(gl.FRONT);
        else if (newMegaState.cullMode === GfxCullMode.FRONT_AND_BACK)
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

class ResourceCreationTracker {
    public liveObjects = new Set<GfxResource>();
    public creationStacks = new Map<GfxResource, string>();
    public deletionStacks = new Map<GfxResource, string>();

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

class GfxImplP_GL implements GfxSwapChain, GfxDevice {
    private _WEBGL_compressed_texture_s3tc: WEBGL_compressed_texture_s3tc | null = null;
    private _WEBGL_compressed_texture_s3tc_srgb: WEBGL_compressed_texture_s3tc_srgb | null = null;
    private _KHR_parallel_shader_compile: KHR_parallel_shader_compile | null = null;
    private _uniformBufferMaxPageByteSize: number;

    private _hostAccessPassPool: GfxHostAccessPassP_GL[] = [];
    private _renderPassPool: GfxRenderPassP_GL[] = [];

    // Swap Chain
    private _fullscreenCopyMegaState = fullscreenMegaState;
    private _fullscreenCopyProgram: GfxProgramP_GL;
    private _scWidth: number = 0;
    private _scHeight: number = 0;
    private _scTexture: GfxTexture | null = null;

    // GfxDevice
    private _currentActiveTexture: GLenum | null = null;
    private _currentBoundVAO: WebGLVertexArrayObject | null = null;
    private _currentProgram: GfxProgramP_GL | null = null;
    private _resourceCreationTracker: ResourceCreationTracker | null = null;
    private _resourceUniqueId = 0;

    // Pass Execution
    private _currentColorAttachments: GfxAttachmentP_GL[] = [];
    private _currentColorResolveTos: (GfxTextureP_GL | null)[] = [];
    private _currentDepthStencilAttachment: GfxAttachmentP_GL | null;
    private _currentDepthStencilResolveTo: GfxTextureP_GL | null = null;
    private _currentPipeline: GfxRenderPipelineP_GL;
    private _currentInputState: GfxInputStateP_GL;
    private _currentMegaState: GfxMegaStateDescriptor = copyMegaState(defaultMegaState);
    private _currentSamplers: (WebGLSampler | null)[] = [];
    private _currentTextures: (WebGLTexture | null)[] = [];
    private _currentUniformBuffers: GfxBuffer[] = [];
    private _currentUniformBufferByteOffsets: number[] = [];
    private _currentUniformBufferByteSizes: number[] = [];
    private _debugGroupStack: GfxDebugGroup[] = [];
    private _resolveReadFramebuffer!: WebGLFramebuffer;
    private _resolveDrawFramebuffer!: WebGLFramebuffer;
    private _renderPassDrawFramebuffer!: WebGLFramebuffer;
    private _blackTexture!: WebGLTexture;

    // GfxVendorInfo
    public bugQuirks = new GfxBugQuirksImpl();
    public glslVersion = `#version 300 es`;
    public explicitBindingLocations = false;
    public separateSamplerTextures = false;

    constructor(public gl: WebGL2RenderingContext) {
        this._WEBGL_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        this._WEBGL_compressed_texture_s3tc_srgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');
        this._KHR_parallel_shader_compile = gl.getExtension('KHR_parallel_shader_compile');

        this._uniformBufferMaxPageByteSize = Math.min(gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE), UBO_PAGE_MAX_BYTE_SIZE);

        const fullscreenVS: string = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1, 1);
}
`;
        const fullscreenFS: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(u_Texture, v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;

        const fullscreenProgramDescriptor = preprocessProgram_GLSL(this.queryVendorInfo(), fullscreenVS, fullscreenFS);
        this._fullscreenCopyProgram = this._createProgram(fullscreenProgramDescriptor);

        this._resolveReadFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._resolveDrawFramebuffer = this.ensureResourceExists(gl.createFramebuffer());
        this._renderPassDrawFramebuffer = this.ensureResourceExists(gl.createFramebuffer());

        this._blackTexture = this.ensureResourceExists(gl.createTexture());
        gl.bindTexture(gl.TEXTURE_2D, this._blackTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

        // Adjust for GL defaults.
        this._currentMegaState.depthCompare = GfxCompareMode.ALWAYS;
        this._currentMegaState.depthWrite = false;

        // We always have depth test enabled.
        gl.enable(gl.DEPTH_TEST);

        this._checkForBugQuirks();

        if (TRACK_RESOURCES)
            this._resourceCreationTracker = new ResourceCreationTracker();
    }

    private _checkForBugQuirksRowMajor(): void {
        const gl = this.gl;
        // Check if row_major is broken by generating a dummy program and checking the uniform data...
        // TODO(jstpierre): Async? Some better way that doesn't block on startup?
        const shaderVert = this._compileShader(this.glslVersion + `
precision mediump float;
layout(row_major, std140) uniform ub_Test {
    mat4x2 u_Test;
};
void main() {
    gl_Position = vec4(1);
}`, gl.VERTEX_SHADER);
        const shaderFrag = this._compileShader(this.glslVersion + `
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1);
}`, gl.FRAGMENT_SHADER);

        const prog = this.ensureResourceExists(gl.createProgram());
        gl.attachShader(prog, shaderVert);
        gl.attachShader(prog, shaderFrag);
        gl.linkProgram(prog);
        assert(gl.getProgramParameter(prog, gl.LINK_STATUS));
        gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, `ub_Test`), 0);
        const dataSize = gl.getActiveUniformBlockParameter(prog, 0, gl.UNIFORM_BLOCK_DATA_SIZE);
        // If it's working, it will be 32. If it's broken, it will be 64.
        // Looking forward to see what fun other values it will be in the wild!
        if (dataSize === 32)
            this.bugQuirks.rowMajorMatricesBroken = false;
        else if (dataSize === 64)
            this.bugQuirks.rowMajorMatricesBroken = true;
        else
            throw "whoops";
        gl.deleteProgram(prog);
        gl.deleteShader(shaderVert);
        gl.deleteShader(shaderFrag);
    }

    private _checkForBugQuirks(): void {
        const gl = this.gl;

        if (!this.bugQuirks.rowMajorMatricesBroken) {
            const debugRendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugRendererInfo !== null) {
                const renderer = gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL);
                // On some Apple platforms, dynamically indexing an array of row_major matrices
                // has troubles, and there's no easy way to detect this case.
                //
                // https://bugs.chromium.org/p/angleproject/issues/detail?id=4242
                if (navigator.platform === 'MacIntel' && !renderer.includes('NVIDIA'))
                    this.bugQuirks.rowMajorMatricesBroken = true;
            }
        }

        if (!this.bugQuirks.rowMajorMatricesBroken)
        this._checkForBugQuirksRowMajor();
    }

    //#region GfxSwapChain
    public configureSwapChain(width: number, height: number): void {
        if (this._scWidth !== width || this._scHeight !== height) {
            const gl = this.gl;

            this._scWidth = width;
            this._scHeight = height;

            if (this._scTexture !== null)
                this._destroyTexture(this._scTexture);

            this._scTexture = this._createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this._scWidth, this._scHeight, 1));
            gl.bindTexture(gl.TEXTURE_2D, getPlatformTexture(this._scTexture));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
    }

    public getDevice(): GfxDevice {
        return this;
    }

    public getOnscreenTexture(): GfxTexture {
        return this._scTexture!;
    }

    public present(platformFramebuffer?: GfxPlatformFramebuffer, viewport?: NormalizedViewportCoords): void {
        if (platformFramebuffer !== undefined) {
            const gl = this.gl;
            // TODO(jstpierre): Find a way to copy the depth buffer to WebXR.
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, platformFramebuffer);
            this.blitFullscreenTexture(this._scTexture!, viewport);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        } else {
            this.blitFullscreenTexture(this._scTexture!);
        }
    }

    private blitFullscreenTexture(texture: GfxTexture, viewport: NormalizedViewportCoords = {x: 0, y: 0, w: 1, h: 1}): void {
        const gl = this.gl;
        this._setMegaState(this._fullscreenCopyMegaState);
        this._setActiveTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, getPlatformTexture(texture));
        gl.bindSampler(0, null);
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(viewport.x * this._scWidth, viewport.y * this._scHeight, viewport.w * this._scWidth, viewport.h * this._scHeight);
        this._currentTextures[0] = null;
        this._currentSamplers[0] = null;
        this._useProgram(this._fullscreenCopyProgram);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    //#endregion

    //#region GfxDevice
    private translateTextureInternalFormat(fmt: GfxFormat): GLenum {
        switch (fmt) {
        case GfxFormat.F32_R:
            return WebGL2RenderingContext.R32F;
        case GfxFormat.F32_RG:
            return WebGL2RenderingContext.RG32F;
        case GfxFormat.F32_RGB:
            return WebGL2RenderingContext.RGB32F;
        case GfxFormat.F32_RGBA:
            return WebGL2RenderingContext.RGBA32F;
        case GfxFormat.U16_R:
            return WebGL2RenderingContext.R16UI;
        case GfxFormat.U32_R:
            return WebGL2RenderingContext.R32UI;
        case GfxFormat.U8_R_NORM:
            return WebGL2RenderingContext.R8;
        case GfxFormat.U8_RG_NORM:
            return WebGL2RenderingContext.RG8;
        case GfxFormat.U8_RGB_NORM:
            return WebGL2RenderingContext.RGB8;
        case GfxFormat.U8_RGB_SRGB:
            return WebGL2RenderingContext.SRGB8;
        case GfxFormat.U8_RGBA_NORM:
            return WebGL2RenderingContext.RGBA8;
        case GfxFormat.U8_RGBA_SRGB:
            return WebGL2RenderingContext.SRGB8_ALPHA8;
        case GfxFormat.S8_RGBA_NORM:
            return WebGL2RenderingContext.RGBA8_SNORM;
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
        switch (fmt) {
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
        case GfxFormat.D24_S8:
        case GfxFormat.D32F_S8:
            return WebGL2RenderingContext.DEPTH_STENCIL;
        case GfxFormat.D24:
        case GfxFormat.D32F:
            return WebGL2RenderingContext.DEPTH_COMPONENT;
        default:
            break;
        }

        const compFlags: FormatCompFlags = getFormatCompFlags(fmt);
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
    
    private translateTextureType(fmt: GfxFormat): GLenum {
        const typeFlags: FormatTypeFlags = getFormatTypeFlags(fmt);
        switch (typeFlags) {
        case FormatTypeFlags.U8:
            return WebGL2RenderingContext.UNSIGNED_BYTE;
        case FormatTypeFlags.U16:
            return WebGL2RenderingContext.UNSIGNED_SHORT;
        case FormatTypeFlags.U32:
            return WebGL2RenderingContext.UNSIGNED_INT;
        case FormatTypeFlags.F32:
        case FormatTypeFlags.D32:
            return WebGL2RenderingContext.FLOAT;
        case FormatTypeFlags.D24:
        case FormatTypeFlags.D24S8:
            return WebGL2RenderingContext.UNSIGNED_INT_24_8;
        case FormatTypeFlags.D32S8:
            return WebGL2RenderingContext.FLOAT_32_UNSIGNED_INT_24_8_REV;
        case FormatTypeFlags.S8:
            return WebGL2RenderingContext.BYTE;
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
            return true;
        default:
            return false;
        }
    }

    private clampNumLevels(descriptor: GfxTextureDescriptor): number {
        if (descriptor.dimension === GfxTextureDimension.n2D_ARRAY && descriptor.depth > 1) {
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

    private _bindVAO(vao: WebGLVertexArrayObject | null): void {
        if (this._currentBoundVAO !== vao) {
            this.gl.bindVertexArray(vao);
            this._currentBoundVAO = vao;
        }
    }

    private _useProgram(program: GfxProgramP_GL): void {
        if (this._currentProgram !== program) {
            this.gl.useProgram(program.gl_program);
            this._currentProgram = program;
        }
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
        if (usage === GfxBufferUsage.UNIFORM) {
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
        } else if (descriptor.dimension === GfxTextureDimension.n2D_ARRAY) {
            gl_target = WebGL2RenderingContext.TEXTURE_2D_ARRAY;
            gl.bindTexture(gl_target, gl_texture);
            gl.texStorage3D(gl_target, numLevels, internalformat, descriptor.width, descriptor.height, descriptor.depth);
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
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MIN_FILTER, translateFilterMode(descriptor.minFilter, descriptor.mipFilter));
        gl.samplerParameteri(gl_sampler, gl.TEXTURE_MAG_FILTER, translateFilterMode(descriptor.magFilter, GfxMipFilterMode.NO_MIP));
        gl.samplerParameterf(gl_sampler, gl.TEXTURE_MIN_LOD, descriptor.minLOD);
        gl.samplerParameterf(gl_sampler, gl.TEXTURE_MAX_LOD, descriptor.maxLOD);
        const sampler: GfxSamplerP_GL = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gl_sampler };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(sampler);
        return sampler;
    }

    public createAttachment(descriptor: GfxAttachmentDescriptor): GfxAttachment {
        const width = descriptor.width, height = descriptor.height, format = descriptor.format, numSamples = descriptor.numSamples;
        const gl = this.gl;

        const gl_renderbuffer = this.ensureResourceExists(gl.createRenderbuffer());
        gl.bindRenderbuffer(gl.RENDERBUFFER, gl_renderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, numSamples, this.translateTextureInternalFormat(format), width, height);

        const attachment: GfxAttachmentP_GL = { _T: _T.Attachment, ResourceUniqueId: this.getNextUniqueId(),
            gl_renderbuffer,
            gfxTexture: null,
            pixelFormat: format, width, height,
        };

        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(attachment);
        return attachment;
    }

    public createAttachmentFromTexture(gfxTexture: GfxTexture): GfxAttachment {
        const { pixelFormat, width, height, numLevels } = gfxTexture as GfxTextureP_GL;
        const gl = this.gl;

        // Attachments cannot have a mip chain currently.
        assert(numLevels === 1);

        const attachment: GfxAttachmentP_GL = { _T: _T.Attachment, ResourceUniqueId: this.getNextUniqueId(),
            gl_renderbuffer: null,
            gfxTexture,
            pixelFormat, width, height,
        };

        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(attachment);
        return attachment;
    }

    private _createProgram(descriptor: GfxProgramDescriptorSimple): GfxProgramP_GL {
        const gl_program: WebGLProgram | null = null;
        const gl_shader_vert: WebGLShader | null = null;
        const gl_shader_frag: WebGLShader | null = null;
        const compileDirty = true;
        const bindDirty = true;
        const program: GfxProgramP_GL = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor, compileDirty, bindDirty, gl_program, gl_shader_vert, gl_shader_frag };
        this._tryCompileProgram(program);
        return program;
    }

    public createProgramSimple(descriptor: GfxProgramDescriptor): GfxProgramP_GL {
        const program = this._createProgram(descriptor);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(program);
        return program;
    }

    public createProgram(descriptor: GfxProgramDescriptor): GfxProgram {
        descriptor.ensurePreprocessed(this.queryVendorInfo());
        return this.createProgramSimple(descriptor);
    }

    public createBindings(descriptor: GfxBindingsDescriptor): GfxBindings {
        const { bindingLayout, uniformBufferBindings, samplerBindings } = descriptor;
        assert(uniformBufferBindings.length >= bindingLayout.numUniformBuffers);
        assert(samplerBindings.length >= bindingLayout.numSamplers);
        const bindings: GfxBindingsP_GL = { _T: _T.Bindings, ResourceUniqueId: this.getNextUniqueId(), uniformBufferBindings, samplerBindings };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(bindings);
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        const { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat } = inputLayoutDescriptor;
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
            const { size, type, normalized } = translateVertexFormat(attr.format);
            const vertexBuffer = vertexBuffers[attr.bufferIndex];
            if (vertexBuffer === null)
                continue;

            const inputLayoutBuffer = assertExists(inputLayout.vertexBufferDescriptors[attr.bufferIndex]);

            const buffer = vertexBuffer.buffer as GfxBufferP_GL;
            assert(buffer.usage === GfxBufferUsage.VERTEX);
            gl.bindBuffer(gl.ARRAY_BUFFER, getPlatformBuffer(vertexBuffer.buffer));

            const bufferOffset = vertexBuffer.byteOffset + attr.bufferByteOffset;
            gl.vertexAttribPointer(attr.location, size, type, normalized, inputLayoutBuffer.byteStride, bufferOffset);

            if (inputLayoutBuffer.frequency === GfxVertexBufferFrequency.PER_INSTANCE) {
                gl.vertexAttribDivisor(attr.location, 1);
            }

            gl.enableVertexAttribArray(attr.location);
        }

        let indexBufferType: GLenum | null = null;
        let indexBufferCompByteSize: number | null = null;
        let indexBufferByteOffset: number | null = null;
        if (indexBufferBinding !== null) {
            const buffer = indexBufferBinding.buffer as GfxBufferP_GL;
            assert(buffer.usage === GfxBufferUsage.INDEX);
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
        const megaState = descriptor.megaStateDescriptor;
        const inputLayout = descriptor.inputLayout as GfxInputLayoutP_GL | null;
        const pipeline: GfxRenderPipelineP_GL = { _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(), bindingLayouts, drawMode, program, megaState, inputLayout, ready: false };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(pipeline);
        return pipeline;
    }

    public createReadback(elemCount: number): GfxReadback {
        const gl = this.gl;
        const gl_pbo = this.ensureResourceExists(gl.createBuffer());
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, gl_pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, elemCount * 0x04, gl.STREAM_READ);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const readback: GfxReadbackP_GL = { _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId(), gl_pbo, gl_sync: null };
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceCreated(readback);
        return readback;
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

    public destroyAttachment(o_: GfxAttachment): void {
        const o = o_ as GfxAttachmentP_GL;
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

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public destroyReadback(o: GfxReadback): void {
        const readback = o as GfxReadbackP_GL;
        if (readback.gl_sync !== null)
            this.gl.deleteSync(readback.gl_sync);
        if (readback.gl_pbo !== null)
            this.gl.deleteBuffer(readback.gl_pbo);
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.trackResourceDestroyed(o);
    }

    public createHostAccessPass(): GfxHostAccessPass {
        let pass = this._hostAccessPassPool.pop();
        if (pass === undefined)
            pass = new GfxHostAccessPassP_GL();
        return pass;
    }

    public createRenderPass(descriptor: GfxRenderPassDescriptor): GfxRenderPassP_GL {
        let pass = this._renderPassPool.pop();
        if (pass === undefined)
            pass = new GfxRenderPassP_GL();

        let clearBits: number = 0;
        if (descriptor.colorAttachment !== null) {
            if (descriptor.colorLoadDisposition === GfxLoadDisposition.CLEAR)
                clearBits |= WebGL2RenderingContext.COLOR_BUFFER_BIT;
        }

        if (descriptor.depthStencilAttachment !== null) {
            const attachment = descriptor.depthStencilAttachment as GfxAttachmentP_GL;
            const flags = getFormatFlags(attachment.pixelFormat);
            if (!!(flags & FormatFlags.DEPTH) && descriptor.depthLoadDisposition === GfxLoadDisposition.CLEAR)
                clearBits |= WebGL2RenderingContext.DEPTH_BUFFER_BIT;
            if (!!(flags & FormatFlags.STENCIL) && descriptor.stencilLoadDisposition === GfxLoadDisposition.CLEAR)
                clearBits |= WebGL2RenderingContext.STENCIL_BUFFER_BIT;
        }

        // TODO(jstpierre): This isn't kosher.
        pass.descriptor = descriptor;

        const { colorAttachment, colorResolveTo, depthStencilAttachment, depthStencilResolveTo, colorClearColor, depthClearValue, stencilClearValue } = descriptor;

        pass.setRenderPassParameters(colorAttachment, colorResolveTo, depthStencilAttachment, depthStencilResolveTo, clearBits, colorClearColor.r, colorClearColor.g, colorClearColor.b, colorClearColor.a, depthClearValue, stencilClearValue);
        return pass;
    }

    public submitPass(o: GfxPass): void {
        if (o instanceof GfxRenderPassP_GL) {
            o.end();
            this.executeRenderPass(o.u32.b, o.f32.b, o.o);
            o.reset();
            this._renderPassPool.push(o);
        } else if (o instanceof GfxHostAccessPassP_GL) {
            o.end();
            this.executeHostAccessPass(o.u32.b, o.gfxr, o.bufr);
            o.reset();
            this._hostAccessPassPool.push(o);
        }
    }

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void {
        const gl = this.gl;
        const readback = o as GfxReadbackP_GL;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveReadFramebuffer);
        const texture = a as GfxTextureP_GL;
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.gl_texture, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readback.gl_pbo);
        gl.readPixels(x, y, 1, 1, gl.RED_INTEGER, gl.UNSIGNED_INT, dstOffset * 0x04);
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
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, readback.gl_pbo);
            gl.getBufferSubData(gl.PIXEL_UNPACK_BUFFER, 0, dst, dstOffs);
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            return true;
        } else {
            return false;
        }
    }

    public queryLimits(): GfxDeviceLimits {
        const gl = this.gl;
        return {
            uniformBufferWordAlignment: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) / 4,
            uniformBufferMaxPageWordSize: this._uniformBufferMaxPageByteSize / 4,
        };
    }

    public queryTextureFormatSupported(format: GfxFormat): boolean {
        switch (format) {
        case GfxFormat.BC1_SRGB:
        case GfxFormat.BC2_SRGB:
        case GfxFormat.BC3_SRGB:
            return this._WEBGL_compressed_texture_s3tc_srgb !== null;
        case GfxFormat.BC1:
        case GfxFormat.BC2:
        case GfxFormat.BC3:
            return this._WEBGL_compressed_texture_s3tc !== null;
        default:
            return true;
        }
    }

    public queryPipelineReady(o: GfxRenderPipeline): boolean {
        const pipeline = o as GfxRenderPipelineP_GL;
        if (pipeline.ready)
            return true;

        if (pipeline.program.gl_program === null)
            return false;

        const gl = this.gl;
        const prog = pipeline.program.gl_program;

        if (this._KHR_parallel_shader_compile !== null) {
            // With asynchronous pipeline compilation, we need to ask whether the pipeline is ready...
            pipeline.ready = gl.getProgramParameter(prog, this._KHR_parallel_shader_compile.COMPLETION_STATUS_KHR);
        } else {
            // With synchronous pipeline compilation, pipelines are ready as soon as they're created...
            pipeline.ready = true;
        }

        // Check for errors.
        if (pipeline.ready && SHADER_DEBUG)
            this._checkProgramCompilationForErrors(pipeline.program);

        return pipeline.ready;
    }

    public queryPlatformAvailable(): boolean {
        return this.gl.isContextLost();
    }

    public queryVendorInfo(): GfxVendorInfo {
        return this;
    }

    public queryRenderPass(o: GfxRenderPass): GfxRenderPassDescriptor {
        const pass = o as GfxRenderPassP_GL;
        return pass.descriptor;
    }

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
        } else if (o._T === _T.Attachment) {
            const { gl_renderbuffer } = o as GfxAttachmentP_GL;
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

    public pushDebugGroup(debugGroup: GfxDebugGroup): void {
        this._debugGroupStack.push(debugGroup);
    }

    public popDebugGroup(): void {
        this._debugGroupStack.pop();
    }
    //#endregion

    //#region Debugging
    public getBufferData(buffer: GfxBuffer, dstBuffer: ArrayBufferView, wordOffset: number = 0): void {
        const gl = this.gl;
        gl.bindBuffer(gl.COPY_READ_BUFFER, getPlatformBuffer(buffer, wordOffset * 4));
        gl.getBufferSubData(gl.COPY_READ_BUFFER, wordOffset * 4, dstBuffer);
    }

    public checkForLeaks(): void {
        if (this._resourceCreationTracker !== null)
            this._resourceCreationTracker.checkForLeaks();
    }
    //#endregion

    //#region Pass execution
    public executeRenderPass(u32: Uint32Array, f32: Float32Array, gfxr: (object | null)[]): void {
        let iu32 = 0, if32 = 0, igfxr = 0;
        while (true) {
            const cmd = u32[iu32++] as RenderPassCmd;

            if (cmd === RenderPassCmd.setRenderPassParameters) {
                const numColorAttachments = u32[iu32++];
                igfxr += numColorAttachments * 2;
                this.setRenderPassParameters(gfxr as GfxAttachment[], numColorAttachments, gfxr[igfxr++] as GfxAttachment | null, gfxr[igfxr++] as GfxTexture | null, u32[iu32++], f32[if32++], f32[if32++], f32[if32++], f32[if32++], f32[if32++], f32[if32++]);
            } else if (cmd === RenderPassCmd.setViewport) {
                this.setViewport(f32[if32++], f32[if32++], f32[if32++], f32[if32++]);
            } else if (cmd === RenderPassCmd.setScissor) {
                this.setScissor(f32[if32++], f32[if32++], f32[if32++], f32[if32++]);
            } else if (cmd === RenderPassCmd.setBindings) {
                const index = u32[iu32++], numOffsets = u32[iu32++];
                this.setBindings(index, gfxr[igfxr++] as GfxBindings, numOffsets, u32, iu32);
                iu32 += numOffsets;
            } else if (cmd === RenderPassCmd.setPipeline) {
                this.setPipeline(gfxr[igfxr++] as GfxRenderPipeline);
            } else if (cmd === RenderPassCmd.setInputState) {
                this.setInputState(gfxr[igfxr++] as GfxInputState | null);
            } else if (cmd === RenderPassCmd.setStencilRef) {
                this.setStencilRef(f32[if32++]);
            } else if (cmd === RenderPassCmd.draw) {
                this.draw(u32[iu32++], u32[iu32++]);
            } else if (cmd === RenderPassCmd.drawIndexed) {
                this.drawIndexed(u32[iu32++], u32[iu32++]);
            } else if (cmd === RenderPassCmd.drawIndexedInstanced) {
                this.drawIndexedInstanced(u32[iu32++], u32[iu32++], u32[iu32++]);
            } else if (cmd === RenderPassCmd.endPass) {
                this.endPass();
                return;
            } else {
                const m: RenderPassCmd.invalid = cmd;
                throw new Error("Invalid execution");
            }
        }
    }

    public executeHostAccessPass(u32: Uint32Array, gfxr: (GfxResource | null)[], bufr: ArrayBufferView[]): void {
        let iu32 = 0, igfxr = 0, ibufr = 0;
        while (true) {
            const cmd = u32[iu32++] as HostAccessPassCmd;

            if (cmd === HostAccessPassCmd.uploadBufferData) {
                this.uploadBufferData(gfxr[igfxr++] as GfxBuffer, u32[iu32++], bufr[ibufr++] as Uint8Array, u32[iu32++], u32[iu32++]);
            } else if (cmd === HostAccessPassCmd.uploadTextureData) {
                // Implement inline to prevent allocation.
                const texture = gfxr[igfxr++] as GfxTexture;
                const firstMipLevelToUpload = u32[iu32++];
                const numMipLevelsToUpload = u32[iu32++];

                const gl = this.gl;
                const { gl_texture, gl_target, pixelFormat, width, height, depth, numLevels } = texture as GfxTextureP_GL;
                this._setActiveTexture(gl.TEXTURE0);
                this._currentTextures[0] = null;
                gl.bindTexture(gl_target, gl_texture);
                let w = width, h = height, d = depth;
                const maxMipLevel = Math.min(firstMipLevelToUpload + numMipLevelsToUpload, numLevels);

                const isCompressed = this.isTextureFormatCompressed(pixelFormat);
                const is3D = gl_target === WebGL2RenderingContext.TEXTURE_3D || gl_target === WebGL2RenderingContext.TEXTURE_2D_ARRAY;
                const gl_format = this.translateTextureFormat(pixelFormat);

                for (let i = 0; i < maxMipLevel; i++) {
                    if (i >= firstMipLevelToUpload) {
                        const levelData = bufr[ibufr++] as ArrayBufferView;

                        if (gl_target === WebGL2RenderingContext.TEXTURE_2D_ARRAY && isCompressed) {
                            // Workaround for https://bugs.chromium.org/p/chromium/issues/detail?id=1004511
                            const imageSize = levelData.byteLength / depth;
                            for (let z = 0; z < depth; z++) {
                                gl.compressedTexSubImage3D(gl_target, i, 0, 0, z, w, h, 1, gl_format, levelData, z * imageSize, imageSize);
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
            } else if (cmd === HostAccessPassCmd.end) {
                return;
            } else {
                throw new Error("Invalid execution");
            }
        }
    }

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

            if (!this._reportShaderError(program.gl_shader_frag!, descriptor.preprocessedFrag))
                return;

            // Neither shader had an error, report the program info log.
            console.error(gl.getProgramInfoLog(program.gl_program!));
            debugger;
        }
    }

    private _tryCompileProgram(program: GfxProgramP_GL): void {
        assert(program.compileDirty);

        const descriptor = program.descriptor;

        const gl = this.gl;
        program.gl_shader_vert = this._compileShader(descriptor.preprocessedVert, gl.VERTEX_SHADER);
        program.gl_shader_frag = this._compileShader(descriptor.preprocessedFrag, gl.FRAGMENT_SHADER);
        const prog = this.ensureResourceExists(gl.createProgram());
        gl.attachShader(prog, program.gl_shader_vert);
        gl.attachShader(prog, program.gl_shader_frag);
        gl.linkProgram(prog);
        program.gl_program = prog;

        program.compileDirty = false;
        program.bindDirty = true;
    }

    private _bindFramebufferAttachment(binding: GLenum, attachment: GfxAttachmentP_GL | null): void {
        const gl = this.gl;

        if (attachment === null)
            gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, binding, gl.RENDERBUFFER, null);
        else if (attachment.gl_renderbuffer !== null)
            gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, binding, gl.RENDERBUFFER, attachment.gl_renderbuffer);
        else if (attachment.gfxTexture !== null)
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, binding, gl.TEXTURE_2D, getPlatformTexture(attachment.gfxTexture), 0);
    }

    private setRenderPassParameters(colorResources: GfxResource[], numColorAttachments: number, depthStencilAttachment: GfxAttachment | null, depthStencilResolveTo: GfxTexture | null, clearBits: GLenum, clearColorR: number, clearColorG: number, clearColorB: number, clearColorA: number, depthClearValue: number, stencilClearValue: number): void {
        const gl = this.gl;

        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._renderPassDrawFramebuffer);

        for (let i = numColorAttachments; i < this._currentColorAttachments.length; i++) {
            gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, null);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
        }

        this._currentColorAttachments.length = numColorAttachments;
        for (let i = 0; i < numColorAttachments; i += 2) {
            const colorAttachment = colorResources[i + 0] as GfxAttachmentP_GL, colorResolveTo = colorResources[i + 1] as GfxTextureP_GL;
            if (this._currentColorAttachments[i] !== colorAttachment) {
                this._currentColorAttachments[i] = colorAttachment;
                this._bindFramebufferAttachment(gl.COLOR_ATTACHMENT0 + i, colorAttachment);
            }
            this._currentColorResolveTos[i] = colorResolveTo;
        }

        if (this._currentDepthStencilAttachment !== depthStencilAttachment) {
            this._currentDepthStencilAttachment = depthStencilAttachment as GfxAttachmentP_GL;
            this._bindFramebufferAttachment(gl.DEPTH_STENCIL_ATTACHMENT, this._currentDepthStencilAttachment);
        }
        this._currentDepthStencilResolveTo = depthStencilResolveTo as GfxTextureP_GL;

        gl.disable(gl.SCISSOR_TEST);
        if (!!(clearBits & WebGL2RenderingContext.COLOR_BUFFER_BIT)) {
            assert(this._currentColorAttachments.length > 0);
            gl.clearColor(clearColorR, clearColorG, clearColorB, clearColorA);
        }
        if (!!(clearBits & WebGL2RenderingContext.DEPTH_BUFFER_BIT)) {
            assert(this._currentDepthStencilAttachment !== null);
            // GL clears obey the masks... bad API or worst API?
            if (!this._currentMegaState.depthWrite) {
                gl.depthMask(true);
                this._currentMegaState.depthWrite = true;
            }
            gl.clearDepth(depthClearValue);
        }
        if (!!(clearBits & WebGL2RenderingContext.STENCIL_BUFFER_BIT)) {
            assert(this._currentDepthStencilAttachment !== null);
            gl.clearStencil(stencilClearValue);
        }
        if (clearBits !== 0)
            gl.clear(clearBits);
    }

    private setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsetsCount: number, dynamicByteOffsets: Uint32Array, dynamicByteOffsetsStart: number): void {
        const gl = this.gl;

        assert(bindingLayoutIndex < this._currentPipeline.bindingLayouts.bindingLayoutTables.length);
        const bindingLayoutTable = this._currentPipeline.bindingLayouts.bindingLayoutTables[bindingLayoutIndex];

        const { uniformBufferBindings, samplerBindings } = bindings_ as GfxBindingsP_GL;
        // Ignore extra bindings.
        assert(uniformBufferBindings.length >= bindingLayoutTable.numUniformBuffers);
        assert(samplerBindings.length >= bindingLayoutTable.numSamplers);
        assert(dynamicByteOffsetsCount >= uniformBufferBindings.length);

        for (let i = 0; i < uniformBufferBindings.length; i++) {
            const binding = uniformBufferBindings[i];
            if (binding.wordCount === 0)
                continue;
            const index = bindingLayoutTable.firstUniformBuffer + i;
            const buffer = binding.buffer as GfxBufferP_GL;
            const byteOffset = (binding.wordOffset * 4) + dynamicByteOffsets[dynamicByteOffsetsStart + i];
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

        for (let i = 0; i < samplerBindings.length; i++) {
            const binding = samplerBindings[i];
            const samplerIndex = bindingLayoutTable.firstSampler + i;
            const gl_sampler = binding !== null && binding.gfxSampler !== null ? getPlatformSampler(binding.gfxSampler) : null;
            const gl_texture = binding !== null && binding.gfxTexture !== null ? getPlatformTexture(binding.gfxTexture) : null;

            if (this._currentSamplers[samplerIndex] !== gl_sampler) {
                gl.bindSampler(samplerIndex, gl_sampler);
                this._currentSamplers[samplerIndex] = gl_sampler;
            }

            if (this._currentTextures[samplerIndex] !== gl_texture) {
                this._setActiveTexture(gl.TEXTURE0 + samplerIndex);
                if (gl_texture !== null) {
                    const { gl_target } = (assertExists(binding).gfxTexture as GfxTextureP_GL);
                    gl.bindTexture(gl_target, gl_texture);
                    this._debugGroupStatisticsTextureBind();
                } else {
                    // XXX(jstpierre): wtf do I do here? Maybe do nothing?
                    // Let's hope that it's a 2D texture.
                    gl.bindTexture(gl.TEXTURE_2D, this._blackTexture);
                }
                this._currentTextures[samplerIndex] = gl_texture;
            }
        }
    }

    private setViewport(x: number, y: number, w: number, h: number): void {
        const gl = this.gl;
        gl.viewport(x, y, w, h);
    }

    private setScissor(x: number, y: number, w: number, h: number): void {
        const gl = this.gl;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(x, y, w, h);
    }

    private _setMegaState(newMegaState: GfxMegaStateDescriptor): void {
        applyMegaState(this.gl, this._currentMegaState, newMegaState);
    }

    private setPipeline(pipeline: GfxRenderPipeline): void {
        this._currentPipeline = pipeline as GfxRenderPipelineP_GL;
        assert(this.queryPipelineReady(this._currentPipeline));
        this._setMegaState(this._currentPipeline.megaState);

        // Hotpatch support.
        // TODO(jstpierre): Make this a bit less hacky in the future.
        const program = this._currentPipeline.program;
        if (program.descriptor.preprocessedVert === '') {
            const descriptor = program.descriptor as GfxProgramDescriptor;
            descriptor.ensurePreprocessed(this.queryVendorInfo());
            program.compileDirty = true;
            this._tryCompileProgram(program);
        }

        this._useProgram(program);

        if (program.bindDirty) {
            const gl = this.gl, prog = program.gl_program!;
            const deviceProgram = program.descriptor;

            const uniformBlocks = findall(deviceProgram.preprocessedVert, /uniform (\w+) {([^]*?)}/g);
            for (let i = 0; i < uniformBlocks.length; i++) {
                const [m, blockName, contents] = uniformBlocks[i];
                gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, blockName), i);
            }

            const samplers = findall(deviceProgram.preprocessedVert, /^uniform .*sampler\S+ (\w+)(?:\[(\d+)\])?;$/gm);
            let samplerIndex = 0;
            for (let i = 0; i < samplers.length; i++) {
                const [m, name, arraySizeStr] = samplers[i];
                const arraySize = arraySizeStr ? parseInt(arraySizeStr) : 1;
                // Assign identities in order.
                const samplerUniformLocation = gl.getUniformLocation(prog, name);
                gl.uniform1iv(samplerUniformLocation, range(samplerIndex, arraySize));
                samplerIndex += arraySize;
            }

            program.bindDirty = false;
        }
    }

    private setInputState(inputState_: GfxInputState | null): void {
        const inputState = inputState_ as GfxInputStateP_GL;
        this._currentInputState = inputState;
        if (this._currentInputState !== null) {
            assert(this._currentPipeline.inputLayout === this._currentInputState.inputLayout);
            this._bindVAO(this._currentInputState.vao);
        } else {
            assert(this._currentPipeline.inputLayout === null);
            this._bindVAO(null);
        }
    }

    private setStencilRef(value: number): void {
        const gl = this.gl;
        gl.stencilFunc(this._currentMegaState.stencilCompare, value, 0xFF);
    }

    private draw(count: number, firstVertex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        gl.drawArrays(pipeline.drawMode, firstVertex, count);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles(count / 3);
    }

    private drawIndexed(count: number, firstIndex: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        const inputState = this._currentInputState;
        const byteOffset = assertExists(inputState.indexBufferByteOffset) + firstIndex * assertExists(inputState.indexBufferCompByteSize);
        gl.drawElements(pipeline.drawMode, count, assertExists(inputState.indexBufferType), byteOffset);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles(count / 3);
    }

    private drawIndexedInstanced(count: number, firstIndex: number, instanceCount: number): void {
        const gl = this.gl;
        const pipeline = this._currentPipeline;
        const inputState = this._currentInputState;
        const byteOffset = assertExists(inputState.indexBufferByteOffset) + firstIndex * assertExists(inputState.indexBufferCompByteSize);
        gl.drawElementsInstanced(pipeline.drawMode, count, assertExists(inputState.indexBufferType), byteOffset, instanceCount);
        this._debugGroupStatisticsDrawCall();
        this._debugGroupStatisticsTriangles((count / 3) * instanceCount);
    }

    private framebufferAttachmentForFormat(format: GfxFormat): GLenum {
        const flags = getFormatFlags(format);
        const depth = !!(flags & FormatFlags.DEPTH), stencil = !!(flags & FormatFlags.STENCIL);
        if (depth && stencil)
            return WebGL2RenderingContext.DEPTH_STENCIL_ATTACHMENT;
        else if (depth)
            return WebGL2RenderingContext.DEPTH_ATTACHMENT;
        else if (stencil)
            return WebGL2RenderingContext.STENCIL_ATTACHMENT;
        else
            throw "whoops";
    }

    private endPass(): void {
        const gl = this.gl;
        for (let i = 0; i < this._currentColorAttachments.length; i++) {
            const colorResolveFrom = this._currentColorAttachments[i];
            const colorResolveTo = this._currentColorResolveTos[i];

            if (colorResolveTo !== null) {
                assert(colorResolveFrom.width === colorResolveTo.width && colorResolveFrom.height === colorResolveTo.height);
                assert(colorResolveFrom.gl_renderbuffer !== null);

                gl.disable(gl.SCISSOR_TEST);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveReadFramebuffer);
                gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorResolveFrom.gl_renderbuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolveDrawFramebuffer);
                gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorResolveTo.gl_texture, 0);
                gl.blitFramebuffer(0, 0, colorResolveFrom.width, colorResolveFrom.height, 0, 0, colorResolveTo.width, colorResolveTo.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);

                gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, null);
                gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);

                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            }
        }

        const depthStencilResolveFrom = this._currentDepthStencilAttachment;
        const depthStencilResolveTo = this._currentDepthStencilResolveTo;

        if (depthStencilResolveFrom !== null && depthStencilResolveTo !== null) {
            assert(depthStencilResolveFrom.width === depthStencilResolveTo.width && depthStencilResolveFrom.height === depthStencilResolveTo.height);
            assert(depthStencilResolveFrom.gl_renderbuffer !== null);

            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._resolveReadFramebuffer);
            gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, this.framebufferAttachmentForFormat(depthStencilResolveFrom.pixelFormat), gl.RENDERBUFFER, depthStencilResolveFrom.gl_renderbuffer);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._resolveDrawFramebuffer);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, this.framebufferAttachmentForFormat(depthStencilResolveTo.pixelFormat), gl.TEXTURE_2D, depthStencilResolveTo.gl_texture, 0);
            gl.blitFramebuffer(0, 0, depthStencilResolveFrom.width, depthStencilResolveFrom.height, 0, 0, depthStencilResolveTo.width, depthStencilResolveTo.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

            gl.framebufferRenderbuffer(gl.READ_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
            gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        }
    }

    private uploadBufferData(buffer: GfxBuffer, dstByteOffset: number, data: Uint8Array, srcByteOffset: number, byteSize: number): void {
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
    //#endregion
}

export function createSwapChainForWebGL2(gl: WebGL2RenderingContext): GfxSwapChain {
    return new GfxImplP_GL(gl);
}

export function gfxDeviceGetImpl_GL(gfxDevice: GfxDevice): GfxImplP_GL {
    return gfxDevice as GfxImplP_GL;
}

export function getPlatformTexture_GL(texture: GfxTexture): WebGLTexture {
    return getPlatformTexture(texture);
}
