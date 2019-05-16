
// Moderately memory-efficient way of storing some number of bits.

export default class BitMap {
    private words: Uint32Array | null = null;

    constructor(public numBits: number) {
        if (this.numBits > 0) {
            const numWords = (this.numBits + 31) >>> 5;
            this.words = new Uint32Array(numWords);
        }
    }

    public setWord(wordIndex: number, wordValue: number): void {
        this.words[wordIndex] = wordValue;
    }

    public setBit(bitIndex: number, bitValue: boolean): void {
        const wordIndex = bitIndex >>> 5;
        const mask = 1 << (31 - (bitIndex & 0x1F));
        if (bitValue)
            this.words[wordIndex] |= mask;
        else
            this.words[wordIndex] &= ~mask;
    }

    public getBit(bitIndex: number): boolean {
        const wordIndex = bitIndex >>> 5;
        const mask = 1 << (31 - (bitIndex & 0x1F));
        return !!(this.words[wordIndex] & mask);
    }
}
