
import { NameObj, NameObjGroup } from "./NameObj";
import { EffectKeeper } from "./EffectSystem";
import { Spine } from "./Spine";
import { ActorLightCtrl } from "./LightData";
import { vec3, mat4 } from "gl-matrix";
import { SceneObjHolder, getObjectName, FPS, getDeltaTimeFrames, ResourceHolder } from "./Main";
import { GfxTexture } from "../gfx/platform/GfxPlatform";
import { EFB_WIDTH, EFB_HEIGHT } from "../gx/gx_material";
import { JMapInfoIter, createCsvParser, getJMapInfoTransLocal, getJMapInfoRotateLocal, getJMapInfoBool } from "./JMapInfo";
import { TextureMapping } from "../TextureHolder";
import { computeModelMatrixSRT, computeEulerAngleRotationFromSRTMatrix } from "../MathHelpers";
import { Camera } from "../Camera";
import { LightType } from "./DrawBuffer";

import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import * as Viewer from '../viewer';
import { assertExists, fallback } from "../util";
import { RailRider } from "./RailRider";
import { BvaPlayer, BrkPlayer, BtkPlayer, BtpPlayer, XanimePlayer, BckCtrl } from "./Animation";
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { isBtkExist, isBtkPlaying, startBtk, isBrkExist, isBrkPlaying, startBrk, isBpkExist, isBpkPlaying, startBpk, isBtpExist, startBtp, isBtpPlaying, isBvaExist, isBvaPlaying, startBva, isBckExist, isBckPlaying, startBck, calcGravity } from "./ActorUtil";
import { HitSensor, HitSensorKeeper } from "./HitSensor";

function setIndirectTextureOverride(modelInstance: J3DModelInstance, sceneTexture: GfxTexture): void {
    const m = modelInstance.getTextureMappingReference("IndDummy");
    if (m !== null)
        setTextureMappingIndirect(m, sceneTexture);
}

export function setTextureMappingIndirect(m: TextureMapping, sceneTexture: GfxTexture): void {
    m.gfxTexture = sceneTexture;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

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

        this.modelInstance.calcAnim(viewerInput.camera);
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

export const enum LayerId {
    COMMON = -1,
    LAYER_A = 0,
    LAYER_B,
    LAYER_C,
    LAYER_D,
    LAYER_E,
    LAYER_F,
    LAYER_G,
    LAYER_H,
    LAYER_I,
    LAYER_J,
    LAYER_K,
    LAYER_L,
    LAYER_M,
    LAYER_N,
    LAYER_O,
    LAYER_P,
    LAYER_MAX = LAYER_P,
}

export interface ZoneAndLayer {
    zoneId: number;
    layerId: LayerId;
}

export const dynamicSpawnZoneAndLayer: ZoneAndLayer = { zoneId: -1, layerId: LayerId.COMMON };

export const enum MessageType {
    TicoRail_StartTalk = 0xCE,
    MapPartsRailMover_TryRotate = 0xCB,
    MapPartsRailMover_TryRotateBetweenPoints = 0xCD,
    MapPartsRailMover_Vanish = 0xCF,
}

export class LiveActor<TNerve extends number = number> extends NameObj {
    public visibleScenario: boolean = true;
    public visibleAlive: boolean = true;
    public visibleModel: boolean = true;
    public boundingSphereRadius: number | null = null;

    public actorAnimKeeper: ActorAnimKeeper | null = null;
    public actorLightCtrl: ActorLightCtrl | null = null;
    public effectKeeper: EffectKeeper | null = null;
    public spine: Spine<TNerve> | null = null;
    public railRider: RailRider | null = null;
    public modelManager: ModelManager | null = null;
    public hitSensorKeeper: HitSensorKeeper | null = null;

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public velocity = vec3.create();
    public gravityVector = vec3.fromValues(0, -1, 0);
    // calcGravity is off by default until we can feel comfortable turning it on...
    public calcGravityFlag: boolean = false;

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

    public attackSensor(thisSensor: HitSensor, otherSensor: HitSensor): void {
        // Do nothing by default.
    }

    public getSensor(name: string): HitSensor | null {
        if (this.hitSensorKeeper !== null)
            return this.hitSensorKeeper.getSensor(name);
        else
            return null;
    }

    public receiveMessage(messageType: MessageType, thisSensor: HitSensor | null, otherSensor: HitSensor | null): boolean {
        return false;
    }

    public makeActorAppeared(): void {
        this.visibleAlive = true;
    }

    public makeActorDead(): void {
        this.visibleAlive = false;
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        this.visibleScenario = sceneObjHolder.spawner.checkAliveScenario(this.zoneAndLayer);
    }

    public setIndirectTextureOverride(sceneTexture: GfxTexture): void {
        setIndirectTextureOverride(this.modelInstance!, sceneTexture);
    }

    public getBaseMtx(): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.modelMatrix;
    }

    public getJointMtx(jointName: string): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.getJointToWorldMatrixReference(jointName);
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
        this.modelManager.modelInstance.calcJointToWorld();

        // TODO(jstpierre): RE the whole ModelManager / XanimePlayer thing.
        // Seems like it's possible to have a secondary file for BCK animations?
        this.actorAnimKeeper = ActorAnimKeeper.tryCreate(this);
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
        this.railRider = new RailRider(sceneObjHolder, this, infoIter);
    }

    public initHitSensor(): void {
        this.hitSensorKeeper = new HitSensorKeeper();
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

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.modelInstance === null)
            return;

        this.modelInstance.calcView(viewerInput.camera);

        const visible = this.visibleModel && this.getActorVisible(viewerInput.camera);
        this.modelInstance.visible = visible;
        if (!visible)
            return;

        if (this.actorLightCtrl !== null) {
            this.actorLightCtrl.loadLight(this.modelInstance, viewerInput.camera);
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
                lightInfo.setOnModelInstance(this.modelInstance, viewerInput.camera, false);
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.doObjCol();

        if (this.visibleAlive) {
            const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

            if (this.calcGravityFlag)
                calcGravity(sceneObjHolder, this);

            if (this.modelManager !== null)
                this.modelManager.update(deltaTimeFrames);

            // TODO(jstpierre): Split out updateSpine to a vfunc or something.
            if (this.spine !== null)
                this.spine.update(deltaTimeFrames);

            // TODO(jstpierre): Add control vfunc here.

            // updateBinder
            vec3.scaleAndAdd(this.translation, this.translation, this.velocity, deltaTimeFrames);

            if (this.effectKeeper !== null) {
                this.effectKeeper.updateSyncBckEffect(sceneObjHolder.effectSystem!, deltaTimeFrames);
                this.effectKeeper.setVisibleScenario(this.visibleAlive && this.visibleScenario);
            }

            if (this.actorLightCtrl !== null)
                this.actorLightCtrl.update(sceneObjHolder, viewerInput.camera, false, deltaTimeFrames);

            if (this.hitSensorKeeper !== null)
                this.hitSensorKeeper.update();
        }
    }
}

export function isDead(actor: LiveActor): boolean {
    return !actor.visibleAlive;
}

export class LiveActorGroup<T extends LiveActor> extends NameObjGroup<T> {
    public appearAll(): void {
        for (let i = 0; i < this.objArray.length; i++)
            if (isDead(this.objArray[i]))
                this.objArray[i].makeActorAppeared();
    }

    public killAll(): void {
        for (let i = 0; i < this.objArray.length; i++)
            this.objArray[i].makeActorAppeared();
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
