
import { NameObj } from "./NameObj";
import { OceanBowl } from "./OceanBowl";
import { SceneObjHolder } from "./Main";
import { connectToSceneScreenEffectMovement } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { AreaObjMgr, AreaObj, AreaFormType } from "./AreaObj";
import { vec3 } from "gl-matrix";
import { OceanRing, getCamPos, isEqualStageName } from "./MiscActor";
import { JMapInfoIter } from "./JMapInfo";
import { ZoneAndLayer } from "./LiveActor";
import { createNormalBloom } from "./ImageEffect";

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

const scratchVec3 = vec3.create();
export class WaterAreaHolder extends NameObj {
    public cameraInWater: boolean = false;
    public oceanBowl: OceanBowl[] = [];
    public oceanRing: OceanRing[] = [];
    private useBloom: boolean = false;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterAreaHolder');

        if (isEqualStageName(sceneObjHolder, 'HeavenlyBeachGalaxy') || isEqualStageName(sceneObjHolder, 'OceanRingGalaxy')) {
            createNormalBloom(sceneObjHolder);
            this.useBloom = true;
        }

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

        getCamPos(scratchVec3, viewerInput.camera);

        const inWater = getWaterAreaObj(sceneObjHolder, scratchVec3);
        if (inWater) {
            if (!this.cameraInWater) {
                this.cameraInWater = true;

                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.turnOnNormal(sceneObjHolder);
                    imageEffectDirector.setNormalBloomIntensity(0xFF);
                    imageEffectDirector.setNormalBloomThreshold(0x80);
                    imageEffectDirector.setNormalBloomBlurIntensity1(0x28);
                    imageEffectDirector.setNormalBloomBlurIntensity2(0x14);
                }
            }

            // TODO(jstpierre): WaterInfo
        } else {
            if (this.cameraInWater) {
                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.setAuto(sceneObjHolder);
                }

                this.cameraInWater = false;
            }
        }
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

        for (let i = 0; i < waterAreas.oceanRing.length; i++)
            if (waterAreas.oceanRing[i].isInWater(sceneObjHolder, position))
                return true;
    }

    return false;
}

export function isInWater(sceneObjHolder: SceneObjHolder, position: vec3): boolean {
    return getWaterAreaObj(sceneObjHolder, position);
}

export function isCameraInWater(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.waterAreaHolder === null)
        return false;
    return sceneObjHolder.waterAreaHolder.cameraInWater;
}

export function createWaterAreaCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CubeGround);
}

export function createWaterAreaCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}

export function createWaterAreaSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}
