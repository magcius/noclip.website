
import { GfxBuffer, GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxHostAccessPass } from "../platform/GfxPlatform";
import { assert } from "../../util";

// Implements a high-level resizable buffer that uses the platform GfxBuffer under the hood.

// D3D11 UBOs are capped to 64KiB in size (16k words). ANGLE appears to have a bug
// and starts copying everywhere if you go over that limit.
const UBO_PAGE_WORD_LIMIT = 0x4000;

// TODO(jstpierre): Need to make sure we don't split UBOs across multiple pages.
export class GfxRenderBuffer {
    private usesMultiplePages: boolean;
    private bufferPages: GfxBuffer[] = [];
    private wordCount: number = 0;
    private shadowBufferF32: Float32Array | null = null;
    private shadowBufferU8: Uint8Array | null = null;
    private pageDirty: boolean[] = [];

    constructor(public usage: GfxBufferUsage, public frequencyHint: GfxBufferFrequencyHint, public resourceName: string = "Unnamed GfxResourceBuffer") {
    }

    public setWordCount(device: GfxDevice, newWordCount: number) {
        if (newWordCount > this.wordCount) {
            this.wordCount = newWordCount;

            if (this.usage === GfxBufferUsage.UNIFORM) {
                this.shadowBufferF32 = new Float32Array(this.wordCount);
                this.shadowBufferU8 = new Uint8Array(this.shadowBufferF32.buffer);

                // Drop the last page, since it might not have the right amount of data in it.
                if (this.bufferPages.length)
                    device.destroyBuffer(this.bufferPages.pop());

                const existingWordCount = this.bufferPages.length * UBO_PAGE_WORD_LIMIT;
                let remaining = this.wordCount - existingWordCount;
                while (remaining > 0) {
                    const bufferSize = Math.min(remaining, UBO_PAGE_WORD_LIMIT);
                    const buffer = device.createBuffer(bufferSize, this.usage, this.frequencyHint)
                    device.setResourceName(buffer, `${this.resourceName} Page ${this.bufferPages.length}`);
                    this.bufferPages.push(buffer);
                    remaining -= bufferSize;
                }

                this.pageDirty.length = this.bufferPages.length;
                for (let i = 0; i < this.pageDirty.length; i++)
                    this.pageDirty[i] = false;

                this.usesMultiplePages = true;
            } else {
                this.destroy(device);
                const buffer = device.createBuffer(newWordCount, this.usage, this.frequencyHint);
                device.setResourceName(buffer, `${this.resourceName} Full`);
                this.bufferPages.push(buffer);
                this.pageDirty.push(false);
                this.usesMultiplePages = false;
            }
        }
    }

    public mapBufferF32(wordOffset: number, wordCount: number): Float32Array {
        this.markDirty(wordOffset, wordCount);
        return this.shadowBufferF32;
    }

    private findPageIndex(wordOffset: number): number {
        return (wordOffset / UBO_PAGE_WORD_LIMIT) | 0;
    }

    public markDirty(wordOffset: number, wordCount: number): void {
        // Mark all pages that overlap [wordOffset,wordCount).
        const startPage = this.findPageIndex(wordOffset);
        const endPage = this.findPageIndex(wordOffset + wordCount - 1);
        for (let i = startPage; i <= endPage; i++)
            this.pageDirty[i] = true;
    }

    public uploadSubData(hostAccessPass: GfxHostAccessPass, dstWordOffset: number, data: Float32Array): void {
        // If we have a shadow buffer, copy the data into the shadow buffer.
        // Otherwise, copy it into the backend directly.
        if (this.shadowBufferF32 !== null) {
            this.shadowBufferF32.set(data, dstWordOffset);
            this.markDirty(dstWordOffset, data.length);
        } else {
            // If we don't have a shadow buffer, we should only have one page.
            assert(!this.usesMultiplePages && this.bufferPages.length === 1);
            // TODO(jstpierre): Prevent allocation here. Though we shouldn't run into this case normally.
            hostAccessPass.uploadBufferData(this.bufferPages[0], dstWordOffset, new Uint8Array(data.buffer));
        }
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass): void {
        if (this.shadowBufferU8 !== null) {
            assert(this.usesMultiplePages);
            for (let i = 0; i < this.bufferPages.length; i++) {
                if (!this.pageDirty[i])
                    continue;
                const srcWordOffset = i * UBO_PAGE_WORD_LIMIT;
                const wordCount = Math.min((this.wordCount - srcWordOffset), UBO_PAGE_WORD_LIMIT);
                hostAccessPass.uploadBufferData(this.bufferPages[i], 0, this.shadowBufferU8, srcWordOffset, wordCount);
                this.pageDirty[i] = false;
            }
        }
    }

    public getGfxBuffer(bigWordOffset: number): { buffer: GfxBuffer, wordOffset: number } {
        // Find the correct page.
        assert(bigWordOffset <= this.wordCount);
        if (this.usesMultiplePages) {
            const pageIndex = (bigWordOffset / UBO_PAGE_WORD_LIMIT) | 0;
            return { buffer: this.bufferPages[pageIndex], wordOffset: (bigWordOffset & (UBO_PAGE_WORD_LIMIT - 1)) };
        } else {
            return { buffer: this.bufferPages[0], wordOffset: bigWordOffset };
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bufferPages.length; i++)
            device.destroyBuffer(this.bufferPages[i]);
        this.bufferPages = [];
        this.wordCount = 0;
        this.shadowBufferF32 = null;
        this.shadowBufferU8 = null;
    }
}
