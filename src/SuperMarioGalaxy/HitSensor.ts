
import { vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { LiveActor, isDead, MessageType } from "./LiveActor";
import { SceneObjHolder, SceneObj } from "./Main";
import { connectToScene } from "./ActorUtil";
import { NameObj, MovementType } from "./NameObj";
import { ViewerRenderInput } from "../viewer";
import { arrayRemove } from "../util";
import { transformVec3Mat4w1, transformVec3Mat4w0 } from "../MathHelpers";

export const enum HitSensorType {
    Player                      = 0x01,
    // ??? 0x02
    // ??? 0x03
    // ??? 0x04
    Npc                         = 0x05,
    // ??? 0x06
    Animal                      = 0x07,
    // ??? 0x08

    _Ride_First                 = 0x09,
    Ride                        = 0x09,
    Tamakoro                    = 0x0A,
    TamakoroHit                 = 0x0B,
    SlingShooterAttack          = 0x0C,
    SlingShooterNPC             = 0x0E,
    JetTurtle                   = 0x0F,
    // ??? 0x10
    _Ride_Last                  = 0x11,

    // ??? 0x12
    // ??? 0x13

    _Enemy_First                = 0x14,
    Enemy                       = 0x14,
    EnemySimple                 = 0x15,
    EnemyAttack                 = 0x16,
    CocoNut                     = 0x17,
    WaterPressureBullet         = 0x18,
    BombHei                     = 0x19,
    Takobo                      = 0x1A,
    Kuribo                      = 0x1B,
    Karikari                    = 0x1C,
    Begoman                     = 0x1D,
    // Gesso, Jellyfish, Poihana = 0x1E,
    // BegomanSpring, JumpBeamer, JumpBeamer = 0x1F, (bounce?)
    MogucchiRefuseTerritory     = 0x20,
    BigBubble                   = 0x21,
    // ??? 0x22
    Pukupuku                    = 0x23,
    Unizo                       = 0x24,
    CocoSamboHead               = 0x25,
    CocoSambo                   = 0x26,
    // ??? 0x27
    // ??? 0x28
    HomingKiller                = 0x29,
    Rock                        = 0x2A,
    Wanwan                      = 0x2B,
    TripodBossGuardWallPart     = 0x2C,
    TripodBossKillerGenerater   = 0x2D,
    TombSpiderBody              = 0x2E,
    TombSpiderEye               = 0x2F,
    TombSpiderHip               = 0x30,
    TombSpiderMouth             = 0x31,
    // ??? 0x32
    TombSpiderFrontLGland       = 0x33,
    TombSpiderFrontLAttacker    = 0x34,
    TombSpiderFrontRGland       = 0x35,
    TombSpiderFrontRAttacker    = 0x36,
    TombSpiderRearLGland        = 0x37,
    TombSpiderRearLAttacker     = 0x38,
    TombSpiderRearRGland        = 0x39,
    TombSpiderRearRAttacker     = 0x3A,
    TombSpiderVitalSpotC        = 0x3B,
    TombSpiderVitalSpotL        = 0x3C,
    TombSpiderVitalSpotR        = 0x3D,
    TombSpiderCocoon            = 0x3E,
    // ??? 0x3F
    // ??? 0x40
    // KoopaHipDrop, KoopaSpin, Koopa DamageEscapePush = 0x41 (special Koopa damage?)
    KoopaFireShort              = 0x42,
    _Enemy_Last                 = 0x43,

    // ??? 0x44
    // ??? 0x45

    _MapObj_First               = 0x46,
    // isSensorItem() = 0x4A, 0x4B, 0x4D
    MapObj                      = 0x46,
    MapObjSimple                = 0x47,
    MapObjMoveCollision         = 0x48,
    Coin                        = 0x4A,
    // ??? 0x4B
    StarPiece                   = 0x4C,
    BenefitItem                 = 0x4D,
    // ??? 0x4E
    // PTimerSwitch, PicketSwitch = 0x4F, (push switches?)
    MorphItemNeo                = 0x50,
    // ??? 0x51
    // BreakableCage, TripodBossCore, TripodBossShell = 0x52, (Breakable map objects?)
    // ??? 0x53
    // TreasureBoxCracked, UFOBreakable = 0x54, (Breakable map objects?)
    WoodBox                     = 0x55,
    WaterBazookaCapsule         = 0x56,
    // ??? 0x57
    // ??? 0x58
    KameckBarrier               = 0x59,
    KoopaAttack                 = 0x5A,
    KoopaReceiver               = 0x5B,
    KoopaBattleMapDamagePlate   = 0x5C,
    KoopaBattleMapCoinPlate     = 0x5D,
    KoopaBattleMapPlate         = 0x5E,
    _MapObj_Last                = 0x5E,

    // ??? 0x5F

    _AutoRush_First             = 0x61,
    Binder                      = 0x61,
    TransferableBinder          = 0x62,
    PriorBinder                 = 0x63,
    SpinDriver                  = 0x64,
    SuperSpinDriver             = 0x65,
    TamakoroBind                = 0x66,
    PowerStar                   = 0x67,
    GCapture                    = 0x68,
    // ??? 0x69
    WaterPressureBulletBinder   = 0x6A,
    MarioLauncher               = 0x6B,
    QuestionCoin                = 0x6C,
    SecnarioStarter             = 0x6D,
    _AutoRush_Last              = 0x6D,

    // ??? 0x6E
    // ??? 0x6F

    _Rush_First                 = 0x70,
    // ??? 0x70
    // ??? 0x71
    // ??? 0x72
    HitWallTimerSwitch          = 0x73,
    _Rush_Last                  = 0x73,

    // ??? 0x74
    // ??? 0x75

    MapObjPress                 = 0x76,
    // ??? 0x77
    // ??? 0x78
    // BallOpener, DragonHeadFlower, JumpHole = 0x79,
    SphereRailDash              = 0x7A,
    BallRail                    = 0x7B,

    // ??? 0x7C
    // ??? 0x7D
    // ??? 0x7E

    Eye                         = 0x7F,
    Push                        = 0x80,
    // ??? 0x81
    // ??? 0x82
    MessageSensorHolder         = 0x83,
    Receiver                    = 0x84,
}

export class HitSensor {
    public center = vec3.create();
    public pairwiseSensors: HitSensor[] = [];
    public group: SensorGroup;
    public sensorValidBySystem: boolean = false;
    public sensorValidByHost: boolean = true;

    constructor(sceneObjHolder: SceneObjHolder, public sensorType: HitSensorType, pairwiseCapacity: number, public radius: number, public actor: LiveActor) {
        sceneObjHolder.create(SceneObj.SensorHitChecker);
        sceneObjHolder.sensorHitChecker!.initGroup(this);
    }

    public isType(type: HitSensorType): boolean {
        return this.sensorType === type;
    }

    public addHitSensor(other: HitSensor): void {
        this.pairwiseSensors.push(other);
    }

    public isValid(): boolean {
        return this.sensorValidByHost && this.sensorValidBySystem;
    }

    public validate(): void {
        if (!this.sensorValidByHost) {
            if (this.sensorValidBySystem)
                this.group.push(this);
            this.sensorValidByHost = true;
        }
    }

    public invalidate(): void {
        if (this.sensorValidByHost) {
            if (this.sensorValidBySystem)
                arrayRemove(this.group, this);
            this.sensorValidByHost = false;
            this.pairwiseSensors.length = 0;
        }
    }

    public validateBySystem(): void {
        if (!this.sensorValidBySystem) {
            if (this.sensorValidByHost)
                this.group.push(this);
            this.sensorValidBySystem = true;
        }
    }

    public invalidateBySystem(): void {
        if (this.sensorValidBySystem) {
            if (this.sensorValidByHost)
                arrayRemove(this.group, this);
            this.sensorValidBySystem = false;
            this.pairwiseSensors.length = 0;
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor): boolean {
        return this.actor.receiveMessage(sceneObjHolder, messageType, otherSensor, this);
    }
}

const scratchVec3 = vec3.create();
export class HitSensorInfo {
    public offset = vec3.create();

    constructor(public name: string, public sensor: HitSensor, private translation: vec3 | null, private baseMtx: mat4 | null, radius: number, offset: ReadonlyVec3, private useCallback: boolean) {
        vec3.copy(this.offset, offset);
    }

    public doObjCol(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.sensor.pairwiseSensors.length; i++) {
            if (!isDead(this.sensor.pairwiseSensors[i].actor))
                this.sensor.actor.attackSensor(sceneObjHolder, this.sensor, this.sensor.pairwiseSensors[i]);
        }
    }

    public update(): void {
        const dst = this.sensor.center;

        if (this.useCallback) {
            // TODO(jstpierre): Find a use of this?
            // this.sensor.actor.updateHitSensor();
        } else if (this.baseMtx !== null) {
            transformVec3Mat4w1(dst, this.baseMtx, this.offset);
        } else {
            if (this.translation !== null)
                vec3.copy(dst, this.translation);
            else
                vec3.copy(dst, this.sensor.actor.translation);

            const baseMtx = this.sensor.actor.getBaseMtx();
            if (baseMtx !== null) {
                transformVec3Mat4w0(scratchVec3, baseMtx, this.offset);
                vec3.add(dst, dst, scratchVec3);
            } else {
                vec3.add(dst, dst, this.offset);
            }
        }
    }
}

export class HitSensorKeeper {
    public sensorInfos: HitSensorInfo[] = [];

    public add(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor, offset: ReadonlyVec3): HitSensor {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, null, null, radius, offset, false);
        this.sensorInfos.push(sensorInfo);
        sensorInfo.update();
        return sensor;
    }

    public getSensor(name: string): HitSensor | null {
        for (let i = 0; i < this.sensorInfos.length; i++)
            if (this.sensorInfos[i].name === name)
                return this.sensorInfos[i].sensor;
        return null;
    }

    public invalidate(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.invalidate();
    }

    public validate(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.validate();
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

    public doObjCol(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].doObjCol(sceneObjHolder);
    }

    public update(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].update();
    }
}

type SensorGroup = HitSensor[];

export class SensorHitChecker extends NameObj {
    private playerGroup: SensorGroup = [];
    private rideGroup: SensorGroup = [];
    private eyeGroup: SensorGroup = [];
    private simpleGroup: SensorGroup = [];
    private mapObjGroup: SensorGroup = [];
    private characterGroup: SensorGroup = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SensorHitChecker');
        connectToScene(sceneObjHolder, this, MovementType.SensorHitChecker, -1, -1, -1);
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
        else if (sensor.isType(HitSensorType.Eye))
            sensor.group = this.eyeGroup;
        else if (sensor.isType(HitSensorType.Coin) || sensor.isType(HitSensorType.StarPiece) || sensor.isType(HitSensorType.EnemySimple) || sensor.isType(HitSensorType.MapObjSimple) || sensor.isType(0x1F) || isSensorRush(sensor) || isSensorAutoRush(sensor))
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

            // TODO(jstpierre): Check clipping
            if (!as.isValid())
                continue;

            for (let j = 0; j < b.length; j++) {
                const bs = b[j];
                if (!bs.isValid())
                    continue;
                this.checkAttack(as, bs);
            }
        }
    }

    public doObjColInSameGroup(a: SensorGroup): void {
        for (let i = 0; i < a.length; i++) {
            const as = a[i];

            // TODO(jstpierre): Check clipping
            if (!as.isValid())
                continue;

            for (let j = i + 1; j < a.length; j++) {
                const bs = a[j];
                if (!bs.isValid())
                    continue;
                this.checkAttack(as, bs);
            }
        }
    }

    public checkAttack(a: HitSensor, b: HitSensor): void {
        if (a.actor === b.actor)
            return;

        if (vec3.squaredDistance(a.center, b.center) < (a.radius + b.radius) ** 2.0) {
            if (!isSensorEye(b))
                a.addHitSensor(b);
            if (!isSensorEye(a))
                b.addHitSensor(a);
        }
    }
}

export function isSensorPlayer(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.Player);
}

export function isSensorNpc(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.Npc);
}

export function isSensorEye(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.Eye);
}

export function isSensorRide(sensor: HitSensor): boolean {
    return sensor.sensorType >= HitSensorType._Ride_First && sensor.sensorType <= HitSensorType._Ride_Last;
}

export function isSensorEnemy(sensor: HitSensor): boolean {
    return sensor.sensorType >= HitSensorType._Enemy_First && sensor.sensorType <= HitSensorType._Enemy_Last;
}

export function isSensorMapObj(sensor: HitSensor): boolean {
    return sensor.sensorType >= HitSensorType._MapObj_First && sensor.sensorType <= HitSensorType._MapObj_Last;
}

export function isSensorAutoRush(sensor: HitSensor): boolean {
    return sensor.sensorType >= HitSensorType._AutoRush_First && sensor.sensorType <= HitSensorType._AutoRush_Last;
}

export function isSensorRush(sensor: HitSensor): boolean {
    return sensor.sensorType >= HitSensorType._Rush_First && sensor.sensorType <= HitSensorType._Rush_Last;
}

export function isSensorPlayerOrRide(sensor: HitSensor): boolean {
    return isSensorPlayer(sensor) || isSensorRide(sensor);
}

export function sendMsgEnemyAttack(sceneObjHolder: SceneObjHolder, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, MessageType.EnemyAttack, sendSensor);
}

export function sendArbitraryMsg(sceneObjHolder: SceneObjHolder, messageType: MessageType, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, messageType, sendSensor);
}
