import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import {
    descentRleDecompress,
    readDescent1Robot,
    readDescent1Tmap,
    readDescent1WClip,
    readDescentEClip,
    readDescentJoint,
    readDescentPowerUp,
    readDescentVClip,
} from "../Common/AssetReaders";
import {
    DescentBitmapSource,
    DescentGameDataSource,
} from "../Common/AssetSource";
import {
    BITMAP_FLAG_RLE,
    DescentEClip,
    DescentJoint,
    DescentPigBitmap,
    DescentPowerUp,
    DescentReactor,
    DescentRobot,
    DescentTmap,
    DescentVClip,
    DescentWClip,
} from "../Common/AssetTypes";
import { DescentDataReader } from "../Common/DataReader";
import { DescentPolymodel, readPolymodel } from "../Common/Polymodel";

export class Descent1PigFile
    implements DescentBitmapSource, DescentGameDataSource
{
    public readonly gameVersion: 1 = 1;
    private dataBase: number;
    private bitmapSoundBase: number;

    public pigTextureIds: number[] = [];
    public tmaps: DescentTmap[] = [];
    public vclips: DescentVClip[] = [];
    public eclips: DescentEClip[] = [];
    public wclips: DescentWClip[] = [];
    public bitmaps: DescentPigBitmap[] = [];
    public robots: DescentRobot[] = [];
    public joints: DescentJoint[] = [];
    public powerUps: DescentPowerUp[] = [];
    public polymodels: DescentPolymodel[] = [];
    public objBitmapIds: number[] = [];
    public objBitmapPointers: number[] = [];
    public playerModelNum: number;
    public readonly reactors: DescentReactor[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        const reader = new DescentDataReader(buffer);
        this.dataBase = reader.readUint32();
        assert(this.dataBase >= 65536);

        // Skip bogus texture count
        reader.offset += 4;
        for (let i = 0; i < 800; ++i) {
            // PIG texture IDs
            this.pigTextureIds.push(reader.readUint16());
        }
        for (let i = 0; i < 800; ++i) {
            // TMAP objects
            this.tmaps.push(readDescent1Tmap(reader));
        }

        // Skip sound data
        reader.offset += 500;

        // Skip bogus VCLIP count
        reader.offset += 4;
        for (let i = 0; i < 70; ++i) {
            this.vclips.push(readDescentVClip(reader));
        }

        // Skip bogus ECLIP count
        reader.offset += 4;
        for (let i = 0; i < 60; ++i) {
            this.eclips.push(readDescentEClip(reader));
        }

        // Skip bogus WCLIP count
        reader.offset += 4;
        for (let i = 0; i < 30; ++i) {
            this.wclips.push(readDescent1WClip(reader));
        }

        // Skip bogus ROBOT count
        reader.offset += 4;
        for (let i = 0; i < 30; ++i) {
            this.robots.push(readDescent1Robot(reader));
        }

        // Skip bogus JOINT count
        reader.offset += 4;
        for (let i = 0; i < 600; ++i) {
            this.joints.push(readDescentJoint(reader));
        }

        // Skip bogus WEAPON count
        reader.offset += 4;
        // Skip weapons
        reader.offset += 30 * 115;

        // Skip bogus POWERUP count
        reader.offset += 4;
        for (let i = 0; i < 29; ++i) {
            this.powerUps.push(readDescentPowerUp(reader));
        }

        const polymodelCount = reader.readInt32();
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels.push(readPolymodel(reader, i));
        }
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[i].data = reader.readBytes(
                this.polymodels[i].dataSize,
            );
        }
        // Skip gauges
        reader.offset += 2 * 80;
        for (let i = 0; i < 85; ++i) {
            const num = reader.readInt32();
            if (i < this.polymodels.length)
                this.polymodels[i].dyingModelId = num;
        }
        for (let i = 0; i < 85; ++i) {
            const num = reader.readInt32();
            if (i < this.polymodels.length)
                this.polymodels[i].deadModelId = num;
        }

        const objBitmapCount = 210;
        for (let i = 0; i < objBitmapCount; ++i) {
            this.objBitmapIds.push(reader.readUint16());
        }
        for (let i = 0; i < objBitmapCount; ++i) {
            this.objBitmapPointers.push(reader.readUint16());
        }
        this.playerModelNum = reader.readUint32();
        // Skip rest of player data
        reader.offset += 4 * 8 + 8 * 3 * 4;

        // Skip the rest of the POF data for now.

        reader.offset = this.dataBase;
        const bitmapCount = reader.readInt32();
        const soundCount = reader.readInt32();

        this.bitmaps.push(
            new DescentPigBitmap("[MISSING]", 0, 64, 64, -1, -1, -1, 0),
        );

        // Read bitmaps
        for (let i = 0; i < bitmapCount; ++i) {
            const localName = reader.readStringWithNulls(8, "@");
            const meta = reader.readUint8();
            const lx = reader.readUint8();
            const ly = reader.readUint8();
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
                    0,
                ),
            );
        }

        // Read sounds only to skip them
        for (let i = 0; i < soundCount; ++i) {
            reader.readStringWithNulls(8, "@");
            reader.readInt32();
            reader.readInt32();
            reader.readInt32();
        }

        this.bitmapSoundBase = reader.offset;
    }

    public loadBitmap(bitmap: DescentPigBitmap): ArrayBufferSlice {
        if (bitmap.flags === -1) {
            return new ArrayBufferSlice(
                new ArrayBuffer(bitmap.width * bitmap.height),
            );
        }

        const reader = new DescentDataReader(this.buffer);
        reader.offset = bitmap.offset + this.bitmapSoundBase;
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
