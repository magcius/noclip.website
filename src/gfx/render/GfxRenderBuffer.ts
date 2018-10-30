
import { GfxBuffer, GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint } from "../platform/GfxPlatform";

// Implements a high-level resizable buffer that uses the platform GfxBuffer under the hood.

export class GfxRenderBuffer {
    private buffer: GfxBuffer | null = null;
    private wordCount: number = 0;

    constructor(public usage: GfxBufferUsage, public frequencyHint: GfxBufferFrequencyHint) {
    }

    public setWordCount(device: GfxDevice, newWordCount: number) {
        if (newWordCount > this.wordCount) {
            console.log(newWordCount, this.wordCount);
            this.destroy(device);
            this.wordCount = newWordCount;
            this.buffer = device.createBuffer(this.wordCount, this.usage, this.frequencyHint);
            // TODO(jstpierre): Copy data from A to B, or demand client does it?
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.buffer !== null) {
            device.destroyBuffer(this.buffer);
            this.buffer = null;
            this.wordCount = 0;
        }
    }

    public getGfxBuffer(): GfxBuffer {
        return this.buffer;
    }
}
