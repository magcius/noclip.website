
// Misc MapObj actors.

import { mat4, vec3 } from 'gl-matrix';
import { MathConstants, setMatrixTranslation } from '../MathHelpers';
import { assertExists, fallback } from '../util';
import * as Viewer from '../viewer';
import { addBodyMessageSensorMapObj, calcMtxFromGravityAndZAxis, calcUpVec, connectToSceneCollisionMapObj, connectToSceneCollisionMapObjStrongLight, connectToSceneCollisionMapObjWeakLight, connectToSceneEnvironment, connectToSceneEnvironmentStrongLight, connectToScenePlanet, getBrkFrameMax, getRailDirection, initCollisionParts, initDefaultPos, isBckExist, isBtkExist, isBtpExist, isExistCollisionResource, isRailReachedGoal, listenStageSwitchOnOffA, listenStageSwitchOnOffB, moveCoordAndFollowTrans, moveCoordAndTransToNearestRailPos, moveCoordToNearestPos, reverseRailDirection, rotateVecDegree, setBckFrameAndStop, setBrkFrameAndStop, setBtkFrameAndStop, setBtpFrameAndStop, startBck, startBrk, startBtk, startBtp, startBva, syncStageSwitchAppear, tryStartAllAnim, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB } from './ActorUtil';
import { tryCreateCollisionMoveLimit } from './Collision';
import { LightType } from './DrawBuffer';
import { deleteEffect, emitEffect, isEffectValid, isRegisteredEffect, setEffectHostSRT } from './EffectSystem';
import { HitSensor } from './HitSensor';
import { getJMapInfoArg0, getJMapInfoArg1, JMapInfoIter } from './JMapInfo';
import { LiveActor, MessageType, ZoneAndLayer } from './LiveActor';
import { getDeltaTimeFrames, getObjectName, SceneObj, SceneObjHolder } from './Main';
import { getMapPartsArgMoveConditionType, getMapPartsArgRailGuideType, MapPartsRailGuideDrawer, MapPartsRailMover, MapPartsRotator, MoveConditionType, RailGuideType } from './MapParts';
import { createIndirectPlanetModel, PartsModel } from './MiscActor';
import { isConnectedWithRail } from './RailRider';
import { isFirstStep, isGreaterStep } from './Spine';
import { ModelObj, createModelObjBloomModel } from './ModelObj';

// Scratchpad
const scratchVec3 = vec3.create();

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

class MapObjActor<TNerve extends number = number> extends LiveActor<TNerve> {
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
            this.initLightCtrl(sceneObjHolder);
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
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomObjName))
            this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, this.name, bloomObjName, this.modelInstance!.modelMatrix);

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

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
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
            super.calcAndSetBaseMtx(sceneObjHolder, viewerInput);
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
    }
}

export class SimpleEnvironmentObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoSimpleMapObj(initInfo);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
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
    }

    private getCurrentSinkDepth(): number {
        mat4.getTranslation(scratchVec3, this.getBaseMtx()!);
        vec3.subtract(scratchVec3, this.translation, scratchVec3);
        return vec3.length(scratchVec3) * Math.sign(vec3.dot(scratchVec3, this.gravityVector));
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(sceneObjHolder, viewerInput);

        vec3.scale(scratchVec3, this.gravityVector, this.waveForce.getCurrentValue());
        mat4.translate(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, scratchVec3);
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
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder): void {
        connectToSceneCollisionMapObj(sceneObjHolder, this);
    }

    public calcAndSetBaseMtx(): void {
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
