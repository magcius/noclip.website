
import { NameObj, NameObjGroup } from "./NameObj";
import { EffectKeeper } from "./EffectSystem";
import { Spine } from "./Spine";
import { ActorLightCtrl } from "./LightData";
import { vec3, mat4 } from "gl-matrix";
import { SceneObjHolder, getObjectName, getDeltaTimeFrames, ResourceHolder, SpecialTextureType } from "./Main";
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoBool } from "./JMapInfo";
import { computeModelMatrixSRT, computeEulerAngleRotationFromSRTMatrix } from "../MathHelpers";
import { Camera } from "../Camera";
import { LightType } from "./DrawBuffer";

import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import * as Viewer from '../viewer';
import { assertExists, fallback } from "../util";
import { RailRider } from "./RailRider";
import { BvaPlayer, BrkPlayer, BtkPlayer, BtpPlayer, XanimePlayer, BckCtrl } from "./Animation";
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { isBtkExist, isBtkPlaying, startBtk, isBrkExist, isBrkPlaying, startBrk, isBpkExist, isBpkPlaying, startBpk, isBtpExist, startBtp, isBtpPlaying, isBvaExist, isBvaPlaying, startBva, isBckExist, isBckPlaying, startBck, calcGravity, resetAllCollisionMtx, validateCollisionPartsForActor, invalidateCollisionPartsForActor, connectToScene } from "./ActorUtil";
import { HitSensor, HitSensorKeeper } from "./HitSensor";
import { CollisionParts, CollisionScaleType, createCollisionPartsFromLiveActor, Binder, invalidateCollisionParts } from "./Collision";
import { StageSwitchCtrl, createStageSwitchCtrl } from "./Switch";

class ActorAnimDataInfo {
    public Name: string;
    public StartFrame: number;
    public IsKeepAnim: boolean;

    constructor(infoIter: JMapInfoIter, animType: string) {
        this.Name = assertExists(infoIter.getValueString(`${animType}Name`));
        this.StartFrame = fallback(infoIter.getValueNumber(`${animType}StartFrame`), -1);
        this.IsKeepAnim = getJMapInfoBool(fallback(infoIter.getValueNumber(`${animType}IsKeepAnim`), -1));
    }
}

function getAnimName(keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): string {
    if (dataInfo.Name)
        return dataInfo.Name;
    else
        return keeperInfo.ActorAnimName;
}

class ActorAnimKeeperInfo {
    public ActorAnimName: string;
    public Bck: ActorAnimDataInfo;
    public Btk: ActorAnimDataInfo;
    public Brk: ActorAnimDataInfo;
    public Bpk: ActorAnimDataInfo;
    public Btp: ActorAnimDataInfo;
    public Bva: ActorAnimDataInfo;

    constructor(infoIter: JMapInfoIter) {
        this.ActorAnimName = assertExists(infoIter.getValueString('ActorAnimName')).toLowerCase();
        this.Bck = new ActorAnimDataInfo(infoIter, 'Bck');
        this.Btk = new ActorAnimDataInfo(infoIter, 'Btk');
        this.Brk = new ActorAnimDataInfo(infoIter, 'Brk');
        this.Bpk = new ActorAnimDataInfo(infoIter, 'Bpk');
        this.Btp = new ActorAnimDataInfo(infoIter, 'Btp');
        this.Bva = new ActorAnimDataInfo(infoIter, 'Bva');
    }
}

class ActorAnimKeeper {
    public keeperInfo: ActorAnimKeeperInfo[] = [];

    constructor(infoIter: JMapInfoIter) {
        for (let i = 0; i < infoIter.getNumRecords(); i++) {
            infoIter.setRecord(i);
            this.keeperInfo.push(new ActorAnimKeeperInfo(infoIter));
        }
    }

    public static tryCreate(actor: LiveActor): ActorAnimKeeper | null {
        let bcsv = actor.resourceHolder.arc.findFileData('ActorAnimCtrl.bcsv');

        // Super Mario Galaxy 2 puts these assets in a subfolder.
        if (bcsv === null)
            bcsv = actor.resourceHolder.arc.findFileData('ActorInfo/ActorAnimCtrl.bcsv');

        if (bcsv === null)
            return null;

        const infoIter = createCsvParser(bcsv);
        return new ActorAnimKeeper(infoIter);
    }

    private findAnimInfo(animationName: string): ActorAnimKeeperInfo | null {
        animationName = animationName.toLowerCase();
        const animInfo = this.keeperInfo.find((info) => info.ActorAnimName === animationName);
        if (animInfo === undefined)
            return null;

        return animInfo;
    }

    public start(actor: LiveActor, animationName: string): boolean {
        const animInfo = this.findAnimInfo(animationName);
        if (animInfo === null)
            return false;

        const bckAnimName = getAnimName(animInfo, animInfo.Bck);
        if (isBckExist(actor, bckAnimName) && (!animInfo.Bck.IsKeepAnim || !isBckPlaying(actor, bckAnimName)))
            startBck(actor, bckAnimName);

        const btkAnimName = getAnimName(animInfo, animInfo.Btk);
        if (isBtkExist(actor, btkAnimName) && (!animInfo.Btk.IsKeepAnim || !isBtkPlaying(actor, btkAnimName)))
            startBtk(actor, btkAnimName);

        const brkAnimName = getAnimName(animInfo, animInfo.Brk);
        if (isBrkExist(actor, brkAnimName) && (!animInfo.Brk.IsKeepAnim || !isBrkPlaying(actor, brkAnimName)))
            startBrk(actor, brkAnimName);

        const bpkAnimName = getAnimName(animInfo, animInfo.Bpk);
        if (isBpkExist(actor, bpkAnimName) && (!animInfo.Bpk.IsKeepAnim || !isBpkPlaying(actor, bpkAnimName)))
            startBpk(actor, bpkAnimName);

        const btpAnimName = getAnimName(animInfo, animInfo.Btp);
        if (isBtpExist(actor, btpAnimName) && (!animInfo.Btp.IsKeepAnim || !isBtpPlaying(actor, btpAnimName)))
            startBtp(actor, btpAnimName);

        const bvaAnimName = getAnimName(animInfo, animInfo.Bva);
        if (isBvaExist(actor, bvaAnimName) && (!animInfo.Bva.IsKeepAnim || !isBvaPlaying(actor, bvaAnimName)))
            startBva(actor, bvaAnimName);

        return true;
    }

    public isPlaying(actor: LiveActor, animationName: string): boolean {
        const animInfo = this.findAnimInfo(animationName);
        if (animInfo !== null) {
            const animName = getAnimName(animInfo, animInfo.Bck);
            return isBckPlaying(actor, animName);
        } else {
            return isBckPlaying(actor, animationName);
        }
    }
}

export class ModelManager {
    public resourceHolder: ResourceHolder;
    public modelInstance: J3DModelInstance;
    public xanimePlayer: XanimePlayer | null = null;
    public btkPlayer: BtkPlayer | null = null;
    public brkPlayer: BrkPlayer | null = null;
    public btpPlayer: BtpPlayer | null = null;
    public bpkPlayer: BrkPlayer | null = null;
    public bvaPlayer: BvaPlayer | null = null;
    public bckCtrl: BckCtrl | null = null;

    constructor(sceneObjHolder: SceneObjHolder, objName: string) {
        this.resourceHolder = sceneObjHolder.modelCache.getResourceHolder(objName);

        const bmdModel = this.resourceHolder.getModel(objName);
        this.modelInstance = new J3DModelInstance(bmdModel);
        this.modelInstance.name = objName;
        if (this.resourceHolder.motionTable.size > 0)
            this.xanimePlayer = new XanimePlayer(this.resourceHolder.motionTable, this.modelInstance);
        if (this.resourceHolder.btkTable.size > 0)
            this.btkPlayer = new BtkPlayer(this.resourceHolder.btkTable, this.modelInstance);
        if (this.resourceHolder.brkTable.size > 0)
            this.brkPlayer = new BrkPlayer(this.resourceHolder.brkTable, this.modelInstance);
        if (this.resourceHolder.btpTable.size > 0)
            this.btpPlayer = new BtpPlayer(this.resourceHolder.btpTable, this.modelInstance);
        if (this.resourceHolder.bpkTable.size > 0)
            this.bpkPlayer = new BrkPlayer(this.resourceHolder.bpkTable, this.modelInstance);
        if (this.resourceHolder.bvaTable.size > 0)
            this.bvaPlayer = new BvaPlayer(this.resourceHolder.bvaTable, this.modelInstance);

        if (this.resourceHolder.motionTable.size > 0) {
            this.bckCtrl = this.resourceHolder.getRes(this.resourceHolder.banmtTable, objName);
            if (this.bckCtrl === null)
                this.bckCtrl = new BckCtrl();
        }
    }

    public calcAnim(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.xanimePlayer !== null)
            this.xanimePlayer.calcAnm();

        if (this.bvaPlayer !== null)
            this.bvaPlayer.calc();

        this.modelInstance.calcAnim();
    }

    public update(deltaTimeFrames: number): void {
        if (this.xanimePlayer !== null)
            this.xanimePlayer.update(deltaTimeFrames);
        if (this.btkPlayer !== null)
            this.btkPlayer.update(deltaTimeFrames);
        if (this.brkPlayer !== null)
            this.brkPlayer.update(deltaTimeFrames);
        if (this.btpPlayer !== null)
            this.btpPlayer.update(deltaTimeFrames);
        if (this.bpkPlayer !== null)
            this.bpkPlayer.update(deltaTimeFrames);
        if (this.bvaPlayer !== null)
            this.bvaPlayer.update(deltaTimeFrames);
    }

    public getBckCtrl(): J3DFrameCtrl {
        return this.xanimePlayer!.frameCtrl;
    }

    public startBck(name: string): void {
        this.xanimePlayer!.changeAnimationBck(name);
        this.xanimePlayer!.changeInterpoleFrame(0);
        this.bckCtrl!.changeBckSetting(name, this.xanimePlayer!);
    }

    public startBckWithInterpole(name: string, interpole: number): void {
        this.xanimePlayer!.changeAnimationBck(name);
        this.xanimePlayer!.changeInterpoleFrame(0);
        this.xanimePlayer!.changeInterpoleFrame(interpole);
    }

    public isBckStopped(): boolean {
        const bckCtrl = this.xanimePlayer!.frameCtrl;
        return !!(bckCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped);
    }

    public getBtkCtrl(): J3DFrameCtrl {
        return this.btkPlayer!.frameCtrl;
    }

    public startBtk(name: string): void {
        this.btkPlayer!.start(name);
    }

    public isBtkPlaying(name: string): boolean {
        return this.btkPlayer!.isPlaying(name);
    }

    public isBtkStopped(): boolean {
        return this.btkPlayer!.isStop();
    }

    public getBrkCtrl(): J3DFrameCtrl {
        return this.brkPlayer!.frameCtrl;
    }

    public startBrk(name: string): void {
        this.brkPlayer!.start(name);
    }

    public isBrkPlaying(name: string): boolean {
        return this.brkPlayer!.isPlaying(name);
    }

    public isBrkStopped(): boolean {
        return this.brkPlayer!.isStop();
    }

    public getBtpCtrl(): J3DFrameCtrl {
        return this.btpPlayer!.frameCtrl;
    }

    public startBtp(name: string): void {
        this.btpPlayer!.start(name);
    }

    public isBtpPlaying(name: string): boolean {
        return this.btpPlayer!.isPlaying(name);
    }

    public isBtpStopped(): boolean {
        return this.btpPlayer!.isStop();
    }

    public getBpkCtrl(): J3DFrameCtrl {
        return this.bpkPlayer!.frameCtrl;
    }

    public startBpk(name: string): void {
        this.bpkPlayer!.start(name);
    }

    public isBpkPlaying(name: string): boolean {
        return this.bpkPlayer!.isPlaying(name);
    }

    public isBpkStopped(): boolean {
        return this.bpkPlayer!.isStop();
    }

    public getBvaCtrl(): J3DFrameCtrl {
        return this.bvaPlayer!.frameCtrl;
    }

    public startBva(name: string): void {
        this.bvaPlayer!.start(name);
    }

    public isBvaPlaying(name: string): boolean {
        return this.bvaPlayer!.isPlaying(name);
    }

    public isBvaStopped(): boolean {
        return this.bvaPlayer!.isStop();
    }
}

export function getJMapInfoTrans(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoTransLocal(dst, infoIter);
    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    vec3.transformMat4(dst, dst, stageDataHolder.placementMtx);
}

const scratchMatrix = mat4.create();
export function getJMapInfoRotate(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, scratch: mat4 = scratchMatrix): void {
    getJMapInfoRotateLocal(dst, infoIter);

    // Compute local rotation matrix, combine with stage placement, and extract new rotation.
    computeModelMatrixSRT(scratch, 1, 1, 1, dst[0], dst[1], dst[2], 0, 0, 0);
    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    mat4.mul(scratch, stageDataHolder.placementMtx, scratch);

    computeEulerAngleRotationFromSRTMatrix(dst, scratch);
}

export function makeMtxTRFromActor(dst: mat4, actor: LiveActor): void {
    computeModelMatrixSRT(dst,
        1, 1, 1,
        actor.rotation[0], actor.rotation[1], actor.rotation[2],
        actor.translation[0], actor.translation[1], actor.translation[2]);
}

export function makeMtxTRSFromActor(dst: mat4, actor: LiveActor): void {
    computeModelMatrixSRT(dst,
        actor.scale[0], actor.scale[1], actor.scale[2],
        actor.rotation[0], actor.rotation[1], actor.rotation[2],
        actor.translation[0], actor.translation[1], actor.translation[2]);
}

export function resetPosition(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (actor.hitSensorKeeper !== null)
        actor.hitSensorKeeper.clear();
    if (actor.calcGravityFlag)
        calcGravity(sceneObjHolder, actor);
    // calcAnimDirect
    if (actor.collisionParts !== null)
        resetAllCollisionMtx(actor);
    // requestCalcActorShadowAppear
}

export const enum LayerId {
    Common = -1,
    LayerA = 0,
    LayerB,
    LayerC,
    LayerD,
    LayerE,
    LayerF,
    LayerG,
    LayerH,
    LayerI,
    LayerJ,
    LayerK,
    LayerL,
    LayerM,
    LayerN,
    LayerO,
    LayerP,
    LayerMax = LayerP,
}

export interface ZoneAndLayer {
    zoneId: number;
    layerId: LayerId;
}

export const dynamicSpawnZoneAndLayer: ZoneAndLayer = { zoneId: -1, layerId: LayerId.Common };

export const enum MessageType {
    EnemyAttack                              = 0x53,
    FirePressureRadiate_StartWait            = 0x68,
    FirePressureRadiate_StartSyncWait        = 0x69,
    TicoRail_StartTalk                       = 0xCE,
    MapPartsRailMover_TryRotate              = 0xCB,
    MapPartsRailMover_TryRotateBetweenPoints = 0xCD,
    MapPartsRailMover_Vanish                 = 0xCF,
    SphereSelector_SelectStart               = 0xE0,
    SphereSelector_SelectEnd                 = 0xE1,

    NoclipButton_Click                       = 0x200,
}

const scratchVec3a = vec3.create();
export class LiveActor<TNerve extends number = number> extends NameObj {
    public visibleScenario: boolean = true;
    public visibleAlive: boolean = true;
    public visibleModel: boolean = true;
    // calcGravity is off by default until we can feel comfortable turning it on...
    public calcGravityFlag: boolean = false;
    public calcBinderFlag: boolean = false;
    public boundingSphereRadius: number | null = null;

    public actorAnimKeeper: ActorAnimKeeper | null = null;
    public actorLightCtrl: ActorLightCtrl | null = null;
    public effectKeeper: EffectKeeper | null = null;
    public spine: Spine<TNerve> | null = null;
    public railRider: RailRider | null = null;
    public modelManager: ModelManager | null = null;
    public hitSensorKeeper: HitSensorKeeper | null = null;
    public collisionParts: CollisionParts | null = null;
    public binder: Binder | null = null;
    public stageSwitchCtrl: StageSwitchCtrl | null = null;

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public velocity = vec3.create();
    public gravityVector = vec3.fromValues(0, -1, 0);

    // HACK(jstpierre): For not having proper culling that stops movement
    public initWaitPhase: number = 0;

    constructor(public zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, public name: string) {
        super(sceneObjHolder, name);
    }

    // TODO(jstpierre): Remove these accessors.
    public get resourceHolder(): ResourceHolder {
        return this.modelManager!.resourceHolder;
    }

    public get modelInstance(): J3DModelInstance | null {
        return this.modelManager !== null ? this.modelManager.modelInstance : null;
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        // Do nothing by default.
    }

    public getSensor(name: string): HitSensor | null {
        if (this.hitSensorKeeper !== null)
            return this.hitSensorKeeper.getSensor(name);
        else
            return null;
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        return false;
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.validateBySystem();
        // endClipped
        this.visibleAlive = true;
        if (this.collisionParts !== null)
            validateCollisionPartsForActor(sceneObjHolder, this);
        resetPosition(sceneObjHolder, this);
        if (this.actorLightCtrl !== null)
            this.actorLightCtrl.reset(sceneObjHolder);

        // tryUpdateHitSensorsAll
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.update();

        // addToClippingTarget

        // connectToSceneTemporarily
        // connectToDrawTemporarily
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        vec3.set(this.velocity, 0, 0, 0);
        if (this.hitSensorKeeper !== null) {
            this.hitSensorKeeper.clear();
            this.hitSensorKeeper.invalidateBySystem();
        }
        if (this.binder !== null)
            this.binder.clear();
        if (this.effectKeeper !== null)
            this.effectKeeper.clear();
        if (this.collisionParts !== null)
            invalidateCollisionParts(sceneObjHolder, this.collisionParts);
        this.visibleAlive = false;
        // removeFromClippingTarget
        // disconnectToSceneTemporarily
        // disconnectToDrawTemporarily
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        const newVisibleScenario = sceneObjHolder.spawner.checkAliveScenario(this.zoneAndLayer);
        if (this.visibleScenario === newVisibleScenario)
            return;

        this.visibleScenario = newVisibleScenario;
        if (newVisibleScenario)
            this.onScenario(sceneObjHolder);
        else
            this.offScenario(sceneObjHolder);
    }

    // noclip hook for scenario changing. This should probably be makeActorAppeared/makeActorDead by default.

    protected onScenario(sceneObjHolder: SceneObjHolder): void {
        // this.makeActorAppeared(sceneObjHolder);

        if (this.effectKeeper !== null)
            this.effectKeeper.setVisibleScenario(true);
    }

    protected offScenario(sceneObjHolder: SceneObjHolder): void {
        // this.makeActorDead(sceneObjHolder);

        if (this.effectKeeper !== null)
            this.effectKeeper.setVisibleScenario(false);
    }

    public getBaseMtx(): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.modelMatrix;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const modelCache = sceneObjHolder.modelCache;

        // By default, we request the object's name.
        const objName = getObjectName(infoIter);
        modelCache.requestObjectData(objName);
    }

    public initModelManagerWithAnm(sceneObjHolder: SceneObjHolder, objName: string): void {
        this.modelManager = new ModelManager(sceneObjHolder, objName);

        vec3.copy(this.modelManager.modelInstance.baseScale, this.scale);
        this.calcAndSetBaseMtxBase();

        // Compute the joint matrices an initial time in case anything wants to rely on them...
        this.modelManager.modelInstance.calcAnim();

        // TODO(jstpierre): Seems like it's possible to have a secondary file for BCK animations?
        this.actorAnimKeeper = ActorAnimKeeper.tryCreate(this);
    }

    public initActorCollisionParts(sceneObjHolder: SceneObjHolder, name: string, hitSensor: HitSensor, resourceHolder: ResourceHolder | null, hostMtx: mat4 | null, scaleType: CollisionScaleType): void {
        if (resourceHolder === null) {
            this.collisionParts = createCollisionPartsFromLiveActor(sceneObjHolder, this, name, hitSensor, hostMtx, scaleType);
        } else {
            // TODO(jstpierre)
            // makeMtxTRSFromActor(scratchMatrix, this);
            // this.collisionParts = createCollisionPartsFromResourceHolder();
            throw "whoops";
        }

        invalidateCollisionPartsForActor(sceneObjHolder, this);
    }

    public initLightCtrl(sceneObjHolder: SceneObjHolder): void {
        this.actorLightCtrl = new ActorLightCtrl(this);
        this.actorLightCtrl.init(sceneObjHolder);
    }

    public initEffectKeeper(sceneObjHolder: SceneObjHolder, groupName: string | null): void {
        if (sceneObjHolder.effectSystem === null)
            return;
        if (groupName === null && this.modelInstance !== null)
            groupName = this.modelInstance.name;
        this.effectKeeper = new EffectKeeper(sceneObjHolder, this, assertExists(groupName));
    }

    public initRailRider(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.railRider = new RailRider(sceneObjHolder, infoIter);
    }

    public initHitSensor(): void {
        this.hitSensorKeeper = new HitSensorKeeper();
    }

    public initStageSwitch(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.stageSwitchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
    }

    public initBinder(radius: number, centerY: number, hitInfoCapacity: number): void {
        this.binder = new Binder(this.getBaseMtx()!, this.translation, this.gravityVector, centerY, radius, hitInfoCapacity);
        this.calcBinderFlag = true;

        // if (this.effectKeeper !== null)
        //     this.effectKeeper.setBinder(this.binder);
    }

    public initNerve(nerve: TNerve): void {
        this.spine = new Spine<TNerve>();
        this.spine.setNerve(nerve);
    }

    public setNerve(nerve: TNerve): void {
        this.spine!.setNerve(nerve);
    }

    public getCurrentNerve(): TNerve {
        return this.spine!.getCurrentNerve() as TNerve;
    }

    public getNerveStep(): number {
        return this.spine!.getNerveStep();
    }

    public calcAndSetBaseMtxBase(): void {
        makeMtxTRFromActor(this.modelInstance!.modelMatrix, this);
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.calcAndSetBaseMtxBase();
    }

    protected getActorVisible(camera: Camera): boolean {
        if (this.visibleScenario && this.visibleAlive) {
            if (this.boundingSphereRadius !== null)
                return camera.frustum.containsSphere(this.translation, this.boundingSphereRadius);
            else
                return true;
        } else {
            return false;
        }
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.modelManager === null)
            return;

        // calcAnmMtx
        vec3.copy(this.modelManager.modelInstance.baseScale, this.scale);
        this.calcAndSetBaseMtx(sceneObjHolder, viewerInput);
        this.modelManager.calcAnim(viewerInput);
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera, viewMatrix: mat4 | null): void {
        if (this.modelInstance === null)
            return;

        if (viewMatrix !== null)
            this.modelInstance.calcView(camera, camera.viewMatrix);
        else
            this.modelInstance.calcView(null, null);

        const visible = this.visibleModel && this.getActorVisible(camera);
        this.modelInstance.visible = visible;
        if (!visible)
            return;

        // Bind the correct scene texture.
        const indDummy = this.modelInstance.getTextureMappingReference('IndDummy');
        if (indDummy !== null)
            sceneObjHolder.specialTextureBinder.registerTextureMapping(indDummy, SpecialTextureType.OpaqueSceneTexture);

        if (this.actorLightCtrl !== null) {
            this.actorLightCtrl.loadLight(this.modelInstance, camera);
        } else {
            // If we don't have an individualized actor light control, then load the default area light.
            // This is basically what DrawBufferExecuter::draw() and DrawBufferGroup::draw() effectively do.

            const lightType = sceneObjHolder.sceneNameObjListExecutor.findLightType(this);
            if (lightType !== LightType.None) {
                const areaLightInfo = sceneObjHolder.lightDirector.findDefaultAreaLight(sceneObjHolder);
                const lightInfo = areaLightInfo.getActorLightInfo(lightType);

                // The reason we don't setAmbient here is a bit funky -- normally how this works
                // is that the J3DModel's DLs will set up the ambient, but when an actor has its
                // own ActorLightCtrl, through a long series of convoluted of actions, the
                // DrawBufferExecutor associated with that actor will stomp on the actor's ambient light
                // configuration. Without this, we're left with the DrawBufferGroup's light configuration,
                // and the actor's DL will override the ambient light there...
                // Rather than emulate the whole DrawBufferGroup system, quirks and all, just hardcode
                // this logic.
                //
                // Specifically, what's going on is that when an actor has an ActorLightCtrl, then the light
                // is loaded in DrawBufferShapeDrawer, *after* the material packet DL has been run. Otherwise,
                // it's loaded in either DrawBufferExecuter or DrawBufferGroup, which run before the material
                // DL, so the actor will overwrite the ambient light. I'm quite sure this is a bug in the
                // original game engine, honestly.
                lightInfo.setOnModelInstance(this.modelInstance, camera, false);
            }
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TNerve, deltaTimeFrames: number): void {
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
    }

    private updateBinder(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        if (this.binder !== null) {
            if (this.calcBinderFlag) {
                if (Number.isNaN(this.velocity[0]) || Number.isNaN(this.velocity[1]) || Number.isNaN(this.velocity[2]))
                    debugger;
                this.binder.bind(sceneObjHolder, scratchVec3a, this.velocity);
                if (Number.isNaN(scratchVec3a[0]) || Number.isNaN(scratchVec3a[1]) || Number.isNaN(scratchVec3a[2]))
                    debugger;
                vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, deltaTimeFrames);
            } else {
                vec3.scaleAndAdd(this.translation, this.translation, this.velocity, deltaTimeFrames);
                this.binder.clear();
            }
        } else {
            vec3.scaleAndAdd(this.translation, this.translation, this.velocity, deltaTimeFrames);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        // Don't do anything. All cleanup should have happened at offScenario time.
        if (!this.visibleScenario)
            return;

        if (this.calcGravityFlag)
            calcGravity(sceneObjHolder, this);

        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.doObjCol(sceneObjHolder);

        if (!this.visibleAlive)
            return;

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        if (this.modelManager !== null)
            this.modelManager.update(deltaTimeFrames);

        if (this.spine !== null) {
            if (this.initWaitPhase > 0) {
                this.initWaitPhase -= deltaTimeFrames;
            } else {
                this.spine.changeNerve();
                this.updateSpine(sceneObjHolder, this.getCurrentNerve(), deltaTimeFrames);
                this.spine.updateTick(deltaTimeFrames);
                this.spine.changeNerve();
            }
        }

        if (!this.visibleAlive)
            return;

        this.control(sceneObjHolder, viewerInput);

        if (!this.visibleAlive)
            return;

        // updateBinder()
        this.updateBinder(sceneObjHolder, deltaTimeFrames);

        // EffectKeeper::update()
        if (this.effectKeeper !== null)
            this.effectKeeper.updateSyncBckEffect(sceneObjHolder.effectSystem!, deltaTimeFrames);

        // ActorPadAndCameraCtrl::update()

        if (this.actorLightCtrl !== null)
            this.actorLightCtrl.update(sceneObjHolder, viewerInput.camera, false, deltaTimeFrames);

        // tryUpdateHitSensorsAll()
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.update();
    }
}

export function isDead(actor: LiveActor): boolean {
    return !actor.visibleAlive;
}

export class LiveActorGroup<T extends LiveActor> extends NameObjGroup<T> {
    public appearAll(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.objArray.length; i++)
            if (isDead(this.objArray[i]))
                this.objArray[i].makeActorAppeared(sceneObjHolder);
    }

    public killAll(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.objArray.length; i++)
            this.objArray[i].makeActorDead(sceneObjHolder);
    }

    public getLivingActorNum(): number {
        let count = 0;
        for (let i = 0; i < this.objArray.length; i++)
            if (!isDead(this.objArray[i]))
                ++count;
        return count;
    }

    public getActor(i: number): T {
        return this.objArray[i];
    }

    public getDeadActor(): T | null {
        for (let i = 0; i < this.objArray.length; i++)
            if (isDead(this.objArray[i]))
                return this.objArray[i];
        return null;
    }

    public registerActor(obj: T): void {
        this.registerObj(obj);
    }
}

export class MsgSharedGroup<T extends LiveActor> extends LiveActorGroup<T> {
    private pendingMessageType: MessageType | null = null;
    private pendingHitSensor: HitSensor | null = null;
    private pendingSensorName: string | null = null;

    constructor(sceneObjHolder: SceneObjHolder, public zoneId: number, public infoId: number, name: string, maxCount: number) {
        super(sceneObjHolder, name, maxCount);
        connectToScene(sceneObjHolder, this, 0x06, -1, -1, -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.pendingMessageType !== null) {
            for (let i = 0; i < this.objArray.length; i++) {
                const actor = this.objArray[i];
                const sensor = actor.getSensor(this.pendingSensorName!)!;
                sensor.receiveMessage(sceneObjHolder, this.pendingMessageType, this.pendingHitSensor!);
            }

            this.pendingMessageType = null;
            this.pendingHitSensor = null;
            this.pendingSensorName = null;
        }
    }

    public sendMsgToGroupMember(messageType: MessageType, hitSensor: HitSensor, sensorName: string): void {
        this.pendingMessageType = messageType;
        this.pendingHitSensor = hitSensor;
        this.pendingSensorName = sensorName;
    }
}

export function getJMapInfoClippingGroupID(infoIter: JMapInfoIter): number | null {
    return infoIter.getValueNumberNoInit('ClippingGroupId');
}

export function getJMapInfoGroupID(infoIter: JMapInfoIter): number | null {
    const groupId = infoIter.getValueNumberNoInit('GroupId');
    if (groupId !== null)
        return groupId;

    return getJMapInfoClippingGroupID(infoIter);
}

export class LiveActorGroupArray extends NameObj {
    private groups: MsgSharedGroup<LiveActor>[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'LiveActorGroupArray');
    }

    public getLiveActorGroup<T extends LiveActor>(actor: T): MsgSharedGroup<T> | null {
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            for (let j = 0; j < group.objArray.length; j++)
                if (group.objArray[j] === actor)
                    return group as MsgSharedGroup<T>;
        }

        return null;
    }

    public findGroup<T extends LiveActor>(zoneId: number, groupId: number): MsgSharedGroup<T> | null {
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            if (group.zoneId === zoneId && group.infoId === groupId)
                return group as MsgSharedGroup<T>;
        }

        return null;
    }

    public createGroup<T extends LiveActor>(sceneObjHolder: SceneObjHolder, zoneId: number, infoId: number, groupName: string, maxCount: number): MsgSharedGroup<T> {
        const group = new MsgSharedGroup<T>(sceneObjHolder, zoneId, infoId, groupName, maxCount);
        this.groups.push(group);
        return group;
    }

    public entry<T extends LiveActor>(sceneObjHolder: SceneObjHolder, actor: T, infoIter: JMapInfoIter, groupName: string | null, maxCount: number): MsgSharedGroup<T> | null {
        const zoneId = actor.zoneAndLayer.zoneId;
        const groupId = getJMapInfoGroupID(infoIter);
        if (groupId === null)
            return null;

        let group = this.findGroup<T>(zoneId, groupId);
        if (group === null) {
            if (groupName === null)
                groupName = `group${groupId}`;

            group = this.createGroup<T>(sceneObjHolder, zoneId, groupId, groupName, maxCount);
        }
        group.registerActor(actor);
        return group;
    }
}
