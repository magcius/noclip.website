
import { GfxSwapChain, GfxDevice, GfxTexture, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingsDescriptor, GfxTextureDescriptor, GfxSamplerDescriptor, GfxInputLayoutDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxInputState, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxSampler, GfxProgram, GfxBindings, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxDebugGroup, GfxPass, GfxRenderPassDescriptor, GfxRenderPass, GfxDeviceLimits, GfxFormat, GfxVendorInfo, GfxTextureDimension, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxAttachmentState, GfxChannelBlendState, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxVertexBufferFrequency, GfxIndexBufferDescriptor, GfxProgramDescriptor, GfxProgramDescriptorSimple, GfxRenderTarget, GfxRenderTargetDescriptor, makeTextureDescriptor2D, GfxClipSpaceNearZ, GfxTextureUsage, GfxViewportOrigin, GfxQueryPoolType, GfxBindingLayoutSamplerDescriptor, GfxSamplerFormatKind } from "./GfxPlatform";
import { _T, GfxResource, GfxReadback, GfxQueryPool, defaultBindingLayoutSamplerDescriptor } from "./GfxPlatformImpl";
import { assertExists, assert, align, gfxBindingLayoutDescriptorEqual } from "./GfxPlatformUtil";
import { FormatTypeFlags, getFormatTypeFlags, getFormatByteSize, getFormatSamplerKind, FormatFlags, getFormatFlags } from "./GfxPlatformFormat";
import { HashMap, nullHashFunc } from "../../HashMap";
import type { glsl_compile as glsl_compile_ } from "../../../rust/pkg/index";

interface GfxBufferP_WebGPU extends GfxBuffer {
    gpuBuffer: GPUBuffer;
    size: number;
}

interface GfxTextureSharedDescriptor {
    dimension: GfxTextureDimension;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    depthOrArrayLayers: number;
    numLevels: number;
    sampleCount: number;
    usage: GfxTextureUsage;
}

interface GfxTextureSharedP_WebGPU {
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    depthOrArrayLayers: number;
    numLevels: number;
    sampleCount: number;
    usage: GPUTextureUsageFlags;
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
    dimension: GfxTextureDimension;
}

interface GfxTextureP_WebGPU extends GfxTextureSharedP_WebGPU, GfxTexture {
}

interface GfxAttachmentP_WebGPU extends GfxTextureSharedP_WebGPU, GfxRenderTarget {
}

interface GfxSamplerP_WebGPU extends GfxSampler {
    gpuSampler: GPUSampler;
}

interface GfxProgramP_WebGPU extends GfxProgram {
    descriptor: GfxProgramDescriptorSimple;
    vertexStage: GPUProgrammableStage | null;
    fragmentStage: GPUProgrammableStage | null;
}

interface BindGroupLayout {
    gpuBindGroupLayout: GPUBindGroupLayout[];
}

interface GfxBindingsP_WebGPU extends GfxBindings {
    bindingLayout: GfxBindingLayoutDescriptor;
    bindGroupLayout: BindGroupLayout;
    gpuBindGroup: GPUBindGroup[];
}

interface GfxInputLayoutP_WebGPU extends GfxInputLayout {
    buffers: GPUVertexBufferLayout[];
    indexFormat: GPUIndexFormat | undefined;
}

interface GfxInputStateP_WebGPU extends GfxInputState {
    inputLayout: GfxInputLayout;
    vertexBuffers: (GfxVertexBufferDescriptor | null)[];
    indexBuffer: GfxIndexBufferDescriptor | null;
}

interface GfxRenderPipelineP_WebGPU extends GfxRenderPipeline {
    descriptor: GfxRenderPipelineDescriptor;
    gpuRenderPipeline: GPURenderPipeline | null;
    isCreatingAsync: boolean;
}

interface GfxReadbackP_WebGPU extends GfxReadback {
    gpuResultBuffer: GPUBuffer;
    done: boolean;
}

interface GfxQueryPoolP_WebGPU extends GfxQueryPool {
    querySet: GPUQuerySet;
}

function translateBufferUsage(usage: GfxBufferUsage): GPUBufferUsageFlags {
    if (usage === GfxBufferUsage.Index)
        return GPUBufferUsage.INDEX;
    else if (usage === GfxBufferUsage.Vertex)
        return GPUBufferUsage.VERTEX;
    else if (usage === GfxBufferUsage.Uniform)
        return GPUBufferUsage.UNIFORM;
    else
        throw "whoops";
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
    else if (format === GfxFormat.U32_R)
        return 'r32uint';
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

function getPlatformQuerySet(queryPool_: GfxQueryPool): GPUQuerySet {
    const queryPool = queryPool_ as GfxQueryPoolP_WebGPU;
    return queryPool.querySet;
}

function translateTopology(topology: GfxPrimitiveTopology): GPUPrimitiveTopology {
    if (topology === GfxPrimitiveTopology.Triangles)
        return 'triangle-list';
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

function translateTargets(colorAttachmentFormats: (GfxFormat | null)[], megaStateDescriptor: GfxMegaStateDescriptor): GPUColorTargetState[] {
    return megaStateDescriptor.attachmentsState!.map((attachmentState, i) => {
        return translateColorState(attachmentState, colorAttachmentFormats[i]!);
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

function translateVertexBufferFrequency(frequency: GfxVertexBufferFrequency): GPUVertexStepMode {
    if (frequency === GfxVertexBufferFrequency.PerVertex)
        return 'vertex';
    else if (frequency === GfxVertexBufferFrequency.PerInstance)
        return 'instance';
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
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'unorm8x4';
    else if (format === GfxFormat.S8_RGB_NORM)
        return 'snorm8x4';
    else if (format === GfxFormat.S8_RGBA_NORM)
        return 'snorm8x4';
    else if (format === GfxFormat.S16_RG)
        return 'uint16x2';
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

class GfxRenderPassP_WebGPU implements GfxRenderPass {
    public descriptor!: GfxRenderPassDescriptor;
    private gpuRenderPassEncoder: GPURenderPassEncoder | null = null;
    private gpuRenderPassDescriptor: GPURenderPassDescriptor;
    private gpuColorAttachments: GPURenderPassColorAttachment[];
    private gpuDepthStencilAttachment: GPURenderPassDepthStencilAttachment;
    private gfxColorAttachment: (GfxTextureSharedP_WebGPU | null)[] = [];
    private gfxColorResolveTo: (GfxTextureSharedP_WebGPU | null)[] = [];
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

    private setRenderPassDescriptor(descriptor: GfxRenderPassDescriptor): void {
        this.descriptor = descriptor;

        this.gpuRenderPassDescriptor.colorAttachments = this.gpuColorAttachments;

        const numColorAttachments = descriptor.colorAttachment.length;
        this.gfxColorAttachment.length = numColorAttachments;
        this.gfxColorResolveTo.length = numColorAttachments;
        for (let i = 0; i < descriptor.colorAttachment.length; i++) {
            let colorAttachment: GfxTextureSharedP_WebGPU | null = descriptor.colorAttachment[i] as GfxAttachmentP_WebGPU;
            let colorResolveTo: GfxTextureSharedP_WebGPU | null = descriptor.colorResolveTo[i] as GfxTextureP_WebGPU;

            // Do some dumb juggling...
            if (colorAttachment === null && colorResolveTo !== null) {
                colorAttachment = colorResolveTo as GfxTextureP_WebGPU;
                colorResolveTo = null;
            }

            this.gfxColorAttachment[i] = colorAttachment;
            this.gfxColorResolveTo[i] = colorResolveTo;

            if (colorAttachment !== null) {
                if (this.gpuColorAttachments[i] === undefined)
                    this.gpuColorAttachments[i] = {} as GPURenderPassColorAttachment;

                const dstAttachment = this.gpuColorAttachments[i];
                dstAttachment.view = colorAttachment.gpuTextureView;
                const clearColor = descriptor.colorClearColor[i];
                if (clearColor === 'load') {
                    dstAttachment.loadOp = 'load';
                } else {
                    dstAttachment.loadOp = 'clear';
                    dstAttachment.clearValue = clearColor;
                }
                dstAttachment.storeOp = descriptor.colorStore[i] ? 'store' : 'discard';
                dstAttachment.resolveTarget = undefined;
                if (colorResolveTo !== null) {
                    if (colorAttachment.sampleCount > 1)
                        dstAttachment.resolveTarget = colorResolveTo.gpuTextureView;
                    else
                        dstAttachment.storeOp = 'store';
                }
            } else {
                // TODO(jstpierre): Figure out what to do with no sparse attachments.
                // https://github.com/gpuweb/gpuweb/issues/1250
                this.gpuColorAttachments.length = i;
                this.gfxColorAttachment.length = i;
                this.gfxColorResolveTo.length = i;
                break;
            }
        }

        this.gfxDepthStencilAttachment = descriptor.depthStencilAttachment as GfxAttachmentP_WebGPU;
        this.gfxDepthStencilResolveTo = descriptor.depthStencilResolveTo as GfxTextureP_WebGPU;

        if (descriptor.depthStencilAttachment !== null) {
            const dsAttachment = descriptor.depthStencilAttachment as GfxAttachmentP_WebGPU;
            const dstAttachment = this.gpuDepthStencilAttachment;
            dstAttachment.view = dsAttachment.gpuTextureView;

            const hasDepth = !!(getFormatFlags(dsAttachment.pixelFormat) & FormatFlags.Depth);
            if (hasDepth) {
                if (descriptor.depthClearValue === 'load') {
                    dstAttachment.depthLoadOp = 'load';
                } else {
                    dstAttachment.depthLoadOp = 'clear';
                    dstAttachment.depthClearValue = descriptor.depthClearValue;
                }

                if (descriptor.depthStencilStore || this.gfxDepthStencilResolveTo !== null)
                    dstAttachment.depthStoreOp = 'store';
                else
                    dstAttachment.depthStoreOp = 'discard';
            } else {
                dstAttachment.depthLoadOp = undefined;
                dstAttachment.depthStoreOp = undefined;
            }

            const hasStencil = !!(getFormatFlags(dsAttachment.pixelFormat) & FormatFlags.Stencil);
            if (hasStencil) {
                if (descriptor.stencilClearValue === 'load') {
                    dstAttachment.stencilLoadOp = 'load';
                } else {
                    dstAttachment.stencilLoadOp = 'clear';
                    dstAttachment.stencilClearValue = descriptor.stencilClearValue;
                }

                if (descriptor.depthStencilStore || this.gfxDepthStencilResolveTo !== null)
                    dstAttachment.stencilStoreOp = 'store';
                else
                    dstAttachment.stencilStoreOp = 'discard';
            } else {
                dstAttachment.stencilLoadOp = undefined;
                dstAttachment.stencilStoreOp = undefined;
            }

            this.gpuRenderPassDescriptor.depthStencilAttachment = this.gpuDepthStencilAttachment;
        } else {
            this.gpuRenderPassDescriptor.depthStencilAttachment = undefined;
        }

        this.gpuRenderPassDescriptor.occlusionQuerySet = descriptor.occlusionQueryPool !== null ? getPlatformQuerySet(descriptor.occlusionQueryPool) : undefined;
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

    public setInputState(inputState_: GfxInputState | null): void {
        if (inputState_ === null)
            return;

        const inputState = inputState_ as GfxInputStateP_WebGPU;
        if (inputState.indexBuffer !== null) {
            const inputLayout = inputState.inputLayout as GfxInputLayoutP_WebGPU;
            const indexBuffer = inputState.indexBuffer;
            this.gpuRenderPassEncoder!.setIndexBuffer(getPlatformBuffer(indexBuffer.buffer), assertExists(inputLayout.indexFormat), indexBuffer.byteOffset);
        }

        for (let i = 0; i < inputState.vertexBuffers.length; i++) {
            const b = inputState.vertexBuffers[i];
            if (b === null)
                continue;
            this.gpuRenderPassEncoder!.setVertexBuffer(i, getPlatformBuffer(b.buffer), b.byteOffset);
        }
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const bindings = bindings_ as GfxBindingsP_WebGPU;
        this.gpuRenderPassEncoder!.setBindGroup(bindingLayoutIndex + 0, bindings.gpuBindGroup[0], dynamicByteOffsets.slice(0, bindings.bindingLayout.numUniformBuffers));
        this.gpuRenderPassEncoder!.setBindGroup(bindingLayoutIndex + 1, bindings.gpuBindGroup[1]);
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

    public endOcclusionQuery(dstOffs: number): void {
        this.gpuRenderPassEncoder!.endOcclusionQuery();
    }

    public beginDebugGroup(name: string): void {
        // FIREFOX MISSING
        if (this.gpuRenderPassEncoder!.pushDebugGroup === undefined)
            return;

        this.gpuRenderPassEncoder!.pushDebugGroup(name);
    }

    public endDebugGroup(): void {
        // FIREFOX MISSING
        if (this.gpuRenderPassEncoder!.popDebugGroup === undefined)
            return;

        this.gpuRenderPassEncoder!.popDebugGroup();
    }

    private copyAttachment(dst: GfxTextureSharedP_WebGPU, src: GfxTextureSharedP_WebGPU): void {
        assert(src.sampleCount === 1);
        const srcCopy: GPUImageCopyTexture = { texture: src.gpuTexture };
        const dstCopy: GPUImageCopyTexture = { texture: dst.gpuTexture };
        assert(src.width === dst.width);
        assert(src.height === dst.height);
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
                this.copyAttachment(colorResolveTo, colorAttachment);
        }

        if (this.gfxDepthStencilAttachment !== null && this.gfxDepthStencilResolveTo !== null) {
            if (this.gfxDepthStencilAttachment.sampleCount > 1) {
                // TODO(jstpierre): MSAA depth resolve (requires shader)
            } else {
                this.copyAttachment(this.gfxDepthStencilResolveTo, this.gfxDepthStencilAttachment);
            }
        }

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

const fullscreenVS = `
struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
};

@stage(vertex)
fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
    var out: VertexOutput;
    out.pos.x = select(-1.0, 3.0, index == 1u);
    out.pos.y = select(-1.0, 3.0, index == 2u);
    out.pos.z = 1.0;
    out.pos.w = 1.0;
    return out;
}
`;

// Hack for now until browsers implement compositingAlphaMode
// https://bugs.chromium.org/p/chromium/issues/detail?id=1241373
class FullscreenAlphaClear {
    private shaderModule: GPUShaderModule;
    private pipeline: GPURenderPipeline;

    private shaderText = `
${fullscreenVS}

struct FragmentOutput { @location(0) color: vec4<f32>, };

@stage(fragment)
fn fs() -> FragmentOutput {
    return FragmentOutput(vec4<f32>(1.0, 0.0, 1.0, 1.0));
}
`;

    constructor(device: GPUDevice, format: GPUTextureFormat) {
        this.shaderModule = device.createShaderModule({ code: this.shaderText });
        this.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: this.shaderModule, entryPoint: 'vs', },
            fragment: { module: this.shaderModule, entryPoint: 'fs', targets: [{ format, writeMask: 0x08, }] },
        });
    }

    public render(encoder: GPUCommandEncoder, onscreenTexture: GPUTextureView): void {
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{ view: onscreenTexture, loadOp: 'load', storeOp: 'store', }],
        });
        renderPass.setPipeline(this.pipeline);
        renderPass.draw(3);
        renderPass.end();
    }

    public destroy(device: GPUDevice): void {
    }
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
    private _fallbackSampler: GfxSampler;

    private _renderPassPool: GfxRenderPassP_WebGPU[] = [];
    private _featureTextureCompressionBC: boolean = false;

    private _bindGroupLayoutCache = new HashMap<GfxBindingLayoutDescriptor, BindGroupLayout>(gfxBindingLayoutDescriptorEqual, nullHashFunc);

    private _fullscreenAlphaClear: FullscreenAlphaClear;
    private _frameCommandEncoder: GPUCommandEncoder | null = null;
    private _readbacksSubmitted: GfxReadbackP_WebGPU[] = [];

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

    constructor(private adapter: GPUAdapter, private device: GPUDevice, private canvas: HTMLCanvasElement | OffscreenCanvas, private canvasContext: GPUCanvasContext, private glsl_compile: typeof glsl_compile_) {
        this._fallbackTexture2D = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Float);
        this._fallbackTexture2DDepth = this.createFallbackTexture(GfxTextureDimension.n2D, GfxSamplerFormatKind.Depth);
        this._fallbackTexture2DArray = this.createFallbackTexture(GfxTextureDimension.n2DArray, GfxSamplerFormatKind.Float);
        this._fallbackTexture3D = this.createFallbackTexture(GfxTextureDimension.n3D, GfxSamplerFormatKind.Float);
        this._fallbackTextureCube = this.createFallbackTexture(GfxTextureDimension.Cube, GfxSamplerFormatKind.Float);

        this._fallbackSampler = this.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
        });

        // FIREFOX MISSING
        if (this.device.features)
            this._featureTextureCompressionBC = this.device.features.has('texture-compression-bc');

        this.device.onuncapturederror = (event) => {
            console.error(event.error);
            debugger;
        };

        this._swapChainFormat = navigator.gpu.getPreferredCanvasFormat();
        this._fullscreenAlphaClear = new FullscreenAlphaClear(this.device, this._swapChainFormat);

        this.canvasContext.configure({ device: this.device, format: this._swapChainFormat, usage: this._swapChainTextureUsage, compositingAlphaMode: 'opaque' });
    }

    private createFallbackTexture(dimension: GfxTextureDimension, formatKind: GfxSamplerFormatKind): GfxTextureP_WebGPU {
        const depth = dimension === GfxTextureDimension.Cube ? 6 : 1;
        const pixelFormat = formatKind === GfxSamplerFormatKind.Float ? GfxFormat.U8_RGBA_NORM : GfxFormat.D24;
        return this.createTexture({
            dimension, pixelFormat, usage: GfxTextureUsage.Sampled,
            width: 1, height: 1, depth, numLevels: 1,
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

    public createBuffer(wordCount: number, usage_: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer {
        let usage = translateBufferUsage(usage_);
        usage |= GPUBufferUsage.COPY_DST;
        const size = wordCount * 4;
        const gpuBuffer = this.device.createBuffer({ usage, size });
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
            depthOrArrayLayers: descriptor.depth,
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
            // TODO(jstpierre): Expose this as a sampler parameter.
            addressModeW: translateWrapMode(descriptor.wrapQ ?? descriptor.wrapS),
            lodMinClamp,
            lodMaxClamp,
            minFilter: translateMinMagFilter(descriptor.minFilter),
            magFilter: translateMinMagFilter(descriptor.magFilter),
            mipmapFilter: translateMipFilter(descriptor.mipFilter),
            maxAnisotropy,
        });

        const sampler: GfxSamplerP_WebGPU = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gpuSampler };
        return sampler;
    }

    public createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTarget {
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
        return { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(), ...texture };
    }

    public createRenderTargetFromTexture(gfxTexture: GfxTexture): GfxRenderTarget {
        const { pixelFormat, width, height, depthOrArrayLayers, sampleCount, numLevels, gpuTexture, gpuTextureView, usage } = gfxTexture as GfxTextureP_WebGPU;
        assert(!!(usage & GPUTextureUsage.RENDER_ATTACHMENT));
        const attachment: GfxAttachmentP_WebGPU = {
            _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            pixelFormat, width, height, depthOrArrayLayers, sampleCount, numLevels,
            usage, gpuTexture, gpuTextureView,
            dimension: GfxTextureDimension.n2D,
        };
        return attachment;
    }

    private _createShaderStage(sourceText: string, shaderStage: 'vertex' | 'fragment'): GPUProgrammableStage {
        const validationEnabled = false;

        let code: string;
        try {
            code = this.glsl_compile(sourceText, shaderStage, validationEnabled);
        } catch (e) {
            console.error(sourceText);
            throw "whoops";
        }

        // Workaround for https://github.com/gfx-rs/naga/issues/1355
        for (const depthTextureName of ['u_TextureFramebufferDepth']) {
            if (!code.includes(depthTextureName)) continue;

            code = code.replace(`var T_${depthTextureName}: texture_2d<f32>;`, `var T_${depthTextureName}: texture_depth_2d;`);
            code = code.replace(new RegExp(`textureSample\\\(T_${depthTextureName}(.*)\\\);$`, 'gm'), (sub, cap) => {
                return `vec4<f32>(textureSample(T_${depthTextureName}${cap}), 0.0, 0.0, 0.0);`
            });
        }

        // Workaround for https://bugs.chromium.org/p/tint/issues/detail?id=1503
        code = code.replace('@vertex', '@stage(vertex)');
        code = code.replace('@fragment', '@stage(fragment)');

        const shaderModule = this.device.createShaderModule({ code });
        return { module: shaderModule, entryPoint: 'main' };
    }

    public createProgramSimple(descriptor: GfxProgramDescriptorSimple): GfxProgram {
        const vertexStage = this._createShaderStage(descriptor.preprocessedVert, 'vertex');
        const fragmentStage = descriptor.preprocessedFrag !== null ? this._createShaderStage(descriptor.preprocessedFrag, 'fragment') : null;
        const program: GfxProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor, vertexStage, fragmentStage, };
        return program;
    }

    public createProgram(descriptor: GfxProgramDescriptor): GfxProgram {
        descriptor.ensurePreprocessed(this);
        return this.createProgramSimple(descriptor);
    }

    private _createBindGroupLayoutInternal(bindingLayout: GfxBindingLayoutDescriptor): BindGroupLayout {
        const entries: GPUBindGroupLayoutEntry[][] = [[], []];

        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            entries[0].push({ binding: entries[0].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } });

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            const samplerEntry = bindingLayout.samplerEntries !== undefined ? bindingLayout.samplerEntries[i] : defaultBindingLayoutSamplerDescriptor;
            entries[1].push({ binding: entries[1].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: translateBindGroupTextureBinding(samplerEntry), });
            entries[1].push({ binding: entries[1].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
        }

        const gpuBindGroupLayout = entries.map((entries) => this.device.createBindGroupLayout({ entries }));
        return { gpuBindGroupLayout };
    }

    private _createBindGroupLayout(bindingLayout: GfxBindingLayoutDescriptor): BindGroupLayout {
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
            return formatKind === GfxSamplerFormatKind.Depth ? this._fallbackTexture2DDepth : this._fallbackTexture2D;
        else if (dimension === GfxTextureDimension.n2DArray)
            return this._fallbackTexture2DArray;
        else if (dimension === GfxTextureDimension.n3D)
            return this._fallbackTexture3D;
        else if (dimension === GfxTextureDimension.Cube)
            return this._fallbackTextureCube;
        else
            throw "whoops";
    }

    public createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings {
        const bindingLayout = bindingsDescriptor.bindingLayout;
        const bindGroupLayout = this._createBindGroupLayout(bindingLayout);

        const gpuBindGroupEntries: GPUBindGroupEntry[][] = [[], []];
        let numBindings = 0;
        for (let i = 0; i < bindingLayout.numUniformBuffers; i++) {
            const gfxBinding = bindingsDescriptor.uniformBufferBindings[i];
            assert(gfxBinding.wordCount > 0);
            const gpuBufferBinding: GPUBufferBinding = {
                buffer: getPlatformBuffer(gfxBinding.buffer),
                offset: 0,
                size: gfxBinding.wordCount << 2,
            };
            gpuBindGroupEntries[0].push({ binding: numBindings++, resource: gpuBufferBinding });
        }

        numBindings = 0;
        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            const samplerEntry = bindingLayout.samplerEntries !== undefined ? bindingLayout.samplerEntries[i] : defaultBindingLayoutSamplerDescriptor;

            const gfxBinding = bindingsDescriptor.samplerBindings[i];
            const gfxTexture = gfxBinding.gfxTexture !== null ? gfxBinding.gfxTexture : this._getFallbackTexture(samplerEntry);
            assert(samplerEntry.dimension === (gfxTexture as GfxTextureP_WebGPU).dimension);
            assert(samplerEntry.formatKind === getFormatSamplerKind((gfxTexture as GfxTextureP_WebGPU).pixelFormat));
            const gpuTextureView = (gfxTexture as GfxTextureP_WebGPU).gpuTextureView;
            gpuBindGroupEntries[1].push({ binding: numBindings++, resource: gpuTextureView });

            const gfxSampler = gfxBinding.gfxSampler !== null ? gfxBinding.gfxSampler : this._fallbackSampler;
            const gpuSampler = getPlatformSampler(gfxSampler);
            gpuBindGroupEntries[1].push({ binding: numBindings++, resource: gpuSampler });
        }

        const gpuBindGroup = gpuBindGroupEntries.map((gpuBindGroupEntries, i) => this.device.createBindGroup({ layout: bindGroupLayout.gpuBindGroupLayout[i], entries: gpuBindGroupEntries }));
        const bindings: GfxBindingsP_WebGPU = { _T: _T.Bindings, ResourceUniqueId: this._resourceUniqueId, bindingLayout: bindingsDescriptor.bindingLayout, bindGroupLayout, gpuBindGroup };
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        // GfxInputLayout is not a platform object, it's a descriptor in WebGPU.

        const buffers: GPUVertexBufferLayout[] = [];
        for (let i = 0; i < inputLayoutDescriptor.vertexBufferDescriptors.length; i++) {
            const b = inputLayoutDescriptor.vertexBufferDescriptors[i];
            if (b === null)
                continue;
            const arrayStride = b.byteStride;
            const stepMode = translateVertexBufferFrequency(b.frequency);
            const attributes: GPUVertexAttribute[] = [];
            buffers[i] = { arrayStride, stepMode, attributes };
        }

        for (let i = 0; i < inputLayoutDescriptor.vertexAttributeDescriptors.length; i++) {
            const attr = inputLayoutDescriptor.vertexAttributeDescriptors[i];
            const b = assertExists(buffers[attr.bufferIndex]);
            const attribute: GPUVertexAttribute = {
                shaderLocation: attr.location,
                format: translateVertexFormat(attr.format),
                offset: attr.bufferByteOffset,
            };
            (b.attributes as GPUVertexAttribute[]).push(attribute);
        }

        const indexFormat = translateIndexFormat(inputLayoutDescriptor.indexBufferFormat);

        const inputLayout: GfxInputLayoutP_WebGPU = { _T: _T.InputLayout, ResourceUniqueId: this.getNextUniqueId(), buffers, indexFormat };
        return inputLayout;
    }

    public createInputState(inputLayout: GfxInputLayout, vertexBuffers: (GfxVertexBufferDescriptor | null)[], indexBuffer: GfxIndexBufferDescriptor | null): GfxInputState {
        // GfxInputState is a GL-only thing, as VAOs suck. We emulate it with a VAO-alike here.
        const inputState: GfxInputStateP_WebGPU = {
            _T: _T.InputState, ResourceUniqueId: this.getNextUniqueId(),
            inputLayout, vertexBuffers, indexBuffer,
        };
        return inputState;
    }

    private _createPipelineLayout(bindingLayouts: GfxBindingLayoutDescriptor[]): GPUPipelineLayout {
        const bindGroupLayouts = bindingLayouts.flatMap((bindingLayout) => this._createBindGroupLayout(bindingLayout).gpuBindGroupLayout);
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
        // FIREFOX MISSING
        if (this.device.createRenderPipelineAsync === undefined)
            async = false;

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

    public createReadback(byteCount: number): GfxReadback {
        const o: GfxReadbackP_WebGPU = {
            _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId(),
            gpuResultBuffer: this.device.createBuffer({ size: byteCount, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
            done: false,
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
        const attachment = o as GfxAttachmentP_WebGPU;
        attachment.gpuTexture.destroy();
    }

    public destroyProgram(o: GfxProgram): void {
    }

    public destroyBindings(o: GfxBindings): void {
    }

    public destroyInputLayout(o: GfxInputLayout): void {
    }

    public destroyInputState(o: GfxInputState): void {
    }

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
    }

    public destroyReadback(o: GfxReadback): void {
        const readback = o as GfxReadbackP_WebGPU;
        readback.gpuResultBuffer.destroy();
    }

    public destroyQueryPool(o: GfxQueryPool): void {
        getPlatformQuerySet(o).destroy();
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

    public submitPass(o: GfxPass): void {
        if (o instanceof GfxRenderPassP_WebGPU) {
            const pass = o as GfxRenderPassP_WebGPU;
            pass.finish();
            this._renderPassPool.push(pass);
        }
    }

    public beginFrame(): void {
        assert(this._frameCommandEncoder === null);
        this._frameCommandEncoder = this.device.createCommandEncoder();
    }

    public endFrame(): void {
        assert(this._frameCommandEncoder !== null);

        this._fullscreenAlphaClear.render(this._frameCommandEncoder, this.canvasContext.getCurrentTexture().createView());
        this.device.queue.submit([this._frameCommandEncoder.finish()]);
        this._frameCommandEncoder = null;

        // Do any post-command-submit scheduling work
        for (let i = 0; i < this._readbacksSubmitted.length; i++) {
            const readback = this._readbacksSubmitted[i];
            readback.gpuResultBuffer.mapAsync(GPUMapMode.READ).then(() => {
                readback.done = true;
            });
        }
        this._readbacksSubmitted.length = 0;
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

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, texture_: GfxTexture, x: number, y: number): void {
        const readback = o as GfxReadbackP_WebGPU;
        const texture = (texture_ as GfxTextureP_WebGPU);
        const formatByteSize = getFormatByteSize(texture.pixelFormat);
        const copySrc: GPUImageCopyTexture = { texture: texture.gpuTexture, origin: [x, y, 0] };
        const copyDst: GPUImageCopyBuffer = { buffer: readback.gpuResultBuffer, offset: dstOffset * formatByteSize };
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
            const src = new Uint32Array(readback.gpuResultBuffer.getMappedRange());
            dst.set(src, dstOffs);

            // Reset the readback object.
            readback.gpuResultBuffer.unmap();
            readback.done = false;

            return true;
        } else {
            return false;
        }
    }

    public queryPoolResultOcclusion(o: GfxQueryPool, dstOffs: number): boolean | null {
        return true;
    }

    public queryLimits(): GfxDeviceLimits {
        // TODO(jstpierre): GPULimits
        return {
            uniformBufferMaxPageWordSize: 0x1000,
            uniformBufferWordAlignment: 0x40,
            supportedSampleCounts: [1],
            occlusionQueriesRecommended: false,
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
        case GfxFormat.U16_RGBA_NORM: return false;
        case GfxFormat.F32_RGBA: return false; // unfilterable
        }

        return true;
    }

    public queryPlatformAvailable(): boolean {
        // TODO(jstpierre): Listen to the lost event?
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
        const attachment = o as GfxAttachmentP_WebGPU;
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
            const r = o as GfxAttachmentP_WebGPU;
            r.gpuTexture.label = s;
            r.gpuTextureView.label = s;
        } else if (o._T === _T.Sampler) {
            const r = o as GfxSamplerP_WebGPU;
            r.gpuSampler.label = s;
        } else if (o._T === _T.RenderPipeline) {
            const r = o as GfxRenderPipelineP_WebGPU;
            if (r.gpuRenderPipeline !== null)
                r.gpuRenderPipeline.label = s;
        }
    }

    public setResourceLeakCheck(o: GfxResource, v: boolean): void {
    }

    public checkForLeaks(): void {
    }

    public programPatched(o: GfxProgram): void {
    }

    public pushDebugGroup(debugGroup: GfxDebugGroup): void {
    }

    public popDebugGroup(): void {
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

    const context = canvas.getContext('webgpu') as any as GPUCanvasContext;

    if (!context)
        return null;

    const { glsl_compile } = await import('../../../rust/pkg/index');
    return new GfxImplP_WebGPU(adapter, device, canvas, context, glsl_compile);
}
