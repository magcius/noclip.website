import { HIEnt } from "./HIEnt.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

export class HIEntDestructObjAsset {
    public animSpeed: number;
    public initAnimState: number;
    public health: number;
    public spawnItemID: number;
    public dflags: number;
    public collType: number;
    public fxType: number;
    public blast_radius: number;
    public blast_strength: number;
    public shrapnelID_destroy: number;
    public shrapnelID_hit: number;
    public sfx_destroy: number;
    public sfx_hit: number;
    public hitModel: number;
    public destroyModel: number;

    constructor(stream: RwStream) {
        this.animSpeed = stream.readFloat();
        this.initAnimState = stream.readUint32();
        this.health = stream.readUint32();
        this.spawnItemID = stream.readUint32();
        this.dflags = stream.readUint32();
        this.collType = stream.readUint8();
        this.fxType = stream.readUint8();
        stream.pos += 2; // padding
        this.blast_radius = stream.readFloat();
        this.blast_strength = stream.readFloat();
        this.shrapnelID_destroy = stream.readUint32();
        this.shrapnelID_hit = stream.readUint32();
        this.sfx_destroy = stream.readUint32();
        this.sfx_hit = stream.readUint32();
        this.hitModel = stream.readUint32();
        this.destroyModel = stream.readUint32();
    }
}

export class HIEntDestructObj extends HIEnt {
    public destructAsset: HIEntDestructObjAsset;

    constructor(stream: RwStream) {
        super(stream);
        this.destructAsset = new HIEntDestructObjAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
}