import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { readDescent2Robot, readDescentJoint } from "../Common/AssetReaders";
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

export class Descent2VHamFile implements DescentGameDataSource {
    public readonly gameVersion: 2 = 2;

    public pigTextureIds: number[];
    public tmaps: DescentTmap[];
    public vclips: DescentVClip[];
    public eclips: DescentEClip[];
    public wclips: DescentWClip[];
    public robots: DescentRobot[];
    public joints: DescentJoint[];
    public powerUps: DescentPowerUp[];
    public polymodels: DescentPolymodel[];
    public objBitmapIds: number[];
    public objBitmapPointers: number[];
    public playerModelNum: number;
    public reactors: DescentReactor[];

    constructor(
        private buffer: ArrayBufferSlice,
        hamBase: DescentGameDataSource,
    ) {
        this.pigTextureIds = [...hamBase.pigTextureIds];
        this.tmaps = [...hamBase.tmaps];
        this.vclips = [...hamBase.vclips];
        this.eclips = [...hamBase.eclips];
        this.wclips = [...hamBase.wclips];
        this.robots = [...hamBase.robots];
        this.joints = [...hamBase.joints];
        this.powerUps = [...hamBase.powerUps];
        this.polymodels = [...hamBase.polymodels];
        this.objBitmapIds = [...hamBase.objBitmapIds];
        this.objBitmapPointers = [...hamBase.objBitmapPointers];
        this.playerModelNum = hamBase.playerModelNum;
        this.reactors = [...hamBase.reactors];

        const reader = new DescentDataReader(buffer);
        const header = reader.readString(4);
        assert(header === "MAHX");

        const version = reader.readInt32();
        assert(version === 1);

        const weaponCount = reader.readInt32();
        // Skip weapons
        reader.offset += weaponCount * 125;

        const robotCount = reader.readInt32();
        for (let i = 0; i < robotCount; ++i) {
            this.robots.push(readDescent2Robot(reader));
        }

        const jointCount = reader.readInt32();
        for (let i = 0; i < jointCount; ++i) {
            this.joints.push(readDescentJoint(reader));
        }

        const polymodelCount = reader.readInt32();
        const polymodelOffset = this.polymodels.length;
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels.push(readPolymodel(reader, polymodelOffset + i));
        }
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[polymodelOffset + i].data = reader.readBytes(
                this.polymodels[polymodelOffset + i].dataSize,
            );
        }
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[polymodelOffset + i].dyingModelId =
                reader.readInt32();
        }
        for (let i = 0; i < polymodelCount; ++i) {
            this.polymodels[polymodelOffset + i].deadModelId =
                reader.readInt32();
        }

        // D2 -> D2 Vertigo VHAM fixed offsets
        this.objBitmapIds.length = 422;
        this.objBitmapPointers.length = 502;

        const objBitmapCount = reader.readInt32();
        for (let i = 0; i < objBitmapCount; ++i) {
            this.objBitmapIds.push(reader.readUint16());
        }
        const objBitmapPointerCount = reader.readInt32();
        for (let i = 0; i < objBitmapPointerCount; ++i) {
            this.objBitmapPointers.push(reader.readUint16());
        }
    }

    public destroy(): void {}
}
