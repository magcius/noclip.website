import { HIEnt } from "./HIEnt.js";
import { HIEntMotionAsset } from "./HIEntMotion.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HIEntButtonAsset {
    public modelPressedInfoID: number;
    public actMethod: number;
    public initButtonState: number;
    public isReset: number;
    public resetDelay: number;
    public buttonActFlags: number;

    constructor(stream: RwStream) {
        this.modelPressedInfoID = stream.readUint32();
        this.actMethod = stream.readUint32();
        this.initButtonState = stream.readInt32();
        this.isReset = stream.readInt32();
        this.resetDelay = stream.readFloat();
        this.buttonActFlags = stream.readUint32();
    }
}

export class HIEntButton extends HIEnt {
    public buttonAsset: HIEntButtonAsset;
    public motionAsset: HIEntMotionAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.buttonAsset = new HIEntButtonAsset(stream);
        this.motionAsset = new HIEntMotionAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
}