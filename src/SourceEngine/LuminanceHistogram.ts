
import { vec2, vec4 } from "gl-matrix";
import { Color, colorLerp, colorNewCopy, colorToCSS, Cyan, Green, Red, White } from "../Color";
import { drawScreenSpaceBox, drawScreenSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxQueryPoolType, GfxShadingLanguage } from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxComputePipeline, GfxProgram, GfxQueryPool, GfxReadback } from "../gfx/platform/GfxPlatformImpl";
import { gfxDeviceGetImpl_WebGPU } from "../gfx/platform/GfxPlatformWebGPU";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { clamp, invlerp, lerp, saturate } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { align, nArray } from "../util";
import { SourceRenderContext } from "./Main";
import { ToneMapParams } from "./Materials";

const scratchVec4 = vec4.create();

class LuminanceThreshProgram extends DeviceProgram {
    public override both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc[2];
};

#define u_TexCoordScaleBias (u_Misc[0].xyzw)
#define u_ThreshMin (u_Misc[1].x)
#define u_ThreshMax (u_Misc[1].y)
#define u_ThreshPass (u_Misc[1].z)
`;

    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

${GfxShaderLibrary.CalcScaleBias}
${GfxShaderLibrary.MonochromeNTSCLinear}

void main() {
    gl_FragColor = vec4(1.0);
    vec2 t_TexCoord = CalcScaleBias(v_TexCoord.xy, u_TexCoordScaleBias);
    vec4 t_Sample = texture(SAMPLER_2D(u_Texture), t_TexCoord.xy);
    float t_Luminance = MonochromeNTSCLinear(t_Sample.rgb);
    if (t_Luminance < u_ThreshMin || t_Luminance >= u_ThreshMax) {
        // gl_FragColor = vec4(0.0);
        discard;
    }
}
`;
}

// General strategy: Use a large number of conservative occlusion queries to emulate a test for the amount of pixels
// in each bucket, each one on a small square piece of the framebuffer (known as a "quad"). This lets us know which
// buckets a quad can be in. We then use the rest of the Valve HDR algorithm, except we operate such that each "quad"
// is a pixel.
//
// Tweakables:
//
//   * queriesPerFrame is the number of occlusion queries that should be submitted per frame. In my testing,
//     increasing this did not substantially hurt performance, but it could be lowered at the cost of making the
//     latency of the algorithm more extreme.
//
//   * The grid layout of squares. You can visualize the squares by turning on debugDrawSquares, and the grid
//     layout is decided in updateLayout().

class ImplConservativeOcclFrame {
    public bucket: number = 0;
    public locationStart: number = 0;
    public entryStart: number = 0;
    public pool: GfxQueryPool;

    constructor(device: GfxDevice, num: number) {
        this.pool = device.createQueryPool(GfxQueryPoolType.OcclusionConservative, num);
    }

    public destroy(device: GfxDevice): void {
        device.destroyQueryPool(this.pool);
    }
}

class ImplConservativeOcclBucket {
    public entries: number[] = [];

    public calcSum(): number {
        let sum = 0;
        for (let i = 0; i < this.entries.length; i++)
            sum += this.entries[i];
        return sum;
    }
}

class ImplConservativeOccl {
    private queriesPerFrame = 256;
    private buckets: ImplConservativeOcclBucket[];

    private framePool: ImplConservativeOcclFrame[] = [];
    private submittedFrames: ImplConservativeOcclFrame[] = [];

    private dummyTargetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private baseScaleBias = vec4.create();

    private counter = 0;
    private numLocationsX = 0;
    private numLocationsY = 0;
    private numLocationsPerBucket = 0;

    public debugDrawSquares: boolean = false;

    constructor(cache: GfxRenderCache, private histogram: LuminanceHistogram) {
        this.gfxProgram = cache.createProgram(new LuminanceThreshProgram());
        this.dummyTargetDesc.colorClearColor = White;
        this.buckets = nArray(this.histogram.bucketArea.length, () => new ImplConservativeOcclBucket());
    }

    private peekFrame(device: GfxDevice, frame: ImplConservativeOcclFrame): number | null {
        let numQuads = 0;
        for (let i = 0; i < this.queriesPerFrame; i++) {
            const visible = device.queryPoolResultOcclusion(frame.pool, i);
            if (visible === null)
                return null;
            if (visible)
                numQuads++;
        }
        return numQuads;
    }

    public updateHistogramBuckets(bucketArea: Uint32Array): void {
        for (let i = 0; i < this.histogram.bucketCount; i++)
            bucketArea[i] = this.buckets[i].calcSum();
    }

    private updateFromFinishedFrames(device: GfxDevice): void {
        for (let i = 0; i < this.submittedFrames.length; i++) {
            const frame = this.submittedFrames[i];
            const numQuads = this.peekFrame(device, frame);
            if (numQuads !== null) {
                // Update the bucket.
                const bucket = this.buckets[frame.bucket];
                bucket.entries[frame.entryStart] = numQuads;

                // Add to free list.
                this.submittedFrames.splice(i--, 1);
                this.framePool.push(frame);
            }
        }
    }

    private newFrame(device: GfxDevice): ImplConservativeOcclFrame {
        if (this.framePool.length > 0)
            return this.framePool.pop()!;
        else
            return new ImplConservativeOcclFrame(device, this.queriesPerFrame);
    }

    private updateLayout(desc: GfxrRenderTargetDescription): void {
        // Each bucket contains N quads which cover a different part of the frame (we're using many
        // conservative occlusion queries to emulate pixel coverage queries).

        this.numLocationsX = 16;
        this.numLocationsY = 16;
        this.numLocationsPerBucket = this.numLocationsX * this.numLocationsY;

        // We choose a square in the middle of the frame to keep aspect ratio identical between X/Y.
        const minDimension = Math.min(desc.width, desc.height);
        const minDiv = Math.min(this.numLocationsX, this.numLocationsY);

        const quadLength = (minDimension / minDiv) | 0;
        this.dummyTargetDesc.setDimensions(quadLength, quadLength, 1);

        // Now choose the base scale/bias.

        const normW = minDimension / desc.width;
        const normH = minDimension / desc.height;
        this.baseScaleBias[0] = normW / this.numLocationsX;
        this.baseScaleBias[1] = normH / this.numLocationsY;
        this.baseScaleBias[2] = (1.0 - normW) / 2;
        this.baseScaleBias[3] = (1.0 - normH) / 2;
    }

    private calcLocationScaleBias(dst: vec4, i: number): void {
        // Scramble the location a bit.
        i *= 7;

        const location = i % this.numLocationsPerBucket;

        // Choose the quad.
        const y = (location / this.numLocationsX) | 0;
        const x = location % this.numLocationsX;

        dst[0] = this.baseScaleBias[0];
        dst[1] = this.baseScaleBias[1];
        dst[2] = x * this.baseScaleBias[0] + this.baseScaleBias[2];
        dst[3] = y * this.baseScaleBias[1] + this.baseScaleBias[3];
    }

    private debugBucket = -1;
    private chooseBucketAndLocationSet(dst: ImplConservativeOcclFrame): void {
        const counter = this.counter++;
        const numBuckets = this.histogram.bucketCount;
        dst.bucket = counter % numBuckets;

        if (this.debugBucket >= 0)
            dst.bucket = this.debugBucket;

        dst.locationStart = (((counter / numBuckets) | 0) * this.queriesPerFrame) % this.numLocationsPerBucket;
        dst.entryStart = (dst.locationStart / this.queriesPerFrame) | 0;
    }

    public debugDraw(ctx: CanvasRenderingContext2D): void {
        if (this.histogram.debugDrawHistogram) {
            const width = 350;
            const height = 150;
            const marginTop = 32, marginRight = 32;
    
            const x = ctx.canvas.width - marginRight - width;
            const y = 0 + marginTop;

            const tickBarY = height + 50;

            ctx.save();
            ctx.lineWidth = 2;
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'white';
            ctx.shadowColor = 'black';
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            drawScreenSpaceText(ctx, x, tickBarY + 100, `Impl: Occlusion Query`, White, { outline: 2, align: 'left' });
            ctx.restore();
        }

        if (this.debugDrawSquares) {
            ctx.save();
            for (let i = 0; i < this.submittedFrames.length; i++) {
                const frame = this.submittedFrames[i];
                const color = colorNewCopy(White);
                colorLerp(color, Red, Green, frame.bucket / (this.histogram.bucketCount - 1));
                color.a = 0.1;

                ctx.beginPath();
                ctx.fillStyle = colorToCSS(color);
                for (let j = 0; j < this.queriesPerFrame; j++) {
                    this.calcLocationScaleBias(scratchVec4, frame.locationStart + j);
                    // Location scale-bias takes us from 0...1 and gives us normalized screen coordinates (0...1 in viewport space)
                    const x1 = ((0 * scratchVec4[0]) + scratchVec4[2]) * ctx.canvas.width;
                    const y1 = ((0 * scratchVec4[1]) + scratchVec4[3]) * ctx.canvas.height;
                    const x2 = ((1 * scratchVec4[0]) + scratchVec4[2]) * ctx.canvas.width;
                    const y2 = ((1 * scratchVec4[1]) + scratchVec4[3]) * ctx.canvas.height;
                    ctx.rect(x1, y1, x2-x1, y2-y1);
                }
                ctx.fill();
            }
            ctx.restore();
        }
    }

    public pushPasses(renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, colorTargetID: GfxrRenderTargetID): void {
        this.updateFromFinishedFrames(renderInstManager.gfxRenderCache.device);

        const colorTargetDesc = builder.getRenderTargetDescription(colorTargetID);
        this.updateLayout(colorTargetDesc);

        const device = renderInstManager.gfxRenderCache.device;

        // We, unfortunately, have to render to a target for the occlusion query to function, so make a dummy one.
        const dummyTargetID = builder.createRenderTargetID(this.dummyTargetDesc, 'LuminanceHistogram Dummy');

        const resolvedColorTextureID = builder.resolveRenderTarget(colorTargetID);

        const frame = this.newFrame(device);

        const renderInsts: GfxRenderInst[] = [];

        this.chooseBucketAndLocationSet(frame);
        device.setResourceName(frame.pool, `Bucket ${frame.bucket}`);

        builder.pushPass((pass) => {
            pass.setDebugName('LuminanceHistogram');
            pass.attachOcclusionQueryPool(frame.pool);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, dummyTargetID);

            pass.attachResolveTexture(resolvedColorTextureID);

            for (let j = 0; j < this.queriesPerFrame; j++) {
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setGfxProgram(this.gfxProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                renderInst.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
                renderInst.drawPrimitives(3);

                let offs = renderInst.allocateUniformBuffer(0, 8);
                const d = renderInst.mapUniformBufferF32(0);
                this.calcLocationScaleBias(scratchVec4, frame.locationStart + j);
                offs += fillVec4v(d, offs, scratchVec4);
                const bucketMinLuminance = this.histogram.getBucketMinLuminance(frame.bucket);
                const bucketMaxLuminance = this.histogram.getBucketMinLuminance(frame.bucket + 1);
                offs += fillVec4(d, offs, bucketMinLuminance, bucketMaxLuminance, frame.bucket);

                renderInsts.push(renderInst);
            }

            pass.exec((passRenderer, scope) => {
                for (let j = 0; j < this.queriesPerFrame; j++) {
                    const renderInst = renderInsts[j];

                    const resolvedColorTexture = scope.getResolveTextureForID(resolvedColorTextureID);
                    this.textureMapping[0].gfxTexture = resolvedColorTexture;
                    renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

                    passRenderer.beginOcclusionQuery(j);
                    renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
                    passRenderer.endOcclusionQuery();
                }
            });
        });

        this.submittedFrames.push(frame);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.framePool.length; i++)
            this.framePool[i].destroy(device);
        for (let i = 0; i < this.submittedFrames.length; i++)
            this.submittedFrames[i].destroy(device);
    }
}

const histogramProgram = `
struct Params {
    viewport : vec4<f32>,
    bucketCount : f32,
    bucketExpInv : f32,
};

@binding(0) @group(0) var<uniform> params : Params;
@binding(1) @group(0) var<storage, read_write> buckets : array<atomic<u32>>;
@binding(2) @group(0) var frameTex: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) threadID : vec3<u32>) {
    var texCoord = threadID.xy;
    if (texCoord.x >= u32(params.viewport.z) || texCoord.y >= u32(params.viewport.w)) { return; }

    texCoord += vec2<u32>(params.viewport.xy);
    var sample = textureLoad(frameTex, texCoord.xy, 0);

    // Inlined version of GfxShaderLibrary.MonochromeNTSCLinear
    // NTSC primaries. Note that this is designed for linear-space values.
    var luminance = dot(sample.rgb, vec3(0.2125, 0.7154, 0.0721));

    var bucketIdx = u32(pow(luminance, params.bucketExpInv) * params.bucketCount);
    atomicAdd(&(buckets[bucketIdx]), 1u);
}
`;

class ImplComputeFrame {
    public readback: GfxReadback;

    constructor(device: GfxDevice, bucketCount: number) {
        this.readback = device.createReadback(bucketCount * 4);
    }

    public destroy(device: GfxDevice): void {
        device.destroyReadback(this.readback);
    }
}

class ImplCompute {
    private framePool: ImplComputeFrame[] = [];
    private submittedFrames: ImplComputeFrame[] = [];
    private computePipeline: GfxComputePipeline;
    private bucketBuffer: GfxBuffer;
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private results: Uint32Array;
    private hasResults: boolean = false;

    // Viewport configuration.
    private centerRegion = vec2.fromValues(0.9, 0.85);
    private viewport = vec4.create();
    private debugDrawRegion = false;

    constructor(private cache: GfxRenderCache, private histogram: LuminanceHistogram) {
        const device = cache.device;

        const deviceWebGPU = gfxDeviceGetImpl_WebGPU(device).device;
        this.bindGroupLayout = deviceWebGPU.createBindGroupLayout({ 
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, }, },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage', }, },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { multisampled: false, }, },
            ],
        });
        const pipelineLayout = deviceWebGPU.createPipelineLayout({ 
            bindGroupLayouts: [this.bindGroupLayout],
        });

        const program = device.createComputeProgram({ shadingLanguage: GfxShadingLanguage.WGSL, preprocessedComp: histogramProgram });
        this.computePipeline = device.createComputePipeline({ program, pipelineLayout });

        const bucketCount = this.histogram.bucketCount;
        this.bucketBuffer = device.createBuffer(bucketCount, GfxBufferUsage.Storage | GfxBufferUsage.CopySrc, GfxBufferFrequencyHint.Dynamic);

        this.results = new Uint32Array(bucketCount);
    }

    public debugDraw(ctx: CanvasRenderingContext2D): void {
        if (this.histogram.debugDrawHistogram) {
            const width = 350;
            const height = 150;
            const marginTop = 32, marginRight = 32;
    
            const x = ctx.canvas.width - marginRight - width;
            const y = 0 + marginTop;

            const tickBarY = height + 50;

            ctx.save();
            ctx.lineWidth = 2;
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'white';
            ctx.shadowColor = 'black';
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            drawScreenSpaceText(ctx, x, tickBarY + 100, `Impl: Compute`, White, { outline: 2, align: 'left' });
            ctx.restore();
        }

        if (this.debugDrawRegion) {
            drawScreenSpaceBox(ctx, this.viewport[0], this.viewport[1], this.viewport[0] + this.viewport[2], this.viewport[1] + this.viewport[3]);
        }
    }

    private peekFrame(device: GfxDevice, frame: ImplComputeFrame): boolean {
        return device.queryReadbackFinished(this.results, 0, frame.readback);
    }

    private updateFromFinishedFrames(device: GfxDevice): void {
        for (let i = 0; i < this.submittedFrames.length; i++) {
            const frame = this.submittedFrames[i];
            const results = this.peekFrame(device, frame);
            if (results) {
                this.hasResults = true;

                // Add to free list.
                this.submittedFrames.splice(i--, 1);
                this.framePool.push(frame);
            }
        }
    }

    private getFrame(): ImplComputeFrame {
        if (this.framePool.length > 0)
            return this.framePool.pop()!;
        else
            return new ImplComputeFrame(this.cache.device, this.histogram.bucketCount);
    }

    public updateHistogramBuckets(bucketArea: Uint32Array): void {
        if (!this.hasResults)
            return;

        for (let i = 0; i < this.histogram.bucketCount; i++)
            bucketArea[i] = this.results[i];
    }

    private calcViewport(desc: GfxrRenderTargetDescription): void {
        this.viewport[0] = ((1.0 - this.centerRegion[0]) * 0.5) * desc.width;
        this.viewport[1] = ((1.0 - this.centerRegion[1]) * 0.5) * desc.height;
        this.viewport[2] = this.centerRegion[0] * desc.width;
        this.viewport[3] = this.centerRegion[1] * desc.height;
    }

    public pushPasses(renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, colorTargetID: GfxrRenderTargetID): void {
        const cache = renderInstManager.gfxRenderCache, device = cache.device;
        this.updateFromFinishedFrames(device);

        const deviceWebGPU = gfxDeviceGetImpl_WebGPU(device).device;

        const gpuPipeline = (this.computePipeline as any).gpuComputePipeline as (GPUComputePipeline | null);
        if (gpuPipeline === null)
            return;

        if (this.bindGroupLayout === null)
            this.bindGroupLayout = gpuPipeline.getBindGroupLayout(0);

        const bucketCount = this.histogram.bucketCount;
        const frame = this.getFrame();

        // Clear bucket buffer
        device.uploadBufferData(this.bucketBuffer, 0, new Uint8Array(bucketCount * 4));

        builder.pushComputePass((pass) => {
            pass.setDebugName('Luminance Histogram Compute');
            const resolveTextureID = builder.resolveRenderTarget(colorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            const desc = builder.getRenderTargetDescription(colorTargetID);

            this.calcViewport(desc);

            const dynamicByteOffsets: number[] = [0];
            const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
            let uniformBufferOffs = uniformBuffer.allocateChunk(8);
            dynamicByteOffsets[0] = uniformBufferOffs << 2;

            const d = uniformBuffer.mapBufferF32();
            const bucketExpInv = 1.0 / this.histogram.bucketExp;
            uniformBufferOffs += fillVec4v(d, uniformBufferOffs, this.viewport);
            uniformBufferOffs += fillVec4(d, uniformBufferOffs, bucketCount, bucketExpInv);

            pass.exec((pass, scope) => {
                const resolveTexture = scope.getResolveTextureForID(resolveTextureID);

                const bindGroup = deviceWebGPU.createBindGroup({
                    layout: this.bindGroupLayout!,
                    entries: [
                        { binding: 0, resource: { buffer: (uniformBuffer.gfxBuffer as any).gpuBuffer, size: 8*4, }, },
                        { binding: 1, resource: { buffer: (this.bucketBuffer as any).gpuBuffer, }, },
                        { binding: 2, resource: (resolveTexture as any).gpuTextureView, },
                    ],
                });

                pass.setPipeline(this.computePipeline);
                pass.setBindings(0, bindGroup, dynamicByteOffsets);
                const dispatchX = align(desc.width, 8) / 8;
                const dispatchY = align(desc.height, 8) / 8;
                pass.dispatch(dispatchX, dispatchY, 1);
            });

            pass.post((scope) => {
                device.readBuffer(frame.readback, 0, this.bucketBuffer, 0, bucketCount * 4);
                device.submitReadback(frame.readback);
                this.submittedFrames.push(frame);
            });
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyComputePipeline(this.computePipeline);
        device.destroyBuffer(this.bucketBuffer);
    }
}

export class LuminanceHistogram {
    // Bucket configuration.
    public bucketCount = 16;
    public bucketExp: number = 1.5;
    public bucketArea: Uint32Array;

    // Attenuation & easing
    private toneMapScaleHistory: number[] = [];
    private toneMapScaleHistoryCount = 10;

    private impl: ImplConservativeOccl | ImplCompute;

    public debugDrawHistogram: boolean = false;

    constructor(cache: GfxRenderCache) {
        this.bucketArea = new Uint32Array(this.bucketCount);
        this.bucketArea.fill(-1);

        if (cache.device.queryLimits().computeShadersSupported)
            this.impl = new ImplCompute(cache, this);
        else
            this.impl = new ImplConservativeOccl(cache, this);
    }

    public getBucketMinLuminance(i: number): number {
        return Math.pow((i + 0) / this.bucketCount, 1.5);
    }

    public debugDraw(renderContext: SourceRenderContext, toneMapParams: ToneMapParams): void {
        const ctx = getDebugOverlayCanvas2D();

        if (this.debugDrawHistogram) {
            const width = 350;
            const height = 150;
            const marginTop = 32, marginRight = 32;
    
            const x = ctx.canvas.width - marginRight - width;
            const y = 0 + marginTop;

            ctx.save();

            ctx.lineWidth = 2;
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'white';
            ctx.shadowColor = 'black';
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            ctx.beginPath();

            let max = 0;
            for (let i = 0; i < this.bucketArea.length; i++)
                max = Math.max(max, this.bucketArea[i]);

            const spacing = 2;
            for (let i = 0; i < this.bucketArea.length; i++) {
                const bucket = this.bucketArea[i];
                const barHeightPct = bucket / max;
                const barHeight = height * barHeightPct;
                const barY = y + height - barHeight;

                const barX1 = x + width * this.getBucketMinLuminance(i);
                const barX2 = x + width * this.getBucketMinLuminance(i + 1) - spacing;
                ctx.rect(barX1, barY, barX2 - barX1, barHeight);
            }
            ctx.fill();

            // now do target bars

            const targetBar = (pct: number, color: string) => {
                ctx.beginPath();
                ctx.fillStyle = color;
                ctx.rect(x + width * pct - 2, y, 4, height);
                ctx.fill();
            };

            // average pixel
            ctx.save();
            targetBar(toneMapParams.percentTarget, 'rgb(200, 200, 0)');

            const computedTarget = this.findLocationOfPercentBrightPixels(toneMapParams.percentBrightPixels, toneMapParams.percentTarget);
            if (computedTarget !== null)
                targetBar(computedTarget, 'rgb(0, 255, 0)');
            ctx.restore();

            // Axes
            ctx.beginPath();
            ctx.moveTo(x - 5, y);
            ctx.lineTo(x - 5, y + height);
            ctx.lineTo(x + width, y + height);
            ctx.stroke();

            ctx.beginPath();
            const tickBarY = height + 50;
            ctx.rect(x, tickBarY, width, 4);
            ctx.fill();

            const calcMarkerX = (scale: number) => {
                return x + width * invlerp(toneMapParams.autoExposureMin, toneMapParams.autoExposureMax, scale);
            };

            const drawMarker = (scale: number, color: Color) => {
                ctx.save();
                ctx.beginPath();
                ctx.rect(calcMarkerX(scale), tickBarY - 10 + 2, 4, 20);
                ctx.fillStyle = colorToCSS(color);
                ctx.fill();
                ctx.restore();
                drawScreenSpaceText(ctx, calcMarkerX(scale), tickBarY + 30, scale.toFixed(2), color, { outline: 4, align: 'center' });
            };

            ctx.beginPath();
            drawScreenSpaceText(ctx, x, tickBarY + 30, '' + toneMapParams.autoExposureMin, White, { outline: 2, align: 'center' });
            drawScreenSpaceText(ctx, x + width, tickBarY + 30, '' + toneMapParams.autoExposureMax, White, { outline: 2, align: 'center' });

            if (this.toneMapScaleHistory.length >= 1)
                drawMarker(this.toneMapScaleHistory[0], colorNewCopy(Red, 0.8));
            drawMarker(this.calcGoalScale(), colorNewCopy(Cyan, 0.8));
            drawMarker(toneMapParams.toneMapScale, White);

            drawScreenSpaceText(ctx, x, tickBarY + 60, `Bloom Scale: ${toneMapParams.bloomScale}`, White, { outline: 2, align: 'left' });
            if (!renderContext.isUsingHDR())
                drawScreenSpaceText(ctx, x, tickBarY + 90, `Map does not have HDR samples!`, Red, { outline: 2 });
            ctx.restore();
        }

        this.impl.debugDraw(ctx);
    }

    // For details on the algorithm, see https://cdn.cloudflare.steamstatic.com/apps/valve/2008/GDC2008_PostProcessingInTheOrangeBox.pdf#page=26
    // The numbers have since been tweaked: Source seems to use settings now to keep 2% of the pixels above the 60% threshold target.

    private findLocationOfPercentBrightPixels(threshold: number, stickyBin: number | null): number | null {
        let totalArea = 0;
        for (let i = 0; i < this.bucketArea.length; i++)
            totalArea += this.bucketArea[i];

        // Start at the bright end, and keep scanning down until we find a bucket we like.
        let areaTestedPct = 0;
        let rangeTestedPct = 0;
        for (let i = this.bucketArea.length - 1; i >= 0; i--) {
            const bucketArea = this.bucketArea[i];
            if (bucketArea < 0)
                return null;

            const bucketAreaPct = bucketArea / totalArea;
            if (bucketAreaPct <= 0)
                continue;

            const bucketAreaThreshold = threshold - areaTestedPct;
            const bucketMinLuminance = this.getBucketMinLuminance(i);
            const bucketMaxLuminance = this.getBucketMinLuminance(i + 1);
            const bucketLuminanceRange = bucketMaxLuminance - bucketMinLuminance;

            if (bucketAreaPct >= bucketAreaThreshold) {
                if (stickyBin !== null && bucketMinLuminance <= stickyBin && bucketMaxLuminance >= stickyBin) {
                    // "Sticky" bin -- prevents us from oscillating small amounts of lights.
                    return stickyBin;
                }

                const thresholdRatio = bucketAreaThreshold / bucketAreaPct;
                const border = clamp(1.0 - (rangeTestedPct + (bucketLuminanceRange * thresholdRatio)), bucketMinLuminance, bucketMaxLuminance);
                return border;
            }

            areaTestedPct += bucketAreaPct;
            rangeTestedPct += bucketLuminanceRange;
        }

        return null;
    }

    public updateToneMapParams(toneMapParams: ToneMapParams, deltaTime: number): void {
        let locationOfTarget = this.findLocationOfPercentBrightPixels(toneMapParams.percentBrightPixels, toneMapParams.percentTarget);
        if (locationOfTarget === null)
            locationOfTarget = toneMapParams.percentTarget;
        locationOfTarget = Math.max(0.001, locationOfTarget);

        let target = (toneMapParams.percentTarget / locationOfTarget) * toneMapParams.toneMapScale;

        // Also 
        const locationOfAverage = this.findLocationOfPercentBrightPixels(0.5, null);
        if (locationOfAverage !== null)
            target = Math.max(target, toneMapParams.minAvgLum / locationOfAverage);

        this.updateToneMapScale(toneMapParams, target, deltaTime);
    }

    private calcGoalScale(): number {
        let sum = 0.0;
        for (let i = 0; i < this.toneMapScaleHistoryCount; i++) {
            // I think this is backwards -- it generates the weights 1.0, 0.8, 0.6, 0.4, 0.2, 0.0, 0.2, 0.4, 0.6, 0.8...
            // const weight = Math.abs(i - center) / center;
            // I think we should just roll off the weights from 0...1
            const weight = (this.toneMapScaleHistoryCount - i) / 55;
            sum += (weight * this.toneMapScaleHistory[i]);
        }
        return sum;
    }

    private updateToneMapScale(toneMapParams: ToneMapParams, targetScale: number, deltaTime: number): void{
        targetScale = clamp(targetScale, toneMapParams.autoExposureMin, toneMapParams.autoExposureMax);
        this.toneMapScaleHistory.unshift(targetScale);

        if (this.toneMapScaleHistory.length > this.toneMapScaleHistoryCount)
            this.toneMapScaleHistory.length = this.toneMapScaleHistoryCount;

        if (this.toneMapScaleHistory.length < this.toneMapScaleHistoryCount)
            return;

        const goalScale = this.calcGoalScale();

        // Accelerate towards target.
        let rate = toneMapParams.adjustRate * 2.0;
        if (goalScale < toneMapParams.toneMapScale) {
            rate = lerp(rate, toneMapParams.accelerateDownRate * rate, invlerp(0.0, 1.5, toneMapParams.toneMapScale - goalScale));
        }

        let t = rate * deltaTime;
        t = saturate(Math.min(t, 0.25 / this.bucketCount));

        toneMapParams.toneMapScale = lerp(toneMapParams.toneMapScale, goalScale, t);
    }

    public pushPasses(renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, colorTargetID: GfxrRenderTargetID): void {
        this.impl.pushPasses(renderInstManager, builder, colorTargetID);
        this.impl.updateHistogramBuckets(this.bucketArea);
    }

    public destroy(device: GfxDevice): void {
        this.impl.destroy(device);
    }
}
