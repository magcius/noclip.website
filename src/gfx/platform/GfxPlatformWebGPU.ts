
import { GfxSwapChain, GfxDevice, GfxTexture, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingsDescriptor, GfxTextureDescriptor, GfxSamplerDescriptor, GfxInputLayoutDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxInputState, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxSampler, GfxProgram, GfxBindings, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxDebugGroup, GfxPass, GfxRenderPassDescriptor, GfxRenderPass, GfxDeviceLimits, GfxFormat, GfxVendorInfo, GfxTextureDimension, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxAttachmentState, GfxChannelBlendState, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxVertexBufferFrequency, GfxIndexBufferDescriptor, GfxProgramDescriptor, GfxProgramDescriptorSimple, GfxRenderTarget, GfxRenderTargetDescriptor, makeTextureDescriptor2D, GfxClipSpaceNearZ, GfxTextureUsage } from "./GfxPlatform";
import { _T, GfxResource, GfxReadback } from "./GfxPlatformImpl";
import { assertExists, assert, leftPad, align } from "./GfxPlatformUtil";
import glslang, { ShaderStage, Glslang } from '../../vendor/glslang/glslang';
import { FormatTypeFlags, getFormatTypeFlags, getFormatByteSize } from "./GfxPlatformFormat";

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

interface GfxBindingsP_WebGPU extends GfxBindings {
    bindingLayout: GfxBindingLayoutDescriptor;
    gpuBindGroupLayout: GPUBindGroupLayout[];
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
    isCreating: boolean;
    gpuRenderPipeline: GPURenderPipeline | null;
}

interface GfxReadbackP_WebGPU extends GfxReadback {
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
    if (format === GfxFormat.U8_RGBA_RT)
        return 'bgra8unorm';
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'rgba8unorm';
    else if (format === GfxFormat.U8_RG_NORM)
        return 'rg8unorm';
    else if (format === GfxFormat.U32_R)
        return 'r32uint';
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
    else if (dimension === GfxTextureDimension.Cube)
        return '3d';
    else if (dimension === GfxTextureDimension.n2DArray)
        return '3d';
    else if (dimension === GfxTextureDimension.n3D)
        return '3d';
    else
        throw "whoops";
}

function translateTextureUsage(usage: GfxTextureUsage): GPUTextureUsageFlags {
    let gpuUsage: GPUTextureUsageFlags = 0;

    if (!!(usage & GfxTextureUsage.Sampled))
        gpuUsage |= GPUTextureUsage.SAMPLED | GPUTextureUsage.COPY_DST;
    if (!!(usage & GfxTextureUsage.RenderTarget))
        gpuUsage |= GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.SAMPLED | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

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

function translateBlendState(blendState: GfxChannelBlendState): GPUBlendComponent {
    return {
        operation: translateBlendMode(blendState.blendMode),
        srcFactor: translateBlendFactor(blendState.blendSrcFactor),
        dstFactor: translateBlendFactor(blendState.blendDstFactor),
    };
}

function translateColorState(attachmentState: GfxAttachmentState, format: GfxFormat): GPUColorTargetState {
    return { 
        format: translateTextureFormat(format),
        blend: {
            color: translateBlendState(attachmentState.rgbBlendState),
            alpha: translateBlendState(attachmentState.alphaBlendState),
        },
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

function translateVertexBufferFrequency(frequency: GfxVertexBufferFrequency): GPUInputStepMode {
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

class GfxRenderPassP_WebGPU implements GfxRenderPass {
    public commandEncoder: GPUCommandEncoder | null = null;
    public descriptor: GfxRenderPassDescriptor;
    private renderPassEncoder: GPURenderPassEncoder | null = null;
    private renderPassDescriptor: GPURenderPassDescriptor;
    private colorAttachments: GPURenderPassColorAttachmentNew[];
    private depthStencilAttachment: GPURenderPassDepthStencilAttachmentNew;
    private colorAttachment: (GfxTextureSharedP_WebGPU | null)[] = [];
    private colorResolveTo: (GfxTextureSharedP_WebGPU | null)[] = [];
    private debugPointer: any;

    constructor(private device: GPUDevice) {
        this.colorAttachments = [{
            view: null!,
            loadValue: 'load',
            storeOp: 'store',
        }];

        this.depthStencilAttachment = {
            view: null!,
            depthLoadValue: 'load',
            depthStoreOp: 'store',
            stencilLoadValue: 'load',
            stencilStoreOp: 'store',
        };

        this.renderPassDescriptor = {
            colorAttachments: this.colorAttachments,
            depthStencilAttachment: this.depthStencilAttachment,
        };
    }

    private setRenderPassDescriptor(descriptor: GfxRenderPassDescriptor): void {
        this.descriptor = descriptor;

        const numColorAttachments = descriptor.colorAttachment.length;
        this.colorAttachment.length = numColorAttachments;
        this.colorResolveTo.length = numColorAttachments;
        for (let i = 0; i < descriptor.colorAttachment.length; i++) {
            let colorAttachment: GfxTextureSharedP_WebGPU | null = descriptor.colorAttachment[i] as GfxAttachmentP_WebGPU;
            let colorResolveTo: GfxTextureSharedP_WebGPU | null = descriptor.colorResolveTo[i] as GfxTextureP_WebGPU;

            // Do some dumb juggling...
            if (colorAttachment === null && colorResolveTo !== null) {
                colorAttachment = colorResolveTo as GfxTextureP_WebGPU;
                colorResolveTo = null;
            }

            if (colorAttachment !== null) {
                const dstAttachment = this.colorAttachments[0];
                dstAttachment.view = colorAttachment.gpuTextureView;
                dstAttachment.loadValue = descriptor.colorClearColor[i];
                dstAttachment.storeOp = 'store';
                dstAttachment.resolveTarget = undefined;
                this.renderPassDescriptor.colorAttachments = this.colorAttachments;

                if (colorResolveTo !== null && colorAttachment.sampleCount > 1)
                    dstAttachment.resolveTarget = colorResolveTo.gpuTextureView;
            } else {
                this.renderPassDescriptor.colorAttachments = [];
            }

            this.colorAttachment[i] = colorAttachment;
            this.colorResolveTo[i] = colorResolveTo;
        }

        if (descriptor.depthStencilAttachment !== null) {
            const dsAttachment = descriptor.depthStencilAttachment as GfxAttachmentP_WebGPU;
            const dstAttachment = this.depthStencilAttachment;
            dstAttachment.view = dsAttachment.gpuTextureView;
            dstAttachment.depthLoadValue = descriptor.depthClearValue;
            dstAttachment.stencilLoadValue = descriptor.stencilClearValue;
            dstAttachment.depthStoreOp = 'store';
            dstAttachment.stencilStoreOp = 'store';
            this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment;
        } else {
            this.renderPassDescriptor.depthStencilAttachment = undefined;
        }
    }

    public beginRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): void {
        assert(this.renderPassEncoder === null);
        this.setRenderPassDescriptor(renderPassDescriptor);
        this.renderPassEncoder = this.commandEncoder!.beginRenderPass(this.renderPassDescriptor);
    }

    public setViewport(x: number, y: number, w: number, h: number): void {
        this.renderPassEncoder!.setViewport(x, y, w, h, 0, 1);
    }

    public setScissor(x: number, y: number, w: number, h: number): void {
        this.renderPassEncoder!.setScissorRect(x, y, w, h);
    }

    public setPipeline(pipeline_: GfxRenderPipeline): void {
        const pipeline = pipeline_ as GfxRenderPipelineP_WebGPU;
        const gpuRenderPipeline = assertExists(pipeline.gpuRenderPipeline);
        this.renderPassEncoder!.setPipeline(gpuRenderPipeline);
    }

    public setInputState(inputState_: GfxInputState | null): void {
        if (inputState_ === null)
            return;

        const inputState = inputState_ as GfxInputStateP_WebGPU;
        if (inputState.indexBuffer !== null) {
            const inputLayout = inputState.inputLayout as GfxInputLayoutP_WebGPU;
            const indexBuffer = inputState.indexBuffer;
            this.renderPassEncoder!.setIndexBuffer(getPlatformBuffer(indexBuffer.buffer), assertExists(inputLayout.indexFormat), indexBuffer.byteOffset);
        }

        for (let i = 0; i < inputState.vertexBuffers.length; i++) {
            const b = inputState.vertexBuffers[i];
            if (b === null)
                continue;
            this.renderPassEncoder!.setVertexBuffer(i, getPlatformBuffer(b.buffer), b.byteOffset);
        }
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const bindings = bindings_ as GfxBindingsP_WebGPU;
        this.renderPassEncoder!.setBindGroup(bindingLayoutIndex + 0, bindings.gpuBindGroup[0], dynamicByteOffsets.slice(0, bindings.bindingLayout.numUniformBuffers));
        this.renderPassEncoder!.setBindGroup(bindingLayoutIndex + 1, bindings.gpuBindGroup[1]);
    }

    public setStencilRef(ref: number): void {
        this.renderPassEncoder!.setStencilReference(ref);
    }

    public draw(vertexCount: number, firstVertex: number): void {
        this.renderPassEncoder!.draw(vertexCount, 1, firstVertex, 0);
    }

    public drawIndexed(indexCount: number, firstIndex: number): void {
        this.renderPassEncoder!.drawIndexed(indexCount, 1, firstIndex, 0, 0);
    }

    public drawIndexedInstanced(indexCount: number, firstIndex: number, instanceCount: number): void {
        this.renderPassEncoder!.drawIndexed(indexCount, instanceCount, firstIndex, 0, 0);
    }

    public setDebugPointer(value: any): void {
        this.debugPointer = value;
    }

    public finish(): GPUCommandBuffer {
        this.renderPassEncoder!.endPass();
        this.renderPassEncoder = null;

        // Fake a resolve with a copy for non-MSAA.
        for (let i = 0; i < this.colorAttachment.length; i++) {
            const colorAttachment = this.colorAttachment[i];
            const colorResolveTo = this.colorResolveTo[i];

            if (colorAttachment !== null && colorResolveTo !== null && colorAttachment.sampleCount === 1) {
                const srcCopy: GPUImageCopyTexture = { texture: colorAttachment.gpuTexture };
                const dstCopy: GPUImageCopyTexture = { texture: colorResolveTo.gpuTexture };
                assert(colorAttachment.width === colorResolveTo.width);
                assert(colorAttachment.height === colorResolveTo.height);
                assert(!!(colorAttachment.usage & GPUTextureUsage.COPY_SRC));
                assert(!!(colorResolveTo.usage & GPUTextureUsage.COPY_DST));
                this.commandEncoder!.copyTextureToTexture(srcCopy, dstCopy, [colorResolveTo.width, colorResolveTo.height, 1]);
            }
        }

        return this.commandEncoder!.finish();
    }
}

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
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

function translateImageLayout(layout: GPUImageDataLayout, format: GfxFormat, mipWidth: number, mipHeight: number): void {
    const blockSize = getFormatBlockSize(format);

    const numBlocksX = align(mipWidth, blockSize);
    const numBlocksY = align(mipHeight, blockSize);

    layout.bytesPerRow = numBlocksX * getFormatByteSizePerBlock(format);
    layout.rowsPerImage = numBlocksY;
}

class GfxImplP_WebGPU implements GfxSwapChain, GfxDevice {
    private _swapChain: GPUSwapChain;
    private _swapChainWidth = 0;
    private _swapChainHeight = 0;
    private readonly _swapChainTextureUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST;
    private _resourceUniqueId: number = 0;

    private _renderPassPool: GfxRenderPassP_WebGPU[] = [];
    private _fallbackTexture: GfxTexture;
    private _fallbackSampler: GfxSampler;
    private _featureTextureCompressionBC: boolean = false;

    // GfxVendorInfo
    public readonly platformString: string = 'WebGPU';
    public readonly glslVersion = `#version 440`;
    public readonly explicitBindingLocations = true;
    public readonly separateSamplerTextures = true;
    public readonly clipSpaceNearZ = GfxClipSpaceNearZ.Zero;

    constructor(private adapter: GPUAdapter, private device: GPUDevice, private canvasContext: GPUCanvasContext, private glslang: Glslang) {
        this._swapChain = this.canvasContext.configureSwapChain({ device, format: 'bgra8unorm', usage: this._swapChainTextureUsage });
        this._fallbackTexture = this.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
        this._fallbackSampler = this.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
        });

        this._featureTextureCompressionBC = this.device.features.has('texture-compression-bc');
    }

    // GfxSwapChain
    public configureSwapChain(width: number, height: number): void {
        this._swapChainWidth = width;
        this._swapChainHeight = height;
    }

    public getOnscreenTexture(): GfxTexture {
        // TODO(jstpierre): Figure out how to wrap more efficiently.
        const gpuTexture = this._swapChain.getCurrentTexture();
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = { _T: _T.Texture, ResourceUniqueId: 0,
            gpuTexture, gpuTextureView,
            pixelFormat: GfxFormat.U8_RGBA_RT,
            width: this._swapChainWidth,
            height: this._swapChainHeight,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: this._swapChainTextureUsage,
            sampleCount: 1,
        };
        return texture;
    }

    public getDevice(): GfxDevice {
        return this;
    }

    public present(): void {
        // Nothing to do, AFAIK. Might have to make a fake swap chain eventually, I think...
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
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureSharedP_WebGPU = { 
            pixelFormat: descriptor.pixelFormat,
            width: descriptor.width,
            height: descriptor.height,
            depthOrArrayLayers: descriptor.depthOrArrayLayers,
            numLevels: mipLevelCount,
            usage,
            sampleCount: 1,
            gpuTexture, gpuTextureView,
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
        const attachment: GfxAttachmentP_WebGPU = { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            pixelFormat, width, height, depthOrArrayLayers, sampleCount, numLevels,
            usage, gpuTexture, gpuTextureView,
        };
        return attachment;
    }

    private async _createShaderStage(sourceText: string, shaderStage: ShaderStage): Promise<GPUProgrammableStage> {
        let res: Uint32Array;
        try {
            res = this.glslang.compileGLSL(sourceText, shaderStage, true);
        } catch(e) {
            console.error(prependLineNo(sourceText));
            throw "whoops";
        }

        const shaderModule = this.device.createShaderModule({ code: res });
        return { module: shaderModule, entryPoint: 'main' };
    }

    private async _createProgram(program: GfxProgramP_WebGPU): Promise<void> {
        const deviceProgram = program.descriptor;
        // TODO(jstpierre): Asynchronous program compilation
        program.vertexStage = await this._createShaderStage(deviceProgram.preprocessedVert, 'vertex');
        program.fragmentStage = await this._createShaderStage(deviceProgram.preprocessedFrag, 'fragment');
    }

    public createProgramSimple(deviceProgram: GfxProgramDescriptorSimple): GfxProgram {
        const vertexStage: GPUProgrammableStage | null = null;
        const fragmentStage: GPUProgrammableStage | null = null;
        const program: GfxProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor: deviceProgram, vertexStage, fragmentStage };
        this._createProgram(program);
        return program;
    }

    public createProgram(descriptor: GfxProgramDescriptor): GfxProgram {
        descriptor.ensurePreprocessed(this);
        return this.createProgramSimple(descriptor);
    }

    private _createBindGroupLayout(bindingLayout: GfxBindingLayoutDescriptor): GPUBindGroupLayout[] {
        const entries: GPUBindGroupLayoutEntry[][] = [[], []];

        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            entries[0].push({ binding: entries[0].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } });

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            // TODO(jstpierre): This doesn't work for depth textures
            entries[1].push({ binding: entries[1].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
            entries[1].push({ binding: entries[1].length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
        }

        return entries.map((entries) => this.device.createBindGroupLayout({ entries }));
    }

    public createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings {
        const bindingLayout = bindingsDescriptor.bindingLayout;
        const gpuBindGroupLayout = this._createBindGroupLayout(bindingLayout);

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
            const gfxBinding = bindingsDescriptor.samplerBindings[i];
            const gfxTexture = gfxBinding.gfxTexture !== null ? gfxBinding.gfxTexture : this._fallbackTexture;
            const gpuTextureView = (gfxTexture as GfxTextureP_WebGPU).gpuTextureView;
            gpuBindGroupEntries[1].push({ binding: numBindings++, resource: gpuTextureView });

            const gfxSampler = gfxBinding.gfxSampler !== null ? gfxBinding.gfxSampler : this._fallbackSampler;
            const gpuSampler = getPlatformSampler(gfxSampler);
            gpuBindGroupEntries[1].push({ binding: numBindings++, resource: gpuSampler });
        }

        const gpuBindGroup = gpuBindGroupEntries.map((gpuBindGroupEntries, i) => this.device.createBindGroup({ layout: gpuBindGroupLayout[i], entries: gpuBindGroupEntries }));
        const bindings: GfxBindingsP_WebGPU = { _T: _T.Bindings, ResourceUniqueId: this._resourceUniqueId, bindingLayout: bindingsDescriptor.bindingLayout, gpuBindGroupLayout, gpuBindGroup };
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
        const inputState: GfxInputStateP_WebGPU = { _T: _T.InputState, ResourceUniqueId: this.getNextUniqueId(),
            inputLayout, vertexBuffers, indexBuffer,
        };
        return inputState;
    }

    private _createPipelineLayout(bindingLayouts: GfxBindingLayoutDescriptor[]): GPUPipelineLayout {
        const bindGroupLayouts = bindingLayouts.flatMap((bindingLayout) => this._createBindGroupLayout(bindingLayout));
        return this.device.createPipelineLayout({ bindGroupLayouts });
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const gpuRenderPipeline: GPURenderPipeline | null = null;
        const isCreating = false;
        const renderPipeline: GfxRenderPipelineP_WebGPU = { _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(),
            descriptor, isCreating, gpuRenderPipeline,
        };
        this.ensureRenderPipeline(renderPipeline);
        return renderPipeline;
    }

    private async ensureRenderPipeline(renderPipeline: GfxRenderPipelineP_WebGPU): Promise<void> {
        if (renderPipeline.isCreating)
            return;

        if (renderPipeline.gpuRenderPipeline !== null)
            return;

        const descriptor = renderPipeline.descriptor;
        const program = descriptor.program as GfxProgramP_WebGPU;
        const vertexStage = program.vertexStage, fragmentStage = program.fragmentStage;
        if (vertexStage === null || fragmentStage === null)
            return;

        const layout = this._createPipelineLayout(descriptor.bindingLayouts);
        const primitive = translatePrimitiveState(descriptor.topology, descriptor.megaStateDescriptor);
        const targets = translateTargets(descriptor.colorAttachmentFormats, descriptor.megaStateDescriptor);
        const depthStencil = translateDepthStencilState(descriptor.depthStencilAttachmentFormat, descriptor.megaStateDescriptor);

        let buffers: GPUVertexBufferLayout[] | undefined = undefined;
        if (descriptor.inputLayout !== null)
            buffers = (descriptor.inputLayout as GfxInputLayoutP_WebGPU).buffers;
        const sampleCount = descriptor.sampleCount;

        renderPipeline.isCreating = true;

        const gpuRenderPipeline: GPURenderPipelineDescriptorNew = {
            layout,
            vertex: {
                ... vertexStage,
                buffers,
            },
            primitive,
            depthStencil,
            multisample: {
                count: sampleCount,
            },
            fragment: {
                ... fragmentStage,
                targets,
            },
        };

        // TODO(jstpierre): createRenderPipelineAsync
        renderPipeline.gpuRenderPipeline = this.device.createRenderPipeline(gpuRenderPipeline);

        if (renderPipeline.ResourceName !== undefined)
            renderPipeline.gpuRenderPipeline.label = renderPipeline.ResourceName;
    }

    public createReadback(): GfxReadback {
        const o: GfxReadbackP_WebGPU = { _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId() };
        return o;
    }

    public createWebXRLayer(webXRSession: XRSession): XRWebGLLayer {
        // TODO WebXR: currently now way to use WebGPU with WebXR.
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
    }

    public createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        let pass = this._renderPassPool.pop();
        if (pass === undefined)
            pass = new GfxRenderPassP_WebGPU(this.device);
        pass.commandEncoder = this.device.createCommandEncoder();
        pass.beginRenderPass(renderPassDescriptor);
        return pass;
    }

    public submitPass(o: GfxPass): void {
        const queue = this.device.queue;

        const pass = o as GfxRenderPassP_WebGPU;
        const b = pass.finish()!;
        queue.submit([b]);
        pass.commandEncoder = null;

        if (o instanceof GfxRenderPassP_WebGPU) {
            this._renderPassPool.push(o);
        }
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
        const size: GPUExtent3DStrict = { width: 0, height: 0, depthOrArrayLayers: 1 };

        for (let i = 0; i < levelDatas.length; i++) {
            const mipLevel = firstMipLevel + i;
            destination.mipLevel = mipLevel;

            const mipWidth = texture.width >>> mipLevel;
            const mipHeight = texture.height >>> mipLevel;

            size.width = mipWidth;
            size.height = mipHeight;

            translateImageLayout(layout, texture.pixelFormat, mipWidth, mipHeight);

            this.device.queue.writeTexture(destination, levelDatas[i], layout, size);
        }
    }

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void {
    }

    public submitReadback(o: GfxReadback): void {
    }

    public queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean {
        return true;
    }

    public queryLimits(): GfxDeviceLimits {
        // TODO(jstpierre): GPULimits
        return {
            uniformBufferMaxPageWordSize: 0x1000,
            uniformBufferWordAlignment: 0x40,
            supportedSampleCounts: [1],
        };
    }

    public queryTextureFormatSupported(format: GfxFormat): boolean {
        if (isFormatTextureCompressionBC(format))
            return this._featureTextureCompressionBC;
        return true;
    }

    public queryPipelineReady(o: GfxRenderPipeline): boolean {
        const renderPipeline = o as GfxRenderPipelineP_WebGPU;
        this.ensureRenderPipeline(renderPipeline);
        return renderPipeline.gpuRenderPipeline !== null;
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

export async function createSwapChainForWebGPU(canvas: HTMLCanvasElement): Promise<GfxSwapChain | null> {
    if (navigator.gpu === undefined)
        return null;

    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null)
        return null;

    const device = await adapter.requestDevice();
    if (device === null)
        return null;

    const context = canvas.getContext('gpupresent') as any as GPUCanvasContext;

    if (!context)
        return null;

    const _glslang = await glslang('glslang.wasm');

    return new GfxImplP_WebGPU(adapter, device, context, _glslang);
}
