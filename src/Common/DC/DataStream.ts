
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString } from "../../util";

export class DataStream {
    constructor(
        public buffer: ArrayBufferSlice,
        public view: DataView = buffer.createDataView(),
        public offs: number = 0,
    ) {
    }

    public readUint8(): number { return this.view.getUint8(this.offs++); }
    public readUint16(): number { const v = this.view.getUint16(this.offs, true); this.offs += 0x02; return v; }
    public readUint32(): number { const v = this.view.getUint32(this.offs, true); this.offs += 0x04; return v; }
    public readFloat32(): number { const v = this.view.getFloat32(this.offs, true); this.offs += 0x04; return v; }

    public readString(n: number, n2: number = n): string {
        const v = readString(this.buffer, this.offs, n, false);
        this.offs += n2;
        return v;
    }

    public readStringStream_2b(): string {
        const n = this.readUint16();
        return this.readString(Math.max(n - 1, 0), n);
    }

    public readStringStream_4b(): string {
        const n = this.readUint32();
        return this.readString(Math.max(n - 1, 0), n);
    }

    public readSlice(size: number): ArrayBufferSlice {
        const v = this.buffer.subarray(this.offs, size);
        this.offs += size;
        return v;
    }
}
