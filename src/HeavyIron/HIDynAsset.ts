import { HIBaseAsset } from "./HIBase.js";
import { RwStream } from "./rw/rwcore.js";

export class HIDynAsset extends HIBaseAsset {
    public type: number;
    public version: number;
    public handle: number;

    constructor(stream?: RwStream) {
        super(stream);

        if (stream) {
            this.type = stream.readUint32();
            this.version = stream.readUint16();
            this.handle = stream.readUint16();
        }
    }
}