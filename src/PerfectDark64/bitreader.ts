import ArrayBufferSlice from "../ArrayBufferSlice";

export default class BitReader {
    private accBits: number = 0;
    private accValue: number = 0;
    private view: DataView;
    private offset: number = 0;

    constructor(data: ArrayBufferSlice) {
        this.view = data.createDataView();
    }

    read(nBits: number): number {
        while (this.accBits < nBits) {
            this.accValue = (this.accValue << 8) | this.view.getUint8(this.offset);
            this.offset++;
            this.accBits += 8;
        }

        this.accBits -= nBits;
        return (this.accValue >>> this.accBits) & ((1 << nBits) - 1);
    }
}
