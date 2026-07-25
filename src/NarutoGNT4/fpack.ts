import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { readString } from "../util.js";
import { decompressBuffer } from "./decompress.js";

export class FPackEntry {
    path: string;
    offset: number;
    compressedSize: number;
    uncompressedSize: number;

    constructor(view: ArrayBufferSlice) {
        const dataView = view.createDataView();

        this.path = readString(view, 0x00);
        this.offset = dataView.getUint32(20);
        this.compressedSize = dataView.getUint32(24);
        this.uncompressedSize = dataView.getUint32(28);
    }
}

//FPack Archive
export class FPack {
    fileCount: number;
    headerSize: number;
    fileSize: number;

    entries: FPackEntry[];

    view: ArrayBufferSlice;

    constructor(view: ArrayBufferSlice) {
        this.view = view;

        const dataView = view.createDataView();

        this.fileCount = dataView.getUint32(4);
        this.headerSize = dataView.getUint32(8);
        this.fileSize = dataView.getUint32(12);

        this.entries = [];
        for (let i = 0; i < this.fileCount; i++) {
            const slice = view.slice(this.headerSize + i * 32);
            this.entries.push(new FPackEntry(slice));
        }
    }

    getEntryData(entry: FPackEntry): ArrayBufferSlice {
        const src = new Uint8Array(this.view.arrayBuffer).slice(entry.offset, entry.offset + entry.compressedSize);

        const out = decompressBuffer(src, entry.compressedSize, entry.uncompressedSize);

        return new ArrayBufferSlice(out.buffer);
    }
}