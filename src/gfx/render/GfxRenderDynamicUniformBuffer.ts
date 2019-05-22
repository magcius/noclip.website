
import { GfxBuffer, GfxDevice, GfxHostAccessPass, GfxBufferUsage, GfxBufferFrequencyHint } from "../platform/GfxPlatform";
import { align, assert, hexzero } from "../../util";

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
        wordCount = align(wordCount, this.uniformBufferWordAlignment);
        assert(wordCount < this.uniformBufferMaxPageWordSize);

        let wordOffset = this.currentWordOffset;

        // If we straddle the page, then put it at the start of the next one.
        if (this.findPageIndex(wordOffset) !== this.findPageIndex(wordOffset + wordCount - 1))
            wordOffset = align(wordOffset, this.uniformBufferMaxPageWordSize);

        this.currentWordOffset = wordOffset + wordCount;
        return wordOffset;
    }

    private ensureShadowBuffer(wordOffset: number, wordCount: number): void {
        if (this.shadowBufferF32 === null) {
            this.shadowBufferU8 = new Uint8Array(this.currentWordOffset * 4);
            this.shadowBufferF32 = new Float32Array(this.shadowBufferU8.buffer);
        } else if (wordOffset + wordCount >= this.shadowBufferF32.length) {
            assert(wordOffset < this.currentWordOffset && wordOffset + wordCount < this.currentWordOffset);

            // Grow logarithmically.
            const newBuffer = new Uint8Array(Math.max(this.currentWordOffset, this.shadowBufferF32.length * 2) * 4);

            newBuffer.set(this.shadowBufferU8, 0);
            this.shadowBufferU8 = newBuffer;
            this.shadowBufferF32 = new Float32Array(this.shadowBufferU8.buffer);
        }
    }

    // TODO(jstpierre): This API is kind of bad for initial performance...
    public mapBufferF32(wordOffset: number, wordCount: number): Float32Array {
        this.ensureShadowBuffer(wordOffset, wordCount);
        return this.shadowBufferF32;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass): void {
        if (this.shadowBufferF32.length !== this.currentBufferWordSize) {
            this.currentBufferWordSize = this.shadowBufferF32.length;

            if (this.gfxBuffer !== null)
                device.destroyBuffer(this.gfxBuffer);

            this.gfxBuffer = device.createBuffer(this.currentBufferWordSize, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        }

        hostAccessPass.uploadBufferData(this.gfxBuffer, 0, this.shadowBufferU8);

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
