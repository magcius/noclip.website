import { HIEnt } from "./HIEnt.js";
import { HIModelInstance } from "./HIModel.js";
import { HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";

const enum SB_model_index {
    body = 4,
    arm_l = 3,
    arm_r = 2,
    ass = 1,
    underwear = 0,
    wand = 5,
    tongue = 6,
    bubble_helmet = 7,
    bubble_shoe_l = 8,
    bubble_shoe_r = 9,
    shadow_body = 13,
    shadow_arm_l = 12,
    shadow_arm_r = 11,
    shadow_wand = 10,
    count = 14
}

export class HIEntPlayerAsset {
    public lightKitID: number;

    constructor(stream: RwStream) {
        this.lightKitID = stream.readUint32();
    }
}

export class HIEntPlayer extends HIEnt {
    public playerAsset: HIEntPlayerAsset;
    public sb_models: HIModelInstance[] = [];

    constructor(stream: RwStream) {
        super(stream);
        this.readLinks(stream);
        this.playerAsset = new HIEntPlayerAsset(stream);
    }

    public override setup(scene: HIScene): void {
        this.parseModelInfo(this.entAsset.modelInfoID, scene);

        let modelIndex = 0;
        for (let modelInst = this.model; modelInst !== null; modelInst = modelInst.next) {
            this.sb_models.push(modelInst);
            modelInst.hide();
            modelIndex++;
        }

        this.sb_models[SB_model_index.body].show();
        this.sb_models[SB_model_index.arm_l].show();
        this.sb_models[SB_model_index.arm_r].show();
    }
}