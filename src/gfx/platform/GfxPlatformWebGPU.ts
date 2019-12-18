
import { GfxSwapChain, GfxDevice, GfxTexture, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingsDescriptor, GfxColorAttachment, GfxTextureDescriptor, GfxSamplerDescriptor, GfxInputLayoutDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxInputState, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxSampler, GfxDepthStencilAttachment, GfxProgram, GfxBindings, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxDebugGroup, GfxPass, GfxRenderPassDescriptor, GfxRenderPass, GfxHostAccessPass, GfxDeviceLimits, GfxFormat, GfxVendorInfo, GfxTextureDimension, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxAttachmentState, GfxChannelBlendState, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxVertexBufferFrequency, GfxIndexBufferDescriptor, GfxLoadDisposition, GfxProgramDescriptor } from "./GfxPlatform";
import { _T, GfxResource, GfxBugQuirksImpl } from "./GfxPlatformImpl";
import { assertExists, assert, leftPad, align } from "../../util";
import glslang, { ShaderStage, Glslang } from '../../vendor/glslang/glslang';

interface GfxBufferP_WebGPU extends GfxBuffer {
    gpuBuffer: GPUBuffer;
}

interface GfxTextureP_WebGPU extends GfxTexture {
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    numLevels: number;
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
}

interface GfxColorAttachmentP_WebGPU extends GfxColorAttachment {
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
}

interface GfxDepthStencilAttachmentP_WebGPU extends GfxDepthStencilAttachment {
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
}

interface GfxSamplerP_WebGPU extends GfxSampler {
    gpuSampler: GPUSampler;
}

interface GfxProgramP_WebGPU extends GfxProgram {
    deviceProgram: GfxProgramDescriptor;
    vertexStage: GPUProgrammableStageDescriptor | null;
    fragmentStage: GPUProgrammableStageDescriptor | null;
}

interface GfxBindingsP_WebGPU extends GfxBindings {
    bindingLayout: GfxBindingLayoutDescriptor;
    gpuBindGroupLayout: GPUBindGroupLayout;
    gpuBindGroup: GPUBindGroup;
}

interface GfxInputLayoutP_WebGPU extends GfxInputLayout {
    gpuVertexInputDescriptor: GPUVertexInputDescriptor;
}

interface GfxInputStateP_WebGPU extends GfxInputState {
    inputLayout: GfxInputLayout;
    vertexBuffers: (GfxVertexBufferDescriptor | null)[];
    indexBuffer: GfxIndexBufferDescriptor | null;
}

interface GfxRenderPipelineP_WebGPU extends GfxRenderPipeline {
    descriptor: GfxRenderPipelineDescriptor;
    gpuRenderPipeline: GPURenderPipeline | null;
}

function translateBufferUsage(usage: GfxBufferUsage): GPUBufferUsage {
    if (usage === GfxBufferUsage.INDEX)
        return GPUBufferUsage.INDEX;
    else if (usage === GfxBufferUsage.VERTEX)
        return GPUBufferUsage.VERTEX;
    else if (usage === GfxBufferUsage.UNIFORM)
        return GPUBufferUsage.UNIFORM;
    else
        throw "whoops";
}

function translateWrapMode(wrapMode: GfxWrapMode): GPUAddressMode {
    if (wrapMode === GfxWrapMode.CLAMP)
        return 'clamp-to-edge';
    else if (wrapMode === GfxWrapMode.REPEAT)
        return 'repeat';
    else if (wrapMode === GfxWrapMode.MIRROR)
        return 'mirror-repeat';
    else
        throw "whoops";
}

function translateMinMagFilter(texFilter: GfxTexFilterMode): GPUFilterMode {
    if (texFilter === GfxTexFilterMode.BILINEAR)
        return 'linear';
    else if (texFilter === GfxTexFilterMode.POINT)
        return 'nearest';
    else
        throw "whoops";
}

function translateMipFilter(mipFilter: GfxMipFilterMode): GPUFilterMode {
    if (mipFilter === GfxMipFilterMode.LINEAR)
        return 'linear';
    else if (mipFilter === GfxMipFilterMode.NEAREST)
        return 'nearest';
    else if (mipFilter === GfxMipFilterMode.NO_MIP)
        return 'nearest';
    else
        throw "whoops";
}

function translateTextureFormat(format: GfxFormat): GPUTextureFormat {
    if (format === GfxFormat.U8_RGBA_NORM)
        return 'rgba8unorm';
    else if (format === GfxFormat.U8_RG_NORM)
        return 'rg8unorm';
    else
        throw "whoops";
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
    if (topology === GfxPrimitiveTopology.TRIANGLES)
        return 'triangle-list';
    else
        throw "whoops";
}

function translateCullMode(cullMode: GfxCullMode): GPUCullMode {
    if (cullMode === GfxCullMode.NONE)
        return 'none';
    else if (cullMode === GfxCullMode.FRONT)
        return 'front';
    else if (cullMode === GfxCullMode.BACK)
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

function translateRasterizationState(megaStateDescriptor: GfxMegaStateDescriptor): GPURasterizationStateDescriptor {
    return {
        cullMode: translateCullMode(megaStateDescriptor.cullMode),
        frontFace: translateFrontFace(megaStateDescriptor.frontFace),
    };
}

function translateBlendFactor(factor: GfxBlendFactor): GPUBlendFactor {
    if (factor === GfxBlendFactor.ZERO)
        return 'zero';
    else if (factor === GfxBlendFactor.ONE)
        return 'one';
    else if (factor === GfxBlendFactor.SRC_COLOR)
        return 'src-color';
    else if (factor === GfxBlendFactor.ONE_MINUS_SRC_COLOR)
        return 'one-minus-src-color';
    else if (factor === GfxBlendFactor.DST_COLOR)
        return 'dst-color';
    else if (factor === GfxBlendFactor.ONE_MINUS_DST_COLOR)
        return 'one-minus-dst-color';
    else if (factor === GfxBlendFactor.SRC_ALPHA)
        return 'src-alpha';
    else if (factor === GfxBlendFactor.ONE_MINUS_SRC_ALPHA)
        return 'one-minus-src-alpha';
    else if (factor === GfxBlendFactor.DST_ALPHA)
        return 'dst-alpha';
    else if (factor === GfxBlendFactor.ONE_MINUS_DST_ALPHA)
        return 'one-minus-dst-alpha';
    else
        throw "whoops";
}

function translateBlendMode(mode: GfxBlendMode): GPUBlendOperation {
    if (mode === GfxBlendMode.ADD)
        return 'add';
    else if (mode === GfxBlendMode.SUBTRACT)
        return 'subtract';
    else if (mode === GfxBlendMode.REVERSE_SUBTRACT)
        return 'reverse-subtract';
    else
        throw "whoops";
}

function translateBlendState(blendState: GfxChannelBlendState): GPUBlendDescriptor {
    return {
        operation: translateBlendMode(blendState.blendMode),
        srcFactor: translateBlendFactor(blendState.blendSrcFactor),
        dstFactor: translateBlendFactor(blendState.blendDstFactor),
    };
}

function translateColorState(attachmentState: GfxAttachmentState): GPUColorStateDescriptor {
    return { 
        format: 'bgra8unorm',
        colorBlend: translateBlendState(attachmentState.rgbBlendState),
        alphaBlend: translateBlendState(attachmentState.alphaBlendState),
        writeMask: attachmentState.colorWriteMask,
    };
}

function translateColorStates(megaStateDescriptor: GfxMegaStateDescriptor): GPUColorStateDescriptor[] {
    // TODO(jstpierre): Remove legacy blend states.
    return megaStateDescriptor.attachmentsState!.map(translateColorState);
}

function translateCompareMode(compareMode: GfxCompareMode): GPUCompareFunction {
    if (compareMode === GfxCompareMode.NEVER)
        return 'never';
    else if (compareMode === GfxCompareMode.LESS)
        return 'less';
    else if (compareMode === GfxCompareMode.EQUAL)
        return 'equal';
    else if (compareMode === GfxCompareMode.LEQUAL)
        // @ts-ignore: https://github.com/gpuweb/types/pull/5
        return 'less-equal';
    else if (compareMode === GfxCompareMode.GREATER)
        return 'greater';
    else if (compareMode === GfxCompareMode.NEQUAL)
        // @ts-ignore: https://github.com/gpuweb/types/pull/5
        return 'not-equal';
    else if (compareMode === GfxCompareMode.GEQUAL)
        // @ts-ignore: https://github.com/gpuweb/types/pull/5
        return 'greater-equal';
    else if (compareMode === GfxCompareMode.ALWAYS)
        return 'always';
    else
        throw "whoops";
}

function translateDepthStencilState(megaStateDescriptor: GfxMegaStateDescriptor): GPUDepthStencilStateDescriptor {
    return {
        format: 'depth24plus-stencil8',

        depthWriteEnabled: megaStateDescriptor.depthWrite,
        depthCompare: translateCompareMode(megaStateDescriptor.depthCompare),

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
    if (frequency === GfxVertexBufferFrequency.PER_VERTEX)
        return 'vertex';
    else if (frequency === GfxVertexBufferFrequency.PER_INSTANCE)
        return 'instance';
    else
        throw "whoops";
}

function translateVertexFormat(format: GfxFormat): GPUVertexFormat {
    if (format === GfxFormat.U8_RG)
        return 'uchar2';
    else if (format === GfxFormat.U8_RGBA)
        return 'uchar4';
    else if (format === GfxFormat.F32_R)
        return 'float';
    else if (format === GfxFormat.F32_RG)
        return 'float2';
    else if (format === GfxFormat.F32_RGB)
        return 'float3';
    else if (format === GfxFormat.F32_RGBA)
        return 'float4';
    else
        throw "whoops";
}

class GfxHostAccessPassP_WebGPU implements GfxHostAccessPass {
    public commandEncoder: GPUCommandEncoder | null = null;

    constructor(private device: GPUDevice) {
    }

    public uploadBufferData(buffer: GfxBuffer, dstWordOffset: number, data: Uint8Array, srcWordOffset?: number, wordCount?: number): void {
        // TODO(jstpierre): Don't upload immediately. Depends on what the buffer versioning scheme will look like.
        const gfxBuffer = buffer as GfxBufferP_WebGPU;
        const dstByteOffset = dstWordOffset << 2;
        const srcByteOffset = srcWordOffset !== undefined ? srcWordOffset << 2 : 0;
        const byteCount = wordCount !== undefined ? wordCount << 2 : 0;
        gfxBuffer.gpuBuffer.setSubData(dstByteOffset, data, srcByteOffset, byteCount);
    }

    public uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void {
        // TODO(jstpierre): Don't create scratch buffers, instead use a larger upload pool.
        const gfxTexture = texture as GfxTextureP_WebGPU;

        // Not sure why, but WebGPU rowPitch is multiples of 256 (?), which is a super large number.
        const widthInBytes = gfxTexture.pixelFormat;
        const rowPitch = align(gfxTexture.width, 256);

        let bufferSize = 0;
        for (let i = 0; i < levelDatas.length; i++)
            bufferSize += levelDatas[i].byteLength;

        const dataBuffer = this.device.createBuffer({ size: bufferSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });

        let bufferOffs = 0;
        let w = gfxTexture.width, h = gfxTexture.height;
        for (let i = 0; i < levelDatas.length; i++) {
            dataBuffer.setSubData(bufferOffs, levelDatas[i]);
            bufferOffs += levelDatas[i].byteLength;

            const source: GPUBufferCopyView = {
                buffer: dataBuffer,
                offset: 0,
                rowPitch: w,
                imageHeight: h,
            };

            const destination: GPUTextureCopyView = {
                texture: gfxTexture.gpuTexture,
                mipLevel: firstMipLevel + i,
                arrayLayer: 0,
                origin: [0, 0, 0],
            };

            const copySize: GPUExtent3D = [w, h, 1];

            this.commandEncoder!.copyBufferToTexture(source, destination, copySize);

            w = Math.max((w / 2) | 0, 1);
            h = Math.max((h / 2) | 0, 1);
        }
    }
}

class GfxRenderPassP_WebGPU implements GfxRenderPass {
    public commandEncoder: GPUCommandEncoder | null = null;
    private renderPassEncoder: GPURenderPassEncoder | null = null;
    private renderPassDescriptor: GPURenderPassDescriptor;
    private colorAttachments: GPURenderPassColorAttachmentDescriptor[];
    private depthStencilAttachment: GPURenderPassDepthStencilAttachmentDescriptor;

    constructor() {
        this.colorAttachments = [{
            attachment: null!,
            loadValue: 'load',
        }];

        this.depthStencilAttachment = {
            attachment: null!,
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

    private setRenderPassDescriptor(gfxPass: GfxRenderPassDescriptor): void {
        if (gfxPass.colorAttachment !== null) {
            const colorAttachment = gfxPass.colorAttachment as GfxColorAttachmentP_WebGPU;
            const dstAttachment = this.colorAttachments[0];
            dstAttachment.attachment = colorAttachment.gpuTextureView;
            dstAttachment.loadValue = gfxPass.colorLoadDisposition === GfxLoadDisposition.LOAD ? 'load' : gfxPass.colorClearColor;
            dstAttachment.storeOp = 'store';
            dstAttachment.resolveTarget = undefined;
            this.renderPassDescriptor.colorAttachments = this.colorAttachments;
        } else {
            this.renderPassDescriptor.colorAttachments = [];
        }

        if (gfxPass.depthStencilAttachment !== null) {
            const dsAttachment = gfxPass.depthStencilAttachment as GfxDepthStencilAttachmentP_WebGPU;
            const dstAttachment = this.depthStencilAttachment;
            dstAttachment.attachment = dsAttachment.gpuTextureView;
            dstAttachment.depthLoadValue = gfxPass.depthLoadDisposition === GfxLoadDisposition.LOAD ? 'load' : gfxPass.depthClearValue;
            dstAttachment.stencilLoadValue = gfxPass.stencilLoadDisposition === GfxLoadDisposition.LOAD ? 'load' : gfxPass.stencilClearValue;
            dstAttachment.depthStoreOp = 'store';
            dstAttachment.stencilStoreOp = 'store';
            this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment;
        } else {
            this.renderPassDescriptor.depthStencilAttachment = undefined;
        }
    }

    private setRenderPassDescriptorResolve(resolveColorAttachmentTo: GfxTexture): void {
        // Make sure that we started with a render pass...
        assert(this.renderPassDescriptor.colorAttachments.length === 1);
        this.renderPassDescriptor.depthStencilAttachment = undefined;
        this.colorAttachments[0].loadValue = 'load';
        this.colorAttachments[0].storeOp = 'store';
        const resolveTexture = resolveColorAttachmentTo as GfxTextureP_WebGPU;
        this.colorAttachments[0].resolveTarget = resolveTexture.gpuTextureView;
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

    public setInputState(inputState_: GfxInputState): void {
        const inputState = inputState_ as GfxInputStateP_WebGPU;
        if (inputState.indexBuffer !== null)
            this.renderPassEncoder!.setIndexBuffer(getPlatformBuffer(inputState.indexBuffer.buffer), inputState.indexBuffer.byteOffset);

        for (let i = 0; i < inputState.vertexBuffers.length; i++) {
            const b = inputState.vertexBuffers[i];
            if (b === null)
                continue;
            this.renderPassEncoder!.setVertexBuffer(i, getPlatformBuffer(b.buffer), b.byteOffset);
        }
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const bindings = bindings_ as GfxBindingsP_WebGPU;
        this.renderPassEncoder!.setBindGroup(bindingLayoutIndex, bindings.gpuBindGroup, dynamicByteOffsets.slice(0, bindings.bindingLayout.numUniformBuffers));
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

    public endPass(resolveColorAttachmentTo: GfxTexture | null): void {
        this.renderPassEncoder!.endPass();
        this.renderPassEncoder = null;

        if (resolveColorAttachmentTo !== null) {
            this.setRenderPassDescriptorResolve(resolveColorAttachmentTo);
            const resolvePass = this.commandEncoder!.beginRenderPass(this.renderPassDescriptor);
            resolvePass.endPass();
        }
    }
}

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
}

class GfxImplP_WebGPU implements GfxSwapChain, GfxDevice {
    private _swapChain: GPUSwapChain;
    private _resourceUniqueId: number = 0;

    private _hostAccessPassPool: GfxHostAccessPassP_WebGPU[] = [];
    private _renderPassPool: GfxRenderPassP_WebGPU[] = [];

    // GfxVendorInfo
    public bugQuirks = new GfxBugQuirksImpl();
    public glslVersion = `#version 450`;
    public explicitBindingLocations = true;
    public separateSamplerTextures = true;

    constructor(private adapter: GPUAdapter, private device: GPUDevice, private canvasContext: GPUCanvasContext, private glslang: Glslang) {
        this._swapChain = this.canvasContext.configureSwapChain({ device, format: 'bgra8unorm' });
    }

    // GfxSwapChain
    public configureSwapChain(width: number, height: number): void {
        // Nothing to do, AFAIK.
    }

    public getOnscreenTexture(): GfxTexture {
        // TODO(jstpierre): Figure out how to wrap more efficiently.
        const gpuTexture = this._swapChain.getCurrentTexture();
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = { _T: _T.Texture, ResourceUniqueId: 0,
            gpuTexture, gpuTextureView,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: 0,
            height: 0,
            numLevels: 1,
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
        const buffer: GfxBufferP_WebGPU = { _T: _T.Buffer, ResourceUniqueId: this.getNextUniqueId(), gpuBuffer };
        return buffer;
    }

    public createTexture(descriptor: GfxTextureDescriptor): GfxTexture {
        const size: GPUExtent3D = [descriptor.width, descriptor.height, 1];
        const arrayLayerCount = (descriptor.dimension === GfxTextureDimension.n2D_ARRAY) ? descriptor.depth : 1;
        const mipLevelCount = descriptor.numLevels;
        const format = translateTextureFormat(descriptor.pixelFormat);
        const dimension = '2d';
        const usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED;

        const gpuTexture = this.device.createTexture({ size, arrayLayerCount, mipLevelCount, format, dimension, usage });
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = { _T: _T.Texture, ResourceUniqueId: this.getNextUniqueId(),
            gpuTexture, gpuTextureView,
            pixelFormat: descriptor.pixelFormat,
            width: descriptor.width,
            height: descriptor.height,
            numLevels: mipLevelCount,
        };
        return texture;
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        const gpuSampler = this.device.createSampler({
            addressModeU: translateWrapMode(descriptor.wrapS),
            addressModeV: translateWrapMode(descriptor.wrapT),
            lodMinClamp: descriptor.minLOD,
            lodMaxClamp: descriptor.maxLOD,
            minFilter: translateMinMagFilter(descriptor.minFilter),
            magFilter: translateMinMagFilter(descriptor.magFilter),
            mipmapFilter: translateMipFilter(descriptor.mipFilter),
        });
        const sampler: GfxSamplerP_WebGPU = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gpuSampler };
        return sampler;
    }

    public createColorAttachment(width: number, height: number, numSamples: number): GfxColorAttachment {
        const gpuTexture = this.device.createTexture({
            size: [width, height, 1],
            sampleCount: numSamples,
            format: 'bgra8unorm',
            usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
        });
        const gpuTextureView = gpuTexture.createView();

        const colorAttachment: GfxColorAttachmentP_WebGPU = { _T: _T.ColorAttachment, ResourceUniqueId: this.getNextUniqueId(), gpuTexture, gpuTextureView };
        return colorAttachment;
    }

    public createDepthStencilAttachment(width: number, height: number, numSamples: number): GfxDepthStencilAttachment {
        const gpuTexture = this.device.createTexture({
            size: [width, height, 1],
            sampleCount: numSamples,
            format: 'depth24plus-stencil8',
            usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
        });
        const gpuTextureView = gpuTexture.createView();

        const depthStencilAttachment: GfxDepthStencilAttachmentP_WebGPU = { _T: _T.DepthStencilAttachment, ResourceUniqueId: this.getNextUniqueId(), gpuTexture, gpuTextureView };
        return depthStencilAttachment;
    }

    private async _createShaderStage(sourceText: string, shaderStage: ShaderStage): Promise<GPUProgrammableStageDescriptor> {
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
        const deviceProgram = program.deviceProgram;
        // TODO(jstpierre): Asynchronous program compilation
        program.vertexStage = await this._createShaderStage(deviceProgram.preprocessedVert, 'vertex');
        program.fragmentStage = await this._createShaderStage(deviceProgram.preprocessedFrag, 'fragment');
    }

    public createProgram(deviceProgram: GfxProgramDescriptor): GfxProgram {
        deviceProgram.ensurePreprocessed(this);

        const vertexStage: GPUProgrammableStageDescriptor | null = null;
        const fragmentStage: GPUProgrammableStageDescriptor | null = null;
        const program: GfxProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), deviceProgram, vertexStage, fragmentStage };

        this._createProgram(program);

        return program;
    }

    private _createBindGroupLayout(bindingLayout: GfxBindingLayoutDescriptor): GPUBindGroupLayout {
        const bindings: GPUBindGroupLayoutBinding[] = [];

        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            bindings.push({ binding: bindings.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'uniform-buffer', hasDynamicOffset: true });

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            bindings.push({ binding: bindings.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'sampled-texture' });
            bindings.push({ binding: bindings.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'sampler' });
        }

        return this.device.createBindGroupLayout({ bindings });
    }

    public createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings {
        const gpuBindGroupLayout = this._createBindGroupLayout(bindingsDescriptor.bindingLayout);

        const gpuBindGroupBindings: GPUBindGroupBinding[] = [];
        let numBindings = 0;
        for (let i = 0; i < bindingsDescriptor.uniformBufferBindings.length; i++) {
            const gfxBinding = bindingsDescriptor.uniformBufferBindings[i];
            const gpuBufferBinding: GPUBufferBinding = {
                buffer: getPlatformBuffer(gfxBinding.buffer),
                offset: gfxBinding.wordOffset << 2,
                size: gfxBinding.wordCount << 2,
            };
            gpuBindGroupBindings.push({ binding: numBindings++, resource: gpuBufferBinding });
        }

        for (let i = 0; i < bindingsDescriptor.samplerBindings.length; i++) {
            const gfxBinding = bindingsDescriptor.samplerBindings[i];
            if (gfxBinding.gfxTexture !== null) {
                const gfxTexture = gfxBinding.gfxTexture as GfxTextureP_WebGPU;
                const gpuTextureView = gfxTexture.gpuTextureView;
                gpuBindGroupBindings.push({ binding: numBindings + 0, resource: gpuTextureView });
            }

            if (gfxBinding.gfxSampler !== null) {
                const gpuSampler = getPlatformSampler(gfxBinding.gfxSampler);
                gpuBindGroupBindings.push({ binding: numBindings + 1, resource: gpuSampler });
            }

            numBindings += 2;
        }

        const gpuBindGroup = this.device.createBindGroup({ layout: gpuBindGroupLayout, bindings: gpuBindGroupBindings });
        const bindings: GfxBindingsP_WebGPU = { _T: _T.Bindings, ResourceUniqueId: this._resourceUniqueId, bindingLayout: bindingsDescriptor.bindingLayout, gpuBindGroupLayout, gpuBindGroup };
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        // GfxInputLayout is not a platform object, it's a descriptor in WebGPU.
        const indexFormat = translateIndexFormat(inputLayoutDescriptor.indexBufferFormat);

        const vertexBuffers: GPUVertexBufferDescriptor[] = [];
        for (let i = 0; i < inputLayoutDescriptor.vertexBufferDescriptors.length; i++) {
            const b = inputLayoutDescriptor.vertexBufferDescriptors[i];
            if (b === null)
                continue;
            const stride = b.byteStride;
            assert(stride > 0);
            const stepMode = translateVertexBufferFrequency(b.frequency);
            const attributeSet: GPUVertexAttributeDescriptor[] = [];
            vertexBuffers[i] = { stride, stepMode, attributeSet };
        }

        for (let i = 0; i < inputLayoutDescriptor.vertexAttributeDescriptors.length; i++) {
            const attr = inputLayoutDescriptor.vertexAttributeDescriptors[i];
            const b = assertExists(vertexBuffers[attr.bufferIndex]);
            const attribute: GPUVertexAttributeDescriptor = {
                shaderLocation: attr.location,
                format: translateVertexFormat(attr.format),
                offset: attr.bufferByteOffset,
            };
            b.attributeSet.push(attribute);
        }

        const gpuVertexInputDescriptor: GPUVertexInputDescriptor = { indexFormat, vertexBuffers };

        const inputLayout: GfxInputLayoutP_WebGPU = { _T: _T.InputLayout, ResourceUniqueId: this.getNextUniqueId(), gpuVertexInputDescriptor };
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
        const bindGroupLayouts = bindingLayouts.map((bindingLayout) => this._createBindGroupLayout(bindingLayout));
        return this.device.createPipelineLayout({ bindGroupLayouts })
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const gpuRenderPipeline: GPURenderPipeline | null = null;
        const renderPipeline: GfxRenderPipelineP_WebGPU = { _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(),
            descriptor, gpuRenderPipeline,
        };
        this.ensureRenderPipeline(renderPipeline);
        return renderPipeline;
    }

    public async ensureRenderPipeline(renderPipeline: GfxRenderPipelineP_WebGPU): Promise<void> {
        if (renderPipeline.gpuRenderPipeline !== null)
            return;

        const descriptor = renderPipeline.descriptor;
        const program = descriptor.program as GfxProgramP_WebGPU;

        if (program.vertexStage === null || program.fragmentStage === null)
            return;

        const layout = this._createPipelineLayout(descriptor.bindingLayouts);

        const primitiveTopology = translateTopology(descriptor.topology);
        const rasterizationState = translateRasterizationState(descriptor.megaStateDescriptor);
        const colorStates = translateColorStates(descriptor.megaStateDescriptor);
        const depthStencilState = translateDepthStencilState(descriptor.megaStateDescriptor);

        const vertexStage = program.vertexStage, fragmentStage = program.fragmentStage;

        const inputLayout = descriptor.inputLayout as GfxInputLayoutP_WebGPU;
        const vertexInput = inputLayout.gpuVertexInputDescriptor;
        const sampleCount = descriptor.sampleCount;

        this.device.pushErrorScope('none');
        renderPipeline.gpuRenderPipeline = this.device.createRenderPipeline({
            layout,
            vertexStage, fragmentStage,
            primitiveTopology, rasterizationState, colorStates, depthStencilState, vertexInput,
            sampleCount,
        });
        await this.device.popErrorScope();

        if (renderPipeline.ResourceName !== undefined)
            renderPipeline.gpuRenderPipeline.label = renderPipeline.ResourceName;
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

    public destroyColorAttachment(o: GfxColorAttachment): void {
        const colorAttachment = o as GfxColorAttachmentP_WebGPU;
        colorAttachment.gpuTexture.destroy();
    }

    public destroyDepthStencilAttachment(o: GfxDepthStencilAttachment): void {
        const depthStencilAttachment = o as GfxDepthStencilAttachmentP_WebGPU;
        depthStencilAttachment.gpuTexture.destroy();
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

    public createHostAccessPass(): GfxHostAccessPass {
        let pass = this._hostAccessPassPool.pop();
        if (pass === undefined)
            pass = new GfxHostAccessPassP_WebGPU(this.device);
        pass.commandEncoder = this.device.createCommandEncoder();
        return pass;
    }

    public createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        let pass = this._renderPassPool.pop();
        if (pass === undefined)
            pass = new GfxRenderPassP_WebGPU();
        pass.commandEncoder = this.device.createCommandEncoder();
        pass.beginRenderPass(renderPassDescriptor);
        return pass;
    }

    public submitPass(o: GfxPass): void {
        const queue = this.device.getQueue();

        const pass = o as (GfxRenderPassP_WebGPU | GfxHostAccessPassP_WebGPU);
        if (pass.commandEncoder !== null) {
            const b = pass.commandEncoder.finish();
            queue.submit([b]);
        }
        pass.commandEncoder = null;

        if (o instanceof GfxRenderPassP_WebGPU) {
            this._renderPassPool.push(o);
        } else if (o instanceof GfxHostAccessPassP_WebGPU) {
            this._hostAccessPassPool.push(o);
        }
    }

    public queryLimits(): GfxDeviceLimits {
        // TODO(jstpierre): GPULimits
        return {
            uniformBufferMaxPageWordSize: 0x1000,
            uniformBufferWordAlignment: 0x40,
        };
    }

    public queryTextureFormatSupported(format: GfxFormat): boolean {
        // TODO(jstpierre): Support compressed texture formats
        if (format === GfxFormat.BC1 || format === GfxFormat.BC1_SRGB)
            return false;
        if (format === GfxFormat.BC2 || format === GfxFormat.BC2_SRGB)
            return false;
        if (format === GfxFormat.BC3 || format === GfxFormat.BC3_SRGB)
            return false;
        return true;
    }

    public queryPipelineReady(o: GfxRenderPipeline): boolean {
        const renderPipeline = o as GfxRenderPipelineP_WebGPU;
        return renderPipeline.gpuRenderPipeline !== null;
    }

    public queryPlatformAvailable(): boolean {
        // TODO(jstpierre): Listen to the lost event?
        return true;
    }

    public queryVendorInfo(): GfxVendorInfo {
        return this;
    }

    public setResourceName(o: GfxResource, s: string): void {
        o.ResourceName = s;

        if (o._T === _T.Buffer) {
            const r = o as GfxBufferP_WebGPU;
            r.gpuBuffer.label = s;
        } else if (o._T === _T.Texture) {
            const r = o as GfxTextureP_WebGPU;
            r.gpuTexture.label = s;
        } else if (o._T === _T.ColorAttachment) {
            const r = o as GfxColorAttachmentP_WebGPU;
            r.gpuTexture.label = s;
            r.gpuTextureView.label = s;
        } else if (o._T === _T.DepthStencilAttachment) {
            const r = o as GfxDepthStencilAttachmentP_WebGPU;
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

    public pushDebugGroup(debugGroup: GfxDebugGroup): void {
    }

    public popDebugGroup(): void {
    }
}

export async function createSwapChainForWebGPU(canvas: HTMLCanvasElement): Promise<GfxSwapChain | null> {
    if (navigator.gpu === undefined)
        return null;

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    
    const context = canvas.getContext('gpupresent') as any as GPUCanvasContext;

    if (!context)
        return null;

    const _glslang = await glslang('glslang.wasm');

    return new GfxImplP_WebGPU(adapter, device, context, _glslang);
}
