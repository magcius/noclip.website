import ArrayBufferSlice from "../ArrayBufferSlice";

export class DataStream {
    constructor(
        public buffer: ArrayBufferSlice,
        public view: DataView = buffer.createDataView(),
        public offs: number = 0,
        public littleEndian: boolean = false,
    ) {
    }

    public readUint8(): number { return this.view.getUint8(this.offs++); }
    public readUint16(): number { const v = this.view.getUint16(this.offs, this.littleEndian); this.offs += 0x02; return v; }
    public readUint32(): number { const v = this.view.getUint32(this.offs, this.littleEndian); this.offs += 0x04; return v; }
    public readFloat32(): number { const v = this.view.getFloat32(this.offs, this.littleEndian); this.offs += 0x04; return v; }

    public readSlice(size: number): ArrayBufferSlice {
        const v = this.buffer.subarray(this.offs, size);
        this.offs += size;
        return v;
    }
}
