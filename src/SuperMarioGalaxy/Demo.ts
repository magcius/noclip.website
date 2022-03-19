
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { assertExists, fallback } from "../util";
import { ViewerRenderInput } from "../viewer";
import { connectToScene, startAction } from "./ActorUtil";
import { createCsvParser, createJMapIdInfoFromIter, JMapIdInfo, JMapInfoIter } from "./JMapInfo";
import { LiveActor, LiveActorGroup, ZoneAndLayer } from "./LiveActor";
import { SceneObj, SceneObjHolder } from "./Main";
import { CalcAnimType, DrawBufferType, DrawType, GameBits, MovementType, NameObj, NameObjGroup } from "./NameObj";
import { createStageSwitchCtrl, getSwitchWatcherHolder, StageSwitchCtrl, SwitchFunctorEventListener } from "./Switch";

function getDemoName(infoIter: JMapInfoIter): string {
    return infoIter.getValueString('DemoName')!;
}

function getDemoGroupLinkID(infoIter: JMapInfoIter): number {
    return infoIter.getValueNumber('l_id')!;
}

function getDemoGroupID(infoIter: JMapInfoIter): number | null {
    return infoIter.getValueNumber('DemoGroupId');
}

export class DemoCastGroup extends NameObj {
    public group: LiveActorGroup<LiveActor>;
    public idInfo: JMapIdInfo;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(sceneObjHolder, getDemoName(infoIter));
        this.group = new LiveActorGroup(sceneObjHolder, 'DemoCastGroup', 192);
        this.idInfo = createJMapIdInfoFromIter(sceneObjHolder, getDemoGroupLinkID(infoIter), infoIter);
    }

    protected registerDemoActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter): void {
        this.group.registerActor(actor);
    }

    public tryRegisterDemoActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter, linkIdInfo: JMapIdInfo): boolean {
        if (this.idInfo.equals(linkIdInfo)) {
            this.registerDemoActor(sceneObjHolder, actor, infoIter);
            return true;
        } else {
            return false;
        }
    }
}

function getDemoSheetName(infoIter: JMapInfoIter): string {
    return infoIter.getValueString('TimeSheetName')!;
}

function createSheetParser(sceneObjHolder: SceneObjHolder, executor: DemoExecutor, sheet: string): JMapInfoIter | null {
    const sheetFilename = `Demo${executor.sheetName}${sheet}.bcsv`;
    const zoneId = executor.idInfo.zoneId;
    const demoSheetArchive = assertExists(sceneObjHolder.demoDirector!.getDemoSheetArchiveForZone(sceneObjHolder, zoneId));
    const sheetData = demoSheetArchive.findFilenameData(sheetFilename);
    if (sheetData !== null)
        return createCsvParser(sheetData);
    else
        return null;
}

class DemoTimePartInfo {
    public partName: string;
    public totalStep: number;
    public suspendFlag: boolean;

    constructor(infoIter: JMapInfoIter) {
        this.partName = assertExists(infoIter.getValueString('PartName'));
        this.totalStep = assertExists(infoIter.getValueNumber('TotalStep'));
        this.suspendFlag = assertExists(infoIter.getValueNumber('SuspendFlag')) !== 0;
    }
}

class DemoTimeKeeper {
    private partInfos: DemoTimePartInfo[];
    private currentPartIndex: number = -1;
    public partTimer = -1;
    public totalTimer = -1;
    public paused = false;

    constructor(sceneObjHolder: SceneObjHolder, executor: DemoExecutor) {
        const sheet = createSheetParser(sceneObjHolder, executor, 'Time');
        if (sheet !== null)
            this.partInfos = sheet.mapRecords((infoIter) => new DemoTimePartInfo(infoIter));
        else
            this.partInfos = [];
    }

    public getCurrentPartInfo(): DemoTimePartInfo | null {
        return this.partInfos[this.currentPartIndex];
    }

    public setCurrentPart(name: string): void {
        this.currentPartIndex = -1;
        for (let i = 0; i < this.partInfos.length; i++) {
            if (this.partInfos[i].partName === name) {
                this.currentPartIndex = i;
                return;
            }
        }
    }

    public pause(): void {
        this.paused = true;
    }

    public resume(): void {
        this.paused = false;
    }

    public start(): void {
        this.currentPartIndex = 0;
    }

    public end(): void {
        this.currentPartIndex = -1;
        this.totalTimer = -1;
        this.partTimer = -1;
    }

    public isPartLast(): boolean {
        if (this.paused)
            return false;
        return this.currentPartIndex >= this.partInfos.length - 1;
    }

    public isCurrentDemoPartLastStep(): boolean {
        const currentPart = assertExists(this.getCurrentPartInfo());
        return this.partTimer >= currentPart.totalStep;
    }

    public isExistSuspendFlagCurrentPart(): boolean {
        const currentPart = assertExists(this.getCurrentPartInfo());
        return currentPart.suspendFlag;
    }

    public isDemoEnd(): boolean {
        if (this.paused)
            return false;
        const currentPart = assertExists(this.getCurrentPartInfo());
        if (this.partTimer >= currentPart.totalStep && currentPart.suspendFlag)
            return true;
        if (this.partTimer >= currentPart.totalStep && this.currentPartIndex >= this.partInfos.length - 1)
            return true;
        return false;
    }

    public update(deltaTimeFrames: number): void {
        if (this.paused) {
            if (this.partTimer < 0)
                this.partTimer++;
            if (this.totalTimer < 0)
                this.totalTimer++;
            return;
        }

        this.partTimer++;
        this.totalTimer++;
        const currentPart = assertExists(this.partInfos[this.currentPartIndex]);
        if (this.partTimer >= currentPart.totalStep) {
            if (currentPart.suspendFlag)
                return;

            if (this.currentPartIndex < this.partInfos.length - 1) {
                this.currentPartIndex++;
                this.partTimer = 0;
            }
        }
    }
}

const enum DemoActionType {
    Appear = 0,
    Kill = 1,
    Functor = 2,
    Nerve = 3,
    OnSwitchA = 4,
    OnSwitchB = 5,
    ShowModel = 6,
    HideModel = 7,
    TryTalkTimeKeepDemoMarioPuppetable = 8,
    TryTalkTimeKeepDemoWithoutPauseMarioPuppetable = 9,
    TryTalkTimeKeepDemoWithoutPauseMarioPuppetable_2 = 10,
    Nothing = 11,
    OffSwitchA = 12,
    OffSwitchB = 13,
}

class DemoActionInfo {
    public partName: string;
    public castName: string;
    public castID: number;
    public actionType: number;
    public posName: string;
    public animName: string;

    private actors: LiveActor[] = [];
    private nerves: number[] = [];

    constructor(infoIter: JMapInfoIter) {
        this.partName = assertExists(infoIter.getValueString('PartName'));
        this.castName = assertExists(infoIter.getValueString('CastName'));
        this.castID = assertExists(infoIter.getValueNumber('CastID'));
        this.actionType = assertExists(infoIter.getValueNumber('ActionType'));
        this.posName = fallback(infoIter.getValueString('PosName'), '');
        this.animName = fallback(infoIter.getValueString('AnimName'), '');
    }

    public registerCast(actor: LiveActor): void {
        this.actors.push(actor);
    }

    public registerNerve(actor: LiveActor, nerve: number): void {
        const idx = this.actors.indexOf(actor);
        if (idx < 0)
            return;

        this.nerves[idx] = nerve;
    }

    public executeActionFirst(sceneObjHolder: SceneObjHolder): void {
        // setTalkAnimCtrlInterpole(this.actors[0], 0);

        for (let i = 0; i < this.actors.length; i++) {
            const actor = this.actors[i];
            if (this.actionType === DemoActionType.Appear)
                actor.makeActorAppeared(sceneObjHolder);
            else if (this.actionType === DemoActionType.Kill)
                actor.makeActorDead(sceneObjHolder);
            else if (this.actionType === DemoActionType.Functor)
                throw "whoops";
            else if (this.actionType === DemoActionType.Nerve)
                actor.setNerve(this.nerves[i]);
            else if (this.actionType === DemoActionType.OnSwitchA)
                actor.stageSwitchCtrl!.onSwitchA(sceneObjHolder);
            else if (this.actionType === DemoActionType.OnSwitchB)
                actor.stageSwitchCtrl!.onSwitchB(sceneObjHolder);
            else if (this.actionType === DemoActionType.OffSwitchA)
                actor.stageSwitchCtrl!.offSwitchA(sceneObjHolder);
            else if (this.actionType === DemoActionType.OffSwitchB)
                actor.stageSwitchCtrl!.offSwitchB(sceneObjHolder);

            if (this.animName !== '')
                startAction(actor, this.animName);
            // TODO(jstpierre): GeneralPos
            // if (this.posName !== '')
            //     findNamePos()
        }
    }

    public executeActionLast(sceneObjHolder: SceneObjHolder): void {
        // Talk stuff only.
    }
}

function translateJpName(sceneObjHolder: SceneObjHolder, jp_name: string): string {
    if (!sceneObjHolder.objNameTable.findRecord((infoIter) => infoIter.getValueString('jp_name') === jp_name))
        throw "whoops";
    return sceneObjHolder.objNameTable.getValueString('en_name')!;
}

function isNameDemoCast(sceneObjHolder: SceneObjHolder, actor: LiveActor, castName: string): boolean {
    // castName is Japanese, actor.name is English. Translate.
    if (actor.name === castName)
        return true;
    const en_name = translateJpName(sceneObjHolder, castName);
    if (actor.name === en_name)
        return true;
    return false;
}

function getDemoCastID(infoIter: JMapInfoIter): number {
    return fallback(infoIter.getValueNumber('CastId'), -1);
}

function isTargetDemoCast(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter, castName: string, castID: number): boolean {
    if (!isNameDemoCast(sceneObjHolder, actor, castName))
        return false;
    const actorCastID = getDemoCastID(infoIter);
    if (actorCastID < 0 || actorCastID === castID)
        return true;
    return false;
}

function isTimeKeepDemoActive(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.demoDirector === null)
        return false;
    return sceneObjHolder.demoDirector.currentExecutor !== null;
}

function getCurrentTimeKeeper(sceneObjHolder: SceneObjHolder): DemoTimeKeeper {
    return sceneObjHolder.demoDirector!.currentExecutor!.timeKeeper;
}

function isCurrentMainPart(sceneObjHolder: SceneObjHolder, partName: string): boolean {
    const currentPartInfo = getCurrentTimeKeeper(sceneObjHolder).getCurrentPartInfo();
    return currentPartInfo !== null && currentPartInfo.partName === partName;
}

function isDemoPartActiveFunction(sceneObjHolder: SceneObjHolder, partName: string): boolean {
    if (!isTimeKeepDemoActive(sceneObjHolder))
        return false;
    if (isCurrentMainPart(sceneObjHolder, partName))
        return true;
    // return getCurrentSubPartKeeper(sceneObjHolder).isDemoPartActive(partName);
    return false;
}

function getDemoPartStepFunction(sceneObjHolder: SceneObjHolder, partName: string): number {
    if (isCurrentMainPart(sceneObjHolder, partName))
        return getCurrentTimeKeeper(sceneObjHolder).partTimer;
    else
        return -1; // getCurrentSubPartKeeper(sceneObjHolder).getDemoPartStep(partName);
}

function isDemoPartFirstStep(sceneObjHolder: SceneObjHolder, partName: string): boolean {
    if (!isDemoPartActiveFunction(sceneObjHolder, partName))
        return false;
    return getDemoPartStepFunction(sceneObjHolder, partName) === 0;
}

function isDemoPartLastStep(sceneObjHolder: SceneObjHolder, partName: string): boolean {
    if (!isDemoPartActiveFunction(sceneObjHolder, partName))
        return false;
    return false;
}

class DemoActionKeeper {
    private actionInfos: DemoActionInfo[];

    constructor(sceneObjHolder: SceneObjHolder, executor: DemoExecutor) {
        const sheet = createSheetParser(sceneObjHolder, executor, 'Action');
        if (sheet !== null)
            this.actionInfos = sheet.mapRecords((infoIter) => new DemoActionInfo(infoIter));
        else
            this.actionInfos = [];
    }

    public initCast(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter): void {
        for (let i = 0; i < this.actionInfos.length; i++) {
            const actionInfo = this.actionInfos[i];
            if (isTargetDemoCast(sceneObjHolder, actor, infoIter, actionInfo.castName, actionInfo.castID))
                this.actionInfos[i].registerCast(actor);
        }
    }

    public update(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.actionInfos.length; i++) {
            const actionInfo = this.actionInfos[i];
            if (isDemoPartFirstStep(sceneObjHolder, actionInfo.partName))
                this.actionInfos[i].executeActionFirst(sceneObjHolder);
            else if (isDemoPartLastStep(sceneObjHolder, actionInfo.partName))
                this.actionInfos[i].executeActionLast(sceneObjHolder);
        }
    }

    public registerNerve(actor: LiveActor, nerve: number, partName: string | null): void {
        for (let i = 0; i < this.actionInfos.length; i++) {
            const actionInfo = this.actionInfos[i];
            if (partName !== null && partName !== actionInfo.partName)
                continue;
            actionInfo.registerNerve(actor, nerve);
        }
    }
}

export class DemoExecutor extends DemoCastGroup {
    public sheetName: string;
    public timeKeeper: DemoTimeKeeper;
    public actionKeeper: DemoActionKeeper;
    // private subPartKeeper: DemoSubPartKeeper;
    // private playerKeeper: DemoPlayerKeeper;
    // private cameraKeeper: DemoCameraKeeper;
    // private wipeKeeper: DemoWipeKeeper;
    // private soundKeeper: DemoSoundKeeper;

    private stageSwitchCtrl: StageSwitchCtrl;

    private curRequester: NameObj | null = null;
    private curDemoName: string | null = null;
    private curMovementControlType: number | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(sceneObjHolder, infoIter);

        sceneObjHolder.create(SceneObj.DemoDirector);
        this.sheetName = getDemoSheetName(infoIter);

        this.timeKeeper = new DemoTimeKeeper(sceneObjHolder, this);
        this.actionKeeper = new DemoActionKeeper(sceneObjHolder, this);

        this.stageSwitchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
        if (this.stageSwitchCtrl.isValidSwitchAppear()) {
            const eventListener = new SwitchFunctorEventListener(this.startProperDemoSystem.bind(this), null);
            getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerAppear(this.stageSwitchCtrl!, eventListener);
        }

        registerDemoExecutor(sceneObjHolder, this);
    }

    private end(sceneObjHolder: SceneObjHolder): void {
        this.timeKeeper.end();
        // this.subPartKeeper.end();
        // this.cameraKeeper.end();

        if (this.curMovementControlType === 2 || this.curMovementControlType === 1)
            endDemo(sceneObjHolder, this.curRequester!, this.curDemoName!);

        this.curRequester = null;
        this.curDemoName = null;
        this.curMovementControlType = null;

        if (this.stageSwitchCtrl.isValidSwitchDead())
            this.stageSwitchCtrl.onSwitchDead(sceneObjHolder);
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;

        this.timeKeeper.update(deltaTimeFrames);
        if (this.timeKeeper.isDemoEnd()) {
            this.end(sceneObjHolder);
        } else {
            if (!this.timeKeeper.paused) {
                // this.subPartKeeper.update();
                this.actionKeeper.update(sceneObjHolder);
            }
        }
    }

    public override registerDemoActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter): void {
        super.registerDemoActor(sceneObjHolder, actor, infoIter);
        // this.cameraKeeper.initCast(actor, infoIter);
        this.actionKeeper.initCast(sceneObjHolder, actor, infoIter);
    }

    private startProperDemoSystem(sceneObjHolder: SceneObjHolder): void {
        requestStartTimeKeepDemo(sceneObjHolder, this, this.name, null);
    }

    public start(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, movementControlType: number): void {
        this.curRequester = requester;
        this.curDemoName = demoName;
        this.curMovementControlType = movementControlType;

        this.timeKeeper.start();
        // this.cameraKeeper.start();
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        DemoDirector.requestArchives(sceneObjHolder);
    }
}

export class DemoCastGroupHolder<T extends DemoCastGroup> extends NameObjGroup<T> {
    public findCastGroup(name: string): T {
        for (let i = 0; i < this.objArray.length; i++)
            if (this.objArray[i].name === name)
                return this.objArray[i];
        throw "whoops";
    }

    public tryRegisterDemoActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter, idInfo: JMapIdInfo): boolean {
        for (let i = 0; i < this.objArray.length; i++)
            if (this.objArray[i].tryRegisterDemoActor(sceneObjHolder, actor, infoIter, idInfo))
                return true;
        return false;
    }
}

export class DemoDirector extends NameObj {
    public executorHolder: DemoCastGroupHolder<DemoExecutor>;
    public demoSheetArchives: (JKRArchive | null)[] = [];
    public currentExecutor: DemoExecutor | null = null;
    private inDemo = false;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'DemoDirector');
        connectToScene(sceneObjHolder, this, MovementType.DemoDirector, CalcAnimType.None, DrawBufferType.None, DrawType.None);
        this.executorHolder = new DemoCastGroupHolder(sceneObjHolder, 'DemoExecutorHolder', 32);
    }

    public getDemoSheetArchiveForZone(sceneObjHolder: SceneObjHolder, zoneId: number): JKRArchive | null {
        if (this.demoSheetArchives[zoneId] === undefined) {
            if (sceneObjHolder.sceneDesc.gameBit & GameBits.SMG1) {
                if (this.demoSheetArchives[0] === undefined)
                    this.demoSheetArchives[0] = assertExists(sceneObjHolder.modelCache.getObjectData('DemoSheet'));
                this.demoSheetArchives[zoneId] = this.demoSheetArchives[0];
            } else if (sceneObjHolder.sceneDesc.gameBit & GameBits.SMG2) {
                const zoneName = sceneObjHolder.scenarioData.zoneNames[zoneId];
                this.demoSheetArchives[zoneId] = sceneObjHolder.modelCache.getArchive(`StageData/${zoneName}/${zoneName}Demo.arc`);
            } else {
                throw "whoops";
            }
        }

        return this.demoSheetArchives[zoneId];
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        super.movement(sceneObjHolder);

        if (this.currentExecutor !== null) {
            this.currentExecutor.movement(sceneObjHolder);
        }
    }

    private startDemo(sceneObjHolder: SceneObjHolder, requester: NameObj, frameType: CinemaFrameType, movementControlType: number): void {
        this.inDemo = true;
    }

    private startDemoExecutor(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, movementControlType: number, subPartName: string | null): void {
        const demoExecutor = this.executorHolder.findCastGroup(demoName);
        this.currentExecutor = demoExecutor;

        if (subPartName === null)
            demoExecutor.start(sceneObjHolder, requester, demoName, movementControlType);
        else
            throw "whoops";
    }

    public startDemoTimeKeep(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, movementControlType: number, frameType: CinemaFrameType, subPartName: string | null): void {
        this.startDemo(sceneObjHolder, requester, frameType, movementControlType);
        this.startDemoExecutor(sceneObjHolder, requester, demoName, movementControlType, subPartName);
    }

    public registerDemoCast(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter): boolean {
        const demoGroupId = getDemoGroupID(infoIter);
        if (demoGroupId === null)
            return false;

        const infoId = createJMapIdInfoFromIter(sceneObjHolder, demoGroupId, infoIter);
        return this.executorHolder.tryRegisterDemoActor(sceneObjHolder, actor, infoIter, infoId);
    }

    private doDemoEndRequest(sceneObjHolder: SceneObjHolder): void {
        // requestPlaySceneFor
        // activateDefaultGameLayout
        // endStarPointerMode
        // tryFrameToScreenCinemaFrame
        // endRemoteDemo
        this.inDemo = false;
    }

    public endDemo(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, force: boolean = false): void {
        if (/* this.startRequestHolder.isExistStartDemoRequest() */ false) {
            // sendMsgToAllLiveActor(sceneObjHolder, 0x70);
            this.currentExecutor = null;
            this.doDemoEndRequest(sceneObjHolder);
            // this.startDemoRequested(sceneObjHolder);
        } else {
            if (!force || /* isCameraInterpolatingNearlyEnd(sceneObjHolder) */ true) {
                // sendMsgToAllLiveActor(sceneObjHolder, 0x70);
                this.currentExecutor = null;
                this.doDemoEndRequest(sceneObjHolder);
            } else {
                // requestStopSceneOverwrite(requester);
            }
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('DemoSheet');
    }
}

function registerDemoExecutor(sceneObjHolder: SceneObjHolder, executor: DemoExecutor): void {
    sceneObjHolder.create(SceneObj.DemoDirector);
    sceneObjHolder.demoDirector!.executorHolder.registerObj(executor);
}

const enum DemoType { Programmable, TimeKeep }
const enum CinemaFrameType { Unk }
const enum StarPointerType { Unk }
const enum DeleteEffectType { Unk }
function startDemoSystem(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, movementControlType: number, demoType: DemoType, frameType: CinemaFrameType, pointerType: StarPointerType, deleteEffectType: DeleteEffectType, subPartName: string | null = null): void {
    if (demoType === DemoType.TimeKeep) {
        sceneObjHolder.demoDirector!.startDemoTimeKeep(sceneObjHolder, requester, demoName, movementControlType, frameType, subPartName);
    } else {
        throw "whoops";
    }
}

function canStartDemo(sceneObjHolder: SceneObjHolder): boolean {
    // can always start demos currently.
    return true;
}

function requestStartTimeKeepDemo(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string, subPartName: string | null, movementControlType: number = 1, demoType: DemoType = DemoType.TimeKeep, frameType: CinemaFrameType = CinemaFrameType.Unk, starPointerType: StarPointerType = StarPointerType.Unk, deleteEffectType: DeleteEffectType = DeleteEffectType.Unk): void {
    if (canStartDemo(sceneObjHolder)) {
        startDemoSystem(sceneObjHolder, requester, demoName, movementControlType, demoType, frameType, starPointerType, deleteEffectType, subPartName);
    } else {
        throw "whoops";
    }
}

function isRegisteredDemoCastExecutor(executor: DemoExecutor, actor: LiveActor): boolean {
    return executor.group.objArray.includes(actor);
}

function findDemoExecutor(sceneObjHolder: SceneObjHolder, actor: LiveActor): DemoExecutor | null {
    if (sceneObjHolder.demoDirector === null)
        return null;

    const executors = sceneObjHolder.demoDirector.executorHolder.objArray;
    for (let i = 0; i < executors.length; i++)
        if (isRegisteredDemoCastExecutor(executors[i], actor))
            return executors[i];

    return null;
}

export function registerDemoActionNerve<T extends number>(sceneObjHolder: SceneObjHolder, actor: LiveActor<T>, nerve: T, partName: string | null = null): void {
    const executor = findDemoExecutor(sceneObjHolder, actor);
    if (executor === null)
        return;
    executor.actionKeeper.registerNerve(actor, nerve, partName);
}

export function tryRegisterDemoCast(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter): boolean {
    if (sceneObjHolder.demoDirector === null)
        return false;
    return sceneObjHolder.demoDirector.registerDemoCast(sceneObjHolder, actor, infoIter);
}

export function isDemoLastStep(sceneObjHolder: SceneObjHolder): boolean {
    if (!isTimeKeepDemoActive(sceneObjHolder))
        return false;

    const timeKeeper = getCurrentTimeKeeper(sceneObjHolder);
    if (timeKeeper.partTimer !== timeKeeper.getCurrentPartInfo()!.totalStep - 1)
        return false;

    return timeKeeper.isPartLast();
}

export function endDemo(sceneObjHolder: SceneObjHolder, requester: NameObj, demoName: string): void {
    if (sceneObjHolder.demoDirector === null)
        return;
    sceneObjHolder.demoDirector.endDemo(sceneObjHolder, requester, demoName);
}
