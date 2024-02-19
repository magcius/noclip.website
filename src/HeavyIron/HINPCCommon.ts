import { HIEnt } from "./HIEnt.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HIEntNPCAsset {
    public npcFlags: number;
    public npcModel: number;
    public npcProps: number;
    public movepoint: number;
    public taskWidgetPrime: number;
    public taskWidgetSecond: number;

    constructor(stream: RwStream) {
        this.npcFlags = stream.readInt32();
        this.npcModel = stream.readInt32();
        this.npcProps = stream.readInt32();
        this.movepoint = stream.readUint32();
        this.taskWidgetPrime = stream.readUint32();
        this.taskWidgetSecond = stream.readUint32();
    }
}

export class HINPCCommon extends HIEnt {
    public npcAsset: HIEntNPCAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.npcAsset = new HIEntNPCAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
}