
import { vec3 } from "gl-matrix";
import { colorNew, colorCopy, colorFromRGBA } from "../../Color";
import { Camera } from "../../Camera";
import { Light, lightSetWorldPosition, lightSetWorldDirection, Color } from "../../gx/gx_material";
import { BMDModelInstance } from "../render";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { RARC } from "../rarc";
import { LightType } from "./DrawBuffer";
import { assertExists } from "../../util";
import { SceneObjHolder, LiveActor, SMGSceneDescBase } from "./smg_scenes";

function getValueColor(color: Color, infoIter: JMapInfoIter, prefix: string): void {
    const colorR = infoIter.getValueNumber(`${prefix}R`, 0) / 0xFF;
    const colorG = infoIter.getValueNumber(`${prefix}G`, 0) / 0xFF;
    const colorB = infoIter.getValueNumber(`${prefix}B`, 0) / 0xFF;
    const colorA = infoIter.getValueNumber(`${prefix}A`, 0) / 0xFF;
    colorFromRGBA(color, colorR, colorG, colorB, colorA);
}

export class LightInfo {
    public Position = vec3.create();
    public Color = colorNew(1, 1, 1, 1);
    public FollowCamera: boolean;

    constructor(infoIter: JMapInfoIter, prefix: string) {
        getValueColor(this.Color, infoIter, `${prefix}Color`);

        const posX = infoIter.getValueNumber(`${prefix}PosX`, 0);
        const posY = infoIter.getValueNumber(`${prefix}PosY`, 0);
        const posZ = infoIter.getValueNumber(`${prefix}PosZ`, 0);
        vec3.set(this.Position, posX, posY, posZ);

        this.FollowCamera = infoIter.getValueNumber(`${prefix}FollowCamera`) !== 0;
    }

    public setLight(dst: Light, camera: Camera): void {
        if (this.FollowCamera) {
            vec3.copy(dst.Position, this.Position);
            vec3.set(dst.Direction, 1, 0, 0);
        } else {
            lightSetWorldPosition(dst, camera, this.Position[0], this.Position[1], this.Position[2]);
            lightSetWorldDirection(dst, camera, 1, 0, 0);
        }

        colorCopy(dst.Color, this.Color);
        vec3.set(dst.CosAtten, 1, 0, 0);
        vec3.set(dst.DistAtten, 1, 0, 0);
    }
}

export class ActorLightInfo {
    public AreaLightName: string;
    public Light0: LightInfo;
    public Light1: LightInfo;
    public Alpha2: number;
    public Ambient = colorNew(1, 1, 1, 1);

    constructor(infoIter: JMapInfoIter, prefix: string) {
        this.Light0 = new LightInfo(infoIter, `${prefix}Light0`);
        this.Light1 = new LightInfo(infoIter, `${prefix}Light1`);
        getValueColor(this.Ambient, infoIter, `${prefix}Ambient`);
        this.Alpha2 = infoIter.getValueNumber(`${prefix}Alpha2`) / 0xFF;
    }

    public setOnModelInstance(modelInstance: BMDModelInstance, camera: Camera): void {
        this.Light0.setLight(modelInstance.getGXLightReference(0), camera);
        this.Light1.setLight(modelInstance.getGXLightReference(1), camera);

        const light2 = modelInstance.getGXLightReference(2);
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.Alpha2);

        // TODO(jstpierre): This doesn't look quite right for planets.
        // Needs investigation.
        // modelInstance.setColorOverride(ColorKind.AMB0, this.Ambient, true);
    }
}

export class AreaLightInfo {
    public AreaLightName: string;
    public Interpolate: number;
    public Player: ActorLightInfo;
    public Strong: ActorLightInfo;
    public Weak: ActorLightInfo;
    public Planet: ActorLightInfo;

    constructor(infoIter: JMapInfoIter) {
        this.AreaLightName = infoIter.getValueString('AreaLightName');
        this.Interpolate = infoIter.getValueNumber('Interpolate');
        this.Player = new ActorLightInfo(infoIter, 'Player');
        this.Strong = new ActorLightInfo(infoIter, 'Strong');
        this.Weak = new ActorLightInfo(infoIter, 'Weak');
        this.Planet = new ActorLightInfo(infoIter, 'Planet');
    }
}

export class ActorLightCtrl {
    public currentAreaLight: AreaLightInfo | null = null;

    constructor(private assocActor: LiveActor, public lightType: LightType = LightType.None) {
    }

    public initActorLightInfo(sceneObjHolder: SceneObjHolder): void {
        if (this.lightType !== LightType.None)
            return;
        sceneObjHolder.sceneNameObjListExecutor.findLightInfo(this.assocActor);
    }

    public getActorLight(): ActorLightInfo | null {
        if (this.currentAreaLight !== null)
            return this.getTargetActorLight(this.currentAreaLight);
        else
            return null;
    }

    public getTargetActorLight(areaLight: AreaLightInfo): ActorLightInfo | null {
        if (this.lightType === LightType.Player)
            return areaLight.Player;
        else if (this.lightType === LightType.Strong)
            return areaLight.Strong;
        else if (this.lightType === LightType.Weak)
            return areaLight.Weak;
        else if (this.lightType === LightType.Planet)
            return areaLight.Planet;
        else
            return null;
    }
}

class LightZoneInfo {
    private lightIDToAreaLightName = new Map<number, string>();

    constructor(public zoneName: string, infoIter: JMapInfoIter) {
        for (let i = 0; i < infoIter.getNumRecords(); i++) {
            infoIter.setRecord(i);
            const lightID = infoIter.getValueNumber('LightID');
            const areaLightName = infoIter.getValueString('AreaLightName');
            this.lightIDToAreaLightName.set(lightID, areaLightName);
        }
    }

    public getAreaLightName(lightID: number): string {
        return this.lightIDToAreaLightName.get(lightID);
    }
}

export class LightDataHolder {
    public areaLightInfos: AreaLightInfo[] = [];
    public zoneInfos: LightZoneInfo[] = [];

    constructor(lightData: JMapInfoIter) {
        for (let i = 0; i < lightData.getNumRecords(); i++) {
            lightData.setRecord(i);
            this.areaLightInfos.push(new AreaLightInfo(lightData));
        }
    }

    private ensureZoneInfo(sceneObjHolder: SceneObjHolder, zoneName: string): LightZoneInfo {
        let zoneInfo = this.zoneInfos.find((zoneInfo) => zoneInfo.zoneName === zoneName);
        if (zoneInfo === undefined) {
            const zoneLightData = sceneObjHolder.sceneDesc.getZoneLightData(sceneObjHolder.modelCache, zoneName);
            zoneInfo = new LightZoneInfo(zoneName, zoneLightData);
            this.zoneInfos.push(zoneInfo);
        }
        return zoneInfo;
    }

    // The original uses a ZoneLightID which is composed of a ZoneID/LightID pair. We use zone names, not IDs.
    public getAreaLightName(sceneObjHolder: SceneObjHolder, zoneName: string, lightID: number): string {
        return this.ensureZoneInfo(sceneObjHolder, zoneName).getAreaLightName(lightID);
    }

    public findAreaLight(areaLightName: string): AreaLightInfo {
        return this.areaLightInfos.find((areaLight) => areaLight.AreaLightName === areaLightName);
    }

    public findDefaultAreaLight(sceneObjHolder: SceneObjHolder): AreaLightInfo {
        const stageName = sceneObjHolder.scenarioData.getMasterZoneFilename();
        const areaLightName = this.getAreaLightName(sceneObjHolder, stageName, -1);
        return this.findAreaLight(areaLightName);
    }
}
