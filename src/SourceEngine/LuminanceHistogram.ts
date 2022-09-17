
import { vec4 } from "gl-matrix";
import { Color, colorLerp, colorNewCopy, colorToCSS, Cyan, Green, Red, White } from "../Color";
import { drawScreenSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxDevice, GfxFormat, GfxQueryPoolType } from "../gfx/platform/GfxPlatform";
import { GfxProgram, GfxQueryPool } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { clamp, invlerp, lerp, saturate } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { SourceRenderContext } from "./Main";
import { ToneMapParams } from "./Materials";

const scratchVec4 = vec4.create();

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

const queriesPerFrame = 256;

class LuminanceFrame {
    public bucket: number = 0;
    public locationStart: number = 0;
    public entryStart: number = 0;
    public pool: GfxQueryPool;

    constructor(device: GfxDevice) {
        this.pool = device.createQueryPool(GfxQueryPoolType.OcclusionConservative, queriesPerFrame);
    }

    public destroy(device: GfxDevice): void {
        device.destroyQueryPool(this.pool);
    }
}

class LuminanceBucket {
    public minLuminance: number = 0.0;
    public maxLuminance: number = 0.0;
    public entries: number[] = [];

    public calcSum(): number {
        let sum = 0;
        for (let i = 0; i < this.entries.length; i++)
            sum += this.entries[i];
        return sum;
    }

    public calcPctOfSingleBin(): number {
        return this.calcSum() / (this.entries.length * queriesPerFrame);
    }
}

export class LuminanceHistogram {
    private framePool: LuminanceFrame[] = [];
    private submittedFrames: LuminanceFrame[] = [];

    private dummyTargetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());

    // Bucket configuration.
    private buckets: LuminanceBucket[] = [];
    private counter = 0;
    private numLocationsX = 0;
    private numLocationsY = 0;
    private numLocationsPerBucket = 0;
    private baseScaleBias = vec4.create();

    // Attenuation & easing
    private toneMapScaleHistory: number[] = [];
    private toneMapScaleHistoryCount = 10;

    public debugDrawHistogram: boolean = false;
    public debugDrawSquares: boolean = false;

    constructor(cache: GfxRenderCache) {
        this.setupBuckets();
        this.gfxProgram = cache.createProgram(new LuminanceThreshProgram());
        this.dummyTargetDesc.colorClearColor = White;
    }

    private setupBuckets(): void {
        const numBuckets = 16;

        for (let i = 0; i < numBuckets; i++) {
            const bucket = new LuminanceBucket();
            bucket.minLuminance = Math.pow((i + 0) / numBuckets, 1.5);
            bucket.maxLuminance = Math.pow((i + 1) / numBuckets, 1.5);
            this.buckets.push(bucket);
        }
    }

    private peekFrame(device: GfxDevice, frame: LuminanceFrame): number | null {
        let numQuads = 0;
        for (let i = 0; i < queriesPerFrame; i++) {
            const visible = device.queryPoolResultOcclusion(frame.pool, i);
            if (visible === null)
                return null;
            if (visible)
                numQuads++;
        }
        return numQuads;
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

    private newFrame(device: GfxDevice): LuminanceFrame {
        if (this.framePool.length > 0)
            return this.framePool.pop()!;
        else
            return new LuminanceFrame(device);
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
    private chooseBucketAndLocationSet(dst: LuminanceFrame): void {
        const counter = this.counter++;
        const numBuckets = this.buckets.length;
        dst.bucket = counter % numBuckets;

        if (this.debugBucket >= 0)
            dst.bucket = this.debugBucket;

        dst.locationStart = (((counter / numBuckets) | 0) * queriesPerFrame) % this.numLocationsPerBucket;
        dst.entryStart = (dst.locationStart / queriesPerFrame) | 0;
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
            for (let i = 0; i < this.buckets.length; i++)
                max = Math.max(max, this.buckets[i].calcPctOfSingleBin());

            const spacing = 2;
            for (let i = 0; i < this.buckets.length; i++) {
                const bucket = this.buckets[i];
                const barHeightPct = bucket.calcPctOfSingleBin() / max;
                const barHeight = height * barHeightPct;
                const barY = y + height - barHeight;

                const barX1 = x + width * bucket.minLuminance;
                const barX2 = x + width * bucket.maxLuminance - spacing;
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

        if (this.debugDrawSquares) {
            ctx.save();
            for (let i = 0; i < this.submittedFrames.length; i++) {
                const frame = this.submittedFrames[i];
                const color = colorNewCopy(White);
                colorLerp(color, Red, Green, frame.bucket / (this.buckets.length - 1));
                color.a = 0.1;

                ctx.beginPath();
                ctx.fillStyle = colorToCSS(color);
                for (let j = 0; j < queriesPerFrame; j++) {
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

    // For details on the algorithm, see https://cdn.cloudflare.steamstatic.com/apps/valve/2008/GDC2008_PostProcessingInTheOrangeBox.pdf#page=26
    // The numbers have since been tweaked: Source seems to use settings now to keep 2% of the pixels above the 60% threshold target.

    private findLocationOfPercentBrightPixels(threshold: number, stickyBin: number | null): number | null {
        let totalQuads = 0;
        for (let i = 0; i < this.buckets.length; i++)
            totalQuads += this.buckets[i].calcSum();

        // Start at the bright end, and keep scanning down until we find a bucket we like.
        let quadsTestedPct = 0;
        let rangeTestedPct = 0;
        for (let i = this.buckets.length - 1; i >= 0; i--) {
            const bucket = this.buckets[i];
            if (bucket.entries.length === 0)
                return null;

            const bucketQuadsPct = bucket.calcSum() / totalQuads;
            if (bucketQuadsPct <= 0)
                continue;

            const bucketQuadsThreshold = threshold - quadsTestedPct;
            const bucketLuminanceRange = bucket.maxLuminance - bucket.minLuminance;

            if (bucketQuadsPct >= bucketQuadsThreshold) {
                if (stickyBin !== null && bucket.minLuminance <= stickyBin && bucket.maxLuminance >= stickyBin) {
                    // "Sticky" bin -- prevents us from oscillating small amounts of lights.
                    return stickyBin;
                }

                const thresholdRatio = bucketQuadsThreshold / bucketQuadsPct;
                const border = clamp(1.0 - (rangeTestedPct + (bucketLuminanceRange * thresholdRatio)), bucket.minLuminance, bucket.maxLuminance);
                return border;
            }

            quadsTestedPct += bucketQuadsPct;
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
        t = saturate(Math.min(t, 0.25 / this.buckets.length));

        toneMapParams.toneMapScale = lerp(toneMapParams.toneMapScale, goalScale, t);
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
        const bucket = this.buckets[frame.bucket];

        device.setResourceName(frame.pool, `Bucket ${frame.bucket}`);

        builder.pushPass((pass) => {
            pass.setDebugName('LuminanceHistogram');
            pass.attachOcclusionQueryPool(frame.pool);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, dummyTargetID);

            pass.attachResolveTexture(resolvedColorTextureID);

            for (let j = 0; j < queriesPerFrame; j++) {
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setGfxProgram(this.gfxProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                renderInst.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
                renderInst.drawPrimitives(3);

                let offs = renderInst.allocateUniformBuffer(0, 8);
                const d = renderInst.mapUniformBufferF32(0);
                this.calcLocationScaleBias(scratchVec4, frame.locationStart + j);
                offs += fillVec4v(d, offs, scratchVec4);
                offs += fillVec4(d, offs, bucket.minLuminance, bucket.maxLuminance, frame.bucket);

                renderInsts.push(renderInst);
            }

            pass.exec((passRenderer, scope) => {
                for (let j = 0; j < queriesPerFrame; j++) {
                    const renderInst = renderInsts[j];

                    const resolvedColorTexture = scope.getResolveTextureForID(resolvedColorTextureID);
                    this.textureMapping[0].gfxTexture = resolvedColorTexture;
                    renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

                    passRenderer.beginOcclusionQuery(j);
                    renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
                    passRenderer.endOcclusionQuery(j);
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
