
import { vec3, mat4 } from "gl-matrix";
import { LiveActor, isDead } from "./LiveActor";
import { SceneObjHolder, SceneObj } from "./Main";
import { connectToScene } from "./ActorUtil";
import { NameObj } from "./NameObj";
import { ViewerRenderInput } from "../viewer";
import { arrayRemove } from "../util";

function initHitSensorGroup(sceneObjHolder: SceneObjHolder, sensor: HitSensor): void {
    sceneObjHolder.create(SceneObj.SENSOR_HIT_CHECKER);
    sceneObjHolder.sensorHitChecker!.initGroup(sensor);
}

export const enum HitSensorType {
}

export class HitSensor {
    public center = vec3.create();
    public pairwiseSensors: HitSensor[] = [];
    public group: SensorGroup;
    public sensorValid: boolean = false;

    constructor(sceneObjHolder: SceneObjHolder, public sensorType: HitSensorType, pairwiseCapacity: number, public radius: number, public actor: LiveActor) {
        initHitSensorGroup(sceneObjHolder, this);
    }

    public isType(type: HitSensorType): boolean {
        return this.sensorType === type;
    }

    public addHitSensor(other: HitSensor): void {
        this.pairwiseSensors.push(other);
    }

    public invalidateBySystem(): void {
        if (this.sensorValid) {
            arrayRemove(this.group, this);
        }
    }

    public validateBySystem(): void {
        if (!this.sensorValid) {
            this.group.push(this);
            this.sensorValid = true;
        }
    }
}

const scratchVec3 = vec3.create();
export class HitSensorInfo {
    public offset = vec3.create();

    constructor(public name: string, public sensor: HitSensor, private translation: vec3 | null, private baseMtx: mat4 | null, radius: number, offset: vec3, private useCallback: boolean) {
        vec3.copy(this.offset, offset);
    }

    public doObjCol(): void {
        for (let i = 0; i < this.sensor.pairwiseSensors.length; i++) {
            if (!isDead(this.sensor.pairwiseSensors[i].actor))
                this.sensor.actor.attackSensor(this.sensor, this.sensor.pairwiseSensors[i]);
        }
    }

    public update(): void {
        if (this.useCallback) {
            // TODO(jstpierre): Implement
        } else if (this.baseMtx !== null) {
            // TODO(jstpierre): Implement
        } else {
            const dst = this.sensor.center;

            if (this.translation !== null)
                vec3.copy(dst, this.translation);
            else
                vec3.copy(dst, this.sensor.actor.translation);

            const baseMtx = this.sensor.actor.getBaseMtx();
            if (baseMtx !== null) {
                vec3.transformMat4(scratchVec3, this.offset, baseMtx);
                vec3.add(dst, dst, scratchVec3);
            } else {
                vec3.add(dst, dst, this.offset);
            }
        }
    }
}

export class HitSensorKeeper {
    public sensorInfos: HitSensorInfo[] = [];

    public add(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor, offset: vec3): void {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, null, null, radius, offset, false);
        this.sensorInfos.push(sensorInfo);
        sensorInfo.update();
    }

    public getSensor(name: string): HitSensor | null {
        for (let i = 0; i < this.sensorInfos.length; i++)
            if (this.sensorInfos[i].name === name)
                return this.sensorInfos[i].sensor;
        return null;
    }

    public invalidateBySystem(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.invalidateBySystem();
    }

    public validateBySystem(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.validateBySystem();
    }

    public clear(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.pairwiseSensors.length = 0;
    }

    public doObjCol(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].doObjCol();
    }

    public update(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].update();
    }
}

type SensorGroup = HitSensor[];

export function isSensorPlayer(sensor: HitSensor): boolean {
    return sensor.isType(1);
}

export function isSensorRide(sensor: HitSensor): boolean {
    return sensor.sensorType > 0x08 && sensor.sensorType < 0x12;
}

export function isSensorRush(sensor: HitSensor): boolean {
    return sensor.sensorType > 0x6F && sensor.sensorType < 0x74;
}

export function isSensorAutoRush(sensor: HitSensor): boolean {
    return sensor.sensorType > 0x60 && sensor.sensorType < 0x6E;
}

export function isSensorMapObj(sensor: HitSensor): boolean {
    return sensor.sensorType > 0x45 && sensor.sensorType < 0x5F;
}

export function isSensorNpc(sensor: HitSensor): boolean {
    return sensor.sensorType > 0x04 && sensor.sensorType < 0x06;
}

export class SensorHitChecker extends NameObj {
    private playerGroup: SensorGroup = [];
    private rideGroup: SensorGroup = [];
    private eyeGroup: SensorGroup = [];
    private simpleGroup: SensorGroup = [];
    private mapObjGroup: SensorGroup = [];
    private characterGroup: SensorGroup = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SensorHitChecker');
        connectToScene(sceneObjHolder, this, 0x05, -1, -1, -1);
    }

    private clearGroup(group: SensorGroup): void {
        for (let i = 0; i < group.length; i++)
            group[i].pairwiseSensors.length = 0;
    }

    public initGroup(sensor: HitSensor): void {
        if (isSensorPlayer(sensor))
            sensor.group = this.playerGroup;
        else if (isSensorRide(sensor))
            sensor.group = this.rideGroup;
        else if (sensor.isType(0x7F))
            sensor.group = this.eyeGroup;
        else if (sensor.isType(0x4A) || sensor.isType(0x4C) || sensor.isType(0x15) || sensor.isType(0x47) || sensor.isType(0x1F) || isSensorRush(sensor) || isSensorAutoRush(sensor))
            sensor.group = this.simpleGroup;
        else if (isSensorMapObj(sensor))
            sensor.group = this.mapObjGroup;
        else
            sensor.group = this.characterGroup;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.clearGroup(this.playerGroup);
        this.clearGroup(this.rideGroup);
        this.clearGroup(this.eyeGroup);
        this.clearGroup(this.simpleGroup);
        this.clearGroup(this.mapObjGroup);
        this.clearGroup(this.characterGroup);

        this.doObjColGroup(this.playerGroup, this.characterGroup);
        this.doObjColGroup(this.playerGroup, this.mapObjGroup);
        this.doObjColGroup(this.playerGroup, this.rideGroup);
        this.doObjColGroup(this.playerGroup, this.simpleGroup);
        this.doObjColGroup(this.playerGroup, this.eyeGroup);
        this.doObjColGroup(this.rideGroup, this.characterGroup);
        this.doObjColGroup(this.rideGroup, this.mapObjGroup);
        this.doObjColGroup(this.rideGroup, this.simpleGroup);
        this.doObjColGroup(this.rideGroup, this.eyeGroup);
        this.doObjColGroup(this.eyeGroup, this.characterGroup);
        this.doObjColGroup(this.eyeGroup, this.mapObjGroup);
        this.doObjColGroup(this.eyeGroup, this.simpleGroup);
        this.doObjColGroup(this.characterGroup, this.mapObjGroup);
        this.doObjColInSameGroup(this.characterGroup);
    }

    public doObjColGroup(a: SensorGroup, b: SensorGroup): void {
        for (let i = 0; i < a.length; i++) {
            const as = a[i];

            // TODO(jstpierre): Check validity & clipping

            for (let j = 0; j < b.length; j++) {
                const bs = b[j];
                this.checkAttack(as, bs);
            }
        }
    }

    public doObjColInSameGroup(a: SensorGroup): void {
        for (let i = 0; i < a.length; i++) {
            const as = a[i];

            // TODO(jstpierre): Check validity & clipping

            for (let j = i + 1; j < a.length; j++) {
                const bs = a[j];
                this.checkAttack(as, bs);
            }
        }
    }

    public checkAttack(a: HitSensor, b: HitSensor): void {
        if (a.actor !== b.actor) {
            const d = vec3.squaredDistance(a.center, b.center);
            const r = a.radius + b.radius;
            if (d < r * r) {
                if (!b.isType(0x7F))
                    a.addHitSensor(b);
                if (!a.isType(0x7F))
                    b.addHitSensor(a);
            }
        }
    }
}
