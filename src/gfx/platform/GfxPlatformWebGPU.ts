
import type { glsl_compile as glsl_compile_ } from "../../../rust/pkg/noclip_support";
import { HashMap, nullHashFunc } from "../../HashMap.js";
import { rust } from "../../rustlib.js";
import { GfxAttachmentState, GfxBindingLayoutDescriptor, GfxBindingLayoutSamplerDescriptor, GfxBindings, GfxBindingsDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelBlendState, GfxClipSpaceNearZ, GfxCompareMode, GfxComputePass, GfxComputePipelineDescriptor, GfxComputeProgramDescriptor, GfxCullMode, GfxStatisticsGroup, GfxDevice, GfxDeviceLimits, GfxFormat, GfxFrontFaceMode, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxPass, GfxPrimitiveTopology, GfxProgram, GfxQueryPoolType, GfxRenderPass, GfxRenderPassDescriptor, GfxRenderPipeline, GfxRenderPipelineDescriptor, GfxRenderTarget, GfxRenderTargetDescriptor, GfxSampler, GfxSamplerDescriptor, GfxSamplerFormatKind, GfxShadingLanguage, GfxSwapChain, GfxTexFilterMode, GfxTexture, GfxTextureDescriptor, GfxTextureDimension, GfxTextureUsage, GfxVendorInfo, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxViewportOrigin, GfxWrapMode, GfxRenderAttachmentView, GfxRenderProgramDescriptor } from "./GfxPlatform.js";
import { FormatFlags, FormatTypeFlags, getFormatByteSize, getFormatFlags, getFormatSamplerKind, getFormatTypeFlags } from "./GfxPlatformFormat.js";
import { GfxComputePipeline, GfxQueryPool, GfxReadback, GfxResource, GfxTextureImpl, _T, defaultBindingLayoutSamplerDescriptor, isFormatSamplerKindCompatible } from "./GfxPlatformImpl.js";
import { align, assert, assertExists } from "./GfxPlatformUtil.js";
import { gfxBindingLayoutDescriptorEqual } from './GfxPlatformObjUtil.js';
import { IS_DEVELOPMENT } from "../../BuildVersion.js";

interface GfxBufferP_WebGPU extends GfxBuffer {
    gpuBuffer: GPUBuffer;
    size: number;
}

interface GfxTextureSharedDescriptor extends GfxTextureDescriptor {
    sampleCount: number;
}

interface GfxTextureSharedP_WebGPU extends GfxTextureSharedDescriptor {
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
}

interface GfxTextureP_WebGPU extends GfxTextureSharedP_WebGPU, GfxTextureImpl {
}

interface GfxRenderTargetP_WebGPU extends GfxTextureSharedP_WebGPU, GfxRenderTarget {
    ownsTexture: boolean;
}

interface GfxSamplerP_WebGPU extends GfxSampler {
    gpuSampler: GPUSampler;
}

interface GfxProgramP_WebGPU extends GfxProgram {
    descriptor: GfxRenderProgramDescriptor;
    vertexStage: GPUProgrammableStage | null;
    fragmentStage: GPUProgrammableStage | null;
}

interface GfxComputeProgramP_WebGPU extends GfxProgram {
    descriptor: GfxComputeProgramDescriptor;
    computeStage: GPUProgrammableStage | null;
}

interface GfxBindingsP_WebGPU extends GfxBindings {
    bindingLayout: GfxBindingLayoutDescriptor;
    bindGroupLayout: GPUBindGroupLayout;
    gpuBindGroup: GPUBindGroup;
}

interface GfxInputLayoutP_WebGPU extends GfxInputLayout {
    buffers: GPUVertexBufferLayout[];
    indexFormat: GPUIndexFormat | undefined;
}

interface GfxRenderPipelineP_WebGPU extends GfxRenderPipeline {
    descriptor: GfxRenderPipelineDescriptor;
    gpuRenderPipeline: GPURenderPipeline | null;
    isCreatingAsync: boolean;
}

interface GfxComputePipelineP_WebGPU extends GfxComputePipeline {
    descriptor: GfxComputePipelineDescriptor;
    gpuComputePipeline: GPUComputePipeline | null;
    isCreatingAsync: boolean;
}

interface GfxReadbackP_WebGPU extends GfxReadback {
    cpuBuffer: GPUBuffer;
    done: boolean;
    destroyed: boolean;
}

interface GfxQueryPoolP_WebGPU extends GfxQueryPool {
    querySet: GPUQuerySet;
    resolveBuffer: GPUBuffer;
    cpuBuffer: GPUBuffer;
    results: BigUint64Array | null;
    destroyed: boolean;
}

function translateBufferUsage(usage_: GfxBufferUsage): GPUBufferUsageFlags {
    let usage = 0;
    if (usage_ & GfxBufferUsage.Index)
        usage |= GPUBufferUsage.INDEX;
    if (usage_ & GfxBufferUsage.Vertex)
        usage |= GPUBufferUsage.VERTEX;
    if (usage_ & GfxBufferUsage.Uniform)
        usage |= GPUBufferUsage.UNIFORM;
    if (usage_ & GfxBufferUsage.Storage)
        usage |= GPUBufferUsage.STORAGE;
    if (usage_ & GfxBufferUsage.CopySrc)
        usage |= GPUBufferUsage.COPY_SRC;
    usage |= GPUBufferUsage.COPY_DST;
    return usage;
}

function translateWrapMode(wrapMode: GfxWrapMode): GPUAddressMode {
    if (wrapMode === GfxWrapMode.Clamp)
        return 'clamp-to-edge';
    else if (wrapMode === GfxWrapMode.Repeat)
        return 'repeat';
    else if (wrapMode === GfxWrapMode.Mirror)
        return 'mirror-repeat';
    else
        throw "whoops";
}

function translateMinMagFilter(texFilter: GfxTexFilterMode): GPUFilterMode {
    if (texFilter === GfxTexFilterMode.Bilinear)
        return 'linear';
    else if (texFilter === GfxTexFilterMode.Point)
        return 'nearest';
    else
        throw "whoops";
}

function translateMipFilter(mipFilter: GfxMipFilterMode): GPUFilterMode {
    if (mipFilter === GfxMipFilterMode.Linear)
        return 'linear';
    else if (mipFilter === GfxMipFilterMode.Nearest)
        return 'nearest';
    else if (mipFilter === GfxMipFilterMode.NoMip)
        return 'nearest';
    else
        throw "whoops";
}

function translateTextureFormat(format: GfxFormat): GPUTextureFormat {
    if (format === GfxFormat.U8_R_NORM)
        return 'r8unorm';
    else if (format === GfxFormat.U8_RG_NORM)
        return 'rg8unorm';
    else if (format === GfxFormat.U8_RGBA_RT)
        return 'bgra8unorm';
    else if (format === GfxFormat.U8_RGBA_RT_SRGB)
        return 'bgra8unorm-srgb';
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'rgba8unorm';
    else if (format === GfxFormat.U8_RGBA_SRGB)
        return 'rgba8unorm-srgb';
    else if (format === GfxFormat.S8_R_NORM)
        return 'r8snorm';
    else if (format === GfxFormat.S8_RG_NORM)
        return 'rg8snorm';
    else if (format === GfxFormat.S8_RGBA_NORM)
        return 'rgba8snorm';
    else if (format === GfxFormat.U32_R)
        return 'r32uint';
    else if (format === GfxFormat.F32_R)
        return 'r32float';
    else if (format === GfxFormat.F16_RGBA)
        return 'rgba16float';
    else if (format === GfxFormat.F32_RGBA)
        return 'rgba32float';
    else if (format === GfxFormat.D24)
        return 'depth24plus';
    else if (format === GfxFormat.D24_S8)
        return 'depth24plus-stencil8';
    else if (format === GfxFormat.D32F)
        return 'depth32float';
    else if (format === GfxFormat.D32F_S8)
        return 'depth32float-stencil8';
    else if (format === GfxFormat.BC1)
        return 'bc1-rgba-unorm';
    else if (format === GfxFormat.BC1_SRGB)
        return 'bc1-rgba-unorm-srgb';
    else if (format === GfxFormat.BC2)
        return 'bc2-rgba-unorm';
    else if (format === GfxFormat.BC2_SRGB)
        return 'bc2-rgba-unorm-srgb';
    else if (format === GfxFormat.BC3)
        return 'bc3-rgba-unorm';
    else if (format === GfxFormat.BC3_SRGB)
        return 'bc3-rgba-unorm-srgb';
    else if (format === GfxFormat.BC4_SNORM)
        return 'bc4-r-snorm';
    else if (format === GfxFormat.BC4_UNORM)
        return 'bc4-r-unorm';
    else if (format === GfxFormat.BC5_SNORM)
        return 'bc5-rg-snorm';
    else if (format === GfxFormat.BC5_UNORM)
        return 'bc5-rg-unorm';
    else
        throw "whoops";
}

function translateTextureDimension(dimension: GfxTextureDimension): GPUTextureDimension {
    if (dimension === GfxTextureDimension.n2D)
        return '2d';
    else if (dimension === GfxTextureDimension.n2DArray)
        return '2d';
    else if (dimension === GfxTextureDimension.n3D)
        return '3d';
    else if (dimension === GfxTextureDimension.Cube)
        return '2d';
    else
        throw "whoops";
}

function translateViewDimension(dimension: GfxTextureDimension): GPUTextureViewDimension {
    if (dimension === GfxTextureDimension.n2D)
        return '2d';
    else if (dimension === GfxTextureDimension.n2DArray)
        return '2d-array';
    else if (dimension === GfxTextureDimension.n3D)
        return '3d';
    else if (dimension === GfxTextureDimension.Cube)
        return 'cube';
    else
        throw "whoops";
}

function translateTextureUsage(usage: GfxTextureUsage): GPUTextureUsageFlags {
    let gpuUsage: GPUTextureUsageFlags = 0;

    if (!!(usage & GfxTextureUsage.Sampled))
        gpuUsage |= GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    if (!!(usage & GfxTextureUsage.RenderTarget))
        gpuUsage |= GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

    return gpuUsage;
}

function getPlatformBuffer(buffer_: GfxBuffer): GPUBuffer {
    const buffer = buffer_ as GfxBufferP_WebGPU;
    return buffer.gpuBuffer;
}

function getPlatformSampler(sampler_: GfxSampler): GPUSampler {
    const sampler = sampler_ as GfxSamplerP_WebGPU;
    return sampler.gpuSampler;
}

function translateTopology(topology: GfxPrimitiveTopology): GPUPrimitiveTopology {
    if (topology === GfxPrimitiveTopology.Triangles)
        return 'triangle-list';
    else if (topology === GfxPrimitiveTopology.Lines)
        return 'line-list';
    else
        throw "whoops";
}

function translateCullMode(cullMode: GfxCullMode): GPUCullMode {
    if (cullMode === GfxCullMode.None)
        return 'none';
    else if (cullMode === GfxCullMode.Front)
        return 'front';
    else if (cullMode === GfxCullMode.Back)
        return 'back';
    else
        throw "whoops";
}

function translateFrontFace(frontFaceMode: GfxFrontFaceMode): GPUFrontFace {
    if (frontFaceMode === GfxFrontFaceMode.CCW)
        return 'ccw';
    else if (frontFaceMode === GfxFrontFaceMode.CW)
        return 'cw';
    else
        throw "whoops";
}

function translatePrimitiveState(topology: GfxPrimitiveTopology, megaStateDescriptor: GfxMegaStateDescriptor): GPUPrimitiveState {
    return {
        topology: translateTopology(topology),
        cullMode: translateCullMode(megaStateDescriptor.cullMode),
        frontFace: translateFrontFace(megaStateDescriptor.frontFace),
    };
}

function translateBlendFactor(factor: GfxBlendFactor): GPUBlendFactor {
    if (factor === GfxBlendFactor.Zero)
        return 'zero';
    else if (factor === GfxBlendFactor.One)
        return 'one';
    else if (factor === GfxBlendFactor.Src)
        return 'src';
    else if (factor === GfxBlendFactor.OneMinusSrc)
        return 'one-minus-src';
    else if (factor === GfxBlendFactor.Dst)
        return 'dst';
    else if (factor === GfxBlendFactor.OneMinusDst)
        return 'one-minus-dst';
    else if (factor === GfxBlendFactor.SrcAlpha)
        return 'src-alpha';
    else if (factor === GfxBlendFactor.OneMinusSrcAlpha)
        return 'one-minus-src-alpha';
    else if (factor === GfxBlendFactor.DstAlpha)
        return 'dst-alpha';
    else if (factor === GfxBlendFactor.OneMinusDstAlpha)
        return 'one-minus-dst-alpha';
    else
        throw "whoops";
}

function translateBlendMode(mode: GfxBlendMode): GPUBlendOperation {
    if (mode === GfxBlendMode.Add)
        return 'add';
    else if (mode === GfxBlendMode.Subtract)
        return 'subtract';
    else if (mode === GfxBlendMode.ReverseSubtract)
        return 'reverse-subtract';
    else
        throw "whoops";
}

function translateBlendComponent(ch: GfxChannelBlendState): GPUBlendComponent {
    return {
        operation: translateBlendMode(ch.blendMode),
        srcFactor: translateBlendFactor(ch.blendSrcFactor),
        dstFactor: translateBlendFactor(ch.blendDstFactor),
    };
}

function blendComponentIsNil(ch: GfxChannelBlendState): boolean {
    return ch.blendMode === GfxBlendMode.Add && ch.blendSrcFactor === GfxBlendFactor.One && ch.blendDstFactor === GfxBlendFactor.Zero;
}

function translateBlendState(attachmentState: GfxAttachmentState): GPUBlendState | undefined {
    if (blendComponentIsNil(attachmentState.rgbBlendState) && blendComponentIsNil(attachmentState.alphaBlendState)) {
        return undefined;
    } else {
        return {
            color: translateBlendComponent(attachmentState.rgbBlendState),
            alpha: translateBlendComponent(attachmentState.alphaBlendState),
        };
    }
}

function translateColorState(attachmentState: GfxAttachmentState, format: GfxFormat): GPUColorTargetState {
    return {
        format: translateTextureFormat(format),
        blend: translateBlendState(attachmentState),
        writeMask: attachmentState.channelWriteMask,
    };
}

function translateTargets(colorAttachmentFormats: (GfxFormat | null)[], megaStateDescriptor: GfxMegaStateDescriptor): (GPUColorTargetState | null)[] {
    return colorAttachmentFormats.map((format, i) => {
        if (format === null)
            return null;

        let attachmentState = megaStateDescriptor.attachmentsState[i];
        if (attachmentState === undefined)
            attachmentState = megaStateDescriptor.attachmentsState[0];
        return translateColorState(attachmentState, format);
    }).filter((v) => {
        // FIREFOX does not support holes in targets array.
        return v !== null;
    });
}

function translateCompareMode(compareMode: GfxCompareMode): GPUCompareFunction {
    if (compareMode === GfxCompareMode.Never)
        return 'never';
    else if (compareMode === GfxCompareMode.Less)
        return 'less';
    else if (compareMode === GfxCompareMode.Equal)
        return 'equal';
    else if (compareMode === GfxCompareMode.LessEqual)
        return 'less-equal';
    else if (compareMode === GfxCompareMode.Greater)
        return 'greater';
    else if (compareMode === GfxCompareMode.NotEqual)
        return 'not-equal';
    else if (compareMode === GfxCompareMode.GreaterEqual)
        return 'greater-equal';
    else if (compareMode === GfxCompareMode.Always)
        return 'always';
    else
        throw "whoops";
}

function translateDepthStencilState(format: GfxFormat | null, megaStateDescriptor: GfxMegaStateDescriptor): GPUDepthStencilState | undefined {
    if (format === null)
        return undefined;

    return {
        format: translateTextureFormat(format),
        depthWriteEnabled: megaStateDescriptor.depthWrite,
        depthCompare: translateCompareMode(megaStateDescriptor.depthCompare),
        depthBias: megaStateDescriptor.polygonOffset ? 1 : 0,
        depthBiasSlopeScale: megaStateDescriptor.polygonOffset ? 1 : 0,
        // TODO(jstpierre): Stencil
    };
}

function translateIndexFormat(format: GfxFormat | null): GPUIndexFormat | undefined {
    if (format === null)
        return undefined;
    else if (format === GfxFormat.U16_R)
        return 'uint16';
    else if (format === GfxFormat.U32_R)
        return 'uint32';
    else
        throw "whoops";
}

function translateVertexFormat(format: GfxFormat): GPUVertexFormat {
    if (format === GfxFormat.U8_R)
        return 'uint8x2';
    else if (format === GfxFormat.U8_RG)
        return 'uint8x2';
    else if (format === GfxFormat.U8_RGB)
        return 'uint8x4';
    else if (format === GfxFormat.U8_RGBA)
        return 'uint8x4';
    else if (format === GfxFormat.U8_RG_NORM)
        return 'unorm8x2';
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'unorm8x4';
    else if (format === GfxFormat.S8_RGB_NORM)
        return 'snorm8x4';
    else if (format === GfxFormat.S8_RGBA_NORM)
        return 'snorm8x4';
    else if (format === GfxFormat.U16_RG_NORM)
        return 'unorm16x2';
    else if (format === GfxFormat.U16_RGBA_NORM)
        return 'unorm16x4';
    else if (format === GfxFormat.S16_RG_NORM)
        return 'snorm16x2';
    else if (format === GfxFormat.S16_RGBA_NORM)
        return 'snorm16x4';
    else if (format === GfxFormat.S16_RG)
        return 'uint16x2';
    else if (format === GfxFormat.S16_RGBA)
        return 'uint16x4';
    else if (format === GfxFormat.F16_RG)
        return 'float16x2';
    else if (format === GfxFormat.F16_RGBA)
        return 'float16x4';
    else if (format === GfxFormat.F32_R)
        return 'float32';
    else if (format === GfxFormat.F32_RG)
        return 'float32x2';
    else if (format === GfxFormat.F32_RGB)
        return 'float32x3';
    else if (format === GfxFormat.F32_RGBA)
        return 'float32x4';
    else
        throw "whoops";
}

function translateQueryPoolType(type: GfxQueryPoolType): GPUQueryType {
    if (type === GfxQueryPoolType.OcclusionConservative)
        return 'occlusion';
    else
        throw "whoops";
}

function translateSampleType(type: GfxSamplerFormatKind): GPUTextureSampleType {
    if (type === GfxSamplerFormatKind.Float)
        return 'float';
    else if (type === GfxSamplerFormatKind.UnfilterableFloat)
        return 'unfilterable-float';
    else if (type === GfxSamplerFormatKind.Depth)
        return 'depth';
    else
        throw "whoops";
}

function translateBindGroupTextureBinding(sampler: GfxBindingLayoutSamplerDescriptor): GPUTextureBindingLayout {
    return {
        sampleType: translateSampleType(sampler.formatKind),
        viewDimension: translateViewDimension(sampler.dimension),
    };
}

function translateBindGroupSamplerBinding(sampler: GfxBindingLayoutSamplerDescriptor): GPUSamplerBindingLayout {
    if (sampler.formatKind === GfxSamplerFormatKind.Depth && sampler.comparison)
        return { type: "comparison" };
    else if (sampler.formatKind === GfxSamplerFormatKind.Float)
        return { type: "filtering" };
    else
        return { type: "non-filtering" };
}

class GfxRenderPassP_WebGPU implements GfxRenderPass {
    public descriptor!: GfxRenderPassDescriptor;
    public occlusionQueryPool: GfxQueryPoolP_WebGPU | null = null;
    private gpuRenderPassEncoder: GPURenderPassEncoder | null = null;
    private gpuRenderPassDescriptor: GPURenderPassDescriptor;
    private gpuColorAttachments: (GPURenderPassColorAttachment | null)[];
    private gpuDepthStencilAttachment: GPURenderPassDepthStencilAttachment;
    private gfxColorAttachment: (GfxTextureSharedP_WebGPU | null)[] = [];
    private gfxColorAttachmentView: (GfxRenderAttachmentView | null)[] = [];
    private gfxColorResolveTo: (GfxTextureSharedP_WebGPU | null)[] = [];
    private gfxColorResolveToView: (GfxRenderAttachmentView | null)[] = [];
    private gfxDepthStencilAttachment: GfxTextureSharedP_WebGPU | null = null;
    private gfxDepthStencilResolveTo: GfxTextureSharedP_WebGPU | null = null;
    private frameCommandEncoder: GPUCommandEncoder | null;

    constructor() {
        this.gpuColorAttachments = [];

        this.gpuDepthStencilAttachment = {
            view: null!,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            stencilLoadOp: 'load',
            stencilStoreOp: 'store',
        };

        this.gpuRenderPassDescriptor = {
            colorAttachments: this.gpuColorAttachments,
            depthStencilAttachment: this.gpuDepthStencilAttachment,
        };
    }

    private getTextureView(target: GfxTextureSharedP_WebGPU, view: GfxRenderAttachmentView): GPUTextureView {
        const level = view.level, z = view.z;
        assert(level < target.numLevels);
        assert(z < target.depthOrArrayLayers);
        if (target.numLevels === 1 && target.depthOrArrayLayers === 1)
            return target.gpuTextureView;
        else
            return target.gpuTexture.createView({ baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: z, arrayLayerCount: 1 });
    }

    private setRenderPassDescriptor(descriptor: GfxRenderPassDescriptor): void {
        this.descriptor = descriptor;

        this.gpuRenderPassDescriptor.colorAttachments = this.gpuColorAttachments;

        const numColorAttachments = descriptor.colorAttachments.length;
        this.gfxColorAttachment.length = numColorAttachments;
        this.gfxColorResolveTo.length = numColorAttachments;
        this.gpuColorAttachments.length = 0;
        for (let i = 0; i < descriptor.colorAttachments.length; i++) {
            const passAttachment = descriptor.colorAttachments[i];

            if (passAttachment !== null) {
                const attachment = passAttachment.renderTarget as GfxRenderTargetP_WebGPU;
                const resolveTo = passAttachment.resolveTo as GfxTextureP_WebGPU | null;

                this.gfxColorAttachment[i] = attachment;
                this.gfxColorAttachmentView[i] = passAttachment.view;
                this.gfxColorResolveTo[i] = resolveTo;
                this.gfxColorResolveToView[i] = passAttachment.resolveView;

                this.gpuColorAttachments.length = i;

                if (!this.gpuColorAttachments[i])
                    this.gpuColorAttachments[i] = {} as GPURenderPassColorAttachment;

                const dstAttachment = this.gpuColorAttachments[i]!;
                dstAttachment.view = this.getTextureView(attachment, passAttachment.view);
                const clearColor = passAttachment.clearColor;
                if (clearColor === 'load') {
                    dstAttachment.loadOp = 'load';
                } else {
                    dstAttachment.loadOp = 'clear';
                    dstAttachment.clearValue = clearColor;
                }
                dstAttachment.storeOp = passAttachment.store ? 'store' : 'discard';
                dstAttachment.resolveTarget = undefined;
                if (resolveTo !== null) {
                    if (attachment.sampleCount > 1)
                        dstAttachment.resolveTarget = this.getTextureView(resolveTo, assertExists(passAttachment.resolveView));
                    else
                        dstAttachment.storeOp = 'store';
                }
            } else {
                this.gfxColorAttachment[i] = null;
                this.gfxColorResolveTo[i] = null;
            }
        }

        {
            const passAttachment = descriptor.depthStencilAttachment;

            if (passAttachment !== null) {
                const attachment = passAttachment.renderTarget as GfxRenderTargetP_WebGPU;
                const resolveTo = passAttachment.resolveTo as GfxTextureP_WebGPU | null;

                this.gfxDepthStencilAttachment = attachment;
                this.gfxDepthStencilResolveTo = resolveTo;

                const dstAttachment = this.gpuDepthStencilAttachment;
                dstAttachment.view = attachment.gpuTextureView;

                const hasDepth = !!(getFormatFlags(attachment.pixelFormat) & FormatFlags.Depth);
                if (hasDepth) {
                    if (passAttachment.clearDepth === 'load') {
                        dstAttachment.depthLoadOp = 'load';
                    } else {
                        dstAttachment.depthLoadOp = 'clear';
                        dstAttachment.depthClearValue = passAttachment.clearDepth;
                    }

                    if (passAttachment.store || this.gfxDepthStencilResolveTo !== null)
                        dstAttachment.depthStoreOp = 'store';
                    else
                        dstAttachment.depthStoreOp = 'discard';
                } else {
                    dstAttachment.depthLoadOp = undefined;
                    dstAttachment.depthStoreOp = undefined;
                }

                const hasStencil = !!(getFormatFlags(attachment.pixelFormat) & FormatFlags.Stencil);
                if (hasStencil) {
                    if (passAttachment.clearStencil === 'load') {
                        dstAttachment.stencilLoadOp = 'load';
                    } else {
                        dstAttachment.stencilLoadOp = 'clear';
                        dstAttachment.stencilClearValue = passAttachment.clearStencil;
                    }

                    if (passAttachment.store || this.gfxDepthStencilResolveTo !== null)
                        dstAttachment.stencilStoreOp = 'store';
                    else
                        dstAttachment.stencilStoreOp = 'discard';
                } else {
                    dstAttachment.stencilLoadOp = undefined;
                    dstAttachment.stencilStoreOp = undefined;
                }

                this.gpuRenderPassDescriptor.depthStencilAttachment = this.gpuDepthStencilAttachment;
            } else {
                this.gfxDepthStencilAttachment = null;
                this.gfxDepthStencilResolveTo = null;
                this.gpuRenderPassDescriptor.depthStencilAttachment = undefined;
            }
        }

        this.occlusionQueryPool = descriptor.occlusionQueryPool as GfxQueryPoolP_WebGPU;
        if (this.occlusionQueryPool !== null) {
            this.occlusionQueryPool.cpuBuffer.unmap();
            this.occlusionQueryPool.results = null;
        }
        this.gpuRenderPassDescriptor.occlusionQuerySet = this.occlusionQueryPool !== null ? this.occlusionQueryPool.querySet : undefined;
    }

    public beginRenderPass(commandEncoder: GPUCommandEncoder, renderPassDescriptor: GfxRenderPassDescriptor): void {
        assert(this.gpuRenderPassEncoder === null);
        this.setRenderPassDescriptor(renderPassDescriptor);
        this.frameCommandEncoder = commandEncoder;
        this.gpuRenderPassEncoder = this.frameCommandEncoder.beginRenderPass(this.gpuRenderPassDescriptor);
    }

    public setViewport(x: number, y: number, w: number, h: number): void {
        this.gpuRenderPassEncoder!.setViewport(x, y, w, h, 0, 1);
    }

    public setScissor(x: number, y: number, w: number, h: number): void {
        this.gpuRenderPassEncoder!.setScissorRect(x, y, w, h);
    }

    public setPipeline(pipeline_: GfxRenderPipeline): void {
        const pipeline = pipeline_ as GfxRenderPipelineP_WebGPU;
        const gpuRenderPipeline = assertExists(pipeline.gpuRenderPipeline);
        this.gpuRenderPassEncoder!.setPipeline(gpuRenderPipeline);
    }

    public setVertexInput(inputLayout_: GfxInputLayout | null, vertexBuffers: (GfxVertexBufferDescriptor | null)[] | null, indexBuffer: GfxIndexBufferDescriptor | null): void {
        if (inputLayout_ === null)
            return;

        const inputLayout = inputLayout_ as GfxInputLayoutP_WebGPU;
        if (indexBuffer !== null)
            this.gpuRenderPassEncoder!.setIndexBuffer(getPlatformBuffer(indexBuffer.buffer), assertExists(inputLayout.indexFormat), indexBuffer.byteOffset);

        if (vertexBuffers !== null) {
            for (let i = 0; i < vertexBuffers.length; i++) {
                const b = vertexBuffers![i];
                if (b === null)
                    continue;
                this.gpuRenderPassEncoder!.setVertexBuffer(i, getPlatformBuffer(b.buffer), b.byteOffset);
            }
        }
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const bindings = bindings_ as GfxBindingsP_WebGPU;
        this.gpuRenderPassEncoder!.setBindGroup(bindingLayoutIndex, bindings.gpuBindGroup, dynamicByteOffsets);
    }

    public setStencilRef(ref: number): void {
        this.gpuRenderPassEncoder!.setStencilReference(ref);
    }

    public draw(vertexCount: number, firstVertex: number): void {
        this.gpuRenderPassEncoder!.draw(vertexCount, 1, firstVertex, 0);
    }

    public drawIndexed(indexCount: number, firstIndex: number): void {
        this.gpuRenderPassEncoder!.drawIndexed(indexCount, 1, firstIndex, 0, 0);
    }

    public drawIndexedInstanced(indexCount: number, firstIndex: number, instanceCount: number): void {
        this.gpuRenderPassEncoder!.drawIndexed(indexCount, instanceCount, firstIndex, 0, 0);
    }

    public beginOcclusionQuery(dstOffs: number): void {
        this.gpuRenderPassEncoder!.beginOcclusionQuery(dstOffs);
    }

    public endOcclusionQuery(): void {
        this.gpuRenderPassEncoder!.endOcclusionQuery();
    }

    public beginDebugGroup(name: string): void {
        this.gpuRenderPassEncoder!.pushDebugGroup(name);
    }

    public endDebugGroup(): void {
        this.gpuRenderPassEncoder!.popDebugGroup();
    }

    private copyAttachment(dst: GfxTextureSharedP_WebGPU, dstView: GfxRenderAttachmentView, src: GfxTextureSharedP_WebGPU, srcView: GfxRenderAttachmentView): void {
        assert(src.sampleCount === 1);
        const srcCopy: GPUImageCopyTexture = { texture: src.gpuTexture, mipLevel: srcView.level, origin: [0, 0, srcView.z] };
        const dstCopy: GPUImageCopyTexture = { texture: dst.gpuTexture, mipLevel: dstView.level, origin: [0, 0, dstView.z] };
        assert((src.width >>> srcView.level) === (dst.width >>> dstView.level));
        assert((src.height >>> srcView.level) === (dst.height >>> dstView.level));
        assert(!!(src.usage & GPUTextureUsage.COPY_SRC));
        assert(!!(dst.usage & GPUTextureUsage.COPY_DST));
        this.frameCommandEncoder!.copyTextureToTexture(srcCopy, dstCopy, [dst.width, dst.height, 1]);
    }

    public finish(): void {
        this.gpuRenderPassEncoder!.end();
        this.gpuRenderPassEncoder = null;

        // Fake a resolve with a copy for non-MSAA.
        for (let i = 0; i < this.gfxColorAttachment.length; i++) {
            const colorAttachment = this.gfxColorAttachment[i];
            const colorResolveTo = this.gfxColorResolveTo[i];
            if (colorAttachment !== null && colorResolveTo !== null && colorAttachment.sampleCount === 1)
                this.copyAttachment(colorResolveTo, assertExists(this.gfxColorAttachmentView[i]), colorAttachment, assertExists(this.gfxColorResolveToView[i]));
        }

        if (this.gfxDepthStencilAttachment !== null && this.gfxDepthStencilResolveTo !== null) {
            if (this.gfxDepthStencilAttachment.sampleCount > 1) {
                // TODO(jstpierre): MSAA depth resolve (requires shader)
            } else {
                this.copyAttachment(this.gfxDepthStencilResolveTo, { level: 0, z: 0 }, this.gfxDepthStencilAttachment, { level: 0, z: 0 });
            }
        }

        const queryPool = this.occlusionQueryPool;
        if (queryPool !== null) {
            this.frameCommandEncoder!.resolveQuerySet(queryPool.querySet, 0, queryPool.querySet.count, queryPool.resolveBuffer, 0);
            this.frameCommandEncoder!.copyBufferToBuffer(queryPool.resolveBuffer, 0, queryPool.cpuBuffer, 0, 8 * queryPool.querySet.count);
        }

        this.frameCommandEncoder = null;
    }
}


class GfxComputePassP_WebGPU implements GfxComputePass {
    private gpuComputePassEncoder: GPUComputePassEncoder | null = null;
    private frameCommandEncoder: GPUCommandEncoder | null;

    public beginRenderPass(commandEncoder: GPUCommandEncoder): void {
        assert(this.gpuComputePassEncoder === null);
        this.frameCommandEncoder = commandEncoder;
        this.gpuComputePassEncoder = this.frameCommandEncoder.beginComputePass();
    }

    public setPipeline(pipeline_: GfxComputePipeline): void {
        const pipeline = pipeline_ as GfxComputePipelineP_WebGPU;
        const gpuComputePipeline = assertExists(pipeline.gpuComputePipeline);
        this.gpuComputePassEncoder!.setPipeline(gpuComputePipeline);
    }

    public setBindings(bindingLayoutIndex: number, bindings_: any, dynamicByteOffsets: number[]): void {
        // TODO(jstpierre): Better bindings API
        this.gpuComputePassEncoder!.setBindGroup(bindingLayoutIndex + 0, bindings_, dynamicByteOffsets);
    }

    public dispatch(x: number, y: number, z: number): void {
        this.gpuComputePassEncoder!.dispatchWorkgroups(x, y, z);
    }

    public beginDebugGroup(name: string): void {
        this.gpuComputePassEncoder!.pushDebugGroup(name);
    }

    public endDebugGroup(): void {
        this.gpuComputePassEncoder!.popDebugGroup();
    }

    public finish(): void {
        this.gpuComputePassEncoder!.end();
        this.gpuComputePassEncoder = null;

        this.frameCommandEncoder = null;
    }
}

function isFormatTextureCompressionBC(format: GfxFormat): boolean {
    const formatTypeFlags = getFormatTypeFlags(format);

    switch (formatTypeFlags) {
        case FormatTypeFlags.BC1:
        case FormatTypeFlags.BC2:
        case FormatTypeFlags.BC3:
        case FormatTypeFlags.BC4_SNORM:
        case FormatTypeFlags.BC4_UNORM:
        case FormatTypeFlags.BC5_SNORM:
        case FormatTypeFlags.BC5_UNORM:
            return true;
    }

    return false;
}

function getFormatByteSizePerBlock(format: GfxFormat): number {
    const formatTypeFlags = getFormatTypeFlags(format);

    switch (formatTypeFlags) {
        case FormatTypeFlags.BC1:
        case FormatTypeFlags.BC4_SNORM:
        case FormatTypeFlags.BC4_UNORM:
            return 8;
        case FormatTypeFlags.BC2:
        case FormatTypeFlags.BC3:
        case FormatTypeFlags.BC5_SNORM:
        case FormatTypeFlags.BC5_UNORM:
            return 16;
    }

    return getFormatByteSize(format);
}

function getFormatBlockSize(format: GfxFormat): number {
    const formatTypeFlags = getFormatTypeFlags(format);

    switch (formatTypeFlags) {
        case FormatTypeFlags.BC1:
        case FormatTypeFlags.BC2:
        case FormatTypeFlags.BC3:
        case FormatTypeFlags.BC4_SNORM:
        case FormatTypeFlags.BC4_UNORM:
        case FormatTypeFlags.BC5_SNORM:
        case FormatTypeFlags.BC5_UNORM:
            return 4;
    }

    return 1;
}

function translateImageLayout(size: GPUExtent3DDictStrict, layout: GPUImageDataLayout, format: GfxFormat, mipWidth: number, mipHeight: number): void {
    const blockSize = getFormatBlockSize(format);

    size.width = align(mipWidth, blockSize);
    size.height = align(mipHeight, blockSize);

    const numBlocksX = (size.width / blockSize) | 0;
    const numBlocksY = (size.height / blockSize) | 0;

    layout.bytesPerRow = numBlocksX * getFormatByteSizePerBlock(format);
    layout.rowsPerImage = numBlocksY;
}

class GfxImplP_WebGPU implements GfxSwapChain, GfxDevice {
    private _swapChainWidth = 0;
    private _swapChainHeight = 0;
    private _swapChainFormat: GPUTextureFormat;
    private readonly _swapChainTextureUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
    private _resourceUniqueId: number = 0;

    // Fallback resources.
    private _fallbackTexture2D: GfxTextureP_WebGPU;
    private _fallbackTexture2DDepth: GfxTextureP_WebGPU;
    private _fallbackTexture2DArray: GfxTextureP_WebGPU;
    private _fallbackTexture3D: GfxTextureP_WebGPU;
    private _fallbackTextureCube: GfxTextureP_WebGPU;
    private _fallbackSamplerFiltering: GfxSampler;
    private _fallbackSamplerComparison: GfxSampler;

    private _renderPassPool: GfxRenderPassP_WebGPU[] = [];
    private _computePassPool: GfxComputePassP_WebGPU[] = [];
    private _featureTextureCompressionBC: boolean = false;

    private _bindGroupLayoutCache = new HashMap<GfxBindingLayoutDescriptor, GPUBindGroupLayout>(gfxBindingLayoutDescriptorEqual, nullHashFunc);

    private _frameCommandEncoder: GPUCommandEncoder | null = null;
    private _readbacksSubmitted: GfxReadbackP_WebGPU[] = [];
    private _queryPoolsSubmitted: GfxQueryPoolP_WebGPU[] = [];

    // GfxVendorInfo
    public readonly platformString: string = 'WebGPU';
    public readonly glslVersion = `#version 440`;
    public readonly explicitBindingLocations = true;
    public readonly separateSamplerTextures = true;
    public readonly viewportOrigin = GfxViewportOrigin.UpperLeft;
    public readonly clipSpaceNearZ = GfxClipSpaceNearZ.Zero;

    public static readonly optionalFeatures: GPUFeatureName[] = [
        'depth32float-stencil8',
        'texture-compression-bc',
    ];

    constructor(public adapter: GPUAdapter, public device: GPUDevice, private canvas: HTMLCanvasElement | OffscreenCanvas, private canvasContext: GPUCanvasContext, private glsl_compile: typeof glsl_compile_) {
        this._fallbackTexture2D = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Float);
        this._fallbackTexture2DDepth = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Depth);
        this._fallbackTexture2DArray = this.createFallbackTexture(GfxTextureDimension.n2DArray, GfxSamplerFormatKind.Float);
        this._fallbackTexture3D = this.createFallbackTexture(GfxTextureDimension.n3D, GfxSamplerFormatKind.Float);
        this._fallbackTextureCube = this.createFallbackTexture(GfxTextureDimension.Cube, GfxSamplerFormatKind.Float);

        this._fallbackSamplerFiltering = this.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
        });
        this.setResourceName(this._fallbackSamplerFiltering, 'Fallback Sampler Filtering');

        this._fallbackSamplerComparison = this.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            compareMode: GfxCompareMode.Always,
        });
        this.setResourceName(this._fallbackSamplerFiltering, 'Fallback Sampler Comparison');

        this._featureTextureCompressionBC = this.device.features.has('texture-compression-bc');

        this.device.onuncapturederror = (event) => {
            console.error(event.error);
            // debugger;
        };

        this._swapChainFormat = navigator.gpu.getPreferredCanvasFormat();

        this.canvasContext.configure({ device: this.device, format: this._swapChainFormat, usage: this._swapChainTextureUsage, alphaMode: 'opaque' });
    }

    private createFallbackTexture(dimension: GfxTextureDimension, formatKind: GfxSamplerFormatKind): GfxTextureP_WebGPU {
        const depth = dimension === GfxTextureDimension.Cube ? 6 : 1;
        const pixelFormat = formatKind === GfxSamplerFormatKind.Float ? GfxFormat.U8_RGBA_NORM : GfxFormat.D24;
        return this.createTexture({
            dimension, pixelFormat, usage: GfxTextureUsage.Sampled,
            width: 1, height: 1, depthOrArrayLayers: depth, numLevels: 1,
        }) as GfxTextureP_WebGPU;
    }

    // GfxSwapChain
    public configureSwapChain(width: number, height: number): void {
        this._swapChainWidth = width;
        this._swapChainHeight = height;
    }

    public getOnscreenTexture(): GfxTexture {
        // TODO(jstpierre): Figure out how to wrap more efficiently.
        const gpuTexture = this.canvasContext.getCurrentTexture();
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = {
            _T: _T.Texture, ResourceUniqueId: 0,
            gpuTexture, gpuTextureView,
            pixelFormat: GfxFormat.U8_RGBA_RT,
            width: this._swapChainWidth,
            height: this._swapChainHeight,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: this._swapChainTextureUsage,
            sampleCount: 1,
            dimension: GfxTextureDimension.n2D,
        };
        return texture;
    }

    public getDevice(): GfxDevice {
        return this;
    }

    public getCanvas(): HTMLCanvasElement | OffscreenCanvas {
        return this.canvas;
    }

    // GfxDevice
    private getNextUniqueId(): number {
        return ++this._resourceUniqueId;
    }

    public createBuffer(wordCount: number, usage_: GfxBufferUsage, hint: GfxBufferFrequencyHint, initialData?: Uint8Array): GfxBuffer {
        let usage = translateBufferUsage(usage_);
        const size = wordCount * 4;
        const gpuBuffer = this.device.createBuffer({ usage, size, mappedAtCreation: initialData !== undefined });

        if (initialData !== undefined) {
            const dst = new Uint8Array(gpuBuffer.getMappedRange());
            dst.set(initialData);
            gpuBuffer.unmap();
        }

        const buffer: GfxBufferP_WebGPU = { _T: _T.Buffer, ResourceUniqueId: this.getNextUniqueId(), gpuBuffer, size };
        return buffer;
    }

    private createTextureShared(descriptor: GfxTextureSharedDescriptor): GfxTextureSharedP_WebGPU {
        const size: GPUExtent3D = {
            width: descriptor.width,
            height: descriptor.height,
            depthOrArrayLayers: descriptor.depthOrArrayLayers,
        };
        const mipLevelCount = descriptor.numLevels;
        const format = translateTextureFormat(descriptor.pixelFormat);
        const dimension = translateTextureDimension(descriptor.dimension);
        const usage = translateTextureUsage(descriptor.usage);

        const gpuTexture = this.device.createTexture({ size, mipLevelCount, format, dimension, usage });
        const gpuTextureView = gpuTexture.createView({
            dimension: translateViewDimension(descriptor.dimension),
        });
        const texture: GfxTextureSharedP_WebGPU = {
            pixelFormat: descriptor.pixelFormat,
            width: descriptor.width,
            height: descriptor.height,
            depthOrArrayLayers: descriptor.depthOrArrayLayers,
            numLevels: mipLevelCount,
            usage,
            sampleCount: 1,
            gpuTexture, gpuTextureView,
            dimension: descriptor.dimension,
        };
        return texture;
    }

    public createTexture(descriptor: GfxTextureDescriptor): GfxTexture {
        const texture = this.createTextureShared({
            pixelFormat: descriptor.pixelFormat,
            dimension: descriptor.dimension,
            width: descriptor.width,
            height: descriptor.height,
            depthOrArrayLayers: descriptor.depthOrArrayLayers,
            numLevels: descriptor.numLevels,
            usage: descriptor.usage,
            sampleCount: 1,
        });
        return { _T: _T.Texture, ResourceUniqueId: this.getNextUniqueId(), ...texture };
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        const lodMinClamp = descriptor.minLOD;
        const lodMaxClamp = descriptor.mipFilter === GfxMipFilterMode.NoMip ? descriptor.minLOD : descriptor.maxLOD;

        let maxAnisotropy = descriptor.maxAnisotropy ?? 1;
        if (maxAnisotropy > 1)
            assert(descriptor.minFilter === GfxTexFilterMode.Bilinear && descriptor.magFilter === GfxTexFilterMode.Bilinear && descriptor.mipFilter === GfxMipFilterMode.Linear);

        const gpuSampler = this.device.createSampler({
            addressModeU: translateWrapMode(descriptor.wrapS),
            addressModeV: translateWrapMode(descriptor.wrapT),
            addressModeW: translateWrapMode(descriptor.wrapQ ?? descriptor.wrapS),
            lodMinClamp,
            lodMaxClamp,
            minFilter: translateMinMagFilter(descriptor.minFilter),
            magFilter: translateMinMagFilter(descriptor.magFilter),
            mipmapFilter: translateMipFilter(descriptor.mipFilter),
            compare: descriptor.compareMode !== undefined ? translateCompareMode(descriptor.compareMode) : undefined,
            maxAnisotropy,
        });

        const sampler: GfxSamplerP_WebGPU = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gpuSampler };
        return sampler;
    }

    public createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTargetP_WebGPU {
        const texture = this.createTextureShared({
            pixelFormat: descriptor.pixelFormat,
            dimension: GfxTextureDimension.n2D,
            width: descriptor.width,
            height: descriptor.height,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: GfxTextureUsage.RenderTarget,
            sampleCount: descriptor.sampleCount,
        });
        return { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(), ...texture, ownsTexture: true };
    }

    public createRenderTargetFromTexture(gfxTexture: GfxTexture): GfxRenderTargetP_WebGPU {
        const { pixelFormat, width, height, depthOrArrayLayers, sampleCount, numLevels, gpuTexture, gpuTextureView, usage, dimension } = gfxTexture as GfxTextureP_WebGPU;
        assert(!!(usage & GPUTextureUsage.RENDER_ATTACHMENT));
        const attachment: GfxRenderTargetP_WebGPU = {
            _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            pixelFormat, width, height, depthOrArrayLayers, sampleCount, numLevels, usage, dimension,
            gpuTexture, gpuTextureView, ownsTexture: false,
        };
        return attachment;
    }

    private _createShaderStageGLSL(sourceText: string, shaderStage: 'vertex' | 'fragment' | 'compute'): GPUProgrammableStage {
        const validationEnabled = false;

        let code: string;
        try {
            code = this.glsl_compile(sourceText, shaderStage, validationEnabled);
        } catch (e) {
            console.error(sourceText);
            throw "whoops";
        }

        const shaderModule = this.device.createShaderModule({ code });
        const stage = { module: shaderModule, entryPoint: 'main' };
        if (IS_DEVELOPMENT) {
            (stage as any).sourceText = sourceText;
            (stage as any).code = code;
        }
        return stage;
    }

    private _createShaderStage(sourceText: string, shaderStage: 'vertex' | 'fragment' | 'compute', shadingLanguage: GfxShadingLanguage): GPUProgrammableStage {
        if (shadingLanguage === GfxShadingLanguage.GLSL) {
            return this._createShaderStageGLSL(sourceText, shaderStage);
        } else {
            // by convention, entry point is named main
            const code = sourceText;
            const shaderModule = this.device.createShaderModule({ code });
            return { module: shaderModule, entryPoint: 'main' };
        }
    }

    public createProgram(descriptor: GfxRenderProgramDescriptor): GfxProgram {
        const vertexStage = this._createShaderStageGLSL(descriptor.preprocessedVert, 'vertex');
        const fragmentStage = descriptor.preprocessedFrag !== null ? this._createShaderStageGLSL(descriptor.preprocessedFrag, 'fragment') : null;
        const program: GfxProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor, vertexStage, fragmentStage, };
        return program;
    }

    public createComputeProgram(descriptor: GfxComputeProgramDescriptor): GfxProgram {
        const computeStage = this._createShaderStage(descriptor.preprocessedComp, 'compute', descriptor.shadingLanguage);
        const program: GfxComputeProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor, computeStage, };
        return program;
    }

    private _createBindGroupLayoutInternal(bindingLayout: GfxBindingLayoutDescriptor): GPUBindGroupLayout {
        const entries: GPUBindGroupLayoutEntry[] = [];

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            const samplerEntry = bindingLayout.samplerEntries !== undefined ? bindingLayout.samplerEntries[i] : defaultBindingLayoutSamplerDescriptor;
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: translateBindGroupTextureBinding(samplerEntry), });
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: translateBindGroupSamplerBinding(samplerEntry), });
        }

        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } });

        return this.device.createBindGroupLayout({ entries });
    }

    private _createBindGroupLayout(bindingLayout: GfxBindingLayoutDescriptor): GPUBindGroupLayout {
        let gpuBindGroupLayout = this._bindGroupLayoutCache.get(bindingLayout);
        if (gpuBindGroupLayout === null) {
            gpuBindGroupLayout = this._createBindGroupLayoutInternal(bindingLayout);
            this._bindGroupLayoutCache.add(bindingLayout, gpuBindGroupLayout);
        }
        return gpuBindGroupLayout;
    }

    private _getFallbackTexture(samplerEntry: GfxBindingLayoutSamplerDescriptor): GfxTexture {
        const dimension = samplerEntry.dimension, formatKind = samplerEntry.formatKind;
        if (dimension === GfxTextureDimension.n2D)
            return (formatKind === GfxSamplerFormatKind.Depth) ? this._fallbackTexture2DDepth : this._fallbackTexture2D;
        else if (dimension === GfxTextureDimension.n2DArray)
            return this._fallbackTexture2DArray;
        else if (dimension === GfxTextureDimension.n3D)
            return this._fallbackTexture3D;
        else if (dimension === GfxTextureDimension.Cube)
            return this._fallbackTextureCube;
        else
            throw "whoops";
    }

    private _getFallbackSampler(samplerEntry: GfxBindingLayoutSamplerDescriptor): GfxSampler {
        const formatKind = samplerEntry.formatKind;
        if (formatKind === GfxSamplerFormatKind.Depth && samplerEntry.comparison)
            return this._fallbackSamplerComparison;
        else
            return this._fallbackSamplerFiltering;
    }

    public createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings {
        const bindingLayout = bindingsDescriptor.bindingLayout;
        const bindGroupLayout = this._createBindGroupLayout(bindingLayout);

        const gpuBindGroupEntries: GPUBindGroupEntry[] = [];
        let numBindings = 0;

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            const samplerEntry = bindingLayout.samplerEntries !== undefined ? bindingLayout.samplerEntries[i] : defaultBindingLayoutSamplerDescriptor;

            const gfxBinding = bindingsDescriptor.samplerBindings[i];
            const gfxTexture = (gfxBinding.gfxTexture !== null ? gfxBinding.gfxTexture : this._getFallbackTexture(samplerEntry)) as GfxTextureP_WebGPU;
            assert(samplerEntry.dimension === gfxTexture.dimension);
            const formatKind = getFormatSamplerKind(gfxTexture.pixelFormat);
            assert(isFormatSamplerKindCompatible(samplerEntry.formatKind, formatKind));
            const gpuTextureView = (gfxTexture as GfxTextureP_WebGPU).gpuTextureView;
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuTextureView });

            const gfxSampler = gfxBinding.gfxSampler !== null ? gfxBinding.gfxSampler : this._getFallbackSampler(samplerEntry);
            const gpuSampler = getPlatformSampler(gfxSampler);
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuSampler });
        }

        // numBindings = 0;
        for (let i = 0; i < bindingLayout.numUniformBuffers; i++) {
            const gfxBinding = bindingsDescriptor.uniformBufferBindings[i];
            assert(gfxBinding.wordCount > 0);
            const gpuBufferBinding: GPUBufferBinding = {
                buffer: getPlatformBuffer(gfxBinding.buffer),
                offset: 0,
                size: gfxBinding.wordCount << 2,
            };
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuBufferBinding });
        }

        const gpuBindGroup = this.device.createBindGroup({ layout: bindGroupLayout, entries: gpuBindGroupEntries });
        const bindings: GfxBindingsP_WebGPU = { _T: _T.Bindings, ResourceUniqueId: this._resourceUniqueId, bindingLayout: bindingsDescriptor.bindingLayout, bindGroupLayout, gpuBindGroup };
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        const buffers: GPUVertexBufferLayout[] = [];
        for (let i = 0; i < inputLayoutDescriptor.vertexAttributeDescriptors.length; i++) {
            const attr = inputLayoutDescriptor.vertexAttributeDescriptors[i];

            const attribute: GPUVertexAttribute = {
                shaderLocation: attr.location,
                format: translateVertexFormat(attr.format),
                offset: attr.bufferByteOffset,
            };

            if (buffers[attr.bufferIndex] !== undefined) {
                (buffers[attr.bufferIndex].attributes as GPUVertexAttribute[]).push(attribute);
            } else {
                const b = assertExists(inputLayoutDescriptor.vertexBufferDescriptors[attr.bufferIndex]);
                const arrayStride = b.frequency === GfxVertexBufferFrequency.Constant ? 0 : b.byteStride;
                const stepMode: GPUVertexStepMode = b.frequency === GfxVertexBufferFrequency.PerInstance ? 'instance' : 'vertex';
                const attributes: GPUVertexAttribute[] = [attribute];
                buffers[attr.bufferIndex] = { arrayStride, stepMode, attributes };
            }
        }

        const indexFormat = translateIndexFormat(inputLayoutDescriptor.indexBufferFormat);

        const inputLayout: GfxInputLayoutP_WebGPU = { _T: _T.InputLayout, ResourceUniqueId: this.getNextUniqueId(), buffers, indexFormat };
        return inputLayout;
    }

    private _createPipelineLayout(bindingLayouts: GfxBindingLayoutDescriptor[]): GPUPipelineLayout {
        const bindGroupLayouts = bindingLayouts.map((bindingLayout) => this._createBindGroupLayout(bindingLayout));
        return this.device.createPipelineLayout({ bindGroupLayouts });
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const gpuRenderPipeline: GPURenderPipeline | null = null;
        const isCreatingAsync = false;
        const renderPipeline: GfxRenderPipelineP_WebGPU = {
            _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(),
            descriptor, isCreatingAsync, gpuRenderPipeline,
        };
        this._createRenderPipeline(renderPipeline, true);
        return renderPipeline;
    }

    private async _createRenderPipeline(renderPipeline: GfxRenderPipelineP_WebGPU, async: boolean): Promise<void> {
        // If we're already in the process of creating a the pipeline async, no need to kick the process off again...
        if (async && renderPipeline.isCreatingAsync)
            return;

        if (renderPipeline.gpuRenderPipeline !== null)
            return;

        const descriptor = renderPipeline.descriptor;
        const program = descriptor.program as GfxProgramP_WebGPU;

        const vertexStage = assertExists(program.vertexStage), fragmentStage = program.fragmentStage;
        const layout = this._createPipelineLayout(descriptor.bindingLayouts);
        const primitive = translatePrimitiveState(descriptor.topology, descriptor.megaStateDescriptor);
        const targets = translateTargets(descriptor.colorAttachmentFormats, descriptor.megaStateDescriptor);
        const depthStencil = translateDepthStencilState(descriptor.depthStencilAttachmentFormat, descriptor.megaStateDescriptor);

        let buffers: GPUVertexBufferLayout[] | undefined = undefined;
        if (descriptor.inputLayout !== null)
            buffers = (descriptor.inputLayout as GfxInputLayoutP_WebGPU).buffers;
        const sampleCount = descriptor.sampleCount;

        renderPipeline.isCreatingAsync = true;

        let fragment: GPUFragmentState | undefined = undefined;
        if (fragmentStage !== null) {
            fragment = {
                ...fragmentStage,
                targets,
            };
        }

        const gpuRenderPipelineDescriptor: GPURenderPipelineDescriptor = {
            layout,
            vertex: {
                ...vertexStage,
                buffers,
            },
            primitive,
            depthStencil,
            multisample: {
                count: sampleCount,
            },
            fragment,
        };

        if (async) {
            const gpuRenderPipeline = await this.device.createRenderPipelineAsync(gpuRenderPipelineDescriptor);

            // We might have created a sync pipeline while we were async building; no way to cancel the async
            // pipeline build at this point, so just chuck it out :/
            if (renderPipeline.gpuRenderPipeline === null)
                renderPipeline.gpuRenderPipeline = gpuRenderPipeline;
        } else {
            renderPipeline.gpuRenderPipeline = this.device.createRenderPipeline(gpuRenderPipelineDescriptor);
        }

        if (renderPipeline.ResourceName !== undefined)
            renderPipeline.gpuRenderPipeline.label = renderPipeline.ResourceName;

        renderPipeline.isCreatingAsync = false;
    }

    public createComputePipeline(descriptor: GfxComputePipelineDescriptor): GfxComputePipeline {
        const gpuComputePipeline: GPUComputePipeline | null = null;
        const isCreatingAsync = false;
        const computePipeline: GfxComputePipelineP_WebGPU = {
            _T: _T.ComputePipeline, ResourceUniqueId: this.getNextUniqueId(),
            descriptor, isCreatingAsync, gpuComputePipeline,
        };
        this._createComputePipeline(computePipeline, true);
        return computePipeline;
    }

    private async _createComputePipeline(computePipeline: GfxComputePipelineP_WebGPU, async: boolean): Promise<void> {
        // If we're already in the process of creating a the pipeline async, no need to kick the process off again...
        if (async && computePipeline.isCreatingAsync)
            return;

        if (computePipeline.gpuComputePipeline !== null)
            return;

        const descriptor = computePipeline.descriptor;
        const program = descriptor.program as GfxComputeProgramP_WebGPU;
        
        const layout = descriptor.pipelineLayout as GPUPipelineLayout;
        const compute = program.computeStage!;

        computePipeline.isCreatingAsync = true;

        const gpuComputePipelineDescriptor: GPUComputePipelineDescriptor = {
            layout,
            compute,
        };

        if (async) {
            const gpuComputePipeline = await this.device.createComputePipelineAsync(gpuComputePipelineDescriptor);

            // We might have created a sync pipeline while we were async building; no way to cancel the async
            // pipeline build at this point, so just chuck it out :/
            if (computePipeline.gpuComputePipeline === null)
                computePipeline.gpuComputePipeline = gpuComputePipeline;
        } else {
            computePipeline.gpuComputePipeline = this.device.createComputePipeline(gpuComputePipelineDescriptor);
        }

        if (computePipeline.ResourceName !== undefined)
            computePipeline.gpuComputePipeline.label = computePipeline.ResourceName;

        computePipeline.isCreatingAsync = false;
    }

    public createReadback(byteCount: number): GfxReadback {
        const o: GfxReadbackP_WebGPU = {
            _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId(),
            cpuBuffer: this.device.createBuffer({ size: byteCount, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
            done: false, destroyed: false,
        };
        return o;
    }

    public createQueryPool(type: GfxQueryPoolType, elemCount: number): GfxQueryPool {
        const querySet = this.device.createQuerySet({
            type: translateQueryPoolType(type),
            count: elemCount,
        });
        const o: GfxQueryPoolP_WebGPU = {
            _T: _T.QueryPool, ResourceUniqueId: this.getNextUniqueId(),
            querySet,
            resolveBuffer: this.device.createBuffer({ size: elemCount * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
            cpuBuffer: this.device.createBuffer({ size: elemCount * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
            results: null,
            destroyed: false,
        };
        return o;
    }

    public createWebXRLayer(webXRSession: XRSession): Promise<XRWebGLLayer> {
        // There is currently no way to use WebGPU with WebXR.
        // This method should never be called.
        throw "createWebXRLayer not implemented on WebGPU";
    }

    public destroyBuffer(o: GfxBuffer): void {
        getPlatformBuffer(o).destroy();
    }

    public destroyTexture(o: GfxTexture): void {
        const texture = o as GfxTextureP_WebGPU;
        texture.gpuTexture.destroy();
    }

    public destroySampler(o: GfxSampler): void {
    }

    public destroyRenderTarget(o: GfxRenderTarget): void {
        const renderTarget = o as GfxRenderTargetP_WebGPU;
        if (renderTarget.ownsTexture)
            renderTarget.gpuTexture.destroy();
    }

    public destroyProgram(o: GfxProgram): void {
    }

    public destroyBindings(o: GfxBindings): void {
    }

    public destroyInputLayout(o: GfxInputLayout): void {
    }

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
    }

    public destroyComputePipeline(o: GfxComputePipeline): void {
    }

    public destroyReadback(o: GfxReadback): void {
        const readback = o as GfxReadbackP_WebGPU;
        if (readback.cpuBuffer.mapState === 'pending')
            readback.destroyed = true;
        else
            readback.cpuBuffer.destroy();
    }

    public destroyQueryPool(o: GfxQueryPool): void {
        const queryPool = o as GfxQueryPoolP_WebGPU;
        queryPool.querySet.destroy();
        queryPool.resolveBuffer.destroy();
        if (queryPool.cpuBuffer.mapState === 'pending')
            queryPool.destroyed = true;
        else
            queryPool.cpuBuffer.destroy();
    }

    public pipelineQueryReady(o: GfxRenderPipeline): boolean {
        const renderPipeline = o as GfxRenderPipelineP_WebGPU;
        return renderPipeline.gpuRenderPipeline !== null;
    }

    public pipelineForceReady(o: GfxRenderPipeline): void {
        const renderPipeline = o as GfxRenderPipelineP_WebGPU;
        this._createRenderPipeline(renderPipeline, false);
    }

    public createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        let pass = this._renderPassPool.pop();
        if (pass === undefined)
            pass = new GfxRenderPassP_WebGPU();
        pass.beginRenderPass(this._frameCommandEncoder!, renderPassDescriptor);
        return pass;
    }

    public createComputePass(): GfxComputePass {
        let pass = this._computePassPool.pop();
        if (pass === undefined)
            pass = new GfxComputePassP_WebGPU();
        pass.beginRenderPass(this._frameCommandEncoder!);
        return pass;
    }

    public submitPass(o: GfxPass): void {
        if (o instanceof GfxRenderPassP_WebGPU) {
            const pass = o as GfxRenderPassP_WebGPU;
            pass.finish();
            this._renderPassPool.push(pass);

            if (pass.occlusionQueryPool !== null)
                this._queryPoolsSubmitted.push(pass.occlusionQueryPool);
        } else if (o instanceof GfxComputePassP_WebGPU) {
            const pass = o as GfxComputePassP_WebGPU;
            pass.finish();
            this._computePassPool.push(pass);
        }
    }

    public beginFrame(): void {
        assert(this._frameCommandEncoder === null);
        this._frameCommandEncoder = this.device.createCommandEncoder();
    }

    public endFrame(): void {
        assert(this._frameCommandEncoder !== null);

        this.device.queue.submit([this._frameCommandEncoder.finish()]);
        this._frameCommandEncoder = null;

        // Do any post-command-submit scheduling work

        for (let i = 0; i < this._readbacksSubmitted.length; i++) {
            const readback = this._readbacksSubmitted[i];
            readback.cpuBuffer.mapAsync(GPUMapMode.READ).then(() => {
                readback.done = true;

                if (readback.destroyed)
                    readback.cpuBuffer.destroy();
            });
        }
        this._readbacksSubmitted.length = 0;

        for (let i = 0; i < this._queryPoolsSubmitted.length; i++) {
            const queryPool = this._queryPoolsSubmitted[i];
            queryPool.cpuBuffer.mapAsync(GPUMapMode.READ).then(() => {
                queryPool.results = new BigUint64Array(queryPool.cpuBuffer.getMappedRange());

                if (queryPool.destroyed)
                    queryPool.cpuBuffer.destroy();
            });
        }
        this._queryPoolsSubmitted.length = 0;
    }

    public copySubTexture2D(dst_: GfxTexture, dstX: number, dstY: number, src_: GfxTexture, srcX: number, srcY: number): void {
        const dst = dst_ as GfxTextureP_WebGPU;
        const src = src_ as GfxTextureP_WebGPU;
        const srcCopy: GPUImageCopyTexture = { texture: src.gpuTexture, origin: [srcX, srcY, 0] };
        const dstCopy: GPUImageCopyTexture = { texture: dst.gpuTexture, origin: [dstX, dstY, 0] };
        assert(!!(src.usage & GPUTextureUsage.COPY_SRC));
        assert(!!(dst.usage & GPUTextureUsage.COPY_DST));
        this._frameCommandEncoder!.copyTextureToTexture(srcCopy, dstCopy, [src.width, src.height, 1]);
    }

    public zeroBuffer(buffer: GfxBuffer, dstByteOffset: number, byteCount: number): void {
        this._frameCommandEncoder!.clearBuffer(getPlatformBuffer(buffer), dstByteOffset, byteCount);
    }

    public uploadBufferData(buffer: GfxBuffer, dstByteOffset: number, data: Uint8Array, srcByteOffset?: number, byteCount?: number): void {
        if (byteCount === undefined)
            byteCount = data.byteLength;
        if (srcByteOffset === undefined)
            srcByteOffset = 0;

        if (byteCount % 4 !== 0) {
            // copy data (should probably pass this back to clients... this sucks!!!)
            const oldData = data.subarray(srcByteOffset, byteCount);
            byteCount = align(byteCount, 4);
            data = new Uint8Array(byteCount);
            data.set(oldData);
        }
        assert(data.byteLength - srcByteOffset >= byteCount);

        this.device.queue.writeBuffer(getPlatformBuffer(buffer), dstByteOffset, data, srcByteOffset, byteCount);
    }

    public uploadTextureData(texture_: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void {
        const texture = texture_ as GfxTextureP_WebGPU;
        const destination: GPUImageCopyTexture = {
            texture: texture.gpuTexture,
        };
        const layout: GPUImageDataLayout = {};
        const size: GPUExtent3DStrict = { width: 0, height: 0, depthOrArrayLayers: texture.depthOrArrayLayers };

        for (let i = 0; i < levelDatas.length; i++) {
            const mipLevel = firstMipLevel + i;
            destination.mipLevel = mipLevel;

            const mipWidth = texture.width >>> mipLevel;
            const mipHeight = texture.height >>> mipLevel;

            translateImageLayout(size, layout, texture.pixelFormat, mipWidth, mipHeight);
            this.device.queue.writeTexture(destination, levelDatas[i], layout, size);
        }
    }

    public readBuffer(o: GfxReadback, dstOffset: number, buffer_: GfxBuffer, srcOffset: number, byteSize: number): void {
        const readback = o as GfxReadbackP_WebGPU;
        const buffer = buffer_ as GfxBufferP_WebGPU;
        this._frameCommandEncoder!.copyBufferToBuffer(buffer.gpuBuffer, srcOffset, readback.cpuBuffer, dstOffset, byteSize);
    }

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, texture_: GfxTexture, x: number, y: number): void {
        const readback = o as GfxReadbackP_WebGPU;
        const texture = texture_ as GfxTextureP_WebGPU;
        const formatByteSize = getFormatByteSize(texture.pixelFormat);
        const copySrc: GPUImageCopyTexture = { texture: texture.gpuTexture, origin: [x, y, 0] };
        const copyDst: GPUImageCopyBuffer = { buffer: readback.cpuBuffer, offset: dstOffset * formatByteSize };
        this._frameCommandEncoder!.copyTextureToBuffer(copySrc, copyDst, [1, 1, 1]);
    }

    public submitReadback(o: GfxReadback): void {
        const readback = o as GfxReadbackP_WebGPU;
        assert(!readback.done);
        this._readbacksSubmitted.push(readback);
    }

    public queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean {
        const readback = o as GfxReadbackP_WebGPU;
        if (readback.done) {
            const src = new Uint32Array(readback.cpuBuffer.getMappedRange());
            dst.set(src, dstOffs);

            // Reset the readback object.
            readback.cpuBuffer.unmap();
            readback.done = false;

            return true;
        } else {
            return false;
        }
    }

    public queryPoolResultOcclusion(o: GfxQueryPool, dstOffs: number): boolean | null {
        const queryPool = o as GfxQueryPoolP_WebGPU;
        if (queryPool.results === null)
            return null;
        return queryPool.results[dstOffs] !== BigInt(0);
    }

    public queryLimits(): GfxDeviceLimits {
        return {
            uniformBufferMaxPageWordSize: this.device.limits.maxUniformBufferBindingSize >>> 2,
            uniformBufferWordAlignment: this.device.limits.minUniformBufferOffsetAlignment >>> 2,
            supportedSampleCounts: [1],
            occlusionQueriesRecommended: true,
            computeShadersSupported: true,
            wireframeSupported: false,
        };
    }

    public queryTextureFormatSupported(format: GfxFormat, width: number, height: number): boolean {
        if (isFormatTextureCompressionBC(format)) {
            if (!this._featureTextureCompressionBC)
                return false;

            const bb = getFormatBlockSize(format);
            if ((width % bb) !== 0 || (height % bb) !== 0)
                return false;
            return this._featureTextureCompressionBC;
        }

        switch (format) {
        case GfxFormat.U16_RGB_565: return false;
        case GfxFormat.U16_RGBA_NORM: return false;
        case GfxFormat.F32_RGBA: return false; // unfilterable
        }

        return true;
    }

    public queryVendorInfo(): GfxVendorInfo {
        return this;
    }

    public queryRenderPass(o: GfxRenderPass): Readonly<GfxRenderPassDescriptor> {
        const pass = o as GfxRenderPassP_WebGPU;
        return pass.descriptor;
    }

    public queryRenderTarget(o: GfxRenderTarget): Readonly<GfxRenderTargetDescriptor> {
        const attachment = o as GfxRenderTargetP_WebGPU;
        return attachment;
    }

    public setResourceName(o: GfxResource, s: string): void {
        o.ResourceName = s;

        if (o._T === _T.Buffer) {
            const r = o as GfxBufferP_WebGPU;
            r.gpuBuffer.label = s;
        } else if (o._T === _T.Texture) {
            const r = o as GfxTextureP_WebGPU;
            r.gpuTexture.label = s;
            r.gpuTextureView.label = s;
        } else if (o._T === _T.RenderTarget) {
            const r = o as GfxRenderTargetP_WebGPU;
            r.gpuTexture.label = s;
            r.gpuTextureView.label = s;
        } else if (o._T === _T.Sampler) {
            const r = o as GfxSamplerP_WebGPU;
            r.gpuSampler.label = s;
        } else if (o._T === _T.RenderPipeline) {
            const r = o as GfxRenderPipelineP_WebGPU;
            if (r.gpuRenderPipeline !== null)
                r.gpuRenderPipeline.label = s;
        } else if (o._T === _T.QueryPool) {
            const r = o as GfxQueryPoolP_WebGPU;
            r.querySet.label = `${s} QuerySet`;
            r.resolveBuffer.label = `${s} Resolve Buffer`;
            r.cpuBuffer.label = `${s} CPU Buffer`;
        } else if (o._T === _T.Program) {
            const r = o as GfxProgramP_WebGPU;
            if (r.vertexStage !== null)
                r.vertexStage.module.label = s;
            if (r.fragmentStage !== null)
                r.fragmentStage.module.label = s;
        }
    }

    public setResourceLeakCheck(o: GfxResource, v: boolean): void {
    }

    public checkForLeaks(): void {
    }

    public programPatched(o: GfxProgram): void {
    }

    public pushStatisticsGroup(statisticsGroup: GfxStatisticsGroup): void {
    }

    public popStatisticsGroup(): void {
    }
}

export async function createSwapChainForWebGPU(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<GfxSwapChain | null> {
    if (navigator.gpu === undefined)
        return null;

    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null)
        return null;

    const requiredFeatures = GfxImplP_WebGPU.optionalFeatures.filter((feature) => adapter.features.has(feature));

    const device = await adapter.requestDevice({ requiredFeatures });
    if (device === null)
        return null;

    const context = canvas.getContext('webgpu');
    if (!context)
        return null;

    return new GfxImplP_WebGPU(adapter, device, canvas, context, rust.glsl_compile);
}

export function gfxDeviceGetImpl_WebGPU(gfxDevice: GfxDevice): GfxImplP_WebGPU {
    return gfxDevice as GfxImplP_WebGPU;
}
