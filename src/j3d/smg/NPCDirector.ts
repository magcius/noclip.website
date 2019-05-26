
import { createCsvParser } from "./JMapInfo";
import * as RARC from "../rarc";

export class NPCActorItem {
    public goods0: string | null;
    public goods1: string | null;
    public goodsJoint0: string | null;
    public goodsJoint1: string | null;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.goods0 = null;
        this.goods1 = null;
        this.goodsJoint0 = null;
        this.goodsJoint1 = null;
    }
}

export class NPCDirector {
    private scratchNPCActorItem = new NPCActorItem();

    constructor(private npcDataArc: RARC.RARC) {
    }

    public getNPCItemData(npcName: string, index: number, npcActorItem = this.scratchNPCActorItem): NPCActorItem | null {
        if (index === -1)
            return null;

        const infoIter = createCsvParser(this.npcDataArc.findFileData(`${npcName}Item.bcsv`));
        infoIter.setRecord(index);
        npcActorItem.goods0 = infoIter.getValueString('mGoods0');
        npcActorItem.goods1 = infoIter.getValueString('mGoods1');
        npcActorItem.goodsJoint0 = infoIter.getValueString('mGoodsJoint0');
        npcActorItem.goodsJoint1 = infoIter.getValueString('mGoodsJoint1');
        return npcActorItem;
    }
}
