
import { NameObj } from "./NameObj";
import { OceanBowl } from "./OceanBowl";
import { SceneObjHolder } from "./Main";
import { connectToSceneScreenEffectMovement } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { AreaObjMgr, AreaObj } from "./AreaObj";

export class WaterArea extends AreaObj {
}

export class WaterAreaMgr extends AreaObjMgr<WaterArea> {
}

export class WaterAreaHolder extends NameObj {
    private oceanBowl: OceanBowl[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterAreaHolder');

        connectToSceneScreenEffectMovement(sceneObjHolder, this);
    }

    public entryOceanBowl(oceanBowl: OceanBowl): void {
        this.oceanBowl.push(oceanBowl);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
    }
}
