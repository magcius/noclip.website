import { HIEnt } from "./HIEnt.js";
import { HIEvent } from "./HIEvent.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HISimpleObjAsset {
    public animSpeed: number;
    public initAnimState: number;
    public collType: number;
    public flags: number;

    constructor(stream: RwStream) {
        this.animSpeed = stream.readFloat();
        this.initAnimState = stream.readUint32();
        this.collType = stream.readUint8();
        this.flags = stream.readUint8();
        stream.pos += 2; // padding
    }
}

export class HIEntSimpleObj extends HIEnt {
    public simpAsset: HISimpleObjAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.simpAsset = new HISimpleObjAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
    
    public override handleEvent(event: HIEvent, params: number[], scene: HIScene): void {
        switch (event) {
        case HIEvent.SetSkyDome:
            scene.skydomeManager.addEntity(this, params[0], params[1] !== 0);
            break;
        }
    }
}