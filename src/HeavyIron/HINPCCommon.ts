import { colorFromRGBA } from "../Color.js";
import { HIEnt } from "./HIEnt.js";
import { HIModelInstance, HIPipeFlags } from "./HIModel.js";
import { HIScene } from "./HIScene.js";
import { RwBlendFunction, RwStream } from "./rw/rwcore.js";

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

    constructor(stream: RwStream, scene: HIScene) {
        super(stream, scene);
        this.npcAsset = new HIEntNPCAsset(stream);
        this.readLinks(stream);
        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }

    public override setup(scene: HIScene): void {
        super.setup(scene);

        const models: HIModelInstance[] = [];
        for (let model = this.model; model; model = model.next) {
            models.push(model);
        }

        // Temporary hacks to make the NPCs look good
        switch (this.entAsset.modelInfoID) {
        case 0x9BAAE4D2: // ham_bind.MINF
            models[1].hide();
            models[2].hide();
            break;
        case 0x0A518D42: // robot_tar_bind.MINF
            models[2].hide();
            models[3].hide();
            break;
        case 0x252F35F0: // g_love_bind.MINF
            models[1].hide();
            models[2].hide();
            break;
        case 0x0615D145: // robot_chunk_bind.MINF
            models[2].hide();
            models[3].hide();
            break;
        case 0x38E7D5C4: // robot_4a_monsoon_bind.MINF
            models[1].hide();
            models[2].hide();
            break;
        case 0x582111BD: // robot_sleepy-time_bind.MINF
            models[2].hide();
            models[3].hide();
            models[4].hide();
            break;
        case 0xF7771D9E: // robot_arf_bind.MINF
            models[2].hide();
            models[3].hide();
            break;
        case 0x2554CA0D: // tubelet_bind.MINF
            models[2].hide();
            models[3].hide();
            models[4].hide();
            break;
        case 0xFD7A8D39: // tubelet_slave_bind.MINF
            models[2].hide();
            models[3].hide();
            models[4].hide();
            break;
        case 0xBD640B63: // robot_9a_bind.MINF
            models[1].alpha = 100/255;
            models[1].pipeFlags |= (RwBlendFunction.SRCALPHA << HIPipeFlags.SRCBLEND_SHIFT);
            models[1].pipeFlags |= (RwBlendFunction.INVSRCALPHA << HIPipeFlags.DESTBLEND_SHIFT);
            models[1].pipeFlags |= HIPipeFlags.CULL_FRONTONLY;
            models[2].hide();
            models[3].hide();
            break;
        case 0xD9BA02B0: // dutchman_bind.MINF
            models[1].hide();
            break;
        case 0xD9F1A3AA: // boss_sb_body_bind.MINF
            models[3].pipeFlags |= (RwBlendFunction.SRCALPHA << HIPipeFlags.SRCBLEND_SHIFT);
            models[3].pipeFlags |= (RwBlendFunction.INVSRCALPHA << HIPipeFlags.DESTBLEND_SHIFT);
            break;
        }
    }
}