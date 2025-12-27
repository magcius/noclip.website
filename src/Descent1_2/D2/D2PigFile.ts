import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { descentRleDecompress } from "../Common/AssetReaders";
import { DescentBitmapSource } from "../Common/AssetSource";
import {
    BITMAP_FLAG_RLE,
    DescentEClip,
    DescentPigBitmap,
    DescentTmap,
    DescentVClip,
    DescentWClip,
} from "../Common/AssetTypes";
import { DescentDataReader } from "../Common/DataReader";

export class Descent2PigFile implements DescentBitmapSource {
    public readonly gameVersion: 2 = 2;
    private bitmapBase: number;

    public pigTextureIds: number[] = [];
    public tmaps: DescentTmap[] = [];
    public vclips: DescentVClip[] = [];
    public eclips: DescentEClip[] = [];
    public wclips: DescentWClip[] = [];
    public bitmaps: DescentPigBitmap[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        // Build an index of files from the HOG file.
        const reader = new DescentDataReader(buffer);
        const header = reader.readString(4);
        assert(header === "PPIG");

        const version = reader.readInt32();
        assert(version === 2);

        const bitmapCount = reader.readInt32();

        this.bitmaps.push(
            new DescentPigBitmap("[MISSING]", 0, 64, 64, -1, -1, -1, 0),
        );

        // Read bitmaps
        for (let i = 0; i < bitmapCount; ++i) {
            const localName = reader.readStringWithNulls(8, "@");
            const meta = reader.readUint8();
            const lx = reader.readUint8();
            const ly = reader.readUint8();
            const extension = reader.readUint8();
            const flags = reader.readUint8();
            const average = reader.readUint8();
            const offset = reader.readUint32();
            this.bitmaps.push(
                new DescentPigBitmap(
                    localName,
                    meta,
                    lx,
                    ly,
                    flags,
                    average,
                    offset,
                    extension,
                ),
            );
        }

        this.bitmapBase = reader.offset;
    }

    public loadBitmap(bitmap: DescentPigBitmap): ArrayBufferSlice {
        if (bitmap.flags === -1) {
            return new ArrayBufferSlice(
                new ArrayBuffer(bitmap.width * bitmap.height),
            );
        }

        const reader = new DescentDataReader(this.buffer);
        reader.offset = bitmap.offset + this.bitmapBase;
        if (bitmap.flags & BITMAP_FLAG_RLE) {
            // RLE encoded data
            const size = reader.readUint32();
            return new ArrayBufferSlice(
                descentRleDecompress(bitmap, reader.readBytes(size)),
            );
        } else {
            return reader.readBytes(bitmap.width * bitmap.height);
        }
    }

    public destroy(): void {}
}
