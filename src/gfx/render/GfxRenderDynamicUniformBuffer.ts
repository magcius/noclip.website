
import { GfxBuffer, GfxDevice, GfxHostAccessPass, GfxBufferUsage, GfxBufferFrequencyHint } from "../platform/GfxPlatform";
import { assert, assertExists, alignNonPowerOfTwo } from "../../util";

// TODO(jstpierre): Maybe this makes more sense as a native platform object

// This is a very basic linear allocator. We allocate offsets in-order.
export class GfxRenderDynamicUniformBuffer {
    private uniformBufferWordAlignment: number;
    private uniformBufferMaxPageWordSize: number;

    private currentBufferWordSize: number = -1;
    private currentWordOffset: number = 0;
    public gfxBuffer: GfxBuffer | null = null;

    private shadowBufferF32: Float32Array | null = null;
    private shadowBufferU8: Uint8Array | null = null;

    constructor(device: GfxDevice) {
        const limits = device.queryLimits();
        this.uniformBufferWordAlignment = limits.uniformBufferWordAlignment;
        this.uniformBufferMaxPageWordSize = limits.uniformBufferMaxPageWordSize;
    }

    private findPageIndex(wordOffset: number): number {
        return (wordOffset / this.uniformBufferMaxPageWordSize) | 0;
    }

    public allocateChunk(wordCount: number): number {
        wordCount = alignNonPowerOfTwo(wordCount, this.uniformBufferWordAlignment);
        assert(wordCount < this.uniformBufferMaxPageWordSize);

        let wordOffset = this.currentWordOffset;

        // If we straddle the page, then put it at the start of the next one.
        if (this.findPageIndex(wordOffset) !== this.findPageIndex(wordOffset + wordCount - 1))
            wordOffset = alignNonPowerOfTwo(wordOffset, this.uniformBufferMaxPageWordSize);

        this.currentWordOffset = wordOffset + wordCount;
        this.ensureShadowBuffer(wordOffset, wordCount);

        return wordOffset;
    }

    private ensureShadowBuffer(wordOffset: number, wordCount: number): void {
        if (this.shadowBufferU8 === null || this.shadowBufferF32 === null) {
            const newWordCount = alignNonPowerOfTwo(this.currentWordOffset, this.uniformBufferMaxPageWordSize);
            this.shadowBufferU8 = new Uint8Array(newWordCount * 4);
            this.shadowBufferF32 = new Float32Array(this.shadowBufferU8.buffer);
        } else if (wordOffset + wordCount >= this.shadowBufferF32.length) {
            assert(wordOffset < this.currentWordOffset && wordOffset + wordCount <= this.currentWordOffset);

            // Grow logarithmically, aligned to page size.
            const newWordCount = alignNonPowerOfTwo(Math.max(this.currentWordOffset, this.shadowBufferF32.length * 2), this.uniformBufferMaxPageWordSize);
            const newBuffer = new Uint8Array(newWordCount * 4);

            newBuffer.set(this.shadowBufferU8, 0);
            this.shadowBufferU8 = newBuffer;
            this.shadowBufferF32 = new Float32Array(this.shadowBufferU8.buffer);

            if (!(this.currentWordOffset <= newWordCount))
                throw new Error(`Assert fail: this.currentWordOffset [${this.currentWordOffset}] <= newWordCount [${newWordCount}]`);
        }
    }

    /**
     * Return the CPU data buffer used internally. Fill this in to submit data to the CPU. Write to
     * it with the offset that was returned from {@see allocateChunk}.
     */
    public mapBufferF32(): Float32Array {
        return assertExists(this.shadowBufferF32);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass): void {
        if (this.shadowBufferF32 === null) {
            // Nothing to do.
            return;
        }

        const shadowBufferF32 = assertExists(this.shadowBufferF32);

        if (shadowBufferF32.length !== this.currentBufferWordSize) {
            this.currentBufferWordSize = shadowBufferF32.length;

            if (this.gfxBuffer !== null)
                device.destroyBuffer(this.gfxBuffer);

            this.gfxBuffer = device.createBuffer(this.currentBufferWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        }

        const wordCount = alignNonPowerOfTwo(this.currentWordOffset, this.uniformBufferMaxPageWordSize);
        if (!(wordCount <= this.currentBufferWordSize))
            throw new Error(`Assert fail: wordCount [${wordCount}] (${this.currentWordOffset} aligned ${this.uniformBufferMaxPageWordSize}) <= this.currentBufferWordSize [${this.currentBufferWordSize}]`);

        const gfxBuffer = assertExists(this.gfxBuffer);
        hostAccessPass.uploadBufferData(gfxBuffer, 0, this.shadowBufferU8!, 0, wordCount * 4);

        // Reset the offset for next frame.
        // TODO(jstpierre): Should this be a separate step?
        this.currentWordOffset = 0;
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxBuffer !== null)
            device.destroyBuffer(this.gfxBuffer);

        this.shadowBufferF32 = null;
        this.shadowBufferU8 = null;
    }
}
