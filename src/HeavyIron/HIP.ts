import ArrayBufferSlice from "../ArrayBufferSlice.js";

class HIPStream {
    public view: DataView;
    public stack: any = [];
    public pos = 0;

    constructor(public buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public readLong(): number {
        const x = this.view.getUint32(this.pos, false);
        this.pos += 4;
        return x;
    }

    public readString(): string {
        let s = '';
        while (true) {
            const c = this.view.getUint8(this.pos++);
            if (c === 0) {
                break;
            }
            s += String.fromCharCode(c);
        }
        if (!(s.length & 1)) {
            this.pos++;
        }
        return s;
    }

    public enterBlock(): number {
        if (this.pos + 8 > this.getBlockEnd()) {
            return 0;
        }

        const id = this.readLong();
        const len = this.readLong();

        this.stack.push({ id: id, end: this.pos + len });

        return id;
    }

    public exitBlock(): void {
        this.pos = this.stack.pop()!.end;
    }

    public getBlockEnd(): number {
        return this.stack.length > 0 ?
            this.stack[this.stack.length-1].end :
            this.buffer.byteLength;
    }
}

export interface HIPAsset {
    id: number;
    type: number;
    name: string;
    rawData: ArrayBufferSlice;
    runtimeData?: any;
}

export interface HIPLayer {
    type: number;
    assets: HIPAsset[];
}

enum HIPBlockID {
    HIPA = 0x48495041,
    PACK = 0x5041434B,
    PVER = 0x50564552,
    PFLG = 0x50464C47,
    PCNT = 0x50434E54,
    PCRT = 0x50435254,
    PMOD = 0x504D4F44,
    PLAT = 0x504C4154,
    DICT = 0x44494354,
    ATOC = 0x41544F43,
    AINF = 0x41494E46,
    AHDR = 0x41484452,
    ADBG = 0x41444247,
    LTOC = 0x4C544F43,
    LINF = 0x4C494E46,
    LHDR = 0x4C484452,
    LDBG = 0x4C444247,
    STRM = 0x5354524D,
    DHDR = 0x44484452,
    DPAK = 0x4450414B
}

export class HIPFile {
    public assets: HIPAsset[] = [];
    public layers: HIPLayer[] = [];

    public findAsset(id: number): HIPAsset | undefined {
        return this.assets.find((asset: HIPAsset) => {
            return asset.id === id;
        });
    }

    public static read(buffer: ArrayBufferSlice): HIPFile {
        const hip = new HIPFile();
        const stream = new HIPStream(buffer);

        // We only read the chunks we care about at the moment
        let cid: number;
        while (cid = stream.enterBlock()) {
            switch (cid) {
            case HIPBlockID.DICT:
                this.readDICT(hip, stream);
                break;
            }
            stream.exitBlock();
        }

        return hip;
    }

    private static readDICT(hip: HIPFile, stream: HIPStream) {
        let cid: number;
        while (cid = stream.enterBlock()) {
            switch (cid) {
            case HIPBlockID.ATOC:
                this.readATOC(hip, stream);
                break;
            case HIPBlockID.LTOC:
                this.readLTOC(hip, stream);
                break;
            }
            stream.exitBlock();
        }
    }

    private static readATOC(hip: HIPFile, stream: HIPStream) {
        let cid: number;
        while (cid = stream.enterBlock()) {
            switch (cid) {
            case HIPBlockID.AHDR:
                this.readAHDR(hip, stream);
                break;
            }
            stream.exitBlock();
        }
    }

    private static readAHDR(hip: HIPFile, stream: HIPStream) {
        const id = stream.readLong();
        const type = stream.readLong();
        const offset = stream.readLong();
        const size = stream.readLong();
        const plus = stream.readLong();
        const flags = stream.readLong();

        const rawData = stream.buffer.subarray(offset, size);

        const asset: HIPAsset = { id, type, name: '', rawData };

        let cid: number;
        while (cid = stream.enterBlock()) {
            switch (cid) {
            case HIPBlockID.ADBG:
                this.readADBG(hip, stream, asset);
                break;
            }
            stream.exitBlock();
        }

        hip.assets.push(asset);
    }

    private static readADBG(hip: HIPFile, stream: HIPStream, asset: HIPAsset) {
        const align = stream.readLong();
        const name = stream.readString();
        const filename = stream.readString();
        const checksum = stream.readLong();

        asset.name = name;
    }

    private static readLTOC(hip: HIPFile, stream: HIPStream) {
        let cid: number;
        while (cid = stream.enterBlock()) {
            switch (cid) {
            case HIPBlockID.LHDR:
                this.readLHDR(hip, stream);
                break;
            }
            stream.exitBlock();
        }
    }

    private static readLHDR(hip: HIPFile, stream: HIPStream) {
        const type = stream.readLong();
        const refCount = stream.readLong();
        const assets = [];
        for (let i = 0; i < refCount; i++) {
            const ref = stream.readLong();
            const asset = hip.findAsset(ref);
            if (asset) {
                assets.push(asset);
            }
        }
        hip.layers.push({ type, assets: assets });
    }
}