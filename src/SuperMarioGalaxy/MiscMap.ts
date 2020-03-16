
import { NameObj } from "./NameObj";
import { OceanBowl } from "./OceanBowl";
import { SceneObjHolder } from "./Main";
import { connectToSceneScreenEffectMovement } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { AreaObjMgr, AreaObj } from "./AreaObj";
import { vec3 } from "gl-matrix";
import { OceanRing } from "./MiscActor";

export class WaterArea extends AreaObj {
    public getManagerName(): string {
        return "Water";
    }
}

export class WaterAreaMgr extends AreaObjMgr<WaterArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "Water");
    }
}

export class WaterAreaHolder extends NameObj {
    public oceanBowl: OceanBowl[] = [];
    public oceanRing: OceanRing[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterAreaHolder');

        connectToSceneScreenEffectMovement(sceneObjHolder, this);
    }

    public entryOceanBowl(oceanBowl: OceanBowl): void {
        this.oceanBowl.push(oceanBowl);
    }

    public entryOceanRing(oceanRing: OceanRing): void {
        this.oceanRing.push(oceanRing);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
    }
}

export function getWaterAreaObj(sceneObjHolder: SceneObjHolder, position: vec3): boolean {
    if (sceneObjHolder.areaObjContainer !== null) {
        const areaObj = sceneObjHolder.areaObjContainer.getAreaObj("Water", position);
        if (areaObj !== null)
            return true;
    }

    if (sceneObjHolder.waterAreaHolder !== null) {
        const waterAreas = sceneObjHolder.waterAreaHolder;
        for (let i = 0; i < waterAreas.oceanBowl.length; i++)
            if (waterAreas.oceanBowl[i].isInWater(position))
                return true;

        // TODO(jstpierre): OceanRing.isInWater
        /*
        for (let i = 0; i < waterAreas.oceanRing.length; i++) {
            if (waterAreas.oceanRing[i].isInWater(position))
                return true;
        */
    }

    return false;
}

export function isInWater(sceneObjHolder: SceneObjHolder, position: vec3): boolean {
    return getWaterAreaObj(sceneObjHolder, position);
}
