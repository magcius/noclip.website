import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import {
    readDescent2Robot,
    readDescent2Tmap,
    readDescent2WClip,
    readDescentEClip,
    readDescentJoint,
    readDescentPowerUp,
    readDescentReactor,
    readDescentVClip,
} from "../Common/AssetReaders";
import { DescentGameDataSource } from "../Common/AssetSource";
import {
    DescentEClip,
    DescentJoint,
    DescentPowerUp,
    DescentReactor,
    DescentRobot,
    DescentTmap,
    DescentVClip,
    DescentWClip,
} from "../Common/AssetTypes";
import { DescentDataReader } from "../Common/DataReader";
import { DescentPolymodel, readPolymodel } from "../Common/Polymodel";

export class Descent2HamFile implements DescentGameDataSource {
    public readonly gameVersion: 2 = 2;
    private hamVersion: number;

    public pigTextureIds: number[] = [];
    public tmaps: DescentTmap[] = [];
    public vclips: DescentVClip[] = [];
    public eclips: DescentEClip[] = [];
    public wclips: DescentWClip[] = [];
    public robots: DescentRobot[] = [];
    public joints: DescentJoint[] = [];
    public powerUps: DescentPowerUp[] = [];
    public polymodels: DescentPolymodel[] = [];
    public objBitmapIds: number[] = [];
    public objBitmapPointers: number[] = [];
    public playerModelNum: number;
    public reactors: DescentReactor[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        const reader = new DescentDataReader(buffer);
        const header = reader.readString(4);
        assert(header === "HAM!");

        const version = reader.readInt32();
        assert(version === 2 || version === 3);
        this.hamVersion = version;
        // Skip sound pointer
        if (version === 2) reader.offset += 4;

        const bitmapCount = reader.readInt32();
        for (let i = 0; i < bitmapCount; ++i) {
            // PIG texture IDs
            this.pigTextureIds.push(reader.readUint16());
        }
        for (let i = 0; i < bitmapCount; ++i) {
            // TMAP objects
            this.tmaps.push(readDescent2Tmap(reader));
            this.tmaps[i].id = i;
        }

        const soundCount = reader.readInt32();
        reader.offset += soundCount * 2;

        const vclipCount = reader.readInt32();
        for (let i = 0; i < vclipCount; ++i) {
            this.vclips.push(readDescentVClip(reader));
        }

        const eclipCount = reader.readInt32();
        for (let i = 0; i < eclipCount; ++i) {
            this.eclips.push(readDescentEClip(reader));
        }

        const wclipCount = reader.readInt32();
        for (let i = 0; i < wclipCount; ++i) {
            this.wclips.push(readDescent2WClip(reader));
        }

        const robotCount = reader.readInt32();
        for (let i = 0; i < robotCount; ++i) {
            this.robots.push(readDescent2Robot(reader));
        }

        const jointCount = reader.readInt32();
        for (let i = 0; i < jointCount; ++i) {
            this.joints.push(readDescentJoint(reader));
        }

        const weaponCount = reader.readInt32();
        // Skip weapons
        reader.offset += weaponCount * (version === 2 ? 118 : 125);

        const powerUpCount = reader.readInt32();
        for (let i = 0; i < powerUpCount; ++i) {
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
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[i].dyingModelId = reader.readInt32();
        }
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[i].deadModelId = reader.readInt32();
        }

        const gaugeCount = reader.readInt32();
        // Skip gauges
        reader.offset += gaugeCount * 4;

        const objBitmapCount = reader.readInt32();
        for (let i = 0; i < objBitmapCount; ++i) {
            this.objBitmapIds.push(reader.readUint16());
        }
        for (let i = 0; i < objBitmapCount; ++i) {
            this.objBitmapPointers.push(reader.readUint16());
        }
        this.playerModelNum = reader.readUint32();
        // Skip rest of player data
        reader.offset += 4 * 8 + 8 * 3 * 4;

        const cockpitCount = reader.readInt32();
        // Skip cockpits
        reader.offset += cockpitCount * 2;

        reader.readInt32();

        const reactorCount = reader.readInt32();
        for (let i = 0; i < reactorCount; ++i) {
            this.reactors.push(readDescentReactor(reader));
        }
    }

    public destroy(): void {}
}
