
// Misc MapObj actors.

import { mat4, vec3 } from 'gl-matrix';
import { MathConstants, setMatrixTranslation, isNearZero, getMatrixAxisY, scaleMatrix, Vec3UnitZ, isNearZeroVec3, normToLength, Vec3Zero, getMatrixTranslation } from '../../MathHelpers';
import { assertExists, fallback, assert } from '../../util';
import * as Viewer from '../../viewer';
import { addBodyMessageSensorMapObj, calcMtxFromGravityAndZAxis, calcUpVec, connectToSceneCollisionMapObj, connectToSceneCollisionMapObjStrongLight, connectToSceneCollisionMapObjWeakLight, connectToSceneEnvironment, connectToSceneEnvironmentStrongLight, connectToScenePlanet, getBrkFrameMax, getRailDirection, initCollisionParts, initDefaultPos, isBckExist, isBtkExist, isBtpExist, isExistCollisionResource, isRailReachedGoal, listenStageSwitchOnOffA, listenStageSwitchOnOffB, moveCoordAndFollowTrans, moveCoordAndTransToNearestRailPos, moveCoordToNearestPos, reverseRailDirection, rotateVecDegree, setBckFrameAndStop, setBrkFrameAndStop, setBtkFrameAndStop, setBtpFrameAndStop, startBck, startBrk, startBtk, startBtp, startBva, syncStageSwitchAppear, tryStartAllAnim, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB, connectToSceneMapObjMovement, getRailTotalLength, connectToSceneNoShadowedMapObjStrongLight, getRandomFloat, getNextRailPointArg2, isHiddenModel, moveCoord, getCurrentRailPointNo, getCurrentRailPointArg1, getEaseOutValue, hideModel, invalidateHitSensors, makeMtxUpFrontPos, isZeroGravity, calcGravity, showModel, validateHitSensors, vecKillElement, isLoopRail, isSameDirection, makeMtxFrontNoSupportPos, makeMtxUpNoSupportPos, getRailPos, getCurrentRailPointArg0, addHitSensor, isBckStopped, turnVecToVecCos, connectToSceneMapObj, getJointMtx, calcFrontVec, makeMtxFrontUpPos } from '../ActorUtil';
import { tryCreateCollisionMoveLimit, getFirstPolyOnLineToMap, isOnGround, isBindedGroundDamageFire, isBindedWall } from '../Collision';
import { LightType } from '../DrawBuffer';
import { deleteEffect, emitEffect, isEffectValid, isRegisteredEffect, setEffectHostSRT, setEffectHostMtx, deleteEffectAll } from '../EffectSystem';
import { HitSensor, HitSensorType } from '../HitSensor';
import { getJMapInfoArg0, getJMapInfoArg1, JMapInfoIter, getJMapInfoArg2, getJMapInfoArg5, getJMapInfoBool, getJMapInfoArg3, getJMapInfoArg4 } from '../JMapInfo';
import { LiveActor, MessageType, ZoneAndLayer, isDead, makeMtxTRFromActor } from '../LiveActor';
import { getDeltaTimeFrames, getObjectName, SceneObj, SceneObjHolder } from '../Main';
import { getMapPartsArgMoveConditionType, getMapPartsArgRailGuideType, MapPartsRailGuideDrawer, MapPartsRailMover, MapPartsRotator, MoveConditionType, RailGuideType } from '../MapParts';
import { createIndirectPlanetModel, PartsModel } from './MiscActor';
import { isConnectedWithRail } from '../RailRider';
import { isFirstStep, isGreaterStep, isGreaterEqualStep, isLessStep } from '../Spine';
import { ModelObj, createModelObjBloomModel, createModelObjMapObjStrongLight } from './ModelObj';
import { initMultiFur } from '../Fur';
import { initShadowVolumeSphere, initShadowVolumeCylinder, setShadowDropLength, initShadowVolumeBox, setShadowVolumeStartDropOffset } from '../Shadow';
import { initLightCtrl } from '../LightData';
import { drawWorldSpaceVector, getDebugOverlayCanvas2D } from '../../DebugJunk';
import { DrawBufferType } from '../NameObj';

// Scratchpad
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMatrix = mat4.create();

function setupInitInfoSimpleMapObj(initInfo: MapObjActorInitInfo): void {
    initInfo.setDefaultPos = true;
    initInfo.connectToScene = true;
    initInfo.initEffect = true;
    initInfo.effectFilename = null;
}

function setupInitInfoTypical(initInfo: MapObjActorInitInfo, objName: string): void {
    // Special cases go here.
}

function setupInitInfoColorChangeArg0(initInfo: MapObjActorInitInfo, infoIter: JMapInfoIter): void {
    initInfo.colorChangeFrame = fallback(getJMapInfoArg0(infoIter), -1);
}

function setupInitInfoTextureChangeArg1(initInfo: MapObjActorInitInfo, infoIter: JMapInfoIter): void {
    initInfo.texChangeFrame = fallback(getJMapInfoArg1(infoIter), -1);
}

function setupInitInfoPlanet(initInfo: MapObjActorInitInfo): void {
    initInfo.setDefaultPos = true;
    initInfo.connectToScene = true;
    initInfo.initEffect = true;
    initInfo.effectFilename = null;
}

class MapObjActorInitInfo<TNerve extends number = number> {
    public lightType: LightType = LightType.Planet;
    public initLightControl: boolean = false;
    public connectToScene: boolean = false;
    public setDefaultPos: boolean = true;
    public modelName: string | null = null;
    public initEffect: boolean = false;
    public effectFilename: string | null = null;
    public colorChangeFrame: number = -1;
    public texChangeFrame: number = -1;
    public rotator: boolean = false;
    public railMover: boolean = false;
    public initNerve: TNerve | null = null;
    public initHitSensor: boolean = false;
    public initFur: boolean = false;

    public setupDefaultPos(): void {
        this.setDefaultPos = true;
    }

    public setupConnectToScene(): void {
        this.connectToScene = true;
    }

    public setupModelName(name: string): void {
        this.modelName = name;
    }

    public setupEffect(name: string | null): void {
        this.initEffect = true;
        this.effectFilename = name;
    }

    public setupRotator(): void {
        this.rotator = true;
    }

    public setupRailMover(): void {
        this.railMover = true;
    }

    public setupNerve(nerve: TNerve): void {
        this.initNerve = nerve;
    }
}

abstract class MapObjActor<TNerve extends number = number> extends LiveActor<TNerve> {
    private bloomModel: ModelObj | null = null;
    private objName: string;
    protected rotator: MapPartsRotator | null = null;
    protected railMover: MapPartsRailMover | null = null;
    protected railGuideDrawer: MapPartsRailGuideDrawer | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, initInfo: MapObjActorInitInfo) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.objName = this.name;
        if (initInfo.modelName !== null)
            this.objName = initInfo.modelName;

        if (initInfo.setDefaultPos)
            initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.objName);
        if (initInfo.connectToScene)
            this.connectToScene(sceneObjHolder, initInfo);
        if (initInfo.initLightControl)
            initLightCtrl(sceneObjHolder, this);
        if (initInfo.initEffect !== null)
            this.initEffectKeeper(sceneObjHolder, initInfo.effectFilename);
        if (initInfo.initNerve !== null)
            this.initNerve(initInfo.initNerve as TNerve);

        if (isExistCollisionResource(this, this.objName)) {
            if (!initInfo.initHitSensor) {
                this.initHitSensor();
                addBodyMessageSensorMapObj(sceneObjHolder, this);
            }

            let hostMtx: mat4 | null = null;
            // TODO(jstpierre): Follow joint

            const bodySensor = this.getSensor('body')!;
            initCollisionParts(sceneObjHolder, this, this.objName, bodySensor, hostMtx);

            tryCreateCollisionMoveLimit(sceneObjHolder, this, bodySensor);
        }

        const connectedWithRail = isConnectedWithRail(infoIter);
        if (connectedWithRail)
            this.initRailRider(sceneObjHolder, infoIter);
        if (connectedWithRail && initInfo.railMover)
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
        if (initInfo.rotator)
            this.rotator = new MapPartsRotator(sceneObjHolder, this, infoIter);

        if (connectedWithRail) {
            const guideType = fallback(getMapPartsArgRailGuideType(this), RailGuideType.None);
            if (guideType !== RailGuideType.None) {
                sceneObjHolder.create(SceneObj.MapPartsRailGuideHolder);
                this.railGuideDrawer = sceneObjHolder.mapPartsRailGuideHolder!.createRailGuide(sceneObjHolder, this, 'RailPoint', infoIter);
            }
        }

        tryStartAllAnim(this, this.objName);
        if (initInfo.colorChangeFrame !== -1) {
            startBrk(this, 'ColorChange');
            setBrkFrameAndStop(this, initInfo.colorChangeFrame);
        }

        if (initInfo.texChangeFrame !== -1) {
            if (isBtpExist(this, 'TexChange')) {
                startBtp(this, 'TexChange');
                setBtpFrameAndStop(this, initInfo.texChangeFrame);
            }

            if (isBtkExist(this, 'TexChange')) {
                startBtk(this, 'TexChange');
                setBtkFrameAndStop(this, initInfo.texChangeFrame);
            }
        }

        const bloomObjName = `${this.objName}Bloom`;
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomObjName)) {
            this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, bloomObjName, bloomObjName, this.modelInstance!.modelMatrix);
            vec3.copy(this.bloomModel.scale, this.scale);
        }

        // tryCreateBreakModel
        // makeSubModels

        if (initInfo.initFur)
            initMultiFur(sceneObjHolder, this, initInfo.lightType);

        // Normally, makeActorAppeared / makeActorDead would be in here. However, due to TypeScript
        // constraints, the parent constructor has to be called first. So we split this into two stages.
        // Call initFinish.
    }

    protected initFinish(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.makeActorAppeared(sceneObjHolder);

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter))
            this.initCaseUseSwitchA(sceneObjHolder, infoIter);
        else
            this.initCaseNoUseSwitchA(sceneObjHolder, infoIter);

        if (useStageSwitchWriteB(sceneObjHolder, this, infoIter))
            this.initCaseUseSwitchB(sceneObjHolder, infoIter);
        else
            this.initCaseNoUseSwitchB(sceneObjHolder, infoIter);

        // useStageSwitchWriteDead

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        }

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        if (this.bloomModel !== null)
            this.bloomModel.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        if (this.bloomModel !== null)
            this.bloomModel.makeActorDead(sceneObjHolder);
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder, initInfo: MapObjActorInitInfo): void {
        // Default implementation.
        if (initInfo.lightType === LightType.Strong)
            connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);
        else if (initInfo.lightType === LightType.Weak)
            connectToSceneCollisionMapObjWeakLight(sceneObjHolder, this);
        else
            connectToSceneCollisionMapObj(sceneObjHolder, this);
    }

    protected initCaseUseSwitchA(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }

    protected initCaseUseSwitchB(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        // TODO(jstpierre): Switch B
    }

    protected initCaseNoUseSwitchA(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }

    protected initCaseNoUseSwitchB(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.startMapPartsFunctions(sceneObjHolder);
    }

    protected appearBloomModel(sceneObjHolder: SceneObjHolder): void {
        this.bloomModel!.makeActorAppeared(sceneObjHolder);
        tryStartAllAnim(this.bloomModel!, `${this.objName}Bloom`);
    }

    protected killBloomModel(sceneObjHolder: SceneObjHolder): void {
        this.bloomModel!.makeActorDead(sceneObjHolder);
    }

    public isObjectName(name: string): boolean {
        return this.objName === name;
    }

    public startMapPartsFunctions(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.start();
        if (this.railMover !== null)
            this.railMover.start();
        if (this.railGuideDrawer !== null)
            this.railGuideDrawer.start(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (this.rotator !== null)
            this.rotator.movement(sceneObjHolder, viewerInput);
        if (this.railMover !== null)
            this.railMover.movement(sceneObjHolder, viewerInput);
        if (this.railGuideDrawer !== null)
            this.railGuideDrawer.movement(sceneObjHolder, viewerInput);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        const hasAnyMapFunction = (
            (this.rotator !== null && this.rotator.isWorking())
        );

        if (hasAnyMapFunction) {
            const m = this.modelInstance!.modelMatrix;
            mat4.identity(m);

            if (this.rotator !== null && this.rotator.isWorking())
                mat4.mul(m, m, this.rotator.mtx);
            if (this.railMover !== null && this.railMover.isWorking())
                mat4.mul(m, m, this.railMover.mtx);

            setMatrixTranslation(m, this.translation);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);

        // Always request the rail guide if we're connected with a rail.
        if (isConnectedWithRail(infoIter)) {
            sceneObjHolder.modelCache.requestObjectData('RailPoint');
        }
    }
}

export class SimpleMapObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        setupInitInfoTypical(initInfo, getObjectName(infoIter));
        setupInitInfoColorChangeArg0(initInfo, infoIter);
        setupInitInfoTextureChangeArg1(initInfo, infoIter);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.initFinish(sceneObjHolder, infoIter);
    }
}

export class SimpleEnvironmentObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.initFinish(sceneObjHolder, infoIter);
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder, initInfo: MapObjActorInitInfo): void {
        // Default implementation.
        if (initInfo.lightType === LightType.Strong)
            connectToSceneEnvironmentStrongLight(sceneObjHolder, this);
        else
            connectToSceneEnvironment(sceneObjHolder, this);
    }
}

export class RotateMoveObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        initInfo.setupRotator();
        setupInitInfoTypical(initInfo, getObjectName(infoIter));
        setupInitInfoColorChangeArg0(initInfo, infoIter);
        setupInitInfoTextureChangeArg1(initInfo, infoIter);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        const moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        const startRotating = (moveConditionType === MoveConditionType.Unconditionally);
        // TODO(jstpierre): Also check SwitchB

        if (startRotating)
            this.startMapPartsFunctions(sceneObjHolder);

        this.initFinish(sceneObjHolder, infoIter);
    }
}

const enum RailMoveObjNrv { Move, Done, WaitForPlayerOn }

export class RailMoveObj extends MapObjActor<RailMoveObjNrv> {
    private isWorking: boolean;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupEffect(null);
        initInfo.setupRailMover();
        // initInfo.setupRailPosture();
        // initInfo.setupBaseMtxFollowTarget();
        initInfo.setupNerve(RailMoveObjNrv.Move);
        setupInitInfoTypical(initInfo, getObjectName(infoIter));

        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        this.isWorking = false;

        if (!isConnectedWithRail(infoIter))
            this.setNerve(RailMoveObjNrv.Done);

        const moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        if (moveConditionType === MoveConditionType.WaitForPlayerOn)
            this.setNerve(RailMoveObjNrv.WaitForPlayerOn);

        this.initFinish(sceneObjHolder, infoIter);
    }

    private startMoveInner(): void {
        // this.tryStageEffectStart();
        if (isBckExist(this, `Move`))
            startBck(this, `Move`);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, msgType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (msgType === MessageType.MapPartsRailMover_Vanish && this.getCurrentNerve() === RailMoveObjNrv.Move) {
            this.makeActorDead(sceneObjHolder);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, msgType, otherSensor, thisSensor);
    }

    protected move(): void {
        // this.tryStageEffectMoving();
    }

    protected doAtEndPoint(): void {
        // stop bck
    }

    protected endMove(): boolean {
        this.doAtEndPoint();
        return true;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RailMoveObjNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RailMoveObjNrv.Move) {
            if (isFirstStep(this))
                this.startMapPartsFunctions(sceneObjHolder);

            const isWorking = this.railMover!.isWorking();
            if (!this.isWorking && isWorking)
                this.startMoveInner();

            this.isWorking = isWorking;
            this.move();

            if (this.railMover!.isReachedEnd()) {
                if (!this.railMover!.isDone() || !this.endMove())
                    this.doAtEndPoint();
                else
                    this.setNerve(RailMoveObjNrv.Done);
            }
        }
    }
}

export class CollapsePlane extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupConnectToScene();
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
    }
}

const enum PeachCastleGardenPlanetNrv { Wait, Damage }

export class PeachCastleGardenPlanet extends MapObjActor<PeachCastleGardenPlanetNrv> {
    private indirectModel: PartsModel | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo<PeachCastleGardenPlanetNrv>();
        setupInitInfoPlanet(initInfo);
        initInfo.setupNerve(PeachCastleGardenPlanetNrv.Wait);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);

        this.initFinish(sceneObjHolder, infoIter);
    }

    protected initCaseUseSwitchA(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.initCaseUseSwitchA(sceneObjHolder, infoIter);
        // listenStageSwitchOnA(sceneObjHolder, this, this.startDamage.bind(this));
        listenStageSwitchOnOffA(sceneObjHolder, this, this.startDamage.bind(this), this.startWait.bind(this));
    }

    private startWait(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(PeachCastleGardenPlanetNrv.Wait);
    }

    private startDamage(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(PeachCastleGardenPlanetNrv.Damage);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PeachCastleGardenPlanetNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PeachCastleGardenPlanetNrv.Wait) {
            if (isFirstStep(this))
                startBrk(this, 'Before');
        } else if (currentNerve === PeachCastleGardenPlanetNrv.Damage) {
            if (isFirstStep(this))
                startBrk(this, 'After');
        }
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder): void {
        connectToScenePlanet(sceneObjHolder, this);
    }
}

export class AstroMapObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        const objectName = getObjectName(infoIter);
        const domeId = fallback(getJMapInfoArg0(infoIter), -1);
        initInfo.setupModelName(AstroMapObj.getModelName(objectName, domeId));
        initInfo.setupConnectToScene();
        initInfo.setupEffect(objectName);

        if (objectName === 'AstroRotateStepA' || objectName === 'AstroRotateStepB' || objectName === 'AstroDecoratePartsA')
            initInfo.setupRotator();

        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        tryStartAllAnim(this, 'Open');
        this.tryStartAllAnimAndEffect(sceneObjHolder, 'AliveWait');

        if (this.rotator !== null)
            this.startMapPartsFunctions(sceneObjHolder);

        this.setStateAlive(sceneObjHolder);

        this.initFinish(sceneObjHolder, infoIter);
    }

    private tryStartAllAnimAndEffect(sceneObjHolder: SceneObjHolder, name: string): void {
        tryStartAllAnim(this, name);
        if (this.isObjectName('AstroDomeEntranceKitchen'))
            emitEffect(sceneObjHolder, this, 'KitchenSmoke');
        if (isRegisteredEffect(this, name))
            emitEffect(sceneObjHolder, this, name);
    }

    private setStateAlive(sceneObjHolder: SceneObjHolder): void {
        tryStartAllAnim(this, 'Revival');
        this.tryStartAllAnimAndEffect(sceneObjHolder, 'AliveWait');
        tryStartAllAnim(this, 'Open');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const objectName = getObjectName(infoIter);
        const domeId = fallback(getJMapInfoArg0(infoIter), -1);
        sceneObjHolder.modelCache.requestObjectData(AstroMapObj.getModelName(objectName, domeId));
    }

    public static getModelName(objName: string, domeId: number): string {
        if (objName === 'AstroDomeEntrance') {
            const table = [
                'AstroDomeEntranceObservatory',
                'AstroDomeEntranceWell',
                'AstroDomeEntranceKitchen',
                'AstroDomeEntranceBedRoom',
                'AstroDomeEntranceMachine',
                'AstroDomeEntranceTower',
            ];
            return table[domeId - 1];
        } else if (objName === 'AstroStarPlate') {
            const table = [
                'AstroStarPlateObservatory',
                'AstroStarPlateWell',
                'AstroStarPlateKitchen',
                'AstroStarPlateBedRoom',
                'AstroStarPlateMachine',
                'AstroStarPlateTower',
            ];
            return table[domeId - 1];
        } else if (objName === 'AstroDome') {
            const table = [
                'AstroDomeObservatory',
                'AstroDomeWell',
                'AstroDomeKitchen',
                'AstroDomeBedRoom',
                'AstroDomeMachine',
                'AstroDomeTower',
            ];
            return table[domeId - 1];
        } else {
            return objName;
        }
    }
}

export class AstroCore extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        // We pick Revival4 because it's the most interesting of the bunch.
        tryStartAllAnim(this, 'Revival4');
    }
}

export class UFOKinokoUnderConstruction extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        setupInitInfoColorChangeArg0(initInfo, infoIter);
        setupInitInfoTextureChangeArg1(initInfo, infoIter);
        // Original actor tests isUFOKinokoBeforeConstruction() / isUFOKinokoUnderConstruction()
        // to determine which model to show. Here, we assume the player has unlocked the relevant flag...
        initInfo.setupModelName('UFOKinokoLandingAstro');
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.initFinish(sceneObjHolder, infoIter);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('UFOKinokoLandingAstro');
    }
}

class WaveFloatingForce {
    private theta: number;

    constructor(private frequency: number, private amplitude: number) {
        this.theta = Math.random() * MathConstants.TAU;
    }

    public update(deltaTime: number): void {
        this.theta += (MathConstants.TAU / this.frequency) * deltaTime;
        this.theta = this.theta % MathConstants.TAU;
    }

    public getCurrentValue(): number {
        return this.amplitude * Math.sin(this.theta);
    }
}

export class OceanWaveFloater extends MapObjActor {
    private waveForce: WaveFloatingForce;
    private upVec: vec3;
    private isRippling: boolean;
    private rippleStopThreshold: number;
    private rippleStartThreshold: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupEffect(null);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        let frequency: number, amplitude: number;
        if (this.name === 'OceanPierFloaterA') {
            frequency = 300;
            amplitude = 30;
            this.rippleStopThreshold = 140;
            this.rippleStartThreshold = 120;
        } else if (this.name === 'OceanHexagonFloater') {
            frequency = 330;
            amplitude = 50;
            this.rippleStopThreshold = 150;
            this.rippleStartThreshold = 100;
        } else {
            throw "whoops";
        }

        this.waveForce = new WaveFloatingForce(frequency, amplitude);

        setEffectHostSRT(this, 'Ripple', this.translation, null, null);

        this.upVec = vec3.create();
        calcUpVec(this.upVec, this);

        // For now.
        vec3.negate(this.gravityVector, this.upVec);

        this.isRippling = false;
        this.initFinish(sceneObjHolder, infoIter);
    }

    private getCurrentSinkDepth(): number {
        mat4.getTranslation(scratchVec3a, this.getBaseMtx()!);
        vec3.subtract(scratchVec3a, this.translation, scratchVec3a);
        return vec3.length(scratchVec3a) * Math.sign(vec3.dot(scratchVec3a, this.gravityVector));
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);

        vec3.scale(scratchVec3a, this.gravityVector, this.waveForce.getCurrentValue());
        mat4.translate(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, scratchVec3a);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        this.waveForce.update(getDeltaTimeFrames(viewerInput));

        // controlEffect
        const sinkDepth = this.getCurrentSinkDepth();
        if (sinkDepth <= this.rippleStopThreshold || !this.isRippling) {
            if (sinkDepth < this.rippleStartThreshold && !this.isRippling) {
                emitEffect(sceneObjHolder, this, 'Ripple');
                this.isRippling = true;
            }
        } else {
            deleteEffect(sceneObjHolder, this, 'Ripple');
            this.isRippling = false;
        }
    }
}

const enum TsukidashikunNrv { Relax, WaitForward, SignForward, MoveForward, WaitBack, SignBack, MoveBack }

export class Tsukidashikun extends MapObjActor<TsukidashikunNrv> {
    private speed: number;
    private waitStep: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo<TsukidashikunNrv>();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupEffect(null);
        // initInfo.setupSound(4);
        initInfo.setupNerve(TsukidashikunNrv.WaitBack);
        initInfo.initLightControl = true;
        initInfo.lightType = LightType.Strong;
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.speed = fallback(getJMapInfoArg0(infoIter), 10.0);
        this.waitStep = fallback(getJMapInfoArg0(infoIter), 120);
        moveCoordToNearestPos(this);
        this.initFinish(sceneObjHolder, infoIter);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TsukidashikunNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TsukidashikunNrv.MoveForward || currentNerve === TsukidashikunNrv.MoveBack) {
            moveCoordAndFollowTrans(this, this.speed * deltaTimeFrames);
            if (isRailReachedGoal(this)) {
                reverseRailDirection(this);
                if (currentNerve === TsukidashikunNrv.MoveForward)
                    this.setNerve(TsukidashikunNrv.WaitForward);
                else
                    this.setNerve(TsukidashikunNrv.WaitBack);
            }
        } else if (currentNerve === TsukidashikunNrv.WaitForward || currentNerve === TsukidashikunNrv.WaitBack) {
            if (isFirstStep(this)) {
                if (currentNerve === TsukidashikunNrv.WaitForward)
                    startBva(this, 'FWait');
                else
                    startBva(this, 'BWait');
            }

            if (isGreaterStep(this, this.waitStep)) {
                if (currentNerve === TsukidashikunNrv.WaitForward)
                    this.setNerve(TsukidashikunNrv.SignBack);
                else
                    this.setNerve(TsukidashikunNrv.SignForward);
            }
        } else if (currentNerve === TsukidashikunNrv.SignForward || currentNerve === TsukidashikunNrv.SignBack) {
            if (isFirstStep(this)) {
                startBck(this, 'Sign');
                if (currentNerve === TsukidashikunNrv.SignForward)
                    startBva(this, 'FSign');
                else
                    startBva(this, 'BSign');
            }

            if (isGreaterStep(this, 60)) {
                setBckFrameAndStop(this, 0.0);
                if (currentNerve === TsukidashikunNrv.SignForward)
                    this.setNerve(TsukidashikunNrv.MoveForward);
                else
                    this.setNerve(TsukidashikunNrv.MoveBack);
            }
        }
    }
}

const enum DriftWoodNrv { Wait }

export class DriftWood extends MapObjActor<DriftWoodNrv> {
    private front: vec3;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo<DriftWoodNrv>();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupEffect(null);
        initInfo.setupNerve(DriftWoodNrv.Wait);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        moveCoordAndTransToNearestRailPos(this);
        this.front = vec3.create();
        getRailDirection(this.front, this);
        this.initFinish(sceneObjHolder, infoIter);
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder): void {
        connectToSceneCollisionMapObj(sceneObjHolder, this);
    }

    protected calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.front);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: DriftWoodNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === DriftWoodNrv.Wait) {
            if (isFirstStep(this) && !isEffectValid(this, 'Ripple'))
                emitEffect(sceneObjHolder, this, 'Ripple');
            moveCoordAndFollowTrans(this, 3.0);
            rotateVecDegree(this.front, this.gravityVector, 0.05);
            // this.tryVibrate();
        }
    }
}

const enum UFOKinokoNrv { Wait }

export class UFOKinoko extends MapObjActor<UFOKinokoNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupEffect(null);
        initInfo.setupRailMover();
        initInfo.setupRotator();
        // initInfo.setupBaseMtxFolowTarget();
        initInfo.setupNerve(UFOKinokoNrv.Wait);
        setupInitInfoColorChangeArg0(initInfo, infoIter);
        // setupNoUseLodCtrl
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.rotator!.start();
        this.initFinish(sceneObjHolder, infoIter);
    }

    public initCaseUseSwitchB(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.initCaseUseSwitchB(sceneObjHolder, infoIter);
        listenStageSwitchOnOffB(sceneObjHolder, this, this.startMove.bind(this), this.stopMove.bind(this));
    }

    private startMove(): void {
        if (this.railMover !== null)
            this.railMover.start();
    }

    private stopMove(): void {
        // TODO(jstpierre)
        // if (this.railMover !== null)
        //     this.railMover.stop();
    }
}

const enum SideSpikeMoveStepNrv { Wait }

export class SideSpikeMoveStep extends MapObjActor<SideSpikeMoveStepNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo<SideSpikeMoveStepNrv>();
        initInfo.setupDefaultPos();
        initInfo.setupConnectToScene();
        initInfo.setupRailMover();
        initInfo.setupNerve(SideSpikeMoveStepNrv.Wait);
        setupInitInfoTypical(initInfo, getObjectName(infoIter));
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.initEffectKeeper(sceneObjHolder, null);
        // StarPointerTarget / AnimScaleController / WalkerStateBindStarPointer
        this.initFinish(sceneObjHolder, infoIter);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: SideSpikeMoveStepNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === SideSpikeMoveStepNrv.Wait) {
            if (isFirstStep(this))
                this.startMapPartsFunctions(sceneObjHolder);
        }
    }
}

const enum AstroDomeNrv { Wait }

export class AstroDome extends MapObjActor<AstroDomeNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const domeId = assertExists(getJMapInfoArg0(infoIter));
        const domeModelName = AstroMapObj.getModelName('AstroDome', domeId);
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupModelName(domeModelName);
        initInfo.setupNerve(AstroDomeNrv.Wait);
        setupInitInfoSimpleMapObj(initInfo);
        // setupNoAppearRiddleSE

        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
        this.initFinish(sceneObjHolder, infoIter);

        // invalidateClipping
        // registerTarget
        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: AstroDomeNrv, deltaTimeFrames: number): void {
        if (currentNerve === AstroDomeNrv.Wait) {
            if (isFirstStep(this)) {
                startBrk(this, 'Appear');
                setBrkFrameAndStop(this, getBrkFrameMax(this));
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const domeId = assertExists(getJMapInfoArg0(infoIter));
        const domeModelName = AstroMapObj.getModelName('AstroDome', domeId);
        sceneObjHolder.modelCache.requestObjectData(domeModelName);
    }
}

const enum RockNrv { Appear, AppearMoveInvalidBind, Move, MoveInvalidBind, Break }
const enum RockType { Rock, WanwanRolling, WanwanRollingMini, WanwanRollingGold }
class Rock extends LiveActor<RockNrv> {
    public useBreak: boolean = false;
    private type: RockType;
    private breakModel: ModelObj | null = null;
    private appearStep: number;
    private origTranslation = vec3.create();
    private lastTranslation = vec3.create();
    private speed: number;
    private bindRadius: number;
    private rotateSpeed: number;
    private fallSpeed: number;
    private falling: boolean = false;
    private fallVelocity = vec3.create();
    private rotatePhaseRandom: number = 0;
    private moveAirTimer: number = 0;
    private moveTimer: number = 0;
    private currentRailPointNo: number = -1;
    private effectHostMtx = mat4.create();
    private front = vec3.clone(Vec3UnitZ);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.type = Rock.getType(infoIter);
        if (this.type === RockType.Rock)
            this.appearStep = 8;
        else
            this.appearStep = 45;
        this.appearStep = fallback(getJMapInfoArg3(infoIter), this.appearStep);

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.origTranslation, this.translation);

        const scaleX = this.getScale();
        this.bindRadius = 225.0 * scaleX;
        this.speed = 10.0;
        const perim = this.bindRadius * (MathConstants.TAU / 2);
        this.rotateSpeed = (1.1 * (MathConstants.TAU / 2) * this.speed) / perim;

        if (isZeroGravity(sceneObjHolder, this)) {
            makeMtxTRFromActor(scratchMatrix, this);
            getMatrixAxisY(this.gravityVector, scratchMatrix);
            vec3.negate(this.gravityVector, this.gravityVector);
        } else {
            this.calcGravityFlag = true;
        }

        if (this.type === RockType.Rock) {
            this.initModelManagerWithAnm(sceneObjHolder, 'Rock');
            this.breakModel = createModelObjMapObjStrongLight(zoneAndLayer, sceneObjHolder, 'RockBreak', 'RockBreak', null);
            vec3.copy(this.breakModel.scale, this.scale);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else if (this.type === RockType.WanwanRolling) {
            this.initModelManagerWithAnm(sceneObjHolder, 'WanwanRolling');
            this.breakModel = createModelObjMapObjStrongLight(zoneAndLayer, sceneObjHolder, 'WanwanRollingBreak', 'WanwanRollingBreak', null);
            vec3.copy(this.breakModel.scale, this.scale);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else if (this.type === RockType.WanwanRollingMini) {
            this.initModelManagerWithAnm(sceneObjHolder, 'WanwanRollingMini');
        } else if (this.type === RockType.WanwanRollingGold) {
            this.initModelManagerWithAnm(sceneObjHolder, 'WanwanRollingGold');
            this.breakModel = createModelObjMapObjStrongLight(zoneAndLayer, sceneObjHolder, 'WanwanRollingGoldBreak', 'WanwanRollingGoldBreak', null);
            vec3.copy(this.breakModel.scale, this.scale);
            this.breakModel.makeActorDead(sceneObjHolder);
        }

        connectToSceneNoShadowedMapObjStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        const hitSensorType = this.type === RockType.Rock ? HitSensorType.Rock : HitSensorType.Wanwan;
        addHitSensor(sceneObjHolder, this, 'body', hitSensorType, 16, this.bindRadius, Vec3Zero);
        if (this.type === RockType.Rock) {
            vec3.set(scratchVec3a, 0.0, 0.0, -150.0);
            vec3.scale(scratchVec3a, scratchVec3a, this.scale[0]);
            addHitSensor(sceneObjHolder, this, 'weak', hitSensorType, 16, 125.0 * this.scale[0], scratchVec3a);
        }
        this.initBinder(this.bindRadius, 0.0, 0);
        this.initRailRider(sceneObjHolder, infoIter);

        if (this.type === RockType.WanwanRollingMini)
            this.initEffectKeeper(sceneObjHolder, 'WanwanRolling');
        else
            this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'Smoke', this.effectHostMtx);
        setEffectHostMtx(this, 'Land', this.effectHostMtx);
        // initStarPointerTarget
        // initSound

        const shadowDropLength = getJMapInfoArg4(infoIter);
        if (shadowDropLength !== null) {
            initShadowVolumeCylinder(sceneObjHolder, this, this.bindRadius);
            setShadowDropLength(this, null, shadowDropLength);
        } else {
            initShadowVolumeSphere(sceneObjHolder, this, this.bindRadius);
        }

        this.initNerve(RockNrv.Appear);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        this.moveAirTimer = 0;
        this.fallSpeed = 1.5;
        this.currentRailPointNo = -1;
        vec3.copy(this.translation, this.origTranslation);
        vec3.copy(this.lastTranslation, this.origTranslation);
        vec3.zero(this.rotation);

        if (isZeroGravity(sceneObjHolder, this))
            calcGravity(sceneObjHolder, this);

        moveCoordAndTransToNearestRailPos(this);
        showModel(this);
        // invalidateClipping
        validateHitSensors(this);
        getRailDirection(scratchVec3a, this);
        vecKillElement(this.front, scratchVec3a, this.gravityVector);
        vec3.normalize(this.front, this.front);

        if (this.type === RockType.Rock)
            this.setBtkForEnvironmentMap(this, 'Size');
        else if (this.type === RockType.WanwanRolling)
            this.setBtkForEnvironmentMap(this, 'WanwanRolling');

        super.makeActorAppeared(sceneObjHolder);

        if (isLoopRail(this)) {
            this.calcBinderFlag = true;
            this.setNerve(RockNrv.Move);
        } else {
            this.calcBinderFlag = false;
            this.setNerve(RockNrv.Appear);
        }
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);

        if (this.type === RockType.WanwanRollingMini)
            emitEffect(sceneObjHolder, this, 'MiniBreak');
    }

    public control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (!this.isNerve(RockNrv.Break)) {
            vec3.sub(scratchVec3a, this.translation, this.lastTranslation);
            if (!isNearZeroVec3(scratchVec3a, 0.001)) {
                vec3.normalize(scratchVec3a, scratchVec3a);
                vec3.copy(this.lastTranslation, this.translation);
            }

            const isMoving = this.isNerve(RockNrv.Appear) || this.isNerve(RockNrv.AppearMoveInvalidBind) || this.isNerve(RockNrv.Move) || this.isNerve(RockNrv.MoveInvalidBind);

            // isInClippingRange
            showModel(this);
            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.translation, scratchVec3a, 100.0);

            if (isMoving) {
                // TODO(jstpierre): This exposes some precision issues with our Binder.
                // turnVecToVecCos(this.front, this.front, scratchVec3a, 0.999, this.gravityVector, 0.02);

                vec3.lerp(this.front, this.front, scratchVec3a, 0.02);
                vec3.normalize(this.front, this.front);
            }

            if (isOnGround(this))
                vec3.zero(this.fallVelocity);

            if (this.isNerve(RockNrv.Move)) {
                getRailPos(scratchVec3a, this);
                vec3.sub(scratchVec3a, scratchVec3a, this.translation);
                vecKillElement(this.velocity, scratchVec3a, this.gravityVector);
                vec3.scaleAndAdd(this.fallVelocity, this.fallVelocity, this.gravityVector, this.fallSpeed);

                vec3.add(this.velocity, this.velocity, this.fallVelocity);
                if (vec3.length(this.velocity) > 30.0)
                    normToLength(this.velocity, 30.0);
            }
        }
    }

    protected calcAndSetBaseMtx(): void {
        this.calcBaseMtx(this.modelInstance!.modelMatrix);

        if (this.isNerve(RockNrv.AppearMoveInvalidBind) || this.isNerve(RockNrv.MoveInvalidBind) || (this.isNerve(RockNrv.Move) && isOnGround(this))) {
            if (this.isNerve(RockNrv.Move))
                vec3.copy(scratchVec3a, this.binder!.floorHitInfo.faceNormal);
            else
                vec3.negate(scratchVec3a, this.gravityVector);

            vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3a, -this.bindRadius);
            if (isSameDirection(scratchVec3a, this.front, 0.01))
                makeMtxUpNoSupportPos(this.effectHostMtx, scratchVec3a, scratchVec3b);
            else
                makeMtxUpFrontPos(this.effectHostMtx, scratchVec3a, this.front, scratchVec3b);

            // const scale = this.getScale();
            // scaleMatrix(this.effectHostMtx, this.effectHostMtx, scale);
        }
    }

    private setBtkForEnvironmentMap(actor: LiveActor, name: string): void {
        const scaleX = this.scale[0];
        let frame = 0.0;
        if (this.type === RockType.Rock) {
            if (isNearZero(scaleX - 0.5, 0.001))
                frame = 0.0;
            else if (isNearZero(scaleX - 2.0, 0.001))
                frame = 2.0;
            else
                frame = 1.0;
        } else if (this.type === RockType.WanwanRolling) {
            if (isNearZero(scaleX - 0.9, 0.001))
                frame = 1.0;
            else if (isNearZero(scaleX - 0.5, 0.001))
                frame = 2.0;
            else
                frame = 0.0;
        }

        startBtk(actor, name);
        setBtkFrameAndStop(actor, frame);
    }

    private updateRotateX(n: number): void {
        this.rotation[0] = n % MathConstants.TAU;
    }

    private moveOnRail(sceneObjHolder: SceneObjHolder, speed: number, rotateSpeed: number, bindGround: boolean): void {
        moveCoordAndFollowTrans(this, speed);
        this.updateRotateX(this.rotation[0] + rotateSpeed);

        if (bindGround) {
            vec3.scale(scratchVec3a, this.gravityVector, this.bindRadius * 2.0);
            if (getFirstPolyOnLineToMap(sceneObjHolder, scratchVec3b, null, this.translation, scratchVec3a))
                vec3.scaleAndAdd(this.translation, scratchVec3b, this.gravityVector, -this.bindRadius);
        }
    }

    private move(speed: number): boolean {
        moveCoord(this, speed);
        const railPointNo = getCurrentRailPointNo(this);
        if (this.currentRailPointNo !== railPointNo) {
            this.currentRailPointNo = railPointNo;

            const slowFall = fallback(getCurrentRailPointArg0(this), -1) >= 0;
            if (slowFall) {
                this.falling = false;
                this.fallSpeed = 0.2;
            }

            const invalidBindSection = fallback(getCurrentRailPointArg1(this), -1) >= 0;
            if (invalidBindSection) {
                this.setNerve(RockNrv.MoveInvalidBind);
                return false;
            }
        }

        return true;
    }

    private isForceInvalidBindSection(): boolean {
        return getJMapInfoBool(fallback(getNextRailPointArg2(this), -1));
    }

    private tryFreeze(nrv: RockNrv): boolean {
        return false;
    }

    private isBreakByWall(): boolean {
        if (isBindedWall(this)) {
            getRailDirection(scratchVec3a, this);
            return vec3.dot(this.binder!.floorHitInfo.faceNormal, scratchVec3a) < -0.5;
        } else {
            return false;
        }
    }

    private tryBreakReachedGoal(sceneObjHolder: SceneObjHolder): boolean {
        if (isRailReachedGoal(this)) {
            if (this.useBreak)
                this.setNerve(RockNrv.Break);
            else
                this.makeActorDead(sceneObjHolder);
            return true;
        } else {
            return false;
        }
    }

    private calcBaseMtx(dst: mat4): void {
        vec3.negate(scratchVec3a, this.gravityVector);
        if (isSameDirection(scratchVec3a, this.front, 0.001))
            makeMtxFrontNoSupportPos(dst, scratchVec3a, this.translation);
        else
            makeMtxUpFrontPos(dst, scratchVec3a, this.front, this.translation);
        mat4.rotateX(dst, dst, this.rotation[0]);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RockNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RockNrv.Appear) {
            const perim = this.bindRadius * (MathConstants.TAU / 2);
            const rotateSpeed = (MathConstants.DEG_TO_RAD * 1386.0) / perim;

            if (isFirstStep(this) && this.type === RockType.WanwanRollingMini) {
                this.rotatePhaseRandom = getRandomFloat(0, MathConstants.TAU);
                this.updateRotateX(this.rotatePhaseRandom - rotateSpeed * this.appearStep);
            }

            if (isLessStep(this, this.appearStep))
                this.moveOnRail(sceneObjHolder, 7.0, rotateSpeed, false);

            if (isGreaterEqualStep(this, this.appearStep) && isLessStep(this, this.appearStep + 15)) {
                const t = this.getNerveStep() - this.appearStep;
                const rotateAnim = MathConstants.DEG_TO_RAD * ((15.0 - t) * (5.0 * Math.sin(MathConstants.DEG_TO_RAD * 100.0 * t)) / 15.0);
                this.updateRotateX(this.rotatePhaseRandom + rotateAnim);
            }

            const pauseStep = this.type === RockType.Rock ? 4 : 25;
            if (isGreaterEqualStep(this, this.appearStep + 15 + pauseStep)) {
                this.setNerve(RockNrv.AppearMoveInvalidBind);
            }
        } else if (currentNerve === RockNrv.AppearMoveInvalidBind) {
            if (!isHiddenModel(this)) {
                emitEffect(sceneObjHolder, this, 'Smoke');
                if (this.type === RockType.WanwanRollingGold)
                    emitEffect(sceneObjHolder, this, 'Light');
            }

            // startRollLevelSound
            // startSoundWanwanVoice

            if (!this.tryFreeze(RockNrv.AppearMoveInvalidBind)) {
                const forceInvalidBind = this.isForceInvalidBindSection();
                this.moveOnRail(sceneObjHolder, this.speed, this.rotateSpeed, forceInvalidBind);
                if (!forceInvalidBind && isGreaterEqualStep(this, 45)) {
                    this.calcBinderFlag = true;
                    this.setNerve(RockNrv.Move);
                }
            }
        } else if (currentNerve === RockNrv.Move) {
            if (isOnGround(this)) {
                if (this.type === RockType.Rock && isBindedGroundDamageFire(sceneObjHolder, this))
                    this.setNerve(RockNrv.Break);

                if (!isHiddenModel(this)) {
                    emitEffect(sceneObjHolder, this, 'Smoke');
                    if (this.type === RockType.WanwanRollingGold)
                        emitEffect(sceneObjHolder, this, 'Light');
                }

                if (this.moveAirTimer >= 20) {
                    if (!isHiddenModel(this)) {
                        emitEffect(sceneObjHolder, this, 'Land');
                        // rumblePadAndCamera
                    }

                    // startSound
                }

                this.moveAirTimer = 0;
            } else {
                if (this.moveAirTimer < 20)
                    this.moveAirTimer += deltaTimeFrames;
                else
                    deleteEffect(sceneObjHolder, this, 'Smoke');
            }

            if (isOnGround(this)) {
                if (this.falling)
                    this.fallSpeed = 1.5;
            } else {
                this.falling = true;
            }

            if (this.isBreakByWall()) {
                if (this.type === RockType.Rock)
                    this.setNerve(RockNrv.Break);
                else
                    this.makeActorDead(sceneObjHolder);
            } else if (this.tryBreakReachedGoal(sceneObjHolder)) {
                // Don't bother doing anything; we're broken.
            } else {
                let speed = this.speed;
                if (this.moveTimer > 0) {
                    speed = getEaseOutValue(this.moveTimer, this.speed, 0.0, 150.0);
                    this.moveTimer -= deltaTimeFrames;
                    this.moveTimer = Math.max(this.moveTimer, 0.0);
                }

                this.move(speed * deltaTimeFrames);

                let rotateSpeed = this.rotateSpeed * (speed / this.speed);
                if (this.moveTimer > 130) {
                    const t = 150 - this.moveTimer;
                    rotateSpeed = rotateSpeed + (20 - t) * (5.0 * Math.sin(MathConstants.DEG_TO_RAD * 100.0 * t) / 2.0) * MathConstants.DEG_TO_RAD;
                }
                this.updateRotateX(this.rotation[0] + rotateSpeed * deltaTimeFrames);
                this.tryFreeze(RockNrv.Move);
            }
        } else if (currentNerve === RockNrv.MoveInvalidBind) {
            if (isFirstStep(this)) {
                moveCoordAndTransToNearestRailPos(this);
                vec3.zero(this.velocity);
                this.calcBinderFlag = false;
                deleteEffect(sceneObjHolder, this, 'Smoke');
            }

            // startRollLevelSound
            // startSoundWanwanVoice
            if (!this.tryBreakReachedGoal(sceneObjHolder))
                this.moveOnRail(sceneObjHolder, this.speed, this.rotateSpeed, false);
        } else if (currentNerve === RockNrv.Break) {
            if (isFirstStep(this)) {
                // isInClippingRange
                hideModel(this);
                invalidateHitSensors(this);
                vec3.zero(this.rotation);
                vec3.zero(this.velocity);
                deleteEffectAll(this);

                vec3.copy(this.breakModel!.translation, this.translation);
                this.calcBaseMtx(scratchMatrix);

                // rotate break model

                this.breakModel!.makeActorAppeared(sceneObjHolder);
                startBck(this.breakModel!, 'Break');

                if (this.type === RockType.WanwanRolling)
                    this.setBtkForEnvironmentMap(this.breakModel!, 'WanwanRollingBreak');

                // rumblePadAndCamera
            }

            if (this.type === RockType.WanwanRollingGold) {
                // stopSceneAtStep
                // requestAppearPowerStar
            }

            if (isBckStopped(this.breakModel!)) {
                this.makeActorDead(sceneObjHolder);
                this.breakModel!.makeActorDead(sceneObjHolder);
            }
        }
    }

    private getScale(): number {
        if (this.type === RockType.WanwanRollingMini)
            return 0.3;
        else
            return this.scale[0];
    }

    public static getType(infoIter: JMapInfoIter): RockType {
        const objectName = getObjectName(infoIter);
        if (objectName === 'WanwanRolling')
            return RockType.WanwanRolling;
        else if (objectName === 'WanwanRollingMini')
            return RockType.WanwanRollingMini;
        else if (objectName === 'WanwanRollingGold')
            return RockType.WanwanRollingGold;
        else
            return RockType.Rock;
    }

    public static getAppearFrame() {
        return 55;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const type = Rock.getType(infoIter);

        if (type === RockType.Rock) {
            sceneObjHolder.modelCache.requestObjectData('Rock');
            sceneObjHolder.modelCache.requestObjectData('RockBreak');
        } else if (type === RockType.WanwanRolling) {
            sceneObjHolder.modelCache.requestObjectData('WanwanRolling');
            sceneObjHolder.modelCache.requestObjectData('WanwanRollingBreak');
        } else if (type === RockType.WanwanRollingMini) {
            sceneObjHolder.modelCache.requestObjectData('WanwanRollingMini');
        } else if (type === RockType.WanwanRollingGold) {
            sceneObjHolder.modelCache.requestObjectData('WanwanRollingGold');
            sceneObjHolder.modelCache.requestObjectData('WanwanRollingGoldBreak');
        }
    }
}

const enum RockCreatorNrv { Active, Deactive }
export class RockCreator extends LiveActor<RockCreatorNrv> {
    private arg0: number;
    private framesBetweenRocks: number;
    private rockCount: number;
    private useBreak: boolean;
    private rocks: Rock[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToSceneMapObjMovement(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.arg0 = fallback(getJMapInfoArg0(infoIter), 10.0);

        const type = Rock.getType(infoIter);
        if (type === RockType.Rock)
            this.useBreak = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        else
            this.useBreak = getJMapInfoBool(fallback(getJMapInfoArg5(infoIter), -1));

        this.initRailRider(sceneObjHolder, infoIter);
        this.initNerve(RockCreatorNrv.Active);

        useStageSwitchReadAppear(sceneObjHolder, this, infoIter);
        syncStageSwitchAppear(sceneObjHolder, this);

        // invalidate on switch A

        const arg1 = getJMapInfoArg1(infoIter);
        if (arg1 !== null && arg1 > 0) {
            this.framesBetweenRocks = 60 * arg1;
            this.rockCount = (Rock.getAppearFrame() + ((getRailTotalLength(this) / this.arg0) | 0)) / this.framesBetweenRocks + 2;
        } else {
            this.framesBetweenRocks = -1;
            this.rockCount = 1;
        }

        for (let i = 0; i < this.rockCount; i++) {
            const rock = new Rock(zoneAndLayer, sceneObjHolder, infoIter);
            rock.useBreak = this.useBreak;
            this.rocks.push(rock);
        }

        this.makeActorDead(sceneObjHolder);
    }

    private create(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.rocks.length; i++) {
            if (isDead(this.rocks[i])) {
                this.rocks[i].makeActorAppeared(sceneObjHolder);
                return;
            }
        }
        assert(false);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RockCreatorNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RockCreatorNrv.Active) {
            if (this.framesBetweenRocks < 0 || isGreaterEqualStep(this, this.framesBetweenRocks)) {
                this.create(sceneObjHolder);

                if (this.framesBetweenRocks < 0)
                    this.setNerve(RockCreatorNrv.Deactive);
                else
                    this.setNerve(RockCreatorNrv.Active);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        Rock.requestArchives(sceneObjHolder, infoIter);
    }
}

const enum WatchTowerRotateStepNrv { Move }
export class WatchTowerRotateStep extends LiveActor<WatchTowerRotateStepNrv> {
    private upVec = vec3.create();
    private lifts: PartsModel[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'WatchTowerRotateStep');
        connectToSceneMapObj(sceneObjHolder, this);
        this.initHitSensor();
        const bodySensor = addBodyMessageSensorMapObj(sceneObjHolder, this);
        initCollisionParts(sceneObjHolder, this, 'WatchTowerRotateStep', bodySensor, null);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        // setClippingTypeSphereContainsModelBoundingBox
        // tryRegisterDemoCast
        calcUpVec(this.upVec, this);
        this.initLift(sceneObjHolder);
        this.initNerve(WatchTowerRotateStepNrv.Move);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(): void {
        calcFrontVec(scratchVec3a, this);
        makeMtxFrontUpPos(this.modelInstance!.modelMatrix, scratchVec3a, this.upVec, this.translation);
    }

    private attachLift(): void {
        for (let i = 0; i < 4; i++)
            getMatrixTranslation(this.lifts[i].translation, getJointMtx(this, i + 1));
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WatchTowerRotateStepNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === WatchTowerRotateStepNrv.Move) {
            calcFrontVec(scratchVec3a, this);
            rotateVecDegree(this.upVec, scratchVec3a, 0.3 * deltaTimeFrames);
            this.attachLift();
        }
    }

    private initLift(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < 4; i++) {
            const lift = new PartsModel(sceneObjHolder, 'WatchTowerRotateStepLift', 'WatchTowerRotateStepLift', this, DrawBufferType.None, getJointMtx(this, i + 1));
            lift.useParentMatrix = false;
            initCollisionParts(sceneObjHolder, lift, 'WatchTowerRotateStepLift', this.getSensor('body')!);
            vec3.set(scratchVec3a, 600.0, 200.0, 400.0);
            initShadowVolumeBox(sceneObjHolder, lift, scratchVec3a, lift.getBaseMtx()!);
            setShadowVolumeStartDropOffset(lift, null, 300.0);
            setShadowDropLength(lift, null, 370.0);
            this.lifts.push(lift);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('WatchTowerRotateStepLift');
    }
}
