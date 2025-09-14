
import { GfxBuffer, GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint } from "../platform/GfxPlatform.js";
import { assert, assertExists, alignNonPowerOfTwo } from "../platform/GfxPlatformUtil.js";

// This is a very basic linear allocator. We allocate offsets in-order.
export class GfxRenderDynamicUniformBuffer {
    private uniformBufferByteAlignment: number;
    private uniformBufferMaxPageByteSize: number;

    private currentBufferByteSize: number = -1;
    private currentByteOffset: number = 0;
    public gfxBuffer: GfxBuffer | null = null;

    private shadowBufferF32: Float32Array | null = null;
    private shadowBufferU8: Uint8Array<ArrayBuffer> | null = null;

    constructor(private device: GfxDevice) {
        const limits = device.queryLimits();
        this.uniformBufferByteAlignment = limits.uniformBufferByteAlignment;
        this.uniformBufferMaxPageByteSize = limits.uniformBufferMaxPageByteSize;
    }

    private findPageIndex(byteOffset: number): number {
        return (byteOffset / this.uniformBufferMaxPageByteSize * 4) | 0;
    }

    public allocateChunk(wordCount: number): number {
        wordCount = alignNonPowerOfTwo(wordCount, this.uniformBufferByteAlignment);

        const byteSize = wordCount * 4;
        assert(byteSize <= this.uniformBufferMaxPageByteSize);
        let byteOffset = this.currentByteOffset;

        // If we straddle the page, then put it at the start of the next one.
        if (this.findPageIndex(byteOffset) !== this.findPageIndex(byteOffset + byteSize - 1))
            byteOffset = alignNonPowerOfTwo(byteOffset, this.uniformBufferMaxPageByteSize);

        this.currentByteOffset = byteOffset + byteSize;
        this.ensureShadowBuffer(byteOffset, byteSize);

        // Make sure it's always a word offset.
        const wordOffset = byteOffset >> 2;
        return wordOffset;
    }

    private ensureShadowBuffer(byteOffset: number, byteSize: number): void {
        if (this.shadowBufferU8 === null) {
            const newWordCount = alignNonPowerOfTwo(this.currentByteOffset, this.uniformBufferMaxPageByteSize);
            const buffer = new ArrayBuffer(newWordCount << 2);
            this.shadowBufferU8 = new Uint8Array(buffer);
            this.shadowBufferF32 = new Float32Array(buffer);
        } else if (byteOffset + byteSize >= this.shadowBufferF32!.byteLength) {
            assert(byteOffset < this.currentByteOffset && byteOffset + byteSize <= this.currentByteOffset);

            // Grow logarithmically, aligned to page size.
            const newByteSize = alignNonPowerOfTwo(Math.max(this.currentByteOffset, this.shadowBufferF32!.length * 2), this.uniformBufferMaxPageByteSize);
            const buffer = this.shadowBufferU8.buffer;
            const newBuffer = buffer.transfer(newByteSize);

            this.shadowBufferU8 = new Uint8Array(newBuffer);
            this.shadowBufferF32 = new Float32Array(newBuffer);

            if (!(this.currentByteOffset <= newByteSize))
                throw new Error(`Assert fail: this.currentWordOffset [${this.currentByteOffset}] <= newWordCount [${newByteSize}]`);
        }
    }

    /**
     * Return the CPU data buffer used internally. Fill this in to submit data to the CPU. Write to
     * it with the offset that was returned from {@see allocateChunk}.
     */
    public mapBufferF32(): Float32Array {
        return this.shadowBufferF32!;
    }

    public prepareToRender(): void {
        if (this.shadowBufferF32 === null) {
            // Nothing to do.
            return;
        }

        const shadowBufferF32 = assertExists(this.shadowBufferF32);

        if (shadowBufferF32.byteLength !== this.currentBufferByteSize) {
            this.currentBufferByteSize = shadowBufferF32.byteLength;

            if (this.gfxBuffer !== null)
                this.device.destroyBuffer(this.gfxBuffer);

            this.gfxBuffer = this.device.createBuffer(this.currentBufferByteSize, GfxBufferUsage.Uniform, GfxBufferFrequencyHint.Dynamic);
            this.device.setResourceName(this.gfxBuffer, `GfxRenderDynamicUniformBuffer`);
        }

        const byteSize = alignNonPowerOfTwo(this.currentByteOffset, this.uniformBufferMaxPageByteSize);
        if (!(byteSize <= this.currentBufferByteSize))
            throw new Error(`Assert fail: byteSize [${byteSize}] (${this.currentByteOffset} aligned ${this.uniformBufferMaxPageByteSize}) <= this.currentBufferByteSize [${this.currentBufferByteSize}]`);

        const gfxBuffer = assertExists(this.gfxBuffer);
        this.device.uploadBufferData(gfxBuffer, 0, this.shadowBufferU8!, 0, byteSize);

        // Reset the offset for next frame.
        // TODO(jstpierre): Should this be a separate step?
        this.currentByteOffset = 0;
    }

    public destroy(): void {
        if (this.gfxBuffer !== null)
            this.device.destroyBuffer(this.gfxBuffer);

        this.shadowBufferF32 = null;
        this.shadowBufferU8 = null;
    }
}
